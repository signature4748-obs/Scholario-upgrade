import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { burnPasswordTiming } from '@/lib/auth'
import {
  RATE_LIMITS,
  checkRateLimitStrict,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { parseJsonBody, strictBody, emailSchema } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { isCanonicalSchoolRole } from '@/lib/security/permissions'
import { issueAndEmailPasswordReset, maskedEmailDomain } from '@/lib/school/password-reset'

export const runtime = 'nodejs'

const forgotBodySchema = strictBody({ email: emailSchema })

/**
 * POST /api/auth/forgot-password — PUBLIC (no session). SCHOOL PLANE.
 *
 * SELF-SERVICE PASSWORD RECOVERY for school users (Student & Staff) —
 * docs/SCHOOL_ACCOUNT_RECOVERY.md. Mirrors the platform plane's
 * forgot-password contract (docs/PLATFORM_ACCOUNT_RECOVERY.md §1):
 *
 * ANTI-ENUMERATION CONTRACT: the response is byte-identical whether
 * the email belongs to a recoverable school account or not:
 *   { ok: true, data: { message: 'If that address belongs to a school account, a password reset link has been sent.' } }
 * Same status, same body, same latency envelope (non-eligible lookups
 * burn a scrypt round so timing cannot distinguish either).
 *
 * Eligibility mirrors what the school login can ever authenticate
 * (src/app/api/auth/login/route.ts): an ACTIVE account whose role is a
 * canonical school role (PRINCIPAL | TEACHER | STUDENT) and which is
 * bound to a school. Anything else (unknown address, inactive,
 * SUPER_ADMIN / legacy non-canonical roles, no school binding) issues
 * NOTHING and answers identically. A new request supersedes previous
 * pending tokens (single outstanding token).
 *
 * Rate limits: per-IP AND per-account buckets — both consulted before
 * any DB work; a rate-limited request reveals nothing (the limiter
 * throws the same generic RATE_LIMITED shape the login surface uses).
 *
 * Email: the shared transactional pipeline (docs/EMAIL.md — honest
 * status semantics). Delivery failures NEVER change the response; they
 * are recorded in the EmailDelivery row (provider-rejection class tags)
 * and the audit metadata carries the status VALUE only.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return api(async () => {
    const body = await parseJsonBody(req, forgotBodySchema)
    const email = body.email
    const ip = clientIpFromHeaders(req.headers)

    // ── Rate limits (both gates; strict = throw on exhaustion) ────────
    const ipVerdict = await checkRateLimitStrict(
      `rl:school-forgot:ip:${ip}`,
      RATE_LIMITS.schoolForgotPassword,
    )
    if (!ipVerdict.allowed) {
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset requests. Please try again in ${ipVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(ipVerdict.retryAfterSec) },
        internalDetail: `school forgot-password ip bucket exhausted (${ip})`,
      })
    }
    const accountVerdict = await checkRateLimitStrict(
      `rl:school-forgot:acct:${email.trim().toLowerCase()}`,
      RATE_LIMITS.schoolForgotPasswordAccount,
    )
    if (!accountVerdict.allowed) {
      // Same envelope as the IP bucket — no account existence signal.
      throw new AppError('RATE_LIMITED', {
        publicMessage: `Too many password reset requests. Please try again in ${accountVerdict.retryAfterSec}s.`,
        headers: { 'Retry-After': String(accountVerdict.retryAfterSec) },
        internalDetail: 'school forgot-password account bucket exhausted',
      })
    }

    // ── Lookup + eligibility (silent; the response NEVER depends on it) ──
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, status: true, schoolId: true },
    })
    const eligible = Boolean(
      user &&
        user.status === 'ACTIVE' &&
        isCanonicalSchoolRole(user.role) &&
        user.schoolId, // login refuses an account with no school binding — recovery must not issue either
    )

    if (user && eligible) {
      // The reset link origin: APP_URL (canonical origin, the school-app
      // production domain) or the request origin — identical pipeline to
      // the platform plane's issuance sites.
      const origin =
        (process.env.APP_URL ?? '').trim() ||
        `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? 'localhost:3000'}`
      const { issued, emailStatus } = await issueAndEmailPasswordReset(
        { id: user.id, email: user.email, name: user.name ?? '', schoolId: user.schoolId },
        { origin, requestIp: ip, userAgent: req.headers.get('user-agent'), requestId },
      )
      await auditEvent({
        schoolId: user.schoolId,
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        ip,
        requestId,
        // Counts/ids only — never the token, never the full address
        // (the audit row already binds the user).
        detail: `School password reset requested (reset ${issued.id}, expires ${issued.expiresAt.toISOString()}, email status ${emailStatus}, domain ${maskedEmailDomain(user.email)})`,
      }).catch(() => {})
    } else {
      // Timing equalizer: unknown/ineligible accounts burn one scrypt
      // round so the response envelope is indistinguishable.
      burnPasswordTiming()
      await auditEvent({
        action: 'PASSWORD_RESET_REQUESTED',
        ip,
        requestId,
        // Truth for the internal audit trail only — never the response.
        detail: 'School password reset requested — no eligible school account for the submitted address',
      }).catch(() => {})
    }

    // ── The ONE generic response (byte-identical in every branch) ─────
    return {
      message:
        'If that address belongs to a school account, a password reset link has been sent.',
    }
  })
}
