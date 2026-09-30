'use client'

// ============================================================
// SchoolsModule — the platform-wide school ledger (PHASE 6)
// ------------------------------------------------------------
// /platform/schools: searchable, status-filtered, paginated list of
// every tenant with live counts, plus the PENDING provisioning
// dialog (POST /api/platform/schools). Desktop renders a table,
// small screens render cards — same data, no horizontal overflow.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Building2,
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
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

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
}

interface SchoolsData {
  total: number
  page: number
  pageSize: number
  schools: SchoolRow[]
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'PENDING'

const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const
const SCHOOL_BOARDS = ['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM'] as const

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
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  SUSPENDED: 'border-red-500/30 bg-red-500/10 text-red-400',
  PENDING: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  TRIAL: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`normal-case ${STATUS_STYLES[status] ?? STATUS_STYLES['TRIAL']}`}>
      {status}
    </Badge>
  )
}

// ── Provision dialog ──────────────────────────────────────────────────────

interface ProvisionForm {
  name: string
  slug: string
  code: string
  domain: string
  city: string
  plan: string
  board: string
  principalName: string
  principalEmail: string
  principalPassword: string
}

const EMPTY_FORM: ProvisionForm = {
  name: '',
  slug: '',
  code: '',
  domain: '',
  city: '',
  plan: 'STANDARD',
  board: 'CBSE',
  principalName: '',
  principalEmail: '',
  principalPassword: '',
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z0-9-]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ProvisionDialog({
  open,
  onOpenChange,
  onProvisioned,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onProvisioned: () => void
}) {
  const [form, setForm] = useState<ProvisionForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [open])

  const set = <K extends keyof ProvisionForm>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    if (form.name.trim().length < 2) return 'School name is required (2+ characters)'
    if (!SLUG_RE.test(form.slug) || form.slug.length < 3)
      return 'Slug must be 3+ chars — lowercase letters, numbers and hyphens only (e.g. riverside-academy)'
    if (!CODE_RE.test(form.code) || form.code.length < 2)
      return 'Code must be 2+ chars — uppercase letters, numbers and hyphens only (e.g. RVS-001)'
    if (form.domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(form.domain.trim()))
      return 'Domain must look like a hostname (e.g. riverside.edu.in)'
    if (!form.principalName.trim()) return 'Principal name is required'
    if (!EMAIL_RE.test(form.principalEmail.trim())) return 'A valid principal email is required'
    if (form.principalPassword.length < 8) return 'Principal password must be at least 8 characters'
    return null
  }

  const submit = async () => {
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await platformApi('/api/platform/schools', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug,
          code: form.code,
          domain: form.domain.trim() || undefined,
          city: form.city.trim() || undefined,
          plan: form.plan,
          board: form.board,
          principalName: form.principalName.trim(),
          principalEmail: form.principalEmail.trim(),
          principalPassword: form.principalPassword,
        }),
      })
      toast.success('School provisioned — activate it to enable sign-in')
      onOpenChange(false)
      onProvisioned()
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Provisioning failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  const field =
    'bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40 h-11'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scrollbar bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-zinc-50">
            <Building2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            Provision a new school
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Creates the tenant in <span className="text-amber-300 font-medium">PENDING</span> state with its
            founding principal account. Nobody can sign in until the school is explicitly activated.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="prov-name" className="text-xs font-semibold text-zinc-300">
              School name *
            </Label>
            <Input
              id="prov-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Riverside Academy"
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-slug" className="text-xs font-semibold text-zinc-300">
              Slug *
            </Label>
            <Input
              id="prov-slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value.toLowerCase())}
              placeholder="riverside-academy"
              className={`${field} font-mono`}
            />
            <p className="text-[10px] text-zinc-600">lowercase letters, numbers and hyphens</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-code" className="text-xs font-semibold text-zinc-300">
              Code *
            </Label>
            <Input
              id="prov-code"
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="RVS-001"
              className={`${field} font-mono`}
            />
            <p className="text-[10px] text-zinc-600">uppercase — must be unique platform-wide</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-domain" className="text-xs font-semibold text-zinc-300">
              Domain
            </Label>
            <Input
              id="prov-domain"
              value={form.domain}
              onChange={(e) => set('domain', e.target.value.toLowerCase())}
              placeholder="riverside.edu.in"
              className={`${field} font-mono`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-city" className="text-xs font-semibold text-zinc-300">
              City
            </Label>
            <Input
              id="prov-city"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Pune"
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-plan" className="text-xs font-semibold text-zinc-300">
              Plan *
            </Label>
            <Select value={form.plan} onValueChange={(v) => set('plan', v)}>
              <SelectTrigger id="prov-plan" className={`${field} w-full`}>
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                {SCHOOL_PLANS.map((p) => (
                  <SelectItem key={p} value={p} className="focus:bg-zinc-800">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-board" className="text-xs font-semibold text-zinc-300">
              Board *
            </Label>
            <Select value={form.board} onValueChange={(v) => set('board', v)}>
              <SelectTrigger id="prov-board" className={`${field} w-full`}>
                <SelectValue placeholder="Board" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                {SCHOOL_BOARDS.map((b) => (
                  <SelectItem key={b} value={b} className="focus:bg-zinc-800">
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400/90">
            Founding principal
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="prov-pname" className="text-xs font-semibold text-zinc-300">
                Name *
              </Label>
              <Input
                id="prov-pname"
                value={form.principalName}
                onChange={(e) => set('principalName', e.target.value)}
                placeholder="Meera Iyer"
                className={field}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-pemail" className="text-xs font-semibold text-zinc-300">
                Email *
              </Label>
              <Input
                id="prov-pemail"
                type="email"
                value={form.principalEmail}
                onChange={(e) => set('principalEmail', e.target.value)}
                placeholder="principal@riverside.edu.in"
                className={field}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-ppass" className="text-xs font-semibold text-zinc-300">
                Password *
              </Label>
              <Input
                id="prov-ppass"
                type="text"
                autoComplete="off"
                value={form.principalPassword}
                onChange={(e) => set('principalPassword', e.target.value)}
                placeholder="Set an initial password"
                className={field}
              />
              <p className="text-[10px] text-zinc-600">The principal resets it after first sign-in</p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 h-11 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold h-11 focus-ring"
          >
            {busy ? 'Provisioning…' : 'Provision school'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-zinc-50"
        >
          Schools
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every tenant on the platform{data ? ` · ${num.format(data.total)} total` : ''} · click a school to
          manage it
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, slug, code, domain…"
            aria-label="Search schools"
            className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40 h-11 pl-9"
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
            className="h-11 w-full sm:w-40 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
            <SelectItem value="ALL" className="focus:bg-zinc-800">
              All statuses
            </SelectItem>
            <SelectItem value="ACTIVE" className="focus:bg-zinc-800">
              ACTIVE
            </SelectItem>
            <SelectItem value="SUSPENDED" className="focus:bg-zinc-800">
              SUSPENDED
            </SelectItem>
            <SelectItem value="PENDING" className="focus:bg-zinc-800">
              PENDING
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          {canProvision && (
            <Button
              onClick={() => setProvisionOpen(true)}
              className="h-11 w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Provision school
            </Button>
          )}
        </div>
      </div>

      {/* Load error */}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-9 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus-ring"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Ledger — table on sm+, cards below */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
        {showSkeletonRows ? (
          <div className="space-y-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading schools">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-44 bg-zinc-800" />
                <Skeleton className="h-6 w-20 bg-zinc-800" />
                <Skeleton className="hidden sm:block h-4 flex-1 bg-zinc-800" />
                <Skeleton className="hidden lg:block h-4 w-20 bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : data && data.schools.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/70 text-zinc-500 ring-1 ring-zinc-700/60">
              <SchoolIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-200">No schools match</p>
            <p className="mt-1 max-w-xs text-xs leading-snug text-zinc-500">
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
                className="mt-4 h-9 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus-ring"
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
                  <TableRow className="border-zinc-800/80 hover:bg-transparent">
                    <TableHead className="text-zinc-500 font-semibold h-11">School</TableHead>
                    <TableHead className="text-zinc-500 font-semibold">Status</TableHead>
                    <TableHead className="text-zinc-500 font-semibold">Plan</TableHead>
                    <TableHead className="text-zinc-500 font-semibold text-right">Users</TableHead>
                    <TableHead className="text-zinc-500 font-semibold text-right">Students</TableHead>
                    <TableHead className="text-zinc-500 font-semibold text-right">Teachers</TableHead>
                    <TableHead className="text-zinc-500 font-semibold">City</TableHead>
                    <TableHead className="text-zinc-500 font-semibold">Created</TableHead>
                    <TableHead className="w-12" aria-label="Open school" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.schools.map((s) => (
                    <TableRow
                      key={s.id}
                      onClick={() => openSchool(s.id)}
                      className="cursor-pointer border-zinc-800/60 hover:bg-zinc-800/40 focus:bg-zinc-800/40 focus:outline-none"
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
                        <p className="truncate font-semibold text-zinc-100">{s.name}</p>
                        <p className="truncate font-mono text-[11px] text-zinc-500">
                          {s.slug} · {s.code}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-zinc-300">
                          {s.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-zinc-300 tabular-nums">
                        {num.format(s.counts.users)}
                      </TableCell>
                      <TableCell className="text-right text-zinc-300 tabular-nums">
                        {num.format(s.counts.students)}
                      </TableCell>
                      <TableCell className="text-right text-zinc-300 tabular-nums">
                        {num.format(s.counts.teachers)}
                      </TableCell>
                      <TableCell className="text-zinc-400">{s.city ?? '—'}</TableCell>
                      <TableCell className="text-zinc-500 tabular-nums" title={new Date(s.createdAt).toLocaleString()}>
                        {timeAgo(s.createdAt)}
                      </TableCell>
                      <TableCell className="py-3">
                        <ChevronRight className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards (<sm) */}
            <div className="sm:hidden divide-y divide-zinc-800/60" aria-label="Schools">
              {data?.schools.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => openSchool(s.id)}
                  whileTap={{ scale: 0.985 }}
                  className="w-full min-h-[44px] text-left p-4 hover:bg-zinc-800/40 focus:outline-none focus-visible:bg-zinc-800/40"
                  aria-label={`Open ${s.name}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold text-sm text-zinc-100">{s.name}</p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                    {s.slug} · {s.code}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={s.status} />
                    <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-zinc-300">
                      {s.plan}
                    </Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 tabular-nums">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {s.city ?? '—'}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
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
                </motion.button>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 px-4 py-3">
              <p className="text-xs text-zinc-500 tabular-nums">
                Page {page} of {totalPages}
                {data ? ` · ${num.format(data.total)} school${data.total === 1 ? '' : 's'}` : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-9 min-w-[76px] border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
                >
                  ← Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-9 min-w-[76px] border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {canProvision && (
        <ProvisionDialog
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
