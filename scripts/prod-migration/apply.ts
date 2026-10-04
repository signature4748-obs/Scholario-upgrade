/**
 * scripts/prod-migration/apply.ts — STAGE 2 of the production database
 * migration pipeline (docs/PRODUCTION_DB_MIGRATION.md).
 *
 * Applies the PENDING migrations from THIS checkout to production, in exact
 * timestamp (name-sort) order, through the Supabase Management API. Each
 * migration is ONE explicit transaction containing the migration file's SQL
 * plus its `_prisma_migrations` row (TRUE Prisma checksum — sha256 of
 * migration.sql, byte-identical to what `prisma migrate deploy` writes), so:
 *
 *   · a failure rolls the whole migration back (no partial schema state,
 *     no history row) and the process exits non-zero immediately — a failed
 *     migration can never be marked applied or "successful";
 *   · re-running is idempotent (already-applied migrations are skipped);
 *   · `prisma migrate deploy` / `prisma migrate status` treat the result as
 *     their own — zero drift.
 *
 * Before applying, this stage also transactionally REPAIRS the one known,
 * documented history divergence: migration 20261004090000_saas_hardening_
 * entitlement was applied via this same Management API channel during the
 * SaaS-hardening production handoff and its row was recorded with the
 * placeholder checksum 'saas-hardening-manual-apply' (worklog SAAS-HARD-PROD).
 * The repair rewrites that checksum to the TRUE file checksum — the exact
 * divergence is understood and documented; no other row is touched.
 *
 * Seeds are NEVER executed. No other production data is modified.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-migration/apply.ts \
 *       [--expect 20261004150000_credential_neutralization,…] [--dry-run]
 */
