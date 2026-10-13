/**
 * tests/regression/prod-migration-fk-invariant.test.ts
 *
 * Regression coverage for the FK-hardening + honest-signal pipeline
 * extension (this batch):
 *
 *   1. MIGRATION_EXPECTATIONS maps 20261013120000_fee_transaction_student_fk
 *      to the FeeTransaction_studentId_fkey constraint — the object gate
 *      can detect "constraint already exists while pending" (drift) and
 *      "constraint missing although applied" (silent non-apply).
 *   2. evaluateExpectations enforces the constraint bucket in BOTH
 *      directions (pending-violation / applied-violation) — unit-tested
 *      against a mocked Management API.
 *   3. verify.ts (source-level contract): stage B asserts the FK exists
 *      with ON DELETE SET NULL ON UPDATE CASCADE; stage D asserts the
 *      global honest-signal invariant (neverSetOwnPasswordUnflagged).
 *   4. userState() computes neverSetOwnPasswordUnflagged from the same
 *      predicate the migration enforces.
 *   5. The pending migrations' SQL is re-checked against the contract the
 *      runbook promises: self-heal BEFORE the constraint, ledger rows
 *      preserved (no DELETE), no receipt rewriting, no hash rewriting.
 *   6. Guard-safe self-heal contract (B-4b): the FeeTransaction tenant-guard
 *      tg_guard_FT_upd (whose feeId branch rejects ANY update of the 3 legacy
 *      rows that carry a dangling feeId) must be disabled for exactly the
 *      one self-heal statement inside the migration's single transaction and
 *      re-enabled BEFORE the FK is added; only tg_guard_FT_upd is ever
 *      disabled; feeId is never modified (dangling feeId preserved for a
 *      separate owner decision).
 *   7. feeId FK hardening (20261013140000): the follow-up migration that
 *      self-heals those same dangling feeId pointers to NULL (school-scoped
 *      predicate — cross-tenant pointers heal too) and enforces
 *      FeeTransaction_feeId_fkey; stage B additionally holds the post-heal
 *      invariant "zero dangling feeId" in verify.ts.
 *   8. verify.ts trigger-state contract: post-apply BOTH tenant guards
 *      (tg_guard_FT_ins / tg_guard_FT_upd) must be present, ENABLED
 *      (tgenabled = 'O') and bound to tg_guard_FT_ins_fn — fail-closed.
 *   9. Financial-integrity digest: preflight captures a DB-clock cutoff +
 *      privacy-safe md5 over receiptNo|studentId|amount (never feeId — the
 *      sanctioned heal column); verify recomputes the SAME cutoff window
 *      and fails on divergence; organic growth is excluded by the cutoff.
 *  10. financialIntegrity()/dbNow() unit behavior against the mocked
 *      Management API (row mapping, cutoff scoping, DB clock).
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  dbNow,
  evaluateExpectations,
  financialIntegrity,
  MIGRATION_EXPECTATIONS,
  HistoryGate,
  RepoMigration,
} from '../../scripts/prod-migration/lib'

const ROOT = resolve(__dirname, '../..')

// ─── helpers ───────────────────────────────────────────────────────────────

const SQL = readFileSync(
  join(ROOT, 'prisma/migrations/20261013120000_fee_transaction_student_fk/migration.sql'),
  'utf8',
)
const FLAG_SQL = readFileSync(
  join(ROOT, 'prisma/migrations/20261013130000_flag_never_changed_bootstrap_users/migration.sql'),
  'utf8',
)
const FEE_SQL = readFileSync(
  join(ROOT, 'prisma/migrations/20261013140000_fee_transaction_dangling_feeid_self_heal/migration.sql'),
  'utf8',
)

const repoMigration = (name: string): RepoMigration => ({
  name,
  path: `prisma/migrations/${name}/migration.sql`,
  checksum: '0'.repeat(64),
  sql:
    name === '20261013120000_fee_transaction_student_fk'
      ? SQL
      : name === '20261013140000_fee_transaction_dangling_feeid_self_heal'
        ? FEE_SQL
        : FLAG_SQL,
})

function makeGate(pendingNames: string[], appliedNames: string[]): HistoryGate {
  const names = [...pendingNames, ...appliedNames]
  return {
    repo: names.map(repoMigration),
    applied: appliedNames.map((name) => ({
      migration_name: name,
      checksum: '0'.repeat(64),
      finished: true,
      rolled_back: false,
      applied_steps_count: 1,
    })),
    pending: pendingNames.map(repoMigration),
    unknown: [],
    failed: [],
    checksumDivergences: [],
    repairableDivergence: null,
    outOfOrder: [],
    problems: [],
  }
}

/** Mock the Supabase Management API: pg_constraint rows decide which
 *  constraint names "exist"; pg_indexes / information_schema / table counts
 *  return empty sets. */
