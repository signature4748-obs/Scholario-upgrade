/**
 * 8B-7-e — EMAIL INFRASTRUCTURE TESTS (src/lib/email).
 *
 * Contract under test — `sendEmail` NEVER throws; every outcome is a
 * value, every send is an audited EmailDelivery row:
 *
 *   1. dev transport      — RESEND_API_KEY absent → row SENT with
 *                           providerMessageId 'dev-log', the structured
 *                           'email_dev_delivery' log line IS the delivery,
 *                           result { status:'sent', transport:'dev-log' }
 *   2. idempotency        — a second send with the same dedupeKey and a
 *                           prior SENT row → 'skipped', NO new row
 *   3. resend success     — stubbed fetch 200 {id} → SENT + provider id
 *   4. resend retry       — 429 then 200 → attempts 2, SENT
 *   5. permanent failure  — 400 always → attempts 1 (no retry), FAILED
 *   6. unknown template   → failed BEFORE any transport call
 *   7. invalid recipient  → failed BEFORE any transport call (audited row)
 *   8. render safety      — admission template carries school branding and
 *                           HTML-ESCAPES dynamic props (XSS boundary);
 *                           salary template uses fixed-payment language
 *                           only (no gross/net/deduction wording)
 *
 * SAFETY: no test can send a real email — the resend tests use an
 * obviously-stub key ('re_stub_not_a_real_key') plus a stubbed
 * global fetch; the dev tests delete RESEND_API_KEY entirely. Real
 * keys are never present here.
 *
 * DB NOTE: this suite asserts through `@/lib/db` — the SAME singleton
 * sendEmail uses (tests/helpers/db.ts pattern of ONE bounded pool per
 * process, taken one step further: zero extra pools). The test process
 * therefore holds ≤6 Supavisor connections, keeping the documented
 * budget (dev 6 + test 6 + event-stream 1 = 13/15). Rows created here
 * carry dedupeKey prefix 'IT-' and are swept in afterAll.
 *
 * Run: DATABASE_URL must point at the Supabase pooler (see package
 * docs) — the sandbox injects a stale SQLite URL into plain bash.
 */
import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { sendEmail, getEmailTransportStatus, renderTemplate } from '@/lib/email'
import type { EmailResult, EmailTemplateProps, TemplateId } from '@/lib/email'

// ─── fixtures & markers ─────────────────────────────────────────────────

const MARKER = randomBytes(4).toString('hex')
const dk = (name: string): string => `IT-${MARKER}-${name}`
const RECIPIENT = `family-${MARKER}@example.test`

const admissionProps = (studentName = 'Aarav Sharma') => ({
  studentName,
  grade: '9',
  contactEmail: RECIPIENT,
  referenceId: `ref-${MARKER}`,
})

// ─── env / fetch / console save-restore scaffolding ─────────────────────

const SAVED_ENV = {
  resendKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  logLevel: process.env.LOG_LEVEL,
}
const REAL_FETCH = globalThis.fetch

function restoreEnv(name: 'RESEND_API_KEY' | 'EMAIL_FROM' | 'LOG_LEVEL', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/** A stub resend key — clearly not real; never a live credential. */
const STUB_KEY = 're_stub_not_a_real_key'

type StubStep = { status: number; body?: unknown } | Error
interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/**
 * Replace global fetch with a scripted sequence (last step repeats for
 * extra calls; an EMPTY script throws on any call — proving "fetch was
 * never reached"). Returns the recorded calls for request-shape asserts.
 */
function stubFetch(steps: StubStep[]): FetchCall[] {
  const calls: FetchCall[] = []
  let i = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const step =
      steps.length === 0
        ? new Error('unexpected fetch call — transport must not be reached')
        : steps[Math.min(i, steps.length - 1)]
    i++
    if (step instanceof Error) throw step
    const body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {})
    return new Response(body, {
      status: step.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return calls
}

/** Capture console.log lines (the structured logger's info channel). */
function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '))
  }) as typeof console.log
  return { lines, restore: () => (console.log = original) }
}

beforeEach(() => {
  // Default test posture: dev transport (no key) + info logging.
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
  process.env.LOG_LEVEL = 'info'
})

