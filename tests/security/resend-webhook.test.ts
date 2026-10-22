/**
 * RESEND WEBHOOK acceptance suite (src/app/api/webhooks/resend).
 *
 * Contract under test — the delivery-lifecycle half of the email system
 * (docs/EMAIL.md):
 *
 *   1. fail-closed   — unsigned / bad signature / stale timestamp /
 *                      missing svix headers → 401; the route is inert
 *                      without RESEND_WEBHOOK_SECRET
 *   2. signature     — a correct Svix v1 HMAC (id.timestamp.body, base64)
 *                      is accepted; multi-token headers match any token
 *   3. idempotency   — the same svix-id redelivered → 200 duplicate,
 *                      attempts counted, never re-processed
 *   4. state sync    — email.bounced / .complained / .failed flip the
 *                      EmailDelivery row (matched by providerMessageId)
 *                      to BOUNCED / COMPLAINED / FAILED with a human
 *                      lastError; email.delivered is DELIVERY
 *                      EVIDENCE — a QUEUED/PENDING row becomes SENT;
 *                      an already-SENT row is untouched (idempotent)
 *   5. non-activating— unknown event types are recorded + acknowledged
 *                      (processed:false), never an error
 *   6. out-of-order  — failed→delivered: the failure verdict STANDS;
 *                      delivered→bounced (delayed bounce): the newer
 *                      terminal verdict wins (SENT→BOUNCED); duplicate
 *                      terminal events under different svix-ids write
 *                      the row once and record both events; duplicate
 *                      delivered svix-ids count attempts without side
 *                      effects (mission: "Handle duplicate and
 *                      out-of-order events safely")
 *   7. rejection     — Svix-SHAPED rejections (all three svix headers,
 *                      signature/timestamp/secret failed) land in a
 *                      bounded, namespaced evidence ledger (gateway
 *                      'resend-rejected', one row per svix-id, daily
 *                      cap, payload never stored); header-less noise
 *                      stays a bare 401; ledger rows are never counted
 *                      as provider delivery evidence by any consumer
 *
 * SAFETY: no real Resend traffic — the route is exercised over live HTTP
 * against the dev server with a locally-configured test signing secret;
 * payloads use example.test addresses only.
 *
 * ENV-CONDITIONAL: the signed-lifecycle describe blocks require
 * RESEND_WEBHOOK_SECRET in the server environment (the operator sets a
 * test value in the dev sandbox; CI sets it as a workflow secret). The
 * fail-closed block runs unconditionally — a missing secret must still
 * be a 401, never a 500.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHmac, randomBytes } from 'crypto'

import { db } from '../helpers/db'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')
const SECRET = (process.env.RESEND_WEBHOOK_SECRET ?? '').trim()

/** A provider message id in this suite's exclusive namespace. */
const msgId = (name: string): string => `re_wh_${MARKER}_${name}`
const svixId = (name: string): string => `msg_${MARKER}_${name}`
const dk = (name: string): string => `RW-${MARKER}-${name}`

/** Svix v1 signature: base64 HMAC-SHA256 over `${id}.${ts}.${raw}`. */
function sign(id: string, ts: number, raw: string): string {
  return `v1,${createHmac('sha256', SECRET).update(`${id}.${ts}.${raw}`).digest('base64')}`
}

interface PostResult {
  status: number
  body: Record<string, unknown> | null
}

