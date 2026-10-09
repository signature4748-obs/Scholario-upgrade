import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole } from "@/lib/api";

/** Grade level → class label (matches the seeded corpus: 1=Nursery, 2=LKG, 3=IKG, 4..15 = Class 1..12). */
export function gradeLabel(gradeLevel: number): string {
  if (gradeLevel === 1) return "Nursery";
  if (gradeLevel === 2) return "LKG";
  if (gradeLevel === 3) return "IKG";
  return `Class ${gradeLevel - 3}`;
}

const classShape = {
  classTeacher: { select: { id: true, user: { select: { name: true } } } },
  room: { select: { name: true, code: true } },
  subjects: {
    orderBy: [{ subject: { code: "asc" } }] as any,
    include: {
      subject: { select: { code: true, name: true } },
      teacher: { include: { user: { select: { name: true } } } },
    },
  },
  _count: { select: { students: { where: { status: "ACTIVE" } } } },
};

function mapClass(c: any, isClassTeacher?: boolean) {
  return {
    id: c.id,
    name: c.name,
    gradeLevel: c.gradeLevel,
    section: c.section,
    stream: c.stream ?? null,
    capacity: c.capacity,
    strength: c._count.students,
    classTeacherId: c.classTeacherId ?? null,
    classTeacher: c.classTeacher?.user?.name ?? null,
    room: c.room?.name ?? null,
    ...(isClassTeacher !== undefined ? { isClassTeacher } : {}),
    subjects: c.subjects.map((s: any) => ({
      code: s.subject.code,
      name: s.subject.name,
      teacher: s.teacher?.user?.name ?? null,
    })),
  };
}

/** GET /api/classes — PRINCIPAL: every section (+ rooms for dialogs). TEACHER: sections they teach. */
export const GET = route(async (req) => {
  const user = await requireRole("PRINCIPAL", "TEACHER");

  if (user.role === "TEACHER" && user.teacherId) {
    const classes = await db.class.findMany({
      where: {
        schoolId: user.schoolId,
        OR: [{ classTeacherId: user.teacherId }, { subjects: { some: { teacherId: user.teacherId } } }],
      },
      orderBy: { gradeLevel: "asc" },
      include: classShape,
    });
    return ok({
      role: "TEACHER",
      classes: classes.map((c) => mapClass(c, c.classTeacherId === user.teacherId)),
    });
  }

  const [classes, rooms] = await Promise.all([
    db.class.findMany({ where: { schoolId: user.schoolId }, orderBy: { gradeLevel: "asc" }, include: classShape }),
    db.room.findMany({ where: { schoolId: user.schoolId }, orderBy: { code: "asc" }, select: { id: true, name: true, code: true } }),
  ]);

  return ok({
    role: "PRINCIPAL",
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, code: r.code })),
    classes: classes.map((c) => mapClass(c)),
  });
});

/* ── create section (PRINCIPAL) ─────────────────────────────────── */

const createSchema = z.object({
  gradeLevel: z.coerce.number().int().min(1, "Grade level must be 1–15.").max(15, "Grade level must be 1–15."),
  section: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/, "Section must be a single letter (A–Z)."),
  capacity: z.coerce.number().int().min(5, "Capacity must be at least 5.").max(120, "Capacity cannot exceed 120."),
  roomId: z.string().min(1, "Pick a room."),
});

export const POST = route(async (req) => {
  const user = await requireRole("PRINCIPAL");
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid details.");
  const input = parsed.data;

  const room = await db.room.findFirst({ where: { id: input.roomId, schoolId: user.schoolId }, select: { name: true } });
  if (!room) return fail(400, "That room does not exist in your school.");

  const name = `${gradeLabel(input.gradeLevel)}-${input.section}`;
  const duplicate = await db.class.findFirst({
    where: { schoolId: user.schoolId, gradeLevel: input.gradeLevel, section: input.section },
    select: { id: true },
  });
  if (duplicate) return fail(409, `${name} already exists.`);

  const cls = await db.class.create({
    data: {
      schoolId: user.schoolId,
      gradeLevel: input.gradeLevel,
      section: input.section,
      name,
      roomId: input.roomId,
      capacity: input.capacity,
    },
  });

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Class",
      detail: `New section ${name} created · capacity ${input.capacity} · ${room.name}`,
    },
  });

  return ok({ id: cls.id, name: cls.name });
});
