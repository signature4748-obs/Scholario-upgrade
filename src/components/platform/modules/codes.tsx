'use client'

// ============================================================
// AccessCodesModule — /platform/codes (PAYMENTS & GATEWAYS REDESIGN)
// ------------------------------------------------------------
// The GLOBAL activation-code registry — code issuance and redemption
// management across every school:
//   · filters: school, scope (student / staff / everything), status,
//     publicRef / plan search — all served server-side;
//   · batch issuance: pick a school first, then the SAME shared
//     BatchCodesDialog the school Codes tab uses (one flow, one audit
//     trail, one one-time-display contract);
//   · revoke / reissue via the shared audited dialog (reissue shows the
//     fresh plaintext exactly once);
//   · failed-claim diagnostics (the redemption security story).
//
// NEVER shows plaintext after issuance — only publicRef + status. The
// registry is billing.manage-gated server-side; this UI never trusts
// client-side gating.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, KeyRound, RefreshCw, Search, ShieldAlert,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import {
  codeScopeLabel, dateStr, type ActivationCodeRow,
} from './subscription-shared'
import { BatchCodesDialog } from './subscription-batch-codes'
import { RevokeReissueDialog } from './subscription-code-actions'
import { SubscriptionPendingBanner, isSubscriptionSchemaPending } from './pending-banner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface CodeRow extends ActivationCodeRow {
  events?: Array<{ type: string; detail?: unknown; createdAt: string }>
}

interface CodesWire {
  subscriptionSchemaPending?: boolean
  codes: CodeRow[]
  total: number
  page: number
  pageSize: number
  diagnostics: Array<{ publicRef: string; scope: string; codeStatus: string; reason: unknown; at: string }>
}

interface SchoolOption { id: string; name: string }

const STATUS_OPTIONS = ['ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED', 'REPLACED'] as const
const SCOPE_OPTIONS = [
  { value: 'STUDENT_ENTITLEMENT', label: 'Student access' },
  { value: 'STAFF_ENTITLEMENT', label: 'Teacher / staff seats' },
  { value: 'SCHOOL_SUBSCRIPTION', label: 'School subscription' },
] as const

const CODE_STATUS_STYLES: Record<string, string> = {
  ISSUED: 'border-sky-200 bg-sky-50 text-sky-700',
  CLAIMED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  EXPIRED: 'border-slate-200 bg-slate-100 text-slate-500',
  REVOKED: 'border-red-200 bg-red-50 text-red-600',
  REPLACED: 'border-amber-200 bg-amber-50 text-amber-700',
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Request failed'
}

