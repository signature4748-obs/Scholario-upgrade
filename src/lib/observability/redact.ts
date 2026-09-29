/**
 * Value redaction for structured logs (Phase 4 — item 2).
 *
 * POLICY: logs may contain request correlation fields (requestId, userId,
 * schoolId, route, operation, duration, status, errorCode) but must NEVER
 * contain passwords, tokens, session identifiers, signatures or other
 * credentials — even if a caller accidentally passes them.
 *
 * `redact()` is the single sanitizer every log line flows through:
 *   - keys matching the sensitive vocabulary are replaced with [REDACTED]
 *   - over-long strings are truncated (log-line hygiene)
 *   - object depth and array width are capped
 *
 * This is a best-effort structural redactor: it cannot understand arbitrary
 * serialized payloads, so callers must still follow the audit rule —
 * never pass PII (names, phones, addresses, raw webhook bodies) into log
 * fields when an id or enum conveys the same fact.
 */

/** Keys whose VALUES must never reach a log line. */
const SENSITIVE_KEY_RE =
  /pass(word|wd)?|secret|token|authorization|cookie|credential|api[-_]?key|private[-_]?key|signature|otp|cvv|salt|hash|session|refresh|access[-_]?key|rawpayload|rawbody|pa_?token/i

/** Cap for any single string value inside a log field. */
const MAX_STRING = 2000
/** Max object depth walked by the redactor. */
const MAX_DEPTH = 4
/** Max array items inspected (rest summarized as a count). */
const MAX_ARRAY = 50

function truncate(s: string): string {
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[truncated ${s.length - MAX_STRING}]` : s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    // JSON has no NaN/Infinity — degrade those to strings, keep finite
    // numbers as numbers (dashboards filter on real numeric fields).
    return Number.isFinite(value) ? value : String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (value instanceof Error) {
    // Errors: keep name + (already length-capped) message; drop the stack
    // (stack frames contain filesystem paths).
    return { name: value.name, message: truncate(value.message) }
  }
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[max-depth]'
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1))
    if (value.length > MAX_ARRAY) head.push(`[+${value.length - MAX_ARRAY} more]`)
    return head
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redactValue(v, depth + 1)
    }
    return out
  }
  // Maps, Sets, exotic objects → opaque marker (never stringify blindly).
  return '[unloggable]'
}

/** Sanitize an arbitrary structured field set for logging. */
export function redact<T extends Record<string, unknown>>(fields: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redactValue(v, 0)
  }
  return out
}

/** Redact a single string detail (defense-in-depth for message fields). */
export function redactDetail(detail: string, cap = 400): string {
  return truncate(
    detail
      .replace(/\b([A-Fa-f0-9]{64,})\b/g, '[redacted-token]') // session tokens / HMACs
      .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted-key]') // service keys
      .replace(/\b(password|secret|token|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]'),
  ).slice(0, cap + 64)
}

export const REDACTED = '[REDACTED]'
