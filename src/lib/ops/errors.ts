/**
 * Operational error capture — fingerprints, groups, occurrence events.
 *
 * THE DESIGN (mirrors how Sentry-style grouping works, adapted to the
 * platform plane's conventions):
 *   · Every recorded failure is sanitized (redactDetail) and normalized;
 *     a STABLE fingerprint (sha1 of category + statusCode + route +
 *     normalized message) groups repeated occurrences of the same defect
 *     into ONE OperationalError row with an occurrence counter.
 *   · The first ~50 occurrences per group also write an
 *     OperationalErrorEvent row (occurrence history for the drill-down);
 *     beyond that only the group counter increments (bounded storage).
 *   · Capture NEVER throws — observability must not become a new
 *     failure mode (same contract as auditEvent/runJob).
 *   · PII/credential policy: messages pass through redactDetail; route is
 *     the path shape (no query strings — ids in paths are replaced with
 *     a normalized shape so /api/students/123 → /api/students/{id}).
 *
 * WHERE ERRORS FLOW IN (see coverage.ts for the full map):
 *   · The api() envelope catch (src/lib/api.ts) — every API failure
 *     already funnels through classifyError; we record the classes that
 *     are operationally meaningful (5xx server errors, TENANT_MISMATCH
 *     cross-tenant denials, EXTERNAL_SERVICE_FAILURE) — NOT benign 401/
 *     404/429 noise, which would drown the signal.
 *   · Provider sync failures (sync.ts).
 *   · Health check failures (health.ts).
 *   · Email pipeline infra failures (transient/provider API bursts — the
 *     per-message failure FACES live in EmailDelivery and are aggregated
 *     as metrics, not duplicated as error groups).
 */

import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { redactDetail } from '@/lib/observability/redact'
import { log } from '@/lib/observability/logger'

export type ErrorCategory = 'http' | 'email' | 'provider_sync' | 'health' | 'webhook' | 'auth' | 'usage_metering'
export type ErrorSeverity = 'warning' | 'error' | 'critical'

export interface RecordErrorInput {
  category: ErrorCategory
  severity: ErrorSeverity
  /** Error object or raw message — sanitized before storage. */
  error?: unknown
  message?: string
  route?: string | null
  method?: string | null
  statusCode?: number | null
  provider?: string | null
  schoolId?: string | null
  deploymentId?: string | null
  requestId?: string | null
  /** Server-declared environment — NEVER trusted from clients. */
  env?: 'production' | 'preview' | 'development'
}

/** Normalize a path for grouping: ids/dates → {id}/{date} so the same
 *  failing handler on different ids groups together. */
export function normalizeRouteShape(route: string | null | undefined): string | null {
  if (!route) return null
  const r = route.split('?')[0]
  return (
    r
      // UUIDs / cuids
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}')
      .replace(/\b[a-z0-9]{20,30}\b/gi, '{id}')
      // numeric path segments
      .replace(/\/\d+(?=\/|$)/g, '/{id}')
      .slice(0, 160) || null
  )
}

/** Normalize a message for the fingerprint: numbers/uuids/durations → #,
 *  so "P2028 took 5001ms" and "P2028 took 5002ms" group together (the
 *  digit run INSIDE a word like 5001ms normalizes too — timing jitter
 *  must never split a group). */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '#id')
    .replace(/\d[\d.,]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .toLowerCase()
}

/** Stable fingerprint for an error class (exported for unit tests). */
export function errorFingerprint(input: {
  category: string
  statusCode?: number | null
  route?: string | null
  provider?: string | null
  message: string
}): string {
  const parts = [
    input.category,
    String(input.statusCode ?? ''),
    normalizeRouteShape(input.route) ?? '',
    input.provider ?? '',
    normalizeMessage(input.message),
  ]
  return createHash('sha1').update(parts.join('¦')).digest('hex')
}

/** Max occurrence EVENT rows per group (bounded storage; counters keep
 *  counting beyond this). */
const MAX_EVENTS_PER_GROUP = 50

/** Sanitized message extraction (never stores stacks/paths/credentials). */
export function sanitizeErrorMessage(error: unknown, fallbackMessage?: string): string {
  let raw: string
  if (error instanceof Error) {
    raw = `${error.name}: ${error.message}`
  } else if (typeof error === 'string') {
    raw = error
  } else if (error !== null && error !== undefined) {
    try {
      raw = JSON.stringify(error)
    } catch {
      raw = String(error)
    }
  } else {
    raw = fallbackMessage ?? 'unknown error'
  }
  return redactDetail(raw, 600)
}

/**
 * Record one operational error occurrence. NEVER throws; failures are
 * logged (channel ops) and swallowed — a monitoring write must not fail
 * the monitored request.
 */
export async function recordOperationalError(input: RecordErrorInput): Promise<void> {
  try {
    const message = sanitizeErrorMessage(input.error, input.message)
    if (!message) return
    const route = normalizeRouteShape(input.route)
    const env: string = input.env ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development')
    const fingerprint = errorFingerprint({
      category: input.category,
      statusCode: input.statusCode ?? null,
      route,
      provider: input.provider ?? null,
      message,
    })

    // Group upsert (atomic counter increment on conflict).
    const existing = await db.operationalError.findUnique({
      where: { fingerprint },
      select: { id: true, occurrences: true, status: true },
    })

    if (!existing) {
      await db.operationalError.create({
        data: {
          fingerprint,
          category: input.category,
          severity: input.severity,
          status: 'open',
          env,
          message,
          lastRoute: route,
          lastMethod: input.method?.slice(0, 10) ?? null,
          lastStatusCode: input.statusCode ?? null,
          provider: input.provider ?? null,
          schoolId: input.schoolId ?? null,
          deploymentId: input.deploymentId ?? null,
          requestId: input.requestId ?? null,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          occurrences: 1,
        },
      })
    } else {
      await db.operationalError.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: new Date(),
          message,
          lastRoute: route,
          lastMethod: input.method?.slice(0, 10) ?? null,
          lastStatusCode: input.statusCode ?? null,
          requestId: input.requestId ?? null,
          // A resolved/acknowledged group that RECURS reopens and clears
          // the previous terminal-state fields (the prior transition
          // stays in the platform audit log).
          ...(existing.status !== 'open'
            ? {
                status: 'open' as const,
                acknowledgedBy: null,
                acknowledgedAt: null,
                resolvedBy: null,
                resolvedAt: null,
                resolutionNote: null,
              }
            : {}),
        },
      })
    }

    // Occurrence event (bounded per group).
    if (!existing || existing.occurrences < MAX_EVENTS_PER_GROUP) {
      await db.operationalErrorEvent.create({
        data: {
          fingerprint,
          occurredAt: new Date(),
          requestId: input.requestId?.slice(0, 64) ?? null,
          route,
          statusCode: input.statusCode ?? null,
          deploymentId: input.deploymentId?.slice(0, 64) ?? null,
          schoolId: input.schoolId ?? null,
          brief: message.slice(0, 200),
        },
      })
    }

    // Error-burst alert evaluation (configured window/count per fingerprint).
    const { evaluateErrorBurstAlert } = await import('./alerts')
    await evaluateErrorBurstAlert(fingerprint, message).catch(() => null)
  } catch (e) {
    log('warn', 'ops_error_capture_failed', {
      channel: 'ops',
      category: input.category,
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}
