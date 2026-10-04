import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody, emailSchema, passwordInputSchema, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { generateTotpSecret } from '@/lib/platform/totp'
import { isPlatformTotpEnabled } from '@/lib/platform/mfa-config'
import { PLATFORM_PERMISSION_KEYS, OPS_DEFAULT_PERMISSIONS } from '@/lib/platform/permissions'

export const runtime = 'nodejs'

/**
 * GET /api/platform/admins — platform admin roster with effective
 * permission grants. Permission: admins.manage (root plane).
 */
export async function GET() {
  return withPlatform({ permission: 'admins.manage' }, async () => {
    const admins = await db.platformAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: true, _count: { select: { sessions: true } } },
    })
    return {
      admins: admins.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        status: a.status,
        isRoot: a.isRoot,
        isDemo: a.isDemo,
        createdAt: a.createdAt.toISOString(),
        lastLoginAt: null,
        grants: a.isRoot
          ? [...PLATFORM_PERMISSION_KEYS]
          : a.permissions.filter((p) => p.granted).map((p) => p.key),
        permissionCatalog: [...PLATFORM_PERMISSION_KEYS],
        liveSessions: 0, // filled below
      })),
    }
  })
}

const createSchema = strictBody({
  name: safeText(80),
  email: emailSchema,
  password: passwordInputSchema,
  isRoot: z.boolean().default(false),
  permissions: z.array(z.enum(PLATFORM_PERMISSION_KEYS)).default([...OPS_DEFAULT_PERMISSIONS]),
})

/**
 * POST /api/platform/admins — create a platform admin account.
 * DESTRUCTIVE (platform permissions) → admins.manage + STEP-UP.
 *
 * A random TOTP secret is generated server-side (kept on the account so
 * proper MFA can be re-enabled later without re-provisioning admins).
 * In the dev preview the secret is returned so the enrollment QR can be
 * rendered; in production the same response shape feeds the QR flow — the
 * secret is shown ONCE at enrollment, never stored client-side, never
 * re-served.
 *
 * PRODUCT-DIRECTION RESET (Part 1) — while platform TOTP is stood down
 * (mfa-config) the enrollment payload is NOT returned: there is nothing
 * to enroll into yet, so the console shows no authenticator setup flow.
 */
export async function POST(req: NextRequest) {
  return withPlatform(
    { permission: 'admins.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, createSchema)
      const ip = clientIpFromHeaders(req.headers)

      const existing = await db.platformAdmin.findUnique({ where: { email: body.email.toLowerCase() } })
      if (existing) {
        throw new AppError('CONFLICT', { publicMessage: 'A platform admin with this email already exists' })
      }

      const totpSecret = generateTotpSecret()
      const admin = await db.platformAdmin.create({
        data: {
          email: body.email.toLowerCase(),
          passwordHash: hashPassword(body.password),
          name: body.name,
          isRoot: body.isRoot,
          isDemo: false, // production admins are never demo
          totpSecret,
          status: 'ACTIVE',
        },
      })
      if (!body.isRoot) {
        for (const key of body.permissions) {
          await db.platformPermission.create({ data: { adminId: admin.id, key, granted: true } })
        }
      }

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.admin.created',
        targetType: 'ADMIN',
        targetId: admin.id,
        ip,
        reason: `created admin ${body.email} (root=${body.isRoot})`,
        metadata: { grants: body.isRoot ? 'all (root)' : body.permissions },
      })

      return {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        isRoot: admin.isRoot,
        grants: body.isRoot ? [...PLATFORM_PERMISSION_KEYS] : body.permissions,
        // Enrollment payload — shown once (QR provisioning in production).
        // PART 1 reset: only surfaced while platform MFA is actually on —
        // no enrollment UX (and no secret exposure surface) while the
        // challenge is stood down.
        ...(isPlatformTotpEnabled()
          ? {
              enrollment: {
                totpSecret,
                otpauthUrl: `otpauth://totp/Scholario:${encodeURIComponent(admin.email)}?secret=${totpSecret}&issuer=Scholario`,
              },
            }
          : {}),
      }
    },
    { method: 'POST' },
  )
}
