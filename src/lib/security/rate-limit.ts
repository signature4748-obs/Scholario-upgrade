/**
 * Central rate limiter (Phase 1 — brute-force protection; Phase 8A —
 * shared-database backend).
 *
 * Phase-0 baseline B-7: no rate limiting anywhere. This module is the
 * single implementation every guarded route funnels through — no
 * per-route counters, no scattered policies.
 *
 * Scope of application (see docs/SECURITY_BASELINE.md §2):
 *   login · password change · session revocation · public admission
 *   endpoints · AI generation · message sending · uploads · payment
 *   endpoints · webhooks · bulk CSV exports.
 *
 * ── Phase 8A: WHY the backend changed ────────────────────────────────────
 * Phase 1 assumed single-instance deployment (local memory, no Redis) — a
 * per-instance Map means every horizontal replica multiplies each budget by
 * the instance count. The backend is now the shared Supabase PostgreSQL
 * `RateLimitBucket` table (fixed-window counters, one row per key, written
 * ONLY through the atomic upsert below — never via the Prisma model API),
 * so every app instance enforces the same budget.
 *
 * ── Phase 8A: HOW (optimistic-local verdict + authoritative shared state) ─
 * `checkRateLimit`/`enforceRateLimit` keep their SYNCHRONOUS signatures and
 * semantics — routes and tests call them exactly as before (no `await`,
 * no route edits). Each real-time check:
 *   1. decides synchronously from this instance's bucket view — fixed-window
 *      math IDENTICAL to Phase 1 (same profiles, limits, keys, dual
 *      account+IP login buckets, rejected-attempt counting, progressive
 *      block extension, Retry-After = window remainder, 50k local-key
 *      bound), and
 *   2. fires ONE atomic upsert (fire-and-forget, never blocks, never
 *      throws) that counts the attempt in the shared row and RETURNs the
 *      authoritative (count, windowStart), which reconciles this
 *      instance's bucket — so every subsequent check here enforces the
 *      GLOBAL budget.
 *
 * Consistency boundary (documented, accepted): the check issued while a
 * reconciliation is still in flight — or the first check a fresh instance
 * sees for a key — is decided on the local view, so at most ONE request
 * per (key, instance) can overshoot the shared budget before the row is
 * adopted. For the profiles in RATE_LIMITS (8–120 events per 15s–1h) a
 * ≤1-per-instance overshoot is noise, not a breach. Strictly-synchronous
 * DB reads are impossible in JS without blocking the event loop, which a
 * request-path guard must never do.
 *
 * Deny-path abuse extension (≤2 roundtrips on DENY paths, 1 on allow):
 * the local progressive backoff is preserved verbatim (extensions 0–4,
 * decay on roll), AND sustained abuse extends the SHARED window: when a
 * denied attempt pushes the count to ≥ 2× the limit (a full extra budget
 * of rejected attempts), the background sync runs a second statement that
 * restarts the shared windowStart at now() — so a distributed hammer keeps
 * the block alive across instances, decaying only after the abuse stops.
 *
 * Fail-open policy (mission §23 — availability over protection): the
 * synchronous decision NEVER consults the DB, so backend unavailability
 * can never delay, deny, or crash a request. When the background sync
 * fails, that attempt's shared-budget update fails open — this instance
 * keeps enforcing its LOCAL budget (fail-open to shared protection,
 * fail-SAFE to zero protection: an attacker cannot DoS the database to
 * dissolve all rate limiting) — and at most ONE structured warn line per
 * minute ('rate_limit_backend_unavailable' … 'rate-limit backend
 * unavailable — failing open …') is emitted. The limiter NEVER throws a
 * DB error.
 *
 * Bounded state:
 *   - local Map: 50k keys max, oldest-first eviction (unchanged);
 *   - shared table: lazy prune (≤ once per 60s per instance — a best-effort
 *     DELETE of rows in the checked key's family, i.e. matching the first
 *     two colon segments of the key) plus the event-stream service's
 *     periodic sweep. CONTRACT for the sweeper (implemented by another
 *     agent): any row with "updatedAt" older than 2 hours is removable —
 *     every profile window is ≤ 1h, active keys get updatedAt refreshed by
 *     each upsert, and a pruned-but-still-abused key simply re-INSERTs on
 *     its next attempt.
 *
 * Hermetic modes (deterministic tests, no DB traffic): an injected `now`
 * (the Phase-1 test contract — a fake clock cannot be shared truth) or
 * NODE_ENV=test ('bun test' sets it) disables the background sync
 * entirely; RATE_LIMIT_DB_SYNC=off is the ops kill-switch.
 */
