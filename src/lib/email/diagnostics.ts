// ============================================================
// EMAIL DIAGNOSTICS (secret-safe)
// ------------------------------------------------------------
// Phase A: the operator-facing answer to "why are emails not
// arriving?" without ever exposing a credential. Everything here is
// booleans, counts, masked addresses and error CLASSES:
//
//   · which provider is active and why (explicit/auto, config state)
//   · Resend: key present? webhook secret present? sender address?
//     (optionally a LIVE read-only GET /domains — verified-domain
//     count, so "testing mode / no domains" is visible in-app)
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
const LIVE_CHECK_TIMEOUT_MS = 4_000

export interface ResendDomainSummary {
  liveCheck: 'ok' | 'failed' | 'skipped'
  total: number | null
  verified: number | null
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

/**
 * Secret-safe email diagnostics. `liveProviderCheck` performs a
 * read-only authenticated GET /domains against Resend (only when the
 * key is present) so "no verified domains → testing mode" is visible
 * in the admin console. Never sends email, never returns secrets.
 */
export async function getEmailDiagnostics(liveProviderCheck = false): Promise<EmailDiagnostics> {
  const provider = resolveProvider()
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
  const gmail = gmailSmtpConfig()

  const domains: ResendDomainSummary = liveProviderCheck
    ? apiKey
      ? await fetchResendDomainSummary(apiKey)
      : { liveCheck: 'skipped', total: null, verified: null }
    : { liveCheck: 'skipped', total: null, verified: null }

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
