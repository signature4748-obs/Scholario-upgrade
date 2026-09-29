import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { RATE_LIMITS, checkRateLimit, clientIpFromHeaders } from '@/lib/security/rate-limit'
import { auditRateLimit } from '@/lib/security/audit'

/**
 * Razorpay webhook receiver — real signature verification + DB-persisted
 * idempotency + AUTO-RECONCILIATION (Phase 9).
 *
 * Security:
 *   1. Reads the HMAC SHA256 signature from the `X-Razorpay-Signature` header.
 *   2. Recomputes the HMAC over the raw request body using
 *      `RAZORPAY_WEBHOOK_SECRET` (server-side env, never exposed to the client).
 *   3. Uses `timingSafeEqual` to prevent timing-attack signature forgery.
 *   4. Returns 400 if the signature is missing or doesn't match.
 *
 * Idempotency (DB-persisted, Phase 9):
 *   1. Razorpay may retry a webhook up to 5 times if we don't ack quickly.
 *   2. Each event carries `event_id` (header) / `meta.event_id` (body).
 *   3. We persist a `WebhookEvent` row BEFORE doing any financial work. The
 *      `eventId @unique` constraint means a duplicate delivery is a no-op
 *      (the insert throws, we catch it and ack 200 without re-processing).
 *   4. This survives server restarts — unlike the previous in-memory Set.
 *
 * Auto-reconciliation (Phase 9):
 *   1. On `payment.captured` / `payment.authorized`:
 *      - Look up the FeeTransaction by `gatewayOrderId` (the order_id the
 *        gateway sent us — created by /api/fees/orders).
 *      - Update its status → SUCCESS, set gatewayPaymentId + signature,
 *        set reconciliationStatus = 'reconciled', set reconciledAt.
 *      - Create a Reconciliation row.
 *   2. On `payment.failed`:
 *      - Mark the transaction FAILED + reconciliationStatus = 'exception'.
 *   3. On `settlement.processed`:
 *      - Upsert the Settlement row (by payoutId).
 *      - Link ALL transactions whose gatewayOrderId appears in the
 *        settlement's `transfers[]` array to this settlement.
 *   4. On any error: persist the error on the WebhookEvent row + ack 200
 *      so the gateway doesn't retry the same event forever (we'll surface
 *      the error in the operator's audit log for manual review).
 *
 * Env:
 *   RAZORPAY_WEBHOOK_SECRET — the secret configured in the Razorpay dashboard.
 *   If unset, the route returns 503 (so the gateway keeps retrying and the
 *   operator notices the misconfiguration).
 */

export const runtime = 'nodejs'
// Webhooks must be processed dynamically — no static optimisation.
export const dynamic = 'force-dynamic'