import { AppError } from './errors'
import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'

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
  /** Bulk PII CSV exports — students/fees/attendance/teachers (per-user). */
  export: { name: 'export', limit: 30, windowMs: 60 * 60_000 },
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
  // ACCOUNT-RECOVERY — anonymous public endpoints of the platform
  // forgot-password / reset-password / Google-OAuth surface.
  /** Forgot-password requests per-IP (anonymous; anti-enumeration surface). */
  platformForgotPassword: { name: 'platform-forgot-password', limit: 5, windowMs: 60 * 60_000 },
  /** Forgot-password requests per submitted account key (mail-bombing brake). */
  platformForgotPasswordAccount: { name: 'platform-forgot-password-account', limit: 3, windowMs: 60 * 60_000 },
  /** Reset-password consume attempts per-IP (token guessing brake). */
  platformResetPassword: { name: 'platform-reset-password', limit: 10, windowMs: 60 * 60_000 },
  /** Google OAuth login round-trips per-IP (same posture as platform login). */
  platformGoogleLogin: { name: 'platform-google-login', limit: 10, windowMs: 15 * 60_000 },
  // PHASE 8B — canonical payroll mutations (structure writes, payment
  // records, voids — per-user; the principal's whole salary workflow).
  salary: { name: 'salary', limit: 30, windowMs: 60 * 60_000 },
  // PHASE 7-B — school-plane teacher credential reset (per-user): the
  // principal's account-control surface on PATCH /api/teachers/[id]
  // (reset-credential rewrites a password hash + revokes sessions).
  teacherCredentialReset: { name: 'teacher-credential-reset', limit: 20, windowMs: 60 * 60_000 },
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

// ─── Phase 8A: shared-database backend ─────────────────────────────────────

interface DbBucketRow {
  count: number
  windowStart: Date
}

/** Background syncs in flight — drained by flushRateLimitDbSync(). */
const inFlight = new Set<Promise<void>>()

let lastBackendWarnAt = 0

/** Fail-open warn, rate-limited to one line per minute (never spam). */
function warnBackendUnavailable(err: unknown): void {
  const now = Date.now()
  if (now - lastBackendWarnAt < 60_000) return
  lastBackendWarnAt = now
  const e = err as { code?: string; message?: string } | null
  log('warn', 'rate_limit_backend_unavailable', {
    channel: 'rate-limit',
    detail:
      'rate-limit backend unavailable — failing open (shared-budget sync ' +
      'skipped for this attempt; per-instance budget still enforced): ' +
      String(e?.message ?? err).slice(0, 200),
    errorCode: typeof e?.code === 'string' ? e.code : undefined,
  })
}

/** Background DB sync enabled? (hermetic-test + ops kill-switch gates). */
function dbSyncEnabled(): boolean {
  if (process.env.RATE_LIMIT_DB_SYNC === 'off') return false
  if (process.env.NODE_ENV === 'test') return false // `bun test` sets this
  return true
}

/**
 * Merge the authoritative shared-row state into this instance's bucket so
 * the NEXT local decision enforces the global budget.
 *
 *   same window (dbStart === b.start) → count = max(local, shared) —
 *       keeps this instance's in-flight, not-yet-published attempts.
 *   unaligned windows → adopt the shared window as truth. If the local
 *       window had already expired, mirror the Phase-1 roll (fresh count,
 *       one abuse-extension step forgiven); otherwise keep max(local,
 *       shared) so mid-window abuse restarts / fresh-instance alignments
 *       never relax an active block.
 */
