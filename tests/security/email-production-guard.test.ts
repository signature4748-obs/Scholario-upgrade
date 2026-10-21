/**
 * EMAIL PRODUCTION HONESTY GUARD (src/lib/email — resolveProvider).
 *
 * Contract under test — the mission requirement: "In production, missing
 * Resend credentials must fail safely and visibly rather than recording a
 * fake successful delivery" and "No fake success from development-log
 * transport in production":
 *
 *   1. production + no provider credentials (auto) → EVERY send is a
 *      FAILED row with a machine-parseable [provider-config] class —
 *      never a SENT row, never a fake providerMessageId, never a
 *      silent 'skipped'.
 *   2. production + explicit EMAIL_PROVIDER=dev-log → refused the same
 *      way (a pinned dev transport must not fabricate deliveries in
 *      production either).
 *   3. production + real credentials present → the guard does NOT
 *      overreach: resend resolves configured (stubbed 200 {id} →
 *      honest QUEUED row with the provider id).
 *   4. development/test (DATABASE_ENV=test) + no credentials → the
 *      dev-log transport still works EXACTLY as before (SENT row,
 *      providerMessageId 'dev-log') — the guard is production-scoped.
 *   5. resolveProvider() surface: the refusal is introspectable (the
 *      admin diagnostics read it) — configured:false with the
 *      [provider-config] story.
 *
 * "Production" is the canonical database-identity signal
 * (src/lib/env.ts isProductionDatabase): DATABASE_ENV=production.
 * Tests flip DATABASE_ENV per case and restore it — the guard reads it
 * LIVE (never memoized), which is itself part of the contract.
 *
 * SAFETY: no real provider traffic — resend cases use the obviously-fake
 * stub key ('re_stub_not_a_real_key') + a stubbed global fetch (the
 * email-infra.ts convention); dev-log cases need no transport at all.
 *
 * DB NOTE: rows created here carry dedupeKey prefix 'PG-' and are swept
 * in afterAll (same convention as the email-infra suite).
 */
import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'

import { db } from '@/lib/db'
import { sendEmail, resolveProvider } from '@/lib/email'
import { parseErrorClass } from '@/lib/email/provider-errors'
import type { EmailTemplateProps } from '@/lib/email'

// ─── fixtures & markers ─────────────────────────────────────────────────

const MARKER = randomBytes(4).toString('hex')
const dk = (name: string): string => `PG-${MARKER}-${name}`
const RECIPIENT = `prod-guard-${MARKER}@example.test`

const admissionProps = (studentName = 'Aarav Sharma') => ({
  studentName,
  grade: '9',
  contactEmail: RECIPIENT,
  referenceId: `ref-${MARKER}`,
}) as unknown as EmailTemplateProps

// ─── env / fetch save-restore scaffolding ──────────────────────────────

const SAVED_ENV = {
  databaseEnv: process.env.DATABASE_ENV,
  resendKey: process.env.RESEND_API_KEY,
  emailProvider: process.env.EMAIL_PROVIDER,
  gmailUser: process.env.GMAIL_SMTP_USER,
  gmailPass: process.env.GMAIL_SMTP_APP_PASSWORD,
  logLevel: process.env.LOG_LEVEL,
  emailFrom: process.env.EMAIL_FROM,
}

type SavableEnvName = 'DATABASE_ENV' | 'RESEND_API_KEY' | 'EMAIL_PROVIDER' | 'GMAIL_SMTP_USER' | 'GMAIL_SMTP_APP_PASSWORD' | 'LOG_LEVEL' | 'EMAIL_FROM'

function restoreEnv(name: SavableEnvName, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const REAL_FETCH = globalThis.fetch

/** A stub resend key — clearly not real; never a live credential. */
const STUB_KEY = 're_stub_not_a_real_key'

/** Stub fetch: a single scripted 200 {id} response for the resend API. */
function stubResendOk(id: string): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: (init?.body as string | undefined) ?? null })
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { calls }
}

beforeEach(() => {
  // Default suite posture: production database identity, no credentials.
  process.env.DATABASE_ENV = 'production'
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_PROVIDER
  delete process.env.GMAIL_SMTP_USER
  delete process.env.GMAIL_SMTP_APP_PASSWORD
  delete process.env.EMAIL_FROM
  process.env.LOG_LEVEL = 'warn' // quiet: the refusal logs an error per send
})

afterEach(() => {
  restoreEnv('DATABASE_ENV', SAVED_ENV.databaseEnv)
  restoreEnv('RESEND_API_KEY', SAVED_ENV.resendKey)
  restoreEnv('EMAIL_PROVIDER', SAVED_ENV.emailProvider)
  restoreEnv('GMAIL_SMTP_USER', SAVED_ENV.gmailUser)
  restoreEnv('GMAIL_SMTP_APP_PASSWORD', SAVED_ENV.gmailPass)
  restoreEnv('LOG_LEVEL', SAVED_ENV.logLevel)
  restoreEnv('EMAIL_FROM', SAVED_ENV.emailFrom)
  globalThis.fetch = REAL_FETCH
})

afterAll(async () => {
  // Sweep this suite's namespace (crashed prior runs included).
  await db.emailDelivery.deleteMany({ where: { dedupeKey: { startsWith: 'PG-' } } })
  await db.$disconnect()
})

// ─── 1. production + no credentials (auto) ───────────────────────────────

