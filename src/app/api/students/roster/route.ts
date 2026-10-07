import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { deriveAttendanceSummary } from '@/lib/teacher/student-ledger'
import type { Prisma } from '@prisma/client'
import { num, dec, outstandingDec } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/students/roster — the canonical roster payload that hydrates
 * the students store (Seed → DB → API → UI; production data reduction
 * 2026-10). ONE universe of Student ids shared by every panel:
 *
 *   · PRINCIPAL / MANAGEMENT — the full school roster enriched with
 *     canonical derivations (attendance summary + 6-month trend, latest
 *     exam subject marks, fee standing, growth points, behavior count).
 *   · STUDENT — their OWN full record + classmates limited to public
 *     fields (name / roll / section / attendance pct); guardian, fee,
 *     exam-marks, growth and behavior data of other students is never
 *     sent to a student client (audit 3-a fix #2 — now actually true:
 *     classmates get latestExam=null, zeroed fees, null growth/behavior).
 *
 * All numbers derive from the canonical rows (Attendance, ExamMark +
 * ExamSubjectConfig, Fee + FeeTransaction, GrowthEvent, BehaviorRecord).
 * Nothing is fabricated: no marks ⇒ latestExam null; no fees ⇒ zeros.
 */

interface RosterStudent {
  id: string
  userId: string
  name: string
  email: string
  /** User.status — ACTIVE or INACTIVE (archived). */
  status: string
  rollNo: string | null
  admissionNo: string | null
  classId: string | null // section-level DB Class id
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  dob: string | null
  gender: string | null
  bloodGroup: string | null
  address: string | null
  routeName: string | null
  createdAt: string
  attendance: {
    pct: number | null
    records: number
    present: number
    absent: number
    late: number
    leave: number
    monthly: { month: string; pct: number }[]
  }
  latestExam: {
    examId: string
    examName: string
    subjects: { subjectId: string; subjectName: string; marks: number; maxMarks: number; pct: number }[]
    averagePct: number
  } | null
  // STUDENT scope: classmates' latestExam/growthPoints/behaviorCount are
  // null and fees is the ZEROED shape (Task 4-d, audit 3-a fix #2 — the
  // old payload sent every classmate's exam marks, fee ledger, growth
  // points and behavior counts to student clients, contradicting the
  // docstring). The zeroed fee SHAPE (not null) is required by the client
  // mapper (src/lib/store/students-store/server-sync.ts reads
  // s.fees.status unguarded — null would crash the student roster sync);
  // latestExam is optional-chained there, and growthPoints/behaviorCount
  // are never rendered for classmates (grep-verified).
  fees: {
    totalBilled: number
    totalPaid: number
    outstanding: number
    status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'NONE'
    awaitingVerification: number
  }
  growthPoints: number | null
  behaviorCount: number | null
}

