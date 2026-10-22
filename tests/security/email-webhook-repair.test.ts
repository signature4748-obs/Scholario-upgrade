// ============================================================
// EMAIL WEBHOOK REPAIR · hermetic unit tests (no live provider)
// ------------------------------------------------------------
// The repair module mutates PROVIDER state — these tests script the
// entire HTTP surface (Resend + Vercel) and assert the EXACT call
// sequence, the fail-closed preflight, the rollback-on-sync-failure
// contract, and — above all — that the fresh signing secret NEVER
// appears in any result, error message or thrown detail.
// ============================================================

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { repairResendWebhook, WEBHOOK_REPAIR_EVENTS } from '@/lib/email/webhook-repair'
import { AppError } from '@/lib/security/errors'

const REAL_FETCH = globalThis.fetch

const SAVED_ENV = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  OPS_VERCEL_TOKEN: process.env.OPS_VERCEL_TOKEN,
  OPS_VERCEL_TEAM_ID: process.env.OPS_VERCEL_TEAM_ID,
  OPS_VERCEL_PROJECTS: process.env.OPS_VERCEL_PROJECTS,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
}

type SavableEnvName =
  | 'RESEND_API_KEY'
  | 'OPS_VERCEL_TOKEN'
  | 'OPS_VERCEL_TEAM_ID'
  | 'OPS_VERCEL_PROJECTS'
  | 'VERCEL_PROJECT_PRODUCTION_URL'

function restoreEnv(name: SavableEnvName, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_stub_not_a_real_key'
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'scholario-platform.vercel.app'
  process.env.OPS_VERCEL_TOKEN = 'stub_vercel_token'
  process.env.OPS_VERCEL_TEAM_ID = 'stub-team'
  process.env.OPS_VERCEL_PROJECTS = 'scholario-platform,scholario-app'
})

afterEach(() => {
  restoreEnv('RESEND_API_KEY', SAVED_ENV.RESEND_API_KEY)
  restoreEnv('OPS_VERCEL_TOKEN', SAVED_ENV.OPS_VERCEL_TOKEN)
  restoreEnv('OPS_VERCEL_TEAM_ID', SAVED_ENV.OPS_VERCEL_TEAM_ID)
  restoreEnv('OPS_VERCEL_PROJECTS', SAVED_ENV.OPS_VERCEL_PROJECTS)
  restoreEnv('VERCEL_PROJECT_PRODUCTION_URL', SAVED_ENV.VERCEL_PROJECT_PRODUCTION_URL)
  globalThis.fetch = REAL_FETCH
})

/** One scripted provider call (method + url prefix + response). */
interface ScriptedCall {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  urlPrefix: string
  status: number
  body: unknown
}

interface RecordedCall {
  method: string
  url: string
  body: unknown
}

/** Script a call sequence: entries are consumed IN ORDER (each answers
 *  exactly once); an unmatched call answers 500 (the test then fails on
 *  its own assertions). */
