import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText, phoneSchema } from '@/lib/security/validation'

export const runtime = 'nodejs'

// Task 4-d (audit 3-a fix #11): the self-service profile update runs
// through the Phase-1 validation gate — strict body (unknown fields
// rejected), name ≤ 100 chars, phone must match the shared phone pattern.
// (avatarUrl is NOT accepted by this route — avatars flow exclusively
// through /api/profile/avatar POST with the upload policy.)
const profileBodySchema = strictBody({
  name: safeText(100),
  phone: z.union([phoneSchema, z.literal('')]).optional(),
})

export async function PUT(req: NextRequest) {
  return withUser(async (user) => {
    const body = await parseJsonBody(req, profileBodySchema)

    // PIH-4a — in-tenant scope-hijack guard: the teacher-side scope
    // resolvers match legacy Timetable rows by lowercased teacherName
    // (only where teacherUserId IS NULL, after the CSA-first fix). A user
    // self-renaming to a colleague's timetable name would otherwise
    // inherit that teacher's subject/class scope. When the new name
    // differs from the current one (case-insensitive), refuse (409) if
    // ANY timetable row in the caller's school carries that teacherName
    // and is NOT already linked to this account.
    const newName = body.name.trim()
    const currentName = (user.name ?? '').trim()
    if (
      user.schoolId &&
      newName.toLowerCase() !== currentName.toLowerCase()
    ) {
      const rows = await db.timetable.findMany({
        where: { schoolId: user.schoolId, teacherName: { not: null } },
        select: { teacherName: true, teacherUserId: true },
      })
      const clashes = rows.some(
        (r) =>
          (r.teacherName ?? '').trim().toLowerCase() === newName.toLowerCase() &&
          (r.teacherUserId === null || r.teacherUserId !== user.id),
      )
      if (clashes) {
        throw new AppError('CONFLICT', {
          publicMessage:
            'This name is already used by a teacher on the school timetable. Please choose a different name.',
          internalDetail:
            'profile PUT: rename refused — timetable teacherName collision (in-tenant scope hijack guard)',
        })
      }
    }

    // Empty string clears the phone number (parity with the old route).
    const phone = body.phone !== undefined ? body.phone || null : undefined

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        name: body.name,
        ...(phone !== undefined ? { phone } : {}),
      },
      select: { id: true, name: true, email: true, phone: true },
    })

    return updated
  })
}
