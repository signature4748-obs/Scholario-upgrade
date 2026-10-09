import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole, isoToday } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

const PAGE_SIZE = 20;

/** GET /api/students — directory with search, class + status filters, pagination.
 *  PRINCIPAL: whole school. TEACHER: only classes they teach (subject or class-teacher). */
export const GET = route(async (req) => {
  const user = await requireRole("PRINCIPAL", "TEACHER");
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const classId = url.searchParams.get("classId") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const where: any = { schoolId: user.schoolId };
  if (q) {
    where.OR = [{ name: { contains: q } }, { admissionNo: { contains: q.toUpperCase() } }];
  }
  if (classId) where.classId = classId;
  if (status === "ACTIVE" || status === "SUSPENDED" || status === "GRADUATED") where.status = status;

  if (user.role === "TEACHER" && user.teacherId) {
    // scope to classes this teacher teaches or manages
    where.class = {
      OR: [{ classTeacherId: user.teacherId }, { subjects: { some: { teacherId: user.teacherId } } }],
    };
  }

  const [total, rows] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      orderBy: [{ class: { gradeLevel: "asc" } }, { rollNo: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        class: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
  ]);

  return ok({
    role: user.role,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    students: rows.map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: s.name,
      rollNo: s.rollNo,
      classId: s.classId,
      className: s.class.name,
      gender: s.gender,
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone,
      status: s.status,
      email: s.user?.email ?? null,
    })),
  });
});

/* ── create student (PRINCIPAL) ─────────────────────────────────── */

const createSchema = z.object({
  name: z.string().trim().min(3, "Student name looks too short.").max(80),
  classId: z.string().min(1, "Pick a class."),
  gender: z.enum(["M", "F", "O"]).optional(),
  guardianName: z.string().trim().min(3, "Guardian name looks too short.").max(80),
  guardianPhone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{7,14}$/, "Enter a valid phone number."),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be a valid date.")
    .optional()
    .or(z.literal("")),
});

const DEMO_PASSWORD = "Hawkings@2026";

function emailLocalPart(name: string, admTail: string): string {
  const slug = (p: string) => p.toLowerCase().replace(/[^a-z0-9]/g, "");
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = slug(parts[0] ?? "");
  const last = parts.length > 1 ? slug(parts[parts.length - 1]) : "";
  return [first, last, admTail].filter(Boolean).join(".");
}

export const POST = route(async (req) => {
  const user = await requireRole("PRINCIPAL");
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid details.");
  const input = parsed.data;

  const school = await db.school.findUnique({
    where: { id: user.schoolId },
    select: { code: true, academicYear: true },
  });
  if (!school) return fail(400, "School not found for this account.");

  const cls = await db.class.findFirst({
    where: { id: input.classId, schoolId: user.schoolId },
    select: { id: true, name: true },
  });
  if (!cls) return fail(400, "That class does not exist in your school.");

  // next admission number: HHSP-2026-<next>
  const prefix = `${school.code}-${school.academicYear.slice(0, 4)}-`;
  const existing = await db.student.findMany({
    where: { schoolId: user.schoolId, admissionNo: { startsWith: prefix } },
    select: { admissionNo: true },
  });
  let maxSeq = 1000;
  for (const s of existing) {
    const n = parseInt(s.admissionNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  }
  const admissionNo = `${prefix}${maxSeq + 1}`;

  // next roll number in the class
  const lastRoll = await db.student.findFirst({
    where: { classId: cls.id },
    orderBy: { rollNo: "desc" },
    select: { rollNo: true },
  });
  const rollNo = (lastRoll?.rollNo ?? 0) + 1;

  // login: first.last.<last4ofadm>@students.<code>.edu.in
  const domain = `students.${school.code.toLowerCase()}.edu.in`;
  let email = `${emailLocalPart(input.name, admissionNo.slice(-4))}@${domain}`;
  for (let n = 2; ; n++) {
    const clash = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!clash) break;
    email = `${emailLocalPart(input.name, admissionNo.slice(-4))}${n}@${domain}`;
  }

  const student = await db.$transaction(async (tx) => {
    const account = await tx.user.create({
      data: {
        schoolId: user.schoolId,
        email,
        name: input.name,
        role: "STUDENT",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    });
    return tx.student.create({
      data: {
        schoolId: user.schoolId,
        userId: account.id,
        admissionNo,
        rollNo,
        name: input.name,
        classId: cls.id,
        gender: input.gender ?? null,
        dob: input.dob ? new Date(input.dob + "T00:00:00") : null,
        guardianName: input.guardianName,
        guardianPhone: input.guardianPhone,
        admittedOn: new Date(isoToday() + "T00:00:00"),
        status: "ACTIVE",
      },
    });
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Enrolled",
      detail: `${student.name} (${admissionNo}) added to ${cls.name} · roll ${rollNo}`,
    },
  });

  return ok({
    id: student.id,
    admissionNo,
    rollNo,
    className: cls.name,
    // credentials are shown exactly once, right here
    email,
    password: DEMO_PASSWORD,
  });
});
