/**
 * seed-guard — the shared production lock for every Prisma seed script.
 *
 * PHASE 8A (SQLite → Supabase PostgreSQL): production starts CLEAN. The
 * demo corpus is explicitly sanctioned ACCEPTANCE data for the
 * development/integration database only — never a production fallback.
 * Every seed script (and the seed-demo orchestrator) imports this guard
 * FIRST and calls `assertSeedable(<label>)` before touching the database.
 *
 * FAIL-SAFE rules (throw → non-zero exit, no partial writes):
 *   1. `DATABASE_ENV === 'production'` (or NODE_ENV=production) → refuse.
 *   2. `DATABASE_URL` points at Supabase while `DATABASE_ENV` is UNSET →
 *      refuse. Seeding a real hosted database requires an explicit,
 *      deliberate environment declaration; an unset variable must never
 *      silently default to "go ahead".
 *
 * `DATABASE_ENV=development` is the sanctioned state for the integration
 * corpus (two-tenant acceptance data: Sunrise Academy demo + Green Valley
 * Public School clean).
 *
 * NOTE on the sandbox shell: a STALE `DATABASE_URL` (file:…custom.db from
 * the SQLite era) may be injected into the environment; Prisma's postgres
 * client refuses it on its own, and the canonical workflow is
 * `unset DATABASE_URL` so each script reads the postgres URL from .env.
 */

export class SeedGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedGuardError'
  }
}

export function assertSeedable(label: string): void {
  const env = (process.env.DATABASE_ENV ?? '').trim()
  const url = (process.env.DATABASE_URL ?? '').trim()

  if (env === 'production' || process.env.NODE_ENV === 'production') {
    throw new SeedGuardError(
      `[${label}] REFUSING to seed: DATABASE_ENV=${env || 'unset'}` +
        `${process.env.NODE_ENV === 'production' ? ' (NODE_ENV=production)' : ''}. ` +
        'Production starts clean — the demo corpus is development-only acceptance data.',
    )
  }

  if (url.includes('supabase') && env === '') {
    throw new SeedGuardError(
      `[${label}] REFUSING to seed a Supabase database with DATABASE_ENV unset. ` +
        'Set DATABASE_ENV=development (sanctioned demo/integration corpus) or ' +
        'DATABASE_ENV=production (hard refuse) in .env before running seeds.',
    )
  }
}
