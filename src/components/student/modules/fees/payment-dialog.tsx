'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Wallet, ShieldCheck, CheckCircle2, XCircle, Download, Lock, ArrowLeft, IndianRupee } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/format'
import { useFeeStore, type FeeTransaction } from '@/lib/store/fee-store'
import { downloadReceiptA5 } from '@/components/principal/modules/fees/fee-receipt-a5'
import { paymentMethods, MODE_FROM_FORM_ID, type PayStage, type PaymentStudentInfo, type PaymentConfigResponse, type PaymentOrderResponse, type PaymentVerifyResponse } from './data'

/**
 * PaymentDialog — the student self-service ONLINE payment flow.
 *
 * SECURITY ARCHITECTURE (never trust the client):
 *   1. The SERVER creates the order and mints the official receipt
 *      number (RCP-2026-XXXX) — the browser never invents one.
 *   2. The gateway (Razorpay checkout, or the server-side sandbox
 *      gateway in this demo environment) produces a SIGNED confirmation.
 *   3. /api/student/payments/verify re-checks the signature SERVER-SIDE
 *      (HMAC over orderId|paymentId with a server-held secret) before
 *      anything is marked paid. A forged client payload fails here.
 *   4. Only AFTER the server says SUCCESS does this UI mirror the
 *      payment into the local fee ledger (with the server receipt +
 *      gateway payment id) and show the official receipt.
 *
 * Stages: amount → review → gateway (checkout sheet) → verifying →
 * success (official receipt) | failed.
 */

interface PaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentId: string
  student: PaymentStudentInfo
  balanceDue: number
  /** Primary core fee head the payment is applied against (order note). */
  primaryHead: string
  config: PaymentConfigResponse | null
  /** 7-E — fired once the SERVER has verified the payment (success
   * stage). The Fees module refetches its server-derived balance +
   * receipt history so the displayed truth drops immediately. */
  onPaymentSuccess?: () => void
}

interface RazorpayCheckoutResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export function PaymentDialog({ open, onOpenChange, studentId, student, balanceDue, primaryHead, config, onPaymentSuccess }: PaymentDialogProps) {
  const [stage, setStage] = useState<PayStage>('amount')
  const [amountInput, setAmountInput] = useState('')
  const [method, setMethod] = useState(paymentMethods[0]?.id ?? 'upi')
  const [error, setError] = useState<string | null>(null)
  const [_order, setOrder] = useState<PaymentOrderResponse | null>(null)
  const [verified, setVerified] = useState<PaymentVerifyResponse | null>(null)
  const [mirroredTxn, setMirroredTxn] = useState<FeeTransaction | null>(null)
  const recordPayment = useFeeStore((s) => s.recordPayment)
  const receiptSettings = useFeeStore((s) => s.receiptSettings)
  const razorpayRef = useRef<any>(null)
  void razorpayRef

  const providerLabel = config?.provider === 'razorpay' ? 'Razorpay' : 'Sandbox test gateway'
  const isSandbox = config?.mode === 'sandbox'

