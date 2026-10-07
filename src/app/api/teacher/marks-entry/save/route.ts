import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { teacherCanEnterMarks } from '@/lib/teacher-scope'

export const runtime = 'nodejs'

interface SaveBody {
  examId?: string
  classId?: string
  subjectId?: string
  entries?: {
    studentId: string
    marks: number | null
    remarks?: string | null
    /** Canonical absent marker (ExamMark.status='ABSENT'): used by the
     *  scan review flow when the teacher confirms "AB". Requires null marks. */
    absent?: boolean
  }[]
}

/**
 * POST /api/teacher/marks-entry/save — save (draft) the marks for one
 * exam × class × subject the teacher teaches. Validation:
 *   • every mark must be a number 0 ≤ m ≤ maxMarks (or null = absent/not
 *     yet entered) — invalid values are rejected, never clamped;
 *   • the roster is re-derived server-side; unknown students are dropped;
 *   • SUBMITTED rows cannot be edited (the module enforces an explicit
 *     submit step; corrections flow through the office).
 * Both the manual roster and the Scan Marks Sheet review grid write
 * through THIS one canonical route — there is no second marks path.
 */
export async function POST(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = (await request.json().catch(() => null)) as SaveBody | null
      if (!body?.examId || !body?.classId || !body?.subjectId || !Array.isArray(body.entries)) {
        throw new Error('examId, classId, subjectId and entries are required')
      }

      // IQ3000 Phase 8 — canonical assignment guard (CSA appointment with
      // timetable fallback; see lib/teacher-scope). The old name-only
      // timetable check would miss CSA-appointed teachers without cells.
      const allowed = await teacherCanEnterMarks(user, schoolId, body.classId, body.subjectId)
      if (!allowed) {
        throw new Error('FORBIDDEN')
      }

      const config = await db.examSubjectConfig.findFirst({
        where: { examId: body.examId, classId: body.classId, subjectId: body.subjectId, exam: { schoolId } },
      })
      if (!config) throw new Error('NOT_FOUND')

      const students = await db.student.findMany({
        where: { classId: body.classId, user: { status: 'ACTIVE' } },
        select: { id: true },
      })
      const rosterIds = new Set(students.map((s) => s.id))

      const existing = await db.examMark.findMany({
        where: { examId: body.examId, classId: body.classId, subjectId: body.subjectId },
        select: { studentId: true, workflowStatus: true },
      })
      // TQA-7 (immutability lock): the sheet is locked when ANY row is
      // SUBMITTED — or VERIFIED (VERIFIED is the FINAL principal-verified
      // state of a declared result; the old check treated it as editable
      // and let a teacher overwrite a published mark of a Declared exam).
      // Corrections flow through the exam office, never here.
      const submittedIds = new Set(
        existing
          .filter((m) => m.workflowStatus === 'SUBMITTED' || m.workflowStatus === 'VERIFIED')
          .map((m) => m.studentId)
      )
      // Exam-level lock: a Declared exam's marks are published — immutable
      // from the teacher surface regardless of per-row workflow state
      // (a declared exam with zero rows is still a closed sheet).
      const examRow = await db.exam.findUnique({
        where: { id: body.examId },
        select: { status: true, resultStatus: true },
      })
      const examDeclared = examRow?.resultStatus === 'Declared' || examRow?.status === 'COMPLETED'
      if (submittedIds.size > 0 || examDeclared) {
        throw new Error('Marks already submitted — corrections flow through the exam office')
      }

      let saved = 0
      for (const e of body.entries) {
        if (!rosterIds.has(e.studentId)) continue
        if (submittedIds.has(e.studentId)) continue
        // Canonical absent: status='ABSENT' with null marks — the same
        // representation the marksheet and outcome engines already read.
        const absent = e.absent === true
        if (absent && e.marks != null) throw new Error('Absent entries cannot carry marks')
        if (e.marks != null) {
          if (typeof e.marks !== 'number' || !Number.isFinite(e.marks)) {
            throw new Error('Invalid marks value')
          }
          // Phase 3 (service-layer bounds, defense BEFORE the DB trigger):
          // 422-style rejection — the ExamMark DB bound-guard backstops
          // direct-DB writes.
          if (e.marks < 0 || e.marks > config.maxMarks) {
            throw new AppError('INVALID_INPUT', {
              publicMessage: `Marks must be between 0 and ${config.maxMarks}`,
              internalDetail: `marks-entry/save: marks ${e.marks} out of bounds (max ${config.maxMarks})`,
            })
          }
        }
        const remarks =
          typeof e.remarks === 'string' && e.remarks.trim() ? e.remarks.trim().slice(0, 200) : null
        // Phase 3: ExamMark.enteredBy stores the USER ID — the principal's
        // marks module resolves ids to display names via the teacher
        // directory (marks-hooks resolveEnteredBy; whitespace values are
        // the legacy display-name fallback). The canonical service
        // (setMark) already stores user ids.
        await db.examMark.upsert({
          where: {
            examId_classId_subjectId_studentId: {
              examId: body.examId,
              classId: body.classId,
              subjectId: body.subjectId,
              studentId: e.studentId,
            },
          },
          create: {
            examId: body.examId,
            classId: body.classId,
            subjectId: body.subjectId,
            studentId: e.studentId,
            marksObtained: absent ? null : e.marks,
            status: absent ? 'ABSENT' : 'PRESENT',
            workflowStatus: 'DRAFT',
            remarks,
            enteredBy: user.id,
            enteredAt: new Date(),
          },
          update: {
            marksObtained: absent ? null : e.marks,
            status: absent ? 'ABSENT' : 'PRESENT',
            remarks,
            enteredBy: user.id,
            enteredAt: new Date(),
          },
        })
        saved += 1
      }
      return { saved, locked: submittedIds.size }
    },
    { roles: ['TEACHER'] }
  )
}
