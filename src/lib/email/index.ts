// ============================================================
// 8B-7-e — Central email infrastructure: sendEmail PIPELINE
// ------------------------------------------------------------
// The single server-side entry point for transactional email:
//
//   await sendEmail({ to, template, props, schoolId?, dedupeKey?, requestId? })
//     → { status: 'sent'|'queued'|'skipped'|'failed', transport, attempts, messageId?, deliveryId? }
//
// NEVER THROWS — every outcome (including DB and render failures) is
// a value. Call sites must not fail because email infrastructure
// hiccupped; the EmailDelivery row is the audit trail.
//
// FLOW (mission §7):
//   a) recipient validated (zod emailSchema, normalized trim+lowercase);
//      invalid → warn log + FAILED row (lastError 'invalid recipient')
//   b) dedupe: a SENT or QUEUED row with the same dedupeKey → 'skipped'
//      (idempotency — an ACCEPTED email is never re-sent)
//   c) upsert the PENDING EmailDelivery row (create if absent; FAILED
//      rows reset to PENDING — retries allowed; SENT/QUEUED rows
//      NEVER touched)
//   d) render (unknown template / bad props → FAILED row + failed result)
//   e) provider dispatch (providers/ — adapter per provider):
//        resend    → POST https://api.resend.com/emails, 5s timeout,
//                    retries ONLY on 429/5xx/network, backoff
//                    250ms/1000ms (bounded, awaited); 4xx (non-429)
//                    = permanent, classified (403 testing-restriction
//                    is NOT an auth error — see provider-errors.ts)
//        gmail-smtp→ smtp.gmail.com:465 TLS via nodemailer (lazy
//                    import), 10s/15s timeouts, same retry policy
//                    (auth failures permanent, network retryable)
//        dev-log   → structured 'email_dev_delivery' log line; the log
//                    IS the delivery
//      Provider acceptance (2xx / SMTP 250) → status QUEUED — the
//      message is in the provider's queue, NOT confirmed delivered.
//      SENT requires delivery EVIDENCE: the Resend webhook's
//      email.delivered event (see api/webhooks/resend) or the dev-log
//      transport. An email is NEVER reported as delivered when it was
//      merely queued or rejected.
//   f) provider selection: EMAIL_PROVIDER env override ('resend' |
//      'gmail-smtp' | 'dev-log'); default 'auto' → resend when
//      RESEND_API_KEY is set, else gmail-smtp when GMAIL_SMTP_USER +
//      GMAIL_SMTP_APP_PASSWORD are set, else dev-log. An explicit
//      override without its credentials fails LOUDLY (every send →
//      FAILED with a [provider-config] class) — never a silent
//      fallback.
//   g) every transport attempt logs 'email_attempt' {template, transport,
//      attempt, status, errorClass?}; failure details NEVER contain
//      the API key or SMTP password — request headers are never
//      logged, and the structured logger's redact() would mask any
//      'authorization' key anyway
//   h) final row update (QUEUED/SENT/FAILED + attempts + lastError ≤500
//      chars, prefixed with a machine-parseable [error-class] tag)
//      wrapped in try/catch — DB failures log, never throw
//
// CORRELATION: sendEmail opens a minimal request scope (requestId +
// schoolId) when no HTTP request scope is active, so every log line is
// correlated. Inside an existing scope the caller's context stays
// authoritative (the logger drops explicit schoolId/requestId caller
// fields by anti-spoofing design — the context is the channel).
//
// SERVER-ONLY: this module reads RESEND_API_KEY / GMAIL_SMTP_* and
// carries PII payloads. The window guard below fails fast if a bundler
// ever pulls it into a browser bundle (the `server-only` package is
// deliberately NOT imported so bun-run scripts/tests can use the
// module — same pattern as src/lib/storage/supabase.ts).
// ============================================================

