import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, route, requireRole, isoToday } from "@/lib/api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOLIDAYS = new Set(["2026-10-02"]); // Gandhi Jayanti (seeded calendar)

/** GET /api/attendance?date=&classId= — role-aware.
 *  TEACHER: home classes + roster for a class they teach (existing marks included).
 *  PRINCIPAL: class-wise summary for a date + 10-day school trend.
 *  STUDENT: own attendance, last 60 school days. */
export const GET = route(async (req) => {
  const user = await requireRole("PRINCIPAL", "TEACHER", "STUDENT");
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? isoToday();
  const classId = url.searchParams.get("classId") ?? "";
  if (!DATE_RE.test(date)) return fail(400, "Date must be YYYY-MM-DD.");

  if (user.role === "STUDENT") return ok(await studentView(user));
  if (user.role === "PRINCIPAL") return ok(await principalView(user.schoolId, date));
  return ok(await teacherView(user, date, classId));
});

/* ── TEACHER ────────────────────────────────────────────────────── */

async function teacherView(user: any, date: string, classId: string) {
  const teacherId = user.teacherId!;
  const [myClasses, taught] = await Promise.all([
    db.class.findMany({
      where: { schoolId: user.schoolId, classTeacherId: teacherId },
      orderBy: { gradeLevel: "asc" },
      include: { _count: { select: { students: { where: { status: "ACTIVE" } } } } },
    }),
    db.classSubject.findMany({
      where: { teacherId },
      include: { class: { select: { id: true, name: true } } },
      orderBy: { class: { gradeLevel: "asc" } },
    }),
  ]);
  const classesTaught = [...new Map(taught.map((t) => [t.class.id, t.class.name])).entries()].map(([id, name]) => ({ id, name }));

  // marked status per home class for the chosen date
  const marked = await db.attendance.groupBy({
    by: ["classId"],
    where: { schoolId: user.schoolId, date, classId: { in: myClasses.map((c) => c.id) } },
    _count: { _all: true },
  });
  const markedCount = new Map(marked.map((m) => [m.classId, m._count._all]));

  const result: any = {
    role: "TEACHER",
    date,
    myClasses: myClasses.map((c) => ({
      id: c.id,
      name: c.name,
      strength: c._count.students,
      markedCount: markedCount.get(c.id) ?? 0,
    })),
    classesTaught,
  };
  if (!classId) return result;

  // roster — allowed for classes the teacher leads or teaches a subject in
  const allowed =
    myClasses.some((c) => c.id === classId) || taught.some((t) => t.class.id === classId);
  if (!allowed) throw fail(403, "You don't teach in that class.");

  const cls = await db.class.findFirst({
    where: { id: classId, schoolId: user.schoolId },
    select: { id: true, name: true, capacity: true },
  });
  if (!cls) throw fail(404, "Class not found.");

  const [students, marks] = await Promise.all([
    db.student.findMany({
      where: { classId, status: "ACTIVE" },
      orderBy: { rollNo: "asc" },
      select: { id: true, rollNo: true, name: true, admissionNo: true },
    }),
    db.attendance.findMany({
      where: { classId, date },
      select: { studentId: true, status: true },
    }),
  ]);
  const markMap = new Map(marks.map((m) => [m.studentId, m.status]));

  result.roster = {
    classId: cls.id,
    className: cls.name,
    isClassTeacher: myClasses.some((c) => c.id === classId),
    students: students.map((s) => ({ ...s, status: markMap.get(s.id) ?? null })),
  };
  return result;
}

/* ── PRINCIPAL ──────────────────────────────────────────────────── */

