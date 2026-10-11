/**
 * scripts/prod-release/verify-deployment.ts — FINAL STAGE of the production
 * release pipeline (RELEASE-PIPELINE-1; the Vercel-deployment sibling of
 * scripts/prod-migration/verify.ts — it closes the final-verification gap
 * AFTER the Vercel deployment step).
 *
 * TWO-PLANE CONTRACT (Batch 2, 2026-10-10): the active production topology
 * is TWO Vercel projects — `scholario-platform` (control plane) and
 * `scholario-app` (school plane). The deprecated `scholario-production`
 * (unified legacy) is NOT a release surface and is never verified here.
 * Both active planes must be built from the EXACT approved release SHA and
 * serve a healthy `/health/ready` — a release that is only live on ONE
 * plane is NOT released (fail-closed).
 *
 * Per plane it proves two things and fails CLOSED otherwise:
 *   (a) the CURRENT production deployment was built from the exact release
 *       commit — the LATEST READY production deployment's git SHA metadata
 *       (Vercel deployment meta) must equal the expected SHA. A deployment
 *       whose SHA cannot be established is a STOP — UNKNOWN is never a pass.
 *   (b) that plane's /health/ready answers HTTP 200 with "database":"ok".
 *
 * SAFETY RULES (same contract as scripts/prod-migration/lib.ts):
 *   · VERCEL_TOKEN is read from the environment and is never printed,
 *     logged, or written to disk — it only ever travels inside the
 *     Authorization header.
 *   · API and health bodies are clipped before printing (200 chars):
 *     deployment metadata carries SHAs/states/repo names only and health
 *     bodies carry probe JSON — neither contains secrets, clipping is
 *     defense in depth.
 *   · Read-only: the script only ever GETs (deployment listings + health).
 *   · VERCEL_API_BASE (optional, default https://api.vercel.com) — redirect
 *     target used ONLY by the local test harness
 *     (tests/regression/release-two-plane.test.ts) to point the script at a
 *     mock Vercel API. The Release workflow never sets it; production runs
 *     always talk to the real API.
 *
 * Usage (default: BOTH active planes):
 *   VERCEL_TOKEN=… \
 *   VERCEL_PROJECT_ID=<platform project id> \
 *   VERCEL_PROJECT_ID_SCHOOL=<school project id> \
 *   [VERCEL_ORG_ID=team-scope] \
 *   [PRODUCTION_URL=https://scholario-platform.vercel.app] \
 *   [PRODUCTION_URL_SCHOOL=https://scholario-app-virid.vercel.app] \
 *     bun scripts/prod-release/verify-deployment.ts \
 *       [--sha <expected sha>] \
 *       [--plane both|platform|school] \
 *       [--url https://scholario-platform.vercel.app] \
 *       [--url-school https://scholario-app-virid.vercel.app] \
 *       [--timeout-seconds 240]
 *
 * --sha defaults to `git rev-parse HEAD`; --url/--url-school override the
 * per-plane production domains (env PRODUCTION_URL / PRODUCTION_URL_SCHOOL
 * do the same); --timeout-seconds is the per-plane health poll budget (one
 * probe every 10s, 20s timeout per fetch). --plane narrows verification to
 * ONE plane explicitly (both planes remain the default and the release
 * workflow never narrows it).
 *
 * Exit codes: 0 = release live and verified on every requested plane; 1 =
 * STOP (fail-closed).
 */
import { spawnSync } from 'node:child_process'

const API_BASE = (process.env.VERCEL_API_BASE ?? 'https://api.vercel.com').trim().replace(/\/+$/, '')
const API_TIMEOUT_MS = 20_000
const API_RETRIES = 3
const HEALTH_TIMEOUT_MS = 20_000
/**
 * Health poll cadence (default 10s). PROD_RELEASE_POLL_INTERVAL_MS is a
 * test-harness override ONLY (tests/regression/release-two-plane.test.ts
 * shrinks it to keep unhealthy-plane cases fast); the Release workflow never
 * sets it and production always polls at the 10s default.
 */
const POLL_INTERVAL_MS = (() => {
  const raw = Number(process.env.PROD_RELEASE_POLL_INTERVAL_MS)
  return Number.isFinite(raw) && raw >= 100 ? raw : 10_000
})()
const DEFAULT_BUDGET_SECONDS = 240

/** The active production topology — exactly these two planes. */
const DEFAULT_PLATFORM_URL = 'https://scholario-platform.vercel.app'
const DEFAULT_SCHOOL_URL = 'https://scholario-app-virid.vercel.app'

interface PlaneSpec {
  key: 'platform' | 'school'
  label: string
  projectId: string
  url: string
}

interface Deployment {
  uid?: string
  state?: string
  createdAt?: number
  meta?: { githubCommitSha?: string; gitlabCommitSha?: string }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[prod-release] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`[prod-release:verify-deployment] ${flag} requires a value`)
    process.exit(1)
  }
  return v
}

