import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

const DEMO_PASSWORD = "Hawkings@2026";

/** GET /api/teachers — staff directory for the principal, with search. */
export const GET = route(async (req) => {
  const user = await requireRole("PRINCIPAL");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();

  const where: any = { schoolId: user.schoolId };
  if (q) {
    where.OR = [
      { user: { name: { contains: q } } },
      { employeeCode: { contains: q.toUpperCase() } },
      { specialization: { contains: q.toUpperCase() } },
    ];
  }

  const [teachers, assignments, subjects] = await Promise.all([
    db.teacher.findMany({
      where,
      orderBy: [{ monthlySalary: "desc" }],
      include: { user: { select: { name: true, email: true } } },
    }),
    db.classSubject.findMany({
      where: { class: { schoolId: user.schoolId } },
      select: { teacherId: true, subjectId: true },
    }),
    db.subject.findMany({ where: { schoolId: user.schoolId }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  // distinct subjects + class-teacher counts, computed once
  const subjectByTeacher = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!a.teacherId) continue;
    const set = subjectByTeacher.get(a.teacherId) ?? new Set<string>();
    set.add(a.subjectId);
    subjectByTeacher.set(a.teacherId, set);
  }
  const classTeacherCounts = await db.class.groupBy({
    by: ["classTeacherId"],
    where: { schoolId: user.schoolId },
    _count: { _all: true },
  });
  const ctCount = new Map(classTeacherCounts.map((c) => [c.classTeacherId ?? "", c._count._all]));

  return ok({
    role: user.role,
    subjectCodes: subjects.map((s) => ({ code: s.code, name: s.name })),
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.user.name,
      email: t.user.email,
      designation: t.designation,
      employeeCode: t.employeeCode,
      specialization: t.specialization,
      qualification: t.qualification,
      phone: t.phone,
      monthlySalary: t.monthlySalary,
      joinedOn: t.joinedOn ? t.joinedOn.toISOString().slice(0, 10) : null,
      status: t.status,
      subjectsCount: subjectByTeacher.get(t.id)?.size ?? 0,
      classTeacherOf: ctCount.get(t.id) ?? 0,
    })),
  });
});

/* ── create teacher (PRINCIPAL) ─────────────────────────────────── */

const createSchema = z.object({
  name: z.string().trim().min(3, "Teacher name looks too short.").max(80),
  email: z.string().trim().email("Enter a valid email address."),
  designation: z.string().trim().min(2, "Designation is required.").max(60),
  qualification: z.string().trim().max(120).optional().or(z.literal("")),
  specialization: z.string().trim().min(2, "Pick a subject specialization.").max(20),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{7,14}$/, "Enter a valid phone number."),
  monthlySalary: z.coerce.number().int("Salary must be a whole number.").min(1, "Salary must be positive.").max(10000000),
});

export const POST = route(async (req) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid details.");
  const input = parsed.data;

  const school = await db.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
  if (!school) return fail(400, "School not found for this account.");

  const subject = await db.subject.findFirst({
    where: { schoolId: user.schoolId, code: input.specialization },
    select: { name: true },
  });
  if (!subject) return fail(400, "That subject is not taught in your school.");

  const emailTaken = await db.user.findUnique({ where: { email: input.email.toLowerCase() }, select: { id: true } });
  if (emailTaken) return fail(409, "A user with that email already exists.");

  // employee code: HHSP-T-0NN
  const existing = await db.teacher.findMany({
    where: { schoolId: user.schoolId },
    select: { employeeCode: true },
  });
  let maxNo = 0;
  for (const t of existing) {
    const m = t.employeeCode.match(/(\d+)$/);
    if (m) maxNo = Math.max(maxNo, parseInt(m[1], 10));
  }
  const employeeCode = `${school.code}-T-${String(maxNo + 1).padStart(3, "0")}`;

  const teacher = await db.$transaction(async (tx) => {
    const account = await tx.user.create({
      data: {
        schoolId: user.schoolId,
        email: input.email.toLowerCase(),
        name: input.name,
        role: "TEACHER",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    });
    return tx.teacher.create({
      data: {
        schoolId: user.schoolId,
        userId: account.id,
        employeeCode,
        designation: input.designation,
        qualification: input.qualification || null,
        specialization: input.specialization,
        phone: input.phone,
        joinedOn: new Date(),
        monthlySalary: input.monthlySalary,
        status: "ACTIVE",
      },
    });
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Hired",
      detail: `${input.name} joined as ${input.designation} (${employeeCode}) · ${subject.name}`,
    },
  });

  return ok({ id: teacher.id, employeeCode });
});