import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'
import { getRequestContext, runWithContext } from '@/lib/observability/context'
import { newRequestId } from '@/lib/security/errors'
import { emailSchema } from '@/lib/security/validation'
import { renderTemplate } from './templates'
import { gmailSmtpConfig, gmailSmtpConfigured, createNodemailerSendMail, gmailSmtpAttempt } from './providers/gmail-smtp'
import { resendAttempt } from './providers/resend'
import { formatProviderError } from './provider-errors'
import type {
  EmailBranding,
  EmailInput,
  EmailProviderId,
  EmailResult,
  EmailTransportStatus,
  RenderedEmail,
  ResolvedProvider,
  SendEmailOptions,
} from './types'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/email/index.ts is server-side only (it holds provider credentials and email payloads). ' +
      'Remove any Client Component import.',
  )
}

// ─── transport configuration ────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3
/** Bounded backoff after attempt 1 / attempt 2 (later attempts reuse 1000ms). */
const RETRY_BACKOFF_MS = [250, 1000]
const LAST_ERROR_MAX = 500
const INVALID_RECIPIENT_ERROR = 'invalid recipient'
const DEV_PROVIDER_MESSAGE_ID = 'dev-log'
const DEFAULT_FROM = 'Scholario <onboarding@resend.dev>'

const NEUTRAL_BRANDING: EmailBranding = {
  schoolName: 'Scholario',
  primaryColor: '#0f766e',
}

/** Live env read (never memoized) so tests/config reloads flip transports. */
function resendApiKey(): string | null {
  const key = (process.env.RESEND_API_KEY ?? '').trim()
  return key.length > 0 ? key : null
}

/**
 * Resolve the active provider (Phase A). EMAIL_PROVIDER explicitly
 * pins the provider ('resend' | 'gmail-smtp' | 'dev-log'); 'auto' (or
 * unset) detects credentials: resend key → gmail creds → dev-log.
 * An explicit pin without credentials is a LOUD misconfiguration —
 * every send fails with a [provider-config] class instead of a
 * silent fallback.
 */
export function resolveProvider(): ResolvedProvider {
  const requested = (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase()
  if (requested && requested !== 'auto') {
    if (requested === 'resend') {
      if (resendApiKey() === null) {
        return {
          id: 'resend',
          selection: 'explicit',
          configured: false,
          configError: 'EMAIL_PROVIDER=resend but RESEND_API_KEY is not set',
        }
      }
      return { id: 'resend', selection: 'explicit', configured: true }
    }
    if (requested === 'gmail-smtp') {
      if (!gmailSmtpConfigured()) {
        return {
          id: 'gmail-smtp',
          selection: 'explicit',
          configured: false,
          configError:
            'EMAIL_PROVIDER=gmail-smtp but GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD are not fully set (a 16-char Google App Password is required)',
        }
      }
      return { id: 'gmail-smtp', selection: 'explicit', configured: true }
    }
    if (requested === 'dev-log') {
      return { id: 'dev-log', selection: 'explicit', configured: true }
    }
    return {
      id: 'dev-log',
      selection: 'explicit',
      configured: false,
      configError: `EMAIL_PROVIDER='${requested}' is not a recognized provider (resend | gmail-smtp | dev-log | auto)`,
    }
  }
  // auto: credential detection, Resend first (production default).
  if (resendApiKey() !== null) return { id: 'resend', selection: 'auto', configured: true }
  if (gmailSmtpConfigured()) return { id: 'gmail-smtp', selection: 'auto', configured: true }
  return { id: 'dev-log', selection: 'auto', configured: true }
}

/** Diagnostics: is production email configured? (back-compat surface) */
export function getEmailTransportStatus(): EmailTransportStatus {
  return { resendConfigured: resendApiKey() !== null }
}

// ─── small helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function briefError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** Clip text for lastError storage / log detail (≤500 chars). */
function clip(text: string, max = LAST_ERROR_MAX): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Prisma unique-constraint violation (raced create on a dedupeKey). */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null | undefined)?.code === 'P2002'
}

