import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

/** GET /api/students/[id] — full profile: guardian, attendance %, fee dues, PA1 summary.
 *  PRINCIPAL: any student · TEACHER: only students of classes they teach · STUDENT: own record. */
export const GET = route(async (req, ctx) => {
  const user = await requireRole("PRINCIPAL", "TEACHER", "STUDENT");
  const { id } = await ctx.params;

  const student = await db.student.findFirst({
    where: { id, schoolId: user.schoolId },
    include: {
      class: { select: { id: true, name: true, classTeacher: { select: { user: { select: { name: true } } } } } },
      user: { select: { email: true } },
    },
  });
  if (!student) return fail(404, "Student not found.");

  if (user.role === "STUDENT" && student.id !== user.studentId) {
    return fail(403, "You can only view your own profile.");
  }
  if (user.role === "TEACHER" && user.teacherId) {
    const [teaches, cls] = await Promise.all([
      db.classSubject.findFirst({ where: { classId: student.classId, teacherId: user.teacherId }, select: { id: true } }),
      db.class.findUnique({ where: { id: student.classId }, select: { classTeacherId: true } }),
    ]);
    if (!teaches && cls?.classTeacherId !== user.teacherId) {
      return fail(403, "This student is not in a class you teach.");
    }
  }

  // attendance summary (all marked days)
  const attCounts = await db.attendance.groupBy({
    by: ["status"],
    where: { studentId: student.id },
    _count: { _all: true },
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
  for (const row of attCounts) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row._count._all;
  }
  const considered = counts.PRESENT + counts.ABSENT + counts.LATE + counts.LEAVE;
  const attendancePct = considered > 0 ? Math.round(((counts.PRESENT + counts.LATE) / considered) * 1000) / 10 : null;

  // fee dues
  const dues = await db.feeAssessment.findMany({
    where: { studentId: student.id, status: "DUE" },
    include: { feeStructure: { select: { head: true, frequency: true } } },
    orderBy: { dueOn: "asc" },
  });
  const totalDue = dues.reduce((t, d) => t + d.amount - d.concession, 0);

  // PA1 summary (latest published PA1)
  const pa1 = await db.exam.findFirst({
    where: { schoolId: user.schoolId, term: "PA1", status: "PUBLISHED" },
    select: { id: true, name: true },
  });
  let pa1Summary: {
    name: string;
    subjects: { subject: string; obtained: number | null; maxMarks: number; grade: string | null; classAvg: number | null }[];
    overallPct: number | null;
  } | null = null;
  if (pa1) {
    const slots = await db.examSubject.findMany({
      where: { examId: pa1.id, classId: student.classId },
      include: {
        subject: { select: { name: true } },
        marks: { select: { studentId: true, obtained: true, grade: true } },
      },
      orderBy: { subject: { name: "asc" } },
    });
    const subjects = slots.map((slot) => {
      const mine = slot.marks.find((m) => m.studentId === student.id);
      const avg = slot.marks.length ? slot.marks.reduce((t, m) => t + m.obtained, 0) / slot.marks.length : null;
      return {
        subject: slot.subject.name,
        obtained: mine?.obtained ?? null,
        maxMarks: slot.maxMarks,
        grade: mine?.grade ?? null,
        classAvg: avg != null ? Math.round(avg * 10) / 10 : null,
      };
    });
    const marked = subjects.filter((s) => s.obtained != null);
    const overallPct =
      marked.length > 0
        ? Math.round((marked.reduce((t, s) => t + (s.obtained ?? 0), 0) / marked.reduce((t, s) => t + s.maxMarks, 0)) * 1000) / 10
        : null;
    pa1Summary = { name: pa1.name, subjects, overallPct };
  }

  return ok({
    student: {
      id: student.id,
      admissionNo: student.admissionNo,
      name: student.name,
      rollNo: student.rollNo,
      className: student.class.name,
      classTeacher: student.class.classTeacher?.user?.name ?? null,
      gender: student.gender,
      dob: student.dob ? student.dob.toISOString().slice(0, 10) : null,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      address: student.address,
      admittedOn: student.admittedOn.toISOString().slice(0, 10),
      status: student.status,
      email: student.user?.email ?? null,
    },
    attendance: { pct: attendancePct, counts, considered },
    fees: {
      totalDue,
      dueCount: dues.length,
      items: dues.slice(0, 6).map((d) => ({
        head: d.feeStructure.head,
        amount: d.amount - d.concession,
        dueOn: d.dueOn,
      })),
    },
    pa1: pa1Summary,
  });
});

/* ── suspend / reactivate (PRINCIPAL) ───────────────────────────── */

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"], { message: "Status can only be set to active or suspended." }),
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireRole("PRINCIPAL");
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid status.");

  const student = await db.student.findFirst({
    where: { id, schoolId: user.schoolId },
    include: { class: { select: { name: true } } },
  });
  if (!student) return fail(404, "Student not found.");
  if (student.status === parsed.data.status) {
    return fail(400, `${student.name} is already ${parsed.data.status.toLowerCase()}.`);
  }

  await db.$transaction([
    db.student.update({ where: { id: student.id }, data: { status: parsed.data.status } }),
    ...(student.userId
      ? [db.user.update({ where: { id: student.userId }, data: { status: parsed.data.status } })]
      : []),
  ]);

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: parsed.data.status === "SUSPENDED" ? "Suspended" : "Reactivated",
      detail:
        parsed.data.status === "SUSPENDED"
          ? `${student.name} (${student.admissionNo}) of ${student.class.name} suspended`
          : `${student.name} (${student.admissionNo}) of ${student.class.name} reactivated`,
    },
  });

  return ok({ id: student.id, status: parsed.data.status });
});
