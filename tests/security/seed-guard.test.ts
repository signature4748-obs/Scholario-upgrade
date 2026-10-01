/**
 * PHASE 8A — production seed lock (mission §"production starts clean").
 *
 * THE INVARIANT UNDER TEST:
 *   prisma/seed-guard.ts `assertSeedable(label)` is the shared fail-safe
 *   every seed script calls BEFORE touching the database. The demo corpus
 *   (Sunrise Academy full corpus + Green Valley clean skeleton) is
 *   development/integration acceptance data — it must NEVER be writable
 *   against a production declaration, and a Supabase DATABASE_URL with
 *   DATABASE_ENV UNSET must refuse (an unset variable must never silently
 *   default to "go ahead").
 *
 * Unit test — no DB, no server. process.env is snapshotted and restored
 * around every case so the suite is hermetic regardless of the shell
 * (bun auto-loads .env: DATABASE_URL here points at Supabase with
 * DATABASE_ENV=development — the sanctioned integration state).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { assertSeedable, SeedGuardError } from '../../prisma/seed-guard'

const T = 45_000

// ── env snapshot / restore ──────────────────────────────────────────────────

const KEYS = ['DATABASE_ENV', 'DATABASE_URL', 'NODE_ENV'] as const
let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = {}
  for (const k of KEYS) snapshot[k] = process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

/** A non-Supabase URL (case (a)/(b) isolate the production-declaration rule). */
const PLAIN_URL = 'postgresql://postgres:localpw@localhost:5432/scholario'
/** The integration Supabase URL shape (pooler host — contains 'supabase'). */
const SUPABASE_URL = 'postgresql://postgres.projectref:secretpw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'

describe('Phase 8A · seed-guard production lock (unit)', () => {
  test('(a) DATABASE_ENV=production → REFUSES even on a plain local URL', () => {
    delete process.env.NODE_ENV
    process.env.DATABASE_ENV = 'production'
    process.env.DATABASE_URL = PLAIN_URL
    expect(() => assertSeedable('seed-guard-probe')).toThrow(SeedGuardError)
    try {
      assertSeedable('seed-guard-probe')
    } catch (e) {
      const err = e as SeedGuardError
      expect(err.name).toBe('SeedGuardError')
      expect(err.message).toContain('REFUSING to seed')
      expect(err.message).toContain('Production starts clean')
    }
  }, T)

  test('(b) NODE_ENV=production → REFUSES even with DATABASE_ENV=development', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_ENV = 'development'
    process.env.DATABASE_URL = PLAIN_URL
    expect(() => assertSeedable('seed-guard-probe')).toThrow(SeedGuardError)
    try {
      assertSeedable('seed-guard-probe')
    } catch (e) {
      const err = e as SeedGuardError
      // NODE_ENV=production wins even over an explicit development env.
      expect(err.message).toContain('NODE_ENV=production')
    }
  }, T)

  test('(c) Supabase DATABASE_URL + DATABASE_ENV UNSET → REFUSES (no silent default)', () => {
    delete process.env.NODE_ENV
    delete process.env.DATABASE_ENV
    process.env.DATABASE_URL = SUPABASE_URL
    expect(() => assertSeedable('seed-guard-probe')).toThrow(SeedGuardError)
    try {
      assertSeedable('seed-guard-probe')
    } catch (e) {
      const err = e as SeedGuardError
      expect(err.message).toContain('Supabase')
      expect(err.message).toContain('DATABASE_ENV unset')
    }
  }, T)

  test('(d) DATABASE_ENV=development + Supabase URL → ALLOWS (sanctioned integration state)', () => {
    delete process.env.NODE_ENV
    process.env.DATABASE_ENV = 'development'
    process.env.DATABASE_URL = SUPABASE_URL
    // Must NOT throw — the two-tenant acceptance corpus state.
    expect(assertSeedable('seed-guard-probe')).toBeUndefined()
  }, T)

  test('(e) plain URL + everything unset → ALLOWS (local file/sqlite-era shape, no lock engages)', () => {
    delete process.env.NODE_ENV
    delete process.env.DATABASE_ENV
    process.env.DATABASE_URL = PLAIN_URL
    expect(assertSeedable('seed-guard-probe')).toBeUndefined()
  }, T)

  test('whitespace DATABASE_ENV (" production ") is refused — trim() closes the bypass', () => {
    delete process.env.NODE_ENV
    process.env.DATABASE_ENV = ' production '
    process.env.DATABASE_URL = PLAIN_URL
    expect(() => assertSeedable('seed-guard-probe')).toThrow(SeedGuardError)
  }, T)

  test('whitespace-only DATABASE_ENV counts as unset for the Supabase rule', () => {
    delete process.env.NODE_ENV
    process.env.DATABASE_ENV = '   '
    process.env.DATABASE_URL = SUPABASE_URL
    expect(() => assertSeedable('seed-guard-probe')).toThrow(SeedGuardError)
  }, T)
})
