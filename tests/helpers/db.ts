/**
 * Phase 8A — shared Prisma client for ALL test files.
 *
 * WHY: every test file used to instantiate its own PrismaClient, and each
 * client holds its own connection pool for the lifetime of the process.
 * On SQLite this was free; on the Supabase Supavisor SESSION pooler every
 * pooled connection maps 1:1 to a Postgres backend and the project has a
 * HARD session-mode pool_size (EMAXCONNSESSION "max clients reached" —
 * observed live), so unbounded per-file pools exhaust it mid-suite.
 *
 * BUDGET (must stay under the Supavase session pool_size of 15):
 *   dev server 6 (DATABASE_URL in .env) + event-stream 1
 *   + this shared test client 3 + the src/lib/db client that lives in the
 *   TEST process (Phase 8B: suites importing src modules with @/lib/db —
 *   rate-limit-strict, email-infra) 3 = 13 of 15 — 2 headroom.
 *
 * LAZY SINGLETON (2026-10-25 env-poisoning fix): the URL is read at FIRST
 * USE, never at module evaluation. bun runs every test file in ONE
 * process, and a file that temporarily mutates process.env.DATABASE_URL
 * (restoring it in afterEach) can execute BEFORE this module is first
 * imported — a module-eval capture then froze the poisoned value into the
 * shared client and broke every later suite with the wrong database. The
 * transparent Proxy below defers BOTH the URL read and the PrismaClient
 * construction to the first property access, so the client always sees
 * the environment as it is when a suite actually uses it.
 *
 * Do NOT $disconnect this singleton from individual suites — it is shared
 * process-wide; teardown hooks should clean ROWS, not the client.
 */
import { PrismaClient } from '@prisma/client'

let client: PrismaClient | null = null

// The shared test pool gets its OWN bounded connection_limit (query param
// override), independent of the dev server's .env budget (3 since 8B —
// the test-process src/lib/db client shares the budget now).
// Read LIVE at first use — see the LAZY SINGLETON note above.
function buildUrl(): string {
  const base = process.env.DATABASE_URL ?? ''
  return base.includes('connection_limit')
    ? base.replace(/connection_limit=\d+/, 'connection_limit=3')
    : base + (base.includes('?') ? '&' : '?') + 'connection_limit=3'
}

function getClient(): PrismaClient {
  if (!client) {
    const url = buildUrl()
    client = url
      ? new PrismaClient({ datasources: { db: { url } } })
      : new PrismaClient()
  }
  return client
}

// Transparent forwarding proxy: property access materializes the client.
// set/delete fail LOUDLY so an accidental `db = …` / `delete db.x` can
// never silently corrupt the shared singleton.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = getClient() as object
    const value = Reflect.get(c, prop, c)
    return typeof value === 'function' ? value.bind(c) : value
  },
  has(_target, prop) {
    return Reflect.has(getClient() as object, prop)
  },
  set() {
    throw new Error(
      'tests/helpers/db: the shared Prisma client is a lazy singleton proxy — assignment is not supported. Use `import { db }` directly.',
    )
  },
  deleteProperty() {
    throw new Error(
      'tests/helpers/db: the shared Prisma client is a lazy singleton proxy — property deletion is not supported. Use `import { db }` directly.',
    )
  },
})