// ─── branding (School row, minimal columns, neutral fallback) ───────────

/**
 * Resolve tenant branding from the School row — name, shortName,
 * themeColor, logoUrl ONLY. No schoolId / row missing / DB failure →
 * neutral Scholario branding (the email still goes out).
 */
async function resolveBranding(schoolId?: string): Promise<EmailBranding> {
  if (!schoolId) return NEUTRAL_BRANDING
  try {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { name: true, shortName: true, themeColor: true, logoUrl: true },
    })
    if (!school) return NEUTRAL_BRANDING
    return {
      schoolName: school.name,
      shortName: school.shortName ?? undefined,
      primaryColor: school.themeColor,
      logoUrl: school.logoUrl ?? undefined,
    }
  } catch (e) {
    log('warn', 'email_branding_fallback', { detail: clip(briefError(e)) })
    return NEUTRAL_BRANDING
  }
}

// ─── EmailDelivery row lifecycle (all failures logged, never thrown) ────

type UpsertKind = 'created' | 'reset' | 'accepted-protected' | 'unavailable'

interface UpsertOutcome {
  kind: UpsertKind
  deliveryId?: string
}

/** Statuses that mean the provider already accepted this email. */
const ACCEPTED_STATUSES = ['SENT', 'QUEUED'] as const

function isAcceptedStatus(status: string): boolean {
  return (ACCEPTED_STATUSES as readonly string[]).includes(status)
}

/**
 * Steps (b) + (c): dedupe + PENDING upsert in one DB round-trip family.
 *
 *   · no dedupeKey           → create a fresh PENDING row
 *   · key absent from table  → create a PENDING row (raced create on
 *                              the unique index is re-read and classified)
 *   · existing row SENT/QUEUED → 'accepted-protected' → caller returns
 *                              'skipped' (idempotency — an accepted
 *                              email is never re-sent; re-sending would
 *                              duplicate at the provider)
 *   · existing PENDING/FAILED→ reset to PENDING, attempts 0
 *                              (FAILED = retry allowed; PENDING = concurrent
 *                              sender, last writer wins)
 */
async function upsertPendingDelivery(input: EmailInput, to: string): Promise<UpsertOutcome> {
  const base = {
    schoolId: input.schoolId ?? null,
    template: input.template,
    recipient: to,
    status: 'PENDING',
    attempts: 0,
    lastError: null as string | null,
    providerMessageId: null as string | null,
  }
  try {
    if (!input.dedupeKey) {
      const row = await db.emailDelivery.create({ data: { ...base, dedupeKey: null } })
      return { kind: 'created', deliveryId: row.id }
    }

    let existing = await db.emailDelivery.findUnique({ where: { dedupeKey: input.dedupeKey } })
    if (!existing) {
      try {
        const row = await db.emailDelivery.create({ data: { ...base, dedupeKey: input.dedupeKey } })
        return { kind: 'created', deliveryId: row.id }
      } catch (e) {
        if (!isUniqueViolation(e)) throw e
        // Lost a create race on the unique dedupeKey — classify the winner.
        existing = await db.emailDelivery.findUnique({ where: { dedupeKey: input.dedupeKey } })
        if (!existing) throw e
      }
    }
    if (isAcceptedStatus(existing.status)) {
      return { kind: 'accepted-protected', deliveryId: existing.id }
    }
    await db.emailDelivery.update({
      where: { id: existing.id },
      data: { ...base, dedupeKey: input.dedupeKey },
    })
    return { kind: 'reset', deliveryId: existing.id }
  } catch (e) {
    log('error', 'email_db_failure', { operation: 'upsert_pending_delivery', detail: clip(briefError(e)) })
    return { kind: 'unavailable' }
  }
}

/**
 * Step (a) audit row for a rejected recipient — FAILED with
 * lastError 'invalid recipient'. A dedupeKey collision (an existing row,
 * including an accepted one, already owns the key) is logged and left
 * untouched: an accepted row is never modified.
 */
