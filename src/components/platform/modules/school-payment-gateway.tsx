'use client'

/**
 * PAYMENTS & GATEWAYS REDESIGN — School detail · Subscription group ·
 * Fee gateway card.
 *
 * READ-ONLY STATUS + CENTRAL LINK. The full configuration form no longer
 * lives on every school's Subscription page (Phase 8: "Do not put the
 * entire gateway configuration form inside every school's Subscription
 * page"). It lives in the central Payments & Gateways section
 * (/platform/payments) — this card shows the school's INHERITED vs
 * OVERRIDE state, checkout readiness and the link to configure.
 *
 * The school's OWN student-fee gateway account (Razorpay) — tenant-scoped,
 * platform-managed billing infrastructure. B-domain (school collects fees
 * from parents); completely disjoint from the subscription ledger (A-domain
 * — school pays SCHOLARIO). Secrets are write-only: the API never returns
 * them, so nothing here ever displays a secret.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, CreditCard, Landmark, RefreshCw, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface GatewayView {
  schoolId: string
  provider: string
  publicKeyId: string | null
  mode: 'live' | 'test' | 'sandbox' | null
  status: string
  lastVerifiedAt?: string | null
  webhookSecretConfigured?: boolean
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  DISABLED: 'border-slate-200 bg-slate-100 text-slate-500',
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

export function SchoolPaymentGatewayTab({ schoolId }: { schoolId: string }) {
  const router = useRouter()
  const [gateway, setGateway] = useState<GatewayView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await platformApi<{ gateway: GatewayView | null }>(
        `/api/platform/schools/${schoolId}/payment-gateway`,
      )
      setGateway(res.gateway)
      setLoaded(true)
    } catch (e) {
      setLoadError(errText(e))
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            {loadError}
          </p>
          <Button
            variant="outline" size="sm" onClick={() => void load()}
            className="h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {!loaded && loadError === null && (
        <Skeleton className="h-40 w-full rounded-xl bg-slate-100" aria-label="Loading fee gateway status" />
      )}

      {loaded && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                <Landmark className="h-4 w-4 text-teal-600" aria-hidden="true" />
                Fee payment gateway (student fees)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                The school&apos;s own student-fee rail — separate money, separate credentials from SCHOLARIO subscriptions.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => router.push(`/platform/payments?school=${schoolId}`)}
              className="h-10 shrink-0 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              Configure in Payments &amp; Gateways
            </Button>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-4 sm:px-5">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Configuration</dt>
              <dd className="mt-1 text-sm text-slate-700">
                {gateway && gateway.status !== 'DISABLED' ? (
                  <span className="font-medium">School-specific override</span>
                ) : gateway ? (
                  <span className="font-medium">Override disabled — inherited</span>
                ) : (
                  <span className="font-medium">Inherited — platform default</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Provider &amp; mode</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm capitalize text-slate-700">
                <CreditCard className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {gateway?.publicKeyId ? (
                  <>
                    {gateway.provider}
                    {gateway.mode === 'test' && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 normal-case">test keys</Badge>}
                    {gateway.mode === 'live' && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 normal-case">live keys</Badge>}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</dt>
              <dd className="mt-1">
                {gateway ? (
                  <Badge variant="outline" className={`normal-case ${STATUS_STYLES[gateway.status] ?? STATUS_STYLES.DISABLED}`}>{gateway.status}</Badge>
                ) : (
                  <span className="text-sm text-slate-500">Not configured</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checkout readiness</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                <ShieldCheck className={`h-4 w-4 ${gateway?.status === 'ACTIVE' ? 'text-emerald-600' : 'text-slate-300'}`} aria-hidden="true" />
                {gateway?.status === 'ACTIVE'
                  ? 'Student-fee checkout runs on this account'
                  : 'Falls back to the platform default gateway (if configured)'}
              </dd>
              {gateway?.lastVerifiedAt && (
                <p className="mt-0.5 text-[11px] text-slate-400">Credentials verified {new Date(gateway.lastVerifiedAt).toLocaleDateString('en-IN')}</p>
              )}
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}
