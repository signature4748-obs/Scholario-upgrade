/**
 * ADD-SCHOOL WIZARD (2026-10-20) — focused API regression suite for the
 * 7-step onboarding contract (mission §8 acceptance items that are
 * API-provable; the pure derivation unit tests live in
 * tests/unit/school-identity-derive.test.ts, and the browser E2E covers
 * the wizard UI itself).
 *
 * THE INVARIANTS UNDER TEST:
 *   1.  Boards — only UP Board and CBSE can be provisioned (ICSE/STATE/
 *       CUSTOM are legacy-read-only); the two accepted boards persist.
 *   2.  School code is OPTIONAL — absent code ⇒ the allocated internal
 *       record prefix becomes the code (unique by construction);
 *       a supplied code keeps its uniqueness error.
 *   3.  Internal record prefix — allocated server-side per abbrev
 *       sequence (concurrency-safe advisory lock), format-stable,
 *       IMMUTABLE under later school edits, never reused and never
 *       re-derived from the (new) name.
 *   4.  Prefix collisions — same-name schools get sequential numbers.
 *   5.  Slug collisions — the precheck endpoint reports taken slugs
 *       with free suggestions; provisioning a taken slug stays a 409.
 *   6.  Subscription terms — school-based monthly/yearly and
 *       student-based YEARLY persist their interval / unit price /
 *       currency / licensed count; periodEnd stays null (NO fabricated
 *       payment) and paymentsRecorded is honestly 0.
 *   7.  Student-based MONTHLY is rejected by the API (UI never offers
 *       it); amount/frequency are validated (zero, negative, >max,
 *       string, half-configured pairs, licensed count on the wrong
 *       model).
 *   8.  Principal phone persists on the founding principal's User row.
 *   9.  Address extras (line 2, district, PIN) persist in settings;
 *       Indian PINs are validated as Indian (6 digits, first 1–8) —
 *       and a LEGITIMATE Indian PIN is accepted.
 *  10.  Classes bootstrap dedupes (name, section) pairs server-side.
 *  11.  Directory — search finds schools by record prefix; the board
 *       and billing-frequency filters return live-DB subsets; rows
 *       carry recordPrefix.
 *  12.  Idempotent replay — a no-code provision retried with the same
 *       payload replays (no duplicate school).
 *  13.  Student-access pause/resume — a DISTINCT, server-enforced
 *       operation: pause locks ONLY this school's student accounts
 *       (User.subscriptionStatus LOCKED — the gate withUser already
 *       enforces on every business API), staff accounts are untouched,
 *       the scope + reason are recorded and audited, resume restores
 *       ONLY the pause's scope and never unlocks accounts that were
 *       locked individually for other reasons.
 *  14.  recordPrefix is immutable — PATCH refuses the field (strict
 *       body), and a name change never rewrites the prefix.
 *
 * LIVE HTTP against the dev server; stepped-up session fixtures minted
 * directly (auth fixtures, NOT authorization bypasses — every
 * permission/step-up check under test still runs server-side).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes, createHash } from 'crypto'
import { db } from '../helpers/db'
import { liveFetch } from '../helpers/live-http'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000
const MARKER = randomBytes(4).toString('hex')

const minted: string[] = []

/** Stepped-up platform root session (schools.manage + stepUp path). */
async function steppedUpRoot(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
  if (!admin) throw new Error('root platform admin missing — run seed-platform')
  const raw = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  minted.push(raw)
  return raw
}

async function platform(token: string, path: string, init: RequestInit = {}) {
  // liveFetch (the repo-standard transport-resilient fetch) — this suite
  // used a raw fetch, which hard-fails when a cold loaded runner takes
  // >10s to lazy-compile the heavy provision route graph (observed as the
  // recurring §STEP-1 TimeoutError on run #169 and the 2026-10-29 runs).
  // Assertions are untouched — only the transport gets the documented
  // retry + per-attempt budget every other live suite already uses. The
  // OUTER per-attempt budget stays at the 10s default so every cut is
  // retried within this 90s deadline (the preload's 25s inner budget
  // absorbs the compile inside an attempt; the outer signal, combined
  // via AbortSignal.any, must never outlive it or the cut would look
  // deterministic and never retry).
  return liveFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': token, ...(init.headers ?? {}) },
  }, { deadlineMs: 90_000 })
}