/** HEAD commit of this checkout (the default expected release SHA). */
function gitSha(): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 })
    return r.status === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

/**
 * GET one Vercel API JSON document. Transport failures (5xx / timeout /
 * network) are retried with backoff — the scripts/prod-migration/lib.ts
 * pattern — and the token only ever travels in the Authorization header.
 */
async function vercelGetJson(path: string, token: string, attempt = 1): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status >= 500 && attempt < API_RETRIES) {
        console.warn(
          `[prod-release:verify-deployment] Vercel API HTTP ${res.status} — retrying (${attempt}/${API_RETRIES - 1})…`,
        )
        await sleep(1500 * attempt)
        return vercelGetJson(path, token, attempt + 1)
      }
      throw new Error(`Vercel API rejected the deployment listing (HTTP ${res.status}): ${clip(text, 200)}`)
    }
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Vercel API returned a non-JSON body (HTTP ${res.status}): ${clip(text, 200)}`)
    }
  } catch (err) {
    const e = err as Error
    const retriable = e.name === 'AbortError' || e.name === 'TypeError' // timeout / network-level fetch failure
    if (retriable && attempt < API_RETRIES) {
      console.warn(
        `[prod-release:verify-deployment] transport hiccup (${e.name}) — retrying (${attempt}/${API_RETRIES - 1})…`,
      )
      await sleep(1500 * attempt)
      return vercelGetJson(path, token, attempt + 1)
    }
    if (retriable) {
      throw new Error(`Vercel API unreachable after ${attempt} attempt(s) (${e.name}: ${clip(e.message, 120)})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Defensive body unwrapping: bare array / { deployments: […] } / { result: […] }. */
function deploymentsOf(body: unknown): Deployment[] {
  if (Array.isArray(body)) return body as Deployment[]
  if (!body || typeof body !== 'object') return []
  const b = body as { deployments?: unknown; result?: unknown }
  if (Array.isArray(b.deployments)) return b.deployments as Deployment[]
  if (Array.isArray(b.result)) return b.result as Deployment[]
  return []
}

/** Recent production deployments (v6 list endpoint; SHA + state metadata only). */
async function recentProductionDeployments(
  projectId: string,
  orgId: string | undefined,
  token: string,
): Promise<Deployment[]> {
  const params = new URLSearchParams({ projectId, target: 'production', limit: '5' })
  if (orgId) params.set('teamId', orgId)
  const body = await vercelGetJson(`/v6/deployments?${params.toString()}`, token)
  return deploymentsOf(body)
}