  // Reset ONLY on the false→true open transition. balanceDue intentionally
  // excluded from the guard: a successful payment changes it MID-dialog,
  // and that must never wipe the success/receipt stage (the mirrored
  // payment already happened server-side).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStage('amount')
      setAmountInput(String(balanceDue > 0 ? balanceDue : ''))
      setMethod(paymentMethods[0]?.id ?? 'upi')
      setError(null)
      setOrder(null)
      setVerified(null)
      setMirroredTxn(null)
    }
    wasOpen.current = open
  }, [open, balanceDue])

  const amountNum = useMemo(() => {
    const n = Math.round(Number(amountInput))
    return Number.isFinite(n) ? n : 0
  }, [amountInput])
  const amountValid = amountNum >= 1 && amountNum <= balanceDue

  const close = () => {
    if (stage === 'gateway' || stage === 'verifying') return // no mid-flight dismiss
    onOpenChange(false)
  }

  // ── Step 1+2: create the SERVER order, then hand off to the gateway ──
  const confirmAndPay = async () => {
    if (!amountValid || !config?.available) return
    setStage('gateway')
    setError(null)
    try {
      const r = await fetch('/api/student/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountNum,
          method: MODE_FROM_FORM_ID[method] ?? 'UPI',
          feeHead: primaryHead,
          purpose: `Online fee payment via ${providerLabel} (${MODE_FROM_FORM_ID[method] ?? 'UPI'})`,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? 'The payment order could not be created.')
      const ord: PaymentOrderResponse = j.data
      setOrder(ord)

      if (config.provider === 'razorpay' && ord.keyId) {
        // REAL Razorpay checkout — the signed confirmation comes from
        // Razorpay's sheet and is verified server-side at /verify.
        await openRazorpayCheckout(ord)
      } else {
        // SANDBOX gateway — the server minted a signed confirmation with
        // the order; present the secure sheet for a beat, then relay the
        // confirmation to /verify exactly like a checkout handler would.
        await new Promise((res) => setTimeout(res, 1700))
        await verifyPayment({ orderId: ord.orderId, paymentId: ord.paymentId!, signature: ord.signature! })
      }
    } catch (e: any) {
      // Razorpay modal dismissal is a cancel, not a failure.
      if (e?.name === 'RazorpayDismissed') {
        setStage('review')
        return
      }
      setError(e instanceof Error ? e.message : 'Payment could not be completed.')
      setStage('failed')
    }
  }

  // ── Razorpay checkout.js loader + sheet ──────────────────────────────
  const openRazorpayCheckout = (ord: PaymentOrderResponse) =>
    new Promise<void>((resolve, reject) => {
      const run = () => {
        try {
          const rzp = new (window as any).Razorpay({
            key: ord.keyId,
            order_id: ord.orderId,
            amount: ord.amountPaise,
            currency: ord.currency,
            name: 'School Fees',
            description: `${primaryHead} · ${student.name}`,
            prefill: { name: student.name, contact: '' },
            theme: { color: '#7c3aed' },
            handler: (res: RazorpayCheckoutResponse) => {
              verifyPayment({ orderId: res.razorpay_order_id, paymentId: res.razorpay_payment_id, signature: res.razorpay_signature })
                .then(resolve)
                .catch(reject)
            },
            modal: {
              ondismiss: () => {
                const err: any = new Error('Checkout cancelled')
                err.name = 'RazorpayDismissed'
                reject(err)
              },
            },
          })
          razorpayRef.current = rzp
          rzp.on('payment.failed', () => {
            const err: any = new Error('The gateway reported a failed payment.')
            err.name = 'GatewayFailed'
            reject(err)
          })
          rzp.open()
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Could not open the payment gateway.'))
        }
      }
      if ((window as any).Razorpay) return run()
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload = run
      script.onerror = () => reject(new Error('Could not load the payment gateway. Check your connection and retry.'))
      document.body.appendChild(script)
    })

  // ── Step 3: SERVER-SIDE verification — the only path to 'success' ────
  const verifyPayment = async (confirmation: { orderId: string; paymentId: string; signature: string }) => {
    setStage('verifying')
    const r = await fetch('/api/student/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(confirmation),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) throw new Error(j?.error === 'SIGNATURE_VERIFICATION_FAILED'
      ? 'The payment could not be verified. If money left your account it will be auto-refunded by the gateway.'
      : (j?.error ?? 'Verification failed.'))
    const v: PaymentVerifyResponse = j.data
    setVerified(v)

    // Mirror the SERVER-VERIFIED payment into the ONE fee ledger — with
    // the server receipt + gateway ids. The gateway confirmation makes
    // this Success automatically (never held for manual verification).
    const payMode = (MODE_FROM_FORM_ID[method] ?? 'UPI') as 'UPI' | 'Card' | 'Net Banking'
    const result = recordPayment({
      studentId,
      amount: v.amount,
      mode: payMode,
      feeHead: primaryHead,
      purpose: `Online fee payment via ${providerLabel} (${payMode})`,
      collectedBy: student.name,
      collectorRole: 'self',
      gateway: config?.provider === 'razorpay' ? 'razorpay' : 'razorpay',
      gatewayPaymentId: v.gatewayPaymentId,
      gatewayOrderId: confirmation.orderId,
      paymentSource: 'gateway',
      receiptNo: v.receiptNo,
    })
    if (result.success && result.transaction) {
      setMirroredTxn(result.transaction)
      setStage('success')
    } else {
      // Server verified the money; the local mirror hit a guard (e.g.
      // duplicate relay). Success is still the truth — surface the
      // server receipt.
      setMirroredTxn(null)
      setStage('success')
      if (result.error) toast.info('Already recorded', { description: result.error })
    }
    // 7-E — the server has verified this payment: let the Fees module
    // refetch the server-derived balance + receipt history.
    onPaymentSuccess?.()
  }

  const stageLabel: Record<PayStage, string> = {
    amount: 'Step 1 of 4 — Amount',
    review: 'Step 2 of 4 — Review',
    gateway: 'Step 3 of 4 — Gateway',
    verifying: 'Step 4 of 4 — Verifying',
    success: 'Payment complete',
    failed: 'Payment failed',
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-[calc(100vw-1.5rem)] sm:max-w-md" showCloseButton={stage !== 'gateway' && stage !== 'verifying'}>
        <DialogTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 text-white">
            <Wallet className="h-4 w-4" />
          </span>
          Pay School Fees
        </DialogTitle>
        <DialogDescription>{stageLabel[stage]}</DialogDescription>

        <AnimatePresence mode="wait">
          {/* ─── Stage 1: AMOUNT ─────────────────────────────────────── */}
          {stage === 'amount' && (
            <motion.div key="amount" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div>
                <label htmlFor="pay-amount" className="text-xs font-semibold text-foreground mb-2 block">
                  How much are you paying?
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <input
                    id="pay-amount"
                    inputMode="numeric"
                    autoComplete="off"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-3 text-lg font-bold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-describedby="pay-amount-help"
                  />
                </div>
                <p id="pay-amount-help" className={cn('mt-1.5 text-[11px]', amountValid || !amountInput ? 'text-muted-foreground' : 'text-rose-600 dark:text-rose-400')}>
                  {amountInput && !amountValid
                    ? amountNum < 1 ? 'Enter an amount of at least ₹1.' : `You can pay up to your balance of ${formatINR(balanceDue)}.`
                    : `Your current balance is ${formatINR(balanceDue)}.`}
                </p>
              </div>
              {balanceDue > 0 && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setAmountInput(String(balanceDue))}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
                      amountNum === balanceDue
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    Full balance · {formatINR(balanceDue)}
                  </button>
                </div>
              )}
              <div className="rounded-xl border border-border bg-muted/25 p-3 text-[11px] text-muted-foreground leading-relaxed">
                Paid to <span className="font-semibold text-foreground">{student.name}</span> · {student.className}-{student.section} ·
                receipt issued by the school on verification.
              </div>
              <Button className="w-full h-11" disabled={!amountValid} onClick={() => setStage('review')}>
                Continue <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
              </Button>
            </motion.div>
          )}

          {/* ─── Stage 2: REVIEW ─────────────────────────────────────── */}
          {stage === 'review' && (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-4">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">You will pay</p>
                <p className="font-display text-3xl font-extrabold tabular-nums mt-0.5">{formatINR(amountNum)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Applied to your fee account{balanceDue - amountNum > 0 ? ` · ${formatINR(balanceDue - amountNum)} will remain` : ' · clears your balance'}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Choose a payment method</p>
                <div className="grid grid-cols-1 gap-2">
                  {paymentMethods.map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setMethod(pm.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer',
                        method === pm.id
                          ? 'border-violet-500/50 bg-violet-500/[0.06] ring-1 ring-violet-500/30'
                          : 'border-border hover:bg-muted/40',
                      )}
                      aria-pressed={method === pm.id}
                    >
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white', pm.gradient)}>
                        {pm.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{pm.label}</span>
                          {pm.badge && (
                            <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:text-violet-400">{pm.badge}</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">{pm.desc}</span>
                      </span>
                      <span className={cn('h-4 w-4 shrink-0 rounded-full border-2', method === pm.id ? 'border-violet-600 bg-violet-600' : 'border-border')} aria-hidden />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Secured by {providerLabel}
                {isSandbox && ' · test mode'} · no additional charges · verified by the school server
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setStage('amount')}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Button>
                <Button
                  className="flex-[2] h-11 gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                  onClick={() => void confirmAndPay()}
                >
                  <Lock className="h-3.5 w-3.5" /> Confirm &amp; Pay
                </Button>
              </div>
            </motion.div>
          )}

          {/* ─── Stage 3: GATEWAY (checkout sheet) ───────────────────── */}
          {stage === 'gateway' && (
            <motion.div key="gateway" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="relative">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/25">
                    <Lock className="h-6 w-6" />
                  </span>
                  <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-violet-600 dark:text-violet-400" />
                </div>
                <p className="text-sm font-semibold">{providerLabel}</p>
                <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
                  {isSandbox
                    ? 'Sandbox gateway — test mode. Processing your payment…'
                    : 'Complete the payment in the secure gateway window.'}
                </p>
                <p className="font-display text-xl font-bold tabular-nums">{formatINR(amountNum)}</p>
              </div>
            </motion.div>
          )}

          {/* ─── Stage 4: VERIFYING (server signature check) ─────────── */}
          {stage === 'verifying' && (
            <motion.div key="verifying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6">
              <div className="flex flex-col items-center text-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-semibold">Verifying your payment…</p>
                <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
                  The school server is checking the gateway&apos;s signature before your receipt is issued.
                </p>
              </div>
            </motion.div>
          )}

          {/* ─── Stage 5: SUCCESS (server-verified receipt) ──────────── */}
          {stage === 'success' && verified && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex flex-col items-center text-center gap-2.5 py-2">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 14 }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/25"
                >
                  <CheckCircle2 className="h-7 w-7" />
                </motion.div>
                <h3 className="font-display text-lg font-bold">Payment successful</h3>
                <p className="font-display text-3xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatINR(verified.amount)}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] divide-y divide-emerald-500/15 text-xs">
                <ReceiptRow label="Official receipt" value={verified.receiptNo} mono />
                <ReceiptRow label="Gateway reference" value={verified.gatewayPaymentId} mono />
                <ReceiptRow label="Paid via" value={verified.method} />
                <ReceiptRow label="Status" value="Verified · Paid" tone="emerald" />
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                The school office has been notified. Your receipt is available immediately.
              </p>
              <div className="flex gap-2">
                {mirroredTxn && (
                  <Button
                    variant="outline"
                    className="flex-1 h-10 gap-2"
                    onClick={() => {
                      downloadReceiptA5(mirroredTxn, receiptSettings)
                      toast.success('Receipt downloaded', { description: `${mirroredTxn.receiptNo}.html` })
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> Receipt
                  </Button>
                )}
                <Button className="flex-1 h-10" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </motion.div>
          )}

          {/* ─── Stage F: FAILED (honest error) ───────────────────────── */}
          {stage === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex flex-col items-center text-center gap-2.5 py-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/25">
                  <XCircle className="h-6 w-6" />
                </span>
                <h3 className="font-display text-lg font-bold">Payment not completed</h3>
                <p className="text-xs text-muted-foreground max-w-[18rem] leading-relaxed">
                  {error ?? 'Something went wrong. No money has been recorded — you can safely retry.'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-10" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button className="flex-1 h-10" onClick={() => setStage('review')}>
                  Try again
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

function ReceiptRow({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'emerald' }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        'font-semibold',
        mono && 'font-mono tabular-nums',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
      )}>
        {value}
      </span>
    </div>
  )
}
