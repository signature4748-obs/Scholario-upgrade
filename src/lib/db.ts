import { PrismaClient, Prisma } from '@prisma/client'
import { log } from '@/lib/observability/logger'

/**
 * Prisma client with diagnostics (Phase 4 — item 7).
 *
 * Every query and engine error flows through the structured logger:
 *
 *   db_slow_query        (warn)  — any statement at or above
 *                                  DB_SLOW_QUERY_MS (default 200 ms):
 *                                  duration + SQL text (truncated).
 *                                  NEVER the bound parameters — they carry
 *                                  student/parent PII.
 *   db_query_error       (error) — failed engine operations (failed
 *                                  queries, constraint violations that
 *                                  surface at the engine, aborted
 *                                  statements).
 *   db_engine_warn       (warn)  — engine-level warnings.
 *   db_transaction_*     (see trackedTransaction below) — interactive
 *                                  transaction outcome with a label.
 *
 * Query text is truncated to 400 chars and params are dropped by design:
 * the SQL shape + duration is the diagnostic; the values are PII.
 *
 *   db_retry             (warn)  — transient connectivity error retried
 *                                  (see withDbRetry below): attempt
 *                                  number, prisma error code, backoff delay.
 *
 * Slow-query threshold: DB_SLOW_QUERY_MS env (default 200).
 */

const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS ?? 200)

function truncateSql(sql: string): string {
  return sql.length > 400 ? `${sql.slice(0, 400)}…` : sql
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Transient-connection retry wrapper (Phase 8A — Supabase) ────────────

/**
 * Prisma error codes that mean "the database was momentarily unreachable
 * or the connection died" — safe to retry the SAME operation for.
 *
 *   P1001  can't reach the database server
 *   P1002  database server does not respond within the timeout
 *   P1006  connection to the database server was closed
 *   P1008  operations timed out
 *   P1017  server closed the connection
 *
 * Everything else is terminal by design: constraint violations (P2002
 * unique / P2003 FK / P2004 check) and validation errors MUST fail fast —
 * retrying them would re-run a doomed statement and mask the real bug.
 */
const TRANSIENT_PRISMA_CODES: ReadonlySet<string> = new Set([
  'P1001',
  'P1002',
  'P1006',
  'P1008',
  'P1017',
])

function isTransientPrismaError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)
}

export interface DbRetryOptions {
  /** Total attempts (initial call + retries). Default 3. */
  attempts?: number
  /** Base backoff delay in ms; doubles per retry (100→200→400…). Default 100. */
  baseDelayMs?: number
  /** Label for the structured db_retry log lines. */
  label?: string
}

/**
 * Run `fn`, retrying ONLY transient connectivity failures (see
 * TRANSIENT_PRISMA_CODES). Backoff: exponential (base 100ms doubling —
 * 100→200, the 400ms step applies if `attempts` is raised past the default
 * 3) with ±30% jitter so concurrent callers desynchronize. After the last
 * attempt the error is rethrown unchanged.
 *
 * Phase 8A rationale: the app now talks to a REMOTE Supabase pooler —
 * blips (DNS, pool restart, TLS renegotiation) that a local SQLite file
 * could never produce now surface as P1001/P1006/P1008. Financial routes
 * already funnel through trackedTransaction (below), which wraps its
 * $transaction in this helper.
 *
 * Retry-safety note: an interactive-transaction callback re-executes from
 * scratch on retry — that is exactly what transactions guarantee (all-or-
 * nothing), so a transient failure mid-tx leaves no partial state. The one
 * accepted edge (per Phase-8A spec) is a commit ack lost to a P1008: the
 * retry may re-run an already-committed unit; callers whose business logic
 * is not naturally idempotent keep their own guards (idempotency keys,
 * unique constraints) — which fail as P2002 and are NOT retried here.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const baseDelayMs = Math.max(1, opts.baseDelayMs ?? 100)
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= attempts || !isTransientPrismaError(e)) throw e
      const nominal = baseDelayMs * 2 ** (attempt - 1)
      const delayMs = Math.max(
        1,
        Math.round(nominal * (1 + (Math.random() * 0.6 - 0.3))),
      ) // ±30% jitter
      log('warn', 'db_retry', {
        channel: 'db',
        label: opts.label,
        attempt,
        nextAttempt: attempt + 1,
        errorCode: (e as { code?: string }).code,
        delayMs,
      })
      await sleep(delayMs)
    }
  }
}

function createDb(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  })

  client.$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration >= SLOW_QUERY_MS) {
      log('warn', 'db_slow_query', {
        channel: 'db',
        durationMs: e.duration,
        query: truncateSql(e.query),
      })
    }
  })

  client.$on('error', (e: Prisma.LogEvent) => {
    log('error', 'db_query_error', {
      channel: 'db',
      detail: String(e.message).slice(0, 300),
      target: e.target,
    })
  })

  client.$on('warn', (e: Prisma.LogEvent) => {
    log('warn', 'db_engine_warn', {
      channel: 'db',
      detail: String(e.message).slice(0, 300),
    })
  })

  return client
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Interactive transaction wrapper with failure diagnostics (Phase 4 —
 * item 7). Financial and multi-row mutations migrate their
 * `db.$transaction(fn)` calls to this so every rollback is a structured
 * `db_transaction_failure` line with the business label, duration and the
 * underlying error code — instead of a bare 500 in the request log.
 *
 * Behavior is IDENTICAL to db.$transaction (options pass through) except
 * for Phase 8A: TRANSIENT connectivity failures (P1001/P1002/P1006/P1008/
 * P1017 only — constraint/validation errors stay terminal) are retried up
 * to 3 attempts with jittered exponential backoff via withDbRetry before
 * the failure is logged/raised. On top of the observability added in
 * Phase 4, each retry emits a `db_retry` warn line with the attempt
 * number, prisma error code and backoff delay; `durationMs` in the
 * commit/failure lines therefore includes any retry backoff time.
 */
export async function trackedTransaction<T>(
  label: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const startedAt = Date.now()
  try {
    // Phase 8A: remote-Supabase connectivity blips (P1001/P1002/P1006/
    // P1008/P1017) are retried by withDbRetry before the transaction is
    // declared failed — see its retry-safety note for the semantics.
    const result = await withDbRetry(() => db.$transaction(fn, opts), {
      label: `trackedTransaction:${label}`,
    })
    log('debug', 'db_transaction', {
      channel: 'db',
      label,
      status: 'committed',
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (e) {
    const err = e as { code?: string; message?: string }
    log('error', 'db_transaction_failure', {
      channel: 'db',
      label,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorCode: err.code,
      detail: (err.message ?? String(e)).slice(0, 300),
    })
    throw e
  }
}
