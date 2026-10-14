'use client'

// ============================================================
// StudentSubscriptionModule — "My Subscription" (student workspace)
// ------------------------------------------------------------
// SUBSCRIPTION & ENTITLEMENT SYSTEM, Model B student surface:
//   · the student's OWN subscription status (server-computed — school
//     coverage vs individual entitlement vs expired/not-subscribed),
//     with the exact next action stated clearly;
//   · offline activation-code redemption (POST /api/subscription/
//     student/claim — authenticated, atomic, generic errors);
//   · online payment (sandbox/razorpay lanes) with the honest
//     BLOCKED state when the live lane is unconfigured;
//   · last payment + revocation info (own records only — never
//     another student's data; the API is session-scoped).
// The module works in EVERY entitlement state (it is part of the
// exempt renewal/claim surface a locked student must reach).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, CalendarClock, CheckCircle2, CreditCard, Info, KeyRound,
  Loader2, Lock, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

interface StudentSubscriptionData {
  entitlement: { state: string; businessAllowed: boolean; message: string | null; validityEnd: string | null; source: string | null; planCode: string | null }
  billingModel: string
  coveredBySchool: boolean
  lastRevoked: { revokedAt: string | null; reason: string | null } | null
  lastPayment: { receiptNo: string | null; amount: number; currency: string; mode: string; paymentDate: string; validityEndAfter: string | null } | null
  plans: Array<{ code: string; name: string; description: string | null; price: number; currency: string }>
  onlinePaymentsAvailable: boolean
  claimInstructions: { message: string }
}

const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const money = (n: number, c: string) => `${c === 'INR' ? '₹' : ''}${n.toLocaleString('en-IN')}${c === 'INR' ? '' : ' ' + c}`

interface RazorpayCheckoutResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

/** Load checkout.js once and open the REAL Razorpay sheet (live lane).
 *  Mirrors the fee payment-dialog contract: the sheet's signed handler
 *  payload is relayed to /verify where the server re-checks the HMAC —
 *  nothing activates on the client's word. */
function openRazorpayCheckout(opts: {
  keyId: string
  providerOrderId: string
  amount: number
  currency: string
  onConfirm: (res: RazorpayCheckoutResponse) => void
  onDismiss: () => void
  onFail: () => void
}) {
  const run = () => {
    try {
      const rzp = new (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: () => void) => void } }).Razorpay({
        key: opts.keyId,
        order_id: opts.providerOrderId,
        amount: Math.round(opts.amount * 100),
        currency: opts.currency,
        name: 'Scholario Student Subscription',
        description: 'Annual student subscription',
        theme: { color: '#7c3aed' },
        handler: (res: RazorpayCheckoutResponse) => opts.onConfirm(res),
        modal: { ondismiss: () => opts.onDismiss() },
      })
      rzp.on('payment.failed', () => opts.onFail())
      rzp.open()
    } catch {
      opts.onFail()
    }
  }
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return run()
  const script = document.createElement('script')
  script.src = 'https://checkout.razorpay.com/v1/checkout.js'
  script.onload = run
  script.onerror = () => opts.onFail()
  document.body.appendChild(script)
}