function reconcile(key: string, profile: RateLimitProfile, row: DbBucketRow): void {
  const dbStart = row.windowStart.getTime()
  const b = buckets.get(key)
  if (!b) {
    buckets.set(key, { start: dbStart, count: row.count, extensions: 0 })
    return
  }
  if (dbStart === b.start) {
    b.count = Math.max(b.count, row.count)
    return
  }
  const localExpired = Date.now() - b.start >= profile.windowMs * (1 + b.extensions)
  b.start = dbStart
  b.count = localExpired ? row.count : Math.max(b.count, row.count)
  if (localExpired) b.extensions = Math.max(0, b.extensions - 1)
}

let lastPruneAt = 0

/**
 * Lazy prune (bounded + cheap): at most once per 60s per instance, delete
 * swept-contract-expired rows (updatedAt older than 2h) that share the
 * checked key's family prefix (first two colon segments, e.g. 'rl:export:').
 * Best-effort and silent by design — the event-stream sweeper is the
 * authoritative cleanup (contract in the module header).
 */
async function maybePrune(checkedKey: string): Promise<void> {
  const now = Date.now()
  if (now - lastPruneAt < 60_000) return
  lastPruneAt = now
  try {
    const family = checkedKey.split(':').slice(0, 2).join(':') + ':%'
    await db.$executeRaw`
      DELETE FROM "RateLimitBucket"
      WHERE "key" LIKE ${family}
        AND "updatedAt" <= now() - make_interval(secs => ${7200})
    `
  } catch {
    // Prune failures are invisible — cleanup is the sweeper's job.
  }
}

/**
 * Fire-and-forget publish+reconcile for one rate-limit check (real-time
 * path only). One atomic upsert (counting this attempt in the shared
 * budget), plus — on DENY paths with clear sustained abuse — a second
 * statement extending the shared block window. Never rejects; DB errors
 * fail open via warnBackendUnavailable (see module header).
 */
function scheduleDbSync(
  key: string,
  profile: RateLimitProfile,
  opts: { abuse: boolean },
): void {
  const windowStart = new Date()
  const windowSecs = profile.windowMs / 1000
  const task = (async () => {
    // 1. Atomic single-statement upsert. NOTE: Prisma's tagged templates
    //    bind each interpolation site separately, so the windowStart value
    //    that the reference statement binds twice as $2 appears here as
    //    two parameters ($2/$4) carrying the SAME Date — semantically
    //    identical, type-safely bound.
    const rows = (await db.$queryRaw`
      INSERT INTO "RateLimitBucket"("key","count","windowStart","updatedAt")
      VALUES (${key}, 1, ${windowStart}, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" <= now() - make_interval(secs => ${windowSecs})
                       THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= now() - make_interval(secs => ${windowSecs})
                       THEN ${windowStart} ELSE "RateLimitBucket"."windowStart" END,
        "updatedAt" = now()
      RETURNING "count", "windowStart"
    `) as DbBucketRow[]
    const row = rows[0]
    if (row) reconcile(key, profile, row)
    // 2. Deny-path abuse extension: a full extra budget of rejected
    //    attempts (count ≥ 2× limit) restarts the shared window so the
    //    block outlives any single instance's view.
    if (opts.abuse) {
      await db.$executeRaw`
        UPDATE "RateLimitBucket"
        SET "windowStart" = now(), "updatedAt" = now()
        WHERE "key" = ${key} AND "count" >= ${profile.limit * 2}
      `
    }
    await maybePrune(key)
  })().catch((e: unknown) => {
    warnBackendUnavailable(e)
  })
  inFlight.add(task)
  void task.then(() => {
    inFlight.delete(task)
  })
}

/**
 * Core check. Pure counting — the caller decides what to do (throw, audit,
 * or branch). `now` is injectable for tests (an injected `now` ALSO implies
 * the hermetic path: no background DB sync, so deterministic clocks never
 * write fake windowStarts into the shared table).
 */
