/**
 * Signed file-access tokens (Phase 1 — upload security, "signed access").
 *
 * Stored documents (admission documents, teacher photo/signature) are PII.
 * Anonymous access is gone; the GET routes require either:
 *
 *   1. a valid session (cookie or Bearer — the normal authenticated app), or
 *   2. a short-lived HMAC-signed URL token, minted by an authenticated
 *      access endpoint, so that `<img src>` / `<a href>` navigation works
 *      in contexts where neither cookie nor Authorization header can ride
 *      along (the dev preview iframe; any future embed).
 *
 * The token is HMAC-SHA256(fileId | exp | scope) over a server-held
 * secret, verified with `timingSafeEqual`. It binds to ONE file id and
 * ONE scope family, expires (default 1h), and carries no session
 * credential — leaking it exposes a single document for minutes, not the
 * account.
 *
 * Secret sourcing:
 *   - FILE_SIGNING_SECRET env (production),
 *   - otherwise a random per-process secret (dev — restart invalidates).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

function getSigningSecret(): Buffer {
  const env = process.env.FILE_SIGNING_SECRET
  if (env && env.length >= 16) {
    return Buffer.from(env, 'utf8')
  }
  if (process.env.NODE_ENV === 'production') {
    // No env secret in production → per-process random (signed URLs do
    // not survive a restart; the operator sets FILE_SIGNING_SECRET for
    // continuity). Never a committed constant.
    if (!(getSigningSecret as unknown as { warned?: boolean }).warned) {
      ;(getSigningSecret as unknown as { warned?: boolean }).warned = true
      console.warn(
        '[security] FILE_SIGNING_SECRET not set — using an ephemeral per-process secret (signed URLs reset on restart).',
      )
    }
  }
  const g = globalThis as unknown as { __scholarioFileSecret?: Buffer }
  if (!g.__scholarioFileSecret) g.__scholarioFileSecret = randomBytes(32)
  return g.__scholarioFileSecret
}

export type FileScope = 'admissions' | 'teachers'

export const DEFAULT_FILE_TOKEN_TTL_SEC = 60 * 60 // 1 hour

/**
 * Mint a signed token for one file id. Format: `v1.<exp>.<hex hmac>` where
 * the HMAC covers `v1|scope|fileId|exp`.
 */
export function signFileToken(
  fileId: string,
  scope: FileScope,
  ttlSec: number = DEFAULT_FILE_TOKEN_TTL_SEC,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  const exp = now + ttlSec * 1000
  const payload = `v1|${scope}|${fileId}|${exp}`
  const mac = createHmac('sha256', getSigningSecret()).update(payload).digest('hex')
  return { token: `v1.${exp}.${mac}`, expiresAt: exp }
}

/**
 * Verify a signed token for a file id. Timing-safe; enforces scope + exp.
 */
export function verifyFileToken(
  fileId: string,
  scope: FileScope,
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  const exp = Number(parts[1])
  if (!Number.isInteger(exp) || exp <= now || exp > now + 7 * 24 * 3600 * 1000) return false
  const expected = createHmac('sha256', getSigningSecret())
    .update(`v1|${scope}|${fileId}|${exp}`)
    .digest('hex')
  const given = parts[2]
  if (!/^[a-f0-9]{64}$/i.test(given)) return false
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(given.toLowerCase(), 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
