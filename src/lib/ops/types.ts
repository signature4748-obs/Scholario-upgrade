/**
 * PLATFORM OPERATIONS CENTER — shared types (2026-10).
 *
 * The normalized provider-metric model every adapter produces and the
 * sync service persists. Honesty contract encoded in the types:
 *   · `limitValue: null` means the provider does NOT report a limit —
 *     NEVER 0 (a missing limit is not a zero quota).
 *   · `availability: 'unavailable'` rows exist so the dashboard can show
 *     WHY a metric is missing (plan-restricted, endpoint gone, key
 *     missing) instead of an absence that reads as zero/healthy.
 *   · `measured: false` rows are operator estimates and ALWAYS render
 *     with an "estimate" label — never mixed into measured provider data.
 */

export type ProviderId = 'vercel' | 'supabase' | 'resend'

/** One metric sample produced by an adapter. */
export interface MetricSample {
  provider: ProviderId
  /** 'project:<id>' | 'account:<owner>' | 'database:<ref>' … */
  scope: string
  /** Human-readable scope label for the UI (project name, account). */
  scopeLabel: string
  metric: string
  metricLabel: string
  value: number
  unit: 'bytes' | 'count' | 'requests' | 'ms' | 'percent' | 'services'
  /** NULL = limit not reported by the provider API/plan. */
  limitValue: number | null
  measured: boolean
  periodStart?: Date | null
  periodEnd?: Date | null
  availability: 'ok' | 'unavailable'
  /** Sanitized JSON detail (never credentials, never PII). */
  meta?: Record<string, unknown> | null
}

/** A metric the provider/plan does NOT expose — persisted honestly. */
export interface UnavailableMetric {
  provider: ProviderId
  scope: string
  scopeLabel: string
  metric: string
  metricLabel: string
  /** Machine-readable reason class. */
  reason: 'plan-restricted' | 'endpoint-unavailable' | 'not-configured' | 'not-reported'
  /** Sanitized human explanation shown in the UI. */
  detail: string
}

export interface ProviderSyncResult {
  provider: ProviderId
  samples: MetricSample[]
  unavailable: UnavailableMetric[]
  /** Deployment-level facts (Vercel adapter) — real data for the
   *  Overview's "latest successful/failed deployment" cards. */
  deployments?: ProviderDeploymentSummary[]
  error?: string
}

export interface ProviderDeploymentSummary {
  provider: ProviderId
  projectId: string
  projectName: string
  deploymentId: string
  /** READY | ERROR | CANCELED | BUILDING | QUEUED | INITIALIZING
   *  (Vercel state vocabulary, uppercased). */
  state: string
  createdAt: string | null
  commitSha: string | null
  commitMessage: string | null
  url: string | null
}

/** Result shape the dashboard APIs consume (read from the DB, plus the
 *  freshness/limit math applied server-side so the UI never guesses). */
export interface MetricView {
  provider: string
  scope: string
  scopeLabel: string
  metric: string
  metricLabel: string
  value: number
  unit: string
  limitValue: number | null
  measured: boolean
  availability: 'ok' | 'unavailable'
  periodStart: string | null
  periodEnd: string | null
  collectedAt: string
  meta: Record<string, unknown> | null
  /** Computed server-side: consumed % of the limit; null when the limit
   *  is unknown (never fabricated). */
  percentConsumed: number | null
  remaining: number | null
  /** Age-based staleness computed at read time (never cached itself). */
  stale: boolean
}

/** Health check contract (src/lib/ops/health.ts). */
export type CheckStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'not_configured'
export type CheckSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface HealthCheckResult {
  checkKey: string
  checkLabel: string
  status: CheckStatus
  severity: CheckSeverity
  latencyMs: number | null
  /** Sanitized summary + next-step guidance. */
  detail: string
  /** UI grouping: 'liveness' | 'readiness' | 'dependency'. */
  kind: 'liveness' | 'readiness' | 'dependency'
  /** Drill-down hint (existing surface to open when the check fails). */
  drilldownHint?: string
}

/** Default alert thresholds (PlatformAlertSetting overrides at runtime). */
export const DEFAULT_ALERT_SETTINGS: Record<string, number> = {
  'usage.warning': 70, // % consumed → warning alert
  'usage.high': 85, // % consumed → high alert
  'usage.critical': 95, // % consumed → critical alert
  'email.failure_rate.warn': 10, // % of attempted sends failing (7d) → warning
  'email.failure_rate.critical': 30, // … critical
  'sync.stale_minutes': 90, // provider sync older than → warning
  'error_burst.window_minutes': 15, // burst window
  'error_burst.count': 10, // occurrences of one fingerprint in window → alert
  'db_size.warning_bytes': 400 * 1024 * 1024, // operator-configured capacity
  // expectation for the Supabase DB (an ESTIMATE, labeled as such — the
  // provider does not expose the plan quota via API).
}

export type AlertTransition = 'open' | 'acknowledged' | 'resolved'
