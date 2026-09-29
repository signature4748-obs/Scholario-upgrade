/**
 * Central error classification for every API route.
 *
 * Phase 1 — Production Security Hardening.
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
 */
import { randomUUID } from 'crypto'

/** Well-known error codes → HTTP status + safe public message. */
export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CONFLICT'
  | 'CSRF_REJECTED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL_ERROR'

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
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INVALID_INPUT: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONFLICT: 409,
  CSRF_REJECTED: 403,
  ACCOUNT_LOCKED: 429,
  INTERNAL_ERROR: 500,
}

const DEFAULT_MESSAGE: Record<AppErrorCode, string> = {
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have access to this resource',
  NOT_FOUND: 'Resource not found',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  INVALID_INPUT: 'Invalid input',
  PAYLOAD_TOO_LARGE: 'Request payload is too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file type',
  CONFLICT: 'The request conflicts with existing data',
  CSRF_REJECTED: 'Cross-origin request rejected',
  ACCOUNT_LOCKED: 'Account temporarily locked. Try again later.',
  INTERNAL_ERROR: 'Internal server error',
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
      return new AppError('NOT_FOUND', { internalDetail: `P2025: ${err.message}` })
    case 'P2003':
      return new AppError('INVALID_INPUT', {
        publicMessage: 'Related record not found',
        internalDetail: `P2003: ${err.message}`,
      })
    default:
      return new AppError('INTERNAL_ERROR', { internalDetail: `Prisma ${err.code}: ${err.message}` })
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

/** New correlation id for a request (also returned as X-Request-Id). */
export function newRequestId(): string {
  return randomUUID()
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

  // 2. Legacy sentinels (thrown all over the route layer)
  if (message === 'UNAUTHORIZED') {
    return { status: 401, code: 'UNAUTHORIZED', publicMessage: DEFAULT_MESSAGE.UNAUTHORIZED, headers, internalDetail: 'legacy sentinel', requestId }
  }
  if (message === 'FORBIDDEN' || message === 'NO_SCHOOL' || message === 'SUPER_ADMIN has no school scope') {
    return { status: 403, code: 'FORBIDDEN', publicMessage: DEFAULT_MESSAGE.FORBIDDEN, headers, internalDetail: `legacy sentinel: ${message}`, requestId }
  }
  if (message === 'NOT_FOUND') {
    return { status: 404, code: 'NOT_FOUND', publicMessage: DEFAULT_MESSAGE.NOT_FOUND, headers, internalDetail: 'legacy sentinel', requestId }
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
