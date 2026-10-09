import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireSession, requireRole } from "@/lib/api";
import { gradeFor } from "@/lib/format";

/** GET /api/marks
 *  ?scope=mine                      → teacher's assigned sheets (teaches subject or homeroom)
 *  ?examId&classId&subjectId        → roster with existing marks (teacher: own slots only; principal: any) */
export const GET = route(async (req: Request) => {
  const user = await requireSession();
  if (user.role !== "PRINCIPAL" && user.role !== "TEACHER") {
    throw fail(403, "Marks sheets are for teachers and the principal.");
  }
  const url = new URL(req.url);
  const schoolId = user.schoolId;

  /* ── my sheets ── */
  if (url.searchParams.get("scope") === "mine") {
    if (user.role !== "TEACHER" || !user.teacherId) {
      throw fail(403, "Only teachers have assigned marks sheets.");
    }
    const teacherId = user.teacherId;

    const slots = await db.examSubject.findMany({
      where: {
        exam: { schoolId },
        OR: [
          { class: { classTeacherId: teacherId } },
          { class: { subjects: { some: { teacherId } } } },
        ],
      },
      orderBy: [{ exam: { startsOn: "asc" } }, { class: { name: "asc" } }, { subject: { name: "asc" } }],
      include: {
        exam: { select: { id: true, name: true, term: true, status: true } },
        class: { select: { id: true, name: true } },
        subject: { select: { id: true, code: true, name: true } },
        _count: { select: { marks: true } },
      },
    });

    const myCs = await db.classSubject.findMany({
      where: { teacherId },
      select: { classId: true, subjectId: true },
    });
    const taught = new Set(myCs.map((cs) => `${cs.classId}|${cs.subjectId}`));

    const classIds = [...new Set(slots.map((s) => s.classId))];
    const strengths = await db.student.groupBy({
      by: ["classId"],
      where: { classId: { in: classIds }, status: "ACTIVE", schoolId },
      _count: { _all: true },
    });
    const strengthByClass = new Map(strengths.map((s) => [s.classId, s._count._all]));

    return ok({
      slots: slots.map((s) => ({
        id: s.id,
        examId: s.exam.id,
        examName: s.exam.name,
        term: s.exam.term,
        examStatus: s.exam.status,
        classId: s.classId,
        className: s.class.name,
        subjectId: s.subjectId,
        subjectCode: s.subject.code,
        subjectName: s.subject.name,
        maxMarks: s.maxMarks,
        heldOn: s.heldOn,
        entered: s._count.marks,
        total: strengthByClass.get(s.classId) ?? 0,
        isMineTeach: taught.has(`${s.classId}|${s.subjectId}`),
      })),
    });
  }

  /* ── roster ── */
  const examId = url.searchParams.get("examId") ?? "";
  const classId = url.searchParams.get("classId") ?? "";
  const subjectId = url.searchParams.get("subjectId") ?? "";
  if (!examId || !classId || !subjectId) {
    throw fail(400, "examId, classId and subjectId are required.");
  }

  const slot = await db.examSubject.findFirst({
    where: {
      examId, classId, subjectId,
      exam: { schoolId },
      class: { schoolId },
      subject: { schoolId },
    },
    include: {
      exam: { select: { id: true, name: true, term: true, status: true } },
      class: { select: { id: true, name: true, classTeacherId: true } },
      subject: { select: { id: true, code: true, name: true } },
    },
  });
  if (!slot) throw fail(404, "No such marks sheet for this exam, class and subject.");

  if (user.role === "TEACHER") {
    if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");
    const teaches = await db.classSubject.findFirst({
      where: { classId: slot.classId, subjectId: slot.subjectId, teacherId: user.teacherId },
    });
    const homeroom = slot.class.classTeacherId === user.teacherId;
    if (!teaches && !homeroom) {
      throw fail(403, "You can only open marks sheets for subjects you teach, or your own homeroom class.");
    }
  }

  const students = await db.student.findMany({
    where: { classId: slot.classId, status: "ACTIVE", schoolId },
    orderBy: { rollNo: "asc" },
    select: { id: true, rollNo: true, name: true },
  });
  const marks = await db.mark.findMany({
    where: { examSubjectId: slot.id },
    select: { studentId: true, obtained: true, grade: true },
  });
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));

  return ok({
    examSubjectId: slot.id,
    examName: slot.exam.name,
    term: slot.exam.term,
    examStatus: slot.exam.status,
    classId: slot.classId,
    className: slot.class.name,
    subjectId: slot.subjectId,
    subjectName: slot.subject.name,
    subjectCode: slot.subject.code,
    maxMarks: slot.maxMarks,
    heldOn: slot.heldOn,
    rows: students.map((s) => ({
      studentId: s.id,
      rollNo: s.rollNo,
      name: s.name,
      obtained: byStudent.get(s.id)?.obtained ?? null,
      grade: byStudent.get(s.id)?.grade ?? null,
    })),
  });
});

