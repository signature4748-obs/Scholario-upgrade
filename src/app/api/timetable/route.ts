import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireSession, requireRole } from "@/lib/api";
import { DAYS_FULL } from "@/lib/format";

type SlotInclude = {
  subject: { id: string; code: string; name: string };
  teacher: { id: string; user: { name: string } };
  room: { id: string; code: string; name: string } | null;
  class?: { id: string; name: string };
};

function serializeSlot(s: any, withClass = false) {
  const base: any = {
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    period: s.period,
    subjectId: s.subjectId,
    subjectCode: s.subject.code,
    subjectName: s.subject.name,
    teacherId: s.teacherId,
    teacherName: s.teacher.user.name,
    roomId: s.roomId,
    roomCode: s.room?.code ?? null,
  };
  if (withClass && s.class) {
    base.classId = s.class.id;
    base.className = s.class.name;
  }
  return base;
}

/** GET /api/timetable — role-aware.
 *  PRINCIPAL ?classId= : editable payload (slots + class subjects + teacher options + rooms);
 *  PRINCIPAL (no param)   : class list + rooms;
 *  TEACHER                : own week (slots where teacherId = me, with class names);
 *  STUDENT                : own class slots. */
export const GET = route(async (req: Request) => {
  const user = await requireSession();
  const schoolId = user.schoolId;
  const classId = new URL(req.url).searchParams.get("classId");

  if (user.role === "PRINCIPAL") {
    const rooms = await db.room.findMany({
      where: { schoolId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });

    if (!classId) {
      const classes = await db.class.findMany({
        where: { schoolId },
        orderBy: { gradeLevel: "asc" },
        select: { id: true, name: true, gradeLevel: true, _count: { select: { subjects: true } } },
      });
      return ok({
        classes: classes.map((c) => ({
          id: c.id, name: c.name, gradeLevel: c.gradeLevel, subjectsCount: c._count.subjects,
        })),
        rooms,
      });
    }

    const klass = await db.class.findFirst({ where: { id: classId, schoolId } });
    if (!klass) throw fail(404, "Class not found.");

    const slots = await db.timetableSlot.findMany({
      where: { classId: klass.id },
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
      include: {
        subject: { select: { id: true, code: true, name: true } },
        teacher: { select: { id: true, user: { select: { name: true } } } },
        room: { select: { id: true, code: true, name: true } },
      },
    });

    const classSubjects = await db.classSubject.findMany({
      where: { classId: klass.id },
      orderBy: { subject: { name: "asc" } },
      include: { subject: { select: { id: true, code: true, name: true } } },
    });

    const allAssignments = await db.classSubject.findMany({
      where: { class: { schoolId } },
      select: { teacherId: true, subjectId: true },
    });
    const subjectsByTeacher = new Map<string, string[]>();
    for (const cs of allAssignments) {
      if (!cs.teacherId) continue;
      const arr = subjectsByTeacher.get(cs.teacherId) ?? [];
      if (!arr.includes(cs.subjectId)) arr.push(cs.subjectId);
      subjectsByTeacher.set(cs.teacherId, arr);
    }

    const teachers = await db.teacher.findMany({
      where: { schoolId, status: "ACTIVE" },
      orderBy: { user: { name: "asc" } },
      include: { user: { select: { name: true } } },
    });

    return ok({
      class: { id: klass.id, name: klass.name },
      slots: slots.map((s) => serializeSlot(s)),
      subjects: classSubjects.map((cs) => cs.subject),
      teachers: teachers.map((t) => ({
        id: t.id,
        name: t.user.name,
        subjectIds: subjectsByTeacher.get(t.id) ?? [],
      })),
      rooms,
    });
  }

  if (user.role === "TEACHER") {
    if (!user.teacherId) throw fail(403, "No teacher profile linked to your account.");
    const slots = await db.timetableSlot.findMany({
      where: { teacherId: user.teacherId, schoolId },
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
      include: {
        class: { select: { id: true, name: true } },
        subject: { select: { id: true, code: true, name: true } },
        teacher: { select: { id: true, user: { select: { name: true } } } },
        room: { select: { id: true, code: true, name: true } },
      },
    });
    return ok({ slots: slots.map((s) => serializeSlot(s, true)) });
  }

  /* STUDENT */
  if (!user.studentClassId) throw fail(403, "No class on your profile yet.");
  const klass = await db.class.findFirst({
    where: { id: user.studentClassId, schoolId },
    select: { id: true, name: true },
  });
  if (!klass) throw fail(404, "Class not found.");
  const slots = await db.timetableSlot.findMany({
    where: { classId: klass.id },
    orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
    include: {
      subject: { select: { id: true, code: true, name: true } },
      teacher: { select: { id: true, user: { select: { name: true } } } },
      room: { select: { id: true, code: true, name: true } },
    },
  });
  return ok({ class: klass, slots: slots.map((s) => serializeSlot(s)) });
});

const PutBody = z.object({
  classId: z.string().min(1, "Missing class."),
  dayOfWeek: z.number().int().min(1, "Day must be 1–6.").max(6, "Day must be 1–6."),
  period: z.number().int().min(1, "Period must be 1–8.").max(8, "Period must be 1–8."),
  subjectId: z.string().min(1, "Pick a subject."),
  teacherId: z.string().min(1, "Pick a teacher."),
  roomId: z.string().nullish(),
});

/** PUT /api/timetable — principal assigns/edits a cell.
 *  Conflict rules: same teacher in another class at the same day+period → 409 with the
 *  exact clash; the target class's own cell is replaced (upsert). */
export const PUT = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const schoolId = user.schoolId;

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message ?? "Invalid timetable payload.");
  }
  const { classId, dayOfWeek, period, subjectId, teacherId, roomId } = parsed.data;

  if (dayOfWeek === 6 && period > 4) {
    return fail(400, "Saturday is a half day — only periods 1–4 can be scheduled.");
  }

  const klass = await db.class.findFirst({ where: { id: classId, schoolId } });
  if (!klass) throw fail(404, "Class not found.");

  const subject = await db.subject.findFirst({ where: { id: subjectId, schoolId } });
  if (!subject) throw fail(404, "Subject not found.");

  const offered = await db.classSubject.findFirst({ where: { classId, subjectId } });
  if (!offered) return fail(400, `${subject.name} is not offered for ${klass.name}.`);

  const teacher = await db.teacher.findFirst({
    where: { id: teacherId, schoolId },
    include: { user: { select: { name: true } } },
  });
  if (!teacher) throw fail(404, "Teacher not found.");

  let room: { id: string; code: string } | null = null;
  if (roomId) {
    const r = await db.room.findFirst({ where: { id: roomId, schoolId } });
    if (!r) throw fail(404, "Room not found.");
    room = { id: r.id, code: r.code };
  }

  /* teacher double-booking in another class → 409 */
  const clash = await db.timetableSlot.findFirst({
    where: { teacherId, dayOfWeek, period, schoolId, NOT: { classId } },
    include: { class: { select: { name: true } } },
  });
  if (clash) {
    throw fail(
      409,
      `${teacher.user.name} is already teaching ${clash.class.name} in period ${period} on ${DAYS_FULL[dayOfWeek]}`,
    );
  }

  /* same class + day + period → replace; otherwise create */
  const existing = await db.timetableSlot.findUnique({
    where: { classId_dayOfWeek_period: { classId, dayOfWeek, period } },
  });

  const slot = existing
    ? await db.timetableSlot.update({
        where: { id: existing.id },
        data: { subjectId, teacherId, roomId: roomId ?? null },
      })
    : await db.timetableSlot.create({
        data: { schoolId, classId, dayOfWeek, period, subjectId, teacherId, roomId: roomId ?? null },
      });

  await db.activityLog.create({
    data: {
      schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Timetable",
      detail: `P${period} ${DAYS_FULL[dayOfWeek]} set to ${subject.name} (${teacher.user.name}${room ? `, ${room.code}` : ""}) for ${klass.name}`,
    },
  });

  return ok({ slotId: slot.id });
});

/** DELETE /api/timetable?slotId= — principal clears a period. */
export const DELETE = route(async (req: Request) => {
  const user = await requireRole("PRINCIPAL");
  const slotId = new URL(req.url).searchParams.get("slotId");
  if (!slotId) throw fail(400, "slotId is required.");

  const slot = await db.timetableSlot.findFirst({
    where: { id: slotId, schoolId: user.schoolId },
    include: {
      class: { select: { name: true } },
      subject: { select: { name: true } },
    },
  });
  if (!slot) throw fail(404, "That period isn't on the timetable.");

  await db.timetableSlot.delete({ where: { id: slot.id } });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Timetable",
      detail: `P${slot.period} ${DAYS_FULL[slot.dayOfWeek]} (${slot.subject.name}) cleared for ${slot.class.name}`,
    },
  });

  return ok({ deleted: slot.id });
});
