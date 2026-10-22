/**
 * PLATFORM OPERATIONS CENTER — diagnosis-rule unit tests.
 *
 * THE CONTRACT UNDER TEST (mission §7): every verdict carries one of
 * exactly three statuses — confirmed / likely / insufficient-evidence —
 * backed by explicit evidence lines and a next safe step. Rules are
 * PURE: no fetches, no DB — the caller gathers evidence. A rule must
 * NEVER fire without its evidence, and a rule with missing links must
 * say "insufficient-evidence", never guess.
 */
import { describe, test, expect } from 'bun:test'
import {
  composeDiagnoses,
  diagnoseEmailTestingMode,
  diagnoseEmailAuthInvalid,
  diagnoseEmailDeliveryEvidenceGap,
  diagnoseDatabaseIssues,
  diagnoseTenantMismatchBurst,
  diagnoseDeploymentFailure,
  diagnoseSyncFailure,
} from '../../src/lib/ops/diagnose'

const EMAIL_OK = {
  domainsTotal: 2,
  domainsVerified: 2,
  failureClasses: {},
  statusCounts: {},
  webhookSecretConfigured: true,
  resendWebhookEvents: 5,
  queuedWithProviderMessageId: 0,
}
const EMAIL_TESTING = {
  domainsTotal: 0,
  domainsVerified: 0,
  failureClasses: { 'testing-recipient-restricted': 7 },
  statusCounts: { FAILED: 7, SENT: 2 },
  webhookSecretConfigured: false,
  resendWebhookEvents: 0,
  queuedWithProviderMessageId: 4,
}
const DB_OK = { databaseFailureErrors: 0, connectivity: 'healthy' as const, connectivityLatencyMs: 12 }
const AUTHZ_OK = { tenantMismatches: 0, forbiddenTotal: 0, platformLoginFailures: 0 }
const DEPLOY_OK = { failedDeployments: 0, latestState: 'READY' }
const SYNC_OK = { lastRunStatus: 'success', lastRunError: null, ageMinutes: 5 }

describe('EMAIL-1 — sender domain not verified (testing mode)', () => {
  test('403 testing-restriction failures + zero verified domains → CONFIRMED', () => {
    const d = diagnoseEmailTestingMode(EMAIL_TESTING)
    expect(d).not.toBeNull()
    expect(d!.status).toBe('confirmed')
    expect(d!.evidence.some((e) => e.includes('testing-recipient-restricted'))).toBe(true)
    expect(d!.evidence.some((e) => e.includes('0/0 domains verified'))).toBe(true)
    expect(d!.nextStep).toContain('Do NOT rotate the API key')
  })

  test('no email failures → rule does not fire (no false verdicts)', () => {
    expect(diagnoseEmailTestingMode(EMAIL_OK)).toBeNull()
  })

  test('failures but domains verified → insufficient-evidence (honest gap)', () => {
    const d = diagnoseEmailTestingMode({
      ...EMAIL_OK,
      failureClasses: { 'unverified-sender-domain': 3 },
    })
    expect(d).not.toBeNull()
    expect(d!.status).toBe('insufficient-evidence')
  })
})

describe('EMAIL-2 — invalid API key', () => {
  test('auth-invalid class → confirmed with the 401-not-403 distinction', () => {
    const d = diagnoseEmailAuthInvalid({
      ...EMAIL_OK,
      failureClasses: { 'auth-invalid': 2 },
    })
    expect(d).not.toBeNull()
    expect(d!.status).toBe('confirmed')
    expect(d!.evidence.join(' ')).toContain('401')
  })

  test('no auth failures → does not fire', () => {
    expect(diagnoseEmailAuthInvalid(EMAIL_TESTING)).toBeNull()
  })
})

describe('EMAIL-3 — delivery-evidence gap (webhook not delivering)', () => {
  test('QUEUED-with-message-id rows + zero webhook events + no signing secret → CONFIRMED', () => {
    const d = diagnoseEmailDeliveryEvidenceGap({
      ...EMAIL_OK,
      webhookSecretConfigured: false,
      resendWebhookEvents: 0,
      queuedWithProviderMessageId: 9,
    })
    expect(d).not.toBeNull()
    expect(d!.status).toBe('confirmed')
    expect(d!.rule).toBe('EMAIL-3')
    expect(d!.evidence.some((e) => e.includes('ZERO Resend webhook events'))).toBe(true)
    expect(d!.evidence.some((e) => e.includes('fail-closed'))).toBe(true)
    expect(d!.nextStep).toContain('RESEND_WEBHOOK_SECRET')
    expect(d!.nextStep).toContain('BOTH active projects')
  })

  test('QUEUED rows but events arriving (webhook partially fixed) → likely, never a silent pass', () => {
    const d = diagnoseEmailDeliveryEvidenceGap({
      ...EMAIL_OK,
      webhookSecretConfigured: true,
      resendWebhookEvents: 3,
      queuedWithProviderMessageId: 4,
    })
    expect(d).not.toBeNull()
    expect(d!.status).toBe('likely')
    expect(d!.evidence.join(' ')).toContain('some evidence is arriving')
  })

  test('no provider-accepted mail awaiting evidence → does not fire', () => {
    expect(
      diagnoseEmailDeliveryEvidenceGap({ ...EMAIL_OK, queuedWithProviderMessageId: 0, resendWebhookEvents: 0, webhookSecretConfigured: false }),
    ).toBeNull()
  })
})

