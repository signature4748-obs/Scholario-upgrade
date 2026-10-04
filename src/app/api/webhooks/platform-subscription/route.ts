import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { enforceRateLimitStrict, RATE_LIMITS, clientIpFromHeaders } from '@/lib/security/rate-limit'
import { platformAuditEvent } from '@/lib/platform/audit'
import { recordPlatformPayment } from '@/lib/platform/billing'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/platform-subscription — ONLINE payment receiver for
 * the A-domain (school pays SCHOLARIO).
 *
 * SECURITY MODEL (§3A):
 *   Gateway → VERIFIED webhook (HMAC-SHA256 signature over the raw body
 *   with PLATFORM_PAYMENT_WEBHOOK_SECRET) → payment verification →
 *   subscription ledger row → subscription activation/extension →
 *   tenant automatically unlocked.
 *
 *   A subscription is NEVER activated because the browser reported
 *   payment success — this signature-verified path (or an offline
 *   platform-admin recording) is the only activation cause.
 *
 * Idempotency: the provider event id is unique in WebhookEvent — a
 * replayed event is acknowledged (200) but processed exactly once.
 *
 * Expected JSON body (provider-agnostic envelope):
 *   {
 *     "eventId":   "evt_...",            (required, unique per event)
 *     "eventType": "subscription.payment.captured",   (only this activates)
 *     "payment": {
 *       "schoolId": "<scholario school id>",          (trusted: provider
 *                     metadata captured at order creation — never a
 *                     client-echoed value on THIS route; the signature
 *                     makes the whole payload provider-authentic)
 *       "amount": 24000, "currency": "INR",
 *       "providerPaymentId": "pay_...", "reference": "..."
 *     },
 *     "subscription": { "periodMonths": 12 }
 *   }
 *
 * Signature header: x-scholario-signature = hex(HMAC_SHA256(rawBody)).
 * Unknown/unsigned requests are rejected 401 with a safe message.
 */
const SIGNATURE_HEADER = 'x-scholario-signature'
const ACTIVATING_EVENT = 'subscription.payment.captured'

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET
  if (!secret) {
    // Fail-closed: no configured secret ⇒ no online activation path.
    // Offline platform-admin recording remains fully functional.
    return false
  }
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface WebhookBody {
  eventId?: string
  eventType?: string
  payment?: {
    schoolId?: string
    amount?: number
    currency?: string
    providerPaymentId?: string
    reference?: string
  }
  subscription?: { periodMonths?: number }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ip = clientIpFromHeaders(req.headers)

  // Gateway retries legitimately — a loose per-IP budget.
  await enforceRateLimitStrict('rl:platform-wh:' + ip, RATE_LIMITS.webhook)

  if (!verifySignature(raw, req.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json(
      { ok: false, error: 'Invalid webhook signature.' },
      { status: 401 },
    )
  }

  let body: WebhookBody
  try {
    body = JSON.parse(raw) as WebhookBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 })
  }
  if (!body.eventId || !body.eventType || typeof body.eventId !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing eventId/eventType' }, { status: 400 })
  }

  // Idempotency: a replayed event id is acknowledged, never re-processed.
  const seen = await db.webhookEvent.findUnique({ where: { eventId: body.eventId } })
  if (seen) {
    await db.webhookEvent.update({
      where: { id: seen.id },
      data: { attempts: { increment: 1 }, status: 'duplicate' },
    })
    return NextResponse.json({ ok: true, duplicate: true, eventId: body.eventId })
  }

  const row = await db.webhookEvent.create({
    data: {
      eventId: body.eventId,
      eventType: body.eventType,
      gatewayName: 'platform-subscription',
      signature: req.headers.get(SIGNATURE_HEADER)?.slice(0, 64) ?? null,
      rawPayload: raw.slice(0, 8000),
      status: 'processing',
    },
  })

  try {
    if (body.eventType !== ACTIVATING_EVENT) {
      await db.webhookEvent.update({
        where: { id: row.id },
        data: { status: 'processed', processedAt: new Date() },
      })
      return NextResponse.json({ ok: true, processed: false, reason: `non-activating event ${body.eventType}` })
    }

    const payment = body.payment ?? {}
    const amount = Number(payment.amount ?? 0)
    if (!payment.schoolId || !(amount > 0)) {
      return NextResponse.json({ ok: false, error: 'Missing payment fields' }, { status: 400 })
    }
    const school = await db.school.findUnique({
      where: { id: payment.schoolId },
      select: { id: true },
    })
    if (!school) {
      // Signed but referencing an unknown school — record honestly,
      // never guess. No existence oracle: the response is generic.
      await db.webhookEvent.update({
        where: { id: row.id },
        data: { status: 'error', error: 'unknown school', processedAt: new Date() },
      })
      // No existence oracle: the response is generic whether the school
      // exists or not (the row records the truth internally).
      return NextResponse.json({ ok: false, error: 'Payment could not be applied' }, { status: 200 })
    }

    const result = await recordPlatformPayment({
      schoolId: school.id,
      amount,
      currency: payment.currency ?? 'INR',
      mode: 'ONLINE_PAYMENT',
      paymentDate: new Date(),
      periodMonths: body.subscription?.periodMonths ?? 12,
      reference: payment.providerPaymentId ?? payment.reference ?? body.eventId,
      notes: 'Online payment — signature-verified webhook',
      recordedById: null,
      source: 'webhook',
    })

    await db.webhookEvent.update({
      where: { id: row.id },
      data: {
        schoolId: school.id,
        status: 'processed',
        processedAt: new Date(),
        matchedTransactionId: result.paymentId,
      },
    })

    await platformAuditEvent({
      adminId: null,
      action: 'platform.billing.webhook_payment',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'Online subscription payment captured (verified webhook)',
      metadata: {
        eventId: body.eventId,
        receiptNo: result.receiptNo,
        amount,
        currency: payment.currency ?? 'INR',
        periodMonths: body.subscription?.periodMonths ?? 12,
        statusAfter: result.statusAfter,
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true, processed: true, receiptNo: result.receiptNo })
  } catch (e) {
    await db.webhookEvent.update({
      where: { id: row.id },
      data: { status: 'error', error: String(e).slice(0, 300), processedAt: new Date() },
    })
    return NextResponse.json(
      { ok: false, error: 'Webhook processing failed' },
      { status: 500 },
    )
  }
}
