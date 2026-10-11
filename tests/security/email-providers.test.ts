/**
 * EMAIL PROVIDER ADAPTERS + ERROR CLASSIFICATION TESTS.
 *
 * Pure, dependency-light coverage for the Phase A provider layer:
 *
 *   1. classifyProviderHttpStatus — every failure family is typed:
 *      401 → auth-invalid; 403 + "testing emails to your own email
 *      address" → testing-recipient-restricted (the PRODUCTION failure
 *      mode: never mislabeled as an invalid key); 403/422 domain
 *      language → unverified-sender-domain; 429 → rate-limited;
 *      5xx → transient; other 4xx → invalid-request.
 *   2. classifyProviderTransportError — SMTP family: EAUTH/535 →
 *      auth-invalid; network codes/421 → transient; SMTP 5xx →
 *      invalid-request.
 *   3. formatProviderError / parseErrorClass — round-trip of the
 *      machine-parseable [class] tag with clipping.
 *   4. gmailSmtpAttempt — the Gmail SMTP adapter against an INJECTED
 *      stub send function: 250 → ok (accepted); 535/EAUTH →
 *      auth-invalid (no retry); ETIMEDOUT → transient (retry);
 *      rejected recipients → invalid-request.
 *   5. resolveProvider — the selection matrix: auto detection order,
 *      explicit pins, loud misconfiguration on missing creds.
 *
 * SAFETY: no network, no DB, no nodemailer (the adapter's send
 * function is injected; createNodemailerSendMail's lazy import is
 * never exercised here). No real credentials anywhere.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import {
  classifyProviderHttpStatus,
  classifyProviderTransportError,
  formatProviderError,
  parseErrorClass,
} from '@/lib/email/provider-errors'
import { gmailSmtpAttempt, maskEmail, type SmtpSendMail } from '@/lib/email/providers/gmail-smtp'
import { resolveProvider } from '@/lib/email'

// ─── fixtures ────────────────────────────────────────────────────────────

/** The EXACT production 403 body observed 2026-10 (redacted owner). */
const RESEND_TESTING_403 =
  '{"message": "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.", "name": "validation_error", "statusCode": 403}'

const RENDERED = { subject: 'Test subject', html: '<p>Test body</p>' }

const SAVED_ENV = {
  resendKey: process.env.RESEND_API_KEY,
  emailProvider: process.env.EMAIL_PROVIDER,
  gmailUser: process.env.GMAIL_SMTP_USER,
  gmailPass: process.env.GMAIL_SMTP_APP_PASSWORD,
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_PROVIDER
  delete process.env.GMAIL_SMTP_USER
  delete process.env.GMAIL_SMTP_APP_PASSWORD
})