const realFetch = globalThis.fetch
let constraintExists = false

function installMockApi(): void {
  process.env.SUPABASE_ACCESS_TOKEN = 'test-token'
  process.env.SUPABASE_PROJECT_REF = 'test-ref'
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as Request).url)
    if (!url.includes('/database/query')) return realFetch(input as RequestInfo, init)
    const body = JSON.parse(String(init?.body ?? '{}')) as { query: string }
    const q = body.query
    if (q.includes('FROM pg_constraint') && q.includes('conname')) {
      return new Response(JSON.stringify(constraintExists ? [{ conname: 'FeeTransaction_studentId_fkey' }] : []), { status: 200 })
    }
    if (q.includes('FROM pg_indexes')) return new Response(JSON.stringify([]), { status: 200 })
    if (q.includes('information_schema.columns')) return new Response(JSON.stringify([]), { status: 200 })
    if (q.includes('information_schema.tables')) return new Response(JSON.stringify([{ table_name: 'User' }]), { status: 200 })
    if (q.includes('count(*)') && q.includes('pg_class')) return new Response(JSON.stringify([{ n: 0 }]), { status: 200 })
    if (q.startsWith('SELECT count')) return new Response(JSON.stringify([{ n: 0 }]), { status: 200 })
    return new Response(JSON.stringify([]), { status: 200 })
  }) as typeof fetch
}

// ─── 1. expectation mapping ────────────────────────────────────────────────

describe('MIGRATION_EXPECTATIONS — FK-hardening mapping', () => {
  test('20261013120000 maps to the FeeTransaction_studentId_fkey constraint', () => {
    const expectation = MIGRATION_EXPECTATIONS['20261013120000_fee_transaction_student_fk']
    expect(expectation).toBeDefined()
    expect(expectation?.constraints).toContain('FeeTransaction_studentId_fkey')
  })

  test('the constraint name matches the migration.sql ADD CONSTRAINT line', () => {
    expect(SQL).toContain('ADD CONSTRAINT "FeeTransaction_studentId_fkey"')
  })
})

// ─── 2. evaluateExpectations constraint bucket ─────────────────────────────

describe('evaluateExpectations — constraint object gate', () => {
  beforeEach(() => installMockApi())
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.SUPABASE_ACCESS_TOKEN
    delete process.env.SUPABASE_PROJECT_REF
  })

  test('constraint MISSING while migration is PENDING → clean (no drift)', async () => {
    constraintExists = false
    const gate = makeGate(['20261013120000_fee_transaction_student_fk'], [])
    const result = await evaluateExpectations(gate)
    expect(result.pendingViolations).toEqual([])
    expect(result.appliedViolations).toEqual([])
  })

  test('constraint EXISTS while migration is PENDING → drift violation (STOP)', async () => {
    constraintExists = true
    const gate = makeGate(['20261013120000_fee_transaction_student_fk'], [])
    const result = await evaluateExpectations(gate)
    expect(result.pendingViolations).toHaveLength(1)
    expect(result.pendingViolations[0]).toContain('20261013120000_fee_transaction_student_fk')
    expect(result.pendingViolations[0]).toContain('FeeTransaction_studentId_fkey')
    expect(result.pendingViolations[0]).toContain('PENDING')
  })

  test('constraint MISSING although migration is APPLIED → violation (silent non-apply)', async () => {
    constraintExists = false
    const gate = makeGate([], ['20261013120000_fee_transaction_student_fk'])
    const result = await evaluateExpectations(gate)
    expect(result.appliedViolations).toHaveLength(1)
    expect(result.appliedViolations[0]).toContain('missing although migration is APPLIED')
  })

  test('constraint EXISTS and migration is APPLIED → clean', async () => {
    constraintExists = true
    const gate = makeGate([], ['20261013120000_fee_transaction_student_fk'])
    const result = await evaluateExpectations(gate)
    expect(result.pendingViolations).toEqual([])
    expect(result.appliedViolations).toEqual([])
  })
})

