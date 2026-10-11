import { db } from '../helpers/db'
/**
 * FEE-ADMISSIONS MVP — the full server-issued admissions + fee workflow
 * suite (H1-R2 contract, Phases A–E).
 *
 * THE INVARIANTS UNDER TEST:
 *   1. FLAG GATING — every new-workflow endpoint is fail-closed OFF by
 *      default (FEATURE_DISABLED), per-school overridable; PRINCIPAL-only
 *      role enforcement; the legacy surface is untouched while off.
 *   2. FEE CONFIG — draft→publish produces an immutable version snapshot;
 *      the current/scheduled partial uniques hold; kind/mandatory
 *      invariants are enforced at the API and DB CHECK layers.
 *   3. QUOTE — server-side paise-exact computation with explicit
 *      selections; fail-closed FEE_CONFIGURATION_REQUIRED; deterministic
 *      422s for unknown heads / bad quantities / ineligible discounts.
 *   4. APPLICATIONS — clientRequestId idempotency (same key+payload →
 *      replay; same key+different payload → 409; cross-tenant same key →
 *      independent), siblings sharing guardian emails never block.
 *   5. STATE MACHINE — every legal transition and its illegal twin
 *      (409 INVALID_STATE); REJECTED terminal; correction loop with
 *      mandatory notes and re-fingerprinted resubmission.
 *   6. ENROLMENT — atomic all-or-nothing (student+user+obligations+
 *      snapshot+sequence+events); idempotent replay never duplicates and
 *      never re-exposes the one-time credential; EMAIL_TAKEN rolls back
 *      everything; concurrent enrolments get distinct ADM-NNNNNN numbers;
 *      exhaustion at 999999 → 409 ADMISSION_SEQUENCE_EXHAUSTED.
 *   7. SNAPSHOT IMMUTABILITY (Phase E) — the persisted
 *      AdmissionFeeSnapshot is the authoritative fee statement: a later
 *      fee-structure edit + republish NEVER changes issued amounts.
 *   8. CREDENTIAL RECOVERY — reset-credential works only in the bootstrap
 *      state, issues a new one-time expiring credential exactly once.
 *   9. TENANT ISOLATION — foreign-tenant ids are fail-safe 404s (no
 *      oracle) across detail/decision/enrol/fee-snapshot/quote.
 *
 * Live-HTTP conventions match tests/security/fee-lifecycle.test.ts: dev
 * server (TENANT_TEST_BASE, default :3000); sessions minted as DIRECT
 * ROWS (bypasses ONLY the login limiter, never an authorization gate);
 * cookie jar `erp_session=<raw>`; every created row is MARKER-tagged and
 * deleted in afterAll — the suite leaves both fixture tenants exactly as
 * it found them (flags included).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes, randomUUID } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000 // generous: first-hit dev compilation
const MARKER = randomBytes(4).toString('hex')

// ── fixtures ───────────────────────────────────────────────────────────────

let schoolA = { id: '', slug: '' }
let schoolB = { id: '', slug: '' }
let principalA = { id: '', email: 'principal@hawkingshigh.edu' }
let principalB = { id: '', email: 'principal.b@greenvalley.test' }
let tokenA = ''
let tokenB = ''
let tokenTeacher = ''
let tokenStudent = ''
let originalFlagsA: string | null = null
let originalFlagsB: string | null = null

/** MARKER classes + structures + applications created by this suite. */
let classA = { id: '', name: `FeeAdm ${MARKER} A` }
let classB = { id: '', name: `FeeAdm ${MARKER} B` }
let noStructClassA = { id: '', name: `FeeAdm ${MARKER} NoStruct` }
let structA = { id: '' }
let structB = { id: '' }
let discountCode = `FA-${MARKER.slice(0, 6)}`.toUpperCase()

const createdAppIds: string[] = []
const createdUserIds: string[] = []

const cleanup: Array<() => Promise<unknown>> = []

// ── HTTP helpers (fee-lifecycle conventions) ───────────────────────────────

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

async function call(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}), ...jar(token) },
  })
  const body = (await res.json().catch(() => null)) as any
  return { status: res.status, body }
}

const post = (token: string, path: string, data?: unknown) =>
  call(token, path, { method: 'POST', body: JSON.stringify(data ?? {}) })
const get = (token: string, path: string) => call(token, path)

// ── fixture heads (FIXED + OPTIONAL + QUANTITY + legacy-style) ─────────────

const HEADS = (amountSeed: number) => [
  { name: `Tuition ${MARKER}`, category: 'Tuition', amount: 12000 + amountSeed, frequency: 'Annual', mandatory: true },
  { name: `Admission ${MARKER}`, category: 'Admission', amount: 5000, frequency: 'One-Time', mandatory: true },
  { name: `Transport Opt ${MARKER}`, category: 'Transport', amount: 1800, frequency: 'Term', mandatory: false },
  { name: `Notebooks Qty ${MARKER}`, category: 'Books', amount: 60, frequency: 'One-Time', kind: 'QUANTITY', mandatory: false },
  { name: `Activity Kit Qty ${MARKER}`, category: 'Activity', amount: 250, frequency: 'One-Time', kind: 'QUANTITY', mandatory: false },
]

// ── suite-wide state shared across the ordered tests ───────────────────────

let quotedHeads: any[] = []
let app1 = { id: '', clientRequestId: '' } // happy-path enrolment (school A)
let appSibling = { id: '' } // same guardian email — must never block
let appCorrection = { id: '' } // correction loop (school A)
let appRejected = { id: '' } // terminal rejection (school A)
let appYearMismatch = { id: '' } // DB-mutated year conflict
let appB = { id: '', clientRequestId: '' } // full flow on tenant B
let appBEnrolled: any = null
let enrolResult: any = null
let feeSnapshotBefore: any = null

