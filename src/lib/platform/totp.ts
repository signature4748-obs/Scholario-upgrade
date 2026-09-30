/**
 * RFC 6238 TOTP (Time-based One-Time Password) — PHASE 6.
 *
 * Platform authentication REQUIRES a second factor at every sign-in, and
 * again as step-up authentication before destructive control-plane
 * actions (suspend/delete school, billing changes, permission changes,
 * support sessions).
 *
 * Implementation scope: HMAC-SHA1, 6 digits, 30-second period, ±1 step
 * clock-skew window — the standard authenticator-app profile (Google
 * Authenticator, 1Password, Authy, …).
 *
 * SECURITY NOTES
 *   · `verifyTotp` is CONSTANT-DECISION and burns a comparison on
 *     mismatch (timingSafeEqual) — no early-exit code-length oracle.
 *   · Secrets are base32 (RFC 4648), stored on PlatformAdmin.totpSecret.
 *     They NEVER leave the server: the dev-preview demo-code endpoint
 *     returns a *current 30-second code*, never the secret.
 *   · Replay defense is NOT handled here — it belongs to the caller
 *     (login/step-up routes rate-limit attempts and sessions pin the
 *     last successful verification time).
 */

import { createHmac, timingSafeEqual } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decode an RFC 4648 base32 string (padding optional, case-insensitive). */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('base32: invalid character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

/** Encode bytes to base32 (no padding — secrets never need it). */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(value >>> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Generate a fresh random TOTP secret (160 bits, base32). */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return base32Encode(Buffer.from(bytes))
}

const STEP_SECONDS = 30
const DIGITS = 6
const SKEW_STEPS = 1

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // Counter is a 64-bit big-endian value; writeUint32 covers our range.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter % 0x100000000, 4)
  const mac = createHmac('sha1', secret).update(buf).digest()
  const offset = mac[mac.length - 1]! & 0x0f
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The current time-step counter (epoch seconds ÷ period). */
export function totpCounter(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

/**
 * Compute the code for a secret at a point in time. Exposed for the
 * dev-preview demo-code endpoint and integration tests ONLY — production
 * verification always goes through `verifyTotp`.
 */
export function totpAt(secret: string, nowMs: number = Date.now()): string {
  return hotp(base32Decode(secret), totpCounter(nowMs))
}

/** Seconds remaining in the current time step (UI countdowns). */
export function secondsIntoStep(nowMs: number = Date.now()): number {
  return Math.floor((nowMs / 1000) % STEP_SECONDS)
}

/**
 * Verify a 6-digit code against a secret with a ±1-step window.
 * Malformed input (wrong length / non-digits / bad secret) is a clean
 * `false` — callers map that to a generic MFA_INVALID error.
 */
export function verifyTotp(code: string, secret: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  let secretBuf: Buffer
  try {
    secretBuf = base32Decode(secret)
  } catch {
    return false
  }
  const counter = totpCounter(nowMs)
  const candidate = code // already normalized to 6 ASCII digits
  for (let skew = -SKEW_STEPS; skew <= SKEW_STEPS; skew++) {
    const expected = hotp(secretBuf, counter + skew)
    // Constant-time compare (lengths are equal: 6 chars).
    if (timingSafeEqual(Buffer.from(candidate, 'ascii'), Buffer.from(expected, 'ascii'))) {
      return true
    }
  }
  return false
}
