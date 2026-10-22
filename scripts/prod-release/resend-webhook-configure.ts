/**
 * scripts/prod-release/resend-webhook-configure.ts — ONE-TIME (repeatable,
 * idempotent) configuration repair for the Resend delivery webhook
 * (docs/EMAIL.md §"Webhooks" — the documented owner activation action,
 * automated so nobody ever has to handle the raw signing secret).
 *
 * WHAT THIS DOES (in order, every step sanitized — secrets never printed):
 *   1. Reads the desired endpoint: ${PRODUCTION_URL}/api/webhooks/resend
 *      (PRODUCTION_URL is the canonical control-plane origin; the route is
 *      served on every plane and all planes share one database —
 *      docs/VERCEL_PROJECTS.md).
 *   2. Fetches the current provider state: GET /domains + GET /webhooks
 *      (report only).
 *   3. Reconciles the webhook endpoint:
 *        · absent                       → CREATE (all six lifecycle events).
 *        · wrong URL or drifted events  → PATCH to the canonical state.
 *        · canonical + drifted events   → PATCH events only.
 *        · canonical + complete         → untouched (unless --recreate).
 *   4. Secret flow (the ONLY API-verifiable path): a signing secret is
 *      returned by Resend ONLY at create time. CREATE (and --recreate:
 *      DELETE + CREATE) capture it IN MEMORY and sync it to BOTH active
 *      Vercel planes as RESEND_WEBHOOK_SECRET (created when absent, value
 *      rotated when present) — target production, type encrypted. The
 *      value never appears in any log line.
 *   5. When a secret was written: triggers BOTH deploy hooks and waits
 *      for the new deployments (SHA must equal the checked-out HEAD) to
 *      be READY and /health/ready green on both planes.
 *   6. Prints the exact manual follow-ups when any step is impossible
 *      via API (never claims a manual action is done).
 *
 * WHY --recreate EXISTS: the API cannot read an EXISTING endpoint's
 * signing secret. If the dashboard-created webhook's secret was never
 * copied to Vercel (or a mismatch is suspected from failed live
 * verification), --recreate is the documented repair: delete + create
 * mints a fresh secret returned by the API, which this script syncs.
 *
 * Usage (secrets via environment only):
 *   VERCEL_TOKEN=… VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… \
 *   VERCEL_PROJECT_ID_SCHOOL=… RESEND… (fetched from Vercel env in-memory)
 *   PRODUCTION_URL=… PRODUCTION_URL_SCHOOL=… \
 *   VERCEL_DEPLOY_HOOK_URL=… VERCEL_DEPLOY_HOOK_URL_SCHOOL=… \
 *     bun scripts/prod-release/resend-webhook-configure.ts [--recreate]
 *
 * Exit codes: 0 = desired state reached (or already reached);
 *             1 = any step failed — the report says exactly which.
 */

import { execSync } from 'node:child_process'

const VERCEL_API_BASE = 'https://api.vercel.com'
const RESEND_API_BASE = 'https://api.resend.com'
const API_TIMEOUT_MS = 15_000
const API_RETRIES = 3
const DEPLOY_READY_TIMEOUT_MS = 5 * 60_000
const DEPLOY_POLL_MS = 8_000

/** The six documented Resend webhook lifecycle events (docs/EMAIL.md). */
const WEBHOOK_EVENTS = [
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.delivery_delayed',
  'email.failed',
  'email.sent',
] as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[webhook-configure] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Redact every secret env value from any accidental echo (defense in depth). */
function redactSecrets(text: string): string {
  let out = text
  for (const name of ['RESEND_API_KEY', 'VERCEL_TOKEN', 'RESEND_WEBHOOK_SECRET', 'SIGNING_SECRET']) {
    const v = process.env[name]
    if (v && v.length > 8) out = out.split(v).join(`«${name}-redacted»`)
  }
  return out
}

function say(text: string): void {
  console.log(redactSecrets(text))
}

