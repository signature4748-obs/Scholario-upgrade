'use client'

/**
 * PHASE 2 — SUPER ADMIN CONTROL CENTER — the guided School Setup Wizard.
 *
 * Rendered inside the Setup destination of the school workspace
 * (/platform/schools/[id]?tab=setup). It is a guided view over REAL,
 * PERSISTED configuration:
 *
 *   · progress is DERIVED from the live database (the shared readiness
 *     engine + wizard counts served by GET …/setup-wizard) — never a
 *     client-side counter, never a fabricated badge;
 *   · every "Save and continue" writes through its own audited
 *     platform route and re-reads the server truth before advancing;
 *   · completed steps can be reopened and edited — data lives
 *     server-side, so navigating away or refreshing loses nothing;
 *   · optional steps (people, fees, exams, website, modules, branding)
 *     are explicitly optional and never block activation;
 *   · activation is server-validated: the review screen shows the
 *     strict checklist verdict, and the Activate action sends
 *     { requireComplete: true } so the server enforces the SAME
 *     checklist (deriveActivationRequirements) before transitioning.
 *
 * After activation the school owns its routine work — the wizard points
 * the operator at the ongoing governance editors (single home per
 * domain) instead of duplicating them.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Circle,
  CircleDashed,
  ClipboardCheck,
  Copy,
  GraduationCap,
  Layers,
  Palette,
  RefreshCw,
  School,
  ShieldAlert,
  UserCog,
  Users,
  Wallet,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'

// ── API contract (mirrors GET /api/platform/schools/[id]/setup-wizard) ──

type WizardStepState = 'not_started' | 'in_progress' | 'completed'

interface WizardStep {
  id: string
  label: string
  optional: boolean
  status: WizardStepState
  detail: string
  manageAnchor?: string
}

interface WizardLocation {
  state: string | null
  district: string | null
  pincode: string | null
  country: string | null
  timezone: string | null
  workingDays: string[]
  websiteEnabled: boolean
}

interface WizardSchool {
  id: string
  name: string
  shortName: string | null
  tagline: string | null
  slug: string
  code: string
  plan: string
  status: string
  board: string
  academicYear: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  established: string | null
  themeColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  location: WizardLocation
}

interface WizardPrincipal {
  id: string
  email: string
  name: string | null
  phone: string | null
  status: string
  credentialState: 'BOOTSTRAP_PENDING' | 'OWNED' | 'UNKNOWN'
  lastLoginAt: string | null
  credentialExpiresAt: string | null
  invitation: { state: string; errorClass?: string }
}

interface SetupWizardState {
  school: WizardSchool
  readiness: {
    summary: {
      requiredTotal: number
      requiredDone: number
      requiredComplete: boolean
      optionalDone: number
      optionalTotal: number
      usable: boolean
    }
  }
  steps: WizardStep[]
  access: { loginUrl: string; publicUrl: string }
  activation: {
    ok: boolean
    missing: Array<{ id: string; label: string; fix: string }>
    wizardChecklistOk: boolean
    wizardMissing: Array<{ id: string; label: string; fix: string }>
  }
  principal: WizardPrincipal | null
  counts: {
    teachers: number
    classes: number
    subjects: number
    masterFeeHeads: number
    feeStructures: number
    examTypes: number
    gradeScales: number
  }
  modules: {
    master: Record<string, boolean>
    school: Record<string, boolean>
    effective: Record<string, boolean>
    admissionsIssuance: boolean
  }
  website: {
    enabled: boolean
    hero: { badgePrefix: string; title: string; titleAccent: string; description: string }
    about: { title: string; subtitle: string }
    contact: { title: string; subtitle: string }
    seo: { title?: string; description?: string }
  }
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

const FIELD =
  'h-11 bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40'
const FIELD_AREA =
  'min-h-[88px] bg-white border-slate-200 text-slate-900 focus-visible:ring-teal-500/40'

const SCHOOL_BOARDS = ['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM'] as const
const BOARD_LABELS: Record<string, string> = {
  CBSE: 'CBSE',
  UP_BOARD: 'UP Board',
  ICSE: 'ICSE',
  STATE: 'State board',
  CUSTOM: 'Other / custom',
}

const WORK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const
const WORK_DAY_LABELS: Record<string, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
}

const CLASS_STREAMS = [
  'Science-PCM',
  'Science-PCB',
  'Science-PCMB',
  'Commerce',
  'Humanities',
  'General',
] as const
const STREAM_LABELS: Record<string, string> = {
  'Science-PCM': 'Science (PCM)',
  'Science-PCB': 'Science (PCB)',
  'Science-PCMB': 'Science (PCMB)',
  Commerce: 'Commerce',
  Humanities: 'Humanities / Arts',
  General: 'General',
}

/** Class presets (name + default sections) — the same shapes the
 *  provisioning wizard offers; every school picks only what applies. */
const CLASS_PRESETS: Array<{ label: string; classes: Array<{ name: string; sections: string[] }> }> = [
  {
    label: 'Pre-Primary',
    classes: [
      { name: 'Nursery', sections: ['A'] },
      { name: 'LKG', sections: ['A'] },
      { name: 'UKG', sections: ['A'] },
    ],
  },
  {
    label: 'Class 1–5',
    classes: Array.from({ length: 5 }, (_, i) => ({ name: `Class ${i + 1}`, sections: ['A'] })),
  },
  {
    label: 'Class 6–8',
    classes: Array.from({ length: 3 }, (_, i) => ({ name: `Class ${i + 6}`, sections: ['A'] })),
  },
  {
    label: 'Class 9–10',
    classes: Array.from({ length: 2 }, (_, i) => ({ name: `Class ${i + 9}`, sections: ['A'] })),
  },
  {
    label: 'Class 11–12',
    classes: [
      { name: 'Class 11', sections: ['A'], },
      { name: 'Class 12', sections: ['A'] },
    ],
  },
]

const FEE_CATEGORIES = [
  'Tuition',
  'Admission',
  'Annual',
  'Transport',
  'Lab',
  'Library',
  'Exam',
  'Activity',
  'Board',
  'Other',
] as const

const FEE_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Annual', 'Per Term', 'One-Time'] as const

/** The 5 flaggable modules (FLAGGABLE_MODULES vocabulary). Defined locally
 *  — the lib module imports the server DB client and must never reach the
 *  client bundle. */
const MODULE_META: Array<{ id: string; label: string; purpose: string }> = [
  { id: 'exams', label: 'Examinations', purpose: 'Exam creation, marks entry and results' },
  { id: 'fees', label: 'Fees', purpose: 'Fee structures, collection and receipts' },
  { id: 'homework', label: 'Homework', purpose: 'Assignments and submissions' },
  { id: 'library', label: 'Library', purpose: 'Book catalogue and issue/return' },
  { id: 'transport', label: 'Transport', purpose: 'Routes and student transport' },
]

