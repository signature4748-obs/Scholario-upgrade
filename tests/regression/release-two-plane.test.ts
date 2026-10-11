/**
 * RELEASE WIRING — TWO-PLANE BEHAVIOR REGRESSION SUITE.
 *
 * THE CONTRACT UNDER TEST (Batch 2 / PART A, 2026-10-10): the active
 * production topology is exactly TWO Vercel projects —
 *   · scholario-platform  (control plane, VERCEL_PROJECT_ID)
 *   · scholario-app       (school plane,   VERCEL_PROJECT_ID_SCHOOL)
 * The deprecated scholario-production is NEVER a deploy target, never a
 * default health URL, never a verification surface. A release that is only
 * live on ONE plane is NOT released (fail-closed everywhere).
 *
 * Coverage (each case spawns the REAL script as a child process against a
 * local mock Vercel API / health / deploy-hook server — the
 * scripts/prod-release/* VERCEL_API_BASE + PROD_RELEASE_POLL_INTERVAL_MS
 * test-harness overrides; no real Vercel, no real hooks, no secrets):
 *
 *   1. config-preflight    — missing school-project configuration fails;
 *                            missing platform configuration fails; both
 *                            planes green passes; a school plane missing
 *                            CORE vars fails with the plane named.
 *   2. verify-deployment   — missing school-project configuration fails;
 *                            both planes green passes; SHA mismatch on
 *                            EITHER project fails with that plane named;
 *                            no-READY-deployment on the school plane fails
 *                            (UNKNOWN = STOP); unhealthy endpoint on EITHER
 *                            plane fails.
 *   3. trigger-deploy-hooks— both hooks accepted passes; one hook failing
 *                            fails (exit 1) while BOTH hooks were still
 *                            fired; a missing school-hook secret fails; a
 *                            4xx hook fails immediately without retry storm.
 *   4. release-gate (dry-run / no-deploy behavior — the ACTUAL bash block
 *      extracted from .github/release.yml.parked and executed):
 *                            dry-run ⇒ deployable=false, exit 0 (nothing
 *                            deploys); all-green ⇒ deployable=true; any
 *                            non-success stage (ci / config / migration
 *                            apply skipped, …) ⇒ deployable=false + RED.
 *   5. Workflow wiring (static): the deploy job runs ONLY after the gate
 *      opens, fires BOTH hook secrets via trigger-deploy-hooks.ts, and the
 *      config/verify jobs carry the school-plane project + URL secrets;
 *      scholario-production appears only inside deprecation comments.
 *   6. planesHealthGate (prod-migration Stage F unit behavior): both planes
 *      healthy ⇒ no problems; EITHER plane unhealthy ⇒ problem naming that
 *      plane; defaults point at the two ACTIVE planes, never the deprecated
 *      project.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { ACTIVE_PRODUCTION_HEALTH_URLS, planesHealthGate } from '../../scripts/prod-migration/lib'

const ROOT = resolve(__dirname, '../..')
const RELEASE_SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const OTHER_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const PLATFORM_PROJECT = 'prj_platform_test'
const SCHOOL_PROJECT = 'prj_school_test'
const base2 = (port: number) => `http://127.0.0.1:${port}`

// ─── Local mock Vercel API + health + deploy-hook server ─────────────────

interface MockDeployment {
  uid: string
  state: string
  createdAt: number
  sha: string
}

interface MockState {
  deployments: Map<string, MockDeployment[]>
  envs: Map<string, string[]>
  /** /<plane>/health/ready path → HTTP status (200 default). */
  healthStatus: Record<string, number>
  /** hook path → HTTP status (200 default). */
  hookStatus: Record<string, number>
  /** every POST hook path received, in order. */
  hookHits: string[]
}

