import { createHash } from 'crypto'

/**
 * canonical-payload — FEE-ADMISSIONS MVP idempotency fingerprint.
 *
 * The submission idempotency contract (H1-R2 §3):
 *   · Same (schoolId, clientRequestId) + SAME canonical payload →
 *     replay: return the existing application.
 *   · Same key + DIFFERENT canonical payload → 409
 *     IDEMPOTENCY_KEY_REUSED.
 *   · The comparison must NEVER depend on JSON key ordering or
 *     client-side incidental fields.
 *
 * Canonicalization: recursively sort object keys, drop null/undefined
 * values (absent ≡ null in the form contract), preserve arrays in
 * ORDER (array order is semantic), then stable-stringify and sha256.
 */

/** Recursively canonicalize a JSON value: sorted keys, no nullish. */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = canonicalize((value as Record<string, unknown>)[key])
      if (v !== undefined) out[key] = v
    }
    return out
  }
  // strings are trimmed — trailing whitespace is never semantic on a form
  if (typeof value === 'string') return value.trim()
  return value
}

/** Stable stringify (canonical form already has sorted keys). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

/** Canonical JSON string of a submission payload. */
export function canonicalPayloadJson(payload: unknown): string {
  return stableStringify(canonicalize(payload))
}

/** sha256 hex of the canonical payload — the persisted fingerprint. */
export function canonicalPayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalPayloadJson(payload)).digest('hex')
}
