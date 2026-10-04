/**
 * SaaS-HARDENING acceptance suite (directive §14).
 *
 * TENANT: School A cannot read/write/enumerate School B through the new
 *         CMS/billing surfaces (notices, admissions, payments, requests).
 * SUBSCRIPTION: login NEVER depends on subscription state; RESTRICTED/
 *         SUSPENDED lock business APIs server-side while the exempt
 *         surface (subscription status, support, profile, logout) stays
 *         reachable; a VERIFIED payment restores access automatically.
 * OFFLINE PAYMENT: recordPlatformPayment activates the CORRECT school
 *         only, transactionally, with a receipt.
 * WEBSITE: publish → public; draft/schedule/expiry honored; cross-tenant
 *         public payloads never mix.
 * DOMAIN: the principal plane exposes no domain infrastructure controls.
 * WEBHOOK: unsigned → 401; signed → activation; replay → duplicate.
 *
 * Live-HTTP conventions match tests/security/phase75-product.test.ts
 * (dev server BASE, direct Session rows bypassing only the login limiter,
 * strict cleanup of every mutation).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHmac, randomBytes } from 'crypto'

import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { evaluateTenantEntitlement, isEntitlementExemptRoute } from '@/lib/entitlement/entitlement'
import { recordPlatformPayment } from '@/lib/platform/billing'
import { TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const PW = TENANT_FIXTURE_PASSWORD
const MARKER = `SH-${randomBytes(4).toString('hex')}`

let schoolA = { id: '', slug: '' }
let schoolB = { id: '', slug: '' }
let tokenA = ''
let tokenB = ''
const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  const b = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!a || !b) throw new Error('fixture schools missing (run seed:demo / seed:clean)')
  schoolA = { id: a.id, slug: a.slug }
  schoolB = { id: b.id, slug: b.slug }

  const pa = await db.user.findUnique({ where: { email: 'tenant.principal.a@hawkings.test' } })
  const pb = await db.user.findUnique({ where: { email: 'principal.b@greenvalley.test' } })
  if (!pa || !pb) throw new Error('fixture users missing (run db:seed-tenant-isolation)')

  tokenA = randomBytes(32).toString('hex')
  tokenB = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: pa.id, tokenHash: hashSessionToken(tokenA), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pb.id, tokenHash: hashSessionToken(tokenB), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({ where: { tokenHash: { in: [hashSessionToken(tokenA), hashSessionToken(tokenB)] } } }),
  )
}, 60000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

async function json(r: Response): Promise<any> {
  return r.json().catch(() => null)
}

async function login(email: string, password: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, body: await json(res) }
}

async function publicPayload(slug: string): Promise<any> {
  const res = await fetch(`${BASE}/api/schools/public?slug=${encodeURIComponent(slug)}`)
  const body = await json(res)
  return body?.data ?? body
}

// ═════════════════════════════════════════════════════════════════════
// ENTITLEMENT — unit state machine
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · entitlement state machine (unit)', () => {
  const base = {
    schoolStatus: 'ACTIVE',
    accountSubscriptionStatus: 'ACTIVE',
    subscription: { status: 'ACTIVE', plan: 'STANDARD', periodEnd: null, graceDays: 14, overrideStatus: null },
  }

  test('ACTIVE: full access, no renewal nudge', () => {
    const e = evaluateTenantEntitlement(base)
    expect(e.state).toBe('ACTIVE')
    expect(e.businessAllowed).toBe(true)
    expect(e.renewalRequired).toBe(false)
  })

  test('future periodEnd stays ACTIVE', () => {
    const e = evaluateTenantEntitlement({
      ...base,
      subscription: { ...base.subscription, periodEnd: new Date(Date.now() + 86_400_000) },
    })
    expect(e.state).toBe('ACTIVE')
  })

  test('recent expiry → GRACE (business allowed + persistent warning)', () => {
    const e = evaluateTenantEntitlement({
      ...base,
      subscription: { ...base.subscription, periodEnd: new Date(Date.now() - 2 * 86_400_000) },
    })
    expect(e.state).toBe('GRACE')
    expect(e.businessAllowed).toBe(true)
    expect(e.renewalRequired).toBe(true)
    expect(e.message).toBeTruthy()
  })

  test('grace exceeded → RESTRICTED (login ok, business locked)', () => {
    const e = evaluateTenantEntitlement({
      ...base,
      subscription: { ...base.subscription, periodEnd: new Date(Date.now() - 30 * 86_400_000) },
    })
    expect(e.state).toBe('RESTRICTED')
    expect(e.businessAllowed).toBe(false)
    expect(e.loginAllowed).toBe(true)
    expect(e.message).toContain('needs renewal')
  })

  test('platform suspension → SUSPENDED (login still allowed)', () => {
    const e = evaluateTenantEntitlement({ ...base, schoolStatus: 'SUSPENDED' })
    expect(e.state).toBe('SUSPENDED')
    expect(e.loginAllowed).toBe(true)
    expect(e.businessAllowed).toBe(false)
  })

  test('never-activated school → NOT_ACTIVATED (login refused — provisioning, not subscription)', () => {
    const e = evaluateTenantEntitlement({ ...base, schoolStatus: 'PENDING' })
    expect(e.state).toBe('NOT_ACTIVATED')
    expect(e.loginAllowed).toBe(false)
  })

  test('manual override wins over the computed period state', () => {
    const e = evaluateTenantEntitlement({
      ...base,
      subscription: { ...base.subscription, periodEnd: new Date(Date.now() + 86_400_000), overrideStatus: 'SUSPENDED' },
    })
    expect(e.state).toBe('SUSPENDED')
  })

  test('account-level LOCKED preserves the restricted posture', () => {
    const e = evaluateTenantEntitlement({ ...base, accountSubscriptionStatus: 'LOCKED' })
    expect(e.state).toBe('RESTRICTED')
    expect(e.businessAllowed).toBe(false)
  })

  test('fail-closed: unknown school status is never open', () => {
    const e = evaluateTenantEntitlement({ ...base, schoolStatus: 'SOMETHING_ELSE' })
    expect(e.loginAllowed).toBe(false)
    expect(e.businessAllowed).toBe(false)
  })

  test('route exemption: exact prefixes, fail-closed otherwise', () => {
    expect(isEntitlementExemptRoute('/api/auth/me')).toBe(true)
    expect(isEntitlementExemptRoute('/api/subscription')).toBe(true)
    expect(isEntitlementExemptRoute('/api/support')).toBe(true)
    expect(isEntitlementExemptRoute('/api/profile')).toBe(true)
    expect(isEntitlementExemptRoute('/api/public/website')).toBe(true)
    expect(isEntitlementExemptRoute('/api/students')).toBe(false)
    expect(isEntitlementExemptRoute('/api/school/website/notices')).toBe(false)
    expect(isEntitlementExemptRoute('/api/authenticate-evil')).toBe(false)
    expect(isEntitlementExemptRoute(null)).toBe(false)
    expect(isEntitlementExemptRoute('unknown')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════
// SUBSCRIPTION — login never blocked; API lock + exempt surface
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · subscription must not block login (live)', () => {
  test('RESTRICTED: login succeeds, carries entitlement, business APIs reject, exempt surface works', async () => {
    const sub = await db.schoolSubscription.findUnique({ where: { schoolId: schoolB.id } })
    if (!sub) throw new Error('green-valley subscription row missing (run backfill)')
    const before = { periodEnd: sub.periodEnd, status: sub.status, plan: sub.plan, override: sub.overrideStatus }

    // Restrict tenant B (beyond grace).
    await db.schoolSubscription.update({
      where: { schoolId: schoolB.id },
      data: { periodEnd: new Date(Date.now() - 40 * 86_400_000), overrideStatus: null },
    })
    cleanup.push(() =>
      db.schoolSubscription.update({
        where: { schoolId: schoolB.id },
        data: { periodEnd: before.periodEnd, status: before.status, plan: before.plan, overrideStatus: before.override },
      }),
    )

    // 1 — LOGIN SUCCEEDS (never "invalid credentials").
    const loginB = await login('principal.b@greenvalley.test', PW)
    expect(loginB.status).toBe(200)
    expect(loginB.body?.ok).toBe(true)
    expect(loginB.body?.data?.entitlement?.state).toBe('RESTRICTED')
    expect(loginB.body?.data?.entitlement?.businessAllowed).toBe(false)

    // 2 — a session for B sees its own identity (me works, entitlement RESTRICTED).
    const me = await as(tokenB, '/api/auth/me')
    expect(me.status).toBe(200)
    const meBody = await json(me)
    expect(meBody?.data?.entitlement?.state).toBe('RESTRICTED')

    // 3 — business APIs are LOCKED server-side.
    const students = await as(tokenB, '/api/students')
    expect(students.status).toBe(403)
    const studentsBody = await json(students)
    expect(studentsBody?.code).toBe('SUBSCRIPTION_REQUIRED')
    expect(String(studentsBody?.error)).toContain('renewal')
    const website = await as(tokenB, '/api/school/website/notices')
    expect(website.status).toBe(403)

    // 4 — the exempt surface stays reachable.
    const status = await as(tokenB, '/api/subscription')
    expect(status.status).toBe(200)
    const statusBody = await json(status)
    expect(statusBody?.data?.entitlement?.state).toBe('RESTRICTED')
    const support = await as(tokenB, '/api/support', {
      method: 'POST',
      body: JSON.stringify({ topic: 'subscription', message: `${MARKER} test support message` }),
    })
    expect(support.status).toBe(200)

    // 5 — School A is completely unaffected (its business APIs still work).
    const studentsA = await as(tokenA, '/api/students')
    expect(studentsA.status).toBe(200)
  })

  test('SUSPENDED (platform suspension): login still works, business locked', async () => {
    const school = await db.school.findUnique({ where: { id: schoolB.id }, select: { status: true } })
    const before = school?.status ?? 'ACTIVE'
    await db.school.update({ where: { id: schoolB.id }, data: { status: 'SUSPENDED' } })
    cleanup.push(() => db.school.update({ where: { id: schoolB.id }, data: { status: before } }))

    const loginB = await login('principal.b@greenvalley.test', PW)
    expect(loginB.status).toBe(200)
    expect(loginB.body?.data?.entitlement?.state).toBe('SUSPENDED')

    const students = await as(tokenB, '/api/students')
    expect(students.status).toBe(403)
    const subStatus = await as(tokenB, '/api/subscription')
    expect(subStatus.status).toBe(200)

    // IMPORTANT: a platform suspension is NOT lifted by a payment — restore
    // the lifecycle NOW so the next test (verified payment) runs against an
    // operational tenant (the payment only clears subscription state).
    await db.school.update({ where: { id: schoolB.id }, data: { status: before } })
  })

  test('RESTRICTED → verified payment → access restored automatically (the correct school only)', async () => {
    const subB = (await db.schoolSubscription.findUnique({ where: { schoolId: schoolB.id } }))!
    const beforeB = { periodEnd: subB.periodEnd, status: subB.status, plan: subB.plan, override: subB.overrideStatus }
    const subA = (await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } }))!
    const beforeA = { periodEnd: subA.periodEnd, status: subA.status, plan: subA.plan, override: subA.overrideStatus }

    // B restricted, A healthy.
    await db.schoolSubscription.update({
      where: { schoolId: schoolB.id },
      data: { periodEnd: new Date(Date.now() - 40 * 86_400_000), overrideStatus: 'RESTRICTED' },
    })

    // A VERIFIED offline payment for B (the lib-level activation path —
    // the platform API path was live-verified in the orchestrator's curl
    // cycle; this is the transactional core both paths share).
    const result = await recordPlatformPayment({
      schoolId: schoolB.id,
      amount: 18_000,
      currency: 'INR',
      mode: 'CHEQUE',
      paymentDate: new Date(),
      periodMonths: 12,
      reference: `${MARKER}-CHQ`,
      notes: 'SaaS-hardening test payment',
      recordedById: null,
      source: 'admin',
    })
    cleanup.push(() => db.platformPayment.deleteMany({ where: { reference: `${MARKER}-CHQ` } }))
    cleanup.push(() =>
      db.schoolSubscription.update({
        where: { schoolId: schoolB.id },
        data: { periodEnd: beforeB.periodEnd, status: beforeB.status, plan: beforeB.plan, overrideStatus: beforeB.override },
      }),
    )
    cleanup.push(() =>
      db.schoolSubscription.update({
        where: { schoolId: schoolA.id },
        data: { periodEnd: beforeA.periodEnd, status: beforeA.status, plan: beforeA.plan, overrideStatus: beforeA.override },
      }),
    )

    // Receipt + snapshot + period extension.
    expect(result.statusAfter).toBe('ACTIVE')
    expect(result.receiptNo).toMatch(/^SCH-RCP-\d{4}-\d{5}$/)
    expect(result.periodEndAfter.getTime()).toBeGreaterThan(Date.now() + 330 * 86_400_000)

    // Access restored for B; A untouched (its subscription row unchanged).
    const studentsB = await as(tokenB, '/api/students')
    expect(studentsB.status).toBe(200)
    const afterA = await db.schoolSubscription.findUnique({ where: { schoolId: schoolA.id } })
    expect(afterA?.periodEnd?.toISOString()).toBe(beforeA.periodEnd?.toISOString())
    expect(afterA?.status).toBe(beforeA.status)

    // The payment row is VERIFIED (never a browser-report activation).
    const row = await db.platformPayment.findFirst({ where: { reference: `${MARKER}-CHQ` } })
    expect(row?.verification).toBe('VERIFIED')
    expect(row?.schoolId).toBe(schoolB.id)
    expect(row?.statusAfter).toBe('ACTIVE')
  })
})

// ═════════════════════════════════════════════════════════════════════
// TENANT — new CMS/billing surfaces are isolated
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · cross-tenant isolation on the new surfaces', () => {
  test('notices: A cannot read/patch/delete B\'s notice (forged id → 404, no oracle)', async () => {
    const created = await db.websiteNotice.create({
      data: { schoolId: schoolB.id, kind: 'NOTICE', title: `${MARKER} B-only`, body: 'B body' },
    })
    cleanup.push(() => db.websiteNotice.deleteMany({ where: { id: created.id } }))

    // A's own list never contains B's row.
    const listA = await as(tokenA, '/api/school/website/notices')
    const listABody = await json(listA)
    const titlesA: string[] = (listABody?.data?.notices ?? []).map((n: any) => n.title)
    expect(titlesA).not.toContain(`${MARKER} B-only`)

    // Forged PATCH by A on B's notice id → 404 RESOURCE_NOT_FOUND.
    const patch = await as(tokenA, `/api/school/website/notices/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'publish' }),
    })
    expect(patch.status).toBe(404)

    // Forged DELETE by A → 404; the row survives.
    const del = await as(tokenA, `/api/school/website/notices/${created.id}`, { method: 'DELETE' })
    expect(del.status).toBe(404)
    const survivor = await db.websiteNotice.findUnique({ where: { id: created.id } })
    expect(survivor).not.toBeNull()
  })

  test('admissions: A\'s PUT writes ONLY A\'s singleton; public payloads never mix', async () => {
    const putA = await as(tokenA, '/api/school/website/admissions', {
      method: 'PUT',
      body: JSON.stringify({
        status: 'OPEN',
        session: `${MARKER}-A`,
        classesAccepting: ['Class 1'],
        published: true,
        noticeTitle: `${MARKER} A admissions`,
      }),
    })
    expect(putA.status).toBe(200)
    const rowA = await db.websiteAdmission.findUnique({ where: { schoolId: schoolA.id } })
    cleanup.push(() => rowA && db.websiteAdmission.update({ where: { schoolId: schoolA.id }, data: { published: false, session: null, noticeTitle: null, status: 'CLOSED' } }))

    // B's singleton is NOT touched by A's write.
    const rowB = await db.websiteAdmission.findUnique({ where: { schoolId: schoolB.id } })
    expect(rowB?.session ?? null).not.toBe(`${MARKER}-A`)

    // Public payloads: A's slug carries A's admissions; B's does not.
    const pubA = await publicPayload(schoolA.slug)
    const pubB = await publicPayload(schoolB.slug)
    expect(pubA?.admissions?.noticeTitle).toBe(`${MARKER} A admissions`)
    expect(pubB?.admissions?.noticeTitle ?? null).not.toBe(`${MARKER} A admissions`)
  })

  test('subscription surface: A sees ONLY A\'s payment ledger', async () => {
    const payment = await db.platformPayment.create({
      data: {
        schoolId: schoolB.id,
        amount: 100,
        currency: 'INR',
        mode: 'CASH',
        paymentDate: new Date(),
        periodMonths: 1,
        reference: `${MARKER}-B-only`,
        verification: 'VERIFIED',
      },
    })
    cleanup.push(() => db.platformPayment.deleteMany({ where: { id: payment.id } }))

    const statusA = await as(tokenA, '/api/subscription')
    const bodyA = await json(statusA)
    const refsA: string[] = (bodyA?.data?.recentPayments ?? []).map((p: any) => p.receiptNo)
    // A's ledger contains A payments only — B's row (no receipt yet) and
    // B's earlier verified payment never appear for A.
    const statusB = await as(tokenB, '/api/subscription')
    const bodyB = await json(statusB)
    expect(statusA.status).toBe(200)
    expect(statusB.status).toBe(200)
    const bReceipts: string[] = (bodyB?.data?.recentPayments ?? []).map((p: any) => p.receiptNo)
    const aReceipts = new Set(refsA)
    for (const r of bReceipts) expect(aReceipts.has(r)).toBe(false)
  })

  test('profile change requests: principal requests are school-scoped; platform review is path-tenant-scoped', async () => {
    const reqA = await db.schoolProfileChangeRequest.create({
      data: {
        schoolId: schoolA.id,
        field: 'name',
        currentValue: 'Hawkings High',
        requestedValue: `${MARKER} name`,
        reason: 'SaaS-hardening isolation test',
        status: 'PENDING',
      },
    })
    cleanup.push(() => db.schoolProfileChangeRequest.deleteMany({ where: { id: reqA.id } }))

    // A's principal sees ONLY A's requests.
    const listA = await as(tokenA, '/api/school-settings/profile-change-request')
    const bodyA = await json(listA)
    const idsA: string[] = (bodyA?.data?.requests ?? []).map((r: any) => r.id)
    expect(idsA).toContain(reqA.id)

    // B's principal never sees A's request.
    const listB = await as(tokenB, '/api/school-settings/profile-change-request')
    const bodyB = await json(listB)
    const idsB: string[] = (bodyB?.data?.requests ?? []).map((r: any) => r.id)
    expect(idsB).not.toContain(reqA.id)
  })
})

// ═════════════════════════════════════════════════════════════════════
// WEBSITE — publish lifecycle + public honesty
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · notice publish lifecycle (live)', () => {
  test('draft is private; publish → public; unpublish → private; schedule/expiry honored', async () => {
    const created = await db.websiteNotice.create({
      data: { schoolId: schoolA.id, kind: 'NOTICE', title: `${MARKER} lifecycle`, body: 'x'.repeat(20) },
    })
    cleanup.push(() => db.websiteNotice.deleteMany({ where: { id: created.id } }))

    // DRAFT: never public.
    let pub = await publicPayload(schoolA.slug)
    expect((pub?.notices ?? []).some((n: any) => n.title === `${MARKER} lifecycle`)).toBe(false)

    // PUBLISH → public.
    const publish = await as(tokenA, `/api/school/website/notices/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'publish' }),
    })
    expect(publish.status).toBe(200)
    pub = await publicPayload(schoolA.slug)
    expect((pub?.notices ?? []).some((n: any) => n.title === `${MARKER} lifecycle`)).toBe(true)

    // UNPUBLISH → private again.
    const unpublish = await as(tokenA, `/api/school/website/notices/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'unpublish' }),
    })
    expect(unpublish.status).toBe(200)
    pub = await publicPayload(schoolA.slug)
    expect((pub?.notices ?? []).some((n: any) => n.title === `${MARKER} lifecycle`)).toBe(false)

    // SCHEDULED in the future → not public yet.
    await db.websiteNotice.update({
      where: { id: created.id },
      data: { status: 'SCHEDULED', publishAt: new Date(Date.now() + 86_400_000) },
    })
    pub = await publicPayload(schoolA.slug)
    expect((pub?.notices ?? []).some((n: any) => n.title === `${MARKER} lifecycle`)).toBe(false)

    // EXPIRED (published but past expiry) → not public.
    await db.websiteNotice.update({
      where: { id: created.id },
      data: { status: 'PUBLISHED', publishAt: new Date(), expiresAt: new Date(Date.now() - 60_000) },
    })
    pub = await publicPayload(schoolA.slug)
    expect((pub?.notices ?? []).some((n: any) => n.title === `${MARKER} lifecycle`)).toBe(false)
  })

  test('cross-tenant public: A\'s published notice never appears on B\'s site', async () => {
    const n = await db.websiteNotice.create({
      data: {
        schoolId: schoolA.id,
        kind: 'NOTICE',
        title: `${MARKER} A only notice`,
        body: 'x'.repeat(20),
        status: 'PUBLISHED',
        publishAt: new Date(),
      },
    })
    cleanup.push(() => db.websiteNotice.deleteMany({ where: { id: n.id } }))

    const pubA = await publicPayload(schoolA.slug)
    const pubB = await publicPayload(schoolB.slug)
    expect((pubA?.notices ?? []).some((x: any) => x.title === `${MARKER} A only notice`)).toBe(true)
    expect((pubB?.notices ?? []).some((x: any) => x.title === `${MARKER} A only notice`)).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════
// DOMAIN — no infrastructure controls on the principal plane
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · custom domain is platform-owned', () => {
  test('principal GET returns status only (no tokens, no DNS instructions); POST no longer exists', async () => {
    const res = await as(tokenA, '/api/school/domains')
    expect(res.status).toBe(200)
    const body = await json(res)
    const payload = JSON.stringify(body?.data ?? {})
    expect(payload).not.toContain('verificationToken')
    expect(payload).not.toContain('verificationTxt')
    expect(payload).not.toContain('CNAME')
    expect(payload).not.toContain('TXT')

    const post = await as(tokenA, '/api/school/domains', {
      method: 'POST',
      body: JSON.stringify({ hostname: 'evil.example.com' }),
    })
    expect([404, 405]).toContain(post.status)
  })
})

// ═════════════════════════════════════════════════════════════════════
// WEBHOOK — signature-verified activation only
// ═════════════════════════════════════════════════════════════════════
describe('SaaS-HARDENING · platform payment webhook', () => {
  const secret = process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET ?? ''
  const eventId = `evt_${MARKER}`

  function sign(raw: string): string {
    return createHmac('sha256', secret).update(raw).digest('hex')
  }

  test('unsigned → 401; wrong signature → 401 (fail-closed)', async () => {
    const raw = JSON.stringify({ eventId, eventType: 'subscription.payment.captured', payment: { schoolId: schoolB.id, amount: 1 } })
    const noSig = await fetch(`${BASE}/api/webhooks/platform-subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    expect(noSig.status).toBe(401)
    const badSig = await fetch(`${BASE}/api/webhooks/platform-subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scholario-signature': 'deadbeef' },
      body: raw,
    })
    expect(badSig.status).toBe(401)
  })

  test('signed activation → subscription ACTIVE; replay → duplicate (exactly once)', async () => {
    const subB = (await db.schoolSubscription.findUnique({ where: { schoolId: schoolB.id } }))!
    const before = { periodEnd: subB.periodEnd, status: subB.status, override: subB.overrideStatus }
    cleanup.push(() =>
      db.schoolSubscription.update({
        where: { schoolId: schoolB.id },
        data: { periodEnd: before.periodEnd, status: before.status, overrideStatus: before.override },
      }),
    )
    cleanup.push(() => db.webhookEvent.deleteMany({ where: { eventId } }))
    cleanup.push(() => db.platformPayment.deleteMany({ where: { reference: `pay_${MARKER}` } }))

    const raw = JSON.stringify({
      eventId,
      eventType: 'subscription.payment.captured',
      payment: { schoolId: schoolB.id, amount: 5_000, currency: 'INR', providerPaymentId: `pay_${MARKER}` },
      subscription: { periodMonths: 6 },
    })
    const ok = await fetch(`${BASE}/api/webhooks/platform-subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scholario-signature': sign(raw) },
      body: raw,
    })
    expect(ok.status).toBe(200)
    const okBody = await json(ok)
    expect(okBody?.ok).toBe(true)
    expect(okBody?.processed).toBe(true)

    // B's subscription now computes ACTIVE with the extended period.
    const after = await db.schoolSubscription.findUnique({ where: { schoolId: schoolB.id } })
    expect(after?.overrideStatus ?? null).toBe(null)
    expect(after?.periodEnd?.getTime() ?? 0).toBeGreaterThan(Date.now() + 150 * 86_400_000)

    // Replay → acknowledged duplicate, never re-processed.
    const replay = await fetch(`${BASE}/api/webhooks/platform-subscription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scholario-signature': sign(raw) },
      body: raw,
    })
    expect(replay.status).toBe(200)
    const replayBody = await json(replay)
    expect(replayBody?.duplicate).toBe(true)
    const payments = await db.platformPayment.count({ where: { reference: `pay_${MARKER}` } })
    expect(payments).toBe(1)
  })
})