function scriptFetch(calls: ScriptedCall[]): { recorded: RecordedCall[] } {
  const recorded: RecordedCall[] = []
  const queue = [...calls]
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET')
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    recorded.push({ method, url, body })
    const idx = queue.findIndex((c) => c.method === method && url.startsWith(c.urlPrefix))
    if (idx === -1) {
      return new Response(JSON.stringify({ message: `unscripted ${method} ${url}` }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
    const hit = queue.splice(idx, 1)[0]
    return new Response(JSON.stringify(hit.body ?? null), {
      status: hit.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { recorded }
}

/** The full provider surface for a happy-path repair run — the REAL
 *  Resend GET shape (endpointUrl, not url) as live-verified on
 *  2026-10-22. */
const FRESH_SECRET = 'whsec_STUB_SECRET_VALUE_never_real_0123456789abcdef'

function happyPathCalls(): ScriptedCall[] {
  return [
    // Resend: GET the existing (stale, non-delivering) endpoints.
    {
      method: 'GET',
      urlPrefix: 'https://api.resend.com/webhooks',
      status: 200,
      body: {
        data: [
          { id: 'wh_live_old1', endpointUrl: 'https://scholario-platform.vercel.app/api/webhooks/resend', events: ['email.delivered'] },
          { id: 'wh_live_old2', endpointUrl: 'https://stale.example.com/hook', events: [] },
        ],
      },
    },
    // CREATE-FIRST: the fresh endpoint exists before any delete.
    {
      method: 'POST',
      urlPrefix: 'https://api.resend.com/webhooks',
      status: 201,
      body: { id: 'wh_live_fresh', signing_secret: FRESH_SECRET },
    },
    // Then the OLD endpoints are removed (the fresh one delivers).
    {
      method: 'DELETE',
      urlPrefix: 'https://api.resend.com/webhooks/wh_live_old1',
      status: 200,
      body: { id: 'wh_live_old1' },
    },
    {
      method: 'DELETE',
      urlPrefix: 'https://api.resend.com/webhooks/wh_live_old2',
      status: 200,
      body: { id: 'wh_live_old2' },
    },
    // Vercel: project listing → the two planes.
    {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v9/projects?limit=100',
      status: 200,
      body: {
        projects: [
          { id: 'prj_platform', name: 'scholario-platform' },
          { id: 'prj_school', name: 'scholario-app' },
          { id: 'prj_other', name: 'unrelated-project' },
        ],
      },
    },
    // Env listing: platform HAS the secret (→ rotate), school does NOT (→ create).
    {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v9/projects/prj_platform/env?',
      status: 200,
      body: { envs: [{ key: 'RESEND_WEBHOOK_SECRET', id: 'env_platform_1' }] },
    },
    {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v9/projects/prj_school/env?',
      status: 200,
      body: { envs: [] },
    },
    {
      method: 'PATCH',
      urlPrefix: 'https://api.vercel.com/v9/projects/prj_platform/env/env_platform_1',
      status: 200,
      body: {},
    },
    {
      method: 'POST',
      urlPrefix: 'https://api.vercel.com/v9/projects/prj_school/env?',
      status: 200,
      body: {},
    },
    // Deployments per plane + the redeploy (deployment duplication) calls.
    {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v6/deployments?projectId=prj_platform',
      status: 200,
      body: { deployments: [{ uid: 'dpl_platform_1', state: 'READY', target: 'production' }] },
    },
    {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v6/deployments?projectId=prj_school',
      status: 200,
      body: { deployments: [{ uid: 'dpl_school_1', state: 'READY', target: 'production' }] },
    },
    {
      method: 'POST',
      urlPrefix: 'https://api.vercel.com/v13/deployments',
      status: 200,
      body: { id: 'dpl_new_1' },
    },
    {
      method: 'POST',
      urlPrefix: 'https://api.vercel.com/v13/deployments',
      status: 200,
      body: { id: 'dpl_new_2' },
    },
  ]
}

// ─── 1. fail-closed preflight (nothing mutated) ──────────────────────────

describe('WEBHOOK REPAIR · fail-closed preflight', () => {
  test('refuses without RESEND_API_KEY — and never touches the network', async () => {
    delete process.env.RESEND_API_KEY
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await expect(repairResendWebhook()).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('refuses without VERCEL_PROJECT_PRODUCTION_URL (no canonical endpoint derivation)', async () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await expect(repairResendWebhook()).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('refuses without OPS_VERCEL_TOKEN (secret sync impossible — no half-repairs)', async () => {
    delete process.env.OPS_VERCEL_TOKEN
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await expect(repairResendWebhook()).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('refuses without OPS_VERCEL_TEAM_ID', async () => {
    delete process.env.OPS_VERCEL_TEAM_ID
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await expect(repairResendWebhook()).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('provider GET failure refuses BEFORE any mutation (nothing deleted, nothing created)', async () => {
    const { recorded } = scriptFetch([
      { method: 'GET', urlPrefix: 'https://api.resend.com/webhooks', status: 403, body: { message: 'denied' } },
    ])
    await expect(repairResendWebhook()).rejects.toThrow()
    expect(recorded.some((c) => c.method === 'DELETE' || c.method === 'POST')).toBe(false)
  })

  test('create-validation failure (HTTP 422) leaves the provider state UNTOUCHED — create runs before any delete, and the provider error text is surfaced', async () => {
    const calls: ScriptedCall[] = [
      {
        method: 'GET',
        urlPrefix: 'https://api.resend.com/webhooks',
        status: 200,
        body: { data: [{ id: 'wh_live_old1', endpointUrl: 'https://scholario-platform.vercel.app/api/webhooks/resend', events: ['email.delivered'] }] },
      },
      {
        method: 'POST',
        urlPrefix: 'https://api.resend.com/webhooks',
        status: 422,
        body: { message: 'endpointUrl is required' },
      },
    ]
    const { recorded } = scriptFetch(calls)
    let caught: unknown
    try {
      await repairResendWebhook()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AppError)
    // The provider's own validation text is operator-facing — surfaced.
    expect(String((caught as AppError).publicMessage)).toContain('422')
    expect(String((caught as AppError).publicMessage)).toContain('endpointUrl')
    // NOTHING was deleted before the failed create (create-first).
    expect(recorded.some((c) => c.method === 'DELETE')).toBe(false)
    expect(String((caught as AppError).publicMessage)).not.toContain(FRESH_SECRET)
  })
})

// ─── 2. the repair sequence itself ───────────────────────────────────────

describe('WEBHOOK REPAIR · recreate + secret sync + redeploy', () => {
  test('happy path: CREATE-FIRST at the canonical endpointUrl with all six events, then deletes the old endpoints, syncs + redeploys both planes', async () => {
    const { recorded } = scriptFetch(happyPathCalls())
    const result = await repairResendWebhook()

    // Provider surface — the ORDER is the create-first contract: GET →
    // POST create → DELETE old1 → DELETE old2 (never deletes before a
    // successful create).
    const createIdx = recorded.findIndex((c) => c.method === 'POST' && c.url === 'https://api.resend.com/webhooks')
    const firstDeleteIdx = recorded.findIndex((c) => c.method === 'DELETE')
    expect(createIdx).toBeGreaterThan(-1)
    expect(firstDeleteIdx).toBeGreaterThan(createIdx)
    const create = recorded[createIdx]
    expect(create.body).toEqual({
      endpointUrl: 'https://scholario-platform.vercel.app/api/webhooks/resend',
      events: [...WEBHOOK_REPAIR_EVENTS],
      description: expect.any(String),
    })
    expect([...WEBHOOK_REPAIR_EVENTS]).toContain('email.delivered')
    expect([...WEBHOOK_REPAIR_EVENTS].length).toBe(6)
    const deletes = recorded.filter((c) => c.method === 'DELETE')
    expect(deletes.map((c) => c.url)).toEqual([
      'https://api.resend.com/webhooks/wh_live_old1',
      'https://api.resend.com/webhooks/wh_live_old2',
    ])

    // Vercel surface: only the two OPS_VERCEL_PROJECTS planes were touched.
    const envLists = recorded.filter((c) => c.method === 'GET' && c.url.includes('/v9/projects/') && c.url.includes('/env'))
    expect(envLists.map((c) => c.url)).toContain('https://api.vercel.com/v9/projects/prj_platform/env?limit=100&teamId=stub-team')
    expect(recorded.some((c) => c.url.includes('prj_other'))).toBe(false)

    // Platform plane: PATCH rotate (env row exists); school plane: POST create.
    const patch = recorded.find((c) => c.method === 'PATCH')
    expect(patch?.url).toBe('https://api.vercel.com/v9/projects/prj_platform/env/env_platform_1?teamId=stub-team')
    expect(patch?.body).toEqual({ value: FRESH_SECRET })
    const createEnv = recorded.find((c) => c.method === 'POST' && c.url.includes('/v9/projects/prj_school/env'))
    expect(createEnv?.body).toMatchObject({ key: 'RESEND_WEBHOOK_SECRET', value: FRESH_SECRET, type: 'encrypted', target: ['production'] })

    // Redeploys: duplicate the READY production deployment per plane.
    const redeploys = recorded.filter((c) => c.method === 'POST' && c.url.startsWith('https://api.vercel.com/v13/deployments'))
    expect(redeploys.length).toBe(2)
    expect(
      redeploys.map((c) => c.body),
    ).toEqual([
      { deploymentId: 'dpl_platform_1', target: 'production' },
      { deploymentId: 'dpl_school_1', target: 'production' },
    ])

    // Sanitized result contract.
    expect(result.ok).toBe(true)
    expect(result.createdWebhookId).toBe('wh_live_fresh')
    expect(result.canonicalEndpoint).toBe('https://scholario-platform.vercel.app/api/webhooks/resend')
    expect(result.found.map((f) => f.url)).toEqual([
      'https://scholario-platform.vercel.app/api/webhooks/resend',
      'https://stale.example.com/hook',
    ])
    expect(result.deleted.map((d) => d.id)).toEqual(['wh_live_old1', 'wh_live_old2'])
    expect(result.deleteWarnings).toEqual([])
    expect(result.secretSynced).toEqual({ 'scholario-platform': 'rotated', 'scholario-app': 'created' })
    expect(result.redeploy['scholario-platform']).toContain('triggered')
    expect(result.redeploy['scholario-app']).toContain('triggered')
    expect(JSON.stringify(result)).not.toContain(FRESH_SECRET)
  })

  test('a stale endpoint failing to delete is a WARNING, never fatal (the fresh one delivers)', async () => {
    const calls = happyPathCalls()
    const old1Delete = calls.findIndex((c) => c.method === 'DELETE' && c.urlPrefix.includes('wh_live_old1'))
    calls[old1Delete] = { method: 'DELETE', urlPrefix: 'https://api.resend.com/webhooks/wh_live_old1', status: 403, body: { message: 'denied' } }
    scriptFetch(calls)
    const result = await repairResendWebhook()
    expect(result.ok).toBe(true)
    expect(result.deleted.map((d) => d.id)).toEqual(['wh_live_old2'])
    expect(result.deleteWarnings.length).toBe(1)
    expect(result.deleteWarnings[0]).toContain('wh_live_old1')
    expect(JSON.stringify(result)).not.toContain(FRESH_SECRET)
  })

  test('the signing secret NEVER appears in the result (serialized sweep)', async () => {
    scriptFetch(happyPathCalls())
    const result = await repairResendWebhook()
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('whsec_')
    expect(serialized).not.toContain('signing')
  })

  test('recreate without a returned signing secret fails with the manual-step story', async () => {
    const calls = happyPathCalls()
    const createIdx = calls.findIndex((c) => c.method === 'POST' && c.urlPrefix === 'https://api.resend.com/webhooks')
    calls[createIdx] = { method: 'POST', urlPrefix: 'https://api.resend.com/webhooks', status: 201, body: { id: 'wh_live_fresh' } }
    scriptFetch(calls)
    let caught: unknown
    try {
      await repairResendWebhook()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AppError)
    expect(String((caught as AppError).publicMessage)).toContain('Resend dashboard')
    expect(String((caught as AppError).publicMessage)).not.toContain(FRESH_SECRET)
  })
})

// ─── 3. rollback-on-sync-failure (never keep an unverifiable webhook) ────

describe('WEBHOOK REPAIR · rollback when the secret cannot be synced', () => {
  test('env-sync failure DELETES the fresh webhook and reports honestly (no webhook left signing with an unknown secret)', async () => {
    const calls = happyPathCalls()
    // The platform plane's env PATCH is refused (e.g. token lacks env-write scope).
    const patchIdx = calls.findIndex((c) => c.method === 'PATCH' && c.urlPrefix.includes('prj_platform/env/'))
    calls[patchIdx] = { method: 'PATCH', urlPrefix: 'https://api.vercel.com/v9/projects/prj_platform/env/env_platform_1', status: 403, body: { message: 'scope denied' } }
    const { recorded } = scriptFetch(calls)

    let caught: unknown
    try {
      await repairResendWebhook()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AppError)
    const msg = String((caught as AppError).publicMessage)
    expect(msg).toContain('DELETED')
    expect(msg).toContain('rollback')
    expect(msg).not.toContain(FRESH_SECRET)

    // The rollback DELETE of the fresh webhook actually happened.
    const rollback = recorded.find(
      (c) => c.method === 'DELETE' && c.url === 'https://api.resend.com/webhooks/wh_live_fresh',
    )
    expect(rollback).toBeTruthy()
  })

  test('plane discovery failure (token cannot list projects) also rolls back the fresh webhook', async () => {
    const calls = happyPathCalls()
    const projectsIdx = calls.findIndex((c) => c.method === 'GET' && c.urlPrefix === 'https://api.vercel.com/v9/projects?limit=100')
    calls[projectsIdx] = { method: 'GET', urlPrefix: 'https://api.vercel.com/v9/projects?limit=100', status: 403, body: { message: 'scope denied' } }
    const { recorded } = scriptFetch(calls)

    await expect(repairResendWebhook()).rejects.toThrow()
    const rollback = recorded.find(
      (c) => c.method === 'DELETE' && c.url === 'https://api.resend.com/webhooks/wh_live_fresh',
    )
    expect(rollback).toBeTruthy()
  })
})

// ─── 4. redeploy is best-effort (secret already synced) ──────────────────

describe('WEBHOOK REPAIR · redeploy is best-effort, never fatal', () => {
  test('a redeploy trigger failure becomes a warning line, the repair still succeeds', async () => {
    const calls = happyPathCalls()
    const redeploys = calls.filter((c) => c.method === 'POST' && c.urlPrefix === 'https://api.vercel.com/v13/deployments')
    calls[calls.indexOf(redeploys[0])] = {
      method: 'POST',
      urlPrefix: 'https://api.vercel.com/v13/deployments',
      status: 403,
      body: { message: 'scope denied' },
    }
    scriptFetch(calls)
    const result = await repairResendWebhook()
    expect(result.ok).toBe(true)
    expect(result.redeploy['scholario-platform']).toContain('failed')
    expect(result.redeploy['scholario-app']).toContain('triggered')
  })

  test('no READY production deployment to duplicate → honest skip note', async () => {
    const calls = happyPathCalls()
    const depIdx = calls.findIndex((c) => c.method === 'GET' && c.urlPrefix.includes('projectId=prj_platform'))
    calls[depIdx] = {
      method: 'GET',
      urlPrefix: 'https://api.vercel.com/v6/deployments?projectId=prj_platform',
      status: 200,
      body: { deployments: [{ uid: 'dpl_queued', state: 'QUEUED', target: 'production' }] },
    }
    scriptFetch(calls)
    const result = await repairResendWebhook()
    expect(result.ok).toBe(true)
    expect(result.redeploy['scholario-platform']).toContain('skipped')
  })
})
