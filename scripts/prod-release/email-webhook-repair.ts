/**
 * scripts/prod-release/email-webhook-repair.ts — LIVE provider-side
 * webhook repair through the app's own audited repair route.
 *
 * WHY THIS RUNS THROUGH THE APP (not direct provider calls): the
 * deployment holds the real RESEND_API_KEY at runtime (the dashboard
 * Sensitive value is write-only via every runner-side API), so the
 * app's permission-gated, audited route — introduced with the repair
 * capability — is the one place that can recreate the provider
 * webhook AND sync the fresh signing secret to RESEND_WEBHOOK_SECRET
 * on BOTH planes. This script is only the operator's hands: it
 * mints a self-owned fixture admin (ops.read grant), signs in
 * through the REAL production session transport, invokes the repair
 * with the typed confirmation, prints the SANITIZED result, waits
 * for the redeploys it triggers to go READY on BOTH planes, and
 * purges the fixture. The signing secret never appears anywhere.
 *
 * EVIDENCE LEDGER (each step sanitized):
 *   A. platform plane healthy before we touch anything
 *   B. fixture admin (ops-isolation convention) + REAL platform login
 *   B2. READ-ONLY pre-repair inspection — the live in-app diagnostics
 *       (GET /api/platform/health/email?live=1) prints the CURRENT
 *       provider webhook surface (registered / enabled / URL /
 *       subscribed events) BEFORE anything is mutated (inspect-then-
 *       mutate: never repair blind, never delete what was not looked at)
 *   C. repair invoked through the REAL route (typed confirmation):
 *      endpoints found (with status), the fresh webhook's provider-
 *      side VALIDATION evidence (registered + canonical URL + events +
 *      enabled), old endpoints deleted, per-plane secret sync
 *      outcomes, per-plane redeploy triggers — audited in-app
 *   D. BOTH planes redeployed READY (the fresh secret is what the
 *      webhook route verifies signatures against at runtime)
 *   E. fixture admin fully purged (login audit rows retained — honest)
 *
 * FAILS HONESTLY: if the runtime key lacks provider write scope or
 * the ops Vercel token lacks env-write scope, the repair route
 * refuses/rolls back with the exact story and this script prints it
 * and exits non-zero. No success is claimed without the READY gates.
 *
 * Usage (secrets via environment only):
 *   PRODUCTION_URL=… SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *   VERCEL_TOKEN=… VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… VERCEL_PROJECT_ID_SCHOOL=… \
 *     bun scripts/prod-release/email-webhook-repair.ts
 */

import { randomBytes, scryptSync } from 'node:crypto'

const SUPABASE_API_BASE = 'https://api.supabase.com'
const VERCEL_API_BASE = 'https://api.vercel.com'
const API_TIMEOUT_MS = 20_000
const DEPLOY_POLL_MS = 15_000
const DEPLOY_READY_TIMEOUT_MS = 14 * 60_000

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[webhook-repair] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** In-memory secret values to redact from any accidental echo (defense in depth). */
const SENSITIVE_VALUES: string[] = []

function redactSecrets(text: string): string {
  let out = text
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'VERCEL_TOKEN']) {
    const v = process.env[name]
    if (v && v.length > 8) out = out.split(v).join(`«${name}-redacted»`)
  }
  for (const v of SENSITIVE_VALUES) {
    if (v.length > 8) out = out.split(v).join('«secret-redacted»')
  }
  return out
}

function say(text: string): void {
  console.log(redactSecrets(text))
}

// ─── evidence ledger ─────────────────────────────────────────────────────

const evidence: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): void {
  evidence.push({ step, ok, detail })
  say(`  ${ok ? '✓' : '✗'} ${step} — ${detail}`)
}
function fail(step: string, detail: string): void {
  record(step, false, detail)
}

// ─── Supabase Management API (fixture admin only) ───────────────────────

