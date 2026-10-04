import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { encryptSecret, tenantGatewayView } from '@/lib/payments/tenant-gateway'
import { z } from 'zod'

export const runtime = 'nodejs'

const putSchema = strictBody({
  provider: z.enum(['razorpay']).default('razorpay'),
  publicKeyId: z.string().trim().min(4).max(120),
  /** Write-only secret fields — NEVER echoed back by any reader. */
  keySecret: z.string().trim().min(8).max(200),
  webhookSecret: z.string().trim().min(8).max(200).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'DISABLED']).default('ACTIVE'),
  notes: z.string().max(400).optional(),
})

/**
 * SaaS-HARDENING (§3B) — the school's OWN student-fee gateway account.
 *
 *   GET  /api/platform/schools/[id]/payment-gateway → browser-safe view
 *        (public key id, provider, status — NO secrets, ever)
 *   PUT  /api/platform/schools/[id]/payment-gateway → configure the
 *        tenant gateway (billing.manage + STEP-UP). Secrets are
 *        AES-256-GCM encrypted at rest; the write is fully audited
 *        (secret LENGTHS only — values never enter the audit trail).
 *   DELETE → disable the tenant gateway (falls back to the deployment
 *        provider for that school).
 *
 * Platform-owned configuration (a principal never sees or sets these —
 * it is billing infrastructure), consumed server-side by the tenant-
 * scoped checkout resolution (getTenantPaymentProvider).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const view = await tenantGatewayView(id)
    return { gateway: view }
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, putSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (body.provider === 'razorpay' && !/^rzp_(live|test)_/.test(body.publicKeyId)) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Razorpay key ids look like rzp_live_… or rzp_test_…',
        })
      }

      const secretEnc = encryptSecret(body.keySecret)
      const webhookEnc = body.webhookSecret ? encryptSecret(body.webhookSecret) : null

      await db.schoolPaymentGateway.upsert({
        where: { schoolId: id },
        create: {
          schoolId: id,
          provider: body.provider,
          publicKeyId: body.publicKeyId,
          secretKeyCipher: secretEnc.cipher,
          secretKeyNonce: secretEnc.nonce,
          webhookSecretCipher: webhookEnc?.cipher ?? null,
          webhookSecretNonce: webhookEnc?.nonce ?? null,
          status: body.status,
          configuredById: ctx.admin.id,
          notes: body.notes ?? null,
        },
        update: {
          provider: body.provider,
          publicKeyId: body.publicKeyId,
          secretKeyCipher: secretEnc.cipher,
          secretKeyNonce: secretEnc.nonce,
          webhookSecretCipher: webhookEnc?.cipher ?? null,
          webhookSecretNonce: webhookEnc?.nonce ?? null,
          status: body.status,
          configuredById: ctx.admin.id,
          notes: body.notes ?? undefined,
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.school_gateway_configured',
        targetType: 'SCHOOL',
        targetId: id,
        schoolId: id,
        ip,
        reason: body.notes ?? 'School fee gateway configured',
        metadata: {
          provider: body.provider,
          publicKeyId: body.publicKeyId,
          status: body.status,
          keySecretLength: body.keySecret.length,
          webhookSecretConfigured: Boolean(body.webhookSecret),
        },
      })

      const view = await tenantGatewayView(id)
      return {
        ok: true,
        gateway: view,
        message: `Gateway configured for ${school.name} (secrets stored encrypted; never displayed again).`,
      }
    },
    { method: 'PUT' },
  )
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)
      const row = await db.schoolPaymentGateway.findUnique({ where: { schoolId: id } })
      if (!row) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'No gateway configured for this school' })
      }
      await db.schoolPaymentGateway.update({
        where: { schoolId: id },
        data: { status: 'DISABLED', configuredById: ctx.admin.id },
      })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.billing.school_gateway_disabled',
        targetType: 'SCHOOL',
        targetId: id,
        schoolId: id,
        ip,
        reason: 'School fee gateway disabled',
        metadata: { provider: row.provider },
      })
      return { ok: true, message: 'Gateway disabled — the school falls back to the deployment payment provider.' }
    },
    { method: 'DELETE' },
  )
}
