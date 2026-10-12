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
function isTransientNetworkError(err: unknown): boolean {
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