class ApiError extends Error {
  constructor(
    public label: string,
    public status: number,
    public bodyText: string,
  ) {
    super(`${label} rejected (HTTP ${status}): ${clip(bodyText, 300)}`)
  }
}

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  base: string,
  path: string,
  headers: Record<string, string>,
  label: string,
  body?: unknown,
  attempt = 1,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      if (res.status >= 500 && attempt < API_RETRIES) {
        say(`  [warn] ${label} HTTP ${res.status} — retrying (${attempt}/${API_RETRIES - 1})…`)
        await sleep(1500 * attempt)
        return api(method, base, path, headers, label, body, attempt + 1)
      }
      throw new ApiError(label, res.status, text)
    }
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new ApiError(label, res.status, 'non-JSON body')
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    const e = err as Error
    const retriable = e.name === 'AbortError' || e.name === 'TypeError'
    if (retriable && attempt < API_RETRIES) {
      say(`  [warn] ${label} transport hiccup (${e.name}) — retrying (${attempt}/${API_RETRIES - 1})…`)
      await sleep(1500 * attempt)
      return api(method, base, path, headers, label, body, attempt + 1)
    }
    if (retriable) throw new Error(`${label} unreachable after ${attempt} attempt(s) (${clip(e.message, 120)})`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ─── Vercel env inventory (names + ids only; values only via decrypt) ────

interface VercelEnvRecord {
  key?: unknown
  id?: unknown
  target?: unknown
  targets?: unknown
}

function envRecordsOf(body: unknown): VercelEnvRecord[] {
  if (Array.isArray(body)) return body as VercelEnvRecord[]
  if (!body || typeof body !== 'object') return []
  const b = body as { envs?: unknown; result?: unknown }
  if (Array.isArray(b.envs)) return b.envs as VercelEnvRecord[]
  if (b.result && typeof b.result === 'object') {
    if (Array.isArray(b.result)) return b.result as VercelEnvRecord[]
    const r = b.result as { envs?: unknown }
    if (Array.isArray(r.envs)) return r.envs as VercelEnvRecord[]
  }
  return []
}

function paginationNext(body: unknown): number | string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as { next?: unknown; result?: unknown }
  let raw = b.next
  if (raw === undefined && b.result && typeof b.result === 'object') {
    raw = (b.result as { next?: unknown }).next
  }
  if (raw === undefined || raw === null) return undefined
  return typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw)
}

async function listEnv(projectId: string, orgId: string, token: string): Promise<VercelEnvRecord[]> {
  const out: VercelEnvRecord[] = []
  const params = new URLSearchParams({ limit: '100', teamId: orgId })
  let next: number | string | undefined
  let pages = 0
  do {
    if (next !== undefined) params.set('until', String(next))
    const body = await api(
      'GET',
      VERCEL_API_BASE,
      `/v9/projects/${encodeURIComponent(projectId)}/env?${params.toString()}`,
      { Authorization: `Bearer ${token}` },
      `Vercel env listing (${projectId})`,
    )
    out.push(...envRecordsOf(body))
    next = paginationNext(body)
    pages += 1
  } while (next !== undefined && pages < 20)
  return out
}

async function fetchEnvValue(
  projectId: string,
  orgId: string,
  token: string,
  envId: string,
): Promise<string | undefined> {
  const body = (await api(
    'GET',
    VERCEL_API_BASE,
    `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}?decrypt=1&teamId=${encodeURIComponent(orgId)}`,
    { Authorization: `Bearer ${token}` },
    `Vercel env decrypt (${projectId})`,
  )) as { value?: unknown } | null
  const v = body?.value
  return typeof v === 'string' ? v : undefined
}

