/**
 * Platform authentication — PHASE 6, the SEPARATE identity boundary.
 *
 * ARCHITECTURE INVARIANT (docs/PLATFORM_SECURITY_MODEL.md):
 *   The school authentication system can NEVER issue a platform session,
 *   and the platform system can NEVER issue a school session.
 *
 *   · Own credential store   — PlatformAdmin (NOT the User table; the
 *                               legacy User(role='SUPER_ADMIN') rows are
 *                               suspended and rejected by school login).
 *   · Own session store       — PlatformAdminSession (disjoint from the
 *                               school Session table).
 *   · Own cookie              — `scholario_platform_session` (HttpOnly,
 *                               SameSite=Lax; distinct name from the
 *                               school `erp_session` cookie).
 *   · Own bearer transport    — `x-platform-token` header. NEVER the
 *                               school `Authorization` header — the two
 *                               token spaces cannot be confused in either
 *                               direction. Header fallback is DEV PREVIEW
 *                               ONLY (cross-site iframe blocks cookies),
 *                               mirroring the school-side bearer pattern
 *                               (lib/auth.ts isDevSessionBearerEnabled).
 *   · Token at rest           — sha256(token). A DB leak does not yield
 *                               usable credentials (school sessions store
 *                               raw tokens — a known, documented Phase-0
 *                               baseline risk; the platform plane does
 *                               not repeat it).
 *
 * MFA: every platform login verifies a TOTP code (RFC 6238, lib/platform/totp).
 * A fresh MFA grants a 10-minute step-up window for destructive actions.
 */

import { db } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'
import { cookies, headers } from 'next/headers'
import { AppError, } from '@/lib/security/errors'
import { isCrossOriginRequest } from '@/lib/auth'

// ── Constants ─────────────────────────────────────────────────────────────

export const PLATFORM_SESSION_COOKIE = 'scholario_platform_session'
export const SUPPORT_SESSION_COOKIE = 'scholario_support'
export const PLATFORM_TOKEN_HEADER = 'x-platform-token'
export const SUPPORT_TOKEN_HEADER = 'x-support-token'

/** Platform sessions are short-lived: 4h absolute. */
export const PLATFORM_SESSION_TTL_MS = 4 * 60 * 60 * 1000
/** Destructive actions require a successful MFA within this window. */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000
/** Support sessions: minimum grant. */
export const SUPPORT_MIN_MINUTES = 5

export interface PlatformAdminAuth {
  id: string
  email: string
  name: string
  status: string
  isRoot: boolean
  isDemo: boolean
  totpSecret: string
}

export interface PlatformSessionAuth {
  id: string
  adminId: string
  stepUpAt: Date | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  userAgent: string | null
  ipAddress: string | null
}

export interface SupportSessionAuth {
  id: string
  adminId: string
  schoolId: string
  reason: string
  durationMinutes: number
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

// ── Token helpers ─────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/** Cookie attributes — HttpOnly, SameSite=Lax, Secure in production. */
export function platformCookieOptions(isProd: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProd,
    maxAge: maxAgeSeconds,
  }
}

// ── Platform sessions ─────────────────────────────────────────────────────

export async function createPlatformSession(
  adminId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null; stepUp?: boolean },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + PLATFORM_SESSION_TTL_MS)
  await db.platformAdminSession.create({
    data: {
      adminId,
      tokenHash: hashToken(token),
      // A login that verified TOTP IS a fresh MFA → step-up starts live.
      stepUpAt: meta?.stepUp ? new Date() : null,
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 400) ?? null,
      ipAddress: meta?.ipAddress?.slice(0, 60) ?? null,
    },
  })
  return { token, expiresAt }
}

export async function setPlatformSessionCookie(token: string) {
  const store = await cookies()
  store.set(
    PLATFORM_SESSION_COOKIE,
    token,
    platformCookieOptions(process.env.NODE_ENV === 'production', Math.floor(PLATFORM_SESSION_TTL_MS / 1000)),
  )
}

export async function clearPlatformSessionCookie() {
  const store = await cookies()
  store.delete(PLATFORM_SESSION_COOKIE)
}

/**
 * Raw token from the request: HttpOnly cookie first (first-party tabs,
 * with the same-origin CSRF check as the school plane), then the
 * `x-platform-token` header when the DEV bearer mode is enabled
 * (cross-site iframe preview — see lib/auth.ts for the school twin).
 */
