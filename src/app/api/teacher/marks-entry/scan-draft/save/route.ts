import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import {
  authorizeScanScope,
  parseDraftPages,
  parseDraftRows,
} from '@/lib/marks-scan/server'

export const runtime = 'nodejs'

interface SaveDraftBody {
  examId?: string
  classId?: string
  subjectId?: string
  maxMarks?: number
  rows?: unknown
  pages?: unknown
}

/**
 * POST /api/teacher/marks-entry/scan-draft/save — persist the teacher's
 * scan REVIEW state (rows + page previews) for one exam × class × subject.
 *
 * This is a DRAFT, never official marks: nothing here is visible to any
 * marks/marksheet/growth reader, and every row is re-validated against
 * the real roster + maxMarks before being stored. A draft whose exam has
 * already been SUBMITTED through the canonical route is rejected — the
 * scan workflow never writes onto a locked sheet.
 */
export async function POST(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = (await request.json().catch(() => null)) as SaveDraftBody | null
      if (!body?.examId || !body?.classId || !body?.subjectId) {
        throw new Error('examId, classId and subjectId are required')
      }

      const auth = await authorizeScanScope(user, schoolId, {
        examId: body.examId,
        classId: body.classId,
        subjectId: body.subjectId,
      })

      // Exam-level lock: once any row of this grid is SUBMITTED — or
      // VERIFIED (TQA-7: VERIFIED is the final principal-verified state;
      // the old check treated it as editable) — or the exam itself is
      // COMPLETED/Declared, the sheet is frozen: no draft can be
      // (re)written for it.
      const existing = await db.examMark.findFirst({
        where: {
          examId: body.examId,
          classId: body.classId,
          subjectId: body.subjectId,
          workflowStatus: { in: ['SUBMITTED', 'VERIFIED'] },
        },
        select: { id: true },
      })
      const examRow = await db.exam.findUnique({
        where: { id: body.examId },
        select: { status: true, resultStatus: true },
      })
      const examClosed = existing || examRow?.resultStatus === 'Declared' || examRow?.status === 'COMPLETED'
      if (examClosed) {
        throw new Error('Marks already submitted — corrections flow through the exam office')
      }

      const rows = parseDraftRows(body.rows)
      const pages = parseDraftPages(body.pages)

      // Every roster-matched row must reference a real student of THIS class.
      const rosterIds = new Set(auth.roster.map((s) => s.id))
      const badRow = rows.find((r) => r.studentId !== '' && !rosterIds.has(r.studentId))
      if (badRow) throw new Error('Draft contains a student outside this class roster')

      // Values must be submittable shapes (digits ≤ maxMarks, 'AB', or '').
      for (const r of rows) {
        if (r.value === '' || r.value === 'AB') continue
        if (!/^\d{1,3}$/.test(r.value)) throw new Error(`Invalid draft value “${r.value}”`)
        const n = Number.parseInt(r.value, 10)
        if (n > auth.maxMarks) throw new Error(`Draft value ${n} exceeds maximum ${auth.maxMarks}`)
      }

      await db.marksScanDraft.upsert({
        where: {
          schoolId_teacherId_examId_classId_subjectId: {
            schoolId,
            teacherId: user.id,
            examId: body.examId,
            classId: body.classId,
            subjectId: body.subjectId,
          },
        },
        create: {
          schoolId,
          teacherId: user.id,
          examId: body.examId,
          classId: body.classId,
          subjectId: body.subjectId,
          session: auth.session,
          maxMarks: auth.maxMarks,
          rowsJson: JSON.stringify(rows),
          pagesJson: JSON.stringify(pages),
        },
        update: {
          session: auth.session,
          maxMarks: auth.maxMarks,
          rowsJson: JSON.stringify(rows),
          pagesJson: JSON.stringify(pages),
        },
      })
      return { saved: true, savedAt: new Date().toISOString() }
    },
    { roles: ['TEACHER'] },
  )
}
