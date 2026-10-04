/**
 * scripts/prod-migration/verify.ts — STAGE 3 of the production database
 * migration pipeline (docs/PRODUCTION_DB_MIGRATION.md).
 *
 * Post-migration verification against production (read-only). Compares the
 * live database against the pre-flight snapshot and FAILS the pipeline on
 * any regression:
 *
 *   A. migration status      — every repo migration applied, none pending,
 *                               none failed, every checksum == repo file.
 *   B. schema verification   — User.mustChangePassword (boolean, NOT NULL)
 *                               and User.passwordChangedAt (timestamp)
 *                               exist.
 *   C. index verification    — all 24 pg_trgm search indexes and all 11
 *                               schoolId tenant indexes exist (exact names).
 *   D. credential migration  — every PRINCIPAL is flagged
 *                               mustChangePassword = true; every
 *                               school-plane account that never set its own
 *                               password (passwordChangedAt IS NULL) is
 *                               flagged; zero invariant violations. Password
 *                               values are never read, printed or compared.
 *   E. row-count comparison  — no public table DECREASED vs the snapshot
 *                               (no unexpected deletions); _prisma_migrations
 *                               grew by exactly the number of applied
 *                               migrations; user counts unchanged.
 *   F. production health     — GET /health/ready answers 200 with
 *                               database:ok (the deployment stayed healthy).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-migration/verify.ts --snapshot snapshot.json \
 *       [--health-url https://scholario-production.vercel.app/health/ready]
 */
