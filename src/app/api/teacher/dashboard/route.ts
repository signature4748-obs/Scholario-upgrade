import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf, requireTeacher, authorizedStudentWhere } from '@/lib/teacher-hub'
import { getTeachingAssignments, getLessonPlansBatch } from '@/lib/lesson-planner'
import { audienceAllowsStaff, notificationVisibilityWhere, audienceLabel } from '@/lib/notices'
import { istDayKey } from '@/lib/class-attendance'
import { growthScoresFor } from '@/lib/growth/service'
import { bandOf } from '@/lib/growth/shared'

export const runtime = 'nodejs'

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Weekday name of `today + offsetDays`, on the school's IST calendar. */
function istWeekday(base: Date, offsetDays: number): string {
  return WEEKDAY_NAMES[new Date(base.getTime() + 330 * 60_000 + offsetDays * 86_400_000).getUTCDay()]
}

/** One curriculum-progress card (the dashboard's slice of a lesson plan). */
interface CurriculumEntry {
  classId: string
  classLabel: string
  subjectId: string
  subjectName: string
  progress: { completed: number; total: number; pct: number }
  todayTopic: { topicName: string; unitName: string; status: string; endDate: string } | null
  todayReason: string | null
}

/**
 * GET /api/teacher/dashboard — ONE aggregate for the Teacher Dashboard:
 * identity, teaching assignments, today's periods (real timetable) plus the
 * next teaching day, class-teacher attendance snapshot for today (with
 * marked-count for the partial state), curriculum progress with today's
 * topic per assignment, Teacher Hub pending counts INCLUDING the open
 * follow-up rows and draft marks entries (so the dashboard needs no second
 * fetch), class-teacher hub stats (30-day rate, follow-ups) and the latest
 * school notices with per-user read state. Sections fail independently.
 *
 * 8B-7-f — the query plan is TWO parallel rounds (the documented N+1 fix):
 *   Wave 1: teacher record, teaching assignments (scope), the teacher's
 *   timetable cells, class-teacher classes — four independent reads.
 *   Wave 2: today's attendance snapshot (ONE batched query for every
 *   class-teacher class), the 30-day attendance window, open follow-ups,
 *   the lesson plans for EVERY assignment (ONE batched read — see
 *   getLessonPlansBatch), the Teacher Hub counts and the notice window.
 * Authorization and the response shape are unchanged; per-section error
 * containment is unchanged (curriculum/hub catch their own failures, a
 * rejected attendance/notice query fails the route exactly as before).
 */
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const today = new Date()
      // IST contract (audit): attendance rows live at UTC-midnight of the
      // IST day key, and "today's" weekday is the school's calendar day —
      // a plain UTC dayKey pointed at the previous day between 00:00 and
      // 05:30 IST.
      const todayDayKey = istDayKey(today)
      const weekday = istWeekday(today, 0)
      const teacherName = (user.name || '').trim().toLowerCase()

      // ── Wave 1 — the four independent scope fetches in ONE round ──────
      // (8B-7-f: these were four sequential awaits — one pooler round-trip
      // each — with no data dependency between them. The timetable name
      // filter still runs in memory; a teacher with an empty name skips
      // the query exactly as before.)
      const [teacher, assignments, schoolCells, classTeacherOf] = await Promise.all([
        db.teacher.findUnique({ where: { userId: user.id } }),
        getTeachingAssignments(user),
        teacherName
          ? db.timetable.findMany({
              where: { schoolId, teacherName: { not: null } },
              include: {
                class: { select: { name: true, section: true } },
                subject: { select: { name: true } },
              },
              orderBy: [{ day: 'asc' }, { period: 'asc' }],
            })
          : Promise.resolve([] as never[]),
        db.class.findMany({
          where: { schoolId, classTeacherId: user.id },
          select: {
            id: true,
            name: true,
            section: true,
            students: { select: { id: true } },
          },
          orderBy: { name: 'asc' },
        }),
      ])

      // ── The teacher's own timetable cells (ALL weekdays in ONE query) ──
      // today's slice feeds "Today's Schedule"; the earliest future weekday
      // with a period feeds the "no more periods today" Next-Up state.
      const allMyCells = schoolCells.filter(
        (r) => teacherName !== '' && (r.teacherName || '').trim().toLowerCase() === teacherName,
      )
      const toPeriod = (r: (typeof allMyCells)[number]) => ({
        period: r.period,
        startTime: r.startTime,
        endTime: r.endTime,
        subjectName: r.subject?.name ?? 'Subject',
        classLabel: classLabelOf(r.class),
        room: r.room,
        // ids let the dashboard deep-link a period into the Lesson Planner
        classId: r.classId,
        subjectId: r.subjectId,
      })
      const myCellsByDay = new Map<string, (typeof allMyCells)[number][]>()
      for (const r of allMyCells) {
        const list = myCellsByDay.get(r.day) ?? []
        list.push(r)
        myCellsByDay.set(r.day, list)
      }
      const todayCells = (myCellsByDay.get(weekday) ?? []).slice().sort((a, b) => a.period - b.period)

      // Next teaching day after today (1–7 days ahead) and its first period.
      let nextDay: { weekday: string; period: ReturnType<typeof toPeriod> } | null = null
      for (let offset = 1; offset <= 7 && !nextDay; offset++) {
        const dayName = istWeekday(today, offset)
        const cells = (myCellsByDay.get(dayName) ?? []).slice().sort((a, b) => a.period - b.period)
        if (cells.length > 0) nextDay = { weekday: dayName, period: toPeriod(cells[0]) }
      }

      // 30-day attendance window (same canonical bounds as the Class Hub:
      // rows up to end of today; LEAVE never penalizes — excluded from the
      // denominator, PRESENT+LATE count as attended).
      const since30 = new Date(today.getTime() - 30 * 86_400_000)
      // 8B-7-f — ONE attendance query for every class-teacher class's
      // TODAY snapshot (was one findMany per class inside a Promise.all —
      // each waiting its own pooler round-trip). Rows group in memory.
      // TQA-6: Attendance.date is a PG DATE — a DateTime parameter is
      // truncated to date-only by the engine, so `lt: T23:59:59.999Z`
      // became `date < today` and EXCLUDED today's rows (the dashboard
      // showed "not marked" after the class teacher saved). The canonical
      // bound (class-attendance.ts) is next-day midnight, exclusive.
      const todayAttStart = new Date(`${todayDayKey}T00:00:00.000Z`)
      const todayAttEnd = new Date(todayAttStart.getTime() + 86_400_000)

      // ── Wave 2 — every remaining section in ONE parallel round ────────
      // Attendance snapshots + window + follow-ups, curriculum (batched),
      // the Teacher Hub counts and the notice window are all independent
      // of each other once Wave 1 resolved the scopes. Failure semantics
      // per section are unchanged.
      const [todayAttRows, att30Rows, ctFollowUpRows, curriculumOut, hub, noticeRows] = await Promise.all([
        classTeacherOf.length > 0
          ? db.attendance.findMany({
              where: {
                classId: { in: classTeacherOf.map((c) => c.id) },
                date: { gte: todayAttStart, lt: todayAttEnd },
              },
              select: { classId: true, status: true },
            })
          : Promise.resolve([] as { classId: string | null; status: string }[]),
        classTeacherOf.length > 0
          ? db.attendance.findMany({
              where: {
                schoolId,
                date: { gte: since30, lte: today },
                student: { classId: { in: classTeacherOf.map((c) => c.id) } },
              },
              select: { studentId: true, status: true },
            })
          : Promise.resolve([] as { studentId: string; status: string }[]),
        // Open follow-ups for MY students, grouped by the student's class —
        // the Class Teacher Hub "pending follow-ups" figure. teacherId is
        // the USER id (the documented TeacherFollowUp contract).
        classTeacherOf.length > 0
          ? db.teacherFollowUp.findMany({
              where: {
                schoolId,
                teacherId: user.id,
                status: 'open',
                student: { classId: { in: classTeacherOf.map((c) => c.id) } },
              },
              select: { student: { select: { classId: true } } },
            })
          : Promise.resolve([] as { student: { classId: string | null } }[]),
        // ── Curriculum progress + today's topic per teaching assignment ──
        // 8B-7-f — ONE batched read for every (class, subject) pair via
        // getLessonPlansBatch (was one getLessonPlan call — ~13 queries
        // each, incl. a full scope re-resolution — per assignment). Same
        // scope: the pairs come from getTeachingAssignments above, the
        // same guard getLessonPlan applies internally; a failing pair
        // drops only itself and a total batch failure drops the section
        // (per-pair try/catch + this .then rejection fallback).
        getLessonPlansBatch(user, assignments).then(
          (plans) =>
            assignments.map((a): CurriculumEntry | null => {
              const plan = plans.get(`${a.classId}|${a.subjectId}`)
              if (!plan) return null
              return {
                classId: a.classId,
                classLabel: a.classLabel,
                subjectId: a.subjectId,
                subjectName: a.subjectName,
                progress: plan.progress,
                todayTopic: plan.today.topic
                  ? {
                      topicName: plan.today.topic.topicName,
                      unitName: plan.today.topic.unitName,
                      status: plan.today.topic.status,
                      endDate: plan.today.topic.endDate,
                    }
                  : null,
                todayReason: plan.today.reason,
              }
            }),
          () => assignments.map((): CurriculumEntry | null => null),
        ),
        // ── Teacher Hub pending counts + the actionable rows themselves ──
        // NOTE: ParentConversation.teacherId and TeacherFollowUp.teacherId
        // both hold the TEACHER'S USER id (the seeded hub contract). The
        // growth count uses the SAME scoped derivation as the Student
        // Growth module (canonical numbers everywhere).
        (async () => {
          const [unreadRows, followUpRows, needsAttention, draftMarks] = await Promise.all([
            db.parentMessage.count({
              where: { conversation: { teacherId: user.id }, readAt: null, senderId: { not: user.id } },
            }),
            // ALL open follow-ups (any kind) — a behavior follow-up is
            // pending work too. Rows power the Pending Actions queue.
            db.teacherFollowUp.findMany({
              where: { schoolId, teacherId: user.id, status: 'open' },
              include: {
                student: {
                  select: { id: true, rollNo: true, user: { select: { name: true } }, class: { select: { name: true, section: true } } },
                },
              },
              orderBy: { dueDate: 'asc' },
              take: 8,
            }),
            (async () => {
              try {
                const ctx = await requireTeacher(user)
                const scopeStudents = await db.student.findMany({
                  where: authorizedStudentWhere(ctx),
                  select: { id: true },
                  take: 300,
                })
                const scores = await growthScoresFor(schoolId, scopeStudents.map((s) => s.id))
                return [...scores.values()].filter((g) => bandOf(g.score, g.monthDelta) === 'NEEDS_ATTENTION').length
              } catch {
                return 0
              }
            })(),
            // Marks entries sitting in DRAFT for this teacher's
            // (class, subject) pairs — only in exams whose results are not
            // declared yet (a declared exam can no longer be submitted).
            (async () => {
              try {
                if (assignments.length === 0) return 0
                return await db.examMark.count({
                  where: {
                    exam: { schoolId, resultStatus: { not: 'Declared' } },
                    workflowStatus: 'DRAFT',
                    OR: assignments.map((a) => ({
                      AND: [{ classId: a.classId }, { subjectId: a.subjectId }],
                    })),
                  },
                })
              } catch {
                return 0
              }
            })(),
          ])
          return {
            unreadMessages: unreadRows,
            openFollowUps: followUpRows.length,
            needsAttention,
            marksPending: draftMarks,
            followUps: followUpRows.slice(0, 4).map((f) => ({
              id: f.id,
              kind: f.kind,
              reason: f.reason,
              dueDate: f.dueDate.toISOString(),
              priority: f.priority,
              status: f.status,
              studentName: f.student?.user?.name ?? null,
              classLabel: f.student?.class ? classLabelOf(f.student.class) : null,
            })),
          }
        })(),
        // ── Latest notices for staff (audience-scoped, read-state aware) ──
        // 8B-7-f — the audience check is now the SYNCHRONOUS staff verdict
        // (`audienceAllowsStaff`): the old `.filter((n) =>
        // audienceAllows(n.audience, user))` called an async function
        // without awaiting — every Promise is truthy, so the filter was a
        // no-op that passed ALL rows. The staff verdict stays a
        // pass-through (see its contract note in notices.ts) so
        // teacher-visible rows are exactly what shipped.
        db.notification.findMany({
          where: { schoolId, ...notificationVisibilityWhere() },
          include: {
            sender: { select: { name: true } },
            reads: { where: { userId: user.id }, select: { readAt: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
        }),
      ])

      // Per-class TODAY snapshot (grouped from the single batched query —
      // the same rows the per-class queries returned).
      const todayAttByClass = new Map<string, string[]>()
      for (const r of todayAttRows) {
        if (!r.classId) continue
        const list = todayAttByClass.get(r.classId) ?? []
        list.push(r.status)
        todayAttByClass.set(r.classId, list)
      }
      const attendanceSnapshots = classTeacherOf.map((c) => {
        const statuses = todayAttByClass.get(c.id) ?? []
        return {
          classId: c.id,
          classLabel: classLabelOf(c),
          studentCount: c.students.length,
          marked: statuses.length > 0,
          markedCount: statuses.length,
          counts: {
            present: statuses.filter((s) => s === 'PRESENT').length,
            absent: statuses.filter((s) => s === 'ABSENT').length,
            late: statuses.filter((s) => s === 'LATE').length,
            leave: statuses.filter((s) => s === 'LEAVE').length,
          },
        }
      })

      // Per-class 30-day rate + open follow-ups for the hub card.
      const ctStudentClass = new Map<string, string>()
      for (const c of classTeacherOf) for (const s of c.students) ctStudentClass.set(s.id, c.id)
      const rateAgg = new Map<string, { attended: number; eligible: number }>()
      for (const r of att30Rows) {
        const cid = ctStudentClass.get(r.studentId)
        if (!cid) continue
        if (r.status === 'LEAVE') continue
        const agg = rateAgg.get(cid) ?? { attended: 0, eligible: 0 }
        agg.eligible++
        if (r.status === 'PRESENT' || r.status === 'LATE') agg.attended++
        rateAgg.set(cid, agg)
      }
      const followUpAgg = new Map<string, number>()
      for (const f of ctFollowUpRows) {
        if (!f.student?.classId) continue
        followUpAgg.set(f.student.classId, (followUpAgg.get(f.student.classId) ?? 0) + 1)
      }

      const notices = noticeRows
        .filter((n) => audienceAllowsStaff(n.audience, user.role))
        .slice(0, 3)
        .map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          priority: n.priority,
          sender: n.sender?.name ?? 'School',
          createdAt: n.createdAt.toISOString(),
          audienceLabel: audienceLabel(n.audience),
          readAt: n.reads[0]?.readAt ? n.reads[0].readAt.toISOString() : null,
        }))

      return {
        teacher: {
          name: user.name ?? 'Teacher',
          employeeId: teacher?.employeeId ?? null,
        },
        today: {
          weekday,
          date: todayDayKey,
          periods: todayCells.map(toPeriod),
        },
        nextDay,
        assignments: assignments.map((a) => ({
          classId: a.classId,
          classLabel: a.classLabel,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          periodsPerWeek: a.periodsPerWeek,
        })),
        classTeacherOf: classTeacherOf.map((c) => {
          const agg = rateAgg.get(c.id)
          return {
            classId: c.id,
            classLabel: classLabelOf(c),
            studentCount: c.students.length,
            attendancePct: agg && agg.eligible > 0 ? Math.round((agg.attended / agg.eligible) * 100) : null,
            openFollowUps: followUpAgg.get(c.id) ?? 0,
          }
        }),
        attendance: attendanceSnapshots,
        curriculum: curriculumOut.filter((c): c is CurriculumEntry => c !== null),
        hub,
        notices,
      }
    },
    { roles: ['TEACHER'] }
  )
}
