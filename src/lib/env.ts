/**
 * Environment identity for database-safety guards (Phase 8A — infra-guards).
 *
 * Problem being fixed: "is this the production database?" was previously
 * inferred from NODE_ENV alone, which says nothing about WHICH database a
 * script/process is pointed at. Phase 8A moves the app to Supabase
 * PostgreSQL, so destructive tooling (db:push, db:reset, seeds) needs a
 * database-identity signal that is independent of the app runtime mode.
 *
 * Signal hierarchy (first match wins):
 *   1. DATABASE_ENV env var — explicit, ops-controlled:
 *      'development' | 'test' | 'staging' | 'production'.
 *      Default when unset (and for unrecognized values): 'development'.
 *   2. Fail-safe recognition: DATABASE_ENV UNSET + DATABASE_URL host
 *      contains 'supabase' → treat as production. Rationale: an unset
 *      DATABASE_ENV means nobody declared the environment, and pointing
 *      tooling at a Supabase host without declaring it is exactly the
 *      muscle-memory mistake the guards exist to catch — so we refuse.
 *      (When DATABASE_ENV IS set, it wins: the sandbox/staging Supabase
 *      projects run with DATABASE_ENV=development|staging explicitly.)
 *
 * Dependency-free by design: reads process.env only (server-side safe —
 * plain Node, bun scripts, Next.js runtime; bun auto-loads .env for
 * scripts/tests, Next.js loads it for the app). No imports, so guard
 * scripts can use it without pulling in the app graph.
 */

export type DatabaseEnv = 'development' | 'test' | 'staging' | 'production'

const KNOWN_DATABASE_ENVS: readonly string[] = [
  'development',
  'test',
  'staging',
  'production',
]

/** Raw DATABASE_ENV value: undefined when unset or blank. */
function readDatabaseEnv(): string | undefined {
  const raw = process.env.DATABASE_ENV
  if (typeof raw !== 'string') return undefined
  const v = raw.trim().toLowerCase()
  return v === '' ? undefined : v
}

/** DATABASE_URL hostname (lowercased); '' when unset/unparseable. */
function databaseUrlHost(): string {
  const url = process.env.DATABASE_URL
  if (typeof url !== 'string' || url === '') return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    // Unparseable — fall back to a raw substring scan so a mangled
    // production-looking URL still trips the fail-safe check.
    return url.toLowerCase()
  }
}

/**
 * Declared database environment. Unset / unrecognized → 'development'
 * (fail-open classification: unknown means "not declared", NOT "prod" —
 * production refusal is isProductionDatabase()'s job, which adds the
 * Supabase fail-safe recognition below).
 */
export function getDatabaseEnv(): DatabaseEnv {
  const v = readDatabaseEnv()
  return v !== undefined && KNOWN_DATABASE_ENVS.includes(v)
    ? (v as DatabaseEnv)
    : 'development'
}

/**
 * True when the current process is pointed at the production database:
 * DATABASE_ENV=production (explicit), OR DATABASE_ENV unset AND the
 * DATABASE_URL host contains 'supabase' (fail-safe recognition).
 */
export function isProductionDatabase(): boolean {
  const explicit = readDatabaseEnv()
  if (explicit !== undefined) return explicit === 'production'
  return databaseUrlHost().includes('supabase')
}

/**
 * Throw a descriptive error when `action` would run against the production
 * database. Guard scripts call this BEFORE spawning any prisma command.
 */
export function assertNotProductionDb(action: string): void {
  if (!isProductionDatabase()) return
  throw new Error(
    `[db-guard] REFUSED: "${action}" must not run against the production database. ` +
      `Detected production via ${readDatabaseEnv() === 'production' ? 'DATABASE_ENV=production' : 'fail-safe Supabase host recognition (DATABASE_ENV unset)'}` +
      ` (DATABASE_URL host: ${databaseUrlHost() || 'unknown'}). ` +
      `Restores and schema changes on production are ops runbook tasks — never scripts. ` +
      `If this really is a non-production database, set DATABASE_ENV explicitly (e.g. DATABASE_ENV=development).`,
  )
}
