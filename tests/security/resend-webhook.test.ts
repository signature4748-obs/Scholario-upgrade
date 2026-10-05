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
 *                      lastError; email.delivered records evidence only
 *                      and leaves the send-side row untouched
 *   5. non-activating— unknown event types are recorded + acknowledged
 *                      (processed:false), never an error
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
async function deliveryRow(name: string): Promise<string> {
  const row = await db.emailDelivery.create({
    data: {
      template: 'admission-enquiry-received',
      recipient: `rw-${MARKER}-${name}@example.test`,
      status: 'SENT',
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

  test('email.delivered → recorded evidence only; SENT row untouched', async () => {
    const id = await deliveryRow('delivered')
    const res = await signedEvent('delivered', 'email.delivered', {
      id: msgId('delivered'),
      to: [`rw-${MARKER}-delivered@example.test`],
    })
    expect(res.status).toBe(200)
    expect(res.body?.processed).toBe(false) // non-activating

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
})
