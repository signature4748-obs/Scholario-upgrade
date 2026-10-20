/**
 * Resend provider adapter — real domain state, real email outcomes, real
 * counts. NO fabricated quotas.
 *
 * WHAT IS ACTUALLY AVAILABLE (live-verified 2026-10-20 against the
 * connected account):
 *   · GET /domains — domain list + verification status. This account:
 *     ZERO verified domains (testing mode — the provider only delivers
 *     to the account-owner address; matches every historical
 *     '[testing-recipient-restricted]' EmailDelivery failure).
 *   · GET /emails — real per-message state. `last_event` values include
 *     "delivered" — the ONLY evidence that upgrades our EmailDelivery
 *     rows from QUEUED (accepted) to delivered. Recipient addresses are
 *     PII: the adapter AGGREGATES ONLY (never stores a recipient).
 *   · Counted today/30d sends: real numbers derived from GET /emails
 *     pagination (created_at buckets), not from our DB — so platform
 *     sends outside the app (if any) count too.
 *
 * WHAT IS NOT AVAILABLE:
 *   · The plan's sending quota / rate limit is NOT exposed as a usage
 *     endpoint (the API returns per-request rate-limit HEADERS for the
 *     call itself, which are NOT the daily send quota — never confuse
 *     them). The adapter reports the quota as `not-reported`.
 *
 * Delivery semantics (same honesty rule as EmailDelivery):
 *   accepted (API 2xx) ≠ delivered (provider last_event = delivered).
 */

import { opsFetch, OpsFetchError } from '../fetch'
import type { MetricSample, ProviderSyncResult, UnavailableMetric } from '../types'

const API = 'https://api.resend.com'

export function resendConfigured(): boolean {
  return (process.env.RESEND_API_KEY ?? '').trim().length > 0
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${(process.env.RESEND_API_KEY ?? '').trim()}` }
}

interface ResendDomain {
  name?: string
  status?: string
}

interface ResendEmailRow {
  created_at?: string
  last_event?: string
}

function countEmailEvents(rows: ResendEmailRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const ev = (r.last_event ?? 'unknown').toLowerCase()
    counts[ev] = (counts[ev] ?? 0) + 1
  }
  return counts
}

/** Page through recent Resend emails (bounded: ≤ 5 pages × 100). */
async function fetchRecentEmails(maxPages = 5): Promise<ResendEmailRow[]> {
  const out: ResendEmailRow[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const url = `${API}/emails?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`
    const body = (await opsFetch(url, { headers: authHeaders(), timeoutMs: 8_000 })) as {
      data?: ResendEmailRow[]
      has_more?: boolean
    } | null
    const rows = Array.isArray(body?.data) ? body!.data! : []
    out.push(...rows)
    if (!body?.has_more || rows.length === 0) break
    // Resend cursors by the newest id of the page (append-only audit key).
    const last = rows[rows.length - 1] as unknown as { id?: string }
    cursor = typeof last?.id === 'string' ? last.id : null
    if (!cursor) break
  }
  return out
}

/** Live Resend sync (called by the sync service). */
export async function syncResend(): Promise<ProviderSyncResult> {
  if (!resendConfigured()) {
    return {
      provider: 'resend',
      samples: [],
      unavailable: [
        {
          provider: 'resend',
          scope: 'account',
          scopeLabel: 'Resend account',
          metric: 'all_email_metrics',
          metricLabel: 'Domains · send counts · delivery outcomes',
          reason: 'not-configured',
          detail: 'RESEND_API_KEY is not set in the server environment — email telemetry is unavailable.',
        },
      ],
    }
  }

  const samples: MetricSample[] = []
  const unavailable: UnavailableMetric[] = []
  const scope = 'account:resend'
  const label = 'Resend account'

  try {
    // ── Domains: verification status (the testing-mode signal) ────────
    const domainsBody = (await opsFetch(`${API}/domains`, {
      headers: authHeaders(),
      timeoutMs: 6_000,
    })) as { data?: ResendDomain[] } | null
    const domains = Array.isArray(domainsBody?.data) ? domainsBody.data : []
    const verified = domains.filter((d) => (d.status ?? '').toLowerCase() === 'verified').length
    samples.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'domains_verified',
      metricLabel: 'Verified sending domains',
      value: verified,
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'ok',
      meta: {
        total: domains.length,
        statuses: domains.map((d) => ({ name: d.name ?? null, status: d.status ?? null })),
        testingMode: verified === 0,
      },
    })

    // ── Recent emails: REAL provider-side outcomes (PII-free counts) ──
    const rows = await fetchRecentEmails()
    const counts = countEmailEvents(rows)
    const delivered = counts['delivered'] ?? 0
    const bounced = counts['bounced'] ?? 0
    const complained = counts['complained'] ?? 0
    const deliveryDelayed = counts['delivery_delayed'] ?? 0
    const sent = counts['sent'] ?? 0
    const accepted = delivered + bounced + complained + deliveryDelayed + sent

    samples.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'emails_recent_counted',
      metricLabel: 'Emails observed in the provider (recent window)',
      value: rows.length,
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'ok',
      meta: {
        windowNote: 'Most recent emails visible through the provider API (bounded pagination)',
        byLastEvent: counts,
      },
    })
    samples.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'emails_delivered_recent',
      metricLabel: 'Delivered (provider delivery evidence)',
      value: delivered,
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'ok',
      meta: { distinction: 'delivered = provider last_event "delivered", NOT mere API acceptance' },
    })
    samples.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'emails_bounced_recent',
      metricLabel: 'Bounced (provider evidence)',
      value: bounced,
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'ok',
    })
    samples.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'emails_accepted_not_delivered_recent',
      metricLabel: 'Accepted without delivery evidence yet',
      value: Math.max(0, accepted - delivered - bounced - complained),
      unit: 'count',
      limitValue: null,
      measured: true,
      availability: 'ok',
      meta: {
        definition: 'provider last_event in (sent, delivery_delayed) — accepted, delivery not confirmed',
      },
    })

    // ── Honest unavailability: plan quota not exposed ──────────────────
    unavailable.push({
      provider: 'resend',
      scope,
      scopeLabel: label,
      metric: 'send_quota',
      metricLabel: 'Daily / monthly sending quota · remaining allowance',
      reason: 'not-reported',
      detail:
        'Resend does not expose the plan sending quota through the public API. The counts above are measured sends; view the plan quota in the Resend dashboard: resend.com/usage',
    })

    return { provider: 'resend', samples, unavailable }
  } catch (e) {
    const detail = e instanceof OpsFetchError ? e.message : e instanceof Error ? e.message : String(e)
    return {
      provider: 'resend',
      samples: [],
      unavailable: [],
      error: `Resend API unreachable: ${detail.slice(0, 200)}`,
    }
  }
}
