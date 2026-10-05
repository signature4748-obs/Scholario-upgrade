import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { enforceRateLimitStrict, RATE_LIMITS, clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/resend — delivery lifecycle receiver for Resend
 * (docs/EMAIL.md §"Webhooks").
 *
 * WHAT THIS CLOSES: the outbox knew a send was accepted (SENT) or rejected
 * (FAILED) at API time, but nothing recorded what the provider learned
 * afterwards — hard bounces, spam complaints, delayed and failed
 * deliveries. This route is that missing half: signature-verified
 * provider events synchronize EmailDelivery terminal state so operators
 * see WHY a message never arrived, not just that we tried.
 *
 * SECURITY MODEL (same shape as the platform-subscription webhook):
 *   · Resend delivers via Svix: headers svix-id, svix-timestamp,
 *     svix-signature. The signature is v1,<base64 HMAC-SHA256 over
 *     `${svix-id}.${svix-timestamp}.${rawBody}` keyed by the
 *     RESEND_WEBHOOK_SECRET signing secret (multiple v1 tokens may be
 *     space-separated; any match wins).
 *   · Replay protection: a svix-timestamp older than 5 minutes is
 *     rejected (401) — a captured request cannot be replayed later.
 *   · Fail-closed: no configured secret ⇒ every request is 401 and the
 *     route is inert. Email sending itself is unaffected.
 *   · Idempotency: svix-id is unique in WebhookEvent — a redelivered
 *     event is acknowledged (200) and counted, never re-processed.
 *
 * STATE SYNC (EmailDelivery, matched by providerMessageId = the id
 * Resend returned at send time; NEVER by recipient — ambiguous):
 *   email.bounced     → status BOUNCED, lastError 'bounce: <reason>'
 *   email.complained  → status COMPLAINED, lastError 'complaint (FBL)'
 *   email.failed      → status FAILED, lastError 'provider failure: …'
 *   email.delivered / email.sent / email.delivery_delayed / anything
 *   else              → recorded in WebhookEvent only (the audit trail;
 *                       the send-side row stays as the pipeline wrote it)
 *
 * NOTE on retry semantics: a BOUNCED/FAILED row is a non-SENT row, so a
 * dedupeKey retry may legitimately re-send (Resend itself suppresses
 * hard-bounced addresses at the provider edge — no double-bounce loop).
 *
 * Never throws: malformed bodies are 400, processing errors 500 with the
 * WebhookEvent row carrying the honest error. Responses are generic —
 * no existence oracle (the payload is provider-authentic, but the shape
 * stays boring).
 */

const SIGNATURE_HEADER = 'svix-signature'
const ID_HEADER = 'svix-id'
const TIMESTAMP_HEADER = 'svix-timestamp'
/** Svix-signed requests older than this are replays → reject. */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000
const RAW_PAYLOAD_MAX = 8000
const LAST_ERROR_MAX = 500

/** Events that flip EmailDelivery into a terminal failure state. */
const BOUNCED = 'email.bounced'
const COMPLAINED = 'email.complained'
const FAILED = 'email.failed'

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

// ─── Svix signature verification ────────────────────────────────────────

/**
 * Verify the Svix v1 signature envelope. Fail-closed on: missing secret
 * (route inert), missing headers, stale timestamp, no matching v1 token.
 * Timing-safe comparison per token.
 */
function verifySvixSignature(
  rawBody: string,
  id: string | null,
  timestamp: string | null,
  signatureHeader: string | null,
): { ok: true } | { ok: false; reason: string } {
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? '').trim()
  if (!secret) return { ok: false, reason: 'no signing secret configured' }
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing svix headers' }
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'malformed timestamp' }
  const ageMs = Math.abs(Date.now() - ts * 1000)
  if (ageMs > TIMESTAMP_TOLERANCE_MS) return { ok: false, reason: 'stale timestamp (replay)' }

  const message = `${id}.${timestamp}.${rawBody}`
  const expected = createHmac('sha256', secret).update(message).digest('base64')
  const expectedBuf = Buffer.from(expected, 'utf8')

  // Multiple schemes can be space-separated: "v1,AAA v1,BBB v1gpg,..." —
  // any valid v1 token accepts the request.
  const tokens = signatureHeader
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('v1,'))
  if (tokens.length === 0) return { ok: false, reason: 'no v1 signature token' }

  for (const token of tokens) {
    const providedBuf = Buffer.from(token.slice('v1,'.length), 'utf8')
    if (providedBuf.length !== expectedBuf.length) continue
    if (timingSafeEqual(providedBuf, expectedBuf)) return { ok: true }
  }
  return { ok: false, reason: 'signature mismatch' }
}

