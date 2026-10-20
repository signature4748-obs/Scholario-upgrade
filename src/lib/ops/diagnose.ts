/**
 * Root-cause diagnosis — rule-based, evidence-linked, honest by design.
 *
 * Every rule takes REAL collected evidence (DB rows + live provider
 * facts already gathered) and emits a diagnosis with a REQUIRED status:
 *   · confirmed        — the causal chain is directly evidenced (e.g.
 *                        email failures + live provider query showing
 *                        zero verified domains).
 *   · likely           — strong circumstantial evidence, missing a link.
 *   · insufficient-evidence — the data cannot support a claim yet; the
 *                        diagnosis says exactly WHAT to collect next.
 * A rule may NEVER claim to have inspected provider logs the app did
 * not actually retrieve. No AI-generated verdicts are treated as ground
 * truth (no AI analysis is wired in at all; if one is added later it
 * must be optional and labeled).
 *
 * Rules are PURE functions over their inputs (unit-testable, no fetch):
 * live provider facts are gathered by the CALLER (the API route/health
 * suite) and passed in.
 */

export type DiagnosisStatus = 'confirmed' | 'likely' | 'insufficient-evidence'

export interface Diagnosis {
  rule: string
  title: string
  status: DiagnosisStatus
  /** The exact evidence supporting the verdict (shown verbatim). */
  evidence: string[]
  /** The safest next troubleshooting step. */
  nextStep: string
}

/** Evidence about the email provider gathered live (health.ts/sync). */
export interface EmailEvidence {
  /** Live GET /domains result: total domains configured. */
  domainsTotal: number
  /** … of which status=verified. */
  domainsVerified: number
  /** Counts of EmailDelivery.lastError classes in the window. */
  failureClasses: Record<string, number>
  /** EmailDelivery status counts in the window. */
  statusCounts: Record<string, number>
}

/**
 * Rule EMAIL-1: sender domain not verified (testing mode).
 * Confirmed when failures carry the testing-recipient restriction class
 * AND the live provider query shows zero verified domains.
 */
export function diagnoseEmailTestingMode(ev: EmailEvidence): Diagnosis | null {
  const testingFailures = ev.failureClasses['testing-recipient-restricted'] ?? 0
  const unverifiedFailures = ev.failureClasses['unverified-sender-domain'] ?? 0
  if (testingFailures === 0 && unverifiedFailures === 0) return null
  const confirmed = ev.domainsVerified === 0
  return {
    rule: 'EMAIL-1',
    title:
      ev.domainsVerified === 0
        ? 'Email invitations fail because the sender domain is not verified (provider testing mode)'
        : 'Email failures mention domain verification although domains are verified — payload/recipient policy mismatch',
    status: confirmed ? 'confirmed' : 'insufficient-evidence',
    evidence: [
      `${testingFailures} failure(s) classified [testing-recipient-restricted] (HTTP 403 owner-only delivery)`,
      `${unverifiedFailures} failure(s) classified [unverified-sender-domain]`,
      `Live provider query at diagnosis time: ${ev.domainsVerified}/${ev.domainsTotal} domains verified`,
      ...(confirmed ? [] : ['Verified domains exist — the restriction class may be stale; verify the exact failing sender address in the provider dashboard']),
    ],
    nextStep:
      ev.domainsVerified === 0
        ? 'Verify a sending domain in the provider dashboard (Resend → Domains), or keep using the provider sandbox sender within its restrictions. Do NOT rotate the API key — it is valid.'
        : 'Open the failing message in the provider dashboard and compare its sender with the configured verified domains.',
  }
}

/**
 * Rule EMAIL-2: invalid API key.
 * Confirmed when failures carry auth-invalid (HTTP 401 from the
 * provider) — a credential problem, categorically different from 403.
 */
export function diagnoseEmailAuthInvalid(ev: EmailEvidence): Diagnosis | null {
  const authFailures = ev.failureClasses['auth-invalid'] ?? 0
  if (authFailures === 0) return null
  return {
    rule: 'EMAIL-2',
    title: 'Email API key is missing, invalid or revoked',
    status: 'confirmed',
    evidence: [
      `${authFailures} failure(s) classified [auth-invalid] — the provider rejected the credential with HTTP 401`,
      'A 401 is a CREDENTIAL failure — distinct from the 403 testing-mode restriction (do not conflate them)',
    ],
    nextStep: 'Rotate the key in the provider dashboard, update the deployment env (RESEND_API_KEY), then trigger a test send from the Operations center.',
  }
}

/** Evidence about the database gathered live. */
export interface DbEvidence {
  /** DATABASE_FAILURE 5xx group counts in the recent window. */
  databaseFailureErrors: number
  /** Recent db_connectivity health check status. */
  connectivity: 'healthy' | 'degraded' | 'down' | 'unknown' | 'not_configured'
  connectivityLatencyMs: number | null
}

/**
 * Rule DB-1: database outage / degradation.
 * Confirmed when the health check is down; likely when a burst of
 * DATABASE_FAILURE responses correlates with degraded connectivity.
 */
