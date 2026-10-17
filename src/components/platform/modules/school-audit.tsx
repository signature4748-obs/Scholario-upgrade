'use client'

// ============================================================
// SchoolAuditTab — school workspace · Audit History tab
// ------------------------------------------------------------
// The school-scoped platform audit trail (mission §9): every audited
// platform action that targeted THIS tenant — actor, action, reason,
// metadata, timestamp — with action-prefix and free-text filters.
//
// Sensitive values (passwords, gateway secrets, plaintext activation
// codes, session tokens) are never present in audit metadata (they
// are redacted at write time — verified by the audit.test suite).
//
// Data: GET /api/platform/audit?schoolId= (permission audit.read).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ScrollText,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AuditEvent {
  id: string
  at: string
  action: string
  admin: { id: string; name: string } | null
  targetType: string | null
  targetId: string | null
  schoolId: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
}

interface AuditData {
  total: number
  page: number
  pageSize: number
  events: AuditEvent[]
}

/** Common action-prefix families for the quick filter. */
const ACTION_FAMILIES = [
  { value: 'ALL', label: 'All actions' },
  { value: 'platform.school.', label: 'School lifecycle' },
  { value: 'platform.billing.', label: 'Billing & codes' },
  { value: 'platform.support_session.', label: 'Support sessions' },
  { value: 'platform.school_session.', label: 'User session revokes' },
  { value: 'platform.domain.', label: 'Domains' },
  { value: 'platform.profile_change.', label: 'Identity changes' },
] as const

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Renders audit metadata as safe key/value chips (already redacted server-side). */
function MetadataChips({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null
  const entries = Object.entries(metadata).filter(([, v]) => v != null).slice(0, 8)
  if (entries.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[10px] text-slate-500"
          title={`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`}
        >
          {k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </div>
  )
}

export function SchoolAuditTab({ schoolId }: { schoolId: string }) {
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [action, setAction] = useState<string>('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounced search (~300ms) → resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('schoolId', schoolId)
      if (q) params.set('q', q)
      if (action !== 'ALL') params.set('action', action)
      params.set('page', String(page))
      const res = await platformApi<AuditData>(`/api/platform/audit?${params.toString()}`)
      setData(res)
    } catch (e) {
      const pae = e as PlatformApiError
      setError(pae.error || 'Failed to load audit trail')
    } finally {
      setLoading(false)
    }
  }, [schoolId, q, action, page])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4" aria-label="School audit history">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search action or reason…"
            aria-label="Search audit events"
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11 pl-9"
          />
        </div>
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="Filter by action family" className="h-11 w-full sm:w-48 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-900">
            {ACTION_FAMILIES.map((f) => (
              <SelectItem key={f.value} value={f.value} className="focus:bg-slate-100">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh audit trail"
            className="h-11 w-11 border-slate-200 bg-white text-slate-600 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()} className="mt-3 h-9 border-slate-300 bg-white text-slate-700">
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Trail */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading || !data ? (
          <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading audit trail">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-slate-200" />
            ))}
          </div>
        ) : data.events.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <ScrollText className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900">No audit events match</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              {q || action !== 'ALL'
                ? 'Nothing matches the current search and filters — try clearing them.'
                : 'No platform actions targeting this school have been audited yet.'}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100" aria-label="Audit events">
              {data.events.map((e) => (
                <li key={e.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 font-mono text-[10px] text-slate-700">
                      {e.action}
                    </Badge>
                    <span className="text-xs text-slate-500">{fmtDateTime(e.at)}</span>
                    {e.admin && (
                      <span className="text-xs text-slate-600">
                        by <span className="font-medium text-slate-800">{e.admin.name}</span>
                      </span>
                    )}
                    {e.ip && <span className="font-mono text-[10px] text-slate-400">{e.ip}</span>}
                  </div>
                  {e.reason && <p className="mt-1 text-xs text-slate-600">reason: {e.reason}</p>}
                  <MetadataChips metadata={e.metadata} />
                </li>
              ))}
            </ul>
            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {data.page} of {totalPages} · {data.total} event{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                >
                  <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100"
                >
                  Next
                  <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Sensitive values (passwords, gateway secrets, plaintext activation codes, session tokens) are redacted at
        write time — they never appear in this trail.
      </p>
    </div>
  )
}
