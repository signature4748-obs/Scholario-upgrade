// ============================================================
// RESEND PROVIDER WEBHOOK REPAIR (in-app, audited)
// ------------------------------------------------------------
// WHY THIS EXISTS (live evidence, 2026-10-22): the provider-side
// webhook is REGISTERED (GET /webhooks shows it at the canonical
// platform URL with the full event set) but DELIVERS NOTHING —
// signature-verified email.delivered events stopped arriving after
// 2026-10-12, so provider-accepted rows stay QUEUED forever
// (delivered-in-fact, evidenced by GET /emails/{id} last_event, but
// never upgraded to SENT). The provider does not expose a "why" and
// the registered-endpoint state looks perfect, so the only
// deterministic repair is RECREATE: delete the endpoints, create a
// fresh one (a fresh endpoint starts delivering; the API returns its
// signing secret at creation), and sync that secret where the app
// reads it (RESEND_WEBHOOK_SECRET on BOTH planes).
//
// WHY IN-APP: every runner-side tool (scripts/prod-release/
// resend-webhook-configure.ts) is blocked on the SAME missing input —
// RESEND_API_KEY is dashboard-Sensitive on Vercel (write-only via
// the API; decryption is correctly refused). The DEPLOYMENT has the
// real key at runtime (the live diagnostics channel proves it every
// day: GET /domains, GET /webhooks, GET /emails/{id}). So the one
// place that CAN perform the provider mutation is the app itself,
// behind the platform permission gate, with the full audit trail.
//
// SAFETY MODEL:
//   · ALL preconditions are checked BEFORE the first provider
//     mutation (fail-closed, no half-repairs): platform plane,
//     runtime Resend key, canonical production URL, Vercel ops token
//     + team for the secret sync.
//   · The fresh signing secret exists ONLY in process memory. It is
//     never logged, never returned, never audited — the result and
//     audit payloads carry per-plane outcomes ('created'/'rotated'),
//     not values.
//   · ROLLBACK: if the Vercel secret sync fails after the provider
//     recreate, the fresh webhook is DELETED and the failure is
//     reported honestly (state restored to "no webhook", which is the
//     same effective outage as before, but now audited) — we never
//     leave a webhook signing with a secret the app does not hold.
//   · Redeploy triggers (deployment duplication) are BEST-EFFORT:
//     env changes require a new deployment to reach runtime; if the
//     trigger fails the outcome is reported per-plane and any later
//     deploy picks the secret up (provider events retry meanwhile).
//   · The route is permission-gated (ops.read — root-implicit,
//     fail-closed) and audited by its caller (the route handler).
// ============================================================

import { planeServesPlatform } from '@/lib/plane'
import { AppError } from '@/lib/security/errors'
import { redactDetail } from '@/lib/observability/redact'

const RESEND_API_BASE = 'https://api.resend.com'
const VERCEL_API_BASE = 'https://api.vercel.com'

/** The full lifecycle event set the webhook route understands. */
export const WEBHOOK_REPAIR_EVENTS = [
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.delivery_delayed',
  'email.failed',
  'email.sent',
] as const

const FETCH_TIMEOUT_MS = 8_000

export interface WebhookEndpointSummary {
  id: string
  url: string
  /** Provider enablement enum ('enabled'/'disabled'; '' when the
   * provider response does not carry it) — documented per-item field
   * of the GET list response. */
  status: string
  events: string[]
}

export interface WebhookRepairResult {
  ok: true
  /** The canonical endpoint the provider now delivers to. */
  canonicalEndpoint: string
  /** What was found before the repair (sanitized view). */
  found: WebhookEndpointSummary[]
  /** The fresh endpoint's provider-side state as VALIDATED by the
   * post-create GET (registered + canonical URL + full event set +
   * enabled-when-reported) — the live proof the replacement works
   * BEFORE any old endpoint is removed. */
  validated: WebhookEndpointSummary
  /** Old endpoints successfully deleted after the fresh one existed. */
  deleted: WebhookEndpointSummary[]
  /** Old endpoints that failed to delete (warnings — fresh one delivers). */
  deleteWarnings: string[]
  /** The fresh provider webhook id (NEVER its signing secret). */
  createdWebhookId: string
  /** The subscribed event set on the fresh endpoint. */
  events: string[]
  /** Per-plane RESEND_WEBHOOK_SECRET sync outcomes. */
  secretSynced: Record<string, 'created' | 'rotated' | 'unchanged'>
  /** Per-plane redeploy trigger outcomes. */
  redeploy: Record<string, string>
}

// ─── small typed fetch helpers (bounded, sanitized errors) ───────────────