// ─── 3. verify.ts source-level contract ────────────────────────────────────

describe('verify.ts — stage B/D contracts (source-level)', () => {
  const verifySrc = readFileSync(join(ROOT, 'scripts/prod-migration/verify.ts'), 'utf8')

  test('stage B probes the FK constraint name AND its referential behavior', () => {
    expect(verifySrc).toContain("conname = 'FeeTransaction_studentId_fkey'")
    expect(verifySrc).toContain('ON DELETE SET NULL')
    expect(verifySrc).toContain('ON UPDATE CASCADE')
  })

  test('stage B fails when the constraint is missing', () => {
    expect(verifySrc).toContain('constraint missing (20261013120000 not in effect)')
  })

  test('stage D asserts the global honest-signal invariant', () => {
    expect(verifySrc).toContain('neverSetOwnPasswordUnflagged')
    expect(verifySrc).toContain('honest-signal invariant violations')
  })
})

// ─── 4. lib.ts userState predicate parity ─────────────────────────────────

describe('userState honest-signal predicate parity', () => {
  const libSrc = readFileSync(join(ROOT, 'scripts/prod-migration/lib.ts'), 'utf8')

  test('UserState exposes neverSetOwnPasswordUnflagged', () => {
    expect(libSrc).toContain('neverSetOwnPasswordUnflagged: number | null')
  })

  test('the counting predicate matches the migration predicate exactly', () => {
    // migration: passwordChangedAt IS NULL AND mustChangePassword = false
    // counting:  passwordChangedAt IS NULL AND mustChangePassword <> true
    // (equivalent for a NOT NULL boolean column)
    expect(FLAG_SQL).toContain('"passwordChangedAt" IS NULL AND "mustChangePassword" = false')
    expect(libSrc).toContain('"passwordChangedAt" IS NULL AND "mustChangePassword" <> true')
  })
})

// ─── 5. migration SQL contracts (ledger preservation) ──────────────────────

describe('pending migration SQL contracts', () => {
  test('FK migration self-heals BEFORE enforcing (UPDATE precedes ADD CONSTRAINT)', () => {
    const healIndex = SQL.indexOf('UPDATE "FeeTransaction"')
    const constraintIndex = SQL.indexOf('ADD CONSTRAINT')
    expect(healIndex).toBeGreaterThan(-1)
    expect(constraintIndex).toBeGreaterThan(healIndex)
  })

  test('FK migration never deletes financial rows or rewrites receipts', () => {
    expect(SQL).not.toContain('DELETE FROM')
    expect(SQL).not.toMatch(/receiptNo/)
  })

  test('FK referential behavior preserves the ledger on student delete', () => {
    expect(SQL).toContain('ON DELETE SET NULL')
    expect(SQL).toContain('ON UPDATE CASCADE')
  })

  test('flag migration never rewrites password hashes', () => {
    expect(FLAG_SQL).not.toMatch(/passwordHash|password_hash/)
    expect(FLAG_SQL).not.toContain('DELETE FROM')
    expect(FLAG_SQL).toContain('"mustChangePassword" = true')
  })
})

