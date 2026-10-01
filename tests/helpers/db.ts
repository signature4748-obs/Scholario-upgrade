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
 * BUDGET (must stay under the Supavisor session pool_size):
 *   dev server 6 (DATABASE_URL in .env) + this test client 6 + event-stream 1
 *   = 13 of 15 — 2 headroom for transient scripts.
 *
 * Do NOT $disconnect this singleton from individual suites — it is shared
 * process-wide; teardown hooks should clean ROWS, not the client.
 */
import { PrismaClient } from '@prisma/client'

// The shared test pool gets its OWN bounded connection_limit (query param
// override), independent of the dev server's .env budget.
const base = process.env.DATABASE_URL ?? ''
const url = base.includes('connection_limit')
  ? base.replace(/connection_limit=\d+/, 'connection_limit=6')
  : base + (base.includes('?') ? '&' : '?') + 'connection_limit=6'

export const db = url
  ? new PrismaClient({ datasources: { db: { url } } })
  : new PrismaClient()
