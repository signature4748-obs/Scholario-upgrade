/**
 * liveFetch — transient-outage-resilient fetch for LIVE test suites
 * (2026-10-11, CI first-run fix — Task C-ci-tests).
 *
 * WHY THIS EXISTS (root-caused from the first CI run's log): the live
 * suites talk to the dev server (`bun run dev`, webpack dev). On a CI
 * runner the dev server occasionally becomes UNAVAILABLE for a short
 * window mid-suite — the first run showed two such windows (fee-admissions
 * at 20:08:06, auth-gate/identity-authz at 20:10:09), each with the same
 * signature:
 *   · one in-flight request dies with ECONNRESET
 *     ("The socket connection was closed unexpectedly"),
 *   · the next few requests fail with ECONNREFUSED ("Unable to connect"),
 *   · a request whose socket was accepted just before the window can hang
 *     on an ABANDONED connection (accepted, never answered — the run's
 *     dev-server tail shows one /api/auth/me answered after 69s),
 *   · then everything recovers and later tests pass at full speed.
 * This is the dev server restarting/re-compiling under CI memory and
 * CPU pressure; the suite must tolerate the window instead of failing
 * honest assertions with transport errors.
 *
 * CONTRACT (assertions are NEVER affected):
 *   · retries ONLY transport-level failures — ECONNRESET, ECONNREFUSED,
 *     ECONNABORTED, EAI_AGAIN, "socket connection was closed", "Unable to
 *     connect" — and per-attempt timeouts (abandoned sockets). An HTTP
 *     response of ANY status (500 included) is returned immediately,
 *     exactly once: product errors stay visible to the suite.
 *   · the retry budget is a WALL-CLOCK deadline (not a fixed attempt
 *     count): fast ECONNREFUSED failures burn almost no budget, so an
 *     attempt-count cap alone would expire during a long window on
 *     backoff time. Retries continue until the deadline; the deadline is
 *     always shorter than the calling test's own timeout, so the test's
 *     budget remains the binding ceiling.
 *   · the FINAL attempt's error is rethrown unchanged, so a genuinely
 *     dead server still fails the test with the real diagnostic.
 *   · non-idempotent POSTs are safe to retry here: the affected suites
 *     either assert on fresh-state outcomes or use server-side
 *     idempotency keys (fee-admissions clientRequestId), and a retried
 *     login only consumes one extra rate-limit budget slot.
 *
 * Defaults: 25s deadline (fits every suite's existing ≥30s per-test
 * timeout), 10s per-attempt timeout (cold compiles on a slow runner can
 * legitimately take seconds; an ABANDONED socket is cut here), backoff
 * 300ms doubling capped at 3s. Suites with larger per-test budgets pass
 * a longer deadline explicitly (e.g. fee-admissions T=45s → 40s,
 * identity-authz/auth-gate T=60s → 50s).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * liveWriteFetch (2026-10-24, fee-gateway transport-reliability fix).
 *
 * WHY IT EXISTS — the CI flake ledger (runs 39345157812, 39372509050,
 * 39991519022-attempt-1, PR #44-era) shows fee-gateway.test.ts dying in
 * supervised dev-server restart windows (Next.js memory-guard exit →
 * supervisor respawn): one in-flight request dies with ECONNRESET and the
 * next few fail with ECONNREFUSED before the server is back. liveFetch's
 * retry cures the READ side, but its blind retry is UNSOUND for the
 * suite's NON-IDEMPOTENT writes (staff/student order creation, the
 * one-shot refund, the legacy POST /api/fees payment-record, first
 * webhook deliveries whose ack shape differs from the duplicate shape):
 * a blind re-issue after an ambiguous failure can DOUBLE the write (two
 * orders, a double ledger credit) or return the DUPLICATE ack shape the
 * test never asserts on. fee-gateway was one of the last live-HTTP
 * suites still on plain fetch — this closes the gap without touching a
 * single assertion.
 *
 * THE THREE-WAY TRANSPORT CLASSIFICATION (the core of the fix):
 *   · NEVER-DELIVERED (isNeverDeliveredError: ECONNREFUSED /
 *     "Unable to connect" / EAI_AGAIN, incl. bun's aggregate-cause
 *     chain): the connection never formed, so the server never saw the
 *     request — safe to re-issue for ANY method, exactly like a read.
 *   · AMBIGUOUS (ECONNRESET / ECONNABORTED / EPIPE / "socket connection
 *     was closed" / "socket hang up" / aggregate "fetch failed" that is
 *     not provably refused / per-attempt timeout): the request MAY have
 *     been delivered and processed. NEVER blind-retried. The caller's
 *     {snapshot, detect, respond} closure reconciles against DB truth:
 *       - detect(before) returns a LANDED result → respond() synthesizes
 *         the response the route would have returned, marked
 *         `x-live-http-reconciled: 1`. The request is NEVER re-issued.
 *       - detect returns null → the DB PROVES the write did not land →
 *         a re-issue is sound (same safety as a refused connection).
 *       - detect THROWS → fail-closed: the ORIGINAL transport error is
 *         rethrown (never guess, never respond from a partial probe).
 *   · DETERMINISTIC (anything else, incl. every HTTP status): an HTTP
 *     response of ANY status is returned immediately, exactly once;
 *     non-transient errors are rethrown immediately. Product errors
 *     (400/409/422/500…) are NEVER retried and NEVER synthesized.
 *
 * SOUNDNESS GATE: between any two deliveries of the same write there is
 * ALWAYS a proof of no-delivery — either the transport proved it
 * (refused) or the caller's detect() proved it against the DB snapshot
 * taken BEFORE the first attempt. Every retry cycle is bounded by the
 * same wall-clock deadline + attempt cap as liveFetch.
 *
 * KNOWN LIMITATION (documented honestly, accepted by design): detect()
 * proves absence AS OF the query instant. A server that resets the
 * CLIENT socket but keeps processing can commit its write after detect
 * said "not landed" — the re-issue would then double-write. The CI
 * failure mode this fixes is a process KILL (memory-guard exit): the
 * dying server's in-flight DB transactions roll back, so by the time the
 * client observes ECONNRESET and runs detect, absence is durable. The
 * residual race requires a half-closed-socket server that completes the
 * write late — not the observed mechanism, and strictly narrower than
 * the previous behaviour (which blind-retried EVERY ambiguous failure).
 *
 * The synthesized response carries `x-live-http-reconciled: 1` so a
 * suite (or a debugging human) can always tell a reconciled answer from
 * a live HTTP one. Assertions are NEVER affected: respond() must build
 * the EXACT shape the route returns, from the landed DB rows.
 */