// ─── 6. guard-safe self-heal contracts (B-4b) ──────────────────────────────
//
// B-3 proved the merged self-heal UPDATE could never commit: production's 3
// legacy orphan rows carry a SECOND dangling pointer (feeId), and the feeId
// branch of tg_guard_FT_upd (→ tg_guard_FT_ins_fn) rejects ANY update of such
// rows — even a no-op on an unrelated column. The migration must therefore
// suspend exactly that UPDATE guard for exactly the one self-heal statement,
// inside its own single transaction (transactional DDL rolls the trigger
// state back on failure), and re-enable it before the constraint is added.

/** SQL with `--` line comments stripped: the order/substring checks below
 *  reason about EXECUTABLE statements only (the explanatory comment block
 *  mentions DISABLE/ENABLE TRIGGER and feeId, which would otherwise
 *  false-match). */
const SQL_CODE = SQL.replace(/--[^\n]*/g, '')

describe('guard-safe self-heal SQL contracts (B-4b)', () => {
  test('guard window: DISABLE TRIGGER before the self-heal UPDATE; ENABLE TRIGGER after it and before ADD CONSTRAINT', () => {
    const disableIndex = SQL_CODE.indexOf('DISABLE TRIGGER')
    const healIndex = SQL_CODE.indexOf('UPDATE "FeeTransaction"')
    const enableIndex = SQL_CODE.indexOf('ENABLE TRIGGER')
    const constraintIndex = SQL_CODE.indexOf('ADD CONSTRAINT')
    expect(disableIndex).toBeGreaterThan(-1)
    expect(healIndex).toBeGreaterThan(disableIndex)
    expect(enableIndex).toBeGreaterThan(healIndex)
    expect(constraintIndex).toBeGreaterThan(enableIndex)
  })

  test('only the UPDATE guard is disabled — no other trigger name in any DISABLE statement', () => {
    const disableStatements = SQL_CODE.match(/DISABLE TRIGGER[^;]*;/g) ?? []
    expect(disableStatements.length).toBeGreaterThan(0)
    for (const stmt of disableStatements) {
      expect(stmt).toContain('"tg_guard_FT_upd"')
      expect(stmt).not.toMatch(/tg_guard_FT_ins/)
      expect(stmt).not.toMatch(/\b(ALL|ALWAYS|USER|REPLICA|ORIGIN)\b/)
    }
  })

  test('the guard is re-enabled: ENABLE TRIGGER count is at least DISABLE TRIGGER count', () => {
    const disableCount = (SQL_CODE.match(/DISABLE TRIGGER/g) ?? []).length
    const enableCount = (SQL_CODE.match(/ENABLE TRIGGER/g) ?? []).length
    expect(disableCount).toBeGreaterThan(0)
    expect(enableCount).toBeGreaterThanOrEqual(disableCount)
  })

  test('feeId is never modified: no executable feeId reference; the self-heal UPDATE sets only studentId', () => {
    expect(SQL_CODE).not.toMatch(/feeId/i)
    const healStart = SQL_CODE.indexOf('UPDATE "FeeTransaction"')
    expect(healStart).toBeGreaterThan(-1)
    const healEnd = SQL_CODE.indexOf(';', healStart)
    const healStatement = SQL_CODE.slice(healStart, healEnd + 1)
    const setClause = healStatement.slice(
      healStatement.indexOf('SET'),
      healStatement.indexOf('WHERE'),
    )
    expect(setClause.trim()).toBe('SET "studentId" = NULL')
  })
})

// ─── 7. feeId FK hardening contracts (20261013140000) ──────────────────────
//
// The 3 legacy rows kept a SECOND dangling pointer after 20261013120000: their
// feeId values resolve to no Fee row in any school (the referenced Fees were
// cascade-deleted with their Student — Fee.studentId is onDelete: Cascade).
// This migration detaches those dead pointers (NULL is the sanctioned
// "no live Fee to apply to" state — the online order routes persist
// feeId: null by design) and then enforces the FK so no future Fee deletion
// can strand a dangling pointer again.