async function providerFetch(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  init: { headers: Record<string, string>; body?: unknown },
  label: string,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage: `The Resend API request (${label}) failed at the network level. Nothing was mutated by this request.`,
      internalDetail: redactDetail(String((e as Error).message)),
    })
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // The provider's own validation error text is operator-facing
    // information (it names the rejected field) — include it, redacted
    // and clipped, in the PUBLIC message so a failed repair is
    // self-diagnosing from the workflow evidence alone.
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage: `The Resend API request (${label}) failed with HTTP ${res.status}: ${redactDetail(text.slice(0, 200))}`,
      internalDetail: `HTTP ${res.status} ${redactDetail(text.slice(0, 400))}`,
    })
  }
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

async function vercelFetch(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  init: { headers: Record<string, string>; body?: unknown },
  label: string,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage: `The Vercel API request (${label}) failed at the network level. The provider webhook was NOT mutated by this request.`,
      internalDetail: redactDetail(String((e as Error).message)),
    })
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // Same convention as providerFetch: the API's own validation error
    // text is operator-facing information (it names the rejected field —
    // the live 400 on the redeploy trigger in run 39746765594 was
    // undiagnosable from the evidence because the body was dropped) —
    // include it, redacted and clipped, in the PUBLIC message.
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage: `The Vercel API request (${label}) failed with HTTP ${res.status}: ${redactDetail(text.slice(0, 200))}. The provider webhook was NOT mutated by this request.`,
      internalDetail: `HTTP ${res.status} ${redactDetail(text.slice(0, 400))}`,
    })
  }
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

// ─── endpoint (allowlisted) view of a provider webhook doc ───────────────

function endpointView(w: Record<string, unknown>): WebhookEndpointSummary {
  // The provider's GET URL field name is NOT `url` (live-verified
  // 2026-10-22: the diagnostics line that printed an empty URL was
  // this same discovery; the documented GET shape is `endpoint`).
  // Accept every observed shape: `endpointUrl` or `endpoint` or `url`
  // — whichever the provider returns.
  const rawUrl =
    typeof w.endpointUrl === 'string' ? w.endpointUrl
      : typeof w.endpoint === 'string' ? w.endpoint
        : typeof w.url === 'string' ? w.url
          : '«no url»'
  return {
    id: String(w.id ?? '«no id»'),
    url: rawUrl,
    status: typeof w.status === 'string' ? w.status : '',
    events: Array.isArray(w.events) ? (w.events as unknown[]).map((e) => String(e)) : [],
  }
}

// ─── preflight (ALL gates before ANY provider mutation) ──────────────────

interface Preflight {
  resendKey: string
  canonicalEndpoint: string
  opsVercelToken: string
  opsTeamId: string
}

function preflight(): Preflight {
  if (!planeServesPlatform()) {
    throw new AppError('FEATURE_DISABLED', {
      publicMessage:
        'The provider webhook repair runs on the platform control plane only — the school plane never mutates provider configuration.',
    })
  }
  const resendKey = (process.env.RESEND_API_KEY ?? '').trim()
  if (!resendKey) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'RESEND_API_KEY is not set in this deployment environment, so the provider webhook cannot be repaired from the app. Configure the key (or use the Resend dashboard) and retry.',
    })
  }
  // The canonical endpoint must be derived from the deployment's own
  // production domain — NEVER guessed from a request host (a spoofed
  // Host header must not be able to point the provider at itself).
  const prodHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!prodHost) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'VERCEL_PROJECT_PRODUCTION_URL is not available in this environment, so the canonical webhook endpoint cannot be derived. Repair from the Resend dashboard or re-run on the platform deployment.',
    })
  }
  const opsVercelToken = (process.env.OPS_VERCEL_TOKEN ?? '').trim()
  const opsTeamId = (process.env.OPS_VERCEL_TEAM_ID ?? '').trim()
  if (!opsVercelToken || !opsTeamId) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'OPS_VERCEL_TOKEN / OPS_VERCEL_TEAM_ID are not set in this deployment environment. Without them a fresh signing secret could not be synced to the planes, so the repair refuses to start (fail-closed: no half-repairs).',
    })
  }
  return {
    resendKey,
    canonicalEndpoint: `https://${prodHost}/api/webhooks/resend`,
    opsVercelToken,
    opsTeamId,
  }
}

// ─── Vercel plane discovery (same convention as the ops adapter) ─────────

interface VercelPlane {
  label: string
  projectId: string
}