export function StudentSubscriptionModule() {
  const [data, setData] = useState<StudentSubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [claimCode, setClaimCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [paying, setPaying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/subscription/student', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (body?.ok) setData(body.data as StudentSubscriptionData)
      else toast.error(body?.error ?? 'Could not load your subscription status.')
    } catch {
      toast.error('Could not load your subscription status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const claim = async () => {
    if (claimCode.trim().length < 10) { toast.error('Enter the full activation code from your school office.'); return }
    setClaiming(true)
    try {
      const res = await fetch('/api/subscription/student/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: claimCode.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (body?.ok) {
        toast.success(body.data.message ?? 'Code accepted.')
        setClaimCode('')
        void load()
      } else {
        toast.error(body?.error ?? 'This code is not valid for your account.')
      }
    } catch {
      toast.error('Claim failed — please try again.')
    } finally {
      setClaiming(false)
    }
  }

  const payOnline = async (planCode: string) => {
    setPaying(planCode)
    try {
      // 1) create the order (server-side amount; sandbox lane auto-confirmed
      //    server-side in the dev/test contract).
      const res = await fetch('/api/subscription/student/order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planCode, sandbox: true }),
      })
      const body = await res.json().catch(() => null)
      if (!body?.ok) { toast.error(body?.error ?? 'Could not start the payment.'); return }
      const { order, sandboxConfirmation } = body.data as {
        order: { orderNo: string; amount: number; currency: string; expiresAt: string; provider: string; providerOrderId: string; keyId: string | null; mode: string }
        sandboxConfirmation: { orderId: string; paymentId: string; signature: string } | null
      }
      if (sandboxConfirmation) {
        // 2) sandbox lane: relay the server-signed confirmation to verify —
        //    activation happens ONLY after server-side verification.
        const vres = await fetch('/api/subscription/student/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderNo: order.orderNo, sandbox: true }),
        })
        const vbody = await vres.json().catch(() => null)
        if (vbody?.ok) {
          toast.success(vbody.data.message ?? 'Subscription activated.')
          void load()
        } else {
          toast.error(vbody?.error ?? 'Payment verification failed — nothing was activated.')
        }
        return
      }
      if (order.keyId && order.providerOrderId && order.mode !== 'sandbox') {
        // 3) LIVE Razorpay lane: open the real checkout sheet. The signed
        //    handler payload (order/payment/signature triple) is relayed to
        //    /verify, which re-checks the HMAC server-side before anything
        //    activates (the same contract as the fee payment dialog).
        openRazorpayCheckout({
          keyId: order.keyId,
          providerOrderId: order.providerOrderId,
          amount: order.amount,
          currency: order.currency,
          onConfirm: async (r) => {
            try {
              const vres = await fetch('/api/subscription/student/verify', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  orderNo: order.orderNo,
                  orderId: r.razorpay_order_id,
                  paymentId: r.razorpay_payment_id,
                  signature: r.razorpay_signature,
                }),
              })
              const vbody = await vres.json().catch(() => null)
              if (vbody?.ok) {
                toast.success(vbody.data.message ?? 'Payment verified and your subscription is active.')
                void load()
              } else {
                toast.error(vbody?.error ?? 'Payment verification failed — nothing was activated.')
              }
            } catch {
              toast.error('Payment verification failed — nothing was activated.')
            }
          },
          onDismiss: () => toast.info('Checkout cancelled — your order stays pending for a few minutes.'),
          onFail: () => toast.error('The gateway reported a failed payment — nothing was activated.'),
        })
        return
      }
      // Unconfigured live lane — honest blocked state (no fake success).
      toast.info(`Order ${order.orderNo} created for ${money(order.amount, order.currency)}. Online payment verification is not configured on this deployment yet — if you were asked to pay, contact your school office.`)
    } catch {
      toast.error('Payment failed — nothing was activated.')
    } finally {
      setPaying(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-2xl" />
        <Skeleton className="h-32 w-full max-w-2xl" />
      </div>
    )
  }
  if (!data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Subscription status is unavailable right now.</div>
  }

  const state = data.entitlement.state

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">My Subscription</h1>
        <p className="text-sm text-muted-foreground">Your annual student subscription status and activation.</p>
      </header>

      {/* Status card — states with the exact next action */}
      <section className="max-w-2xl space-y-3">
        <div className={`rounded-xl border p-4 ${state === 'ACTIVE' || state === 'COVERED_BY_SCHOOL' ? 'border-emerald-300 bg-emerald-50/60' : state === 'PENDING' ? 'border-sky-300 bg-sky-50/60' : 'border-amber-300 bg-amber-50/60'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {state === 'ACTIVE' || state === 'COVERED_BY_SCHOOL' ? (
              <BadgeCheck className="h-5 w-5 text-emerald-700" />
            ) : state === 'PENDING' ? (
              <CalendarClock className="h-5 w-5 text-sky-700" />
            ) : (
              <Lock className="h-5 w-5 text-amber-700" />
            )}
            <span className="text-sm font-semibold">
              {state === 'COVERED_BY_SCHOOL'
                ? 'Covered by your school’s plan'
                : state === 'ACTIVE'
                  ? 'Active'
                  : state === 'PENDING'
                    ? 'Starts soon'
                    : state === 'EXPIRED'
                      ? 'Expired'
                      : state === 'REVOKED'
                        ? 'Withdrawn'
                        : state === 'SUSPENDED'
                          ? 'Suspended'
                          : state === 'ACCOUNT_LOCKED'
                            ? 'Account locked'
                            : 'Not active yet'}
            </span>
            {data.entitlement.validityEnd && state !== 'COVERED_BY_SCHOOL' && (
              <Badge variant="outline">until {dateStr(data.entitlement.validityEnd)}</Badge>
            )}
          </div>
          {data.entitlement.message && (
            <p className="mt-2 text-sm text-muted-foreground">{data.entitlement.message}</p>
          )}
          {state === 'REVOKED' && data.lastRevoked?.reason && (
            <p className="mt-1 text-xs text-rose-700">Reason: {data.lastRevoked.reason}</p>
          )}
        </div>

        {/* Activation code claim — available in every state (renewals too) */}
        {!data.coveredBySchool && (
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4" />Activate with a code</div>
            <p className="mt-1 text-xs text-muted-foreground">{data.claimInstructions.message}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                className="font-mono tracking-wider sm:flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') void claim() }}
              />
              <Button onClick={() => void claim()} disabled={claiming}>
                {claiming ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                Activate
              </Button>
            </div>
          </div>
        )}

        {/* Online payment */}
        {!data.coveredBySchool && data.plans.length > 0 && (
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><CreditCard className="h-4 w-4" />Pay online</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your subscription activates only after the payment is verified by the server.
            </p>
            <div className="mt-3 grid gap-2">
              {data.plans.map((p) => (
                <div key={p.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{money(p.price, p.currency)}</span>
                    <Button size="sm" onClick={() => void payOnline(p.code)} disabled={paying === p.code || !data.onlinePaymentsAvailable}>
                      {paying === p.code && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      <Wallet className="mr-1 h-3.5 w-3.5" />Pay
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!data.onlinePaymentsAvailable && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Online payment is currently unavailable on this deployment — use the activation code from your school office.
              </p>
            )}
          </div>
        )}

        {/* Own history */}
        {data.lastPayment && (
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="h-4 w-4" />Last payment</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{data.lastPayment.receiptNo}</span>
              <span>{money(data.lastPayment.amount, data.lastPayment.currency)} · {data.lastPayment.mode.replace(/_/g, ' ').toLowerCase()}</span>
              <span>{dateStr(data.lastPayment.paymentDate)}</span>
              {data.lastPayment.validityEndAfter && <Badge variant="outline">until {dateStr(data.lastPayment.validityEndAfter)}</Badge>}
            </div>
          </div>
        )}

        {data.billingModel === 'SCHOOL_WIDE' && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Your school pays for Scholario school-wide — no individual student subscription is required.
          </p>
        )}
      </section>
    </div>
  )
}
