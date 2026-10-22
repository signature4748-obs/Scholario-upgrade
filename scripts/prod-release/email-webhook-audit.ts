/**
 * scripts/prod-release/email-webhook-audit.ts — SANITIZED live audit of the
 * production email pipeline (docs/EMAIL.md §"Webhooks", §"Diagnostics").
 *
 * Answers, with LIVE evidence and ZERO secret exposure:
 *   1. Which email provider/transport is configured in production
 *      (EMAIL_PROVIDER / EMAIL_FROM / Resend key presence per plane)?
 *   2. Is the Resend sending domain verified (GET /domains — the live
 *      answer to "can the production sender deliver to arbitrary
 *      recipients, or is the account still testing-restricted")?
 *   3. Is a Resend webhook endpoint registered (GET /webhooks), pointed
 *      at the documented /api/webhooks/resend route, and which events
 *      are subscribed?
 *   4. Is RESEND_WEBHOOK_SECRET configured on BOTH active planes (and
 *      do the two planes agree — boolean only, never the value)?
 *   5. Outbox truth (read-only, via the Supabase Management API — same
 *      channel as the migration pipeline): EmailDelivery status counts,
 *      recent failure classes, QUEUED-with-provider-message-id rows
 *      (the "delivery evidence missing" population), principal-invite
 *      rows (masked recipients), and Resend WebhookEvent rows.
 *
 * SECURITY CONTRACT (hard rules — enforced in code below):
 *   · Secrets (RESEND_API_KEY, RESEND_WEBHOOK_SECRET, SUPABASE tokens,
 *     VERCEL_TOKEN) are fetched into memory ONLY and never printed,
 *     logged, or included in any output line.
 *   · Recipient addresses are masked (first char + ***@domain).
 *   · Resend webhook objects are printed through a strict FIELD
 *     ALLOWLIST (id/url/events/status flags/dates) — anything whose key
 *     contains secret/token/key/password is dropped before printing.
 *   · All database access is read-only SELECT (single statement per
 *     query, via the Management API batch endpoint).
 *
 * Usage (all secrets via environment — never arguments, never files):
 *   VERCEL_TOKEN=… VERCEL_ORG_ID=… \
 *   VERCEL_PROJECT_ID=… VERCEL_PROJECT_ID_SCHOOL=… \
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *     bun scripts/prod-release/email-webhook-audit.ts [--skip-db]
 *
 * Exit code: 0 always (an audit reports, it does not gate).
 */

import { execSync } from 'node:child_process'

const VERCEL_API_BASE = 'https://api.vercel.com'
const RESEND_API_BASE = 'https://api.resend.com'
const SUPABASE_API_BASE = 'https://api.supabase.com'
const API_TIMEOUT_MS = 15_000
const API_RETRIES = 3

/** Keys whose VALUES we may print (they are configuration, not secrets). */
const PRINTABLE_ENV_KEYS = new Set(['EMAIL_PROVIDER', 'EMAIL_FROM'])
/** Keys we fetch (in memory) but NEVER print. */
const SECRET_ENV_KEYS = new Set(['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET'])
/** Resend webhook object fields that are safe to print. */
const WEBHOOK_PRINTABLE_FIELDS = new Set([
  'id',
  'url',
  'events',
  'status',
  'enabled',
  'disabled',
  'active',
  'created_at',
  'updated_at',
  'last_event_at',
  'name',
])
const MASK_SECRET_KEY_RE = /(secret|token|key|password)/i

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[email-audit] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Redact a secret from any accidental echo (defense in depth). */
function redactSecrets(text: string): string {
  let out = text
  for (const name of SECRET_ENV_KEYS) {
    const v = process.env[name]
    if (v && v.length > 8) out = out.split(v).join(`«${name}-redacted»`)
  }
  for (const name of ['VERCEL_TOKEN', 'SUPABASE_ACCESS_TOKEN'] as const) {
    const v = process.env[name]
    if (v && v.length > 8) out = out.split(v).join(`«${name}-redacted»`)
  }
  return out
}

