// ============================================================
// EMAIL DIAGNOSTICS (secret-safe)
// ------------------------------------------------------------
// Phase A: the operator-facing answer to "why are emails not
// arriving?" without ever exposing a credential. Everything here is
// booleans, counts, masked addresses and error CLASSES:
//
//   · which provider is active and why (explicit/auto, config state)
//   · Resend: key present? webhook secret present? sender address?
//     (optionally LIVE read-only provider queries — GET /domains
//     verified-domain count, so "testing mode / no domains" is visible
//     in-app, AND GET /webhooks: the registered endpoints with their
//     URLs + subscribed events, so "webhook missing/disabled/stale"
//     answers "why do delivered emails stay QUEUED" in-app)
//   · Gmail SMTP: creds present? masked account address?
//   · outbox: status counts (last 7 days) + the latest failure's
//     parsed error class — the 403 testing-restriction shows up as
//     'testing-recipient-restricted', not a wall of JSON
//
// NEVER returned: API keys, app passwords, webhook signing secrets,
// full recipient addresses of failures are kept (recipient is PII but
// the admin console already shows email audit rows elsewhere; here we
// include template + class + time only).
// ============================================================

import { db } from '@/lib/db'
import { gmailSmtpConfig, maskEmail } from './providers/gmail-smtp'
import { parseErrorClass } from './provider-errors'
import { resolveProvider } from './index'
import type { EmailProviderId } from './types'

const RESEND_DOMAINS_ENDPOINT = 'https://api.resend.com/domains'
const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_WEBHOOKS_ENDPOINT = 'https://api.resend.com/webhooks'
const LIVE_CHECK_TIMEOUT_MS = 4_000

export interface ResendDomainSummary {
  liveCheck: 'ok' | 'failed' | 'skipped'
  total: number | null
  verified: number | null
}

/** One registered provider webhook endpoint (field-allowlisted —
 * id/url/status/events ONLY; `status` is the provider's documented
 * 'enabled'/'disabled' enum, the live answer to "is the endpoint
 * ENABLED?" — never a secret-bearing field). */
export interface ResendWebhookEndpoint {
  id: string
  url: string
  /** Provider enablement enum ('enabled'/'disabled'); '' when the
   * provider response does not carry it. */
  status: string
  events: string[]
}

export interface ResendWebhookSummary {
  liveCheck: 'ok' | 'failed' | 'skipped'
  total: number | null
  /** Empty array with liveCheck 'ok' = ZERO endpoints registered (the
   * delivered-mail-stays-QUEUED root cause, visible in-app). */
  endpoints: ResendWebhookEndpoint[]
}

export interface EmailDiagnostics {
  provider: {
    id: EmailProviderId
    selection: 'explicit' | 'auto'
    configured: boolean
    configError?: string
    /** Env var that pins the provider, when set. */
    emailProviderEnv: string
  }
  resend: {
    apiKeyPresent: boolean
    fromAddress: string
    webhookSecretPresent: boolean
    domains: ResendDomainSummary
    webhooks: ResendWebhookSummary
    /** Present only when a ?message=<providerMessageId> probe was
     * requested: the live per-message delivery state. */
    message?: ResendMessageState
  }
  gmailSmtp: {
    userPresent: boolean
    maskedUser?: string
    appPasswordPresent: boolean
  }
  outbox: {
    last7d: Record<string, number>
    lastFailure?: {
      template: string
      errorClass: string
      lastError: string
      failedAt: string
    }
  }
  generatedAt: string
}

/** Live, read-only Resend domain check (GET /domains, 4s timeout). */
async function fetchResendDomainSummary(apiKey: string): Promise<ResendDomainSummary> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(RESEND_DOMAINS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return { liveCheck: 'failed', total: null, verified: null }
    const body = (await res.json().catch(() => null)) as { data?: Array<{ status?: string }> } | null
    const domains = Array.isArray(body?.data) ? body.data : []
    const verified = domains.filter((d) => (d.status ?? '').toLowerCase() === 'verified').length
    return { liveCheck: 'ok', total: domains.length, verified }
  } catch {
    return { liveCheck: 'failed', total: null, verified: null }
  } finally {
    clearTimeout(timer)
  }
}

/** Live, read-only Resend webhook endpoint list (GET /webhooks, 4s timeout).
 * STRICT FIELD ALLOWLIST: id + url + status + events only — anything else
 * the provider returns (in particular any secret-bearing field) is dropped
 * before this function returns. Exported for the allowlist unit test. */
export async function fetchResendWebhookSummary(apiKey: string): Promise<ResendWebhookSummary> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(RESEND_WEBHOOKS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return { liveCheck: 'failed', total: null, endpoints: [] }
    const body = (await res.json().catch(() => null)) as { data?: Array<Record<string, unknown>> } | null
    const list = Array.isArray(body?.data) ? body.data : []
    const endpoints: ResendWebhookEndpoint[] = []
    for (const w of list) {
      const id = typeof w.id === 'string' ? w.id : ''
      // The provider's GET URL field is NOT `url` (live-verified
      // 2026-10-22; the documented GET shape is `endpoint`). Accept every
      // observed shape: `endpointUrl`, `endpoint`, or `url`; the
      // ALLOWLIST stays id + url + status + events.
      const url =
        typeof w.endpointUrl === 'string' ? w.endpointUrl
          : typeof w.endpoint === 'string' ? w.endpoint
            : typeof w.url === 'string' ? w.url
              : ''
      // Documented per-item enum 'enabled'/'disabled' — the live
      // "is the webhook actually enabled?" answer (a registered but
      // disabled endpoint is precisely the delivered-mail-stays-QUEUED
      // posture this diagnostics surface exists to expose).
      const status = typeof w.status === 'string' ? w.status : ''
      const events = Array.isArray(w.events) ? w.events.filter((e): e is string => typeof e === 'string') : []
      if (id || url) endpoints.push({ id, url, status, events })
    }
    return { liveCheck: 'ok', total: list.length, endpoints }
  } catch {
    return { liveCheck: 'failed', total: null, endpoints: [] }
  } finally {
    clearTimeout(timer)
  }
}