async function principalView(schoolId: string, date: string) {
  const classes = await db.class.findMany({
    where: { schoolId },
    orderBy: { gradeLevel: "asc" },
    include: {
      classTeacher: { select: { user: { select: { name: true } } } },
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });

  const [byClass, trendRows] = await Promise.all([
    db.attendance.groupBy({
      by: ["classId", "status"],
      where: { schoolId, date },
      _count: { _all: true },
    }),
    db.attendance.groupBy({
      by: ["date", "status"],
      where: { schoolId, date: { gte: shiftISO(date, -20), lte: date } },
      _count: { _all: true },
    }),
  ]);

  const perClass = new Map<string, { present: number; absent: number; late: number; leave: number }>();
  for (const row of byClass) {
    const e = perClass.get(row.classId) ?? { present: 0, absent: 0, late: 0, leave: 0 };
    const key = row.status.toLowerCase() as "present" | "absent" | "late" | "leave";
    if (key in e) e[key] += row._count._all;
    perClass.set(row.classId, e);
  }

  // 10 school days ending at `date` (same calendar as the dashboard)
  const days: string[] = [];
  for (let i = 0; days.length < 10 && i < 21; i++) {
    const d = shiftISO(date, -i);
    if (new Date(d + "T00:00:00").getDay() === 0) continue;
    if (HOLIDAYS.has(d)) continue;
    days.push(d);
  }
  days.reverse();

  const trendMap = new Map<string, { present: number; total: number }>();
  for (const row of trendRows) {
    const e = trendMap.get(row.date) ?? { present: 0, total: 0 };
    if (row.status !== "ABSENT") e.present += row._count._all;
    e.total += row._count._all;
    trendMap.set(row.date, e);
  }

  let present = 0, absent = 0, late = 0, leave = 0, markedClasses = 0;
  const classRows = classes.map((c) => {
    const e = perClass.get(c.id);
    if (e) {
      present += e.present; absent += e.absent; late += e.late; leave += e.leave;
      markedClasses++;
    }
    const total = e ? e.present + e.absent + e.late + e.leave : 0;
    return {
      id: c.id,
      name: c.name,
      classTeacher: c.classTeacher?.user?.name ?? null,
      strength: c._count.students,
      present: e?.present ?? 0,
      absent: e?.absent ?? 0,
      late: e?.late ?? 0,
      leave: e?.leave ?? 0,
      marked: !!e,
      pct: total > 0 ? Math.round(((total - e!.absent) / total) * 1000) / 10 : null,
    };
  });

  const overallTotal = present + absent + late + leave;
  return {
    role: "PRINCIPAL",
    date,
    overall: {
      present, absent, late, leave,
      pct: overallTotal > 0 ? Math.round(((overallTotal - absent) / overallTotal) * 1000) / 10 : null,
      classesMarked: markedClasses,
      classesTotal: classes.length,
    },
    classes: classRows,
    trend: days.map((d) => {
      const e = trendMap.get(d);
      return { date: d, pct: e && e.total > 0 ? Math.round((e.present / e.total) * 1000) / 10 : null };
    }),
  };
}

/* ── STUDENT ────────────────────────────────────────────────────── */

async function studentView(user: any) {
  const student = await db.student.findFirst({
    where: { id: user.studentId! },
    include: { class: { select: { name: true } } },
  });
  if (!student) return { role: "STUDENT", className: null, days: [], counts: { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 }, considered: 0, pct: null };

  const days = await db.attendance.findMany({
    where: { studentId: student.id },
    orderBy: { date: "desc" },
    take: 60,
    select: { date: true, status: true },
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
  for (const d of days) counts[d.status as keyof typeof counts]++;
  const considered = days.length;
  const pct = considered > 0 ? Math.round(((counts.PRESENT + counts.LATE) / considered) * 1000) / 10 : null;

  return { role: "STUDENT", className: student.class.name, days, counts, considered, pct };
}

/* ── POST: submit roster (class teacher only) ───────────────────── */

const submitSchema = z.object({
  classId: z.string().min(1),
  date: z.string().regex(DATE_RE, "Date must be YYYY-MM-DD."),
  entries: z
    .array(
      z.object({
        studentId: z.string().min(1),
        status: z.enum(["PRESENT", "ABSENT", "LATE", "LEAVE"]),
      }),
    )
    .min(1, "Nothing to submit — mark at least one student.")
    .max(120, "That roster is too large."),
});

export const POST = route(async (req) => {
  const user = await requireRole("TEACHER");
  const parsed = submitSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid submission.");
  const { classId, date, entries } = parsed.data;

  if (date > isoToday()) return fail(400, "Attendance can't be submitted for a future date.");
  const dow = new Date(date + "T00:00:00").getDay();
  if (dow === 0) return fail(400, "Sundays are not school days.");

  const teacherId = user.teacherId!;
  const cls = await db.class.findFirst({
    where: { id: classId, schoolId: user.schoolId },
    select: { id: true, name: true, classTeacherId: true },
  });
  if (!cls) return fail(404, "Class not found.");
  if (cls.classTeacherId !== teacherId) {
    return fail(403, `Only the class teacher of ${cls.name} can submit its attendance.`);
  }

  // every entry must be an active student of this class
  const roster = await db.student.findMany({
    where: { classId, schoolId: user.schoolId, status: "ACTIVE" },
    select: { id: true },
  });
  const rosterIds = new Set(roster.map((s) => s.id));
  const seen = new Set<string>();
  for (const e of entries) {
    if (!rosterIds.has(e.studentId)) return fail(400, "Some students don't belong to this class.");
    if (seen.has(e.studentId)) return fail(400, "Duplicate student in the roster.");
    seen.add(e.studentId);
  }

  await db.$transaction(
    entries.map((e) =>
      db.attendance.upsert({
        where: { studentId_date: { studentId: e.studentId, date } },
        create: {
          schoolId: user.schoolId,
          studentId: e.studentId,
          classId,
          date,
          status: e.status,
          markedById: teacherId,
        },
        update: { status: e.status, markedById: teacherId, classId },
      }),
    ),
  );

  await db.activityLog.create({
    data: {
      schoolId: user.schoolId,
      actorName: user.name,
      actorRole: user.role,
      action: "Attendance",
      detail: `Daily attendance submitted for ${cls.name} · ${entries.length} students`,
    },
  });

  return ok({ className: cls.name, date, count: entries.length });
});

/* ── helpers ────────────────────────────────────────────────────── */

function shiftISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
