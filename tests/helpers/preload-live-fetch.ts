/**
 * preload-live-fetch — GLOBAL transport-resilience preload for bun test
 * runs (2026-10-26, combined-battery zero-unexplained-failures gate).
 *
 * WHY THIS EXISTS: the combined battery runs EVERY suite in ONE bun
 * process against a supervised `next dev` server. On any memory-bounded
 * host the dev server occasionally exits mid-battery (Next.js memory
 * guard, or a host-level OOM kill of the worker) and the supervisor
 * respawns it within seconds — a RESTART WINDOW. Suites still using
 * plain fetch die in that window: in-flight requests reset, the next
 * requests refuse, beforeAll fixtures crash, and whole suites cascade
 * red with transport errors that say NOTHING about the product. The
 * repo's established per-suite rail for this is tests/helpers/live-http.ts
 * (liveFetch, converted suite-by-suite since 2026-10-11; fee-gateway got
 * liveWriteFetch in PR #59 for its NON-idempotent writes); the remaining
 * ~30 live-HTTP suites are still on plain fetch, which is exactly what
 * the local 4GB-host batteries keep hitting (86 ConnectionRefused + 2
 * ECONNRESET + 2 second-order + 1 abandoned-socket-hang failures in the
 * 2026-10-26 run — every one transport-class, zero product defects).
 *
 * This preload factors the rail's READ-side contract to the ROOT of the
 * test runtime via bunfig.toml `[test] preload`, so every suite gets
 * restart-window resilience without per-file edits and without touching
 * a single assertion:
 *
 *   · NEVER-DELIVERED (ECONNREFUSED / "Unable to connect" / EAI_AGAIN /
 *     ENOTFOUND — the connection never formed, so the server never saw
 *     the request): retried for ANY method, exactly like a read. This is
 *     the dominant failure class of a restart window and is provably
 *     safe: an unaccepted connection cannot have side effects.
 *   · AMBIGUOUS (ECONNRESET / ECONNABORTED / EPIPE / "socket connection
 *     was closed" / "socket hang up" / bun's aggregate "fetch failed"
 *     that is not provably refused / per-attempt timeout on an abandoned
 *     socket): the request MAY have been delivered and processed.
 *     Retried ONLY for idempotent methods (GET / HEAD / OPTIONS); every
 *     other method RETHROWS the original error immediately — fail-closed
 *     against double-writes, STRICTER than the per-suite liveFetch rail
 *     (which blind-retries these for the suites it was reviewed with).
 *   · DETERMINISTIC (any HTTP response, any status; any non-transient
 *     error): returned / thrown exactly once. Product errors stay
 *     visible.
 *
 * ELIGIBILITY (origin-scoped — the wrapper NEVER changes behavior for
 * anything that is not the live dev server): it engages ONLY for URLs
 * whose origin is one of the documented live-server bases —
 * TENANT_TEST_BASE / API_TEST_BASE / LIVE_BASE / E2E_BASE_URL, default
 * http://localhost:3000 (the CI dev server). Deliberate dead-port probes
 * (e.g. supabase-auth-linking's http://127.0.0.1:1), external hosts and
 * every other origin pass through UNWRAPPED.
 *
 * BUDGETS: 20s wall-clock deadline (< every suite's 30s+ per-test
 * timeout and bun's 45s CLI timeout, so the TEST's budget stays the
 * binding ceiling), 8s per-attempt timeout (cuts abandoned sockets),
 * 300ms→3s capped backoff, 40-attempt cap. The FINAL attempt's error is
 * rethrown unchanged — a genuinely dead server still fails honestly.
 *
 * STREAM-BODY GUARD: a retry must be able to re-send the body. Only
 * re-issuable bodies (string / ArrayBuffer / TypedArray / Blob /
 * URLSearchParams / null / undefined) are retried; ReadableStream bodies
 * and Request objects carrying a body RETHROW immediately (fail-closed).
 *
 * KILL SWITCH: SCHOLARIO_LIVE_FETCH_PRELOAD=off skips installation
 * entirely (documented escape hatch for isolating transport behavior).
 *
 * Mock-friendliness: suites that assign their own global.fetch (e.g.
 * tests/unit/live-http-write.test.ts) REPLACE the wrapper wholesale —
 * the wrapper only wraps the fetch that existed at preload time and
 * never re-grabs globalThis.fetch afterwards.
 */

// ── error classification (shared vocabulary with live-http.ts) ──────────

export type TransportClass = 'never-delivered' | 'ambiguous' | 'deterministic'

export function classifyTransportError(err: unknown): TransportClass {
  if (!(err instanceof Error)) return 'deterministic'
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const msg = err.message ?? ''
  if (
    code === 'ECONNREFUSED' ||
    /unable to connect/i.test(msg) ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND'
  ) {
    return 'never-delivered'
  }
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'EPIPE' ||
    /socket connection was closed/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /fetch failed/i.test(msg) // bun aggregate wrapper — not provably refused → ambiguous
  ) {
    return 'ambiguous'
  }
  return 'deterministic'
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ── re-issuable body guard ──────────────────────────────────────────────

function bodyIsReIssuable(body: unknown): boolean {
  if (body == null) return true
  return (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    typeof Blob !== 'undefined' && body instanceof Blob ||
    typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams
  )
}

