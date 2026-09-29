import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/class-hub/marksheet?classId=&examId= — the class
 * marksheet MATRIX for one exam: subjects (with max marks) × every
 * student row (marks, total, %, rank). A pure read surface over the
 * canonical ExamMark rows — the same numbers Marks Entry, Results and
 * the Principal's report cards use; My Class never duplicates marks.
 * Only the appointed class teacher of the class may read it.
 */
export async function GET(request: Request) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const url = new URL(request.url)
      const classId = url.searchParams.get('classId')
      const examId = url.searchParams.get('examId')
      if (!classId || !examId) throw new Error('classId and examId are required')

      const cls = await db.class.findUnique({
        where: { id: classId },
        select: { id: true, schoolId: true, classTeacherId: true, name: true, section: true, room: true },
      })
      if (!cls || cls.schoolId !== schoolId) throw new Error('NOT_FOUND')
      if (cls.classTeacherId !== user.id) {
        throw new Error('FORBIDDEN — you are not the class teacher of this class')
      }

      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      })

      const exam = await db.exam.findUnique({
        where: { id: examId },
        select: { id: true, name: true, type: true, session: true, startDate: true, endDate: true, resultStatus: true, schoolId: true },
      })
      // Tenant guard (audit 3-b MEDIUM): the exam must belong to the
      // caller's school — the bare-id lookup previously served any
      // school's exam metadata (name/type/dates) into another tenant.
      if (!exam || exam.schoolId !== schoolId) throw new Error('NOT_FOUND')

      const students = await db.student.findMany({
        where: { classId, user: { status: 'ACTIVE' } },
        select: { id: true, rollNo: true, admissionNo: true, user: { select: { name: true } } },
        orderBy: { rollNo: 'asc' },
      })
      const markRows = await db.examMark.findMany({
        where: { classId, examId },
        select: {
          subjectId: true,
          studentId: true,
          marksObtained: true,
          status: true,
          workflowStatus: true,
        },
      })
      const configRows = await db.examSubjectConfig.findMany({
        where: { examId, classId },
        select: { subjectId: true, maxMarks: true, subject: { select: { name: true } } },
      })
      const subjectRows = await db.classSubjectAssignment.findMany({
        where: { classId, isActive: true },
        select: { subjectId: true, displayOrder: true, subject: { select: { name: true, fullMarks: true } } },
        orderBy: { displayOrder: 'asc' },
      })

      // subjects with entered marks, in the class's canonical display order
      const enteredSubjectIds = [...new Set(markRows.filter((m) => m.marksObtained != null).map((m) => m.subjectId))]
      const orderById = new Map(subjectRows.map((s, i) => [s.subjectId, i]))
      const configBySubject = new Map(configRows.map((c) => [c.subjectId, c]))
      const subjects = enteredSubjectIds
        .map((sid) => {
          const cfg = configBySubject.get(sid)
          const csa = subjectRows.find((s) => s.subjectId === sid)
          return {
            subjectId: sid,
            subjectName: cfg?.subject.name ?? csa?.subject.name ?? 'Subject',
            maxMarks: cfg?.maxMarks ?? csa?.subject.fullMarks ?? 100,
            order: orderById.get(sid) ?? 999,
          }
        })
        .sort((a, b) => a.order - b.order || a.subjectName.localeCompare(b.subjectName))

      // per-student rows: marks per subject, total, %, rank
      const maxTotal = subjects.reduce((sum, s) => sum + s.maxMarks, 0)
      interface Row {
        studentId: string
        rollNo: string | null
        admissionNo: string | null
        name: string
        marks: Record<string, { obtained: number | null; status: string }>
        total: number
        maxTotal: number
        pct: number
        hasAny: boolean
        rank: number | null
      }
      const rows: Row[] = students.map((s) => {
        const marks: Record<string, { obtained: number | null; status: string }> = {}
        let total = 0
        let hasAny = false
        for (const sub of subjects) {
          const m = markRows.find((r) => r.studentId === s.id && r.subjectId === sub.subjectId)
          if (m) {
            marks[sub.subjectId] = { obtained: m.marksObtained, status: m.status }
            if (m.marksObtained != null) {
              total += m.marksObtained
              hasAny = true
            } else if (m.status === 'ABSENT') {
              hasAny = true // absent counts as a scored-zero outcome, honestly shown
            }
          }
        }
        return {
          studentId: s.id,
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          name: s.user.name ?? 'Student',
          marks,
          total,
          maxTotal,
          pct: maxTotal > 0 ? Math.round((total / maxTotal) * 1000) / 10 : 0,
          hasAny,
          rank: null,
        }
      })
      const ranked = rows
        .filter((r) => r.hasAny)
        .sort((a, b) => b.total - a.total || (a.rollNo ?? '').localeCompare(b.rollNo ?? ''))
      ranked.forEach((r, i) => {
        r.rank = i + 1
      })

      return {
        classId,
        classLabel: classLabelOf(cls),
        room: cls.room,
        schoolName: school?.name ?? 'School',
        exam: {
          examId: exam.id,
          examName: exam.name,
          type: exam.type,
          session: exam.session,
          examDate: exam.startDate ? exam.startDate.toISOString().slice(0, 10) : null,
          resultStatus: exam.resultStatus,
        },
        subjects,
        rows: rows.filter((r) => r.hasAny || subjects.length === 0),
        classAveragePct:
          ranked.length > 0
            ? Math.round((ranked.reduce((a, r) => a + r.pct, 0) / ranked.length) * 10) / 10
            : null,
      }
    },
    { roles: ['TEACHER'] }
  )
}
