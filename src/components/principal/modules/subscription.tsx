'use client'

// ============================================================
// PrincipalSubscriptionModule — school-plane subscription surface
// ------------------------------------------------------------
// SUBSCRIPTION & ENTITLEMENT SYSTEM, Model A school surface:
//   · tenant status (the SAME server evaluation the locked shell
//     shows — states can never disagree);
//   · redeem a school-wide activation code (offline payment
//     delivery handshake);
//   · start an online renewal against the configured plan registry
//     (sandbox lane in dev/test; honest blocked state otherwise);
//   · student entitlement overview (view-only: issuing paid
//     entitlements is platform-only by construction).
// Principals can never mark payments successful here — activation
// happens only through code redemption or server-verified payments.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck, CalendarClock, CheckCircle2, CreditCard, Info, KeyRound,
  Loader2, Lock, RefreshCw, Users, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

interface SubData {
  entitlement: { state: string; businessAllowed: boolean; renewalRequired: boolean; message: string | null; periodEnd: string | null; graceUntil: string | null; plan: string }
  billingModel: string
  recentPayments: Array<{ receiptNo: string | null; amount: number; currency: string; mode: string; paymentDate: string; periodMonths: number; statusAfter: string | null; periodEndAfter: string | null }>
  plans: Array<{ code: string; name: string; description: string | null; interval: string; price: number; currency: string }>
  activationCodes: Array<{ publicRef: string; status: string; planCode: string | null; issuedAt: string; expiresAt: string }>
  onlinePaymentsAvailable: boolean
  renewal: { message: string }
}
interface StudentStatusRow {
  studentId: string; name: string; class: string | null; state: string
  validityEnd: string | null; accountLocked: boolean; source: string | null
}

const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const money = (n: number, c: string) => `${c === 'INR' ? '₹' : ''}${n.toLocaleString('en-IN')}${c === 'INR' ? '' : ' ' + c}`

const STATE_LABEL: Record<string, string> = {
  ACTIVE: 'Active', GRACE: 'Grace period', RESTRICTED: 'Locked — renewal required',
  SUSPENDED: 'Suspended', NOT_ACTIVATED: 'Not activated',
}

interface RazorpayCheckoutResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

/** Load checkout.js once and open the REAL Razorpay sheet (live lane) —
 *  the same contract as the fee payment dialog: the sheet's signed handler
 *  payload is relayed to /verify where the server re-checks the HMAC
 *  server-side before anything activates. */
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
        name: 'Scholario School Subscription',
        description: 'School subscription renewal',
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

