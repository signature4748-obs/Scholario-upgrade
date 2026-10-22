import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Svix v1 signature verification for provider webhooks (Resend).
 *
 * THE TWO KEY DERIVATIONS (live evidence 2026-10-22, PR #54's
 * rejection-evidence ledger):
 *
 *   Scheme A (legacy, string-key):  key = the UTF-8 bytes of the FULL
 *     secret string exactly as stored. This is how Scholario's route
 *     always verified, and it PROVABLY worked for the provider's events
 *     on 2026-10-11/12 (2 signature-verified email.delivered rows).
 *
 *   Scheme B (current provider stack, standardwebhooks derivation):
 *     key = base64.decode(secret minus the `whsec_` prefix) — the raw
 *     decoded bytes. This is EXACTLY what `standardwebhooks` does —
 *     the library the provider's own SDK delegates to (`new Webhook(
 *     secret).verify(...)`: svix → standardwebhooks), and therefore
 *     the derivation the provider's CURRENT dispatcher signs with.
 *
 * On 2026-10-22 the provider dispatched real events (Svix ids,
 * 3× backoff retries, all recorded in the rejection-evidence ledger)
 * that failed Scheme A against a `whsec_…` secret synced verbatim
 * from the provider's own create-webhook response — the provider
 * re-keyed its signing stack around 2026-10-12 (the same change that
 * stopped all deliveries then), and today's events are Scheme-B
 * signed. Accepting EITHER derivation keeps the route fail-closed
 * (a forged request must still defeat BOTH keys, which are both
 * derived from the same deployment-held secret) while verifying
 * events signed under either era of the provider's stack.
 *
 * The verification envelope itself is unchanged: v1 HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${rawBody}`, base64, multi-token
 * space-separated headers, 5-minute replay window, timing-safe
 * compares, fail-closed on every missing/malformed input.
 */

export const SVIX_SECRET_PREFIX = 'whsec_'

/** Replay protection window (a captured request cannot be replayed). */
export const SVIX_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

export type SvixVerification = { ok: true } | { ok: false; reason: string }

/** Both candidate HMAC keys derived from the deployment's secret. */
export function svixHmacKeys(secret: string): Buffer[] {
  const keys: Buffer[] = [Buffer.from(secret, 'utf8')]
  if (secret.startsWith(SVIX_SECRET_PREFIX)) {
    const tail = secret.slice(SVIX_SECRET_PREFIX.length)
    if (tail.length > 0) {
      // base64 decoding never throws in Node (lenient), but a bogus tail
      // can decode to zero bytes — that scheme is simply skipped.
      const decoded = Buffer.from(tail, 'base64')
      if (decoded.length > 0) keys.push(decoded)
    }
  }
  return keys
}

/**
 * Verify a Svix v1 envelope. Pure: the secret is a parameter so this is
 * unit-testable for every secret shape without touching process.env.
 * Fail-closed: missing secret/headers, malformed or stale timestamps,
 * and no matching v1 token all refuse with the honest reason.
 */
export function verifySvixEnvelope(input: {
  secret: string
  rawBody: string
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  now?: number
}): SvixVerification {
  const secret = (input.secret ?? '').trim()
  if (!secret) return { ok: false, reason: 'no signing secret configured' }
  if (!input.id || !input.timestamp || !input.signatureHeader) {
    return { ok: false, reason: 'missing svix headers' }
  }

  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'malformed timestamp' }
  const now = input.now ?? Date.now()
  const ageMs = Math.abs(now - ts * 1000)
  if (ageMs > SVIX_TIMESTAMP_TOLERANCE_MS) return { ok: false, reason: 'stale timestamp (replay)' }

  // Multiple schemes can be space-separated: "v1,AAA v1,BBB v1gpg,..." —
  // any valid v1 token accepts the request.
  const tokens = input.signatureHeader
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('v1,'))
  if (tokens.length === 0) return { ok: false, reason: 'no v1 signature token' }

  const message = `${input.id}.${input.timestamp}.${input.rawBody}`
  const expectedBuffers = svixHmacKeys(secret).map((key) =>
    Buffer.from(createHmac('sha256', key).update(message).digest('base64'), 'utf8'),
  )

  for (const token of tokens) {
    const providedBuf = Buffer.from(token.slice('v1,'.length), 'utf8')
    for (const expectedBuf of expectedBuffers) {
      if (providedBuf.length !== expectedBuf.length) continue
      if (timingSafeEqual(providedBuf, expectedBuf)) return { ok: true }
    }
  }
  return { ok: false, reason: 'signature mismatch' }
}
