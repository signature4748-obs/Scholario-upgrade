'use client'

// ============================================================
// Platform Operations — Errors & Incidents tab
// ------------------------------------------------------------
// Error groups (fingerprinted) with filters, pagination, occurrence
// drill-down, ack/resolve actions, related audit rows, and the
// rule-based root-cause diagnosis (confirmed / likely /
// insufficient-evidence — each with its evidence + next step).
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ClipboardCopy, Filter, Search, ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../../platform-client'
import {
  OPS_CARD,
  OpsEmptyState,
  OpsErrorState,
  SeverityBadge,
  StateBadge,
  formatNumber,
  severityRank,
  timeAgo,
} from './shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } } as const

interface ErrorGroup {
  id: string
  fingerprint: string
  category: string
  severity: string
  status: string
  env: string
  message: string
  lastRoute: string | null
  lastMethod: string | null
  lastStatusCode: number | null
  provider: string | null
  schoolId: string | null
  schoolName: string | null
  requestId: string | null
  firstSeenAt: string
  lastSeenAt: string
  occurrences: number
}

interface ErrorListData {
  groups: ErrorGroup[]
  total: number
  nextCursor: string | null
}

interface Diagnosis {
  rule: string
  title: string
  status: 'confirmed' | 'likely' | 'insufficient-evidence'
  evidence: string[]
  nextStep: string
}

interface ErrorDetailData {
  group: ErrorGroup & {
    resolutionNote: string | null
    acknowledgedBy: string | null
    acknowledgedAt: string | null
    resolvedBy: string | null
    resolvedAt: string | null
  }
  events: Array<{
    id: string
    occurredAt: string
    route: string | null
    statusCode: number | null
    requestId: string | null
    brief: string | null
  }>
  relatedAudit: Array<{ id: string; action: string; at: string; schoolId: string | null }>
  emailEvidence: { statusCounts: Record<string, number>; failureClasses: Record<string, number>; domainsTotal: number; domainsVerified: number }
  diagnoses: Diagnosis[]
  report: string
}

function DiagnosisStatusBadge({ status }: { status: Diagnosis['status'] }) {
  const cls =
    status === 'confirmed'
      ? 'border-red-200 bg-red-50 text-red-700'
      : status === 'likely'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>{status}</span>
  )
}

