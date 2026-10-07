import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { audienceAllows, audienceLabel } from '@/lib/notices'
import {
  requireStudent,
  materialVisibleToStudent,
  targetedMaterialIds,
  subjectNamesById,
  type LearningMaterialCard,
} from '@/lib/learning'
import { toStudyMaterialMeta } from '@/lib/study-materials'
import { num, dec } from '@/lib/money'

export const runtime = 'nodejs'

/// GET /api/student/dashboard
///
/// SD-2 — the ONE server-side aggregation behind the Student Dashboard
/// (V2). The dashboard is a VIEW/AGGREGATION layer, never a second
/// business-logic system: every section reuses the authoritative models
/// and libraries the dedicated modules use (Learning lib, notices lib,
/// Fee/Attendance/Exam/Message rows).
///
/// Identity is resolved entirely server-side:
///   erp_session cookie → user → student → school → class
/// (client-supplied ids are never trusted).
///
/// One call returns everything the dashboard needs (PHASE 29 — no
/// waterfall of 15 independent requests):
///   student     name / class / section / roll / admission / avatar
///   timetable   the class's full week (the client picks today + period
///               states from the student's own device clock)
///   attendance  counts, %, weekly trend from real Attendance rows
///   academics   latest DECLARED exam: subject marks, %, and an HONEST
///               class rank derived from classmates' real results
///   fees        outstanding balance + nearest due date + due items
///   notices     audience-scoped announcements with read state (3 latest)
///   learning    continueLearning card + dueFlashcards + nearest task
///   messages    unread count + the senders of the latest unread ones
///   transport   the student's route assignment summary (no live GPS
///               fabrication here — live tracking lives in Transport)
///
/// Sections are computed defensively (Promise.allSettled): a failing
/// subsystem degrades to `null` for that section instead of breaking the
/// whole dashboard (PHASE 32 — isolated failures).
export async function GET(_req: NextRequest) {
  return withUser(
    async (user) => {
      const ctx = await requireStudent(user)
      const dbUser = await db.user.findUnique({
        where: { id: user.id },
        include: {
          student: {
            include: {
              class: true,
              route: { include: { vehicles: { take: 1 } } },
            },
          },
        },
      })
      const student = dbUser?.student
      if (!student) return { student: null }

      // Class label — the Class name may already carry the section
      // (e.g. "Grade 9 - A" + section "A"): never render it twice.
      const classLabel = student.class
        ? student.class.section &&
            new RegExp(`[-–\\s]${escapeRegExp(student.class.section)}\\s*$`, 'i').test(student.class.name)
          ? student.class.name
          : `${student.class.name}${student.class.section ? ` - ${student.class.section}` : ''}`
        : null

      // ── Section builders (each fails independently) ─────────────────
      const studentSection = () => ({
        name: user.name,
        avatarUrl: user.avatarUrl,
        className: student.class?.name ?? null,
        section: student.class?.section ?? null,
        classLabel,
        rollNo: student.rollNo,
        admissionNo: student.admissionNo,
        classRoom: student.class?.room ?? null,
      })

      const timetableSection = async () => {
        if (!student.classId) return { week: {} as Record<string, TodayClass[]> }
        const rows = await db.timetable.findMany({
          where: { schoolId: ctx.schoolId, classId: student.classId },
          orderBy: [{ day: 'asc' }, { period: 'asc' }],
          include: { subject: { select: { name: true } } },
        })
        const week: Record<string, TodayClass[]> = {}
        for (const r of rows) {
          const day = r.day?.trim() ?? ''
          if (!day) continue
          ;(week[day] ??= []).push({
            id: r.id,
            period: r.period,
            subject: r.subject?.name ?? 'Period',
            teacherName: r.teacherName ?? '',
            room: r.room ?? '',
            startTime: r.startTime ?? '',
            endTime: r.endTime ?? '',
          })
        }
        return { week }
      }

      const attendanceSection = async () => {
        const rows = await db.attendance.findMany({
          where: { studentId: ctx.studentId },
          orderBy: { date: 'asc' },
        })
        if (rows.length === 0) {
          return emptyAttendance()
        }
        const present = rows.filter((r) => r.status === 'PRESENT').length
        const late = rows.filter((r) => r.status === 'LATE').length
        const absent = rows.filter((r) => r.status === 'ABSENT').length
        const attended = present + late
        const pct = Math.round((attended / rows.length) * 1000) / 10
        // Weekly trend — honest buckets over weeks that have records.
        const weekBuckets = new Map<string, { attended: number; total: number }>()
        for (const r of rows) {
          const d = new Date(r.date)
          const monday = new Date(d)
          monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
          const key = monday.toISOString().slice(0, 10)
          const b = weekBuckets.get(key) ?? { attended: 0, total: 0 }
          b.total += 1
          if (r.status !== 'ABSENT') b.attended += 1
          weekBuckets.set(key, b)
        }
        const trend = [...weekBuckets.entries()].map(([monday, b]) => ({
          name: new Date(`${monday}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          v: Math.round((b.attended / b.total) * 1000) / 10,
        }))
        const weekDelta =
          trend.length >= 2
            ? Math.round((trend[trend.length - 1].v - trend[trend.length - 2].v) * 10) / 10
            : null
        const first = new Date(rows[0].date)
        const last = new Date(rows[rows.length - 1].date)
        const a = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        const b = last.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        return {
          pct,
          present,
          late,
          absent,
          total: rows.length,
          windowLabel: a === b ? a : `${first.toLocaleDateString('en-IN', { month: 'long' })} – ${b}`,
          trend,
          weekDelta,
        }
      }

      const academicsSection = async () => {
        if (!student.classId) return null
        // Latest DECLARED exam for the class with results for this student.
        // STUDENT-QA S5-2 fix: exams are linked to classes through the
        // ExamClass join (the modern architecture — createExam always
        // writes examClasses and leaves the legacy Exam.classId scalar
        // null). Filtering on the legacy scalar matched ZERO exams, so
        // the "latest declared results" card silently never rendered for
        // any student even with real declared Result rows. Resolve the
        // class through the join; the legacy scalar stays untouched for
        // legacy readers.
        const exams = await db.exam.findMany({
          where: { schoolId: ctx.schoolId, examClasses: { some: { classId: student.classId } } },
          orderBy: [{ declaredAt: 'desc' }, { endDate: 'desc' }],
        })
        const declared = exams.find((e) => e.resultStatus === 'Declared' && e.declaredAt)
        if (!declared) return null
        const [myResults, classResults] = await Promise.all([
          db.result.findMany({
            where: { examId: declared.id, studentId: ctx.studentId },
            include: { subject: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
          }),
          db.result.findMany({
            where: { examId: declared.id },
            select: { studentId: true, marks: true, totalMarks: true },
          }),
        ])
        if (myResults.length === 0) return null
        const subjects = myResults.map((r) => ({
          subject: r.subject?.name ?? 'Subject',
          marks: r.marks,
          totalMarks: r.totalMarks,
          grade: r.grade ?? '',
        }))
        const totalMarks = subjects.reduce((s, x) => s + x.totalMarks, 0)
        const obtained = subjects.reduce((s, x) => s + x.marks, 0)
        const pct = totalMarks > 0 ? Math.round((obtained / totalMarks) * 1000) / 10 : null

        // Honest class rank: average % per student across THIS exam —
        // only students who actually have results are ranked.
        const byStudent = new Map<string, { obtained: number; total: number }>()
        for (const r of classResults) {
          const b = byStudent.get(r.studentId) ?? { obtained: 0, total: 0 }
          b.obtained += r.marks
          b.total += r.totalMarks
          byStudent.set(r.studentId, b)
        }
        const standings = [...byStudent.entries()]
          .map(([sid, b]) => ({ studentId: sid, pct: b.total > 0 ? (b.obtained / b.total) * 100 : 0 }))
          .sort((a, b) => b.pct - a.pct)
        const rankIdx = standings.findIndex((s) => s.studentId === ctx.studentId)
        const rank =
          rankIdx >= 0 && standings.length > 1
            ? { position: rankIdx + 1, assessedCount: standings.length }
            : null

        // Nearest upcoming exam for the class (an Up Next source).
        const upcoming = exams
          .filter((e) => e.resultStatus !== 'Declared' && e.startDate && new Date(e.startDate) > new Date())
          .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime())[0]

        return {
          latest: {
            examId: declared.id,
            examName: declared.name,
            declaredAt: declared.declaredAt!.toISOString(),
            subjects,
            pct,
          },
          rank,
          upcomingExam: upcoming
            ? {
                examName: upcoming.name,
                startsAt: upcoming.startDate!.toISOString(),
                endsAt: upcoming.endDate?.toISOString() ?? null,
              }
            : null,
        }
      }

      const feesSection = async () => {
        const rows = await db.fee.findMany({
          where: { studentId: ctx.studentId },
          orderBy: [{ dueDate: 'asc' }],
        })
        const due = rows.filter((r) => dec(r.amount).minus(r.paid).greaterThan(0))
        const outstanding = Math.round(num(due.reduce((s, r) => s.plus(dec(r.amount).minus(r.paid)), dec(0))))
        const nearestDue = due.find((r) => r.dueDate)?.dueDate?.toISOString() ?? null

        // Round-7 — the principal's latest fee-reminder message for THIS
        // student (the Outreach workflow writes Message rows with the
        // stable "Fee Reminder" subject prefix). Surfaces as the dashboard
        // banner so the outreach loop closes where the student actually
        // looks, not only in Messages/bell.
        const reminderRow = outstanding > 0
          ? await db.message.findFirst({
              where: { recipientId: user.id, subject: { startsWith: 'Fee Reminder' } },
              orderBy: { createdAt: 'desc' },
              select: {
                subject: true, body: true, createdAt: true,
                sender: { select: { name: true, role: true } },
              },
            })
          : null
        const reminder = reminderRow
          ? {
              subject: reminderRow.subject,
              excerpt: (reminderRow.body.split('\n').find((l) => /outstanding balance/i.test(l)) ?? '')
                .replace(/^This is a gentle reminder from .*? that /i, '')
                .slice(0, 140),
              createdAt: reminderRow.createdAt.toISOString(),
              senderName: reminderRow.sender?.name ?? 'the school office',
            }
          : null

        return {
          outstanding,
          nearestDue,
          items: due.slice(0, 3).map((r) => ({
            title: r.title,
            balance: Math.round(num(dec(r.amount).minus(r.paid))),
            dueDate: r.dueDate?.toISOString() ?? null,
          })),
          reminder,
        }
      }

      const noticesSection = async () => {
        const rows = await db.notification.findMany({
          where: { schoolId: ctx.schoolId },
          orderBy: { createdAt: 'desc' },
          take: 40,
          include: {
            sender: { select: { name: true, role: true } },
            reads: { where: { userId: user.id }, select: { readAt: true } },
          },
        })
        const seen = new Set<string>()
        const notices: NoticeItem[] = []
        let unreadCount = 0
        let importantUnread = 0
        for (const row of rows) {
          if (!(await audienceAllows(row.audience, user))) continue
          const key = `${row.title}\u0000${row.message}`
          if (seen.has(key)) continue
          seen.add(key)
          const read = row.reads.length > 0
          if (!read) {
            unreadCount += 1
            if (row.priority === 'HIGH' || row.priority === 'URGENT') importantUnread += 1
          }
          if (notices.length < 3) {
            notices.push({
              id: row.id,
              title: row.title,
              message: row.message,
              audience: audienceLabel(row.audience),
              priority: row.priority,
              sender: row.sender?.name ?? 'School office',
              createdAt: row.createdAt.toISOString(),
              read,
            })
          }
        }
        return { unreadCount, importantUnread, latest: notices }
      }

      const learningSection = async () => {
        // Same building blocks as /api/student/learning/overview — the
        // dashboard is a consumer of the Learning system, not a clone.
        const targeted = await targetedMaterialIds(ctx.studentId)
        const materials = await db.studyMaterial.findMany({
          where: { schoolId: ctx.schoolId, status: 'published' },
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        })
        const authorized = materials.filter((m) => materialVisibleToStudent(m, ctx, targeted))
        const nameById = await subjectNamesById(
          ctx.schoolId,
          authorized.map((m) => m.subjectId),
        )
        const activities = await db.learningActivity.findMany({
          where: { studentId: ctx.studentId, schoolId: ctx.schoolId },
          orderBy: { lastOpenedAt: 'desc' },
          include: { studyMaterial: true },
        })
        const completedIds = new Set(
          activities.filter((a) => a.completedAt != null).map((a) => a.studyMaterialId),
        )
        void completedIds
        const continueActivity = activities.find(
          (a) =>
            a.completedAt == null &&
            a.studyMaterial != null &&
            materialVisibleToStudent(a.studyMaterial, ctx, targeted),
        )
        let continueLearning: LearningMaterialCard | null = null
        if (continueActivity?.studyMaterial) {
          const m = continueActivity.studyMaterial
          const meta = toStudyMaterialMeta(m, m.subjectId ? nameById.get(m.subjectId) ?? null : null)
          continueLearning = {
            ...meta,
            createdAt: meta.createdAt.toISOString(),
            publishedAt: meta.publishedAt ? meta.publishedAt.toISOString() : null,
            opened: true,
            completed: false,
            bookmarked: false,
            lastOpenedAt: continueActivity.lastOpenedAt.toISOString(),
          }
        }
        // Due flashcards — the same computation as the Learning overview.
        const [deckCards, reviewStates, taskRows] = await Promise.all([
          db.flashcardCard.count({ where: { deck: { schoolId: ctx.schoolId } } }),
          db.flashcardReviewState.findMany({
            where: { studentId: ctx.studentId, deck: { schoolId: ctx.schoolId } },
            select: { dueAt: true },
          }),
          db.studyTask.findMany({
            where: { studentId: ctx.studentId, schoolId: ctx.schoolId, completedAt: null },
            orderBy: { dueDate: 'asc' },
            take: 3,
            include: { subject: { select: { name: true } } },
          }),
        ])
        const now = Date.now()
        const scheduled = reviewStates.filter((s) => s.dueAt.getTime() > now).length
        const dueFlashcards = Math.max(0, deckCards - scheduled)
        const nearestTask = taskRows[0]
          ? {
              id: taskRows[0].id,
              title: taskRows[0].title,
              dueDate: taskRows[0].dueDate?.toISOString() ?? null,
              subjectName: taskRows[0].subject?.name ?? null,
            }
          : null
        return { continueLearning, dueFlashcards, nearestTask }
      }

      const messagesSection = async () => {
        const unread = await db.message.findMany({
          where: { recipientId: user.id, read: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { sender: { select: { name: true } } },
        })
        const senders: string[] = []
        for (const m of unread) {
          const name = m.sender?.name ?? 'School'
          if (!senders.includes(name)) senders.push(name)
        }
        return { unreadCount: unread.length, recentSenders: senders.slice(0, 2) }
      }

      const transportSection = () => {
        const route = student.route
        if (!route) {
          return { assigned: false as const, routeName: null, pickupWindow: null, stopsCount: 0, vehicleNo: null }
        }
        const vehicle = route.vehicles[0]
        return {
          assigned: true as const,
          routeName: route.name,
          pickupWindow: route.startTime && route.endTime ? `${route.startTime} – ${route.endTime}` : null,
          stopsCount: route.stops ? route.stops.split('|').filter((s) => s.trim()).length : 0,
          vehicleNo: vehicle?.number ?? null,
        }
      }

      // ── Parallel, defensively isolated (PHASE 29/32) ────────────────
      const [s, tt, att, ac, fees, notices, learning, messages] = await Promise.allSettled([
        Promise.resolve(studentSection()),
        timetableSection(),
        attendanceSection(),
        academicsSection(),
        feesSection(),
        noticesSection(),
        learningSection(),
        messagesSection(),
      ])
      const val = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback

      return {
        student: val(s, null as unknown as ReturnType<typeof studentSection>),
        timetable: val(tt, { week: {} as Record<string, TodayClass[]> }),
        attendance: val(att, emptyAttendance()),
        academics: val(ac, null as unknown as Awaited<ReturnType<typeof academicsSection>>),
        fees: val(fees, { outstanding: 0, nearestDue: null, items: [] as FeeItem[], reminder: null }),
        notices: val(notices, { unreadCount: 0, importantUnread: 0, latest: [] as NoticeItem[] }),
        learning: val(learning, { continueLearning: null, dueFlashcards: 0, nearestTask: null }),
        messages: val(messages, { unreadCount: 0, recentSenders: [] as string[] }),
        transport: transportSection(),
        generatedAt: new Date().toISOString(),
      }
    },
    { roles: ['STUDENT'] },
  )
}

// ── Shared response shapes ───────────────────────────────────────────

interface TodayClass {
  id: string
  period: number
  subject: string
  teacherName: string
  room: string
  startTime: string
  endTime: string
}

interface FeeItem {
  title: string
  balance: number
  dueDate: string | null
}

interface _FeeReminder {
  subject: string
  excerpt: string
  createdAt: string
  senderName: string
}

interface NoticeItem {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  sender: string
  createdAt: string
  read: boolean
}

function emptyAttendance() {
  return {
    pct: null as number | null,
    present: 0,
    late: 0,
    absent: 0,
    total: 0,
    windowLabel: '',
    trend: [] as { name: string; v: number }[],
    weekDelta: null as number | null,
  }
}

/** Escape user-controlled text before embedding it in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
