'use client'

// ============================================================
// AuditModule — /platform/audit (PHASE 6 console)
// ------------------------------------------------------------
// The platform audit-trail viewer: free-text search (action/reason),
// action-prefix filter, pagination (50/page, newest first) and an
// expandable metadata row per event. Audit rows have NO foreign keys
// server-side — they deliberately survive school/admin deletion, which
// is why an admin name can render as "unknown admin".
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Search, ChevronLeft, ChevronRight, ScrollText, ChevronDown } from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface AuditEvent {
  id: string
  at: string
  action: string
  admin: { id: string; name: string } | null
  targetType: string | null
  targetId: string | null
  schoolId: string | null
  reason: string | null
  metadata: string | null
  ip: string | null
}

interface AuditPage {
  total: number
  page: number
  pageSize: number
  events: AuditEvent[]
}

const PAGE_SIZE = 50

/** Short id chip ("a1b2c3d4…", full value in title/aria). */
function shortId(id: string | null): string | null {
  if (!id) return null
  return id.length > 10 ? `${id.slice(0, 10)}…` : id
}

/** Action badge tone by prefix (zinc default). */
function actionTone(action: string): 'zinc' | 'red' | 'amber' | 'emerald' {
  if (action.startsWith('platform.login') || action.startsWith('platform.logout')) return 'zinc'
  if (action === 'platform.school.suspended' || action === 'platform.school.deleted') return 'red'
  if (action.startsWith('platform.support')) return 'amber'
  if (action.startsWith('platform.step')) return 'emerald'
  return 'zinc'
}

