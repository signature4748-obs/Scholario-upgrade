/**
 * EMAIL PROVIDER RESOLUTION — pure decision-table tests (no DB, no fetch;
 * resolveProvider reads env LIVE and is fully introspectable).
 *
 * The production honesty guard (src/lib/email/index.ts): the dev-log
 * transport fabricates a SENT row (the log line IS the delivery). In
 * production (isProductionDatabase()) it must be REFUSED — as the auto
 * fallback with no real credentials AND as an explicit pin — so a
 * credential outage fails visibly ([provider-config]) instead of
 * recording fake deliveries.
 *
 * Companion: tests/security/email-production-guard.test.ts covers the
 * full sendEmail → EmailDelivery-row behavior (needs the test DB).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolveProvider } from '@/lib/email'

const SAVED = {
  databaseEnv: process.env.DATABASE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  resendKey: process.env.RESEND_API_KEY,
  emailProvider: process.env.EMAIL_PROVIDER,
  gmailUser: process.env.GMAIL_SMTP_USER,
  gmailPass: process.env.GMAIL_SMTP_APP_PASSWORD,
}

// REAL environment-variable names for each SAVED key. process.env keys are
// case-sensitive: restoring via the camelCase SAVED keys writes DIFFERENT
// variables (process.env.databaseEnv) and silently no-ops the real ones —
// DATABASE_ENV stayed 'production', the fake supabase DATABASE_URL from the
// fail-safe test stayed set, and every LATER suite in the same bun process
// inherited the poisoned environment (root cause of the combined-order
// failure cascade; tests/helpers/db.ts additionally froze the poisoned URL
// into its shared client when evaluated after this file).
const ENV_NAMES: Record<keyof typeof SAVED, string> = {
  databaseEnv: 'DATABASE_ENV',
  databaseUrl: 'DATABASE_URL',
  resendKey: 'RESEND_API_KEY',
  emailProvider: 'EMAIL_PROVIDER',
  gmailUser: 'GMAIL_SMTP_USER',
  gmailPass: 'GMAIL_SMTP_APP_PASSWORD',
}

function restore(name: keyof typeof SAVED): void {
  const envName = ENV_NAMES[name]
  const v = SAVED[name]
  if (v === undefined) delete process.env[envName]
  else process.env[envName] = v
}

beforeEach(() => {
  // Canonical posture: explicit production database identity.
  process.env.DATABASE_ENV = 'production'
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_PROVIDER
  delete process.env.GMAIL_SMTP_USER
  delete process.env.GMAIL_SMTP_APP_PASSWORD
})

afterEach(() => {
  restore('databaseEnv')
  restore('databaseUrl')
  restore('resendKey')
  restore('emailProvider')
  restore('gmailUser')
  restore('gmailPass')
})

describe('resolveProvider · production honesty guard (decision table)', () => {
  test('production + auto + no credentials → dev-log REFUSED with the production story', () => {
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.selection).toBe('auto')
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('No email provider credentials in production')
  })

  test('production + explicit dev-log pin → REFUSED (a pin must not smuggle the dev transport)', () => {
    process.env.EMAIL_PROVIDER = 'dev-log'
    const p = resolveProvider()
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('refused in production')
  })

  test('production + auto + RESEND_API_KEY → configured resend (guard does not overreach)', () => {
    process.env.RESEND_API_KEY = 're_stub_not_a_real_key'
    const p = resolveProvider()
    expect(p.id).toBe('resend')
    expect(p.configured).toBe(true)
  })

  test('production + auto + Gmail SMTP creds → configured gmail-smtp (real providers are never blocked)', () => {
    process.env.GMAIL_SMTP_USER = 'stub.user@gmail.com'
    process.env.GMAIL_SMTP_APP_PASSWORD = 'sixteencharstub'
    const p = resolveProvider()
    expect(p.id).toBe('gmail-smtp')
    expect(p.configured).toBe(true)
  })

  test('production + explicit resend without key → refused (pre-existing pin contract unchanged)', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    const p = resolveProvider()
    expect(p.id).toBe('resend')
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set')
  })

  test('DATABASE_ENV=test + auto + no credentials → dev-log ALLOWED (dev/test DX unchanged)', () => {
    process.env.DATABASE_ENV = 'test'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.configured).toBe(true)
  })

  test('DATABASE_ENV=test + explicit dev-log pin → ALLOWED', () => {
    process.env.DATABASE_ENV = 'test'
    process.env.EMAIL_PROVIDER = 'dev-log'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.configured).toBe(true)
  })

  test('DATABASE_ENV=development + no credentials → dev-log ALLOWED (plain dev posture)', () => {
    process.env.DATABASE_ENV = 'development'
    const p = resolveProvider()
    expect(p.id).toBe('dev-log')
    expect(p.configured).toBe(true)
  })

  test('Supabase fail-safe: DATABASE_ENV UNSET + supabase DATABASE_URL host → treated as production → refused', () => {
    delete process.env.DATABASE_ENV
    process.env.DATABASE_URL = 'postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
    try {
      const p = resolveProvider()
      expect(p.configured).toBe(false)
      expect(p.configError).toContain('production')
    } finally {
      // DATABASE_URL is restored by afterEach; never printed.
    }
  })

  test('the guard reads env LIVE (flip DATABASE_ENV between two calls — no memoization)', () => {
    expect(resolveProvider().configured).toBe(false) // production
    process.env.DATABASE_ENV = 'test'
    expect(resolveProvider().configured).toBe(true) // test
    process.env.DATABASE_ENV = 'production'
    expect(resolveProvider().configured).toBe(false) // back to production
  })
})
