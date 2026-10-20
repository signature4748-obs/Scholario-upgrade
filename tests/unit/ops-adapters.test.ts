/**
 * PLATFORM OPERATIONS CENTER — provider-adapter degradation tests.
 *
 * The honesty contract under test (mission §5/§13):
 *   · missing credentials → the adapter reports `not-configured`
 *     unavailable metrics, never throws, never fabricates values;
 *   · provider HTTP failures surface as sanitized error strings — a
 *     credential NEVER leaks into an error message;
 *   · bounded fetching: transient failures are retried, permanent 4xx
 *     are not;
 *   · plan restrictions are reported as `plan-restricted` (the Vercel
 *     Hobby usage API case, verified live).
 *
 * Live provider APIs are NOT called here — fetch is replaced by an
 * in-test stub (mission §16: safe provider mocks).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { syncVercel } from '../../src/lib/ops/providers/vercel'
import { syncResend } from '../../src/lib/ops/providers/resend'
import { opsFetch, OpsFetchError } from '../../src/lib/ops/fetch'

const REAL_FETCH = globalThis.fetch

beforeEach(() => {
  process.env.OPS_VERCEL_TOKEN = 'test-vercel-token'
  process.env.RESEND_API_KEY = 'test-resend-key'
})

afterEach(() => {
  globalThis.fetch = REAL_FETCH
  delete process.env.OPS_VERCEL_TOKEN
  delete process.env.RESEND_API_KEY
})

describe('vercel adapter — honest degradation', () => {
  test('missing token → not-configured unavailable metric, no samples, no crash', async () => {
    delete process.env.OPS_VERCEL_TOKEN
    const r = await syncVercel()
    expect(r.error).toBeUndefined()
    expect(r.samples).toEqual([])
    expect(r.unavailable.length).toBeGreaterThan(0)
    expect(r.unavailable[0].reason).toBe('not-configured')
    expect(r.unavailable[0].detail).toContain('OPS_VERCEL_TOKEN')
  })

  test('API failure → sanitized error (no token leak); no fabricated availability rows', async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":{"code":"bad_request","message":"denied"}}', { status: 403 })) as typeof fetch
    const r = await syncVercel()
    expect(r.error).toBeTruthy()
    expect(r.error!).not.toContain('test-vercel-token')
    // A total connectivity failure yields NO samples and NO availability
    // rows — the failure itself is the fact (recorded as a sync error +
    // an operational error group). Nothing is fabricated.
    expect(r.samples).toEqual([])
    expect(r.unavailable).toEqual([])
    expect(r.deployments).toEqual([])
  })

  test('reachable API → real projects + deployments + honest plan-restriction row', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/v9/projects')) {
        return new Response(
          JSON.stringify({
            projects: [
              { id: 'prj_test1', name: 'scholario-platform', accountId: 'team_x', targets: { production: { url: 'x.vercel.app' } } },
              { id: 'prj_test2', name: 'scholario-app', accountId: 'team_x' },
            ],
          }),
          { status: 200 },
        )
      }
      if (u.includes('/v6/deployments')) {
        return new Response(
          JSON.stringify({
            deployments: [
              { uid: 'dpl_1', name: 'scholario-platform', state: 'READY', created: 1700000000000, url: 'x.vercel.app', meta: { githubCommitSha: 'abcdef123456', githubCommitMessage: 'test commit' } },
              { uid: 'dpl_2', name: 'scholario-platform', state: 'ERROR', created: 1699990000000 },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const r = await syncVercel()
    expect(r.error).toBeUndefined()
    expect(r.samples.length).toBeGreaterThan(0)
    // Deployment summaries carry the REAL states incl. the failure.
    expect(r.deployments?.some((d) => d.state === 'ERROR')).toBe(true)
    expect(r.deployments?.some((d) => d.state === 'READY')).toBe(true)
    const failedMetric = r.samples.find((s) => s.metric === 'deployments_failed_total_recent')
    expect(failedMetric?.value).toBe(1)
    // And the honest plan-restriction (verified live on this team).
    expect(r.unavailable.find((u) => u.metric === 'usage_metrics')?.reason).toBe('plan-restricted')
  })
})

describe('resend adapter — real outcomes, no fabricated quotas', () => {
  test('missing key → not-configured, no crash', async () => {
    delete process.env.RESEND_API_KEY
    const r = await syncResend()
    expect(r.error).toBeUndefined()
    expect(r.unavailable[0].reason).toBe('not-configured')
  })

  test('real domain + email data → counted outcomes; quota honestly not-reported', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/domains')) {
        return new Response(JSON.stringify({ data: [{ name: 'x.test', status: 'pending' }] }), { status: 200 })
      }
      if (u.includes('/emails')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'e1', created_at: '2026-10-20 01:00:00', last_event: 'delivered' },
              { id: 'e2', created_at: '2026-10-20 02:00:00', last_event: 'sent' },
              { id: 'e3', created_at: '2026-10-20 03:00:00', last_event: 'bounced' },
            ],
            has_more: false,
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const r = await syncResend()
    expect(r.error).toBeUndefined()
    const delivered = r.samples.find((s) => s.metric === 'emails_delivered_recent')
    const bounced = r.samples.find((s) => s.metric === 'emails_bounced_recent')
    const accepted = r.samples.find((s) => s.metric === 'emails_accepted_not_delivered_recent')
    const verified = r.samples.find((s) => s.metric === 'domains_verified')
    expect(delivered?.value).toBe(1) // provider last_event=delivered ONLY (acceptance is not delivery)
    expect(bounced?.value).toBe(1)
    expect(accepted?.value).toBe(1) // last_event=sent → accepted without delivery evidence
    expect(verified?.value).toBe(0) // 0 verified domains — the testing-mode signal
    // The plan quota is honestly not-reported (never a made-up number).
    expect(r.unavailable.find((u) => u.metric === 'send_quota')?.reason).toBe('not-reported')
    // Recipient addresses (PII) must never be stored in samples.
    const json = JSON.stringify(r.samples)
    expect(json).not.toContain('@hawkings')
    expect(json).not.toContain('signature4748')
  })
})

describe('opsFetch — bounded fetching semantics', () => {
  test('permanent 404 is not retried past its attempts and carries a typed error', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response('{"message":"Cannot GET"}', { status: 404 })
    }) as typeof fetch
    try {
      await opsFetch('https://api.example.com/x', { attempts: 3 })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(OpsFetchError)
      expect((e as OpsFetchError).transient).toBe(false)
      expect(calls).toBe(1) // permanent → exactly one attempt
    }
  })

  test('5xx is transient (retried)', async () => {
    const err = new OpsFetchError('http', 503, 'HTTP 503: busy')
    expect(err.transient).toBe(true)
    const rateLimit = new OpsFetchError('http', 429, 'HTTP 429')
    expect(rateLimit.transient).toBe(true)
    const forbidden = new OpsFetchError('http', 403, 'HTTP 403')
    expect(forbidden.transient).toBe(false)
  })

  test('non-JSON responses fail as a parse error, never a raw throw', async () => {
    globalThis.fetch = (async () => new Response('<html>not json</html>', { status: 200 })) as typeof fetch
    try {
      await opsFetch('https://api.example.com/x', { attempts: 1 })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OpsFetchError).kind).toBe('parse')
    }
  })
})
