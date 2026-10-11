import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPassword,
  hashPassword,
  burnPasswordTiming,
} from '@/lib/auth'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import {
  RATE_LIMITS,
  enforceRateLimitStrict,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import {
  parseJsonBody,
  strictBody,
  passwordInputSchema,
  newPasswordSchema,
} from '@/lib/security/validation'
import { platformAuditEvent } from '@/lib/platform/audit'
import {
  getPlatformSession,
  createPlatformSession,
  setPlatformSessionCookie,
  revokePlatformSession,
} from '@/lib/platform/auth'
import { invalidateAdminResetTokens } from '@/lib/platform/password-reset'
import { isSupabaseAuthEnabled, provisionProviderPassword, linkPlatformAdminAuthUser } from '@/lib/auth/supabase'

export const runtime = 'nodejs'

const changePasswordBodySchema = strictBody({
  currentPassword: passwordInputSchema,
  newPassword: newPasswordSchema,
  confirmPassword: passwordInputSchema,
})

/** Cutover helper — guarded platform link (conflict-safe, never throws). */
async function linkPlatformAuthUserSafe(adminId: string, authUserId: string): Promise<boolean> {
  try {
    const link = await linkPlatformAdminAuthUser(adminId, authUserId)
    return link.linked
  } catch {
    return false
  }
}

/**
 * POST /api/platform/auth/change-password — the signed-in admin's OWN
 * password self-service (P0-A repair).
 *
 * WHY THIS ROUTE EXISTS: before it, a signed-in platform admin could
 * only rotate their password through the EMAILED reset flow (broken
 * email delivery = no rotation at all) or dual-control recovery
 * (requires a second admins.manage holder — impossible with a single
 * active admin). The owner could sign in and still be unable to
 * retire a bootstrap credential. This is the in-session repair,
 * mirroring the school-plane /api/auth/change-password contract:
 *
 *   · platform session REQUIRED (a school token can never reach here —
 *     disjoint token spaces enforced by getPlatformSession);
 *   · strict schema (new-password policy: ≥8 chars, letter + digit);
 *   · per-account throttle (5 attempts/hour — brute force on the
 *     current-password field is bounded);
 *   · CURRENT password verification (a stolen session cannot silently
 *     rotate the credential);
 *   · new-password ≠ current-password;
 *   · every OTHER platform session is revoked, the CURRENT session is
 *     ROTATED (the pre-change token, if stolen, dies immediately) —
 *     the new token travels through the same transports as login
 *     (Set-Cookie always; body only in the dev bearer preview mode);
 *   · outstanding emailed reset tokens for the admin are invalidated;
 *   · audited on BOTH outcomes (platform.password.changed /
 *     platform.password.change_failed) — never the secret;
 *   · SUPABASE AUTH staged-migration cutover (same contract as the
 *     school plane): best-effort provider provisioning at the natural
 *     password change; a provider failure is audited, never surfaced
 *     as an app error.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    // ── Identity: the platform session boundary (school tokens die here) ─
    const authed = await getPlatformSession()
    if (!authed) {
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Sign in to change your password',
        internalDetail: 'platform change-password: no platform session',
      })
    }
    const { admin, session } = authed

    // ── Per-account throttle (credential-adjacent mutation, strict) ────
    await enforceRateLimitStrict(`rl:pf-pwchange:${admin.id}`, RATE_LIMITS.passwordChange)

    const body = await parseJsonBody(req, changePasswordBodySchema)
    const ip = clientIpFromHeaders(req.headers)

    if (body.newPassword !== body.confirmPassword) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'New passwords do not match' })
    }

    // ── Current-password proof (a live session is NOT enough to rotate) ─
    const dbAdmin = await db.platformAdmin.findUnique({ where: { id: admin.id } })
    if (!dbAdmin) {
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Sign in to change your password',
        internalDetail: 'platform change-password: admin row vanished mid-session',
      })
    }
    const currentOk = dbAdmin.passwordHash
      ? verifyPassword(body.currentPassword, dbAdmin.passwordHash)
      : (burnPasswordTiming(), false)

    if (!currentOk) {
      await platformAuditEvent({
        adminId: admin.id,
        action: 'platform.password.change_failed',
        targetType: 'AUTH',
        targetId: admin.id,
        ip,
        requestId,
        reason: 'current password incorrect',
      }).catch(() => {})
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Current password is incorrect',
        internalDetail: 'platform change-password: current password mismatch',
      })
    }

    if (body.currentPassword === body.newPassword) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'The new password must be different from the current one',
      })
    }

    // ── Apply: new scrypt hash (the exact production implementation) ────
    await db.platformAdmin.update({
      where: { id: admin.id },
      data: { passwordHash: hashPassword(body.newPassword) },
    })

    // Revoke every OTHER live session (standard practice: a password
    // change invalidates other devices). The current session is
    // ROTATED below, so its old token dies too.
    const revoked = await db.platformAdminSession.updateMany({
      where: { adminId: admin.id, revokedAt: null, id: { not: session.id } },
      data: { revokedAt: new Date() },
    })

    // Any outstanding emailed reset token for this admin is now stale.
    await invalidateAdminResetTokens(admin.id).catch(() => {})

    // ── Session rotation: revoke the current row, mint a fresh token ───
    await revokePlatformSession(session.id)
    const { token } = await createPlatformSession(admin.id, {
      userAgent: session.userAgent,
      ipAddress: session.ipAddress ?? ip,
      // No fresh MFA ran during a password change; the step-up window
      // is not implicitly extended (the previous row's stepUpAt is
      // deliberately not carried over).
      stepUp: false,
    })
    await setPlatformSessionCookie(token)

    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.password.changed',
      targetType: 'AUTH',
      targetId: admin.id,
      ip,
      requestId,
      metadata: {
        otherSessionsRevoked: revoked.count,
        sessionRotated: true,
        resetTokensInvalidated: true,
      },
    }).catch(() => {})

    // ── SUPABASE AUTH staged-migration cutover (best-effort, audited) ───
    // Same contract as the school plane: the provider is provisioned at
    // the natural password change; failure is audited, never an app error.
    if (isSupabaseAuthEnabled()) {
      const outcome = await provisionProviderPassword({
        email: dbAdmin.email,
        newPassword: body.newPassword,
        existingAuthUserId: dbAdmin.authUserId,
      })
      const action =
        outcome.state === 'provisioned'
          ? 'platform.auth_supabase_provisioned'
          : outcome.state === 'updated'
            ? 'platform.auth_supabase_updated'
            : 'platform.auth_supabase_provision_skipped'
      let linkNote = ''
      if (outcome.state === 'provisioned' && outcome.authUserId) {
        const linked = await linkPlatformAuthUserSafe(admin.id, outcome.authUserId)
        linkNote = `; link=${linked ? 'written' : 'skipped (conflict)'}`
      }
      await platformAuditEvent({
        adminId: admin.id,
        action,
        targetType: 'AUTH',
        targetId: admin.id,
        ip,
        requestId,
        reason:
          outcome.state === 'failed'
            ? `provider provisioning failed: ${outcome.reason}`
            : `provider provisioning ${outcome.state}${linkNote}`,
      }).catch(() => {})
    }

    return {
      ok: true,
      otherSessionsSignedOut: revoked.count,
      // DEV PREVIEW ONLY — same gating as login (never in production;
      // the HttpOnly cookie is the only session transport there).
      ...(process.env.NODE_ENV !== 'production' ? { sessionToken: token } : {}),
    }
  })
}
