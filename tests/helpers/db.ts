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
 * Do NOT $disconnect this singleton from individual suites — it is shared
 * process-wide; teardown hooks should clean ROWS, not the client.
 */
import { PrismaClient } from '@prisma/client'

// The shared test pool gets its OWN bounded connection_limit (query param
// override), independent of the dev server's .env budget (3 since 8B —
// the test-process src/lib/db client shares the budget now).
const base = process.env.DATABASE_URL ?? ''
const url = base.includes('connection_limit')
  ? base.replace(/connection_limit=\d+/, 'connection_limit=3')
  : base + (base.includes('?') ? '&' : '?') + 'connection_limit=3'

export const db = url
  ? new PrismaClient({ datasources: { db: { url } } })
  : new PrismaClient()