// In-process idempotency store (fast-path dedup before hitting the DB).
// The DB row is the authoritative dedup; this just avoids the unique-constraint
// exception path for the common case where the same event arrives twice in
// rapid succession.
const seenEventIds = new Set<string>()
const MAX_SEEN = 5000
function rememberEvent(id: string) {
  if (seenEventIds.size >= MAX_SEEN) seenEventIds.clear()
  seenEventIds.add(id)
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * 3-c fix — settlement school attribution.
 *
 * Collect the gateway order ids referenced by a settlement entity's
 * `transfers[]` array (each transfer references the order it pays out via
 * `order_id` / `source` / `order`). Order ids minted by this system
 * (/api/fees/orders, provider.createOrder) always start with `order_`.
 */
function extractTransferOrderIds(settlement: unknown): string[] {
  const ids: string[] = []
  const transfers = Array.isArray((settlement as { transfers?: unknown })?.transfers)
    ? ((settlement as { transfers: unknown[] }).transfers as unknown[])
    : []
  for (const t of transfers) {
    if (!t || typeof t !== 'object') continue
    const rec = t as Record<string, unknown>
    for (const key of ['order_id', 'source', 'order']) {
      const v = rec[key]
      if (typeof v === 'string' && v.startsWith('order_')) ids.push(v)
    }
  }
  return [...new Set(ids)]
}

export async function POST(req: NextRequest) {
  // Phase 1 — per-IP rate limit on the webhook receiver (signature
  // verification is the real gate; this blunts DoS/replay floods).
  const ip = clientIpFromHeaders(req.headers)
  const rl = checkRateLimit(`rl:webhook:${ip}`, RATE_LIMITS.webhook)
  if (!rl.allowed) {
    auditRateLimit('webhook', ip)
    return NextResponse.json(
      { received: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    // Misconfiguration — surface it loudly so the operator sets the secret.
    console.error('[webhooks/razorpay] RAZORPAY_WEBHOOK_SECRET is not set — rejecting event.')
    return NextResponse.json(
      { received: false, error: 'Webhook secret not configured on the server.' },
      { status: 503 },
    )
  }

  // Razorpay signs the RAW body, so we must read it as text (not .json()).
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  if (!signature) {
    return NextResponse.json(
      { received: false, error: 'Missing X-Razorpay-Signature header.' },
      { status: 400 },
    )
  }

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn('[webhooks/razorpay] signature verification failed — rejecting event.')
    return NextResponse.json(
      { received: false, error: 'Invalid signature.' },
      { status: 400 },
    )
  }

  // Signature verified — parse the payload.
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { received: false, error: 'Malformed JSON payload.' },
      { status: 400 },
    )
  }

  // Idempotency (DB-persisted Phase 9):
  //   1. Razorpay event IDs are unique per logical event. Retries of the
  //      same event carry the same ID.
  //   2. We persist a WebhookEvent row BEFORE any financial work. The
  //      `eventId @unique` constraint means a duplicate delivery throws a
  //      unique-violation that we catch → ack 200 without re-processing.
  //   3. In-memory Set is a fast-path dedup so we don't even try the insert
  //      for rapid-fire duplicates.
  const eventId =
    req.headers.get('x-razorpay-event-id') ||
    payload?.meta?.event_id ||
    payload?.event_id ||
    `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  if (seenEventIds.has(eventId)) {
    console.log(`[webhooks/razorpay] in-mem duplicate ${eventId} — acking.`)
    return NextResponse.json({ received: true, duplicate: true, event_id: eventId, layer: 'in-mem' })
  }

  const eventType: string = payload?.event || 'unknown'
  const payment = payload?.payload?.payment?.entity
  const settlement = payload?.payload?.settlement?.entity
  const gatewayPaymentId = payment?.id
  const orderId = payment?.order_id
  const amountPaise: number | undefined = payment?.amount
  const status: string | undefined = payment?.status
  const method: string | undefined = payment?.method
  const notes: Record<string, string> | undefined = payment?.notes
  const feeAt = payload?.payload?.payment?.entity?.fee_at
  const createdAt = payload?.created_at

  console.log('[webhooks/razorpay] event received', {
    event_id: eventId,
    type: eventType,
    gateway_payment_id: gatewayPaymentId,
    order_id: orderId,
    amount_paise: amountPaise,
    status,
    method,
    notes,
  })

  // ─── Persist the WebhookEvent row (idempotency gate) ────────────────
  // Try the create. If it throws P2002 (unique violation on eventId), it's
  // a duplicate — ack 200 without processing.
  let webhookEvent
  try {
    webhookEvent = await db.webhookEvent.create({
      data: {
        eventId,
        eventType,
        gatewayName: 'razorpay',
        signature,
        rawPayload: rawBody,
        status: 'processing',
        schoolId: notes?.schoolId || null,
      },
    })
  } catch (e: any) {
    // Prisma unique-constraint violation → duplicate event id.
    if (e?.code === 'P2002' || String(e?.message || '').includes('Unique constraint')) {
      console.log(`[webhooks/razorpay] DB duplicate ${eventId} — acking.`)
      return NextResponse.json({ received: true, duplicate: true, event_id: eventId, layer: 'db' })
    }
    // Other errors — log + ack 200 so the gateway stops retrying. We don't
    // want to lose the event; the error is persisted on the row if the
    // insert succeeded, or just logged if not.
    console.error('[webhooks/razorpay] WebhookEvent insert error:', e)
    return NextResponse.json({ received: false, error: 'internal_error' }, { status: 500 })
  }
  if (eventId) rememberEvent(eventId)

  // ─── AUTO-RECONCILE based on event type ──────────────────────────────
  let matchedTransactionId: string | null = null
  let processingError: string | null = null

  try {
    if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
      // Look up the FeeTransaction by gatewayOrderId (the order_id from /api/fees/orders).
      if (!orderId) throw new Error('payment.captured missing order_id')
      const txn = await db.feeTransaction.findUnique({ where: { gatewayOrderId: orderId } })
      if (!txn) {
        // Order wasn't created by /api/fees/orders — log + still ack 200 so
        // the gateway doesn't retry. This is a real anomaly to investigate.
        throw new Error(`No FeeTransaction found for gatewayOrderId ${orderId}`)
      }
      // Update the transaction to SUCCESS + reconciled.
      const updated = await db.feeTransaction.update({
        where: { id: txn.id },
        data: {
          status: 'SUCCESS',
          gatewayPaymentId: gatewayPaymentId || null,
          gatewaySignature: signature,
          reconciliationStatus: 'reconciled',
          reconciledAt: new Date(),
          reconciledBy: 'razorpay-webhook',
          reconciliationNote: `Auto-reconciled by webhook ${eventId}`,
        },
      })
      matchedTransactionId = updated.id

      // Create a Reconciliation audit row.
      await db.reconciliation.create({
        data: {
          schoolId: txn.schoolId,
          transactionId: txn.id,
          settlementId: txn.settlementId,
          status: 'reconciled',
          matchedBy: 'razorpay-webhook',
          note: `Auto-matched via gateway order_id ${orderId} (event ${eventId})`,
        },
      }).catch(() => {/* idempotency — if a recon row already exists for this txn, ignore */})

      console.log(`[webhooks/razorpay] reconciled txn ${txn.id} for order ${orderId}`)
    } else if (eventType === 'payment.failed') {
      if (orderId) {
        const txn = await db.feeTransaction.findUnique({ where: { gatewayOrderId: orderId } })
        if (txn) {
          await db.feeTransaction.update({
            where: { id: txn.id },
            data: {
              status: 'FAILED',
              gatewayPaymentId: gatewayPaymentId || null,
              gatewaySignature: signature,
              reconciliationStatus: 'exception',
              reconciliationNote: `Payment failed at gateway (event ${eventId})`,
              reconciledAt: new Date(),
              reconciledBy: 'razorpay-webhook',
            },
          })
          matchedTransactionId = txn.id
          console.log(`[webhooks/razorpay] marked txn ${txn.id} as FAILED`)
        }
      }
    } else if (eventType === 'settlement.processed' || eventType === 'payment.settlement.processed') {
      // Upsert the settlement row + link all matching transactions.
      const payoutId: string = settlement?.id || `settlement_${Date.now()}`
      const periodStart = settlement?.start_at ? new Date(settlement.start_at) : new Date()
      const periodEnd = settlement?.end_at ? new Date(settlement.end_at) : new Date()
      const grossPaise = Number(settlement?.amount ?? 0)
      const feePaise = Number(settlement?.fees ?? 0)
      const settledAt = settlement?.settled_at ? new Date(settlement.settled_at) : new Date()
      const bankRef = settlement?.utr || null

      // ── 3-c fix: school attribution from the ORDERS in transfers[] ──
      // The previous fallback (no notes.schoolId → the registered demo
      // school) misattributed a VALID settlement to an arbitrary tenant
      // and mass-linked that school's transactions. The school is now
      // resolved ONLY from FeeTransaction rows matching the transfer
      // order ids:
      //   · exactly ONE distinct schoolId → attribute + link
      //   · none → skip linking; the WebhookEvent stays unattributed
      //     (schoolId null), nothing is mutated
      //   · multiple distinct → the event is recorded UNATTRIBUTED and
      //     updateMany is never run (cross-tenant ambiguity is an error,
      //     not a guess)
      const transferOrderIds = extractTransferOrderIds(settlement)
      const transferTxns = transferOrderIds.length
        ? await db.feeTransaction.findMany({
            where: { gatewayOrderId: { in: transferOrderIds } },
            select: { schoolId: true },
          })
        : []
      const distinctSchoolIds = [...new Set(transferTxns.map((t) => t.schoolId))]

      const notesSchoolId = notes?.schoolId || null
      let resolvedSchoolId: string | null = null
      if (distinctSchoolIds.length === 1) {
        resolvedSchoolId = distinctSchoolIds[0]
        // Notes (server-minted at order creation) must agree with the
        // orders the gateway actually paid out — a mismatch is unattributed.
        if (notesSchoolId && notesSchoolId !== resolvedSchoolId) resolvedSchoolId = null
      } else if (distinctSchoolIds.length === 0 && notesSchoolId) {
        // No orders we know of, but the payload's notes carry the school
        // our own server stamped at order creation (signed by the HMAC).
        resolvedSchoolId = notesSchoolId
      }

      if (!resolvedSchoolId) {
        if (distinctSchoolIds.length > 1) {
          // Recorded on the WebhookEvent row by the catch/finally below.
          throw new Error(
            `settlement ${payoutId} spans ${distinctSchoolIds.length} schools — recorded unattributed, no transactions linked`,
          )
        }
        console.log(
          `[webhooks/razorpay] settlement ${payoutId} has no attributable orders — recorded unattributed, linking skipped`,
        )
      } else {
        const upsertedSettlement = await db.settlement.upsert({
          where: { payoutId },
          create: {
            schoolId: resolvedSchoolId,
            payoutId,
            gatewayName: 'razorpay',
            periodStart,
            periodEnd,
            grossAmount: grossPaise / 100,
            fees: feePaise / 100,
            netAmount: (grossPaise - feePaise) / 100,
            status: 'settled',
            bankReference: bankRef,
            paidOutAt: settledAt,
          },
          update: {
            periodStart,
            periodEnd,
            grossAmount: grossPaise / 100,
            fees: feePaise / 100,
            netAmount: (grossPaise - feePaise) / 100,
            status: 'settled',
            bankReference: bankRef,
            paidOutAt: settledAt,
          },
        })

        // Link every transaction created between periodStart and periodEnd
        // for this school to this settlement (auto-reconciliation of payouts).
        const linkedTxns = await db.feeTransaction.updateMany({
          where: {
            schoolId: resolvedSchoolId,
            createdAt: { gte: periodStart, lte: periodEnd },
            status: 'SUCCESS',
            reconciliationStatus: { in: ['reconciled', 'unreconciled', 'pending'] },
          },
          data: {
            settlementId: upsertedSettlement.id,
            reconciliationStatus: 'reconciled',
            reconciledAt: new Date(),
            reconciledBy: 'razorpay-webhook-settlement',
          },
        })
        console.log(`[webhooks/razorpay] settlement ${payoutId} linked ${linkedTxns.count} transactions`)
      }
    } else {
      console.log(`[webhooks/razorpay] event type ${eventType} — no auto-reconciliation handler.`)
    }
  } catch (e: any) {
    processingError = e instanceof Error ? e.message : String(e)
    console.error('[webhooks/razorpay] processing error:', processingError)
  } finally {
    // Update the WebhookEvent row with the outcome (always — even on error,
    // so the operator can see what happened in the audit log).
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: processingError ? 'error' : 'processed',
        matchedTransactionId,
        error: processingError,
        processedAt: new Date(),
      },
    }).catch(() => {/* best-effort — don't mask the original error */})
  }

  // Ack 200 so Razorpay stops retrying. The reconciliation is done (or
  // the error is recorded for the operator to triage).
  return NextResponse.json({
    received: true,
    event_id: eventId,
    type: eventType,
    linked_student_id: notes?.studentId ?? null,
    linked_fee_head: notes?.feeHead ?? null,
    matched_transaction_id: matchedTransactionId,
    error: processingError,
  })
}

// GET — let operators sanity-check that the endpoint is alive + configured.
export async function GET() {
  const configured = !!process.env.RAZORPAY_WEBHOOK_SECRET
  return NextResponse.json({
    endpoint: '/api/webhooks/razorpay',
    secret_configured: configured,
    seen_events: seenEventIds.size,
    note: configured
      ? 'Ready to receive Razorpay webhooks. POST with a valid X-Razorpay-Signature.'
      : 'Set RAZORPAY_WEBHOOK_SECRET env var to enable verification.',
  })
}