export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const isStudent = user.role === 'STUDENT'

      // ── Scope resolution ────────────────────────────────────────────
      let scopeClassIds: string[] | null = null // null = whole school
      let selfStudentId: string | null = null
      if (isStudent) {
        const self = await db.student.findFirst({
          where: { userId: user.id },
          select: { id: true, classId: true },
        })
        if (!self) return { classes: [], subjects: [], teachers: [], students: [] }
        selfStudentId = self.id
        scopeClassIds = self.classId ? [self.classId] : []
      }

      // ── Classes / subjects / teachers ───────────────────────────────
      const [classRows, subjectRows, teacherRows, csaRows, ttRows] = await Promise.all([
        db.class.findMany({
          where: { schoolId, ...(scopeClassIds ? { id: { in: scopeClassIds } } : {}) },
          include: { _count: { select: { students: true } } },
          orderBy: [{ gradeLevel: 'asc' }, { section: 'asc' }],
        }),
        db.subject.findMany({
          where: { schoolId, status: 'Active' },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
        db.user.findMany({
          where: { schoolId, role: 'TEACHER', status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        db.classSubjectAssignment.findMany({
          where: { schoolId, isActive: true },
          orderBy: { displayOrder: 'asc' },
          select: { classId: true, subjectId: true },
        }),
        db.timetable.findMany({
          where: { schoolId, teacherName: { not: null } },
          select: { classId: true, teacherName: true, subjectId: true },
        }),
      ])

      const subjectsByClass = new Map<string, string[]>()
      for (const csa of csaRows) {
        subjectsByClass.set(csa.classId, [...(subjectsByClass.get(csa.classId) ?? []), csa.subjectId])
      }
      // Best-effort per-class subject → teacher map (timetable teacherName
      // resolved against the teacher roster by exact name).
      const teacherIdByName = new Map(teacherRows.map((t) => [(t.name ?? '').trim().toLowerCase(), t.id]))
      const subjectTeacherByClass = new Map<string, Record<string, string>>()
      for (const row of ttRows) {
        if (!row.teacherName || !row.classId || !row.subjectId) continue
        const tid = teacherIdByName.get(row.teacherName.trim().toLowerCase())
        if (!tid) continue
        const map = subjectTeacherByClass.get(row.classId) ?? {}
        if (!map[row.subjectId]) map[row.subjectId] = tid
        subjectTeacherByClass.set(row.classId, map)
      }

      const visibleClassIds = new Set(classRows.map((c) => c.id))

      // ── Students ────────────────────────────────────────────────────
      // Staff (P/M) see the FULL roster including archived students (the
      // directory filters Active client-side; the Archived tab reads the
      // same sync). The STUDENT projection stays ACTIVE-only — a student
      // sees active classmates, never archived records.
      const studentRows = await db.student.findMany({
        where: {
          schoolId,
          ...(visibleClassIds.size ? { classId: { in: [...visibleClassIds] } } : {}),
          ...(isStudent ? { user: { status: 'ACTIVE' } } : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true, createdAt: true, status: true } },
          route: { select: { name: true } },
        },
        orderBy: [{ rollNo: 'asc' }],
      })
      // Guardian emails (guardian is a User referenced by guardianId — no
      // direct relation, resolved in one batch query).
      const guardianIds = studentRows.map((s) => s.guardianId).filter((x): x is string => !!x)
      const guardianEmailById = new Map(
        guardianIds.length
          ? (await db.user.findMany({ where: { id: { in: guardianIds } }, select: { id: true, email: true } })).map((g) => [g.id, g.email])
          : [],
      )

      const studentIds = studentRows.map((s) => s.id)
      const idSet = new Set(studentIds)

      // ── Attendance (canonical rows → summary + monthly trend) ───────
      const attRows = await db.attendance.findMany({
        where: { schoolId, studentId: { in: studentIds } },
        select: { studentId: true, date: true, status: true },
      })
      const attByStudent = new Map<string, { date: Date; status: string }[]>()
      for (const row of attRows) {
        const list = attByStudent.get(row.studentId) ?? []
        list.push({ date: row.date, status: row.status })
        attByStudent.set(row.studentId, list)
      }

      // ── Latest exam per class (with entered marks) + per-subject pcts ─
      const markRows = await db.examMark.findMany({
        where: { classId: { in: [...visibleClassIds] }, marksObtained: { not: null } },
        select: {
          examId: true,
          classId: true,
          studentId: true,
          subjectId: true,
          marksObtained: true,
          exam: { select: { name: true, startDate: true, createdAt: true } },
          subject: { select: { name: true } },
        },
      })
      const escRows = await db.examSubjectConfig.findMany({
        where: { classId: { in: [...visibleClassIds] } },
        select: { classId: true, subjectId: true, maxMarks: true },
      })
      const maxByClassSubject = new Map(escRows.map((e) => [`${e.classId}|${e.subjectId}`, e.maxMarks]))
      // exam recency key
      const examRecency = new Map<string, number>()
      for (const m of markRows) {
        const d = m.exam.startDate ?? m.exam.createdAt
        const t = d ? new Date(d).getTime() : 0
        if (!examRecency.has(m.examId) || t > (examRecency.get(m.examId) ?? 0)) examRecency.set(m.examId, t)
      }
      const latestExamByClass = new Map<string, string>()
      for (const m of markRows) {
        const cur = latestExamByClass.get(m.classId)
        if (!cur || (examRecency.get(m.examId) ?? 0) > (examRecency.get(cur) ?? 0)) {
          latestExamByClass.set(m.classId, m.examId)
        }
      }
      const latestExamName = new Map<string, string>()
      for (const m of markRows) latestExamName.set(m.examId, m.exam.name)
      const latestMarksByStudent = new Map<
        string,
        { subjectId: string; subjectName: string; marks: number; maxMarks: number }[]
      >()
      for (const m of markRows) {
        if (latestExamByClass.get(m.classId) !== m.examId) continue
        if (!idSet.has(m.studentId)) continue
        const list = latestMarksByStudent.get(m.studentId) ?? []
        const max = maxByClassSubject.get(`${m.classId}|${m.subjectId}`) ?? 100
        list.push({ subjectId: m.subjectId, subjectName: m.subject.name, marks: m.marksObtained ?? 0, maxMarks: max })
        latestMarksByStudent.set(m.studentId, list)
      }

      // ── Fees (canonical standing; students see only their own) ──────
      const feeRows = await db.fee.findMany({
        where: { schoolId, studentId: { in: studentIds } },
        select: { studentId: true, amount: true, paid: true, dueDate: true },
      })
      const billedBy = new Map<string, Prisma.Decimal>()
      const paidBy = new Map<string, Prisma.Decimal>()
      const hasDueBy = new Map<string, boolean>()
      for (const f of feeRows) {
        billedBy.set(f.studentId, (billedBy.get(f.studentId) ?? dec(0)).plus(f.amount))
        paidBy.set(f.studentId, (paidBy.get(f.studentId) ?? dec(0)).plus(f.paid))
        if (f.dueDate && f.dueDate < new Date() && dec(f.paid).lessThan(f.amount)) hasDueBy.set(f.studentId, true)
      }
      const pendingTxnRows = await db.feeTransaction.groupBy({
        by: ['studentId'],
        where: {
          schoolId,
          studentId: { in: studentIds },
          status: { in: ['PENDING', 'UNDER_VERIFICATION'] },
        },
        _sum: { amount: true },
      })
      const awaitingBy = new Map(pendingTxnRows.map((t) => [t.studentId ?? '', num(t._sum.amount)]))

      // ── Growth + behavior counts ────────────────────────────────────
      const growthRows = await db.growthEvent.groupBy({
        by: ['studentId'],
        where: { schoolId, studentId: { in: studentIds }, status: 'ACTIVE' },
        _sum: { points: true },
      })
      const growthBy = new Map(growthRows.map((g) => [g.studentId, g._sum.points ?? 0]))
      const behaviorRows = await db.behaviorRecord.groupBy({
        by: ['studentId'],
        where: { schoolId, studentId: { in: studentIds } },
        _count: { _all: true },
      })
      const behaviorBy = new Map(behaviorRows.map((b) => [b.studentId ?? '', b._count._all]))

      // ── Assemble ────────────────────────────────────────────────────
      const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const students: RosterStudent[] = studentRows.map((s) => {
        const attRowsFor = attByStudent.get(s.id) ?? []
        const summary = deriveAttendanceSummary(attRowsFor)
        // 6-month trend (PRESENT + LATE attend)
        const byMonth = new Map<string, { attended: number; total: number }>()
        for (const row of attRowsFor) {
          const k = monthKey(row.date)
          const agg = byMonth.get(k) ?? { attended: 0, total: 0 }
          if (row.status === 'PRESENT' || row.status === 'LATE') agg.attended++
          agg.total++
          byMonth.set(k, agg)
        }
        const monthly = [...byMonth.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-6)
          .map(([k, v]) => ({ month: k, pct: v.total ? Math.round((v.attended / v.total) * 100) : 0 }))

        const latest = latestMarksByStudent.get(s.id) ?? null
        const latestExam = latest && latest.length
          ? {
              examId: latestExamByClass.get(s.classId ?? '') ?? '',
              examName: latestExamName.get(latestExamByClass.get(s.classId ?? '') ?? '') ?? '',
              subjects: latest.map((x) => ({ ...x, pct: x.maxMarks ? Math.round((x.marks / x.maxMarks) * 100) : 0 })),
              averagePct: Math.round(
                latest.reduce((a, x) => a + (x.maxMarks ? (x.marks / x.maxMarks) * 100 : 0), 0) / latest.length,
              ),
            }
          : null

        const billedD = billedBy.get(s.id) ?? dec(0)
        const paidD = paidBy.get(s.id) ?? dec(0)
        const billed = num(billedD)
        const paidAmt = num(paidD)
        const outstanding = num(outstandingDec(billedD, paidD))
        const feeStatus: RosterStudent['fees']['status'] =
          billedD.eq(0) ? 'NONE' : outstanding <= 0 ? 'PAID' : hasDueBy.get(s.id) ? 'OVERDUE' : paidD.greaterThan(0) ? 'PARTIAL' : 'UNPAID'

        const isSelf = s.id === selfStudentId
        // Classmate projection (STUDENT scope): everything that is not a
        // public class-list field is withheld — the self row keeps the
        // full enrichment (fees/attendance/exams) the student panel's own
        // profile derives from.
        const hidden = isStudent && !isSelf
        return {
          id: s.id,
          userId: s.user.id,
          name: s.user.name ?? '',
          email: isStudent && !isSelf ? '' : s.user.email,
          status: s.user.status,
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          classId: s.classId,
          guardianName: isStudent && !isSelf ? null : s.guardianName,
          guardianPhone: isStudent && !isSelf ? null : s.guardianPhone,
          guardianEmail: isStudent && !isSelf ? null : (s.guardianId ? guardianEmailById.get(s.guardianId) ?? null : null),
          dob: isStudent && !isSelf ? null : s.dob,
          gender: s.gender,
          bloodGroup: isStudent && !isSelf ? null : s.bloodGroup,
          address: isStudent && !isSelf ? null : s.address,
          routeName: isStudent && !isSelf ? null : s.route?.name ?? null,
          createdAt: s.user.createdAt.toISOString(),
          attendance: {
            pct: summary.pct,
            records: summary.records,
            present: summary.present,
            absent: summary.absent,
            late: summary.late,
            leave: summary.leave,
            monthly,
          },
          latestExam: hidden ? null : latestExam,
          fees: hidden
            ? { totalBilled: 0, totalPaid: 0, outstanding: 0, status: 'NONE', awaitingVerification: 0 }
            : {
                totalBilled: billed,
                totalPaid: paidAmt,
                outstanding,
                status: feeStatus,
                awaitingVerification: awaitingBy.get(s.id) ?? 0,
              },
          growthPoints: hidden ? null : growthBy.get(s.id) ?? 0,
          behaviorCount: hidden ? null : behaviorBy.get(s.id) ?? 0,
        }
      })

      return {
        classes: classRows.map((c) => ({
          id: c.id,
          name: c.name,
          gradeLevel: c.gradeLevel,
          section: c.section,
          stream: c.stream,
          capacity: c.capacity,
          room: c.room,
          classTeacherId: c.classTeacherId,
          studentCount: c._count.students,
          subjectIds: subjectsByClass.get(c.id) ?? [],
          subjectTeachers: subjectTeacherByClass.get(c.id) ?? {},
        })),
        subjects: subjectRows,
        teachers: teacherRows,
        students,
      }
    },
    // TEACHER panels are fully API-scoped (/api/teacher/*) and must not
    // receive the whole-school roster; the store sync is a principal /
    // management / student concern.
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'STUDENT'] },
  )
}
