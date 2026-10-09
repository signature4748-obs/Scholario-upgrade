import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/exams — exam list with slot counts, marks entered and school average.
 *  PRINCIPAL also receives the classes+subjects catalogue (for slot dialogs). */
export const GET = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL", "TEACHER");
  const schoolId = user.schoolId;

  const exams = await db.exam.findMany({
    where: { schoolId },
    orderBy: [{ startsOn: "desc" }, { name: "asc" }],
  });
  const slots = await db.examSubject.findMany({
    where: { exam: { schoolId } },
    select: { id: true, examId: true, maxMarks: true },
  });
  const markAgg = await db.mark.groupBy({
    by: ["examSubjectId"],
    where: { examSubject: { exam: { schoolId } } },
    _count: { _all: true },
    _sum: { obtained: true },
  });
  const aggBySlot = new Map(markAgg.map((m) => [m.examSubjectId, m]));

  const summaries = exams.map((e) => {
    const examSlots = slots.filter((s) => s.examId === e.id);
    let entered = 0;
    let obtained = 0;
    let possible = 0;
    for (const s of examSlots) {
      const a = aggBySlot.get(s.id);
      if (a) {
        entered += a._count._all;
        obtained += a._sum.obtained ?? 0;
        possible += a._count._all * s.maxMarks;
      }
    }
    return {
      id: e.id,
      name: e.name,
      term: e.term,
      status: e.status,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      slotCount: examSlots.length,
      entered,
      avgPct: possible > 0 ? Math.round((obtained / possible) * 1000) / 10 : null,
    };
  });

  let classes: any[] = [];
  if (user.role === "PRINCIPAL") {
    const rows = await db.class.findMany({
      where: { schoolId, subjects: { some: {} } },
      orderBy: { gradeLevel: "asc" },
      select: {
        id: true, name: true, gradeLevel: true,
        subjects: {
          orderBy: { subject: { name: "asc" } },
          select: { subject: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    classes = rows.map((c) => ({
      id: c.id, name: c.name, gradeLevel: c.gradeLevel,
      subjects: c.subjects.map((cs) => cs.subject),
    }));
  }

  return ok({ exams: summaries, classes });
});

const CreateBody = z.object({
  name: z.string().trim().min(3, "Give the exam a name (at least 3 characters).").max(120),
  term: z.enum(["PA1", "HALF_YEARLY", "PA2", "ANNUAL"]),
  startsOn: z.string().regex(DATE_RE, "Start date must be YYYY-MM-DD."),
  endsOn: z.string().regex(DATE_RE, "End date must be YYYY-MM-DD."),
});

/** POST /api/exams — principal creates an exam shell (status SCHEDULED). */
export const POST = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid exam details.");
  }
  const { name, term, startsOn, endsOn } = parsed.data;
  if (endsOn < startsOn) {
    return fail(400, "The exam cannot end before it starts.");
  }

  const dupe = await db.exam.findFirst({ where: { schoolId: user.schoolId, name } });
  if (dupe) return fail(400, "An exam with this name already exists — pick a different name.");

  const exam = await db.exam.create({
    data: { schoolId: user.schoolId, name, term, startsOn, endsOn, status: "SCHEDULED" },
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Exam",
      detail: `${name} scheduled (${term.replace("_", "-")} · ${startsOn} to ${endsOn})`,
    },
  });

  return ok({
    id: exam.id, name: exam.name, term: exam.term,
    status: exam.status, startsOn: exam.startsOn, endsOn: exam.endsOn,
  });
});
