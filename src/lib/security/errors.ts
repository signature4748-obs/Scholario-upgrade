/**
 * Central error classification for every API route.
 *
 * Phase 1 — Production Security Hardening (envelope, sanitization).
 * Phase 4 — Observability: canonical diagnostic taxonomy.
 *
 * Problem being fixed (Phase-0 baseline B-10 / F-2):
 * the old `api()` wrapper surfaced raw `Error.message` strings to clients
 * and mapped every non-401/403/404 error to HTTP 400. Internal messages
 * (Prisma errors, filesystem paths, implementation details) could reach
 * users.
 *
 * This module owns the classification; `src/lib/api.ts` owns the response
 * envelope. Routes keep throwing `Error('human message')` for deliberate
 * user-facing messages — the classifier decides what is safe to surface.
 *
 * ── Canonical error-code taxonomy (Phase 4) ────────────────────────────
 *
 *   AUTH_REQUIRED            401  no active session / inactive account
 *   FORBIDDEN                403  authenticated, role/permission denied
 *   TENANT_MISMATCH          403  INTERNAL classification for cross-tenant
 *                                 attempts. NOTE (Phase-2 invariant): by-id
 *                                 lookups of foreign-tenant rows return
 *                                 RESOURCE_NOT_FOUND — never a 403 with
 *                                 distinction — so TENANT_MISMATCH appears
 *                                 in audit events and server logs, NOT in
 *                                 client envelopes (no existence oracle).
 *   VALIDATION_FAILED        422  schema/shape validation (parseJsonBody,
 *                                 parseQuery — zod paths)
 *   INVALID_INPUT            422  domain input validation (route/business
 *                                 rules) — synonym of VALIDATION_FAILED
 *   RESOURCE_NOT_FOUND       404  requested resource does not exist (or
 *                                 exists in another tenant — fail-safe)
 *   RATE_LIMITED             429  rate limiter
 *   ACCOUNT_LOCKED           429  auth lockout
 *   PAYLOAD_TOO_LARGE        413
 *   UNSUPPORTED_MEDIA_TYPE   415
 *   CONFLICT                 409  uniqueness / state conflicts (P2002 …)
 *                                 — generic default for all P2002 sites
 *   ROOM_CONFLICT            409  PHASE 8 §2(A) — timetable publish: the
 *                                 payload schedules the same ROOM twice at
 *                                 one (day, period)
 *   TEACHER_CONFLICT         409  PHASE 8 §2(A) — timetable publish: the
 *                                 payload schedules the same TEACHER twice
 *                                 at one (day, period)
 *   CLASS_CONFLICT           409  PHASE 8 §2(A) — timetable publish: the
 *                                 payload schedules the same CLASS twice at
 *                                 one (day, period)
 *   CSRF_REJECTED            403  origin check
 *   DATABASE_FAILURE         500  Prisma/DB engine failures (internal)
 *   EXTERNAL_SERVICE_FAILURE 503  upstream dependency failure (AI gateway,
 *                                 payment gateway fetches …)
 *   INTERNAL_ERROR           500  everything unclassified
 *
 * `UNAUTHORIZED` and `NOT_FOUND` remain in the union as DEPRECATED
 * aliases (legacy typed throws still compile); new code uses the canonical
 * names. Legacy sentinels classify to the canonical codes.
 */
import { newRequestId } from '@/lib/observability/http'

export { newRequestId }

