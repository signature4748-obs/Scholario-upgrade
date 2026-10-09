import { db } from "@/lib/db";
import { requireRole, ok, fail, route } from "@/lib/api";
import { gradeFor } from "@/lib/format";

/** GET /api/results — exam results for the signed-in student.
 *  Returns every exam that has subject slots for the student's class:
 *  published exams carry per-subject marks (obtained / max / grade /
 *  class average) plus an overall summary; scheduled or ongoing exams
 *  carry only their datesheet so the UI can show an honest "awaited"
 *  state. STUDENT role only; tenant derives from the session. */
export const GET = route(async () => {
  const user = await requireRole("STUDENT");

  const student = await db.student.findUnique({
    where: { id: user.studentId ?? "" },
    include: { class: { select: { name: true } } },
  });
  if (!student || student.schoolId !== user.schoolId) {
    throw fail(404, "No student profile linked to this account.");
  }

  const exams = await db.exam.findMany({
    where: { schoolId: user.schoolId, slots: { some: { classId: student.classId } } },
    include: {
      slots: {
        where: { classId: student.classId },
        orderBy: [{ heldOn: "asc" }, { subject: { name: "asc" } }],
        include: {
          subject: { select: { name: true, code: true, passMarks: true, fullMarks: true } },
          marks: { select: { studentId: true, obtained: true, grade: true } },
        },
      },
    },
  });

  const payload = exams
    .map((exam) => {
      const published = exam.status === "PUBLISHED";

      const subjects = exam.slots.map((slot) => {
        const mine = slot.marks.find((m) => m.studentId === student.id) ?? null;
        const avg = slot.marks.length
          ? slot.marks.reduce((t, m) => t + m.obtained, 0) / slot.marks.length
          : null;
        return {
          subject: slot.subject.name,
          code: slot.subject.code,
          maxMarks: slot.maxMarks,
          passMarks: slot.subject.passMarks,
          // pass threshold scaled to this paper's max marks (passMarks is
          // defined against the subject's full marks, e.g. 33/100)
          passAt: Math.ceil((slot.subject.passMarks / Math.max(1, slot.subject.fullMarks)) * slot.maxMarks),
          obtained: mine?.obtained ?? null,
          grade: mine?.grade ?? (mine ? gradeFor((mine.obtained / slot.maxMarks) * 100) : null),
          classAvg: avg != null ? Math.round(avg * 10) / 10 : null,
        };
      });

      let overall: {
        totalObtained: number;
        totalMax: number;
        pct: number;
        grade: string;
        best: { subject: string; pct: number } | null;
      } | null = null;
      if (published) {
        const scored = subjects.filter((s) => s.obtained != null);
        if (scored.length) {
          const totalObtained = scored.reduce((t, s) => t + (s.obtained ?? 0), 0);
          const totalMax = scored.reduce((t, s) => t + s.maxMarks, 0);
          const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 1000) / 10 : 0;
          const best = scored
            .map((s) => ({ subject: s.subject, pct: Math.round(((s.obtained ?? 0) / s.maxMarks) * 1000) / 10 }))
            .sort((a, b) => b.pct - a.pct)[0];
          overall = { totalObtained, totalMax, pct, grade: gradeFor(pct), best: best ?? null };
        }
      }

      return {
        id: exam.id,
        name: exam.name,
        term: exam.term,
        status: exam.status,
        startsOn: exam.startsOn,
        endsOn: exam.endsOn,
        published,
        subjects: published ? subjects : [],
        datesheet: published
          ? []
          : exam.slots
              .filter((sl) => sl.heldOn)
              .map((sl) => ({ subject: sl.subject.name, heldOn: sl.heldOn as string })),
        overall,
      };
    })
    .sort((a, b) =>
      a.published === b.published ? b.startsOn.localeCompare(a.startsOn) : a.published ? -1 : 1,
    );

  return ok({ className: student.class.name, exams: payload });
});