// ─── payload shape (defensive — provider schema may drift) ──────────────

interface ResendWebhookBody {
  type?: string
  created_at?: string
  data?: {
    /** The email id Resend returned at send time (schema has used both). */
    id?: string
    email_id?: string
    from?: string
    to?: string[]
    subject?: string
    bounce?: { message?: string; code?: string; diagnostic?: string }
    reason?: string
    [key: string]: unknown
  }
}

/** The provider message id, from whichever field the payload carries. */
function providerMessageId(data: ResendWebhookBody['data']): string | null {
  const id = data?.id ?? data?.email_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Short human-readable failure detail for lastError (never values). */
function failureDetail(type: string, data: ResendWebhookBody['data']): string {
  if (type === BOUNCED) {
    const b = data?.bounce
    const parts = [b?.code, b?.message ?? b?.diagnostic].filter(Boolean)
    return `bounce: ${parts.join(' — ') || 'no detail'}`
  }
  if (type === COMPLAINED) return 'complaint (feedback loop)'
  if (type === FAILED) {
    const reason = typeof data?.reason === 'string' ? data.reason : 'no detail'
    return `provider failure: ${reason}`
  }
  return type
}

// ─── the route ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ip = clientIpFromHeaders(req.headers)

  // Gateway retries legitimately — the shared webhook budget.
  await enforceRateLimitStrict('rl:resend-wh:' + ip, RATE_LIMITS.webhook)

  const verification = verifySvixSignature(
    raw,
    req.headers.get(ID_HEADER),
    req.headers.get(TIMESTAMP_HEADER),
    req.headers.get(SIGNATURE_HEADER),
  )
  if (!verification.ok) {
    return NextResponse.json({ ok: false, error: 'Invalid webhook signature.' }, { status: 401 })
  }
  const eventId = req.headers.get(ID_HEADER) as string

  let body: ResendWebhookBody
  try {
    body = JSON.parse(raw) as ResendWebhookBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 })
  }
  if (typeof body.type !== 'string' || body.type.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing event type' }, { status: 400 })
  }

  // Idempotency: a redelivered svix-id is acknowledged, never re-processed.
  const seen = await db.webhookEvent.findUnique({ where: { eventId } })
  if (seen) {
    await db.webhookEvent.update({
      where: { id: seen.id },
      data: { attempts: { increment: 1 }, status: 'duplicate' },
    })
    return NextResponse.json({ ok: true, duplicate: true, eventId })
  }

  const row = await db.webhookEvent.create({
    data: {
      eventId,
      eventType: body.type,
      gatewayName: 'resend',
      signature: clip(req.headers.get(SIGNATURE_HEADER) ?? '', 64),
      rawPayload: clip(raw, RAW_PAYLOAD_MAX),
      status: 'processing',
    },
  })

  try {
    // Terminal-failure events sync EmailDelivery by providerMessageId.
    if (body.type === BOUNCED || body.type === COMPLAINED || body.type === FAILED) {
      const messageId = providerMessageId(body.data)
      if (messageId) {
        const result = await db.emailDelivery.updateMany({
          where: { providerMessageId: messageId },
          data: {
            status: body.type === BOUNCED ? 'BOUNCED' : body.type === COMPLAINED ? 'COMPLAINED' : 'FAILED',
            lastError: clip(failureDetail(body.type, body.data), LAST_ERROR_MAX),
          },
        })
        await db.webhookEvent.update({
          where: { id: row.id },
          data: {
            status: 'processed',
            processedAt: new Date(),
            matchedTransactionId: result.count > 0 ? messageId : null,
          },
        })
        return NextResponse.json({ ok: true, processed: true, matched: result.count })
      }
      // Signed provider event without a usable message id — record
      // honestly, never guess a match.
      await db.webhookEvent.update({
        where: { id: row.id },
        data: { status: 'error', error: 'no provider message id in payload', processedAt: new Date() },
      })
      return NextResponse.json({ ok: true, processed: false, reason: 'no message id' })
    }

    // Non-activating lifecycle events (delivered/sent/delayed/opened/…):
    // the WebhookEvent row IS the delivery evidence.
    await db.webhookEvent.update({
      where: { id: row.id },
      data: { status: 'processed', processedAt: new Date() },
    })
    return NextResponse.json({ ok: true, processed: false, reason: `non-activating event ${body.type}` })
  } catch (e) {
    await db.webhookEvent.update({
      where: { id: row.id },
      data: { status: 'error', error: String(e).slice(0, 300), processedAt: new Date() },
    })
    return NextResponse.json({ ok: false, error: 'Webhook processing failed' }, { status: 500 })
  }
}