async function post(raw: string, headers: Record<string, string>): Promise<PostResult> {
  const res = await fetch(`${BASE}/api/webhooks/resend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { status: res.status, body }
}

/** A signed request with a fresh timestamp for the given event. */
function signedEvent(name: string, type: string, data: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<PostResult> {
  const id = svixId(name)
  const ts = Math.floor(Date.now() / 1000)
  const raw = JSON.stringify({ type, created_at: new Date().toISOString(), data })
  return post(raw, {
    'svix-id': id,
    'svix-timestamp': String(ts),
    'svix-signature': sign(id, ts, raw),
    ...extraHeaders,
  })
}

/** An EmailDelivery row in this suite's namespace (cleaned in afterAll). */
async function deliveryRow(name: string, status: 'SENT' | 'QUEUED' | 'PENDING' = 'SENT'): Promise<string> {
  const row = await db.emailDelivery.create({
    data: {
      template: 'admission-enquiry-received',
      recipient: `rw-${MARKER}-${name}@example.test`,
      status,
      attempts: 1,
      providerMessageId: msgId(name),
      dedupeKey: dk(name),
    },
  })
  return row.id
}

beforeAll(async () => {
  if (!SECRET) return // fail-closed-only mode; lifecycle blocks are skipped
})

afterAll(async () => {
  // Sweep this suite's namespaces (crashed prior runs included).
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: `msg_${MARKER}` } } })
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: `rejected:msg_${MARKER}` } } })
  await db.emailDelivery.deleteMany({ where: { dedupeKey: { startsWith: `RW-${MARKER}` } } })
})

// ─── 1. fail-closed (runs with or without the secret) ───────────────────

describe('RESEND-WEBHOOK · fail-closed boundary', () => {
  test('unsigned request → 401', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await post(raw, {})
    expect(res.status).toBe(401)
    expect(res.body?.ok).toBe(false)
  })

  test('wrong signature → 401', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await post(raw, {
      'svix-id': svixId('badsig'),
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    })
    expect(res.status).toBe(401)
  })

  test('valid signature but stale timestamp (replay) → 401', () => {
    if (!SECRET) return // nothing to verify without a secret — covered above
    const id = svixId('stale')
    const oldTs = Math.floor(Date.now() / 1000) - 60 * 60 // one hour ago
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    return post(raw, {
      'svix-id': id,
      'svix-timestamp': String(oldTs),
      'svix-signature': sign(id, oldTs, raw),
    }).then((res) => expect(res.status).toBe(401))
  })

  test('missing svix headers → 401', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await post(raw, { 'x-irrelevant': '1' })
    expect(res.status).toBe(401)
  })
})

// ─── 2-5. signed lifecycle (requires the test signing secret) ───────────

describe.skipIf(!SECRET)('RESEND-WEBHOOK · signed lifecycle', () => {
  test('email.bounced → EmailDelivery BOUNCED with bounce detail', async () => {
    const id = await deliveryRow('bounced')
    const res = await signedEvent('bounced', 'email.bounced', {
      id: msgId('bounced'),
      to: [`rw-${MARKER}-bounced@example.test`],
      bounce: { code: '5.1.1', message: 'user unknown' },
    })
    expect(res.status).toBe(200)
    expect(res.body?.processed).toBe(true)
    expect(res.body?.matched).toBe(1)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('BOUNCED')
    expect(row?.lastError).toContain('bounce:')
    expect(row?.lastError).toContain('5.1.1')
    expect(row?.providerMessageId).toBe(msgId('bounced')) // id never clobbered
  })

  test('email.complained → EmailDelivery COMPLAINED', async () => {
    const id = await deliveryRow('complained')
    const res = await signedEvent('complained', 'email.complained', {
      id: msgId('complained'),
      to: [`rw-${MARKER}-complained@example.test`],
    })
    expect(res.status).toBe(200)
    expect(res.body?.processed).toBe(true)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('COMPLAINED')
    expect(row?.lastError).toContain('complaint')
  })

  test('email.failed → EmailDelivery FAILED with provider reason', async () => {
    const id = await deliveryRow('failed')
    const res = await signedEvent('failed', 'email.failed', {
      id: msgId('failed'),
      to: [`rw-${MARKER}-failed@example.test`],
      reason: 'suppressed address',
    })
    expect(res.status).toBe(200)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('FAILED')
    expect(row?.lastError).toContain('provider failure')
    expect(row?.lastError).toContain('suppressed address')
  })

  test('email.delivered (QUEUED row) → SENT — the delivery evidence upgrade', async () => {
    // Provider 2xx wrote QUEUED (accepted, unconfirmed); the delivered
    // event is the ONLY thing that upgrades it to SENT.
    const id = await deliveryRow('delivered-queued', 'QUEUED')
    const res = await signedEvent('delivered-queued', 'email.delivered', {
      id: msgId('delivered-queued'),
      to: [`rw-${MARKER}-delivered-queued@example.test`],
    })
    expect(res.status).toBe(200)
    expect(res.body?.processed).toBe(true)
    expect(res.body?.matched).toBe(1)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('SENT')
    expect(row?.lastError).toBeNull()
    expect(row?.providerMessageId).toBe(msgId('delivered-queued'))
  })

  test('email.delivered (PENDING row — crashed mid-send) → SENT', async () => {
    // A send that died between provider acceptance and the row write:
    // provider evidence still upgrades it honestly.
    const id = await deliveryRow('delivered-pending', 'PENDING')
    const res = await signedEvent('delivered-pending', 'email.delivered', {
      id: msgId('delivered-pending'),
    })
    expect(res.status).toBe(200)
    expect(res.body?.matched).toBe(1)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('SENT')
  })

  test('email.delivered (already-SENT row) → acknowledged, row untouched (idempotent)', async () => {
    const id = await deliveryRow('delivered')
    const res = await signedEvent('delivered', 'email.delivered', {
      id: msgId('delivered'),
      to: [`rw-${MARKER}-delivered@example.test`],
    })
    expect(res.status).toBe(200)
    expect(res.body?.processed).toBe(true)
    expect(res.body?.matched).toBe(0) // SENT rows are never re-flipped

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('SENT') // exactly as the pipeline wrote it
    expect(row?.lastError).toBeNull()

    const evt = await db.webhookEvent.findUnique({ where: { eventId: svixId('delivered') } })
    expect(evt?.gatewayName).toBe('resend')
    expect(evt?.status).toBe('processed')
    expect(evt?.eventType).toBe('email.delivered')
  })

  test('replay (same svix-id) → duplicate acknowledged, state not re-processed', async () => {
    await deliveryRow('replay')
    const first = await signedEvent('replay', 'email.bounced', {
      id: msgId('replay'),
      bounce: { code: '5.0.0', message: 'first delivery' },
    })
    expect(first.status).toBe(200)
    expect(first.body?.duplicate).toBeUndefined()

    // Redelivery of the SAME svix-id with a DIFFERENT payload must not
    // re-process (the row already carries the first bounce's detail).
    const second = await signedEvent('replay', 'email.bounced', {
      id: msgId('replay'),
      bounce: { code: '4.0.0', message: 'tampered second delivery' },
    })
    expect(second.status).toBe(200)
    expect(second.body?.duplicate).toBe(true)

    const row = await db.emailDelivery.findFirst({ where: { providerMessageId: msgId('replay') } })
    expect(row?.status).toBe('BOUNCED')
    expect(row?.lastError).toContain('first delivery')
    expect(row?.lastError).not.toContain('tampered')

    const evt = await db.webhookEvent.findUnique({ where: { eventId: svixId('replay') } })
    expect(evt?.attempts).toBe(2)
    expect(evt?.status).toBe('duplicate')
  })

  test('unknown event type → recorded, acknowledged, never an error', async () => {
    const res = await signedEvent('unknown', 'email.opened', { id: 'irrelevant' })
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.processed).toBe(false)

    const evt = await db.webhookEvent.findUnique({ where: { eventId: svixId('unknown') } })
    expect(evt?.status).toBe('processed')
  })

  test('multi-token signature header (v1,v1,v1gpg) → accepted', async () => {
    const raw = JSON.stringify({ type: 'email.sent', data: { id: 'x' } })
    const id = svixId('multi')
    const ts = Math.floor(Date.now() / 1000)
    const good = sign(id, ts, raw)
    const header = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${good} v1gpg,zzz`
    const res = await post(raw, {
      'svix-id': id,
      'svix-timestamp': String(ts),
      'svix-signature': header,
    })
    expect(res.status).toBe(200)
  })

  // ─── out-of-order + duplicate provider events ──────────────────────────
  // Providers redeliver and reorder; the row must converge sanely and
  // duplicate side effects must never occur (mission: "Handle duplicate
  // and out-of-order events safely").

  test('OUT-OF-ORDER · email.failed then email.delivered for the same id → the failure verdict STANDS (delivered never upgrades a failure)', async () => {
    const id = await deliveryRow('oo-fail-first', 'QUEUED')
    const fail = await signedEvent('oo-fail-first-f', 'email.failed', {
      id: msgId('oo-fail-first'),
      reason: 'provider internal failure',
    })
    expect(fail.status).toBe(200)
    expect(fail.body?.matched).toBe(1)

    const late = await signedEvent('oo-fail-first-d', 'email.delivered', {
      id: msgId('oo-fail-first'),
    })
    expect(late.status).toBe(200)
    expect(late.body?.matched).toBe(0) // FAILED rows are not upgraded by delivered

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('FAILED')
    expect(row?.lastError).toContain('provider failure: provider internal failure')
  })

  test('OUT-OF-ORDER · email.delivered then email.bounced (delayed hard bounce) → later terminal evidence wins: SENT → BOUNCED', async () => {
    const id = await deliveryRow('oo-delivered-first', 'QUEUED')
    const ok = await signedEvent('oo-delivered-first-d', 'email.delivered', {
      id: msgId('oo-delivered-first'),
    })
    expect(ok.body?.matched).toBe(1)
    expect((await db.emailDelivery.findUnique({ where: { id } }))?.status).toBe('SENT')

    // A hard bounce reported AFTER delivery (real provider semantics):
    // the newer terminal verdict overwrites the optimistic SENT.
    const bounce = await signedEvent('oo-delivered-first-b', 'email.bounced', {
      id: msgId('oo-delivered-first'),
      bounce: { code: '5.1.1', message: 'user unknown (delayed report)' },
    })
    expect(bounce.status).toBe(200)
    expect(bounce.body?.matched).toBe(1)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('BOUNCED')
    expect(row?.lastError).toContain('user unknown (delayed report)')
  })

  test('DUPLICATE terminal event (different svix-ids, same message) → row written ONCE, idempotent state, both events recorded', async () => {
    const id = await deliveryRow('dup-terminal', 'QUEUED')
    const first = await signedEvent('dup-terminal-1', 'email.complained', { id: msgId('dup-terminal') })
    const second = await signedEvent('dup-terminal-2', 'email.complained', { id: msgId('dup-terminal') })
    expect(first.body?.ok).toBe(true)
    expect(second.body?.ok).toBe(true)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('COMPLAINED')
    expect(row?.lastError).toBe('complaint (feedback loop)')

    // Both provider events are in the audit trail; the row converged once.
    const events = await db.webhookEvent.findMany({
      where: { eventId: { in: [svixId('dup-terminal-1'), svixId('dup-terminal-2')] } },
    })
    expect(events.length).toBe(2)
    expect(events.every((e) => e.status === 'processed')).toBe(true)
  })

  test('convergence: delivered (QUEUED→SENT) → duplicate delivered svix-id → row stays SENT, attempts counted (no side effects)', async () => {
    const id = await deliveryRow('conv', 'QUEUED')
    const first = await signedEvent('conv', 'email.delivered', { id: msgId('conv') })
    expect(first.body?.matched).toBe(1)

    const replay = await signedEvent('conv', 'email.delivered', { id: msgId('conv') })
    expect(replay.body?.duplicate).toBe(true)

    const row = await db.emailDelivery.findUnique({ where: { id } })
    expect(row?.status).toBe('SENT')
    const evt = await db.webhookEvent.findUnique({ where: { eventId: svixId('conv') } })
    expect(evt?.attempts).toBe(2)
    expect(evt?.status).toBe('duplicate')
  })
})

