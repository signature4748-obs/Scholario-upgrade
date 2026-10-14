import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { revokeActivationCode, reissueActivationCode } from '@/lib/subscription/codes'
import { z } from 'zod'

export const runtime = 'nodejs'

const actionSchema = strictBody({
  action: z.enum(['revoke', 'reissue']),
  reason: z.string().min(4).max(400),
})

/**
 * PATCH /api/platform/subscriptions/codes/[id] — operator actions on an
 * activation code (billing.manage):
 *   revoke  — invalidate an ISSUED code (audited; claimed codes cannot be
 *             revoked — revoke the ENTITLEMENT instead).
 *   reissue — revoke + replace in ONE transaction (the old code can never
 *             claim after the replacement exists); returns the NEW code
 *             plaintext exactly ONCE (never stored, never logged).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    // revoke/reissue are destructive operator actions — step-up policy,
    // dormant while platform TOTP is stood down (re-arms with MFA).
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, actionSchema)
      const code = await db.activationCode.findUnique({
        where: { id },
        include: { school: { select: { id: true, name: true } }, student: { select: { id: true } } },
      })
      if (!code) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Activation code not found' })
      }

      if (body.action === 'revoke') {
        const result = await revokeActivationCode({ codeId: code.id, adminId: ctx.admin.id, reason: body.reason })
        if (result.status !== 'REVOKED') {
          throw new AppError('CONFLICT', {
            publicMessage: `This code is ${result.status.toLowerCase()} — nothing to revoke.`,
            internalDetail: `revoke: code ${code.publicRef} status ${result.status}`,
          })
        }
        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.billing.code_revoked',
          targetType: 'ACTIVATION_CODE',
          targetId: code.id,
          schoolId: code.schoolId,
          ip: clientIpFromHeaders(req.headers),
          reason: body.reason,
          metadata: { publicRef: code.publicRef, scope: code.scope },
        }).catch(() => {})
        return { ok: true, status: 'REVOKED', publicRef: code.publicRef, message: `Code ${code.publicRef} revoked.` }
      }

      // reissue
      const result = await reissueActivationCode({ codeId: code.id, adminId: ctx.admin.id, reason: body.reason })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.code_reissued',
        targetType: 'ACTIVATION_CODE',
        targetId: code.id,
        schoolId: code.schoolId,
        ip: clientIpFromHeaders(req.headers),
        reason: body.reason,
        metadata: { oldPublicRef: code.publicRef, newPublicRef: result.publicRef, oldStatus: result.revokedStatus },
      }).catch(() => {})
      return {
        ok: true,
        publicRef: result.publicRef,
        /** The ONLY copy of the new code — display once, deliver to the
         *  student out-of-band. Never stored, never logged. */
        code: result.code,
        expiresAt: result.expiresAt.toISOString(),
        message: `Reissued. The previous code (${code.publicRef}) can no longer be claimed. Show and copy the new code now — it will not be visible again.`,
      }
    },
    { method: 'PATCH' },
  )
}
