import { db } from './db'
import { randomBytes } from 'crypto'
import { cookies, headers } from 'next/headers'

// Lightweight password hashing using Node's scrypt (no external deps)
import { scryptSync, timingSafeEqual } from 'crypto'
import { AppError } from './security/errors'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const hashBuf = Buffer.from(hash, 'hex')
  const testBuf = scryptSync(password, salt, 64)
  if (hashBuf.length !== testBuf.length) return false
  return timingSafeEqual(hashBuf, testBuf)
}

/**
 * Timing-equalizer for failed lookups: when an account does not exist we
 * still burn one scrypt round against a fixed hash, so response latency
 * cannot distinguish "no such user" from "wrong password" (anti user
 * enumeration).
 */
const DUMMY_HASH = hashPassword('scholario-timing-equalizer')
export function burnPasswordTiming(): void {
  scryptSync('invalid', DUMMY_HASH.split(':')[0], 64)
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export const SESSION_COOKIE = 'erp_session'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

/**
 * Cookie attributes — the single source of truth (tested).
 * `secure` is enforced in production so the session cookie is only ever
 * transported over HTTPS; dev/http preview keeps it functional.
 */
export function sessionCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProd,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}

/**
 * Is the cross-site-iframe BEARER fallback (login response carries the
 * session token for localStorage) enabled?
 *
 * Production: NEVER — session credentials must not reach browser
 * JavaScript (Phase-0 baseline B-4). Dev/preview: enabled unless
 * SCHOLARIO_DEV_BEARER=0, because the sandbox preview renders the app in
 * a cross-site iframe where browsers refuse the SameSite=Lax cookie.
 */
export function isDevSessionBearerEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.SCHOLARIO_DEV_BEARER !== '0'
}

export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null },
): Promise<string> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({
    data: {
      userId,
      token,
      expiresAt,
      // SS-1 — device context for Settings → Devices (nullable: older
      // sessions honestly render as "unknown device").
      userAgent: meta?.userAgent?.slice(0, 400) ?? null,
      ipAddress: meta?.ipAddress?.slice(0, 60) ?? null,
    },
  })
  await db.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  })
  return token
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } }).catch(() => {})
}

/**
 * Session ROTATION (Phase 1): replace the caller's session token with a
 * fresh random token (new expiry), keeping device metadata. Used after
 * password change so a stolen pre-rotation token dies immediately.
 */
export async function rotateSession(currentToken: string): Promise<string> {
  const old = await db.session.findUnique({ where: { token: currentToken } })
  if (!old) throw new Error('UNAUTHORIZED')
  const newToken = generateToken()
  await db.session.create({
    data: {
      userId: old.userId,
      token: newToken,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: old.userAgent,
      ipAddress: old.ipAddress,
    },
  })
  await db.session.delete({ where: { id: old.id } }).catch(() => {})
  return newToken
}

export async function setSessionCookie(token: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, sessionCookieOptions(process.env.NODE_ENV === 'production'))
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * CSRF defense-in-depth for cookie-authenticated requests (Phase 1).
 *
 * SameSite=Lax already blocks cross-site POST cookies in modern browsers.
 * This guard closes the residual gap: when authentication rides the
 * cookie (an ambient credential) and the request carries an Origin whose
 * host does not match the request Host, reject as cross-site. Bearer-
 * authenticated requests skip the check — an explicit header cannot be
 * smuggled by a cross-site page.
 *
 * Pure host comparison (exported for tests).
 */
export function isCrossOriginRequest(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false
  try {
    const originHost = new URL(origin).host
    if (!originHost) return false
    return originHost.toLowerCase() !== host.toLowerCase()
  } catch {
    // Unparseable Origin (not a URL) — treat as hostile.
    return true
  }
}

