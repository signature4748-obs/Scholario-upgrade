import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isResultDeclared } from '@/lib/exams/types'
import { withUser } from '@/lib/api'
import {
  requireTeacher,
  assertStudentInScope,
  classLabelOf,
} from '@/lib/teacher-hub'
import { deriveStudentFees, deriveAttendanceSummary, type StudentFeesDto } from '@/lib/teacher/student-ledger'
import { growthScoresFor, feeStandingOf, growthSettingsFor, manualPresetsFor, toGrowthEventItem } from '@/lib/growth/service'
import { manualStateByStudent } from '@/lib/growth/limits'

/** The per-exam personal result state of ONE student (digital record
 * §7/§11/§12) — derived, never stored. */
export interface StudentExamStateDto {
  examId: string
  examName: string
  examDate: string | null
  type: string
  session: string | null
  resultStatus: string
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'FINALIZED'
  subjectsSubmitted: number
  subjectsTotal: number
  /** over submitted subjects only — labeled partial when incomplete */
  percentage: number | null
  partial: boolean
}

export const runtime = 'nodejs'

/**
 * GET /api/teacher/students/[studentId] — the ONE shared Teacher student
 * profile payload. Opened from the Student Directory, My Class, Fees &
 * Payments and Student Growth — the same canonical student, the same
 * sections, role-appropriate visibility:
 *
 * PERMISSION MODEL (all server-decided):
 *   · the student must be inside the teacher's authorized scope
 *     (class-teacher class ∪ subject-taught class ∪ hub relations) —
 *     assertStudentInScope re-validates on every request;
 *   · FEE LEDGER — visible ONLY when this teacher is the class teacher of
 *     the student's class (subject teachers never see a family's money);
 *     the FEE STANDING chip derives from the same ledger and is likewise
 *     class-teacher-only — it is administrative metadata, NEVER part of
 *     the growth score (§3/§23);
 *   · GROWTH — the canonical score + point ledger for this student
 *     (every teacher in scope sees the same growth data);
 *   · academics — the latest exam THIS student has entered marks for
 *     (nothing fabricated; no marks ⇒ null) PLUS the exam-wise personal
 *     result states (digital record §7–§12): for EVERY examination
 *     configured for the student's class, the honest NOT_STARTED /
 *     IN_PROGRESS / READY / FINALIZED state derived from the SAME
 *     canonical ExamMark + ExamSubjectConfig rows Marks Entry, Academics
 *     and Results Submission use — never a second marks record.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { studentId } = await params
      const student = await assertStudentInScope(ctx, studentId)

      const isClassTeacher = !!student.classId && ctx.classTeacherOf.some((c) => c.id === student.classId)
      const today = new Date()
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

      const [user_, attRows, ownMarkRows, feeRows, txnRows, growthEventRows, conversation, taughtSubjectRows, presets] =
        await Promise.all([
          db.user.findUnique({ where: { id: student.userId }, select: { name: true, email: true } }),
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
          // Fee rows load ONLY for the class teacher of the student's class.
          isClassTeacher
            ? db.fee.findMany({
                where: { studentId: student.id },
                include: { payments: { orderBy: { createdAt: 'desc' } } },
                orderBy: [{ dueDate: 'asc' }],
              })
            : Promise.resolve([]),
          isClassTeacher
            ? db.feeTransaction.findMany({
                where: { studentId: student.id, source: { not: null } },
                orderBy: { createdAt: 'desc' },
                take: 50,
              })
            : Promise.resolve([]),
          db.growthEvent.findMany({
            where: { schoolId: ctx.schoolId, studentId: student.id, status: 'ACTIVE' },
            include: {
              createdBy: { select: { id: true, name: true } },
              student: {
                select: {
                  id: true,
                  user: { select: { name: true } },
                  class: { select: { name: true, section: true } },
                },
              },
            },
            orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
            take: 20,
          }),
          db.parentConversation.findFirst({
            where: { teacherId: ctx.userId, studentId: student.id },
            select: { id: true },
          }),
          // subjects this teacher teaches in the student's class
          student.classId
            ? db.timetable.findMany({
                where: { schoolId: ctx.schoolId, classId: student.classId, teacherName: { not: null } },
                select: { teacherName: true, subject: { select: { name: true } } },
                distinct: ['teacherName', 'subjectId'],
              })
            : Promise.resolve([]),
          manualPresetsFor(ctx.schoolId),
        ])

      // ── latest exam with entered marks for THIS student (same honest
      //    rule as the Directory: no marks ⇒ null).
      let latestExam: {
        examId: string
        examName: string
        subjects: { subjectId: string; subjectName: string; marks: number; maxMarks: number; pct: number }[]
        averagePct: number
      } | null = null
      if (ownMarkRows.length > 0 && student.classId) {
        // the winning exam = greatest (startDate ?? createdAt) among the
        // exams this student has marks for
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

      // ── exam-wise personal result states (digital record §7–§12) ────
      // For EVERY examination linked to the student's class: the honest
      // NOT_STARTED / IN_PROGRESS / READY / FINALIZED state from the same
      // canonical ExamMark + ExamSubjectConfig rows every other module
      // uses. "Submitted" per subject = the student has an outcome (a
      // mark or an ABSENT); missing subjects are never invented.
      const exams: StudentExamStateDto[] = []
      if (student.classId) {
        const links = await db.examClass.findMany({
          where: { classId: student.classId },
          select: {
            exam: {
              select: { id: true, name: true, type: true, session: true, startDate: true, createdAt: true, resultStatus: true },
            },
          },
        })
        if (links.length > 0) {
          const examIds = links.map((l) => l.exam.id)
          const [cfgRows, ownRows, classRows] = await Promise.all([
            db.examSubjectConfig.findMany({
              where: { examId: { in: examIds }, classId: student.classId },
              select: { examId: true, subjectId: true, maxMarks: true, subject: { select: { name: true } } },
            }),
            // ALL of this student's rows in these exams (incl. ABSENT
            // outcomes and drafts — an outcome is an outcome)
            db.examMark.findMany({
              where: { examId: { in: examIds }, studentId: student.id },
              select: { examId: true, subjectId: true, marksObtained: true, status: true },
            }),
            // class-wide entered subjects — the honest fallback required
            // set for exams without a subject config for this class
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
            // the canonical declare flow writes "Result Declared"; the
            // seeded/student-results convention is "Declared" — both mean
            // the official final result is out
            const isDeclared = isResultDeclared(exam.resultStatus)
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
          // session-timeline order (earliest → latest) — the record reads
          // like the spec's §12 history: completed exams first, pending
          // future exams at the bottom where "Not started" belongs
          exams.sort((a, b) =>
            (a.examDate ?? a.examName).localeCompare(b.examDate ?? b.examName),
          )
        }
      }

      // ── canonical fee ledger (class teacher only) ─────────────────────
      const fees: StudentFeesDto | null = isClassTeacher
        ? deriveStudentFees(feeRows, txnRows, endOfToday)
        : null

      const teacherNameLc = (ctx.name || '').trim().toLowerCase()
      const taughtSubjects = [
        ...new Set(
          taughtSubjectRows
            .filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherNameLc && r.subject?.name)
            .map((r) => (r.subject?.name ?? '') as string),
        ),
      ].sort()

      // — canonical growth profile (the SAME score every surface shows) ─
      const [growth, growthSettings, manualState] = await Promise.all([
        growthScoresFor(ctx.schoolId, [student.id]).then((m) => [...m.values()][0] ?? null),
        growthSettingsFor(ctx.schoolId),
        manualStateByStudent(ctx.schoolId, ctx.userId, [student.id]).then(
          (m) => m.get(student.id) ?? { manualToday: false, manualWeekCategories: [] },
        ),
      ])

      return {
        student: {
          id: student.id,
          name: user_?.name ?? student.user?.name ?? 'Student',
          email: user_?.email ?? null,
          rollNo: student.rollNo,
          admissionNo: student.admissionNo,
          classId: student.classId,
          classLabel: classLabelOf(student.class),
          stream: student.class?.stream ?? null,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          gender: student.gender,
          dob: student.dob,
          bloodGroup: student.bloodGroup,
          address: student.address,
        },
        isClassTeacher,
        taughtSubjects,
        attendance: deriveAttendanceSummary(attRows),
        academics: { latestExam, exams },
        fees,
        growth: {
          score: growth ?? null,
          events: growthEventRows.map(toGrowthEventItem),
          feeStanding: feeStandingOf(fees),
          presets,
          settings: growthSettings,
          manualToday: manualState.manualToday,
          manualWeekCategories: manualState.manualWeekCategories,
        },
        conversationId: conversation?.id ?? null,
      }
    },
    { roles: ['TEACHER'] },
  )
}
