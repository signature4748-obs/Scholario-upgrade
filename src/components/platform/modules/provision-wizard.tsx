'use client'

// ============================================================
// ProvisionWizard — the 7-step school onboarding workflow
// (ADD-SCHOOL WIZARD, 2026-10-20 · FULL-PAGE WORKSPACE,
//  2026-10-20 control-plane mandate)
// ------------------------------------------------------------
// Served at /platform/schools/new — a DEDICATED FULL-PAGE workspace
// in the Schools hierarchy (never a cramped modal). The stepper's
// COMPLETED steps are clickable (jump-back without data loss), the
// form AUTO-SAVES to sessionStorage (the principal password is
// structurally never persisted) and a stored draft is only ever
// loaded through an explicit RESUME/DISCARD decision.
//
// Platform → Schools → Add school. SEVEN steps that collect everything
// a new tenant needs, then ONE atomic POST /api/platform/schools call
// that transactionally creates the tenant ecosystem:
//
//   School tenant (identity + internal record prefix) → founding
//   Principal (+role, phone) → SchoolSubscription (agreed commercial
//   terms — never a fabricated payment) → TenantDomain record →
//   academic session → initial classes/sections/subjects/rooms →
//   branding → address & contact configuration.
//
//   · STEP 1  School identity    (name, board: UP Board/CBSE only,
//                                 optional external code, auto short
//                                 name, auto slug with server-side
//                                 availability + collision suggestions,
//                                 server-allocated record prefix)
//   · STEP 2  Principal          (founding Principal account, phone,
//                                 credential option)
//   · STEP 3  Subscription      (school-based monthly/yearly OR
//                                 student-based yearly-only, agreed
//                                 amount, currency, licensed students,
//                                 start date, price breakdown)
//   · STEP 4  Academic setup     (session default from date+timezone,
//                                 working days, class selection grid,
//                                 optional subjects/rooms)
//   · STEP 5  Branding & website (colors + live preview, tagline,
//                                 website toggle, optional custom
//                                 domain — PENDING until DNS proof)
//   · STEP 6  Address & contact  (line 1/2, city, district, state,
//                                 PIN, country, timezone, email/phone,
//                                 optional website)
//   · STEP 7  Review & create   (Ready / Optional / Needs-attention
//                                 per section, jump-back editing,
//                                 idempotent CREATE)
//
// Auto-generated fields (short name, slug, academic session) follow
// the operator's typing until edited — and every derived value shown
// here is RE-derived and re-validated server-side at creation; the
// internal record prefix number is allocated under an advisory lock
// inside the provision transaction (never client-side).
//
// The SUCCESS panel is the school-access truth surface: the canonical
// LOGIN URL, the founding principal, the one-time bootstrap credential
// with the forced-change warning, the allocated prefix, the agreed
// subscription terms (with the honest "no payment recorded yet" state)
// and the remaining setup tasks.
//
// One application · one database · many tenants: everything here is
// DATA — no new deployment, repo, or code change per school. The
// school needs no developer.
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UserCog,
  Globe2,
  GraduationCap,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Info,
  LogIn,
  Palette,
  MapPin,
  CreditCard,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toast } from 'sonner'
import {
  BILLING_MODEL_OPTIONS,
  defaultAcademicSession,
  deriveShortName,
  frequencyOptionsFor,
  slugifyName,
  suggestSlugAlternatives,
} from '@/lib/school/identity-derive'

/// The two boards the product onboards (mission §2 STEP 1). The API
/// enforces the same two on provision; existing tenants keep the full
/// legacy vocabulary.
const BOARD_OPTIONS = [
  { value: 'CBSE', label: 'CBSE — Central Board of Secondary Education' },
  { value: 'UP_BOARD', label: 'UP Board — Uttar Pradesh Madhyamik Shiksha Parishad' },
] as const

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
] as const

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const

const WEEKDAYS = [
  { key: 'MON', label: 'Mon' },
  { key: 'TUE', label: 'Tue' },
  { key: 'WED', label: 'Wed' },
  { key: 'THU', label: 'Thu' },
  { key: 'FRI', label: 'Fri' },
  { key: 'SAT', label: 'Sat' },
  { key: 'SUN', label: 'Sun' },
] as const

const PRIMARY_PRESETS = [
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Maroon', value: '#7f1d33' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Emerald', value: '#047852' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Slate', value: '#334155' },
] as const

const ACCENT_PRESETS = [
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Sky', value: '#0284c7' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Lime', value: '#65a30d' },
  { label: 'Slate', value: '#64748b' },
] as const

const BILLING_MODEL_LABELS: Record<string, string> = {
  SCHOOL_WIDE: 'school-based',
  PER_STUDENT: 'student-based',
  MIXED: 'mixed',
}

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'monthly',
  ANNUAL: 'yearly',
}

/// Class-selection presets (mission §2 STEP 4): operators pick the
/// classes the school actually offers — never forced to offer all.
const CLASS_PRESETS = [
  { label: 'Class 1–5', range: [1, 5] },
  { label: 'Class 6–8', range: [6, 8] },
  { label: 'Class 9–10', range: [9, 10] },
  { label: 'Class 11–12', range: [11, 12] },
  { label: 'Class 1–12', range: [1, 12] },
] as const

interface ClassRow {
  name: string
  sections: string
}

interface WizardForm {
  // STEP 1 — School identity
  name: string
  shortName: string
  code: string
  slug: string
  board: string
  // STEP 2 — Principal & administrator
  principalName: string
  principalEmail: string
  principalPhone: string
  principalPassword: string
  // STEP 3 — Subscription & pricing (agreed commercial terms)
  billingModel: string
  billingFrequency: string
  agreedAmount: string
  currency: string
  licensedStudents: string
  subscriptionStartsOn: string
  // STEP 4 — Academic setup
  academicYear: string
  workingDays: string[]
  classRows: ClassRow[]
  subjectsText: string
  roomsText: string
  // STEP 5 — Branding & website
  themeColor: string
  accentColor: string
  tagline: string
  websiteEnabled: boolean
  customDomain: string
  // STEP 6 — Address & contact
  address: string
  addressLine2: string
  city: string
  district: string
  state: string
  pincode: string
  country: string
  timezone: string
  contactEmail: string
  contactPhone: string
  website: string
}

/// Exported for the wizard-empty-form regression test: the inert-row
/// invariant (the default form carries NO class rows; every row the UI
/// can add is a named, real class — a name-less row can never carry
/// sections) must never regress.
export const EMPTY_FORM: WizardForm = {
  name: '',
  shortName: '',
  code: '',
  slug: '',
  board: 'CBSE',
  principalName: '',
  principalEmail: '',
  principalPhone: '',
  principalPassword: '',
  billingModel: 'SCHOOL_WIDE',
  billingFrequency: 'ANNUAL',
  agreedAmount: '',
  currency: 'INR',
  licensedStudents: '',
  subscriptionStartsOn: '',
  academicYear: '',
  workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  classRows: [],
  subjectsText: '',
  roomsText: '',
  themeColor: '#0f766e',
  accentColor: '#f59e0b',
  tagline: '',
  websiteEnabled: true,
  customDomain: '',
  address: '',
  addressLine2: '',
  city: '',
  district: '',
  state: '',
  pincode: '',
  country: '',
  timezone: 'Asia/Kolkata',
  contactEmail: '',
  contactPhone: '',
  website: '',
}

const STEPS = [
  { id: 1, label: 'School identity', icon: Building2 },
  { id: 2, label: 'Principal', icon: UserCog },
  { id: 3, label: 'Subscription', icon: CreditCard },
  { id: 4, label: 'Academic setup', icon: GraduationCap },
  { id: 5, label: 'Branding', icon: Palette },
  { id: 6, label: 'Address', icon: MapPin },
  { id: 7, label: 'Review & create', icon: ClipboardCheck },
] as const

/** The optional step-4 section (progressive disclosure). */
type ConfigSectionKey = 'bootstrap'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z0-9-]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const YEAR_RE = /^\d{4}[-/]\d{4}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const DOMAINISH_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const PHONE_RE = /^[+0-9()\-\s]{7,20}$/
/// Indian PIN codes (6 digits, first 1–8) — permissive for other
/// countries: 3–12 alphanumerics/punctuation.
const PIN_IN_RE = /^[1-8][0-9]{5}$/
const PIN_GENERIC_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface PrecheckResult {
  slug: { value: string; patternValid: boolean; available: boolean | null; suggestions: string[] } | null
  code: { value: string; patternValid: boolean; available: boolean | null } | null
  generated: {
    shortName: string | null
    slug: string | null
    prefixAbbreviation: string | null
    prefixNextNumber: number | null
  }
}

interface ProvisionResult {
  replayed?: boolean
  replayNote?: string
  school: {
    id: string
    name: string
    slug: string
    code: string
    recordPrefix: string | null
    status: string
    plan: string
  }
  principal: { id: string; email: string; name: string | null }
  // TWO-PROJECT TOPOLOGY — the canonical doors (may be RELATIVE when
  // SCHOOL_APP_BASE_URL is unset; the unified deployment serves both
  // planes). Copies resolve relative URLs against the current origin.
  loginUrl: string
  publicUrl: string
  tempPassword?: string
  mustChangePassword: boolean
  domain: {
    customDomain: { hostname: string; status: string } | null
    tempDomain: string
    previewUrl: string
  }
  bootstrap?: { classes: number; sections: number; subjects: number; rooms: number }
  // The AGREED commercial terms as persisted (mission §2 STEP 3) —
  // paymentsRecorded is the honest count: provisioning records terms,
  // never a payment.
  subscription?: {
    billingModel: string
    interval: string
    unitPrice: number
    currency: string
    licensedStudents: number | null
    periodStart: string
    periodEnd: string | null
    paymentsRecorded: number
  }
  // Phase 3 — invite-email delivery state (honest, never fabricated:
  // SENT | QUEUED | FAILED | NONE + optional transport/errorClass).
  invitation?: { state: string; transport?: string; errorClass?: string; at?: string }
  nextStep: string
  // Task 4 wire contract — provisioned with the legacy schema fields.
  subscriptionSchemaPending?: boolean
  subscriptionPendingNote?: string
}