/** Pick a school, then the shared BatchCodesDialog opens for it. */
function BatchSchoolPickerDialog({
  schools, onClose, onPicked,
}: {
  schools: SchoolOption[]
  onClose: () => void
  onPicked: (school: SchoolOption) => void
}) {
  const [picked, setPicked] = useState<SchoolOption | null>(null)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-teal-600" aria-hidden="true" />Generate activation codes
          </DialogTitle>
          <DialogDescription>
            Every code binds to ONE school. Pick the school this batch belongs to — the codes can only ever be
            redeemed inside it, by their scope.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="batch-school" className="text-xs font-semibold text-slate-700">School</Label>
            <Select value={picked?.id ?? ''} onValueChange={(v) => setPicked(schools.find((s) => s.id === v) ?? null)}>
              <SelectTrigger id="batch-school" className="h-10 border-slate-300 bg-white"><SelectValue placeholder="Select a school…" /></SelectTrigger>
              <SelectContent className="max-h-72 bg-white">
                {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} className="border-slate-300 bg-white text-slate-700">Cancel</Button>
            <Button
              disabled={!picked}
              onClick={() => { if (picked) onPicked(picked) }}
              className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
            >
              <Check className="h-4 w-4" aria-hidden="true" />Continue
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AccessCodesModule() {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [data, setData] = useState<CodesWire | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [scopeFilter, setScopeFilter] = useState('ALL')
  const [schoolId, setSchoolId] = useState('ALL')
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [page, setPage] = useState(1)

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSchool, setBatchSchool] = useState<SchoolOption | null>(null)
  const [act, setAct] = useState<{ code: CodeRow; action: 'revoke' | 'reissue' } | null>(null)

  const load = useCallback(async (pageNo: number) => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (query.trim()) p.set('q', query.trim())
      if (statusFilter !== 'ALL') p.set('status', statusFilter)
      if (scopeFilter !== 'ALL') p.set('scope', scopeFilter)
      if (schoolId !== 'ALL') p.set('schoolId', schoolId)
      p.set('page', String(pageNo))
      p.set('pageSize', '50')
      const d = await platformApi<CodesWire>(`/api/platform/subscriptions/codes?${p.toString()}`)
      setData(d)
      setPending(isSubscriptionSchemaPending(d))
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [query, statusFilter, scopeFilter, schoolId])

  useEffect(() => { void load(1) }, [load])

  useEffect(() => {
    platformApi<{ schools: Array<{ id: string; name: string }> }>('/api/platform/schools?pageSize=200')
      .then((d) => setSchools(d.schools))
      .catch(() => setSchools([]))
  }, [])

  const applyFilters = () => { setPage(1); void load(1) }
  const changeFilter = (fn: () => void) => { fn(); setPage(1); setTimeout(() => void load(1), 0) }

  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 50
  const totalPages = data ? Math.max(1, Math.ceil(total / pageSize)) : 1

  return (
    <div className="space-y-5">
      {stepUpNode}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Access Codes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Issuance and redemption across every school. Plaintext is shown once at issuance — afterwards only a keyed verifier exists.
          </p>
        </div>
        <Button
          size="sm" onClick={() => setBatchOpen(true)} disabled={pending}
          title={pending ? 'The code system is provisioned by the pending subscription-system migration.' : undefined}
          className="bg-teal-600 font-semibold text-white hover:bg-teal-700"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />Generate batch…
        </Button>
      </div>

      {pending && <SubscriptionPendingBanner />}

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Could not load the code registry: {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load(page)} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </Button>
        </div>
      )}

      {/* Filters */}
      {!error && (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search codes by public reference or plan code"
              placeholder="Search public ref / plan code…"
              className="h-10 border-slate-300 bg-white pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters() }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-auto">
            <Select value={schoolId} onValueChange={(v) => changeFilter(() => setSchoolId(v))}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by school"><SelectValue placeholder="School" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ALL">All schools</SelectItem>
                {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={(v) => changeFilter(() => setScopeFilter(v))}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by scope"><SelectValue placeholder="Scope" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All scopes</SelectItem>
                {SCOPE_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => changeFilter(() => setStatusFilter(v))}>
              <SelectTrigger className="h-10 border-slate-300 bg-white" aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Registry table */}
      {loading && !data ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full bg-slate-200" />)}
          </div>
        </div>
      ) : !error && data && (
        <>
          <p className="text-xs text-slate-500" aria-live="polite">Showing {data.codes.length} of {total} codes</p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] text-sm">
              <caption className="sr-only">Activation codes across all schools with scope, plan, validity, status and actions</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Code</th>
                  <th scope="col" className="px-3 py-2.5">School</th>
                  <th scope="col" className="px-3 py-2.5">Unlocks</th>
                  <th scope="col" className="px-3 py-2.5">Plan</th>
                  <th scope="col" className="px-3 py-2.5">Validity</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.codes.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-xs font-medium text-slate-900">{c.publicRef}</p>
                      <p className="text-[11px] text-slate-400">issued {dateStr(c.issuedAt)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{c.school?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {codeScopeLabel(c.scope)}
                      {c.student && <p className="text-[11px] text-slate-400">{c.student.user?.name ?? c.student.user?.email}</p>}
                      {c.scope === 'STAFF_ENTITLEMENT' && c.assignedUser && (
                        <p className="text-[11px] text-slate-400">{c.assignedUser.name ?? c.assignedUser.email}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {c.planCode ?? '—'}
                      {c.interval && <p className="text-[11px] text-slate-400">{c.interval.toLowerCase()}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600 tabular-nums">
                      {c.validityMonths ? `${c.validityMonths}mo` : '—'}
                      {c.claimWindowDays && <p className="text-[11px] text-slate-400">redeem within {c.claimWindowDays}d</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[11px] ${CODE_STATUS_STYLES[c.status] ?? ''}`}>{c.status}</Badge>
                      {c.status === 'CLAIMED' && c.claimedAt && (
                        <p className="mt-0.5 text-[11px] text-slate-400">{dateStr(c.claimedAt)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {c.status === 'ISSUED' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="border-slate-300 text-slate-700" onClick={() => setAct({ code: c, action: 'reissue' })}>Reissue</Button>
                          <Button size="sm" variant="outline" className="border-red-200 bg-red-50 text-red-600 hover:bg-red-100" onClick={() => setAct({ code: c, action: 'revoke' })}>Revoke</Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {c.status === 'REPLACED' && c.replacedBy ? `replaced by ${c.replacedBy.publicRef}` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.codes.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                      {pending
                        ? 'The code system is not provisioned on this database yet.'
                        : 'No codes match the current filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Failed-claim diagnostics — the redemption security story */}
          {data.diagnostics.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-labelledby="claim-diag-heading">
              <h2 id="claim-diag-heading" className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />Rejected redemption attempts (latest {data.diagnostics.length})
              </h2>
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {data.diagnostics.slice(0, 8).map((d, i) => (
                  <li key={`${d.publicRef}-${d.at}-${i}`} className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono">{d.publicRef}</span>
                    <span>· {d.scope.toLowerCase().replace(/_/g, ' ')}</span>
                    <span>· {String(d.reason ?? 'rejected')}</span>
                    <span className="text-amber-600">· {dateStr(d.at)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-amber-700">
                Wrong-school, wrong-scope, expired, revoked and replay attempts are rejected atomically and recorded here.
              </p>
            </section>
          )}

          {/* Pager */}
          {total > 0 && (
            <nav aria-label="Code registry pages" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs tabular-nums text-slate-500">Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => { const n = Math.max(1, page - 1); setPage(n); void load(n) }} className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring">← Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => { const n = page + 1; setPage(n); void load(n) }} className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring">Next →</Button>
              </div>
            </nav>
          )}
        </>
      )}

      {/* Batch issuance — school FIRST, then the shared dialog */}
      {batchOpen && !batchSchool && (
        <BatchSchoolPickerDialog
          schools={schools}
          onClose={() => setBatchOpen(false)}
          onPicked={(school) => { setBatchOpen(false); setBatchSchool(school) }}
        />
      )}
      {batchSchool && (
        <BatchCodesDialog
          schoolId={batchSchool.id}
          gate={gate}
          onClose={() => setBatchSchool(null)}
          onDone={() => void load(page)}
        />
      )}

      {act && (
        <RevokeReissueDialog
          code={act.code as ActivationCodeRow}
          action={act.action}
          onClose={() => setAct(null)}
          onDone={() => void load(page)}
          gate={gate}
        />
      )}
    </div>
  )
}