/** One provider message's live delivery state (STRICT FIELD ALLOWLIST —
 * id/last_event/status/created_at only; subject, body and recipients are
 * provider PII the diagnostics surface never carries). */
export interface ResendMessageState {
  liveCheck: 'ok' | 'failed' | 'skipped'
  id: string | null
  lastEvent: string | null
  status: string | null
  createdAt: string | null
}

/**
 * Live, read-only Resend GET /emails/{id} (4s timeout) — the
 * per-message delivery answer ("did the provider actually deliver THIS
 * message?") with the runtime provider key. The allowlisted fields only:
 * subject/body/recipients never leave this module.
 */
export async function fetchResendMessageState(apiKey: string, messageId: string): Promise<ResendMessageState> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(`${RESEND_EMAILS_ENDPOINT}/${encodeURIComponent(messageId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return { liveCheck: 'failed', id: null, lastEvent: null, status: null, createdAt: null }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const pick = (k: string): string | null => {
      const v = body?.[k]
      return typeof v === 'string' ? v : null
    }
    return {
      liveCheck: 'ok',
      id: pick('id'),
      lastEvent: pick('last_event'),
      status: pick('status'),
      createdAt: pick('created_at'),
    }
  } catch {
    return { liveCheck: 'failed', id: null, lastEvent: null, status: null, createdAt: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Secret-safe email diagnostics. `liveProviderCheck` performs a
 * read-only authenticated GET /domains against Resend (only when the
 * key is present) so "no verified domains → testing mode" is visible
 * in the admin console. Never sends email, never returns secrets.
 */
export async function getEmailDiagnostics(liveProviderCheck = false, messageProbe?: string): Promise<EmailDiagnostics> {
  const provider = resolveProvider()
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
  const gmail = gmailSmtpConfig()

  const domains: ResendDomainSummary = liveProviderCheck
    ? apiKey
      ? await fetchResendDomainSummary(apiKey)
      : { liveCheck: 'skipped', total: null, verified: null }
    : { liveCheck: 'skipped', total: null, verified: null }
  const webhooks: ResendWebhookSummary = liveProviderCheck
    ? apiKey
      ? await fetchResendWebhookSummary(apiKey)
      : { liveCheck: 'skipped', total: null, endpoints: [] }
    : { liveCheck: 'skipped', total: null, endpoints: [] }
  // Optional per-message delivery probe (?message=<providerMessageId>):
  // runs whenever a message id is requested and the key is present —
  // independent of the live flag (a targeted question, not a sweep).
  const message: ResendMessageState | undefined =
    messageProbe && apiKey
      ? await fetchResendMessageState(apiKey, messageProbe)
      : messageProbe
        ? { liveCheck: 'skipped', id: null, lastEvent: null, status: null, createdAt: null }
        : undefined

  // Outbox status counts (7-day window) + the latest failure with its
  // parsed error class.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  let last7d: Record<string, number> = {}
  let lastFailure: EmailDiagnostics['outbox']['lastFailure']
  try {
    const rows = await db.emailDelivery.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, template: true, lastError: true, updatedAt: true },
    })
    for (const row of rows) {
      last7d[row.status] = (last7d[row.status] ?? 0) + 1
    }
    const failure = await db.emailDelivery.findFirst({
      where: { status: { in: ['FAILED', 'BOUNCED', 'COMPLAINED'] } },
      orderBy: { updatedAt: 'desc' },
      select: { template: true, lastError: true, updatedAt: true },
    })
    if (failure) {
      lastFailure = {
        template: failure.template,
        errorClass: parseErrorClass(failure.lastError) ?? 'unclassified',
        lastError: (failure.lastError ?? '').slice(0, 300),
        failedAt: failure.updatedAt.toISOString(),
      }
    }
  } catch {
    // DB unavailable — the rest of the diagnostics still matters.
    last7d = { error: -1 }
  }

  return {
    provider: {
      id: provider.id,
      selection: provider.selection,
      configured: provider.configured,
      configError: provider.configError,
      emailProviderEnv: (process.env.EMAIL_PROVIDER ?? '').trim(),
    },
    resend: {
      apiKeyPresent: apiKey.length > 0,
      fromAddress: (process.env.EMAIL_FROM ?? '').trim() || 'Scholario <onboarding@resend.dev>',
      webhookSecretPresent: (process.env.RESEND_WEBHOOK_SECRET ?? '').trim().length > 0,
      domains,
      webhooks,
      ...(message !== undefined ? { message } : {}),
    },
    gmailSmtp: {
      userPresent: gmail.user !== null,
      maskedUser: gmail.user ? maskEmail(gmail.user) : undefined,
      appPasswordPresent: gmail.appPassword !== null,
    },
    outbox: { last7d, lastFailure },
    generatedAt: new Date().toISOString(),
  }
}
