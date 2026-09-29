import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { AppError } from '@/lib/security/errors'
import { deriveStudentFees, deriveAttendanceSummary } from '@/lib/teacher/student-ledger'
import { growthScoresFor, toGrowthEventItem } from '@/lib/growth/service'

export const runtime = 'nodejs'

/** Per-exam personal result state (same honest derivation as the teacher
 * student detail route — digital record §7/§11/§12). */
interface StudentExamStateDto {
  examId: string
  examName: string
  examDate: string | null
  type: string
  session: string | null
  resultStatus: string
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'FINALIZED'
  subjectsSubmitted: number
  subjectsTotal: number
  percentage: number | null
  partial: boolean
}

/**
 * GET /api/students/[id] — the Principal/Management canonical student
 * profile payload. Mirrors the teacher student-detail route (the ONE
 * canonical profile contract) with principal-grade visibility:
 *
 *   · full fee ledger (principal sees every family's money),
 *   · full attendance history + growth ledger + behavior records,
 *   · exam-wise personal result states from the canonical ExamMark +
 *     ExamSubjectConfig rows — never a second marks record.
 *
 * School-scoped: the student must belong to the caller's school.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params

      const student = await db.student.findFirst({
        where: { id, schoolId },
        include: {
          user: { select: { id: true, name: true, email: true, createdAt: true } },
          class: true,
          route: { select: { id: true, name: true } },
        },
      })
      if (!student) throw new AppError('NOT_FOUND', { publicMessage: 'Student not found', internalDetail: 'students/[id]: student missing or foreign tenant' })
      // Task 4-d (fix #10 — defense in depth): the guardian USER is looked
      // up within the caller's school (a spoofed guardianId pointing at a
      // foreign-school user resolves to null instead of leaking that
      // user's contact fields through this profile).
      const guardianUser = student.guardianId
        ? await db.user.findFirst({
            where: { id: student.guardianId, schoolId },
            select: { id: true, name: true, email: true, phone: true },
          })
        : null

      const endOfToday = new Date()
      endOfToday.setHours(23, 59, 59, 999)

      const [attRows, ownMarkRows, feeRows, txnRows, growthEventRows, behaviorRows] = await Promise.all([
        db.attendance.findMany({
          where: { studentId: student.id },
          select: { date: true, status: true },
          orderBy: { date: 'desc' },
        }),
        db.examMark.findMany({
          where: { studentId: student.id, marksObtained: { not: null } },
          select: {
            examId: true,
            marksObtained: true,
            exam: { select: { name: true, startDate: true, createdAt: true } },
            subject: { select: { id: true, name: true, fullMarks: true } },
          },
        }),
        db.fee.findMany({
          where: { studentId: student.id },
          include: { payments: { orderBy: { createdAt: 'desc' } } },
          orderBy: [{ dueDate: 'asc' }],
        }),
        db.feeTransaction.findMany({
          where: { studentId: student.id, source: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.growthEvent.findMany({
          where: { schoolId, studentId: student.id, status: 'ACTIVE' },
          include: {
            createdBy: { select: { id: true, name: true } },
            student: { select: { id: true, user: { select: { name: true } }, class: { select: { name: true, section: true } } } },
          },
          orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
          take: 20,
        }),
        db.behaviorRecord.findMany({
          where: { studentId: student.id },
          orderBy: { date: 'desc' },
          take: 20,
          include: { recordedBy: { select: { name: true } } },
        }),
      ])

      // ── latest exam with entered marks (same honest rule as teacher) ──
      let latestExam: {
        examId: string
        examName: string
        subjects: { subjectId: string; subjectName: string; marks: number; maxMarks: number; pct: number }[]
        averagePct: number
      } | null = null
      if (ownMarkRows.length > 0 && student.classId) {
        let latestExamId: string | null = null
        let latestKey = -1
        const keyOf = new Map<string, number>()
        for (const m of ownMarkRows) {
          const key = (m.exam.startDate ?? m.exam.createdAt).getTime()
          keyOf.set(m.examId, Math.max(keyOf.get(m.examId) ?? -1, key))
          if (keyOf.get(m.examId)! > latestKey) {
            latestKey = keyOf.get(m.examId)!
            latestExamId = m.examId
          }
        }
        if (latestExamId) {
          const cfgRows = await db.examSubjectConfig.findMany({
            where: { examId: latestExamId, classId: student.classId },
            select: { subjectId: true, maxMarks: true },
          })
          const maxByKey = new Map(cfgRows.map((c) => [c.subjectId, c.maxMarks]))
          const rows = ownMarkRows.filter((m) => m.examId === latestExamId)
          const examName = rows[0]?.exam.name ?? 'Exam'
          const subjects = rows.map((m) => {
            const maxMarks = maxByKey.get(m.subject.id) ?? m.subject.fullMarks ?? 100
            return {
              subjectId: m.subject.id,
              subjectName: m.subject.name,
              marks: m.marksObtained ?? 0,
              maxMarks,
              pct: Math.round(((m.marksObtained ?? 0) / maxMarks) * 100),
            }
          })
          latestExam = {
            examId: latestExamId,
            examName,
            subjects,
            averagePct: Math.round(subjects.reduce((sum, x) => sum + x.pct, 0) / subjects.length),
          }
        }
      }

      // ── exam-wise personal result states ────────────────────────────
      const exams: StudentExamStateDto[] = []
      if (student.classId) {
        const links = await db.examClass.findMany({
          where: { classId: student.classId },
          select: { exam: { select: { id: true, name: true, type: true, session: true, startDate: true, createdAt: true, resultStatus: true } } },
        })
        if (links.length > 0) {
          const examIds = links.map((l) => l.exam.id)
          const [cfgRows, ownRows, classRows] = await Promise.all([
            db.examSubjectConfig.findMany({
              where: { examId: { in: examIds }, classId: student.classId },
              select: { examId: true, subjectId: true, maxMarks: true },
            }),
            db.examMark.findMany({
              where: { examId: { in: examIds }, studentId: student.id },
              select: { examId: true, subjectId: true, marksObtained: true, status: true },
            }),
            db.examMark.findMany({
              where: { examId: { in: examIds }, classId: student.classId, marksObtained: { not: null } },
              select: { examId: true, subjectId: true },
            }),
          ])
          const cfgByExam = new Map<string, { subjectId: string; maxMarks: number }[]>()
          for (const c of cfgRows) {
            const list = cfgByExam.get(c.examId) ?? []
            list.push({ subjectId: c.subjectId, maxMarks: c.maxMarks })
            cfgByExam.set(c.examId, list)
          }
          const classSubjectsByExam = new Map<string, Set<string>>()
          for (const r of classRows) {
            const set = classSubjectsByExam.get(r.examId) ?? new Set<string>()
            set.add(r.subjectId)
            classSubjectsByExam.set(r.examId, set)
          }
          const maxByExamSubject = new Map(cfgRows.map((c) => [`${c.examId}:${c.subjectId}`, c.maxMarks]))
          for (const exam of links.map((l) => l.exam)) {
            const required = cfgByExam.get(exam.id) ?? [...(classSubjectsByExam.get(exam.id) ?? [])].map((subjectId) => ({
              subjectId,
              maxMarks: maxByExamSubject.get(`${exam.id}:${subjectId}`) ?? 100,
            }))
            const own = ownRows.filter((r) => r.examId === exam.id)
            const ownBySubject = new Map(own.map((r) => [r.subjectId, r]))
            let submitted = 0
            let total = 0
            let maxTotal = 0
            for (const req of required) {
              const row = ownBySubject.get(req.subjectId)
              const isOutcome = !!row && (row.marksObtained != null || row.status === 'ABSENT')
              if (isOutcome) {
                submitted += 1
                total += row!.marksObtained ?? 0
                maxTotal += req.maxMarks
              }
            }
            const subjectsTotal = required.length
            const isDeclared = exam.resultStatus === 'Declared' || exam.resultStatus === 'Result Declared'
            const state: StudentExamStateDto['state'] =
              submitted === 0 || subjectsTotal === 0
                ? 'NOT_STARTED'
                : submitted < subjectsTotal
                  ? 'IN_PROGRESS'
                  : isDeclared
                    ? 'FINALIZED'
                    : 'READY'
            exams.push({
              examId: exam.id,
              examName: exam.name,
              examDate: exam.startDate ? exam.startDate.toISOString().slice(0, 10) : null,
              type: exam.type,
              session: exam.session,
              resultStatus: exam.resultStatus,
              state,
              subjectsSubmitted: submitted,
              subjectsTotal,
              percentage: submitted > 0 && maxTotal > 0 ? Math.round((total / maxTotal) * 1000) / 10 : null,
              partial: submitted > 0 && submitted < subjectsTotal,
            })
          }
          exams.sort((a, b) => (a.examDate ?? a.examName).localeCompare(b.examDate ?? b.examName))
        }
      }

      const fees = deriveStudentFees(feeRows, txnRows, endOfToday)
      const growth = await growthScoresFor(schoolId, [student.id]).then((m) => [...m.values()][0] ?? null)

      return {
        student: {
          id: student.id,
          name: student.user.name,
          email: student.user.email,
          rollNo: student.rollNo,
          admissionNo: student.admissionNo,
          classId: student.classId,
          classLabel: classLabelOf(student.class),
          stream: student.class?.stream ?? null,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          guardianEmail: guardianUser?.email ?? null,
          gender: student.gender,
          dob: student.dob,
          bloodGroup: student.bloodGroup,
          address: student.address,
          routeName: student.route?.name ?? null,
          joinedAt: student.user.createdAt.toISOString(),
        },
        attendance: deriveAttendanceSummary(attRows),
        academics: { latestExam, exams },
        fees,
        growth: {
          score: growth ?? null,
          events: growthEventRows.map(toGrowthEventItem),
        },
        behavior: behaviorRows.map((b) => ({
          id: b.id,
          date: b.date.toISOString().slice(0, 10),
          category: b.category,
          type: b.type,
          description: b.description,
          actionTaken: b.actionTaken,
          status: b.status,
          parentNotified: b.parentNotified,
          recordedBy: b.recordedBy?.name ?? null,
        })),
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