function makeState(): MockState {
  return {
    deployments: new Map([
      [PLATFORM_PROJECT, [{ uid: 'dpl_platform_1', state: 'READY', createdAt: Date.now() - 60_000, sha: RELEASE_SHA }]],
      [SCHOOL_PROJECT, [{ uid: 'dpl_school_1', state: 'READY', createdAt: Date.now() - 60_000, sha: RELEASE_SHA }]],
    ]),
    envs: new Map([
      [PLATFORM_PROJECT, ['DATABASE_URL', 'DATABASE_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'FILE_SIGNING_SECRET', 'REALTIME_CHANNEL_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM']],
      [SCHOOL_PROJECT, ['DATABASE_URL', 'DATABASE_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'FILE_SIGNING_SECRET', 'REALTIME_CHANNEL_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM']],
    ]),
    healthStatus: {},
    hookStatus: {},
    hookHits: [],
  }
}

function startMockServer(state: MockState): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }

    // Vercel deployments listing (v6) — per projectId.
    if (url.pathname === '/v6/deployments') {
      const projectId = url.searchParams.get('projectId') ?? ''
      const deps = state.deployments.get(projectId) ?? []
      send(200, { deployments: deps.map((d) => ({ uid: d.uid, state: d.state, createdAt: d.createdAt, meta: { githubCommitSha: d.sha } })) })
      return
    }

    // Vercel project env listing (v9) — per projectId, names + targets only.
    const envMatch = url.pathname.match(/^\/v9\/projects\/([^/]+)\/env$/)
    if (envMatch) {
      const projectId = decodeURIComponent(envMatch[1])
      const keys = state.envs.get(projectId) ?? []
      send(200, { envs: keys.map((key) => ({ key, target: ['production'] })) })
      return
    }

    // Deploy hooks (POST) — status per path; every hit recorded.
    if (req.method === 'POST') {
      state.hookHits.push(url.pathname)
      const status = state.hookStatus[url.pathname] ?? 200
      send(status, { deploymentId: `dpl_mock${url.pathname.replace(/\W/g, '_')}` })
      return
    }

    // Plane health probes: /<plane-prefix>/health/ready.
    if (url.pathname.endsWith('/health/ready')) {
      const status = state.healthStatus[url.pathname] ?? 200
      send(status, status === 200 ? { status: 'ok', database: 'ok' } : { error: 'unhealthy' })
      return
    }

    send(404, { error: 'not found' })
  })
  return new Promise((resolveStart) => {
    server.listen(0, '127.0.0.1', () => {
      resolveStart({ server, port: (server.address() as { port: number }).port })
    })
  })
}

// ─── Child-process runner for the REAL scripts ────────────────────────────

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runScript(script: string, args: string[], env: Record<string, string | undefined>): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child: ChildProcess = spawn('bun', [script, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? '/home/z',
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('close', (code) => resolveRun({ code: code ?? -1, stdout, stderr }))
    child.on('error', (err) => resolveRun({ code: -1, stdout, stderr: String(err) }))
  })
}

/** combined output — the scripts log to stdout and/or stderr per stage. */
const all = (r: RunResult) => r.stdout + r.stderr

// ─── Shared mock server for the whole suite (sequential tests) ────────────

let mock: { server: Server; port: number }
let state: MockState
const base = () => `http://127.0.0.1:${mock.port}`

beforeAll(async () => {
  state = makeState()
  mock = await startMockServer(state)
})
afterAll(() => {
  mock.server.close()
})

// ─── 1. config-preflight — two-plane configuration gating ─────────────────

