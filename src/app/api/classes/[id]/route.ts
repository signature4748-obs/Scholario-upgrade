import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

/** PATCH /api/classes/[id] — change the class teacher (PRINCIPAL). */
const patchSchema = z.object({
  classTeacherId: z.string().min(1, "Pick a teacher."),
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireRole("PRINCIPAL");
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid teacher.");

  const cls = await db.class.findFirst({
    where: { id, schoolId: user.schoolId },
    include: { classTeacher: { include: { user: { select: { name: true } } } } },
  });
  if (!cls) return fail(404, "Class not found.");

  const teacher = await db.teacher.findFirst({
    where: { id: parsed.data.classTeacherId, schoolId: user.schoolId, status: "ACTIVE" },
    include: { user: { select: { name: true } } },
  });
  if (!teacher) return fail(400, "That teacher is not active in your school.");
  if (cls.classTeacherId === teacher.id) {
    return fail(400, `${teacher.user.name} already leads ${cls.name}.`);
  }

  await db.class.update({ where: { id: cls.id }, data: { classTeacherId: teacher.id } });

  const from = cls.classTeacher?.user?.name ?? "—";
  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Class teacher",
      detail: `${cls.name} class teacher changed from ${from} to ${teacher.user.name}`,
    },
  });

  return ok({ id: cls.id, classTeacher: teacher.user.name });
});
