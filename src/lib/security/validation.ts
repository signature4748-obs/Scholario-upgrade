/**
 * Central input validation strategy (Phase 1).
 *
 * Phase-0 baseline F-3: no schema validation layer existed — routes
 * hand-rolled `String(body.x || '')` coercion. This module gives every
 * externally-controlled input ONE consistent gate:
 *
 *   - `parseJsonBody(req, schema)` — size-capped JSON parsing + strict
 *     zod validation (unexpected fields rejected, enums/numbers/dates
 *     coerced and bounds-checked, malformed ids impossible).
 *   - `parseQuery(req, schema)` — same for query strings.
 *   - Shared primitives: `idSchema` (cuid-like), `emailSchema`,
 *     `passwordSchema`, `phoneSchema`, `safeText`, `dateStringSchema`,
 *     `enumSchema`.
 *
 * Validation failures throw AppError('INVALID_INPUT') → HTTP 422 with a
 * SAFE message (field-level issues, never internals).
 */
import { z } from 'zod'
import { AppError } from './errors'

/** Default request body cap — 256 KB for JSON endpoints. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024

/** Hard cap for JSON bodies anywhere (route can lower, never raise). */
export const ABSOLUTE_MAX_BODY_BYTES = 2 * 1024 * 1024

/** Format a zod failure into a compact, safe, user-facing message. */
function zodIssueMessage(issues: z.ZodIssue[]): string {
  const parts = issues.slice(0, 5).map((i) => {
    const path = i.path.length ? i.path.join('.') : 'body'
    // Only trusted, structural fields — never echo raw input values.
    return `${path}: ${i.message}`
  })
  return `Invalid input — ${parts.join('; ')}`
}

function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  if (e instanceof z.ZodError) {
    return new AppError('INVALID_INPUT', {
      publicMessage: zodIssueMessage(e.issues),
      internalDetail: `zod: ${JSON.stringify(
        e.issues.map((i) => ({ path: i.path, code: i.code })),
      ).slice(0, 500)}`,
    })
  }
  return new AppError('INVALID_INPUT', {
    publicMessage: 'Malformed request body',
    internalDetail: String(e).slice(0, 300),
  })
}

/**
 * Read + JSON.parse the request body with a hard size cap, then validate
 * with the schema. `strict` (default true) rejects unknown top-level
 * fields — "unexpected fields" are a classic smuggling vector.
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
  opts: { maxBytes?: number; strict?: boolean } = {},
): Promise<T> {
  const maxBytes = Math.min(opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES, ABSOLUTE_MAX_BODY_BYTES)

  let raw: string
  try {
    raw = await req.text()
  } catch {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Request body could not be read' })
  }

  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', {
      publicMessage: `Request body exceeds the ${Math.floor(maxBytes / 1024)} KB limit`,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Request body must be valid JSON' })
  }

  if (opts.strict !== false && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape
    if (shape) {
      const keys = Object.keys(parsed as Record<string, unknown>)
      const unknownKeys = keys.filter((k) => !(k in shape))
      if (unknownKeys.length > 0) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Unexpected field(s): ${unknownKeys.slice(0, 5).join(', ')}`,
        })
      }
    }
  }

  try {
    return schema.parse(parsed)
  } catch (e) {
    throw toAppError(e)
  }
}

/** Validate URL query parameters against a schema. */
export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  let params: URLSearchParams
  try {
    params = new URL(req.url).searchParams
  } catch {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Malformed query string' })
  }
  const obj: Record<string, string> = {}
  params.forEach((v, k) => {
    obj[k] = v
  })
  try {
    return schema.parse(obj)
  } catch (e) {
    throw toAppError(e)
  }
}

/** Validate a bare value (route param, header) against a schema. */
export function parseValue<T>(value: unknown, schema: z.ZodType<T>, label = 'value'): T {
  try {
    return schema.parse(value)
  } catch (e) {
    if (e instanceof z.ZodError) {
      const mapped = new AppError('INVALID_INPUT', {
        publicMessage: zodIssueMessage(e.issues.map((i) => ({ ...i, path: [label, ...i.path] }))),
        internalDetail: 'parseValue',
      })
      throw mapped
    }
    throw toAppError(e)
  }
}

/* ── Shared primitives ──────────────────────────────────────────────── */

/**
 * Opaque entity id: cuid (`clxxx…`), UUID, or the upload family's
 * `timestamp-hex` ids. Rejects path separators, traversal, unicode —
 * anything a malformed id could smuggle.
 */
export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'id must be alphanumeric (ids may contain - or _)')

export const cuidSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9]{20,32}$/, 'malformed id')

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('must be a valid email')

/** Login-flow password input (policy lives in auth; this is transport shape). */
export const passwordInputSchema = z.string().min(1).max(128)

/** New-password policy: 8–128 chars, at least one letter and one digit. */
export const newPasswordSchema = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(128, 'must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'must contain a letter and a number')

export const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^[+0-9()\-\s]+$/, 'must contain only digits and phone punctuation')

/** Bounded free text (no control characters). */
export function safeText(max: number, min = 1) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), 'contains control characters')
}

export function enumSchema<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values)
}

/** ISO date string → Date (rejects invalid dates, NaN, junk). */
export const dateStringSchema = z.coerce
  .date()
  .refine((d) => !Number.isNaN(d.getTime()), 'invalid date')
  .refine((d) => d.getTime() > -62135596800000 && d.getTime() < 253402300799000, 'date out of range')

/** Bounded integer. */
export function boundedInt(min: number, max: number) {
  return z.coerce.number().int().min(min).max(max)
}

/** Bounded positive amount (rupees). */
export const amountSchema = z.coerce.number().finite().min(0.01).max(10_000_000)

/** Strict object factory — the standard shape for request bodies. */
export function strictBody<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict()
}