const FEE_SQL_CODE = FEE_SQL.replace(/--[^\n]*/g, '')

describe('feeId FK hardening — expectation mapping and gate', () => {
  test('20261013140000 maps to the FeeTransaction_feeId_fkey constraint', () => {
    const expectation = MIGRATION_EXPECTATIONS['20261013140000_fee_transaction_dangling_feeid_self_heal']
    expect(expectation).toBeDefined()
    expect(expectation?.constraints).toContain('FeeTransaction_feeId_fkey')
  })

  test('the constraint name matches the migration.sql ADD CONSTRAINT line', () => {
    expect(FEE_SQL).toContain('ADD CONSTRAINT "FeeTransaction_feeId_fkey"')
  })
})

describe('evaluateExpectations — feeId constraint object gate', () => {
  const realFetch2 = globalThis.fetch
  let feeConstraintExists = false

  function installFeeMockApi(): void {
    process.env.SUPABASE_ACCESS_TOKEN = 'test-token'
    process.env.SUPABASE_PROJECT_REF = 'test-ref'
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as Request).url)
      if (!url.includes('/database/query')) return realFetch2(input as RequestInfo, init)
      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string }
      const q = body.query
      if (q.includes('FROM pg_constraint') && q.includes('conname')) {
        const rows: Array<Record<string, string>> = []
        if (feeConstraintExists) rows.push({ conname: 'FeeTransaction_feeId_fkey' })
        return new Response(JSON.stringify(rows), { status: 200 })
      }
      if (q.includes('FROM pg_indexes')) return new Response(JSON.stringify([]), { status: 200 })
      if (q.includes('information_schema.columns')) return new Response(JSON.stringify([]), { status: 200 })
      if (q.includes('information_schema.tables')) return new Response(JSON.stringify([{ table_name: 'User' }]), { status: 200 })
      if (q.includes('count(*)') && q.includes('pg_class')) return new Response(JSON.stringify([{ n: 0 }]), { status: 200 })
      if (q.startsWith('SELECT count')) return new Response(JSON.stringify([{ n: 0 }]), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }) as typeof fetch
  }

  beforeEach(() => installFeeMockApi())
  afterEach(() => {
    globalThis.fetch = realFetch2
    delete process.env.SUPABASE_ACCESS_TOKEN
    delete process.env.SUPABASE_PROJECT_REF
  })

  test('feeId constraint MISSING while migration is PENDING → clean (no drift)', async () => {
    feeConstraintExists = false
    const gate = makeGate(['20261013140000_fee_transaction_dangling_feeid_self_heal'], [])
    const result = await evaluateExpectations(gate)
    expect(result.pendingViolations).toEqual([])
    expect(result.appliedViolations).toEqual([])
  })

  test('feeId constraint EXISTS while migration is PENDING → drift violation (STOP)', async () => {
    feeConstraintExists = true
    const gate = makeGate(['20261013140000_fee_transaction_dangling_feeid_self_heal'], [])
    const result = await evaluateExpectations(gate)
    expect(result.pendingViolations).toHaveLength(1)
    expect(result.pendingViolations[0]).toContain('20261013140000_fee_transaction_dangling_feeid_self_heal')
    expect(result.pendingViolations[0]).toContain('FeeTransaction_feeId_fkey')
    expect(result.pendingViolations[0]).toContain('PENDING')
  })

  test('feeId constraint MISSING although migration is APPLIED → violation (silent non-apply)', async () => {
    feeConstraintExists = false
    const gate = makeGate([], ['20261013140000_fee_transaction_dangling_feeid_self_heal'])
    const result = await evaluateExpectations(gate)
    expect(result.appliedViolations).toHaveLength(1)
    expect(result.appliedViolations[0]).toContain('missing although migration is APPLIED')
  })
})