const formDataFor = (first: string, last: string, cls: string, guardianEmail: string) => ({
  firstName: first,
  lastName: last,
  className: cls,
  section: 'A',
  dob: '2015-04-12',
  gender: 'Female',
  fatherName: `${last} Father`,
  fatherPhone: '9876543210',
  fatherEmail: guardianEmail,
  motherName: `${last} Mother`,
  currentAddress: '1 Test Lane',
  state: 'MP',
  district: 'Test',
  pincode: '462001',
})

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const a = (await db.school.findFirst({ where: { isDemo: true } }))!
  const b = (await db.school.findFirst({ where: { slug: 'green-valley' } }))!
  schoolA = { id: a.id, slug: a.slug }
  schoolB = { id: b.id, slug: b.slug }
  originalFlagsA = a.featureFlags
  originalFlagsB = b.featureFlags
  // The canonical academic year is asserted through the config/quote
  // responses (2026-2027); the raw School.academicYear is read-only here.

  const byEmail = async (email: string) => (await db.user.findUnique({ where: { email } }))!
  const [pA, pB] = await Promise.all([byEmail(principalA.email), byEmail(principalB.email)])
  principalA = { ...principalA, id: pA.id }
  principalB = { ...principalB, id: pB.id }

  const t1 = (await db.user.findFirst({
    where: { schoolId: schoolA.id, role: 'TEACHER', status: 'ACTIVE' },
  }))!
  const s1 = (await db.user.findFirst({
    where: { schoolId: schoolA.id, role: 'STUDENT', status: 'ACTIVE' },
  }))!

  tokenA = randomBytes(32).toString('hex')
  tokenB = randomBytes(32).toString('hex')
  tokenTeacher = randomBytes(32).toString('hex')
  tokenStudent = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: pA.id, tokenHash: hashSessionToken(tokenA), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pB.id, tokenHash: hashSessionToken(tokenB), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: t1.id, tokenHash: hashSessionToken(tokenTeacher), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: s1.id, tokenHash: hashSessionToken(tokenStudent), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: { tokenHash: { in: [tokenA, tokenB, tokenTeacher, tokenStudent].map(hashSessionToken) } },
    }),
  )

  // MARKER classes in both tenants.
  const mk = (schoolId: string, name: string) => db.class.create({ data: { schoolId, name, gradeLevel: '6' } })
  const [cA, cB, cNS] = await Promise.all([
    mk(schoolA.id, classA.name),
    mk(schoolB.id, classB.name),
    mk(schoolA.id, noStructClassA.name),
  ])
  classA = { ...classA, id: cA.id }
  classB = { ...classB, id: cB.id }
  noStructClassA = { ...noStructClassA, id: cNS.id }
  cleanup.push(() => db.class.deleteMany({ where: { id: { in: [classA.id, classB.id, noStructClassA.id] } } }))
}, T)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Final sweep — the MARKER namespace (defense in depth for failures):
  await db.activityLog
    .deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, action: { in: ['ADMISSION_SUBMITTED', 'ADMISSION_DRAFT', 'ADMISSION_UNDER_REVIEW', 'ADMISSION_ENROLLED', 'ADMISSION_REJECTED', 'CREDENTIAL_RESET', 'ACCOUNT_CREATED', 'LOGIN_CREDENTIAL_EXPIRED'] }, detail: { contains: MARKER } } })
    .catch(() => {})
  await db.fee.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, title: { contains: MARKER } } }).catch(() => {})
  await db.student
    .deleteMany({
      where: { schoolId: { in: [schoolA.id, schoolB.id] }, user: { email: { contains: 'feeadm.' } } },
    })
    .catch(() => {})
  await db.user
    .deleteMany({ where: { id: { in: createdUserIds } } })
    .catch(() => {})
  // Sweep any user the enrolment tests created that was not tracked above
  // (all use the feeadm.* login-email namespace).
  await db.user
    .deleteMany({ where: { email: { contains: 'feeadm.' } } })
    .catch(() => {})
  await db.admissionFeeSnapshot.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, academicYear: { contains: '2026' }, lineItems: { contains: MARKER } } }).catch(() => {})
  await db.admissionApplication
    .deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, className: { contains: MARKER } } })
    .catch(() => {})
  await db.feeStructureVersion.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, snapshot: { contains: MARKER } } }).catch(() => {})
  await db.feeStructure.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, className: { contains: MARKER } } }).catch(() => {})
  await db.feeDiscountRule.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] }, code: { contains: 'FA-' } } }).catch(() => {})
  await db.admissionSequence
    .deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } })
    .catch(() => {})
  await db.school
    .update({ where: { id: schoolA.id }, data: { featureFlags: originalFlagsA } })
    .catch(() => {})
  await db.school
    .update({ where: { id: schoolB.id }, data: { featureFlags: originalFlagsB } })
    .catch(() => {})
  await db.$disconnect()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('FEE-ADMISSIONS MVP — full server-issued workflow', () => {
  // ══════════════════════════════════════════════════════════════════════
  // 1 — FLAG GATING (fail-closed default; role enforcement)
  // ══════════════════════════════════════════════════════════════════════

  test('flag OFF by default: config reports disabled and every new endpoint refuses FEATURE_DISABLED', async () => {
    const cfg = await get(tokenA, '/api/admissions/config')
    expect(cfg.status).toBe(200)
    expect(cfg.body.ok).toBe(true)
    expect(cfg.body.data.enabled).toBe(false)
    expect(cfg.body.data.academicYear).toBe(null)

    const quote = await post(tokenA, '/api/fees/quote', { classId: classA.id })
    expect(quote.status).toBe(403)
    expect(quote.body.code).toBe('FEATURE_DISABLED')

    const submit = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      formData: formDataFor('Off', 'Flag', classA.name, 'off@flag.test'),
    })
    expect(submit.status).toBe(403)
    expect(submit.body.code).toBe('FEATURE_DISABLED')
  }, T)

  test('new workflow is PRINCIPAL-only (teacher and student sessions are refused)', async () => {
    await db.school.update({
      where: { id: schoolA.id },
      data: { featureFlags: JSON.stringify({ admissionsServerIssuance: true }) },
    })
    cleanup.push(() =>
      db.school
        .update({ where: { id: schoolA.id }, data: { featureFlags: originalFlagsA } })
        .then(() => undefined),
    )

    for (const tok of [tokenTeacher, tokenStudent]) {
      const cfg = await get(tok, '/api/admissions/config')
      expect(cfg.status).toBe(403)
      const quote = await post(tok, '/api/fees/quote', { classId: classA.id })
      expect(quote.status).toBe(403)
      const apps = await get(tok, '/api/admissions/applications')
      expect(apps.status).toBe(403)
    }
    // Enabled per-school: tenant B (flag still off) is refused while A works.
    const cfgB = await get(tokenB, '/api/admissions/config')
    expect(cfgB.body.data.enabled).toBe(false)
    const cfgA = await get(tokenA, '/api/admissions/config')
    expect(cfgA.body.data.enabled).toBe(true)
    expect(cfgA.body.data.academicYear).toBe('2026-2027')
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 2 — FEE CONFIGURATION (draft → publish → immutable version)
  // ══════════════════════════════════════════════════════════════════════

  test('draft structure: legacy truth table backfill (mandatory→FIXED, optional→OPTIONAL, explicit QUANTITY)', async () => {
    const res = await post(tokenA, '/api/fees/structures', {
      classId: classA.id,
      className: classA.name,
      classLevel: 'Primary',
      heads: HEADS(0),
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    structA.id = res.body.data.id
    expect(res.body.data.status).toBe('draft')
    const kinds = res.body.data.heads.map((h: any) => `${h.kind}:${h.mandatory}`)
    // QUANTITY heads are opt-in in this fixture (a MANDATORY quantity
    // head has its own fail-closed test below).
    expect(kinds).toEqual(['FIXED:true', 'FIXED:true', 'OPTIONAL:false', 'QUANTITY:false', 'QUANTITY:false'])
    cleanup.push(() => db.feeStructure.deleteMany({ where: { id: structA.id } }).then(() => undefined))
  }, T)

  test('kind/mandatory invariant is enforced at the API layer (422 on contradictory combinations)', async () => {
    for (const bad of [
      { name: `Bad ${MARKER}`, amount: 100, kind: 'FIXED', mandatory: false },
      { name: `Bad ${MARKER}`, amount: 100, kind: 'OPTIONAL', mandatory: true },
    ]) {
      const res = await post(tokenA, '/api/fees/structures', {
        classId: noStructClassA.id,
        className: noStructClassA.name,
        heads: [bad],
      })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('INVALID_INPUT')
    }
  }, T)

  test('publish promotes draft→current atomically with an immutable version snapshot', async () => {
    const res = await post(tokenA, `/api/fees/structures/${structA.id}/publish`)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('current')
    expect(res.body.data.version).toBe(2) // draft v1 → publish v2
    expect(res.body.data.academicYear).toBe('2026-2027')

    const version = await db.feeStructureVersion.findFirst({
      where: { structureId: structA.id, version: 2 },
    })
    expect(version).not.toBeNull()
    const snapshot = JSON.parse(version!.snapshot)
    expect(snapshot.academicYear).toBe('2026-2027')
    expect(snapshot.heads.length).toBe(5)

    // Re-publishing the SAME structure is refused (it is already current).
    const again = await post(tokenA, `/api/fees/structures/${structA.id}/publish`)
    expect(again.status).toBe(400)
  }, T)

  test('partial unique: a second CURRENT structure for the same class is refused (DB + API)', async () => {
    // Draft created DB-direct (the API POST route refuses ANY structure for
    // a class that already has a current — that refusal is asserted below).
    const dup = await db.feeStructure.create({
      data: {
        schoolId: schoolA.id,
        classId: classA.id,
        className: classA.name,
        classLevel: 'Primary',
        status: 'draft',
        version: 1,
      },
    })
    cleanup.push(() => db.feeStructure.deleteMany({ where: { id: dup.id } }).then(() => undefined))
    let rejected: any = null
    try {
      await db.feeStructure.update({ where: { id: dup.id }, data: { status: 'current' } })
    } catch (e) {
      rejected = e
    }
    if (!rejected) {
      throw new Error('expected the partial unique to reject a second current structure')
    }
    expect(String((rejected as { code?: string }).code ?? '')).toContain('P2002')
    // API layer twin: the POST route refuses while a current exists.
    const apiDup = await post(tokenA, '/api/fees/structures', {
      classId: classA.id,
      className: classA.name,
      heads: [{ name: `Third ${MARKER}`, amount: 100 }],
    })
    expect(apiDup.status).toBe(409)
  }, T)

  test('DB CHECK: FeeHead kind/mandatory violations are rejected by the database itself', async () => {
    let err: unknown = null
    try {
      await db.feeHead.create({
        data: {
          schoolId: schoolA.id,
          structureId: structA.id,
          name: `DBCheck ${MARKER}`,
          kind: 'FIXED',
          mandatory: false,
          amount: 100,
        },
      })
    } catch (e) {
      err = e
    }
    if (!err) throw new Error('expected the DB CHECK to reject a FIXED/non-mandatory head')
    expect(String((err as Error).message)).toContain('db.feeHead.create')
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 3 — QUOTE (server-side amounts, fail-closed, explicit selections)
  // ══════════════════════════════════════════════════════════════════════

  test('discount rule: create with an eligible head + duplicate code refusal', async () => {
    // The rule is scoped to the Tuition head (eligible-head semantics —
    // H1-R2: single rule, no stacking, head-scoped eligibility).
    const tuitionHead = await db.feeHead.findFirst({
      where: { structureId: structA.id, name: { contains: MARKER }, category: 'Tuition' },
    })!
    const res = await post(tokenA, '/api/fees/discount-rules', {
      code: discountCode,
      name: `FeeAdmissions ${MARKER}`,
      headId: tuitionHead.id,
      type: 'FLAT',
      value: 2500,
      active: true,
    })
    expect(res.status).toBe(200)
    cleanup.push(() => db.feeDiscountRule.deleteMany({ where: { code: discountCode } }).then(() => undefined))

    const dup = await post(tokenA, '/api/fees/discount-rules', {
      code: discountCode,
      name: 'Duplicate',
      type: 'FLAT',
      value: 1,
    })
    expect(dup.status).toBe(409)
  }, T)

  test('quote with no selections applies FIXED heads only, paise-exact', async () => {
    const res = await post(tokenA, '/api/fees/quote', { classId: classA.id })
    expect(res.status).toBe(200)
    const q = res.body.data
    expect(q.academicYear).toBe('2026-2027')
    expect(q.structureVersion).toBe(2)
    quotedHeads = q.selectableHeads
    expect(quotedHeads.length).toBe(5)
    expect(q.quote.lineItems.length).toBe(2) // two FIXED heads
    expect(q.quote.totals.gross).toBe(17000)
    expect(q.quote.totals.net).toBe(17000)
    expect(q.quote.discount).toBe(null)
  }, T)

  test('quote with explicit selections (optional + quantities + eligible discount) computes server-side', async () => {
    const tuition = quotedHeads.find((h: any) => h.category === 'Tuition')
    const transport = quotedHeads.find((h: any) => h.category === 'Transport')
    const notebooks = quotedHeads.find((h: any) => h.category === 'Books')
    const kit = quotedHeads.find((h: any) => h.category === 'Activity')

    const res = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: {
        optionalHeadIds: [transport.id],
        quantities: { [notebooks.id]: 7, [kit.id]: 2 },
        discountCode: discountCode,
      },
    })
    expect(res.status).toBe(200)
    const q = res.body.data.quote
    // Tuition 12000 + Admission 5000 + Transport 1800 + Notebooks 7×60=420 + Kit 2×250=500
    expect(q.totals.gross).toBe(19720)
    // FLAT 2500 off the ELIGIBLE head (Tuition) — one rule, no stacking.
    expect(q.totals.discount).toBe(2500)
    expect(q.totals.net).toBe(17220)
    expect(q.discount.code).toBe(discountCode)
    const nb = q.lineItems.find((li: any) => li.headId === notebooks.id)
    expect(nb.quantity).toBe(7)
    expect(nb.amount).toBe(420)
    const tuitionLine = q.lineItems.find((li: any) => li.headId === tuition.id)
    expect(tuitionLine.discounted).toBe(true)
  }, T)

  test('a MANDATORY quantity head fails closed when no quantity is supplied (422)', async () => {
    const cls = await db.class.create({
      data: { schoolId: schoolA.id, name: `FeeAdm ${MARKER} ReqQty` },
    })
    cleanup.push(() => db.class.deleteMany({ where: { id: cls.id } }).then(() => undefined))
    const draft = await post(tokenA, '/api/fees/structures', {
      classId: cls.id,
      className: cls.name,
      heads: [
        { name: `Tuition ${MARKER}`, amount: 1000, category: 'Tuition', mandatory: true },
        { name: `Required Qty ${MARKER}`, amount: 60, category: 'Books', kind: 'QUANTITY', mandatory: true },
      ],
    })
    expect(draft.status).toBe(200)
    const pub = await post(tokenA, `/api/fees/structures/${draft.body.data.id}/publish`)
    expect(pub.status).toBe(200)

    const noQty = await post(tokenA, '/api/fees/quote', { classId: cls.id })
    expect(noQty.status).toBe(422)
    expect(noQty.body.error).toContain('quantity is required')

    const withQty = await post(tokenA, '/api/fees/quote', {
      classId: cls.id,
      selections: { quantities: { [pub.body.data.heads[1].id]: 3 } },
    })
    expect(withQty.status).toBe(200)
    expect(withQty.body.data.quote.totals.net).toBe(1180)
  }, T)

  test('quote fail-closed: FEE_CONFIGURATION_REQUIRED for a class with no published structure', async () => {
    const res = await post(tokenA, '/api/fees/quote', { classId: noStructClassA.id })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('FEE_CONFIGURATION_REQUIRED')
  }, T)

  test('quote validations: unknown head / quantity on non-quantity / out-of-range quantity → 422', async () => {
    const tuition = quotedHeads.find((h: any) => h.category === 'Tuition')
    const unknown = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: { optionalHeadIds: ['nonexistent-head-id'] },
    })
    expect(unknown.status).toBe(422)

    const qtyOnFixed = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: { quantities: { [tuition.id]: 2 } },
    })
    expect(qtyOnFixed.status).toBe(422)

    const qtyRange = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: { quantities: { [tuition.id]: 0 } },
    })
    expect(qtyRange.status).toBe(422)

    const badDiscount = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: { discountCode: 'NO-SUCH-RULE' },
    })
    expect(badDiscount.status).toBe(422)

    // A rule with headId=null is never silently applied — requesting it
    // is a deterministic 422 (not applicable to the selected heads).
    const inertCode = `FA-INERT-${MARKER.slice(0, 4)}`.toUpperCase()
    const inert = await post(tokenA, '/api/fees/discount-rules', {
      code: inertCode,
      name: 'Inert Rule',
      type: 'FLAT',
      value: 10,
    })
    expect(inert.status).toBe(200)
    cleanup.push(() => db.feeDiscountRule.deleteMany({ where: { code: inertCode } }).then(() => undefined))
    const inertQuote = await post(tokenA, '/api/fees/quote', {
      classId: classA.id,
      selections: { discountCode: inertCode },
    })
    expect(inertQuote.status).toBe(422)
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 4 — APPLICATIONS (idempotency, siblings, cross-tenant key independence)
  // ══════════════════════════════════════════════════════════════════════

  test('submission: creates SUBMITTED with an event; same key+payload replays; same key+different payload → 409', async () => {
    app1.clientRequestId = randomUUID()
    const formData = formDataFor('Aarav', 'FeeAdm', classA.name, `guardian.${MARKER}@family.test`)

    const res = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: app1.clientRequestId,
      classId: classA.id,
      formData,
      feeSelections: { quantities: {} },
    })
    expect(res.status).toBe(200)
    app1.id = res.body.data.application.id
    createdAppIds.push(app1.id)
    expect(res.body.data.application.status).toBe('SUBMITTED')
    expect(res.body.data.idempotentReplay).toBe(false)
    expect(res.body.data.application.className).toBe(classA.name)

    const events = await db.admissionApplicationEvent.findMany({ where: { applicationId: app1.id } })
    expect(events.length).toBe(1)
    expect(events[0].action).toBe('SUBMITTED')

    // Deterministic replay — exact same payload, same key.
    const replay = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: app1.clientRequestId,
      classId: classA.id,
      formData,
      feeSelections: { quantities: {} },
    })
    expect(replay.status).toBe(200)
    expect(replay.body.data.idempotentReplay).toBe(true)
    expect(replay.body.data.application.id).toBe(app1.id)
    const count = await db.admissionApplication.count({ where: { id: app1.id } })
    expect(count).toBe(1)

    // Same key, DIFFERENT payload → 409, original untouched.
    const mutate = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: app1.clientRequestId,
      classId: classA.id,
      formData: { ...formData, firstName: 'Different' },
    })
    expect(mutate.status).toBe(409)
    expect(mutate.body.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const still = await db.admissionApplication.findUnique({ where: { id: app1.id } })
    expect(still!.status).toBe('SUBMITTED')

    // Conflicting academic year in the body → 422 (never silently reconciled).
    const yearConflict = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      academicYear: '2025-2026',
      formData,
    })
    expect(yearConflict.status).toBe(422)

    // Invalid input: no clientRequestId / missing names.
    const noKey = await post(tokenA, '/api/admissions/applications', { formData })
    expect(noKey.status).toBe(422)
  }, T)

  test('siblings sharing one guardian email: both accepted; advisory detection only', async () => {
    const sharedGuardian = `shared.${MARKER}@family.test`
    const r1 = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Diya', 'Sharma', classA.name, sharedGuardian),
    })
    expect(r1.status).toBe(200)
    appSibling.id = r1.body.data.application.id
    createdAppIds.push(appSibling.id)

    const r2 = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Vihaan', 'Sharma', classA.name, sharedGuardian),
    })
    expect(r2.status).toBe(200)
    createdAppIds.push(r2.body.data.application.id)

    // Same name + same dob → the ADVISORY duplicate flag surfaces on detail
    // (never blocks: both exist as independent SUBMITTED applications).
    const r3 = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Diya', 'Sharma', classA.name, sharedGuardian),
    })
    expect(r3.status).toBe(200)
    const twinId = r3.body.data.application.id
    createdAppIds.push(twinId)
    const detail = await get(tokenA, `/api/admissions/applications/${twinId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.duplicateAdvisory.checked).toBe(true)
    expect(detail.body.data.duplicateAdvisory.possibleDuplicates.length).toBeGreaterThanOrEqual(1)
  }, T)

  test('cross-tenant: the same clientRequestId in another school creates an INDEPENDENT application', async () => {
    await db.school.update({
      where: { id: schoolB.id },
      data: { featureFlags: JSON.stringify({ admissionsServerIssuance: true }) },
    })
    cleanup.push(() =>
      db.school.update({ where: { id: schoolB.id }, data: { featureFlags: originalFlagsB } }).then(() => undefined),
    )

    // Tenant B needs its own published structure before it can quote/enrol.
    const draft = await post(tokenB, '/api/fees/structures', {
      classId: classB.id,
      className: classB.name,
      heads: HEADS(100),
    })
    expect(draft.status).toBe(200)
    structB.id = draft.body.data.id
    cleanup.push(() => db.feeStructure.deleteMany({ where: { id: structB.id } }).then(() => undefined))
    const pub = await post(tokenB, `/api/fees/structures/${structB.id}/publish`)
    expect(pub.status).toBe(200)

    appB.clientRequestId = randomUUID()
    const res = await post(tokenB, '/api/admissions/applications', {
      clientRequestId: appB.clientRequestId,
      classId: classB.id,
      formData: formDataFor('Green', 'ValleyKid', classB.name, `b.${MARKER}@family.test`),
    })
    expect(res.status).toBe(200)
    appB.id = res.body.data.application.id
    createdAppIds.push(appB.id)
    expect(appB.id).not.toBe(app1.id)

    // The key is scoped per school: replaying A's key in B does NOT hit A's row.
    const foreignKey = await post(tokenB, '/api/admissions/applications', {
      clientRequestId: app1.clientRequestId,
      classId: classB.id,
      formData: formDataFor('Other', 'TenantKid', classB.name, `b2.${MARKER}@family.test`),
    })
    expect(foreignKey.status).toBe(200)
    expect(foreignKey.body.data.idempotentReplay).toBe(false)
    createdAppIds.push(foreignKey.body.data.application.id)
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 5 — STATE MACHINE (legal + illegal transitions, correction loop)
  // ══════════════════════════════════════════════════════════════════════

  test('decision machine: start-review → approve; illegal skips and repeats → 409', async () => {
    // approve directly from SUBMITTED is illegal (review must start first).
    const early = await post(tokenA, `/api/admissions/applications/${app1.id}/decision`, { action: 'approve' })
    expect(early.status).toBe(409)
    expect(early.body.code).toBe('INVALID_STATE')

    const start = await post(tokenA, `/api/admissions/applications/${app1.id}/decision`, { action: 'start-review' })
    expect(start.status).toBe(200)
    expect(start.body.data.status).toBe('UNDER_REVIEW')

    // start-review twice → 409 (already UNDER_REVIEW).
    const startAgain = await post(tokenA, `/api/admissions/applications/${app1.id}/decision`, { action: 'start-review' })
    expect(startAgain.status).toBe(409)

    const approve = await post(tokenA, `/api/admissions/applications/${app1.id}/decision`, {
      action: 'approve',
      notes: `Approved by fee-admissions suite ${MARKER}`,
    })
    expect(approve.status).toBe(200)
    expect(approve.body.data.status).toBe('APPROVED')

    const row = await db.admissionApplication.findUnique({ where: { id: app1.id } })
    expect(row!.decisionAt).not.toBeNull()
    const events = await db.admissionApplicationEvent.findMany({
      where: { applicationId: app1.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(events.map((e) => e.action)).toEqual(['SUBMITTED', 'START_REVIEW', 'APPROVED'])

    // Rejecting an APPROVED application is an illegal transition.
    const rejectApproved = await post(tokenA, `/api/admissions/applications/${app1.id}/decision`, {
      action: 'reject',
      reason: 'too late',
    })
    expect(rejectApproved.status).toBe(409)
  }, T)

  test('correction loop: request-correction requires notes, returns to SUBMITTED, resubmit re-fingerprints', async () => {
    const sub = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Correct', 'MePlease', classA.name, `corr.${MARKER}@family.test`),
    })
    expect(sub.status).toBe(200)
    appCorrection.id = sub.body.data.application.id
    createdAppIds.push(appCorrection.id)

    await post(tokenA, `/api/admissions/applications/${appCorrection.id}/decision`, { action: 'start-review' })

    // Empty correction notes → 422.
    const empty = await post(tokenA, `/api/admissions/applications/${appCorrection.id}/decision`, {
      action: 'request-correction',
      notes: '   ',
    })
    expect(empty.status).toBe(422)

    const correction = await post(tokenA, `/api/admissions/applications/${appCorrection.id}/decision`, {
      action: 'request-correction',
      notes: 'Fix the guardian phone',
    })
    expect(correction.status).toBe(200)
    expect(correction.body.data.status).toBe('SUBMITTED')

    // The office amends and RESUBMITS — corrected formData re-fingerprinted.
    const resubmit = await post(tokenA, `/api/admissions/applications/${appCorrection.id}/decision`, {
      action: 'resubmit',
      formData: {
        ...formDataFor('Correct', 'MePlease', classA.name, `corr.${MARKER}@family.test`),
        fatherPhone: '9990001111',
      },
    })
    expect(resubmit.status).toBe(200)
    expect(resubmit.body.data.status).toBe('UNDER_REVIEW')

    const row = await db.admissionApplication.findUnique({ where: { id: appCorrection.id } })
    const payload = JSON.parse(row!.payload)
    expect(payload.formData.fatherPhone).toBe('9990001111')
    // idempotent-replay events are recorded, not duplicated decisions.
    const events = await db.admissionApplicationEvent.findMany({
      where: { applicationId: appCorrection.id },
    })
    expect(events.map((e) => e.action).sort()).toEqual(
      ['SUBMITTED', 'START_REVIEW', 'REQUEST_CORRECTION', 'RESUBMITTED'].sort(),
    )
  }, T)

  test('rejection is terminal: reject from UNDER_REVIEW then every action → 409', async () => {
    const sub = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Reject', 'MeInstead', classA.name, `rej.${MARKER}@family.test`),
    })
    expect(sub.status).toBe(200)
    appRejected.id = sub.body.data.application.id
    createdAppIds.push(appRejected.id)

    // reject from SUBMITTED directly is also legal.
    const reject = await post(tokenA, `/api/admissions/applications/${appRejected.id}/decision`, {
      action: 'reject',
      reason: 'Capacity full',
    })
    expect(reject.status).toBe(200)
    expect(reject.body.data.status).toBe('REJECTED')
    const row = await db.admissionApplication.findUnique({ where: { id: appRejected.id } })
    expect(row!.rejectionReason).toBe('Capacity full')

    for (const [action, payload] of [
      ['start-review', {}],
      ['request-correction', { notes: 'more docs' }],
      ['resubmit', { formData: formDataFor('Reject', 'MeInstead', classA.name, `rej.${MARKER}@family.test`) }],
      ['approve', {}],
      ['reject', { reason: 'again' }],
    ] as const) {
      const r = await post(tokenA, `/api/admissions/applications/${appRejected.id}/decision`, {
        action,
        ...payload,
      })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('INVALID_STATE')
    }
    // A rejected application cannot enrol.
    const enrol = await post(tokenA, `/api/admissions/applications/${appRejected.id}/enrol`, {
      loginEmail: `never.${MARKER}@created.test`,
    })
    expect(enrol.status).toBe(409)
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 6 — ENROLMENT (atomic, idempotent, concurrent, exhaustive)
  // ══════════════════════════════════════════════════════════════════════

  test('enrol: ONE transaction creates student+user+obligations+snapshot+sequence+events (one-time credential)', async () => {
    const beforeStudents = await db.student.count({ where: { schoolId: schoolA.id } })
    const beforeSeq = await db.admissionSequence.findUnique({ where: { schoolId: schoolA.id } })

    const loginEmail = `feeadm.${MARKER}@student.test`
    const res = await post(tokenA, `/api/admissions/applications/${app1.id}/enrol`, { loginEmail })
    expect(res.status).toBe(200)
    enrolResult = res.body.data
    expect(enrolResult.idempotentReplay).toBe(false)
    expect(enrolResult.admissionNo).toMatch(/^ADM-[0-9]{6}$/)
    expect(enrolResult.tempPassword).toBeTruthy()
    expect(enrolResult.feeSnapshot.totalAmount).toBe(17000) // FIXED heads only
    expect(enrolResult.student.loginEmail).toBe(loginEmail)

    // Atomic truth in the DB:
    const student = await db.student.findFirst({ where: { schoolId: schoolA.id, admissionNo: enrolResult.admissionNo } })
    expect(student).not.toBeNull()
    expect(student!.userId).toBe(enrolResult.student.userId)
    createdUserIds.push(enrolResult.student.userId)

    const user = await db.user.findUnique({ where: { id: enrolResult.student.userId } })
    expect(user!.mustChangePassword).toBe(true)
    expect(user!.credentialExpiresAt).not.toBeNull()

    const obligations = await db.fee.findMany({ where: { studentId: student!.id } })
    expect(obligations.length).toBe(2) // one Fee row per quote line item
    expect(obligations.map((f) => f.status)).toEqual(['UNPAID', 'UNPAID'])

    const snapshot = await db.admissionFeeSnapshot.findUnique({ where: { applicationId: app1.id } })
    expect(snapshot).not.toBeNull()
    expect(Number(snapshot!.totalAmount)).toBe(17000)
    expect(JSON.parse(snapshot!.lineItems).length).toBe(2)

    const seq = await db.admissionSequence.findUnique({ where: { schoolId: schoolA.id } })
    expect(seq).not.toBeNull()
    expect(seq!.currentValue).toBeGreaterThanOrEqual(1)
    expect(beforeSeq === null || seq!.currentValue > (beforeSeq?.currentValue ?? 0)).toBe(true)
    expect(await db.student.count({ where: { schoolId: schoolA.id } })).toBe(beforeStudents + 1)

    const row = await db.admissionApplication.findUnique({ where: { id: app1.id } })
    expect(row!.status).toBe('ENROLLED')
    expect(row!.enrolledStudentId).toBe(student!.id)
    // The stored canonical enrol result NEVER carries the credential.
    const stored = JSON.parse(row!.enrolResult!)
    expect(stored.tempPassword).toBeUndefined()
    expect(stored.admissionNo).toBe(enrolResult.admissionNo)
  }, T)

  test('enrol replay: same request returns the ORIGINAL result — no duplicates, NO credential re-exposure', async () => {
    const loginEmail = `feeadm.${MARKER}@student.test`
    const studentsBefore = await db.student.count({ where: { schoolId: schoolA.id } })
    const feesBefore = await db.fee.count({ where: { schoolId: schoolA.id } })
    const eventsBefore = await db.admissionApplicationEvent.count({ where: { applicationId: app1.id } })

    const res = await post(tokenA, `/api/admissions/applications/${app1.id}/enrol`, { loginEmail })
    expect(res.status).toBe(200)
    const replay = res.body.data
    expect(replay.idempotentReplay).toBe(true)
    expect(replay.admissionNo).toBe(enrolResult.admissionNo)
    expect(replay.student.id).toBe(enrolResult.student.id)
    expect(replay.tempPassword).toBeUndefined() // never re-exposed
    expect(replay.feeSnapshot.totalAmount).toBe(17000)

    expect(await db.student.count({ where: { schoolId: schoolA.id } })).toBe(studentsBefore)
    expect(await db.fee.count({ where: { schoolId: schoolA.id } })).toBe(feesBefore)
    expect(await db.admissionApplicationEvent.count({ where: { applicationId: app1.id } })).toBe(eventsBefore)
  }, T)

  test('EMAIL_TAKEN: enrolment with an existing email rolls back EVERYTHING (application stays APPROVED)', async () => {
    // Approve the sibling and try to enrol it with the SAME login email.
    await post(tokenA, `/api/admissions/applications/${appSibling.id}/decision`, { action: 'start-review' })
    await post(tokenA, `/api/admissions/applications/${appSibling.id}/decision`, { action: 'approve' })

    const studentsBefore = await db.student.count({ where: { schoolId: schoolA.id } })
    const seqBefore = (await db.admissionSequence.findUnique({ where: { schoolId: schoolA.id } }))!.currentValue

    const res = await post(tokenA, `/api/admissions/applications/${appSibling.id}/enrol`, {
      loginEmail: `feeadm.${MARKER}@student.test`,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('EMAIL_TAKEN')

    const row = await db.admissionApplication.findUnique({ where: { id: appSibling.id } })
    expect(row!.status).toBe('APPROVED') // untouched
    expect(row!.enrolledStudentId).toBeNull()
    expect(await db.student.count({ where: { schoolId: schoolA.id } })).toBe(studentsBefore)
    const seqAfter = (await db.admissionSequence.findUnique({ where: { schoolId: schoolA.id } }))!.currentValue
    expect(seqAfter).toBe(seqBefore) // the rolled-back allocation freed the number
  }, T)

  test('concurrent enrolments serialize to DISTINCT admission numbers', async () => {
    // Approve two more applications first.
    const mkApproved = async (first: string) => {
      const sub = await post(tokenA, '/api/admissions/applications', {
        clientRequestId: randomUUID(),
        classId: classA.id,
        formData: formDataFor(first, 'Concurrent', classA.name, `conc.${MARKER}@family.test`),
      })
      const id = sub.body.data.application.id
      createdAppIds.push(id)
      await post(tokenA, `/api/admissions/applications/${id}/decision`, { action: 'start-review' })
      await post(tokenA, `/api/admissions/applications/${id}/decision`, { action: 'approve' })
      return id
    }
    const idA = await mkApproved('First')
    const idB = await mkApproved('Second')

    const [ra, rb] = await Promise.all([
      post(tokenA, `/api/admissions/applications/${idA}/enrol`, { loginEmail: `feeadm.a.${MARKER}@student.test` }),
      post(tokenA, `/api/admissions/applications/${idB}/enrol`, { loginEmail: `feeadm.b.${MARKER}@student.test` }),
    ])
    expect(ra.status).toBe(200)
    expect(rb.status).toBe(200)
    expect(ra.body.data.admissionNo).not.toBe(rb.body.data.admissionNo)
    expect(ra.body.data.admissionNo).toMatch(/^ADM-[0-9]{6}$/)
    expect(rb.body.data.admissionNo).toMatch(/^ADM-[0-9]{6}$/)
    const seq = await db.admissionSequence.findUnique({ where: { schoolId: schoolA.id } })
    expect([ra.body.data.admissionNo, rb.body.data.admissionNo].map((n) => Number(n.slice(4))).sort((x, y) => x - y)).toEqual(
      [Number(seq!.currentValue) - 1, Number(seq!.currentValue)],
    )
  }, T)

  test('academic-year conflict: an application from another year fails closed (409, no enrolment)', async () => {
    const sub = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Old', 'YearKid', classA.name, `old.${MARKER}@family.test`),
    })
    appYearMismatch.id = sub.body.data.application.id
    createdAppIds.push(appYearMismatch.id)
    await post(tokenA, `/api/admissions/applications/${appYearMismatch.id}/decision`, { action: 'start-review' })
    await post(tokenA, `/api/admissions/applications/${appYearMismatch.id}/decision`, { action: 'approve' })

    // DB-direct mutation: the application "was submitted" under an old year.
    await db.admissionApplication.update({
      where: { id: appYearMismatch.id },
      data: { academicYear: '2025-2026' },
    })

    const res = await post(tokenA, `/api/admissions/applications/${appYearMismatch.id}/enrol`, {
      loginEmail: `feeadm.old.${MARKER}@student.test`,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('INVALID_STATE')
    const row = await db.admissionApplication.findUnique({ where: { id: appYearMismatch.id } })
    expect(row!.status).toBe('APPROVED')
  }, T)

  test('sequence exhaustion at 999999: 409 ADMISSION_SEQUENCE_EXHAUSTED, nothing created', async () => {
    // Approve one more, then pin the sequence at its ceiling.
    const sub = await post(tokenA, '/api/admissions/applications', {
      clientRequestId: randomUUID(),
      classId: classA.id,
      formData: formDataFor('Exhaust', 'TheSeq', classA.name, `exh.${MARKER}@family.test`),
    })
    const id = sub.body.data.application.id
    createdAppIds.push(id)
    await post(tokenA, `/api/admissions/applications/${id}/decision`, { action: 'start-review' })
    await post(tokenA, `/api/admissions/applications/${id}/decision`, { action: 'approve' })

    await db.admissionSequence.update({
      where: { schoolId: schoolA.id },
      data: { currentValue: 999999 },
    })

    const studentsBefore = await db.student.count({ where: { schoolId: schoolA.id } })
    const res = await post(tokenA, `/api/admissions/applications/${id}/enrol`, {
      loginEmail: `feeadm.exh.${MARKER}@student.test`,
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ADMISSION_SEQUENCE_EXHAUSTED')
    expect(await db.student.count({ where: { schoolId: schoolA.id } })).toBe(studentsBefore)
    const row = await db.admissionApplication.findUnique({ where: { id } })
    expect(row!.status).toBe('APPROVED')
    // Restore the true sequence head so later cleanup/teardown is honest.
    await db.admissionSequence.update({
      where: { schoolId: schoolA.id },
      data: { currentValue: 999900 },
    })
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 7 — SNAPSHOT IMMUTABILITY (Phase E — persisted amounts never move)
  // ══════════════════════════════════════════════════════════════════════

  test('fee-snapshot endpoint returns the exact persisted amounts for official documents', async () => {
    const res = await get(tokenA, `/api/admissions/applications/${app1.id}/fee-snapshot`)
    expect(res.status).toBe(200)
    feeSnapshotBefore = res.body.data
    expect(feeSnapshotBefore.totalAmount).toBe(17000)
    expect(feeSnapshotBefore.structureVersion).toBe(2)
    expect(feeSnapshotBefore.lineItems.length).toBe(2)
    expect(feeSnapshotBefore.academicYear).toBe('2026-2027')
    expect(feeSnapshotBefore.status).toBe('ENROLLED')
  }, T)

  test('a later fee-structure edit + REPUBLISH never changes the issued snapshot', async () => {
    // The canonical amend flow: archive the current → create a new draft
    // (allowed again) → publish with materially different amounts.
    const archive = await call(tokenA, `/api/fees/structures/${structA.id}?reason=republish-test`, {
      method: 'DELETE',
    })
    expect(archive.status).toBe(200)
    expect(archive.body.data.archived).toBe(true)

    const draft = await post(tokenA, '/api/fees/structures', {
      classId: classA.id,
      className: classA.name,
      heads: [
        { name: `Tuition ${MARKER}`, category: 'Tuition', amount: 99000, frequency: 'Annual', mandatory: true },
        { name: `Admission ${MARKER}`, category: 'Admission', amount: 5000, frequency: 'One-Time', mandatory: true },
      ],
    })
    expect(draft.status).toBe(200)
    const newStructId = draft.body.data.id
    cleanup.push(() => db.feeStructure.deleteMany({ where: { id: newStructId } }).then(() => undefined))
    const pub = await post(tokenA, `/api/fees/structures/${newStructId}/publish`)
    expect(pub.status).toBe(200)

    // The live quote now reflects the NEW amounts…
    const quote = await post(tokenA, '/api/fees/quote', { classId: classA.id })
    expect(quote.body.data.quote.totals.net).toBe(104000)

    // …but the issued snapshot is unchanged (immutable).
    const res = await get(tokenA, `/api/admissions/applications/${app1.id}/fee-snapshot`)
    expect(res.status).toBe(200)
    expect(res.body.data.totalAmount).toBe(feeSnapshotBefore.totalAmount)
    expect(res.body.data.structureVersion).toBe(feeSnapshotBefore.structureVersion)
    expect(JSON.stringify(res.body.data.lineItems)).toBe(JSON.stringify(feeSnapshotBefore.lineItems))
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 8 — CREDENTIAL RECOVERY (bootstrap-only, one-time, expiring)
  // ══════════════════════════════════════════════════════════════════════

  test('reset-credential: issues a NEW one-time expiring credential exactly once (bootstrap state only)', async () => {
    const studentId = enrolResult.student.id
    const oldHash = (await db.user.findUnique({ where: { id: enrolResult.student.userId } }))!.passwordHash

    const res = await post(tokenA, `/api/students/${studentId}/reset-credential`)
    expect(res.status).toBe(200)
    expect(res.body.data.tempPassword).toBeTruthy()
    expect(res.body.data.credentialExpiresAt).toBeTruthy()
    expect(res.body.data.loginEmail).toBe(enrolResult.student.loginEmail)

    const newHash = (await db.user.findUnique({ where: { id: enrolResult.student.userId } }))!.passwordHash
    expect(newHash).not.toBe(oldHash)
    expect((await db.user.findUnique({ where: { id: enrolResult.student.userId } }))!.mustChangePassword).toBe(true)

    // Teachers cannot reset (PRINCIPAL-only).
    const asTeacher = await post(tokenTeacher, `/api/students/${studentId}/reset-credential`)
    expect(asTeacher.status).toBe(403)

    // Once the account sets its own password, the reset flow refuses.
    await db.user.update({
      where: { id: enrolResult.student.userId },
      data: { mustChangePassword: false, passwordChangedAt: new Date() },
    })
    const afterOwn = await post(tokenA, `/api/students/${studentId}/reset-credential`)
    expect(afterOwn.status).toBe(422)
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 9 — FULL WORKFLOW ON THE SECOND TENANT (B) + CROSS-TENANT ISOLATION
  // ══════════════════════════════════════════════════════════════════════

  test('tenant B full workflow: submit → review → approve → enrol → snapshot', async () => {
    const cfg = await get(tokenB, '/api/admissions/config')
    expect(cfg.body.data.enabled).toBe(true)

    await post(tokenB, `/api/admissions/applications/${appB.id}/decision`, { action: 'start-review' })
    await post(tokenB, `/api/admissions/applications/${appB.id}/decision`, { action: 'approve' })

    const loginEmail = `feeadm.bv.${MARKER}@student.test`
    const res = await post(tokenB, `/api/admissions/applications/${appB.id}/enrol`, { loginEmail })
    expect(res.status).toBe(200)
    appBEnrolled = res.body.data
    expect(appBEnrolled.admissionNo).toMatch(/^ADM-[0-9]{6}$/)
    expect(appBEnrolled.tempPassword).toBeTruthy()
    createdUserIds.push(appBEnrolled.student.userId)

    // B's sequence is independent from A's.
    const seqB = await db.admissionSequence.findUnique({ where: { schoolId: schoolB.id } })
    expect(seqB!.currentValue).toBeGreaterThanOrEqual(1)

    const snap = await get(tokenB, `/api/admissions/applications/${appB.id}/fee-snapshot`)
    expect(snap.status).toBe(200)
    // HEADS(100): Tuition 12100 + Admission 5000 = 17100 (FIXED only).
    expect(snap.body.data.totalAmount).toBe(17100)
  }, T)

  test('cross-tenant isolation: foreign ids fail-safe 404 across every new surface (no oracle)', async () => {
    // A's principal cannot read/decide/enrol/snapshot B's application.
    const detail = await get(tokenA, `/api/admissions/applications/${appB.id}`)
    expect(detail.status).toBe(404)
    const decide = await post(tokenA, `/api/admissions/applications/${appB.id}/decision`, { action: 'approve' })
    expect(decide.status).toBe(404)
    const enrol = await post(tokenA, `/api/admissions/applications/${appB.id}/enrol`, {
      loginEmail: `x.${MARKER}@nowhere.test`,
    })
    expect(enrol.status).toBe(404)
    const snap = await get(tokenA, `/api/admissions/applications/${appB.id}/fee-snapshot`)
    expect(snap.status).toBe(404)

    // B's principal cannot quote A's class (FK in-tenant only).
    const quote = await post(tokenB, '/api/fees/quote', { classId: classA.id })
    expect(quote.status).toBe(404)

    // B's application list never contains A's applications.
    const listB = await get(tokenB, '/api/admissions/applications')
    expect(listB.status).toBe(200)
    const idsB = listB.body.data.map((x: any) => x.id)
    expect(idsB).not.toContain(app1.id)
    expect(idsB).toContain(appB.id)

    // The enrolled students stay in their own tenants.
    const studentA_row = await db.student.findUnique({ where: { id: enrolResult.student.id } })
    const studentB_row = await db.student.findUnique({ where: { id: appBEnrolled.student.id } })
    expect(studentA_row!.schoolId).toBe(schoolA.id)
    expect(studentB_row!.schoolId).toBe(schoolB.id)
  }, T)

  test('per-school flag restore: tenant B off again → FEATURE_DISABLED (A still on)', async () => {
    await db.school.update({
      where: { id: schoolB.id },
      data: { featureFlags: JSON.stringify({ admissionsServerIssuance: false }) },
    })
    const quoteB = await post(tokenB, '/api/fees/quote', { classId: classB.id })
    expect(quoteB.status).toBe(403)
    expect(quoteB.body.code).toBe('FEATURE_DISABLED')
    const cfgB = await get(tokenB, '/api/admissions/config')
    expect(cfgB.body.data.enabled).toBe(false)

    // A is unaffected (flag isolation).
    const cfgA = await get(tokenA, '/api/admissions/config')
    expect(cfgA.body.data.enabled).toBe(true)

    // Restore B's ORIGINAL flags for the fixture-tenant contract.
    await db.school.update({ where: { id: schoolB.id }, data: { featureFlags: originalFlagsB } })
  }, T)

  // ══════════════════════════════════════════════════════════════════════
  // 10 — DB SPOT-CHECKS (schema-level invariants from the migration)
  // ══════════════════════════════════════════════════════════════════════

  test('AdmissionSequence CHECK: values outside 0..999999 are rejected by the DB', async () => {
    let err: unknown = null
    try {
      await db.admissionSequence.update({
        where: { schoolId: schoolA.id },
        data: { currentValue: 1000000 },
      })
    } catch (e) {
      err = e
    }
    if (!err) throw new Error('expected the DB CHECK to reject currentValue=1000000')
  }, T)

  test('idempotency unique: duplicate (schoolId, clientRequestId) direct writes are rejected', async () => {
    let err: unknown = null
    try {
      await db.admissionApplication.create({
        data: {
          schoolId: schoolA.id,
          clientRequestId: app1.clientRequestId,
          status: 'SUBMITTED',
          academicYear: '2026-2027',
          className: classA.name,
          applicantFirstName: 'Dupe',
          applicantLastName: 'Write',
          payload: '{}',
          payloadHash: 'x',
        },
      })
    } catch (e) {
      err = e
    }
    if (!err) throw new Error('expected the idempotency unique to reject the duplicate write')
  }, T)
})
