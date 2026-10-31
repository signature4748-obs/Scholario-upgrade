import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'

export const runtime = 'nodejs'

/**
 * GET /api/classes/class-teachers — the official class-teacher appointment
 * roster (PRINCIPAL/MANAGEMENT): every real class of the school with its
 * appointed class teacher + the appointable teacher pool. One call feeds
 * the Classes module's appointment card (no N+1).
 */
export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      const [classes, teachers] = await Promise.all([
        db.class.findMany({
          where: { schoolId },
          select: {
            id: true,
            name: true,
            section: true,
            room: true,
            classTeacherId: true,
            students: { where: { user: { status: 'ACTIVE' } }, select: { id: true } },
          },
          orderBy: { name: 'asc' },
        }),
        db.teacher.findMany({
          where: { schoolId },
          select: {
            userId: true,
            department: true,
            employeeId: true,
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { user: { name: 'asc' } },
        }),
      ])

      const teacherByUserId = new Map(teachers.map((t) => [t.user.id, t]))

      return {
        classes: classes.map((c) => {
          const t = c.classTeacherId ? teacherByUserId.get(c.classTeacherId) : undefined
          return {
            id: c.id,
            label: classLabelOf(c),
            room: c.room,
            studentCount: c.students.length,
            classTeacher: t
              ? {
                  userId: t.user.id,
                  name: t.user.name,
                  email: t.user.email,
                  department: t.department,
                  employeeId: t.employeeId,
                }
              : null,
          }
        }),
        teachers: teachers.map((t) => ({
          userId: t.user.id,
          name: t.user.name,
          email: t.user.email,
          department: t.department,
          employeeId: t.employeeId,
        })),
      }
    },
    { feature: 'people.structure.manage', roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
