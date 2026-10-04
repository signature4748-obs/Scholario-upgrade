'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CreditCard, LifeBuoy, LogOut, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUser, type MeUser, type EntitlementInfo } from '@/lib/store/current-user-store'
import { useAuth } from '@/lib/store/auth-store'

/**
 * EntitlementLockScreen — SaaS-HARDENING (§2).
 *
 * Rendered INSTEAD of the role panels when the server identity reports a
 * RESTRICTED or SUSPENDED tenant entitlement (or a LOCKED account). The
 * user is AUTHENTICATED — sign-in never depends on the subscription —
 * and this screen gives them everything the model promises:
 *
 *   · the prominent renewal message ("Your SCHOLARIO subscription needs
 *     renewal." — the exact server-evaluated state, never a guess)
 *   · subscription STATUS (state, plan, period end, grace window, recent
 *     payments — GET /api/subscription, an exempt endpoint)
 *   · Renew Subscription (principal/management: POST /api/subscription
 *     records the audited renewal request)
 *   · Contact SCHOLARIO (support form → POST /api/support, exempt)
 *   · Sign out
 *
 * This screen is a UX COURTESY only — withUser enforces the business
 * lock server-side on every module API regardless of what the client
 * renders. Restricted tenants cannot bypass it by calling APIs.
 */