async function recordInvalidRecipient(input: EmailInput): Promise<string | undefined> {
  try {
    const row = await db.emailDelivery.create({
      data: {
        schoolId: input.schoolId ?? null,
        template: input.template,
        recipient: input.to,
        status: 'FAILED',
        attempts: 0,
        lastError: INVALID_RECIPIENT_ERROR,
        dedupeKey: input.dedupeKey ?? null,
      },
    })
    return row.id
  } catch (e) {
    log('warn', 'email_db_failure', { operation: 'record_invalid_recipient', detail: clip(briefError(e)) })
    return undefined
  }
}

/** Post-acceptance status (QUEUED for real providers, SENT for dev-log). */
type AcceptedStatus = 'QUEUED' | 'SENT'

/**
 * Step (h): final status write. `updateMany` with
 * `status NOT IN ('SENT','QUEUED')` makes "never touch an accepted
 * row" a DB-level guarantee — if a concurrent sender already marked
 * the row accepted, this write is a no-op.
 */
async function finalizeDelivery(
  deliveryId: string | undefined,
  outcome: {
    status: AcceptedStatus | 'FAILED'
    attempts: number
    providerMessageId?: string | null
    lastError?: string | null
  },
): Promise<void> {
  if (!deliveryId) return
  try {
    await db.emailDelivery.updateMany({
      where: { id: deliveryId, status: { notIn: ['SENT', 'QUEUED'] } },
      data: {
        status: outcome.status,
        attempts: outcome.attempts,
        providerMessageId: outcome.providerMessageId ?? null,
        lastError: outcome.lastError ? clip(outcome.lastError) : null,
      },
    })
  } catch (e) {
    log('error', 'email_db_failure', { operation: 'finalize_delivery', detail: clip(briefError(e)) })
  }
}

// ─── the provider retry loop (shared by resend + gmail-smtp) ────────────

interface ProviderOutcome {
  ok: boolean
  messageId?: string
  retryable: boolean
  errorClass?: string
  error?: string
}

/**
 * Bounded retry loop over a provider attempt function. Retries ONLY
 * retryable outcomes (rate-limited / transient — 429, 5xx, network,
 * SMTP 4xx-transient); permanent provider rejections (auth-invalid,
 * testing-recipient-restricted, unverified-sender-domain,
 * invalid-request) break immediately. Backoff 250ms/1000ms, awaited.
 */
async function runProviderAttempts(
  provider: EmailProviderId,
  template: string,
  deliveryId: string | undefined,
  maxAttempts: number,
  attemptOnce: () => Promise<ProviderOutcome>,
): Promise<{ accepted: boolean; attempts: number; messageId?: string; lastError?: string }> {
  let attempts = 0
  let lastError: string | undefined
  while (attempts < maxAttempts) {
    attempts++
    const outcome = await attemptOnce()
    if (outcome.ok) {
      log('info', 'email_attempt', {
        template,
        transport: provider,
        attempt: attempts,
        status: 'ok',
      })
      return { accepted: true, attempts, messageId: outcome.messageId }
    }

    lastError = outcome.error
    log(outcome.retryable ? 'warn' : 'error', 'email_attempt', {
      template,
      transport: provider,
      attempt: attempts,
      status: outcome.retryable ? 'retryable' : 'permanent',
      errorClass: outcome.errorClass ?? 'unknown',
      detail: outcome.error,
    })
    if (!outcome.retryable) break // permanent provider rejection: no retry
    if (attempts < maxAttempts) {
      const backoffMs = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]
      await sleep(backoffMs) // bounded, awaited
    }
  }
  return { accepted: false, attempts, lastError }
}

/**
 * Provider-accepted → the honest row status. Real providers (resend,
 * gmail-smtp): QUEUED — accepted into the provider's queue, delivery
 * unconfirmed (SENT requires the delivery webhook event). Dev-log:
 * SENT — the structured log line IS the delivery.
 */
