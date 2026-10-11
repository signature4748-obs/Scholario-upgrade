/**
 * src/lib/auth/supabase.ts — SUPABASE AUTH PHASE 1 (server-side identity
 * verification + linking helpers).
 *
 * Architecture contract (docs/AUTH_ARCHITECTURE.md §7 staged adoption, the
 * standing rule — authorization NEVER moves to the provider):
 *
 *   · Supabase Auth (GoTrue) is an IDENTITY provider only. It answers
 *     exactly one question: "who holds this verified identity?" The
 *     Scholario Postgres rows (User / PlatformAdmin) remain the identity
 *     of record, and withUser / withPlatform / RLS remain the ONLY
 *     authorization authorities.
 *   · The provider identity is linked to a canonical account through
 *     server-side flows ONLY, with proof of account ownership:
 *       1. EXCHANGE-LINK — a VERIFIED Supabase identity whose email (or
 *          phone) matches an existing account, PLUS the account's current
 *          Scholario password (scrypt-verified here). Without both, no
 *          link is written. This is the anti-takeover invariant: a
 *          squatter who signs up at the provider with a victim's email
 *          cannot verify that mailbox, and even a verified mailbox owner
 *          cannot link without the account password.
 *       2. PASSWORD-CHANGE CUTOVER — when a user naturally changes their
 *          password through /api/auth/change-password, the new password
 *          is additionally provisioned to the provider and the row is
 *          linked (no forced reset, no forced logout — the documented
 *          migration path).
 *   · NO authorization decision is ever taken from client-supplied
 *     metadata, JWT claims or request bodies: the exchange endpoints
 *     verify the access token against the provider's own /auth/v1/user
 *     endpoint (server-to-server), then resolve the canonical account
 *     from the DB by the linked pointer or the verified identifier.
 *   · The service-role key NEVER reaches the browser. This module is
 *     server-only (imported exclusively from route handlers and server
 *     libs; never from a 'use client' file).
 *
 * Testability: the provider base URL honours SUPABASE_AUTH_API_BASE so
 * integration tests can point the SAME code at a local stub identity
 * server (tests/api/supabase-auth-stub.ts) — no network, no mocks of
 * internal logic; the HTTP contract is exercised for real.
 */

import { db } from '@/lib/db'
import { verifyPassword, burnPasswordTiming } from '@/lib/auth'
import { AppError } from '@/lib/security/errors'

// ─── Feature flag ─────────────────────────────────────────────────────────

/**
 * Controlled rollout switch for the Supabase Auth path. Default OFF:
 * with the flag down, the exchange endpoints answer FEATURE_DISABLED,
 * the login doors render no Supabase card, and the custom scrypt login
 * keeps working untouched (the compatibility path is permanent until the
 * migration is proven — never a forced cutover).
 */
export function isSupabaseAuthEnabled(): boolean {
  return process.env.SCHOLARIO_SUPABASE_AUTH === 'on'
}

// ─── Provider HTTP surface (server-to-server, raw fetch) ─────────────────

function providerBase(): string {
  const override = process.env.SUPABASE_AUTH_API_BASE?.trim()
  if (override) return override.replace(/\/+$/, '')
  const url = process.env.SUPABASE_URL?.trim()
  if (!url) throw new AppError('SUPABASE_AUTH_UNCONFIGURED', { internalDetail: 'SUPABASE_URL is not set' })
  return url.replace(/\/+$/, '')
}

function apiKey(): string {
  const key = process.env.SUPABASE_ANON_KEY?.trim()
  if (!key) throw new AppError('SUPABASE_AUTH_UNCONFIGURED', { internalDetail: 'SUPABASE_ANON_KEY is not set' })
  return key
}

function serviceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) throw new AppError('SUPABASE_AUTH_UNCONFIGURED', { internalDetail: 'SUPABASE_SERVICE_ROLE_KEY is not set' })
  return key
}

/** Normalized, verified provider identity — the ONLY provider data the
 *  exchange flows trust, and only when the corresponding *_confirmed_at
 *  marker is present (an unverified email/phone NEVER links). */
