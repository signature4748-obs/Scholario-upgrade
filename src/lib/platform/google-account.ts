/**
 * ACCOUNT-RECOVERY — Google-identity → PlatformAdmin account operations.
 *
 * The ACCOUNT-LEVEL half of Google sign-in (the route half lives in
 * src/app/api/platform/auth/google/*): resolving a VERIFIED Google
 * identity to the ONE admin account it is linked to, linking, and
 * unlinking. Pure DB + audit operations — no HTTP, no Google network —
 * so tests can drive every branch directly.
 *
 * INVARIANTS (docs/PLATFORM_ACCOUNT_RECOVERY.md):
 *   · Resolution is by googleSub ONLY (never email match): a Google
 *     identity is a linked account's key, not a claim to one.
 *   · NO account is ever created from a Google identity.
 *   · One Google identity → at most ONE PlatformAdmin (unique index;
 *     the pre-check here gives a clean typed error instead of P2002).
 *   · A Google login passes the SAME gates as a password login:
 *     admin lookup, ACTIVE status, session creation, audit. Root /
 *     permission checks are NOT login concerns — they happen per
 *     request through the unchanged withPlatform pipeline.
 */

import { db } from '@/lib/db'
import { platformAuditEvent } from './audit'
import { createPlatformSession } from './auth'

export type GoogleLoginFailure = 'NOT_LINKED' | 'SUSPENDED'

export interface GoogleLoginResult {
  ok: boolean
  failure?: GoogleLoginFailure
  adminId?: string
  token?: string
}

/**
 * Resolve a VERIFIED Google identity (sub) to its linked admin and
 * mint a platform session — the exact createPlatformSession contract
 * the password login uses (HttpOnly cookie on the caller side, 4h TTL,
 * hashed at rest). Audited as platform.login.success with
 * method:'google'.
 */
export async function googleLogin(
  sub: string,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null },
): Promise<GoogleLoginResult> {
  const admin = await db.platformAdmin.findUnique({ where: { googleSub: sub } })
  if (!admin) {
    await platformAuditEvent({
      action: 'platform.login.failed',
      targetType: 'AUTH',
      ip: meta.ip,
      requestId: meta.requestId,
      reason: 'google identity not linked to any platform admin account',
      metadata: { method: 'google' },
    }).catch(() => {})
    return { ok: false, failure: 'NOT_LINKED' }
  }
  if (admin.status !== 'ACTIVE') {
    await platformAuditEvent({
      adminId: admin.id,
      action: 'platform.login.failed',
      targetType: 'AUTH',
      targetId: admin.id,
      ip: meta.ip,
      requestId: meta.requestId,
      reason: 'google login for suspended account (generic redirect: no status disclosure)',
      metadata: { method: 'google' },
    }).catch(() => {})
    return { ok: false, failure: 'SUSPENDED' }
  }

  const { token } = await createPlatformSession(admin.id, {
    userAgent: meta.userAgent,
    ipAddress: meta.ip,
    // A Google OIDC round-trip is an authentication of the person at
    // the keyboard, but it is NOT a TOTP second factor — step-up only
    // opens through the platform's own MFA (mfa-config), exactly like
    // the stood-down password flow.
    stepUp: false,
  })
  await platformAuditEvent({
    adminId: admin.id,
    action: 'platform.login.success',
    targetType: 'AUTH',
    targetId: admin.id,
    ip: meta.ip,
    requestId: meta.requestId,
    metadata: { method: 'google', root: admin.isRoot },
  }).catch(() => {})

  return { ok: true, adminId: admin.id, token }
}

export type GoogleLinkFailure = 'ALREADY_LINKED_SELF' | 'ALREADY_LINKED_OTHER'
export type GoogleUnlinkFailure = 'LAST_CREDENTIAL'

/**
 * Explicitly link a VERIFIED Google identity to an EXISTING admin
 * account (the caller authenticated as that admin + step-up — enforced
 * by the route). Stores the MINIMUM verified identity: sub, email,
 * link timestamp.
 */