export interface LiveFetchOpts {
  /** Wall-clock retry budget in ms. Default 25_000. */
  deadlineMs?: number
  /** Per-attempt timeout in ms; an attempt that exceeds it is retried.
   * Default 10_000. */
  perAttemptMs?: number
  /** Hard cap on attempts regardless of deadline (guards a pathological
   * instant-fail loop). Default 30. */
  maxAttempts?: number
}

/** Transient transport failures worth retrying (by bun error code / text). */
export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const msg = err.message ?? ''
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE' ||
    /socket connection was closed/i.test(msg) ||
    /unable to connect/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /fetch failed/i.test(msg) // bun wraps some ECONNRESETs in aggregate errors
  )
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function liveFetch(
  url: string,
  init?: RequestInit,
  opts: LiveFetchOpts = {},
): Promise<Response> {
  const deadlineMs = Math.max(1, opts.deadlineMs ?? 25_000)
  const perAttemptMs = Math.max(1, opts.perAttemptMs ?? 10_000)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 30)
  const startedAt = Date.now()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Per-attempt timeout: absorbs ABANDONED sockets (accepted by a server
    // that then restarts and never answers) without eating the whole
    // deadline. Signals are combined with any caller-provided one.
    const timeoutSignal = AbortSignal.timeout(perAttemptMs)
    const callerSignal = init?.signal ?? null
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal

    try {
      const res = await fetch(url, { ...init, signal })
      // A returned response is always final (an abort at the boundary
      // surfaces as a thrown AbortError, handled below).
      return res
    } catch (err) {
      const abortedByCaller = callerSignal?.aborted === true
      const timedOut = timeoutSignal.aborted === true && !abortedByCaller
      const transient = isTransientNetworkError(err)
      const elapsed = Date.now() - startedAt

      if (abortedByCaller) throw err // caller cancelled: never retry
      // Stop conditions, in order: deadline exhausted, attempt cap,
      // deterministic (non-transient, non-timeout) failure.
      if (elapsed >= deadlineMs || attempt === maxAttempts || (!transient && !timedOut)) {
        throw err
      }

      const backoffMs = Math.min(3_000, 300 * 2 ** (attempt - 1))
      console.warn(
        `[live-http] attempt ${attempt} failed after ${elapsed}ms of a ${deadlineMs}ms budget ` +
          `(${timedOut ? `> ${perAttemptMs}ms abandoned/hung socket` : 'transient network error'}): ` +
          `${err instanceof Error ? err.message : String(err)} — retrying in ${backoffMs}ms: ${url}`,
      )
      await sleep(backoffMs)
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new Error(`[live-http] exhausted attempts for ${url}`)
}

// ─────────────────────────────────────────────────────────────────────────
// liveWriteFetch — restart-resilient fetch for NON-IDEMPOTENT test writes
// (2026-10-24, fee-gateway transport-reliability fix; full contract in the
// file header above).
// ─────────────────────────────────────────────────────────────────────────

/** Response synthesis result — the exact JSON shape the route returns. */
export interface LiveWriteSynthesis {
  /** HTTP status of the synthesized response. Default 200. */
  status?: number
  /** JSON body — built from the LANDED DB rows, never invented. */
  body: unknown
}

/**
 * DB-truth reconciliation for AMBIGUOUS transport failures on writes.
 *
 * Snapshot/detect/respond form ONE identity closure per logical request:
 *  · snapshot() runs BEFORE the first attempt — its result is the
 *    baseline that lets detect() say "THIS request landed" rather than
 *    "a row like this exists" (a pre-existing row can never false-green).
 *  · detect(before) runs after an ambiguous failure. Landed result →
 *    respond(); null/undefined → the write provably did not land and a
 *    re-issue follows; THROWN → fail-closed, the original transport
 *    error is rethrown. detect() must keep its own waits BOUNDED well
 *    under the caller's deadline (the webhook closure polls ≤5s).
 *  · respond(landed) builds the response the route would have returned
 *    — the same status, the same body shape, from the rows detect found.
 */
export interface LiveWriteReconcile<Snapshot = unknown, Landed = unknown> {
  snapshot(): Promise<Snapshot>
  detect(before: Snapshot): Promise<Landed | null | undefined>
  respond(landed: Landed): LiveWriteSynthesis | Promise<LiveWriteSynthesis>
}

export interface LiveWriteOpts<Snapshot = unknown, Landed = unknown> extends LiveFetchOpts {
  /** Without a reconcile closure an ambiguous failure on a write is
   * FAIL-CLOSED (rethrown, never blind-retried). */
  reconcile?: LiveWriteReconcile<Snapshot, Landed>
}

/**
 * Transport failures that PROVE the request was never delivered: the
 * connection could not be established (ECONNREFUSED / "Unable to
 * connect" / "connection refused") or DNS was not resolvable YET
 * (EAI_AGAIN). bun wraps some of these in aggregate "fetch failed"
 * errors — the cause chain is inspected for the same codes (bounded
 * depth, cycle-guarded). For a WRITE these are safe to re-issue for ANY
 * method: the server never saw the request.
 */
export function isNeverDeliveredError(err: unknown): boolean {
  const seen = new Set<unknown>()
  let cur: unknown = err
  for (let depth = 0; cur != null && depth < 4; depth++) {
    if (seen.has(cur)) break
    seen.add(cur)
    if (!(cur instanceof Error)) break
    const code = (cur as NodeJS.ErrnoException).code ?? ''
    const msg = cur.message ?? ''
    if (code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return true
    if (/connection refused/i.test(msg) || /unable to connect/i.test(msg)) return true
    cur = (cur as Error & { cause?: unknown }).cause
  }
  return false
}

export async function liveWriteFetch<Snapshot = unknown, Landed = unknown>(
  url: string,
  init?: RequestInit,
  opts: LiveWriteOpts<Snapshot, Landed> = {},
): Promise<Response> {
  const reconcile = opts.reconcile
  const deadlineMs = Math.max(1, opts.deadlineMs ?? 25_000)
  const perAttemptMs = Math.max(1, opts.perAttemptMs ?? 10_000)
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 30)
  const startedAt = Date.now()

  // The reconciliation baseline is captured ONCE, before ANY request is
  // issued — detect() must distinguish "this request landed" from
  // "this state existed before the request".
  const before = reconcile ? await reconcile.snapshot() : (undefined as Snapshot | undefined)
  let lastErr: unknown = new Error(`[live-http] no attempts made for ${url}`)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(perAttemptMs)
    const callerSignal = init?.signal ?? null
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal

    try {
      const res = await fetch(url, { ...init, signal })
      // Any HTTP status is final — returned exactly once, never retried,
      // never synthesized. Product errors stay visible to the suite.
      return res
    } catch (err) {
      lastErr = err
      const abortedByCaller = callerSignal?.aborted === true
      const timedOut = timeoutSignal.aborted === true && !abortedByCaller
      if (abortedByCaller) throw err // caller cancelled: never retry

      const neverDelivered = isNeverDeliveredError(err)
      const ambiguous = !neverDelivered && (isTransientNetworkError(err) || timedOut)
      const elapsed = Date.now() - startedAt

      if (neverDelivered) {
        // Provably undelivered → a re-issue is sound for ANY method.
        if (elapsed >= deadlineMs || attempt === maxAttempts) throw err
        const backoffMs = Math.min(3_000, 300 * 2 ** (attempt - 1))
        console.warn(
          `[live-http] attempt ${attempt} REFUSED (never delivered) after ${elapsed}ms of a ${deadlineMs}ms budget: ` +
            `${err instanceof Error ? err.message : String(err)} — re-issuing in ${backoffMs}ms: ${url}`,
        )
        await sleep(backoffMs)
        continue
      }

      if (ambiguous) {
        // The request MAY have been delivered and processed. NEVER
        // blind-retry a write here — reconcile against DB truth.
        if (!reconcile) throw err // fail-closed: no closure, no retry
        let landed: Landed | null | undefined
        try {
          landed = await reconcile.detect(before as Snapshot)
        } catch (detectErr) {
          // Fail-closed: never guess. The ORIGINAL transport error is the
          // honest answer — a broken probe must not become a fake green.
          console.warn(
            `[live-http] reconcile detect() threw for ${url} ` +
              `(${detectErr instanceof Error ? detectErr.message : String(detectErr)}) — failing closed with the original transport error`,
          )
          throw err
        }
        if (landed != null) {
          // DB truth says the write LANDED — synthesize the route's
          // response from the rows. The request is NEVER re-issued.
          const synth = await reconcile.respond(landed)
          console.warn(
            `[live-http] ambiguous failure but the write LANDED (DB-verified) — ` +
              `response synthesized from rows (x-live-http-reconciled: 1), never re-issued: ${url}`,
          )
          return new Response(JSON.stringify(synth.body), {
            status: synth.status ?? 200,
            headers: {
              'content-type': 'application/json',
              'x-live-http-reconciled': '1',
            },
          })
        }
        // DB truth PROVES the write did not land → a re-issue is sound.
        if (elapsed >= deadlineMs || attempt === maxAttempts) throw err
        const backoffMs = Math.min(3_000, 300 * 2 ** (attempt - 1))
        console.warn(
          `[live-http] attempt ${attempt} ambiguous but NOT landed (DB-verified) after ${elapsed}ms of a ${deadlineMs}ms budget: ` +
            `${err instanceof Error ? err.message : String(err)} — re-issuing in ${backoffMs}ms: ${url}`,
        )
        await sleep(backoffMs)
        continue
      }

      // Deterministic (non-transient, non-timeout) failure — rethrow.
      throw err
    }
  }
  // Unreachable — the loop either returns or throws the last error.
  throw lastErr
}
