/**
 * scripts/prod-migration/preflight.ts — STAGE 1 of the production database
 * migration pipeline (docs/PRODUCTION_DB_MIGRATION.md).
 *
 * Read-only against production. It verifies that the production migration
 * history MATCHES this checkout, that the three pending migrations are
 * exactly the expected set (when --expect is given), that the objects they
 * create do NOT already exist (schema-drift / different-migration-state
 * protection), and it captures the full before-state (every table's row
 * count, user/credential counts, applied history) into a snapshot JSON that
 * verify.ts compares against after the apply.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-migration/preflight.ts --out snapshot.json \
 *       [--expect 20261004150000_credential_neutralization,…]
 *
 * Exit codes: 0 = all gates green; 1 = STOP (do not apply).
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ADDITIVE_ONLY_MIGRATIONS,
  adminState,
  assertAdditiveOnly,
  evaluateExpectations,
  exitWithProblems,
  gitSha,
  migrationHistoryGate,
  parseCsv,
  requireEnv,
  Snapshot,
  tableCounts,
  userCredentialColumns,
  userState,
} from './lib'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[prod-migration:preflight] ${flag} requires a value`)
    process.exit(2)
  }
  return v
}

async function main(): Promise<void> {
  requireEnv('SUPABASE_ACCESS_TOKEN')
  const ref = requireEnv('SUPABASE_PROJECT_REF')
  const sha = gitSha()
  const outPath = argValue('--out') ?? resolve(process.cwd(), 'prod-migration-snapshot.json')
  const expected = parseCsv(argValue('--expect'))

  console.log('[prod-migration:preflight] ═══ PRE-FLIGHT (read-only) ═══')
  console.log(`  project ref : ${ref}`)
  console.log(`  checkout    : ${sha ?? '<not a git checkout>'}`)
  console.log(`  token       : <present, never logged>`)

  // Gate 1 — history matches the repository (no unknown, failed, gapped or
  // divergent rows; a documented divergence is surfaced for apply.ts to
  // repair transactionally).
  const gate = await migrationHistoryGate()
  console.log(`\n  repository migrations : ${gate.repo.length}`)
  console.log(`  production applied    : ${gate.applied.length}`)
  console.log(`  pending (to apply)    : ${gate.pending.length}`)
  for (const m of gate.pending) {
    console.log(`    · ${m.name}  (sha256 ${m.checksum.slice(0, 16)}…)`)
  }
  for (const d of gate.checksumDivergences) {
    console.log(
      `  ⚠ documented divergence on ${d.name}: db ${String(d.db)?.slice(0, 16) ?? 'null'}… ≠ repo ${d.repo.slice(0, 16)}… — apply.ts will repair the checksum transactionally`,
    )
  }

  // Gate 2 — expected pending set (exact list and order).
  const problems = [...gate.problems]
  if (expected.length) {
    const actual = gate.pending.map((m) => m.name)
    const matches = actual.length === expected.length && actual.every((n, i) => n === expected[i])
    if (!matches) {
      problems.push(
        `pending set mismatch — expected [${expected.join(', ')}] but production/repo state gives [${actual.join(', ')}]`,
      )
    } else {
      console.log(`\n  expected pending set  : exact match ✓ (${expected.length} migration(s) in timestamp order)`)
    }
  }

  // Gate 3 — object expectations: pending migrations' objects must NOT
  // exist yet; applied migrations' objects must exist.
  const expectations = await evaluateExpectations(gate)
  for (const v of expectations.pendingViolations) problems.push(v)
  for (const v of expectations.appliedViolations) problems.push(v)
  console.log(
    `  object expectations   : ${expectations.pendingViolations.length + expectations.appliedViolations.length === 0 ? 'clean ✓' : 'VIOLATIONS ✖'}`,
  )

  // Gate 3b — additive-only migrations: no data statement may run (the
  // account-safety contract: existing rows are never altered).
  for (const m of gate.pending) {
    if (!ADDITIVE_ONLY_MIGRATIONS.has(m.name)) continue
    try {
      assertAdditiveOnly(m)
      console.log(`  additive-only       : ${m.name} — pure DDL ✓ (no data statements)`)
    } catch (err) {
      problems.push((err as Error).message)
    }
  }

  if (problems.length) exitWithProblems('preflight', problems)

  // Snapshot — the before-state verify.ts compares against.
  const columns = await userCredentialColumns()
  const admins = await adminState()
  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    gitSha: sha,
    tableCounts: await tableCounts(),
    userState: await userState(columns.length > 0),
    adminState: admins,
    appliedMigrations: gate.applied.map((m) => ({
      name: m.migration_name,
      checksum: m.checksum,
      finished: m.finished,
    })),
  }
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')

  console.log(`\n  snapshot written      : ${outPath}`)
  console.log(`    · public tables counted : ${Object.keys(snapshot.tableCounts).length}`)
  console.log(`    · users total            : ${snapshot.userState.total} (school-plane ${snapshot.userState.schoolPlane}, principals ${snapshot.userState.principals})`)
  console.log(`    · platform admins         : ${admins.total} total, ${admins.googleLinked ?? 'n/a (pre-migration)'} google-linked, ${admins.withPassword} with password (counts only)`)
  console.log(`    · credential columns     : ${columns.length ? 'present' : 'absent (expected pre-migration)'}`)
  console.log(`    · seed execution         : NEVER (pipeline runs migrations only)`)
  console.log('\n[prod-migration:preflight] ✓ PRE-FLIGHT GREEN — safe to apply')
}

main().catch((err) => {
  console.error(`\n[prod-migration:preflight] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