function acceptedRowStatus(provider: EmailProviderId): AcceptedStatus {
  return provider === 'dev-log' ? 'SENT' : 'QUEUED'
}

// ─── transport drivers ──────────────────────────────────────────────────

async function deliverViaResend(
  input: EmailInput,
  to: string,
  rendered: RenderedEmail,
  deliveryId: string | undefined,
  maxAttempts: number,
): Promise<EmailResult> {
  const apiKey = resendApiKey()
  if (!apiKey) {
    // Key vanished between provider resolution and now (env race) —
    // fail loudly-but-safely rather than silently not delivering.
    const detail = formatProviderError('provider-config', 'RESEND_API_KEY disappeared mid-send')
    log('error', 'email_result', { template: input.template, transport: 'resend', status: 'failed', detail })
    await finalizeDelivery(deliveryId, { status: 'FAILED', attempts: 0, lastError: detail })
    return { status: 'failed', transport: 'resend', attempts: 0, deliveryId }
  }
  const from = (process.env.EMAIL_FROM ?? '').trim() || DEFAULT_FROM

  const outcome = await runProviderAttempts('resend', input.template, deliveryId, maxAttempts, () =>
    resendAttempt(apiKey, from, to, rendered),
  )

  if (outcome.accepted) {
    if (!outcome.messageId) {
      // 2xx without a parseable id — accepted, but flag it loudly.
      log('warn', 'email_attempt', { transport: 'resend', status: 'ok_no_provider_id', deliveryId })
    }
    const rowStatus = acceptedRowStatus('resend')
    await finalizeDelivery(deliveryId, {
      status: rowStatus,
      attempts: outcome.attempts,
      providerMessageId: outcome.messageId ?? null,
    })
    log('info', 'email_result', {
      template: input.template,
      transport: 'resend',
      status: rowStatus === 'QUEUED' ? 'queued' : 'sent',
      attempts: outcome.attempts,
      deliveryId,
    })
    return {
      status: 'queued',
      transport: 'resend',
      attempts: outcome.attempts,
      messageId: outcome.messageId,
      deliveryId,
    }
  }

  const finalError = outcome.lastError ?? formatProviderError('unknown', 'resend transport failed')
  await finalizeDelivery(deliveryId, { status: 'FAILED', attempts: outcome.attempts, lastError: finalError })
  log('error', 'email_result', {
    template: input.template,
    transport: 'resend',
    status: 'failed',
    attempts: outcome.attempts,
    deliveryId,
  })
  return { status: 'failed', transport: 'resend', attempts: outcome.attempts, deliveryId }
}