export function checkRateLimit(
  key: string,
  profile: RateLimitProfile,
  now?: number,
): RateLimitResult {
  pruneIfNeeded()
  const t = now ?? Date.now()
  const existing = buckets.get(key)
  const b: Bucket = existing ?? { start: t, count: 0, extensions: 0 }

  // Window rolled over → reset (extensions lengthen the effective window).
  const windowLen = profile.windowMs * (1 + b.extensions)
  if (t - b.start >= windowLen) {
    b.start = t
    b.count = 0
    b.extensions = Math.max(0, b.extensions - 1) // decay abuse history
  }

  if (b.count >= profile.limit) {
    const resetAt = b.start + windowLen
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - t) / 1000))
    // Repeated hits while blocked escalate the next window (backoff).
    if (b.count === profile.limit) b.extensions = Math.min(4, b.extensions + 1)
    b.count++ // count the rejected attempt too
    buckets.set(key, b)
    if (now === undefined && dbSyncEnabled()) {
      scheduleDbSync(key, profile, { abuse: b.count >= profile.limit * 2 })
    }
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  b.count++
  buckets.set(key, b)
  if (now === undefined && dbSyncEnabled()) {
    scheduleDbSync(key, profile, { abuse: false })
  }
  return { allowed: true, remaining: profile.limit - b.count, retryAfterSec: 0 }
}

/** Clear a bucket (e.g. successful login clears the per-account failure
 * count). Phase 8A: also deletes the shared row (fire-and-forget, never
 * throws) so the clear holds across ALL instances, not just this one. */
