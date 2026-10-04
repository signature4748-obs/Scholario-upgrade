import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

/**
 * SCHOLARIO-OS — Payment gateway abstraction (server-only).
 * ---------------------------------------------------------
 * SERVER-ONLY MODULE. Never import this from client components or
 * middleware — the module reads gateway secrets from process.env and
 * mints HMAC signatures. It is only ever imported from API route
 * handlers under src/app/api/**, which always run on the Node runtime.
 *
 * #1 security rule of the checkout flow: the client is NEVER trusted to
 * declare payment success. The only thing that flips a FeeTransaction to
 * SUCCESS is server-side verification of the checkout-handler signature
 * (HMAC_SHA256(`${orderId}|${paymentId}`, <server-held secret>)) — see
 * POST /api/student/payments/verify.
 *
 * Two implementations:
 *
 *   1. RazorpayProvider — activated when RAZORPAY_KEY_ID +
 *      RAZORPAY_KEY_SECRET are both set. Talks to the real Razorpay
 *      Orders API over plain fetch (NO npm SDK — no extra deps) and
 *      verifies checkout confirmations with the key secret. keyId is
 *      the PUBLIC Razorpay key id (safe to hand to the browser for
 *      Razorpay Checkout); the secret never leaves the server.
 *
 *   2. SandboxProvider — activated when PAYMENTS_SANDBOX=1 (demo env,
 *      no real gateway keys). It SIMULATES the gateway server-side:
 *      createOrder mints `order_sbx_<random>` locally and
 *      confirmSandboxPayment "runs" the payment and returns the signed
 *      confirmation the client relays to /verify — exactly like a real
 *      Razorpay checkout handler would. The signature is
 *      HMAC_SHA256(`${orderId}|${paymentId}`, PAYMENTS_SANDBOX_SECRET)
 *      with a server-held secret, so /verify's re-check still holds the
 *      security property: a client-forged payload fails verification.
 *
 * Selection order in getPaymentProvider(): Razorpay if configured,
 * else Sandbox if enabled, else null (online payments unavailable).
 */

export interface ProviderOrderResult {
  orderId: string
  amountPaise: number
  currency: 'INR'
  keyId?: string
  mode: 'live' | 'test' | 'sandbox'
}

/** Shape mirrors the Razorpay Checkout handler payload. */
export interface CheckoutConfirmation {
  paymentId: string
  orderId: string
  signature: string
}

export interface VerifyResult {
  ok: boolean
  reason?: string
}

export interface PaymentProvider {
  name: 'razorpay' | 'sandbox'
  mode: 'live' | 'test' | 'sandbox'
  /** PUBLIC key id only (Razorpay keyId is public; sandbox has none). */
  keyId?: string
  createOrder(input: {
    amountPaise: number
    receipt: string
    notes: Record<string, string>
  }): Promise<ProviderOrderResult>
  /**
   * Verifies the checkout-handler payload signature.
   * Razorpay: HMAC_SHA256(`${orderId}|${paymentId}`, keySecret).
   */
  verifyCheckoutConfirmation(confirmation: CheckoutConfirmation): VerifyResult
  /**
   * Server-side sandbox gateway: "runs" the payment and returns the
   * signed confirmation the client will relay to /verify.
   */
  confirmSandboxPayment?(input: {
    orderId: string
    amountPaise: number
  }): CheckoutConfirmation
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Length-checked, timing-safe hex comparison (prevents timing attacks). */
function safeEqualHex(expected: string, received: string): boolean {
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(received, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** HMAC_SHA256(`${orderId}|${paymentId}`, secret) → hex (Razorpay convention). */
function checkoutSignature(orderId: string, paymentId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
}

function randomToken(bytes = 12): string {
  return randomBytes(bytes).toString('hex')
}

// ─── Razorpay (real gateway, plain fetch — no SDK) ─────────────────────

export class RazorpayProvider implements PaymentProvider {
  name = 'razorpay' as const
  keyId: string
  private keySecret: string
  mode: 'live' | 'test'

  constructor(keyId: string, keySecret: string) {
    this.keyId = keyId
    this.keySecret = keySecret
    this.mode = keyId.startsWith('rzp_test_') ? 'test' : 'live'
  }

  async createOrder(input: {
    amountPaise: number
    receipt: string
    notes: Record<string, string>
  }): Promise<ProviderOrderResult> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      }),
    })
    if (!res.ok) {
      // Surface a generic error — never leak the secret/auth material.
      throw new Error('gateway order failed')
    }
    const order = (await res.json()) as { id?: string; amount?: number }
    if (!order.id) throw new Error('gateway order failed')
    return {
      orderId: order.id,
      amountPaise: order.amount ?? input.amountPaise,
      currency: 'INR',
      keyId: this.keyId,
      mode: this.mode,
    }
  }

  verifyCheckoutConfirmation(confirmation: CheckoutConfirmation): VerifyResult {
    if (!confirmation?.orderId || !confirmation?.paymentId || !confirmation?.signature) {
      return { ok: false, reason: 'incomplete confirmation payload' }
    }
    const expected = checkoutSignature(confirmation.orderId, confirmation.paymentId, this.keySecret)
    const ok = safeEqualHex(expected, confirmation.signature)
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  }
}