export async function getSessionToken(): Promise<string | undefined> {
  // Primary: the HttpOnly cookie (first-party tabs).
  const store = await cookies()
  const cookieToken = store.get(SESSION_COOKIE)?.value
  if (cookieToken) {
    // Ambient-credential (cookie) use → enforce same-origin for it.
    try {
      const h = await headers()
      const origin = h.get('origin')
      const host = h.get('host')
      if (isCrossOriginRequest(origin, host)) {
        throw new AppError('CSRF_REJECTED', {
          publicMessage: 'Cross-origin request rejected',
          internalDetail: `origin=${origin} host=${host}`,
        })
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      // headers() unavailable outside request scope — cookie-only mode.
    }
    return cookieToken
  }

  // Fallback: `Authorization: Bearer <token>` — DEV ONLY (see
  // isDevSessionBearerEnabled): the sandbox preview panel renders this
  // app inside a CROSS-SITE iframe; browsers refuse to store AND send
  // SameSite=Lax cookies in third-party frames, so a login that succeeds
  // server-side (200 + Set-Cookie) was followed by cookie-less 401s on
  // every subsequent call. In production this header path is hard-disabled
  // (no env override — the HttpOnly cookie is the ONLY session transport
  // in production).
  if (process.env.NODE_ENV !== 'production') {
    try {
      const h = await headers()
      const auth = h.get('authorization')
      if (auth?.startsWith('Bearer ')) {
        const bearer = auth.slice(7).trim()
        if (bearer) return bearer
      }
    } catch {
      // headers() unavailable outside request scope — cookie-only mode.
    }
  }
  return undefined
}

/** SS-1 — the caller's Session row (token never leaves the server; the
 *  id/createdAt/expiresAt/device metadata shape what Settings renders). */
export async function getCurrentSession() {
  const token = await getSessionToken()
  if (!token) return null
  const session = await db.session.findUnique({ where: { token } })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return session
}

/** SS-1 — light UA parser for the Devices list. Best-effort labels; never
 *  a fingerprint. Unknown UAs render as "Unknown device" downstream. */
export function parseUserAgent(ua: string | null | undefined): {
  browser: string
  os: string
  device: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown'
} {
  if (!ua) return { browser: 'Unknown browser', os: 'Unknown OS', device: 'Unknown' }
  const s = ua.toLowerCase()

  const device: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown' = /ipad|tablet|playbook|silk/.test(s)
    ? 'Tablet'
    : /mobi|iphone|android.*mobile|windows phone/.test(s)
      ? 'Mobile'
      : /android/.test(s)
        ? 'Tablet'
        : /windows|macintosh|mac os|cros|linux/.test(s)
          ? 'Desktop'
          : 'Unknown'

  const browser =
    /edg\//.test(s) ? 'Edge'
    : /opr\//.test(s) ? 'Opera'
    : /chrome|crios/.test(s) && !/edg\//.test(s) ? 'Chrome'
    : /firefox|fxios/.test(s) ? 'Firefox'
    : /safari/.test(s) && !/chrome/.test(s) ? 'Safari'
    : 'Unknown browser'

  const os =
    /windows/.test(s) ? 'Windows'
    : /iphone|ipad|ipod|ios/.test(s) ? 'iOS'
    : /mac os|macintosh/.test(s) ? 'macOS'
    : /android/.test(s) ? 'Android'
    : /cros/.test(s) ? 'ChromeOS'
    : /linux/.test(s) ? 'Linux'
    : 'Unknown OS'

  return { browser, os, device }
}

export type AuthUser = {
  id: string
  email: string
  name: string
  role: string
  schoolId: string | null
  avatarUrl: string | null
  phone: string | null
  status: string
  school?: {
    id: string
    name: string
    slug: string
    code: string
    themeColor: string
    accentColor: string
    logoUrl: string | null
    academicYear: string
    plan: string
    /** Tenant lifecycle status — the access-policy input (PHASE 7.5). */
    status: string
    /** FINAL-GATE — demo-tenant flag: the sanctioned signal that gates
     * illustrative client-side seed content to the showcase tenant only
     * (real production tenants must start honest-empty). */
    isDemo: boolean
  } | null
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken()
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: { include: { school: true } },
    },
  })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  const u = session.user
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? '',
    role: u.role,
    schoolId: u.schoolId,
    avatarUrl: u.avatarUrl,
    phone: u.phone,
    status: u.status,
    school: u.school
      ? {
          id: u.school.id,
          name: u.school.name,
          slug: u.school.slug,
          code: u.school.code,
          themeColor: u.school.themeColor,
          accentColor: u.school.accentColor,
          logoUrl: u.school.logoUrl,
          academicYear: u.school.academicYear ?? '',
          plan: u.school.plan,
          status: u.school.status,
          isDemo: u.school.isDemo,
        }
      : null,
  }
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

export function requireRole(user: AuthUser | null, ...roles: string[]): AuthUser {
  const u = requireUser(user)
  if (!roles.includes(u.role)) throw new Error('FORBIDDEN')
  return u
}