/** Well-known error codes → HTTP status + safe public message. */
export type AppErrorCode =
  // canonical (Phase 4)
  | 'AUTH_REQUIRED'
  | 'TENANT_MISMATCH'
  | 'VALIDATION_FAILED'
  | 'RESOURCE_NOT_FOUND'
  | 'DATABASE_FAILURE'
  | 'EXTERNAL_SERVICE_FAILURE'
  // working set (Phase 1 — still canonical for their semantics)
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CONFLICT'
  | 'CSRF_REJECTED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL_ERROR'
  // PHASE 6 — platform control plane
  | 'MFA_REQUIRED' // 401 — platform login: authenticator code missing
  | 'MFA_INVALID' // 401 — platform login/step-up: bad authenticator code
  | 'MFA_NOT_ENABLED' // 403 — platform MFA policy is currently OFF (Part 1 reset)
  | 'STEP_UP_REQUIRED' // 403 — destructive action needs recent MFA
  | 'SCHOOL_SUSPENDED' // 403 — school tenant suspended by the platform
  | 'FEATURE_DISABLED' // 403 — module disabled by platform/school flags
  | 'SUBSCRIPTION_REQUIRED' // 403 — ACCOUNT-level subscription lock (Phase 10):
                             // the account authenticates and may read its
                             // identity surfaces, but protected module APIs
                             // reject it server-side.
  | 'PASSWORD_CHANGE_REQUIRED' // 403 — CREDENTIAL-RESET: the account
                             // authenticates (login succeeds) but has not
                             // yet established its own password
                             // (mustChangePassword). Business APIs reject
                             // the session until /api/auth/change-password
                             // completes; the exempt identity surface
                             // (auth/profile/subscription/support) stays
                             // reachable so the forced-change screen works.
  // PHASE 8 §2(A) — timetable publish domain conflict codes. Same 409
  // semantics as the generic CONFLICT, but STABLE and machine-readable per
  // dimension, so clients (and regression tests) can tell WHICH unique
  // fired. Only the timetable publish route throws these; every other
  // P2002 site keeps the generic 'CONFLICT' (the classifyPrisma default).
  | 'ROOM_CONFLICT'
  | 'TEACHER_CONFLICT'
  | 'CLASS_CONFLICT'
  // FEE-ADMISSIONS MVP — stable machine-readable 409 codes (same
  // semantics as the timetable conflict codes: distinct failure causes,
  // deterministic client behavior).
  | 'FEE_CONFIGURATION_REQUIRED' // 409 — no applicable published fee structure (fail-closed quote)
  | 'SESSION_NOT_SET' // 409 — school has no canonical academic year configured
  | 'IDEMPOTENCY_KEY_REUSED' // 409 — same clientRequestId with a different payload
  | 'INVALID_STATE' // 409 — illegal admission state transition (incl. terminal REJECTED)
  | 'ADMISSION_SEQUENCE_EXHAUSTED' // 409 — ADM-NNNNNN sequence hit 999999
  | 'ADMISSION_NUMBER_COLLISION' // 409 — bounded collision-retry loop failed
  | 'EMAIL_TAKEN' // 409 — login email already exists (User.email global unique)
  | 'CREDENTIAL_EXPIRED' // 401 — bootstrap credential expired; request a new one
  // deprecated aliases (legacy typed throws; classify to themselves)
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  /** Safe, user-facing message (never internals). */
  readonly publicMessage: string
  /** Extra response headers (e.g. Retry-After for rate limits). */
  readonly headers?: Record<string, string>
  /** Internal detail — server log only, never the response. */
  readonly internalDetail?: string

  constructor(
    code: AppErrorCode,
    opts: {
      publicMessage?: string
      headers?: Record<string, string>
      internalDetail?: string
    } = {},
  ) {
    super(opts.publicMessage ?? code)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.publicMessage = opts.publicMessage ?? DEFAULT_MESSAGE[code]
    this.headers = opts.headers
    this.internalDetail = opts.internalDetail
  }
}

export const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  AUTH_REQUIRED: 401,
  UNAUTHORIZED: 401, // deprecated alias
  FORBIDDEN: 403,
  TENANT_MISMATCH: 403,
  CSRF_REJECTED: 403,
  RESOURCE_NOT_FOUND: 404,
  NOT_FOUND: 404, // deprecated alias
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 429,
  VALIDATION_FAILED: 422,
  INVALID_INPUT: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONFLICT: 409,
  ROOM_CONFLICT: 409,
  TEACHER_CONFLICT: 409,
  CLASS_CONFLICT: 409,
  FEE_CONFIGURATION_REQUIRED: 409,
  SESSION_NOT_SET: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_STATE: 409,
  ADMISSION_SEQUENCE_EXHAUSTED: 409,
  ADMISSION_NUMBER_COLLISION: 409,
  EMAIL_TAKEN: 409,
  CREDENTIAL_EXPIRED: 401,
  DATABASE_FAILURE: 500,
  INTERNAL_ERROR: 500,
  EXTERNAL_SERVICE_FAILURE: 503,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  MFA_NOT_ENABLED: 403,
  STEP_UP_REQUIRED: 403,
  SCHOOL_SUSPENDED: 403,
  FEATURE_DISABLED: 403,
  SUBSCRIPTION_REQUIRED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
}