describe('config-preflight (two planes)', () => {
  const script = 'scripts/prod-release/config-preflight.ts'
  const goodEnv = () => ({
    VERCEL_TOKEN: 'mock-token-not-a-real-secret',
    VERCEL_PROJECT_ID: PLATFORM_PROJECT,
    VERCEL_PROJECT_ID_SCHOOL: SCHOOL_PROJECT,
    VERCEL_API_BASE: base(),
  })

  test('MISSING school-project configuration fails closed (the school plane is not optional)', async () => {
    const env = goodEnv()
    delete env.VERCEL_PROJECT_ID_SCHOOL
    const r = await runScript(script, [], env)
    expect(r.code).not.toBe(0)
    expect(all(r)).toContain('VERCEL_PROJECT_ID_SCHOOL')
  })

  test('MISSING platform-project configuration fails closed', async () => {
    const env = goodEnv()
    delete env.VERCEL_PROJECT_ID
    const r = await runScript(script, [], env)
    expect(r.code).not.toBe(0)
    expect(all(r)).toContain('VERCEL_PROJECT_ID')
  })

  test('both planes fully configured → green (exit 0)', async () => {
    const r = await runScript(script, [], goodEnv())
    expect(r.code).toBe(0)
    expect(all(r)).toContain('scholario-platform')
    expect(all(r)).toContain('scholario-app')
    expect(all(r)).toContain('both active planes')
  })

  test('school plane missing CORE variables fails closed with the plane visible', async () => {
    state.envs.set(SCHOOL_PROJECT, ['DATABASE_URL']) // everything else missing
    try {
      const r = await runScript(script, [], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('MISSING')
      // the school plane's own listing ran (its report section printed)
      expect(all(r)).toContain(SCHOOL_PROJECT)
    } finally {
      state.envs.set(SCHOOL_PROJECT, makeState().envs.get(SCHOOL_PROJECT)!)
    }
  })
})

// ─── 2. verify-deployment — two-plane SHA provenance + health ─────────────

describe('verify-deployment (two planes)', () => {
  const script = 'scripts/prod-release/verify-deployment.ts'
  const goodEnv = () => ({
    VERCEL_TOKEN: 'mock-token-not-a-real-secret',
    VERCEL_PROJECT_ID: PLATFORM_PROJECT,
    VERCEL_PROJECT_ID_SCHOOL: SCHOOL_PROJECT,
    VERCEL_API_BASE: base(),
    PROD_RELEASE_POLL_INTERVAL_MS: '200',
  })

  test('MISSING school-project configuration fails closed', async () => {
    const env = goodEnv()
    delete env.VERCEL_PROJECT_ID_SCHOOL
    const r = await runScript(script, ['--sha', RELEASE_SHA], env)
    expect(r.code).not.toBe(0)
    expect(all(r)).toContain('VERCEL_PROJECT_ID_SCHOOL')
  })

  test('both planes on the exact release SHA + healthy → green (exit 0)', async () => {
    const r = await runScript(script, [
      '--sha', RELEASE_SHA,
      '--url', `${base()}/platform-plane`,
      '--url-school', `${base()}/school-plane`,
      '--timeout-seconds', '5',
    ], goodEnv())
    expect(r.code).toBe(0)
    expect(all(r)).toContain('both active planes required')
    expect(all(r)).toContain('RELEASE LIVE AND VERIFIED ON EVERY ACTIVE PLANE')
  })

  test('SHA mismatch on the PLATFORM project fails closed, naming the plane', async () => {
    state.deployments.set(PLATFORM_PROJECT, [{ uid: 'dpl_platform_stale', state: 'READY', createdAt: Date.now(), sha: OTHER_SHA }])
    try {
      const r = await runScript(script, ['--sha', RELEASE_SHA, '--url', `${base()}/platform-plane`, '--url-school', `${base()}/school-plane`, '--timeout-seconds', '5'], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[platform]')
      expect(all(r)).toContain('SHA mismatch')
    } finally {
      state.deployments.set(PLATFORM_PROJECT, makeState().deployments.get(PLATFORM_PROJECT)!)
    }
  })

  test('SHA mismatch on the SCHOOL project fails closed, naming the plane', async () => {
    state.deployments.set(SCHOOL_PROJECT, [{ uid: 'dpl_school_stale', state: 'READY', createdAt: Date.now(), sha: OTHER_SHA }])
    try {
      const r = await runScript(script, ['--sha', RELEASE_SHA, '--url', `${base()}/platform-plane`, '--url-school', `${base()}/school-plane`, '--timeout-seconds', '5'], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[school]')
      expect(all(r)).toContain('SHA mismatch')
    } finally {
      state.deployments.set(SCHOOL_PROJECT, makeState().deployments.get(SCHOOL_PROJECT)!)
    }
  })

  test('school plane with NO READY deployment fails closed (UNKNOWN = STOP)', async () => {
    state.deployments.set(SCHOOL_PROJECT, [{ uid: 'dpl_school_building', state: 'BUILDING', createdAt: Date.now(), sha: RELEASE_SHA }])
    try {
      const r = await runScript(script, ['--sha', RELEASE_SHA, '--url', `${base()}/platform-plane`, '--url-school', `${base()}/school-plane`, '--timeout-seconds', '5'], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[school]')
      expect(all(r)).toContain('no READY production deployment')
    } finally {
      state.deployments.set(SCHOOL_PROJECT, makeState().deployments.get(SCHOOL_PROJECT)!)
    }
  })

  test('unhealthy endpoint on the PLATFORM plane fails closed, naming the plane', async () => {
    state.healthStatus['/platform-plane/health/ready'] = 503
    try {
      const r = await runScript(script, ['--sha', RELEASE_SHA, '--url', `${base()}/platform-plane`, '--url-school', `${base()}/school-plane`, '--timeout-seconds', '3'], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[platform]')
      expect(all(r)).toContain('health probe failed')
    } finally {
      delete state.healthStatus['/platform-plane/health/ready']
    }
  })

  test('unhealthy endpoint on the SCHOOL plane fails closed, naming the plane', async () => {
    state.healthStatus['/school-plane/health/ready'] = 503
    try {
      const r = await runScript(script, ['--sha', RELEASE_SHA, '--url', `${base()}/platform-plane`, '--url-school', `${base()}/school-plane`, '--timeout-seconds', '3'], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[school]')
      expect(all(r)).toContain('health probe failed')
    } finally {
      delete state.healthStatus['/school-plane/health/ready']
    }
  })
})

// ─── 3. trigger-deploy-hooks — both hooks fire, fail-closed ────────────────

describe('trigger-deploy-hooks (two planes)', () => {
  const script = 'scripts/prod-release/trigger-deploy-hooks.ts'
  const PLATFORM_HOOK = '/hook/platform'
  const SCHOOL_HOOK = '/hook/school'
  const goodEnv = () => ({
    VERCEL_DEPLOY_HOOK_URL: `${base()}${PLATFORM_HOOK}`,
    VERCEL_DEPLOY_HOOK_URL_SCHOOL: `${base()}${SCHOOL_HOOK}`,
  })

  test('both hooks accepted → green (exit 0), both planes fired exactly once', async () => {
    const r = await runScript(script, [], goodEnv())
    expect(r.code).toBe(0)
    expect(all(r)).toContain('BOTH production deploy hooks accepted')
    expect(state.hookHits.filter((h) => h === PLATFORM_HOOK).length).toBe(1)
    expect(state.hookHits.filter((h) => h === SCHOOL_HOOK).length).toBe(1)
  })

  test('ONE hook failing (school hook 500) → RED run; BOTH hooks were still fired; partial-deploy backstop message', async () => {
    state.hookHits.length = 0
    state.hookStatus[SCHOOL_HOOK] = 500
    try {
      const r = await runScript(script, [], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[school]')
      // the platform hook fired too — maximal progress, then fail closed
      expect(state.hookHits.filter((h) => h === PLATFORM_HOOK).length).toBeGreaterThanOrEqual(1)
      expect(all(r)).toContain('verify-deployment')
    } finally {
      delete state.hookStatus[SCHOOL_HOOK]
      state.hookHits.length = 0
    }
  })

  test('ONE hook failing (platform hook 500) → RED run, school plane still fired', async () => {
    state.hookHits.length = 0
    state.hookStatus[PLATFORM_HOOK] = 500
    try {
      const r = await runScript(script, [], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[platform]')
      expect(state.hookHits.filter((h) => h === SCHOOL_HOOK).length).toBeGreaterThanOrEqual(1)
    } finally {
      delete state.hookStatus[PLATFORM_HOOK]
      state.hookHits.length = 0
    }
  })

  test('MISSING school-hook secret fails closed (no silent one-plane release)', async () => {
    const env = goodEnv()
    delete env.VERCEL_DEPLOY_HOOK_URL_SCHOOL
    const r = await runScript(script, [], env)
    expect(r.code).not.toBe(0)
    expect(all(r)).toContain('VERCEL_DEPLOY_HOOK_URL_SCHOOL')
  })

  test('a 4xx hook fails immediately — no retry storm (exactly one POST)', async () => {
    state.hookHits.length = 0
    state.hookStatus[PLATFORM_HOOK] = 403
    try {
      const r = await runScript(script, [], goodEnv())
      expect(r.code).not.toBe(0)
      expect(all(r)).toContain('[platform]')
      expect(state.hookHits.filter((h) => h === PLATFORM_HOOK).length).toBe(1)
    } finally {
      delete state.hookStatus[PLATFORM_HOOK]
      state.hookHits.length = 0
    }
  })
})

// ─── 4. release-gate — dry-run / no-deploy behavior (the REAL bash) ───────

describe('release-gate (dry-run / no-deploy — actual workflow bash)', () => {
  const workflow = readFileSync(join(ROOT, '.github/release.yml.parked'), 'utf8')

  /** Extract the gate step's `run: |` block (YAML block scalar) from the parked workflow. */
  function extractGateScript(yaml: string): string {
    const lines = yaml.split('\n')
    const gateIdx = lines.findIndex((l) => l.includes('name: Evaluate the gate'))
    expect(gateIdx).toBeGreaterThanOrEqual(0)
    const runLineIdx = lines.findIndex((l, i) => i > gateIdx && /^ {8}run: \|/.test(l))
    expect(runLineIdx).toBeGreaterThanOrEqual(0)
    const content: string[] = []
    for (let i = runLineIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (l.trim() === '') { content.push(''); continue }
      // block-scalar content: at least 10 spaces of indent (the `run: |`
      // key sits at 8; nested bash lines sit deeper — dedent by 10 keeps
      // the bash's own relative indentation intact)
      if (/^ {10}/.test(l)) { content.push(l.slice(10)); continue }
      break // block ended
    }
    expect(content.length).toBeGreaterThan(5)
    return content.join('\n')
  }

  const gateScript = extractGateScript(workflow)

  interface GateOutcome { code: number; output: string; summary: string }

  function runGate(env: Record<string, string>): GateOutcome {
    const dir = mkdtempSync(join(tmpdir(), 'release-gate-'))
    const outPath = join(dir, 'github_output')
    const sumPath = join(dir, 'github_summary')
    const scriptPath = join(dir, 'gate.sh')
    writeFileSync(scriptPath, gateScript)
    const child = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        GITHUB_OUTPUT: outPath,
        GITHUB_STEP_SUMMARY: sumPath,
        ...env,
      },
    })
    return {
      code: child.status ?? -1,
      output: readFileSync(outPath, 'utf8'),
      summary: readFileSync(sumPath, 'utf8'),
    }
  }

  const ALL_GREEN: Record<string, string> = {
    CI_RESULT: 'success',
    CFG_RESULT: 'success',
    PRE_RESULT: 'success',
    APP_RESULT: 'success',
    VER_RESULT: 'success',
    RELEASE_SHA: RELEASE_SHA,
  }

  test('dry-run ⇒ deployable=false, exit 0 — NOTHING deploys (non-mutating rehearsal)', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: 'true' })
    expect(r.code).toBe(0)
    expect(r.output).toContain('deployable=false')
    expect(r.summary).toContain('CLOSED (dry run)')
    expect(r.summary).toContain('no deployment will trigger')
  })

  test('all stages green (no dry run) ⇒ deployable=true — the ONLY path to the deploy job', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: '' })
    expect(r.code).toBe(0)
    expect(r.output).toContain('deployable=true')
    expect(r.summary).toContain('Release gate — OPEN')
  })

  test('ci failure ⇒ deployable=false + RED run (hooks can never fire)', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: '', CI_RESULT: 'failure' })
    expect(r.code).not.toBe(0)
    expect(r.output).toContain('deployable=false')
  })

  test('config-preflight failure ⇒ deployable=false + RED run', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: '', CFG_RESULT: 'failure' })
    expect(r.code).not.toBe(0)
    expect(r.output).toContain('deployable=false')
  })

  test('migration apply SKIPPED (as a dry-run dispatch leaves it) ⇒ deployable=false + RED run', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: '', APP_RESULT: 'skipped', VER_RESULT: 'skipped' })
    expect(r.code).not.toBe(0)
    expect(r.output).toContain('deployable=false')
    expect(r.summary).toContain('CLOSED')
  })

  test('migration verify CANCELLED ⇒ deployable=false + RED run (unknown = stopped)', () => {
    const r = runGate({ ...ALL_GREEN, DRY_RUN: '', VER_RESULT: 'cancelled' })
    expect(r.code).not.toBe(0)
    expect(r.output).toContain('deployable=false')
  })

  test('the extracted gate really is the workflow\'s gate (marker lines present in the YAML)', () => {
    expect(gateScript).toContain('deployable=true')
    expect(gateScript).toContain('deployable=false')
    expect(gateScript).toContain('DRY_RUN')
    expect(workflow).toContain('name: Evaluate the gate')
  })
})

