import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { hashPassword } from '@/lib/auth'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { auditEvent } from '@/lib/security/audit'
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/students/[id]/reset-credential — the VERIFIED recovery flow
 * for a lost one-time bootstrap credential (FEE-ADMISSIONS MVP, Phase D).
 *
 * Semantics:
 *   · PRINCIPAL-only, tenant-scoped (fail-safe 404) — the principal is
 *     the verified authority inside the school; no email-dependent
 *     identity proof is needed for the MVP.
 *   · Only affects accounts that have NOT established their own
 *     password (mustChangePassword = true): accounts that DID change
 *     their password use the normal change-password flow, and this
 *     endpoint refuses to reset them (no silent credential override).
 *   · Issues a NEW one-time expiring bootstrap credential (48h), forces
 *     first-password-change again, and surfaces the new credential
 *     exactly ONCE on THIS response (never persisted, never logged).
 *   · Rate-limited per IP (the shared strict budget) to deter
 *     bulk-credential minting.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params

      // Rate limit (principal-plane abuse guard — per-user, same
      // posture as the teacher credential-reset surface).
      const verdict = checkRateLimit(
        `rl:student-cred-reset:${user.id}`,
        RATE_LIMITS.studentCredentialReset,
      )
      if (!verdict.allowed) {
        throw new AppError('RATE_LIMITED', {
          publicMessage: 'Too many credential resets. Please try again later.',
          headers: { 'Retry-After': String(verdict.retryAfterSec) },
          internalDetail: 'reset-credential: rate limited',
        })
      }

      const student = await db.student.findFirst({
        where: { id, schoolId },
        include: { user: { select: { id: true, email: true, mustChangePassword: true, passwordChangedAt: true } } },
      })
      if (!student || !student.user) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Student not found',
          internalDetail: 'reset-credential: student missing or foreign tenant',
        })
      }
      const account = student.user
      if (!account.mustChangePassword || account.passwordChangedAt) {
        throw new AppError('INVALID_INPUT', {
          publicMessage:
            'This account has already set its own password. Use the normal sign-in and change-password flow instead.',
          internalDetail: 'reset-credential: account is not in bootstrap state',
        })
      }

      // New one-time expiring bootstrap credential.
      const { password } = resolveProvisionedPassword(undefined)
      const credentialExpiresAt = new Date(Date.now() + 48 * 3600 * 1000)
      await db.user.update({
        where: { id: account.id },
        data: {
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          credentialExpiresAt,
        },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'CREDENTIAL_RESET',
        requestId: newRequestId(),
        detail: `Bootstrap credential reissued for student account (${account.email}, admission no ${student.admissionNo ?? '—'}) — expiring one-time credential`,
      }).catch(() => undefined)

      return {
        studentId: student.id,
        loginEmail: account.email,
        admissionNo: student.admissionNo,
        credentialExpiresAt,
        tempPassword: password,
      }
    },
    { roles: ['PRINCIPAL'] },
  )
}
