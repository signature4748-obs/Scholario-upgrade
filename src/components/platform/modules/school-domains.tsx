'use client'

/**
 * PHASE 8B (§10/§25) — platform console · school detail · Custom Domains tab.
 *
 * Lists the school's TenantDomain mappings (PENDING/VERIFIED), adds new
 * hostnames (normalized + validated server-side; duplicates 409), runs
 * DNS verification (ownership TXT + routing records), and removes
 * mappings. Step-up-gated mutations use the console's gate() convention.
 * A "DNS instructions" expander shows the exact records a school must
 * create (the verification token IS the school's proof-of-ownership
 * secret — the platform console may show it).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Globe, Plus, RefreshCw, ShieldCheck, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'

interface DomainRow {
  id: string
  hostname: string
  isPrimary: boolean
  status: string
  lastCheckedAt: string | null
  lastCheckResult: string | null
  createdAt: string
  verifiedAt: string | null
}

interface DomainsResponse {
  domains: DomainRow[]
}

interface VerifyResponse {
  domain: { id: string; hostname: string; status: string; lastCheckResult?: string | null }
  ownershipProven?: boolean
  routingConfigured?: boolean
  summary?: string
  alreadyVerified?: boolean
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

export function SchoolDomainsTab({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newHostname, setNewHostname] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null)
  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({})
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await platformApi<DomainsResponse>(`/api/platform/schools/${schoolId}/domains`)
      setDomains(res.domains)
    } catch (e) {
      setLoadError(errText(e))
    }
  }, [schoolId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    setAddBusy(true)
    setAddError(null)
    try {
      const res = await gate(() =>
        platformApi<{ domain: DomainRow }>(`/api/platform/schools/${schoolId}/domains`, {
          method: 'POST',
          body: JSON.stringify({ hostname: newHostname.trim() }),
        }),
      )
      if (res) {
        setNewHostname('')
        await load()
      }
    } catch (e) {
      setAddError(errText(e))
    } finally {
      setAddBusy(false)
    }
  }

  const verify = async (domain: DomainRow) => {
    setVerifyBusy(domain.id)
    try {
      const res = await platformApi<VerifyResponse>(
        `/api/platform/schools/${schoolId}/domains/${domain.id}/verify`,
        { method: 'POST' },
      )
      setVerifyMsg((m) => ({
        ...m,
        [domain.id]: res.summary ?? (res.alreadyVerified ? 'Already verified' : 'Checked'),
      }))
      await load()
    } catch (e) {
      setVerifyMsg((m) => ({ ...m, [domain.id]: errText(e) }))
    } finally {
      setVerifyBusy(null)
    }
  }

  const remove = async (domain: DomainRow) => {
    if (!window.confirm(`Remove the domain mapping ${domain.hostname}? Traffic on it stops resolving this school.`)) return
    setDeleteBusy(domain.id)
    try {
      await gate(() =>
        platformApi(`/api/platform/schools/${schoolId}/domains/${domain.id}`, { method: 'DELETE' }),
      )
      await load()
    } catch (e) {
      setVerifyMsg((m) => ({ ...m, [domain.id]: errText(e) }))
    } finally {
      setDeleteBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {stepUpNode}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
            <Globe className="h-4 w-4 text-teal-600" aria-hidden="true" />
            Custom domains
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Verified hostnames resolve this school on the public website and login portal. One
            hostname maps to exactly one school — enforced at the storage layer.
          </p>
        </div>

        <div className="p-4 sm:px-5 space-y-4">
          {canManage && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newHostname}
                onChange={(e) => setNewHostname(e.target.value)}
                placeholder="school-a.com"
                aria-label="New hostname"
                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newHostname.trim().length >= 4 && !addBusy) void add()
                }}
              />
              <Button
                onClick={() => void add()}
                disabled={addBusy || newHostname.trim().length < 4}
                className="bg-teal-600 hover:bg-teal-700 text-white min-h-[36px]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {addBusy ? 'Adding…' : 'Add domain'}
              </Button>
            </div>
          )}
          {addError && (
            <p className="text-xs text-red-600 flex items-start gap-1.5" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              {addError}
            </p>
          )}

          {domains === null && loadError === null && (
            <div className="space-y-2" aria-label="Loading domains">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {loadError && (
            <p className="text-xs text-red-600" role="alert">
              {loadError}
            </p>
          )}
          {domains !== null && domains.length === 0 && (
            <p className="text-xs text-slate-500 py-2">
              No custom domains yet. The school can also request one from its own settings
              (Identity → Custom domain).
            </p>
          )}

          <ul className="divide-y divide-slate-200" aria-label="Domain list">
            {domains?.map((d) => (
              <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-mono text-sm text-slate-700 break-all">{d.hostname}</span>
                  {d.isPrimary && (
                    <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                      primary
                    </span>
                  )}
                  <span
                    className={
                      d.status === 'VERIFIED'
                        ? 'inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
                        : 'inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700'
                    }
                  >
                    {d.status === 'VERIFIED' ? (
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    )}
                    {d.status}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void verify(d)}
                      disabled={verifyBusy === d.id || d.status === 'VERIFIED'}
                      className="h-8 border-slate-300 text-slate-700 hover:text-slate-900 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      {verifyBusy === d.id ? 'Checking…' : d.status === 'VERIFIED' ? 'Verified' : 'Verify DNS'}
                    </Button>
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void remove(d)}
                        disabled={deleteBusy === d.id}
                        className="h-8 border-red-200 text-red-600 hover:text-red-700 hover:bg-red-50"
                        aria-label={`Remove ${d.hostname}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                </div>

                {verifyMsg[d.id] && (
                  <p
                    className={
                      'mt-2 text-xs ' +
                      (verifyMsg[d.id].startsWith('Pending') ? 'text-amber-700' : 'text-slate-600')
                    }
                  >
                    {verifyMsg[d.id]}
                  </p>
                )}
                {d.lastCheckResult && d.status !== 'VERIFIED' && (
                  <p className="mt-1.5 text-xs text-slate-500">{d.lastCheckResult}</p>
                )}
                {d.status !== 'VERIFIED' && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                      className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
                    >
                      {expanded === d.id ? 'Hide DNS instructions' : 'Show DNS instructions'}
                    </button>
                    {expanded === d.id && <DnsInstructions hostname={d.hostname} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** The records a school must create (public knowledge — the token itself
 *  lives in the school-plane instructions; the platform sees it too). */
function DnsInstructions({ hostname }: { hostname: string }) {
  const isApex = hostname.split('.').length <= 2
  const records = [
    { type: 'TXT', name: `_scholario-verify.${hostname}`, value: '(shown to the school in its settings — proof-of-ownership token)' },
    isApex
      ? { type: 'A', name: hostname, value: '76.76.21.21' }
      : { type: 'CNAME', name: hostname, value: 'cname.vercel-dns.com' },
  ]
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {records.map((r) => (
        <div key={r.type + r.name} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <span className="font-mono font-semibold text-teal-700">{r.type}</span>
          <span className="font-mono text-slate-700 break-all">{r.name}</span>
          <span className="sr-only">value</span>
          <span className="font-mono text-slate-600 break-all">{r.value}</span>
        </div>
      ))}
      <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
        After the school creates these records, run Verify DNS. The platform must also attach the
        domain to the deployment (Vercel) — see docs/CUSTOM_DOMAINS.md.
      </p>
    </div>
  )
}