// ─── 5. Workflow wiring (static) — hooks only after the gate, both planes ──

describe('release.yml.parked wiring (two-plane static contract)', () => {
  const wf = readFileSync(join(ROOT, '.github/release.yml.parked'), 'utf8')
  const deployJobStart = wf.indexOf('  deploy:')
  const deployJobEnd = wf.indexOf('  verify-deployment:')
  const deployJob = wf.slice(deployJobStart, deployJobEnd)

  test('the deploy job runs ONLY after the release-gate opened', () => {
    expect(deployJob).toContain('needs: release-gate')
    expect(deployJob).toContain("needs.release-gate.outputs.deployable == 'true'")
  })

  test('the deploy job fires ONLY on an explicit trigger (push mode or deploy_after_gate)', () => {
    expect(deployJob).toContain("github.event_name == 'push' || inputs.deploy_after_gate == true")
  })

  test('the deploy job fires BOTH plane deploy hooks via trigger-deploy-hooks.ts', () => {
    expect(deployJob).toContain('bun scripts/prod-release/trigger-deploy-hooks.ts')
    expect(deployJob).toContain('VERCEL_DEPLOY_HOOK_URL: ${{ secrets.VERCEL_DEPLOY_HOOK_URL }}')
    expect(deployJob).toContain('VERCEL_DEPLOY_HOOK_URL_SCHOOL: ${{ secrets.VERCEL_DEPLOY_HOOK_URL_SCHOOL }}')
  })

  test('the config-preflight job carries the SCHOOL plane project secret', () => {
    const configJob = wf.slice(wf.indexOf('  config-preflight:'), wf.indexOf('  migration-preflight:'))
    expect(configJob).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}')
    expect(configJob).toContain('VERCEL_PROJECT_ID_SCHOOL: ${{ secrets.VERCEL_PROJECT_ID_SCHOOL }}')
  })

  test('the verify-deployment job verifies BOTH planes (school project + school URL)', () => {
    const verifyJob = wf.slice(deployJobEnd)
    expect(verifyJob).toContain('VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}')
    expect(verifyJob).toContain('VERCEL_PROJECT_ID_SCHOOL: ${{ secrets.VERCEL_PROJECT_ID_SCHOOL }}')
    expect(verifyJob).toContain('PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}')
    expect(verifyJob).toContain('PRODUCTION_URL_SCHOOL: ${{ secrets.PRODUCTION_URL_SCHOOL }}')
    expect(verifyJob).toContain('--url-school')
  })

  test('migration stages run BEFORE the gate (DATABASE FIRST, APPLICATION SECOND)', () => {
    const gateNeeds = /release-gate:\s*\n\s*name:.*\n\s*needs: \[[^\]]*\]/
    const m = wf.match(gateNeeds)
    expect(m).toBeTruthy()
    const needs = m![0]
    expect(needs).toContain('ci')
    expect(needs).toContain('config-preflight')
    expect(needs).toContain('migration-preflight')
    expect(needs).toContain('migration-apply')
    expect(needs).toContain('migration-verify')
  })

  test('the deprecated scholario-production is NEVER a release target (comment-only mentions)', () => {
    const mentions = wf.split('\n').filter((l) => l.includes('scholario-production'))
    expect(mentions.length).toBeGreaterThan(0) // the deprecation note exists…
    for (const line of mentions) {
      expect(line.trim().startsWith('#')).toBe(true) // …and every mention is a comment
    }
  })

  test('verify-deployment.ts defaults point at the two ACTIVE planes only', () => {
    const src = readFileSync(join(ROOT, 'scripts/prod-release/verify-deployment.ts'), 'utf8')
    expect(src).toContain("DEFAULT_PLATFORM_URL = 'https://scholario-platform.vercel.app'")
    expect(src).toContain("DEFAULT_SCHOOL_URL = 'https://scholario-app-virid.vercel.app'")
    expect(src).not.toContain('scholario-production.vercel.app')
  })

  test('prod-migration/verify.ts probes BOTH planes via planesHealthGate (no deprecated default)', () => {
    const src = readFileSync(join(ROOT, 'scripts/prod-migration/verify.ts'), 'utf8')
    expect(src).toContain('planesHealthGate')
    expect(src).not.toContain('scholario-production.vercel.app')
    expect(src).toContain('--health-url-school')
  })
})

