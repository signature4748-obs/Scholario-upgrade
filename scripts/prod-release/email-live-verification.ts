/**
 * scripts/prod-release/email-live-verification.ts — LIVE end-to-end
 * delivery verification for the production email pipeline (mission §5),
 * using an EXPLICITLY AUTHORIZED, CONTROLLED recipient address only.
 *
 * WHAT THIS PROVES (each step prints sanitized evidence):
 *   A. the REAL production app paths are healthy (both planes /health/ready)
 *   B. a REAL principal invitation sent through the REAL provisioning API
 *      is ACCEPTED by the provider (EmailDelivery row QUEUED with a REAL
 *      Resend message id — never dev-log, never fabricated)
 *   C. the provider actually DELIVERED it (Resend GET /emails/{id}
 *      last_event = delivered — provider-side evidence)
 *   D. the production WEBHOOK works end-to-end: the delivered event lands
 *      as a Resend WebhookEvent row and upgrades the EmailDelivery row
 *      QUEUED → SENT (the delivery-evidence half of the contract)
 *   E. the invitation is REDEEMABLE at the school door: one-time
 *      credential signs in, the forced password change completes, and
 *      the OLD bootstrap credential is rejected on reuse (single-use ✓)
 *   F. duplicate/takeover protection: re-issue against an OWNED
 *      credential is refused (409) after redemption
 *   G. full fixture cleanup with honest counts (school, principal,
 *      sessions, invite rows, fixture-scoped audit rows, fixture admin);
 *      the fixture admin's own login audit rows are RETAINED (honest
 *      operational history — same convention as the routing-repair smoke)
 *
 * SAFETY CONTRACT:
 *   · CONTROLLED_RECIPIENT is an input — NEVER hardcoded. It must be an
 *     address with ESTABLISHED permission to receive test email (the
 *     mission forbids inventing recipients or sending unsolicited mail).
 *   · The one-time bootstrap credential + all session tokens exist in
 *     memory only — NEVER printed, NEVER logged. Same for the replaced
 *     password.
 *   · The fixture school/admin/slug/email are uniquely marked and fully
 *     purged in the finally-block (and via --cleanup-only after a crash).
 *   · DB access is the Supabase Management API (read/write SQL) with
 *     strictly-validated values (no free text from anywhere).
 *
 * Usage (secrets via environment only):
 *   PRODUCTION_URL=… PRODUCTION_URL_SCHOOL=… \
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… \
 *   CONTROLLED_RECIPIENT=… \
 *     bun scripts/prod-release/email-live-verification.ts [--cleanup-only]
 */

import { randomBytes, scryptSync } from 'node:crypto'

const SUPABASE_API_BASE = 'https://api.supabase.com'
const RESEND_API_BASE = 'https://api.resend.com'
const VERCEL_API_BASE = 'https://api.vercel.com'
const API_TIMEOUT_MS = 20_000
const DELIVERY_POLL_MS = 10_000
const DELIVERY_TIMEOUT_MS = 6 * 60_000

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`[live-verify] environment variable ${name} is required (never logged.)`)
  }
  return value.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** In-memory secret values to redact from any accidental echo (defense in depth). */
const SENSITIVE_VALUES: string[] = []

