import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireTeacher, assertStudentInScope, classLabelOf } from '@/lib/teacher-hub'
import { getGradeForPercentage, isResultDeclared } from '@/lib/exams/types'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/students/[studentId]/marksheet — the STUDENT'S FORMAL
 * DIGITAL MARKSHEET: ONE consolidated document covering the WHOLE academic
 * session (every examination the school configured for the student's
 * class), in the supplied A4 template's design language.
 *
 * PURE PRESENTATION LAYER (§8/§32): there is no second marks database.
 * Every number is read from the SAME canonical rows Marks Entry /
 * Academics / Results Submission use —
 *   Exam + ExamClass (the Principal's examination configuration),
 *   ExamSubjectConfig (per-exam subject + maxMarks),
 *   ExamMark (canonical marks), GradeScale (school grading),
 *   ReportCardConfig (document sections), Attendance (canonical),
 *   School + Class + User (branding, class teacher, principal).
 * When teachers submit more marks the document reflects them on the next
 * open — no regeneration step (§11 progressive).
 *
 * DYNAMIC EXAMINATION STRUCTURE (§5/§6/§9): the exam columns come from the
 * ExamClass links for the student's class in the ACTIVE session — 2 exams
 * render 2 columns, 6 exams render 6. Nothing is hardcoded.
 *
 * HONESTY RULES (§10/§17): unentered marks render "—" — never 0, never
 * invented; totals/percentages are computed over SUBMITTED marks only and
 * labeled "(to date)" while any examination is still pending; the final
 * percentage appears without qualification only when every configured
 * examination is complete.
 *
 * STATE MACHINE (§24): per exam NOT_STARTED → IN_PROGRESS → READY →
 * FINALIZED (exam declared). Print/PDF is offered only when at least one
 * examination is complete (summary.canPrint).
 *
 * MULTI-TENANT SAFETY (§27): every query is scoped by the session's
 * schoolId (server-side) and by the student's OWN class/exam links.
 * Client-supplied ids are never trusted for tenancy — a School A student
 * can never receive School B branding, subjects, exams or marks.
 *
 * PERMISSIONS (§13 of the prior record spec, unchanged): the teacher must
 * have this student in scope (class-teacher ∪ subject-taught ∪ hub
 * relations) — the same visibility the Academics tab always had. Fee data
 * is never part of this document.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { studentId } = await params
      const student = await assertStudentInScope(ctx, studentId)
      if (!student.classId) throw new Error('Student is not assigned to a class')

      // ── the school's examination structure for this class ────────────
      const links = await db.examClass.findMany({
        where: { classId: student.classId },
        select: {
          exam: {
            select: {
              id: true, name: true, type: true, session: true,
              startDate: true, resultStatus: true, declaredAt: true,
            },
          },
        },
      })
      // active session: the school's configured academic year when the
      // class has exams in it, else the session of the latest exam
      const [school, classRow, principalUser] = await Promise.all([
        db.school.findUnique({
          where: { id: ctx.schoolId },
          select: {
            name: true, address: true, city: true, phone: true, email: true,
            academicYear: true, board: true, logoUrl: true,
          },
        }),
        db.class.findUnique({
          where: { id: student.classId },
          select: { classTeacherId: true },
        }),
        db.user.findFirst({
          where: { schoolId: ctx.schoolId, role: 'PRINCIPAL', status: 'ACTIVE' },
          select: { name: true },
        }),
      ])
      const allExams = links.map((l) => l.exam)
      const session =
        (school?.academicYear && allExams.some((e) => e.session === school.academicYear)
          ? school.academicYear
          : null) ??
        [...allExams].sort(
          (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
        )[0]?.session ??
        school?.academicYear ??
        null
      // session-timeline order (earliest → latest) — how the year reads
      const exams = allExams
        .filter((e) => e.session === session)
        .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0))

      const examIds = exams.map((e) => e.id)

      // ── canonical configuration + marks (parallel reads) ─────────────
      const [cfgRows, ownMarkRows, classMarkRows, csaRows, gradeScaleRows, reportCfg, attRows, outcomeRows, classWideMarkRows] =
        await Promise.all([
          db.examSubjectConfig.findMany({
            where: { examId: { in: examIds }, classId: student.classId },
            select: {
              examId: true, subjectId: true, maxMarks: true, sortOrder: true,
              subject: { select: { id: true, name: true, fullMarks: true } },
            },
          }),
          db.examMark.findMany({
            where: { examId: { in: examIds }, studentId: student.id },
            select: { examId: true, subjectId: true, marksObtained: true, status: true },
          }),
          // fallback "required subjects" for exams without a config: the
          // subjects the class has marks in (same convention as the
          // previous per-exam document + the students API)
          db.examMark.findMany({
            where: { examId: { in: examIds }, classId: student.classId },
            select: { examId: true, subjectId: true, subject: { select: { fullMarks: true } } },
          }),
          db.classSubjectAssignment.findMany({
            where: { classId: student.classId, isActive: true },
            select: { subjectId: true, displayOrder: true },
          }),
          db.gradeScale.findMany({
            where: { schoolId: ctx.schoolId },
            select: { grade: true, minPct: true, maxPct: true, color: true, sortOrder: true },
            orderBy: { minPct: 'desc' },
          }),
          db.reportCardConfig.findUnique({ where: { schoolId: ctx.schoolId } }),
          db.attendance.findMany({
            where: { studentId: student.id },
            select: { status: true },
          }),
          db.examResultOutcome.findMany({
            where: { examId: { in: examIds }, studentId: student.id },
            select: { examId: true, outcome: true, notes: true, reason: true },
          }),
          // the WHOLE class's canonical marks across the session's exams —
          // the basis of the honest class rank (same convention as the
          // class marksheet matrix: totals among students with any marks)
          db.examMark.findMany({
            where: { classId: student.classId, examId: { in: examIds } },
            select: { studentId: true, marksObtained: true },
          }),
        ])

      // per-exam maps
      const cfgByExam = new Map<string, Map<string, number>>() // examId -> subjectId -> maxMarks
      for (const c of cfgRows) {
        if (!cfgByExam.has(c.examId)) cfgByExam.set(c.examId, new Map())
        cfgByExam.get(c.examId)!.set(c.subjectId, c.maxMarks)
      }
      const fallbackByExam = new Map<string, Map<string, number>>() // examId -> subjectId -> maxMarks
      for (const r of classMarkRows) {
        if (cfgByExam.get(r.examId)?.size) continue // configured exams don't use the fallback
        if (!fallbackByExam.has(r.examId)) fallbackByExam.set(r.examId, new Map())
        const map = fallbackByExam.get(r.examId)!
        if (!map.has(r.subjectId)) map.set(r.subjectId, r.subject.fullMarks ?? 100)
      }
      const ownByExam = new Map<string, Map<string, { obtained: number | null; status: string }>>()
      for (const m of ownMarkRows) {
        if (!ownByExam.has(m.examId)) ownByExam.set(m.examId, new Map())
        ownByExam.get(m.examId)!.set(m.subjectId, {
          obtained: m.marksObtained ?? null,
          status: m.status,
        })
      }

      // ── the union of subjects across every exam (dynamic rows, §7) ────
      const subjectIds = new Set<string>()
      for (const e of exams) {
        for (const sid of cfgByExam.get(e.id)?.keys() ?? []) subjectIds.add(sid)
        for (const sid of fallbackByExam.get(e.id)?.keys() ?? []) subjectIds.add(sid)
        for (const sid of ownByExam.get(e.id)?.keys() ?? []) subjectIds.add(sid)
      }
      const subjectRows = await db.subject.findMany({
        where: { id: { in: [...subjectIds] } },
        select: { id: true, name: true, fullMarks: true },
      })
      const subjectById = new Map(subjectRows.map((s) => [s.id, s]))
      const csaOrder = new Map(csaRows.map((c) => [c.subjectId, c.displayOrder]))
      const orderedSubjectIds = [...subjectIds].sort((a, b) => {
        const sa = subjectById.get(a)
        const sb = subjectById.get(b)
        return (
          (csaOrder.get(a) ?? 999) - (csaOrder.get(b) ?? 999) ||
          (sa && sb ? sa.name.localeCompare(sb.name) : a.localeCompare(b))
        )
      })

      // ── per-exam summaries + the subject × exam matrix ───────────────
      const isDeclared = isResultDeclared // canonical helper (legacy 'Declared' ≡ 'Result Declared')
      type ExamDto = {
        examId: string
        examName: string
        type: string
        examDate: string | null
        resultStatus: string
        declaredAt: string | null
        state: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'FINALIZED'
        subjectsSubmitted: number
        subjectsTotal: number
        total: number
        maxTotal: number
        percentage: number | null
        partial: boolean
      }
      const examDtos: ExamDto[] = exams.map((e) => {
        const cfg = cfgByExam.get(e.id)
        const required =
          cfg && cfg.size > 0
            ? cfg
            : fallbackByExam.get(e.id) ?? new Map<string, number>()
        const own = ownByExam.get(e.id) ?? new Map()
        let submitted = 0
        let total = 0
        let maxTotal = 0
        for (const [subjectId, maxMarks] of required) {
          const row = own.get(subjectId)
          const isOutcome = !!row && (row.obtained != null || row.status === 'ABSENT')
          if (isOutcome) {
            submitted += 1
            total += row!.obtained ?? 0
            maxTotal += maxMarks
          }
        }
        const subjectsTotal = required.size
        const declared = isDeclared(e.resultStatus)
        const state: ExamDto['state'] =
          subjectsTotal === 0 || submitted === 0
            ? 'NOT_STARTED'
            : submitted < subjectsTotal
              ? 'IN_PROGRESS'
              : declared
                ? 'FINALIZED'
                : 'READY'
        return {
          examId: e.id,
          examName: e.name,
          type: e.type,
          examDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
          resultStatus: e.resultStatus,
          declaredAt: e.declaredAt ? e.declaredAt.toISOString().slice(0, 10) : null,
          state,
          subjectsSubmitted: submitted,
          subjectsTotal,
          total,
          maxTotal,
          percentage:
            submitted > 0 && maxTotal > 0
              ? Math.round((total / maxTotal) * 1000) / 10
              : null,
          partial: submitted > 0 && submitted < subjectsTotal,
        }
      })

      type CellDto = {
        /** configured for this exam (or has marks) — null = not part of it */
        maxMarks: number | null
        obtained: number | null
        markStatus: string | null
        isSubmitted: boolean
      }
      const subjects = orderedSubjectIds.map((sid) => {
        const cells: CellDto[] = exams.map((e) => {
          const cfgMax = cfgByExam.get(e.id)?.get(sid)
          const fallbackMax = fallbackByExam.get(e.id)?.get(sid)
          const own = ownByExam.get(e.id)?.get(sid)
          const maxMarks =
            cfgMax != null ? cfgMax : own || fallbackMax != null ? (fallbackMax ?? subjectById.get(sid)?.fullMarks ?? 100) : null
          const isSubmitted = !!own && (own.obtained != null || own.status === 'ABSENT')
          return {
            maxMarks,
            obtained: own?.obtained ?? null,
            markStatus: own?.status ?? null,
            isSubmitted,
          }
        })
        // row grand total only when every cell of this row that belongs to
        // an exam has an outcome (progressive honesty: no exam counted as 0)
        let pending = false
        let grandTotal = 0
        let grandMax = 0
        let anySubmitted = false
        for (const c of cells) {
          if (c.maxMarks == null && !c.isSubmitted) continue // subject not in that exam
          if (!c.isSubmitted) {
            pending = true
          } else {
            anySubmitted = true
            grandTotal += c.obtained ?? 0
            grandMax += c.maxMarks ?? 0
          }
        }
        const complete = anySubmitted && !pending
        const pct = complete && grandMax > 0 ? (grandTotal / grandMax) * 100 : null
        return {
          subjectId: sid,
          subjectName: subjectById.get(sid)?.name ?? 'Subject',
          cells,
          complete,
          grandTotal: complete ? grandTotal : null,
          grandMax: complete ? grandMax : null,
          grade: pct != null ? getGradeForPercentage(pct, gradeScaleRows).grade : null,
        }
      })

      // ── document-level summary ───────────────────────────────────────
      const pendingCells = examDtos.reduce(
        (n, e) => n + Math.max(0, e.subjectsTotal - e.subjectsSubmitted),
        0,
      )
      const anySubmitted = examDtos.some((e) => e.subjectsSubmitted > 0)
      const allComplete =
        examDtos.length > 0 && examDtos.every((e) => e.state === 'READY' || e.state === 'FINALIZED')
      const anyDeclared = examDtos.some((e) => e.state === 'FINALIZED')
      const docState: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'FINALIZED' =
        allComplete ? (anyDeclared ? 'FINALIZED' : 'READY') : anySubmitted ? 'IN_PROGRESS' : 'NOT_STARTED'
      // the year is still open → every total is "to date" (§10/§17: never
      // silently treat a missing examination as zero)
      const partial = !allComplete
      const grandTotal = subjects.reduce((n, s) => n + (s.grandTotal ?? 0), 0)
      const grandMax = subjects.reduce((n, s) => n + (s.grandMax ?? 0), 0)
      const percentage = grandMax > 0 ? Math.round((grandTotal / grandMax) * 1000) / 10 : null
      // date of issue — only a genuinely FINALIZED exam (declared AND all
      // marks in) may issue the document; never a declared-but-empty exam
      const declaredAt =
        [...examDtos]
          .filter((e) => e.state === 'FINALIZED' && e.declaredAt)
          .sort((a, b) => (a.declaredAt! < b.declaredAt! ? 1 : -1))[0]?.declaredAt ?? null
      const outcome = outcomeRows.find((o) => isDeclared(examDtos.find((e) => e.examId === o.examId)?.resultStatus ?? ''))

      const attended = attRows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length

      // ── class rank (§21): computed from the SAME canonical ExamMark rows
      // the class marksheet matrix ranks by — position among assessed
      // classmates. Never invented: absent a ranking (single student / no
      // marks) it is null and the marksheet shows no rank.
      const totalsByStudent = new Map<string, number>()
      for (const m of classWideMarkRows) {
        if (m.marksObtained == null) continue
        totalsByStudent.set(m.studentId, (totalsByStudent.get(m.studentId) ?? 0) + m.marksObtained)
      }
      const standings = [...totalsByStudent.entries()].sort((a, b) => b[1] - a[1])
      const rankIdx = standings.findIndex(([sid]) => sid === student.id)
      const classRank =
        rankIdx >= 0 && standings.length > 1
          ? { position: rankIdx + 1, assessedCount: standings.length }
          : null

      // the school's own co-scholastic areas (config, never constants)
      let coScholasticAreas: string[] = []
      if (reportCfg?.coScholasticAreas) {
        try {
          const parsed = JSON.parse(reportCfg.coScholasticAreas)
          if (Array.isArray(parsed)) {
            coScholasticAreas = parsed.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
          }
        } catch {
          coScholasticAreas = []
        }
      }
      const scaleUsed =
        gradeScaleRows.length > 0
          ? gradeScaleRows.map((g) => ({ grade: g.grade, minPct: g.minPct, maxPct: g.maxPct }))
          : // the app-wide default the exams module renders everywhere —
            // used only until the school configures its own scale
            [
              { grade: 'A1', minPct: 90, maxPct: 100 },
              { grade: 'A2', minPct: 80, maxPct: 89.99 },
              { grade: 'B1', minPct: 70, maxPct: 79.99 },
              { grade: 'B2', minPct: 60, maxPct: 69.99 },
              { grade: 'C1', minPct: 50, maxPct: 59.99 },
              { grade: 'C2', minPct: 33, maxPct: 49.99 },
              { grade: 'E', minPct: 0, maxPct: 32.99 },
            ]

      return {
        school: {
          name: school?.name ?? 'School',
          address: school?.address ?? null,
          city: school?.city ?? null,
          phone: school?.phone ?? null,
          email: school?.email ?? null,
          board: school?.board ?? null,
          logoUrl: school?.logoUrl ?? null,
        },
        student: {
          name: student.user?.name ?? 'Student',
          admissionNo: student.admissionNo,
          rollNo: student.rollNo,
          classLabel: classLabelOf(student.class),
          gender: student.gender,
          dob: student.dob,
          guardianName: student.guardianName,
        },
        session,
        classTeacherName: classRow?.classTeacherId
          ? ((await db.user.findUnique({
              where: { id: classRow.classTeacherId },
              select: { name: true },
            }))?.name ?? null)
          : null,
        principalName: principalUser?.name ?? null,
        exams: examDtos,
        subjects,
        summary: {
          state: docState,
          totalExams: examDtos.length,
          examsComplete: examDtos.filter((e) => e.state === 'READY' || e.state === 'FINALIZED')
            .length,
          examsWithMarks: examDtos.filter((e) => e.subjectsSubmitted > 0).length,
          grandTotal,
          grandMax,
          percentage,
          grade:
            allComplete && percentage != null
              ? getGradeForPercentage(percentage, gradeScaleRows).grade
              : null,
          partial,
          pendingExams: examDtos.filter((e) => e.state === 'NOT_STARTED' || e.state === 'IN_PROGRESS')
            .length,
          pendingCells,
          /** print / PDF unlocked once at least one examination's full
           *  result is in — the document honestly labels what is pending */
          canPrint: examDtos.some((e) => e.state === 'READY' || e.state === 'FINALIZED'),
          declaredAt,
          remark: outcome?.notes ?? outcome?.reason ?? null,
          outcome: outcome?.outcome ?? null,
        },
        attendance: {
          presentDays: attended,
          totalDays: attRows.length,
          pct: attRows.length > 0 ? Math.round((attended / attRows.length) * 100) : null,
        },
        classRank: (reportCfg?.showRank ?? true) ? classRank : null,
        gradeScale: {
          source: gradeScaleRows.length > 0 ? ('school' as const) : ('default' as const),
          rows: scaleUsed,
        },
        config: {
          showAttendance: reportCfg?.showAttendance ?? true,
          showRank: reportCfg?.showRank ?? true,
          showPercentage: reportCfg?.showPercentage ?? true,
          showGrade: reportCfg?.showGrade ?? true,
          showCoScholastic: reportCfg?.showCoScholastic ?? false,
          coScholasticAreas,
          showRemarks: reportCfg?.showRemarks ?? true,
          showClassTeacherSign: reportCfg?.showClassTeacherSign ?? true,
          showPrincipalSign: reportCfg?.showPrincipalSign ?? true,
        },
        generatedAt: new Date().toISOString(),
      }
    },
    { roles: ['TEACHER'] },
  )
}
