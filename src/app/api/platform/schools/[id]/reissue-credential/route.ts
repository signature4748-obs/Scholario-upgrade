import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { generateTempPassword } from '@/lib/account-provisioning'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { sendPrincipalInvite, reissueInviteKey } from '@/lib/platform/principal-invite'

export const runtime = 'nodejs'

/**
 * POST /api/platform/schools/[id]/reissue-credential — recover a lost
 * one-time bootstrap credential for a school's FOUNDING principal
 * (Phase 3: school provisioning completion — mission §3D "invitation
 * failures are recoverable").
 *
 * THE CONTRACT:
 *   · Available ONLY while the founding principal's bootstrap
 *     credential is still PENDING (`mustChangePassword: true` and no
 *     `passwordChangedAt`). Once the principal has set their own
 *     password, re-issue is REFUSED — this route must never become an
 *     account-takeover primitive against an owned credential.
 *   · A re-issue generates a FRESH crypto-random one-time password
 *     (the old bootstrap value stops working immediately — its hash is
 *     replaced), keeps the forced first-password-change armed, and
 *     revokes every live school session for the principal (any session
 *     minted under the old bootstrap credential is no longer trustworthy).
 *   · The new one-time password is surfaced EXACTLY ONCE in this
 *     response (never logged, never audited, never stored in
 *     plaintext) and is re-delivered by email through the shared
 *     pipeline (a NEW logical email — re-issues are never deduped
 *     against the original invite).
 *   · Audited: `platform.school.credential_reissued` (metadata carries
 *     ids/emails and the email outcome — never the password).
 *
 * Permission: schools.manage + step-up (the same destructive-action
 * posture as suspend; the step-up gate is dormant while platform TOTP
 * is stood down and re-arms automatically when MFA returns).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, status: true },
      })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'School not found',
          internalDetail: 'reissue-credential: no such school',
        })
      }

      // The FOUNDING principal (earliest PRINCIPAL row — the same
      // resolution rule as the dossier/ledger surfaces).
      const principal = await db.user.findFirst({
        where: { schoolId: school.id, role: 'PRINCIPAL' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          mustChangePassword: true,
          passwordChangedAt: true,
        },
      })
      if (!principal) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'This school has no founding principal account to re-issue a credential for',
          internalDetail: 'reissue-credential: no PRINCIPAL row for school',
        })
      }

      // FAIL-CLOSED ownership guard: the moment the principal has ever
      // completed a password change (or the bootstrap flag is off),
      // re-issue is refused — only a still-pending BOOTSTRAP credential
      // can be re-issued, never an owned one.
      if (!principal.mustChangePassword || principal.passwordChangedAt) {
        throw new AppError('CONFLICT', {
          publicMessage:
            'The principal already owns their credential (first sign-in completed). Re-issue is only available before the one-time password is replaced — ask the principal to use the school sign-in flow instead.',
          internalDetail:
            'reissue-credential refused: credential is OWNED (mustChangePassword=false or passwordChangedAt set)',
        })
      }

      // Fresh one-time bootstrap credential (crypto-random,
      // policy-satisfying by construction). The old hash is replaced —
      // the previous bootstrap value stops working immediately — and
      // every live session minted under it is revoked in the same
      // operation (a PENDING school blocks sign-in, but a session
      // created after activation-but-before-change must not survive a
      // credential rotation).
      const tempPassword = generateTempPassword()
      const revokedSessions = await db.session.deleteMany({
        where: { userId: principal.id },
      })

      await db.user.update({
        where: { id: principal.id },
        data: {
          passwordHash: hashPassword(tempPassword),
          mustChangePassword: true,
        },
      })

      // Re-deliver by email: a NEW logical invite (unique dedupe key —
      // never deduped against the original), carrying the fresh
      // one-time password. Best-effort: a failed send is surfaced as a
      // value; the response's tempPassword remains authoritative.
      const reissuedAt = new Date()
      const invitation = await sendPrincipalInvite({
        school,
        principal,
        tempPassword,
        dedupeKey: reissueInviteKey(principal.id, reissuedAt),
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.credential_reissued',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: `re-issued the founding principal's one-time bootstrap credential for ${school.slug}`,
        metadata: {
          principalId: principal.id,
          principalEmail: principal.email,
          revokedSessions: revokedSessions.count,
          inviteState: invitation.state,
          // The password itself is NEVER in the audit row.
        },
      })

      return {
        school: { id: school.id, slug: school.slug, name: school.name },
        principal: { id: principal.id, email: principal.email, name: principal.name },
        // The NEW one-time bootstrap credential — surfaced EXACTLY ONCE
        // here (same convention as the provision response).
        tempPassword,
        mustChangePassword: true,
        revokedSessions: revokedSessions.count,
        invitation,
      }
    },
    { method: 'POST' },
  )
}
