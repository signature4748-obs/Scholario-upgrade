/**
 * PHASE 4 (item 10) — UNIT tests: the canonical error taxonomy.
 *
 * Pure-function scope: NO database, NO HTTP. (Complements the Phase-1
 * tests/security/errors.test.ts with the Phase-4 additions: the full
 * STATUS_BY_CODE table, canonical code classification, Prisma code
 * mapping incl. DATABASE_FAILURE, and EXTERNAL_SERVICE_FAILURE.)
 *
 * Contract under test (src/lib/security/errors.ts):
 *   · every AppErrorCode maps to its documented HTTP status
 *   · canonical Phase-4 codes: AUTH_REQUIRED/TENANT_MISMATCH/
 *     VALIDATION_FAILED/RESOURCE_NOT_FOUND/DATABASE_FAILURE/
 *     EXTERNAL_SERVICE_FAILURE
 *   · legacy sentinels classify to canonical codes (never leak the legacy
 *     spelling to clients)
 *   · P2002→CONFLICT (safe message + internal detail retained),
 *     P2025→RESOURCE_NOT_FOUND, P2003→INVALID_INPUT, every other
 *     P-code→DATABASE_FAILURE 500
 */
import { describe, test, expect } from 'bun:test'
import {
  AppError,
  classifyError,
  STATUS_BY_CODE,
  type AppErrorCode,
} from '@/lib/security/errors'

// ── 1. the full taxonomy table ───────────────────────────────────────────

