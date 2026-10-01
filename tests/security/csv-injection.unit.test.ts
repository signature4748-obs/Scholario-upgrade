import { db } from '../helpers/db'
/**
 * PIH-5 — INVARIANT: CSV formula/DDE injection neutralization (OWASP).
 *
 * INTENT: a PURE UNIT suite over the CSV cell escapers. Reality check (per
 * task instruction): the two formula-guarded escapers — csvEscape in
 * src/app/api/export/route.ts and csvCell in src/app/api/payments-export/
 * route.ts — are route-LOCAL (not exported; Next route modules may only
 * export route handlers), so they cannot be imported directly. This suite
 * therefore does BOTH:
 *
 *   1. PURE UNIT (no server): the shared, exported RFC-4180 escaper
 *      `csvEscape` from src/lib/csv.ts — quote/comma/newline wrapping,
 *      doubled inner quotes, plain numbers. (Formula neutralization is
 *      deliberately NOT that helper's contract — it lives route-side.)
 *   2. ROUTE BEHAVIOUR (live dev server, the sanctioned fallback): seeds
 *      throwaway students whose names lead with each dangerous character
 *      (=, +, -, @, tab-then-formula, CR-then-formula — the guard tests
 *      the TRIMMED value, so a bare leading tab/CR is already harmless),
 *      exports ONCE through /api/export, and asserts every dangerous cell
 *      renders with the ' guard prefix while normal values pass through
 *      untouched. A second probe pins the OTHER guarded exporter
 *      (/api/payments-export) via a seeded fee title.
 *
 * Conventions match tests/security/tenant-isolation.test.ts and
 * tests/security/phase75-product.test.ts (direct-minted session rows —
 * bypassing ONLY the login limiter — cookie transport via a manual jar).
 *
 * Cleanup: every seeded row (students, users, fee, parity-preserving
 * fee-transaction + payment mirror) is deleted; the fee probe keeps the
 * ledger parity invariant intact while it exists (Fee.paid Σ, Payment Σ
 * and FeeTransaction Σ all move by the same amount).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { csvEscape } from '@/lib/csv'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const MARKER = randomBytes(4).toString('hex')

// ── part 1 · pure unit — src/lib/csv.ts csvEscape (RFC-4180 contract) ──────

describe('PIH-5 · csvEscape (src/lib/csv.ts) — RFC-4180 cell escaping (unit)', () => {
  test('normal values and numbers pass through unchanged', () => {
    expect(csvEscape('Mrs. Kavita Sharma')).toBe('Mrs. Kavita Sharma')
    expect(csvEscape('DEMO-2026-0001')).toBe('DEMO-2026-0001')
    expect(csvEscape(42)).toBe('42')
    expect(csvEscape(0)).toBe('0')
    expect(csvEscape('')).toBe('')
  })

  test('commas, quotes and newlines wrap in quotes with doubled inner quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
    expect(csvEscape('plain, "quoted", and more')).toBe('"plain, ""quoted"", and more"')
  })
})

// ── part 2 · route behaviour — the OWASP guard on the live exporters ──────

let schoolId = ''
let principalToken = ''
const suiteStart = new Date()

/** Every dangerous leading character, as student NAME cells. */
const DANGEROUS_NAMES: string[] = [
  `=EVIL-${MARKER}`,
  `+EVIL-${MARKER}`,
  `-EVIL-${MARKER}`,
  `@EVIL-${MARKER}`,
  `\t=EVIL-${MARKER}`, // leading tab + formula (guard inspects the trimmed value)
  `\r=EVIL-${MARKER}`, // leading CR + formula
]
const NORMAL_NAME = `PIH5 Normal ${MARKER}`
const COMMA_NAME = `PIH5 O'Brien, Jr ${MARKER}`

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const school = await db.school.findFirst({ where: { isDemo: true } })
  if (!school) throw new Error('demo school missing (run the canonical seeds)')
  schoolId = school.id

  const principal = await db.user.findUnique({ where: { email: 'principal@sunriseacademy.edu' } })
  if (!principal) throw new Error('fixture user missing: principal@sunriseacademy.edu')
  principalToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId: principal.id,
      tokenHash: hashSessionToken(principalToken),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  cleanup.push(() => db.session.deleteMany({ where: { tokenHash: hashSessionToken(principalToken) } }))

  // Seed the matrix: 6 dangerous + 2 control students (deleted in cleanup).
  const specs: { name: string; admissionNo: string }[] = [
    ...DANGEROUS_NAMES.map((name, i) => ({ name, admissionNo: `PIH5CSV${i}-${MARKER}` })),
    { name: NORMAL_NAME, admissionNo: `PIH5CSV6-${MARKER}` },
    { name: COMMA_NAME, admissionNo: `PIH5CSV7-${MARKER}` },
  ]
  for (const spec of specs) {
    const user = await db.user.create({
      data: {
        schoolId,
        email: `pih5.inj.${MARKER}.${spec.admissionNo}@sunrise.test`,
        name: spec.name,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const student = await db.student.create({
      data: { schoolId, userId: user.id, admissionNo: spec.admissionNo },
    })
    cleanup.push(() => db.student.delete({ where: { id: student.id } }))
    cleanup.push(() => db.user.delete({ where: { id: user.id } }))
  }
  cleanup.push(() =>
    db.activityLog.deleteMany({
      where: { action: 'STUDENT_DATA_EXPORT', createdAt: { gte: suiteStart } },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

function jar(token: string): { cookie: string } {
  return { cookie: `erp_session=${token}` }
}

function as(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...jar(token), ...(init?.headers ?? {}), 'content-type': 'application/json' },
  })
}

describe('PIH-5 · /api/export csvEscape guard — every dangerous leading value gets the \' prefix (route behaviour)', () => {
  test('principal exports the roster: =, +, -, @, tab-formula and CR-formula names are all guarded; normal and comma names are untouched', async () => {
    const res = await as(principalToken, '/api/export?type=students')
    expect(res.status).toBe(200)
    const csv = await res.text()

    // Every dangerous name renders WITH the guard prefix (the apostrophe is
    // prepended to the raw value; none of these names contain , " or \n, so
    // no additional RFC-4180 wrapping is expected).
    for (const name of DANGEROUS_NAMES) {
      expect(csv).toContain(`'${name}`)
      // …and is never present as a raw (unguarded) cell value.
      expect(csv.match(new RegExp(`(^|\\n|,)${escapeRegExp(name)}`))).toBeNull()
    }

    // Control: a normal name passes through with NO guard prefix.
    expect(csv).toContain(NORMAL_NAME)
    expect(csv).not.toContain(`'${NORMAL_NAME}`)

    // Control: a comma+quote name is RFC-4180 wrapped, still un-prefixed.
    expect(csv).toContain(`"${COMMA_NAME}"`)
    expect(csv).not.toContain(`'${COMMA_NAME}`)
  }, 45_000) // generous: first-hit dev compilation of the export route
})

describe('PIH-5 · /api/payments-export csvCell guard — fee title payload (route behaviour)', () => {
  test('a seeded fee titled "=SUM(A1:A9)" renders guarded in the payments ledger CSV', async () => {
    // Seed one parity-preserving money row: Fee(paid 100) + Payment(100) +
    // FeeTransaction(SUCCESS 100) — all three ledger sums move equally, so
    // the PIH-5 parity invariant holds even while the probe exists. The
    // receipt uses the PREVIOUS calendar year's SCH series so the live
    // current-year sequential mint is untouched.
    const evilTitle = `=SUM(A1:A9)-${MARKER}`
    const studentUser = await db.user.create({
      data: {
        schoolId,
        email: `pih5.pay.${MARKER}@sunrise.test`,
        name: `=EVILPAY-${MARKER}`,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const student = await db.student.create({
      data: { schoolId, userId: studentUser.id, admissionNo: `PIH5PAY-${MARKER}` },
    })
    const fee = await db.fee.create({
      data: {
        schoolId,
        studentId: student.id,
        title: evilTitle,
        amount: 100,
        paid: 100,
        status: 'PAID',
        method: 'CASH',
        paidDate: new Date(),
      },
    })
    const txn = await db.feeTransaction.create({
      data: {
        schoolId,
        studentId: student.id,
        studentName: `=EVILPAY-${MARKER}`,
        feeId: fee.id,
        feeHeadName: evilTitle,
        amount: 100,
        method: 'CASH',
        status: 'SUCCESS',
        receiptNo: 'SCH-2025-000001', // no live SCH-2025 series exists (verified in beforeAll run context)
        gatewayName: 'manual',
      },
    })
    const payment = await db.payment.create({
      data: {
        schoolId,
        feeId: fee.id,
        amount: 100,
        method: 'CASH',
        status: 'SUCCESS',
        transactionId: txn.id,
      },
    })
    cleanup.push(() => db.payment.delete({ where: { id: payment.id } }))
    cleanup.push(() => db.feeTransaction.delete({ where: { id: txn.id } }))
    cleanup.push(() => db.fee.delete({ where: { id: fee.id } }))
    cleanup.push(() => db.student.delete({ where: { id: student.id } }))
    cleanup.push(() => db.user.delete({ where: { id: studentUser.id } }))

    const res = await as(principalToken, '/api/payments-export?limit=500')
    expect(res.status).toBe(200)
    const csv = await res.text()

    // The fee-title cell and the student-name cell are both guarded.
    expect(csv).toContain(`'${evilTitle}`)
    expect(csv).toContain(`'=EVILPAY-${MARKER}`)
    // Neither payload ever starts a cell unescaped.
    expect(csv.match(new RegExp(`(^|\\n|,)${escapeRegExp(evilTitle)}`))).toBeNull()
    expect(csv.match(new RegExp(`(^|\\n|,)=EVILPAY-`))).toBeNull()
  }, 45_000)
})

/** Minimal regexp escape for literal name matching. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