afterEach(() => {
  restoreEnv('RESEND_API_KEY', SAVED_ENV.resendKey)
  restoreEnv('EMAIL_FROM', SAVED_ENV.emailFrom)
  restoreEnv('LOG_LEVEL', SAVED_ENV.logLevel)
  globalThis.fetch = REAL_FETCH
})

afterAll(async () => {
  // Sweep every row this suite created (crashed prior runs included —
  // the 'IT-' prefix is this suite's exclusive namespace).
  await db.emailDelivery.deleteMany({ where: { dedupeKey: { startsWith: 'IT-' } } })
})

// ─── 1. dev transport ───────────────────────────────────────────────────

describe('email infrastructure — dev transport (RESEND_API_KEY absent)', () => {
  test('sendEmail → SENT row (providerMessageId dev-log) + email_dev_delivery log line + sent result', async () => {
    expect(process.env.RESEND_API_KEY).toBeUndefined()
    expect(getEmailTransportStatus().resendConfigured).toBe(false)

    const key = dk('dev')
    const cap = captureConsoleLog()
    let result: EmailResult
    try {
      result = await sendEmail({
        to: RECIPIENT,
        template: 'admission-enquiry-received',
        props: admissionProps(),
        dedupeKey: key,
      })
    } finally {
      cap.restore()
    }

    expect(result.status).toBe('sent')
    expect(result.transport).toBe('dev-log')
    expect(result.attempts).toBe(1)
    expect(result.messageId).toBe('dev-log')
    expect(result.deliveryId).toBeTruthy()

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('SENT')
    expect(row?.providerMessageId).toBe('dev-log')
    expect(row?.attempts).toBe(1)
    expect(row?.recipient).toBe(RECIPIENT)
    expect(row?.template).toBe('admission-enquiry-received')

    // The log line IS the dev delivery — parse the captured JSON lines.
    const devLine = cap.lines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find((e) => e?.event === 'email_dev_delivery')
    expect(devLine).toBeDefined()
    expect(devLine?.template).toBe('admission-enquiry-received')
    expect(devLine?.to).toBe(RECIPIENT)
    expect(String(devLine?.subject ?? '')).toContain('admission enquiry')
  })
})

// ─── 2. idempotency (dedupeKey) ─────────────────────────────────────────

describe('email infrastructure — idempotency', () => {
  test('second send with the same dedupeKey → skipped, no new row, SENT row untouched', async () => {
    const key = dk('idem')
    const props = admissionProps('Ishaan Verma')

    const first = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props,
      dedupeKey: key,
    })
    expect(first.status).toBe('sent')

    const second = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props,
      dedupeKey: key,
    })
    expect(second.status).toBe('skipped')
    expect(second.attempts).toBe(0)

    const rows = await db.emailDelivery.findMany({ where: { dedupeKey: key } })
    expect(rows.length).toBe(1)
    expect(rows[0]?.status).toBe('SENT')
    expect(rows[0]?.providerMessageId).toBe('dev-log')
  })
})

// ─── 3-5. resend transport (stubbed fetch — never a real API call) ──────

describe('email infrastructure — resend transport (stubbed fetch)', () => {
  test('2xx {id} → SENT + providerMessageId, correct request shape', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    expect(getEmailTransportStatus().resendConfigured).toBe(true)

    const calls = stubFetch([{ status: 200, body: { id: 're_123' } }])
    const key = dk('resend-ok')

    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: key,
    })

    expect(result.status).toBe('sent')
    expect(result.transport).toBe('resend')
    expect(result.attempts).toBe(1)
    expect(result.messageId).toBe('re_123')

    // Exactly one transport call, correct endpoint + envelope.
    expect(calls.length).toBe(1)
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${STUB_KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(body.to).toBe(RECIPIENT)
    expect(body.from).toBe('Scholario <onboarding@resend.dev>') // EMAIL_FROM unset → default
    expect(String(body.subject)).toContain('admission enquiry')
    expect(String(body.html)).toContain('Aarav Sharma')

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('SENT')
    expect(row?.providerMessageId).toBe('re_123')
    expect(row?.attempts).toBe(1)
  })

  test('429 then 200 → retried once, attempts 2, SENT', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    const calls = stubFetch([
      { status: 429, body: { message: 'rate limited' } },
      { status: 200, body: { id: 're_456' } },
    ])
    const key = dk('retry')

    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: key,
    })

    expect(result.status).toBe('sent')
    expect(result.attempts).toBe(2)
    expect(result.messageId).toBe('re_456')
    expect(calls.length).toBe(2)

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('SENT')
    expect(row?.attempts).toBe(2)
    expect(row?.providerMessageId).toBe('re_456')
  })

  test('400 (permanent, non-429) → attempts 1, no retry, FAILED row + lastError', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    // Single scripted step repeats for any extra call — the assert below
    // proves the retry policy never made one.
    const calls = stubFetch([{ status: 400, body: { message: 'validation error' } }])
    const key = dk('perm-fail')

    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: key,
    })

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(1)
    expect(calls.length).toBe(1) // 4xx non-429 = permanent → no retries

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('FAILED')
    expect(row?.attempts).toBe(1)
    expect(row?.lastError).toContain('HTTP 400')
  })
})