describe('DB-1 — database outage / degradation', () => {
  test('connectivity DOWN → confirmed', () => {
    const d = diagnoseDatabaseIssues({ databaseFailureErrors: 12, connectivity: 'down', connectivityLatencyMs: null })
    expect(d!.status).toBe('confirmed')
  })

  test('degraded + failures present → likely', () => {
    const d = diagnoseDatabaseIssues({ databaseFailureErrors: 3, connectivity: 'degraded', connectivityLatencyMs: 850 })
    expect(d!.status).toBe('likely')
  })

  test('healthy + zero failures → does not fire', () => {
    expect(diagnoseDatabaseIssues(DB_OK)).toBeNull()
  })

  test('degraded but zero failures → does not fire (insufficient evidence for a verdict)', () => {
    expect(diagnoseDatabaseIssues({ databaseFailureErrors: 0, connectivity: 'degraded', connectivityLatencyMs: 400 })).toBeNull()
  })
})

describe('AUTHZ-1 — cross-tenant denial burst', () => {
  test('≥5 TENANT_MISMATCH denials → likely (never claims a breach)', () => {
    const d = diagnoseTenantMismatchBurst({ tenantMismatches: 9, forbiddenTotal: 40, platformLoginFailures: 2 })
    expect(d!.status).toBe('likely')
    expect(d!.evidence.join(' ')).toContain('REJECTED server-side')
  })

  test('under the burst threshold → does not fire', () => {
    expect(diagnoseTenantMismatchBurst({ tenantMismatches: 4, forbiddenTotal: 4, platformLoginFailures: 0 })).toBeNull()
  })
})

describe('DEPLOY-1 — failed deployment', () => {
  test('latest deployment ERROR → confirmed, previous known-good still serving', () => {
    const d = diagnoseDeploymentFailure({ failedDeployments: 1, latestState: 'ERROR' })
    expect(d!.status).toBe('confirmed')
    expect(d!.title).toContain('previous known-good')
  })

  test('latest READY → does not fire', () => {
    expect(diagnoseDeploymentFailure(DEPLOY_OK)).toBeNull()
  })
})

describe('SYNC-1 — provider sync failure', () => {
  test('last run failed → confirmed with the error detail', () => {
    const d = diagnoseSyncFailure({ lastRunStatus: 'failed', lastRunError: 'Vercel API unreachable: HTTP 401', ageMinutes: 30 })
    expect(d!.status).toBe('confirmed')
    expect(d!.evidence.join(' ')).toContain('HTTP 401')
  })

  test('successful sync → does not fire', () => {
    expect(diagnoseSyncFailure(SYNC_OK)).toBeNull()
  })
})

describe('composeDiagnoses — only evidence-backed verdicts surface', () => {
  test('a healthy system yields ZERO diagnoses (no noise)', () => {
    expect(
      composeDiagnoses({
        email: EMAIL_OK,
        db: DB_OK,
        authz: AUTHZ_OK,
        deployment: DEPLOY_OK,
        sync: SYNC_OK,
      }),
    ).toEqual([])
  })

  test('multiple simultaneous issues all surface with their statuses', () => {
    const out = composeDiagnoses({
      email: EMAIL_TESTING,
      db: { databaseFailureErrors: 5, connectivity: 'down', connectivityLatencyMs: null },
      authz: { tenantMismatches: 12, forbiddenTotal: 30, platformLoginFailures: 1 },
      deployment: { failedDeployments: 2, latestState: 'ERROR' },
      sync: { lastRunStatus: 'failed', lastRunError: 'boom', ageMinutes: 60 },
    })
    expect(out.length).toBeGreaterThanOrEqual(6)
    expect(out.every((d) => ['confirmed', 'likely', 'insufficient-evidence'].includes(d.status))).toBe(true)
    expect(out.every((d) => d.evidence.length > 0 && d.nextStep.length > 0)).toBe(true)
    // EMAIL-3 is among them (EMAIL_TESTING carries queued rows + zero events + no secret)
    expect(out.some((d) => d.rule === 'EMAIL-3')).toBe(true)
  })
})