export async function getPlatformToken(): Promise<string | undefined> {
  const store = await cookies()
  const cookieToken = store.get(PLATFORM_SESSION_COOKIE)?.value
  if (cookieToken) {
    try {
      const h = await headers()
      const origin = h.get('origin')
      const host = h.get('host')
      if (isCrossOriginRequest(origin, host)) {
        throw new AppError('CSRF_REJECTED', {
          publicMessage: 'Cross-origin request rejected',
          internalDetail: `platform cookie cross-origin: origin=${origin} host=${host}`,
        })
      }
    } catch (e) {
      if (e instanceof AppError) throw e
    }
    return cookieToken
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      const h = await headers()
      const headerToken = h.get(PLATFORM_TOKEN_HEADER)
      if (headerToken) return headerToken
    } catch {
      // headers() unavailable outside request scope.
    }
  }
  return undefined
}

/**
 * Validate the caller's platform session: live (not revoked, not
 * expired), admin ACTIVE. Expired rows are lazily deleted. Returns null
 * when unauthenticated — callers map that to AUTH_REQUIRED.
 */
export async function getPlatformSession(): Promise<{
  session: PlatformSessionAuth
  admin: PlatformAdminAuth
} | null> {
  const token = await getPlatformToken()
  if (!token) return null
  const session = await db.platformAdminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { admin: true },
  })
  if (!session) return null
  if (session.revokedAt) return null
  if (session.expiresAt < new Date()) {
    await db.platformAdminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    }).catch(() => {})
    return null
  }
  if (session.admin.status !== 'ACTIVE') return null
  return { session, admin: session.admin }
}

/** Is the session's step-up (recent MFA) still live? */
export function hasLiveStepUp(session: PlatformSessionAuth): boolean {
  return session.stepUpAt !== null && Date.now() - session.stepUpAt.getTime() <= STEP_UP_WINDOW_MS
}

/** Record a fresh step-up (TOTP re-verification) on the session. */
export async function markStepUp(sessionId: string): Promise<void> {
  await db.platformAdminSession.update({
    where: { id: sessionId },
    data: { stepUpAt: new Date() },
  })
}

export async function revokePlatformSession(sessionId: string): Promise<void> {
  await db.platformAdminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeAllPlatformSessions(adminId: string): Promise<number> {
  const res = await db.platformAdminSession.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return res.count
}

// ── Support sessions ("Access School") ────────────────────────────────────

export async function createSupportSession(opts: {
  adminId: string
  schoolId: string
  reason: string
  durationMinutes: number
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + opts.durationMinutes * 60 * 1000)
  await db.supportSession.create({
    data: {
      adminId: opts.adminId,
      schoolId: opts.schoolId,
      reason: opts.reason.slice(0, 500),
      durationMinutes: opts.durationMinutes,
      tokenHash: hashToken(token),
      expiresAt,
    },
  })
  return { token, expiresAt }
}

export async function setSupportSessionCookie(token: string, maxAgeSeconds: number) {
  const store = await cookies()
  store.set(SUPPORT_SESSION_COOKIE, token, platformCookieOptions(process.env.NODE_ENV === 'production', maxAgeSeconds))
}

export async function clearSupportSessionCookie() {
  const store = await cookies()
  store.delete(SUPPORT_SESSION_COOKIE)
}

/** Support token: cookie first (same-origin check), then dev header. */
export async function getSupportToken(): Promise<string | undefined> {
  const store = await cookies()
  const cookieToken = store.get(SUPPORT_SESSION_COOKIE)?.value
  if (cookieToken) {
    try {
      const h = await headers()
      if (isCrossOriginRequest(h.get('origin'), h.get('host'))) {
        throw new AppError('CSRF_REJECTED', {
          publicMessage: 'Cross-origin request rejected',
          internalDetail: 'support cookie cross-origin',
        })
      }
    } catch (e) {
      if (e instanceof AppError) throw e
    }
    return cookieToken
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      const h = await headers()
      const headerToken = h.get(SUPPORT_TOKEN_HEADER)
      if (headerToken) return headerToken
    } catch {
      // outside request scope
    }
  }
  return undefined
}

/**
 * Validate the support session. Expired sessions are marked revoked
 * lazily (audited as platform.support_session.expired by the caller).
 * NO platform-session fallback: the support token space is authoritative
 * for oversight endpoints.
 */
export async function getSupportSession(): Promise<{
  support: SupportSessionAuth
  school: { id: string; name: string; slug: string; status: string }
} | null> {
  const token = await getSupportToken()
  if (!token) return null
  const support = await db.supportSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { school: { select: { id: true, name: true, slug: true, status: true } } },
  })
  if (!support) return null
  if (support.revokedAt) return null
  if (support.expiresAt < new Date()) {
    // Lazily retire expired sessions (kept as rows: revocation history).
    await db.supportSession.update({
      where: { id: support.id },
      data: { revokedAt: new Date() },
    }).catch(() => {})
    return { support, school: support.school } // caller distinguishes via expiresAt
  }
  return { support, school: support.school }
}

export async function revokeSupportSession(id: string): Promise<void> {
  await db.supportSession.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
