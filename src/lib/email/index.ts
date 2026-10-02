// ============================================================
// 8B-7-e — Central email infrastructure: sendEmail PIPELINE
// ------------------------------------------------------------
// The single server-side entry point for transactional email:
//
//   await sendEmail({ to, template, props, schoolId?, dedupeKey?, requestId? })
//     → { status: 'sent'|'skipped'|'failed', transport, attempts, messageId?, deliveryId? }
//
// NEVER THROWS — every outcome (including DB and render failures) is
// a value. Call sites must not fail because email infrastructure
// hiccupped; the EmailDelivery row is the audit trail.
//
// FLOW (mission §7):
//   a) recipient validated (zod emailSchema, normalized trim+lowercase);
//      invalid → warn log + FAILED row (lastError 'invalid recipient')
//   b) dedupe: a SENT row with the same dedupeKey → 'skipped' (idempotency)
//   c) upsert the PENDING EmailDelivery row (create if absent; FAILED
//      rows reset to PENDING — retries allowed; SENT rows NEVER touched)
//   d) render (unknown template / bad props → FAILED row + failed result)
//   e) RESEND_API_KEY set → POST https://api.resend.com/emails with a
//      5s AbortController timeout; retries ONLY on 429/5xx/network,
//      backoff 250ms/1000ms (bounded, awaited); 4xx (non-429) = permanent
//   f) RESEND_API_KEY absent → DEV TRANSPORT: structured 'email_dev_delivery'
//      log line + row SENT with providerMessageId 'dev-log' (the log IS
//      the delivery — dedupe works in dev; production sends activate
//      automatically the moment the key is configured)
//   g) every transport attempt logs 'email_attempt' {template, transport,
//      attempt, status}; failure details NEVER contain the API key —
//      request headers are never logged, and the structured logger's
//      redact() would mask any 'authorization' key anyway
//   h) final row update (SENT/FAILED + attempts + lastError ≤500 chars)
//      wrapped in try/catch — DB failures log, never throw
//
// CORRELATION: sendEmail opens a minimal request scope (requestId +
// schoolId) when no HTTP request scope is active, so every log line is
// correlated. Inside an existing scope the caller's context stays
// authoritative (the logger drops explicit schoolId/requestId caller
// fields by anti-spoofing design — the context is the channel).
//
// SERVER-ONLY: this module reads RESEND_API_KEY and carries PII
// payloads. The window guard below fails fast if a bundler ever pulls
// it into a browser bundle (the `server-only` package is deliberately
// NOT imported so bun-run scripts/tests can use the module — same
// pattern as src/lib/storage/supabase.ts).
// ============================================================

import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'
import { getRequestContext, runWithContext } from '@/lib/observability/context'
import { newRequestId } from '@/lib/security/errors'
import { emailSchema } from '@/lib/security/validation'
import { renderTemplate } from './templates'
import type {
  EmailBranding,
  EmailInput,
  EmailResult,
  EmailTransportStatus,
  RenderedEmail,
  SendEmailOptions,
} from './types'

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/email/index.ts is server-side only (it holds the RESEND_API_KEY transport and email payloads). ' +
      'Remove any Client Component import.',
  )
}

// ─── transport configuration ────────────────────────────────────────────

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 5_000
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

function currentTransport(): 'resend' | 'dev-log' {
  return resendApiKey() !== null ? 'resend' : 'dev-log'
}

/** Diagnostics: is production email configured? */
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

type UpsertKind = 'created' | 'reset' | 'sent-protected' | 'unavailable'

interface UpsertOutcome {
  kind: UpsertKind
  deliveryId?: string
}

/**
 * Steps (b) + (c): dedupe + PENDING upsert in one DB round-trip family.
 *
 *   · no dedupeKey           → create a fresh PENDING row
 *   · key absent from table  → create a PENDING row (raced create on
 *                              the unique index is re-read and classified)
 *   · existing row SENT      → 'sent-protected' → caller returns 'skipped'
 *                              (idempotency — a SENT row is never touched)
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
    if (existing.status === 'SENT') {
      return { kind: 'sent-protected', deliveryId: existing.id }
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
 * including a SENT one, already owns the key) is logged and left
 * untouched: a SENT row is never modified.
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

/**
 * Step (h): final status write. `updateMany` with `status != 'SENT'`
 * makes "never touch a SENT row" a DB-level guarantee — if a concurrent
 * sender already marked the row SENT, this write is a no-op.
 */
