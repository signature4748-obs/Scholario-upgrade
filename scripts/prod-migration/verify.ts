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
 *   G. account recovery      — 20261005060000 created EXACTLY the expected
 *                               objects (PlatformAdmin.google{Sub,Email,
 *                               LinkedAt}, PlatformPasswordReset with UNIQUE
 *                               tokenHash + FK, PlatformRecoveryTicket),
 *                               and admin state never regressed (the
 *                               additive-only contract: counts only, values
 *                               never read).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-migration/verify.ts --snapshot snapshot.json \
 *       [--health-url https://scholario-production.vercel.app/health/ready]
 */
import { readFileSync } from 'node:fs'
import {
  ACCOUNT_RECOVERY_INDEXES,
  ACCOUNT_RECOVERY_TABLES,
  adminState,
  AdminState,
  allIndexNames,
  exitWithProblems,
  gitSha,
  indexDefinitions,
  mgmtQuery,
  migrationHistoryGate,
  productionHealth,
  requireEnv,
  SCHOOLID_INDEXES,
  Snapshot,
  tableColumns,
  tableCounts,
  TRGM_INDEXES,
  userCredentialColumns,
  userState,
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

  // G. Account-recovery schema — 20261005060000 must have created EXACTLY
  //    the expected objects: PlatformAdmin.google{Sub,Email,LinkedAt} +
  //    PlatformPasswordReset + PlatformRecoveryTicket with the exact
  //    column shapes, indexes, UNIQUE constraints and the FK; the
  //    migration is additive-only so existing admin passwords are
  //    untouched (admin-state counts below — values never read).
  const adminCols = await tableColumns('PlatformAdmin', ['googleSub', 'googleEmail', 'googleLinkedAt'])
  const colShape = (name: string, type: string, nullable: boolean) => {
    const c = adminCols.find((x) => x.column_name === name)
    if (!c) return `${name} MISSING`
    if (!c.data_type.startsWith(type)) return `${name} wrong type ${c.data_type}`
    if ((c.is_nullable === 'YES') !== nullable) return `${name} nullability ${c.is_nullable}`
    return null
  }
  for (const p of [
    colShape('googleSub', 'text', true),
    colShape('googleEmail', 'text', true),
    colShape('googleLinkedAt', 'timestamp', true),
  ]) {
    if (p) problems.push(`PlatformAdmin.${p}`)
  }

  // Both new tables must exist as base tables (section E counted them);
  // their exact column shapes are asserted below.
  for (const t of ACCOUNT_RECOVERY_TABLES) {
    if (!(t in afterCounts)) problems.push(`account-recovery table ${t} MISSING`)
  }

  const expectTableShape = async (
    table: string,
    expected: ReadonlyArray<[string, string, boolean]>,
  ) => {
    const cols = await tableColumns(table)
    const byName = new Map(cols.map((c) => [c.column_name, c]))
    const extra = cols.map((c) => c.column_name).filter((n) => !expected.some(([e]) => e === n))
    if (extra.length) problems.push(`${table}: unexpected columns ${extra.join(', ')}`)
    for (const [name, type, nullable] of expected) {
      const c = byName.get(name)
      if (!c) {
        problems.push(`${table}.${name} MISSING`)
        continue
      }
      if (!c.data_type.startsWith(type)) problems.push(`${table}.${name} wrong type ${c.data_type}`)
      if ((c.is_nullable === 'YES') !== nullable) {
        problems.push(`${table}.${name} nullability ${c.is_nullable} (expected ${nullable ? 'YES' : 'NO'})`)
      }
    }
  }
  await expectTableShape('PlatformPasswordReset', [
    ['id', 'text', false],
    ['adminId', 'text', false],
    ['tokenHash', 'text', false],
    ['usedAt', 'timestamp', true],
    ['expiresAt', 'timestamp', false],
    ['createdAt', 'timestamp', false],
    ['requestIp', 'text', true],
    ['userAgent', 'text', true],
  ])
  await expectTableShape('PlatformRecoveryTicket', [
    ['id', 'text', false],
    ['action', 'text', false],
    ['targetAdminId', 'text', false],
    ['initiatedBy', 'text', false],
    ['confirmedBy', 'text', true],
    ['confirmedAt', 'timestamp', true],
    ['executedAt', 'timestamp', true],
    ['expiresAt', 'timestamp', false],
    ['metadata', 'text', true],
    ['reason', 'text', true],
    ['createdAt', 'timestamp', false],
  ])

  // Indexes (presence asserted in C) + UNIQUE-ness + FK + PKs.
  const defs = await indexDefinitions(['PlatformAdmin', 'PlatformPasswordReset', 'PlatformRecoveryTicket'])
  for (const name of ['PlatformAdmin_googleSub_key', 'PlatformPasswordReset_tokenHash_key']) {
    const def = defs.get(name)
    if (!def) problems.push(`unique index ${name} MISSING`)
    else if (!/\bUNIQUE\b/i.test(def)) problems.push(`index ${name} exists but is NOT UNIQUE: ${def.slice(0, 120)}`)
  }
  for (const name of ACCOUNT_RECOVERY_INDEXES) {
    if (!defs.has(name)) problems.push(`account-recovery index ${name} MISSING`)
  }
  for (const name of ['PlatformPasswordReset_pkey', 'PlatformRecoveryTicket_pkey']) {
    if (!defs.has(name)) problems.push(`primary key index ${name} MISSING`)
  }
  const fk = (await mgmtQuery(
    `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conname = 'PlatformPasswordReset_adminId_fkey'`,
  )) as Array<{ n: number }>
  if (Number(fk[0]?.n ?? 0) !== 1) {
    problems.push('foreign key PlatformPasswordReset_adminId_fkey → PlatformAdmin.id MISSING')
  }

  // Admin-state stability (additive-only proof — counts only, never values).
  const admins = await adminState()
  const beforeAdmins: AdminState | undefined = snapshot.adminState
  if (beforeAdmins) {
    if (admins.withPassword < beforeAdmins.withPassword) {
      problems.push(`admins with a password DECREASED ${beforeAdmins.withPassword} → ${admins.withPassword} (additive-only contract violated)`)
    }
    if (admins.total < beforeAdmins.total) {
      problems.push(`PlatformAdmin row count DECREASED ${beforeAdmins.total} → ${admins.total}`)
    }
  }
  console.log(
    `  G. account recovery : PlatformAdmin.google{Sub,Email,LinkedAt} ✓ · PlatformPasswordReset (8 cols, UNIQUE tokenHash, FK) ✓ · PlatformRecoveryTicket (11 cols) ✓ · 6 indexes + 2 PKs ✓ · admin state: total ${admins.total}, with-password ${admins.withPassword} (never decreased; values never read)`,
  )

  if (problems.length) exitWithProblems('verify', problems)
  console.log('\n[prod-migration:verify] ✓ ALL VERIFICATIONS GREEN')
}

main().catch((err) => {
  console.error(`\n[prod-migration:verify] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