afterEach(() => {
  for (const [name, value] of Object.entries({
    RESEND_API_KEY: SAVED_ENV.resendKey,
    EMAIL_PROVIDER: SAVED_ENV.emailProvider,
    GMAIL_SMTP_USER: SAVED_ENV.gmailUser,
    GMAIL_SMTP_APP_PASSWORD: SAVED_ENV.gmailPass,
  })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

// ─── 1. HTTP status classification ───────────────────────────────────────

describe('provider error classification — HTTP status family', () => {
  test('401 → auth-invalid, not retryable', () => {
    const c = classifyProviderHttpStatus(401, '{"message":"Unauthorized"}')
    expect(c.errorClass).toBe('auth-invalid')
    expect(c.retryable).toBe(false)
  })

  test('403 + Resend testing-mode body → testing-recipient-restricted (the production failure mode)', () => {
    const c = classifyProviderHttpStatus(403, RESEND_TESTING_403)
    expect(c.errorClass).toBe('testing-recipient-restricted')
    expect(c.retryable).toBe(false)
    // The hint must NOT tell the operator to rotate a working key.
    expect(c.hint).toContain('NOT an invalid API key')
  })

  test('403 + domain-verification body (no testing phrase) → unverified-sender-domain', () => {
    const c = classifyProviderHttpStatus(403, 'You can only send emails from verified domains. Domain not verified.')
    expect(c.errorClass).toBe('unverified-sender-domain')
    expect(c.retryable).toBe(false)
  })

  test('422 + unverified domain body → unverified-sender-domain', () => {
    const c = classifyProviderHttpStatus(422, 'The from domain is not verified')
    expect(c.errorClass).toBe('unverified-sender-domain')
  })

  test('429 → rate-limited, retryable', () => {
    const c = classifyProviderHttpStatus(429, '{"message":"Rate limit exceeded"}')
    expect(c.errorClass).toBe('rate-limited')
    expect(c.retryable).toBe(true)
  })

  test('500/502/503 → transient, retryable', () => {
    expect(classifyProviderHttpStatus(500, 'oops').errorClass).toBe('transient')
    expect(classifyProviderHttpStatus(502, '').retryable).toBe(true)
    expect(classifyProviderHttpStatus(503, 'busy').errorClass).toBe('transient')
  })

  test('400 → invalid-request, permanent', () => {
    const c = classifyProviderHttpStatus(400, '{"message":"validation error"}')
    expect(c.errorClass).toBe('invalid-request')
    expect(c.retryable).toBe(false)
  })

  test('403 with unclassifiable body → unknown, permanent', () => {
    const c = classifyProviderHttpStatus(403, 'something else entirely')
    expect(c.errorClass).toBe('unknown')
    expect(c.retryable).toBe(false)
  })
})

// ─── 2. SMTP transport-error classification ──────────────────────────────

describe('provider error classification — SMTP transport family', () => {
  test('EAUTH / 535 → auth-invalid, not retryable', () => {
    expect(classifyProviderTransportError('EAUTH', '535 Authentication failed').errorClass).toBe('auth-invalid')
    expect(classifyProviderTransportError(undefined, '535-5.7.8 Bad credentials').errorClass).toBe('auth-invalid')
    expect(classifyProviderTransportError('EAUTH', '').retryable).toBe(false)
  })

  test('network error codes → transient, retryable', () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ESOCKET']) {
      const c = classifyProviderTransportError(code, '')
      expect(c.errorClass).toBe('transient')
      expect(c.retryable).toBe(true)
    }
  })

  test('SMTP 421 / 450 → transient, retryable', () => {
    expect(classifyProviderTransportError(undefined, '421 Try again later').retryable).toBe(true)
    expect(classifyProviderTransportError(undefined, '450 greylisted').errorClass).toBe('transient')
  })

  test('SMTP 5xx → invalid-request, permanent', () => {
    const c = classifyProviderTransportError(undefined, '550 5.1.1 user unknown')
    expect(c.errorClass).toBe('invalid-request')
    expect(c.retryable).toBe(false)
  })
})

// ─── 3. class tag round-trip + clipping ──────────────────────────────────

describe('formatProviderError / parseErrorClass round-trip', () => {
  test('round-trips every class', () => {
    for (const cls of [
      'auth-invalid',
      'testing-recipient-restricted',
      'unverified-sender-domain',
      'rate-limited',
      'transient',
      'invalid-request',
      'provider-config',
      'unknown',
    ] as const) {
      const formatted = formatProviderError(cls, 'HTTP 403: something broke')
      expect(formatted.startsWith(`[${cls}]`)).toBe(true)
      expect(parseErrorClass(formatted)).toBe(cls)
    }
  })

  test('clips long details (≤480 + tag) and parseErrorClass still reads the class', () => {
    const long = 'x'.repeat(2000)
    const formatted = formatProviderError('transient', `HTTP 503: ${long}`)
    expect(formatted.length).toBeLessThanOrEqual(500)
    expect(formatted.endsWith('…')).toBe(true)
    expect(parseErrorClass(formatted)).toBe('transient')
  })

  test('parseErrorClass: untagged and garbage inputs → null', () => {
    expect(parseErrorClass(null)).toBeNull()
    expect(parseErrorClass('plain old error text')).toBeNull()
    expect(parseErrorClass('[not-a-real-class] boom')).toBeNull()
  })
})

// ─── 4. Gmail SMTP adapter (injected stub — nodemailer never loads) ──────

describe('gmailSmtpAttempt — Gmail SMTP adapter', () => {
  test('250 response, no rejections → ok + messageId', async () => {
    const sendMail: SmtpSendMail = async () => ({
      messageId: '<abc123@gmail.com>',
      response: '250 2.0.0 OK 1728000000 q4sm12345678.9',
      rejected: [],
    })
    const outcome = await gmailSmtpAttempt(sendMail, 'Scholario <t@example.test>', 'r@example.test', RENDERED)
    expect(outcome.ok).toBe(true)
    expect(outcome.messageId).toBe('<abc123@gmail.com>')
    expect(outcome.retryable).toBe(false)
  })

  test('thrown EAUTH → auth-invalid, permanent', async () => {
    const sendMail: SmtpSendMail = async () => {
      const e = new Error('Invalid login: 535 Bad credentials') as Error & { code: string }
      e.code = 'EAUTH'
      throw e
    }
    const outcome = await gmailSmtpAttempt(sendMail, 'Scholario <t@example.test>', 'r@example.test', RENDERED)
    expect(outcome.ok).toBe(false)
    expect(outcome.retryable).toBe(false)
    expect(outcome.errorClass).toBe('auth-invalid')
    expect(outcome.error).toContain('[auth-invalid]')
  })

  test('thrown ETIMEDOUT → transient, retryable', async () => {
    const sendMail: SmtpSendMail = async () => {
      const e = new Error('connection timed out') as Error & { code: string }
      e.code = 'ETIMEDOUT'
      throw e
    }
    const outcome = await gmailSmtpAttempt(sendMail, 'Scholario <t@example.test>', 'r@example.test', RENDERED)
    expect(outcome.ok).toBe(false)
    expect(outcome.retryable).toBe(true)
    expect(outcome.errorClass).toBe('transient')
  })

  test('rejected recipients → invalid-request, permanent', async () => {
    const sendMail: SmtpSendMail = async () => ({
      response: '250 2.0.0 OK (partial)',
      rejected: ['bad-recipient@example.test'],
    })
    const outcome = await gmailSmtpAttempt(sendMail, 'Scholario <t@example.test>', 'bad-recipient@example.test', RENDERED)
    expect(outcome.ok).toBe(false)
    expect(outcome.retryable).toBe(false)
    expect(outcome.errorClass).toBe('invalid-request')
    expect(outcome.error).toContain('bad-recipient@example.test')
  })

  test('non-2xx final response without throw → classified from the response', async () => {
    const sendMail: SmtpSendMail = async () => ({ response: '550 5.1.1 user unknown', rejected: [] })
    const outcome = await gmailSmtpAttempt(sendMail, 'Scholario <t@example.test>', 'r@example.test', RENDERED)
    expect(outcome.ok).toBe(false)
    expect(outcome.errorClass).toBe('invalid-request')
  })
})

// ─── 5. provider selection matrix ────────────────────────────────────────

describe('resolveProvider — selection matrix', () => {
  test('auto: nothing configured → dev-log', () => {
    expect(resolveProvider()).toMatchObject({ id: 'dev-log', selection: 'auto', configured: true })
  })

  test('auto: resend key only → resend', () => {
    process.env.RESEND_API_KEY = 're_stub_not_a_real_key'
    expect(resolveProvider()).toMatchObject({ id: 'resend', selection: 'auto', configured: true })
  })

  test('auto: gmail creds only (no resend key) → gmail-smtp', () => {
    process.env.GMAIL_SMTP_USER = 'owner@example.test'
    process.env.GMAIL_SMTP_APP_PASSWORD = 'abcdefghijklmnop'
    expect(resolveProvider()).toMatchObject({ id: 'gmail-smtp', selection: 'auto', configured: true })
  })

  test('auto: resend key wins over gmail creds (production default first)', () => {
    process.env.RESEND_API_KEY = 're_stub_not_a_real_key'
    process.env.GMAIL_SMTP_USER = 'owner@example.test'
    process.env.GMAIL_SMTP_APP_PASSWORD = 'abcdefghijklmnop'
    expect(resolveProvider()).toMatchObject({ id: 'resend', selection: 'auto', configured: true })
  })

  test('explicit resend without key → misconfigured with a clear error', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    const p = resolveProvider()
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('RESEND_API_KEY is not set')
  })

  test('explicit gmail-smtp with only the user (no app password) → misconfigured', () => {
    process.env.EMAIL_PROVIDER = 'gmail-smtp'
    process.env.GMAIL_SMTP_USER = 'owner@example.test'
    const p = resolveProvider()
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('App Password')
  })

  test('explicit dev-log overrides a present resend key', () => {
    process.env.RESEND_API_KEY = 're_stub_not_a_real_key'
    process.env.EMAIL_PROVIDER = 'dev-log'
    expect(resolveProvider()).toMatchObject({ id: 'dev-log', selection: 'explicit', configured: true })
  })

  test('unrecognized EMAIL_PROVIDER → misconfiguration, never a silent dev fallback', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    const p = resolveProvider()
    expect(p.configured).toBe(false)
    expect(p.configError).toContain('not a recognized provider')
  })

  test('EMAIL_PROVIDER=auto behaves like unset', () => {
    process.env.EMAIL_PROVIDER = 'auto'
    expect(resolveProvider()).toMatchObject({ id: 'dev-log', selection: 'auto', configured: true })
  })
})

// ─── 6. diagnostics masking helper ───────────────────────────────────────

describe('maskEmail — diagnostics never exposes full addresses', () => {
  test('masks the local part, keeps the domain', () => {
    expect(maskEmail('signature4748@gmail.com')).toBe('sig***@gmail.com')
    expect(maskEmail('ab@example.test')).toBe('a***@example.test')
  })

  test('degenerate inputs never leak', () => {
    expect(maskEmail('')).toBe('***')
    expect(maskEmail('@')).toBe('***')
    expect(maskEmail('x')).toBe('***')
  })
})
