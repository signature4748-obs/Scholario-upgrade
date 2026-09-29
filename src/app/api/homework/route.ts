import { NextRequest } from 'next/server'
import { withAuthz } from '@/lib/security/authz'
import { listHomework, createHomework, getClasses, getTeachers, getAnalytics } from '@/lib/homework/service'

export const runtime = 'nodejs'

// 3-d audit role gates (server-side permission matrix — never frontend
// hiding): reads are the STAFF homework surface ('school.homework.read' →
// P/M/T). Grep-verified before gating: NO client surface (components or
// lib stores) fetches 'api/homework' — the principal homework panel is
// deferred (Wave 1) and the student homework module was removed — so
// STUDENT/PARENT callers are refused outright and DRAFT rows can never
// reach a student account.
export function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.read' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view') || 'list'

    // Different views return different data
    if (view === 'classes') {
      return { classes: await getClasses(schoolId) }
    }
    if (view === 'teachers') {
      return { teachers: await getTeachers(schoolId) }
    }
    if (view === 'analytics') {
      return await getAnalytics(schoolId)
    }

    // Default: list homework with filters
    const filters = {
      status: searchParams.get('status') || undefined,
      classId: searchParams.get('classId') || undefined,
      subjectId: searchParams.get('subjectId') || undefined,
      teacherId: searchParams.get('teacherId') || undefined,
      search: searchParams.get('search') || undefined,
    }
    const homework = await listHomework(schoolId, filters)
    return { homework, classes: await getClasses(schoolId), teachers: await getTeachers(schoolId) }
  }) as Promise<Response>
}

export function POST(req: NextRequest) {
  return withAuthz({ permission: 'school.homework.write' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await req.json().catch(() => ({}))
    const homework = await createHomework(schoolId, ctx.user, body)
    return homework
  }) as Promise<Response>
}
