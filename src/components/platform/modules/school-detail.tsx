'use client'

// ============================================================
// SchoolDetailModule — /platform/schools/[id] (PHASE 6)
// ------------------------------------------------------------
// Full tenant dossier: stats, profile, metadata editor (PATCH),
// plan & module feature flags, the danger zone (activate/suspend/
// reactivate + typed-confirmation cascade delete) and the
// "Access School" support-session launcher. Every destructive call
// is wrapped in useStepUpGate; the server re-authorizes anyway.
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  LifeBuoy,
  Users,
  GraduationCap,
  BookOpen,
  LayoutGrid,
  ClipboardList,
  IndianRupee,
  MonitorSmartphone,
  Globe,
  MapPin,
  CalendarDays,
  History,
  Trash2,
  Ban,
  Power,
  Palette,
  ShieldAlert,
  Info,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { SchoolDomainsTab } from './school-domains'
import { SchoolSetupTab } from './school-setup'
import { saveSupportToken } from '@/lib/platform-session-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

// ── Types (API contract, worklog Task 6-1) ────────────────────────────────

interface SchoolRecord {
  id: string
  name: string
  slug: string
  code: string
  domain: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  board: string
  plan: string
  status: string
  academicYear: string | null
  themeColor: string
  accentColor: string
  isDemo: boolean
  featureFlags: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

interface SchoolDetailData {
  school: SchoolRecord
  counts: { users: number; students: number; teachers: number; classes: number; exams: number; fees: number }
  activeSchoolSessions: number
  activeSupportSessions: number
  recentActivity: Array<{ id: string; action: string; detail: string | null; at: string }>
}

interface AccessResponse {
  supportSession: { schoolId: string; schoolName: string; reason: string; expiresAt: string }
  supportToken?: string
}

const FLAGGABLE_MODULES = ['exams', 'fees', 'homework', 'library', 'transport'] as const
const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const
const SCHOOL_BOARDS = ['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM'] as const
const DURATION_OPTIONS = [5, 15, 30, 45, 60] as const

type GateFn = <T>(action: () => Promise<T>) => Promise<T | undefined>

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

// ── Access School (support session) dialog ────────────────────────────────

function AccessDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  gate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  gate: GateFn
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<string>('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setDuration('15')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required — the school can see it')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<AccessResponse>(`/api/platform/schools/${schoolId}/access`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim(), durationMinutes: Number(duration) }),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      if (res.supportToken) saveSupportToken(res.supportToken)
      toast.success('Support session opened')
      onOpenChange(false)
      router.push('/platform/support/view')
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Could not open the support session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-zinc-50">
            <LifeBuoy className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Access {schoolName} — read-only support session
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Opens a time-boxed, audited oversight session. No school identity is assumed and no school data
            can be modified — the school sees a record of this visit.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="access-reason" className="text-xs font-semibold text-zinc-300">
              Reason (required, visible to the school) *
            </Label>
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Principal reported fee ledger mismatch after the February gateway batch…"
              rows={3}
              maxLength={400}
              className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40 min-h-[88px]"
            />
            <p className="text-[10px] text-zinc-600 tabular-nums">{reason.trim().length}/400 · minimum 10</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="access-duration" className="text-xs font-semibold text-zinc-300">
              Duration
            </Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger
                id="access-duration"
                className="h-11 w-full bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                {DURATION_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)} className="focus:bg-zinc-800">
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-600">Capped by the platform&apos;s maximum support duration</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold focus-ring"
          >
            {busy ? 'Opening…' : 'Open support session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Suspend dialog (required reason ≥ 10 chars) ──────────────────────────

function SuspendDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  gate,
  onSuspended,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  schoolId: string
  schoolName: string
  gate: GateFn
  onSuspended: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (reason.trim().length < 10) {
      setError('A reason of at least 10 characters is required — it goes into the platform audit trail')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ ok: true; status: string; revokedSessions: number }>(
          `/api/platform/schools/${schoolId}/suspend`,
          { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
        ),
      )
      if (!res) return
      toast.success(
        `School suspended — ${res.revokedSessions} live session${res.revokedSessions === 1 ? '' : 's'} revoked`,
      )
      onOpenChange(false)
      onSuspended()
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Suspension failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-zinc-50">
            <Ban className="h-4 w-4 text-red-400" aria-hidden="true" />
            Suspend {schoolName}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Every user of this school is signed out immediately and school sign-in is blocked until it is
            explicitly reactivated. This action requires step-up verification and is audited with your reason.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="suspend-reason" className="text-xs font-semibold text-zinc-300">
            Reason (required) *
          </Label>
          <Textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Repeated fee reconciliation failures pending the Q1 audit review…"
            rows={3}
            maxLength={400}
            className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-red-500/40 min-h-[88px]"
          />
          <p className="text-[10px] text-zinc-600 tabular-nums">{reason.trim().length}/400 · minimum 10</p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
          >
            {busy ? 'Suspending…' : 'Suspend school'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Metadata form type + helpers ──────────────────────────────────────────

interface MetaForm {
  name: string
  domain: string
  address: string
  city: string
  phone: string
  email: string
  board: string
  academicYear: string
  themeColor: string
  accentColor: string
}

function metaFromSchool(s: SchoolRecord): MetaForm {
  return {
    name: s.name,
    domain: s.domain ?? '',
    address: s.address ?? '',
    city: s.city ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    board: s.board,
    academicYear: s.academicYear ?? '',
    themeColor: s.themeColor,
    accentColor: s.accentColor,
  }
}

/** Only genuinely changed fields are PATCHed (server audits field-by-field). */
function diffMeta(form: MetaForm, school: SchoolRecord): Partial<MetaForm> {
  const out: Partial<MetaForm> = {}
  if (form.name.trim() !== school.name) out.name = form.name.trim()
  if (form.domain.trim() !== (school.domain ?? '')) out.domain = form.domain.trim()
  if (form.address.trim() !== (school.address ?? '')) out.address = form.address.trim()
  if (form.city.trim() !== (school.city ?? '')) out.city = form.city.trim()
  if (form.phone.trim() !== (school.phone ?? '')) out.phone = form.phone.trim()
  if (form.email.trim() !== (school.email ?? '')) out.email = form.email.trim()
  if (form.board !== school.board) out.board = form.board
  if (form.academicYear.trim() !== (school.academicYear ?? '')) out.academicYear = form.academicYear.trim()
  if (form.themeColor !== school.themeColor) out.themeColor = form.themeColor
  if (form.accentColor !== school.accentColor) out.accentColor = form.accentColor
  return out
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-semibold text-zinc-300">
          {label}
        </Label>
        <span className="font-mono text-[10px] text-zinc-500">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-zinc-800 bg-zinc-950 p-1 focus-ring"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0f766e"
          aria-label={`${label} hex value`}
          className="h-11 flex-1 bg-zinc-950 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-emerald-500/40"
        />
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${
            tone === 'amber' ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800/80 text-zinc-400'
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-zinc-50 tabular-nums">{value}</p>
    </div>
  )
}

// ── Module ────────────────────────────────────────────────────────────────

export function SchoolDetailModule() {
  const { can } = usePlatformSession()
  const router = useRouter()
  const params = useParams()
  const rawId: unknown = params.id
  const id =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId) && typeof rawId[0] === 'string'
        ? rawId[0]
        : undefined
  const { gate, node: stepUpNode } = useStepUpGate()

  const [data, setData] = useState<SchoolDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [accessOpen, setAccessOpen] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [meta, setMeta] = useState<MetaForm | null>(null)
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaSavedFields, setMetaSavedFields] = useState<string[] | null>(null)

  const [planChoice, setPlanChoice] = useState<string>('STANDARD')
  const [planReason, setPlanReason] = useState('')
  const [planBusy, setPlanBusy] = useState(false)

  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [flagBusy, setFlagBusy] = useState<string | null>(null)

  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      setData(await platformApi<SchoolDetailData>(`/api/platform/schools/${id}`))
    } catch (e) {
      const err = e as PlatformApiError
      if (err.code === 'RESOURCE_NOT_FOUND') {
        setNotFound(true)
      } else {
        setError(err.error || 'Failed to load the school')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  // Sync local editors whenever fresh data lands.
  useEffect(() => {
    if (data) {
      setMeta(metaFromSchool(data.school))
      setPlanChoice(data.school.plan)
      setPlanReason('')
      setFlags(data.school.featureFlags)
    }
  }, [data])

  const school = data?.school

  // Metadata diff — drives the save button + changed-fields feedback.
  const metaDiff = useMemo(
    () => (meta && school ? diffMeta(meta, school) : {}),
    [meta, school],
  )
  const metaChangedKeys = Object.keys(metaDiff)

  const setMetaField = <K extends keyof MetaForm>(key: K, value: string) =>
    setMeta((m) => (m ? { ...m, [key]: value } : m))

  const saveMeta = async () => {
    if (!id || !school || metaChangedKeys.length === 0) return
    setMetaBusy(true)
    try {
      const res = await platformApi<{ ok: true; updatedFields: string[] }>(
        `/api/platform/schools/${id}`,
        { method: 'PATCH', body: JSON.stringify(metaDiff) },
      )
      toast.success(
        res.updatedFields.length > 0
          ? `School updated — ${res.updatedFields.join(', ')}`
          : 'School saved — no effective changes',
      )
      setMetaSavedFields(res.updatedFields)
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Could not save the metadata')
    } finally {
      setMetaBusy(false)
    }
  }

  const changePlan = async () => {
    if (!id || !school) return
    setPlanBusy(true)
    try {
      const res = await gate(() =>
        platformApi(`/api/platform/schools/${id}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({
            plan: planChoice,
            ...(planReason.trim() ? { reason: planReason.trim() } : {}),
          }),
        }),
      )
      if (!res) return // cancelled at the step-up prompt
      toast.success(`Plan changed to ${planChoice}`)
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Plan change failed')
    } finally {
      setPlanBusy(false)
    }
  }

  const toggleFlag = async (module: string, label: string, next: boolean) => {
    if (!id || !school) return
    const previous = flags
    setFlags((f) => ({ ...f, [module]: next }))
    setFlagBusy(module)
    try {
      const res = await platformApi<{ ok: true; featureFlags: Record<string, boolean> }>(
        `/api/platform/schools/${id}/feature-flags`,
        { method: 'PATCH', body: JSON.stringify({ [module]: next }) },
      )
      setFlags(res.featureFlags)
      setData((d) => (d ? { ...d, school: { ...d.school, featureFlags: res.featureFlags } } : d))
      toast.success(`${label} ${next ? 'enabled' : 'disabled'} for this school`)
    } catch (e) {
      setFlags(previous)
      const err = e as PlatformApiError
      toast.error(err.error || 'Could not update the module flag')
    } finally {
      setFlagBusy(null)
    }
  }

  const runStatusAction = async (action: 'activate' | 'reactivate') => {
    if (!id) return
    setStatusBusy(action)
    try {
      await platformApi(`/api/platform/schools/${id}/${action}`, { method: 'POST' })
      toast.success(action === 'activate' ? 'School activated — users can now sign in' : 'School reactivated — service restored')
      await reload()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'The status change failed')
    } finally {
      setStatusBusy(null)
    }
  }

  const deleteSchool = async () => {
    if (!id || !school || deleteTyped.trim() !== school.name) return
    setDeleteBusy(true)
    try {
      const res = await gate(() =>
        platformApi(`/api/platform/schools/${id}?confirmName=${encodeURIComponent(deleteTyped.trim())}`, {
          method: 'DELETE',
        }),
      )
      if (!res) {
        setDeleteBusy(false) // cancelled at the step-up prompt
        return
      }
      toast.success(`School ${school.name} deleted`)
      router.push('/platform/schools')
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Deletion failed')
      setDeleteBusy(false)
    }
  }

  // ── Guards & early states ─────────────────────────────────────────────

  if (!id) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm font-semibold text-zinc-200">No school selected</p>
        <Link
          href="/platform/schools"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 focus-ring rounded"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to schools
        </Link>
      </section>
    )
  }

  if (loading && !data) {
    return (
      <section className="space-y-4 sm:space-y-5" aria-busy="true">
        <Skeleton className="h-8 w-64 bg-zinc-800" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <Skeleton className="h-3 w-20 bg-zinc-800" />
              <Skeleton className="mt-3 h-7 w-12 bg-zinc-800" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full bg-zinc-800/60" />
      </section>
    )
  }

  if (notFound) {
    return (
      <section className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/70 text-zinc-500 ring-1 ring-zinc-700/60">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-3 font-display text-lg font-bold text-zinc-100">School not found</h1>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          This tenant does not exist (or was deleted). Platform audit entries survive deletions by design.
        </p>
        <Button asChild size="sm" className="mt-5 h-10 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring">
          <Link href="/platform/schools">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to schools
          </Link>
        </Button>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section
        role="alert"
        className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex items-start gap-2.5 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          className="h-9 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus-ring"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </section>
    )
  }

  if (!school || !data) return null

  const canManage = can('schools.manage')
  const canBill = can('billing.manage')
  const canSupport = can('support.access')

  const profile: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    { icon: <Globe className="h-3.5 w-3.5" />, label: 'Domain', value: school.domain ?? '—' },
    { icon: <MapPin className="h-3.5 w-3.5" />, label: 'City', value: school.city ?? '—' },
    { icon: <Info className="h-3.5 w-3.5" />, label: 'Board', value: school.board },
    { icon: <ClipboardList className="h-3.5 w-3.5" />, label: 'Plan', value: school.plan },
    { icon: <CalendarDays className="h-3.5 w-3.5" />, label: 'Academic year', value: school.academicYear ?? '—' },
    { icon: <History className="h-3.5 w-3.5" />, label: 'Created', value: new Date(school.createdAt).toLocaleString() },
    { icon: <History className="h-3.5 w-3.5" />, label: 'Updated', value: new Date(school.updatedAt).toLocaleString() },
    {
      icon: <Power className="h-3.5 w-3.5" />,
      label: 'Demo tenant',
      value: school.isDemo ? 'Yes — demo data' : 'No',
    },
  ]

  const stats = [
    { label: 'Users', value: num.format(data.counts.users), icon: <Users className="h-4 w-4" /> },
    { label: 'Students', value: num.format(data.counts.students), icon: <GraduationCap className="h-4 w-4" /> },
    { label: 'Teachers', value: num.format(data.counts.teachers), icon: <BookOpen className="h-4 w-4" /> },
    { label: 'Classes', value: num.format(data.counts.classes), icon: <LayoutGrid className="h-4 w-4" /> },
    { label: 'Exams', value: num.format(data.counts.exams), icon: <ClipboardList className="h-4 w-4" /> },
    { label: 'Fees', value: num.format(data.counts.fees), icon: <IndianRupee className="h-4 w-4" /> },
    {
      label: 'School sessions',
      value: num.format(data.activeSchoolSessions),
      icon: <MonitorSmartphone className="h-4 w-4" />,
    },
    {
      label: 'Support sessions',
      value: num.format(data.activeSupportSessions),
      icon: <LifeBuoy className="h-4 w-4" />,
      tone: 'amber' as const,
    },
  ]

  return (
    <section aria-labelledby="school-heading" className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/platform/schools"
            className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-zinc-400 hover:text-emerald-300 focus-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to schools
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1
              id="school-heading"
              className="font-display text-xl sm:text-2xl font-bold tracking-tight text-zinc-50 break-words"
            >
              {school.name}
            </h1>
            <StatusBadge status={school.status} />
            {school.isDemo && (
              <Badge variant="outline" className="border-zinc-600 bg-zinc-800/60 text-zinc-400 normal-case">
                demo
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {school.slug} · {school.code}
          </p>
        </div>
        {canSupport && (
          <Button
            onClick={() => setAccessOpen(true)}
            className="h-11 shrink-0 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold focus-ring"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Access School
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </motion.div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full bg-zinc-900/80 border border-zinc-800 h-auto flex-wrap p-1 gap-1">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="setup"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
          >
            Setup
          </TabsTrigger>
          {canManage && (
            <TabsTrigger
              value="metadata"
              className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
            >
              Metadata
            </TabsTrigger>
          )}
          <TabsTrigger
            value="plan"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
          >
            Plan &amp; Modules
          </TabsTrigger>
          <TabsTrigger
            value="domains"
            className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-300 data-[state=active]:border-emerald-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
          >
            Domains
          </TabsTrigger>
          {canManage && (
            <TabsTrigger
              value="danger"
              className="data-[state=active]:bg-red-500/10 data-[state=active]:text-red-400 data-[state=active]:border-red-500/20 text-zinc-400 px-3 py-1.5 min-h-[36px]"
            >
              Danger zone
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-zinc-100">School profile</h2>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
              {profile.map((p) => (
                <div key={p.label} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    <span className="text-zinc-600" aria-hidden="true">
                      {p.icon}
                    </span>
                    {p.label}
                  </dt>
                  <dd className="mt-1 truncate text-sm text-zinc-200" title={p.value}>
                    {p.value}
                  </dd>
                </div>
                ))}
            </dl>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-zinc-100">Recent school activity</h2>
            </div>
            {data.recentActivity.length > 0 ? (
              <ol className="relative p-4 sm:px-5" aria-label="Recent school activity">
                {data.recentActivity.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                    {i < data.recentActivity.length - 1 && (
                      <span
                        className="absolute left-[7px] top-4 h-full w-px bg-zinc-800"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className="relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-500/70 ring-4 ring-zinc-900"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="font-mono text-xs font-semibold text-zinc-200">{a.action}</p>
                        <span
                          className="text-[11px] tabular-nums text-zinc-500"
                          title={new Date(a.at).toLocaleString()}
                        >
                          {timeAgo(a.at)}
                        </span>
                      </div>
                      {a.detail && (
                        <p className="mt-0.5 break-words text-xs leading-snug text-zinc-500">{a.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/70 text-zinc-500 ring-1 ring-zinc-700/60">
                  <History className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm font-semibold text-zinc-200">No school activity recorded yet</p>
                <p className="mt-1 max-w-xs text-xs leading-snug text-zinc-500">
                  Tenant-side events (sign-ins, marks, fee actions) will appear here.
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Metadata tab (schools.manage) ───────────────────────────── */}
        {canManage && meta && (
          <TabsContent value="metadata">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
              <div className="flex flex-col gap-1 border-b border-zinc-800/80 px-4 py-3.5 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold text-zinc-100">School metadata</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Profile, contact and branding — audited field-by-field.
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    metaChangedKeys.length > 0 ? 'text-amber-300' : 'text-zinc-600'
                  }`}
                  aria-live="polite"
                >
                  {metaChangedKeys.length > 0
                    ? `${metaChangedKeys.length} unsaved change${metaChangedKeys.length === 1 ? '' : 's'}`
                    : metaSavedFields
                      ? `Saved: ${metaSavedFields.join(', ')}`
                      : 'No unsaved changes'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="meta-name" className="text-xs font-semibold text-zinc-300">
                    Name
                  </Label>
                  <Input
                    id="meta-name"
                    value={meta.name}
                    onChange={(e) => setMetaField('name', e.target.value)}
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-domain" className="text-xs font-semibold text-zinc-300">
                    Domain
                  </Label>
                  <Input
                    id="meta-domain"
                    value={meta.domain}
                    onChange={(e) => setMetaField('domain', e.target.value)}
                    placeholder="school.edu.in"
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-city" className="text-xs font-semibold text-zinc-300">
                    City
                  </Label>
                  <Input
                    id="meta-city"
                    value={meta.city}
                    onChange={(e) => setMetaField('city', e.target.value)}
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="meta-address" className="text-xs font-semibold text-zinc-300">
                    Address
                  </Label>
                  <Input
                    id="meta-address"
                    value={meta.address}
                    onChange={(e) => setMetaField('address', e.target.value)}
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-phone" className="text-xs font-semibold text-zinc-300">
                    Phone
                  </Label>
                  <Input
                    id="meta-phone"
                    value={meta.phone}
                    onChange={(e) => setMetaField('phone', e.target.value)}
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-email" className="text-xs font-semibold text-zinc-300">
                    Contact email
                  </Label>
                  <Input
                    id="meta-email"
                    type="email"
                    value={meta.email}
                    onChange={(e) => setMetaField('email', e.target.value)}
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-board" className="text-xs font-semibold text-zinc-300">
                    Board
                  </Label>
                  <Select value={meta.board} onValueChange={(v) => setMetaField('board', v)}>
                    <SelectTrigger
                      id="meta-board"
                      className="h-11 w-full bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                    >
                      <SelectValue />
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
                <div className="space-y-1.5">
                  <Label htmlFor="meta-year" className="text-xs font-semibold text-zinc-300">
                    Academic year
                  </Label>
                  <Input
                    id="meta-year"
                    value={meta.academicYear}
                    onChange={(e) => setMetaField('academicYear', e.target.value)}
                    placeholder="2025-26"
                    className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40"
                  />
                </div>
                <ColorField
                  id="meta-theme"
                  label="Theme color"
                  value={meta.themeColor}
                  onChange={(v) => setMetaField('themeColor', v)}
                />
                <ColorField
                  id="meta-accent"
                  label="Accent color"
                  value={meta.accentColor}
                  onChange={(v) => setMetaField('accentColor', v)}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-800/80 p-4 sm:px-5">
                <p className="mr-auto hidden items-center gap-1.5 text-[11px] text-zinc-600 sm:flex">
                  <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                  Colors apply to the school workspace
                </p>
                <Button
                  variant="outline"
                  onClick={() => setMeta(metaFromSchool(school))}
                  disabled={metaBusy || metaChangedKeys.length === 0}
                  className="h-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
                >
                  Reset
                </Button>
                <Button
                  onClick={() => void saveMeta()}
                  disabled={metaBusy || metaChangedKeys.length === 0}
                  className="h-11 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
                >
                  {metaBusy ? 'Saving…' : `Save ${metaChangedKeys.length > 0 ? `(${metaChangedKeys.length})` : ''}`}
                </Button>
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── Plan & Modules tab ───────────────────────────────────────── */}
        <TabsContent value="plan" className="space-y-4">
          {/* Plan (billing.manage) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-zinc-100">Subscription plan</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Billing-impacting change — requires billing.manage and step-up verification.
              </p>
            </div>
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:px-5">
              <div className="shrink-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Current plan</p>
                <p className="mt-1 flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm px-3 py-1"
                  >
                    {school.plan}
                  </Badge>
                </p>
              </div>
              {canBill ? (
                <>
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="plan-select" className="text-xs font-semibold text-zinc-300">
                      Change plan to
                    </Label>
                    <Select value={planChoice} onValueChange={setPlanChoice}>
                      <SelectTrigger
                        id="plan-select"
                        className="h-11 w-full bg-zinc-950 border-zinc-800 text-zinc-100 focus-visible:ring-emerald-500/40 sm:w-56"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                        {SCHOOL_PLANS.map((p) => (
                          <SelectItem key={p} value={p} className="focus:bg-zinc-800">
                            {p}
                            {p === school.plan ? ' (current)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => void changePlan()}
                    disabled={planBusy || planChoice === school.plan}
                    className="h-11 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
                  >
                    {planBusy ? 'Changing…' : 'Change plan'}
                  </Button>
                </>
              ) : (
                <p className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-xs text-zinc-500">
                  You do not hold <span className="font-mono text-zinc-400">billing.manage</span> — plan
                  changes are read-only for you.
                </p>
              )}
            </div>
            {canBill && (
              <div className="space-y-1.5 border-t border-zinc-800/80 p-4 sm:px-5">
                <Label htmlFor="plan-reason" className="text-xs font-semibold text-zinc-300">
                  Reason (optional, audited)
                </Label>
                <Textarea
                  id="plan-reason"
                  value={planReason}
                  onChange={(e) => setPlanReason(e.target.value)}
                  placeholder="e.g. Upgraded to PRO after the signed Q2 order #4412"
                  rows={2}
                  maxLength={400}
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40"
                />
              </div>
            )}
          </div>

          {/* Feature flags (schools.manage) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
            <div className="border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
              <h2 className="font-display text-sm font-bold text-zinc-100">Module availability</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Effective availability ={' '}
                <span className="font-mono text-zinc-400">school override ?? platform master ?? enabled</span>{' '}
                — a missing override falls back to the platform-wide master switch.
              </p>
            </div>
            <ul className="divide-y divide-zinc-800/60">
              {FLAGGABLE_MODULES.map((module) => {
                const label = module.charAt(0).toUpperCase() + module.slice(1)
                const override = typeof flags[module] === 'boolean' ? flags[module] : null
                const checked = override ?? true
                return (
                  <li
                    key={module}
                    className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{label}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {override === null ? (
                          <span className="text-zinc-500">No override — platform default applies</span>
                        ) : override ? (
                          <span className="text-emerald-400">Enabled for this school (override)</span>
                        ) : (
                          <span className="text-red-400">Disabled for this school (override)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {flagBusy === module && (
                        <span className="text-[11px] text-zinc-500" role="status">
                          saving…
                        </span>
                      )}
                      <Switch
                        checked={checked}
                        disabled={!canManage || flagBusy === module}
                        onCheckedChange={(next) => void toggleFlag(module, label, next)}
                        aria-label={`${label} module ${checked ? 'enabled' : 'disabled'} — toggle override for this school`}
                        className="data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-700 focus-ring"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
            {!canManage && (
              <p className="border-t border-zinc-800/80 px-4 py-3 text-xs text-zinc-500 sm:px-5">
                You do not hold <span className="font-mono text-zinc-400">schools.manage</span> — the switches
                are read-only for you.
              </p>
            )}
          </div>
        </TabsContent>

        {/* ── Custom Domains tab (PHASE 8B — multi-tenant domains) ─────── */}
        <TabsContent value="domains" className="space-y-4">
          <SchoolDomainsTab schoolId={id} canManage={canManage} />
        </TabsContent>

        {/* ── Setup readiness (PHASE 8C §12 — DB-computed progress) ──── */}
        <TabsContent value="setup" className="space-y-4">
          <SchoolSetupTab schoolId={id} schoolStatus={data?.school.status ?? 'PENDING'} />
        </TabsContent>

        {/* ── Danger zone (schools.manage) ────────────────────────────── */}
        {canManage && (
          <TabsContent value="danger">
            <div className="space-y-4 rounded-xl border-2 border-red-500/30 bg-red-500/[0.04] p-4 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                  <ShieldAlert className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold text-red-300">Danger zone</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Status control and irreversible deletion. Suspend and delete require step-up
                    verification; everything is audited.
                  </p>
                </div>
              </div>

              {/* Status actions */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-zinc-100">School status</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Current status:{' '}
                  <StatusBadge status={school.status} />{' '}
                  {school.status === 'PENDING' &&
                    '— users of this school cannot sign in until it is activated.'}
                  {school.status === 'ACTIVE' && '— suspending signs every user out immediately.'}
                  {school.status === 'SUSPENDED' && '— sign-in is blocked; reactivate to restore service.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {school.status === 'PENDING' && (
                    <Button
                      onClick={() => void runStatusAction('activate')}
                      disabled={statusBusy !== null}
                      className="h-11 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
                    >
                      <Power className="h-4 w-4" aria-hidden="true" />
                      {statusBusy === 'activate' ? 'Activating…' : 'Activate school'}
                    </Button>
                  )}
                  {school.status === 'ACTIVE' && (
                    <Button
                      onClick={() => setSuspendOpen(true)}
                      disabled={statusBusy !== null}
                      className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      Suspend school
                    </Button>
                  )}
                  {school.status === 'SUSPENDED' && (
                    <Button
                      onClick={() => void runStatusAction('reactivate')}
                      disabled={statusBusy !== null}
                      className="h-11 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
                    >
                      <Power className="h-4 w-4" aria-hidden="true" />
                      {statusBusy === 'reactivate' ? 'Reactivating…' : 'Reactivate school'}
                    </Button>
                  )}
                  {school.status === 'TRIAL' && (
                    <p className="text-xs text-zinc-500">
                      This school is in TRIAL state — status actions apply to PENDING, ACTIVE and SUSPENDED.
                    </p>
                  )}
                </div>
              </div>

              {/* Delete */}
              <div className="rounded-xl border border-red-500/30 bg-zinc-900/60 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-zinc-100">Delete this school</h3>
                <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-zinc-500">
                  Permanently deletes <span className="font-semibold text-zinc-300">{school.name}</span> and{' '}
                  <span className="font-semibold text-red-400">every tenant row</span> — users, students,
                  teachers, classes, subjects, exams, marks, fees, payments, attendance, timetables, homework,
                  library records and messages. This is a full cascade and{' '}
                  <span className="font-semibold text-zinc-300">cannot be undone</span>. Platform audit
                  entries survive (by design) so the deletion itself remains traceable.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteTyped('')
                    setDeleteOpen(true)
                  }}
                  disabled={deleteBusy}
                  className="mt-4 h-11 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 font-semibold focus-ring"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete school
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs + the shared step-up TOTP prompt */}
      {canSupport && (
        <AccessDialog
          open={accessOpen}
          onOpenChange={setAccessOpen}
          schoolId={id}
          schoolName={school.name}
          gate={gate}
        />
      )}
      <SuspendDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        schoolId={id}
        schoolName={school.name}
        gate={gate}
        onSuspended={() => void reload()}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="bg-zinc-900 border-red-500/40 text-zinc-100 sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-red-300">
              Delete {school.name} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This cascades through the entire tenant — {num.format(data.counts.users)} users,{' '}
              {num.format(data.counts.students)} students, {num.format(data.counts.teachers)} teachers and
              every dependent row (exams, marks, fees, payments, attendance, timetables, homework, library,
              messages). It cannot be undone. Type the school&apos;s exact name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm" className="text-xs font-semibold text-zinc-300">
              Type <span className="font-mono font-bold text-red-300">{school.name}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder={school.name}
              autoComplete="off"
              aria-invalid={deleteTyped.length > 0 && deleteTyped.trim() !== school.name}
              className="h-11 bg-zinc-950 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-red-500/40"
            />
            {deleteTyped.length > 0 && deleteTyped.trim() !== school.name && (
              <p role="alert" className="text-[11px] text-red-400">
                The name does not match yet.
              </p>
            )}
          </div>
          <AlertDialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
              className="h-11 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 focus-ring"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void deleteSchool()}
              disabled={deleteBusy || deleteTyped.trim() !== school.name}
              className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {deleteBusy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {stepUpNode}
    </section>
  )
}