const TONE_CLASS: Record<'zinc' | 'red' | 'amber' | 'emerald', string> = {
  zinc: 'border-zinc-700/80 bg-zinc-800/60 text-zinc-300',
  red: 'border-red-500/40 bg-red-500/10 text-red-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
}

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[11px] tracking-tight whitespace-normal break-all max-w-full text-left ${TONE_CLASS[actionTone(action)]}`}
    >
      {action}
    </Badge>
  )
}

/** Pretty-print the metadata JSON blob (corrupt blob → raw string). */
function formatMetadata(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function AuditModule() {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Ids of requests in flight so stale responses never overwrite fresh ones.
  const reqId = useRef(0)

  const load = useCallback(async (nextPage: number, qv: string, actionPrefix: string) => {
    const myReq = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(nextPage) })
      if (qv.trim()) params.set('q', qv.trim())
      if (actionPrefix.trim()) params.set('action', actionPrefix.trim())
      const body = await platformApi<AuditPage>(`/api/platform/audit?${params.toString()}`)
      if (reqId.current !== myReq) return
      setData(body)
      setExpanded(null)
    } catch (e) {
      if (reqId.current !== myReq) return
      const err = e as PlatformApiError
      setError(err.error || 'Failed to load the audit trail')
    } finally {
      if (reqId.current === myReq) setLoading(false)
    }
  }, [])

  // Debounced load: page changes fire immediately; text-filter typing
  // waits 350ms so every keystroke does not hit the API.
  const prevPage = useRef(0)
  useEffect(() => {
    const immediate = prevPage.current !== page
    prevPage.current = page
    const t = setTimeout(
      () => void load(page, q, action),
      immediate ? 0 : 350,
    )
    return () => clearTimeout(t)
  }, [page, q, action, load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const events = data?.events ?? []

  return (
    <section aria-labelledby="audit-heading" className="space-y-5">
      {/* Header */}
      <div>
        <h1
          id="audit-heading"
          className="font-display text-xl sm:text-2xl font-bold text-zinc-100 flex items-center gap-2.5"
        >
          <span className="h-9 w-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <ScrollText className="h-4.5 w-4.5 text-emerald-400" aria-hidden="true" />
          </span>
          Platform audit trail
        </h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-2xl">
          Append-only record of every control-plane action. Rows survive school and admin
          deletion — entries may reference an <span className="text-zinc-300">unknown admin</span>{' '}
          when the account has since been removed.
        </p>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search action or reason…"
              aria-label="Search audit events"
              className="pl-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-11 focus-visible:ring-emerald-500/40"
            />
          </div>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Action prefix e.g. platform.school"
            aria-label="Filter by action prefix"
            className="sm:w-72 font-mono text-[13px] bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 h-11 focus-visible:ring-emerald-500/40"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500 tabular-nums" aria-live="polite">
            {loading ? 'Loading…' : `${data?.total ?? 0} events`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
              aria-label="Previous page"
              className="h-11 w-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="text-xs text-zinc-500 tabular-nums min-w-[4.5rem] text-center">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => (p < totalPages ? p + 1 : p))}
              disabled={loading || page >= totalPages}
              aria-label="Next page"
              className="h-11 w-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl bg-zinc-800/70" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && events.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
          <ScrollText className="h-8 w-8 text-zinc-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-zinc-300">No audit events match the filters</p>
          <p className="text-xs text-zinc-500 mt-1">
            Try clearing the search or action filter — the trail records every platform action.
          </p>
        </div>
      )}

      {/* Event list */}
      {!loading && events.length > 0 && (
        <>
          {/* Table (≥ sm) */}
          <div className="hidden sm:block rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <Table className="text-zinc-300">
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-500 font-medium h-11">Time</TableHead>
                  <TableHead className="text-zinc-500 font-medium">Action</TableHead>
                  <TableHead className="text-zinc-500 font-medium">Admin</TableHead>
                  <TableHead className="text-zinc-500 font-medium">Target</TableHead>
                  <TableHead className="text-zinc-500 font-medium">Reason</TableHead>
                  <TableHead className="text-zinc-500 font-medium">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => {
                  const hasMeta = Boolean(ev.metadata)
                  const open = expanded === ev.id
                  return (
                    <React.Fragment key={ev.id}>
                      <TableRow
                        className={
                          hasMeta
                            ? 'cursor-pointer border-zinc-800/80 hover:bg-zinc-800/40'
                            : 'border-zinc-800/80'
                        }
                        onClick={() => hasMeta && setExpanded(open ? null : ev.id)}
                        aria-expanded={hasMeta ? open : undefined}
                        aria-label={hasMeta ? 'Toggle metadata for this event' : undefined}
                        tabIndex={hasMeta ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (hasMeta && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault()
                            setExpanded(open ? null : ev.id)
                          }
                        }}
                      >
                        <TableCell className="whitespace-nowrap tabular-nums text-xs text-zinc-400">
                          {when(ev.at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {hasMeta && (
                              <ChevronDown
                                className={`h-3.5 w-3.5 text-zinc-600 transition-transform ${
                                  open ? 'rotate-180' : ''
                                }`}
                                aria-hidden="true"
                              />
                            )}
                            <ActionBadge action={ev.action} />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-zinc-300">
                          {ev.admin ? (
                            <span title={ev.admin.id}>{ev.admin.name}</span>
                          ) : (
                            <span className="text-zinc-600">system</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ev.targetType ? (
                            <span className="text-zinc-300">
                              {ev.targetType}
                              {ev.targetId && (
                                <span
                                  className="text-zinc-500 font-mono ml-1.5"
                                  title={ev.targetId}
                                >
                                  {shortId(ev.targetId)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                          {ev.schoolId && (
                            <span
                              className="block text-zinc-600 font-mono text-[10px]"
                              title={ev.schoolId}
                            >
                              school {shortId(ev.schoolId)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          {ev.reason ? (
                            <span className="block truncate text-xs text-zinc-400" title={ev.reason}>
                              {ev.reason}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-zinc-500">
                          {ev.ip ?? '—'}
                        </TableCell>
                      </TableRow>
                      {open && ev.metadata && (
                        <TableRow className="border-zinc-800/80 hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-zinc-950/60">
                            <pre className="max-h-64 overflow-auto custom-scrollbar rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300 font-mono">
                              {formatMetadata(ev.metadata)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Cards (mobile) */}
          <div className="sm:hidden space-y-3">
            {events.map((ev) => {
              const hasMeta = Boolean(ev.metadata)
              const open = expanded === ev.id
              return (
                <div
                  key={ev.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <ActionBadge action={ev.action} />
                    <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
                      {when(ev.at)}
                    </span>
                  </div>
                  <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-zinc-500">Admin</dt>
                    <dd className="text-zinc-300 truncate">{ev.admin?.name ?? 'system'}</dd>
                    <dt className="text-zinc-500">Target</dt>
                    <dd className="text-zinc-300">
                      {ev.targetType ?? '—'}
                      {ev.targetId && (
                        <span className="text-zinc-500 font-mono ml-1.5" title={ev.targetId}>
                          {shortId(ev.targetId)}
                        </span>
                      )}
                    </dd>
                    {ev.schoolId && (
                      <>
                        <dt className="text-zinc-500">School</dt>
                        <dd className="text-zinc-400 font-mono" title={ev.schoolId}>
                          {shortId(ev.schoolId)}
                        </dd>
                      </>
                    )}
                    <dt className="text-zinc-500">Reason</dt>
                    <dd className="text-zinc-400 col-span-1" title={ev.reason ?? undefined}>
                      <span className="block truncate">{ev.reason ?? '—'}</span>
                    </dd>
                    <dt className="text-zinc-500">IP</dt>
                    <dd className="text-zinc-500 font-mono">{ev.ip ?? '—'}</dd>
                  </dl>
                  {hasMeta && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded(open ? null : ev.id)}
                      aria-expanded={open}
                      className="w-full h-11 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                      {open ? 'Hide metadata' : 'Show metadata'}
                    </Button>
                  )}
                  {open && ev.metadata && (
                    <pre className="max-h-56 overflow-auto custom-scrollbar rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-300 font-mono">
                      {formatMetadata(ev.metadata)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500 tabular-nums">
              Showing page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-11 px-4 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => (p < totalPages ? p + 1 : p))}
                disabled={page >= totalPages}
                className="h-11 px-4 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
