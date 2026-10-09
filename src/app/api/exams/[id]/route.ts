import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/exams/[id] — exam detail with subject slots grouped by class,
 *  marks completeness and (when published) averages. */
export const GET = route(async (req: Request, ctx: any) => {
  const user = await requireRole("PRINCIPAL", "TEACHER");
  const { id } = await ctx.params;

  const exam = await db.exam.findFirst({ where: { id, schoolId: user.schoolId } });
  if (!exam) throw fail(404, "Exam not found.");

  const slots = await db.examSubject.findMany({
    where: { examId: exam.id },
    orderBy: [{ class: { name: "asc" } }, { subject: { name: "asc" } }],
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { id: true, code: true, name: true } },
    },
  });

  const markAgg = await db.mark.groupBy({
    by: ["examSubjectId"],
    where: { examSubject: { examId: exam.id } },
    _count: { _all: true },
    _sum: { obtained: true },
  });
  const aggBySlot = new Map(markAgg.map((m) => [m.examSubjectId, m]));

  const classIds = [...new Set(slots.map((s) => s.classId))];
  const strengths = await db.student.groupBy({
    by: ["classId"],
    where: { classId: { in: classIds }, status: "ACTIVE", schoolId: user.schoolId },
    _count: { _all: true },
  });
  const strengthByClass = new Map(strengths.map((s) => [s.classId, s._count._all]));

  const groupsMap = new Map<string, any>();
  for (const s of slots) {
    if (!groupsMap.has(s.classId)) {
      groupsMap.set(s.classId, {
        classId: s.classId,
        className: s.class.name,
        strength: strengthByClass.get(s.classId) ?? 0,
        slots: [] as any[],
        _obtained: 0,
        _possible: 0,
      });
    }
    const g = groupsMap.get(s.classId);
    const a = aggBySlot.get(s.id);
    const entered = a?._count._all ?? 0;
    const obtained = a?._sum.obtained ?? 0;
    const possible = entered * s.maxMarks;
    g._obtained += obtained;
    g._possible += possible;
    g.slots.push({
      id: s.id,
      subjectId: s.subjectId,
      subjectCode: s.subject.code,
      subjectName: s.subject.name,
      maxMarks: s.maxMarks,
      heldOn: s.heldOn,
      entered,
      total: g.strength,
      avgPct: possible > 0 ? Math.round((obtained / possible) * 1000) / 10 : null,
    });
  }

  const groups = [...groupsMap.values()].map((g) => ({
    classId: g.classId,
    className: g.className,
    strength: g.strength,
    avgPct: g._possible > 0 ? Math.round((g._obtained / g._possible) * 1000) / 10 : null,
    slots: g.slots,
  }));

  return ok({
    exam: {
      id: exam.id, name: exam.name, term: exam.term, status: exam.status,
      startsOn: exam.startsOn, endsOn: exam.endsOn,
    },
    groups,
  });
});

const StatusBody = z.object({ status: z.literal("PUBLISHED") });

const SlotBody = z.object({
  classId: z.string().min(1, "Pick a class."),
  subjectId: z.string().min(1, "Pick a subject."),
  maxMarks: z.number().int().min(1, "Max marks must be at least 1.").max(500, "Max marks cannot exceed 500."),
  heldOn: z.string().regex(DATE_RE, "Pick the exam date (YYYY-MM-DD)."),
});

/** PATCH /api/exams/[id] — principal publishes results, or adds a subject slot. */
export const PATCH = route(async (req: Request, ctx: any) => {
  const user = await requireRole("PRINCIPAL");
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return fail(400, "Invalid request body.");

  const exam = await db.exam.findFirst({ where: { id, schoolId: user.schoolId } });
  if (!exam) throw fail(404, "Exam not found.");

  /* ── publish results ── */
  if ("status" in (raw as object)) {
    const parsed = StatusBody.safeParse(raw);
    if (!parsed.success) return fail(400, "Only publishing is supported from here.");
    if (exam.status === "PUBLISHED") return fail(400, "Results are already published.");

    await db.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED" } });
    await db.activityLog.create({
      data: {
        schoolId: user.schoolId,
        actorName: user.name,
        actorRole: user.role,
        action: "Marks published",
        detail: `${exam.name} — results published school-wide`,
      },
    });
    return ok({ id: exam.id, status: "PUBLISHED" });
  }

  /* ── add subject slot ── */
  const parsed = SlotBody.safeParse(raw);
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid subject slot details.");
  }
  const { classId, subjectId, maxMarks, heldOn } = parsed.data;

  const klass = await db.class.findFirst({ where: { id: classId, schoolId: user.schoolId } });
  if (!klass) throw fail(404, "Class not found.");
  const subject = await db.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } });
  if (!subject) throw fail(404, "Subject not found.");

  const offered = await db.classSubject.findFirst({ where: { classId, subjectId } });
  if (!offered) return fail(400, `${subject.name} is not offered for ${klass.name}.`);

  const existing = await db.examSubject.findFirst({ where: { examId: exam.id, classId, subjectId } });
  if (existing) return fail(400, `${subject.name} already has a slot for ${klass.name} in this exam.`);

  const slot = await db.examSubject.create({
    data: { examId: exam.id, classId, subjectId, maxMarks, heldOn },
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Exam",
      detail: `Subject slot added — ${subject.name} for ${klass.name} (${exam.name}, max ${maxMarks})`,
    },
  });

  return ok({ id: slot.id, classId, subjectId, maxMarks, heldOn });
});