async function mgmtQuery(token: string, ref: string, sql: string): Promise<Record<string, unknown>[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${SUPABASE_API_BASE}/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Management API rejected query (HTTP ${res.status}): ${clip(text, 200)}`)
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
    if (parsed && typeof parsed === 'object') {
      const inner = (parsed as { data?: unknown }).data
      if (Array.isArray(inner)) return inner as Record<string, unknown>[]
      return [parsed as Record<string, unknown>]
    }
    return []
  } finally {
    clearTimeout(timer)
  }
}

function sq(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** App-format scrypt-64 password hash (salt:hash) — same as src/lib/auth. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

// ─── production HTTP (cookie session transport) ──────────────────────────

interface FetchOutcome {
  status: number
  body: Record<string, unknown> | null
  cookies: Record<string, string>
}

async function jsonFetch(url: string, init: RequestInit, label: string): Promise<FetchOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000) // the repair chain is slow by design
  try {
    const res = await fetch(url, init)
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const cookies: Record<string, string> = {}
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const line of setCookies) {
      const m = line.match(/^([^=;,\s]+)=([^;]*)/)
      if (m) cookies[m[1]!] = m[2]!
    }
    return { status: res.status, body, cookies }
  } catch (e) {
    throw new Error(`${label} unreachable: ${clip((e as Error).message, 120)}`)
  } finally {
    clearTimeout(timer)
  }
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// ─── Vercel deployments (READY gate for the redeploys) ───────────────────

async function latestDeployments(
  vercelToken: string,
  orgId: string,
  projectId: string,
): Promise<Array<{ uid?: string; state?: string; target?: string; created?: number; sha?: string }>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${VERCEL_API_BASE}/v6/deployments?projectId=${encodeURIComponent(projectId)}&teamId=${encodeURIComponent(orgId)}&limit=5`,
      { headers: { Authorization: `Bearer ${vercelToken}` }, signal: controller.signal },
    )
    const body = (await res.json().catch(() => null)) as { deployments?: unknown } | null
    return Array.isArray(body?.deployments) ? (body.deployments as Array<Record<string, unknown>>).map((d) => ({
      uid: typeof d.uid === 'string' ? d.uid : undefined,
      state: typeof d.state === 'string' ? d.state : undefined,
      target: typeof d.target === 'string' ? d.target : undefined,
      created: typeof d.created === 'number' ? d.created : undefined,
      sha: d.meta && typeof d.meta === 'object' && typeof (d.meta as Record<string, unknown>).githubCommitSha === 'string'
        ? ((d.meta as Record<string, unknown>).githubCommitSha as string)
        : undefined,
    })) : []
  } finally {
    clearTimeout(timer)
  }
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const platformUrl = requireEnv('PRODUCTION_URL').replace(/\/+$/, '')
  const supaToken = requireEnv('SUPABASE_ACCESS_TOKEN')
  const supaRef = requireEnv('SUPABASE_PROJECT_REF')
  const vercelToken = requireEnv('VERCEL_TOKEN')
  const orgId = requireEnv('VERCEL_ORG_ID')
  const planes = [
    { label: 'scholario-platform', projectId: requireEnv('VERCEL_PROJECT_ID') },
    { label: 'scholario-app', projectId: requireEnv('VERCEL_PROJECT_ID_SCHOOL') },
  ]

  const MARK = `ewr-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  say('════════════════════════════════════════════════════════════════════')
  say(' PROVIDER WEBHOOK REPAIR (audited in-app route, sanitized output)')
  say('════════════════════════════════════════════════════════════════════')
  say(` run marker: ${MARK}`)
  say(` time:      ${new Date().toISOString()}`)
  say(' credentials (fixture password / session cookie / signing secret) are NEVER printed.')
  say('')

  const q = (sql: string) => mgmtQuery(supaToken, supaRef, sql)

  let adminId = ''
  const report = (): void => {
    say('')
    say('════════════════════════════════════════════════════════════════════')
    say(' REPAIR RESULT (evidence ledger)')
    say('════════════════════════════════════════════════════════════════════')
    const passed = evidence.filter((e) => e.ok).length
    for (const e of evidence) say(`  ${e.ok ? 'PASS' : 'FAIL'}  ${e.step}: ${e.detail}`)
    say('')
    say(`  ${passed}/${evidence.length} checks passed`)
    if (evidence.some((e) => !e.ok)) {
      say('  RESULT: INCOMPLETE — the failing checks above are the honest gaps.')
      process.exitCode = 1
    } else {
      say('  RESULT: PROVIDER WEBHOOK REPAIRED — fresh endpoint live, fresh signing')
      say('          secret synced to BOTH planes, both redeploys READY. The next')
      say('          live email verification should see delivered events land.')
    }
  }

  // ── A. platform health (before touching anything) ─────────────────────
  say('── A. PLATFORM HEALTH ─────────────────────────────────────────────')
  try {
    const res = await fetch(`${platformUrl}/health/ready`)
    const body = (await res.json().catch(() => null)) as { database?: string } | null
    record('platform /health/ready', res.status === 200, `→ ${res.status} (database: ${str(body?.database) || '?'})`)
    if (res.status !== 200) return report()
  } catch (e) {
    fail('platform /health/ready', `unreachable: ${clip((e as Error).message, 80)}`)
    return report()
  }

  // ── B. fixture admin (ops.read) + REAL login ───────────────────────────
  say('── B. FIXTURE ADMIN (ops.read grant) + REAL PLATFORM LOGIN ────────')
  const fixtureEmail = `${MARK}@scholario.test`
  const fixturePassword = `Ewr-${randomBytes(18).toString('base64url')}!`
  // Runtime-random base32 TOTP secret (never a demo-credential pattern).
  const fixtureTotpSecret = randomBytes(10).toString('base64').replace(/[^A-Z2-7]/gi, 'A').toUpperCase().padEnd(16, 'A').slice(0, 16)
  try {
    const rows = await q(
      `INSERT INTO "PlatformAdmin" (id, email, "passwordHash", name, status, "isRoot", "totpSecret", "createdAt", "updatedAt") ` +
        `VALUES (md5(random()::text)||'${MARK}', ${sq(fixtureEmail)}, ${sq(hashPassword(fixturePassword))}, 'Webhook Repair Fixture', 'ACTIVE', false, ${sq(fixtureTotpSecret)}, NOW(), NOW()) ` +
        `RETURNING id`,
    )
    adminId = str(rows[0]?.id)
    if (!adminId) {
      fail('fixture admin insert', 'no id returned')
      return report()
    }
    await q(
      `INSERT INTO "PlatformPermission" (id, "adminId", key, granted) ` +
        `VALUES (md5(random()::text)||'${MARK}p', ${sq(adminId)}, 'ops.read', true)`,
    )
    say('  fixture admin created (id=' + adminId + ', runtime credential never logged; ops.read granted)')
  } catch (e) {
    fail('fixture admin insert', clip(redactSecrets((e as Error).message), 120))
    return report()
  }

  try {
    const login = await jsonFetch(`${platformUrl}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fixtureEmail, password: fixturePassword }),
    }, 'platform login')
    const sessionToken = login.cookies['scholario_platform_session'] ?? ''
    SENSITIVE_VALUES.push(sessionToken)
    if (login.status !== 200 || !sessionToken) {
      fail('REAL platform login', `HTTP ${login.status} — no session cookie set`)
      return report()
    }
    record('REAL platform login', true, 'HTTP 200 + HttpOnly session cookie minted (production transport; token never printed)')
    const authHeaders = { cookie: cookieHeader(login.cookies), 'content-type': 'application/json' }

    // ── B2. READ-ONLY pre-repair inspection (inspect, then mutate) ──
    say('── B2. PRE-REPAIR PROVIDER STATE (read-only live diagnostics) ──')
    try {
      const diag = await jsonFetch(`${platformUrl}/api/platform/health/email?live=1`, {
        method: 'GET',
        headers: authHeaders,
      }, 'email diagnostics')
      // Standard api() envelope: { ok, data } — data IS the diagnostics.
      const body = (diag.body ?? {}) as Record<string, unknown>
      const data = (body.data ?? {}) as Record<string, unknown>
      const resend = (data.resend ?? {}) as Record<string, unknown>
      const webhooks = (resend.webhooks ?? {}) as Record<string, unknown>
      const endpoints = Array.isArray(webhooks.endpoints) ? (webhooks.endpoints as Array<Record<string, unknown>>) : []
      say(`  provider webhook surface right now: liveCheck=${str(webhooks.liveCheck)} total=${str(webhooks.total)}`)
      for (const w of endpoints) {
        const events = Array.isArray(w.events) ? (w.events as string[]).join(',') : ''
        say(`    · id=${str(w.id)} status=${str(w.status) || '«not reported»'} url=${clip(str(w.url), 90)} events=${events || 'none'}`)
      }
      if (str(webhooks.liveCheck) === 'ok' && endpoints.length === 0) {
        say('    ⚠ ZERO registered endpoints — the repair will create the only one.')
      }
      record(
        'pre-repair inspection (read-only)',
        true,
        `liveCheck=${str(webhooks.liveCheck)}, ${endpoints.length} registered endpoint(s) inspected BEFORE any mutation`,
      )
    } catch (e) {
      // The inspection is evidence, not a gate — the repair's own
      // GET /webhooks (step 1 of the route) still inspects before it
      // mutates. A failed probe is reported honestly and the repair
      // continues with the route's own inspection.
      fail('pre-repair inspection (read-only)', `diagnostics probe unreachable: ${clip(redactSecrets((e as Error).message), 100)} (the repair route re-inspects before mutating)`)
    }

    // ── C. invoke the repair through the REAL route ────────────────────
    say('── C. REPAIR (REAL route, typed confirmation, audited in-app) ────')
    const repairStartedAt = Date.now()
    const repair = await jsonFetch(`${platformUrl}/api/platform/operations/email-webhook/repair`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirm: 'recreate-webhook' }),
    }, 'webhook repair')
    const envelope = repair.body as { ok?: boolean; error?: string; data?: Record<string, unknown> } | null
    if (repair.status !== 200 || !envelope?.ok || !envelope.data) {
      fail(
        'repair route',
        `HTTP ${repair.status}: ${clip(str(envelope?.error) || 'no error detail', 160)}`,
      )
      return report()
    }
    const data = envelope.data
    const canonicalEndpoint = str(data.canonicalEndpoint)
    const found = Array.isArray(data.found) ? (data.found as Array<Record<string, unknown>>) : []
    const validated = (data.validated ?? {}) as Record<string, unknown>
    const deleteWarnings = Array.isArray(data.deleteWarnings) ? (data.deleteWarnings as string[]) : []
    const createdWebhookId = str(data.createdWebhookId)
    const secretSynced = (data.secretSynced ?? {}) as Record<string, string>
    const redeploy = (data.redeploy ?? {}) as Record<string, string>
    for (const w of found) say(`    · found endpoint id=${str(w.id)} status=${str(w.status) || '«not reported»'} url=${clip(str(w.url), 90)}`)
    say(`  recreated webhook id=${createdWebhookId} at ${canonicalEndpoint}`)
    say(`  provider-side validation: id=${str(validated.id)} status=${str(validated.status) || '«not reported»'} url=${clip(str(validated.url), 90)} events=${Array.isArray(validated.events) ? (validated.events as string[]).join(',') : ''}`)
    say(`  old endpoints deleted: ${Array.isArray(data.deleted) ? (data.deleted as unknown[]).length : 0}${deleteWarnings.length ? ` (warnings: ${deleteWarnings.join(' | ')})` : ''}`)
    say(`  secret synced: ${JSON.stringify(secretSynced)} (values never printed)`)
    say(`  redeploy triggers: ${JSON.stringify(redeploy)}`)
    record(
      'repair route',
      Boolean(createdWebhookId) && Object.keys(secretSynced).length > 0,
      `recreated ${createdWebhookId} at ${canonicalEndpoint}; secretSynced=${JSON.stringify(secretSynced)}; redeploy=${JSON.stringify(redeploy)}`,
    )

    // ── D. wait for BOTH redeploys READY ────────────────────────────────
    say('── D. BOTH PLANES REDEPLOYED READY (fresh secret live) ────────────')
    const deadline = Date.now() + DEPLOY_READY_TIMEOUT_MS
    let allReady = false
    let errored: string | null = null
    while (Date.now() < deadline && !allReady) {
      await sleep(DEPLOY_POLL_MS)
      const states: string[] = []
      allReady = true
      for (const plane of planes) {
        const list = await latestDeployments(vercelToken, orgId, plane.projectId)
        // A NEW production deployment created after the repair started.
        const fresh = list.find((d) => d.target === 'production' && (d.created ?? 0) * 1000 > repairStartedAt)
        const freshState = fresh?.state ?? 'none-yet'
        states.push(`${plane.label}=${freshState}`)
        if (fresh?.state === 'ERROR') errored = `${plane.label} redeploy errored`
        if (!fresh || fresh.state !== 'READY') allReady = false
      }
      say(`    deployments: ${states.join(' · ')}`)
    }
    if (allReady) {
      record('both planes redeployed READY', true, 'new production deployments READY on both planes after the repair')
    } else {
      fail('both planes redeployed READY', errored ?? `timed out after ${DEPLOY_READY_TIMEOUT_MS / 60000} minutes (the secret IS synced; any later deploy makes it live)`)
    }
  } finally {
    // ── E. fixture purge (honest counts) ────────────────────────────────
    say('── E. FIXTURE PURGE (honest counts) ───────────────────────────────')
    try {
      const p = await q(`DELETE FROM "PlatformPermission" WHERE "adminId" = ${sq(adminId)} RETURNING id`)
      const s = await q(`DELETE FROM "PlatformAdminSession" WHERE "adminId" = ${sq(adminId)} RETURNING id`)
      const a = await q(`DELETE FROM "PlatformAdmin" WHERE id = ${sq(adminId)} RETURNING id`)
      say(`  fixture admin purged: permissions=${p.length} sessions=${s.length} admin=${a.length}`)
      say('  (the fixture admin\u2019s login + repair audit rows are RETAINED — honest history)')
    } catch (e) {
      say(`  ⚠ purge error: ${clip(redactSecrets((e as Error).message), 120)}`)
    }
  }

  return report()
}

main().catch((e: Error) => {
  console.error(`[webhook-repair] FAILED: ${redactSecrets(e.message)}`)
  process.exitCode = 1
})
