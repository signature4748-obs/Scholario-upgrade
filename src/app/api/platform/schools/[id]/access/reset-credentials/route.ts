/**
 * POST /api/platform/schools/[id]/access/reset-credentials — the Super
 * Admin credential-reset path (CREDENTIAL-RESET / CRITICAL audit fix).
 *
 * What it does:
 *   · targets ONE school-plane user (body.email — must belong to THIS
 *     school, 404 otherwise: no existence oracle) or the WHOLE school
 *     user roster (bulk mode — the documented way to retire a seeded
 *     credential family in one audited action);
 *   · replaces the stored password hash with a fresh crypto-random
 *     temp password (policy-valid by construction) that is surfaced in
 *     the response EXACTLY ONCE for the operator to hand to the user;
 *   · sets mustChangePassword = true — the temp credential only ever
 *     gets the user to the forced password-setup screen (business APIs
 *     reject the session server-side until the user sets their own);
 *   · revokes every live session of the reset account(s);
 *   · audits BOTH planes: a PlatformAuditLog row (who reset what, with
 *     reason) and a school-visible ActivityLog row (the principal's
 *     feed shows a platform credential reset happened).
 *
 * Permission: schools.manage + live step-up (same policy class as
 * suspend/plan/domain mutations). Bulk mode additionally requires the
 * typed school-name confirmation (the school DELETE convention).
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { generateTempPassword } from '@/lib/account-provisioning'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { auditEvent } from '@/lib/security/audit'
import { parseJsonBody, strictBody, emailSchema, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const resetSchema = strictBody({
  /** Target account email (school-scoped). Omitted → bulk reset of the
   *  whole school-plane roster (requires confirmName). */
  email: emailSchema.optional(),
  /// Operator reason — always audited.
  reason: safeText(400).refine((r) => r.trim().length >= 10, {
    message: 'Provide a reason of at least 10 characters for the audit trail',
  }),
  /// Typed school-name confirmation — REQUIRED for bulk mode only.
  confirmName: safeText(80).optional(),
})

interface ResetRecord {
  id: string
  email: string
  name: string | null
  role: string
  tempPassword: string
  revokedSessions: number
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, resetSchema)
      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      // ── Resolve the target set (school-scoped; no cross-tenant oracle) ──
      let targets: { id: string; email: string; name: string | null; role: string }[]
      if (body.email) {
        const user = await db.user.findFirst({
          where: { email: body.email.toLowerCase(), schoolId: school.id },
          select: { id: true, email: true, name: true, role: true },
        })
        if (!user) {
          throw new AppError('RESOURCE_NOT_FOUND', {
            publicMessage: 'No account with that email belongs to this school',
          })
        }
        targets = [user]
      } else {
        // BULK — every school-plane account of THIS school. The typed
        // confirmation mirrors the school DELETE convention (the bulk
        // reset locks every user out of the tenant until credentials are
        // re-handed).
        if ((body.confirmName ?? '') !== school.name) {
          throw new AppError('INVALID_INPUT', {
            publicMessage: 'Confirmation failed — type the school name exactly to reset every credential',
            internalDetail: 'reset-credentials (bulk): typed confirmation mismatch',
          })
        }
        targets = await db.user.findMany({
          where: { schoolId: school.id, role: { not: 'SUPER_ADMIN' } },
          select: { id: true, email: true, name: true, role: true },
          orderBy: [{ role: 'asc' }, { email: 'asc' }],
        })
      }

      // ── Reset each account: fresh random credential + forced change ──
      const records: ResetRecord[] = []
      for (const t of targets) {
        const tempPassword = generateTempPassword(16)
        await db.user.update({
          where: { id: t.id },
          data: {
            passwordHash: hashPassword(tempPassword),
            // The temp credential is a single-purpose bootstrap: the
            // forced first-password-change state is re-armed so the
            // account cannot run the tenant on it.
            mustChangePassword: true,
          },
        })
        const revoked = await db.session.deleteMany({ where: { userId: t.id } })
        records.push({
          id: t.id,
          email: t.email,
          name: t.name,
          role: t.role,
          // Surfaced ONCE — never logged, never stored in plaintext.
          tempPassword,
          revokedSessions: revoked.count,
        })
      }

      const revokedTotal = records.reduce((n, r) => n + r.revokedSessions, 0)

      // ── Platform audit (the authority trail) ──────────────────────────
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.credentials_reset',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason,
        metadata: {
          mode: body.email ? 'USER' : 'SCHOOL_BULK',
          resetAccounts: records.length,
          revokedSessions: revokedTotal,
          targets: records.map((r) => ({ email: r.email, role: r.role })),
        },
      })

      // ── School-visible marker (the principal's activity feed) ────────
      await auditEvent({
        schoolId: school.id,
        action: 'PLATFORM_CREDENTIAL_RESET',
        detail: `Platform credential reset (${body.email ? 'single account' : `${records.length} account(s), whole-roster`}) — ${body.reason}`,
      }).catch(() => {})

      return {
        ok: true,
        school: { id: school.id, name: school.name },
        mode: body.email ? 'USER' : 'SCHOOL_BULK',
        resetAccounts: records.length,
        revokedSessions: revokedTotal,
        // The one-time handoff credentials. Each temp password works for
        // sign-in ONLY as far as the forced password-setup screen.
        credentials: records,
      }
    },
    { method: 'POST' },
  )
}
