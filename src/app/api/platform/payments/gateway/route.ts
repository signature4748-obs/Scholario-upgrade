import { NextRequest } from 'next/server'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import {
  disablePlatformGatewayConfig,
  platformGatewayView,
  savePlatformGatewayConfig,
} from '@/lib/payments/platform-gateway'
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
 * PAYMENTS & GATEWAYS REDESIGN — the PLATFORM-level payment gateway
 * (the deployment's OWN provider account for Scholario subscription
 * payments, and the fee lane's fallback rail).
 *
 *   GET    → browser-safe view (public key id, provider, status, mode,
 *            checkout readiness — NO secrets, ever)
 *   PUT    → configure (billing.manage + STEP-UP). Secrets are
 *            AES-256-GCM encrypted at rest; the write is audited with
 *            LENGTHS only — values never enter the audit trail.
 *   DELETE → disable (falls back to the deployment env provider, if any).
 *
 * Platform-owned configuration: a principal never sees or sets these —
 * it is billing infrastructure. Money separation is structural: this
 * account collects SCHOLARIO subscription payments; school-collected
 * student fees live on SchoolPaymentGateway rows (disjoint tables,
 * credentials and webhooks).
 */
export async function GET(_req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const view = await platformGatewayView()
    return { gateway: view }
  })
}

export async function PUT(req: NextRequest) {
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, putSchema)
      const ip = clientIpFromHeaders(req.headers)
      if (body.provider === 'razorpay' && !/^rzp_(live|test)_/.test(body.publicKeyId)) {
        throw new AppError('VALIDATION_FAILED', {
          publicMessage: 'Razorpay key ids look like rzp_live_… or rzp_test_…',
        })
      }
      try {
        const view = await savePlatformGatewayConfig(body, ctx.admin.id, ip)
        return {
          ok: true,
          gateway: view,
          message: 'Platform gateway configured (secrets stored encrypted; never displayed again).',
        }
      } catch (e) {
        if (e instanceof TypeError) {
          throw new AppError('VALIDATION_FAILED', { publicMessage: e.message })
        }
        throw e
      }
    },
    { method: 'PUT' },
  )
}

export async function DELETE(req: NextRequest) {
  return withPlatform(
    { permission: 'billing.manage', stepUp: true },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)
      const view = await disablePlatformGatewayConfig(ctx.admin.id, ip)
      return {
        ok: true,
        gateway: view,
        message: 'Platform gateway disabled — the deployment env provider (if configured) is used instead.',
      }
    },
    { method: 'DELETE' },
  )
}
