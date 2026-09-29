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
 * Slow-query threshold: DB_SLOW_QUERY_MS env (default 200).
 */

const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS ?? 200)

function truncateSql(sql: string): string {
  return sql.length > 400 ? `${sql.slice(0, 400)}…` : sql
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
 * Behavior is IDENTICAL to db.$transaction (options pass through); only
 * observability is added.
 */
export async function trackedTransaction<T>(
  label: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await db.$transaction(fn, opts)
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
