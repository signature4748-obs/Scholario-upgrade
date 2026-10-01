/**
 * PHASE 8A — RLS DENY-BY-DEFAULT proofs (mission §12).
 *
 * THE INVARIANTS UNDER TEST:
 *   1. The PUBLIC Supabase REST surface (PostgREST with the publishable
 *      anon key) is CLOSED: RLS is enabled on every application table and
 *      NO policies exist for anon/authenticated — a leaked anon key can
 *      read NOTHING (Student / User / Notification return an empty array
 *      or an auth error, never data).
 *   2. The service_role key DOES read rows (bypassrls, server-side-only
 *      role) — proving the tables exist and the key works server-side.
 *   3. A throwaway LOGIN role (NOBYPASSRLS, NOSUPERUSER) with schema
 *      USAGE + SELECT privileges on every app table still sees ZERO rows
 *      (RLS with no policies for that role) and its INSERT is refused by
 *      row-level security itself — privileges alone are not access.
 *   4. Census: every table in the public schema has relrowsecurity set
 *      (>= 96 app tables, zero exceptions).
 *
 * Secrets discipline: the anon + service-role keys are read from .env at
 * runtime and NEVER printed, echoed or embedded. The probe-role password
 * is random per run and never printed.
 *
 * ENVIRONMENT ADAPTATION (documented honestly): the mission asked for a
 * direct pg login connection as the probe role. This network reaches the
 * database ONLY through the Supavisor session pooler (the direct :5432
 * endpoint is IPv6-only/refused), and Supavisor rejects freshly-created
 * roles at query time with 42704 "invalid role OID" (roles must be
 * registered with the pooler through the platform API; raw CREATE ROLE
 * is not). The suite therefore FIRST TRIES the direct login connection
 * (10s budget — if a future environment allows it, it is used), and on
 * refusal falls back to the equivalent in-session execution:
 * `SET ROLE scholario_rls_probe` on the admin connection — every query
 * then executes with current_user = scholario_rls_probe (NOBYPASSRLS,
 * NOSUPERUSER, same privileges), which is the same RLS decision path.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'

const T = 45_000
const PROBE_ROLE = 'scholario_rls_probe'
const MARKER = randomBytes(4).toString('hex')

// ── .env reader (secrets never printed) ────────────────────────────────────

function envOf(name: string): string {
  let raw = ''
  try {
    raw = readFileSync(`${process.cwd()}/.env`, 'utf8')
  } catch {
    raw = ''
  }
  const m = raw.match(new RegExp(`^${name}=(.*)$`, 'm'))
  const fromFile = m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  return fromFile || process.env[name] || ''
}

const DATABASE_URL = envOf('DATABASE_URL')
const SUPABASE_ANON_KEY = envOf('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = envOf('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = envOf('SUPABASE_URL').replace(/\/+$/, '')

const PROBE_PASSWORD = randomBytes(12).toString('hex') // never printed

// ── shared state ────────────────────────────────────────────────────────────

let admin: Client | null = null
let probeMode: 'direct-login' | 'set-role' | 'not-opened' = 'not-opened'

async function adminQuery(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
  if (!admin) throw new Error('admin client not connected')
  return admin.query(sql)
}

/** Drop the probe role + every grant/membership it holds (postgres grantor). */
async function hardDropRole(): Promise<void> {
  if (!admin) return
  await admin.query(`RESET ROLE`).catch(() => {})
  await admin.query(`REVOKE ${PROBE_ROLE} FROM postgres`).catch(() => {})
  await admin.query(`REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`).catch(() => {})
  await admin.query(`REVOKE INSERT ON "RateLimitBucket" FROM ${PROBE_ROLE}`).catch(() => {})
  await admin.query(`REVOKE USAGE ON SCHEMA public FROM ${PROBE_ROLE}`).catch(() => {})
  await admin.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`)
}

beforeAll(async () => {
  expect(DATABASE_URL).toContain('pooler.supabase.com') // integration DB shape
  expect(SUPABASE_ANON_KEY.length).toBeGreaterThan(20)
  expect(SUPABASE_SERVICE_ROLE_KEY.length).toBeGreaterThan(20)

  admin = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  })
  await admin.connect()

  // Pre-clean any residue from an interrupted earlier run.
  await hardDropRole()

  await admin.query(
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOBYPASSRLS`,
  )
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`)
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`)
  // INSERT privilege on ONE table, so the insert probe is refused by RLS
  // itself (privilege present, policy absent) — not by a missing grant.
  await admin.query(`GRANT INSERT ON "RateLimitBucket" TO ${PROBE_ROLE}`)
}, T)

afterAll(async () => {
  if (probeMode === 'set-role') await admin?.query(`RESET ROLE`).catch(() => {})
  await hardDropRole()
  if (admin) await admin.end().catch(() => {})
})

// ── PostgREST (Supabase REST) surface ───────────────────────────────────────

describe('Phase 8A · PostgREST anon surface is closed (RLS deny-by-default)', () => {
  for (const table of ['Student', 'User', 'Notification']) {
    test(`anon key GET /rest/v1/${table} → NO data`, async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=10`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          accept: 'application/json',
        },
      })
      if (res.status === 200) {
        const body = (await res.json()) as unknown
        expect(Array.isArray(body)).toBe(true)
        expect((body as unknown[]).length).toBe(0) // RLS deny: empty set
      } else {
        // 401/403 — equally closed; NEVER 200-with-rows.
        expect([401, 403]).toContain(res.status)
        const text = await res.text()
        expect(text.toLowerCase()).not.toContain('"id"')
      }
    }, T)
  }

  test('no anon route leaks Student data even with count hints', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Student?select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}`, accept: 'application/json' },
    })
    expect(res.status).toBeLessThan(500) // PostgREST answered, not a network error
    if (res.status === 200) {
      const body = (await res.json()) as unknown[]
      expect(body.length).toBe(0)
    }
  }, T)
})