async function deliverViaGmailSmtp(
  input: EmailInput,
  to: string,
  rendered: RenderedEmail,
  deliveryId: string | undefined,
  maxAttempts: number,
): Promise<EmailResult> {
  const cfg = gmailSmtpConfig()
  if (!cfg.user || !cfg.appPassword) {
    // Credentials vanished between provider resolution and now —
    // fail loudly-but-safely.
    const detail = formatProviderError(
      'provider-config',
      'GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD disappeared mid-send',
    )
    log('error', 'email_result', { template: input.template, transport: 'gmail-smtp', status: 'failed', detail })
    await finalizeDelivery(deliveryId, { status: 'FAILED', attempts: 0, lastError: detail })
    return { status: 'failed', transport: 'gmail-smtp', attempts: 0, deliveryId }
  }
  // Gmail rewrites the From header to the authenticated account; the
  // display name preserves the Scholario identity in inboxes that
  // honor it. Branding (school name/color) rides subject + body.
  const from = `Scholario <${cfg.user}>`
  const sendMail = createNodemailerSendMail({ user: cfg.user, appPassword: cfg.appPassword })

  const outcome = await runProviderAttempts('gmail-smtp', input.template, deliveryId, maxAttempts, () =>
    gmailSmtpAttempt(sendMail, from, to, rendered),
  )

  if (outcome.accepted) {
    // SMTP 250 = accepted into Gmail's delivery queue. There is NO
    // delivery-confirmation channel for this provider — the row stays
    // QUEUED, honestly, forever unless evidence arrives.
    await finalizeDelivery(deliveryId, {
      status: 'QUEUED',
      attempts: outcome.attempts,
      providerMessageId: outcome.messageId ?? null,
    })
    log('info', 'email_result', {
      template: input.template,
      transport: 'gmail-smtp',
      status: 'queued',
      attempts: outcome.attempts,
      deliveryId,
    })
    return {
      status: 'queued',
      transport: 'gmail-smtp',
      attempts: outcome.attempts,
      messageId: outcome.messageId,
      deliveryId,
    }
  }

  const finalError = outcome.lastError ?? formatProviderError('unknown', 'gmail-smtp transport failed')
  await finalizeDelivery(deliveryId, { status: 'FAILED', attempts: outcome.attempts, lastError: finalError })
  log('error', 'email_result', {
    template: input.template,
    transport: 'gmail-smtp',
    status: 'failed',
    attempts: outcome.attempts,
    deliveryId,
  })
  return { status: 'failed', transport: 'gmail-smtp', attempts: outcome.attempts, deliveryId }
}

async function deliverViaDevLog(
  input: EmailInput,
  to: string,
  rendered: RenderedEmail,
  deliveryId: string | undefined,
): Promise<EmailResult> {
  // The dev transport: the structured log line IS the delivery.
  // (schoolId/requestId ride the request-context correlation channel —
  // the logger drops explicit schoolId caller fields by anti-spoofing
  // design; sendEmail opens a scope when none is active, see below.)
  log('info', 'email_attempt', {
    template: input.template,
    transport: 'dev-log',
    attempt: 1,
    status: 'ok',
  })
  log('info', 'email_dev_delivery', {
    template: input.template,
    to,
    subject: rendered.subject,
  })
  await finalizeDelivery(deliveryId, {
    status: 'SENT',
    attempts: 1,
    providerMessageId: DEV_PROVIDER_MESSAGE_ID,
  })
  log('info', 'email_result', {
    template: input.template,
    transport: 'dev-log',
    status: 'sent',
    attempts: 1,
    deliveryId,
  })
  return {
    status: 'sent',
    transport: 'dev-log',
    attempts: 1,
    messageId: DEV_PROVIDER_MESSAGE_ID,
    deliveryId,
  }
}

// ─── the entry point ────────────────────────────────────────────────────

