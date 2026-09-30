import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform/permissions'

export const runtime = 'nodejs'

const permissionSchema = strictBody({
  key: z.enum(PLATFORM_PERMISSION_KEYS),
  granted: z.boolean(),
})

/**
 * PATCH /api/platform/admins/[id]/permissions — grant/revoke ONE
 * capability. DESTRUCTIVE (modifies platform permissions) →
 * admins.manage + STEP-UP. Root admins cannot have permissions revoked
 * (they are structurally all-capable; suspend instead).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'admins.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, permissionSchema)
      const ip = clientIpFromHeaders(req.headers)

      const admin = await db.platformAdmin.findUnique({ where: { id }, include: { permissions: true } })
      if (!admin) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Platform admin not found' })
      }
      if (admin.isRoot && !body.granted) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'Root admins hold every capability by design — suspend the account instead',
        })
      }
      if (admin.id === ctx.admin.id && !body.granted) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'You cannot revoke your own permissions',
        })
      }

      await db.platformPermission.upsert({
        where: { adminId_key: { adminId: admin.id, key: body.key } },
        update: { granted: body.granted },
        create: { adminId: admin.id, key: body.key, granted: body.granted },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.permission_changed',
        targetType: 'ADMIN',
        targetId: admin.id,
        ip,
        reason: `${body.granted ? 'granted' : 'revoked'} ${body.key} for ${admin.email}`,
        metadata: { key: body.key, granted: body.granted },
      })

      return { ok: true }
    },
    { method: 'PATCH' },
  )
}