const SaveBody = z.object({
  examSubjectId: z.string().min(1, "Missing marks sheet."),
  marks: z
    .array(
      z.object({
        studentId: z.string().min(1),
        obtained: z.number().int().min(0, "Marks cannot be negative."),
      }),
    )
    .min(1, "Enter at least one mark.")
    .max(300, "That's more rows than any section has."),
});

/** POST /api/marks — teacher batch-saves marks for one exam-subject slot.
 *  Upserts per student, validates 0..maxMarks, auto-grades on the CBSE scale. */
export const POST = route(async (req: Request) => {
  const user = await requireRole("TEACHER");
  if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");
  const teacherId = user.teacherId;

  const parsed = SaveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid marks payload.");
  }
  const { examSubjectId, marks } = parsed.data;

  const slot = await db.examSubject.findFirst({
    where: { id: examSubjectId, exam: { schoolId: user.schoolId } },
    include: {
      class: { select: { id: true, name: true, classTeacherId: true, schoolId: true } },
      subject: { select: { id: true, name: true } },
    },
  });
  if (!slot || slot.class.schoolId !== user.schoolId) throw fail(404, "Marks sheet not found.");

  const teaches = await db.classSubject.findFirst({
    where: { classId: slot.classId, subjectId: slot.subjectId, teacherId },
  });
  const homeroom = slot.class.classTeacherId === teacherId;
  if (!teaches && !homeroom) {
    throw fail(403, "You can only enter marks for subjects you teach, or your own homeroom class.");
  }

  const outOfRange = marks.find((m) => m.obtained > slot.maxMarks);
  if (outOfRange) {
    return fail(400, `Marks must be within 0–${slot.maxMarks} for ${slot.subject.name}.`);
  }

  const studentIds = [...new Set(marks.map((m) => m.studentId))];
  const validStudents = await db.student.findMany({
    where: { id: { in: studentIds }, classId: slot.classId, status: "ACTIVE", schoolId: user.schoolId },
    select: { id: true },
  });
  const validIds = new Set(validStudents.map((s) => s.id));
  if (validIds.size !== studentIds.length) {
    return fail(400, "Some students don't belong to this class — refresh and try again.");
  }

  await db.$transaction(
    marks.map((m) =>
      db.mark.upsert({
        where: { examSubjectId_studentId: { examSubjectId: slot.id, studentId: m.studentId } },
        create: {
          examSubjectId: slot.id,
          studentId: m.studentId,
          obtained: m.obtained,
          grade: gradeFor((m.obtained / slot.maxMarks) * 100),
          enteredById: user.id,
        },
        update: {
          obtained: m.obtained,
          grade: gradeFor((m.obtained / slot.maxMarks) * 100),
          enteredById: user.id,
        },
      }),
    ),
  );

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Marks entry",
      detail: `Marks saved for ${slot.class.name} (${slot.subject.name}) — ${marks.length} entries`,
    },
  });

  return ok({ saved: marks.length });
});
