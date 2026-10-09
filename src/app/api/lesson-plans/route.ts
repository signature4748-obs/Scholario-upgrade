import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/lesson-plans — teacher's plans + the class/subject pairs they teach. */
export const GET = route(async (req: Request) => {
  const user = await requireRole("TEACHER");
  if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");
  const teacherId = user.teacherId;

  const plans = await db.lessonPlan.findMany({
    where: { teacherId, schoolId: user.schoolId },
    orderBy: [{ status: "asc" }, { date: "desc" }, { createdAt: "desc" }],
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { id: true, code: true, name: true } },
    },
  });

  const cs = await db.classSubject.findMany({
    where: { teacherId, class: { schoolId: user.schoolId } },
    orderBy: [{ class: { gradeLevel: "asc" } }, { subject: { name: "asc" } }],
    include: {
      class: { select: { id: true, name: true } },
      subject: { select: { id: true, code: true, name: true } },
    },
  });

  const byClass = new Map<string, { id: string; name: string; subjects: any[] }>();
  for (const row of cs) {
    if (!byClass.has(row.classId)) {
      byClass.set(row.classId, { id: row.class.id, name: row.class.name, subjects: [] });
    }
    byClass.get(row.classId)!.subjects.push(row.subject);
  }

  return ok({
    plans: plans.map((p) => ({
      id: p.id,
      classId: p.classId,
      className: p.class.name,
      subjectId: p.subjectId,
      subjectName: p.subject.name,
      subjectCode: p.subject.code,
      topic: p.topic,
      objectives: p.objectives,
      materials: p.materials,
      date: p.date,
      periods: p.periods,
      status: p.status,
    })),
    classes: [...byClass.values()],
  });
});

const CreateBody = z.object({
  classId: z.string().min(1, "Pick a class you teach."),
  subjectId: z.string().min(1, "Pick a subject."),
  topic: z.string().trim().min(3, "Give the lesson a topic.").max(160, "Keep the topic under 160 characters."),
  objectives: z.string().trim().max(2000).optional(),
  materials: z.string().trim().max(300).optional(),
  date: z.string().regex(DATE_RE, "Pick the lesson date (YYYY-MM-DD)."),
  periods: z.number().int().min(1, "At least 1 period.").max(3, "At most 3 periods."),
});

/** POST /api/lesson-plans — teacher creates a draft plan for a class+subject they teach. */
export const POST = route(async (req: Request) => {
  const user = await requireRole("TEACHER");
  if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");
  const teacherId = user.teacherId;

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid lesson plan details.");
  }
  const { classId, subjectId, topic, objectives, materials, date, periods } = parsed.data;

  const teaches = await db.classSubject.findFirst({
    where: { classId, subjectId, teacherId, class: { schoolId: user.schoolId } },
    include: {
      class: { select: { name: true } },
      subject: { select: { name: true } },
    },
  });
  if (!teaches) {
    throw fail(403, "You can only plan lessons for subjects you teach in that class.");
  }

  const plan = await db.lessonPlan.create({
    data: {
      schoolId: user.schoolId,
      teacherId,
      classId,
      subjectId,
      topic,
      objectives: objectives ?? null,
      materials: materials ?? null,
      date,
      periods,
      status: "DRAFT",
    },
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Lesson plan",
      detail: `Lesson plan created — “${topic}”, ${teaches.class.name}`,
    },
  });

  return ok({ id: plan.id });
});

const PatchBody = z.object({
  id: z.string().min(1, "Missing plan id."),
  status: z.enum(["TAUGHT", "SKIPPED"]),
});

/** PATCH /api/lesson-plans — teacher closes a draft (TAUGHT / SKIPPED). */
export const PATCH = route(async (req: Request) => {
  const user = await requireRole("TEACHER");
  if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid status change.");
  }
  const { id, status } = parsed.data;

  const plan = await db.lessonPlan.findFirst({
    where: { id, teacherId: user.teacherId, schoolId: user.schoolId },
    include: { class: { select: { name: true } } },
  });
  if (!plan) throw fail(404, "Lesson plan not found.");
  if (plan.status !== "DRAFT") {
    return fail(400, `This plan is already closed as ${plan.status.toLowerCase()} — only drafts can change.`);
  }

  await db.lessonPlan.update({ where: { id: plan.id }, data: { status } });
  return ok({ id: plan.id, status });
});

/** DELETE /api/lesson-plans?id= — teacher removes their own plan. */
export const DELETE = route(async (req: Request) => {
  const user = await requireRole("TEACHER");
  if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");

  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw fail(400, "id is required.");

  const plan = await db.lessonPlan.findFirst({
    where: { id, teacherId: user.teacherId, schoolId: user.schoolId },
  });
  if (!plan) throw fail(404, "Lesson plan not found.");

  await db.lessonPlan.delete({ where: { id: plan.id } });
  return ok({ deleted: plan.id });
});
