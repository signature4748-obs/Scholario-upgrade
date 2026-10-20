/**
 * Monitoring-coverage report — the honest map of WHICH critical paths are
 * instrumented, partially instrumented or not instrumented, with the
 * mechanism for each (so "covered" always means something specific).
 *
 * The single biggest structural fact: EVERY API route handler in this
 * codebase is wrapped by the api() envelope (src/lib/api.ts) — directly
 * or via withUser / withPlatform — so all of the following are
 * centralized, not per-route:
 *   · one structured http_request log line per request (status, duration,
 *     route, requestId, schoolId/userId),
 *   · a safe error envelope with a canonical code taxonomy,
 *   · (NEW, operations center) operational-error capture for the
 *     operationally meaningful classes: 5xx server errors,
 *     TENANT_MISMATCH cross-tenant denials, EXTERNAL_SERVICE_FAILURE.
 * Benign 4xx (401 challenges, 404s, 429 rate-limit responses) are
 * intentionally NOT recorded as incidents — they are normal security
 * surface, and recording them would bury real failures (the API still
 * logs them as http_request lines and the audit trail records auth
 * events).
 */

export type CoverageState = 'instrumented' | 'partial' | 'not-instrumented'

export interface CoverageEntry {
  path: string
  state: CoverageState
  mechanism: string
  gap?: string
}

export const MONITORING_COVERAGE: CoverageEntry[] = [
  {
    path: 'Authentication & session management (school: /api/auth/*, session cookies)',
    state: 'instrumented',
    mechanism:
      'api() envelope (5xx capture) + auditEvent LOGIN_SUCCESS/LOGIN_FAILED/LOGIN_LOCKED → ActivityLog (aggregated into School Usage) + rate-limit audit + auth-failure client model',
  },
  {
    path: 'Root-admin authorization (platform: /api/platform/* withPlatform)',
    state: 'instrumented',
    mechanism:
      'withPlatform → api() envelope (5xx + FORBIDDEN structured logs) + PlatformAuditLog for every gated action + platform.login.failed counts (Overview security signal)',
  },
  {
    path: 'School creation & provisioning (Add School wizard, /api/platform/schools)',
    state: 'instrumented',
    mechanism: 'api() envelope 5xx capture + platform audit actions (platform.school.provisioned/…) + JobRun for provision jobs',
  },
  {
    path: 'School website & login setup (tenant domains, website CMS APIs)',
    state: 'instrumented',
    mechanism: 'api() envelope + auditEvent on website mutations',
  },
  {
    path: 'Subscription operations (tenant subscription, plans, entitlement, payments)',
    state: 'instrumented',
    mechanism: 'api() envelope + platform audit (plan changes) + WebhookEvent idempotency rows + trackedTransaction diagnostics',
  },
  {
    path: 'Principal / Teacher / Student API boundaries (withUser role + tenant gates)',
    state: 'instrumented',
    mechanism:
      'withUser (role gate + schoolScoped tenant gate) → api() envelope; NEW: TENANT_MISMATCH denials recorded as operational errors (AUTHZ-1 diagnosis rule)',
  },
  {
    path: 'Database queries & mutations (all Prisma access)',
    state: 'instrumented',
    mechanism:
      'db client event hooks: db_slow_query, db_query_error, db_transaction_failure + withDbRetry transient-retry lines; NEW: DATABASE_FAILURE 5xx recorded as operational errors (DB-1 rule)',
  },
  {
    path: 'File uploads & storage (UploadedFile, secure media, website media)',
    state: 'partial',
    mechanism:
      'api() envelope 5xx + UploadedFile rows (size attribution for School Usage); storage-service connectivity is not probed directly — gap covered by the Supabase services health check via the Management API',
    gap: 'No dedicated storage-connectivity synthetic probe; dependency health relies on provider service status.',
  },
  {
    path: 'Email sending & invitations (Resend adapter + EmailDelivery outbox)',
    state: 'instrumented',
    mechanism:
      'EmailDelivery rows (QUEUED/SENT/FAILED with error classes — the source of truth for failure metrics), provider-error classification, live domain verification (health + sync), EMAIL-1/EMAIL-2 diagnosis rules; NEW: email failure-rate alert',
  },
  {
    path: 'Background jobs & scheduled tasks (runJob → JobRun)',
    state: 'instrumented',
    mechanism: 'JobRun rows (status/attempt/duration/error) + job_* structured logs; ops sync runs tracked in ProviderSyncRun',
  },
  {
    path: 'Provider synchronization (ops sync: Vercel/Supabase/Resend)',
    state: 'instrumented',
    mechanism: 'ProviderSyncRun rows + provider_sync operational errors on failure + staleness alert + SYNC-1 diagnosis rule',
  },
  {
    path: 'Webhook processing (payment + Resend delivery webhooks)',
    state: 'instrumented',
    mechanism: 'WebhookEvent rows (idempotency + error state) + api() envelope 5xx capture; EmailDelivery upgraded only on real delivery webhooks',
  },
  {
    path: 'Server components / page render errors (non-API surfaces)',
    state: 'partial',
    mechanism:
      'Next instrumentation onRequestError → next_request_error structured line; error.tsx/global-error.tsx boundaries; NOT persisted to OperationalError (the instrumentation file is edge-sandbox-constrained: it cannot import the DB client without breaking the edge build — documented in src/instrumentation.ts)',
    gap: 'Render errors are log-stream-only — inspect dev.log / Vercel runtime logs; they do not appear in the Errors tab unless they also flow through the API envelope.',
  },
  {
    path: 'Frontend client errors (browser exceptions)',
    state: 'not-instrumented',
    mechanism:
      'Client toasts surface failures to the affected user; no server-side browser-error ingestion route exists yet.',
    gap:
      'No browser-error collector is wired (would require a new ingestion route + storage decision). The existing surfaces show toasts to the user; server-visible failures remain covered.',
  },
]

/** Summarized counts for the UI. */
export function coverageSummary(): { instrumented: number; partial: number; notInstrumented: number } {
  return {
    instrumented: MONITORING_COVERAGE.filter((e) => e.state === 'instrumented').length,
    partial: MONITORING_COVERAGE.filter((e) => e.state === 'partial').length,
    notInstrumented: MONITORING_COVERAGE.filter((e) => e.state === 'not-instrumented').length,
  }
}
