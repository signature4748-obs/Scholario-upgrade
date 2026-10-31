import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText, phoneSchema } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const principalPatchSchema = strictBody({
  name: safeText(80).optional(),
  phone: phoneSchema.optional(),
})

/**
 * PATCH /api/platform/schools/[id]/principal — correct the founding
 * principal's profile fields (PHASE 2 Setup wizard, Principal step).
 *
 * Updates ONLY name and phone of the FOUNDING principal (earliest
 * PRINCIPAL row) — the account itself, its credentials and its role
 * binding stay governed by the existing flows:
 *   · credential (re)issue → POST …/reissue-credential (step-up,
 *     one-time bootstrap, 48h window, audited);
 *   · roster/lifecycle → the existing Manage surfaces.
 *
 * The principal's EMAIL is deliberately NOT writable here: it is the
 * account's identity anchor in the global-unique User.email space and
 * the invite/credential delivery target — changing it is out of the
 * wizard's scope (strictBody rejects unknown fields, so an email
 * attempt is a typed 422, never a silent overwrite).
 *
 * Permission: schools.manage. Audited: platform.school.principal_updated.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, principalPatchSchema)
    const ip = clientIpFromHeaders(req.headers)

    if (Object.keys(body).length === 0) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Nothing to save — send at least one principal field',
      })
    }

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'principal patch: no such school',
      })
    }

    const principal = await db.user.findFirst({
      where: { schoolId: school.id, role: 'PRINCIPAL' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, phone: true, email: true },
    })
    if (!principal) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'This school has no principal account yet',
        internalDetail: 'principal patch: no founding principal row',
      })
    }

    const changes: Record<string, string> = {}
    if (body.name !== undefined && body.name !== (principal.name ?? '')) {
      changes.name = `${principal.name ?? ''} → ${body.name}`
    }
    if (body.phone !== undefined && body.phone !== (principal.phone ?? '')) {
      changes.phone = `${principal.phone ?? ''} → ${body.phone}`
    }

    if (Object.keys(changes).length > 0) {
      await db.user.update({
        where: { id: principal.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
        },
      })
    }

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.principal_updated',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'principal profile update (setup wizard)',
      metadata: { changes, principalEmail: principal.email },
    })

    return {
      ok: true,
      updatedFields: Object.keys(changes),
      principal: {
        id: principal.id,
        name: body.name ?? principal.name,
        phone: body.phone ?? principal.phone,
        email: principal.email,
      },
    }
  })
}