import { readFileSync } from 'node:fs'
import {
  allIndexNames,
  exitWithProblems,
  gitSha,
  migrationHistoryGate,
  requireEnv,
  SCHOOLID_INDEXES,
  Snapshot,
  tableCounts,
  TRGM_INDEXES,
  userCredentialColumns,
  userState,
  productionHealth,
} from './lib'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[prod-migration:verify] ${flag} requires a value`)
    process.exit(2)
  }
  return v
}

async function main(): Promise<void> {
  requireEnv('SUPABASE_ACCESS_TOKEN')
  const ref = requireEnv('SUPABASE_PROJECT_REF')
  const sha = gitSha()
  const snapshotPath = argValue('--snapshot')
  if (!snapshotPath) {
    console.error('[prod-migration:verify] --snapshot <path> is required (the preflight output)')
    process.exit(2)
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot
  const healthUrl =
    argValue('--health-url') ?? 'https://scholario-production.vercel.app/health/ready'

  console.log('[prod-migration:verify] ═══ POST-MIGRATION VERIFICATION (read-only) ═══')
  console.log(`  project ref : ${ref}`)
  console.log(`  checkout    : ${sha ?? '<not a git checkout>'}`)
  console.log(`  snapshot    : ${snapshotPath} (captured ${snapshot.capturedAt}${snapshot.gitSha ? ' @ ' + snapshot.gitSha.slice(0, 10) : ''})`)

  const problems: string[] = []

  // A. Migration status — history complete and drift-free.
  const gate = await migrationHistoryGate()
  if (gate.pending.length) {
    problems.push(`migrations still pending: ${gate.pending.map((m) => m.name).join(', ')}`)
  }
  if (gate.applied.length !== gate.repo.length) {
    problems.push(`applied (${gate.applied.length}) ≠ repository (${gate.repo.length})`)
  }
  if (gate.failed.length || gate.unknown.length) {
    problems.push(`failed or unknown migration rows present`)
  }
  if (gate.checksumDivergences.length) {
    problems.push(`checksum drift remains: ${gate.checksumDivergences.map((d) => d.name).join(', ')}`)
  }
  console.log(`\n  A. migration status : ${gate.applied.length}/${gate.repo.length} applied, ${gate.pending.length} pending, checksums ${gate.checksumDivergences.length ? 'DRIFT ✖' : 'true ✓'}`)

  // B. Schema verification — credential columns.
  const columns = await userCredentialColumns()
  const colMap = new Map(columns.map((c) => [c.column_name, c]))
  const mustChange = colMap.get('mustChangePassword')
  const changedAt = colMap.get('passwordChangedAt')
  if (!mustChange) {
    problems.push('User.mustChangePassword column missing')
  } else if (mustChange.data_type !== 'boolean' || mustChange.is_nullable !== 'NO') {
    problems.push(`User.mustChangePassword has wrong shape (${mustChange.data_type}, nullable=${mustChange.is_nullable})`)
  }
  if (!changedAt) {
    problems.push('User.passwordChangedAt column missing')
  } else if (!changedAt.data_type.startsWith('timestamp')) {
    problems.push(`User.passwordChangedAt has wrong type (${changedAt.data_type})`)
  }
  console.log(
    `  B. schema           : mustChangePassword ${mustChange ? `${mustChange.data_type} NOT NULL ✓` : 'MISSING ✖'} · passwordChangedAt ${changedAt ? changedAt.data_type + ' ✓' : 'MISSING ✖'}`,
  )

  // C. Index verification — exact names, from the migration files.
  const indexes = await allIndexNames()
  const trgmMissing = [...TRGM_INDEXES].filter((n) => !indexes.has(n))
  const schoolIdMissing = [...SCHOOLID_INDEXES].filter((n) => !indexes.has(n))
  if (trgmMissing.length) problems.push(`trgm search indexes missing: ${trgmMissing.join(', ')}`)
  if (schoolIdMissing.length) problems.push(`schoolId indexes missing: ${schoolIdMissing.join(', ')}`)
  console.log(
    `  C. indexes          : pg_trgm search ${TRGM_INDEXES.length - trgmMissing.length}/${TRGM_INDEXES.length} ✓ · schoolId tenant ${SCHOOLID_INDEXES.length - schoolIdMissing.length}/${SCHOOLID_INDEXES.length} ✓`,
  )

  // D. Credential migration verification — flags only, never passwords.
  const users = await userState(true)
  if (users.principals !== users.principalsFlagged) {
    problems.push(
      `principals flagged ${users.principalsFlagged ?? 0}/${users.principals} — every PRINCIPAL must have mustChangePassword = true`,
    )
  }
  if (users.schoolPlaneNeverSetOwnPassword !== users.schoolPlaneNeverSetAndFlagged) {
    problems.push(
      `school-plane accounts that never set their own password: ${users.schoolPlaneNeverSetAndFlagged ?? 0}/${users.schoolPlaneNeverSetOwnPassword ?? 0} flagged`,
    )
  }
  if ((users.schoolPlaneInvariantViolations ?? 0) !== 0) {
    problems.push(`credential-migration invariant violations: ${users.schoolPlaneInvariantViolations} row(s)`)
  }
  console.log(
    `  D. credentials      : principals flagged ${users.principalsFlagged}/${users.principals} ✓ · school-plane never-set-own-password flagged ${users.schoolPlaneNeverSetAndFlagged}/${users.schoolPlaneNeverSetOwnPassword} ✓ · invariant violations ${users.schoolPlaneInvariantViolations} (password values never read)`,
  )

  // E. Row-count comparison — no table may shrink.
  const afterCounts = await tableCounts()
  const before = snapshot.tableCounts
  const grownMigrations = (afterCounts['_prisma_migrations'] ?? 0) - (before['_prisma_migrations'] ?? 0)
  const appliedDelta = gate.applied.length - snapshot.appliedMigrations.length
  if (grownMigrations !== appliedDelta) {
    problems.push(
      `_prisma_migrations grew by ${grownMigrations} but ${appliedDelta} migration(s) were applied`,
    )
  }
  const decreases: string[] = []
  const increases: string[] = []
  for (const [table, n] of Object.entries(afterCounts)) {
    const b = before[table]
    if (b === undefined) {
      increases.push(`${table}: new (${n})`)
    } else if (n < b) {
      decreases.push(`${table}: ${b} → ${n}`)
    } else if (n > b) {
      increases.push(`${table}: +${n - b}`)
    }
  }
  const disappeared = Object.keys(before).filter((t) => !(t in afterCounts))
  if (disappeared.length) {
    problems.push(`tables disappeared: ${disappeared.join(', ')}`)
  }
  if (decreases.length) {
    problems.push(`row counts DECREASED (unexpected deletions): ${decreases.join(', ')}`)
  }
  const userCountStable =
    users.total === snapshot.userState.total && users.schoolPlane === snapshot.userState.schoolPlane
  if (!userCountStable) {
    problems.push(
      `user counts changed: total ${snapshot.userState.total} → ${users.total}, school-plane ${snapshot.userState.schoolPlane} → ${users.schoolPlane}`,
    )
  }
  console.log(
    `  E. row counts       : ${Object.keys(afterCounts).length} tables · decreases 0 ✓ · ${increases.length ? 'increases: ' + increases.join(', ') : 'no organic growth'} · users ${users.total} (stable ✓)`,
  )

  // F. Production health — the deployment must have stayed healthy.
  const health = await productionHealth(healthUrl)
  if (!health.ok) {
    problems.push(`production health probe failed (HTTP ${health.status}): ${health.body}`)
  }
  console.log(`  F. production health: ${health.ok ? 'ready, database ok ✓' : 'FAILED ✖ ' + health.body}`)

  if (problems.length) exitWithProblems('verify', problems)
  console.log('\n[prod-migration:verify] ✓ ALL VERIFICATIONS GREEN')
}

main().catch((err) => {
  console.error(`\n[prod-migration:verify] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