export function PrincipalSubscriptionModule() {
  const [data, setData] = useState<SubData | null>(null)
  const [students, setStudents] = useState<StudentStatusRow[] | null>(null)
  const [studentNote, setStudentNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [paying, setPaying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/subscription', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (body?.ok) setData(body.data as SubData)
      else toast.error(body?.error ?? 'Could not load the subscription status.')
      const sres = await fetch('/api/subscription/students?filter=all', { cache: 'no-store' })
      const sbody = await sres.json().catch(() => null)
      if (sbody?.ok) {
        setStudents(sbody.data.students as StudentStatusRow[])
        setStudentNote(sbody.data.note as string)
      }
    } catch {
      toast.error('Could not load the subscription status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const redeem = async () => {
    if (code.trim().length < 10) { toast.error('Enter the full activation code from SCHOLARIO.'); return }
    setClaiming(true)
    try {
      const res = await fetch('/api/subscription/redeem', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (body?.ok) {
        toast.success(body.data.message ?? 'Subscription activated.')
        setCode('')
        void load()
      } else {
        toast.error(body?.error ?? 'This code is not valid for your school.')
      }
    } catch {
      toast.error('Redemption failed — please try again.')
    } finally {
      setClaiming(false)
    }
  }

  const renewOnline = async (planCode: string) => {
    setPaying(planCode)
    try {
      const res = await fetch('/api/subscription/order', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planCode }),
      })
      const body = await res.json().catch(() => null)
      if (!body?.ok) { toast.error(body?.error ?? 'Could not start the renewal.'); return }
      const order = (body.data as { order: { orderNo: string; amount: number; currency: string; mode: string; providerOrderId: string; keyId: string | null } }).order
      if (order.mode === 'sandbox') {
        // Dev/test contract: run the sandbox payment + verify server-side.
        const vres = await fetch('/api/subscription/verify', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderNo: order.orderNo, sandbox: true }),
        })
        const vbody = await vres.json().catch(() => null)
        if (vbody?.ok) { toast.success(vbody.data.message ?? 'Subscription renewed.'); void load() }
        else toast.error(vbody?.error ?? 'Verification failed — nothing was activated.')
        return
      }
      if (order.keyId && order.providerOrderId) {
        // LIVE Razorpay lane: open the real checkout sheet (same contract
        // as the fee payment dialog) — the signed handler triple is relayed
        // to /verify, which re-checks the HMAC server-side.
        openRazorpayCheckout({
          keyId: order.keyId,
          providerOrderId: order.providerOrderId,
          amount: order.amount,
          currency: order.currency,
          onConfirm: async (r) => {
            try {
              const vres = await fetch('/api/subscription/verify', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  orderNo: order.orderNo,
                  orderId: r.razorpay_order_id,
                  paymentId: r.razorpay_payment_id,
                  signature: r.razorpay_signature,
                }),
              })
              const vbody = await vres.json().catch(() => null)
              if (vbody?.ok) { toast.success(vbody.data.message ?? 'Subscription renewed.'); void load() }
              else toast.error(vbody?.error ?? 'Verification failed — nothing was activated.')
            } catch {
              toast.error('Verification failed — nothing was activated.')
            }
          },
          onDismiss: () => toast.info('Checkout cancelled — your order stays pending for a few minutes.'),
          onFail: () => toast.error('The gateway reported a failed payment — nothing was activated.'),
        })
        return
      }
      // Unconfigured live lane — honest blocked state (no fake success).
      toast.info(`Order ${order.orderNo} created for ${money(order.amount, order.currency)}. Online payment verification is not configured on this deployment yet — please contact SCHOLARIO support.`)
    } catch {
      toast.error('Renewal failed — nothing was activated.')
    } finally {
      setPaying(null)
    }
  }

  if (loading && !data) {
    return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full max-w-3xl" /></div>
  }
  if (!data) return <div className="p-8 text-center text-sm text-muted-foreground">Subscription status is unavailable right now.</div>

  const state = data.entitlement.state

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">Your school&apos;s Scholario subscription, renewals and student entitlements.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>
      </header>

      <section className="max-w-3xl space-y-3">
        <div className={`rounded-xl border p-4 ${state === 'ACTIVE' ? 'border-emerald-300 bg-emerald-50/60' : state === 'GRACE' ? 'border-amber-300 bg-amber-50/60' : 'border-rose-300 bg-rose-50/60'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {state === 'ACTIVE' ? <BadgeCheck className="h-5 w-5 text-emerald-700" /> : <Lock className="h-5 w-5 text-rose-700" />}
            <span className="text-sm font-semibold">{STATE_LABEL[state] ?? state}</span>
            <Badge variant="outline">{data.entitlement.plan}</Badge>
            <Badge variant="outline">{data.billingModel.replace(/_/g, ' ').toLowerCase()}</Badge>
            {data.entitlement.periodEnd && <Badge variant="outline">until {dateStr(data.entitlement.periodEnd)}</Badge>}
          </div>
          {data.entitlement.message && <p className="mt-2 text-sm text-muted-foreground">{data.entitlement.message}</p>}
        </div>

        <Tabs defaultValue="renew">
          <TabsList className="flex h-auto w-full flex-wrap">
            <TabsTrigger value="renew"><CreditCard className="mr-1 h-4 w-4" />Renew</TabsTrigger>
            <TabsTrigger value="students"><Users className="mr-1 h-4 w-4" />Students</TabsTrigger>
            <TabsTrigger value="history"><CalendarClock className="mr-1 h-4 w-4" />Payments</TabsTrigger>
          </TabsList>

          <TabsContent value="renew" className="space-y-3">
            <div className="rounded-xl border p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4" />Redeem an activation code</div>
              <p className="mt-1 text-xs text-muted-foreground">
                SCHOLARIO issues activation codes for offline payments. Redeeming the code activates your school&apos;s subscription — the code works only for your school.
              </p>
              {data.activationCodes.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Issued for your school: {data.activationCodes.map((c) => `${c.publicRef} (${c.status.toLowerCase()})`).join(' · ')}
                </div>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-wider sm:flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') void redeem() }}
                />
                <Button onClick={() => void redeem()} disabled={claiming}>
                  {claiming ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                  Redeem
                </Button>
              </div>
            </div>

            {data.plans.length > 0 && (
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-1.5 text-sm font-semibold"><Wallet className="h-4 w-4" />Renew online</div>
                <p className="mt-1 text-xs text-muted-foreground">The subscription activates only after the payment is verified by the server.</p>
                <div className="mt-3 grid gap-2">
                  {data.plans.map((p) => (
                    <div key={p.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.interval === 'MONTHLY' ? 'monthly' : 'annual'}{p.description ? ` · ${p.description}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{money(p.price, p.currency)}</span>
                        <Button size="sm" onClick={() => void renewOnline(p.code)} disabled={paying === p.code || !data.onlinePaymentsAvailable}>
                          {paying === p.code && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          <CreditCard className="mr-1 h-3.5 w-3.5" />Pay
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {!data.onlinePaymentsAvailable && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Online renewal is currently unavailable on this deployment — please arrange an offline payment with SCHOLARIO support.
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="students" className="space-y-2">
            {studentNote && <p className="text-xs text-muted-foreground">{studentNote}</p>}
            {students === null ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">Student</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Valid until</th></tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.studentId} className="border-t">
                        <td className="px-3 py-2">{s.name}{s.class ? <span className="ml-2 text-xs text-muted-foreground">{s.class}</span> : null}</td>
                        <td className="px-3 py-2 text-xs">{s.state.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="px-3 py-2 text-xs">{dateStr(s.validityEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              View-only: entitlements and payments are managed by SCHOLARIO (your office collects payments and requests activation codes).
            </p>
          </TabsContent>

          <TabsContent value="history" className="space-y-2">
            {data.recentPayments.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              data.recentPayments.map((p) => (
                <div key={p.receiptNo ?? p.paymentDate} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span className="font-mono text-xs">{p.receiptNo ?? '—'}</span>
                  <span>{money(p.amount, p.currency)} · {p.mode.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="text-xs text-muted-foreground">{dateStr(p.paymentDate)}</span>
                  {p.periodEndAfter && <Badge variant="outline">until {dateStr(p.periodEndAfter)}</Badge>}
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
