import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody, boundedInt } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import {
  createSupportSession,
  setSupportSessionCookie,
  SUPPORT_MIN_MINUTES,
} from '@/lib/platform/auth'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

const accessSchema = strictBody({
  reason: z.string().min(10).max(400),
  durationMinutes: boundedInt(SUPPORT_MIN_MINUTES, 60),
})

/**
 * POST /api/platform/schools/[id]/access — "Access School": create a
 * SUPPORT SESSION (destructive: accesses sensitive school data →
 * permission support.access + live STEP-UP + explicit reason).
 *
 * What this does NOT do (by design — "avoid unrestricted
 * impersonation"):
 *   · it never mints a school Session row;
 *   · it never assumes a school identity/role;
 *   · it grants READ-ONLY oversight through a separate token space
 *     (`scholario_support` cookie / x-support-token header) that only
 *     unlocks the support overview endpoints — every school WRITE path
 *     remains unreachable with it.
 *
 * The school sees the event: an ActivityLog row is written into the
 * tenant's own journal (PLATFORM_SUPPORT_SESSION, reason included).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'support.access', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, accessSchema)
      const ip = clientIpFromHeaders(req.headers)

      // Honor the platform-configured maximum duration.
      const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
      const maxMinutes = setting?.supportMaxDuration ?? 60
      const durationMinutes = Math.min(body.durationMinutes, maxMinutes)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (school.status === 'SUSPENDED') {
        // Oversight of a suspended school is legitimate (that's often WHY
        // support is needed) — allowed, audited.
      }

      const { token, expiresAt } = await createSupportSession({
        adminId: ctx.admin.id,
        schoolId: school.id,
        reason: body.reason,
        durationMinutes,
      })
      await setSupportSessionCookie(token, durationMinutes * 60)

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.support_session.created',
        targetType: 'SUPPORT_SESSION',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: { durationMinutes, schoolName: school.name },
      })
      // School-visible marker (the principal's activity feed).
      await auditEvent({
        schoolId: school.id,
        action: 'PLATFORM_SUPPORT_SESSION',
        detail: `Platform support session opened (${durationMinutes} min) — ${body.reason}`,
      }).catch(() => {})

      return {
        ok: true,
        supportSession: {
          schoolId: school.id,
          schoolName: school.name,
          reason: body.reason,
          expiresAt: expiresAt.toISOString(),
        },
        // DEV PREVIEW ONLY: iframe cookie fallback for the support token.
        ...(process.env.NODE_ENV !== 'production' ? { supportToken: token } : {}),
      }
    },
    { method: 'POST' },
  )
}
