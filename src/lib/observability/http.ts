/**
 * Request-id utilities (Phase 4 — item 1).
 *
 * - `newRequestId()` — UUID v4 (crypto). The Phase-1 helper lived in
 *   security/errors.ts; it moved here so middleware, the logger and the
 *   error classifier share ONE definition (errors.ts re-exports for
 *   compatibility).
 * - `sanitizeRequestId()` — a client MAY pass X-Request-Id for correlation;
 *   it is accepted ONLY when it is a short opaque token. Anything else
 *   (log-injection attempts, giant strings, control characters) is dropped
 *   and a fresh id is minted. Request ids appear in log lines — they must
 *   never become an injection channel.
 */
import { randomUUID } from 'crypto'

/** Fresh correlation id. */
export function newRequestId(): string {
  return randomUUID()
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9:_\-]{8,128}$/

/**
 * Accept a client-supplied correlation id only if it is a short, opaque,
 * print-safe token. Returns null otherwise.
 */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (!raw) return null
  return SAFE_REQUEST_ID.test(raw) ? raw : null
}
