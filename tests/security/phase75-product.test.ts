import { db } from '../helpers/db'
/**
 * PHASE 7.5 — Product/tenant test suite (LIVE HTTP + unit proofs).
 *
 * The ten required Phase 7.5 proofs:
 *   1. School A website content cannot resolve as School B.
 *   2. School A announcements are not returned for School B.
 *   3. School A gallery is not returned for School B.
 *   4. School A settings do not affect School B.
 *   5. User cannot switch tenant through client-provided schoolId.
 *   6. School login does not expose Super Admin.
 *   7. Expired/suspended subscription access policy is enforced in the
 *      domain layer (unit + live API gate + login block + recovery).
 *   8. Empty datasets do not produce fake dashboard values.
 *   9. Fee chart calculations are correct (dashboard aggregates vs DB).
 *  10. Theme/branding configuration is applied consistently (public +
 *      session + settings surfaces; contrast validation enforced).
 *
 * Live-HTTP conventions match tests/security/tenant-isolation.test.ts:
 * runs against the dev server (TENANT_TEST_BASE, default :3000) with real
 * sessions. Sessions are minted as DIRECT ROWS (auth fixture that bypasses
 * only the login limiter — never an authorization gate) so the suite is
 * re-runnable inside the login rate-limit window; the two login POSTs the
 * suite does make (superadmin rejection, suspended-tenant login block) are
 * deliberate and counted against the 8/15min IP budget.
 *
 * Cleanup discipline: every mutation (settings patches, announcements,
 * albums, uploads, tenant status flips) is restored/removed in the same
 * test that created it — a failing assertion must not leak state into the
 * other proofs or the dev environment.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { unlink } from 'fs/promises'
import path from 'path'
import { evaluateSchoolAccess, planAllows } from '@/lib/access-policy'
import { hashSessionToken } from '@/lib/auth'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const PW = TENANT_FIXTURE_PASSWORD

// ─── fixtures ──────────────────────────────────────────────────────────────

const MARKER = `P75-${randomBytes(4).toString('hex')}`

let schoolA = { id: '', slug: '', name: '', themeColor: '' }
let schoolB = { id: '', slug: '', name: '', themeColor: '' }
let principalB = { id: '', email: '' }
let superadmin = { id: '', email: '' }
let tokenA = ''
let tokenB = ''
const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
  const b = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!a || !b) throw new Error('fixture schools missing (run bun run seed:demo / seed:clean)')
  schoolA = { id: a.id, slug: a.slug, name: a.name, themeColor: a.themeColor }
  schoolB = { id: b.id, slug: b.slug, name: b.name, themeColor: b.themeColor }

  const pa = await db.user.findUnique({ where: { email: 'tenant.principal.a@sunrise.test' } })
  const pb = await db.user.findUnique({ where: { email: 'principal.b@greenvalley.test' } })
  const sa = await db.user.findUnique({ where: { email: 'tenant.superadmin@sunrise.test' } })
  if (!pa || !pb || !sa) throw new Error('fixture users missing (run bun run db:seed-tenant-isolation)')
  principalB = { id: pb.id, email: pb.email }
  superadmin = { id: sa.id, email: sa.email }

  tokenA = randomBytes(32).toString('hex')
  tokenB = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      // PHASE 8A — Session rows store sha256(token); the RAW tokens ride
      // the Authorization headers below (createSession wire contract).
      { userId: pa.id, tokenHash: hashSessionToken(tokenA), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pb.id, tokenHash: hashSessionToken(tokenB), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: { tokenHash: { in: [hashSessionToken(tokenA), hashSessionToken(tokenB)] } },
    }),
  )
}, 60000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

// ─── helpers ───────────────────────────────────────────────────────────────

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

/** Public website payload for an explicit slug. */
async function publicPayload(slug: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/schools/public?slug=${encodeURIComponent(slug)}`)
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

/** 1×1 PNG (magic bytes valid, well under the 4 MB policy). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// ─────────────────────────────────────────────────────────────────────────
// 1. Website content cannot resolve as School B
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · website content is tenant-scoped', () => {
  test('A resolves A; B resolves B with NEUTRAL content; A\'s strings never appear for B', async () => {
    const [pa, pb] = await Promise.all([publicPayload(schoolA.slug), publicPayload(schoolB.slug)])
    expect(pa.status).toBe(200)
    expect(pb.status).toBe(200)

    expect(pa.body?.data?.name).toBe(schoolA.name)
    expect(pb.body?.data?.name).toBe(schoolB.name)
    expect(pb.body?.data?.name).not.toBe(schoolA.name)

    // The demo school carries the seeded editorial document; Green Valley
    // carries its honest bootstrap skeleton hero — never Sunrise's.
    const heroA: string = pa.body.data.websiteContent?.hero?.title ?? ''
    const heroB: string = pb.body.data.websiteContent?.hero?.title ?? ''
    expect(heroA.length).toBeGreaterThan(0)
    expect(heroB.length).toBeGreaterThan(0)
    expect(heroB).not.toBe(heroA)
    const bJson = JSON.stringify(pb.body)
    expect(bJson).not.toContain(heroA)

    // No cross-tenant ids or names inside B's payload.
    expect(bJson).not.toContain(schoolA.id)
  }, 30000)

  test('an unknown slug fails-safe 404 — no demo fallback, no school oracle', async () => {
    const res = await publicPayload('no-such-school-p75')
    expect(res.status).toBe(404)
    expect(res.body?.success).toBe(false)
    const txt = JSON.stringify(res.body ?? {})
    expect(txt).not.toContain(schoolA.name)
    expect(txt).not.toContain(schoolB.name)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Announcements are not returned for School B (+ visibility window)
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · announcements tenant-scoped + lifecycle visibility', () => {
  test('A-published marker reaches A\'s public payload only; drafts are invisible even for A', async () => {
    const pubTitle = `${MARKER} published`
    const draftTitle = `${MARKER} draft`
    const created: string[] = []

    // 'Whole School' maps to audience ALL → eligible for the PUBLIC site
    // feed; 'All Parents' would (correctly) stay authenticated-only.
    for (const [title, status, audience] of [
      [pubTitle, 'PUBLISHED', 'Whole School'],
      [draftTitle, 'DRAFT', 'Whole School'],
    ] as const) {
      const res = await as(tokenA, '/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, message: `${MARKER} announcement body`, audience, status }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.data.status).toBe(status)
      created.push(body.data.id)
    }
    cleanup.push(() => db.notification.deleteMany({ where: { id: { in: created } } }))

    const [pa, pb] = await Promise.all([publicPayload(schoolA.slug), publicPayload(schoolB.slug)])
    const titlesA = (pa.body.data.announcements ?? []).map((n: any) => n.title)
    const titlesB = (pb.body.data.announcements ?? []).map((n: any) => n.title)

    expect(titlesA).toContain(pubTitle)          // published + visible → public for A
    expect(titlesA).not.toContain(draftTitle)    // draft → invisible even for A
    expect(titlesB).not.toContain(pubTitle)      // never for B
    expect(titlesB).not.toContain(draftTitle)

    // The authenticated school feed for B never sees A's rows either.
    const feedB = await as(tokenB, '/api/announcements')
    const feedBJson = JSON.stringify(await feedB.json().catch(() => ({})))
    expect(feedBJson).not.toContain(pubTitle)
    expect(feedBJson).not.toContain(MARKER)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Gallery is not returned for School B (+ published-only media bytes)
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · gallery tenant-scoped + privacy-by-default media', () => {
  // Dedicated marker: the announcement rows from the earlier proof stay
  // live until afterAll — their marker must not collide with these probes.
  const GAL = `${MARKER}-gal`

  test('A\'s album/image never reach B; bytes serve only while published', async () => {
    // album
    const albumRes = await as(tokenA, '/api/school/website/gallery', {
      method: 'POST',
      body: JSON.stringify({ title: `${GAL} album`, description: 'P75 isolation probe' }),
    })
    expect(albumRes.status).toBe(200)
    const album = (await albumRes.json()).data.album
    cleanup.push(() => db.galleryAlbum.deleteMany({ where: { id: album.id } }))

    // upload a real image (magic-byte policy honored)
    const form = new FormData()
    form.append('file', new File([TINY_PNG], 'p75.png', { type: 'image/png' }))
    const upRes = await fetch(`${BASE}/api/school/website/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}` },
      body: form,
    })
    expect(upRes.status).toBe(200)
    const upBody = await upRes.json()
    expect(upBody.success).toBe(true)
    const fileId: string = upBody.data.fileId
    cleanup.push(async () => {
      await db.uploadedFile.deleteMany({ where: { id: fileId } }).catch(() => {})
      await unlink(path.join(process.cwd(), 'db', 'uploads', 'website', fileId)).catch(() => {})
    })

    // attach image to the album
    const imgRes = await as(tokenA, '/api/school/website/gallery/images', {
      method: 'POST',
      body: JSON.stringify({ albumId: album.id, fileId, caption: `${GAL} caption` }),
    })
    expect(imgRes.status).toBe(200)

    // unpublished album → no public gallery entry, bytes 404
    const beforePublish = await publicPayload(schoolA.slug)
    expect(JSON.stringify(beforePublish.body)).not.toContain(GAL)
    const mediaBefore = await fetch(`${BASE}/api/public/website/media/${fileId}`)
    expect(mediaBefore.status).toBe(404)

    // publish → public for A only
    const pubRes = await as(tokenA, '/api/school/website/gallery', {
      method: 'PATCH',
      body: JSON.stringify({ albumId: album.id, published: true }),
    })
    expect(pubRes.status).toBe(200)

    const [pa, pb] = await Promise.all([publicPayload(schoolA.slug), publicPayload(schoolB.slug)])
    const albumsA = (pa.body.data.gallery ?? []).map((a: any) => a.title)
    const albumsB = (pb.body.data.gallery ?? []).map((a: any) => a.title)
    expect(albumsA).toContain(`${GAL} album`)
    expect(albumsB).not.toContain(`${GAL} album`)
    expect(JSON.stringify(pb.body)).not.toContain(fileId)

    const mediaPub = await fetch(`${BASE}/api/public/website/media/${fileId}`)
    expect(mediaPub.status).toBe(200)
    expect(mediaPub.headers.get('content-type')).toContain('image/png')

    // unpublish → bytes private again (draft images are never public)
    const unpubRes = await as(tokenA, '/api/school/website/gallery', {
      method: 'PATCH',
      body: JSON.stringify({ albumId: album.id, published: false }),
    })
    expect(unpubRes.status).toBe(200)
    const mediaAfter = await fetch(`${BASE}/api/public/website/media/${fileId}`)
    expect(mediaAfter.status).toBe(404)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 4. School A settings do not affect School B
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · settings isolation', () => {
  test('A\'s identity/settings PATCH leaves B byte-identical; cross-tenant schoolId is ignored', async () => {
    const beforeA = await db.school.findUnique({ where: { id: schoolA.id } })
    const before = await db.school.findUnique({ where: { id: schoolB.id } })
    if (!beforeA || !before) throw new Error('fixture school vanished')

    const res = await as(tokenA, '/api/school-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        schoolId: schoolB.id, // ← hostile: must be IGNORED (session tenant wins)
        identity: { tagline: `${MARKER} tagline` },
        settings: { timetable: { periodMinutes: 37 } },
      }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    cleanup.push(() =>
      db.school.update({
        where: { id: schoolA.id },
        data: { tagline: beforeA.tagline, settings: beforeA.settings },
      }),
    )

    // B unchanged — same row bytes (tagline, settings JSON identical)
    const after = await db.school.findUnique({ where: { id: schoolB.id } })
    expect(after?.tagline).toBe(before?.tagline)
    expect(after?.settings).toBe(before?.settings)

    // A actually got the patch (proves the write was real, just tenant-scoped)
    const aCfg = await as(tokenA, '/api/school-settings')
    const aBody = await aCfg.json()
    expect(aBody.data.identity.tagline).toBe(`${MARKER} tagline`)
    expect((aBody.data.settings?.timetable as any)?.periodMinutes).toBe(37)

    // B's OWN read shows its own config — no marker leakage
    const bCfg = await as(tokenB, '/api/school-settings')
    const bBody = await bCfg.json()
    expect(bBody.data.identity.name).toBe(schoolB.name)
    expect(JSON.stringify(bBody.data)).not.toContain(MARKER)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 5. User cannot switch tenant through client-provided schoolId
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · client schoolId never switches tenant', () => {
  test('query/body schoolId=B as principal A still serves A', async () => {
    // query-string attempt (website CMS)
    const web = await as(tokenA, `/api/school/website?schoolId=${schoolB.id}`)
    const webBody = await web.json()
    expect(web.status).toBe(200)
    expect(webBody.data.school.name).toBe(schoolA.name)
    expect(webBody.data.school.name).not.toBe(schoolB.name)

    // settings read attempt
    const cfg = await as(tokenA, `/api/school-settings?schoolId=${schoolB.id}`)
    const cfgBody = await cfg.json()
    expect(cfgBody.data.identity.name).toBe(schoolA.name)

    // body attempt on a WRITE route: announcement must land in A
    const title = `${MARKER} hostile schoolId`
    const res = await as(tokenA, '/api/announcements', {
      method: 'POST',
      body: JSON.stringify({ schoolId: schoolB.id, title, message: 'probe', audience: 'ALL' }),
    })
    expect(res.status).toBe(200)
    const row = (await res.json()).data
    cleanup.push(() => db.notification.deleteMany({ where: { id: row.id } }))
    const stored = await db.notification.findUnique({ where: { id: row.id } })
    expect(stored?.schoolId).toBe(schoolA.id)

    // …and B's public surface never sees it
    const pb = await publicPayload(schoolB.slug)
    expect(JSON.stringify(pb.body)).not.toContain(title)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 6. School login does not expose Super Admin
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · login surface exposes no platform plane', () => {
  test('public payload carries one school, no school list, no platform keys', async () => {
    const res = await fetch(`${BASE}/api/schools/public`)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toBeDefined()
    const txt = JSON.stringify(body)
    expect(txt).not.toContain('SUPER_ADMIN')
    expect(txt).not.toContain('PlatformAdmin')
    expect(body.data.schools).toBeUndefined() // never a tenant directory
  }, 30000)

  test('the legacy superadmin identity cannot obtain a school session', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: superadmin.email, password: PW }),
    })
    const body = await res.json().catch(() => ({}))
    expect(res.status).toBeGreaterThanOrEqual(400) // rejected (suspended role row)
    expect(body.ok ?? body.success).not.toBe(true)
    expect(body.data?.sessionToken).toBeUndefined()
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 8. Empty datasets do not produce fake dashboard values  (runs before the
//    suspension proof so B is ACTIVE here)
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · dashboard values are DB-derived (never fabricated)', () => {
  test('principal B dashboard stats equal live DB aggregates; trend is honest', async () => {
    const res = await as(tokenB, '/api/dashboard')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.scope).toBe('SCHOOL')
    const stats = body.data.stats

    const [students, teachers, classes, feesTotal, feesPaid, overdue] = await Promise.all([
      db.student.count({ where: { schoolId: schoolB.id } }),
      db.teacher.count({ where: { schoolId: schoolB.id } }),
      db.class.count({ where: { schoolId: schoolB.id } }),
      db.fee.aggregate({ where: { schoolId: schoolB.id }, _sum: { amount: true } }),
      // FINAL-GATE mirror: feesPaid sums Fee.paid across ALL rows (partial
      // payments on PARTIALLY_PAID rows count — billed = collected + outstanding).
      db.fee.aggregate({ where: { schoolId: schoolB.id }, _sum: { paid: true } }),
      db.fee.count({ where: { schoolId: schoolB.id, status: { in: ['UNPAID', 'OVERDUE'] } } }),
    ])
    expect(stats.students).toBe(students)
    expect(stats.teachers).toBe(teachers)
    expect(stats.classes).toBe(classes)
    expect(stats.feesTotal).toBe(Number(feesTotal._sum.amount || 0))
    expect(stats.feesPaid).toBe(Number(feesPaid._sum.paid || 0))
    expect(stats.overdue).toBe(overdue)
    expect(Number.isFinite(stats.attendanceRate)).toBe(true)
    expect(stats.attendanceRate).toBeGreaterThanOrEqual(0)
    expect(stats.attendanceRate).toBeLessThanOrEqual(100)

    // Empty payment history ⇒ empty trend (no invented months/amounts).
    // FINAL-GATE mirror: only SUCCESSFUL payments are recorded collections.
    const trend: Array<{ month: string; amount: number }> = body.data.trend ?? []
    const payments = await db.payment.findMany({
      where: { fee: { schoolId: schoolB.id }, status: 'SUCCESS' },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    expect(trend.length).toBe(Math.min(6, new Set(payments.map((p) => p.createdAt.toISOString().slice(0, 7))).size))
    for (const point of trend) {
      expect(point.month).toMatch(/^\d{4}-\d{2}$/)
      expect(point.amount).toBeGreaterThanOrEqual(0)
    }
    if (payments.length === 0) expect(trend).toEqual([])
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 9. Fee chart calculations are correct (School A, real volume)
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · fee aggregation correctness', () => {
  test('billed/collected/overdue/trend match exact DB recomputation', async () => {
    const res = await as(tokenA, '/api/dashboard')
    expect(res.status).toBe(200)
    const body = await res.json()
    const stats = body.data.stats

    const [feesTotal, feesPaid, overdue, students] = await Promise.all([
      db.fee.aggregate({ where: { schoolId: schoolA.id }, _sum: { amount: true } }),
      // FINAL-GATE mirror: all-rows paid sum (see School B mirror above).
      db.fee.aggregate({ where: { schoolId: schoolA.id }, _sum: { paid: true } }),
      db.fee.count({ where: { schoolId: schoolA.id, status: { in: ['UNPAID', 'OVERDUE'] } } }),
      db.student.count({ where: { schoolId: schoolA.id } }),
    ])
    expect(stats.feesTotal).toBe(Number(feesTotal._sum.amount || 0))
    expect(stats.feesPaid).toBe(Number(feesPaid._sum.paid || 0))
    expect(stats.overdue).toBe(overdue)

    // donut semantics: collected cannot exceed billed on honest data
    expect(stats.feesPaid).toBeLessThanOrEqual(stats.feesTotal)

    // trend: identical aggregation over the same window
    // (FINAL-GATE mirror: SUCCESS-only, matching the route's fix)
    const payments = await db.payment.findMany({
      where: { fee: { schoolId: schoolA.id }, status: 'SUCCESS' },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const months: Record<string, number> = {}
    for (const p of payments) {
      const key = p.createdAt.toISOString().slice(0, 7)
      months[key] = (months[key] || 0) + Number(p.amount) // NUMERIC → Decimal → number
    }
    const expected = Object.entries(months)
      .sort((x, y) => (x[0] < y[0] ? -1 : 1))
      .slice(-6)
      .map(([month, amount]) => ({ month, amount }))
    expect(body.data.trend ?? []).toEqual(expected)

    // attendance rate bound + exact formula
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const rows = await db.attendance.groupBy({
      by: ['status'],
      where: { schoolId: schoolA.id, date: { gte: since } },
      _count: { id: true },
    })
    const present = rows.find((r) => r.status === 'PRESENT')?._count.id || 0
    const absent = rows.find((r) => r.status === 'ABSENT')?._count.id || 0
    const late = rows.find((r) => r.status === 'LATE')?._count.id || 0
    const rate = students ? Math.round((present / Math.max(1, present + absent + late)) * 100) : 0
    expect(stats.attendanceRate).toBe(rate)
    expect(stats.attendanceRate).toBeLessThanOrEqual(100)
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 10. Theme/branding configuration is applied consistently
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · branding flows to every surface + contrast gate', () => {
  const NEW_COLOR = '#7c2d12' // dark umber — WCAG-safe on white

  test('one PATCH appears on settings, public site, session identity; A untouched; unsafe colors rejected', async () => {
    const original = schoolB.themeColor

    const res = await as(tokenB, '/api/school-settings', {
      method: 'PATCH',
      body: JSON.stringify({ branding: { primaryColor: NEW_COLOR } }),
    })
    expect(res.status).toBe(200)
    cleanup.push(() => db.school.update({ where: { id: schoolB.id }, data: { themeColor: original } }))

    // settings surface
    const cfg = await as(tokenB, '/api/school-settings')
    expect((await cfg.json()).data.branding.primaryColor).toBe(NEW_COLOR)

    // public website surface
    const pub = await publicPayload(schoolB.slug)
    expect(pub.body.data.themeColor).toBe(NEW_COLOR)

    // authenticated session identity surface
    const me = await as(tokenB, '/api/auth/me')
    const meBody = await me.json()
    expect(meBody.data?.user?.school?.themeColor).toBe(NEW_COLOR)

    // A's branding untouched
    const pa = await publicPayload(schoolA.slug)
    expect(pa.body.data.themeColor).toBe(schoolA.themeColor)

    // contrast-safe gate: a near-white primary must be REJECTED with an
    // actionable message (readability protection, server-enforced)
    const bad = await as(tokenB, '/api/school-settings', {
      method: 'PATCH',
      body: JSON.stringify({ branding: { primaryColor: '#f0fdf4' } }),
    })
    expect(bad.status).toBe(400)
    const badBody = await bad.json()
    expect(String(badBody.error ?? '').toLowerCase()).toContain('contrast')
  }, 30000)
})

// ─────────────────────────────────────────────────────────────────────────
// 7. Subscription access policy — domain layer (unit) + live API gate
// ─────────────────────────────────────────────────────────────────────────
describe('PHASE 7.5 · subscription access policy (domain layer)', () => {
  test('evaluateSchoolAccess: ACTIVE/TRIAL allowed, SUSPENDED denied, fail-closed on unknown', () => {
    expect(evaluateSchoolAccess({ status: 'ACTIVE', plan: 'STANDARD' }).allowed).toBe(true)
    expect(evaluateSchoolAccess({ status: 'TRIAL', plan: 'FREE' }).allowed).toBe(true)
    const denied = evaluateSchoolAccess({ status: 'SUSPENDED', plan: 'ENTERPRISE' })
    expect(denied.allowed).toBe(false)
    expect(denied.reason?.toLowerCase()).toContain('suspended')
    // fail-closed: unknown / missing subject / missing status
    expect(evaluateSchoolAccess({ status: 'WEIRD', plan: 'PRO' }).allowed).toBe(false)
    expect(evaluateSchoolAccess(undefined).allowed).toBe(false)
    expect(evaluateSchoolAccess(null).allowed).toBe(false)
    expect(evaluateSchoolAccess({ status: null, plan: null }).allowed).toBe(false)
  })

  test('planAllows: matrix boundaries (interface only — no billing)', () => {
    expect(planAllows('FREE', 'announcements')).toBe(true)
    expect(planAllows('FREE', 'website-cms')).toBe(false)
    expect(planAllows('STANDARD', 'gallery')).toBe(true)
    expect(planAllows('ENTERPRISE', 'online-payments')).toBe(true)
    expect(planAllows('PRO', 'online-payments')).toBe(false)
    expect(planAllows(null, 'announcements')).toBe(true) // unknown plan → STANDARD
    expect(planAllows('GARBAGE', 'hostel')).toBe(false)
  })

  test('LIVE: suspending tenant B blocks its session on EVERY school API; A unaffected; recovery restores the SAME session', async () => {
    // healthy baseline with the direct-minted B session
    const okBefore = await as(tokenB, '/api/dashboard')
    expect(okBefore.status).toBe(200)

    try {
      await db.school.update({ where: { id: schoolB.id }, data: { status: 'SUSPENDED' } })

      // the API boundary (withUser) enforces the domain policy — even
      // though this session was never revoked
      const blocked = await as(tokenB, '/api/dashboard')
      expect(blocked.status).toBe(403)
      const blockedBody = await blocked.json()
      expect(String(blockedBody.error ?? '').toLowerCase()).toContain('suspended')

      // school A keeps working in the same instant
      const okA = await as(tokenA, '/api/dashboard')
      expect(okA.status).toBe(200)

      // login is blocked while suspended (no new session can be minted)
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: principalB.email, password: PW }),
      })
      const loginBody = await loginRes.json().catch(() => ({}))
      expect([401, 403, 429]).toContain(loginRes.status)
      if (loginRes.status !== 429) {
        expect(loginRes.status).toBe(403)
        expect(loginBody.data?.sessionToken ?? loginBody.data?.token).toBeUndefined()
      }

      // the suspended tenant's public website presence goes dark
      const pub = await publicPayload(schoolB.slug)
      expect(pub.status).toBe(404)
    } finally {
      // data was never deleted — reactivation restores the SAME session
      await db.school.update({ where: { id: schoolB.id }, data: { status: 'ACTIVE' } })
    }

    const okAfter = await as(tokenB, '/api/dashboard')
    expect(okAfter.status).toBe(200)
  }, 30000)
})
