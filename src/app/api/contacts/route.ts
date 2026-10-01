import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * GET /api/contacts — the message-compose recipient picker directory.
 *
 * Task 4-d (audit 3-a fix #6): role-aware projection. The old handler
 * returned the FULL user directory (email + phone for every user in the
 * school) to ANY authenticated caller. Grep-verified client evidence: NO
 * surface under src/components/** or src/lib/** fetches /api/contacts (the
 * compose flows use the teacher roster / class-scoped stores), so the
 * projection below breaks no flow — it hardens the contract for any future
 * consumer:
 *
 *   · STUDENT / PARENT — teachers ONLY, { id, name, role } (no email, no
 *     phone; students reach teachers through the class-scoped surfaces).
 *   · staff (everyone else) — unchanged: full school directory with
 *     contact fields (same fields the route has always served).
 */
export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')

    // Non-staff callers: teachers only, contact-free projection.
    if (user.role === 'STUDENT' || user.role === 'PARENT') {
      const teachers = await db.user.findMany({
        where: {
          schoolId,
          role: 'TEACHER',
          status: 'ACTIVE',
          id: { not: user.id },
          ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
        take: 200,
      })
      return { users: teachers, grouped: { TEACHER: teachers } }
    }

    const users = await db.user.findMany({
      where: {
        schoolId,
        id: { not: user.id },
        status: 'ACTIVE',
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    })

    // Group by role for easier UI
    const grouped: Record<string, typeof users> = {}
    for (const u of users) {
      const role = u.role
      if (!grouped[role]) grouped[role] = []
      grouped[role].push(u)
    }

    return { users, grouped }
  })
}
