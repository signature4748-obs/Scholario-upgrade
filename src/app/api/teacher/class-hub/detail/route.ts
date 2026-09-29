import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { growthScoresFor } from '@/lib/growth/service'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/class-hub/detail?classId= — the FULL management payload
 * for ONE class the signed-in teacher is actually appointed class teacher
 * of (Class.classTeacherId = User.id — the same server truth that gates
 * the module). Everything derives from the canonical systems:
 *
 *   · directory   — the roster with 30-day attendance %, canonical growth
 *                   score, latest-exam academic % and fee standing;
 *   · performance — overall + subject averages, top performers, students
 *                   needing attention and the per-exam trend (ExamMark);
 *   · ranking     — per-exam academic ranking (NEVER the growth score);
 *   · attendance  — 30-day overall + monthly + weekly trend + the most
 *                   recent marked day + per-student breakdown + students
 *                   below the 85% threshold (canonical Attendance — this
 *                   is a READ/summarize surface; marking happens only in
 *                   the global Class Attendance module);
 *   · marksheets  — exams with entered marks for the class (view surface
 *                   over ExamMark — marks are never duplicated);
 *   · taughtSubjects — the class teacher's OWN subjects in this class, so
 *                   the Results section can show status-only for subjects
 *                   she does not teach (§26/§27).
 *
 * Nothing is fabricated: sections without data surface as nulls/empty
 * arrays and render as honest "Not enough data yet" states.
 */

