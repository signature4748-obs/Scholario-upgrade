import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
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