// ─── 6-7. pre-transport rejections ──────────────────────────────────────

describe('email infrastructure — pre-transport failures', () => {
  test('unknown template → failed, no transport call, FAILED row', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    const calls = stubFetch([]) // any fetch call throws → test fails
    const key = dk('unknown-template')

    const result = await sendEmail({
      to: RECIPIENT,
      template: 'nope' as TemplateId,
      props: {} as EmailTemplateProps,
      dedupeKey: key,
    })

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(0)
    expect(calls.length).toBe(0)

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('FAILED')
    expect(row?.lastError).toContain('unknown email template')
  })

  test('invalid recipient → failed without fetch, FAILED audit row (lastError invalid recipient)', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    const calls = stubFetch([]) // any fetch call throws → test fails
    const key = dk('invalid-recipient')

    const result = await sendEmail({
      to: 'not-an-email',
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: key,
    })

    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(0)
    expect(calls.length).toBe(0)

    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: key } })
    expect(row?.status).toBe('FAILED')
    expect(row?.attempts).toBe(0)
    expect(row?.lastError).toBe('invalid recipient')
  })
})

// ─── 8. template rendering safety ───────────────────────────────────────

describe('email infrastructure — template rendering', () => {
  test('admission template: school branding present, dynamic values HTML-escaped', () => {
    const branding = { schoolName: 'Sunrise Academy', primaryColor: '#0f766e' }
    const rendered = renderTemplate(
      'admission-enquiry-received',
      {
        studentName: '<script>alert(1)</script>',
        grade: '9',
        contactEmail: 'evil@example.test',
        referenceId: 'ref-x',
      },
      branding,
    )

    expect(rendered.subject).toBe('We received your admission enquiry — Sunrise Academy')
    expect(rendered.html).toContain('Sunrise Academy')
    expect(rendered.html).toContain('Sent by Sunrise Academy via Scholario')
    // The injected markup is neutralized — no raw <script> survives.
    expect(rendered.html).toContain('&lt;script&gt;')
    expect(rendered.html).not.toContain('<script>')
  })

  test('salary template: fixed-payment language only, amount + month present', () => {
    const branding = { schoolName: 'Sunrise Academy', primaryColor: '#0f766e' }
    const rendered = renderTemplate(
      'salary-payment-recorded',
      { teacherName: 'Rohan Mehta', month: '2026-01', amount: '12345.00' },
      branding,
    )

    expect(rendered.subject).toBe('Salary recorded for 2026-01 — Sunrise Academy')
    expect(rendered.html).toContain('Rohan Mehta')
    expect(rendered.html).toContain('12345.00')
    expect(rendered.html).toContain('fixed monthly salary')
    // NO gross/net/deduction wording (mission rule).
    const lower = rendered.html.toLowerCase()
    expect(lower).not.toContain('gross')
    expect(lower).not.toContain('net')
    expect(lower).not.toContain('deduct')
  })

  test('neutral branding fallback shape (no school) renders the Scholario wordmark', () => {
    const rendered = renderTemplate(
      'admission-enquiry-received',
      { studentName: 'Test Student', grade: '', contactEmail: '', referenceId: '' },
      { schoolName: 'Scholario', primaryColor: '#0f766e' },
    )
    expect(rendered.subject).toBe('We received your admission enquiry — Scholario')
    expect(rendered.html).toContain('Sent by Scholario via Scholario')
    expect(rendered.html).toContain('Test Student')
  })
})