/** GET a health body with a hard 20s timeout per fetch. */
async function probeHealth(url: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const body = await res.text()
    return { status: res.status, body: clip(body, 200) }
  } catch (err) {
    const e = err as Error
    return { status: 0, body: `probe failed (${e.name}: ${clip(e.message, 120)})` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Verify ONE plane: (a) provenance — the LATEST READY production deployment
 * of this project is built from the exact release SHA (UNKNOWN = STOP);
 * (b) health — that plane's /health/ready answers 200 database:ok within
 * the poll budget. Throws on any failure (the caller fails closed).
 */
async function verifyPlane(plane: PlaneSpec, orgId: string | undefined, token: string, sha: string, timeoutSeconds: number): Promise<void> {
  console.log(`\n  ── plane: ${plane.label} (${plane.projectId}) ──`)

  // Gate 1 — provenance: the CURRENT production deployment must be tied to
  // the exact release commit. UNKNOWN is a STOP, never a pass.
  const deployments = await recentProductionDeployments(plane.projectId, orgId, token)
  const ready = deployments.filter((d) => d.state === 'READY')
  if (!ready.length) {
    const recent =
      deployments.map((d) => `${d.uid ?? '?'}=${d.state ?? '?'}`).join(', ') || 'no deployments returned'
    throw new Error(`[${plane.key}] no READY production deployment found (recent: ${recent}) — cannot tie production to the release commit (UNKNOWN = STOP)`)
  }
  const latest = ready.reduce((a, b) => ((b.createdAt ?? 0) > (a.createdAt ?? 0) ? b : a))
  const createdAt = latest.createdAt ? new Date(latest.createdAt).toISOString() : 'unknown time'
  const deployedSha = (latest.meta?.githubCommitSha ?? latest.meta?.gitlabCommitSha ?? '').trim().toLowerCase()
  if (!latest.meta || !deployedSha) {
    console.log(`  deployment  : ${latest.uid ?? '?'} (state ${latest.state ?? '?'}, created ${createdAt}) — no git SHA metadata ✖`)
    throw new Error(`[${plane.key}] production deployment carries no git SHA metadata — cannot tie it to the release commit (UNKNOWN = STOP)`)
  }
  if (deployedSha !== sha) {
    console.log(`  deployment  : ${latest.uid ?? '?'} READY built from ${deployedSha.slice(0, 10)} ✖ (state READY, created ${createdAt})`)
    throw new Error(`[${plane.key}] deployment SHA mismatch — production serves ${deployedSha} but the release commit is ${sha}`)
  }
  console.log(`  deployment  : ${latest.uid ?? '?'} READY built from ${deployedSha.slice(0, 10)} ✓ (state READY, created ${createdAt})`)

  // Gate 2 — health: poll /health/ready until the budget is spent.
  const healthUrl = `${plane.url}/health/ready`
  const budgetMs = timeoutSeconds * 1000
  const startedAt = Date.now()
  let last: { status: number; body: string } = { status: 0, body: '(no probe completed yet)' }
  let healthy = false
  let polls = 0
  while (Date.now() - startedAt <= budgetMs) {
    polls += 1
    last = await probeHealth(healthUrl)
    if (last.status === 200 && last.body.includes('"database":"ok"')) {
      healthy = true
      break
    }
    const remainingMs = budgetMs - (Date.now() - startedAt)
    if (remainingMs > 0) {
      console.log(
        `  … health probe ${polls}: HTTP ${last.status === 0 ? 'unreachable' : last.status} — next poll in ${Math.round(POLL_INTERVAL_MS / 1000)}s (${Math.round(remainingMs / 1000)}s of budget left)`,
      )
      await sleep(POLL_INTERVAL_MS)
    }
  }
  if (!healthy) {
    console.error(`  health      : HTTP ${last.status} ${last.body} ✖ (${timeoutSeconds}s budget exhausted, ${polls} poll(s))`)
    throw new Error(`[${plane.key}] health probe failed at ${healthUrl} — last response HTTP ${last.status}: ${clip(last.body, 200)}`)
  }
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`  health      : ${last.status} ${last.body} ✓ (after ${seconds}s)`)
}

/** Resolve the planes to verify from env + flags (default: BOTH active planes). */
function resolvePlanes(): PlaneSpec[] {
  const planeFlag = (argValue('--plane') ?? 'both').toLowerCase()
  if (!['both', 'platform', 'school'].includes(planeFlag)) {
    console.error('[prod-release:verify-deployment] --plane must be one of: both | platform | school')
    process.exit(1)
  }
  const flagUrl = argValue('--url')
  const flagUrlSchool = argValue('--url-school')
  const envPlatformUrl = (process.env.PRODUCTION_URL ?? '').trim() || undefined
  const envSchoolUrl = (process.env.PRODUCTION_URL_SCHOOL ?? '').trim() || undefined

  const planes: PlaneSpec[] = []
  if (planeFlag === 'both' || planeFlag === 'platform') {
    planes.push({
      key: 'platform',
      label: 'scholario-platform (control plane)',
      projectId: requireEnv('VERCEL_PROJECT_ID'),
      url: (flagUrl ?? envPlatformUrl ?? DEFAULT_PLATFORM_URL).replace(/\/+$/, ''),
    })
  }
  if (planeFlag === 'both' || planeFlag === 'school') {
    planes.push({
      key: 'school',
      label: 'scholario-app (school plane)',
      projectId: requireEnv('VERCEL_PROJECT_ID_SCHOOL'),
      url: (flagUrlSchool ?? envSchoolUrl ?? DEFAULT_SCHOOL_URL).replace(/\/+$/, ''),
    })
  }
  return planes
}

async function main(): Promise<void> {
  const token = requireEnv('VERCEL_TOKEN')
  const orgId = (process.env.VERCEL_ORG_ID ?? '').trim() || undefined
  const planes = resolvePlanes()
  const timeoutSeconds = Number(argValue('--timeout-seconds') ?? DEFAULT_BUDGET_SECONDS)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error('[prod-release:verify-deployment] --timeout-seconds must be a positive integer')
    process.exit(1)
  }
  const sha = (argValue('--sha') ?? gitSha() ?? '').trim().toLowerCase()
  if (!sha) {
    throw new Error('--sha is required and git rev-parse HEAD failed (not a git checkout?)')
  }

  console.log('[prod-release:verify-deployment] ═══ PRODUCTION DEPLOYMENT VERIFICATION (two-plane) ═══')
  console.log(`  release sha : ${sha}`)
  console.log(`  planes      : ${planes.map((p) => p.key).join(' + ')}${planes.length === 1 ? ' (single-plane mode — explicit)' : ' (both active planes required)'}`)

  // Every requested plane must pass BOTH gates; the first failure STOPS the
  // whole verification (fail-closed — no partial release).
  for (const plane of planes) {
    await verifyPlane(plane, orgId, token, sha, timeoutSeconds)
  }

  console.log('\n[prod-release:verify-deployment] ✓ RELEASE LIVE AND VERIFIED ON EVERY ACTIVE PLANE')
}

main().catch((err) => {
  console.error(`\n[prod-release:verify-deployment] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
