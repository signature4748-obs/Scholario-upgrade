import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { getTeacherPreferences, saveTeacherPreferences } from '@/lib/user-preferences'

export const runtime = 'nodejs'

/**
 * The teacher's authorized classes — the SAME permission source the other
 * Teacher Workspace modules use (timetable assignments + class-teacher
 * classes). Server-side only: a class never leaves this list to a teacher
 * who has no relation to it.
 */
async function authorizedClasses(schoolId: string, userId: string, teacherName: string) {
  const ttRows = await db.timetable.findMany({
    where: { schoolId, teacherName: { not: null } },
    select: { classId: true, teacherName: true },
  })
  const classIds = new Set(
    ttRows
      .filter((r) => (r.teacherName || '').trim().toLowerCase() === teacherName)
      .map((r) => r.classId),
  )
  const classTeacherRows = await db.class.findMany({
    where: { schoolId, classTeacherId: userId },
    select: { id: true, name: true, section: true },
  })
  for (const c of classTeacherRows) classIds.add(c.id)

  const classes = await db.class.findMany({
    where: { schoolId, id: { in: [...classIds] } },
    select: { id: true, name: true, section: true },
    orderBy: [{ name: 'asc' }, { section: 'asc' }],
  })
  const classTeacherIds = new Set(classTeacherRows.map((c) => c.id))
  return classes.map((c) => ({
    id: c.id,
    label: classLabelOf(c),
    isClassTeacher: classTeacherIds.has(c.id),
  }))
}

/**
 * GET /api/teacher/settings — the signed-in teacher's preferences plus the
 * account/workspace context the Settings module renders: Teacher record,
 * authorized classes (for the default-class picker) and the school's
 * academic session (read-only — school-managed, not teacher-editable).
 * 3-d audit fix: routed through withUser (session identity + ACTIVE-status
 * enforcement + role gate) instead of a manual getCurrentUser/role check
 * that ignored account status.
 */
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const teacherName = (user.name || '').trim().toLowerCase()
      const [prefs, classes, teacherRow, school] = await Promise.all([
        getTeacherPreferences(user.id),
        authorizedClasses(schoolId, user.id, teacherName),
        db.teacher.findUnique({
          where: { userId: user.id },
          select: { employeeId: true, department: true, qualification: true, subjects: true },
        }),
        db.school.findUnique({
          where: { id: schoolId },
          select: { academicYear: true, name: true },
        }),
      ])

      return {
        ...prefs,
        teacher: {
          employeeId: teacherRow?.employeeId ?? null,
          department: teacherRow?.department ?? null,
          qualification: teacherRow?.qualification ?? null,
          subjects: teacherRow?.subjects ?? null,
        },
        classes,
        school: {
          name: school?.name ?? null,
          academicYear: school?.academicYear ?? null,
        },
      }
    },
    { roles: ['TEACHER'] },
  )
}

/**
 * PUT /api/teacher/settings — persist preference domains.
 * Body: { notifications?: {...booleans}, workspace?: { defaultClassId } }.
 *
 * defaultClassId is validated against the teacher's authorized classes —
 * a tampered id from another school (or a class she has nothing to do
 * with) is rejected, never silently stored.
 * 3-d audit fix: withUser envelope (ACTIVE enforcement + role gate).
 */
export async function PUT(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))

      // Validate the workspace default class BEFORE writing anything.
      if (body?.workspace?.defaultClassId != null) {
        const teacherName = (user.name || '').trim().toLowerCase()
        const classes = await authorizedClasses(schoolId, user.id, teacherName)
        const wanted = body.workspace.defaultClassId
        if (typeof wanted !== 'string' || !classes.some((c) => c.id === wanted)) {
          throw new Error('That class is not available to you.')
        }
      }

      return await saveTeacherPreferences(user.id, schoolId, {
        notifications: body?.notifications,
        workspace: body?.workspace,
      })
    },
    { roles: ['TEACHER'] },
  )
}