export function resetRateLimit(key: string) {
  buckets.delete(key)
  if (dbSyncEnabled()) {
    const task = db
      .$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`
      .then(() => undefined)
      .catch((e: unknown) => {
        warnBackendUnavailable(e)
      })
    inFlight.add(task)
    void task.then(() => {
      inFlight.delete(task)
    })
  }
}

/** Reset every bucket matching a prefix (test isolation). LOCAL-ONLY by
 * design: it must never issue a blanket DELETE against the shared table
 * (other instances / test runners own rows there too). */
export function resetAllRateLimits() {
  buckets.clear()
}

/**
 * Drain every in-flight background sync (verification scripts, graceful
 * shutdown, ops). No-op on the hermetic path.
 */
export async function flushRateLimitDbSync(): Promise<void> {
  if (inFlight.size === 0) return
  await Promise.all([...inFlight])
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

// ─── PHASE 8B (§21) — strict shared-budget gate for credential endpoints ────
//
// Serverless reality: many short-lived instances each hold a LOCAL bucket,
// so the fire-and-forget sync admits the documented ≤1-per-(key,instance)
// overshoot — a budget that scales with instance count on exactly the
// endpoints where overshoot matters (login, account lockout, MFA step-up,
// password change). For those profiles the strict gate makes the SAME
// atomic upsert the DECISION, not a background reconcile:
//
//   1. atomic increment+RETURNING (row lock serializes concurrent checks —
//      exactly `limit` of a concurrent burst pass, the rest deny);
//   2. the returned (count, windowStart) is adopted locally (reconcile);
//   3. allowed iff count ≤ limit (the count already includes this attempt);
//   4. on DB error or a 250ms timeout → BOUNDED FALLBACK to the local-only
//      decision (fail-open to shared protection, never to zero protection —
//      availability is preserved; a DB outage cannot lock out every login,
//      and the local Map still enforces per-instance budgets).
//
// Everything else (all other profiles) keeps the fire-and-forget path
// unchanged. The hermetic contract is preserved: NODE_ENV=test, an
// injected clock, or RATE_LIMIT_DB_SYNC=off degrade strict → local-only.

/** Profiles whose shared budget is enforced SYNCHRONOUSLY (credential surface). */
const STRICT_SHARED_PROFILES = new Set([
  'login',
  'login-account',
  'platform-login',
  'platform-login-account',
  'platform-step-up',
  'password-change',
])

/** Authoritative row state returned by the atomic increment. */
export interface StrictSharedRow {
  count: number
  windowStart: Date
}

/** Injectable atomic increment (tests substitute a serialized counter). */
export type SharedIncrement = (key: string, profile: RateLimitProfile) => Promise<StrictSharedRow>

const STRICT_TIMEOUT_MS = 250

const defaultSharedIncrement: SharedIncrement = async (key, profile) => {
  const windowStart = new Date()
  const windowSecs = profile.windowMs / 1000
  const rows = (await db.$queryRaw`
    INSERT INTO "RateLimitBucket"("key","count","windowStart","updatedAt")
    VALUES (${key}, 1, ${windowStart}, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" <= now() - make_interval(secs => ${windowSecs})
                     THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= now() - make_interval(secs => ${windowSecs})
                     THEN ${windowStart} ELSE "RateLimitBucket"."windowStart" END,
      "updatedAt" = now()
    RETURNING "count", "windowStart"
  `) as StrictSharedRow[]
  if (!rows[0]) throw new Error('strict rate-limit increment returned no row')
  return rows[0]
}

/** Deny-path shared-window abuse restart (extracted for both paths). */
function fireAbuseExtension(key: string, profile: RateLimitProfile): Promise<void> {
  return db
    .$executeRaw`
      UPDATE "RateLimitBucket"
      SET "windowStart" = now(), "updatedAt" = now()
      WHERE "key" = ${key} AND "count" >= ${profile.limit * 2}
    `
    .then(() => undefined)
    .catch(() => undefined)
}

/**
 * Strict variant of checkRateLimit: the shared row IS the decision for
 * credential profiles. Non-throwing (same contract as checkRateLimit).
 * `force` is a TEST-ONLY escape that reaches the shared path even under
 * the hermetic NODE_ENV=test gate (with an injected sharedIncrement).
 */
export async function checkRateLimitStrict(
  key: string,
  profile: RateLimitProfile,
  opts: {
    now?: number
    sharedIncrement?: SharedIncrement
    force?: boolean
  } = {},
): Promise<RateLimitResult> {
  // Hermetic / clock-injected / non-strict profile → the established
  // local-only decision, byte-for-byte (never overridable — `force` only
  // escapes the NODE_ENV=test DB-sync gate for injected-counter tests).
  if (opts.now !== undefined || !STRICT_SHARED_PROFILES.has(profile.name)) {
    return checkRateLimit(key, profile, opts.now)
  }
  if (!dbSyncEnabled() && !opts.force) {
    return checkRateLimit(key, profile, opts.now)
  }

  const inc = opts.sharedIncrement ?? defaultSharedIncrement
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('strict shared-budget timeout')), STRICT_TIMEOUT_MS)
    })
    let row: StrictSharedRow
    try {
      row = await Promise.race([inc(key, profile), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }

    // Adopt the authoritative state locally (same window semantics as the
    // background reconcile — including this attempt in the local count).
    reconcile(key, profile, row)
    const b = buckets.get(key)
    const extensions = b?.extensions ?? 0

    if (row.count > profile.limit) {
      if (b && row.count === profile.limit + 1) {
        b.extensions = Math.min(4, b.extensions + 1)
      }
      const windowLen = profile.windowMs * (1 + (b?.extensions ?? extensions))
      const resetAt = row.windowStart.getTime() + windowLen
      const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      void fireAbuseExtension(key, profile)
      return { allowed: false, remaining: 0, retryAfterSec }
    }
    return { allowed: true, remaining: profile.limit - row.count, retryAfterSec: 0 }
  } catch {
    // Bounded fallback: shared gate unavailable → local budget decides.
    warnBackendUnavailable(new Error('strict shared-budget read failed or timed out'))
    return checkRateLimit(key, profile)
  }
}

/** Throwing strict variant (same contract as enforceRateLimit). */
export async function enforceRateLimitStrict(
  key: string,
  profile: RateLimitProfile,
  opts: { now?: number; sharedIncrement?: SharedIncrement; force?: boolean } = {},
): Promise<RateLimitResult> {
  const result = await checkRateLimitStrict(key, profile, opts)
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', {
      publicMessage: `Too many requests. Please try again in ${result.retryAfterSec}s.`,
      headers: { 'Retry-After': String(result.retryAfterSec) },
      internalDetail: `rate-limited [strict:${profile.name}] key=${key}`,
    })
  }
  return result
}