import {
  buildMigrationTransaction,
  evaluateExpectations,
  exitWithProblems,
  fetchAppliedMigrations,
  gitSha,
  mgmtQuery,
  migrationHistoryGate,
  parseCsv,
  requireEnv,
  SAAS_HARDENING_TABLES,
  sqlLiteral,
} from './lib'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[prod-migration:apply] ${flag} requires a value`)
    process.exit(2)
  }
  return v
}

async function tableExists(name: string): Promise<boolean> {
  const rows = (await mgmtQuery(
    `SELECT to_regclass(${sqlLiteral('public.' + name)}) AS oid`,
  )) as Array<{ oid: string | null }>
  return rows.length > 0 && rows[0].oid != null
}

async function main(): Promise<void> {
  requireEnv('SUPABASE_ACCESS_TOKEN')
  const ref = requireEnv('SUPABASE_PROJECT_REF')
  const sha = gitSha()
  const expected = parseCsv(argValue('--expect'))
  const dryRun = process.argv.includes('--dry-run')

  console.log('[prod-migration:apply] ═══ APPLY (transactional, fail-loud) ═══')
  console.log(`  project ref : ${ref}`)
  console.log(`  checkout    : ${sha ?? '<not a git checkout>'}`)
  console.log(`  mode        : ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`)

  // Re-validate everything preflight validated (defense in depth — apply is
  // safe to run standalone).
  const gate = await migrationHistoryGate()
  const problems = [...gate.problems]
  if (expected.length) {
    const actual = gate.pending.map((m) => m.name)
    const matches = actual.length === expected.length && actual.every((n, i) => n === expected[i])
    if (!matches) {
      problems.push(`pending set mismatch — expected [${expected.join(', ')}] but state gives [${actual.join(', ')}]`)
    }
  }
  const expectations = await evaluateExpectations(gate)
  for (const v of expectations.pendingViolations) problems.push(v)
  for (const v of expectations.appliedViolations) problems.push(v)
  if (problems.length) exitWithProblems('apply', problems)

  // ── Step 0: documented checksum repair (idempotent) ────────────────────
  const saasRow = gate.applied.find((m) => m.migration_name === '20261004090000_saas_hardening_entitlement')
  const saasRepo = gate.repo.find((m) => m.name === '20261004090000_saas_hardening_entitlement')
  if (saasRow && saasRepo && saasRow.checksum !== saasRepo.checksum) {
    console.log('\n  [repair] documented divergence on 20261004090000_saas_hardening_entitlement:')
    console.log(`    db checksum      : ${saasRow.checksum ?? 'null'}`)
    console.log(`    repository sha256: ${saasRepo.checksum}`)
    // Safety: only repair when the migration's objects demonstrably exist
    // (the divergence is understood: the SQL WAS applied; only the row's
    // checksum placeholder is wrong).
    const missingTables: string[] = []
    for (const t of SAAS_HARDENING_TABLES) {
      if (!(await tableExists(t))) missingTables.push(t)
    }
    if (missingTables.length) {
      exitWithProblems('apply', [
        `cannot repair the saas-hardening checksum — its tables are missing (${missingTables.join(', ')}) — the divergence is NOT the documented one. STOP.`,
      ])
    }
    if (dryRun) {
      console.log('    DRY RUN — would rewrite the checksum to the repository value.')
    } else {
      await mgmtQuery(
        [
          'BEGIN;',
          `UPDATE _prisma_migrations SET checksum = ${sqlLiteral(saasRepo.checksum)} WHERE migration_name = ${sqlLiteral(saasRow.migration_name)} AND checksum <> ${sqlLiteral(saasRepo.checksum)};`,
          'COMMIT;',
        ].join('\n'),
      )
      const after = await fetchAppliedMigrations()
      const repaired = after.find((m) => m.migration_name === saasRow.migration_name)
      if (!repaired || repaired.checksum !== saasRepo.checksum) {
        exitWithProblems('apply', ['checksum repair did not land — verify manually before proceeding'])
      }
      console.log('    repaired ✓ — row checksum now equals the repository sha256 (transactional).')
    }
  }

  // ── Step 1..N: apply pending migrations in exact timestamp order ───────
  if (!gate.pending.length) {
    console.log('\n  nothing pending — production is already at this checkout’s schema. Idempotent no-op ✓')
  }
  const appliedNow: string[] = []
  for (const migration of gate.pending) {
    const tx = buildMigrationTransaction(migration)
    console.log(`\n  [apply] ${migration.name}`)
    console.log(`    sha256 : ${migration.checksum}`)
    console.log(`    batch  : ${migration.sql.trim().split('\n').length + 4} statements (1 transaction incl. history row)`)
    if (dryRun) {
      console.log('    DRY RUN — transaction not executed.')
      continue
    }
    const started = Date.now()
    try {
      await mgmtQuery(tx)
    } catch (err) {
      console.error(`\n  ✖ MIGRATION FAILED — transaction rolled back, NO history row written, pipeline HALTED:`)
      console.error(`    ${migration.name}: ${(err as Error).message}`)
      process.exit(1)
    }
    // Post-verify the row + the objects this migration claims.
    const after = await fetchAppliedMigrations()
    const row = after.find((m) => m.migration_name === migration.name)
    if (!row || !row.finished || row.rolled_back || row.checksum !== migration.checksum) {
      exitWithProblems('apply', [
        `${migration.name} reported success but its history row is wrong/missing — investigate immediately`,
      ])
    }
    const fresh = await migrationHistoryGate()
    const stillPending = fresh.pending.find((m) => m.name === migration.name)
    const freshExpectations = await evaluateExpectations(fresh)
    const appliedViolations = freshExpectations.appliedViolations.filter((v) => v.startsWith(migration.name))
    if (stillPending || appliedViolations.length) {
      exitWithProblems('apply', [
        `${migration.name}: post-apply verification failed`,
        ...appliedViolations,
      ])
    }
    appliedNow.push(migration.name)
    console.log(`    done ✓ ${((Date.now() - started) / 1000).toFixed(1)}s — history row verified (true checksum), objects verified.`)
  }

  // ── Final state ─────────────────────────────────────────────────────────
  const finalGate = await migrationHistoryGate()
  console.log(`\n  final history : ${finalGate.applied.length} applied / ${finalGate.repo.length} in repo / ${finalGate.pending.length} pending`)
  if (finalGate.pending.length) {
    exitWithProblems('apply', ['pipeline finished with pending migrations remaining — refusing to report success'])
  }
  if (finalGate.checksumDivergences.length) {
    exitWithProblems('apply', [
      `checksum divergences remain after apply: ${finalGate.checksumDivergences.map((d) => d.name).join(', ')}`,
    ])
  }
  console.log(`  applied now   : ${appliedNow.length ? appliedNow.join(', ') : 'none (idempotent re-run)'}`)
  console.log(`  seeds executed: NEVER (migrations only — production data untouched except the migration’s own data step)`)
  console.log('\n[prod-migration:apply] ✓ APPLY COMPLETE — migration status is clean')
}

main().catch((err) => {
  console.error(`\n[prod-migration:apply] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