const DEFAULT_MESSAGE: Record<AppErrorCode, string> = {
  AUTH_REQUIRED: 'Authentication required',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have access to this resource',
  TENANT_MISMATCH: 'You do not have access to this resource',
  CSRF_REJECTED: 'Cross-origin request rejected',
  RESOURCE_NOT_FOUND: 'Resource not found',
  NOT_FOUND: 'Resource not found',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  ACCOUNT_LOCKED: 'Account temporarily locked. Try again later.',
  VALIDATION_FAILED: 'Invalid input',
  INVALID_INPUT: 'Invalid input',
  PAYLOAD_TOO_LARGE: 'Request payload is too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file type',
  CONFLICT: 'The request conflicts with existing data',
  ROOM_CONFLICT: 'That room is already booked at this day and period. Resolve the overlap before publishing.',
  TEACHER_CONFLICT:
    'That teacher is already booked at this day and period. Resolve the overlap before publishing.',
  CLASS_CONFLICT: 'That class already has a slot at this day and period. Resolve the overlap before publishing.',
  FEE_CONFIGURATION_REQUIRED:
    'No published fee structure applies to this class and academic year. Publish a fee structure before issuing admission fees.',
  SESSION_NOT_SET:
    "Your school's academic year is not configured. Set it in Settings before using server-issued admissions.",
  IDEMPOTENCY_KEY_REUSED:
    'This submission reference was already used for a different application.',
  INVALID_STATE: 'This action is not allowed for the application in its current state.',
  ADMISSION_SEQUENCE_EXHAUSTED:
    'Admission numbers are exhausted for this school (maximum ADM-999999). Contact support.',
  ADMISSION_NUMBER_COLLISION:
    'Could not allocate a free admission number. Please retry; if it persists, contact support.',
  EMAIL_TAKEN: 'This email address is already in use.',
  CREDENTIAL_EXPIRED:
    'This sign-in credential has expired. Ask your school office to issue a new one.',
  DATABASE_FAILURE: 'Internal server error',
  INTERNAL_ERROR: 'Internal server error',
  EXTERNAL_SERVICE_FAILURE: 'An external service is temporarily unavailable',
  SUBSCRIPTION_REQUIRED:
    'Your SCHOLARIO subscription needs renewal. Business modules are locked until the subscription is renewed. Please contact SCHOLARIO support.',
  PASSWORD_CHANGE_REQUIRED:
    'You must set your own password before using Scholario. Sign-in succeeded — finish setting your new password to unlock your school workspace.',
  MFA_REQUIRED: 'Enter your authenticator code',
  MFA_INVALID: 'Invalid authenticator code',
  MFA_NOT_ENABLED: 'Platform multi-factor authentication is currently disabled',
  STEP_UP_REQUIRED: 'This action requires recent multi-factor verification',
  SCHOOL_SUSPENDED: "Your school's Scholario access is currently suspended",
  FEATURE_DISABLED: 'This module is currently disabled',
}

