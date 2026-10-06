'use client'

// ============================================================
// SchoolsModule — the platform-wide school ledger (PHASE 6)
// ------------------------------------------------------------
// /platform/schools: searchable, status-filtered, paginated list of
// every tenant with live counts, plus the PENDING provisioning
// dialog (POST /api/platform/schools). Desktop renders a table,
// small screens render cards — same data, no horizontal overflow.
//
// PHASE 10 (two-project topology): every row carries the tenant's
// CANONICAL doors (loginUrl/publicUrl from SCHOOL_APP_BASE_URL —
// never guessed). The table surfaces the login URL with copy
// controls; copies always resolve relative URLs against the
// current origin so the operator hands out a working link.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Search,
  Plus,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Users,
  GraduationCap,
  BookOpen,
  School as SchoolIcon,
  MapPin,
  CalendarDays,
  Copy,
  Check,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { ProvisionWizard } from './provision-wizard'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ── Types (API contract, worklog Task 6-1) ────────────────────────────────

interface SchoolRow {
  id: string
  name: string
  slug: string
  code: string
  domain: string | null
  city: string | null
  plan: string
  status: string
  board: string
  academicYear: string | null
  featureFlags: string
  createdAt: string
  counts: { users: number; students: number; teachers: number; classes: number }
  // TWO-PROJECT TOPOLOGY — canonical doors (may be RELATIVE when
  // SCHOOL_APP_BASE_URL is unset; the unified deployment serves both
  // planes, so /s/<slug>/login on its own origin is correct).
  loginUrl: string
  publicUrl: string
}

interface SchoolsData {
  total: number
  page: number
  pageSize: number
  schools: SchoolRow[]
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'PENDING'


const num = new Intl.NumberFormat('en-IN')

// ── Small local helpers ───────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  TRIAL: 'border-slate-200 bg-slate-100 text-slate-600',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES['TRIAL']}`}>
      {status}
    </Badge>
  )
}

// ── Access copy controls (PHASE 10 — school access truth) ────────────────

/** Resolve a possibly-relative plane URL to an absolute one (click-time only — window exists). */
function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

/**
 * Copy button with inline "Copied" feedback (icon swaps to Check for
 * ~1.5s; the text variant swaps its label). 44×44 touch target, quiet
 * slate styling, and stopPropagation on click + keydown so the
 * surrounding row/card navigation never fires from inside it.
 */
function CopyControl({
  value,
  absolute,
  label,
  text,
}: {
  value: string
  /** Resolve a leading '/' against window.location.origin before copying. */
  absolute?: boolean
  label: string
  /** Optional visible text label (mobile cards); swaps to "Copied" on success. */
  text?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const payload = absolute ? absoluteUrl(value) : value
    void navigator.clipboard.writeText(payload).then(
      () => {
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* clipboard unavailable — no success feedback (honest failure) */
      },
    )
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={
        text
          ? 'inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
          : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40'
      }
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {text ? <span>{copied ? 'Copied' : text}</span> : null}
    </button>
  )
}