describe('STATUS_BY_CODE · every code maps to its documented status', () => {
  const EXPECTED: Record<AppErrorCode, number> = {
    AUTH_REQUIRED: 401,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    TENANT_MISMATCH: 403,
    CSRF_REJECTED: 403,
    RESOURCE_NOT_FOUND: 404,
    NOT_FOUND: 404,
    VALIDATION_FAILED: 422,
    INVALID_INPUT: 422,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    ACCOUNT_LOCKED: 429,
    DATABASE_FAILURE: 500,
    INTERNAL_ERROR: 500,
    EXTERNAL_SERVICE_FAILURE: 503,
    // PHASE 6 — platform control plane codes.
    MFA_REQUIRED: 401,
    MFA_INVALID: 401,
    STEP_UP_REQUIRED: 403,
    SCHOOL_SUSPENDED: 403,
    FEATURE_DISABLED: 403,
  }

  test('the table is exactly the documented taxonomy (no stray/missing codes)', () => {
    expect(Object.keys(STATUS_BY_CODE).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  test('every code carries its documented HTTP status', () => {
    for (const [code, status] of Object.entries(EXPECTED)) {
      expect(STATUS_BY_CODE[code as AppErrorCode]).toBe(status)
    }
  })

  test('AppError instances resolve status + default public message from the table', () => {
    for (const [code, status] of Object.entries(EXPECTED)) {
      const e = new AppError(code as AppErrorCode)
      expect(e.status).toBe(status)
      expect(e.publicMessage.length).toBeGreaterThan(0)
    }
  })

  test('deprecated aliases share their canonical status but are distinct codes', () => {
    expect(STATUS_BY_CODE.UNAUTHORIZED).toBe(STATUS_BY_CODE.AUTH_REQUIRED) // 401
    expect(STATUS_BY_CODE.NOT_FOUND).toBe(STATUS_BY_CODE.RESOURCE_NOT_FOUND) // 404
  })
})

// ── 2. canonical Phase-4 codes ───────────────────────────────────────────

describe('canonical Phase-4 AppError shapes', () => {
  test('AUTH_REQUIRED → 401 with generic message', () => {
    const c = classifyError(new AppError('AUTH_REQUIRED'), 'r-1')
    expect(c.status).toBe(401)
    expect(c.code).toBe('AUTH_REQUIRED')
    expect(c.publicMessage).toBe('Authentication required')
  })

  test('TENANT_MISMATCH → 403 (internal-only classification)', () => {
    const e = new AppError('TENANT_MISMATCH', { internalDetail: 'school A vs B' })
    const c = classifyError(e, 'r-2')
    expect(c.status).toBe(403)
    expect(c.code).toBe('TENANT_MISMATCH')
    // classification detail is internal — the public message stays generic
    expect(c.publicMessage).not.toContain('school A')
  })

  test('VALIDATION_FAILED → 422', () => {
    const c = classifyError(new AppError('VALIDATION_FAILED', { publicMessage: 'Expected string, got number' }), 'r-3')
    expect(c.status).toBe(422)
    expect(c.code).toBe('VALIDATION_FAILED')
    expect(c.publicMessage).toBe('Expected string, got number')
  })

  test('DATABASE_FAILURE → 500, generic public message, detail internal', () => {
    const c = classifyError(
      new AppError('DATABASE_FAILURE', { internalDetail: 'Prisma P1001: database unreachable' }),
      'r-4',
    )
    expect(c.status).toBe(500)
    expect(c.code).toBe('DATABASE_FAILURE')
    expect(c.publicMessage).toBe('Internal server error')
    expect(c.internalDetail).toContain('P1001')
  })

  test('EXTERNAL_SERVICE_FAILURE → 503 with safe message', () => {
    const e = new AppError('EXTERNAL_SERVICE_FAILURE', {
      internalDetail: 'ECONNREFUSED ai-gateway:443',
    })
    const c = classifyError(e, 'r-5')
    expect(c.status).toBe(503)
    expect(c.code).toBe('EXTERNAL_SERVICE_FAILURE')
    expect(c.publicMessage).toBe('An external service is temporarily unavailable')
    // internals never reach the client envelope
    expect(c.publicMessage).not.toContain('ECONNREFUSED')
    expect(c.internalDetail).toContain('ECONNREFUSED')
  })

  test('RATE_LIMITED carries Retry-After through headers', () => {
    const c = classifyError(
      new AppError('RATE_LIMITED', { headers: { 'Retry-After': '77' } }),
      'r-6',
    )
    expect(c.status).toBe(429)
    expect(c.headers?.['Retry-After']).toBe('77')
    expect(c.headers?.['X-Request-Id']).toBe('r-6') // correlation header always merged
  })
})

// ── 3. legacy sentinels classify to canonical codes ──────────────────────

describe('classifyError · legacy sentinels → canonical codes', () => {
  test("'UNAUTHORIZED' throw → 401 AUTH_REQUIRED (canonical code in the envelope)", () => {
    const c = classifyError(new Error('UNAUTHORIZED'), 's-1')
    expect(c.status).toBe(401)
    expect(c.code).toBe('AUTH_REQUIRED')
  })

  test("'FORBIDDEN' throw → 403 FORBIDDEN", () => {
    const c = classifyError(new Error('FORBIDDEN'), 's-2')
    expect(c.status).toBe(403)
    expect(c.code).toBe('FORBIDDEN')
  })

  test("'NO_SCHOOL' throw → 403 FORBIDDEN", () => {
    const c = classifyError(new Error('NO_SCHOOL'), 's-3')
    expect(c.status).toBe(403)
    expect(c.code).toBe('FORBIDDEN')
  })

  test("'SUPER_ADMIN has no school scope' throw → 403 FORBIDDEN", () => {
    const c = classifyError(new Error('SUPER_ADMIN has no school scope'), 's-4')
    expect(c.status).toBe(403)
    expect(c.code).toBe('FORBIDDEN')
  })

  test("'NOT_FOUND' throw → 404 RESOURCE_NOT_FOUND (canonical code)", () => {
    const c = classifyError(new Error('NOT_FOUND'), 's-5')
    expect(c.status).toBe(404)
    expect(c.code).toBe('RESOURCE_NOT_FOUND')
  })

  test('no legacy spelling ever reaches the public message', () => {
    for (const sentinel of ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'NO_SCHOOL']) {
      const c = classifyError(new Error(sentinel), 's-x')
      expect(c.publicMessage).not.toBe(sentinel)
    }
  })
})

// ── 4. Prisma engine error mapping ───────────────────────────────────────

describe('classifyError · Prisma code mapping', () => {
  const prisma = (code: string, message: string) =>
    Object.assign(new Error(message), { code, clientVersion: '6.11.1' })

  test('P2002 → 409 CONFLICT, safe public message, P2002 retained internally', () => {
    const c = classifyError(prisma('P2002', 'Unique constraint failed on the fields: (`schoolId`,`receiptNo`)'), 'p-1')
    expect(c.status).toBe(409)
    expect(c.code).toBe('CONFLICT')
    expect(c.publicMessage).toBe('This record already exists')
    expect(c.internalDetail).toContain('P2002')
    expect(c.publicMessage).not.toContain('Unique constraint')
  })

  test('P2025 → 404 RESOURCE_NOT_FOUND', () => {
    const c = classifyError(prisma('P2025', 'An operation failed because it depends on one or more records that were required but not found'), 'p-2')
    expect(c.status).toBe(404)
    expect(c.code).toBe('RESOURCE_NOT_FOUND')
  })

  test('P2003 → 422 INVALID_INPUT (FK violation as related-record-missing)', () => {
    const c = classifyError(prisma('P2003', 'Foreign key constraint failed on the field: `studentId`'), 'p-3')
    expect(c.status).toBe(422)
    expect(c.code).toBe('INVALID_INPUT')
    expect(c.publicMessage).toBe('Related record not found')
  })

  test('unknown P-codes (P1001/P2010/P2024…) → 500 DATABASE_FAILURE', () => {
    for (const code of ['P1001', 'P1017', 'P2010', 'P2024', 'P5000']) {
      const c = classifyError(prisma(code, 'engine level failure detail'), 'p-4')
      expect(c.status).toBe(500)
      expect(c.code).toBe('DATABASE_FAILURE')
      expect(c.publicMessage).toBe('Internal server error') // generic envelope
      expect(c.internalDetail).toContain(code) // diagnostics stay server-side
    }
  })

  test('non-P "codes" are not treated as Prisma errors', () => {
    // an Error with a code that is not P-prefixed falls through to the
    // plain-Error path, not the Prisma path
    const c = classifyError(Object.assign(new Error('ENOENT file gone'), { code: 'ENOENT' }), 'p-5')
    expect(c.code).not.toBe('DATABASE_FAILURE')
    expect(c.status).toBe(500) // filesystem path → unsafe message → generic 500
  })
})

// ── 5. fallback ladder tail ──────────────────────────────────────────────

describe('classifyError · fallback ladder', () => {
  test('plain Error with safe message → 400 BAD_REQUEST with the message', () => {
    const c = classifyError(new Error('Class is required'), 'f-1')
    expect(c.status).toBe(400)
    expect(c.code).toBe('BAD_REQUEST')
    expect(c.publicMessage).toBe('Class is required')
  })

  test('plain Error with unsafe message → 500 INTERNAL_ERROR, message stays internal', () => {
    const c = classifyError(new Error('PrismaClient failed at /home/z/x.ts'), 'f-2')
    expect(c.status).toBe(500)
    expect(c.code).toBe('INTERNAL_ERROR')
    expect(c.publicMessage).toBe('Internal server error')
    expect(c.internalDetail).toContain('PrismaClient')
  })

  test('non-Error throwables collapse to a safe 500', () => {
    const c = classifyError('just a string', 'f-3')
    expect(c.status).toBe(500)
    expect(c.code).toBe('INTERNAL_ERROR')
  })

  test('every classification carries the requestId + X-Request-Id header', () => {
    for (const e of [new AppError('CONFLICT'), new Error('NOT_FOUND'), 'string', null]) {
      const c = classifyError(e, 'corr-999')
      expect(c.requestId).toBe('corr-999')
      expect(c.headers?.['X-Request-Id']).toBe('corr-999')
    }
  })
})