/// Draft contract (sessionStorage). SECURITY: `principalPassword` is
/// structurally excluded — restores always bring it back empty; any
/// password value found in storage is discarded unread.
interface WizardDraft {
  form: WizardForm
  step: number
  autoShortName: boolean
  autoSlug: boolean
  autoYear: boolean
  savedAt: string
}

const DRAFT_KEY = 'scholario.platform.add-school-draft.v1'

/// True when the operator has entered anything worth resuming — the
/// auto-save never writes a pristine, untouched form.
function isFormMeaningful(f: WizardForm): boolean {
  return Boolean(
    f.name.trim() ||
      f.slug.trim() ||
      f.code.trim() ||
      f.principalName.trim() ||
      f.principalEmail.trim() ||
      f.agreedAmount.trim() ||
      f.address.trim() ||
      f.city.trim() ||
      f.customDomain.trim() ||
      f.classRows.length > 0,
  )
}

/** The workspace stepper. COMPLETED steps are clickable — the operator
 *  can jump back to any finished step without losing data (the whole
 *  wizard shares ONE form state). Future steps stay non-interactive:
 *  forward motion is validation-gated by Continue. */
function StepDots({ step, onJump }: { step: number; onJump: (s: number) => void }) {
  return (
    <ol
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto custom-scrollbar"
      aria-label="Onboarding steps"
    >
      {STEPS.map((s, i) => {
        const done = s.id < step
        const active = s.id === step
        const connectorDone = i > 0 && STEPS[i - 1].id < step
        const chip = (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
              done
                ? 'border-teal-600 bg-teal-600 text-white'
                : active
                  ? 'border-teal-600 bg-white text-teal-700'
                  : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.id}
          </span>
        )
        const label = (
          <span
            className={`whitespace-nowrap text-xs font-medium ${
              active ? 'text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'
            }`}
          >
            {s.label}
          </span>
        )
        return (
          <li key={s.id} className="flex shrink-0 items-center">
            {i > 0 ? (
              <span
                className={`mx-1 h-px w-3 sm:w-5 ${connectorDone ? 'bg-teal-300' : 'bg-slate-200'}`}
                aria-hidden="true"
              />
            ) : null}
            {done ? (
              <button
                type="button"
                onClick={() => onJump(s.id)}
                aria-label={`Back to step ${s.id}: ${s.label}`}
                title={`Back to ${s.label}`}
                className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-teal-50 focus-ring"
              >
                {chip}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ) : (
              <span
                className={`flex items-center gap-1.5 py-1 pl-1 ${active ? 'pr-1.5' : ''}`}
                aria-current={active ? 'step' : undefined}
              >
                {chip}
                <span className="hidden sm:inline">{label}</span>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Inline-feedback copy button (PHASE 10 — school access truth) ──────────

/** Resolve a possibly-relative plane URL to an absolute one (click-time only — window exists). */
function absoluteUrl(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url
}

/**
 * Copy button with inline "Copied" feedback (icon swaps to Check and
 * the label changes for ~1.5s). `absolute` resolves a leading '/'
 * against the current origin so the operator hands out a working
 * link; the amber tone matches the one-time-credential warning block.
 */
function CopyInlineButton({
  value,
  absolute,
  label,
  tone = 'default',
}: {
  value: string
  absolute?: boolean
  label: string
  tone?: 'default' | 'amber'
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const payload = absolute ? absoluteUrl(value) : value
        void navigator.clipboard?.writeText(payload).then(
          () => {
            setCopied(true)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          },
          () => {
            /* clipboard unavailable — no success feedback (honest failure) */
          },
        )
      }}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-ring ${
        tone === 'amber'
          ? 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Optional-configuration section (progressive disclosure) ──────────

/**
 * A collapsed optional section (subjects & rooms inside step 4). Every
 * field the POST sends is preserved — the optional ones simply start
 * collapsed so the required configuration stays visible. When a step
 * validation error points into a section, the wizard expands it.
 */
function OptionalSection({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-xl border border-slate-200 bg-white">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-700">{title}</span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">{description}</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Review-section status chip (mission §2 STEP 7: Ready / Optional / Requires attention). */
function SectionStatus({ state }: { state: 'ready' | 'attention' | 'optional' }) {
  if (state === 'attention') {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-700 normal-case">Needs attention</Badge>
    )
  }
  if (state === 'optional') {
    return (
      <Badge className="border-slate-200 bg-slate-50 text-slate-500 normal-case">Optional — not configured</Badge>
    )
  }
  return <Badge className="border-teal-200 bg-teal-50 text-teal-700 normal-case">Ready</Badge>
}

export function ProvisionWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardForm>(() => ({
    ...EMPTY_FORM,
    // Date-derived defaults (mission §2 STEPS 3–4): the subscription
    // starts today; the academic session follows the school-year rule
    // in the operator's timezone. Both are RE-derived and re-validated
    // server-side at creation.
    subscriptionStartsOn: new Date().toISOString().slice(0, 10),
    academicYear: defaultAcademicSession(new Date(), EMPTY_FORM.timezone),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [openSections, setOpenSections] = useState<Record<ConfigSectionKey, boolean>>({
    bootstrap: false,
  })
  // Auto-generation flags: derived fields follow the operator's typing
  // until they edit them by hand (then the hand value wins forever).
  const [autoShortName, setAutoShortName] = useState(true)
  const [autoSlug, setAutoSlug] = useState(true)
  const [autoYear, setAutoYear] = useState(true)
  // Server-side availability answers for the CURRENT slug/code values.
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null)

  // ── Draft persistence (full-page workspace) ─────────────────────────
  // A draft from a previous visit is NEVER auto-loaded: the operator
  // explicitly resumes or discards it via the banner. Auto-save stays
  // paused until that decision is made so a fresh form can never
  // silently clobber the stored draft.
  const [draft, setDraft] = useState<WizardDraft | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<WizardDraft> | null
      if (parsed && typeof parsed.step === 'number' && parsed.form && typeof parsed.form === 'object') {
        setDraft({
          step: Math.min(Math.max(parsed.step, 1), STEPS.length),
          autoShortName: parsed.autoShortName ?? true,
          autoSlug: parsed.autoSlug ?? true,
          autoYear: parsed.autoYear ?? true,
          savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
          // SECURITY: any password value in storage is discarded unread.
          form: { ...EMPTY_FORM, ...parsed.form, principalPassword: '' },
        })
      }
    } catch {
      /* unreadable draft — ignored; a fresh form starts */
    }
  }, [])

  const draftWhen = useMemo(() => {
    if (!draft) return ''
    const d = new Date(draft.savedAt)
    return Number.isNaN(d.getTime())
      ? 'earlier'
      : d.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
  }, [draft])

  const resumeDraft = () => {
    if (!draft) return
    setForm({ ...draft.form, principalPassword: '' })
    setStep(draft.step)
    setAutoShortName(draft.autoShortName)
    setAutoSlug(draft.autoSlug)
    setAutoYear(draft.autoYear)
    setDraft(null)
    setError(null)
    setErrorCode(null)
    toast.info('Draft resumed — continue where you left off')
  }

  const discardDraft = () => {
    try {
      window.sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      /* nothing to remove */
    }
    setDraft(null)
  }

  // Debounced auto-save: the operator's progress survives a reload or
  // a stray navigation. `principalPassword` is NEVER written to
  // storage, and a pristine untouched form is never saved at all.
  const autoSaveActive = !result && draft === null && isFormMeaningful(form)
  useEffect(() => {
    if (!autoSaveActive) return
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            form: { ...form, principalPassword: '' },
            step,
            autoShortName,
            autoSlug,
            autoYear,
            savedAt: new Date().toISOString(),
          } satisfies WizardDraft),
        )
        setDraftSavedAt(new Date().toISOString())
      } catch {
        /* storage unavailable — drafts silently unavailable */
      }
    }, 600)
    return () => clearTimeout(t)
  }, [autoSaveActive, form, step, autoShortName, autoSlug, autoYear])

  // ── Debounced server precheck (slug/code availability + generated
  // previews) as the operator edits identity fields. Read-only, never
  // a reservation — POST-time DB constraints are the authority. ──────
  useEffect(() => {
    const name = form.name.trim()
    const slug = form.slug.trim()
    const code = form.code.trim()
    if (!name && !slug && !code) {
      setPrecheck(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (name) params.set('name', name)
        if (slug) params.set('slug', slug)
        if (code) params.set('code', code)
        const res = await platformApi<PrecheckResult>(
          `/api/platform/schools/precheck?${params.toString()}`,
          { method: 'GET', signal: controller.signal },
        )
        setPrecheck(res)
      } catch {
        // Availability unknown (aborted/failed) — never block on it:
        // the server re-validates at POST time.
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [form.name, form.slug, form.code])

  const set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const field =
    'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-10'

  const parsedSubjects = useMemo(
    () =>
      form.subjectsText
        .split(/[,.\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 60),
    [form.subjectsText],
  )

  const parsedRooms = useMemo(
    () =>
      form.roomsText
        .split(/[,.\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40),
    [form.roomsText],
  )

  /// The valid class rows the payload will send (named rows only — the
  /// inert-row invariant).
  const parsedClasses = useMemo(
    () =>
      form.classRows
        .filter((r) => r.name.trim())
        .slice(0, 40)
        .map((r) => ({
          name: r.name.trim().slice(0, 40),
          sections: r.sections
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
        })),
    [form.classRows],
  )

  // The temporary platform domain is DERIVED from the slug (data, not a
  // choice): <slug>.scholario.cloud in production, with the ?tenant=
  // link as the development fallback until custom domains are live.
  const tempDomain = form.slug && SLUG_RE.test(form.slug) ? `${form.slug}.scholario.cloud` : ''

  /// The prefix preview from the latest precheck (e.g. GVPS-0002) —
  /// "next available", allocated at creation, never a reservation.
  const prefixPreview =
    precheck?.generated.prefixAbbreviation && precheck?.generated.prefixNextNumber != null
      ? `${precheck.generated.prefixAbbreviation}-${String(precheck.generated.prefixNextNumber).padStart(4, '0')}`
      : ''

  /// The slug's latest server-side availability for the CURRENT value.
  const slugCheck =
    precheck?.slug && precheck.slug.value === form.slug.trim().toLowerCase() ? precheck.slug : null
  const codeCheck =
    precheck?.code && precheck.code.value === form.code.trim().toUpperCase() ? precheck.code : null

  // ── Commercial-terms parsing + price breakdown (mission §2 STEP 3)
  const amountNum = AMOUNT_RE.test(form.agreedAmount.trim()) ? Number(form.agreedAmount) : null
  const licensedNum = /^\d{1,6}$/.test(form.licensedStudents.trim()) ? Number(form.licensedStudents) : null
  const isStudentBased = form.billingModel === 'PER_STUDENT'
  const unitLabel = isStudentBased
    ? form.billingFrequency === 'MONTHLY'
      ? 'per student / month'
      : 'per student / year'
    : form.billingFrequency === 'MONTHLY'
      ? 'per month'
      : 'per year'
  const money = (v: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: form.currency }).format(v)

  // ── Per-step validation (client UX only; the POST re-validates
  //    everything server-side — the API is the authority). ──────────

  const validateIdentity = (): string | null => {
    if (form.name.trim().length < 2) return 'School name is required (2+ characters)'
    if (!BOARD_OPTIONS.some((b) => b.value === form.board)) return 'Choose a board — UP Board or CBSE'
    if (!SLUG_RE.test(form.slug) || form.slug.length < 3)
      return 'School slug must be 3+ chars — lowercase letters, numbers and hyphens only'
    if (form.code && (!CODE_RE.test(form.code) || form.code.length < 2))
      return 'School code must be 2–16 chars — uppercase letters, numbers and hyphens only (or leave it blank to auto-assign)'
    if (slugCheck && slugCheck.available === false)
      return `The slug "${slugCheck.value}" is already in use${
        slugCheck.suggestions.length > 0 ? ` — try ${slugCheck.suggestions.slice(0, 2).join(' or ')}` : ''
      }`
    if (codeCheck && codeCheck.available === false) return `The school code "${codeCheck.value}" is already in use`
    if (form.contactEmail && !EMAIL_RE.test(form.contactEmail.trim()))
      return 'Contact email must be a valid email address'
    return null
  }

  const validatePrincipal = (): string | null => {
    if (!form.principalName.trim()) return 'Principal name is required'
    if (!EMAIL_RE.test(form.principalEmail.trim())) return 'A valid principal email is required'
    if (form.principalPhone.trim() && !PHONE_RE.test(form.principalPhone.trim()))
      return 'Principal phone must be 7–20 digits/phone punctuation (or leave it blank)'
    if (form.principalPassword && form.principalPassword.length < 8)
      return 'Password must be at least 8 characters (or leave it blank to auto-generate)'
    return null
  }

  const validateSubscription = (): string | null => {
    // Student-based is YEARLY ONLY — the selector cannot offer monthly,
    // and this guard makes the rule impossible to slip past.
    if (isStudentBased && form.billingFrequency === 'MONTHLY')
      return 'Student-based subscriptions are billed yearly only'
    if (amountNum == null)
      return form.agreedAmount.trim()
        ? 'Amount must be a positive number with at most 2 decimals (max 1,000,000,000 style amounts rejected above 100,000,000)'
        : 'The agreed commercial amount is required'
    if (amountNum > 100_000_000) return 'Amount must be at most 100,000,000'
    if (isStudentBased) {
      if (licensedNum == null || licensedNum < 1)
        return 'Licensed student count is required for student-based billing (1–100,000)'
      if (licensedNum > 100_000) return 'Licensed student count must be at most 100,000'
    }
    if (!DATE_RE.test(form.subscriptionStartsOn)) return 'Subscription start date is required (YYYY-MM-DD)'
    const d = new Date(`${form.subscriptionStartsOn}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return 'Subscription start date is not a valid date'
    const days = (Date.now() - d.getTime()) / 86_400_000
    if (days > 366 || days < -366) return 'Subscription start date must be within one year of today'
    return null
  }

  const validateAcademic = (): { message: string | null; section?: ConfigSectionKey } => {
    if (form.academicYear && !YEAR_RE.test(form.academicYear.trim()))
      return { message: 'Academic session must look like 2026-2027' }
    if (form.workingDays.length === 0) return { message: 'Select at least one working day' }
    const namedRows = form.classRows.filter((r) => r.name.trim())
    const rowKeys = new Set<string>()
    for (const row of namedRows) {
      const key = `${row.name.trim().toLowerCase()}|${row.sections.trim().toLowerCase()}`
      if (rowKeys.has(key))
        return { message: `Duplicate class configuration: ${row.name.trim()} (${row.sections.trim() || 'no sections'})` }
      rowKeys.add(key)
    }
    if (form.classRows.length > 40) return { message: 'At most 40 classes can be bootstrapped' }
    return { message: null }
  }

  const validateBranding = (): string | null => {
    if (!HEX_RE.test(form.themeColor))
      return 'Primary color must be a 6-digit hex value (e.g. #0f766e)'
    if (!HEX_RE.test(form.accentColor))
      return 'Accent color must be a 6-digit hex value (e.g. #f59e0b)'
    const cd = form.customDomain.trim().toLowerCase().replace(/^(https?:\/\/|www\.)+/, '').replace(/\/.*$/, '')
    if (form.customDomain && !DOMAINISH_RE.test(cd))
      return 'Custom domain must look like school.com (no protocol, no path)'
    if (form.website.trim()) {
      const w = form.website.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      if (!DOMAINISH_RE.test(w)) return 'School website must look like school.edu or school.edu/path (no protocol needed)'
    }
    return null
  }

  const validateAddress = (): string | null => {
    if (!form.address.trim()) return 'Address line 1 is required'
    if (!form.city.trim()) return 'City is required'
    if (!form.state.trim()) return 'State is required'
    if (!form.country.trim()) return 'Country is required'
    const india = form.country.trim().toLowerCase() === 'india'
    const pin = form.pincode.trim()
    if (india && !pin) return 'PIN code is required for Indian schools (6 digits)'
    if (pin) {
      if (india && !PIN_IN_RE.test(pin))
        return 'Indian PIN code must be 6 digits (first digit 1–8)'
      if (!india && !PIN_GENERIC_RE.test(pin))
        return 'Postal code must be 3–12 characters'
    }
    if (form.contactPhone.trim() && !PHONE_RE.test(form.contactPhone.trim()))
      return 'Contact phone must be 7–20 digits/phone punctuation'
    if (form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim()))
      return 'Contact email must be a valid email address'
    return null
  }

  const stepIssue = (s: number): { message: string | null; section?: ConfigSectionKey } => {
    if (s === 1) return { message: validateIdentity() }
    if (s === 2) return { message: validatePrincipal() }
    if (s === 3) return { message: validateSubscription() }
    if (s === 4) return validateAcademic()
    if (s === 5) return { message: validateBranding() }
    if (s === 6) return { message: validateAddress() }
    return { message: null }
  }

  const next = () => {
    const issue = stepIssue(step)
    if (issue.message) {
      setError(issue.message)
      // A validation failure inside a collapsed optional section
      // expands that section — the error is never invisible.
      if (issue.section) {
        const section = issue.section
        setOpenSections((prev) => ({ ...prev, [section]: true }))
      }
      return
    }
    setError(null)
    setErrorCode(null)
    setStep((s) => Math.min(s + 1, STEPS.length))
  }

  const back = () => {
    setError(null)
    setErrorCode(null)
    setStep((s) => Math.max(s - 1, 1))
  }

  /// Jump to any step from the review screen (data is preserved — the
  /// whole wizard shares ONE form state; mission §2 STEP 7).
  const jumpTo = (s: number) => {
    setError(null)
    setErrorCode(null)
    setStep(Math.min(Math.max(s, 1), 6))
  }

  const buildPayload = () => ({
    name: form.name.trim(),
    shortName: form.shortName.trim() || undefined,
    slug: form.slug,
    code: form.code.trim() || undefined,
    board: form.board,
    // STEP 6 — address & contact
    address: form.address.trim() || undefined,
    addressLine2: form.addressLine2.trim() || undefined,
    city: form.city.trim() || undefined,
    district: form.district.trim() || undefined,
    state: form.state.trim() || undefined,
    pincode: form.pincode.trim() || undefined,
    country: form.country.trim() || undefined,
    timezone: form.timezone || undefined,
    officialEmail: form.contactEmail.trim() || undefined,
    phone: form.contactPhone.trim() || undefined,
    website: form.website.trim() || undefined,
    // STEP 3 — the agreed commercial terms (never a fabricated payment)
    billingModel: form.billingModel,
    billingFrequency: form.billingFrequency,
    agreedAmount: amountNum ?? undefined,
    currency: form.currency,
    licensedStudents: isStudentBased && licensedNum != null ? licensedNum : undefined,
    subscriptionStartsOn: form.subscriptionStartsOn,
    // STEP 2 — founding principal
    principalName: form.principalName.trim(),
    principalEmail: form.principalEmail.trim(),
    principalPhone: form.principalPhone.trim() || undefined,
    principalPassword: form.principalPassword || undefined,
    // STEP 4 — academic setup
    academicYear: form.academicYear.trim() || undefined,
    workingDays: form.workingDays,
    classes: parsedClasses.length > 0 ? parsedClasses : undefined,
    subjects: parsedSubjects.length > 0 ? parsedSubjects : undefined,
    rooms: parsedRooms.length > 0 ? parsedRooms : undefined,
    // STEP 5 — branding & website
    themeColor: form.themeColor,
    accentColor: form.accentColor,
    tagline: form.tagline.trim() || undefined,
    websiteEnabled: form.websiteEnabled,
    customDomain: form.customDomain.trim().toLowerCase() || undefined,
  })

  // Review-step missing-required indicators (defensive: per-step Next
  // validation normally prevents reaching step 7 with issues).
  const reviewIssues: string[] = STEPS.map((s) => {
    const issue = stepIssue(s.id)
    return issue.message ? `${s.label}: ${issue.message}` : null
  }).filter((v): v is string => v !== null)

  /**
   * POST /api/platform/schools. `pendingRecovery` powers the
   * SUBSCRIPTION_SYSTEM_PENDING path: the same payload with the billing
   * model switched to school-wide AND the terms dropped (a pending
   * database cannot persist them — the operator can record the terms
   * after the migration is applied).
   */
  const submit = async (pendingRecovery?: { billingModel?: string; dropTerms?: boolean }) => {
    setBusy(true)
    setError(null)
    setErrorCode(null)
    try {
      const payload = buildPayload()
      const finalPayload =
        pendingRecovery?.billingModel || pendingRecovery?.dropTerms
          ? {
              ...payload,
              ...(pendingRecovery.billingModel ? { billingModel: pendingRecovery.billingModel } : {}),
              ...(pendingRecovery.dropTerms
                ? {
                    billingFrequency: undefined,
                    agreedAmount: undefined,
                    currency: undefined,
                    licensedStudents: undefined,
                    subscriptionStartsOn: undefined,
                  }
                : {}),
            }
          : payload
      // 90s timeout: provisioning is a heavy multi-table transaction plus
      // the invite email — well beyond platformApi's 30s default.
      const res = await platformApi('/api/platform/schools', {
        method: 'POST',
        body: JSON.stringify(finalPayload),
      }, 90_000)
      setResult(res as unknown as ProvisionResult)
      // The workspace completed — the draft is consumed.
      try {
        window.sessionStorage.removeItem(DRAFT_KEY)
      } catch {
        /* nothing stored */
      }
      setDraftSavedAt(null)
      if ((res as unknown as ProvisionResult).replayed) {
        toast.info('Matched an existing PENDING provision — no duplicate created')
      } else {
        toast.success('School created — activate it to enable sign-in')
      }
    } catch (e) {
      const err = e as PlatformApiError
      // SUBSCRIPTION_SYSTEM_PENDING (503) is kept IN the wizard (review
      // step) with its publicMessage + a one-click fix — the operator
      // can retry without losing any entered data.
      setErrorCode(err.code || null)
      setError(err.error || 'Provisioning failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  // ── Class-selection helpers (step 4) ────────────────────────────────
  const togglePresetClasses = (range: readonly [number, number] | readonly number[]) => {
    const [from, to] = [range[0], range[range.length - 1]]
    setForm((f) => {
      const wanted: string[] = []
      for (let n = from; n <= to; n += 1) wanted.push(`Class ${n}`)
      const has = wanted.every((name) => f.classRows.some((r) => r.name === name))
      if (has) {
        // Toggle OFF the classes that belong to this preset and nothing else.
        return { ...f, classRows: f.classRows.filter((r) => !wanted.includes(r.name)) }
      }
      const rows = [...f.classRows]
      for (const name of wanted) {
        if (!rows.some((r) => r.name === name)) rows.push({ name, sections: 'A' })
      }
      return { ...f, classRows: rows }
    })
  }

  const customClasses = form.classRows.filter((r) => !/^Class \d+$/.test(r.name))

  // ── Success-panel helpers ────────────────────────────────────────────
  const remainingTasks: string[] = []
  if (result) {
    remainingTasks.push('Activate the school from its record to enable sign-in')
    if (result.domain.customDomain)
      remainingTasks.push(
        `Verify the custom domain ${result.domain.customDomain.hostname} (DNS TXT record from the school record's Domains tab) — it stays PENDING until ownership is proven`,
      )
    if (result.subscription)
      remainingTasks.push(
        'Record the first verified payment from the school record\u2019s Subscription tab to start the paid period (the agreed terms alone do not bill anything)',
      )
    if (result.invitation && (result.invitation.state === 'FAILED' || result.invitation.state === 'NONE'))
      remainingTasks.push(
        'The invite email did not go through — hand over the one-time credential yourself or re-issue it from the Access card',
      )
    remainingTasks.push('The school uploads its own logo/crest and refines branding from its settings after activation')
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Breadcrumb — the workspace is a real page in the Schools
          hierarchy: reachable by URL, reload-safe, and never a cramped
          modal that one stray click can dismiss. */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          <li>
            <Link
              href="/platform/schools"
              className="rounded font-medium text-slate-500 transition-colors hover:text-teal-700 focus-ring"
            >
              Schools
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
          </li>
          <li aria-current="page" className="font-semibold text-slate-900">
            {result ? 'School created' : 'Add school'}
          </li>
        </ol>
      </nav>
      {result ? (
          // ── Success panel ────────────────────────────────────────────
          <div className="space-y-5">
            <header>
              <h1 className="flex flex-wrap items-center gap-2.5 font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${
                    result.replayed ? 'bg-amber-500' : 'bg-teal-600'
                  }`}
                >
                  {result.replayed ? (
                    <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Check className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
                {result.replayed ? `${result.school.name} — already provisioned` : `${result.school.name} created`}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
                {result.replayed ? (
                  <span>
                    This request matched a PENDING school you provisioned — an <span className="font-medium text-amber-700">idempotent replay</span>, no duplicate was created.
                  </span>
                ) : (
                  <span>
                    The tenant ecosystem is provisioned. The school is in{' '}
                    <span className="font-medium text-amber-700">PENDING</span> state — activate it
                    from the school record to enable sign-in.
                  </span>
                )}
              </p>
            </header>

            {result.replayed ? (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  {result.replayNote ??
                    'The one-time credential was shown only at the original creation — re-issue it from the school record (Access card) if it was lost.'}
                </p>
              </div>
            ) : null}

            {/* SCHEMA-PENDING honesty (Task 4): the tenant was created
                with the legacy subscription fields; the billing model
                defaults to school-wide until the migration is applied. */}
            {result.subscriptionPendingNote ? (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{result.subscriptionPendingNote}</p>
              </div>
            ) : null}

            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Tenant slug</span>
                <span className="font-mono text-slate-900">{result.school.slug}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">School code</span>
                <span className="font-mono text-slate-900">{result.school.code}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Internal record prefix</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-slate-900">{result.school.recordPrefix ?? '—'}</span>
                  {result.school.recordPrefix ? (
                    <CopyInlineButton value={result.school.recordPrefix} label="Copy record prefix" />
                  ) : null}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="shrink-0 text-slate-500">Founding principal</span>
                <span className="min-w-0 text-right">
                  <span className="block truncate font-semibold text-slate-900">
                    {result.principal.name ?? '—'}
                  </span>
                  <span className="block truncate font-mono text-xs text-slate-600" title={result.principal.email}>
                    {result.principal.email}
                  </span>
                </span>
              </div>
              {result.bootstrap ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Academic setup</span>
                  <span className="text-slate-900">
                    {result.bootstrap.classes} classes · {result.bootstrap.sections} sections ·{' '}
                    {result.bootstrap.subjects} subjects · {result.bootstrap.rooms} rooms
                  </span>
                </div>
              ) : null}
              {result.domain.customDomain ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Custom domain</span>
                  <span className="text-slate-900">
                    {result.domain.customDomain.hostname}{' '}
                    <Badge className="border-amber-200 bg-amber-50 text-amber-700 normal-case">
                      {result.domain.customDomain.status}
                    </Badge>
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Temporary domain</span>
                <span className="font-mono text-slate-900">{result.domain.tempDomain}</span>
              </div>
            </div>

            {/* The AGREED subscription terms (mission §2 STEP 3) with the
                honest billing posture: terms are recorded, nothing is
                billed and no payment exists yet. */}
            {result.subscription ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  Subscription terms
                </p>
                <div className="mt-2 grid gap-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Billing</span>
                    <span className="text-slate-900">
                      {BILLING_MODEL_LABELS[result.subscription.billingModel] ?? result.subscription.billingModel} ·{' '}
                      {FREQUENCY_LABELS[result.subscription.interval] ?? result.subscription.interval}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Agreed price</span>
                    <span className="text-slate-900">
                      {new Intl.NumberFormat('en-IN', {
                        style: 'currency',
                        currency: result.subscription.currency,
                      }).format(result.subscription.unitPrice)}
                      {result.subscription.licensedStudents != null
                        ? ` × ${result.subscription.licensedStudents} licensed students`
                        : ''}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Starts</span>
                    <span className="text-slate-900">{result.subscription.periodStart}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Payments recorded</span>
                    <span className="font-medium text-amber-700">
                      {result.subscription.paymentsRecorded} — no payment yet; the paid period starts
                      when a verified payment is recorded from the school record
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* School login URL — the canonical door (PHASE 10). Copied
                links resolve relative URLs against the current origin so
                the operator always hands out a working address. */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                School login URL
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The door the principal, staff, students and parents sign in through — copy it exactly;
                never guess a school address.
              </p>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900"
                  title={result.loginUrl}
                >
                  {result.loginUrl}
                </code>
                <div className="flex shrink-0 items-center gap-2">
                  <CopyInlineButton value={result.loginUrl} absolute label="Copy school login URL" />
                  <a
                    href={result.loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open Login
                  </a>
                </div>
              </div>
            </div>

            {/* Website preview URL — the canonical public door (P0-B).
                publicUrl comes from SCHOOL_APP_BASE_URL (absolute cross-plane
                link) or the unified-deployment ?tenant= fallback; opening it
                from the PLATFORM console must land on the SCHOOL website,
                never on the console's own origin — so the button resolves
                relative values against the current origin, same as copy. */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                Website preview URL
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The school&rsquo;s public website (tenant site). A custom domain only
                becomes the door after DNS verification — until then this is the
                canonical preview address.
              </p>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900"
                  title={result.publicUrl}
                >
                  {result.publicUrl}
                </code>
                <div className="flex shrink-0 items-center gap-2">
                  <CopyInlineButton value={result.publicUrl} absolute label="Copy website preview URL" />
                  <a
                    href={result.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open Website
                  </a>
                </div>
              </div>
            </div>

            {/* One-time credential (server-generated only) or the honest
                forced-change note when the operator supplied the password. */}
            {result.tempPassword ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
                  One-time credential
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Shown only once — the principal must replace it at first sign-in (enforced).
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900">
                    {result.tempPassword}
                  </code>
                  <CopyInlineButton
                    value={result.tempPassword}
                    label="Copy one-time credential"
                    tone="amber"
                  />
                </div>
              </div>
            ) : result.mustChangePassword ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <p>
                  <span className="font-semibold text-slate-700">Forced first-password change is armed.</span>{' '}
                  The password you supplied is a bootstrap value — the principal must set their own at
                  first sign-in (server-enforced).
                </p>
              </div>
            ) : null}

            {/* Principal invitation email status (Phase 3) — the honest
                delivery state from the email pipeline. FAILED/UNKNOWN
                turn amber with the recovery path (manual delivery or
                re-issue from the school record); SENT/QUEUED confirm
                the channel. NEVER a fabricated "delivered". */}
            {result.invitation ? (
              <div
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                  result.invitation.state === 'FAILED' || result.invitation.state === 'NONE'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-teal-200 bg-teal-50 text-teal-800'
                }`}
              >
                {result.invitation.state === 'FAILED' || result.invitation.state === 'NONE' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <p>
                  <span className="font-semibold">Invitation email to {result.principal.email}:</span>{' '}
                  {result.invitation.state === 'SENT'
                    ? 'delivered to the email pipeline (sent).'
                    : result.invitation.state === 'QUEUED'
                      ? 'accepted by the email provider — delivery pending confirmation.'
                      : result.invitation.state === 'FAILED'
                        ? `failed${result.invitation.errorClass ? ` (${result.invitation.errorClass})` : ''} — hand over the one-time credential yourself, or re-issue it from the school record's Access card.`
                        : "no delivery on record — hand over the one-time credential yourself, or re-issue it from the school record's Access card."}
                  {result.invitation.transport ? (
                    <span className="block text-[11px] opacity-70">transport: {result.invitation.transport}</span>
                  ) : null}
                </p>
              </div>
            ) : null}

            {/* Remaining setup tasks — the honest checklist (mission §2
                STEP 7 completion page). */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Remaining setup tasks
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {remainingTasks.map((task) => (
                  <li key={task}>{task}</li>
                ))}
              </ul>
            </div>

            {/* Data-driven next-step hint from the provision response. */}
            {result.nextStep === 'activate' && (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <p>
                  <span className="font-semibold text-slate-700">Next step:</span> the school is PENDING —
                  activate it from its record to enable sign-in.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => router.push('/platform/schools')}
                className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
              >
                Back to schools
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  window.open(
                    result.publicUrl.startsWith('/')
                      ? `${window.location.origin}${result.publicUrl}`
                      : result.publicUrl,
                    '_blank',
                    'noopener',
                  )
                }
                className="border-slate-300 bg-white text-slate-700 hover:bg-slate-100 h-10 focus-ring"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Preview website
              </Button>
              <Button
                onClick={() => router.push(`/platform/schools/${result.school.id}`)}
                className="bg-teal-600 hover:bg-teal-700 text-white font-semibold h-10 focus-ring"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open school record
              </Button>
            </div>
          </div>
        ) : (
          // ── Wizard ────────────────────────────────────────────────────
          <div className="space-y-5">
            <header>
              <h1 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                <Building2 className="h-5 w-5 text-teal-600" aria-hidden="true" />
                Add school
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Seven steps create the tenant ecosystem — identity, principal, subscription, academics,
                branding, address and review. One platform, one database: the school is data, not a deployment.
              </p>
            </header>

            {/* Saved-draft decision — NEVER auto-loaded: the operator
                resumes or discards it explicitly, and auto-save stays
                paused until then so this fresh form cannot clobber the
                stored draft before the decision is made. */}
            {draft ? (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-2.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    A saved draft from <span className="font-semibold">{draftWhen}</span> is waiting —{' '}
                    {draft.form.name.trim() ? `“${draft.form.name.trim()}”` : 'an unfinished school'} at
                    step {draft.step} of {STEPS.length}. Resume where you left off, or discard it and
                    start fresh.
                    <span className="mt-0.5 block text-[11px] opacity-80">
                      For security, the principal password is never saved in drafts.
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={discardDraft}
                    className="h-9 border-amber-300 bg-white text-amber-800 hover:bg-amber-100 focus-ring"
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={resumeDraft}
                    className="h-9 bg-teal-600 font-semibold text-white hover:bg-teal-700 focus-ring"
                  >
                    Resume draft
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm sm:px-4">
              <StepDots step={step} onJump={jumpTo} />
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
              >
                <p className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
                {/* SCHEMA-PENDING recovery (Task 4): the pending database
                    only accepts the school-wide billing model without
                    terms — switch and retry without leaving the wizard. */}
                {errorCode === 'SUBSCRIPTION_SYSTEM_PENDING' && form.billingModel !== 'SCHOOL_WIDE' ? (
                  <div className="mt-2.5 pl-6">
                    <Button
                      size="sm"
                      onClick={() => {
                        set('billingModel', 'SCHOOL_WIDE')
                        set('billingFrequency', 'ANNUAL')
                        void submit({ billingModel: 'SCHOOL_WIDE', dropTerms: true })
                      }}
                      disabled={busy}
                      className="h-9 bg-teal-600 font-semibold text-white hover:bg-teal-700 focus-ring"
                    >
                      {busy ? 'Retrying…' : 'Switch to school-wide billing and retry'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {/* STEP 1 — SCHOOL IDENTITY */}
            {step === 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pw-name" className="text-xs font-semibold text-slate-700">
                    Full official school name *
                  </Label>
                  <Input
                    id="pw-name"
                    value={form.name}
                    onChange={(e) => {
                      const v = e.target.value
                      setForm((f) => ({
                        ...f,
                        name: v,
                        // Auto-generated fields follow the name until the
                        // operator edits them by hand.
                        ...(autoShortName ? { shortName: deriveShortName(v) } : {}),
                        ...(autoSlug ? { slug: slugifyName(v) } : {}),
                      }))
                    }}
                    placeholder="Green Valley Public School"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-shortname" className="text-xs font-semibold text-slate-700">
                    Short name <span className="font-normal text-slate-400">(auto-generated — editable)</span>
                  </Label>
                  <Input
                    id="pw-shortname"
                    value={form.shortName}
                    onChange={(e) => {
                      setAutoShortName(false)
                      set('shortName', e.target.value)
                    }}
                    placeholder="Green Valley"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">
                    Generated from the official name — used for the crest label, footers and the login wordmark.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-board" className="text-xs font-semibold text-slate-700">
                    School board *
                  </Label>
                  <select
                    id="pw-board"
                    value={form.board}
                    onChange={(e) => set('board', e.target.value)}
                    className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                  >
                    {BOARD_OPTIONS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400">UP Board or CBSE — the two boards the platform onboards.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-slug" className="text-xs font-semibold text-slate-700">
                    School URL slug *
                  </Label>
                  <Input
                    id="pw-slug"
                    value={form.slug}
                    onChange={(e) => {
                      setAutoSlug(false)
                      set('slug', e.target.value.toLowerCase())
                    }}
                    placeholder="green-valley-public-school"
                    className={`${field} font-mono`}
                    aria-describedby="pw-slug-hint"
                  />
                  <div id="pw-slug-hint" className="space-y-1">
                    <p className="text-[10px] text-slate-400">
                      Auto-generated from the name — the school&rsquo;s link identity (login and website URLs).
                    </p>
                    {slugCheck && slugCheck.patternValid ? (
                      slugCheck.available ? (
                        <p className="flex items-center gap-1 text-[11px] font-medium text-teal-700">
                          <Check className="h-3 w-3" aria-hidden="true" /> {slugCheck.value} is available
                        </p>
                      ) : (
                        <div className="text-[11px] font-medium text-red-600">
                          <p>{slugCheck.value} is already in use — pick an alternative:</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {slugCheck.suggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setAutoSlug(false)
                                  set('slug', s)
                                }}
                                className="rounded-md border border-red-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-700 transition-colors hover:bg-red-50 focus-ring"
                              >
                                {s}
                              </button>
                            ))}
                            {suggestSlugAlternatives(form.slug).length === 0 ? null : null}
                          </div>
                        </div>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-code" className="text-xs font-semibold text-slate-700">
                    School code <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-code"
                    value={form.code}
                    onChange={(e) => set('code', e.target.value.toUpperCase())}
                    placeholder="Leave blank to auto-assign"
                    className={`${field} font-mono`}
                    aria-describedby="pw-code-hint"
                  />
                  <div id="pw-code-hint" className="space-y-1">
                    <p className="text-[10px] text-slate-400">
                      Some schools have an official or internal code — enter it if so. When left blank, the
                      internal record prefix is assigned as the code.
                    </p>
                    {codeCheck && codeCheck.patternValid ? (
                      codeCheck.available ? (
                        <p className="flex items-center gap-1 text-[11px] font-medium text-teal-700">
                          <Check className="h-3 w-3" aria-hidden="true" /> {codeCheck.value} is available
                        </p>
                      ) : (
                        <p className="text-[11px] font-medium text-red-600">
                          {codeCheck.value} is already in use by another school
                        </p>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <p className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span>
                      <span className="font-semibold text-slate-700">Internal record prefix:</span>{' '}
                      allocated server-side at creation (concurrency-safe, stable forever).{' '}
                      {prefixPreview ? (
                        <>
                          Next available for this name:{' '}
                          <span className="font-mono font-semibold text-slate-900">{prefixPreview}</span>.
                        </>
                      ) : (
                        'Type the school name to preview it.'
                      )}
                    </span>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-email" className="text-xs font-semibold text-slate-700">
                    Contact email <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set('contactEmail', e.target.value)}
                    placeholder="office@greenvalley.edu"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">The school&rsquo;s general email (office/front desk).</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-phone" className="text-xs font-semibold text-slate-700">
                    Contact phone <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-phone"
                    value={form.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                    placeholder="+91 98765 43210"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">Full details are collected on the Address step.</p>
                </div>
              </div>
            ) : null}

            {/* STEP 2 — PRINCIPAL & ADMINISTRATOR */}
            {step === 2 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-pname" className="text-xs font-semibold text-slate-700">
                    Principal name *
                  </Label>
                  <Input
                    id="pw-pname"
                    value={form.principalName}
                    onChange={(e) => set('principalName', e.target.value)}
                    placeholder="Meera Iyer"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-pemail" className="text-xs font-semibold text-slate-700">
                    Principal email *
                  </Label>
                  <Input
                    id="pw-pemail"
                    type="email"
                    value={form.principalEmail}
                    onChange={(e) => set('principalEmail', e.target.value)}
                    placeholder="principal@greenvalley.edu"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">
                    The account is created for THIS school tenant only — tenant isolation is enforced server-side.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-pphone" className="text-xs font-semibold text-slate-700">
                    Principal phone <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-pphone"
                    value={form.principalPhone}
                    onChange={(e) => set('principalPhone', e.target.value)}
                    placeholder="+91 91234 56789"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">Stored on the principal&rsquo;s profile — no new verification flow.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-ppass" className="text-xs font-semibold text-slate-700">
                    Temporary password{' '}
                    <span className="font-normal text-slate-400">(optional — auto-generated when blank)</span>
                  </Label>
                  <Input
                    id="pw-ppass"
                    type="text"
                    autoComplete="off"
                    value={form.principalPassword}
                    onChange={(e) => set('principalPassword', e.target.value)}
                    placeholder="Leave blank to auto-generate a one-time password"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">
                    No shared defaults. One-time bootstrap — the principal must replace it at first sign-in
                    (server-enforced). Additional administrators are added from the school record later.
                  </p>
                </div>
              </div>
            ) : null}

            {/* STEP 3 — SUBSCRIPTION & PRICING */}
            {step === 3 ? (
              <div className="space-y-4">
                {/* Billing model — exactly two (mission §2 STEP 3). */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Billing model *</Label>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Billing model">
                    {BILLING_MODEL_OPTIONS.map((opt) => {
                      const active = form.billingModel === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => {
                            setForm((f) => ({
                              ...f,
                              billingModel: opt.value,
                              // Student-based is YEARLY ONLY — switching the
                              // model can never leave MONTHLY selected.
                              ...(opt.value === 'PER_STUDENT' && f.billingFrequency === 'MONTHLY'
                                ? { billingFrequency: 'ANNUAL' as const }
                                : {}),
                            }))
                          }}
                          className={`rounded-xl border p-3 text-left transition-colors focus-ring ${
                            active
                              ? 'border-teal-400 bg-teal-50/60 ring-1 ring-teal-500/30'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <span className="block text-sm font-semibold text-slate-900">{opt.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                            {opt.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Billing frequency — dynamic per model (mission §2 STEP 3):
                    student-based NEVER offers monthly. */}
                <div className="space-y-1.5">
                  <Label htmlFor="pw-freq" className="text-xs font-semibold text-slate-700">
                    Billing frequency *
                  </Label>
                  <select
                    id="pw-freq"
                    value={form.billingFrequency}
                    onChange={(e) => set('billingFrequency', e.target.value)}
                    disabled={isStudentBased}
                    className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500`}
                    aria-describedby="pw-freq-hint"
                  >
                    {frequencyOptionsFor(form.billingModel).map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <p id="pw-freq-hint" className="text-[11px] leading-snug text-slate-400">
                    {isStudentBased
                      ? 'Student-based subscriptions are billed yearly only — monthly is never offered for them.'
                      : 'School-based billing: monthly or yearly.'}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-amount" className="text-xs font-semibold text-slate-700">
                      Agreed amount ({unitLabel}) *
                    </Label>
                    <Input
                      id="pw-amount"
                      inputMode="decimal"
                      value={form.agreedAmount}
                      onChange={(e) => set('agreedAmount', e.target.value)}
                      placeholder={isStudentBased ? '1200' : '24000'}
                      className={field}
                      aria-describedby="pw-amount-hint"
                    />
                    <p id="pw-amount-hint" className="text-[10px] text-slate-400">
                      The commercial amount actually agreed with the school{isStudentBased ? ' — per student, per year.' : '.'}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-currency" className="text-xs font-semibold text-slate-700">
                      Currency *
                    </Label>
                    <select
                      id="pw-currency"
                      value={form.currency}
                      onChange={(e) => set('currency', e.target.value)}
                      className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400">The platform&rsquo;s supported currency set.</p>
                  </div>
                  {isStudentBased ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="pw-licensed" className="text-xs font-semibold text-slate-700">
                        Licensed student count *
                      </Label>
                      <Input
                        id="pw-licensed"
                        inputMode="numeric"
                        value={form.licensedStudents}
                        onChange={(e) => set('licensedStudents', e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="500"
                        className={field}
                      />
                      <p className="text-[10px] text-slate-400">
                        The billable student quantity for the first year (1–100,000).
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-startson" className="text-xs font-semibold text-slate-700">
                      Subscription start date *
                    </Label>
                    <Input
                      id="pw-startson"
                      type="date"
                      value={form.subscriptionStartsOn}
                      onChange={(e) => set('subscriptionStartsOn', e.target.value)}
                      className={field}
                    />
                    <p className="text-[10px] text-slate-400">
                      Defaults to today. The paid period only begins once a verified payment is recorded.
                    </p>
                  </div>
                </div>

                {/* Price breakdown (mission §2 STEP 3): the operator
                    sees exactly what will be charged, computed from the
                    entered values — never a hardcoded price. */}
                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-700">Price breakdown</p>
                  {amountNum != null ? (
                    <div className="space-y-1 text-sm">
                      {isStudentBased ? (
                        <>
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">
                              {money(amountNum)} per student / year × {licensedNum ?? '—'} licensed students
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5">
                            <span className="font-semibold text-slate-700">First-year total</span>
                            <span className="font-semibold text-slate-900">
                              {licensedNum != null ? money(amountNum * licensedNum) : '— enter the student count'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between gap-4">
                          <span className="text-slate-500">
                            {form.billingFrequency === 'MONTHLY'
                              ? 'Monthly price (billed once a payment is recorded)'
                              : 'Yearly price (billed once a payment is recorded)'}
                          </span>
                          <span className="font-semibold text-slate-900">{money(amountNum)}</span>
                        </div>
                      )}
                      <p className="pt-1 text-[11px] leading-snug text-slate-500">
                        Creating the school records these agreed terms only — no payment is fabricated and the
                        subscription is not marked paid. The first verified payment (recorded from the school
                        record&rsquo;s Subscription tab) starts the paid period.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Enter the agreed amount to see the breakdown.</p>
                  )}
                </div>
              </div>
            ) : null}

            {/* STEP 4 — ACADEMIC SETUP */}
            {step === 4 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-year" className="text-xs font-semibold text-slate-700">
                      Academic session *
                    </Label>
                    <Input
                      id="pw-year"
                      value={form.academicYear}
                      onChange={(e) => {
                        setAutoYear(false)
                        set('academicYear', e.target.value)
                      }}
                      placeholder="2026-2027"
                      className={field}
                    />
                    <p className="text-[10px] text-slate-400">
                      Auto-defaulted from today&rsquo;s date and the school&rsquo;s timezone (Indian April–March
                      year) — edit if the school&rsquo;s session differs.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-tz" className="text-xs font-semibold text-slate-700">
                      Timezone *
                    </Label>
                    <select
                      id="pw-tz"
                      value={form.timezone}
                      onChange={(e) => {
                        const tz = e.target.value
                        setForm((f) => ({
                          ...f,
                          timezone: tz,
                          // The academic-session default follows the
                          // timezone until the operator edits it.
                          ...(autoYear ? { academicYear: defaultAcademicSession(new Date(), tz) } : {}),
                        }))
                      }}
                      className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Working days *</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d) => {
                      const active = form.workingDays.includes(d.key)
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() =>
                            set(
                              'workingDays',
                              active
                                ? form.workingDays.filter((k) => k !== d.key)
                                : [...form.workingDays, d.key],
                            )
                          }
                          className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors focus-ring ${
                            active
                              ? 'border-teal-300 bg-teal-50 text-teal-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                          }`}
                          aria-pressed={active}
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Basic timetable context. The school configures the full timetable later in its ERP.
                  </p>
                </div>

                {/* Classes offered — practical selection (mission §2
                    STEP 4): pick what the school actually offers; never
                    forced to offer every class. */}
                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      Classes offered <span className="font-normal text-slate-400">(select what applies)</span>
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {CLASS_PRESETS.map((preset) => {
                        const [from, to] = preset.range
                        const allSelected = (() => {
                          for (let n = from; n <= to; n += 1) {
                            if (!form.classRows.some((r) => r.name === `Class ${n}`)) return false
                          }
                          return true
                        })()
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => togglePresetClasses(preset.range)}
                            aria-pressed={allSelected}
                            className={`h-8 rounded-lg border px-2.5 text-[11px] font-medium transition-colors focus-ring ${
                              allSelected
                                ? 'border-teal-300 bg-teal-50 text-teal-700'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {preset.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {form.classRows.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      No classes selected yet — pick a preset above, or add the school&rsquo;s own classes.
                      Classes can also be configured later by the principal.
                    </p>
                  ) : null}
                  {form.classRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={row.name}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            classRows: f.classRows.map((r, j) =>
                              j === i ? { ...r, name: e.target.value } : r,
                            ),
                          }))
                        }
                        placeholder="Class 1"
                        className={`${field} h-9 flex-1`}
                        aria-label={`Class row ${i + 1} name`}
                      />
                      <Input
                        value={row.sections}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            classRows: f.classRows.map((r, j) =>
                              j === i ? { ...r, sections: e.target.value } : r,
                            ),
                          }))
                        }
                        placeholder="A, B"
                        className={`${field} h-9 w-28`}
                        aria-label={`Class row ${i + 1} sections (comma-separated)`}
                      />
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setForm((f) => ({ ...f, classRows: f.classRows.filter((_, j) => j !== i) }))
                        }
                        className="h-9 px-2 text-slate-400 hover:text-red-600 focus-ring"
                        aria-label={`Remove class row ${i + 1}`}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  {customClasses.length === 0 && form.classRows.length > 0 ? (
                    <p className="text-[10px] text-slate-400">
                      {form.classRows.length} classes · default section A (edit each row to change).
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => setForm((f) => ({ ...f, classRows: [...f.classRows, { name: '', sections: 'A' }] }))}
                    disabled={form.classRows.length >= 40}
                    className="h-8 w-fit border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-100 focus-ring"
                  >
                    + Add the school&rsquo;s own class
                  </Button>
                </div>

                {/* Optional: subjects & rooms */}
                <OptionalSection
                  title="Optional — subjects & rooms"
                  description="Bootstrap school-level subjects and rooms now, or leave them to the principal in the school's ERP."
                  open={openSections.bootstrap}
                  onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, bootstrap: v }))}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-subjects" className="text-xs font-semibold text-slate-700">
                      Subjects
                    </Label>
                    <textarea
                      id="pw-subjects"
                      value={form.subjectsText}
                      onChange={(e) => set('subjectsText', e.target.value)}
                      placeholder="English, Mathematics, Science, Hindi, Social Studies, Computer Science"
                      rows={3}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500/40"
                    />
                    <p className="text-[10px] text-slate-400">
                      Comma-separated · {parsedSubjects.length}/60 · optional.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-rooms" className="text-xs font-semibold text-slate-700">
                      Rooms
                    </Label>
                    <Input
                      id="pw-rooms"
                      value={form.roomsText}
                      onChange={(e) => set('roomsText', e.target.value)}
                      placeholder="Room 101, Room 102, Science Lab, Computer Lab"
                      className={field}
                    />
                    <p className="text-[10px] text-slate-400">
                      Comma-separated · {parsedRooms.length}/40 · optional.
                    </p>
                  </div>
                </OptionalSection>
              </div>
            ) : null}

            {/* STEP 5 — BRANDING & WEBSITE */}
            {step === 5 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-color" className="text-xs font-semibold text-slate-700">
                      Primary colour *
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="pw-color"
                        value={form.themeColor}
                        onChange={(e) => set('themeColor', e.target.value.toLowerCase())}
                        placeholder="#0f766e"
                        className={`${field} font-mono w-36`}
                      />
                      <span
                        className="h-10 w-10 shrink-0 rounded-lg border border-slate-200"
                        style={{ backgroundColor: form.themeColor }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {PRIMARY_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => set('themeColor', preset.value)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-ring ${
                            form.themeColor === preset.value
                              ? 'border-slate-900 bg-white text-slate-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                          aria-pressed={form.themeColor === preset.value}
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-sm border border-slate-200"
                            style={{ backgroundColor: preset.value }}
                            aria-hidden="true"
                          />
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-accent" className="text-xs font-semibold text-slate-700">
                      Secondary / accent colour *
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="pw-accent"
                        value={form.accentColor}
                        onChange={(e) => set('accentColor', e.target.value.toLowerCase())}
                        placeholder="#f59e0b"
                        className={`${field} font-mono w-36`}
                      />
                      <span
                        className="h-10 w-10 shrink-0 rounded-lg border border-slate-200"
                        style={{ backgroundColor: form.accentColor }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {ACCENT_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => set('accentColor', preset.value)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-ring ${
                            form.accentColor === preset.value
                              ? 'border-slate-900 bg-white text-slate-900'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                          aria-pressed={form.accentColor === preset.value}
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-sm border border-slate-200"
                            style={{ backgroundColor: preset.value }}
                            aria-hidden="true"
                          />
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pw-tagline" className="text-xs font-semibold text-slate-700">
                      Tagline (if the school provides one)
                    </Label>
                    <Input
                      id="pw-tagline"
                      value={form.tagline}
                      onChange={(e) => set('tagline', e.target.value)}
                      placeholder="Leave blank — never invented"
                      className={field}
                    />
                    <p className="text-[10px] text-slate-400">
                      Only what the school actually provides. Empty is honest — the website shows a clean
                      placeholder until the school writes its own content.
                    </p>
                  </div>
                </div>

                {/* Live branding preview — a small, useful mock of the
                    school's public identity rendered with the chosen
                    colours + names (data only; the real website uses the
                    same School fields). */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700">Live preview</p>
                  <div
                    className="relative overflow-hidden rounded-xl border border-slate-200"
                    style={{ backgroundColor: form.themeColor }}
                  >
                    <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-bold text-white"
                        style={{ borderColor: form.accentColor, backgroundColor: 'rgba(255,255,255,0.15)' }}
                        aria-hidden="true"
                      >
                        {(form.shortName.trim() || form.name.trim() || 'S')
                          .split(/\s+/)
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 3)
                          .toUpperCase()}
                      </span>
                      <span className="text-base font-semibold text-white">
                        {form.shortName.trim() || form.name.trim() || 'School name'}
                      </span>
                      <span className="max-w-md truncate text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        {form.tagline.trim() || 'Tagline appears here once the school provides one'}
                      </span>
                      <span
                        className="mt-1 h-1 w-16 rounded-full"
                        style={{ backgroundColor: form.accentColor }}
                        aria-hidden="true"
                      />
                      <span
                        className="mt-2 rounded-md px-3 py-1.5 text-[11px] font-semibold"
                        style={{ backgroundColor: form.accentColor, color: '#1f2937' }}
                        aria-hidden="true"
                      >
                        Sign in
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    The crest, wordmark and accents use the school&rsquo;s colours. Logo and favicon are
                    uploaded by the school itself from its settings after activation — the platform never
                    invents branding.
                  </p>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-teal-300 bg-teal-50/60 p-4 focus-ring">
                  <input
                    type="checkbox"
                    checked={form.websiteEnabled}
                    onChange={(e) => set('websiteEnabled', e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
                    aria-label="Website enabled"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      Public school website enabled
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      The school gets its public website — home, about, academics, admissions, contact and
                      its own login — as soon as it is activated, on the standard Scholario template
                      configured through the branding above.
                    </span>
                  </span>
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-customdomain" className="text-xs font-semibold text-slate-700">
                    Custom domain <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-customdomain"
                    value={form.customDomain}
                    onChange={(e) => set('customDomain', e.target.value.toLowerCase())}
                    placeholder="www.greenvalley.edu"
                    className={`${field} font-mono`}
                  />
                  <p className="text-[10px] text-slate-400">
                    Recorded as PENDING with a verification token — the school proves ownership with a DNS
                    TXT record before it routes traffic. A missing custom domain never blocks creation.
                  </p>
                </div>
                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-700">Temporary platform domain</p>
                  <p className="font-mono text-sm text-slate-900">
                    {tempDomain || 'derived from the slug (fill it in step 1)'}
                  </p>
                  <p className="text-[10px] leading-relaxed text-slate-400">
                    The school&rsquo;s platform subdomain, separate from any custom domain. Until DNS is
                    configured, the website is reachable through the tenant link{' '}
                    <span className="font-mono text-slate-600">
                      /?tenant={form.slug || 'school-slug'}
                    </span>{' '}
                    — a development fallback, never the final customer URL.
                  </p>
                </div>
              </div>
            ) : null}

            {/* STEP 6 — ADDRESS & CONTACT */}
            {step === 6 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pw-address" className="text-xs font-semibold text-slate-700">
                    Address line 1 *
                  </Label>
                  <Input
                    id="pw-address"
                    value={form.address}
                    onChange={(e) => set('address', e.target.value)}
                    placeholder="12 Education Avenue"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pw-address2" className="text-xs font-semibold text-slate-700">
                    Address line 2 <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-address2"
                    value={form.addressLine2}
                    onChange={(e) => set('addressLine2', e.target.value)}
                    placeholder="Near Civil Lines"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-city" className="text-xs font-semibold text-slate-700">
                    City *
                  </Label>
                  <Input
                    id="pw-city"
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                    placeholder="Jhansi"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-district" className="text-xs font-semibold text-slate-700">
                    District <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-district"
                    value={form.district}
                    onChange={(e) => set('district', e.target.value)}
                    placeholder="Jhansi"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-state" className="text-xs font-semibold text-slate-700">
                    State *
                  </Label>
                  <Input
                    id="pw-state"
                    value={form.state}
                    onChange={(e) => set('state', e.target.value)}
                    placeholder="Uttar Pradesh"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-pin" className="text-xs font-semibold text-slate-700">
                    PIN / postal code{' '}
                    <span className="font-normal text-slate-400">
                      {form.country.trim().toLowerCase() === 'india' ? '' : '(optional)'}
                    </span>
                  </Label>
                  <Input
                    id="pw-pin"
                    inputMode="numeric"
                    value={form.pincode}
                    onChange={(e) => set('pincode', e.target.value)}
                    placeholder="284001"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">
                    {form.country.trim().toLowerCase() === 'india'
                      ? 'Indian PIN — 6 digits, first digit 1–8.'
                      : 'Validated per the chosen country.'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-country" className="text-xs font-semibold text-slate-700">
                    Country *
                  </Label>
                  <Input
                    id="pw-country"
                    value={form.country}
                    onChange={(e) => set('country', e.target.value)}
                    placeholder="India"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-gemail" className="text-xs font-semibold text-slate-700">
                    General school email <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-gemail"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set('contactEmail', e.target.value)}
                    placeholder="office@greenvalley.edu"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-gphone" className="text-xs font-semibold text-slate-700">
                    Contact phone <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-gphone"
                    value={form.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                    placeholder="+91 98765 43210"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-website" className="text-xs font-semibold text-slate-700">
                    School website <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-website"
                    value={form.website}
                    onChange={(e) => set('website', e.target.value)}
                    placeholder="greenvalley.edu"
                    className={`${field} font-mono`}
                  />
                  <p className="text-[10px] text-slate-400">
                    The school&rsquo;s existing external website, shown on its public page.
                  </p>
                </div>
              </div>
            ) : null}

            {/* STEP 7 — REVIEW & CREATE */}
            {step === 7 ? (
              <div className="space-y-3">
                {/* Missing-required indicators — defensive (per-step Next
                    validation normally prevents reaching review with
                    issues); Create stays disabled until they are fixed. */}
                {reviewIssues.length > 0 ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                  >
                    <p className="flex items-start gap-2 font-semibold">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Required information still missing:
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-9">
                      {reviewIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {(
                  [
                    {
                      stepId: 1,
                      label: 'School identity',
                      state: stepIssue(1).message ? 'attention' : 'ready',
                      rows: [
                        ['School', `${form.name}${form.shortName ? ` (${form.shortName})` : ''}`],
                        ['Board', BOARD_OPTIONS.find((b) => b.value === form.board)?.label ?? form.board],
                        ['Slug · status', `${form.slug} · ${slugCheck?.available === false ? 'already in use' : slugCheck?.available === true ? 'available' : 'checked at creation'}`],
                        ['School code', form.code.trim() || `auto-assigned from the record prefix (${prefixPreview || 'derived at creation'})`],
                        ['Record prefix', prefixPreview ? `${prefixPreview} (next available — allocated at creation)` : 'allocated server-side at creation'],
                      ],
                    },
                    {
                      stepId: 2,
                      label: 'Principal',
                      state: stepIssue(2).message ? 'attention' : 'ready',
                      rows: [
                        ['Principal', `${form.principalName} · ${form.principalEmail}`],
                        ['Phone', form.principalPhone.trim() || '—'],
                        ['Credential', form.principalPassword ? 'operator-supplied (forced change at first sign-in)' : 'auto-generated one-time (shown once)'],
                      ],
                    },
                    {
                      stepId: 3,
                      label: 'Subscription & pricing',
                      state: stepIssue(3).message ? 'attention' : 'ready',
                      rows: [
                        [
                          'Billing',
                          `${BILLING_MODEL_LABELS[form.billingModel] ?? form.billingModel} · ${FREQUENCY_LABELS[form.billingFrequency] ?? form.billingFrequency}`,
                        ],
                        [
                          'Agreed price',
                          amountNum != null
                            ? `${money(amountNum)} ${unitLabel}${isStudentBased ? ` × ${licensedNum ?? '—'} students` : ''}${isStudentBased && licensedNum != null ? ` = ${money(amountNum * licensedNum)}` : ''}`
                            : '—',
                        ],
                        ['Starts', form.subscriptionStartsOn],
                        ['Payments', 'none recorded yet — terms only, nothing billed at creation'],
                      ],
                    },
                    {
                      stepId: 4,
                      label: 'Academic setup',
                      state: stepIssue(4).message ? 'attention' : parsedClasses.length === 0 ? 'optional' : 'ready',
                      rows: [
                        ['Session · timezone', `${form.academicYear || '—'} · ${form.timezone}`],
                        ['Working days', form.workingDays.join(', ')],
                        [
                          'Classes',
                          parsedClasses.length > 0
                            ? parsedClasses
                                .map((c) => (c.sections.length > 0 ? `${c.name} (${c.sections.join(', ')})` : c.name))
                                .join(', ')
                            : 'not configured — the principal sets them up later',
                        ],
                        ['Subjects', parsedSubjects.length > 0 ? parsedSubjects.join(', ') : '—'],
                        ['Rooms', parsedRooms.length > 0 ? parsedRooms.join(', ') : '—'],
                      ],
                    },
                    {
                      stepId: 5,
                      label: 'Branding & website',
                      state: stepIssue(5).message ? 'attention' : form.websiteEnabled || form.customDomain ? 'ready' : 'ready',
                      rows: [
                        ['Colours', `${form.themeColor} / ${form.accentColor}${form.tagline ? ' · tagline' : ''}`],
                        ['Website', form.websiteEnabled ? 'enabled' : 'disabled'],
                        [
                          'Custom domain',
                          form.customDomain
                            ? `${form.customDomain} (PENDING until DNS verification)`
                            : 'none — the temporary platform domain serves the site',
                        ],
                        ['Temporary domain', tempDomain || '—'],
                      ],
                    },
                    {
                      stepId: 6,
                      label: 'Address & contact',
                      state: stepIssue(6).message ? 'attention' : 'ready',
                      rows: [
                        [
                          'Address',
                          [form.address, form.addressLine2].filter(Boolean).join(', ') || '—',
                        ],
                        [
                          'City · district · state',
                          [form.city, form.district, form.state].filter(Boolean).join(' · ') || '—',
                        ],
                        [
                          'PIN · country',
                          [form.pincode, form.country].filter(Boolean).join(' · ') || '—',
                        ],
                        [
                          'Contact',
                          [form.contactEmail, form.contactPhone, form.website].filter(Boolean).join(' · ') || '—',
                        ],
                      ],
                    },
                  ] as const
                ).map((section) => (
                  <div key={section.stepId} className="rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-xs font-semibold text-slate-700">{section.label}</p>
                        <SectionStatus state={section.state} />
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => jumpTo(section.stepId)}
                        className="h-7 shrink-0 border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-100 focus-ring"
                        aria-label={`Edit ${section.label}`}
                      >
                        Edit
                      </Button>
                    </div>
                    <div className="grid gap-1.5 px-4 py-3 text-sm">
                      {section.rows.map(([label, value]: readonly [string, string]) => (
                        <div key={label} className="flex justify-between gap-4">
                          <span className="shrink-0 text-slate-500">{label}</span>
                          <span className="min-w-0 break-words text-right text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  CREATE SCHOOL provisions the whole tenant ecosystem in one transaction: school identity,
                  record prefix, subscription terms, branding, website configuration, domain record, the
                  principal account, and the initial academic setup. The school is created in PENDING
                  state — sign-in is blocked until you activate it from the school record. Retries are
                  idempotent: a duplicate submission can never create a second school.
                </p>
              </div>
            ) : null}
            </div>

            {/* Sticky workspace footer — the primary controls stay
                reachable without scrolling. The draft indicator is
                honest: a save failure shows nothing rather than a
                false “saved”. */}
            <div className="sticky bottom-0 z-20 mt-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
              {step === 1 ? (
                <Button
                  variant="outline"
                  onClick={() => router.push('/platform/schools')}
                  disabled={busy}
                  className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Exit
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={back}
                  disabled={busy}
                  className="h-10 border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
              )}
              <p className="min-w-0 text-[11px] text-slate-400" aria-live="polite">
                Step {step} of {STEPS.length}
                <span className="hidden sm:inline">
                  {draftSavedAt
                    ? ` · Draft saved ${new Date(draftSavedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : isFormMeaningful(form)
                      ? ' · Draft saves as you type'
                      : ''}
                </span>
              </p>
              {step < STEPS.length ? (
                <Button
                  onClick={next}
                  className="bg-teal-600 hover:bg-teal-700 text-white font-semibold h-10 focus-ring"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  onClick={() => void submit()}
                  disabled={busy || reviewIssues.length > 0}
                  className="bg-teal-600 hover:bg-teal-700 text-white font-semibold h-10 focus-ring"
                >
                  {busy ? 'Creating…' : 'Create school'}
                </Button>
              )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}