const ROLE_LABELS: Record<string, string> = {
  PRINCIPAL: 'Principal',
  MANAGEMENT: 'School Office',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  PARENT: 'Parent',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface SubscriptionStatus {
  entitlement: EntitlementInfo
  recentPayments: Array<{
    receiptNo: string | null
    amount: number
    currency: string
    mode: string
    paymentDate: string
    periodMonths: number
    statusAfter: string | null
    periodEndAfter: string | null
  }>
}

const MODE_LABELS: Record<string, string> = {
  ONLINE_PAYMENT: 'Online payment',
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
}

export function EntitlementLockScreen({ user, entitlement }: { user: MeUser; entitlement: EntitlementInfo }) {
  const logout = useAuth((s) => s.logout)
  const clear = useCurrentUser((s) => s.clear)
  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [renewState, setRenewState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportMessage, setSupportMessage] = useState('')
  const [supportState, setSupportState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const isPrincipal = user.role === 'PRINCIPAL' || user.role === 'MANAGEMENT'
  const suspended = entitlement.state === 'SUSPENDED'

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const r = await fetch('/api/subscription', { cache: 'no-store' })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: SubscriptionStatus } | null
      if (j?.ok && j.data) setStatus(j.data)
    } catch {
      /* status stays null — honest "unavailable" */
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'Subscription Required — Scholario'
    void loadStatus()
  }, [loadStatus])

  const handleSignOut = () => {
    void fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => {})
    logout()
    clear()
    if (typeof window !== 'undefined') window.location.reload()
  }

  const handleRenewRequest = async () => {
    if (!isPrincipal || renewState === 'sending') return
    setRenewState('sending')
    try {
      await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-store',
      })
      setRenewState('sent')
    } catch {
      setRenewState('idle')
    }
  }

  const handleSupport = async () => {
    if (supportMessage.trim().length < 10 || supportState === 'sending') return
    setSupportState('sending')
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'subscription', message: supportMessage.trim() }),
        cache: 'no-store',
      })
      if (r.ok) setSupportState('sent')
      else setSupportState('idle')
    } catch {
      setSupportState('idle')
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex items-start sm:items-center justify-center p-4 sm:p-6 py-8">
        <div className="w-full max-w-lg space-y-4">
          {/* Identity — the authenticated user (sign-in worked) */}
          <Card className="border-border/80">
            <CardContent className="p-4 sm:p-5 flex items-center gap-4">
              <div
                aria-hidden
                className="h-12 w-12 rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 flex items-center justify-center text-base font-bold shrink-0"
              >
                {initials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-foreground">{user.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {ROLE_LABELS[user.role] ?? user.role}
                  {user.school?.name ? ` · ${user.school.name}` : ''}
                </p>
              </div>
              <Badge variant={suspended ? 'destructive' : 'secondary'} className="ml-auto shrink-0 gap-1">
                {suspended ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {suspended ? 'Suspended' : 'Locked'}
              </Badge>
            </CardContent>
          </Card>

          {/* The prominent renewal message — server truth */}
          <Card className={`border ${suspended ? 'border-destructive/40' : 'border-amber-300/70'} shadow-lg`}>
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div
                role="alert"
                className={`rounded-xl border p-4 space-y-1 ${
                  suspended
                    ? 'border-destructive/30 bg-destructive/5'
                    : 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/60'
                }`}
              >
                <p
                  className={`text-sm font-black uppercase tracking-wider ${
                    suspended ? 'text-destructive' : 'text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {suspended ? 'Subscription Suspended' : 'Subscription Needs Renewal'}
                </p>
                <p className={`text-sm ${suspended ? 'text-destructive/90' : 'text-amber-900/90 dark:text-amber-200/90'}`}>
                  {entitlement.message ??
                    'Your SCHOLARIO subscription needs renewal. Business modules are locked until the subscription is renewed.'}
                </p>
              </div>

              {/* Subscription status (exempt endpoint — always reachable) */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Subscription status
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => void loadStatus()} disabled={statusLoading} aria-label="Refresh subscription status">
                    <RefreshCw className={`h-3.5 w-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                {status ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">State</span>
                      <span className="font-semibold">{status.entitlement.state}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Plan</span>
                      <span className="font-semibold">{status.entitlement.plan}</span>
                    </div>
                    {formatDate(status.entitlement.periodEnd) && (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Paid until</span>
                        <span className="font-semibold">{formatDate(status.entitlement.periodEnd)}</span>
                      </div>
                    )}
                    {status.entitlement.state === 'GRACE' && formatDate(status.entitlement.graceUntil) && (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Grace ends</span>
                        <span className="font-semibold">{formatDate(status.entitlement.graceUntil)}</span>
                      </div>
                    )}
                    {status.recentPayments.length > 0 && (
                      <div className="pt-2 border-t border-border/60 space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground pt-1">
                          Recent payments
                        </p>
                        {status.recentPayments.slice(0, 3).map((p, i) => (
                          <div key={i} className="flex justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              {formatDate(p.paymentDate)} · {MODE_LABELS[p.mode] ?? p.mode}
                            </span>
                            <span className="font-medium">
                              {p.currency === 'INR' ? '₹' : `${p.currency} `}
                              {p.amount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : statusLoading ? (
                  <p className="text-sm text-muted-foreground">Loading subscription status…</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Subscription status is temporarily unavailable. Your sign-in and account remain active.
                  </p>
                )}
              </div>

              {/* CTAs */}
              <div className="space-y-2">
                {isPrincipal ? (
                  renewState === 'sent' ? (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm p-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>Renewal request recorded. The SCHOLARIO team will contact your school.</span>
                    </div>
                  ) : (
                    <Button className="w-full gap-2" onClick={() => void handleRenewRequest()} disabled={renewState === 'sending'}>
                      <CreditCard className="h-4 w-4" />
                      {renewState === 'sending' ? 'Sending request…' : 'Renew Subscription'}
                    </Button>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground text-center">
                    Your principal or school office manages the SCHOLARIO subscription renewal.
                  </p>
                )}

                {supportOpen ? (
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    {supportState === 'sent' ? (
                      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-sm p-1">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span>Message recorded for the SCHOLARIO platform team.</span>
                      </div>
                    ) : (
                      <>
                        <Textarea
                          value={supportMessage}
                          onChange={(e) => setSupportMessage(e.target.value)}
                          placeholder="Describe your issue (minimum 10 characters)…"
                          rows={3}
                          maxLength={2000}
                          aria-label="Support message"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setSupportOpen(false)}>
                            Close
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void handleSupport()}
                            disabled={supportState === 'sending' || supportMessage.trim().length < 10}
                          >
                            <LifeBuoy className="h-3.5 w-3.5 mr-1.5" />
                            {supportState === 'sending' ? 'Sending…' : 'Send to SCHOLARIO'}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" className="w-full gap-2" onClick={() => setSupportOpen(true)}>
                    <LifeBuoy className="h-4 w-4" />
                    Contact SCHOLARIO
                  </Button>
                )}

                <Button variant="ghost" className="w-full gap-2" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="mt-auto py-4 text-center text-xs text-muted-foreground">
        {user.school?.name ?? 'Scholario'} · Session {user.school?.academicYear ?? ''}
      </footer>
    </div>
  )
}

/**
 * EntitlementBanner — the PERSISTENT renewal warning for GRACE (business
 * stays available; the school must see the warning everywhere).
 */
export function EntitlementBanner({ entitlement }: { entitlement: EntitlementInfo }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !entitlement.renewalRequired || entitlement.businessAllowed === false) return null
  return (
    <div
      role="status"
      className="w-full border-b border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/60 px-4 py-2 flex items-center justify-between gap-3"
    >
      <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">
          {entitlement.message ?? 'Your SCHOLARIO subscription needs renewal.'}
        </span>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-xs font-medium text-amber-800 dark:text-amber-300 hover:underline shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