export interface SupabaseVerifiedIdentity {
  id: string
  email: string | null
  emailVerified: boolean
  phone: string | null
  phoneVerified: boolean
}

interface GoTrueUserPayload {
  id?: unknown
  email?: unknown
  email_confirmed_at?: unknown
  phone?: unknown
  phone_confirmed_at?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/**
 * Verify a Supabase Auth access token SERVER-SIDE by asking the provider
 * to resolve it (GET /auth/v1/user). This is the trust boundary: the
 * client-supplied token is never decoded or trusted locally — the
 * provider's own validation decides. 401/shape mismatch → AUTH_REQUIRED.
 */
export async function verifySupabaseAccessToken(accessToken: string): Promise<SupabaseVerifiedIdentity> {
  if (!accessToken || accessToken.length > 4096) {
    throw new AppError('AUTH_REQUIRED', { internalDetail: 'supabase exchange: missing/oversized token' })
  }
  let res: Response
  try {
    res = await fetch(`${providerBase()}/auth/v1/user`, {
      headers: { apikey: apiKey(), Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
  } catch {
    throw new AppError('AUTH_PROVIDER_UNREACHABLE', {
      publicMessage: 'Could not reach the sign-in provider. Please try again.',
    })
  }
  if (res.status === 401 || res.status === 403) {
    throw new AppError('AUTH_REQUIRED', { internalDetail: 'supabase exchange: provider rejected the token' })
  }
  if (!res.ok) {
    throw new AppError('AUTH_PROVIDER_UNREACHABLE', {
      publicMessage: 'The sign-in provider returned an error. Please try again.',
      internalDetail: `supabase exchange: provider HTTP ${res.status}`,
    })
  }
  const body = (await res.json().catch(() => null)) as GoTrueUserPayload | null
  const id = str(body?.id)
  if (!body || !id) {
    throw new AppError('AUTH_REQUIRED', { internalDetail: 'supabase exchange: provider payload had no identity' })
  }
  return {
    id,
    email: str(body.email),
    emailVerified: Boolean(body.email_confirmed_at),
    phone: str(body.phone),
    phoneVerified: Boolean(body.phone_confirmed_at),
  }
}

// ─── Phone validation (E.164) ─────────────────────────────────────────────

/**
 * E.164 structural validation for phone-based OTP flows:
 *   +<country-code 1-3 digits, no leading 0><subscriber 6-12 digits>
 * Country-code validity is structural (1-3 digits, first digit 1-9 — the
 * ITU E.164 range); full numbering-plan validation stays with the
 * provider at send time. Returns the normalized E.164 string or throws
 * INVALID_INPUT.
 */
export function validateE164Phone(input: string): string {
  const raw = input.replace(/[\s()-]/g, '')
  if (!/^\+[1-9]\d{5,14}$/.test(raw)) {
    throw new AppError('INVALID_INPUT', {
      publicMessage: 'Phone number must be in international format, e.g. +919876543210',
      internalDetail: 'phone validation: not E.164',
    })
  }
  const cc = raw.slice(1, 4)
  if (!/^[1-9]\d{0,2}$/.test(cc)) {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid country code', internalDetail: 'phone validation: bad country code' })
  }
  return raw
}

// ─── Account resolution (the anti-takeover core) ──────────────────────────

/** Result of resolving a verified provider identity against the
 *  school-plane credential store. */
export type SchoolIdentityResolution =
  | { state: 'linked'; userId: string }
  | { state: 'linkable'; userId: string; requireCurrentPassword: true }
  | { state: 'none' }
  | { state: 'ambiguous-phone' }

/**
 * Resolve a VERIFIED provider identity to a school-plane User:
 *   1. by the linked pointer (authUserId) — the steady state;
 *   2. by verified email against User.email (unlinked) — linkable, but
 *      ONLY with proof of the current Scholario password;
 *   3. by verified phone against User.phone (unlinked) — linkable the
 *      same way, but only when the phone matches exactly ONE account
 *      (parents/students may share a household number → ambiguous is a
 *      safe rejection, never a guess);
 *   4. otherwise no account (an honest NO_ACCOUNT — public signup never
 *      creates an account; provisioning is the platform's job).
 */
export async function resolveSchoolIdentity(
  identity: SupabaseVerifiedIdentity,
): Promise<SchoolIdentityResolution> {
  const byPointer = identity.id
    ? await db.user.findUnique({ where: { authUserId: identity.id }, select: { id: true } })
    : null
  if (byPointer) return { state: 'linked', userId: byPointer.id }

  if (identity.email && identity.emailVerified) {
    const byEmail = await db.user.findUnique({ where: { email: identity.email }, select: { id: true, authUserId: true } })
    if (byEmail && !byEmail.authUserId) return { state: 'linkable', userId: byEmail.id, requireCurrentPassword: true }
    // An account already linked to a DIFFERENT provider identity is not
    // linkable here — the exchange rejects it as NO_ACCOUNT-safe below.
  }

  if (identity.phone && identity.phoneVerified) {
    const byPhone = await db.user.findMany({ where: { phone: identity.phone }, select: { id: true, authUserId: true } })
    const unlinked = byPhone.filter((u) => !u.authUserId)
    if (unlinked.length === 1) return { state: 'linkable', userId: unlinked[0].id, requireCurrentPassword: true }
    if (unlinked.length > 1) return { state: 'ambiguous-phone' }
  }

  return { state: 'none' }
}

/** Same resolution for the PLATFORM credential store (PlatformAdmin).
 *  Phone linking is not offered on the platform plane (admins are
 *  email-identified; the two planes keep disjoint semantics). */
export type PlatformIdentityResolution =
  | { state: 'linked'; adminId: string }
  | { state: 'linkable'; adminId: string; requireCurrentPassword: true }
  | { state: 'none' }

export async function resolvePlatformIdentity(
  identity: SupabaseVerifiedIdentity,
): Promise<PlatformIdentityResolution> {
  const byPointer = await db.platformAdmin.findUnique({ where: { authUserId: identity.id }, select: { id: true } })
  if (byPointer) return { state: 'linked', adminId: byPointer.id }

  if (identity.email && identity.emailVerified) {
    const byEmail = await db.platformAdmin.findUnique({ where: { email: identity.email }, select: { id: true, authUserId: true } })
    if (byEmail && !byEmail.authUserId) return { state: 'linkable', adminId: byEmail.id, requireCurrentPassword: true }
  }
  return { state: 'none' }
}

// ─── Linking (race-safe, server-side only) ────────────────────────────────

/** Prisma unique-constraint code for authUserId collisions. */
function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'P2002')
}

export type LinkOutcome =
  | { linked: true }
  | { linked: false; reason: 'conflict'; existingAuthUserId: string | null }

/**
 * Link a school-plane account to a provider identity. Guarded update
 * (`authUserId IS NULL`) + the UNIQUE index make concurrent first-links
 * safe: exactly one wins; the loser sees a conflict, never a takeover.
 */
export async function linkSchoolAuthUser(userId: string, authUserId: string): Promise<LinkOutcome> {
  try {
    const updated = await db.user.updateMany({
      where: { id: userId, authUserId: null },
      data: { authUserId, authLinkedAt: new Date() },
    })
    if (updated.count === 1) return { linked: true }
    const row = await db.user.findUnique({ where: { id: userId }, select: { authUserId: true } })
    return { linked: false, reason: 'conflict', existingAuthUserId: row?.authUserId ?? null }
  } catch (err) {
    if (isUniqueViolation(err)) {
      // The provider identity is already mapped to another account — the
      // UNIQUE index is the last line of defense.
      const squatter = await db.user.findUnique({ where: { authUserId }, select: { id: true } })
      return { linked: false, reason: 'conflict', existingAuthUserId: squatter ? 'other-account' : null }
    }
    throw err
  }
}

/** Platform-plane twin of linkSchoolAuthUser. */
export async function linkPlatformAdminAuthUser(adminId: string, authUserId: string): Promise<LinkOutcome> {
  try {
    const updated = await db.platformAdmin.updateMany({
      where: { id: adminId, authUserId: null },
      data: { authUserId, authLinkedAt: new Date() },
    })
    if (updated.count === 1) return { linked: true }
    return { linked: false, reason: 'conflict', existingAuthUserId: 'unknown' }
  } catch (err) {
    if (isUniqueViolation(err)) return { linked: false, reason: 'conflict', existingAuthUserId: 'other-account' }
    throw err
  }
}

/**
 * Ownership proof for the first-link flow: verify the account's CURRENT
 * Scholario password (scrypt, timing-safe) — the same verifier the
 * custom login uses. Anti-enumeration timing is preserved by the caller.
 */
export async function proveSchoolPasswordOwnership(userId: string, currentPassword: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!user?.passwordHash) {
    burnPasswordTiming()
    return false
  }
  return verifyPassword(currentPassword, user.passwordHash)
}

export async function provePlatformPasswordOwnership(adminId: string, currentPassword: string): Promise<boolean> {
  const admin = await db.platformAdmin.findUnique({ where: { id: adminId }, select: { passwordHash: true } })
  if (!admin?.passwordHash) {
    burnPasswordTiming()
    return false
  }
  return verifyPassword(currentPassword, admin.passwordHash)
}

// ─── Provider provisioning (the password-change cutover, best-effort) ─────

export type ProvisionOutcome =
  | { state: 'provisioned'; authUserId: string }
  | { state: 'updated'; authUserId: string }
  | { state: 'skipped'; reason: string }
  | { state: 'failed'; reason: string }

interface AdminUserPayload { id?: unknown }

/**
 * Provision (or update) the provider-side credential for an account that
 * just changed its password through the app — the §7.3 "cutover on next
 * password change" path. SERVER-ONLY, service-role, best-effort: the app
 * password change is already authoritative; a provider failure is
 * audited, never surfaced as an app error, and the account simply stays
 * unlinked until the next attempt or the exchange-link flow.
 *
 * `existingAuthUserId` (when the row is already linked) → UPDATE the
 * provider password. Otherwise CREATE; if the email already has a
 * provider account we do NOT guess or take it over — the account links
 * through the verified exchange flow instead.
 */
export async function provisionProviderPassword(input: {
  email: string
  newPassword: string
  existingAuthUserId?: string | null
}): Promise<ProvisionOutcome> {
  const base = providerBase()
  const headers = { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' }
  try {
    if (input.existingAuthUserId) {
      const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(input.existingAuthUserId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ password: input.newPassword }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { state: 'failed', reason: `provider update HTTP ${res.status}` }
      return { state: 'updated', authUserId: input.existingAuthUserId }
    }
    const res = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: input.email,
        password: input.newPassword,
        // NOT auto-confirmed: the provider email verification stays the
        // provider's own flow. The app-side ownership proof (current
        // password) is what authorises the link when the user first
        // signs in through the provider.
        email_confirm: false,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json().catch(() => null)) as AdminUserPayload | { message?: string; msg?: string; error_code?: string } | null
    if (res.status === 201 || res.status === 200) {
      const id = str((body as AdminUserPayload | null)?.id)
      if (id) return { state: 'provisioned', authUserId: id }
      return { state: 'failed', reason: 'provider create returned no id' }
    }
    // 422 "already registered" → the email has a provider account that
    // is NOT linked here; never take it over blindly.
    const msg =
      typeof body === 'object' && body !== null
        ? String((body as { message?: string; msg?: string }).message ?? (body as { msg?: string }).msg ?? '')
        : ''
    if (/already|registered|exists/i.test(msg) || res.status === 422) {
      return { state: 'skipped', reason: 'provider account exists for this email — link via the exchange flow' }
    }
    return { state: 'failed', reason: `provider create HTTP ${res.status} ${msg.slice(0, 120)}` }
  } catch (err) {
    return { state: 'failed', reason: `provider unreachable (${(err as Error).name})` }
  }
}
