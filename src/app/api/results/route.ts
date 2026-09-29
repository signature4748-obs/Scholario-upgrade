import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * GET /api/results — the legacy Result rows, ROLE-SCOPED (audit §11/§8):
 *   · STUDENT  → ONLY their own rows (resolved from the session user —
 *                a student can never read another student's results,
 *                even by passing ?studentId= someone else).
 *   · TEACHER  → only rows of students in the classes they are class
 *                teacher of or teach a subject in (the same permission
 *                source as /api/teacher/students — Class.classTeacherId
 *                ∪ Timetable rows carrying their name).
 *   · PRINCIPAL / MANAGEMENT → school-wide (unchanged).
 * Tenant isolation: every path filters through exam.schoolId.
 */
export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const { searchParams } = new URL(req.url)
    const examId = searchParams.get('examId')
    const studentId = searchParams.get('studentId')

    // Role-derived student scope — the strictest wins.
    let studentIds: string[] | null = null
    if (user.role === 'STUDENT') {
      const me = await db.student.findFirst({ where: { userId: user.id, schoolId } })
      if (!me) return []
      studentIds = [me.id]
    } else if (user.role === 'TEACHER') {
      const teacherName = (user.name || '').trim().toLowerCase()
      const ttRows = await db.timetable.findMany({
        where: { schoolId, teacherName: { not: null } },
        select: { classId: true, teacherName: true },
      })
      const classIds = new Set<string>(
        ttRows.filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherName).map((r) => r.classId),
      )
      const ctClasses = await db.class.findMany({
        where: { schoolId, classTeacherId: user.id },
        select: { id: true },
      })
      for (const c of ctClasses) classIds.add(c.id)
      if (classIds.size === 0) return []
      const roster = await db.student.findMany({
        where: { schoolId, classId: { in: [...classIds] } },
        select: { id: true },
      })
      studentIds = roster.map((s) => s.id)
    }

    // An explicit studentId can only ever NARROW the role scope, never widen it.
    if (studentId && studentIds && !studentIds.includes(studentId)) return []
    const scope = studentId ? [studentId] : studentIds

    const results = await db.result.findMany({
      where: {
        exam: { schoolId },
        ...(examId ? { examId } : {}),
        ...(scope ? { studentId: { in: scope } } : {}),
      },
      include: { subject: true, exam: true, student: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return results
  })
}

/**
 * POST /api/results — staff-only publishing. Every entry is validated
 * against THIS school's students/subjects/exam before anything is
 * written (tenant integrity), and a TEACHER may only publish for
 * students inside their authorized classes.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const entries: Array<{ studentId: string; subjectId: string; marks: number; totalMarks?: number }> = body.entries || []
      if (!entries.length) throw new Error('entries[] required')

      // ── Tenant integrity: every referenced row must belong to this school.
      const studentIds = [...new Set(entries.map((e) => e.studentId))]
      const students = await db.student.findMany({
        where: { id: { in: studentIds }, schoolId },
        select: { id: true, classId: true },
      })
      const studentById = new Map(students.map((s) => [s.id, s]))
      for (const e of entries) {
        if (!studentById.has(e.studentId)) throw new Error(`Unknown student in this school: ${e.studentId}`)
      }

      // ── Teacher scope: only their authorized classes' students.
      if (user.role === 'TEACHER') {
        const teacherName = (user.name || '').trim().toLowerCase()
        const ttRows = await db.timetable.findMany({
          where: { schoolId, teacherName: { not: null } },
          select: { classId: true, teacherName: true },
        })
        const classIds = new Set<string>(
          ttRows.filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherName).map((r) => r.classId),
        )
        const ctClasses = await db.class.findMany({
          where: { schoolId, classTeacherId: user.id },
          select: { id: true },
        })
        for (const c of ctClasses) classIds.add(c.id)
        for (const e of entries) {
          const st = studentById.get(e.studentId)
          if (!st?.classId || !classIds.has(st.classId)) {
            throw new Error('FORBIDDEN — you can only publish results for your own classes')
          }
        }
      }

      const subjectIds = [...new Set(entries.map((e) => e.subjectId))]
      const subjects = await db.subject.findMany({
        where: { id: { in: subjectIds }, schoolId },
        select: { id: true },
      })
      const subjectOk = new Set(subjects.map((s) => s.id))
      for (const e of entries) {
        if (!subjectOk.has(e.subjectId)) throw new Error(`Unknown subject in this school: ${e.subjectId}`)
      }
      if (body.examId) {
        const exam = await db.exam.findFirst({ where: { id: body.examId, schoolId } })
        if (!exam) throw new Error('Unknown exam in this school')
      }

      // Phase 3 — idempotent publish: every entry is an UPSERT on the new
      // (studentId, examId, subjectId) unique. A retried POST (or two staff
      // publishing the same sheet) can no longer mint duplicate Result rows
      // for one student's subject — the row is updated in place.
      // Phase 4: array-form $transaction migrated to the interactive form
      // (same upserts, same order, now sequential inside the tx) so the
      // publish batch is label-tracked as a unit.
      const written = await trackedTransaction('results-publish-batch', async (tx) => {
        const rows: Array<Awaited<ReturnType<typeof tx.result.upsert>>> = []
        for (const e of entries) {
          rows.push(
            await tx.result.upsert({
              where: {
                studentId_examId_subjectId: {
                  studentId: e.studentId,
                  examId: body.examId || null,
                  subjectId: e.subjectId,
                },
              },
              create: {
                studentId: e.studentId,
                examId: body.examId || null,
                subjectId: e.subjectId,
                marks: Number(e.marks),
                totalMarks: Number(e.totalMarks) || 100,
                grade: gradeFor(Number(e.marks), Number(e.totalMarks) || 100),
                remarks: body.remarks || null,
              },
              update: {
                marks: Number(e.marks),
                totalMarks: Number(e.totalMarks) || 100,
                grade: gradeFor(Number(e.marks), Number(e.totalMarks) || 100),
                remarks: body.remarks || null,
              },
            }),
          )
        }
        return rows
      })
      await db.activityLog.create({
        data: { schoolId, userId: user.id, action: 'RESULTS_PUBLISHED', detail: `${written.length} result(s) published` },
      })
      return { count: written.length }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}

function gradeFor(marks: number, total: number): string {
  const pct = (marks / total) * 100
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B+'
  if (pct >= 60) return 'B'
  if (pct >= 50) return 'C'
  if (pct >= 33) return 'D'
  return 'F'
}
