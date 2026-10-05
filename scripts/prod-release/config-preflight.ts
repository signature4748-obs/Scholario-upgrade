/**
 * scripts/prod-release/config-preflight.ts — CONFIG GATE of the production
 * release pipeline (RELEASE-PIPELINE-1; the Vercel-deployment sibling of
 * scripts/prod-migration/preflight.ts — it closes the config gap BEFORE the
 * migration and deployment stages run).
 *
 * Read-only against Vercel. It reports CONFIGURED / MISSING for the
 * production environment variables the release depends on — WITHOUT ever
 * reading or printing VALUES. The Vercel Project env API is asked for NAMES
 * and target metadata only: the listing endpoint
 * (GET /v9/projects/{projectId}/env) never returns decrypted values unless
 * ?decrypt=true is requested, and this script never sends it.
 *
 * SAFETY RULES (same contract as scripts/prod-migration/lib.ts):
 *   · VERCEL_TOKEN is read from the environment and is never printed,
 *     logged, or written to disk — it only ever travels inside the
 *     Authorization header.
 *   · Error bodies are clipped to their first 200 characters before
 *     printing; Vercel error bodies carry env NAMES/metadata and error
 *     codes only — never values, never the token.
 *
 * Categories:
 *   · CORE     — fail the release when missing (target=production):
 *                DATABASE_URL, DATABASE_ENV, SUPABASE_URL,
 *                SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *                FILE_SIGNING_SECRET, REALTIME_CHANNEL_SECRET.
 *   · RECOVERY — fail when missing: the account-recovery release REQUIRES
 *                working password-reset email (RESEND_API_KEY, EMAIL_FROM).
 *   · GOOGLE   — report only / warn when missing (Google sign-in is an
 *                optional auth method that degrades honestly OFF); it fails
 *                only with --strict, or when HALF-configured (exactly one
 *                of GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *                present — an ID without a SECRET or vice versa).
 *
 * Usage:
 *   VERCEL_TOKEN=… VERCEL_PROJECT_ID=<project id or name> \
 *     [VERCEL_ORG_ID=team-scope] \
 *     bun scripts/prod-release/config-preflight.ts [--warn-only] [--strict]
 *
 * Flags:
 *   --warn-only  pre-release reporting mode: print the report, always exit 0
 *   --strict     missing GOOGLE_* variables also fail (the optional gate
 *                becomes mandatory)
 *
 * Exit codes: 0 = green (or --warn-only); 1 = fail-closed.
 */

const API_BASE = 'https://api.vercel.com'
const API_TIMEOUT_MS = 20_000
const API_RETRIES = 3
const MAX_PAGES = 5

const CORE_VARS: readonly string[] = [
  'DATABASE_URL',
  'DATABASE_ENV',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FILE_SIGNING_SECRET',
  'REALTIME_CHANNEL_SECRET',
]
const RECOVERY_VARS: readonly string[] = ['RESEND_API_KEY', 'EMAIL_FROM']
const GOOGLE_VARS: readonly string[] = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
]
/** Status column alignment (longest key: GOOGLE_OAUTH_REDIRECT_URI = 24). */
const KEY_PAD = 28

interface EnvKeys {
  /** Keys whose target metadata includes 'production' (or is absent). */
  production: Set<string>
  /** Keys defined but only targeted at other environments. */
  elsewhere: Set<string>
}

/** One env record as Vercel returns it — key + target metadata, never a value. */
interface EnvRecord {
  key?: unknown
  target?: unknown
  targets?: unknown
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
          `[prod-release:config-preflight] Vercel API HTTP ${res.status} — retrying (${attempt}/${API_RETRIES - 1})…`,
        )
        await sleep(1500 * attempt)
        return vercelGetJson(path, token, attempt + 1)
      }
      throw new Error(`Vercel API rejected the env listing (HTTP ${res.status}): ${clip(text, 200)}`)
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
        `[prod-release:config-preflight] transport hiccup (${e.name}) — retrying (${attempt}/${API_RETRIES - 1})…`,
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

/** Defensive body unwrapping: { envs: […] } / { result: […] } / bare array. */
function envRecordsOf(body: unknown): EnvRecord[] {
  if (Array.isArray(body)) return body as EnvRecord[]
  if (!body || typeof body !== 'object') return []
  const b = body as { envs?: unknown; result?: unknown }
  if (Array.isArray(b.envs)) return b.envs as EnvRecord[]
  if (b.result && typeof b.result === 'object') {
    if (Array.isArray(b.result)) return b.result as EnvRecord[]
    const r = b.result as { envs?: unknown }
    if (Array.isArray(r.envs)) return r.envs as EnvRecord[]
  }
  return []
}

/**
 * Production-presence rule: a var counts when its target array (either the
 * `target` field or the defensive `targets` field) includes 'production',
 * OR when target metadata is missing entirely (conservative: count it — a
 * var with no target metadata on Vercel applies to every environment).
 */
function targetsProduction(rec: EnvRecord): boolean {
  const t = rec.target !== undefined ? rec.target : rec.targets
  if (t === undefined || t === null) return true
  return Array.isArray(t) && t.includes('production')
}

/** Vercel pagination cursor (`next`), tolerated wherever the API puts it. */
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

/**
 * List env NAMES (never values) for the production target. Paginates with
 * `until=<next>` while a cursor is present (up to MAX_PAGES pages).
 */
