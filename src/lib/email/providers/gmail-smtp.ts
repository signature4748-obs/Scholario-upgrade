// ============================================================
// EMAIL PROVIDER: GMAIL SMTP (temporary provider adapter)
// ------------------------------------------------------------
// Owner context: the Resend account is in TESTING MODE with no
// verified sending domain (owner does not want to purchase a domain
// yet), so Resend can only deliver to the account-owner address.
// This adapter lets the deployment temporarily route transactional
// email through a Gmail account's SMTP (an App Password, 2FA
// required) so REAL recipients can receive mail without a domain.
//
// SECURITY MODEL:
//   · Credentials live ONLY in server env: GMAIL_SMTP_USER +
//     GMAIL_SMTP_APP_PASSWORD. They never reach the browser, never
//     appear in diagnostics (booleans + a masked address only),
//     never in logs or EmailDelivery rows.
//   · Explicit opt-in: EMAIL_PROVIDER=gmail-smtp (or auto-selection
//     when RESEND_API_KEY is absent but Gmail creds are present).
//   · Gmail rewrites the From header to the authenticated account —
//     branding survives in subject/body; the sender is the Gmail
//     address. Documented, not hidden.
//
// LIMITS (documented honestly):
//   · ~500 recipients/day on a consumer Gmail account.
//   · No delivery-confirmation channel (no webhook) — SMTP 250 means
//     ACCEPTED, so the outbox row is QUEUED, never SENT (delivery
//     evidence does not exist for this provider).
//   · Requires the owner to create a 16-char App Password
//     (Google Account → Security → 2FA → App passwords).
//
// TESTABILITY: the SMTP send function is injectable — production
// uses createNodemailerSendMail (nodemailer loaded lazily via
// dynamic import so tests never load it); tests inject a stub.
//
// MULTIPART: when both html and text are provided (RenderedEmail
// always carries both since the deliverability patch), nodemailer
// composes multipart/alternative — text/plain preferred by text-only
// clients, HTML for the rest. No extra headers are added.
// ============================================================

import { classifyProviderTransportError, formatProviderError } from '../provider-errors'
import type { ProviderAttempt, RenderedEmail } from '../types'

const SMTP_HOST = 'smtp.gmail.com'
const SMTP_PORT = 465
const CONNECTION_TIMEOUT_MS = 10_000
const GREETING_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 15_000
const ERROR_DETAIL_MAX = 480

export interface GmailSmtpConfig {
  user: string | null
  appPassword: string | null
}

/** Live env read (never memoized) — tests flip transports by env. */
export function gmailSmtpConfig(): GmailSmtpConfig {
  const user = (process.env.GMAIL_SMTP_USER ?? '').trim()
  const pass = (process.env.GMAIL_SMTP_APP_PASSWORD ?? '').trim()
  return {
    user: user.length > 0 ? user : null,
    appPassword: pass.length > 0 ? pass : null,
  }
}

/** Whether the Gmail SMTP provider has both required credentials. */
export function gmailSmtpConfigured(): boolean {
  const cfg = gmailSmtpConfig()
  return cfg.user !== null && cfg.appPassword !== null
}

/** Masked address for diagnostics (never the full address). */
export function maskEmail(address: string): string {
  const at = address.indexOf('@')
  if (at <= 0) return '***'
  const local = address.slice(0, at)
  const domain = address.slice(at)
  const head = local.slice(0, Math.min(3, Math.max(1, local.length - 1)))
  return `${head}${'*'.repeat(3)}${domain}`
}

/** Envelope for one SMTP send (subset of nodemailer's SendMailOptions). */
export interface SmtpMailOptions {
  from: string
  to: string
  subject: string
  html: string
  text?: string
}

/** What the injectable send function returns (subset of nodemailer SentMessageInfo). */
export interface SmtpSendOutcome {
  /** RFC Message-ID nodemailer generated (client-side) on accept. */
  messageId?: string
  /** The SMTP server's final response line, e.g. '250 2.0.0 OK …'. */
  response: string
  /** Recipients the server rejected (should be empty on success). */
  rejected?: string[]
}

export type SmtpSendMail = (options: SmtpMailOptions) => Promise<SmtpSendOutcome>

/**
 * Build the production send function: a nodemailer transport with
 * bounded timeouts. nodemailer is imported DYNAMICALLY so importing
 * this module never loads it (tests stub the send function instead).
 */
export function createNodemailerSendMail(config: { user: string; appPassword: string }): SmtpSendMail {
  return async (options) => {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true, // 465 = implicit TLS
      auth: { user: config.user, pass: config.appPassword },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      // No pooling: serverless functions are short-lived; a fresh
      // connection per send keeps cold starts honest.
      pool: false,
    })
    try {
      const info = await transporter.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      })
      return {
        messageId: typeof info.messageId === 'string' ? info.messageId : undefined,
        response: String(info.response ?? ''),
        rejected: Array.isArray((info as { rejected?: unknown }).rejected)
          ? ((info as { rejected: unknown[] }).rejected.filter((r): r is string => typeof r === 'string'))
          : [],
      }
    } finally {
      transporter.close()
    }
  }
}

function briefError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * ONE Gmail SMTP attempt via the injected send function. NEVER
 * throws — nodemailer rejections/timeouts become classified outcomes:
 *   250 response + no rejections → ok (queued at provider)
 *   EAUTH / 535                  → auth-invalid, permanent
 *   network / 421 / 450          → transient, retryable
 *   SMTP 5xx / rejected rcpt     → invalid-request, permanent
 */
export async function gmailSmtpAttempt(
  sendMail: SmtpSendMail,
  from: string,
  to: string,
  rendered: RenderedEmail,
): Promise<ProviderAttempt> {
  try {
    const info = await sendMail({
      from,
      to,
      subject: rendered.subject,
      html: rendered.html,
      // Both parts → nodemailer emits multipart/alternative (text/plain
      // alternative for text-only clients; same essential information
      // as the HTML by renderer construction).
      text: rendered.text,
    })
    if (info.rejected && info.rejected.length > 0) {
      return {
        ok: false,
        retryable: false,
        errorClass: 'invalid-request',
        error: formatProviderError(
          'invalid-request',
          `smtp rejected recipients: ${info.rejected.join(', ')} (${info.response})`,
          ERROR_DETAIL_MAX,
        ),
      }
    }
    const response = (info.response ?? '').trim()
    if (!/^250/.test(response)) {
      // Non-2xx final response without a thrown error — classify it.
      const classification = classifyProviderTransportError(undefined, response)
      return {
        ok: false,
        retryable: classification.retryable,
        errorClass: classification.errorClass,
        error: formatProviderError(classification.errorClass, `smtp: ${response}`, ERROR_DETAIL_MAX),
      }
    }
    return { ok: true, messageId: info.messageId, retryable: false }
  } catch (e) {
    const err = e as { code?: string; response?: string; message?: string }
    const classification = classifyProviderTransportError(err.code, String(err.response ?? err.message ?? briefError(e)))
    return {
      ok: false,
      retryable: classification.retryable,
      errorClass: classification.errorClass,
      error: formatProviderError(
        classification.errorClass,
        `smtp: ${err.code ? `${err.code} ` : ''}${briefError(e)}`,
        ERROR_DETAIL_MAX,
      ),
    }
  }
}