export function diagnoseDatabaseIssues(ev: DbEvidence): Diagnosis | null {
  if (ev.connectivity === 'down') {
    return {
      rule: 'DB-1',
      title: 'Database is unreachable — application requests fail at the connection layer',
      status: 'confirmed',
      evidence: [
        `db_connectivity health check is DOWN (last measured ${ev.connectivityLatencyMs ?? '?'} ms)`,
        `${ev.databaseFailureErrors} DATABASE_FAILURE API error(s) recorded in the recent window`,
      ],
      nextStep: 'Check the database provider status page; if healthy, inspect connection-pool saturation in the Usage tab (pooler sessions). No data changes are needed.',
    }
  }
  if (ev.connectivity === 'degraded' && ev.databaseFailureErrors > 0) {
    return {
      rule: 'DB-1',
      title: 'Database latency is elevated and failures are occurring — likely pool saturation or provider-side degradation',
      status: 'likely',
      evidence: [
        `db_connectivity check DEGRADED (${ev.connectivityLatencyMs ?? '?'} ms)`,
        `${ev.databaseFailureErrors} DATABASE_FAILURE API error(s) in the recent window`,
      ],
      nextStep: 'Compare current pooler connection counts (Usage & Limits) with the plan limit, and re-run the health checks after a few minutes.',
    }
  }
  return null
}

/** Evidence for authorization-related incidents. */
export interface AuthzEvidence {
  tenantMismatches: number
  forbiddenTotal: number
  platformLoginFailures: number
}

/**
 * Rule AUTHZ-1: cross-tenant denial burst.
 * Likely probing or stale client cache when TENANT_MISMATCH spikes.
 */
export function diagnoseTenantMismatchBurst(ev: AuthzEvidence): Diagnosis | null {
  if (ev.tenantMismatches < 5) return null
  return {
    rule: 'AUTHZ-1',
    title: 'Repeated cross-tenant access denials — likely cross-tenant probing or a stale client cache',
    status: 'likely',
    evidence: [
      `${ev.tenantMismatches} TENANT_MISMATCH denials in the recent window (each request was REJECTED server-side — no data leaked)`,
      'Every denial is a server-enforced boundary hit, not a breach',
    ],
    nextStep: 'Cross-reference the Audit Log for the involved identities (Actions: tenant-mismatch events); if a single identity dominates, review that account; if school users are affected broadly, check for a stale client build holding old ids.',
  }
}

/** Evidence about deployments (Vercel adapter facts). */
export interface DeploymentEvidence {
  failedDeployments: number
  latestState: string
}

/**
 * Rule DEPLOY-1: latest deployment failed — the production build is
 * still the previous known-good one (Vercel keeps serving it).
 */
export function diagnoseDeploymentFailure(ev: DeploymentEvidence): Diagnosis | null {
  if (ev.latestState !== 'ERROR') return null
  return {
    rule: 'DEPLOY-1',
    title: 'The latest production deployment FAILED — production is still serving the previous known-good deployment',
    status: 'confirmed',
    evidence: [
      `Latest deployment state: ${ev.latestState}`,
      `${ev.failedDeployments} failed deployment(s) in the recent window`,
    ],
    nextStep: 'Open the deployment logs in the Vercel dashboard (link on the Overview tab) and fix the failing build step; the release pipeline (docs/RELEASE.md) keeps production pinned to the last passing commit.',
  }
}

/**
 * Rule SYNC-1: provider sync stale/failed.
 */
export function diagnoseSyncFailure(ev: {
  lastRunStatus: string
  lastRunError: string | null
  ageMinutes: number | null
}): Diagnosis | null {
  if (ev.lastRunStatus === 'failed') {
    return {
      rule: 'SYNC-1',
      title: 'Provider synchronization is failing — dashboard values may be stale',
      status: 'confirmed',
      evidence: [
        `Last sync run status: ${ev.lastRunStatus}${ev.lastRunError ? ` — ${ev.lastRunError.slice(0, 200)}` : ''}`,
        ...(ev.ageMinutes !== null ? [`Last run finished ${ev.ageMinutes} minutes ago`] : []),
      ],
      nextStep: 'Retry with "Sync now" on the Usage & Limits tab; if it persists, run the Service Health checks to isolate which provider API is unreachable.',
    }
  }
  return null
}

/**
 * Compose the full diagnosis feed for the Errors & Incidents tab: runs
 * every applicable rule over the current evidence and returns verdicts
 * (pure — the caller gathers evidence first).
 */
export function composeDiagnoses(evidence: {
  email: EmailEvidence
  db: DbEvidence
  authz: AuthzEvidence
  deployment: DeploymentEvidence
  sync: { lastRunStatus: string; lastRunError: string | null; ageMinutes: number | null }
}): Diagnosis[] {
  const candidates: Array<Diagnosis | null> = [
    diagnoseEmailTestingMode(evidence.email),
    diagnoseEmailAuthInvalid(evidence.email),
    diagnoseDatabaseIssues(evidence.db),
    diagnoseTenantMismatchBurst(evidence.authz),
    diagnoseDeploymentFailure(evidence.deployment),
    diagnoseSyncFailure(evidence.sync),
  ]
  return candidates.filter((d): d is Diagnosis => d !== null)
}