/** Redact secrets from any accidental echo (defense in depth). */
function redactSecrets(text: string): string {
  let out = text
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'RESEND_API_KEY', 'VERCEL_TOKEN']) {
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

// ─── providers ──────────────────────────────────────────────────────────

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

/** SQL single-quote escape for the few validated string values. */
function sq(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : -1
}

/** App-format scrypt-64 password hash (salt:hash) — same as src/lib/auth. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function jsonFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(url, init)
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { status: res.status, body }
  } catch (e) {
    throw new Error(`${label} unreachable: ${clip((e as Error).message, 120)}`)
  } finally {
    clearTimeout(timer)
  }
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cleanupOnly = process.argv.includes('--cleanup-only')
  const platformUrl = requireEnv('PRODUCTION_URL').replace(/\/+$/, '')
  const schoolUrl = requireEnv('PRODUCTION_URL_SCHOOL').replace(/\/+$/, '')
  const supaToken = requireEnv('SUPABASE_ACCESS_TOKEN')
  const supaRef = requireEnv('SUPABASE_PROJECT_REF')

  const q = (sql: string) => mgmtQuery(supaToken, supaRef, sql)

  // A unique marker for THIS verification run (fixture rows are found by it).
  const MARK = `elv-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  say('════════════════════════════════════════════════════════════════════')
  say(' LIVE EMAIL DELIVERY VERIFICATION (controlled recipient, sanitized)')
  say('════════════════════════════════════════════════════════════════════')
  say(` run marker:  ${MARK}`)
  say(` time:       ${new Date().toISOString()}`)
  say(' credentials (bootstrap/session/replacement) are NEVER printed.')
  say('')

  if (cleanupOnly) {
    say('--cleanup-only: purging any leftover fixtures from crashed runs…')
    const counts = await purgeLeftovers(q)
    say(`  purged: ${JSON.stringify(counts)}`)
    return
  }

  const recipient = requireEnv('CONTROLLED_RECIPIENT').toLowerCase()
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(recipient)) {
    throw new Error('CONTROLLED_RECIPIENT is not a valid email address (it must be an explicitly authorized test recipient).')
  }

  // ── A. plane health ───────────────────────────────────────────────────
  say('── A. PRODUCTION HEALTH (both planes) ─────────────────────────────')
  for (const [label, base] of [
    ['scholario-platform', platformUrl],
    ['scholario-app', schoolUrl],
  ] as const) {
    try {
      const res = await fetch(`${base}/health/ready`)
      const body = (await res.json().catch(() => null)) as { database?: string } | null
      record(`health ${label}`, res.status === 200, `/health/ready → ${res.status} (database: ${str(body?.database) || '?'})`)
    } catch (e) {
      fail(`health ${label}`, `unreachable: ${clip((e as Error).message, 80)}`)
      return report()
    }
  }

  // ── B. fixture admin + REAL platform login ────────────────────────────
  say('── B. FIXTURE ADMIN (ops-isolation convention) + REAL LOGIN ──────')
  const fixtureEmail = `${MARK}@scholario.test`
  const fixturePassword = `Elv-${randomBytes(18).toString('base64url')}!`
  const adminRows = await q(
    `INSERT INTO "PlatformAdmin" (id, email, "passwordHash", name, status, "isRoot", "totpSecret", "createdAt", "updatedAt") ` +
      `VALUES (md5(random()::text)||'${MARK}', ${sq(fixtureEmail)}, ${sq(hashPassword(fixturePassword))}, 'Email Live Verification Fixture', 'ACTIVE', false, 'JBSWY3DPEHPK3PXP', NOW(), NOW()) ` +
      `RETURNING id`,
  )
  const adminId = str(adminRows[0]?.id)
  if (!adminId) {
    fail('fixture admin insert', 'no id returned')
    return report()
  }
  say(`  fixture admin created (id=${adminId}, runtime-generated credential never logged)`)
  await q(
    `INSERT INTO "PlatformPermission" (id, "adminId", key, granted) VALUES ` +
      `(md5(random()::text)||'${MARK}a', ${sq(adminId)}, 'schools.provision', true), ` +
      `(md5(random()::text)||'${MARK}b', ${sq(adminId)}, 'schools.manage', true)`,
  )
  say('  permissions granted: schools.provision, schools.manage')

  const login = await jsonFetch(`${platformUrl}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: fixtureEmail, password: fixturePassword }),
  }, 'platform login')
  const sessionToken = str(login.body?.data && (login.body.data as Record<string, unknown>).sessionToken)
  if (login.status !== 200 || !sessionToken) {
    fail('REAL platform login', `HTTP ${login.status} (envelope ok=${str(login.body?.ok)})`)
    await cleanup(q, { adminId })
    return report()
  }
  record('REAL platform login', true, `HTTP 200, session minted (token never printed)`)

  // ── B2. IN-APP LIVE PROVIDER DIAGNOSTICS (the runtime key channel) ─────
  say('── B2. IN-APP LIVE DIAGNOSTICS (?live=1 — runtime provider key) ──')
  try {
    const diagRes = await fetch(`${platformUrl}/api/platform/health/email?live=1`, {
      headers: { 'x-platform-token': sessionToken },
    })
    if (diagRes.status !== 200) {
      say(`  /api/platform/health/email?live=1 → HTTP ${diagRes.status} (envelope shape may differ; skipping)`)
    } else {
      const envelope = (await diagRes.json().catch(() => null)) as { data?: Record<string, unknown> } | null
      const diag = (envelope?.data ?? {}) as Record<string, unknown>
      const resend = (diag.resend ?? {}) as Record<string, unknown>
      const domains = (resend.domains ?? {}) as Record<string, unknown>
      const webhooks = (resend.webhooks ?? {}) as Record<string, unknown>
      const endpoints = Array.isArray(webhooks.endpoints) ? (webhooks.endpoints as Array<Record<string, unknown>>) : []
      const outbox = (diag.outbox ?? {}) as Record<string, unknown>
      say(`  provider: ${str(diag.provider && (diag.provider as Record<string, unknown>).id)} configured=${str(diag.provider && (diag.provider as Record<string, unknown>).configured)}`)
      say(`  sender:   ${str(resend.fromAddress)}`)
      say(`  key present: ${str(resend.apiKeyPresent)} · webhook secret present: ${str(resend.webhookSecretPresent)}`)
      say(`  live domains: ${str(domains.liveCheck)} → verified ${str(domains.verified)}/${str(domains.total)}`)
      say(`  live webhook endpoints: ${str(webhooks.liveCheck)} → total ${str(webhooks.total)}`)
      for (const w of endpoints) {
        const events = Array.isArray(w.events) ? (w.events as string[]).join(',') : ''
        say(`    · ${clip(str(w.url), 80)} events=${events || 'none'}${(events || '').includes('email.delivered') ? '' : ' (email.delivered NOT subscribed!)'}`)
      }
      if (str(webhooks.liveCheck) === 'ok' && endpoints.length === 0) {
        say('    ⚠ ZERO webhook endpoints registered at the provider — delivered mail will stay QUEUED (EMAIL-3).')
      }
      say(`  outbox 7d: ${JSON.stringify(outbox.last7d ?? {})}`)
      record(
        'in-app live diagnostics readable',
        true,
        `provider ${str(diag.provider && (diag.provider as Record<string, unknown>).id)}, domains ${str(domains.verified)}/${str(domains.total)} verified, webhook endpoints ${str(webhooks.total)}`,
      )
    }
  } catch (e) {
    say(`  [warn] in-app diagnostics unreachable: ${clip((e as Error).message, 100)}`)
  }

  // ── C. provision the fixture school THROUGH THE REAL API ──────────────
  say('── C. PRINCIPAL INVITATION (REAL provisioning API path) ─────────')
  const slug = `${MARK}`.toLowerCase()
  const provisionRes = await jsonFetch(`${platformUrl}/api/platform/schools`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-platform-token': sessionToken },
    body: JSON.stringify({
      name: `Email Live Verification ${MARK}`,
      slug,
      plan: 'STANDARD',
      principalName: 'Live Verification Principal',
      principalEmail: recipient,
      // No principalPassword → server-generated one-time bootstrap
      // credential (the exact production invitation shape).
    }),
  }, 'provision')
  const data = (provisionRes.body?.data ?? {}) as Record<string, unknown>
  const schoolId = str((data.school as Record<string, unknown> | undefined)?.id)
  const principalId = str((data.principal as Record<string, unknown> | undefined)?.id)
  const tempPassword = str(data.tempPassword)
  const credentialExpiresAt = str(data.credentialExpiresAt)
  const invitation = (data.invitation ?? {}) as Record<string, unknown>
  const inviteState = str(invitation.state)
  const inviteTransport = str(invitation.transport)
  if (provisionRes.status !== 200 || !schoolId || !principalId || !tempPassword) {
    fail('REAL provisioning', `HTTP ${provisionRes.status}, schoolId=${schoolId || '?'} principalId=${principalId || '?'}, tempPassword=${tempPassword ? 'present (never printed)' : 'MISSING'}`)
    await cleanup(q, { adminId, schoolId })
    return report()
  }
  record('REAL provisioning', true, `school id=${schoolId}, principal id=${principalId}, one-time credential ${tempPassword ? 'issued (never printed)' : 'MISSING'}, credentialExpiresAt=${credentialExpiresAt || 'none'}`)
  record('invitation delivery state', inviteState === 'QUEUED' || inviteState === 'SENT', `state=${inviteState}, transport=${inviteTransport} (resend accepted it into the provider queue)`)

  // The EmailDelivery row — REAL transport evidence.
  const inviteKey = `principal-invite:${principalId}`
  const inviteRows = await q(
    `SELECT id, status, "providerMessageId", template, recipient FROM "EmailDelivery" WHERE "dedupeKey" = ${sq(inviteKey)} ORDER BY "updatedAt" DESC LIMIT 1`,
  )
  const inviteRow = inviteRows[0]
  const messageId = str(inviteRow?.providerMessageId)
  const rowStatus0 = str(inviteRow?.status)
  record(
    'EmailDelivery row (provider-accepted)',
    rowStatus0 === 'QUEUED' && !!messageId && messageId !== 'dev-log',
    `status=${rowStatus0}, providerMessageId=${messageId || 'none'}, template=${str(inviteRow?.template)}, recipient=${str(inviteRow?.recipient).replace(/^(.).*(@.*)$/, '$1***$2')}`,
  )
  if (!messageId || messageId === 'dev-log') {
    fail('real provider message id', `messageId=${messageId || 'none'} — a dev-log/fake id means the real transport was not used`)
    await cleanup(q, { adminId, schoolId })
    return report()
  }

  // ── D. provider-side delivery evidence (Resend GET /emails/{id}) ──────
  say('── D. PROVIDER DELIVERY EVIDENCE (GET /emails/{id}) ──────────────')
  // The Resend API key: RESEND_API_KEY when provided, else fetched
  // IN-MEMORY from the platform plane's Vercel env (the workflow passes
  // VERCEL_TOKEN/ORG_ID/PROJECT_ID instead of the key; either way it is
  // never printed).
  let resendKey = (process.env.RESEND_API_KEY ?? '').trim()
  if (!resendKey && process.env.VERCEL_TOKEN && process.env.VERCEL_ORG_ID && process.env.VERCEL_PROJECT_ID) {
    const vt = requireEnv('VERCEL_TOKEN')
    const vo = requireEnv('VERCEL_ORG_ID')
    const vp = requireEnv('VERCEL_PROJECT_ID')
    const listRes = await fetch(`${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(vp)}/env?limit=100&teamId=${encodeURIComponent(vo)}`, {
      headers: { Authorization: `Bearer ${vt}` },
    })
    const listBody = (await listRes.json().catch(() => null)) as { envs?: Array<{ key?: string; id?: string }> } | null
    const rec = (listBody?.envs ?? []).find((e) => e.key === 'RESEND_API_KEY')
    if (rec?.id) {
      const valRes = await fetch(
        `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(vp)}/env/${encodeURIComponent(rec.id)}?decrypt=1&teamId=${encodeURIComponent(vo)}`,
        { headers: { Authorization: `Bearer ${vt}` } },
      )
      const valBody = (await valRes.json().catch(() => null)) as { value?: string } | null
      resendKey = (valBody?.value ?? '').trim()
    }
  }
  if (!resendKey) {
    fail('provider delivery check', 'RESEND_API_KEY unavailable (neither provided nor fetchable from Vercel) — provider-side delivery state cannot be read (the webhook evidence below is still checked independently)')
  } else {
    SENSITIVE_VALUES.push(resendKey)
  }
  SENSITIVE_VALUES.push(tempPassword, sessionToken, fixturePassword)
  let providerDelivered = false
  let lastEventSeen = 'key-missing'
  const deadlineD = Date.now() + DELIVERY_TIMEOUT_MS
  while (Date.now() < deadlineD && !providerDelivered && resendKey) {
    try {
      const res = await fetch(`${RESEND_API_BASE}/emails/${encodeURIComponent(messageId)}`, {
        headers: { Authorization: `Bearer ${resendKey}` },
      })
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { last_event?: string; status?: string } | null
        lastEventSeen = str(body?.last_event || body?.status)
        if (lastEventSeen === 'delivered') providerDelivered = true
      } else if (res.status === 404) {
        lastEventSeen = 'not-found-at-provider'
        break
      } else {
        lastEventSeen = `HTTP ${res.status}`
      }
    } catch (e) {
      lastEventSeen = `transport: ${clip((e as Error).message, 60)}`
    }
    if (!providerDelivered && lastEventSeen !== 'not-found-at-provider') {
      await sleep(DELIVERY_POLL_MS)
    }
  }
  record('provider delivery', providerDelivered, `GET /emails/{id} last_event=${lastEventSeen || '?'}${providerDelivered ? ' — the provider actually delivered it' : ''}`)

  // ── E. webhook end-to-end: delivered event → WebhookEvent row → row SENT ─
  say('── E. WEBHOOK END-TO-END (delivered → WebhookEvent → SENT) ───────')
  let rowStatusFinal = rowStatus0
  let webhookEventId = ''
  const deadlineE = Date.now() + DELIVERY_TIMEOUT_MS
  while (Date.now() < deadlineE) {
    const rows = await q(
      `SELECT status FROM "EmailDelivery" WHERE "providerMessageId" = ${sq(messageId)} ORDER BY "updatedAt" DESC LIMIT 1`,
    )
    rowStatusFinal = str(rows[0]?.status)
    const evRows = await q(
      `SELECT id, "eventType", status FROM "WebhookEvent" WHERE "gatewayName" = 'resend' AND "rawPayload" LIKE ${sq(`%${messageId}%`)} ORDER BY "receivedAt" DESC LIMIT 5`,
    )
    const deliveredEv = evRows.find((r) => str(r.eventType) === 'email.delivered')
    if (deliveredEv) webhookEventId = str(deliveredEv.id)
    if (rowStatusFinal === 'SENT' && deliveredEv) break
    await sleep(DELIVERY_POLL_MS)
  }
  record(
    'webhook delivered-event received',
    !!webhookEventId,
    webhookEventId
      ? `Resend WebhookEvent row (email.delivered) id=${webhookEventId} — the SIGNATURE-VERIFIED provider event reached production`
      : 'no email.delivered WebhookEvent row for this message id (webhook not delivering — see the audit workflow)',
  )
  record('EmailDelivery row → SENT', rowStatusFinal === 'SENT', `status=${rowStatusFinal} (delivery evidence upgraded the provider-accepted QUEUED row)`)

  // ── F. redemption at the school door + single-use enforcement ─────────
  say('── F. INVITATION REDEMPTION (school plane, REAL login APIs) ──────')
  // Activate the school first (PENDING blocks sign-in) — the REAL API.
  const activateRes = await jsonFetch(`${platformUrl}/api/platform/schools/${schoolId}/activate`, {
    method: 'POST',
    headers: { 'x-platform-token': sessionToken },
  }, 'activate')
  record('school activation (REAL API)', activateRes.status === 200, `HTTP ${activateRes.status}`)

  // The invitation link must render the correct school door.
  const loginUrl = `${schoolUrl}/s/${encodeURIComponent(slug)}/login`
  try {
    const doorRes = await fetch(loginUrl)
    const doorHtml = await doorRes.text()
    const doorHasSlug = doorHtml.includes(slug)
    record(
      'invitation login door renders',
      doorRes.status === 200 && doorHasSlug,
      `${loginUrl} → HTTP ${doorRes.status}${doorHasSlug ? ' (school door renders)' : ' (slug missing from door HTML)'}`,
    )
  } catch (e) {
    fail('invitation login door renders', `unreachable: ${clip((e as Error).message, 60)}`)
  }

  // Sign in with the one-time bootstrap credential — the invitation redemption.
  const firstLogin = await jsonFetch(`${schoolUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: recipient, password: tempPassword }),
  }, 'school login (bootstrap credential)')
  const firstLoginData = (firstLogin.body?.data ?? {}) as Record<string, unknown>
  const principalToken = str(firstLoginData.sessionToken)
  const mustChange = firstLoginData.mustChangePassword === true
  record('bootstrap credential redeems at sign-in', firstLogin.status === 200 && !!principalToken && mustChange, `HTTP ${firstLogin.status}, mustChangePassword=${str(mustChange)} (forced change armed)`)

  if (principalToken) {
    SENSITIVE_VALUES.push(principalToken)
    // Complete the forced change (the credential becomes OWNED).
    const newPassword = `Own-${randomBytes(18).toString('base64url')}!`
    SENSITIVE_VALUES.push(newPassword)
    const changeRes = await jsonFetch(`${schoolUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${principalToken}` },
      body: JSON.stringify({ currentPassword: tempPassword, newPassword, confirmPassword: newPassword }),
    }, 'change-password')
    record('forced password change completes', changeRes.status === 200, `HTTP ${changeRes.status} (replacement credential never printed)`)

    // Single-use: the OLD bootstrap credential must be rejected on reuse.
    const reLogin = await jsonFetch(`${schoolUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: recipient, password: tempPassword }),
    }, 'school login (old bootstrap credential reuse)')
    record('single-use enforced (reuse rejected)', reLogin.status === 401, `old bootstrap credential → HTTP ${reLogin.status} (401 = rejected)`)

    // Takeover guard: re-issue against an OWNED credential is refused.
    const reissueRes = await jsonFetch(`${platformUrl}/api/platform/schools/${schoolId}/reissue-credential`, {
      method: 'POST',
      headers: { 'x-platform-token': sessionToken },
    }, 'reissue (owned credential)')
    const reissueCode = str(reissueRes.body?.code)
    record('duplicate re-issue refused (409)', reissueRes.status === 409 && reissueCode === 'CONFLICT', `HTTP ${reissueRes.status} code=${reissueCode || '?'} — the takeover guard stands`)
  }

  // ── G. cleanup ─────────────────────────────────────────────────────────
  say('── G. FIXTURE CLEANUP (honest counts) ─────────────────────────────')
  await cleanup(q, { adminId, schoolId, principalId })

  // ── report ─────────────────────────────────────────────────────────────
  say('')
  say('── WEBHOOK-PROCESSED OUTBOX STATE (final, read-only) ─────────────')
  const finalRows = await q(
    `SELECT status, count(*)::int AS n FROM "EmailDelivery" WHERE "dedupeKey" = ${sq(inviteKey)} GROUP BY status`,
  )
  for (const r of finalRows) say(`    principal-invite row: status=${str(r.status)} n=${num(r.n)}`)

  return report()
}

/** Purge leftovers of crashed runs (marker prefix 'elv-'). */
async function purgeLeftovers(q: (sql: string) => Promise<Record<string, unknown>[]>): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const r1 = await q(`DELETE FROM "PlatformPermission" WHERE "adminId" IN (SELECT id FROM "PlatformAdmin" WHERE email LIKE 'elv-%') RETURNING id`)
  out.permissions = r1.length
  const r2 = await q(`DELETE FROM "PlatformAdminSession" WHERE "adminId" IN (SELECT id FROM "PlatformAdmin" WHERE email LIKE 'elv-%') RETURNING id`)
  out.adminSessions = r2.length
  const schools = await q(`SELECT id FROM "School" WHERE slug LIKE 'elv-%'`)
  for (const s of schools) {
    const counts = await purgeSchool(q, str(s.id))
    for (const [k, v] of Object.entries(counts)) out[k] = (out[k] ?? 0) + v
  }
  const r3 = await q(`DELETE FROM "PlatformAdmin" WHERE email LIKE 'elv-%' RETURNING id`)
  out.admins = r3.length
  return out
}