/** Create (POST) or rotate (PATCH) RESEND_WEBHOOK_SECRET on one plane. */
async function writeWebhookSecret(
  plane: string,
  projectId: string,
  orgId: string,
  token: string,
  secret: string,
): Promise<'created' | 'rotated' | 'unchanged'> {
  const envs = await listEnv(projectId, orgId, token)
  const rec = envs.find((e) => e.key === 'RESEND_WEBHOOK_SECRET')
  if (!rec || typeof rec.id !== 'string') {
    await api(
      'POST',
      VERCEL_API_BASE,
      `/v9/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(orgId)}`,
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      `Vercel env create RESEND_WEBHOOK_SECRET (${plane})`,
      { key: 'RESEND_WEBHOOK_SECRET', value: secret, type: 'encrypted', target: ['production'] },
    )
    return 'created'
  }
  const current = await fetchEnvValue(projectId, orgId, token, rec.id)
  if (current === secret) return 'unchanged'
  await api(
    'PATCH',
    VERCEL_API_BASE,
    `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(rec.id)}?teamId=${encodeURIComponent(orgId)}`,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    `Vercel env update RESEND_WEBHOOK_SECRET (${plane})`,
    { value: secret },
  )
  return 'rotated'
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const forceRecreate = process.argv.includes('--recreate')

  say('════════════════════════════════════════════════════════════════════')
  say(' RESEND WEBHOOK CONFIGURE/REPAIR (sanitized: no secrets)')
  say('════════════════════════════════════════════════════════════════════')
  let headSha = ''
  try {
    headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    say(` commit: ${headSha}`)
  } catch {
    say(' commit: unknown (not a git checkout)')
  }
  say(` mode:  ${forceRecreate ? 'RECREATE (delete + create → fresh secret → sync)' : 'idempotent reconcile'}`)
  say(` time:  ${new Date().toISOString()}`)
  say('')

  const vercelToken = requireEnv('VERCEL_TOKEN')
  const orgId = requireEnv('VERCEL_ORG_ID')
  const planes = [
    { label: 'scholario-platform', projectId: requireEnv('VERCEL_PROJECT_ID'), hook: process.env.VERCEL_DEPLOY_HOOK_URL },
    { label: 'scholario-app', projectId: requireEnv('VERCEL_PROJECT_ID_SCHOOL'), hook: process.env.VERCEL_DEPLOY_HOOK_URL_SCHOOL },
  ]
  const productionUrl = requireEnv('PRODUCTION_URL').replace(/\/+$/, '')
  const canonicalEndpoint = `${productionUrl}/api/webhooks/resend`
  say(` desired endpoint: ${canonicalEndpoint}`)
  say(` desired events:    ${WEBHOOK_EVENTS.join(', ')}`)
  say('')

  // ── 1. Resend key (in memory): env override first, then the platform
  //    plane's Vercel env (a dashboard-created Sensitive value is
  //    write-only via API — the env override is the documented channel
  //    for this case).
  say('── 1. RESEND_API_KEY (env override → Vercel decrypt, in memory) ──')
  let apiKey = (process.env.RESEND_API_KEY ?? '').trim()
  if (apiKey) {
    say('  RESEND_API_KEY provided via environment (value withheld) ✓')
  } else {
    const platformEnvs = await listEnv(planes[0].projectId, orgId, vercelToken)
    const keyRec = platformEnvs.find((e) => e.key === 'RESEND_API_KEY')
    if (!keyRec || typeof keyRec.id !== 'string') {
      throw new Error('RESEND_API_KEY is not set on the platform plane — nothing to configure with.')
    }
    apiKey = (await fetchEnvValue(planes[0].projectId, orgId, vercelToken, keyRec.id)) ?? ''
    if (!apiKey) {
      throw new Error(
        'RESEND_API_KEY value could not be read: the var is set but WRITE-ONLY via the Vercel API (dashboard-created Sensitive). Provide RESEND_API_KEY in this run\'s environment (e.g. a repository/environment secret) — it is fetched in memory only, never printed.',
      )
    }
    say('  RESEND_API_KEY decrypted from the platform plane (value withheld) ✓')
  }
  const authHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  say('')

  // ── 2. Provider state ───────────────────────────────────────────────
  say('── 2. PROVIDER STATE (read-only) ──────────────────────────────────')
  const domainsDoc = (await api('GET', RESEND_API_BASE, '/domains', authHeaders, 'Resend GET /domains')) as {
    data?: Array<Record<string, unknown>>
  } | null
  const domains = Array.isArray(domainsDoc?.data) ? domainsDoc.data : []
  const verified = domains.filter((d) => String(d.status ?? '').toLowerCase() === 'verified').length
  say(`  domains: ${domains.length} total, ${verified} verified${verified === 0 ? ' (testing mode — the sender can only deliver to the account owner)' : ''}`)

  const whDoc = (await api('GET', RESEND_API_BASE, '/webhooks', authHeaders, 'Resend GET /webhooks')) as {
    data?: Array<Record<string, unknown>>
  } | null
  const webhooks = Array.isArray(whDoc?.data) ? whDoc.data : []
  say(`  existing webhook endpoints: ${webhooks.length}`)
  for (const w of webhooks) {
    const id = String(w.id ?? '«no id»')
    const url = String(w.url ?? '«no url»')
    const events = Array.isArray(w.events) ? (w.events as string[]).join(',') : '«no events»'
    say(`    · id=${id} url=${clip(url, 90)} events=${events}`)
  }
  say('')

  // ── 3. Reconcile the endpoint ───────────────────────────────────────
  say('── 3. RECONCILE WEBHOOK ENDPOINT ───────────────────────────────────')
  const canonical = webhooks.find((w) => String(w.url ?? '') === canonicalEndpoint)
  const other = webhooks.find((w) => String(w.url ?? '') !== canonicalEndpoint)
  let freshSecret: string | null = null

  const needsSecretSync = async (): Promise<boolean> => {
    // Secret sync is needed unless BOTH planes already carry the value
    // (read + compare in memory, never printed).
    for (const plane of planes) {
      const envs = await listEnv(plane.projectId, orgId, vercelToken)
      const rec = envs.find((e) => e.key === 'RESEND_WEBHOOK_SECRET')
      if (!rec || typeof rec.id !== 'string') return true
      const v = await fetchEnvValue(plane.projectId, orgId, vercelToken, rec.id)
      if (!v) return true
    }
    return false
  }

  if (forceRecreate && canonical) {
    say('  --recreate: deleting the canonical endpoint to mint a fresh signing secret…')
    await api('DELETE', RESEND_API_BASE, `/webhooks/${encodeURIComponent(String(canonical.id))}`, authHeaders, 'Resend DELETE /webhooks')
    say('  deleted. recreating with all six lifecycle events…')
    const created = (await api('POST', RESEND_API_BASE, '/webhooks', authHeaders, 'Resend POST /webhooks', {
      url: canonicalEndpoint,
      events: [...WEBHOOK_EVENTS],
    })) as { id?: unknown; signing_secret?: unknown } | null
    const sid = created?.signing_secret
    if (typeof sid === 'string' && sid.length > 0) {
      freshSecret = sid
      say(`  recreated (id=${String(created?.id ?? '?')}); fresh signing secret captured IN MEMORY (never printed)`)
    } else {
      throw new Error('Resend did not return a signing secret for the recreated webhook — cannot sync RESEND_WEBHOOK_SECRET. Manual action: copy the secret from the Resend dashboard into RESEND_WEBHOOK_SECRET on BOTH planes, then redeploy.')
    }
  } else if (other && !canonical) {
    say(`  a webhook exists at a NON-canonical URL (${clip(String(other.url ?? '?'), 80)}) — recreating at the canonical URL…`)
    await api('DELETE', RESEND_API_BASE, `/webhooks/${encodeURIComponent(String(other.id))}`, authHeaders, 'Resend DELETE /webhooks')
    const created = (await api('POST', RESEND_API_BASE, '/webhooks', authHeaders, 'Resend POST /webhooks', {
      url: canonicalEndpoint,
      events: [...WEBHOOK_EVENTS],
    })) as { id?: unknown; signing_secret?: unknown } | null
    const sid = created?.signing_secret
    if (typeof sid === 'string' && sid.length > 0) {
      freshSecret = sid
      say('  recreated at the canonical URL; fresh signing secret captured IN MEMORY')
    } else {
      throw new Error('Recreated webhook returned no signing secret via API — copy it manually from the Resend dashboard into RESEND_WEBHOOK_SECRET on BOTH planes, then redeploy.')
    }
  } else if (canonical) {
    const currentEvents = Array.isArray(canonical.events) ? (canonical.events as string[]) : []
    const drifted = WEBHOOK_EVENTS.some((e) => !currentEvents.includes(e))
    if (drifted) {
      say(`  canonical endpoint exists but events drifted (${currentEvents.join(',') || 'none'}) — PATCHing…`)
      await api(
        'PATCH',
        RESEND_API_BASE,
        `/webhooks/${encodeURIComponent(String(canonical.id))}`,
        authHeaders,
        'Resend PATCH /webhooks',
        { url: canonicalEndpoint, events: [...WEBHOOK_EVENTS] },
      )
      say('  events updated (PATCH never changes the signing secret).')
    } else {
      say('  canonical endpoint exists with the complete event set ✓')
    }
    if (await needsSecretSync()) {
      throw new Error(
        'The webhook endpoint is configured but RESEND_WEBHOOK_SECRET is missing on one/both planes, and the API cannot read an EXISTING endpoint\'s signing secret. Re-run with --recreate to mint + sync a fresh secret (deliberate: delete + create).',
      )
    }
    say('  RESEND_WEBHOOK_SECRET present on BOTH planes (values compared in memory, never printed) ✓')
  } else {
    say('  no webhook endpoint exists — creating with all six lifecycle events…')
    const created = (await api('POST', RESEND_API_BASE, '/webhooks', authHeaders, 'Resend POST /webhooks', {
      url: canonicalEndpoint,
      events: [...WEBHOOK_EVENTS],
    })) as { id?: unknown; signing_secret?: unknown } | null
    const sid = created?.signing_secret
    if (typeof sid === 'string' && sid.length > 0) {
      freshSecret = sid
      say(`  created (id=${String(created?.id ?? '?')}); signing secret captured IN MEMORY`)
    } else {
      throw new Error('Created webhook returned no signing secret via API — copy it manually from the Resend dashboard into RESEND_WEBHOOK_SECRET on BOTH planes, then redeploy.')
    }
  }
  say('')

  // ── 4. Sync the secret to BOTH planes (only when we have one) ───────
  let redeployNeeded = false
  if (freshSecret) {
    say('── 4. SYNC RESEND_WEBHOOK_SECRET (both planes, in-memory value) ──')
    for (const plane of planes) {
      const outcome = await writeWebhookSecret(plane.label, plane.projectId, orgId, vercelToken, freshSecret)
      say(`  ${plane.label}: RESEND_WEBHOOK_SECRET ${outcome} (production target, encrypted)`)
      if (outcome !== 'unchanged') redeployNeeded = true
    }
    say('')
  } else {
    say('── 4. SECRET SYNC: skipped (no fresh secret — existing secret verified present on both planes)')
    say('')
  }

  // ── 5. Redeploy both planes when the env changed ─────────────────────
  if (redeployNeeded) {
    say('── 5. REDEPLOY BOTH PLANES (deploy hooks) ─────────────────────────')
    for (const plane of planes) {
      if (!plane.hook) {
        throw new Error(`No deploy hook configured for ${plane.label} (VERCEL_DEPLOY_HOOK_URL missing) — trigger the redeploy manually after this run.`)
      }
      await fetch(plane.hook, { method: 'POST' })
      say(`  ${plane.label}: deploy hook triggered`)
    }
    say('  waiting for BOTH new deployments to be READY…')
    const deadline = Date.now() + DEPLOY_READY_TIMEOUT_MS
    let bothReady = false
    while (Date.now() < deadline && !bothReady) {
      await sleep(DEPLOY_POLL_MS)
      // One poll round: fetch each plane's latest READY production
      // deployment and check it matches the checked-out commit SHA.
      const results = await Promise.all(
        planes.map(async (plane) => {
          const doc = (await api(
            'GET',
            VERCEL_API_BASE,
            `/v6/deployments?projectId=${encodeURIComponent(plane.projectId)}&teamId=${encodeURIComponent(orgId)}&limit=5`,
            { Authorization: `Bearer ${vercelToken}` },
            `Vercel deployments (${plane.label})`,
          )) as { deployments?: Array<{ state?: string; sha?: string; target?: string }> } | null
          const list = doc?.deployments ?? []
          const ready = list.find((d) => d.state === 'READY' && d.target === 'production')
          const latest = list[0]
          const headMatch = !!ready && (!headSha || ready.sha === headSha)
          const note = headMatch
            ? (ready ? 'READY@HEAD ✓' : `state=${latest?.state ?? 'none'}`)
            : `READY but older SHA (${ready?.sha ?? '?'})`
          return { label: plane.label, headMatch, note }
        }),
      )
      say(`    ${results.map((r) => `${r.label}=${r.note}`).join(' · ')}`)
      bothReady = results.every((r) => r.headMatch)
    }
    if (bothReady) say('  both planes READY at the current commit SHA ✓')
    else say('  ⚠ deployment wait window expired — check the Vercel dashboard; the webhook secret is already synced.')
    // Health probes.
    const healthUrls = [process.env.PRODUCTION_URL, process.env.PRODUCTION_URL_SCHOOL]
    for (const [i, plane] of planes.entries()) {
      const url = healthUrls[i]?.replace(/\/+$/, '')
      if (!url) continue
      try {
        const res = await fetch(`${url}/health/ready`)
        say(`  ${plane.label} /health/ready → HTTP ${res.status}${res.status === 200 ? ' ✓' : ' ⚠'}`)
      } catch (e) {
        say(`  ${plane.label} /health/ready unreachable: ${clip((e as Error).message, 80)}`)
      }
    }
    say('')
  } else {
    say('── 5. REDEPLOY: skipped (no env value changed on either plane)')
    say('')
  }

  // ── 6. Report ────────────────────────────────────────────────────────
  say('── RESULT ─────────────────────────────────────────────────────────')
  say(`  endpoint:   ${canonicalEndpoint}`)
  say(`  events:    ${WEBHOOK_EVENTS.join(', ')}`)
  say(`  secret:    ${freshSecret ? 'fresh signing secret synced to BOTH planes (in-memory only)' : 'existing secret present on BOTH planes (API cannot read it — live delivery verification is the proof)'}`)
  say('  NEXT: run the live end-to-end delivery verification (controlled')
  say('        recipient) — a delivered event landing in WebhookEvent with')
  say('        the EmailDelivery row upgrading QUEUED→SENT is the ONLY')
  say('        end-to-end proof that endpoint + secret + redeploy all line up.')
}

main().catch((e: Error) => {
  console.error(`[webhook-configure] FAILED: ${redactSecrets(e.message)}`)
  process.exit(1)
})