const STEP_ICONS: Record<string, React.ReactNode> = {
  identity: <Building2 className="h-4 w-4" aria-hidden="true" />,
  branding: <Palette className="h-4 w-4" aria-hidden="true" />,
  academic: <GraduationCap className="h-4 w-4" aria-hidden="true" />,
  principal: <UserCog className="h-4 w-4" aria-hidden="true" />,
  people: <Users className="h-4 w-4" aria-hidden="true" />,
  fees: <Wallet className="h-4 w-4" aria-hidden="true" />,
  exams: <ClipboardCheck className="h-4 w-4" aria-hidden="true" />,
  website: <Globe className="h-4 w-4" aria-hidden="true" />,
  modules: <Layers className="h-4 w-4" aria-hidden="true" />,
}

function StepStateIcon({ status }: { status: WizardStepState }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
  }
  if (status === 'in_progress') {
    return <Circle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
  }
  return <CircleDashed className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
      {message}
    </p>
  )
}

// ════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════

export function SchoolSetupWizard({
  schoolId,
  canManage,
  onNavigateTab,
  onChanged,
}: {
  schoolId: string
  canManage: boolean
  /** Deep-link into a Setup sub-section (governance editors). */
  onNavigateTab?: (tab: string) => void
  /** Notify the workspace that persisted school data changed. */
  onChanged?: () => void
}) {
  const [data, setData] = useState<SetupWizardState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openStep, setOpenStep] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<SetupWizardState | null> => {
    try {
      const res = await platformApi<SetupWizardState>(`/api/platform/schools/${schoolId}/setup-wizard`)
      setData(res)
      setLoadError(null)
      return res
    } catch (e) {
      setLoadError(errText(e))
      return null
    }
  }, [schoolId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const res = await reload()
      if (!cancelled) setLoading(false)
      if (res) {
        // Resume: open the first incomplete section (required first —
        // they are already first in the step order).
        const first = res.steps.find((s) => s.status !== 'completed')
        setOpenStep(first?.id ?? null)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId])

  const completedCount = data?.steps.filter((s) => s.status === 'completed').length ?? 0

  const advanceFrom = (fresh: SetupWizardState, fromId: string) => {
    const idx = fresh.steps.findIndex((s) => s.id === fromId)
    const next = fresh.steps.slice(idx + 1).find((s) => s.status !== 'completed')
    setOpenStep(next?.id ?? null)
  }

  const handleSaved = useCallback(
    async (fromStep: string, opts: { advance?: boolean } = {}) => {
      const fresh = await reload()
      onChanged?.()
      if (fresh && opts.advance !== false) advanceFrom(fresh, fromStep)
      return fresh
    },
    [reload, onChanged],
  )

  // Fail-closed: an unavailable wizard surface must never look "done".
  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading setup wizard">
        <Skeleton className="h-24 w-full rounded-xl" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    )
  }
  if (loadError && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-red-700">Setup wizard unavailable</h2>
        </div>
        <p className="mt-2 text-xs text-slate-500">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          className="mt-4 h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
        </Button>
      </div>
    )
  }
  if (!data) return null

  const school = data.school
  const logoPreview = school.logoUrl ? `/api/public/website/media/${school.logoUrl}` : null
  const active = school.status === 'ACTIVE'

  return (
    <div className="space-y-4" data-testid="setup-wizard">
      {/* ── Header: where am I · what is done · what remains ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt={`${school.name} logo`}
                className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400"
                aria-hidden="true"
              >
                <School className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-bold text-slate-900">{school.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Complete the essential details to prepare your school on Scholario.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                active
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : school.status === 'SUSPENDED'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {school.status}
            </span>
            <Button
              size="sm"
              onClick={() => {
                const first = data.steps.find((s) => s.status !== 'completed')
                setOpenStep(first?.id ?? null)
                if (!first) document.getElementById('wizard-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              disabled={!canManage}
              className="h-9 bg-teal-600 text-white hover:bg-teal-700 focus-ring"
            >
              {completedCount === data.steps.length ? 'Review Setup' : 'Continue Setup'}
            </Button>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700" aria-live="polite">
              {completedCount} of {data.steps.length} sections complete
            </span>
            <span className="tabular-nums text-slate-500">
              Required: {data.steps.filter((s) => !s.optional && s.status === 'completed').length}/
              {data.steps.filter((s) => !s.optional).length} · Optional:{' '}
              {data.steps.filter((s) => s.optional && s.status === 'completed').length}/
              {data.steps.filter((s) => s.optional).length}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={data.steps.length}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-teal-500 transition-[width] duration-500"
              style={{ width: `${Math.round((completedCount / data.steps.length) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Steps ── */}
      <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {data.steps.map((step, i) => (
          <li key={step.id} className={i > 0 ? 'border-t border-slate-200' : ''}>
            <button
              type="button"
              onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
              aria-expanded={openStep === step.id}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 sm:px-5"
            >
              <StepStateIcon status={step.status} />
              <span className="text-slate-400" aria-hidden="true">
                {STEP_ICONS[step.id]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{step.label}</span>
                  <span
                    className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${
                      step.optional
                        ? 'border-slate-200 bg-slate-100 text-slate-600'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {step.optional ? 'Optional' : 'Required'}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{step.detail}</span>
              </span>
            </button>
            {openStep === step.id && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
                {step.id === 'identity' && (
                  <IdentityEditor schoolId={schoolId} school={school} canManage={canManage} onSaved={handleSaved} />
                )}
                {step.id === 'branding' && (
                  <BrandingEditor schoolId={schoolId} school={school} canManage={canManage} onSaved={handleSaved} />
                )}
                {step.id === 'academic' && (
                  <AcademicEditor
                    schoolId={schoolId}
                    school={school}
                    counts={data.counts}
                    canManage={canManage}
                    onSaved={handleSaved}
                  />
                )}
                {step.id === 'principal' && (
                  <PrincipalEditor
                    schoolId={schoolId}
                    principal={data.principal}
                    loginUrl={data.access.loginUrl}
                    canManage={canManage}
                    onSaved={handleSaved}
                  />
                )}
                {step.id === 'people' && (
                  <PeopleEditor schoolId={schoolId} counts={data.counts} canManage={canManage} onSaved={handleSaved} />
                )}
                {step.id === 'fees' && (
                  <FeesEditor schoolId={schoolId} counts={data.counts} canManage={canManage} onSaved={handleSaved} />
                )}
                {step.id === 'exams' && (
                  <ExamsEditor schoolId={schoolId} counts={data.counts} canManage={canManage} onSaved={handleSaved} />
                )}
                {step.id === 'website' && (
                  <WebsiteEditor
                    schoolId={schoolId}
                    website={data.website}
                    canManage={canManage}
                    onSaved={handleSaved}
                    onNavigateTab={onNavigateTab}
                  />
                )}
                {step.id === 'modules' && (
                  <ModulesEditor schoolId={schoolId} modules={data.modules} canManage={canManage} onSaved={handleSaved} />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* ── Review & activate ── */}
      <ReviewActivateCard
        data={data}
        canManage={canManage}
        onChanged={onChanged}
        reload={reload}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 1 — School identity
// ════════════════════════════════════════════════════════════════════

interface IdentityForm {
  name: string
  shortName: string
  website: string
  established: string
  address: string
  city: string
  phone: string
  email: string
  board: string
  state: string
  district: string
  pincode: string
  country: string
}

function IdentityEditor({
  schoolId,
  school,
  canManage,
  onSaved,
}: {
  schoolId: string
  school: WizardSchool
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [form, setForm] = useState<IdentityForm>({
    name: school.name,
    shortName: school.shortName ?? '',
    website: school.website ?? '',
    established: school.established ?? '',
    address: school.address ?? '',
    city: school.city ?? '',
    phone: school.phone ?? '',
    email: school.email ?? '',
    board: school.board,
    state: school.location.state ?? '',
    district: school.location.district ?? '',
    pincode: school.location.pincode ?? '',
    country: school.location.country ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof IdentityForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      const trimmed = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
      ) as Record<string, string>
      if (trimmed.name !== school.name) payload.name = trimmed.name
      if (trimmed.shortName !== (school.shortName ?? '')) payload.shortName = trimmed.shortName || undefined
      if (trimmed.website !== (school.website ?? '')) payload.website = trimmed.website || undefined
      if (trimmed.established !== (school.established ?? '')) payload.established = trimmed.established || undefined
      if (trimmed.address !== (school.address ?? '')) payload.address = trimmed.address
      if (trimmed.city !== (school.city ?? '')) payload.city = trimmed.city
      if (trimmed.phone !== (school.phone ?? '')) payload.phone = trimmed.phone
      if (trimmed.email !== (school.email ?? '')) payload.email = trimmed.email
      if (trimmed.board !== school.board) payload.board = trimmed.board
      const settings: Record<string, string> = {}
      if (trimmed.state !== (school.location.state ?? '')) settings.state = trimmed.state
      if (trimmed.district !== (school.location.district ?? '')) settings.district = trimmed.district
      if (trimmed.pincode !== (school.location.pincode ?? '')) settings.pincode = trimmed.pincode
      if (trimmed.country !== (school.location.country ?? '')) settings.country = trimmed.country
      if (Object.keys(settings).length > 0) payload.settings = settings
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing to save — no changes')
        if (advance) await onSaved('identity')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      toast.success('School identity saved')
      await onSaved('identity', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-name" className="text-xs font-semibold text-slate-700">Official school name *</Label>
          <Input id="wiz-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-short" className="text-xs font-semibold text-slate-700">Display name</Label>
          <Input id="wiz-short" value={form.shortName} onChange={(e) => set('shortName', e.target.value)} placeholder="e.g. Green Valley" className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-board" className="text-xs font-semibold text-slate-700">Education board *</Label>
          <Select value={form.board} onValueChange={(v) => set('board', v)} disabled={!canManage}>
            <SelectTrigger id="wiz-board" className={`${FIELD} w-full`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCHOOL_BOARDS.map((b) => (
                <SelectItem key={b} value={b}>{BOARD_LABELS[b]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wiz-address" className="text-xs font-semibold text-slate-700">Address *</Label>
          <Input id="wiz-address" value={form.address} onChange={(e) => set('address', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-city" className="text-xs font-semibold text-slate-700">City *</Label>
          <Input id="wiz-city" value={form.city} onChange={(e) => set('city', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-district" className="text-xs font-semibold text-slate-700">District</Label>
          <Input id="wiz-district" value={form.district} onChange={(e) => set('district', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-state" className="text-xs font-semibold text-slate-700">State</Label>
          <Input id="wiz-state" value={form.state} onChange={(e) => set('state', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-pincode" className="text-xs font-semibold text-slate-700">Postal code</Label>
          <Input id="wiz-pincode" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-country" className="text-xs font-semibold text-slate-700">Country</Label>
          <Input id="wiz-country" value={form.country} onChange={(e) => set('country', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-phone" className="text-xs font-semibold text-slate-700">Official contact number *</Label>
          <Input id="wiz-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-email" className="text-xs font-semibold text-slate-700">Official email *</Label>
          <Input id="wiz-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-website" className="text-xs font-semibold text-slate-700">Website URL</Label>
          <Input id="wiz-website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="school.edu.in" className={`${FIELD} font-mono`} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-established" className="text-xs font-semibold text-slate-700">Established year</Label>
          <Input id="wiz-established" value={form.established} onChange={(e) => set('established', e.target.value)} placeholder="1998" className={FIELD} disabled={!canManage} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        The school code ({school.code}) and tenant URL are permanent identifiers. Legal name changes later go through the
        identity change request workflow.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 2 — Branding
// ════════════════════════════════════════════════════════════════════

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs font-semibold text-slate-700">{label}</Label>
        <span className="font-mono text-[10px] text-slate-500">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} flex-1 font-mono`} />
      </div>
    </div>
  )
}

function BrandingEditor({
  schoolId,
  school,
  canManage,
  onSaved,
}: {
  schoolId: string
  school: WizardSchool
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [primary, setPrimary] = useState(school.themeColor)
  const [accent, setAccent] = useState(school.accentColor)
  const [shortName, setShortName] = useState(school.shortName ?? '')
  const [tagline, setTagline] = useState(school.tagline ?? '')
  const [logoPreview, setLogoPreview] = useState<string | null>(
    school.logoUrl ? `/api/public/website/media/${school.logoUrl}` : null,
  )
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File, target: 'logo' | 'favicon') => {
    setUploading(target)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      const res = await fetch(`/api/platform/schools/${schoolId}/branding-logo?target=${target}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer))
      const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { fileId: string; url: string }; error?: string } | null
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error || 'Upload failed')
      }
      if (target === 'logo') setLogoPreview(body.data.url)
      toast.success(target === 'logo' ? 'Logo uploaded' : 'Favicon uploaded')
      await onSaved('branding', { advance: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (primary.trim() !== school.themeColor) payload.themeColor = primary.trim()
      if (accent.trim() !== school.accentColor) payload.accentColor = accent.trim()
      if (shortName.trim() !== (school.shortName ?? '')) payload.shortName = shortName.trim() || undefined
      if (tagline.trim() !== (school.tagline ?? '')) payload.tagline = tagline.trim() || undefined
      if (Object.keys(payload).length > 0) {
        await platformApi(`/api/platform/schools/${schoolId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        toast.success('Branding saved')
      } else {
        toast.info('Nothing to save — no changes')
      }
      await onSaved('branding', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Label className="text-xs font-semibold text-slate-700">School logo</Label>
          <div className="flex items-center gap-3">
            {logoPreview ? (
              <img src={logoPreview} alt="School logo preview" className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-contain p-1" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400" aria-hidden="true">
                <School className="h-6 w-6" />
              </span>
            )}
            <div className="space-y-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                {uploading === 'logo' ? 'Uploading…' : logoPreview ? 'Replace logo' : 'Upload logo (PNG/JPG/WebP · ≤ 4 MB)'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={!canManage || uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void upload(f, 'logo')
                    e.target.value = ''
                  }}
                />
              </label>
              <p className="text-[11px] text-slate-400">Stored in the school&apos;s own secure storage — never shared.</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ColorField id="wiz-primary" label="Primary brand color" value={primary} onChange={setPrimary} />
          <ColorField id="wiz-accent" label="Secondary color" value={accent} onChange={setAccent} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-brand-short" className="text-xs font-semibold text-slate-700">Display name</Label>
          <Input id="wiz-brand-short" value={shortName} onChange={(e) => setShortName(e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-tagline" className="text-xs font-semibold text-slate-700">Tagline</Label>
          <Input id="wiz-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Learning with values" className={FIELD} disabled={!canManage} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        The school&apos;s own administrators can refine branding any time from their Settings — this is the initial look.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 3 — Academic configuration
// ════════════════════════════════════════════════════════════════════

interface ClassRow {
  name: string
  sections: string
  stream: string
}

function AcademicEditor({
  schoolId,
  school,
  counts,
  canManage,
  onSaved,
}: {
  schoolId: string
  school: WizardSchool
  counts: SetupWizardState['counts']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [academicYear, setAcademicYear] = useState(school.academicYear ?? '')
  const [workingDays, setWorkingDays] = useState<string[]>(
    school.location.workingDays.length > 0 ? school.location.workingDays : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  )
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [subjects, setSubjects] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (d: string) =>
    setWorkingDays((days) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]))

  const addPreset = (preset: (typeof CLASS_PRESETS)[number]) =>
    setClasses((rows) => {
      const seen = new Set(rows.map((r) => r.name.trim().toLowerCase()))
      const add = preset.classes
        .filter((c) => !seen.has(c.name.toLowerCase()))
        .map((c) => ({ name: c.name, sections: c.sections.join(', '), stream: '' }))
      return [...rows, ...add]
    })

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const year = academicYear.trim()
      if (year && !/^[0-9]{4}[-/][0-9]{4}$/.test(year)) {
        throw new Error('Academic year must look like 2026-2027')
      }
      const payload: Record<string, unknown> = {}
      if (year && year !== (school.academicYear ?? '')) payload.academicYear = year
      const cleanedClasses = classes
        .map((r) => ({
          name: r.name.trim(),
          sections: r.sections
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          ...(r.stream ? { stream: r.stream } : {}),
        }))
        .filter((r) => r.name)
      if (cleanedClasses.length > 0) payload.classes = cleanedClasses
      const subjectList = subjects
        .split(/[,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (subjectList.length > 0) payload.subjects = subjectList
      if (workingDays.length > 0 && workingDays.join() !== school.location.workingDays.join()) {
        payload.workingDays = workingDays
      }
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing to save — no changes')
        if (advance) await onSaved('academic')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast.success('Academic configuration saved')
      setClasses([])
      setSubjects('')
      await onSaved('academic', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-year" className="text-xs font-semibold text-slate-700">Current academic year *</Label>
          <Input id="wiz-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026-2027" className={`${FIELD} font-mono`} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-700">Board</Label>
          <div className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
            {BOARD_LABELS[school.board] ?? school.board}
            <span className="ml-auto text-[10px] text-slate-400">changed in School identity</span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-slate-700">Working days</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">
          {WORK_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              disabled={!canManage}
              aria-pressed={workingDays.includes(d)}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold transition-colors ${
                workingDays.includes(d)
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {WORK_DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs font-semibold text-slate-700">Classes & sections</Label>
          <div className="flex flex-wrap gap-1.5">
            {CLASS_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={!canManage}
                onClick={() => addPreset(p)}
                className="min-h-[32px] rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                + {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-400">
          Add only the classes this school actually offers. Sections like “A, B”. Streams apply to senior classes only.
        </p>
        {classes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
            No new classes in this save — {counts.classes} already exist{counts.classes === 1 ? '' : ' (duplicates are skipped automatically)'}.
          </div>
        ) : (
          <div className="space-y-2">
            {classes.map((row, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
                <div className="col-span-12 sm:col-span-4">
                  <Label htmlFor={`wiz-cls-name-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Class</Label>
                  <Input
                    id={`wiz-cls-name-${i}`}
                    value={row.name}
                    onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    className={`${FIELD} h-10`}
                    disabled={!canManage}
                  />
                </div>
                <div className="col-span-6 sm:col-span-4">
                  <Label htmlFor={`wiz-cls-sec-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Sections</Label>
                  <Input
                    id={`wiz-cls-sec-${i}`}
                    value={row.sections}
                    onChange={(e) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, sections: e.target.value } : r)))}
                    placeholder="A, B"
                    className={`${FIELD} h-10`}
                    disabled={!canManage}
                  />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <Label htmlFor={`wiz-cls-stream-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stream</Label>
                  <Select
                    value={row.stream || 'none'}
                    onValueChange={(v) => setClasses((rows) => rows.map((r, j) => (j === i ? { ...r, stream: v === 'none' ? '' : v } : r)))}
                    disabled={!canManage}
                  >
                    <SelectTrigger id={`wiz-cls-stream-${i}`} className="h-10 w-full bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No stream</SelectItem>
                      {CLASS_STREAMS.map((s) => (
                        <SelectItem key={s} value={s}>{STREAM_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-12 sm:col-span-1 sm:text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setClasses((rows) => rows.filter((_, j) => j !== i))}
                    className="h-10 text-slate-400 hover:text-red-600"
                    aria-label={`Remove class ${row.name || i + 1}`}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClasses((rows) => [...rows, { name: '', sections: 'A', stream: '' }])}
              disabled={!canManage || classes.length >= 40}
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              + Add a class
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wiz-subjects" className="text-xs font-semibold text-slate-700">Subjects</Label>
        <Textarea
          id="wiz-subjects"
          value={subjects}
          onChange={(e) => setSubjects(e.target.value)}
          placeholder="English, Hindi, Mathematics, Science, Social Science…"
          className={FIELD_AREA}
          disabled={!canManage}
        />
        <p className="text-[11px] text-slate-400">Separate with commas — {counts.subjects} subject(s) already exist; duplicates are skipped.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 4 — Principal account
// ════════════════════════════════════════════════════════════════════

function PrincipalEditor({
  schoolId,
  principal,
  loginUrl,
  canManage,
  onSaved,
}: {
  schoolId: string
  principal: WizardPrincipal | null
  loginUrl: string
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const { gate, node: stepUpNode } = useStepUpGate()
  const [name, setName] = useState(principal?.name ?? '')
  const [phone, setPhone] = useState(principal?.phone ?? '')
  const [busy, setBusy] = useState(false)
  const [reissueBusy, setReissueBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credential, setCredential] = useState<{ email: string; tempPassword: string } | null>(null)

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, string> = {}
      if (name.trim() !== (principal?.name ?? '')) payload.name = name.trim()
      if (phone.trim() !== (principal?.phone ?? '')) payload.phone = phone.trim()
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing to save — no changes')
        if (advance) await onSaved('principal')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}/principal`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      toast.success('Principal details saved')
      await onSaved('principal', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const reissue = async () => {
    setReissueBusy(true)
    setError(null)
    try {
      const res = await gate(() =>
        platformApi<{ tempPassword: string; revokedSessions: number; principal: { email: string } }>(
          `/api/platform/schools/${schoolId}/reissue-credential`,
          { method: 'POST' },
        ),
      )
      if (!res) return
      setCredential({ email: res.principal.email, tempPassword: res.tempPassword })
      await onSaved('principal', { advance: false })
    } catch (e) {
      setError(errText(e))
    } finally {
      setReissueBusy(false)
    }
  }

  if (!principal) {
    return (
      <div className="space-y-3">
        <FormError message={error} />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          This school has no principal account yet — it is created together with the school through provisioning.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {stepUpNode}
      <FormError message={error} />
      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-semibold text-slate-900">{principal.email}</span>
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${
              principal.credentialState === 'OWNED'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {principal.credentialState === 'OWNED'
              ? 'Password set by principal'
              : principal.credentialState === 'BOOTSTRAP_PENDING'
                ? 'One-time credential pending'
                : 'Credential state unknown'}
          </span>
          {principal.invitation.state !== 'NONE' && (
            <span className="text-slate-500">Invite email: {principal.invitation.state}</span>
          )}
          {principal.lastLoginAt && (
            <span className="text-slate-500">Last sign-in: {new Date(principal.lastLoginAt).toLocaleString()}</span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          School door: <span className="font-mono">{loginUrl}</span> — the principal signs in there and sets a personal
          password at first login.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-principal-name" className="text-xs font-semibold text-slate-700">Principal full name</Label>
          <Input id="wiz-principal-name" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-principal-phone" className="text-xs font-semibold text-slate-700">Mobile number</Label>
          <Input id="wiz-principal-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={FIELD} disabled={!canManage} />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        The official email is the principal&apos;s permanent identity anchor and cannot be changed here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
        {canManage && principal.credentialState !== 'OWNED' && (
          <Button variant="outline" onClick={() => void reissue()} disabled={reissueBusy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
            {reissueBusy ? 'Issuing…' : 'Re-issue one-time credential'}
          </Button>
        )}
      </div>
      <Dialog open={credential !== null} onOpenChange={(o) => (!o ? setCredential(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>One-time credential issued</DialogTitle>
            <DialogDescription>
              Shown once for {credential?.email}. Hand it to the principal — they must set a personal password at first
              sign-in. It expires in 48 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900">{credential?.tempPassword}</code>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-300 bg-white"
              onClick={() => {
                if (credential) void navigator.clipboard.writeText(credential.tempPassword)
                toast.success('Copied')
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button className="bg-teal-600 text-white hover:bg-teal-700" onClick={() => setCredential(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 5 — Teachers & staff (optional)
// ════════════════════════════════════════════════════════════════════

interface StaffRow {
  name: string
  email: string
  phone: string
  department: string
  qualification: string
  subjects: string
}

const EMPTY_STAFF: StaffRow = { name: '', email: '', phone: '', department: '', qualification: '', subjects: '' }

function PeopleEditor({
  schoolId,
  counts,
  canManage,
  onSaved,
}: {
  schoolId: string
  counts: SetupWizardState['counts']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [rows, setRows] = useState<StaffRow[]>([{ ...EMPTY_STAFF }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Array<{ name: string; email: string; tempPassword: string }>>([])

  const set = (i: number, k: keyof StaffRow, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const members = rows
        .filter((r) => r.name.trim() || r.email.trim())
        .map((r) => ({
          name: r.name.trim(),
          email: r.email.trim().toLowerCase(),
          ...(r.phone.trim() ? { phone: r.phone.trim() } : {}),
          ...(r.department.trim() ? { department: r.department.trim() } : {}),
          ...(r.qualification.trim() ? { qualification: r.qualification.trim() } : {}),
          ...(r.subjects.trim() ? { subjects: r.subjects.trim() } : {}),
        }))
      for (const m of members) {
        if (!m.name || !m.email) throw new Error('Each teacher needs at least a name and an email')
      }
      if (members.length === 0) {
        toast.info('Nothing to save — add a teacher first')
        return
      }
      const res = await platformApi<{ created: Array<{ id: string; email: string; name: string; tempPassword?: string }>; duplicates: string[] }>(
        `/api/platform/schools/${schoolId}/initial-staff`,
        { method: 'POST', body: JSON.stringify({ members }) },
      )
      const withPasswords = res.created.filter((c) => c.tempPassword)
      if (withPasswords.length > 0) {
        setIssued(withPasswords.map((c) => ({ name: c.name, email: c.email, tempPassword: c.tempPassword! })))
      }
      if (res.duplicates.length > 0) {
        toast.info(`${res.duplicates.length} already on the roster — skipped`)
      } else {
        toast.success(`${res.created.length} teacher(s) onboarded`)
      }
      setRows([{ ...EMPTY_STAFF }])
      await onSaved('people', { advance: advance && withPasswords.length === 0 })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      {issued.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5" role="status">
          <p className="flex items-center gap-2 text-xs font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            One-time passwords — shown only now
          </p>
          <ul className="mt-2 space-y-1.5">
            {issued.map((c) => (
              <li key={c.email} className="flex items-center gap-2 text-xs text-amber-900">
                <span className="min-w-0 flex-1 truncate font-medium">{c.name || c.email}</span>
                <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-900">{c.tempPassword}</code>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-teal-700 hover:underline"
                  onClick={() => {
                    void navigator.clipboard.writeText(c.tempPassword)
                    toast.success('Copied')
                  }}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-700">
            Each teacher sets a personal password at first sign-in (48-hour window).
          </p>
          <Button variant="outline" size="sm" className="mt-2 h-8 border-amber-300 bg-white text-amber-800 hover:bg-amber-100" onClick={() => setIssued([])}>
            I&apos;ve saved them
          </Button>
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="col-span-12 sm:col-span-3">
            <Label htmlFor={`wiz-staff-name-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Full name *</Label>
            <Input id={`wiz-staff-name-${i}`} value={row.name} onChange={(e) => set(i, 'name', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-12 sm:col-span-3">
            <Label htmlFor={`wiz-staff-email-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Email *</Label>
            <Input id={`wiz-staff-email-${i}`} type="email" value={row.email} onChange={(e) => set(i, 'email', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label htmlFor={`wiz-staff-dept-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Department</Label>
            <Input id={`wiz-staff-dept-${i}`} value={row.department} onChange={(e) => set(i, 'department', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label htmlFor={`wiz-staff-subj-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Subjects</Label>
            <Input id={`wiz-staff-subj-${i}`} value={row.subjects} onChange={(e) => set(i, 'subjects', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-12 sm:col-span-1 sm:text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [ { ...EMPTY_STAFF } ]))}
              className="h-10 text-slate-400 hover:text-red-600"
              aria-label={`Remove teacher row ${i + 1}`}
            >
              ✕
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { ...EMPTY_STAFF }])} disabled={!canManage || rows.length >= 40} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          + Add another
        </Button>
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        Optional — {counts.teachers} teacher(s) exist today. The school adds its full roster and assigns classes after
        handover; students are admitted by the school.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 6 — Fees configuration (optional)
// ════════════════════════════════════════════════════════════════════

interface FeeHeadRow {
  name: string
  category: string
  frequency: string
  amount: string
  mandatory: boolean
}

function FeesEditor({
  schoolId,
  counts,
  canManage,
  onSaved,
}: {
  schoolId: string
  counts: SetupWizardState['counts']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [rows, setRows] = useState<FeeHeadRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (i: number, k: keyof FeeHeadRow, v: string | boolean) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const heads = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          category: r.category,
          frequency: r.frequency,
          amount: Number(r.amount || 0),
          mandatory: r.mandatory,
        }))
      for (const h of heads) {
        if (!Number.isFinite(h.amount) || h.amount < 0 || h.amount > 500000) {
          throw new Error(`Amount for "${h.name}" must be between 0 and 500000`)
        }
      }
      if (heads.length === 0) {
        toast.info('Nothing to save — add a fee head first')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}/initial-fee-catalogue`, {
        method: 'POST',
        body: JSON.stringify({ heads }),
      })
      toast.success('Fee catalogue saved')
      setRows([])
      await onSaved('fees', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
          {counts.masterFeeHeads} fee head(s) in the catalogue today. Add the recurring heads this school charges
          (e.g. Tuition, Admission, Transport) — the school builds and publishes per-class fee structures from these.
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="col-span-12 sm:col-span-3">
            <Label htmlFor={`wiz-fee-name-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fee head *</Label>
            <Input id={`wiz-fee-name-${i}`} value={row.name} onChange={(e) => set(i, 'name', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Category</Label>
            <Select value={row.category || 'Other'} onValueChange={(v) => set(i, 'category', v)} disabled={!canManage}>
              <SelectTrigger className="h-10 w-full bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Frequency</Label>
            <Select value={row.frequency || 'Monthly'} onValueChange={(v) => set(i, 'frequency', v)} disabled={!canManage}>
              <SelectTrigger className="h-10 w-full bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEE_FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label htmlFor={`wiz-fee-amount-${i}`} className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Amount</Label>
            <Input id={`wiz-fee-amount-${i}`} type="number" min={0} max={500000} value={row.amount} onChange={(e) => set(i, 'amount', e.target.value)} className={`${FIELD} h-10`} disabled={!canManage} />
          </div>
          <div className="col-span-5 sm:col-span-1">
            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Required</Label>
            <div className="flex h-10 items-center">
              <Switch checked={row.mandatory} onCheckedChange={(v) => set(i, 'mandatory', v)} disabled={!canManage} aria-label={`Fee head ${row.name || i + 1} mandatory`} />
            </div>
          </div>
          <div className="col-span-1 sm:col-span-1 sm:text-right">
            <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="h-10 text-slate-400 hover:text-red-600" aria-label={`Remove fee head ${row.name || i + 1}`}>
              ✕
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { name: '', category: 'Tuition', frequency: 'Monthly', amount: '', mandatory: true }])} disabled={!canManage || rows.length >= 60} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          + Add fee head
        </Button>
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        Optional — no transactions or receipts are created here. Per-class fee structures and publishing stay with the
        school&apos;s principal in the Fees module.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 7 — Examination configuration (optional)
// ════════════════════════════════════════════════════════════════════

interface ExamTypeRow {
  name: string
  code: string
}
interface GradeScaleRow {
  grade: string
  minPct: string
  maxPct: string
}

function ExamsEditor({
  schoolId,
  counts,
  canManage,
  onSaved,
}: {
  schoolId: string
  counts: SetupWizardState['counts']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [types, setTypes] = useState<ExamTypeRow[]>([
    { name: 'Unit Test', code: '' },
    { name: 'Term Exam', code: '' },
    { name: 'Annual Exam', code: '' },
  ])
  const [scales, setScales] = useState<GradeScaleRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      const cleanTypes = types
        .map((t) => ({ name: t.name.trim(), ...(t.code.trim() ? { code: t.code.trim() } : {}) }))
        .filter((t) => t.name)
      if (cleanTypes.length > 0) payload.examTypes = cleanTypes
      const cleanScales = scales
        .map((s) => ({
          grade: s.grade.trim(),
          minPct: Number(s.minPct),
          maxPct: Number(s.maxPct),
        }))
        .filter((s) => s.grade)
      for (const s of cleanScales) {
        if (!Number.isFinite(s.minPct) || !Number.isFinite(s.maxPct) || s.minPct > s.maxPct) {
          throw new Error(`Grade "${s.grade}": check the percentage range`)
        }
      }
      if (cleanScales.length > 0) payload.gradeScales = cleanScales
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing to save')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}/initial-exam-config`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast.success('Examination configuration saved')
      setScales([])
      await onSaved('exams', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Exam types</Label>
        <p className="text-[11px] text-slate-400">{counts.examTypes} already configured — duplicates are skipped.</p>
        {types.map((row, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-7 sm:col-span-8">
              <Input
                value={row.name}
                onChange={(e) => setTypes((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                placeholder="Exam type name"
                aria-label={`Exam type ${i + 1} name`}
                className={`${FIELD} h-10`}
                disabled={!canManage}
              />
            </div>
            <div className="col-span-4 sm:col-span-3">
              <Input
                value={row.code}
                onChange={(e) => setTypes((rs) => rs.map((r, j) => (j === i ? { ...r, code: e.target.value } : r)))}
                placeholder="Code (optional)"
                aria-label={`Exam type ${i + 1} code`}
                className={`${FIELD} h-10 font-mono`}
                disabled={!canManage}
              />
            </div>
            <div className="col-span-1 sm:text-right">
              <Button variant="ghost" size="sm" onClick={() => setTypes((rs) => rs.filter((_, j) => j !== i))} className="h-10 text-slate-400 hover:text-red-600" aria-label={`Remove exam type ${i + 1}`}>
                ✕
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setTypes((rs) => [...rs, { name: '', code: '' }])} disabled={!canManage || types.length >= 20} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          + Add exam type
        </Button>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-700">Grade scale (optional)</Label>
        {scales.length === 0 && (
          <p className="text-[11px] text-slate-400">{counts.gradeScales} grade band(s) exist. Example: A 91–100, B 76–90, C 60–75.</p>
        )}
        {scales.map((row, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <div className="col-span-4 sm:col-span-3">
              <Input value={row.grade} onChange={(e) => setScales((rs) => rs.map((r, j) => (j === i ? { ...r, grade: e.target.value } : r)))} placeholder="Grade (A)" aria-label={`Grade band ${i + 1} letter`} className={`${FIELD} h-10`} disabled={!canManage} />
            </div>
            <div className="col-span-4 sm:col-span-3">
              <Input type="number" min={0} max={100} value={row.minPct} onChange={(e) => setScales((rs) => rs.map((r, j) => (j === i ? { ...r, minPct: e.target.value } : r)))} placeholder="Min %" aria-label={`Grade band ${i + 1} minimum percentage`} className={`${FIELD} h-10`} disabled={!canManage} />
            </div>
            <div className="col-span-3 sm:col-span-3">
              <Input type="number" min={0} max={100} value={row.maxPct} onChange={(e) => setScales((rs) => rs.map((r, j) => (j === i ? { ...r, maxPct: e.target.value } : r)))} placeholder="Max %" aria-label={`Grade band ${i + 1} maximum percentage`} className={`${FIELD} h-10`} disabled={!canManage} />
            </div>
            <div className="col-span-1 sm:col-span-1 sm:text-right">
              <Button variant="ghost" size="sm" onClick={() => setScales((rs) => rs.filter((_, j) => j !== i))} className="h-10 text-slate-400 hover:text-red-600" aria-label={`Remove grade band ${i + 1}`}>
                ✕
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setScales((rs) => [...rs, { grade: '', minPct: '', maxPct: '' }])} disabled={!canManage || scales.length >= 15} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          + Add grade band
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        Optional — prepares the exam vocabulary only. No exams, marks or results are created; the school runs exams from
        its own Exams module.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 8 — Website & presence (optional)
// ════════════════════════════════════════════════════════════════════

function WebsiteEditor({
  schoolId,
  website,
  canManage,
  onSaved,
  onNavigateTab,
}: {
  schoolId: string
  website: SetupWizardState['website']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
  onNavigateTab?: (tab: string) => void
}) {
  const [enabled, setEnabled] = useState(website.enabled)
  const [hero, setHero] = useState({ title: website.hero.title, titleAccent: website.hero.titleAccent, description: website.hero.description, badgePrefix: website.hero.badgePrefix })
  const [about, setAbout] = useState({ title: website.about.title, subtitle: website.about.subtitle })
  const [contact, setContactState] = useState({ title: website.contact.title, subtitle: website.contact.subtitle })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (advance: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (enabled !== website.enabled) payload.websiteEnabled = enabled
      const heroChanged =
        hero.title !== website.hero.title ||
        hero.titleAccent !== website.hero.titleAccent ||
        hero.description !== website.hero.description ||
        hero.badgePrefix !== website.hero.badgePrefix
      if (heroChanged) {
        payload.hero = {
          ...(hero.badgePrefix.trim() ? { badgePrefix: hero.badgePrefix.trim() } : { badgePrefix: '' }),
          title: hero.title.trim(),
          titleAccent: hero.titleAccent.trim(),
          description: hero.description.trim(),
        }
      }
      if (about.title !== website.about.title || about.subtitle !== website.about.subtitle) {
        payload.about = { title: about.title.trim(), subtitle: about.subtitle.trim() }
      }
      if (contact.title !== website.contact.title || contact.subtitle !== website.contact.subtitle) {
        payload.contact = { title: contact.title.trim(), subtitle: contact.subtitle.trim() }
      }
      if (Object.keys(payload).length === 0) {
        toast.info('Nothing to save — no changes')
        if (advance) await onSaved('website')
        return
      }
      await platformApi(`/api/platform/schools/${schoolId}/website-presence`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      toast.success('Website presence saved')
      await onSaved('website', { advance })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Public website enabled</p>
          <p className="text-[11px] text-slate-500">Turn off to keep the school private while preparing.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} aria-label="Public website enabled" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wiz-hero-title" className="text-xs font-semibold text-slate-700">Website headline</Label>
          <Input id="wiz-hero-title" value={hero.title} onChange={(e) => setHero((h) => ({ ...h, title: e.target.value }))} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-hero-accent" className="text-xs font-semibold text-slate-700">Headline accent</Label>
          <Input id="wiz-hero-accent" value={hero.titleAccent} onChange={(e) => setHero((h) => ({ ...h, titleAccent: e.target.value }))} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="wiz-hero-desc" className="text-xs font-semibold text-slate-700">Short description</Label>
          <Textarea id="wiz-hero-desc" value={hero.description} onChange={(e) => setHero((h) => ({ ...h, description: e.target.value }))} className={`${FIELD_AREA} min-h-[64px]`} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-about-title" className="text-xs font-semibold text-slate-700">About title</Label>
          <Input id="wiz-about-title" value={about.title} onChange={(e) => setAbout((a) => ({ ...a, title: e.target.value }))} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-about-sub" className="text-xs font-semibold text-slate-700">About subtitle</Label>
          <Input id="wiz-about-sub" value={about.subtitle} onChange={(e) => setAbout((a) => ({ ...a, subtitle: e.target.value }))} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-contact-title" className="text-xs font-semibold text-slate-700">Contact section title</Label>
          <Input id="wiz-contact-title" value={contact.title} onChange={(e) => setContactState((c) => ({ ...c, title: e.target.value }))} className={FIELD} disabled={!canManage} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiz-contact-sub" className="text-xs font-semibold text-slate-700">Contact details line</Label>
          <Input id="wiz-contact-sub" value={contact.subtitle} onChange={(e) => setContactState((c) => ({ ...c, subtitle: e.target.value }))} placeholder="Phone, email or office hours" className={FIELD} disabled={!canManage} />
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">
            Custom domain (add, verify, remove) lives in its own governance section below.
          </p>
          {onNavigateTab && (
            <Button variant="outline" size="sm" onClick={() => onNavigateTab('domains')} className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
              Open custom domains
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save(true)} disabled={busy || !canManage} className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring">
          Save and continue
        </Button>
        <Button variant="outline" onClick={() => void save(false)} disabled={busy || !canManage} className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">
        Optional — seeds the basic public identity. The school manages its full website content after handover; DNS and
        domain verification stay in their existing secure workflow.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// STEP 9 — Modules & initial access
// ════════════════════════════════════════════════════════════════════

function ModulesEditor({
  schoolId,
  modules,
  canManage,
  onSaved,
}: {
  schoolId: string
  modules: SetupWizardState['modules']
  canManage: boolean
  onSaved: (step: string, opts?: { advance?: boolean }) => Promise<SetupWizardState | null>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flags, setFlags] = useState(modules.school)
  const [admissions, setAdmissions] = useState(modules.admissionsIssuance)

  const toggle = async (id: string, next: boolean) => {
    setBusy(id)
    setError(null)
    const previous = flags
    setFlags((f) => ({ ...f, [id]: next }))
    try {
      await platformApi(`/api/platform/schools/${schoolId}/feature-flags`, {
        method: 'PATCH',
        body: JSON.stringify({ [id]: next }),
      })
      toast.success(`${MODULE_META.find((m) => m.id === id)?.label ?? id} ${next ? 'enabled' : 'disabled'} for this school`)
      await onSaved('modules', { advance: false })
    } catch (e) {
      setFlags(previous)
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleAdmissions = async (next: boolean) => {
    setBusy('admissions')
    setError(null)
    const previous = admissions
    setAdmissions(next)
    try {
      await platformApi(`/api/platform/schools/${schoolId}/admissions-issuance`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      })
      toast.success(`Server-issued admissions ${next ? 'enabled' : 'disabled'}`)
      await onSaved('modules', { advance: false })
    } catch (e) {
      setAdmissions(previous)
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {MODULE_META.map((m) => {
          const effective = modules.effective[m.id]
          const source = typeof flags[m.id] === 'boolean' ? 'school override' : typeof modules.master[m.id] === 'boolean' ? 'platform master' : 'default (on)'
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {m.label}
                  <span className={`ml-2 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${effective ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                    {effective ? 'Available' : 'Unavailable'}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{m.purpose} · source: {source}</p>
              </div>
              <Switch
                checked={effective}
                disabled={!canManage || busy === m.id}
                onCheckedChange={(v) => void toggle(m.id, v)}
                aria-label={`${m.label} available for this school`}
              />
            </li>
          )
        })}
        <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Server-issued admissions
              <span className={`ml-2 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${modules.admissionsIssuance ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                {admissions ? 'Enabled' : 'Off'}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Fail-closed workflow flag — needs the session year and a published fee structure first.
            </p>
          </div>
          <Switch checked={admissions} disabled={!canManage || busy === 'admissions'} onCheckedChange={(v) => void toggleAdmissions(v)} aria-label="Server-issued admissions" />
        </li>
      </ul>
      <p className="text-[11px] text-slate-400">
        Module availability is a product toggle (platform master → school override). Role-wise feature management is a
        separate, stronger system — configure per-role feature access in Manage → Role-wise Feature Control.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// Review & Activate
// ════════════════════════════════════════════════════════════════════

function ReviewActivateCard({
  data,
  canManage,
  onChanged,
  reload,
}: {
  data: SetupWizardState
  canManage: boolean
  onChanged?: () => void
  reload: () => Promise<SetupWizardState | null>
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activated, setActivated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = data.school.status === 'PENDING'
  const checklistOk = data.activation.wizardChecklistOk
  const missing = data.activation.wizardMissing

  const activate = async () => {
    setBusy(true)
    setError(null)
    try {
      // STRICT MODE: the server enforces the SAME checklist the review
      // screen displays (recomputed from the live database — the client
      // never asserts completion).
      await platformApi(`/api/platform/schools/${data.school.id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ requireComplete: true }),
      })
      toast.success('School activated — the principal can now sign in')
      setActivated(true)
      setConfirmOpen(false)
      await reload()
      onChanged?.()
    } catch (e) {
      setError(errText(e))
      setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="wizard-review" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <h2 className="font-display text-sm font-bold text-slate-900">Review setup</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Everything below is read from the saved database state — nothing is marked done until it is actually persisted.
        </p>
      </div>

      {activated && data.school.status === 'ACTIVE' ? (
        <div className="space-y-3 p-4 sm:px-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-800" role="status">
            School activated — handover complete.
          </div>
          <ul className="space-y-1.5 text-xs text-slate-600">
            <li>• The principal signs in at <span className="font-mono">{data.access.loginUrl}</span> (one-time credential, then a personal password).</li>
            <li>• The school now manages its own people, fees, exams, timetable and website content.</li>
            <li>• You keep full visibility — Overview and Manage always reflect the live configuration.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-4 p-4 sm:px-5">
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2">
                <StepStateIcon status={s.status} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{s.label}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${s.optional ? 'text-slate-400' : 'text-emerald-700'}`}>
                  {s.optional ? 'Optional' : 'Required'}
                </span>
              </li>
            ))}
          </ul>

          {missing.length > 0 && pending && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5" role="status">
              <p className="text-xs font-bold text-amber-800">Before activation, complete:</p>
              <ul className="mt-1.5 space-y-1">
                {missing.map((m) => (
                  <li key={m.id} className="text-xs text-amber-900">• {m.fix}</li>
                ))}
              </ul>
            </div>
          )}

          <FormError message={error} />

          <div className="flex flex-wrap items-center gap-2">
            {pending && canManage && (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={busy || !checklistOk}
                className="h-10 bg-teal-600 text-white hover:bg-teal-700 focus-ring"
              >
                Activate School
              </Button>
            )}
            {pending && !canManage && (
              <p className="text-xs text-slate-500">Activation requires the schools.manage permission.</p>
            )}
            {pending && canManage && !checklistOk && (
              <p className="text-xs text-slate-500">Complete the required sections above to enable activation.</p>
            )}
            {data.school.status === 'SUSPENDED' && (
              <p className="text-xs text-slate-500">This school is suspended — use Manage → Danger zone to reactivate.</p>
            )}
            {data.school.status === 'ACTIVE' && !activated && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                This school is active. Routine changes now belong to the school — Overview and Manage keep you current.
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate {data.school.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Activation lets the school&apos;s users sign in and starts the handover: the principal manages routine
              operations, the school controls its own branding and profile within platform governance. The server
              re-validates every required section before activating.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void activate()
              }}
              disabled={busy}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {busy ? 'Activating…' : 'Activate School'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