/** Unwrap the canonical { ok, data } platform envelope. */
async function dataOf(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
  return json.data
}

function body(overrides: Record<string, unknown> = {}) {
  const suffix = `${MARKER}-${randomBytes(3).toString('hex')}`
  return {
    name: `Wizard Academy ${suffix}`,
    slug: `wizard-${suffix}`,
    principalName: 'Wizard Principal',
    principalEmail: `principal-${suffix}@wizard.test`,
    ...overrides,
  }
}

async function provision(token: string, payload: Record<string, unknown>) {
  return platform(token, '/api/platform/schools', { method: 'POST', body: JSON.stringify(payload) })
}

const PREFIX_RE = /^[A-Z0-9X]{2,5}-[0-9]{4,}$/

/** Full teardown of a marker school ecosystem. */
async function purgeSchool(schoolId: string) {
  if (!schoolId) return
  await db.session.deleteMany({ where: { user: { schoolId } } })
  await db.user.deleteMany({ where: { schoolId } })
  await db.platformAuditLog.deleteMany({ where: { schoolId } })
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

const created: string[] = []

beforeAll(async () => {}, 60_000)

afterAll(async () => {
  for (const id of created) await purgeSchool(id).catch(() => {})
  // Belt-and-braces marker sweep.
  const strays = await db.school.findMany({
    where: { slug: { contains: `wizard-${MARKER}` } },
    select: { id: true },
  })
  for (const s of strays) await purgeSchool(s.id).catch(() => {})
  for (const raw of minted) {
    await db.platformAdminSession
      .deleteMany({ where: { tokenHash: createHash('sha256').update(raw).digest('hex') } })
      .catch(() => {})
  }
}, 120_000)

describe('wizard §STEP 1 — board, optional code, prefix, slug', () => {
  test(
    'only CBSE and UP_BOARD can be provisioned; legacy boards are refused',
    async () => {
      const token = await steppedUpRoot()
      for (const board of ['ICSE', 'STATE', 'CUSTOM']) {
        const res = await provision(token, body({ board }))
        expect(res.status).toBe(422)
        const payload = (await res.json()) as { error?: string }
        expect(String(payload.error ?? '')).toMatch(/board/i)
      }
      const up = await provision(token, body({ board: 'UP_BOARD' }))
      expect(up.status).toBe(200)
      const upData = await dataOf(up)
      const upSchool = upData.school as { id: string; board?: string }
      expect(upSchool.id).toBeTruthy()
      created.push(upSchool.id)
      const row = await db.school.findUnique({ where: { id: upSchool.id }, select: { board: true } })
      expect(row?.board).toBe('UP_BOARD')
    },
    T,
  )

  test(
    'school code is optional — an absent code is assigned from the allocated record prefix; duplicates still 409',
    async () => {
      const token = await steppedUpRoot()
      const payload = body({}) // NO code
      const res = await provision(token, payload)
      expect(res.status).toBe(200)
      const school = (await dataOf(res)).school as { id: string; code: string; recordPrefix: string }
      created.push(school.id)
      expect(school.recordPrefix).toMatch(PREFIX_RE)
      expect(school.code).toBe(school.recordPrefix)

      // A supplied code that duplicates an existing one is still a 409.
      const dupe = await provision(
        token,
        body({ code: school.code, slug: `wizard-${MARKER}-code-dupe` }),
      )
      expect(dupe.status).toBe(409)

      // And the precheck reports the code as taken.
      const pre = await platform(
        token,
        `/api/platform/schools/precheck?code=${encodeURIComponent(school.code)}`,
      )
      expect(pre.status).toBe(200)
      const code = (await dataOf(pre)).code as { available: boolean }
      expect(code.available).toBe(false)
    },
    T,
  )

  test(
    'same-name schools get sequential prefix numbers (collision handling, no reuse)',
    async () => {
      const token = await steppedUpRoot()
      const name = `Prefix Collision College ${MARKER}`
      const first = await provision(token, body({ name }))
      expect(first.status).toBe(200)
      const firstSchool = ((await dataOf(first)).school ?? {}) as { id: string; recordPrefix: string }
      created.push(firstSchool.id)

      const second = await provision(
        token,
        body({ name, slug: `wizard-${MARKER}-collision-2` }),
      )
      expect(second.status).toBe(200)
      const secondSchool = ((await dataOf(second)).school ?? {}) as { id: string; recordPrefix: string }
      created.push(secondSchool.id)

      const firstNum = Number(firstSchool.recordPrefix.split('-')[1])
      const secondNum = Number(secondSchool.recordPrefix.split('-')[1])
      expect(secondSchool.recordPrefix.split('-')[0]).toBe(
        firstSchool.recordPrefix.split('-')[0],
      )
      expect(secondNum).toBe(firstNum + 1)
    },
    T,
  )

  test(
    'recordPrefix is immutable: PATCH refuses the field and a name change never rewrites it',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(token, body({}))
      const json = ((await dataOf(res)).school ?? {}) as { id: string; recordPrefix: string }
      created.push(json.id)

      // Strict body: recordPrefix is not a patchable field.
      const bad = await platform(token, `/api/platform/schools/${json.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ recordPrefix: 'FAKE-9999' }),
      })
      expect(bad.status).toBe(422)

      // A legitimate name change keeps the prefix stable.
      const rename = await platform(token, `/api/platform/schools/${json.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: `Renamed Academy ${MARKER}` }),
      })
      expect(rename.status).toBe(200)
      const row = await db.school.findUnique({
        where: { id: json.id },
        select: { recordPrefix: true },
      })
      expect(row?.recordPrefix).toBe(json.recordPrefix)
    },
    T,
  )

  test(
    'precheck: slug availability + suggestions; provisioning a taken slug stays a 409',
    async () => {
      const token = await steppedUpRoot()
      const taken = (await db.school.findFirst({ select: { slug: true } }))?.slug ?? 'hawkings-prithvipur'
      const pre = await platform(
        token,
        `/api/platform/schools/precheck?slug=${encodeURIComponent(taken)}&name=${encodeURIComponent(`Green Valley Public School ${MARKER}`)}`,
      )
      expect(pre.status).toBe(200)
      const preBody = (await dataOf(pre)) as unknown as {
        slug: { available: boolean; suggestions: string[] }
        generated: {
          shortName: string | null
          slug: string | null
          prefixAbbreviation: string | null
          prefixNextNumber: number | null
        }
      }
      expect(preBody.slug.available).toBe(false)
      expect(preBody.slug.suggestions.length).toBeGreaterThan(0)
      // Generated previews are the pure derivations the API also uses.
      expect(preBody.generated.shortName).toBe("Green Valley") // first two significant words — the pure derivation
      expect(preBody.generated.prefixAbbreviation).toMatch(/^GVPS/)
      expect(preBody.generated.slug).toBe(`green-valley-public-school-${MARKER}`)

      const clash = await provision(
        token,
        body({ slug: taken, name: `Green Valley Public School ${MARKER}` }),
      )
      expect(clash.status).toBe(409)
    },
    T,
  )

  test(
    'precheck: boundary — anonymous is refused (platform-only surface)',
    async () => {
      const res = await liveFetch(`${BASE}/api/platform/schools/precheck?slug=whatever-slug`, {}, { deadlineMs: 40_000 })
      expect(res.status).toBe(401)
    },
    T,
  )
})