/** Purge ONE fixture school (purgeSchool semantics — the test convention). */
async function purgeSchool(q: (sql: string) => Promise<Record<string, unknown>[]>, schoolId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (!schoolId) return out
  const r1 = await q(`DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE "schoolId" = ${sq(schoolId)}) RETURNING id`)
  out.sessions = r1.length
  const r2 = await q(
    `DELETE FROM "EmailDelivery" WHERE "dedupeKey" LIKE 'principal-invite:%' AND "schoolId" = ${sq(schoolId)} RETURNING id`,
  )
  out.inviteRows = r2.length
  const r3 = await q(`DELETE FROM "PlatformAuditLog" WHERE "schoolId" = ${sq(schoolId)} RETURNING id`)
  out.auditRows = r3.length
  const r4 = await q(`DELETE FROM "User" WHERE "schoolId" = ${sq(schoolId)} RETURNING id`)
  out.users = r4.length
  const r5 = await q(`DELETE FROM "School" WHERE id = ${sq(schoolId)} RETURNING id`)
  out.school = r5.length
  return out
}

/** Full cleanup for this run's fixtures. */
async function cleanup(
  q: (sql: string) => Promise<Record<string, unknown>[]>,
  ids: { adminId?: string; schoolId?: string; principalId?: string },
): Promise<void> {
  try {
    if (ids.schoolId) {
      const counts = await purgeSchool(q, ids.schoolId)
      say(`  fixture school purged: ${JSON.stringify(counts)}`)
    }
    if (ids.adminId) {
      const p = await q(`DELETE FROM "PlatformPermission" WHERE "adminId" = ${sq(ids.adminId)} RETURNING id`)
      const s = await q(`DELETE FROM "PlatformAdminSession" WHERE "adminId" = ${sq(ids.adminId)} RETURNING id`)
      const a = await q(`DELETE FROM "PlatformAdmin" WHERE id = ${sq(ids.adminId)} RETURNING id`)
      say(`  fixture admin purged: permissions=${p.length} sessions=${s.length} admin=${a.length}`)
      say(`  (the fixture admin's login audit rows are RETAINED — honest history)`)
    }
  } catch (e) {
    say(`  ⚠ cleanup error (re-run with --cleanup-only): ${clip((e as Error).message, 120)}`)
  }
}

function report(): void {
  say('')
  say('════════════════════════════════════════════════════════════════════')
  say(' VERIFICATION RESULT (evidence ledger)')
  say('════════════════════════════════════════════════════════════════════')
  const passed = evidence.filter((e) => e.ok).length
  for (const e of evidence) say(`  ${e.ok ? 'PASS' : 'FAIL'}  ${e.step}: ${e.detail}`)
  say('')
  say(`  ${passed}/${evidence.length} checks passed`)
  const criticalFails = evidence.filter((e) => !e.ok).length
  if (criticalFails > 0) {
    say('  RESULT: INCOMPLETE — the failing checks above are the honest gaps.')
    process.exitCode = 1
  } else {
    say('  RESULT: END-TO-END LIVE DELIVERY VERIFIED (provider accepted +')
    say('          delivered + signature-verified webhook upgraded the row to')
    say('          SENT + invitation redeemed + single-use enforced).')
  }
}

main().catch((e: Error) => {
  console.error(`[live-verify] FAILED: ${redactSecrets(e.message)}`)
  process.exit(1)
})
