import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { getTeacherSubjectAssignments } from '@/lib/teacher-scope'

export const runtime = 'nodejs'

/**
 * GET /api/teacher/class-attendance — the classes this teacher can mark
 * attendance for:
 *   • classes where she is the CLASS TEACHER (she owns the daily baseline
 *     for the whole class), and
 *   • classes she is APPOINTED to teach subjects in (subject-session
 *     attendance only, prefilled from the class teacher's baseline).
 * Class-teacher and subject-teacher capabilities live in ONE workspace —
 * the flag drives the available workflow, not a separate app.
 *
 * IQ3000 Phase 4: subject scope now resolves through the canonical CSA
 * appointments (lib/teacher-scope), timetable name-match as fallback.
 */
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      const classTeacherOf = await db.class.findMany({
        where: { schoolId, classTeacherId: user.id },
        select: { id: true, name: true, section: true },
        orderBy: { name: 'asc' },
      })

      const mine = await getTeacherSubjectAssignments(user, schoolId)
      const subjectRows = mine.length
        ? await db.subject.findMany({
            where: { schoolId, id: { in: mine.map((a) => a.subjectId) } },
            select: { id: true, name: true },
          })
        : []
      const subjectById = new Map(subjectRows.map((s) => [s.id, s]))
      const classRows = mine.length
        ? await db.class.findMany({
            where: { schoolId, id: { in: mine.map((a) => a.classId) } },
            select: { id: true, name: true, section: true },
          })
        : []
      const classById = new Map(classRows.map((c) => [c.id, c]))

      const classesMap = new Map<
        string,
        { classId: string; label: string; isClassTeacher: boolean; subjects: { id: string; name: string }[] }
      >()
      for (const c of classTeacherOf) {
        classesMap.set(c.id, { classId: c.id, label: classLabelOf(c), isClassTeacher: true, subjects: [] })
      }
      for (const a of mine) {
        const subj = subjectById.get(a.subjectId)
        const cls = classById.get(a.classId)
        if (!subj || !cls) continue
        const existing = classesMap.get(a.classId)
        if (existing) {
          if (!existing.subjects.some((s) => s.id === a.subjectId)) {
            existing.subjects.push({ id: a.subjectId, name: subj.name })
          }
        } else {
          classesMap.set(a.classId, {
            classId: a.classId,
            label: classLabelOf(cls),
            isClassTeacher: false,
            subjects: [{ id: a.subjectId, name: subj.name }],
          })
        }
      }

      const classes = [...classesMap.values()].sort((a, b) => a.label.localeCompare(b.label))
      for (const c of classes) c.subjects.sort((a, b) => a.name.localeCompare(b.name))
      return { classes }
    },
    { feature: 'attendance.mark', roles: ['TEACHER'] }
  )
}