describe('feeId FK hardening — verify.ts source-level contract', () => {
  const verifySrc = readFileSync(join(ROOT, 'scripts/prod-migration/verify.ts'), 'utf8')

  test('stage B probes the feeId FK constraint name AND its referential behavior', () => {
    expect(verifySrc).toContain("conname = 'FeeTransaction_feeId_fkey'")
    expect(verifySrc).toContain('constraint missing (20261013140000 not in effect)')
  })

  test('stage B holds the post-heal invariant: zero dangling feeId references', () => {
    expect(verifySrc).toContain('dangling FeeTransaction.feeId references remain')
    // the invariant query must be SCHOOL-SCOPED like the guard's feeId branch
    expect(verifySrc).toContain('f."schoolId" = ft."schoolId"')
  })
})

describe('feeId self-heal SQL contracts (guard-safe, school-scoped)', () => {
  test('guard window: DISABLE TRIGGER before the self-heal UPDATE; ENABLE TRIGGER after it and before ADD CONSTRAINT', () => {
    const disableIndex = FEE_SQL_CODE.indexOf('DISABLE TRIGGER')
    const healIndex = FEE_SQL_CODE.indexOf('UPDATE "FeeTransaction"')
    const enableIndex = FEE_SQL_CODE.indexOf('ENABLE TRIGGER')
    const constraintIndex = FEE_SQL_CODE.indexOf('ADD CONSTRAINT')
    expect(disableIndex).toBeGreaterThan(-1)
    expect(healIndex).toBeGreaterThan(disableIndex)
    expect(enableIndex).toBeGreaterThan(healIndex)
    expect(constraintIndex).toBeGreaterThan(enableIndex)
  })

  test('only the UPDATE guard is disabled — no other trigger name in any DISABLE statement', () => {
    const disableStatements = FEE_SQL_CODE.match(/DISABLE TRIGGER[^;]*;/g) ?? []
    expect(disableStatements.length).toBeGreaterThan(0)
    for (const stmt of disableStatements) {
      expect(stmt).toContain('"tg_guard_FT_upd"')
      expect(stmt).not.toMatch(/tg_guard_FT_ins/)
      expect(stmt).not.toMatch(/\b(ALL|ALWAYS|USER|REPLICA|ORIGIN)\b/)
    }
  })

  test('the guard is re-enabled: ENABLE TRIGGER count is at least DISABLE TRIGGER count', () => {
    const disableCount = (FEE_SQL_CODE.match(/DISABLE TRIGGER/g) ?? []).length
    const enableCount = (FEE_SQL_CODE.match(/ENABLE TRIGGER/g) ?? []).length
    expect(disableCount).toBeGreaterThan(0)
    expect(enableCount).toBeGreaterThanOrEqual(disableCount)
  })

  test('the self-heal UPDATE sets ONLY feeId = NULL (studentId untouched — 20261013120000 already healed it)', () => {
    const healStart = FEE_SQL_CODE.indexOf('UPDATE "FeeTransaction"')
    expect(healStart).toBeGreaterThan(-1)
    const healEnd = FEE_SQL_CODE.indexOf(';', healStart)
    const healStatement = FEE_SQL_CODE.slice(healStart, healEnd + 1)
    const setClause = healStatement.slice(
      healStatement.indexOf('SET'),
      healStatement.indexOf('WHERE'),
    )
    expect(setClause.trim()).toBe('SET "feeId" = NULL')
    expect(healStatement).not.toMatch(/studentId/)
  })

  test('the heal predicate is SCHOOL-SCOPED — it mirrors the tenant guard\'s feeId branch exactly', () => {
    const healStart = FEE_SQL_CODE.indexOf('UPDATE "FeeTransaction"')
    const healEnd = FEE_SQL_CODE.indexOf(';', healStart)
    const healStatement = FEE_SQL_CODE.slice(healStart, healEnd + 1)
    expect(healStatement).toContain('"feeId" IS NOT NULL')
    expect(healStatement).toContain('"Fee"."id" = "FeeTransaction"."feeId"')
    expect(healStatement).toContain('"Fee"."schoolId" = "FeeTransaction"."schoolId"')
  })

  test('feeId FK referential behavior preserves the ledger on Fee delete', () => {
    expect(FEE_SQL).toContain('ON DELETE SET NULL')
    expect(FEE_SQL).toContain('ON UPDATE CASCADE')
  })

  test('ledger preservation: no DELETE, no receipt rewriting, no hash rewriting', () => {
    expect(FEE_SQL_CODE).not.toContain('DELETE FROM')
    expect(FEE_SQL_CODE).not.toMatch(/receiptNo/)
    expect(FEE_SQL_CODE).not.toMatch(/passwordHash/)
  })
})

