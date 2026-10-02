/**
 * PHASE 8C-F (mission §12) — the PRINCIPAL-side setup-readiness contract.
 *
 * THE INVARIANTS UNDER TEST:
 *
 *   1. SESSION-DERIVED TENANT — the principal's readiness document is
 *      computed for THEIR school (green-valley honest-empty state),
 *      never for a client-supplied school id and never another tenant.
 *   2. ROLE GATE — only the school's builders (PRINCIPAL / MANAGEMENT)
 *      may read the readiness surface; teachers, students, parents and
 *      anonymous callers are refused (403 / 401).
 *   3. SHARED CONTRACT — the document is the SAME shape the platform
 *      console sees (sections + summary, DB-computed counts, honest
 *      zero-progress for the clean tenant).
 *
 * Live HTTP against the dev server; fixture-session convention for the
 * probe accounts (bypasses ONLY the login limiter — same pattern as the
 * tenant-isolation suite).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

const GV_PRINCIPAL = 'principal.b@greenvalley.test'
const GV_TEACHER = 'teacher.b@greenvalley.test'
const GV_STUDENT = 'student.b@greenvalley.test'

let gvId = ''
const minted: Array<{ userId: string; tokenHash: string }> = []

/** Direct session-row fixture (auth fixture, NOT an authorization bypass). */
async function fixtureSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no fixture user ${email}`)
  const raw = randomBytes(32).toString('hex')
  const tokenHash = hashSessionToken(raw)
  await db.session.create({
    data: { userId: u.id, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
  })
  minted.push({ userId: u.id, tokenHash })
  return raw
}

function as(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing — run the canonical corpus seeds')
  gvId = gv.id
  await resetLoginBuckets([GV_PRINCIPAL])
}, 60_000)

afterAll(async () => {
  for (const s of minted) await db.session.deleteMany({ where: { tokenHash: s.tokenHash } }).catch(() => {})
  await db.$disconnect()
})

describe('PHASE 8C-F · school setup-readiness (principal surface)', () => {
  test(
    'principal → their OWN school document: green-valley honest state, session-derived tenant',
    async () => {
      const token = await fixtureSession(GV_PRINCIPAL)
      const res = await as(token, '/api/school/setup-readiness')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: {
          school: { id: string; status: string }
          sections: Array<{ id: string; required: boolean; done: boolean; detail: string; counts: Record<string, number> }>
          summary: { requiredTotal: number; requiredDone: number; requiredComplete: boolean; usable: boolean }
        }
      }
      expect(body.ok).toBe(true)
      // Session-derived tenant: the document is for GREEN VALLEY.
      expect(body.data.school.id).toBe(gvId)
      expect(body.data.school.status).toBe('ACTIVE')

      const byId = new Map(body.data.sections.map((s) => [s.id, s]))
      // The clean school: identity+principal exist; the people/academic
      // sections honestly report what the DB holds (0 unless a suite
      // just wrote rows — the assertion is against the LIVE count, not
      // a constant, so suite interleaving can never fake a pass).
      const liveTeachers = await db.teacher.count({ where: { schoolId: gvId } })
      const liveStudents = await db.student.count({ where: { schoolId: gvId } })
      expect(byId.get('people')?.counts.teachers).toBe(liveTeachers)
      expect(byId.get('people')?.counts.students).toBe(liveStudents)
      expect(byId.get('people')?.done).toBe(liveTeachers > 0 && liveStudents > 0)

      // The clean tenant is NOT complete (it has no classes/fees by
      // design — the honest incomplete state the Setup Guide surfaces).
      expect(body.data.summary.requiredComplete).toBe(false)
      expect(body.data.summary.usable).toBe(false)
    },
    T,
  )

  test('teacher → 403 (the builders-only gate)', async () => {
    const token = await fixtureSession(GV_TEACHER)
    const res = await as(token, '/api/school/setup-readiness')
    expect(res.status).toBe(403)
  }, T)

  test('student → 403', async () => {
    const token = await fixtureSession(GV_STUDENT)
    const res = await as(token, '/api/school/setup-readiness')
    expect(res.status).toBe(403)
  }, T)

  test('anonymous → 401', async () => {
    const res = await fetch(`${BASE}/api/school/setup-readiness`)
    expect(res.status).toBe(401)
  }, T)

  test(
    'platform parity: the same document the platform console reads (shared lib)',
    async () => {
      // The platform endpoint for the SAME school must produce the
      // identical requiredDone/requiredTotal — one computation, two
      // transports (platform x-platform-token vs school bearer).
      const admin = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
      const raw = randomBytes(32).toString('hex')
      await db.platformAdminSession.create({
        data: { adminId: admin!.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
      })
      const schoolToken = await fixtureSession(GV_PRINCIPAL)

      const [pf, sc] = await Promise.all([
        fetch(`${BASE}/api/platform/schools/${gvId}/setup-readiness`, {
          headers: { 'x-platform-token': raw },
        }),
        as(schoolToken, '/api/school/setup-readiness'),
      ])
      expect(pf.status).toBe(200)
      expect(sc.status).toBe(200)
      const pfBody = (await pf.json()) as { data: { summary: { requiredDone: number; requiredTotal: number } } }
      const scBody = (await sc.json()) as { data: { summary: { requiredDone: number; requiredTotal: number } } }
      expect(scBody.data.summary.requiredDone).toBe(pfBody.data.summary.requiredDone)
      expect(scBody.data.summary.requiredTotal).toBe(pfBody.data.summary.requiredTotal)

      await db.platformAdminSession.deleteMany({ where: { tokenHash: hashSessionToken(raw) } })
    },
    T,
  )
})