async function listEnvKeys(projectId: string, orgId: string | undefined, token: string): Promise<EnvKeys> {
  const production = new Set<string>()
  const elsewhere = new Set<string>()
  const params = new URLSearchParams({ limit: '100' })
  if (orgId) params.set('teamId', orgId)
  let next: number | string | undefined
  let pages = 0
  do {
    if (next !== undefined) params.set('until', String(next))
    const body = await vercelGetJson(
      `/v9/projects/${encodeURIComponent(projectId)}/env?${params.toString()}`,
      token,
    )
    for (const rec of envRecordsOf(body)) {
      if (typeof rec.key !== 'string' || !rec.key) continue
      if (targetsProduction(rec)) production.add(rec.key)
      else elsewhere.add(rec.key)
    }
    next = paginationNext(body)
    pages += 1
  } while (next !== undefined && pages < MAX_PAGES)
  if (next !== undefined) {
    console.warn(
      `[prod-release:config-preflight] ⚠ env listing truncated at ${MAX_PAGES} pages — re-run if an expected variable reports MISSING`,
    )
  }
  return { production, elsewhere }
}

type StatusMode = 'required' | 'google-optional' | 'google-strict'

/** One status line per variable — the only per-var output, values never involved. */
function statusFor(name: string, keys: EnvKeys, mode: StatusMode): { text: string; missing: boolean } {
  if (keys.production.has(name)) return { text: 'CONFIGURED ✓', missing: false }
  const nuance = keys.elsewhere.has(name) ? ' [defined but not targeted at production]' : ''
  if (mode === 'required') return { text: `MISSING ✖${nuance}`, missing: true }
  if (mode === 'google-strict') {
    return { text: `MISSING ✖ (--strict: Google sign-in required)${nuance}`, missing: true }
  }
  return { text: `MISSING (Google sign-in stays honestly OFF)${nuance}`, missing: true }
}

function reportCategory(title: string, vars: readonly string[], keys: EnvKeys, mode: StatusMode): string[] {
  console.log(`  ${title}`)
  const missing: string[] = []
  for (const name of vars) {
    const s = statusFor(name, keys, mode)
    console.log(`    ${name.padEnd(KEY_PAD)}${s.text}`)
    if (s.missing) missing.push(name)
  }
  return missing
}

async function main(): Promise<void> {
  const warnOnly = process.argv.includes('--warn-only')
  const strict = process.argv.includes('--strict')
  const token = requireEnv('VERCEL_TOKEN')
  const projectId = requireEnv('VERCEL_PROJECT_ID')
  const orgId = (process.env.VERCEL_ORG_ID ?? '').trim() || undefined

  console.log('[prod-release:config-preflight] ═══ PRODUCTION CONFIG PRE-FLIGHT ═══')
  console.log(`  project    : ${projectId}`)
  console.log(`  team       : ${orgId ?? 'personal account'}`)
  console.log('  transport  : Vercel API env listing (names + targets only — values never requested)')

  let keys: EnvKeys
  try {
    keys = await listEnvKeys(projectId, orgId, token)
  } catch (err) {
    // HTTP/transport failure — the body clip below carries the status code
    // and the first 200 chars of a names/metadata-only error body.
    console.error(`\n  ✖ ${(err as Error).message}`)
    console.error('  ✖ configuration state is UNKNOWN — UNKNOWN is a STOP, never a pass (fail-closed by default)')
    if (warnOnly) {
      console.log('\n  verdict: UNKNOWN ✖ — exit 0 (--warn-only: pre-release reporting mode)')
      return
    }
    process.exit(1)
  }

  console.log()
  const missingCore = reportCategory('CORE (fail when missing)', CORE_VARS, keys, 'required')
  const missingRecovery = reportCategory(
    'RECOVERY (account-recovery release — fail when missing)',
    RECOVERY_VARS,
    keys,
    'required',
  )
  const missingGoogle = reportCategory(
    'GOOGLE (optional — Google sign-in; reported, --strict to enforce)',
    GOOGLE_VARS,
    keys,
    strict ? 'google-strict' : 'google-optional',
  )
  if (missingGoogle.length) {
    console.log(
      '    ⚠ Google sign-in stays honestly OFF until all three GOOGLE_* variables are configured (runtime config gate keeps it disabled — no partial sign-in)',
    )
  }

  // Half-configured Google OAuth: exactly one of CLIENT_ID / CLIENT_SECRET
  // present — an ID without a SECRET (or vice versa) is broken, not OFF.
  // This fails regardless of --strict.
  const problems: string[] = []
  if (keys.production.has('GOOGLE_OAUTH_CLIENT_ID') !== keys.production.has('GOOGLE_OAUTH_CLIENT_SECRET')) {
    problems.push('half-configured Google OAuth (CLIENT_ID without SECRET or vice versa) — fix before release')
  }
  if (problems.length) {
    console.log('\n  problems:')
    for (const p of problems) console.log(`    ✖ ${p}`)
  }

  const missingTotal = missingCore.length + missingRecovery.length + (strict ? missingGoogle.length : 0)
  const failCount = missingTotal + problems.length
  if (failCount === 0) {
    console.log('\n  verdict: 0 MISSING ✓ — green')
    console.log('\n[prod-release:config-preflight] ✓ PRODUCTION CONFIG GREEN — safe to proceed')
    return
  }
  const parts: string[] = []
  if (missingTotal > 0) parts.push(`${missingTotal} MISSING`)
  if (problems.length > 0) parts.push(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  console.log(`\n  verdict: ${parts.join(' + ')} ✖ — fail-closed`)
  if (warnOnly) {
    console.log('[prod-release:config-preflight] --warn-only: pre-release reporting mode — exit 0 (fix before the release run)')
    return
  }
  console.error('[prod-release:config-preflight] ✖ CONFIG PRE-FLIGHT FAILED — fail-closed (missing variables above)')
  process.exit(1)
}

main().catch((err) => {
  console.error(`\n[prod-release:config-preflight] ✖ FAILED: ${(err as Error).message}`)
  process.exit(1)
})