// ─── 8. verify.ts trigger-state contract (feeId-FK era) ────────────────────
//
// The migration suspends tg_guard_FT_upd for exactly its one self-heal
// statement (transactional DDL — failure rolls the trigger back to enabled).
// Post-apply, BOTH FeeTransaction tenant guards must be present and ENABLED
// (tgenabled = 'O') and bound to tg_guard_FT_ins_fn — verify.ts holds this
// fail-closed: a disabled or missing guard is an open tenant-isolation hole.

describe('verify.ts — tenant-guard trigger-state contract', () => {
  const verifySrc = readFileSync(join(ROOT, 'scripts/prod-migration/verify.ts'), 'utf8')

  test('stage B probes BOTH guard triggers and their enabled state', () => {
    expect(verifySrc).toContain("'tg_guard_FT_ins', 'tg_guard_FT_upd'")
    expect(verifySrc).toContain("t.tgenabled !== 'O'")
    expect(verifySrc).toContain('tg_guard_FT_ins_fn')
  })

  test('missing / disabled / re-bound triggers each fail closed', () => {
    expect(verifySrc).toContain('tenant-guard trigger ')
    expect(verifySrc).toContain('is disabled (tgenabled')
    expect(verifySrc).toContain('missing on FeeTransaction')
    expect(verifySrc).toContain('bound to unexpected function')
  })

  test('the trigger probe is scoped to FeeTransaction and excludes internal triggers', () => {
    expect(verifySrc).toContain(`t.tgrelid = '"FeeTransaction"'::regclass`)
    expect(verifySrc).toContain('NOT t.tgisinternal')
  })
})

// ─── 9. financial-integrity digest contract (privacy-safe) ─────────────────
//
// Preflight captures a DB-clock cutoff + md5 digest over the immutable
// financial columns (receiptNo | studentId | amount); verify recomputes the
// SAME cutoff window and fails on divergence. feeId is deliberately excluded
// (the sanctioned heal detaches dead pointers); organic growth after the
// snapshot is excluded by the cutoff on both sides.

describe('financial-integrity digest — source-level contracts', () => {
  const libSrc = readFileSync(join(ROOT, 'scripts/prod-migration/lib.ts'), 'utf8')
  const preflightSrc = readFileSync(join(ROOT, 'scripts/prod-migration/preflight.ts'), 'utf8')
  const verifySrc = readFileSync(join(ROOT, 'scripts/prod-migration/verify.ts'), 'utf8')

  test('the digest covers receiptNo, studentId and amount — and NEVER feeId (the heal column)', () => {
    expect(libSrc).toContain(`COALESCE("receiptNo", '<null>')`)
    expect(libSrc).toContain(`COALESCE("studentId", '<null>')`)
    expect(libSrc).toContain(`"amount"::text`)
    const digestStart = libSrc.indexOf('string_agg(')
    const digestEnd = libSrc.indexOf('ORDER BY "id"')
    expect(digestStart).toBeGreaterThan(-1)
    expect(digestEnd).toBeGreaterThan(digestStart)
    expect(libSrc.slice(digestStart, digestEnd)).not.toMatch(/feeId/i)
  })

  test('preflight captures cutoff (DB clock) + digest into the snapshot', () => {
    expect(preflightSrc).toContain('dbNow()')
    expect(preflightSrc).toContain('financialIntegrity(finCutoff)')
    expect(preflightSrc).toContain('financialIntegrity: finIntegrity')
  })

  test('verify FAILS CLOSED when the snapshot lacks the digest evidence', () => {
    expect(verifySrc).toContain('snapshot lacks financialIntegrity')
  })

  test('verify recomputes the SAME cutoff window and gates on digest/rows/sum', () => {
    expect(verifySrc).toContain('financialIntegrity(before.cutoff)')
    expect(verifySrc).toContain('financial digest CHANGED')
    expect(verifySrc).toContain('ledger rows CHANGED within the snapshot window')
    expect(verifySrc).toContain('amount sum changed within the snapshot window')
  })

  test('the digest is privacy-safe: values are hashed, only counts and the md5 are logged', () => {
    expect(libSrc).toContain('md5(')
    expect(verifySrc).toContain('values never read')
    // the preflight digest query never selects row-level receiptNo/amount columns
    const fiStart = libSrc.indexOf('export async function financialIntegrity')
    const fiEnd = libSrc.indexOf('export async function productionHealth')
    const fiSrc = libSrc.slice(fiStart, fiEnd)
    expect(fiSrc).not.toMatch(/SELECT\s+"receiptNo"/)
    expect(fiSrc).not.toMatch(/SELECT\s+"amount"\s+FROM/)
  })
})