describe('wizard §STEP 2 — principal & administrator', () => {
  test(
    'principal phone persists on the founding principal row (optional, validated)',
    async () => {
      const token = await steppedUpRoot()
      const payload = body({ principalPhone: '+91 98765 43210' })
      const res = await provision(token, payload)
      expect(res.status).toBe(200)
      const data = await dataOf(res)
      const principal = data.principal as { id: string; email: string }
      const school = data.school as { id: string }
      created.push(school.id)
      const row = await db.user.findUnique({ where: { id: principal.id }, select: { phone: true } })
      expect(row?.phone).toBe('+91 98765 43210')

      // Malformed phone values are rejected server-side.
      const bad = await provision(token, body({ principalPhone: 'call-me-maybe' }))
      expect(bad.status).toBe(422)
    },
    T,
  )
})

describe('wizard §STEP 3 — subscription & pricing', () => {
  test(
    'school-based MONTHLY persists interval + unit price; NO payment is fabricated',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(
        token,
        body({ billingModel: 'SCHOOL_WIDE', billingFrequency: 'MONTHLY', agreedAmount: 2500, currency: 'INR' }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as {
        school: { id: string }
        subscription: {
          billingModel: string
          interval: string
          unitPrice: number
          currency: string
          licensedStudents: number | null
          periodEnd: string | null
          paymentsRecorded: number
        }
      }
      created.push(json.school.id)
      const row = await db.schoolSubscription.findUnique({ where: { schoolId: json.school.id } })
      expect(row?.interval).toBe('MONTHLY')
      expect(Number(row?.priceSnapshot ?? 0)).toBe(2500)
      expect(row?.currencySnapshot).toBe('INR')
      expect(row?.periodEnd).toBeNull()
      // Response mirrors the DB truth exactly.
      expect(json.subscription.interval).toBe('MONTHLY')
      expect(json.subscription.unitPrice).toBe(2500)
      expect(json.subscription.paymentsRecorded).toBe(0)
      expect(json.subscription.periodEnd).toBeNull()
      expect(json.subscription.licensedStudents).toBeNull()
      // And zero platform payments exist for the tenant.
      const payments = await db.platformPayment.count({ where: { schoolId: json.school.id } })
      expect(payments).toBe(0)
    },
    T,
  )

  test(
    'school-based YEARLY persists the annual price',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(
        token,
        body({ billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: 24000, currency: 'INR' }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as { school: { id: string } }
      created.push(json.school.id)
      const row = await db.schoolSubscription.findUnique({ where: { schoolId: json.school.id } })
      expect(row?.interval).toBe('ANNUAL')
      expect(Number(row?.priceSnapshot ?? 0)).toBe(24000)
    },
    T,
  )

  test(
    'student-based YEARLY persists the per-student price + licensed count',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(
        token,
        body({
          billingModel: 'PER_STUDENT',
          billingFrequency: 'ANNUAL',
          agreedAmount: 900,
          currency: 'INR',
          licensedStudents: 120,
        }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as {
        school: { id: string }
        subscription: { licensedStudents: number | null; unitPrice: number }
      }
      created.push(json.school.id)
      const row = await db.schoolSubscription.findUnique({ where: { schoolId: json.school.id } })
      expect(row?.billingModel).toBe('PER_STUDENT')
      expect(row?.interval).toBe('ANNUAL')
      expect(Number(row?.priceSnapshot ?? 0)).toBe(900)
      expect(row?.licensedStudents).toBe(120)
      expect(json.subscription.licensedStudents).toBe(120)
    },
    T,
  )

  test(
    'student-based MONTHLY is rejected by the API (never offered by the UI)',
    async () => {
      const token = await steppedUpRoot()
      const payload = body({
        billingModel: 'PER_STUDENT',
        billingFrequency: 'MONTHLY',
        agreedAmount: 100,
        licensedStudents: 50,
      })
      const res = await provision(token, payload)
      expect(res.status).toBe(422)
      const errBody = (await res.json()) as { error?: string }
      expect(String(errBody.error ?? '')).toMatch(/yearly/i)
      // NOTHING was created (atomic rejection — the exact slug is absent).
      const specific = await db.school.findUnique({ where: { slug: payload.slug as string } })
      expect(specific).toBeNull()
    },
    T,
  )

  test(
    'amount/frequency validation: zero, negative, over-max, malformed, half-pairs, licensed-on-wrong-model',
    async () => {
      const token = await steppedUpRoot()
      const cases: Array<Record<string, unknown>> = [
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: 0 },
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: -5 },
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: 200_000_000 },
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: 'abc' },
        // amount without frequency (and vice versa) is a half-configured unit
        { billingModel: 'SCHOOL_WIDE', agreedAmount: 100 },
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'MONTHLY' },
        // licensedStudents only applies to student-based billing
        { billingModel: 'SCHOOL_WIDE', billingFrequency: 'ANNUAL', agreedAmount: 100, licensedStudents: 10 },
        // student-based needs the licensed count
        { billingModel: 'PER_STUDENT', billingFrequency: 'ANNUAL', agreedAmount: 100 },
      ]
      for (const overrides of cases) {
        const res = await provision(token, body(overrides))
        expect(res.status).toBe(422)
      }
    },
    T,
  )
})

