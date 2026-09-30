/**
 * Central in-memory rate limiter (Phase 1 — brute-force protection).
 *
 * Phase-0 baseline B-7: no rate limiting anywhere. This module is the
 * single implementation every guarded route funnels through — no
 * per-route counters, no scattered policies.
 *
 * Design (given the Phase-0 constraint set — local memory, no Redis):
 *   - Fixed-window counters with a per-key retry-after.
 *   - Sliding-block: exceeding the limit blocks until the window rolls,
 *     and repeated abuse extends the block (progressive backoff).
 *   - Account-aware + IP-aware keys: login limits by IP *and* by account,
 *     so a distributed attack on one account still trips the account
 *     bucket, and a single IP spraying many accounts trips the IP bucket.
 *   - Memory-bounded: max 50k keys; surplus keys are pruned by oldest
 *     window start (amortized — no timers, safe in any runtime).
 *
 * Scope of application (see docs/SECURITY_BASELINE.md §2):
 *   login · password change · session revocation · public admission
 *   endpoints · AI generation · message sending · uploads · payment
 *   endpoints · webhooks.
 */
import { AppError } from './errors'

export interface RateLimitProfile {
  /** Human-readable policy name (audit + logs). */
  name: string
  /** Max events per window. */
  limit: number
  /** Window length (ms). */
  windowMs: number
}

/** Central policy table — the single source of truth for limits. */
export const RATE_LIMITS = {
  /** Credential endpoint: per-IP and per-account buckets (both applied). */
  login: { name: 'login', limit: 8, windowMs: 15 * 60_000 },
  /** Per-account failure lockout (stricter than the IP bucket). */
  loginAccount: { name: 'login-account', limit: 5, windowMs: 15 * 60_000 },
  /** Password change attempts per account. */
  passwordChange: { name: 'password-change', limit: 5, windowMs: 60 * 60_000 },
  /** Sensitive session management (revoke other devices). */
  sessionRevoke: { name: 'session-revoke', limit: 10, windowMs: 60 * 60_000 },
  /** Public admission inquiry form (per-IP). */
  admissionPublic: { name: 'admission-public', limit: 10, windowMs: 60 * 60_000 },
  /** Authenticated upload endpoints (per-user). */
  upload: { name: 'upload', limit: 30, windowMs: 60 * 60_000 },
  /** Public→auth'd file access token minting (per-user). */
  fileAccess: { name: 'file-access', limit: 120, windowMs: 60 * 60_000 },
  /** AI generation is expensive — strict per-user. */
  ai: { name: 'ai-generate', limit: 12, windowMs: 60 * 60_000 },
  /** Message sending (per-user; bulk sends count per recipient). */
  message: { name: 'message-send', limit: 40, windowMs: 60 * 60_000 },
  /** Payment order creation / verification (per-user). */
  payment: { name: 'payment', limit: 20, windowMs: 60 * 60_000 },
  /** Webhook receiver (per-IP; Razorpay retries legitimately). */
  webhook: { name: 'webhook', limit: 120, windowMs: 60_000 },
  /** Public school-profile reads (per-IP) — anonymous, cache-friendly page. */
  publicSchool: { name: 'public-school-profile', limit: 60, windowMs: 60_000 },
  // PHASE 6 — platform control plane (stricter: privileged surface).
  /** Platform login per-IP (password+MFA attempts). */
  platformLogin: { name: 'platform-login', limit: 10, windowMs: 15 * 60_000 },
  /** Platform login per-account lockout. */
  platformLoginAccount: { name: 'platform-login-account', limit: 5, windowMs: 15 * 60_000 },
  /** TOTP step-up attempts per admin (brake force on code guessing). */
  platformStepUp: { name: 'platform-step-up', limit: 8, windowMs: 5 * 60_000 },
  /** Control-plane mutations per admin (general abuse brake). */
  platformMutation: { name: 'platform-mutation', limit: 60, windowMs: 60_000 },
  /** Platform announcements public read (school login page, per-IP). */
  platformAnnouncementPublic: { name: 'platform-announcement-public', limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitProfile>

export interface RateLimitResult {
  allowed: boolean
  /** Remaining allowance in the current window. */
  remaining: number
  /** Seconds until the window resets (set when blocked). */
  retryAfterSec: number
}

interface Bucket {
  /** Window start (epoch ms). */
  start: number
  count: number
  /** Blocks earned by abuse: window extensions beyond the first. */
  extensions: number
}

const MAX_KEYS = 50_000
const buckets = new Map<string, Bucket>()

/** Prune oldest buckets when the map grows past the memory bound. */
function pruneIfNeeded() {
  if (buckets.size <= MAX_KEYS) return
  // Oldest-first eviction (Map preserves insertion order).
  const toDelete = buckets.size - Math.floor(MAX_KEYS / 2)
  let deleted = 0
  for (const key of buckets.keys()) {
    if (deleted >= toDelete) break
    buckets.delete(key)
    deleted++
  }
}

/**
 * Core check. Pure counting — the caller decides what to do (throw, audit,
 * or branch). `now` is injectable for tests.
 */
export function checkRateLimit(
  key: string,
  profile: RateLimitProfile,
  now: number = Date.now(),
): RateLimitResult {
  pruneIfNeeded()
  const existing = buckets.get(key)
  const b: Bucket = existing ?? { start: now, count: 0, extensions: 0 }

  // Window rolled over → reset (extensions lengthen the effective window).
  const windowLen = profile.windowMs * (1 + b.extensions)
  if (now - b.start >= windowLen) {
    b.start = now
    b.count = 0
    b.extensions = Math.max(0, b.extensions - 1) // decay abuse history
  }

  if (b.count >= profile.limit) {
    const resetAt = b.start + windowLen
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000))
    // Repeated hits while blocked escalate the next window (backoff).
    if (b.count === profile.limit) b.extensions = Math.min(4, b.extensions + 1)
    b.count++ // count the rejected attempt too
    buckets.set(key, b)
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  b.count++
  buckets.set(key, b)
  return { allowed: true, remaining: profile.limit - b.count, retryAfterSec: 0 }
}

/** Clear a bucket (e.g. successful login clears the per-account failure count). */
export function resetRateLimit(key: string) {
  buckets.delete(key)
}

/** Reset every bucket matching a prefix (test isolation). */
export function resetAllRateLimits() {
  buckets.clear()
}

/** Extract the best-effort client IP from proxy headers (single value). */
export function clientIpFromHeaders(h: Headers): string {
  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return h.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * Guard an endpoint. Throws AppError(RATE_LIMITED) with Retry-After when
 * the bucket is exhausted — `api()` maps it to HTTP 429. Returns the
 * result so callers can audit near-limit traffic.
 */
export function enforceRateLimit(
  key: string,
  profile: RateLimitProfile,
  now?: number,
): RateLimitResult {
  const result = checkRateLimit(key, profile, now)
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', {
      publicMessage: `Too many requests. Please try again in ${result.retryAfterSec}s.`,
      headers: { 'Retry-After': String(result.retryAfterSec) },
      internalDetail: `rate-limited [${profile.name}] key=${key}`,
    })
  }
  return result
}

export function loginIpKey(ip: string): string {
  return `rl:login:ip:${ip}`
}

export function loginAccountKey(normalizedEmail: string): string {
  return `rl:login:acct:${normalizedEmail}`
}