async function finalizeDelivery(
  deliveryId: string | undefined,
  outcome: {
    status: 'SENT' | 'FAILED'
    attempts: number
    providerMessageId?: string | null
    lastError?: string | null
  },
): Promise<void> {
  if (!deliveryId) return
  try {
    await db.emailDelivery.updateMany({
      where: { id: deliveryId, status: { not: 'SENT' } },
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

// ─── resend transport (one attempt) ─────────────────────────────────────

interface TransportAttempt {
  ok: boolean
  messageId?: string
  retryable: boolean
  error?: string
}

/**
 * ONE POST to https://api.resend.com/emails, bounded by a 5s
 * AbortController timeout. NEVER throws (network errors/aborts come
 * back as retryable outcomes). Error details carry status + a brief
 * response-body excerpt — NEVER the Authorization header or API key.
 */
async function resendAttempt(
  apiKey: string,
  from: string,
  to: string,
  rendered: RenderedEmail,
): Promise<TransportAttempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS)
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject: rendered.subject, html: rendered.html }),
      signal: controller.signal,
    })
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null
      const messageId = body && typeof body.id === 'string' ? body.id : undefined
      if (!messageId) {
        // 2xx without a parseable id — accepted, but flag it loudly.
        log('warn', 'email_attempt', { transport: 'resend', status: 'ok_no_provider_id' })
      }
      return { ok: true, messageId, retryable: false }
    }
    const bodyText = await res.text().catch(() => '')
    const error = clip(`HTTP ${res.status}: ${bodyText.trim().slice(0, 200)}`, 200)
    const retryable = res.status === 429 || res.status >= 500
    return { ok: false, retryable, error }
  } catch (e) {
    // Network failure or the 5s abort — both retryable by policy.
    return { ok: false, retryable: true, error: clip(`network: ${briefError(e)}`, 200) }
  } finally {
    clearTimeout(timer)
  }
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
    // Key vanished between transport detection and now (env race) —
    // fail loudly-but-safely rather than silently not delivering.
    const detail = 'RESEND_API_KEY disappeared mid-send'
    log('error', 'email_result', { template: input.template, transport: 'resend', status: 'failed', detail })
    await finalizeDelivery(deliveryId, { status: 'FAILED', attempts: 0, lastError: detail })
    return { status: 'failed', transport: 'resend', attempts: 0, deliveryId }
  }
  const from = (process.env.EMAIL_FROM ?? '').trim() || DEFAULT_FROM

  let attempts = 0
  let lastError: string | undefined
  while (attempts < maxAttempts) {
    attempts++
    const outcome = await resendAttempt(apiKey, from, to, rendered)
    if (outcome.ok) {
      log('info', 'email_attempt', {
        template: input.template,
        transport: 'resend',
        attempt: attempts,
        status: 'ok',
      })
      await finalizeDelivery(deliveryId, {
        status: 'SENT',
        attempts,
        providerMessageId: outcome.messageId ?? null,
      })
      log('info', 'email_result', {
        template: input.template,
        transport: 'resend',
        status: 'sent',
        attempts,
        deliveryId,
      })
      return {
        status: 'sent',
        transport: 'resend',
        attempts,
        messageId: outcome.messageId,
        deliveryId,
      }
    }

    lastError = outcome.error
    log(outcome.retryable ? 'warn' : 'error', 'email_attempt', {
      template: input.template,
      transport: 'resend',
      attempt: attempts,
      status: outcome.retryable ? 'retryable' : 'permanent',
      detail: outcome.error,
    })
    if (!outcome.retryable) break // 4xx (non-429): permanent, no retry
    if (attempts < maxAttempts) {
      const backoffMs = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]
      await sleep(backoffMs) // bounded, awaited
    }
  }

  const finalError = lastError ?? 'resend transport failed'
  await finalizeDelivery(deliveryId, { status: 'FAILED', attempts, lastError: finalError })
  log('error', 'email_result', {
    template: input.template,
    transport: 'resend',
    status: 'failed',
    attempts,
    deliveryId,
  })
  return { status: 'failed', transport: 'resend', attempts, deliveryId }
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

async function sendEmailInner(
  input: EmailInput,
  options: SendEmailOptions,
  transport: 'resend' | 'dev-log',
): Promise<EmailResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))

  // (a) recipient validation — normalized (trim + lowercase) by the
  // shared API emailSchema; malformed addresses never reach a transport.
  const recipient = emailSchema.safeParse(input.to)
  if (!recipient.success) {
    log('warn', 'email_invalid_recipient', { template: input.template })
    const deliveryId = await recordInvalidRecipient(input)
    return { status: 'failed', transport, attempts: 0, deliveryId }
  }
  const to = recipient.data

  // (b) + (c) dedupe + PENDING upsert (SENT rows are never touched).
  const upserted = await upsertPendingDelivery(input, to)
  if (upserted.kind === 'sent-protected') {
    log('info', 'email_result', {
      template: input.template,
      transport,
      status: 'skipped',
      attempts: 0,
      deliveryId: upserted.deliveryId,
    })
    return { status: 'skipped', transport, attempts: 0, deliveryId: upserted.deliveryId }
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
    return { status: 'failed', transport, attempts: 0, deliveryId: upserted.deliveryId }
  }

  // (e) + (f) transport.
  if (transport === 'resend') {
    return deliverViaResend(input, to, rendered, upserted.deliveryId, maxAttempts)
  }
  return deliverViaDevLog(input, to, rendered, upserted.deliveryId)
}

/**
 * Send one transactional email. See the module header for the full
 * contract — the guarantee that matters to call sites: NEVER THROWS.
 */
export async function sendEmail(input: EmailInput, options: SendEmailOptions = {}): Promise<EmailResult> {
  const transport = currentTransport()
  try {
    // Correlation scope: when no HTTP request scope is active (raw
    // handlers, jobs, tests), open a minimal email scope so every log
    // line carries requestId + schoolId. Inside an existing request
    // scope the caller's context is already authoritative and wins
    // (AsyncLocalStorage nesting is intentionally avoided there).
    if (getRequestContext()) {
      return await sendEmailInner(input, options, transport)
    }
    return await runWithContext(
      {
        requestId: input.requestId ?? newRequestId(),
        schoolId: input.schoolId,
        route: 'email',
        operation: `sendEmail:${input.template}`,
      },
      () => sendEmailInner(input, options, transport),
    )
  } catch (e) {
    // Belt-and-braces: the pipeline itself catches everything it can,
    // but the never-throws contract must hold unconditionally.
    log('error', 'email_pipeline_failure', {
      template: input.template,
      transport,
      detail: clip(briefError(e)),
    })
    return { status: 'failed', transport, attempts: 0 }
  }
}

// Convenient re-exports so call sites import from '@/lib/email' only.
export { renderTemplate } from './templates'
export type {
  EmailBranding,
  EmailInput,
  EmailResult,
  EmailTemplateProps,
  EmailTransportStatus,
  RenderedEmail,
  SendEmailOptions,
  TemplateId,
} from './types'
