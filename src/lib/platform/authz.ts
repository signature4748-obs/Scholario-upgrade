/**
 * Platform authorization pipeline — PHASE 6.
 *
 * THE SEPARATE CONTROL-PLANE BOUNDARY. Mirrors the school pipeline
 * (lib/security/authz.ts) but resolves a PLATFORM identity:
 *
 *   Request
 *     → platform session          (scholario_platform_session cookie /
 *                                   x-platform-token dev header — NEVER
 *                                   the school erp_session cookie or
 *                                   Authorization bearer)
 *     → platform admin            (PlatformAdmin row, status ACTIVE)
 *     → platform permission       (root implies all; else granted rows;
 *                                   unknown keys fail closed)
 *     → step-up authentication    (recent TOTP for destructive actions)
 *     → handler                   (school ids in the URL are re-verified
 *                                   against real School rows — a school
 *                                   session can never satisfy any of the
 *                                   steps above)
 *
 * withPlatform() composes the Phase-1/4 api() envelope (safe errors,
 * request ids, structured logs) so platform routes get identical error
 * semantics to school routes.
 */

import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { patchRequestContext } from '@/lib/observability/context'
import {
  getPlatformSession,
  hasLiveStepUp,
  type PlatformAdminAuth,
  type PlatformSessionAuth,
} from './auth'
import { loadEffectivePermissions, STEP_UP_REQUIRED_HINT } from './permissions'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export interface PlatformCtx {
  admin: PlatformAdminAuth
  session: PlatformSessionAuth
  /** Effective capability set (root → all keys). */
  permissions: Set<string>
}

export interface PlatformPolicy {
  /** Required capability key (fail-closed). */
  permission?: string
  /** Require a live step-up (recent MFA) — destructive actions. */
  stepUp?: boolean
}

/** Resolve + gate a platform request. Throws AppError on any failure. */
export async function authorizePlatform(policy: PlatformPolicy = {}): Promise<PlatformCtx> {
  const auth = await getPlatformSession()
  if (!auth) {
    // A SCHOOL session never reaches this line as an identity: the
    // platform token spaces (cookie/header) are disjoint from the
    // school transports — see lib/platform/auth.ts.
    throw new AppError('AUTH_REQUIRED', {
      internalDetail: 'authorizePlatform: no valid platform session',
    })
  }

  const permissions = await loadEffectivePermissions(auth.admin.id, auth.admin.isRoot)
  if (policy.permission && !permissions.has(policy.permission)) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You do not have access to this platform resource',
      internalDetail: `authorizePlatform: admin lacks permission ${policy.permission}`,
    })
  }

  if (policy.stepUp && !hasLiveStepUp(auth.session)) {
    throw new AppError('STEP_UP_REQUIRED', {
      publicMessage: STEP_UP_REQUIRED_HINT,
      internalDetail: `authorizePlatform: step-up expired (last=${auth.session.stepUpAt?.toISOString() ?? 'never'})`,
    })
  }

  // Correlate the request with the platform identity.
  patchRequestContext({ userId: auth.admin.id })
  return { admin: auth.admin, session: auth.session, permissions }
}

/**
 * Route wrapper: `export function GET() { return withPlatform({...}, async (ctx) => ...) }`.
 * Applies a per-admin mutation rate limit for non-GET handlers.
 */
export function withPlatform(
  policy: PlatformPolicy,
  handler: (ctx: PlatformCtx) => Promise<unknown>,
  opts: { method?: string } = {},
): Promise<Response> {
  return api(async () => {
    const ctx = await authorizePlatform(policy)
    if ((opts.method ?? 'GET') !== 'GET') {
      // Abuse brake on control-plane mutations (per admin).
      enforceRateLimit(`rl:platform-mut:${ctx.admin.id}`, RATE_LIMITS.platformMutation)
    }
    return handler(ctx)
  })
}