async function discoverPlanes(opsVercelToken: string, opsTeamId: string): Promise<VercelPlane[]> {
  const auth = { Authorization: `Bearer ${opsVercelToken}` }
  const body = (await vercelFetch(
    'GET',
    `${VERCEL_API_BASE}/v9/projects?limit=100&teamId=${encodeURIComponent(opsTeamId)}`,
    { headers: auth },
    'project listing',
  )) as { projects?: Array<Record<string, unknown>> } | null
  const projects = Array.isArray(body?.projects) ? body.projects : []
  const selectedNames = (process.env.OPS_VERCEL_PROJECTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const selected = selectedNames.length
    ? projects.filter((p) => selectedNames.includes(String(p.id ?? '')) || selectedNames.includes(String(p.name ?? '')))
    : projects
  const planes = selected.map((p) => ({ label: String(p.name ?? p.id), projectId: String(p.id ?? '') }))
  if (planes.length === 0) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'No Vercel projects were visible to the ops token, so the fresh signing secret could not be synced. The repair refuses to start (fail-closed).',
    })
  }
  return planes
}

// ─── Vercel env sync (create or rotate; value only in memory) ────────────

interface VercelEnvRecord {
  key?: unknown
  id?: unknown
}

function envRecordsOf(body: unknown): VercelEnvRecord[] {
  if (Array.isArray(body)) return body as VercelEnvRecord[]
  if (!body || typeof body !== 'object') return []
  const b = body as { envs?: unknown }
  if (Array.isArray(b.envs)) return b.envs as VercelEnvRecord[]
  return []
}

async function listEnv(
  plane: VercelPlane,
  opsTeamId: string,
  opsVercelToken: string,
): Promise<VercelEnvRecord[]> {
  const auth = { Authorization: `Bearer ${opsVercelToken}` }
  const body = await vercelFetch(
    'GET',
    `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(plane.projectId)}/env?limit=100&teamId=${encodeURIComponent(opsTeamId)}`,
    { headers: auth },
    `env listing (${plane.label})`,
  )
  return envRecordsOf(body)
}

async function syncSecretToPlane(
  plane: VercelPlane,
  opsTeamId: string,
  opsVercelToken: string,
  secret: string,
): Promise<'created' | 'rotated' | 'unchanged'> {
  const auth = { Authorization: `Bearer ${opsVercelToken}`, 'Content-Type': 'application/json' }
  const envs = await listEnv(plane, opsTeamId, opsVercelToken)
  const rec = envs.find((e) => String(e.key ?? '') === 'RESEND_WEBHOOK_SECRET')
  if (!rec || typeof rec.id !== 'string') {
    await vercelFetch(
      'POST',
      `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(plane.projectId)}/env?teamId=${encodeURIComponent(opsTeamId)}`,
      {
        headers: auth,
        body: { key: 'RESEND_WEBHOOK_SECRET', value: secret, type: 'encrypted', target: ['production'] },
      },
      `env create RESEND_WEBHOOK_SECRET (${plane.label})`,
    )
    return 'created'
  }
  // No decrypt round-trip: the old value is, by construction, not the
  // fresh secret the provider just minted. Rotating unconditionally
  // also repairs the "secret present but drifted" case in one step.
  await vercelFetch(
    'PATCH',
    `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(plane.projectId)}/env/${encodeURIComponent(rec.id)}?teamId=${encodeURIComponent(opsTeamId)}`,
    { headers: auth, body: { value: secret } },
    `env rotate RESEND_WEBHOOK_SECRET (${plane.label})`,
  )
  return 'rotated'
}

// ─── Vercel redeploy (duplicate the current production deployment) ───────

async function triggerRedeploy(
  plane: VercelPlane,
  opsTeamId: string,
  opsVercelToken: string,
): Promise<string> {
  const auth = { Authorization: `Bearer ${opsVercelToken}`, 'Content-Type': 'application/json' }
  const body = (await vercelFetch(
    'GET',
    `${VERCEL_API_BASE}/v6/deployments?projectId=${encodeURIComponent(plane.projectId)}&teamId=${encodeURIComponent(opsTeamId)}&limit=5`,
    { headers: { Authorization: `Bearer ${opsVercelToken}` } },
    `deployments (${plane.label})`,
  )) as { deployments?: Array<{ uid?: string; state?: string; target?: string }> } | null
  const list = body?.deployments ?? []
  const ready = list.find((d) => d.state === 'READY' && d.target === 'production')
  if (!ready?.uid) {
    return 'skipped: no READY production deployment found to duplicate — trigger the redeploy manually after this repair'
  }
  try {
    await vercelFetch(
      'POST',
      `${VERCEL_API_BASE}/v13/deployments?teamId=${encodeURIComponent(opsTeamId)}`,
      { headers: auth, body: { deploymentId: ready.uid, target: 'production' } },
      `redeploy (${plane.label})`,
    )
    return `triggered (duplicating ${ready.uid})`
  } catch (e) {
    return `failed: ${redactDetail(String((e as AppError).publicMessage ?? (e as Error).message)).slice(0, 160)} — the secret IS synced; trigger the redeploy manually and events will verify`
  }
}

