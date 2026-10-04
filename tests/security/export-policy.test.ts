import { db } from '../helpers/db'
/**
 * PIH-5 — INVARIANT: the bulk CSV export policy.
 *
 * THE INVARIANTS UNDER TEST (PIH-4a fix 2 — /api/export hardening):
 *   1. ROLE GATE (matrix-aligned): TEACHER and STUDENT are refused 403 on
 *      /api/export?type=students (bulk student PII is 'school.students.
 *      export' → PRINCIPAL/MANAGEMENT); the demo PRINCIPAL gets 200 with
 *      a text/csv attachment.
 *   2. CSV FORMULA NEUTRALIZATION (OWASP): a seeded student whose name
 *      starts with '=' is rendered with the leading apostrophe guard and
 *      NEVER as an unescaped formula cell.
 *   3. RATE LIMIT (30/h per user — RATE_LIMITS.export): a throwaway
 *      MANAGEMENT principal fires 31 rapid exports — the first 30 are
 *      200, the 31st is 429 RATE_LIMITED with a numeric Retry-After.
 *      (The throwaway user owns a FRESH per-user bucket, so the boundary
 *      is deterministic and no real account's budget is burned.)
 *   4. SUSPENDED TENANT fail-closed: a suspended school's principal
 *      cannot export (403 through the withUser access policy); recovery
 *      restores the same session's access (the phase75 suspension
 *      pattern, applied to THIS surface).
 *
 * Conventions match tests/security/tenant-isolation.test.ts and
 * tests/security/phase75-product.test.ts: dev server (TENANT_TEST_BASE,
 * default :3000), sessions minted as DIRECT ROWS (bypasses ONLY the login
 * limiter — never an authorization gate), cookie transport via a manual
 * cookie jar, cleanup of every row this suite creates.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { DEMO_STUDENT_EMAIL } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000 // generous: first-hit dev compilation (tenant-isolation precedent)

const MARKER = randomBytes(4).toString('hex')

// ── fixtures ───────────────────────────────────────────────────────────────
let schoolA = { id: '' } // demo school (the CSV seeding target)
let schoolB = { id: '' } // green-valley (the clean tenant — suspension probe target)
let teacher1 = { id: '', email: 'teacher1@hawkingshigh.edu' }
let student1 = { id: '', email: DEMO_STUDENT_EMAIL }
let principalA = { id: '', email: 'principal@hawkingshigh.edu' }
let principalB = { id: '', email: 'principal.b@greenvalley.test' }
let teacherToken = ''
let studentToken = ''
let principalAToken = ''
let principalBToken = ''
let rateLimitUser = { id: '', email: '' }
let rateLimitToken = ''
const suiteStart = new Date()

const EVIL_NAME = '=HYPERLINK("http://evil","x")'

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const demo = await db.school.findFirst({ where: { isDemo: true } })
  const greenValley = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!demo || !greenValley) throw new Error('fixture schools missing (run bun run seed:demo / seed:clean)')
  schoolA = { id: demo.id }
  schoolB = { id: greenValley.id }

  const byEmail = async (email: string) => {
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`fixture user missing: ${email}`)
    return u
  }
  const [t1, s1, pA, pB] = await Promise.all([
    byEmail(teacher1.email),
    byEmail(student1.email),
    byEmail(principalA.email),
    byEmail(principalB.email),
  ])
  teacher1 = { ...teacher1, id: t1.id }
  student1 = { ...student1, id: s1.id }
  principalA = { ...principalA, id: pA.id }
  principalB = { ...principalB, id: pB.id }

  teacherToken = randomBytes(32).toString('hex')
  studentToken = randomBytes(32).toString('hex')
  principalAToken = randomBytes(32).toString('hex')
  principalBToken = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      // PHASE 8A — rows store sha256(token); the RAW tokens ride the
      // cookie jar below (createSession wire contract).
      { userId: t1.id, tokenHash: hashSessionToken(teacherToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: s1.id, tokenHash: hashSessionToken(studentToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pA.id, tokenHash: hashSessionToken(principalAToken), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pB.id, tokenHash: hashSessionToken(principalBToken), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: {
        tokenHash: {
          in: [teacherToken, studentToken, principalAToken, principalBToken, rateLimitToken].map(
            hashSessionToken,
          ),
        },
      },
    }),
  )

  // Throwaway MANAGEMENT principal for the deterministic rate-limit
  // boundary: a FRESH user owns a fresh `rl:export:${userId}` bucket.
  rateLimitUser = {
    id: '',
    email: `pih5.export.${MARKER}@hawkings.test`,
  }
  const rl = await db.user.create({
    data: {
      schoolId: schoolA.id,
      email: rateLimitUser.email,
      name: `PIH5 Export Probe ${MARKER}`,
      role: 'MANAGEMENT',
      status: 'ACTIVE',
    },
  })
  rateLimitUser = { ...rateLimitUser, id: rl.id }
  rateLimitToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId: rl.id,
      tokenHash: hashSessionToken(rateLimitToken),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  // Cleanup ORDER matters: the throwaway user's 30 export-audit rows must
  // be deleted BEFORE the user row (the ActivityLog.user FK is SetNull —
  // deleting the user first orphans them with userId null). cleanup runs in
  // reverse, so the user delete is pushed FIRST here. NOTE: Prisma rejects
  // null inside an `in` list — IS NULL is expressed via OR.
  cleanup.push(() => db.user.delete({ where: { id: rl.id } })) // sessions cascade
  cleanup.push(() =>
    db.activityLog.deleteMany({
      where: {
        action: 'STUDENT_DATA_EXPORT',
        schoolId: schoolA.id,
        createdAt: { gte: suiteStart },
        OR: [{ userId: rl.id }, { userId: null }],
      },
    }),
  )

  // Audit rows this suite's OWN successful exports write (identifiable by
  // actor + window); the refusal paths write none.
  cleanup.push(() =>
    db.activityLog.deleteMany({
      where: {
        action: 'STUDENT_DATA_EXPORT',
        userId: { in: [pA.id, pB.id] },
        createdAt: { gte: suiteStart },
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

// ── helpers ────────────────────────────────────────────────────────────────

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 1-2. Role gate + principal CSV + formula neutralization
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · export role gate (permission matrix)', () => {
  test('TEACHER → GET /api/export?type=students → 403', async () => {
    const res = await as(teacherToken, '/api/export?type=students')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)

  test('STUDENT → GET /api/export?type=students → 403', async () => {
    const res = await as(studentToken, '/api/export?type=students')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  }, T)

  test('PRINCIPAL → 200 text/csv attachment; a seeded "=HYPERLINK" student name is neutralized, never an unescaped formula cell', async () => {
    // Seed a throwaway student whose NAME is a classic CSV/DDE payload.
    const email = `pih5.csv.${MARKER}@hawkings.test`
    const user = await db.user.create({
      data: { schoolId: schoolA.id, email, name: EVIL_NAME, role: 'STUDENT', status: 'ACTIVE' },
    })
    const student = await db.student.create({
      data: {
        schoolId: schoolA.id,
        userId: user.id,
        admissionNo: `PIH5CSV-${MARKER}`,
        guardianName: 'PIH5 Probe',
      },
    })
    cleanup.push(() => db.student.delete({ where: { id: student.id } }))
    cleanup.push(() => db.user.delete({ where: { id: user.id } }))

    const res = await as(principalAToken, '/api/export?type=students')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    const csv = await res.text()
    // The row exists and the name cell is the OWASP-neutralized rendering:
    // guard prefix ' + RFC-4180 quote wrapping with doubled inner quotes.
    expect(csv).toContain(`"'${EVIL_NAME.replace(/"/g, '""')}"`)
    // And it is NEVER reachable as a live formula: no line/cell boundary
    // followed by the raw payload.
    expect(csv).not.toMatch(/(^|\n|,)=HYPERLINK\(/)
  }, 45_000) // generous: first-hit dev compilation of the export route
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Rate limit (30/h per user — RATE_LIMITS.export)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · export rate limit boundary', () => {
  test('throwaway MANAGEMENT principal: 30 exports pass, the 31st is 429 RATE_LIMITED with Retry-After', async () => {
    const LIMIT = 30 // RATE_LIMITS.export (src/lib/security/rate-limit.ts)
    let saw200 = 0
    let lastStatus = 0
    for (let i = 1; i <= LIMIT + 1; i++) {
      const res = await as(rateLimitToken, '/api/export?type=students')
      lastStatus = res.status
      if (res.status === 200) saw200 += 1
      if (res.status === 429) {
        // The boundary hit — assert the full refusal contract.
        expect(i).toBe(LIMIT + 1) // exactly the 31st call, not earlier
        expect(res.headers.get('retry-after')).toBeTruthy()
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
        const body = (await res.json()) as { ok: boolean; code: string }
        expect(body.ok).toBe(false)
        expect(body.code).toBe('RATE_LIMITED')
        break
      }
      // Every pre-boundary call must have been a clean CSV.
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    }
    expect(saw200).toBe(LIMIT) // exactly 30 served, boundary at 30→31
    expect(lastStatus).toBe(429)
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. Suspended tenant fail-closed (phase75 pattern, applied to /api/export)
// ─────────────────────────────────────────────────────────────────────────

describe('PIH-5 · suspended tenant cannot export (withUser fail-closed)', () => {
  test('suspend School B → principal B export 403 → reactivated → same session exports 200 again', async () => {
    try {
      await db.school.update({ where: { id: schoolB.id }, data: { status: 'SUSPENDED' } })

      const blocked = await as(principalBToken, '/api/export?type=students')
      expect(blocked.status).toBe(403)
      const blockedBody = (await blocked.json()) as { ok: boolean; code: string }
      expect(blockedBody.ok).toBe(false)
      // SaaS-HARDENING (§2): the entitlement gate names the lock honestly
      // (SUBSCRIPTION_REQUIRED) while the tenant stays suspended.
      expect(blockedBody.code).toBe('SUBSCRIPTION_REQUIRED')
    } finally {
      // Data was never deleted — reactivation restores the SAME session.
      await db.school.update({ where: { id: schoolB.id }, data: { status: 'ACTIVE' } })
    }

    const recovered = await as(principalBToken, '/api/export?type=students')
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get('content-type')).toBe('text/csv; charset=utf-8')
  }, T)
})