function say(text: string): void {
  console.log(redactSecrets(text))
}

/** GET one provider API JSON document with bounded retries (transport only). */
async function getJson(
  base: string,
  path: string,
  headers: Record<string, string>,
  label: string,
  attempt = 1,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${path}`, { headers, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) {
      if (res.status >= 500 && attempt < API_RETRIES) {
        say(`  [warn] ${label} HTTP ${res.status} — retrying (${attempt}/${API_RETRIES - 1})…`)
        await sleep(1500 * attempt)
        return getJson(base, path, headers, label, attempt + 1)
      }
      throw new Error(`${label} rejected (HTTP ${res.status}): ${clip(text, 200)}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${label} returned a non-JSON body: ${clip(text, 200)}`)
    }
  } catch (err) {
    const e = err as Error
    const retriable = e.name === 'AbortError' || e.name === 'TypeError'
    if (retriable && attempt < API_RETRIES) {
      say(`  [warn] ${label} transport hiccup (${e.name}) — retrying (${attempt}/${API_RETRIES - 1})…`)
      await sleep(1500 * attempt)
      return getJson(base, path, headers, label, attempt + 1)
    }
    if (retriable) throw new Error(`${label} unreachable after ${attempt} attempt(s) (${clip(e.message, 120)})`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ─── Vercel env inventory ─────────────────────────────────────────────────

interface VercelEnvRecord {
  key?: unknown
  id?: unknown
  target?: unknown
  targets?: unknown
}

interface VercelEnvDoc {
  id: string
  key: string
  target: string[]
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

/**
 * List env records (key + id + production targeting) for one plane.
 * `decrypt` values are fetched ONLY for the named keys via fetchEnvValue.
 */
async function listEnv(projectId: string, orgId: string, token: string): Promise<VercelEnvDoc[]> {
  const out: VercelEnvDoc[] = []
  const params = new URLSearchParams({ limit: '100', teamId: orgId })
  let next: number | string | undefined
  let pages = 0
  do {
    if (next !== undefined) params.set('until', String(next))
    const body = await getJson(
      VERCEL_API_BASE,
      `/v9/projects/${encodeURIComponent(projectId)}/env?${params.toString()}`,
      { Authorization: `Bearer ${token}` },
      `Vercel env listing (${projectId})`,
    )
    for (const rec of envRecordsOf(body)) {
      if (typeof rec.key !== 'string' || !rec.key || typeof rec.id !== 'string') continue
      const t = rec.target !== undefined ? rec.target : rec.targets
      const target = Array.isArray(t) ? t.map(String) : t === undefined || t === null ? ['production'] : [String(t)]
      out.push({ id: rec.id, key: rec.key, target })
    }
    next = paginationNext(body)
    pages += 1
  } while (next !== undefined && pages < 20)
  return out
}

/** Fetch ONE decrypted env value (in memory; caller decides if printable). */
async function fetchEnvValue(
  projectId: string,
  orgId: string,
  token: string,
  envId: string,
): Promise<string | undefined> {
  const body = (await getJson(
    VERCEL_API_BASE,
    `/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}?decrypt=1&teamId=${encodeURIComponent(orgId)}`,
    { Authorization: `Bearer ${token}` },
    `Vercel env decrypt (${projectId})`,
  )) as { value?: unknown } | null
  const v = body?.value
  return typeof v === 'string' ? v : undefined
}

// ─── Supabase Management API (read-only SELECTs) ───────────────────────────

/** Execute ONE read-only SELECT against production via the Management API. */
async function mgmtQuery(token: string, ref: string, query: string, label: string): Promise<Record<string, unknown>[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${SUPABASE_API_BASE}/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Management API rejected ${label} (HTTP ${res.status}): ${clip(text, 200)}`)
    const parsed = JSON.parse(text) as unknown
    // The endpoint returns the SELECT result array directly.
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

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : -1
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** Mask a recipient address: 'signature4748@gmail.com' → 's***@gmail.com'. */
function maskAddress(addr: string): string {
  const at = addr.indexOf('@')
  if (at <= 0) return '«masked»'
  return `${addr.slice(0, 1)}***@${addr.slice(at + 1)}`
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const skipDb = process.argv.includes('--skip-db')

  say('════════════════════════════════════════════════════════════════════')
  say(' SCHOLARIO — LIVE EMAIL/WEBHOOK AUDIT (sanitized: no secrets)')
  say('════════════════════════════════════════════════════════════════════')

  // Provenance: the exact commit this audit ran from.
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    const subject = execSync('git log -1 --format=%s', { encoding: 'utf8' }).trim()
    say(` audit commit: ${sha} — ${clip(subject, 80)}`)
  } catch {
    say(' audit commit: unknown (not a git checkout)')
  }
  say(` audit time:   ${new Date().toISOString()}`)
  say('')

  const token = requireEnv('VERCEL_TOKEN')
  const orgId = requireEnv('VERCEL_ORG_ID')
  const planes = [
    { label: 'scholario-platform (control plane)', projectId: requireEnv('VERCEL_PROJECT_ID') },
    { label: 'scholario-app (school plane)', projectId: requireEnv('VERCEL_PROJECT_ID_SCHOOL') },
  ]

  // ── 1. Vercel env inventory (names + production targeting only) ─────────
  say('──────────────────────────────────────────────────────────────────')
  say(' 1. VERCEL ENV INVENTORY (presence + production targeting)')
  say('──────────────────────────────────────────────────────────────────')
  const watchKeys = [
    'EMAIL_PROVIDER',
    'EMAIL_FROM',
    'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET',
    'GMAIL_SMTP_USER',
    'GMAIL_SMTP_APP_PASSWORD',
  ]
  const envByPlane: Record<string, VercelEnvDoc[]> = {}
  for (const plane of planes) {
    const envs = await listEnv(plane.projectId, orgId, token)
    envByPlane[plane.projectId] = envs
    say(`  ${plane.label}`)
    for (const key of watchKeys) {
      const rec = envs.find((e) => e.key === key)
      if (!rec) {
        say(`    ${key.padEnd(26)} ⛔ not set`)
      } else {
        const prod = rec.target.includes('production')
        say(`    ${key.padEnd(26)} ✅ set${prod ? ' (production target)' : ` (targets: ${rec.target.join(',')})`}`)
      }
    }
  }
  say('')

  // ── 2. Decrypted values: config keys printed, secrets compared only ─────
  say('──────────────────────────────────────────────────────────────────')
  say(' 2. CONFIG VALUES (printable config only; secrets: boolean/compare)')
  say('──────────────────────────────────────────────────────────────────')
  const values: Record<string, Record<string, string | undefined>> = {
    // planeProjectId -> envKey -> value
  }
  for (const plane of planes) {
    const vals: Record<string, string | undefined> = {}
    const envs = envByPlane[plane.projectId]
    for (const key of [...PRINTABLE_ENV_KEYS, ...SECRET_ENV_KEYS]) {
      const rec = envs.find((e) => e.key === key)
      if (!rec) continue
      try {
        vals[key] = await fetchEnvValue(plane.projectId, orgId, token, rec.id)
      } catch (e) {
        say(`  [warn] could not decrypt ${key} on ${plane.label}: ${clip((e as Error).message, 120)}`)
      }
    }
    values[plane.projectId] = vals
  }

  for (const plane of planes) {
    const vals = values[plane.projectId]
    const present = new Set(envByPlane[plane.projectId].map((e) => e.key))
    say(`  ${plane.label}`)
    for (const key of PRINTABLE_ENV_KEYS) {
      const v = vals[key]
      say(`    ${key.padEnd(26)} ${v ? clip(v, 90) : present.has(key) ? '«set, value write-only via API»' : '«unset → code default»'}`)
    }
    for (const key of SECRET_ENV_KEYS) {
      // Presence comes from the INVENTORY (authoritative); readability is
      // separate — a dashboard-created Sensitive value is write-only via
      // API even though the deployment runtime can read it fine.
      say(
        `    ${key.padEnd(26)} ${present.has(key) ? (vals[key] ? `set (value withheld, length ${vals[key]!.length})` : 'set — value WRITE-ONLY via API (dashboard Sensitive; the runtime still reads it)') : '«unset»'}`,
      )
    }
  }
  const platformVals = values[planes[0].projectId]
  const schoolVals = values[planes[1].projectId]
  const secA = platformVals['RESEND_WEBHOOK_SECRET']
  const secB = schoolVals['RESEND_WEBHOOK_SECRET']
  const secretAgreement =
    secA && secB ? (secA === secB ? 'IDENTICAL on both planes ✓' : '⚠ DIFFER between planes!') : 'insufficient (one/both unset)'
  say(`  RESEND_WEBHOOK_SECRET cross-plane comparison: ${secretAgreement}`)
  const keyA = platformVals['RESEND_API_KEY']
  const keyB = schoolVals['RESEND_API_KEY']
  const keyAgreement = keyA && keyB ? (keyA === keyB ? 'IDENTICAL on both planes ✓' : '⚠ DIFFER between planes!') : 'insufficient'
  say(`  RESEND_API_KEY cross-plane comparison:       ${keyAgreement}`)
  say('')

  // Probe key: an explicit RESEND_API_KEY (e.g. repository secret in the
  // runner) wins; else the decrypted Vercel values (empty when the var is
  // dashboard-Sensitive — write-only via API).
  const apiKey = ((process.env.RESEND_API_KEY ?? '').trim() || keyA || keyB || '') as string
  const keyPresentInInventory = envByPlane[planes[0].projectId].some((e) => e.key === 'RESEND_API_KEY') || envByPlane[planes[1].projectId].some((e) => e.key === 'RESEND_API_KEY')

  // ── 3. Resend live probes ───────────────────────────────────────────────
  say('──────────────────────────────────────────────────────────────────')
  say(' 3. RESEND LIVE STATE (GET /domains, GET /webhooks — read-only)')
  say('──────────────────────────────────────────────────────────────────')
  let verifiedDomains = 0
  let totalDomains = 0
  const webhooks: Array<Record<string, unknown>> = []
  if (!apiKey) {
    say('  ⛔ RESEND_API_KEY value not readable from this channel (set in the inventory but write-only via API, and no env override) — the provider-side probes need either an env-provided key or the IN-APP live diagnostics (GET /api/platform/health/email?live=1, which uses the deployment runtime key).')
  } else {
    try {
      const domainsDoc = (await getJson(
        RESEND_API_BASE,
        '/domains',
        { Authorization: `Bearer ${apiKey}` },
        'Resend GET /domains',
      )) as { data?: Array<Record<string, unknown>> } | null
      const domains = Array.isArray(domainsDoc?.data) ? domainsDoc.data : []
      totalDomains = domains.length
      say(`  domains (${totalDomains}):`)
      for (const d of domains) {
        const name = str(d.name) || '«unnamed»'
        const status = str(d.status) || '«unknown»'
        const created = str(d.created_at)
        if (status.toLowerCase() === 'verified') verifiedDomains += 1
        say(`    · ${name.padEnd(34)} status=${status}  ${created ? `created ${created.slice(0, 10)}` : ''}`)
      }
    } catch (e) {
      say(`  [error] GET /domains failed: ${clip((e as Error).message, 160)}`)
    }
    try {
      const whDoc = (await getJson(
        RESEND_API_BASE,
        '/webhooks',
        { Authorization: `Bearer ${apiKey}` },
        'Resend GET /webhooks',
      )) as { data?: Array<Record<string, unknown>> } | null
      const list = Array.isArray(whDoc?.data) ? whDoc.data : []
      webhooks.push(...list)
      say(`  webhook endpoints (${list.length}):`)
      for (const w of list) {
        for (const [k, v] of Object.entries(w)) {
          if (!WEBHOOK_PRINTABLE_FIELDS.has(k) || MASK_SECRET_KEY_RE.test(k)) continue
          const vs = typeof v === 'object' ? JSON.stringify(v) : String(v)
          say(`    · ${k}: ${clip(vs, 120)}`)
        }
        say('    ──')
      }
      if (list.length === 0) say('    · NONE registered — delivered emails stay QUEUED forever (no delivery evidence).')
    } catch (e) {
      say(`  [error] GET /webhooks failed: ${clip((e as Error).message, 160)}`)
    }
  }
  say('')

  // DB-derived verdict inputs (populated in §4 when the DB audit runs).
  const recentFailures: Array<Record<string, unknown>> = []
  let recentWebhookEventCount = 0
  let lastWebhookEventAt = 'none in the last 14 days'

  // ── 4. Production outbox truth (read-only) ──────────────────────────────
  say('──────────────────────────────────────────────────────────────────')
  say(' 4. PRODUCTION OUTBOX (EmailDelivery + WebhookEvent — read-only)')
  say('──────────────────────────────────────────────────────────────────')
  if (skipDb) {
    say('  skipped (--skip-db)')
  } else {
    const supaToken = process.env.SUPABASE_ACCESS_TOKEN
    const supaRef = process.env.SUPABASE_PROJECT_REF
    if (!supaToken || !supaRef) {
      say('  skipped (SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not provided)')
    } else {
      const q = (sql: string, label: string) => mgmtQuery(supaToken, supaRef, sql, label)

      // NOTE: every query below is a single read-only SELECT.
      const statusRows = await q(
        `SELECT status, count(*)::int AS n FROM "EmailDelivery" GROUP BY status ORDER BY n DESC`,
        'EmailDelivery status counts',
      )
      say('  EmailDelivery by status:')
      for (const r of statusRows) say(`    · ${str(r.status).padEnd(12)} ${num(r.n)}`)

      const templateRows = await q(
        `SELECT template, count(*)::int AS n, max("updatedAt")::text AS last FROM "EmailDelivery" GROUP BY template ORDER BY n DESC`,
        'EmailDelivery template counts',
      )
      say('  EmailDelivery by template:')
      for (const r of templateRows) say(`    · ${str(r.template).padEnd(26)} n=${num(r.n).toString().padEnd(5)} last=${str(r.last).slice(0, 19)}`)

      const failureRows = await q(
        `SELECT template, "lastError", "updatedAt"::text AS at FROM "EmailDelivery" WHERE status IN ('FAILED','BOUNCED','COMPLAINED') ORDER BY "updatedAt" DESC LIMIT 8`,
        'recent failures',
      )
      recentFailures.push(...failureRows)
      say('  recent failures (template + parsed error class — class tag only where parseable):')
      if (failureRows.length === 0) say('    · none on record')
      for (const r of failureRows) {
        const tag = (str(r.lastError).match(/^\[([a-z-]+)\]/) ?? [])[1] ?? 'unclassified'
        say(`    · ${str(r.template).padEnd(22)} [${tag}] at ${str(r.at).slice(0, 19)}`)
      }

      const queuedRows = await q(
        `SELECT count(*)::int AS n FROM "EmailDelivery" WHERE status = 'QUEUED' AND "providerMessageId" IS NOT NULL`,
        'QUEUED with provider message id',
      )
      const queuedTotal = await q(
        `SELECT count(*)::int AS n FROM "EmailDelivery" WHERE status = 'QUEUED'`,
        'QUEUED total',
      )
      say(`  QUEUED rows: ${num(queuedTotal[0]?.n)} total, ${num(queuedRows[0]?.n)} with a provider message id (webhook-eligible)`)

      // QUEUED row detail — the exact rows waiting for delivery evidence.
      const queuedDetail = await q(
        `SELECT template, status, "providerMessageId", "createdAt"::text AS at FROM "EmailDelivery" WHERE status = 'QUEUED' ORDER BY "createdAt" DESC LIMIT 10`,
        'QUEUED detail',
      )
      for (const r of queuedDetail) {
        const pid = str(r.providerMessageId)
        say(`    · QUEUED ${str(r.template).padEnd(26)} at ${str(r.at).slice(0, 19)} providerId=${pid === 'dev-log' ? '«dev-log!»' : clip(pid, 24)}`)
      }

      // SENT provenance — how did each SENT row get its evidence?
      //   providerMessageId = 'dev-log'     → dev transport row (fabricated
      //                                       delivery for the dev database;
      //                                       in production this is the
      //                                       fake-success smell the
      //                                       production guard stops)
      //   real provider id                  → upgraded by the webhook's
      //                                       email.delivered event
      const sentProvenance = await q(
        `SELECT CASE WHEN "providerMessageId" = 'dev-log' THEN 'dev-log' WHEN "providerMessageId" IS NULL THEN 'no-id' ELSE 'webhook-upgraded' END AS kind, count(*)::int AS n, max("updatedAt")::text AS last FROM "EmailDelivery" WHERE status = 'SENT' GROUP BY kind`,
        'SENT provenance',
      )
      say('  SENT row provenance:')
      if (sentProvenance.length === 0) say('    · none')
      for (const r of sentProvenance) {
        say(`    · ${str(r.kind).padEnd(16)} n=${num(r.n).toString().padEnd(4)} last=${str(r.last).slice(0, 19)}`)
      }

      // When did each Resend webhook event arrive (the delivery-evidence trail)?
      const whTimeline = await q(
        `SELECT to_char("receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "WebhookEvent" WHERE "gatewayName" = 'resend' GROUP BY day ORDER BY day DESC LIMIT 10`,
        'webhook event timeline',
      )
      say('  Resend webhook events by day (UTC):')
      if (whTimeline.length === 0) say('    · none')
      for (const r of whTimeline) say(`    · ${str(r.day)}  n=${num(r.n)}`)

      const inviteRows = await q(
        `SELECT template, status, recipient, "updatedAt"::text AS at, "lastError" FROM "EmailDelivery" WHERE "dedupeKey" LIKE 'principal-invite:%' ORDER BY "updatedAt" DESC LIMIT 12`,
        'principal invite rows',
      )
      say('  principal-invite delivery rows (recipients masked):')
      if (inviteRows.length === 0) say('    · none on record')
      for (const r of inviteRows) {
        const tag = (str(r.lastError).match(/^\[([a-z-]+)\]/) ?? [])[1] ?? (str(r.lastError) ? 'unclassified' : '')
        say(
          `    · ${str(r.template).padEnd(18)} ${str(r.status).padEnd(10)} ${maskAddress(str(r.recipient)).padEnd(26)} at ${str(r.at).slice(0, 19)}${tag ? ` [${tag}]` : ''}`,
        )
      }

      const whRows = await q(
        `SELECT "eventType", status, "receivedAt"::text AS at, error, "matchedTransactionId" FROM "WebhookEvent" WHERE "gatewayName" = 'resend' ORDER BY "receivedAt" DESC LIMIT 10`,
        'resend webhook events',
      )
      const whCount = await q(
        `SELECT count(*)::int AS n FROM "WebhookEvent" WHERE "gatewayName" = 'resend'`,
        'resend webhook count',
      )
      const whRecent = await q(
        `SELECT count(*)::int AS n, max("receivedAt")::text AS last FROM "WebhookEvent" WHERE "gatewayName" = 'resend' AND "receivedAt" >= NOW() - INTERVAL '14 days'`,
        'recent resend webhook count',
      )
      recentWebhookEventCount = num(whRecent[0]?.n)
      if (recentWebhookEventCount > 0) lastWebhookEventAt = str(whRecent[0]?.last).slice(0, 19)
      say(`  Resend WebhookEvent rows (total ${num(whCount[0]?.n)}):`)
      if (whRows.length === 0) say('    · none — no signed provider event has EVER reached production.')
      for (const r of whRows) {
        say(
          `    · ${str(r.eventType).padEnd(18)} status=${str(r.status).padEnd(10)} at ${str(r.at).slice(0, 19)}${str(r.error) ? ` error=${clip(str(r.error), 60)}` : ''}${str(r.matchedTransactionId) ? ' matched=yes' : ''}`,
        )
      }
    }
  }
  say('')

  // ── 5. Verdict ─────────────────────────────────────────────────────────
  say('──────────────────────────────────────────────────────────────────')
  say(' 5. VERDICT (mission questions, evidence-based)')
  say('──────────────────────────────────────────────────────────────────')
  say(
    `  A. Resend API key configured in production: ${keyPresentInInventory ? (apiKey ? 'YES (readable in this channel)' : 'YES (set per inventory; value write-only via API — the runtime reads it fine)') : 'NO'}`,
  )
  const testingEvidence = recentFailures.find((r) => str(r.lastError).includes('testing-recipient-restricted'))
  if (apiKey && verifiedDomains > 0) {
    say(`  B. Verified sending domain: YES (${verifiedDomains}/${totalDomains} verified)`)
  } else if (apiKey) {
    say(
      `  B. Verified sending domain: NO (${totalDomains} domain(s) live-probed, none verified) — testing mode: onboarding@resend.dev can ONLY deliver to the Resend account owner's address; invites to other addresses 403 [testing-recipient-restricted]`,
    )
  } else if (testingEvidence) {
    say(
      `  B. Verified sending domain: UNKNOWN via this channel (key write-only) — but the most recent [testing-recipient-restricted] failure at ${str(testingEvidence.updatedAt).slice(0, 19)} proves the provider still enforced owner-only delivery then (the in-app live diagnostics GET /api/platform/health/email?live=1 is the standing check)`,
    )
  } else {
    say('  B. Verified sending domain: UNKNOWN via this channel (key write-only, no recent testing-restriction failure on record)')
  }
  if (apiKey && webhooks.length > 0) {
    say(`  C. Resend webhook endpoint registered: YES (see §3 URL/events)`)
  } else if (apiKey) {
    say('  C. Resend webhook endpoint registered: NO (live-probed: zero endpoints) — delivery evidence never arrives; delivered mail stays QUEUED')
  } else if (recentWebhookEventCount > 0) {
    say(
      `  C. Resend webhook endpoint registered: UNKNOWN via this channel (key write-only) — but ${recentWebhookEventCount} signature-verified Resend webhook event(s) were processed (latest ${lastWebhookEventAt}), so an endpoint + a MATCHING secret existed then; the in-app live diagnostics shows the current endpoint list`,
    )
  } else {
    say('  C. Resend webhook endpoint registered: UNKNOWN via this channel (key write-only, zero webhook events on record)')
  }
  say(
    `  D. Webhook signing secret on both planes: ${secA && secB ? (secA === secB ? 'YES + identical' : 'SET BUT MISMATCHED between planes') : 'NO/INCOMPLETE — route stays fail-closed (401) until set on BOTH planes'}`,
  )
  say('  NOTE: C+D can only be PROVEN end-to-end by a live delivered event landing in')
  say('        WebhookEvent — this audit reports configuration, the live delivery')
  say('        verification (controlled recipient) closes that loop.')
  say('')
  say(' audit complete — configuration evidence only; nothing was sent or mutated.')
}

main().catch((e: Error) => {
  console.error(`[email-audit] FAILED: ${redactSecrets(e.message)}`)
  process.exit(1)
})