// ─── Sandbox (server-side simulated gateway) ───────────────────────────

class SandboxProvider implements PaymentProvider {
  name = 'sandbox' as const
  mode = 'sandbox' as const
  keyId?: string = undefined // sandbox has no public key
  private secret: string

  constructor(secret: string) {
    this.secret = secret
  }

  async createOrder(input: {
    amountPaise: number
    receipt: string
    notes: Record<string, string>
  }): Promise<ProviderOrderResult> {
    // Local mint — no network call. The order id is the join key the
    // FeeTransaction row stores (gatewayOrderId @unique).
    return {
      orderId: `order_sbx_${randomToken()}`,
      amountPaise: input.amountPaise,
      currency: 'INR',
      mode: 'sandbox',
    }
  }

  verifyCheckoutConfirmation(confirmation: CheckoutConfirmation): VerifyResult {
    if (!confirmation?.orderId || !confirmation?.paymentId || !confirmation?.signature) {
      return { ok: false, reason: 'incomplete confirmation payload' }
    }
    const expected = checkoutSignature(confirmation.orderId, confirmation.paymentId, this.secret)
    const ok = safeEqualHex(expected, confirmation.signature)
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  }

  /**
   * "Runs" the payment on the simulated gateway. The signed confirmation
   * is minted SERVER-SIDE with the sandbox secret and relayed by the
   * client to /verify, which re-verifies the HMAC — a forged client
   * payload cannot pass verification.
   */
  confirmSandboxPayment(input: { orderId: string; amountPaise: number }): CheckoutConfirmation {
    const paymentId = `pay_sbx_${randomToken()}`
    return {
      paymentId,
      orderId: input.orderId,
      signature: checkoutSignature(input.orderId, paymentId, this.secret),
    }
  }
}

// ─── factory ───────────────────────────────────────────────────────────

let cached: { provider: PaymentProvider | null } | null = null

/**
 * Resolves the active payment provider.
 *   Razorpay (live/test) when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set,
 *   else Sandbox when PAYMENTS_SANDBOX=1,
 *   else null → online payments unavailable (offline collection only).
 */
export function getPaymentProvider(): PaymentProvider | null {
  if (cached) return cached.provider
  let provider: PaymentProvider | null = null

  const rpKey = process.env.RAZORPAY_KEY_ID?.trim()
  const rpSecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (rpKey && rpSecret) {
    provider = new RazorpayProvider(rpKey, rpSecret)
  } else if (process.env.PAYMENTS_SANDBOX === '1' && process.env.PAYMENTS_SANDBOX_SECRET) {
    provider = new SandboxProvider(process.env.PAYMENTS_SANDBOX_SECRET)
  }

  cached = { provider }
  return provider
}