// ── Onboarding wizard (provision-wizard.tsx) ──────────────────────────────────────────────────────

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolsModule() {
  const { can } = usePlatformSession()
  const router = useRouter()

  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SchoolsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provisionOpen, setProvisionOpen] = useState(false)
  const requestId = useRef(0)

  // Debounced search (~300ms) → resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status !== 'ALL') params.set('status', status)
      params.set('page', String(page))
      const result = await platformApi<SchoolsData>(`/api/platform/schools?${params.toString()}`)
      if (id === requestId.current) setData(result)
    } catch (e) {
      if (id === requestId.current) {
        const err = e as PlatformApiError
        setError(err.error || 'Failed to load schools')
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [q, status, page])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const canProvision = can('schools.provision')
  const showSkeletonRows = loading || !data

  const openSchool = (id: string) => router.push(`/platform/schools/${id}`)

  return (
    <section aria-labelledby="schools-heading" className="space-y-4 sm:space-y-5">
      {/* Page header */}
      <div>
        <h1
          id="schools-heading"
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900"
        >
          Schools
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Every tenant on the platform{data ? ` · ${num.format(data.total)} total` : ''} · click a school to
          manage it
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, slug, code, domain…"
            aria-label="Search schools"
            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11 pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as StatusFilter)
            setPage(1)
          }}
        >
          <SelectTrigger
            aria-label="Filter by status"
            className="h-11 w-full sm:w-40 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-900">
            <SelectItem value="ALL" className="focus:bg-slate-100">
              All statuses
            </SelectItem>
            <SelectItem value="ACTIVE" className="focus:bg-slate-100">
              ACTIVE
            </SelectItem>
            <SelectItem value="SUSPENDED" className="focus:bg-slate-100">
              SUSPENDED
            </SelectItem>
            <SelectItem value="PENDING" className="focus:bg-slate-100">
              PENDING
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          {canProvision && (
            <Button
              onClick={() => setProvisionOpen(true)}
              className="h-11 w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add School
            </Button>
          )}
        </div>
      </div>

      {/* Load error */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Ledger — table on sm+, cards below */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {showSkeletonRows ? (
          <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading schools">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-44 bg-slate-200" />
                <Skeleton className="h-6 w-20 bg-slate-200" />
                <Skeleton className="hidden sm:block h-4 flex-1 bg-slate-200" />
                <Skeleton className="hidden lg:block h-4 w-20 bg-slate-200" />
              </div>
            ))}
          </div>
        ) : data && data.schools.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <SchoolIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900">No schools match</p>
            <p className="mt-1 max-w-xs text-xs leading-snug text-slate-500">
              {q || status !== 'ALL'
                ? 'Nothing matches the current search and status filters — try clearing them.'
                : 'No schools have been provisioned yet.'}
            </p>
            {(q || status !== 'ALL') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchInput('')
                  setStatus('ALL')
                  setPage(1)
                }}
                className="mt-4 h-9 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table (sm+) */}
            <div className="hidden sm:block overflow-x-auto custom-scrollbar">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-slate-500 font-semibold h-11">School</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Status</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Plan</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Login URL</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Users</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Students</TableHead>
                    <TableHead className="text-slate-500 font-semibold text-right">Teachers</TableHead>
                    <TableHead className="text-slate-500 font-semibold">City</TableHead>
                    <TableHead className="text-slate-500 font-semibold">Created</TableHead>
                    <TableHead className="w-24" aria-label="Row actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.schools.map((s) => (
                    <TableRow
                      key={s.id}
                      onClick={() => openSchool(s.id)}
                      className="cursor-pointer border-slate-200 hover:bg-slate-50 focus:bg-slate-100 focus:outline-none"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openSchool(s.id)
                        }
                      }}
                      aria-label={`Open ${s.name}`}
                    >
                      <TableCell className="max-w-[16rem] py-3">
                        <p className="truncate font-semibold text-slate-900">{s.name}</p>
                        <p className="truncate font-mono text-[11px] text-slate-500">
                          {s.slug} · {s.code}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-700">
                          {s.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[13rem] py-3">
                        <div className="flex min-w-0 items-center gap-1">
                          <p
                            className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500"
                            title={s.loginUrl}
                          >
                            {s.loginUrl}
                          </p>
                          <CopyControl
                            value={s.loginUrl}
                            absolute
                            label={`Copy ${s.name} login URL`}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.users)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.students)}
                      </TableCell>
                      <TableCell className="text-right text-slate-700 tabular-nums">
                        {num.format(s.counts.teachers)}
                      </TableCell>
                      <TableCell className="text-slate-600">{s.city ?? '—'}</TableCell>
                      <TableCell className="text-slate-500 tabular-nums" title={new Date(s.createdAt).toLocaleString()}>
                        {timeAgo(s.createdAt)}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          <CopyControl value={s.code} label={`Copy ${s.name} school code`} />
                          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards (<sm) */}
            <div className="sm:hidden divide-y divide-slate-200" aria-label="Schools">
              {data?.schools.map((s) => (
                // The card is a div[role=button] (NOT a <button>) so the
                // copy controls inside remain valid interactive elements;
                // they stopPropagation to keep card = open detail only.
                <motion.div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openSchool(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openSchool(s.id)
                    }
                  }}
                  whileTap={{ scale: 0.985 }}
                  className="w-full min-h-[44px] cursor-pointer text-left p-4 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
                  aria-label={`Open ${s.name}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-sm text-slate-900">{s.name}</p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {s.slug} · {s.code}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={s.status} />
                    <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-700">
                      {s.plan}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {s.city ?? '—'}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.users)} users
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <GraduationCap className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.students)} students
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <BookOpen className="h-3 w-3" aria-hidden="true" />
                      {num.format(s.counts.teachers)} teachers
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {timeAgo(s.createdAt)}
                    </span>
                  </div>
                  {/* Access actions — copy the canonical login URL (absolute)
                      and the school code; never triggers card navigation. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CopyControl
                      value={s.loginUrl}
                      absolute
                      label={`Copy ${s.name} login URL`}
                      text="Login URL"
                    />
                    <CopyControl value={s.code} label={`Copy ${s.name} school code`} text="Code" />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-500 tabular-nums">
                Page {page} of {totalPages}
                {data ? ` · ${num.format(data.total)} school${data.total === 1 ? '' : 's'}` : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  ← Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-9 min-w-[76px] border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {canProvision && (
        <ProvisionWizard
          open={provisionOpen}
          onOpenChange={setProvisionOpen}
          onProvisioned={() => {
            setPage(1)
            void load()
          }}
        />
      )}
    </section>
  )
}