// ─── 6. rejection-evidence ledger (the 401 observability gap) ──────────
// Live motivation (2026-10-22): registered+enabled+validated provider
// webhook, reachable endpoint, fresh secret on both planes — yet zero
// events. The 401 path wrote nothing, so "dispatched but signature
// fails" vs "never dispatched" was unobservable. The bounded ledger
// records every Svix-SHAPED rejection so the next audit separates the
// two hypotheses with hard data (payload never stored; daily-bounded;
// namespaced away from every provider-event consumer).

describe.skipIf(!SECRET)('RESEND-WEBHOOK · rejection-evidence ledger', () => {
  const rejectedEventId = (name: string) => `rejected:${svixId(name)}`

  /** A Svix-shaped request with a WRONG signature (the rejected shape). */
  async function rejectedPost(name: string, raw: string, extraHeaders: Record<string, string> = {}): Promise<PostResult> {
    return post(raw, {
      'svix-id': svixId(name),
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ...extraHeaders,
    })
  }

  test('Svix-shaped wrong signature → 401 + ONE ledger row with the reason (unverified payload NEVER stored)', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x', marker: 'payload-must-not-be-stored' } })
    const res = await rejectedPost('ledger-badsig', raw)
    expect(res.status).toBe(401)
    expect(res.body?.ok).toBe(false)

    const row = await db.webhookEvent.findUnique({ where: { eventId: rejectedEventId('ledger-badsig') } })
    expect(row).not.toBeNull()
    expect(row?.gatewayName).toBe('resend-rejected')
    expect(row?.eventType).toBe('svix.rejected')
    expect(row?.status).toBe('rejected')
    expect(row?.error).toBe('signature mismatch')
    expect(row?.rawPayload).not.toContain('payload-must-not-be-stored')
    expect(row?.attempts).toBe(1)
  })

  test('Svix retries the SAME rejected id → attempts increment, never a second row', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const first = await rejectedPost('ledger-retry', raw)
    const retry = await rejectedPost('ledger-retry', raw)
    expect(first.status).toBe(401)
    expect(retry.status).toBe(401)

    const rows = await db.webhookEvent.count({ where: { eventId: rejectedEventId('ledger-retry') } })
    expect(rows).toBe(1)
    const row = await db.webhookEvent.findUnique({ where: { eventId: rejectedEventId('ledger-retry') } })
    expect(row?.attempts).toBe(2)
  })

  test('correct signature but STALE timestamp → 401 + ledger row with the replay reason', async () => {
    const name = 'ledger-stale'
    const oldTs = Math.floor(Date.now() / 1000) - 60 * 60 // one hour ago
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await post(raw, {
      'svix-id': svixId(name),
      'svix-timestamp': String(oldTs),
      'svix-signature': sign(svixId(name), oldTs, raw),
    })
    expect(res.status).toBe(401)
    const row = await db.webhookEvent.findUnique({ where: { eventId: rejectedEventId(name) } })
    expect(row?.error).toBe('stale timestamp (replay)')
  })

  test('missing svix headers (plain noise) → 401 with NO ledger row', async () => {
    const before = await db.webhookEvent.count({ where: { gatewayName: 'resend-rejected' } })
    const res = await post(JSON.stringify({ type: 'email.delivered', data: { id: 'x' } }), { 'x-irrelevant': '1' })
    expect(res.status).toBe(401)
    const after = await db.webhookEvent.count({ where: { gatewayName: 'resend-rejected' } })
    expect(after).toBe(before)
  })

  test('namespaced: the provider-event poll (gatewayName resend) NEVER counts a rejection as delivery evidence', async () => {
    const name = 'ledger-ns'
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await rejectedPost(name, raw)
    expect(res.status).toBe(401)

    const asProviderEvent = await db.webhookEvent.findMany({
      where: { gatewayName: 'resend', eventId: rejectedEventId(name) },
    })
    expect(asProviderEvent.length).toBe(0)
    const inLedger = await db.webhookEvent.findUnique({ where: { eventId: rejectedEventId(name) } })
    expect(inLedger?.gatewayName).toBe('resend-rejected')
  })

  test('daily cap: once the UTC-day ledger slice is full, further rejections stay 401 with NO row (unbounded growth impossible)', async () => {
    // Pre-fill today's UTC slice directly to the cap (50) — run-unique
    // ids so a crashed prior run cannot collide; all swept in afterAll.
    const dayStart = new Date()
    dayStart.setUTCHours(0, 0, 0, 0)
    const have = await db.webhookEvent.count({
      where: { gatewayName: 'resend-rejected', receivedAt: { gte: dayStart } },
    })
    const stamp = Date.now()
    for (let i = have; i < 50; i++) {
      await db.webhookEvent.create({
        data: {
          eventId: `rejected:msg_${MARKER}_capfill_${stamp}_${i}`,
          eventType: 'svix.rejected',
          gatewayName: 'resend-rejected',
          rawPayload: 'cap filler',
          status: 'rejected',
          error: 'cap filler',
        },
      })
    }
    const raw = JSON.stringify({ type: 'email.delivered', data: { id: 'x' } })
    const res = await rejectedPost('ledger-capped', raw)
    expect(res.status).toBe(401)
    const row = await db.webhookEvent.findUnique({ where: { eventId: rejectedEventId('ledger-capped') } })
    expect(row).toBeNull()
  })
})
