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
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  evaluateExpectations,
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

const repoMigration = (name: string): RepoMigration => ({
  name,
  path: `prisma/migrations/${name}/migration.sql`,
  checksum: '0'.repeat(64),
  sql: name === '20261013120000_fee_transaction_student_fk' ? SQL : FLAG_SQL,
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