// ─── 6. planesHealthGate — migration Stage F unit behavior ─────────────────

describe('planesHealthGate (prod-migration Stage F)', () => {
  test('the default health URLs are the two ACTIVE planes (never the deprecated project)', () => {
    expect(ACTIVE_PRODUCTION_HEALTH_URLS.platform).toBe('https://scholario-platform.vercel.app/health/ready')
    expect(ACTIVE_PRODUCTION_HEALTH_URLS.school).toBe('https://scholario-app-virid.vercel.app/health/ready')
    expect(Object.values(ACTIVE_PRODUCTION_HEALTH_URLS).every((u) => !u.includes('scholario-production'))).toBe(true)
  })

  test('both planes healthy → no problems', async () => {
    const state2 = makeState()
    const mock2 = await startMockServer(state2)
    try {
      const g = await planesHealthGate({
        platform: `${base2(mock2.port)}/plane-a/health/ready`,
        school: `${base2(mock2.port)}/plane-b/health/ready`,
      })
      expect(g.problems).toEqual([])
      expect(g.results).toHaveLength(2)
      expect(g.results.every((r) => r.ok)).toBe(true)
    } finally {
      mock2.server.close()
    }
  })

  test('platform plane unhealthy → problem names the platform plane (fail-closed)', async () => {
    const state2 = makeState()
    state2.healthStatus['/plane-a/health/ready'] = 503
    const mock2 = await startMockServer(state2)
    try {
      const g = await planesHealthGate({
        platform: `${base2(mock2.port)}/plane-a/health/ready`,
        school: `${base2(mock2.port)}/plane-b/health/ready`,
      })
      expect(g.problems).toHaveLength(1)
      expect(g.problems[0]).toContain('[platform plane]')
      expect(g.results.find((r) => r.plane === 'platform')?.ok).toBe(false)
      expect(g.results.find((r) => r.plane === 'school')?.ok).toBe(true)
    } finally {
      mock2.server.close()
    }
  })

  test('school plane unhealthy → problem names the school plane (fail-closed)', async () => {
    const state2 = makeState()
    state2.healthStatus['/plane-b/health/ready'] = 503
    const mock2 = await startMockServer(state2)
    try {
      const g = await planesHealthGate({
        platform: `${base2(mock2.port)}/plane-a/health/ready`,
        school: `${base2(mock2.port)}/plane-b/health/ready`,
      })
      expect(g.problems).toHaveLength(1)
      expect(g.problems[0]).toContain('[school plane]')
      expect(g.results.find((r) => r.plane === 'school')?.ok).toBe(false)
    } finally {
      mock2.server.close()
    }
  })
})