// ── eligible origins ────────────────────────────────────────────────────

export function eligibleOrigins(): Set<string> {
  const bases = [
    process.env.TENANT_TEST_BASE,
    process.env.API_TEST_BASE,
    process.env.LIVE_BASE,
    process.env.E2E_BASE_URL,
    'http://localhost:3000', // the documented CI/dev default
  ]
  const origins = new Set<string>()
  for (const b of bases) {
    if (!b) continue
    try {
      origins.add(new URL(b.replace(/\/$/, '')).origin)
    } catch {
      // malformed env value — ignore, never throw from a preload
    }
  }
  return origins
}

// ── the wrapper (exported for unit tests; installed below) ─────────────

export interface LiveFetchPreloadOpts {
  deadlineMs?: number
  perAttemptMs?: number
  maxAttempts?: number
  /** Override the eligible origins (tests inject their own). */
  origins?: Set<string>
}

export function createLiveFetch(
  originalFetch: typeof fetch,
  opts: LiveFetchPreloadOpts = {},
): typeof fetch {
  const deadlineMs = Math.max(1, opts.deadlineMs ?? 20_000)
  const perAttemptMs = Math.max(1, opts.perAttemptMs ?? 8_000)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 40)
  const origins = opts.origins ?? eligibleOrigins()
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Resolve URL + method WITHOUT constructing a second Request (a
    // Request with a body must never be re-wrapped — stream hazard).
    let url = ''
    let method = 'GET'
    let retryableInput = true
    try {
      if (input instanceof Request) {
        url = input.url
        method = (init?.method ?? input.method ?? 'GET').toUpperCase()
        // A Request carrying a body cannot be re-issued (its stream is
        // single-use): fail closed on any transport error instead.
        if (input.body != null) retryableInput = false
      } else {
        url = String(input)
        method = (init?.method ?? 'GET').toUpperCase()
      }
    } catch {
      // Cannot even resolve the request — pass straight through.
      return originalFetch(input as never, init as never)
    }

    // Eligibility: only the live dev-server origins are protected.
    let eligible = false
    try {
      eligible = origins.has(new URL(url).origin)
    } catch {
      eligible = false // non-URL input (Request with relative URL etc.) — passthrough
    }
    if (!eligible) return originalFetch(input as never, init as never)

    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null)
    const idempotent = IDEMPOTENT_METHODS.has(method)
    const bodyReIssuable =
      retryableInput &&
      (input instanceof Request || bodyIsReIssuable(init?.body))
    const startedAt = Date.now()

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Per-attempt timeout: cuts ABANDONED sockets (accepted by a server
      // that then dies and never answers). Combined with any caller signal.
      const timeoutSignal = AbortSignal.timeout(perAttemptMs)
      const signal = callerSignal
        ? AbortSignal.any([callerSignal as AbortSignal, timeoutSignal])
        : timeoutSignal

      try {
        const effectiveInit =
          input instanceof Request ? (init ? { ...init, signal } : { signal }) : { ...init, signal }
        return await originalFetch(input as never, effectiveInit as never)
      } catch (err) {
        const abortedByCaller = (callerSignal as AbortSignal | null)?.aborted === true
        if (abortedByCaller) throw err // caller cancelled: never retry
        const timedOut = timeoutSignal.aborted === true
        const cls = timedOut ? 'ambiguous' : classifyTransportError(err)
        const elapsed = Date.now() - startedAt

        // Stop conditions: deterministic failure, non-idempotent method on
        // an AMBIGUOUS failure, non-reissuable body, budget exhausted.
        const mayRetry =
          cls === 'never-delivered' ? true : cls === 'ambiguous' ? idempotent : false
        if (!mayRetry || !bodyReIssuable || elapsed >= deadlineMs || attempt === maxAttempts) {
          throw err
        }

        const backoffMs = Math.min(3_000, 300 * 2 ** (attempt - 1))
        console.warn(
          `[live-fetch-preload] attempt ${attempt} ${method} ${url} failed ` +
            `(${cls}${timedOut ? ` > ${perAttemptMs}ms abandoned socket` : ''}) after ` +
            `${elapsed}ms of a ${deadlineMs}ms budget — retrying in ${backoffMs}ms: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
        await sleep(backoffMs)
      }
    }
    // Unreachable: the loop returns or throws.
    throw new Error(`[live-fetch-preload] exhausted attempts for ${method} ${url}`)
  }) as typeof fetch

  return wrapped
}

// ── installation (idempotent; runs when preloaded by bunfig.toml) ───────

declare global {
  var __scholarioLiveFetchPreload: {
    version: string
    origins: string[]
    wrappedAt: string
  } | undefined
}

export function installLiveFetchPreload(): void {
  if (process.env.SCHOLARIO_LIVE_FETCH_PRELOAD === 'off') return
  if (globalThis.__scholarioLiveFetchPreload) return // already installed
  const original = globalThis.fetch.bind(globalThis)
  globalThis.fetch = createLiveFetch(original as typeof fetch)
  globalThis.__scholarioLiveFetchPreload = {
    version: '1.0.0',
    origins: [...eligibleOrigins()],
    wrappedAt: new Date().toISOString(),
  }
}

installLiveFetchPreload()
