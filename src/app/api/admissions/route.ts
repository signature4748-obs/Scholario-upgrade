import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";
import { hashPassword } from "@/lib/auth";

/** Linear inquiry pipeline; CLOSED is reachable from any live stage. */
const NEXT: Record<string, string[]> = {
  NEW: ["CONTACTED", "CLOSED"],
  CONTACTED: ["VISIT_SCHEDULED", "CLOSED"],
  VISIT_SCHEDULED: ["APPLICATION", "CLOSED"],
  APPLICATION: ["ENROLLED", "CLOSED"],
  ENROLLED: [],
  CLOSED: [],
};

const SOURCES = ["WALK_IN", "WEBSITE", "PHONE", "REFERRAL"] as const;

const postSchema = z.object({
  applicantName: z.string().trim().min(2).max(80),
  classSought: z.string().trim().min(2).max(30),
  parentName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)),
  source: z.enum(SOURCES),
  note: z.string().trim().max(400).optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(2).max(30),
  note: z.string().trim().max(400).optional(),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => null)),
});

export const GET = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const status = new URL(req.url).searchParams.get("status");

  const [inquiries, counts, classes] = await Promise.all([
    db.admissionInquiry.findMany({
      where: { schoolId: user.schoolId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    }),
    db.admissionInquiry.groupBy({ by: ["status"], where: { schoolId: user.schoolId }, _count: { _all: true } }),
    db.class.findMany({ where: { schoolId: user.schoolId }, orderBy: { gradeLevel: "asc" }, select: { name: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const c of counts) statusCounts[c.status] = c._count._all;

  // "Class 6-A" → "Class 6"; Nursery/LKG/IKG keep their label.
  const classOptions = [...new Set(classes.map((c) => c.name.replace(/-[^-]+$/, "")))];

  return ok({
    inquiries,
    statusCounts,
    classOptions,
    total: inquiries.length,
  });
});

export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = postSchema.parse(await req.json().catch(() => ({})));

  const cls = await db.class.findFirst({
    where: { schoolId: user.schoolId, name: { startsWith: `${body.classSought}-` } },
    select: { id: true },
  });
  if (!cls) throw fail(400, `No section exists for ${body.classSought}. Pick a class from the list.`);

  const inquiry = await db.$transaction(async (tx) => {
    const created = await tx.admissionInquiry.create({
      data: {
        schoolId: user.schoolId, applicantName: body.applicantName, classSought: body.classSought,
        parentName: body.parentName, phone: body.phone, email: body.email ?? null,
        source: body.source, note: body.note ?? null,
      },
    });
    await tx.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Admissions",
        detail: `New inquiry — ${body.classSought} (${body.applicantName}, ${body.source.toLowerCase().replace("_", " ")})`,
      },
    });
    return created;
  });

  return ok(inquiry);
});

export const PATCH = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const body = patchSchema.parse(await req.json().catch(() => ({})));

  const inquiry = await db.admissionInquiry.findUnique({ where: { id: body.id } });
  if (!inquiry || inquiry.schoolId !== user.schoolId) throw fail(404, "Inquiry not found in this school.");

  const changingStatus = body.status !== inquiry.status;
  if (changingStatus && !NEXT[inquiry.status]?.includes(body.status)) {
    throw fail(409, `An inquiry at ${inquiry.status.toLowerCase().replace(/_/g, " ")} cannot move to ${body.status.toLowerCase().replace(/_/g, " ")}.`);
  }

  if (body.status === "ENROLLED") {
    const result = await enrollFromInquiry(user, inquiry, body);
    return ok(result);
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.admissionInquiry.update({
      where: { id: inquiry.id },
      data: {
        status: body.status,
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.followUpOn !== undefined ? { followUpOn: body.followUpOn } : {}),
      },
    });
    if (changingStatus) {
      await tx.activityLog.create({
        data: {
          schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
          action: "Admissions",
          detail: `Inquiry for ${inquiry.applicantName} (${inquiry.classSought}) marked ${body.status.toLowerCase().replace(/_/g, " ")}`,
        },
      });
    }
    return row;
  });

  return ok(updated);
});

/** ENROLLED: convert the inquiry into a Student + login, mirroring the students module. */
async function enrollFromInquiry(
  user: { id: string; schoolId: string; name: string; role: string },
  inquiry: { id: string; applicantName: string; classSought: string; parentName: string; phone: string },
  body: { note?: string; followUpOn?: string | null },
) {
  const school = await db.school.findUnique({
    where: { id: user.schoolId },
    select: { code: true, email: true, slug: true },
  });
  if (!school) throw fail(404, "School not found.");

  const cls = await db.class.findFirst({
    where: { schoolId: user.schoolId, name: { startsWith: `${inquiry.classSought}-` } },
    orderBy: [{ gradeLevel: "asc" }, { section: "asc" }],
    select: { id: true, name: true },
  });
  if (!cls) throw fail(400, `No section exists for ${inquiry.classSought} — cannot enrol yet.`);

  const prefix = `${school.code}-2026-`;
  const last = await db.student.findFirst({
    where: { schoolId: user.schoolId, admissionNo: { startsWith: prefix } },
    orderBy: { admissionNo: "desc" },
    select: { admissionNo: true },
  });
  const nextNum = last ? parseInt(last.admissionNo.slice(prefix.length), 10) + 1 : 1001;
  const admissionNo = `${prefix}${String(nextNum).padStart(4, "0")}`;

  const parts = inquiry.applicantName.trim().split(/\s+/);
  const emailLocal = `${parts[0]!.toLowerCase()}.${parts[parts.length - 1]!.toLowerCase()}.${admissionNo.slice(-4)}`;
  const domain = school.email?.split("@")[1] ?? `${school.slug}.edu.in`;
  const email = `${emailLocal}@students.${domain}`;
  const password = "Hawkings@2026";

  const rollRow = await db.student.findFirst({
    where: { classId: cls.id },
    orderBy: { rollNo: "desc" },
    select: { rollNo: true },
  });
  const rollNo = (rollRow?.rollNo ?? 0) + 1;

  const result = await db.$transaction(async (tx) => {
    const account = await tx.user.create({
      data: {
        schoolId: user.schoolId, email, name: inquiry.applicantName,
        role: "STUDENT", passwordHash: hashPassword(password),
      },
    });
    const student = await tx.student.create({
      data: {
        schoolId: user.schoolId, userId: account.id, admissionNo, rollNo,
        name: inquiry.applicantName, classId: cls.id,
        guardianName: inquiry.parentName, guardianPhone: inquiry.phone,
        admittedOn: new Date(), status: "ACTIVE",
      },
    });
    const updated = await tx.admissionInquiry.update({
      where: { id: inquiry.id },
      data: {
        status: "ENROLLED",
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.followUpOn !== undefined ? { followUpOn: body.followUpOn } : {}),
      },
    });
    await tx.activityLog.create({
      data: {
        schoolId: user.schoolId, actorName: user.name, actorRole: user.role,
        action: "Student enrolled",
        detail: `${inquiry.applicantName} enrolled from inquiry — ${cls.name}, roll no. ${rollNo}`,
      },
    });
    return { updated, student };
  });

  return {
    ...result.updated,
    credentials: {
      admissionNo,
      email,
      password,
      className: cls.name,
      rollNo,
    },
  };
}