describe('EMAIL PRODUCTION GUARD · auto selection with no credentials', () => {
  test('resolveProvider refuses dev-log in production (configured:false, [provider-config] story)', () => {
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.selection).toBe('auto')
    expect(p.configured).toBe(false)
    expect(p.configError).toBeTruthy()
    expect(p.configError).toContain('No email provider credentials in production')
  })

  test('sendEmail → FAILED row with [provider-config] class — never SENT, never a fake provider id', async () => {
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('auto-fail'),
    })
    expect(result.status).toBe('failed')
    expect(result.transport).toBe('dev-log')
    expect(result.messageId).toBeUndefined()
    // The audit row is the honest record.
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('auto-fail') } })
    expect(row).not.toBeNull()
    expect(row!.status).toBe('FAILED')
    expect(row!.providerMessageId).toBeNull()
    expect(parseErrorClass(row!.lastError)).toBe('provider-config')
    expect(row!.lastError).toContain('dev-log transport is refused')
  })

  test('a retried send after the row exists reuses the FAILED row (reset → FAILED again), never upgrades to SENT', async () => {
    await sendEmail({ to: RECIPIENT, template: 'admission-enquiry-received', props: admissionProps(), dedupeKey: dk('retry') })
    const second = await sendEmail({ to: RECIPIENT, template: 'admission-enquiry-received', props: admissionProps(), dedupeKey: dk('retry') })
    expect(second.status).toBe('failed')
    const rows = await db.emailDelivery.findMany({ where: { dedupeKey: dk('retry') } })
    expect(rows.length).toBe(1)
    expect(rows[0]!.status).toBe('FAILED')
  })

  test('invalid recipient still fails honestly (the guard does not mask recipient validation)', async () => {
    const result = await sendEmail({
      to: 'not-an-email',
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('invalid-recipient'),
    })
    expect(result.status).toBe('failed')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('invalid-recipient') } })
    expect(row!.status).toBe('FAILED')
    expect(row!.lastError).toBe('invalid recipient')
  })
})

// ─── 2. production + explicit dev-log pin ────────────────────────────────

describe('EMAIL PRODUCTION GUARD · explicit EMAIL_PROVIDER=dev-log in production', () => {
  test('the pin is refused with the honest story', () => {
    process.env.EMAIL_PROVIDER = 'dev-log'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.selection).toBe('explicit')
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('refused in production')
  })

  test('sendEmail under the refused pin → FAILED [provider-config], row never SENT', async () => {
    process.env.EMAIL_PROVIDER = 'dev-log'
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('pin-refused'),
    })
    expect(result.status).toBe('failed')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('pin-refused') } })
    expect(row!.status).toBe('FAILED')
    expect(parseErrorClass(row!.lastError)).toBe('provider-config')
  })

  test('an explicit resend pin without a key in production is ALSO refused (pre-existing contract, unchanged)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    const p = resolveProvider()
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set')
  })
})

// ─── 3. production + real credentials → the guard does not overreach ─────

describe('EMAIL PRODUCTION GUARD · production with credentials keeps the real transport', () => {
  test('resolveProvider: resend key present in production → configured resend (auto)', () => {
    process.env.RESEND_API_KEY = STUB_KEY
    const p = resolveProvider()
    expect(p.id).toBe('resend')
    expect(p.selection).toBe('auto')
    expect(p.configured).toBe(true)
    expect(p.configError).toBeUndefined()
  })

  test('sendEmail through resend in production → honest QUEUED with the provider message id (no fabricated SENT)', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    const stub = stubResendOk(`re_stub_${MARKER}`)
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('prod-resend-ok'),
    })
    expect(result.status).toBe('queued')
    expect(result.messageId).toBe(`re_stub_${MARKER}`)
    expect(stub.calls.length).toBe(1)
    expect(stub.calls[0]!.url).toBe('https://api.resend.com/emails')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('prod-resend-ok') } })
    expect(row!.status).toBe('QUEUED') // accepted ≠ delivered — honest even in production
    expect(row!.providerMessageId).toBe(`re_stub_${MARKER}`)
  })

  test('a resend 403 testing-restriction in production stays FAILED with its true class (no transport-mask)', async () => {
    process.env.RESEND_API_KEY = STUB_KEY
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          name: 'validation_error',
          message: 'You can only send testing emails to your own email address (naughty@resend.dev). Enable your account to send emails to other recipients.',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('prod-403'),
    })
    expect(result.status).toBe('failed')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('prod-403') } })
    expect(row!.status).toBe('FAILED')
    expect(parseErrorClass(row!.lastError)).toBe('testing-recipient-restricted')
  })
})

// ─── 4. development/test keeps the dev-log DX ───────────────────────────

describe('EMAIL PRODUCTION GUARD · development/test posture unchanged', () => {
  test('DATABASE_ENV=test + no credentials → dev-log SENT (the log line IS the delivery)', async () => {
    process.env.DATABASE_ENV = 'test'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.configured).toBe(true)
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('dev-sent'),
    })
    expect(result.status).toBe('sent')
    expect(result.messageId).toBe('dev-log')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('dev-sent') } })
    expect(row!.status).toBe('SENT')
    expect(row!.providerMessageId).toBe('dev-log')
  })

  test('DATABASE_ENV unset (plain dev) + no credentials → dev-log SENT (fail-open dev posture preserved)', async () => {
    delete process.env.DATABASE_ENV
    const result = await sendEmail({
      to: RECIPIENT,
      template: 'admission-enquiry-received',
      props: admissionProps(),
      dedupeKey: dk('dev-unset'),
    })
    expect(result.status).toBe('sent')
    const row = await db.emailDelivery.findUnique({ where: { dedupeKey: dk('dev-unset') } })
    expect(row!.status).toBe('SENT')
  })

  test('DATABASE_ENV=test + explicit dev-log pin → still works (guard is production-only)', () => {
    process.env.DATABASE_ENV = 'test'
    process.env.EMAIL_PROVIDER = 'dev-log'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.configured).toBe(true)
  })
})