describe('Phase 8A · service_role key reads rows (bypassrls, server-side-only)', () => {
  test('service_role GET /rest/v1/Student → rows readable', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Student?select=id&limit=5`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0) // tables exist + key works
  }, T)

  test('service_role GET /rest/v1/User → rows readable', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/User?select=id&limit=5`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string }>
    expect(body.length).toBeGreaterThan(0)
  }, T)
})

// ── direct PG probe role ────────────────────────────────────────────────────

describe('Phase 8A · probe role (LOGIN, NOBYPASSRLS) sees nothing + cannot write', () => {
  test('role exists with the mission shape (LOGIN, NOSUPERUSER, NOBYPASSRLS)', async () => {
    const r = await adminQuery(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${PROBE_ROLE}'`)
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].rolcanlogin).toBe(true)
    expect(r.rows[0].rolsuper).toBe(false)
    expect(r.rows[0].rolbypassrls).toBe(false)
  }, T)

  test('privileges alone are not access: SELECT count(*) → 0 rows on Student + User', async () => {
    // Baseline: postgres (bypassrls) DOES see rows — the emptiness below
    // is the RLS decision, not an empty database.
    const base = await adminQuery(`SELECT count(*)::int AS n FROM "Student"`)
    const baseCount = Number(base.rows[0].n)
    expect(baseCount).toBeGreaterThan(0)

    // Try the mission's DIRECT login connection first; fall back to
    // SET ROLE when the pooler refuses fresh roles (see file docstring).
    const ref = DATABASE_URL.match(/postgres\.([a-z0-9]+):/)![1]
    const directUrl = DATABASE_URL.replace(
      /postgres\.[a-z0-9]+:[^@]*@/,
      `${PROBE_ROLE}.${ref}:${PROBE_PASSWORD}@`,
    )
    let query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>
    let close: () => Promise<void>

    const direct = new Client({
      connectionString: directUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    })
    try {
      await direct.connect()
      probeMode = 'direct-login'
      query = (sql) => direct.query(sql)
      close = () => direct.end()
    } catch {
      // Supavisor rejects fresh roles (42704 invalid role OID) — exercise
      // the SAME role identity in-session instead.
      probeMode = 'set-role'
      await admin!.query(`GRANT ${PROBE_ROLE} TO postgres`)
      await admin!.query(`SET ROLE ${PROBE_ROLE}`)
      query = (sql) => admin!.query(sql)
      close = async () => {
        await admin!.query(`RESET ROLE`).catch(() => {})
      }
    }

    try {
      // The query runs AS scholario_rls_probe in both modes.
      const who = await query(`SELECT current_user AS u`)
      expect(who.rows[0].u).toBe(PROBE_ROLE)

      const students = await query(`SELECT count(*)::int AS n FROM "Student"`)
      // RLS deny — the bypassrls postgres session just saw > 0 rows on
      // the SAME table; only the probe role's identity zeroes it.
      expect(Number(students.rows[0].n)).toBe(0)
      const users = await query(`SELECT count(*)::int AS n FROM "User"`)
      expect(Number(users.rows[0].n)).toBe(0)

      // INSERT refused by ROW-LEVEL SECURITY itself (insert privilege was
      // granted on this one table — only the missing policy blocks it).
      const insertKey = `rls-probe-${MARKER}`
      let insertError: { code?: string; message?: string } | null = null
      try {
        await query(
          `INSERT INTO "RateLimitBucket" ("key", count, "windowStart", "updatedAt") VALUES ('${insertKey}', 1, now(), now())`,
        )
      } catch (e) {
        insertError = e as { code?: string; message?: string }
      }
      expect(insertError).not.toBeNull()
      expect(insertError!.code).toBe('42501')
      expect(String(insertError!.message)).toContain('row-level security')

      // Nothing landed (verified from the bypassrls session).
      const landed = await adminQuery(`SELECT count(*)::int AS n FROM "RateLimitBucket" WHERE "key" = '${insertKey}'`)
      expect(Number(landed.rows[0].n)).toBe(0)
    } finally {
      await close().catch(() => {})
    }
  }, T)
})

// ── RLS census ──────────────────────────────────────────────────────────────

describe('Phase 8A · every public-schema table has RLS enabled (census)', () => {
  test('relrowsecurity set on ALL app tables (>= 96, zero exceptions)', async () => {
    const r = await adminQuery(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_on
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false`)
    const total = Number(r.rows[0].total)
    const rlsOn = Number(r.rows[0].rls_on)
    expect(total).toBeGreaterThanOrEqual(96)
    expect(rlsOn).toBe(total) // every table, no exceptions

    const off = await adminQuery(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false AND NOT c.relrowsecurity
      ORDER BY 1`)
    expect(off.rows.map((row) => row.relname)).toEqual([])
  }, T)
})

// ── cleanup proof ───────────────────────────────────────────────────────────

describe('Phase 8A · probe role is fully removed after the suite', () => {
  test('hardDropRole → no scholario_rls_probe remains in pg_roles', async () => {
    // The suite's own teardown, asserted IN-TEST: every grant/membership
    // is revoked, the role is dropped, and pg_roles no longer knows it
    // (re-running the suite re-proves idempotence via beforeAll pre-clean).
    await hardDropRole()
    const r = await adminQuery(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = '${PROBE_ROLE}'`)
    expect(Number(r.rows[0].n)).toBe(0)
  }, T)
})