/** Heuristics that mark an error message as UNSAFE for client exposure. */
const UNSAFE_MESSAGE_PATTERNS: RegExp[] = [
  /\/home\/|\/usr\/|\/var\/|\/tmp\//i, // absolute filesystem paths
  /prisma/i,
  /sqlite|database file|table \w+ has no column/i,
  /invalid \w+ invocation/i, // Prisma: "Invalid `prisma.x.findMany()` invocation"
  /\bat\s+.*\(/i, // stack-frame-like " at fn (file:1:2)"
  /\\n|\\r/, // embedded control chars (stack traces)
  /relation ".+" does not exist/i,
  /unique constraint/i,
  /foreign key/i,
  /connect ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
  /ENOENT|EACCES|EPERM\b/i,
  /secret|token|passwordhash|credential/i,
]

/** Is this message safe to show to an end user? */
export function isSafeClientMessage(message: string): boolean {
  if (!message || message.length > 300) return false
  for (const p of UNSAFE_MESSAGE_PATTERNS) {
    if (p.test(message)) return false
  }
  return true
}

/** Prisma error codes → safe mapping. */
function classifyPrisma(e: unknown): AppError | null {
  const err = e as { code?: string; clientVersion?: string; message?: string }
  if (!err || typeof err.code !== 'string' || !err.code.startsWith('P')) return null
  switch (err.code) {
    case 'P2002':
      return new AppError('CONFLICT', {
        publicMessage: 'This record already exists',
        internalDetail: `P2002: ${err.message}`,
      })
    case 'P2025':
      return new AppError('RESOURCE_NOT_FOUND', { internalDetail: `P2025: ${err.message}` })
    case 'P2003':
      return new AppError('INVALID_INPUT', {
        publicMessage: 'Related record not found',
        internalDetail: `P2003: ${err.message}`,
      })
    default:
      // Phase 4: DB engine failures carry the diagnostic DATABASE_FAILURE
      // code (envelope stays generic — internals never reach the client).
      return new AppError('DATABASE_FAILURE', {
        internalDetail: `Prisma ${err.code}: ${err.message}`,
      })
  }
}

export interface ClassifiedError {
  status: number
  code: string
  publicMessage: string
  headers?: Record<string, string>
  internalDetail: string
  requestId: string
}

/**
 * Classify ANY thrown value into a safe client response + internal detail.
 * Order:
 *   1. AppError (typed security layer)
 *   2. Legacy sentinel strings ('UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND')
 *   3. Prisma engine errors
 *   4. Plain Error with a SAFE human message (route-authored UX copy)
 *   5. Everything else → 500 INTERNAL_ERROR (message stays in the server log)
 */
export function classifyError(e: unknown, requestId: string): ClassifiedError {
  const headers: Record<string, string> = { 'X-Request-Id': requestId }

  // 1. Typed security errors
  if (e instanceof AppError) {
    return {
      status: e.status,
      code: e.code,
      publicMessage: e.publicMessage,
      headers: e.headers ? { ...headers, ...e.headers } : headers,
      internalDetail: e.internalDetail ?? `[AppError ${e.code}]`,
      requestId,
    }
  }

  const message = e instanceof Error ? e.message : String(e)

  // 2. Legacy sentinels (thrown all over the route layer) — classify to the
  //    canonical Phase-4 codes.
  if (message === 'UNAUTHORIZED') {
    return { status: 401, code: 'AUTH_REQUIRED', publicMessage: DEFAULT_MESSAGE.AUTH_REQUIRED, headers, internalDetail: 'legacy sentinel', requestId }
  }
  if (message === 'FORBIDDEN' || message === 'NO_SCHOOL' || message === 'SUPER_ADMIN has no school scope') {
    return { status: 403, code: 'FORBIDDEN', publicMessage: DEFAULT_MESSAGE.FORBIDDEN, headers, internalDetail: `legacy sentinel: ${message}`, requestId }
  }
  if (message === 'NOT_FOUND') {
    return { status: 404, code: 'RESOURCE_NOT_FOUND', publicMessage: DEFAULT_MESSAGE.RESOURCE_NOT_FOUND, headers, internalDetail: 'legacy sentinel', requestId }
  }

  // 3. Prisma engine errors — never surface raw
  const prisma = classifyPrisma(e)
  if (prisma) {
    return {
      status: prisma.status,
      code: prisma.code,
      publicMessage: prisma.publicMessage,
      headers,
      internalDetail: prisma.internalDetail ?? 'prisma error',
      requestId,
    }
  }

  // 4. Route-authored human messages — surface only if provably safe
  if (e instanceof Error && isSafeClientMessage(message)) {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      publicMessage: message,
      headers,
      internalDetail: `route message: ${message}`,
      requestId,
    }
  }

  // 5. Unknown / unsafe — 500, generic message, details only in the log
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    publicMessage: DEFAULT_MESSAGE.INTERNAL_ERROR,
    headers,
    internalDetail: message.slice(0, 500),
    requestId,
  }
}