async function sendEmailInner(input: EmailInput, options: SendEmailOptions, provider: ResolvedProvider): Promise<EmailResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))

  // Provider resolution failure (explicit EMAIL_PROVIDER pin without
  // credentials, or an unrecognized value): fail LOUDLY — every send
  // gets a FAILED row with a [provider-config] class. Never a silent
  // fallback to another transport.
  if (!provider.configured) {
    const detail = formatProviderError('provider-config', provider.configError ?? 'provider not configured')
    log('error', 'email_result', {
      template: input.template,
      transport: provider.id,
      status: 'failed',
      detail,
    })
    // Still audited: invalid-recipient guard first so the row carries
    // the honest reason even for malformed addresses.
    const recipient = emailSchema.safeParse(input.to)
    if (!recipient.success) {
      const deliveryId = await recordInvalidRecipient(input)
      return { status: 'failed', transport: provider.id, attempts: 0, deliveryId }
    }
    const to = recipient.data
    const upserted = await upsertPendingDelivery(input, to)
    if (upserted.kind === 'accepted-protected') {
      return { status: 'skipped', transport: provider.id, attempts: 0, deliveryId: upserted.deliveryId }
    }
    await finalizeDelivery(upserted.deliveryId, { status: 'FAILED', attempts: 0, lastError: detail })
    return { status: 'failed', transport: provider.id, attempts: 0, deliveryId: upserted.deliveryId }
  }

  // (a) recipient validation — normalized (trim + lowercase) by the
  // shared API emailSchema; malformed addresses never reach a transport.
  const recipient = emailSchema.safeParse(input.to)
  if (!recipient.success) {
    log('warn', 'email_invalid_recipient', { template: input.template })
    const deliveryId = await recordInvalidRecipient(input)
    return { status: 'failed', transport: provider.id, attempts: 0, deliveryId }
  }
  const to = recipient.data

  // (b) + (c) dedupe + PENDING upsert (accepted rows are never touched).
  const upserted = await upsertPendingDelivery(input, to)
  if (upserted.kind === 'accepted-protected') {
    log('info', 'email_result', {
      template: input.template,
      transport: provider.id,
      status: 'skipped',
      attempts: 0,
      deliveryId: upserted.deliveryId,
    })
    return { status: 'skipped', transport: provider.id, attempts: 0, deliveryId: upserted.deliveryId }
  }

  // (d) render — unknown template / invalid props → FAILED row + result.
  const branding = await resolveBranding(input.schoolId)
  let rendered: RenderedEmail
  try {
    rendered = renderTemplate(input.template, input.props, branding)
  } catch (e) {
    const detail = clip(briefError(e))
    log('error', 'email_render_failed', { template: input.template, deliveryId: upserted.deliveryId, detail })
    await finalizeDelivery(upserted.deliveryId, { status: 'FAILED', attempts: 0, lastError: detail })
    return { status: 'failed', transport: provider.id, attempts: 0, deliveryId: upserted.deliveryId }
  }

  // (e) + (f) provider dispatch.
  if (provider.id === 'resend') {
    return deliverViaResend(input, to, rendered, upserted.deliveryId, maxAttempts)
  }
  if (provider.id === 'gmail-smtp') {
    return deliverViaGmailSmtp(input, to, rendered, upserted.deliveryId, maxAttempts)
  }
  return deliverViaDevLog(input, to, rendered, upserted.deliveryId)
}

/**
 * Send one transactional email. See the module header for the full
 * contract — the guarantee that matters to call sites: NEVER THROWS.
 */
export async function sendEmail(input: EmailInput, options: SendEmailOptions = {}): Promise<EmailResult> {
  const provider = resolveProvider()
  try {
    // Correlation scope: when no HTTP request scope is active (raw
    // handlers, jobs, tests), open a minimal email scope so every log
    // line carries requestId + schoolId. Inside an existing request
    // scope the caller's context is already authoritative and wins
    // (AsyncLocalStorage nesting is intentionally avoided there).
    if (getRequestContext()) {
      return await sendEmailInner(input, options, provider)
    }
    return await runWithContext(
      {
        requestId: input.requestId ?? newRequestId(),
        schoolId: input.schoolId,
        route: 'email',
        operation: `sendEmail:${input.template}`,
      },
      () => sendEmailInner(input, options, provider),
    )
  } catch (e) {
    // Belt-and-braces: the pipeline itself catches everything it can,
    // but the never-throws contract must hold unconditionally.
    log('error', 'email_pipeline_failure', {
      template: input.template,
      transport: provider.id,
      detail: clip(briefError(e)),
    })
    return { status: 'failed', transport: provider.id, attempts: 0 }
  }
}

// Convenient re-exports so call sites import from '@/lib/email' only.
export { renderTemplate } from './templates'
export {
  classifyProviderHttpStatus,
  classifyProviderTransportError,
  formatProviderError,
  parseErrorClass,
} from './provider-errors'
export type { EmailErrorClass, ProviderErrorClassification } from './provider-errors'
export type {
  EmailBranding,
  EmailInput,
  EmailProviderId,
  EmailResult,
  EmailTemplateProps,
  EmailTransportStatus,
  RenderedEmail,
  ResolvedProvider,
  SendEmailOptions,
  TemplateId,
} from './types'