export async function linkGoogleIdentity(
  adminId: string,
  sub: string,
  email: string | null,
  meta: { ip?: string | null; requestId?: string | null } = {},
): Promise<{ ok: boolean; failure?: GoogleLinkFailure }> {
  const self = await db.platformAdmin.findUnique({ where: { id: adminId } })
  if (self?.googleSub === sub) return { ok: false, failure: 'ALREADY_LINKED_SELF' }
  const other = await db.platformAdmin.findUnique({ where: { googleSub: sub } })
  if (other && other.id !== adminId) {
    await platformAuditEvent({
      adminId,
      action: 'platform.admin.google_link_failed',
      targetType: 'ADMIN',
      targetId: adminId,
      ip: meta.ip,
      requestId: meta.requestId,
      reason: 'google identity already linked to a different platform admin',
    }).catch(() => {})
    return { ok: false, failure: 'ALREADY_LINKED_OTHER' }
  }
  await db.platformAdmin.update({
    where: { id: adminId },
    data: { googleSub: sub, googleEmail: email, googleLinkedAt: new Date() },
  })
  await platformAuditEvent({
    adminId,
    action: 'platform.admin.google_linked',
    targetType: 'ADMIN',
    targetId: adminId,
    ip: meta.ip,
    requestId: meta.requestId,
    // No sub in metadata — the linked email (already stored on the row
    // for display) is sufficient trail; audit rows stay data-minimal.
    metadata: { linkedEmail: email },
  }).catch(() => {})
  return { ok: true }
}

/**
 * Unlink the Google identity from an admin (step-up gated by the route).
 *
 * FINAL-METHOD INVARIANT (ACCOUNT SAFETY): an admin must never lose
 * their LAST usable authentication method. passwordHash is NOT NULL by
 * schema, so an unlink normally leaves the password intact — but the
 * invariant is enforced at RUNTIME too (defense in depth against
 * schema regressions, corrupted rows, or future schema changes): if
 * the admin's password is absent/blank, the Google identity IS the
 * last usable credential and the unlink is REFUSED (failure
 * 'LAST_CREDENTIAL'; wasLinked stays true — the identity IS linked,
 * which is exactly why it must be kept). Recovery paths remain: a
 * fellow admins.manage holder can reset the password by email first.
 *
 * Return contract:
 *   · nothing linked            → { ok: false, wasLinked: false }
 *   · refused (last credential) → { ok: false, wasLinked: true, failure: 'LAST_CREDENTIAL' }
 *   · unlinked                  → { ok: true,  wasLinked: true }
 */
export async function unlinkGoogleIdentity(
  adminId: string,
  meta: { ip?: string | null; requestId?: string | null; byAdminId?: string | null } = {},
): Promise<{ ok: boolean; wasLinked: boolean; failure?: GoogleUnlinkFailure }> {
  const admin = await db.platformAdmin.findUnique({ where: { id: adminId } })
  if (!admin?.googleSub) return { ok: false, wasLinked: false }
  // ── FINAL-METHOD INVARIANT ─────────────────────────────────
  // An admin must never lose their last usable authentication method.
  // passwordHash is NOT NULL by schema, but this is enforced at runtime
  // too (defense in depth against schema regressions/corrupt rows): if
  // the password is absent/blank, the Google identity is the LAST usable
  // credential and unlinking it is REFUSED (recovery flows remain: a
  // fellow admins.manage holder can reset the password by email first).
  if (!admin.passwordHash || admin.passwordHash.trim() === '') {
    await platformAuditEvent({
      adminId: meta.byAdminId ?? adminId,
      action: 'platform.recovery.refused',
      targetType: 'ADMIN',
      targetId: admin.id,
      ip: meta.ip,
      requestId: meta.requestId,
      reason: 'google unlink refused: the Google identity is the admin\u2019s final usable authentication method (no usable password)',
      metadata: { unlinkRefused: 'LAST_CREDENTIAL' },
    }).catch(() => {})
    return { ok: false, wasLinked: true, failure: 'LAST_CREDENTIAL' }
  }
  await db.platformAdmin.update({
    where: { id: adminId },
    data: { googleSub: null, googleEmail: null, googleLinkedAt: null },
  })
  await platformAuditEvent({
    adminId: meta.byAdminId ?? adminId,
    action: 'platform.admin.google_unlinked',
    targetType: 'ADMIN',
    targetId: adminId,
    ip: meta.ip,
    requestId: meta.requestId,
    reason: 'google identity unlinked',
  }).catch(() => {})
  return { ok: true, wasLinked: true }
}