// ─── 10. financialIntegrity() behavior against the mocked API ──────────────

describe('financialIntegrity() — mocked Management API', () => {
  const realFetch2 = globalThis.fetch
  let capturedQuery = ''

  function installDigestMock(row: Record<string, unknown>): void {
    process.env.SUPABASE_ACCESS_TOKEN = 'test-token'
    process.env.SUPABASE_PROJECT_REF = 'test-ref'
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as Request).url)
      if (!url.includes('/database/query')) return realFetch2(input as RequestInfo, init)
      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string }
      capturedQuery = body.query
      return new Response(JSON.stringify([row]), { status: 200 })
    }) as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = realFetch2
    delete process.env.SUPABASE_ACCESS_TOKEN
    delete process.env.SUPABASE_PROJECT_REF
    capturedQuery = ''
  })

  test('maps the API row into rows/feeIdNotNull/amountSum/ledgerDigest', async () => {
    installDigestMock({ n_rows: 226, fee_id_not_null: 226, amount_sum: '123456.78', ledger_digest: 'a'.repeat(32) })
    const fi = await financialIntegrity('2026-10-13 01:00:00.123456+00')
    expect(fi.rows).toBe(226)
    expect(fi.feeIdNotNull).toBe(226)
    expect(fi.amountSum).toBe('123456.78')
    expect(fi.ledgerDigest).toBe('a'.repeat(32))
    expect(fi.cutoff).toBe('2026-10-13 01:00:00.123456+00')
  })

  test('the digest query is cutoff-scoped when a cutoff is passed', async () => {
    installDigestMock({ n_rows: 0, fee_id_not_null: 0, amount_sum: '0', ledger_digest: 'b'.repeat(32) })
    await financialIntegrity('2026-10-13 01:00:00.123456+00')
    expect(capturedQuery).toContain('WHERE "createdAt" <=')
    expect(capturedQuery).toContain(`'2026-10-13 01:00:00.123456+00'::timestamptz`)
  })

  test('without a cutoff the query is unscoped (full ledger)', async () => {
    installDigestMock({ n_rows: 0, fee_id_not_null: 0, amount_sum: '0', ledger_digest: 'b'.repeat(32) })
    const fi = await financialIntegrity()
    expect(fi.cutoff).toBe('')
    expect(capturedQuery).not.toContain('WHERE "createdAt" <=')
  })

  test('dbNow() reads the DB clock (clock_timestamp)', async () => {
    installDigestMock({ now: '2026-10-13 01:00:00.654321+00' })
    const now = await dbNow()
    expect(now).toBe('2026-10-13 01:00:00.654321+00')
    expect(capturedQuery).toContain('clock_timestamp()')
  })
})