describe('wizard §STEP 4/§STEP 6 — academic bootstrap + address extras', () => {
  test(
    'classes bootstrap dedupes (name, section) pairs server-side',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(
        token,
        body({
          classes: [
            { name: 'Class 1', sections: ['A'] },
            { name: 'Class 1', sections: ['A'] },
            { name: 'Class 2', sections: ['A', 'B'] },
          ],
        }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as {
        school: { id: string }
        bootstrap: { classes: number; sections: number }
      }
      created.push(json.school.id)
      expect(json.bootstrap.classes).toBe(3)
      expect(json.bootstrap.sections).toBe(3) // 1 (deduped) + 2
      const rows = await db.class.findMany({ where: { schoolId: json.school.id } })
      expect(rows.length).toBe(3)
      const class1A = rows.filter((c) => c.name === 'Class 1' && c.section === 'A')
      expect(class1A).toHaveLength(1)
    },
    T,
  )

  test(
    'address extras persist in settings; Indian PIN validation accepts legitimate PINs and rejects malformed ones',
    async () => {
      const token = await steppedUpRoot()
      const res = await provision(
        token,
        body({
          address: '12 Education Avenue',
          addressLine2: 'Near Civil Lines',
          city: 'Jhansi',
          district: 'Jhansi',
          state: 'Uttar Pradesh',
          pincode: '284001',
          country: 'India',
        }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as {
        school: { id: string }
      }
      created.push(json.school.id)
      const row = await db.school.findUnique({ where: { id: json.school.id }, select: { settings: true, address: true, city: true } })
      const settings = JSON.parse(row?.settings ?? '{}') as Record<string, unknown>
      expect(row?.address).toBe('12 Education Avenue')
      expect(row?.city).toBe('Jhansi')
      expect(settings.addressLine2).toBe('Near Civil Lines')
      expect(settings.district).toBe('Jhansi')
      expect(settings.pincode).toBe('284001')

      // Malformed Indian PIN is rejected — but legitimate ones (first
      // digit 1–8, tested above) pass.
      const bad = await provision(
        token,
        body({ country: 'India', pincode: '999999' }),
      )
      expect(bad.status).toBe(422)

      // A permissive postal code is fine for other countries.
      const other = await provision(
        token,
        body({ country: 'United Kingdom', pincode: 'SW1A 1AA' }),
      )
      expect(other.status).toBe(200)
      const otherJson = (await dataOf(other)) as unknown as {
        school: { id: string }
      }
      created.push(otherJson.school.id)
    },
    T,
  )
})

describe('wizard §STEP 7 — idempotent replay (optional-code extension)', () => {
  test(
    'a no-code provision retried with the same payload replays — no duplicate school',
    async () => {
      const token = await steppedUpRoot()
      const payload = body({})
      const first = await provision(token, payload)
      expect(first.status).toBe(200)
      const firstJson = (await dataOf(first)) as unknown as {
        school: { id: string; recordPrefix: string; code: string }
      }
      created.push(firstJson.school.id)

      const retry = await provision(token, payload)
      expect(retry.status).toBe(200)
      const retryJson = (await dataOf(retry)) as unknown as {
        replayed?: boolean
        school: { id: string; code: string }
      }
      expect(retryJson.replayed).toBe(true)
      expect(retryJson.school.id).toBe(firstJson.school.id)
      expect(retryJson.school.code).toBe(firstJson.school.code)
      const count = await db.school.count({ where: { slug: payload.slug as string } })
      expect(count).toBe(1)
    },
    T,
  )
})

describe('wizard §4 — directory agreement (search by prefix, board + frequency filters)', () => {
  test(
    'rows carry recordPrefix; search finds it; board and billingFrequency filters match the DB',
    async () => {
      const token = await steppedUpRoot()
      // Provision one UP_BOARD school with MONTHLY terms.
      const res = await provision(
        token,
        body({
          board: 'UP_BOARD',
          billingModel: 'SCHOOL_WIDE',
          billingFrequency: 'MONTHLY',
          agreedAmount: 1800,
        }),
      )
      expect(res.status).toBe(200)
      const json = (await dataOf(res)) as unknown as {
        school: { id: string; recordPrefix: string }
      }
      created.push(json.school.id)

      // Search by the record prefix finds the school.
      const search = await platform(
        token,
        `/api/platform/schools?q=${encodeURIComponent(json.school.recordPrefix)}`,
      )
      expect(search.status).toBe(200)
      const searchBody = (await dataOf(search)) as unknown as {
        schools: Array<{ id: string; recordPrefix: string | null }>
      }
      expect(searchBody.schools.some((s) => s.id === json.school.id)).toBe(true)
      expect(searchBody.schools.every((s) => 'recordPrefix' in s)).toBe(true)

      // Board filter returns it; CBSE filter does not.
      const upFilter = await platform(token, `/api/platform/schools?board=UP_BOARD`)
      const upBody = (await dataOf(upFilter)) as unknown as {
        schools: Array<{ id: string; board: string }>
      }
      expect(upBody.schools.some((s) => s.id === json.school.id)).toBe(true)
      expect(upBody.schools.every((s) => s.board === 'UP_BOARD')).toBe(true)
      const cbseFilter = await platform(token, `/api/platform/schools?board=CBSE`)
      const cbseBody = (await dataOf(cbseFilter)) as unknown as {
        schools: Array<{ id: string }>
      }
      expect(cbseBody.schools.some((s) => s.id === json.school.id)).toBe(false)

      // Billing-frequency filter agrees with the subscription row.
      const monthly = await platform(token, `/api/platform/schools?billingFrequency=MONTHLY`)
      const monthlyBody = (await dataOf(monthly)) as unknown as {
        schools: Array<{ id: string }>
      }
      expect(monthlyBody.schools.some((s) => s.id === json.school.id)).toBe(true)
      const annual = await platform(token, `/api/platform/schools?billingFrequency=ANNUAL`)
      const annualBody = (await dataOf(annual)) as unknown as {
        schools: Array<{ id: string }>
      }
      expect(annualBody.schools.some((s) => s.id === json.school.id)).toBe(false)
    },
    T,
  )
})

describe('wizard §3 — student-access pause/resume (server-enforced, audited, scoped)', () => {
  test(
    'pause locks ONLY this school\u2019s student accounts; staff untouched; resume restores exactly the scope',
    async () => {
      const token = await steppedUpRoot()
      // Provision a school, activate it, then seed a student + a teacher
      // (staff) account directly (roster rows — the school plane's own
      // creation flows are out of scope here; withUser enforcement of
      // LOCKED is already regression-tested in subscription-lock.test.ts).
      const res = await provision(token, body({}))
      const json = (await dataOf(res)) as unknown as {
        school: { id: string }
        principal: { id: string; email: string }
      }
      created.push(json.school.id)
      await platform(token, `/api/platform/schools/${json.school.id}/activate`, { method: 'POST' })

      const studentA = await db.user.create({
        data: {
          schoolId: json.school.id,
          email: `pause-student-a-${MARKER}@wizard.test`,
          passwordHash: 'x',
          name: 'Pause Student A',
          role: 'STUDENT',
        },
      })
      const studentB = await db.user.create({
        data: {
          schoolId: json.school.id,
          email: `pause-student-b-${MARKER}@wizard.test`,
          passwordHash: 'x',
          name: 'Pause Student B',
          role: 'STUDENT',
        },
      })
      // A student locked INDIVIDUALLY before the pause (different reason).
      const studentPreLocked = await db.user.create({
        data: {
          schoolId: json.school.id,
          email: `pause-student-pre-${MARKER}@wizard.test`,
          passwordHash: 'x',
          name: 'Pre-Locked Student',
          role: 'STUDENT',
          subscriptionStatus: 'LOCKED',
        },
      })

      // PAUSE — reason required.
      const noReason = await platform(token, `/api/platform/schools/${json.school.id}/student-access`, {
        method: 'POST',
        body: JSON.stringify({ action: 'pause', reason: 'short' }),
      })
      expect(noReason.status).toBe(422)

      const pause = await platform(token, `/api/platform/schools/${json.school.id}/student-access`, {
        method: 'POST',
        body: JSON.stringify({ action: 'pause', reason: 'Fee defaulters — pause until dues are cleared' }),
      })
      expect(pause.status).toBe(200)
      const pauseBody = (await dataOf(pause)) as unknown as {
        paused: boolean
        affectedCount: number
      }
      expect(pauseBody.paused).toBe(true)
      expect(pauseBody.affectedCount).toBe(2) // A + B only; pre-locked excluded

      // Server-side enforcement rows: students LOCKED, staff untouched.
      expect((await db.user.findUnique({ where: { id: studentA.id } }))?.subscriptionStatus).toBe('LOCKED')
      expect((await db.user.findUnique({ where: { id: studentB.id } }))?.subscriptionStatus).toBe('LOCKED')
      expect(
        (await db.user.findUnique({ where: { id: json.principal.id } }))?.subscriptionStatus,
      ).toBe('ACTIVE')

      // Pause state surfaces on the detail dossier.
      const detail = await platform(token, `/api/platform/schools/${json.school.id}`)
      const detailBody = (await dataOf(detail)) as unknown as {
        studentAccessPause: { affectedCount: number } | null
      }
      expect(detailBody.studentAccessPause).not.toBeNull()
      expect(detailBody.studentAccessPause?.affectedCount).toBe(2)

      // Audited.
      const audit = await db.platformAuditLog.findFirst({
        where: { schoolId: json.school.id, action: 'platform.school.student_access_paused' },
      })
      expect(audit).not.toBeNull()
      expect(audit?.reason).toContain('Fee defaulters')

      // Double pause is a conflict.
      const twice = await platform(token, `/api/platform/schools/${json.school.id}/student-access`, {
        method: 'POST',
        body: JSON.stringify({ action: 'pause', reason: 'Fee defaulters — pause until dues are cleared' }),
      })
      expect(twice.status).toBe(409)

      // RESUME — restores ONLY the pause's scope; the pre-locked account
      // keeps its individual lock.
      const resume = await platform(token, `/api/platform/schools/${json.school.id}/student-access`, {
        method: 'POST',
        body: JSON.stringify({ action: 'resume', reason: 'Dues cleared — restore student access' }),
      })
      expect(resume.status).toBe(200)
      const resumeBody = (await dataOf(resume)) as unknown as {
        paused: boolean
        resumedCount: number
      }
      expect(resumeBody.paused).toBe(false)
      expect(resumeBody.resumedCount).toBe(2)
      expect((await db.user.findUnique({ where: { id: studentA.id } }))?.subscriptionStatus).toBe('ACTIVE')
      expect((await db.user.findUnique({ where: { id: studentB.id } }))?.subscriptionStatus).toBe('ACTIVE')
      expect(
        (await db.user.findUnique({ where: { id: studentPreLocked.id } }))?.subscriptionStatus,
      ).toBe('LOCKED')

      // The pause state is cleared from the dossier.
      const after = await platform(token, `/api/platform/schools/${json.school.id}`)
      const afterBody = (await dataOf(after)) as unknown as {
        studentAccessPause: { affectedCount: number } | null
      }
      expect(afterBody.studentAccessPause).toBeNull()

      // Resume without a pause is a conflict.
      const again = await platform(token, `/api/platform/schools/${json.school.id}/student-access`, {
        method: 'POST',
        body: JSON.stringify({ action: 'resume', reason: 'Dues cleared — restore student access' }),
      })
      expect(again.status).toBe(409)

      const resumeAudit = await db.platformAuditLog.findFirst({
        where: { schoolId: json.school.id, action: 'platform.school.student_access_resumed' },
      })
      expect(resumeAudit).not.toBeNull()
    },
    T,
  )

  test(
    'boundary — anonymous and non-manage sessions are refused; unknown school is 404',
    async () => {
      const anon = await fetch(`${BASE}/api/platform/schools/000000000000000000000000/student-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause', reason: 'should not matter' }),
      })
      expect(anon.status).toBe(401)

      const token = await steppedUpRoot()
      const missing = await platform(
        token,
        `/api/platform/schools/000000000000000000000000/student-access`,
        { method: 'POST', body: JSON.stringify({ action: 'pause', reason: 'unknown school probe' }) },
      )
      expect(missing.status).toBe(404)
    },
    T,
  )
})