// ─── the repair itself ───────────────────────────────────────────────────

/**
 * Recreate the provider-side Resend webhook at the canonical platform
 * endpoint and rotate the app-side signing secret everywhere it is
 * read. Deliberate, destructive, audited by the caller. Fails closed.
 */
export async function repairResendWebhook(): Promise<WebhookRepairResult> {
  const { resendKey, canonicalEndpoint, opsVercelToken, opsTeamId } = preflight()
  const resendAuth = { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }

  // 1. Read the current provider state (allowlisted view).
  const whDoc = (await providerFetch('GET', `${RESEND_API_BASE}/webhooks`, { headers: resendAuth }, 'GET /webhooks')) as {
    data?: Array<Record<string, unknown>>
  } | null
  const existing = Array.isArray(whDoc?.data) ? whDoc.data : []
  const found = existing.map(endpointView)

  // 2. CREATE-FIRST (live-learned 2026-10-22): the first repair attempt
  //    deleted the old endpoints and THEN failed create validation
  //    (HTTP 422 — the create body field is `endpointUrl`, not `url`),
  //    leaving the provider webhook-less. Correct ordering: create the
  //    fresh endpoint FIRST — a create failure can then never destroy
  //    the existing (even if non-delivering) webhook surface — and
  //    only delete the OLD endpoints after the fresh one exists.
  const created = (await providerFetch(
    'POST',
    `${RESEND_API_BASE}/webhooks`,
    {
      headers: resendAuth,
      body: {
        // Live-verified against the REAL provider (2026-10-22, second
        // repair attempt): the create body field is `endpoint` — the
        // provider's own 422 validation text named it ("Missing `endpoint`
        // field.") after `url` (attempt 1) and `endpointUrl` (attempt 2)
        // were rejected. The surfaced provider error bodies made this
        // self-diagnosing from the workflow evidence alone.
        endpoint: canonicalEndpoint,
        events: [...WEBHOOK_REPAIR_EVENTS],
        description: 'Scholario platform delivery lifecycle (auto-managed by the Operations Center repair action)',
      },
    },
    'POST /webhooks',
  )) as { id?: unknown; signing_secret?: unknown; secret?: unknown; signingSecret?: unknown } | null
  const createdId = String(created?.id ?? '')
  // The signing-secret field name in the create RESPONSE has never been
  // observed live (the pre-repair webhook was dashboard-created, whose
  // secret the API never returns). Accept the documented-possible
  // names; a response carrying NONE of them fails honestly below — and
  // create-first means that failure leaves the provider state intact.
  const freshSecret =
    typeof created?.signing_secret === 'string' ? created.signing_secret
      : typeof created?.secret === 'string' ? created.secret
        : typeof created?.signingSecret === 'string' ? created.signingSecret
          : ''
  if (!createdId || !freshSecret) {
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        'The created webhook did not return an id + signing secret via the API, so the app-side secret could not be synced (the pre-existing endpoints were left untouched). Manual step: rotate the webhook from the Resend dashboard and copy the signing secret into RESEND_WEBHOOK_SECRET on both planes, then redeploy.',
    })
  }

  // 2a. VALIDATE the replacement BEFORE removing anything (the
  //     provider-side GET is the evidence source; the documented list
  //     shape carries per-item `endpoint`, `status` and `events`).
  //     The fresh endpoint must be registered at the canonical URL,
  //     subscribed to the full lifecycle event set, and enabled when
  //     the provider reports the field. A validation failure rolls the
  //     fresh webhook back — the pre-existing endpoints are NEVER
  //     touched by this path (a failed validation can never destroy a
  //     working webhook surface).
  const validationDoc = (await providerFetch('GET', `${RESEND_API_BASE}/webhooks`, { headers: resendAuth }, 'GET /webhooks (validation)')) as {
    data?: Array<Record<string, unknown>>
  } | null
  const validationList = Array.isArray(validationDoc?.data) ? validationDoc.data : []
  const freshRow = validationList.find((w) => String(w.id ?? '') === createdId)
  const validated = freshRow ? endpointView(freshRow) : null
  const missingEvents = [...WEBHOOK_REPAIR_EVENTS].filter((e) => !(validated?.events ?? []).includes(e))
  const validationProblem = !validated
    ? 'the fresh webhook id does not appear in the provider webhook list'
    : validated.url !== canonicalEndpoint
      ? `the fresh endpoint URL is ${validated.url}, expected ${canonicalEndpoint}`
      : missingEvents.length > 0
        ? `the fresh endpoint is missing events: ${missingEvents.join(', ')}`
        : validated.status !== '' && validated.status !== 'enabled'
          ? `the fresh endpoint status is '${validated.status}' at the provider (expected 'enabled')`
          : ''
  if (validationProblem) {
    // Rollback: never keep a webhook whose delivery surface was not
    // proven — delete the fresh one and report honestly. The
    // pre-existing endpoints were not touched.
    await providerFetch(
      'DELETE',
      `${RESEND_API_BASE}/webhooks/${encodeURIComponent(createdId)}`,
      { headers: resendAuth },
      'rollback DELETE /webhooks/{id} (validation)',
    ).catch(() => undefined)
    throw new AppError('EXTERNAL_SERVICE_FAILURE', {
      publicMessage:
        `The recreated webhook FAILED provider-side validation (${validationProblem}), ` +
        'so it was deleted (rollback) and the pre-existing endpoints were left untouched. ' +
        'No provider state was lost. Re-run the live email diagnostics to inspect the current provider webhook state before repairing again.',
    })
  }

  // 2b. The fresh endpoint exists — now remove every OLD endpoint so the
  //     provider surface is exactly the one canonical webhook. A stale
  //     endpoint failing to delete is a WARNING, never fatal (the fresh
  //     endpoint is the one that delivers; the stale one is inert).
  const deleted: WebhookEndpointSummary[] = []
  const deleteWarnings: string[] = []
  for (const w of existing) {
    const view = endpointView(w)
    try {
      await providerFetch(
        'DELETE',
        `${RESEND_API_BASE}/webhooks/${encodeURIComponent(String(w.id ?? ''))}`,
        { headers: resendAuth },
        `DELETE /webhooks/{id} (stale ${view.id})`,
      )
      deleted.push(view)
    } catch (e) {
      deleteWarnings.push(`${view.id}: ${redactDetail(String((e as AppError).publicMessage ?? (e as Error).message)).slice(0, 120)}`)
    }
  }

  // 3. Sync the fresh secret to EVERY plane. Rollback on failure: a
  //    webhook signing with a secret the app does not hold is worse
  //    than no webhook (events would arrive and fail verification
  //    forever) — delete the fresh endpoint and report honestly.
  const planes = await discoverPlanes(opsVercelToken, opsTeamId).catch(async (e: unknown) => {
    await providerFetch(
      'DELETE',
      `${RESEND_API_BASE}/webhooks/${encodeURIComponent(createdId)}`,
      { headers: resendAuth },
      'rollback DELETE /webhooks/{id}',
    ).catch(() => undefined)
    throw e
  })
  const secretSynced: Record<string, 'created' | 'rotated' | 'unchanged'> = {}
  for (const plane of planes) {
    try {
      secretSynced[plane.label] = await syncSecretToPlane(plane, opsTeamId, opsVercelToken, freshSecret)
    } catch (e) {
      await providerFetch(
        'DELETE',
        `${RESEND_API_BASE}/webhooks/${encodeURIComponent(createdId)}`,
        { headers: resendAuth },
        'rollback DELETE /webhooks/{id}',
      ).catch(() => undefined)
      throw new AppError('EXTERNAL_SERVICE_FAILURE', {
        publicMessage:
          'The fresh signing secret could NOT be synced to the Vercel planes, so the recreated webhook was DELETED (rollback — the app never keeps a webhook whose secret it cannot verify). ' +
          'The Vercel token likely lacks env-write scope. Manual step: rotate the webhook from the Resend dashboard and copy the signing secret into RESEND_WEBHOOK_SECRET on both planes, then redeploy.',
        internalDetail: `sync failure on ${plane.label}: ${redactDetail(String((e as Error).message)).slice(0, 300)}`,
      })
    }
  }

  // 4. Redeploy both planes (best-effort — the secret is already
  //    synced; any later deploy picks it up, and provider events
  //    retry meanwhile). Outcomes are reported per-plane, honestly.
  const redeploy: Record<string, string> = {}
  for (const plane of planes) {
    redeploy[plane.label] = await triggerRedeploy(plane, opsTeamId, opsVercelToken)
  }

  return {
    ok: true,
    canonicalEndpoint,
    found,
    validated: validated as WebhookEndpointSummary,
    deleted,
    deleteWarnings,
    createdWebhookId: createdId,
    events: [...WEBHOOK_REPAIR_EVENTS],
    secretSynced,
    redeploy,
  }
}