function DiagnosisCard({ d }: { d: Diagnosis }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <DiagnosisStatusBadge status={d.status} />
        <span className="font-mono text-[10px] text-slate-400">{d.rule}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-slate-800">{d.title}</p>
      <div className="mt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Evidence</p>
        <ul className="mt-1 space-y-1">
          {d.evidence.map((e, i) => (
            <li key={i} className="text-xs leading-relaxed text-slate-600 break-words">
              · {e}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-xs text-slate-700">
        <span className="font-semibold text-teal-800">Next safe step: </span>
        {d.nextStep}
      </p>
    </div>
  )
}

export function ErrorsTab({ refreshKey, initialFingerprint }: { refreshKey: number; initialFingerprint?: string | null }) {
  const [data, setData] = useState<ErrorListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)

  // Filters
  const [hours, setHours] = useState('168')
  const [severity, setSeverity] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('unresolved')
  const [routeQ, setRouteQ] = useState('')

  // Detail dialog
  const [detailFp, setDetailFp] = useState<string | null>(initialFingerprint ?? null)
  const [detail, setDetail] = useState<ErrorDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [note, setNote] = useState('')
  const [acting, setActing] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    p.set('hours', hours)
    if (severity !== 'all') p.set('severity', severity)
    if (category !== 'all') p.set('category', category)
    p.set('status', status === 'unresolved' ? 'open,acknowledged' : status)
    if (routeQ.trim()) p.set('route', routeQ.trim())
    if (cursor) p.set('cursor', cursor)
    p.set('limit', '25')
    return p.toString()
  }, [hours, severity, category, status, routeQ, cursor])

  const load = useCallback(
    async (resetCursor = false) => {
      setLoading(true)
      setError(null)
      const p = new URLSearchParams(query)
      if (resetCursor) {
        p.delete('cursor')
        setCursor(null)
      }
      try {
        const d = await platformApi<ErrorListData>(`/api/platform/operations/errors?${p.toString()}`)
        setData(d)
      } catch (e) {
        setError((e as PlatformApiError).error || 'Failed to load operational errors')
      } finally {
        setLoading(false)
      }
    },
    [query],
  )

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, severity, category, status, refreshKey])

  // Declared BEFORE the effect that calls it: the effect callback at the
  // old position referenced `openDetail` ahead of its const declaration —
  // a temporal-dead-zone hazard (any dep-array addition or render-time
  // read would throw ReferenceError) surfaced by eslint-config-next 16.4's
  // react-hooks analyzer. Reordered, not suppressed.
  const openDetail = useCallback(async (fp: string) => {
    setDetailLoading(true)
    setDetail(null)
    setNote('')
    try {
      const d = await platformApi<ErrorDetailData>(
        `/api/platform/operations/errors/${encodeURIComponent(fp)}`,
      )
      setDetail(d)
    } catch (e) {
      toast.error((e as PlatformApiError).error || 'Failed to load error detail')
      setDetailFp(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (detailFp) void openDetail(detailFp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFp])

  const act = useCallback(
    async (kind: 'ack' | 'resolve', fp: string) => {
      setActing(true)
      try {
        await platformApi(`/api/platform/operations/errors/${encodeURIComponent(fp)}/${kind}`, {
          method: 'POST',
          body: JSON.stringify(kind === 'resolve' ? { note } : {}),
        })
        toast.success(kind === 'ack' ? 'Error acknowledged' : 'Error resolved — the group re-opens automatically if it recurs')
        setDetailFp(null)
        await load(true)
      } catch (e) {
        toast.error((e as PlatformApiError).error || `Failed to ${kind === 'ack' ? 'acknowledge' : 'resolve'}`)
      } finally {
        setActing(false)
      }
    },
    [note, load],
  )

  const copyReport = useCallback(() => {
    if (!detail) return
    void navigator.clipboard.writeText(detail.report).then(
      () => toast.success('Sanitized diagnostic report copied'),
      () => toast.error('Clipboard unavailable — select the text manually'),
    )
  }, [detail])

  const groups = useMemo(
    () =>
      (data?.groups ?? []).slice().sort((a, b) => {
        const s = severityRank(b.severity) - severityRank(a.severity)
        return s !== 0 ? s : new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
      }),
    [data],
  )

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className={`${OPS_CARD} flex flex-wrap items-end gap-3`}>
        <div className="flex items-center gap-1.5 pb-1 text-xs font-semibold text-slate-500">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" /> Filters
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Time range
          <Select value={hours} onValueChange={(v) => { setHours(v); setCursor(null) }}>
            <SelectTrigger className="h-9 w-36 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Last 6 hours</SelectItem>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="72">Last 3 days</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
              <SelectItem value="720">Last 30 days</SelectItem>
              <SelectItem value="2160">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Severity
          <Select value={severity} onValueChange={(v) => { setSeverity(v); setCursor(null) }}>
            <SelectTrigger className="h-9 w-32 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Category
          <Select value={category} onValueChange={(v) => { setCategory(v); setCursor(null) }}>
            <SelectTrigger className="h-9 w-36 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="http">HTTP/API</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="provider_sync">Provider sync</SelectItem>
              <SelectItem value="health">Health check</SelectItem>
              <SelectItem value="auth">Auth</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Status
          <Select value={status} onValueChange={(v) => { setStatus(v); setCursor(null) }}>
            <SelectTrigger className="h-9 w-36 border-slate-200 bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Route contains
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              value={routeQ}
              onChange={(e) => { setRouteQ(e.target.value); setCursor(null) }}
              onKeyDown={(e) => e.key === 'Enter' && void load(true)}
              placeholder="/api/students…"
              className="h-9 border-slate-200 bg-white pl-8 text-xs"
            />
          </div>
        </label>
        <Button size="sm" onClick={() => void load(true)} className="h-9 bg-teal-600 text-white hover:bg-teal-700">
          Apply
        </Button>
      </div>

      {/* List */}
      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={OPS_CARD}>
              <Skeleton className="h-4 w-56 bg-slate-200" />
              <Skeleton className="mt-2 h-3 w-72 bg-slate-200" />
            </div>
          ))}
        </div>
      ) : error ? (
        <OpsErrorState message={error} onRetry={() => void load(true)} retrying={loading} />
      ) : !data || groups.length === 0 ? (
        <OpsEmptyState
          title="No error groups match the current filters"
          hint="Operational errors are recorded for 5xx API failures, cross-tenant denials, provider sync failures, failed health checks and webhook processing failures. Benign 4xx security responses (401/404/429) are deliberately not recorded as incidents."
        />
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {formatNumber(data.total)} group(s) match the filters (sorted by severity, then last seen).
          </p>
          <ul className="space-y-2">
            {groups.map((g) => (
              <motion.li key={g.id} {...fadeUp}>
                <button
                  onClick={() => setDetailFp(g.fingerprint)}
                  className={`${OPS_CARD} w-full !p-4 text-left transition-colors hover:border-teal-300 focus-ring`}
                  aria-label={`Inspect error group: ${g.message.slice(0, 80)}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <SeverityBadge severity={g.severity} />
                    <StateBadge status={g.status} />
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {g.category}
                    </span>
                    {g.lastStatusCode && (
                      <span className={`font-mono text-[10px] ${g.lastStatusCode >= 500 ? 'text-red-600' : 'text-amber-600'}`}>
                        HTTP {g.lastStatusCode}
                      </span>
                    )}
                    {g.lastRoute && (
                      <span className="max-w-56 truncate font-mono text-[10px] text-slate-400">{g.lastRoute}</span>
                    )}
                    {g.provider && (
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {g.provider}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">×{formatNumber(g.occurrences)}</span>
                    <span className="ml-auto text-[10px] text-slate-400">{timeAgo(g.lastSeenAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-700 break-words">{g.message}</p>
                  {g.schoolName && (
                    <p className="mt-1 text-[10px] text-slate-400">School: {g.schoolName}</p>
                  )}
                </button>
              </motion.li>
            ))}
          </ul>
          {data.nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCursor(data.nextCursor)
                  setTimeout(() => void load(false), 0)
                }}
                className="border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail dialog */}
      <Dialog open={detailFp !== null} onOpenChange={(v) => !v && setDetailFp(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-white sm:max-w-2xl">
          {detailLoading || !detail ? (
            <div className="space-y-3 py-6">
              <Skeleton className="h-6 w-72 bg-slate-200" />
              <Skeleton className="h-4 w-full bg-slate-200" />
              <Skeleton className="h-4 w-2/3 bg-slate-200" />
              <Skeleton className="h-32 w-full bg-slate-200" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-slate-900">
                  <SeverityBadge severity={detail.group.severity} />
                  <StateBadge status={detail.group.status} />
                  <span className="font-mono text-xs text-slate-400">{detail.group.category}</span>
                </DialogTitle>
                <DialogDescription className="text-left">
                  <span className="block text-sm text-slate-700">{detail.group.message}</span>
                  <span className="mt-1 block font-mono text-[10px] text-slate-400">
                    fingerprint {detail.group.fingerprint.slice(0, 16)}… · first seen {timeAgo(detail.group.firstSeenAt)} ·
                    last seen {timeAgo(detail.group.lastSeenAt)} · ×{formatNumber(detail.group.occurrences)} occurrences
                    {detail.group.lastRoute ? ` · ${detail.group.lastMethod ?? ''} ${detail.group.lastRoute}` : ''}
                  </span>
                </DialogDescription>
              </DialogHeader>

              {/* Root-cause diagnoses */}
              <section aria-label="Root-cause diagnosis">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <ShieldQuestion className="h-3.5 w-3.5" aria-hidden="true" /> Rule-based diagnosis
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyReport}
                    className="h-7 px-2 text-[11px] text-slate-500 hover:bg-slate-100"
                  >
                    <ClipboardCopy className="mr-1 h-3 w-3" aria-hidden="true" /> Copy report
                  </Button>
                </div>
                {detail.diagnoses.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 text-xs text-slate-500">
                    No diagnosis rule matched with the currently collected evidence. Insufficient evidence is an honest
                    verdict — collect more data (run health checks / provider sync) before drawing conclusions.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {detail.diagnoses.map((d) => (
                      <DiagnosisCard key={d.rule} d={d} />
                    ))}
                  </div>
                )}
              </section>

              {/* Occurrence history */}
              <section aria-label="Occurrence history">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recent occurrences ({formatNumber(detail.events.length)})
                </h3>
                <ul className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 custom-scrollbar">
                  {detail.events.map((ev) => (
                    <li key={ev.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px] last:border-0">
                      <span className="tabular-nums text-slate-400">{new Date(ev.occurredAt).toLocaleString()}</span>
                      {ev.statusCode && (
                        <span className={`font-mono ${ev.statusCode >= 500 ? 'text-red-600' : 'text-amber-600'}`}>
                          {ev.statusCode}
                        </span>
                      )}
                      <span className="font-mono text-slate-500">{ev.route ?? '—'}</span>
                      <span className="ml-auto truncate text-slate-400" title={ev.requestId ?? ''}>
                        {ev.requestId ? `req ${ev.requestId.slice(0, 10)}…` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Related audit */}
              {detail.relatedAudit.length > 0 && (
                <section aria-label="Related audit events">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Related platform audit events
                  </h3>
                  <ul className="space-y-1">
                    {detail.relatedAudit.map((a) => (
                      <li key={a.id} className="text-[11px] text-slate-500">
                        <span className="tabular-nums text-slate-400">{new Date(a.at).toLocaleString()}</span> ·{' '}
                        <span className="font-mono">{a.action}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Actions */}
              <section aria-label="Incident actions" className="border-t border-slate-100 pt-3">
                {detail.group.status !== 'resolved' ? (
                  <div className="space-y-2">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Resolution note (required to resolve — recorded in the platform audit trail)"
                      className="min-h-16 border-slate-200 bg-white text-xs"
                      aria-label="Resolution note"
                    />
                    <div className="flex flex-wrap gap-2">
                      {detail.group.status !== 'acknowledged' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void act('ack', detail.group.fingerprint)}
                          disabled={acting}
                          className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        >
                          Acknowledge
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          if (note.trim().length < 3) {
                            toast.error('A resolution note is required (min 3 characters)')
                            return
                          }
                          void act('resolve', detail.group.fingerprint)
                        }}
                        disabled={acting}
                        className="bg-teal-600 text-white hover:bg-teal-700"
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {acting ? 'Saving…' : 'Resolve'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Resolved {timeAgo(detail.group.resolvedAt ?? detail.group.lastSeenAt)}
                    {detail.group.resolutionNote ? ` — “${detail.group.resolutionNote}”` : ''}
                    . A recurrence re-opens this group automatically.
                  </p>
                )}
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
