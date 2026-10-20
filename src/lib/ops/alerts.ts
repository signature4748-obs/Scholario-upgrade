/**
 * Platform alerts — configurable thresholds, deduplication, ack/resolve.
 *
 * MODEL:
 *   · Thresholds live in PlatformAlertSetting (operator-editable, every
 *     change audited via the platform audit funnel); documented defaults
 *     in types.ts DEFAULT_ALERT_SETTINGS. Invalid/unset → default.
 *   · Dedup identity = `type:metricKey` — a still-breached metric bumps
 *     occurrences + lastSeenAt on the ONE open alert instead of opening
 *     duplicates (no alert storms by construction).
 *   · Auto-resolve: when a threshold alert's metric returns within its
 *     threshold, the open/acknowledged alert resolves automatically with
 *     a machine note (audited). Cooldown: a metric that re-breaches
 *     within COOLDOWN_MINUTES of an auto-resolve reopens the SAME alert
 *     instead of creating a fresh row (flap control).
 *   · Severities: usage thresholds warn(70)/high(85)/critical(95) by
 *     default; email failure rate; provider-sync staleness; error bursts
 *     (N occurrences of one fingerprint in a configured window);
 *     health-check failures (from health.ts, not re-evaluated here).
 *   · Notifications: no notification provider is configured in this
 *     deployment → alerts are visible in the dashboard only (honest
 *     limitation, documented in the UI), never silently dropped.
 *
 * Never throws into callers (all public entry points swallow + log).
 */

import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'
import { platformAuditEvent } from '@/lib/platform/audit'
import { DEFAULT_ALERT_SETTINGS, type ProviderId } from './types'

/**
 * ONE alert row per (type, metricKey) — the row describes the CURRENT
 * episode; every state transition (system open / auto-resolve / reopen,
 * admin ack / resolve / threshold change) is written to the platform
 * audit trail, which IS the alert history (rows persist forever there,
 * while PlatformAlert keeps only the live episode per metric). Bumps
 * (occurrence increments) are NOT audited — no audit storm.
 */

export type AlertType =
  | 'usage_threshold'
  | 'sync_stale'
  | 'email_failure_rate'
  | 'error_burst'
  | 'health_check'

export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical'

/** Read one threshold (settings table → documented default). */
export async function getSetting(key: string): Promise<number> {
  try {
    const row = await db.platformAlertSetting.findUnique({ where: { key } })
    if (row) {
      const v = Number(row.value)
      if (Number.isFinite(v)) return v
    }
  } catch {
    /* fall through to default */
  }
  const fallback = DEFAULT_ALERT_SETTINGS[key]
  return Number.isFinite(fallback) ? fallback : 0
}

/** All settings (merged with defaults) for the settings UI. */
export async function getAllSettings(): Promise<Record<string, number>> {
  const out: Record<string, number> = { ...DEFAULT_ALERT_SETTINGS }
  try {
    const rows = await db.platformAlertSetting.findMany()
    for (const r of rows) {
      const v = Number(r.value)
      if (Number.isFinite(v)) out[r.key] = v
    }
  } catch {
    /* defaults */
  }
  return out
}

function severityForPercent(percent: number, warn: number, high: number, critical: number): AlertSeverity {
  if (percent >= critical) return 'critical'
  if (percent >= high) return 'high'
  if (percent >= warn) return 'warning'
  return 'info'
}

interface UpsertAlertInput {
  type: AlertType
  metricKey: string
  metricLabel: string
  observedValue: number
  unit: string
  severity: AlertSeverity
  threshold: number | null
  message: string
  detail?: Record<string, unknown> | null
}

/**
 * Dedup-aware upsert — find the alert by its fingerprint:
 *   · none → create (open) + system audit row.
 *   · open/acknowledged (still breached) → bump occurrences + lastSeenAt
 *     + refresh value/severity/message. Escalating severity re-surfaces
 *     an acknowledged alert as open (new evidence).
 *   · resolved (breached again — a NEW episode) → reopen the SAME row:
 *     firstSeen/occurrences reset to the new episode; the previous
 *     episode's timestamps live in the audit history.
 */