/** Monday-start week key (YYYY-MM-DD) for an ISO date string. */
function weekKeyOf(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

const ATTENTION_THRESHOLD = 85 // % — students below this surface in the report

export async function GET(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const url = new URL(request.url)
      const classId = url.searchParams.get('classId')
      if (!classId) throw new Error('classId is required')

      const cls = await db.class.findUnique({
        where: { id: classId },
        select: {
          id: true,
          name: true,
          section: true,
          room: true,
          classTeacherId: true,
          schoolId: true,
          students: {
            where: { user: { status: 'ACTIVE' } },
            select: {
              id: true,
              rollNo: true,
              admissionNo: true,
              user: { select: { name: true } },
            },
            orderBy: { rollNo: 'asc' },
          },
        },
      })
      if (!cls || cls.schoolId !== schoolId) throw new Error('NOT_FOUND')
      if (cls.classTeacherId !== user.id) {
        throw new Error('FORBIDDEN — you are not the class teacher of this class')
      }

      const students = cls.students
      const studentIds = students.map((s) => s.id)
      const nameById = new Map(students.map((s) => [s.id, s.user.name]))
      const rollById = new Map(students.map((s) => [s.id, s.rollNo]))
      const label = classLabelOf(cls)
      const today = new Date()
      const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

      // ── 30-day attendance (canonical rows, stored at midnight UTC) ────
      const since = new Date(todayEnd.getTime() - 30 * 86_400_000)
      const attRows = studentIds.length
        ? await db.attendance.findMany({
            where: { studentId: { in: studentIds }, date: { gte: since, lte: todayEnd } },
            select: { studentId: true, status: true, date: true },
          })
        : []

      // per-student 30-day rate (LEAVE never penalizes: excluded from the
      // denominator, matching the growth engine's eligible-day model)
      const attStat = new Map<string, { attended: number; eligible: number; absent: number; late: number; leave: number }>()
      for (const sid of studentIds) attStat.set(sid, { attended: 0, eligible: 0, absent: 0, late: 0, leave: 0 })
      for (const r of attRows) {
        const st = attStat.get(r.studentId)
        if (!st) continue
        if (r.status === 'LEAVE') {
          st.leave++
          continue
        }
        st.eligible++
        if (r.status === 'PRESENT' || r.status === 'LATE') st.attended++
        if (r.status === 'ABSENT') st.absent++
        if (r.status === 'LATE') st.late++
      }
      const rateOf = (id: string) => {
        const st = attStat.get(id)!
        return st.eligible > 0 ? st.attended / st.eligible : null
      }

      // overall + monthly (6) + weekly (8) aggregates
      const dayAgg = new Map<string, { attended: number; eligible: number }>()
      for (const r of attRows) {
        if (r.status === 'LEAVE') continue
        const key = r.date.toISOString().slice(0, 10)
        const agg = dayAgg.get(key) ?? { attended: 0, eligible: 0 }
        agg.eligible++
        if (r.status === 'PRESENT' || r.status === 'LATE') agg.attended++
        dayAgg.set(key, agg)
      }
      const overallAttended = [...dayAgg.values()].reduce((a, v) => a + v.attended, 0)
      const overallEligible = [...dayAgg.values()].reduce((a, v) => a + v.eligible, 0)
      const monthAgg = new Map<string, { attended: number; eligible: number }>()
      const weekAgg = new Map<string, { attended: number; eligible: number }>()
      for (const [dayKey, agg] of dayAgg) {
        const mk = dayKey.slice(0, 7)
        const m = monthAgg.get(mk) ?? { attended: 0, eligible: 0 }
        m.attended += agg.attended
        m.eligible += agg.eligible
        monthAgg.set(mk, m)
        const wk = weekKeyOf(dayKey)
        const w = weekAgg.get(wk) ?? { attended: 0, eligible: 0 }
        w.attended += agg.attended
        w.eligible += agg.eligible
        weekAgg.set(wk, w)
      }
      const counts30 = {
        present: attRows.filter((r) => r.status === 'PRESENT').length,
        absent: attRows.filter((r) => r.status === 'ABSENT').length,
        late: attRows.filter((r) => r.status === 'LATE').length,
        leave: attRows.filter((r) => r.status === 'LEAVE').length,
      }

      // school operational days in the window — distinct dates ANY class of
      // this school has canonical attendance for. The honest denominator
      // behind "marked days" (this class) vs "school days" (the school).
      const schoolDayRows = await db.attendance.findMany({
        where: { schoolId, date: { gte: since, lte: todayEnd } },
        select: { date: true },
        distinct: ['date'],
      })
      const schoolDays = new Set(schoolDayRows.map((r) => r.date.toISOString().slice(0, 10))).size

      // the most recent marked day for THIS class, with per-status counts
      // (the report's "most recent attendance summary")
      const dayStatusAgg = new Map<string, { present: number; absent: number; late: number; leave: number }>()
      for (const r of attRows) {
        const key = r.date.toISOString().slice(0, 10)
        const agg =
          dayStatusAgg.get(key) ?? { present: 0, absent: 0, late: 0, leave: 0 }
        if (r.status === 'PRESENT') agg.present++
        else if (r.status === 'ABSENT') agg.absent++
        else if (r.status === 'LATE') agg.late++
        else if (r.status === 'LEAVE') agg.leave++
        dayStatusAgg.set(key, agg)
      }
      const latestDayKey = [...dayStatusAgg.keys()].sort().at(-1) ?? null
      const latestDay = latestDayKey ? { date: latestDayKey, ...dayStatusAgg.get(latestDayKey)! } : null

      // per-student 30-day breakdown (the full roster, roll order) — the
      // same canonical rows, never a second attendance state
      const byStudent = students.map((s) => {
        const st = attStat.get(s.id)!
        const rate = rateOf(s.id)
        return {
          studentId: s.id,
          name: s.user.name,
          rollNo: s.rollNo,
          ratePct: rate != null ? Math.round(rate * 100) : null,
          present: st.attended - st.late,
          absent: st.absent,
          late: st.late,
          leave: st.leave,
          markedDays: st.eligible + st.leave,
        }
      })

      const attendanceReport = {
        overall: {
          ratePct: overallEligible > 0 ? Math.round((overallAttended / overallEligible) * 100) : null,
          markedDays: dayAgg.size,
          schoolDays,
          ...counts30,
        },
        monthly: [...monthAgg.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-6)
          .map(([month, v]) => ({ month, ratePct: v.eligible > 0 ? Math.round((v.attended / v.eligible) * 100) : null })),
        weekly: [...weekAgg.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-8)
          .map(([week, v]) => ({ week, ratePct: v.eligible > 0 ? Math.round((v.attended / v.eligible) * 100) : null })),
        latestDay,
        byStudent,
        belowThreshold: studentIds
          .map((id) => {
            const st = attStat.get(id)!
            const rate = rateOf(id)
            return {
              studentId: id,
              name: nameById.get(id) ?? 'Student',
              rollNo: rollById.get(id) ?? null,
              ratePct: rate != null ? Math.round(rate * 100) : null,
              absentDays: st.absent,
              markedDays: st.eligible + st.leave,
            }
          })
          .filter((s) => s.ratePct != null && s.ratePct < ATTENTION_THRESHOLD && s.markedDays >= 3)
          .sort((a, b) => (a.ratePct ?? 0) - (b.ratePct ?? 0)),
      }

      // ── exams + marks (canonical ExamMark) ────────────────────────────
      const examLinks = await db.examClass.findMany({
        where: { classId },
        select: {
          examId: true,
          exam: {
            select: { id: true, name: true, type: true, status: true, resultStatus: true, startDate: true, createdAt: true },
          },
        },
      })
      const examIds = examLinks.map((l) => l.examId)
      const markRows = examIds.length
        ? await db.examMark.findMany({
            where: { classId, examId: { in: examIds } },
            select: {
              examId: true,
              subjectId: true,
              studentId: true,
              marksObtained: true,
              workflowStatus: true,
              status: true,
            },
          })
        : []
      const configRows = examIds.length
        ? await db.examSubjectConfig.findMany({
            where: { examId: { in: examIds }, classId },
            select: { examId: true, subjectId: true, maxMarks: true, subject: { select: { name: true } } },
          })
        : []
      const subjectRows = await db.classSubjectAssignment.findMany({
        where: { classId, isActive: true },
        select: { subjectId: true, displayOrder: true, subject: { select: { id: true, name: true, fullMarks: true } } },
        orderBy: { displayOrder: 'asc' },
      })
      const subjectName = new Map<string, string>([
        ...subjectRows.map((s) => [s.subject.id, s.subject.name] as [string, string]),
        ...configRows.map((c) => [c.subjectId, c.subject.name] as [string, string]),
      ])
      const maxMarksOf = new Map(configRows.map((c) => [`${c.examId}:${c.subjectId}`, c.maxMarks]))
      const subjectMax = new Map(subjectRows.map((s) => [s.subject.id, s.subject.fullMarks ?? 100]))

      // exams that actually have entered marks for this class, newest first
      const examByMarkCount = new Map<string, number>()
      for (const m of markRows) {
        if (m.marksObtained == null) continue
        examByMarkCount.set(m.examId, (examByMarkCount.get(m.examId) ?? 0) + 1)
      }
      const examsWithMarks = examLinks
        .map((l) => l.exam)
        .filter((e) => (examByMarkCount.get(e.id) ?? 0) > 0)
        .sort((a, b) => (b.startDate ?? b.createdAt).getTime() - (a.startDate ?? a.createdAt).getTime())

      // per-exam student percentage model: total ÷ the max totals of the
      // subjects with entered marks (absent students score 0 honestly)
      interface ExamStudentStat { total: number; maxTotal: number; pct: number }
      const statsByExam = new Map<string, Map<string, ExamStudentStat>>()
      for (const exam of examsWithMarks) {
        const rows = markRows.filter((m) => m.examId === exam.id && m.marksObtained != null)
        const subjectsWithMarks = [...new Set(rows.map((r) => r.subjectId))]
        const maxTotal = subjectsWithMarks.reduce((sum, sid) => sum + (maxMarksOf.get(`${exam.id}:${sid}`) ?? subjectMax.get(sid) ?? 100), 0)
        const byStudent = new Map<string, ExamStudentStat>()
        for (const r of rows) {
          const st = byStudent.get(r.studentId) ?? { total: 0, maxTotal, pct: 0 }
          st.total += r.marksObtained ?? 0
          byStudent.set(r.studentId, st)
        }
        for (const [_sid, st] of byStudent) {
          st.pct = st.maxTotal > 0 ? (st.total / st.maxTotal) * 100 : 0
        }
        statsByExam.set(exam.id, byStudent)
      }

      const latestExam = examsWithMarks[0] ?? null
      const latestStats = latestExam ? statsByExam.get(latestExam.id)! : new Map<string, ExamStudentStat>()
      const latestPcts = [...latestStats.values()].map((s) => s.pct)
      const classAveragePct =
        latestPcts.length > 0 ? Math.round(latestPcts.reduce((a, b) => a + b, 0) / latestPcts.length) : null

      // subject averages for the latest exam with marks
      const subjectAverages = latestExam
        ? [...new Set(markRows.filter((m) => m.examId === latestExam.id && m.marksObtained != null).map((m) => m.subjectId))]
            .map((sid) => {
              const rows = markRows.filter((m) => m.examId === latestExam.id && m.subjectId === sid && m.marksObtained != null)
              const mm = maxMarksOf.get(`${latestExam.id}:${sid}`) ?? subjectMax.get(sid) ?? 100
              const avg = rows.reduce((a, r) => a + (r.marksObtained ?? 0) / mm * 100, 0) / rows.length
              return { subjectId: sid, subjectName: subjectName.get(sid) ?? 'Subject', avgPct: Math.round(avg) }
            })
            .sort((a, b) => b.avgPct - a.avgPct)
        : []

      // per-exam subject averages (§14 — the Academics tab's examination
      // selector drives subject-wise performance for ANY exam with marks,
      // not just the latest; same canonical rows, grouped per exam)
      const subjectAveragesByExam: Record<string, { subjectId: string; subjectName: string; avgPct: number }[]> =
        Object.fromEntries(
          examsWithMarks.slice(0, 6).map((e) => {
            const rows = markRows.filter((m) => m.examId === e.id && m.marksObtained != null)
            const avgs = [...new Set(rows.map((r) => r.subjectId))]
              .map((sid) => {
                const subjectRows = rows.filter((r) => r.subjectId === sid)
                const mm = maxMarksOf.get(`${e.id}:${sid}`) ?? subjectMax.get(sid) ?? 100
                const avg = subjectRows.reduce((a, r) => a + (r.marksObtained ?? 0) / mm * 100, 0) / subjectRows.length
                return { subjectId: sid, subjectName: subjectName.get(sid) ?? 'Subject', avgPct: Math.round(avg) }
              })
              .sort((a, b) => b.avgPct - a.avgPct)
            return [e.id, avgs]
          }),
        )

      const studentRankList = [...latestStats.entries()]
        .sort((a, b) => b[1].pct - a[1].pct || (a[0] < b[0] ? -1 : 1))
        .map(([sid, st], i) => ({
          rank: i + 1,
          studentId: sid,
          name: nameById.get(sid) ?? 'Student',
          rollNo: rollById.get(sid) ?? null,
          pct: Math.round(st.pct * 10) / 10,
          total: st.total,
          maxTotal: st.maxTotal,
        }))
      const topPerformers = studentRankList.slice(0, 5)
      const needsAttention = studentRankList
        .filter((r) => r.pct < 40 || (classAveragePct != null && r.pct < classAveragePct - 15))
        .slice(0, 5)

      const performance = {
        latestExam: latestExam
          ? { examId: latestExam.id, examName: latestExam.name, examDate: latestExam.startDate ? latestExam.startDate.toISOString().slice(0, 10) : null }
          : null,
        overallAvgPct: classAveragePct,
        subjectAverages,
        topPerformers,
        needsAttention,
        trend: [...examsWithMarks]
          .reverse()
          .map((e) => {
            const stats = [...(statsByExam.get(e.id)?.values() ?? [])]
            const avg = stats.length > 0 ? Math.round((stats.reduce((a, s) => a + s.pct, 0) / stats.length) * 10) / 10 : null
            return { examId: e.id, examName: e.name, avgPct: avg }
          })
          .filter((t) => t.avgPct != null),
      }

      // ── ranking (per exam — academic only, NEVER the growth score) ────
      const ranking = {
        exams: examsWithMarks.slice(0, 6).map((e) => ({
          examId: e.id,
          examName: e.name,
          examDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
        })),
        rowsByExam: Object.fromEntries(
          examsWithMarks.slice(0, 6).map((e) => {
            const stats = statsByExam.get(e.id)!
            const rows = [...stats.entries()]
              .sort((a, b) => b[1].pct - a[1].pct || (a[0] < b[0] ? -1 : 1))
              .map(([sid, st], i) => ({
                rank: i + 1,
                studentId: sid,
                name: nameById.get(sid) ?? 'Student',
                rollNo: rollById.get(sid) ?? null,
                pct: Math.round(st.pct * 10) / 10,
                total: st.total,
                maxTotal: st.maxTotal,
              }))
            return [e.id, rows]
          })
        ),
      }

      // ── marksheets (management surface over canonical marks) ──────────
      const marksheets = examsWithMarks.slice(0, 6).map((e) => {
        const rows = markRows.filter((m) => m.examId === e.id)
        const entered = rows.filter((m) => m.marksObtained != null)
        const subjectsWithMarks = [...new Set(entered.map((r) => r.subjectId))]
        const stats = [...(statsByExam.get(e.id)?.values() ?? [])]
        return {
          examId: e.id,
          examName: e.name,
          examDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
          resultStatus: e.resultStatus,
          subjectsWithMarks: subjectsWithMarks.length,
          studentsScored: stats.length,
          avgPct:
            stats.length > 0
              ? Math.round((stats.reduce((a, s) => a + s.pct, 0) / stats.length) * 10) / 10
              : null,
        }
      })

      // ── fee standing per student (canonical Fee rows) ─────────────────
      const feeRows = studentIds.length
        ? await db.fee.findMany({
            where: { studentId: { in: studentIds } },
            select: { studentId: true, amount: true, paid: true, dueDate: true },
          })
        : []
      const feeByStudent = new Map<string, { outstanding: number; overdue: boolean }>()
      for (const f of feeRows) {
        const entry = feeByStudent.get(f.studentId) ?? { outstanding: 0, overdue: false }
        entry.outstanding += Math.max(0, f.amount - f.paid)
        if (f.amount - f.paid > 0 && f.dueDate && f.dueDate < todayEnd) entry.overdue = true
        feeByStudent.set(f.studentId, entry)
      }

      // ── canonical growth scores ───────────────────────────────────────
      const growthScores = await growthScoresFor(schoolId, studentIds)

      // ── the class's 8-week growth trend (§20/§22) — the average of the
      // members' weekly snapshots, exactly like the growth workspace's
      // per-class trend. Presented INSIDE My Class, never a second engine.
      const memberGrowth = studentIds
        .map((id) => growthScores.get(id))
        .filter((g): g is NonNullable<typeof g> => !!g)
      const trendLen = Math.max(0, ...memberGrowth.map((g) => g.trend.length), 0)
      const growthTrend: { label: string; value: number | null }[] = []
      for (let i = 0; i < trendLen; i++) {
        const vals: number[] = []
        let label = `W${i + 1}`
        for (const g of memberGrowth) {
          const p = g.trend[i]
          if (p) {
            label = p.label
            if (p.value != null) vals.push(p.value)
          }
        }
        growthTrend.push({
          label,
          value: vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
        })
      }

      // ── directory rows ────────────────────────────────────────────────
      const directory = students.map((s) => {
        const g = growthScores.get(s.id)
        const fee = feeByStudent.get(s.id)
        return {
          studentId: s.id,
          name: s.user.name,
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          attendancePct: (() => {
            const rate = rateOf(s.id)
            return rate != null ? Math.round(rate * 100) : null
          })(),
          growthScore: g?.score ?? null,
          growthMonthDelta: g?.monthDelta ?? 0,
          academicPct: latestStats.has(s.id) ? Math.round((latestStats.get(s.id)!.pct + Number.EPSILON) * 10) / 10 : null,
          feeOutstanding: fee?.outstanding ?? 0,
          feeOverdue: fee?.overdue ?? false,
        }
      })

      // ── the class teacher's OWN subjects here (§26/§27) ───────────────
      const teacherName = (user.name || '').trim().toLowerCase()
      const activeCSA = new Set(
        (
          await db.classSubjectAssignment.findMany({
            where: { schoolId, classId, isActive: true },
            select: { subjectId: true },
          })
        ).map((c) => c.subjectId)
      )
      const ttRows = teacherName
        ? await db.timetable.findMany({
            where: { schoolId, classId, teacherName: { not: null }, subjectId: { not: null } },
            select: { subjectId: true, teacherName: true },
          })
        : []
      const taughtSubjects = [
        ...new Map(
          ttRows
            .filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherName && r.subjectId && activeCSA.has(r.subjectId))
            .map((r) => {
              const sid = r.subjectId as string
              return [sid, { subjectId: sid, subjectName: subjectName.get(sid) ?? 'Subject' }] as [string, { subjectId: string; subjectName: string }]
            })
        ).values(),
      ].sort((a, b) => a.subjectName.localeCompare(b.subjectName))

      return {
        classId,
        label,
        studentCount: students.length,
        directory,
        performance,
        subjectAveragesByExam,
        ranking,
        attendanceReport,
        marksheets,
        taughtSubjects,
        growthTrend,
      }
    },
    { roles: ['TEACHER'] }
  )
}