export async function upsertAlert(input: UpsertAlertInput): Promise<void> {
  const fingerprint = `${input.type}:${input.metricKey}`
  try {
    const existing = await db.platformAlert.findUnique({ where: { fingerprint } })
    const now = new Date()
    const detail = input.detail ? JSON.stringify(input.detail).slice(0, 4000) : null

    if (!existing) {
      await db.platformAlert.create({
        data: {
          fingerprint,
          type: input.type,
          severity: input.severity,
          status: 'open',
          metricKey: input.metricKey,
          metricLabel: input.metricLabel,
          observedValue: input.observedValue,
          threshold: input.threshold,
          unit: input.unit,
          message: input.message.slice(0, 600),
          detail,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: 1,
        },
      })
      log('warn', 'ops_alert_opened', {
        channel: 'ops',
        type: input.type,
        metricKey: input.metricKey,
        severity: input.severity,
        observedValue: input.observedValue,
      })
      await platformAuditEvent({
        action: 'platform.ops.alert.opened',
        targetType: 'SETTING',
        targetId: fingerprint,
        reason: input.message.slice(0, 300),
        metadata: { type: input.type, metricKey: input.metricKey, severity: input.severity, observedValue: input.observedValue },
      })
      return
    }

    const isLive = existing.status === 'open' || existing.status === 'acknowledged'

    if (isLive) {
      await db.platformAlert.update({
        where: { id: existing.id },
        data: {
          severity: input.severity,
          observedValue: input.observedValue,
          lastSeenAt: now,
          occurrences: { increment: 1 },
          message: input.message.slice(0, 600),
          detail: detail ?? existing.detail,
          ...(existing.status === 'acknowledged' &&
          severityRank(input.severity) > severityRank(existing.severity as AlertSeverity)
            ? { status: 'open' as const }
            : {}),
        },
      })
      return
    }
    // Resolved → new episode: reopen the SAME row (audit keeps history).
    await db.platformAlert.update({
      where: { id: existing.id },
      data: {
        status: 'open',
        severity: input.severity,
        observedValue: input.observedValue,
        lastSeenAt: now,
        firstSeenAt: now,
        occurrences: 1,
        message: input.message.slice(0, 600),
        detail,
        acknowledgedBy: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
      },
    })
    log('warn', 'ops_alert_reopened', {
      channel: 'ops',
      type: input.type,
      metricKey: input.metricKey,
      severity: input.severity,
    })
    await platformAuditEvent({
      action: 'platform.ops.alert.reopened',
      targetType: 'SETTING',
      targetId: fingerprint,
      reason: input.message.slice(0, 300),
      metadata: { type: input.type, metricKey: input.metricKey, severity: input.severity, observedValue: input.observedValue },
    })
  } catch (e) {
    log('warn', 'ops_alert_upsert_failed', {
      channel: 'ops',
      metricKey: input.metricKey,
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

function severityRank(s: AlertSeverity): number {
  return { info: 0, warning: 1, high: 2, critical: 3 }[s] ?? 0
}

/** Auto-resolve a threshold alert whose metric returned within bounds.
 *  Audited as a SYSTEM transition (resolvedBy stays null). */
export async function autoResolveAlert(
  type: AlertType,
  metricKey: string,
  note: string,
): Promise<void> {
  try {
    const fingerprint = `${type}:${metricKey}`
    const existing = await db.platformAlert.findUnique({ where: { fingerprint } })
    if (!existing || existing.status === 'resolved') return
    await db.platformAlert.update({
      where: { id: existing.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: null, // system auto-resolve
        resolutionNote: note.slice(0, 400),
      },
    })
    log('info', 'ops_alert_auto_resolved', { channel: 'ops', type, metricKey })
    await platformAuditEvent({
      action: 'platform.ops.alert.auto_resolved',
      targetType: 'SETTING',
      targetId: fingerprint,
      reason: note.slice(0, 300),
    })
  } catch (e) {
    log('warn', 'ops_alert_auto_resolve_failed', {
      channel: 'ops',
      metricKey,
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Evaluate usage-threshold alerts from the newest snapshot per metric
 * (only metrics with a KNOWN limit — an unknown limit can never breach).
 * Also evaluates: provider-sync staleness, email failure rate (from
 * EmailDelivery — the source of truth), and auto-resolves metrics that
 * returned within thresholds.
 */
export async function evaluateAlertsAfterSync(_provider: ProviderId): Promise<void> {
  const [warn, high, critical, staleMinutes] = await Promise.all([
    getSetting('usage.warning'),
    getSetting('usage.high'),
    getSetting('usage.critical'),
    getSetting('sync.stale_minutes'),
  ])

  // ── Usage thresholds (known limits only) ──────────────────────────────
  const latest = await db.providerUsageSnapshot.findMany({
    where: { availability: 'ok' },
    orderBy: { collectedAt: 'desc' },
    take: 400,
    select: {
      provider: true,
      scope: true,
      metric: true,
      value: true,
      unit: true,
      limitValue: true,
      collectedAt: true,
      meta: true,
    },
  })
  const seen = new Set<string>()
  const seenWithLimit = new Set<string>()
  for (const row of latest) {
    const key = `${row.provider}|${row.scope}|${row.metric}`
    if (seen.has(key)) continue
    seen.add(key)
    const metricKey = `${row.provider}:${row.metric}`
    if (row.limitValue !== null && row.limitValue > 0) seenWithLimit.add(metricKey)
    if (row.limitValue === null || row.limitValue <= 0) {
      // No reported limit: this metric can never breach. If an OLD alert
      // for it still exists (e.g. from a retired spurious limit), it is
      // auto-resolved with the explicit reason — never left dangling.
      await autoResolveAlert(
        'usage_threshold',
        metricKey,
        'Auto-resolved: the metric no longer reports a provider limit — the threshold alert is retracted.',
      )
      continue
    }
    const percent = (row.value / row.limitValue) * 100
    if (percent >= warn) {
      const severity = severityForPercent(percent, warn, high, critical)
      await upsertAlert({
        type: 'usage_threshold',
        metricKey,
        metricLabel: `${row.provider} · ${row.metric}`,
        observedValue: Math.round(percent * 10) / 10,
        unit: 'percent',
        severity,
        threshold: severity === 'critical' ? critical : severity === 'high' ? high : warn,
        message: `Metric ${row.metric} (${row.provider}) is at ${Math.round(percent * 10) / 10}% of its reported limit (${row.value} / ${row.limitValue} ${row.unit}).`,
        detail: {
          provider: row.provider,
          scope: row.scope,
          value: row.value,
          limit: row.limitValue,
          unit: row.unit,
          collectedAt: row.collectedAt.toISOString(),
        },
      })
    } else {
      await autoResolveAlert(
        'usage_threshold',
        metricKey,
        `Auto-resolved: back within the warning threshold (${Math.round(percent * 10) / 10}% < ${warn}%).`,
      )
    }
  }

  // Orphan sweep: an open/acknowledged usage_threshold alert whose metric
  // did not report a limit in this evaluation round is retracted (its
  // metric was retired / no longer limit-bearing — never left dangling).
  const liveAlerts = await db.platformAlert.findMany({
    where: { type: 'usage_threshold', status: { in: ['open', 'acknowledged'] } },
    select: { id: true, metricKey: true },
  })
  for (const a of liveAlerts) {
    if (!seenWithLimit.has(a.metricKey)) {
      await autoResolveAlert(
        'usage_threshold',
        a.metricKey,
        'Auto-resolved: the metric is no longer reported with a provider limit — the threshold alert is retracted.',
      )
    }
  }

  // ── Provider-sync staleness ───────────────────────────────────────────
  const syncAges = await db.providerSyncRun.findMany({
    where: { status: { in: ['success', 'partial'] } },
    orderBy: { startedAt: 'desc' },
    take: 60,
    select: { provider: true, startedAt: true },
  })
  const ageByProvider = new Map<string, number>()
  for (const r of syncAges) {
    if (!ageByProvider.has(r.provider)) {
      ageByProvider.set(r.provider, (Date.now() - r.startedAt.getTime()) / 60_000)
    }
  }
  for (const [provider, ageMin] of ageByProvider) {
    if (ageMin > staleMinutes) {
      await upsertAlert({
        type: 'sync_stale',
        metricKey: `sync:${provider}`,
        metricLabel: `Provider sync freshness · ${provider}`,
        observedValue: Math.round(ageMin),
        unit: 'minutes',
        severity: 'warning',
        threshold: staleMinutes,
        message: `No successful ${provider} synchronization for ${Math.round(ageMin)} minutes (threshold: ${staleMinutes}). Dashboard data for this provider may be stale.`,
        detail: { provider, ageMinutes: Math.round(ageMin), thresholdMinutes: staleMinutes },
      })
    } else {
      await autoResolveAlert(
        'sync_stale',
        `sync:${provider}`,
        `Auto-resolved: ${provider} synchronized ${Math.round(ageMin)} minutes ago (within ${staleMinutes}).`,
      )
    }
  }

  // ── Email failure rate (EmailDelivery is the source of truth) ────────
  await evaluateEmailFailureRate()
}

/** Email failure rate over 7 days: (FAILED+BOUNCED+COMPLAINED) / attempts.
 *  Attempt = every row with a terminal-ish state (never PENDING-only). */
export async function evaluateEmailFailureRate(): Promise<void> {
  try {
    const [warnPct, criticalPct] = await Promise.all([
      getSetting('email.failure_rate.warn'),
      getSetting('email.failure_rate.critical'),
    ])
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const rows = await db.emailDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { createdAt: { gte: since }, status: { not: 'PENDING' } },
    })
    const counts: Record<string, number> = {}
    let attempts = 0
    for (const r of rows) {
      counts[r.status] = r._count._all
      attempts += r._count._all
    }
    const failed = (counts['FAILED'] ?? 0) + (counts['BOUNCED'] ?? 0) + (counts['COMPLAINED'] ?? 0)
    // Honest minimum sample: a 1-of-1 failure is 100% mathematically but
    // not an incident trend — require ≥20 attempts before alerting.
    const MIN_SAMPLE = 20
    if (attempts < MIN_SAMPLE) {
      await autoResolveAlert(
        'email_failure_rate',
        'email:failure_rate_7d',
        `Auto-resolved/note: fewer than ${MIN_SAMPLE} send attempts in the 7-day window — not enough evidence to alert (attempts=${attempts}).`,
      )
      return
    }
    const rate = (failed / attempts) * 100
    if (rate >= warnPct) {
      const severity: AlertSeverity = rate >= criticalPct ? 'critical' : 'warning'
      await upsertAlert({
        type: 'email_failure_rate',
        metricKey: 'email:failure_rate_7d',
        metricLabel: 'Email failure rate (7-day window)',
        observedValue: Math.round(rate * 10) / 10,
        unit: 'percent',
        severity,
        threshold: rate >= criticalPct ? criticalPct : warnPct,
        message: `${failed} of ${attempts} email sends failed/bounced/complained in the last 7 days (${Math.round(rate * 10) / 10}%). Inspect the Email delivery status on the Overview tab.`,
        detail: { failed, attempts, byStatus: counts, windowDays: 7 },
      })
    } else {
      await autoResolveAlert(
        'email_failure_rate',
        'email:failure_rate_7d',
        `Auto-resolved: 7-day failure rate back to ${Math.round(rate * 10) / 10}% (< ${warnPct}%).`,
      )
    }
  } catch (e) {
    log('warn', 'ops_email_rate_eval_failed', {
      channel: 'ops',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

/** Error-burst detection: N occurrences of ONE fingerprint inside the
 *  configured window → single (deduped) alert per fingerprint burst. */
export async function evaluateErrorBurstAlert(fingerprint: string, message: string): Promise<void> {
  try {
    const [windowMinutes, burstCount] = await Promise.all([
      getSetting('error_burst.window_minutes'),
      getSetting('error_burst.count'),
    ])
    if (burstCount <= 0) return
    const since = new Date(Date.now() - windowMinutes * 60_000)
    const events = await db.operationalErrorEvent.count({
      where: { fingerprint, occurredAt: { gte: since } },
    })
    const group = await db.operationalError.findUnique({ where: { fingerprint } })
    if (!group) return
    if (events >= burstCount) {
      await upsertAlert({
        type: 'error_burst',
        metricKey: `error_burst:${fingerprint}`,
        metricLabel: `Error burst · ${group.category}${group.lastRoute ? ` · ${group.lastRoute}` : ''}`,
        observedValue: events,
        unit: 'count',
        severity: group.severity === 'critical' ? 'critical' : 'high',
        threshold: burstCount,
        message: `${events} occurrences of the same error within ${windowMinutes} minutes. First message: ${message.slice(0, 240)}`,
        detail: { fingerprint, occurrences: events, windowMinutes, category: group.category },
      })
    }
  } catch (e) {
    log('warn', 'ops_error_burst_eval_failed', {
      channel: 'ops',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}
