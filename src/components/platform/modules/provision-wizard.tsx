'use client'

// ============================================================
// ProvisionWizard — the school onboarding workflow
// (PRODUCT-DIRECTION RESET, Part 4 · §6.5 four-step consolidation)
// ------------------------------------------------------------
// Platform → Schools → Add school. FOUR steps that collect everything
// a new tenant needs, then ONE atomic POST /api/platform/schools call
// that transactionally creates the tenant ecosystem:
//
//   School tenant → identity → branding → website configuration →
//   TenantDomain record → founding Principal (+role) → academic
//   session → initial classes/sections/subjects/rooms → config
//
//   · STEP 1  School identity  (name, slug, code, board, plan,
//                                 short name, contact basics)
//   · STEP 2  Administrator    (founding Principal account +
//                                 credential option)
//   · STEP 3  Configuration    (billing model + working days; the
//                                 optional bootstrap/branding/website/
//                                 location fields behind collapsed
//                                 progressive-disclosure sections —
//                                 every POST field is preserved)
//   · STEP 4  Review & create  (summary + missing-required
//                                 indicators → CREATE SCHOOL)
//
// The SUCCESS panel is the school-access truth surface (PHASE 10):
// the new tenant's canonical LOGIN URL (from SCHOOL_APP_BASE_URL —
// never guessed, copy resolves relative URLs against the current
// origin), the founding principal, and the one-time bootstrap
// credential with the forced-change warning.
//
// SCHEMA-PENDING HONESTY (Task 4 wire contract): a POST on a
// pending database either succeeds with subscriptionSchemaPending +
// subscriptionPendingNote (rendered in the success panel), or fails
// with code SUBSCRIPTION_SYSTEM_PENDING (503) when a non-SCHOOL_WIDE
// billing model was chosen — the publicMessage renders INLINE and a
// one-click fix switches the model to school-wide and retries; the
// operator stays on the review step.
//
// One application · one database · many tenants: everything here is
// DATA — no new deployment, repo, or code change per school. The
// school needs no developer.
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const
const SCHOOL_BOARDS = ['CBSE', 'UP_BOARD', 'ICSE', 'STATE', 'CUSTOM'] as const

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
  SCHOOL_WIDE: 'school-wide',
  PER_STUDENT: 'per-student',
  MIXED: 'mixed',
}

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
  plan: string
  contactEmail: string
  contactPhone: string
  // STEP 2 — Administrator (founding principal + credential option)
  principalName: string
  principalEmail: string
  principalPassword: string
  // STEP 3 — Configuration (required) + optional collapsed sections
  /// §4 — subscription billing model (SCHOOL_WIDE | PER_STUDENT | MIXED).
  billingModel: string
  workingDays: string[]
  // Optional: branding
  themeColor: string
  accentColor: string
  tagline: string
  // Optional: website & domain
  websiteEnabled: boolean
  customDomain: string
  // Optional: location & academic session
  address: string
  city: string
  state: string
  country: string
  timezone: string
  academicYear: string
  // Optional: academic bootstrap
  classRows: ClassRow[]
  subjectsText: string
  roomsText: string
}

// Exported for the wizard-empty-form regression test: the inert-row
// invariant (a name-less row must carry no sections) must never regress.
export const EMPTY_FORM: WizardForm = {
  name: '',
  shortName: '',
  code: '',
  slug: '',
  board: 'CBSE',
  plan: 'STANDARD',
  contactEmail: '',
  contactPhone: '',
  principalName: '',
  principalEmail: '',
  principalPassword: '',
  billingModel: 'SCHOOL_WIDE',
  workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  themeColor: '#0f766e',
  accentColor: '#f59e0b',
  tagline: '',
  websiteEnabled: true,
  customDomain: '',
  address: '',
  city: '',
  state: '',
  country: '',
  timezone: 'Asia/Kolkata',
  academicYear: '',
  // No pre-filled sections: a default row with sections but no class name
  // tripped the step-3 validation ("Every class row needs a class name")
  // and blocked Continue for admins who skip the optional bootstrap —
  // the submit path drops name-less rows, so an untouched row must be inert.
  classRows: [{ name: '', sections: '' }],
  subjectsText: '',
  roomsText: '',
}

const STEPS = [
  { id: 1, label: 'School identity', icon: Building2 },
  { id: 2, label: 'Administrator', icon: UserCog },
  { id: 3, label: 'Configuration', icon: GraduationCap },
  { id: 4, label: 'Review & create', icon: ClipboardCheck },
] as const

/** The optional step-3 sections (progressive disclosure). */
type ConfigSectionKey = 'bootstrap' | 'branding' | 'website' | 'location'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z0-9-]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const YEAR_RE = /^\d{4}[-/]\d{4}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const DOMAINISH_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

interface ProvisionResult {
  replayed?: boolean
  replayNote?: string
  school: {
    id: string
    name: string
    slug: string
    code: string
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
  // Phase 3 — invite-email delivery state (honest, never fabricated:
  // SENT | QUEUED | FAILED | NONE + optional transport/errorClass).
  invitation?: { state: string; transport?: string; errorClass?: string; at?: string }
  nextStep: string
  // Task 4 wire contract — provisioned with the legacy schema fields.
  subscriptionSchemaPending?: boolean
  subscriptionPendingNote?: string
}

function StepDots({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Onboarding steps">
      {STEPS.map((s, i) => {
        const done = s.id < step
        const active = s.id === step
        return (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 ? <span className="h-px w-3 bg-slate-200" aria-hidden="true" /> : null}
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                done
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : active
                    ? 'border-teal-600 bg-white text-teal-700'
                    : 'border-slate-200 bg-white text-slate-400'
              }`}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : s.id}
            </span>
            <span
              className={`hidden text-[11px] font-medium sm:inline ${
                active ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
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

// ── Optional-configuration section (§6.5 progressive disclosure) ──────────

/**
 * A collapsed optional section of step 3. Every field the POST sends
 * is preserved — the optional ones simply start collapsed so the
 * required configuration stays visible. When a step-3 validation
 * error points into a section, the wizard expands it.
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

export function ProvisionWizard({
  open,
  onOpenChange,
  onProvisioned,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onProvisioned: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [openSections, setOpenSections] = useState<Record<ConfigSectionKey, boolean>>({
    bootstrap: false,
    branding: false,
    website: false,
    location: false,
  })

  useEffect(() => {
    if (open) {
      setStep(1)
      setForm(EMPTY_FORM)
      setError(null)
      setErrorCode(null)
      setResult(null)
      setOpenSections({ bootstrap: false, branding: false, website: false, location: false })
    }
  }, [open])

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

  // The temporary platform domain is DERIVED from the slug (data, not a
  // choice): <slug>.scholario.cloud in production, with the ?tenant=
  // link as the development fallback until custom domains are live.
  const tempDomain = form.slug && SLUG_RE.test(form.slug) ? `${form.slug}.scholario.cloud` : ''

  // ── Per-step validation (same rules as the six-step wizard — the
  //    POST contract is unchanged, only the screens are fewer). ──────

  const validateIdentity = (): string | null => {
    if (form.name.trim().length < 2) return 'School name is required (2+ characters)'
    if (!CODE_RE.test(form.code) || form.code.length < 2)
      return 'Code must be 2+ chars — uppercase letters, numbers and hyphens only'
    if (!SLUG_RE.test(form.slug) || form.slug.length < 3)
      return 'School slug must be 3+ chars — lowercase letters, numbers and hyphens only'
    if (form.contactEmail && !EMAIL_RE.test(form.contactEmail.trim()))
      return 'Contact email must be a valid email address'
    return null
  }

  const validateAdmin = (): string | null => {
    if (!form.principalName.trim()) return 'Principal name is required'
    if (!EMAIL_RE.test(form.principalEmail.trim())) return 'A valid principal email is required'
    if (form.principalPassword && form.principalPassword.length < 8)
      return 'Password must be at least 8 characters (or leave it blank to auto-generate)'
    return null
  }

  const validateConfiguration = (): { message: string | null; section?: ConfigSectionKey } => {
    if (!HEX_RE.test(form.themeColor))
      return { message: 'Primary color must be a 6-digit hex value (e.g. #0f766e)', section: 'branding' }
    if (!HEX_RE.test(form.accentColor))
      return { message: 'Accent color must be a 6-digit hex value (e.g. #f59e0b)', section: 'branding' }
    const cd = form.customDomain.trim().toLowerCase().replace(/^(https?:\/\/|www\.)+/, '').replace(/\/.*$/, '')
    if (form.customDomain && !DOMAINISH_RE.test(cd))
      return { message: 'Custom domain must look like school.com (no protocol, no path)', section: 'website' }
    if (form.academicYear && !YEAR_RE.test(form.academicYear.trim()))
      return { message: 'Academic session must look like 2026-2027', section: 'location' }
    for (const row of form.classRows) {
      if (!row.name.trim() && row.sections.trim())
        return { message: 'Every class row needs a class name', section: 'bootstrap' }
    }
    if (form.workingDays.length === 0) return { message: 'Select at least one working day' }
    return { message: null }
  }

  const stepIssue = (s: number): { message: string | null; section?: ConfigSectionKey } => {
    if (s === 1) return { message: validateIdentity() }
    if (s === 2) return { message: validateAdmin() }
    if (s === 3) return validateConfiguration()
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

  const buildPayload = () => {
    const classes = form.classRows
      .filter((r) => r.name.trim())
      .slice(0, 40)
      .map((r) => ({
        name: r.name.trim().slice(0, 40),
        sections: r.sections
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
      }))
    return {
      name: form.name.trim(),
      shortName: form.shortName.trim() || undefined,
      slug: form.slug,
      code: form.code,
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      country: form.country.trim() || undefined,
      timezone: form.timezone || undefined,
      academicYear: form.academicYear.trim() || undefined,
      officialEmail: form.contactEmail.trim() || undefined,
      phone: form.contactPhone.trim() || undefined,
      plan: form.plan,
      billingModel: form.billingModel,
      board: form.board,
      // Branding (optional section)
      themeColor: form.themeColor,
      accentColor: form.accentColor,
      tagline: form.tagline.trim() || undefined,
      // Website & domain (optional section)
      websiteEnabled: form.websiteEnabled,
      customDomain: form.customDomain.trim().toLowerCase() || undefined,
      // Founding principal
      principalName: form.principalName.trim(),
      principalEmail: form.principalEmail.trim(),
      principalPassword: form.principalPassword || undefined,
      // Academic bootstrap (optional section)
      classes: classes.length > 0 ? classes : undefined,
      subjects: parsedSubjects.length > 0 ? parsedSubjects : undefined,
      rooms: parsedRooms.length > 0 ? parsedRooms : undefined,
      workingDays: form.workingDays,
    }
  }

  // Review-step missing-required indicators (defensive: per-step Next
  // validation normally prevents reaching step 4 with issues).
  const reviewIssues: string[] = STEPS.map((s) => {
    const issue = stepIssue(s.id)
    return issue.message ? `${s.label}: ${issue.message}` : null
  }).filter((v): v is string => v !== null)

  /**
   * POST /api/platform/schools (unchanged contract). `billingOverride`
   * powers the SUBSCRIPTION_SYSTEM_PENDING recovery: the same payload
   * with the billing model switched to school-wide (the pending
   * database's only servable model).
   */
  const submit = async (billingOverride?: string) => {
    setBusy(true)
    setError(null)
    setErrorCode(null)
    try {
      const payload = buildPayload()
      // 90s timeout: provisioning is a heavy multi-table transaction plus
      // the invite email — well beyond platformApi's 30s default.
      const res = await platformApi('/api/platform/schools', {
        method: 'POST',
        body: JSON.stringify(
          billingOverride ? { ...payload, billingModel: billingOverride } : payload,
        ),
      }, 90_000)
      setResult(res as unknown as ProvisionResult)
      if ((res as unknown as ProvisionResult).replayed) {
        toast.info('Matched an existing PENDING provision — no duplicate created')
      } else {
        toast.success('School created — activate it to enable sign-in')
      }
      onProvisioned()
    } catch (e) {
      const err = e as PlatformApiError
      // SUBSCRIPTION_SYSTEM_PENDING (503) is kept IN the wizard (review
      // step) with its publicMessage + a one-click model fix — the
      // operator can retry without losing any entered data.
      setErrorCode(err.code || null)
      setError(err.error || 'Provisioning failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scrollbar bg-white border-slate-200 text-slate-900 sm:max-w-2xl">
        {result ? (
          // ── Success panel ────────────────────────────────────────────
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${
                    result.replayed ? 'bg-amber-500' : 'bg-teal-600'
                  }`}
                >
                  {result.replayed ? (
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                {result.replayed ? `${result.school.name} — already provisioned` : `${result.school.name} created`}
              </DialogTitle>
              <DialogDescription className="text-slate-500">
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
              </DialogDescription>
            </DialogHeader>

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
                  <span className="text-slate-500">Bootstrap</span>
                  <span className="text-slate-900">
                    {result.bootstrap.classes} classes · {result.bootstrap.subjects} subjects ·{' '}
                    {result.bootstrap.rooms} rooms
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
                The school's public website (tenant site). A custom domain only
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
                onClick={() => onOpenChange(false)}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 h-10 focus-ring"
              >
                Close
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
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
                <Building2 className="h-4 w-4 text-teal-600" aria-hidden="true" />
                Add school
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                Four steps create the tenant ecosystem — identity, administrator, configuration and
                review. One platform, one database: the school is data, not a deployment.
              </DialogDescription>
            </DialogHeader>

            <StepDots step={step} />

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
                    only accepts the school-wide billing model — switch it
                    and retry without leaving the review step. */}
                {errorCode === 'SUBSCRIPTION_SYSTEM_PENDING' && form.billingModel !== 'SCHOOL_WIDE' ? (
                  <div className="mt-2.5 pl-6">
                    <Button
                      size="sm"
                      onClick={() => {
                        set('billingModel', 'SCHOOL_WIDE')
                        void submit('SCHOOL_WIDE')
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

            {/* STEP 1 — SCHOOL IDENTITY */}
            {step === 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-name" className="text-xs font-semibold text-slate-700">
                    School name *
                  </Label>
                  <Input
                    id="pw-name"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="Demo International School"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-shortname" className="text-xs font-semibold text-slate-700">
                    Short name <span className="font-normal text-slate-400">(optional)</span>
                  </Label>
                  <Input
                    id="pw-shortname"
                    value={form.shortName}
                    onChange={(e) => set('shortName', e.target.value)}
                    placeholder="Demo International"
                    className={field}
                  />
                  <p className="text-[10px] text-slate-400">
                    Used for the crest label, footers and the login wordmark.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-slug" className="text-xs font-semibold text-slate-700">
                    School slug *
                  </Label>
                  <Input
                    id="pw-slug"
                    value={form.slug}
                    onChange={(e) => set('slug', e.target.value.toLowerCase())}
                    placeholder="demo-international-school"
                    className={`${field} font-mono`}
                    aria-describedby="pw-slug-hint"
                  />
                  <p id="pw-slug-hint" className="text-[10px] text-slate-400">
                    Lowercase letters, numbers and hyphens — the school&rsquo;s link identity across
                    the platform (login and website URLs).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-code" className="text-xs font-semibold text-slate-700">
                    School code *
                  </Label>
                  <Input
                    id="pw-code"
                    value={form.code}
                    onChange={(e) => set('code', e.target.value.toUpperCase())}
                    placeholder="DIS-001"
                    className={`${field} font-mono`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-board" className="text-xs font-semibold text-slate-700">
                    Board *
                  </Label>
                  <select
                    id="pw-board"
                    value={form.board}
                    onChange={(e) => set('board', e.target.value)}
                    className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                  >
                    {SCHOOL_BOARDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-plan" className="text-xs font-semibold text-slate-700">
                    Platform plan *
                  </Label>
                  <select
                    id="pw-plan"
                    value={form.plan}
                    onChange={(e) => set('plan', e.target.value)}
                    className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                  >
                    {SCHOOL_PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
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
                    placeholder="office@demoschool.edu"
                    className={field}
                  />
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
                </div>
              </div>
            ) : null}

            {/* STEP 2 — ADMINISTRATOR (founding principal) */}
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
                    placeholder="principal@demoschool.edu"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
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
                    Optional — if blank, a one-time password is generated and shown once after
                    creation. The principal changes it at first sign-in. This account belongs to
                    THIS school tenant only.
                  </p>
                </div>
              </div>
            ) : null}

            {/* STEP 3 — CONFIGURATION (required visible, optional collapsed) */}
            {step === 3 ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-billing-model" className="text-xs font-semibold text-slate-700">
                    Billing model *
                  </Label>
                  <select
                    id="pw-billing-model"
                    value={form.billingModel}
                    onChange={(e) => set('billingModel', e.target.value)}
                    className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                    aria-describedby="pw-billing-model-hint"
                  >
                    <option value="SCHOOL_WIDE">School-wide (recommended)</option>
                    <option value="PER_STUDENT">Per-student</option>
                    <option value="MIXED">Mixed</option>
                  </select>
                  <p id="pw-billing-model-hint" className="text-[11px] leading-snug text-slate-400">
                    How this school pays for Scholario — one subscription for the whole school,
                    per-student entitlements, or both. Changeable later with the first plan payment.
                  </p>
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
                    Basic timetable context. The school configures the full timetable later in its
                    ERP — every detail is not required here.
                  </p>
                </div>

                {/* Optional academic bootstrap */}
                <OptionalSection
                  title="Optional settings — classes, subjects, rooms"
                  description="Bootstrap the academic setup now, or leave it to the principal in the school's ERP."
                  open={openSections.bootstrap}
                  onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, bootstrap: v }))}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-700">
                        Classes &amp; sections
                      </Label>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            set('classRows', Array.from({ length: 12 }, (_, i) => ({
                              name: `Class ${i + 1}`,
                              sections: 'A',
                            })))
                          }
                          className="h-7 border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-100 focus-ring"
                        >
                          Preset: Class 1–12
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              classRows: [...f.classRows, { name: '', sections: 'A' }],
                            }))
                          }
                          className="h-7 border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-100 focus-ring"
                        >
                          + Add class
                        </Button>
                      </div>
                    </div>
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
                          aria-label={`Class ${i + 1} name`}
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
                          aria-label={`Class ${i + 1} sections (comma-separated)`}
                        />
                        {form.classRows.length > 1 ? (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                classRows: f.classRows.filter((_, j) => j !== i),
                              }))
                            }
                            className="h-9 px-2 text-slate-400 hover:text-red-600 focus-ring"
                            aria-label={`Remove class row ${i + 1}`}
                          >
                            ×
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
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
                      Comma-separated · {parsedSubjects.length}/60 · optional — the principal can add
                      these later in the school&rsquo;s ERP.
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

                {/* Branding (optional) */}
                <OptionalSection
                  title="Branding"
                  description="Primary/accent colors and the school-provided tagline — refined later in school settings."
                  open={openSections.branding}
                  onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, branding: v }))}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-color" className="text-xs font-semibold text-slate-700">
                      Primary color *
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
                      Secondary / accent color *
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
                  <div className="space-y-1.5">
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
                      Only what the school actually provides. Empty is honest — the website shows a
                      clean placeholder until the school writes its own content.
                    </p>
                  </div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                    School name display uses the name and short name from step 1. Logo and favicon
                    are uploaded by the school itself from its settings after activation — the
                    platform never invents branding.
                  </p>
                </OptionalSection>

                {/* Website & domain (optional) */}
                <OptionalSection
                  title="Website & domain"
                  description="Public website toggle, custom domain (PENDING until DNS verification) and the temporary platform domain."
                  open={openSections.website}
                  onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, website: v }))}
                >
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
                        Website enabled
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        The school gets its public website — home, about, academics, admissions,
                        contact and its own login — as soon as it is activated.
                      </span>
                    </span>
                  </label>
                  <div className="space-y-1.5">
                    <Label htmlFor="pw-customdomain" className="text-xs font-semibold text-slate-700">
                      Custom domain
                    </Label>
                    <Input
                      id="pw-customdomain"
                      value={form.customDomain}
                      onChange={(e) => set('customDomain', e.target.value.toLowerCase())}
                      placeholder="www.demoschool.edu"
                      className={`${field} font-mono`}
                    />
                    <p className="text-[10px] text-slate-400">
                      Optional. Recorded as PENDING with a verification token — the school proves
                      ownership with a DNS TXT record before it routes traffic. Nothing is faked.
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-700">Temporary platform domain</p>
                    <p className="font-mono text-sm text-slate-900">
                      {tempDomain || 'derived from the slug (fill it in step 1)'}
                    </p>
                    <p className="text-[10px] leading-relaxed text-slate-400">
                      The school&rsquo;s platform subdomain. Until DNS is configured, the website is
                      reachable through the tenant link{' '}
                      <span className="font-mono text-slate-600">
                        /?tenant={form.slug || 'school-slug'}
                      </span>{' '}
                      — a development fallback, never the final customer URL.
                    </p>
                  </div>
                </OptionalSection>

                {/* Location & academic session (optional) */}
                <OptionalSection
                  title="Location & academic session"
                  description="Address, city, state, country, timezone and the academic year (e.g. 2026-2027)."
                  open={openSections.location}
                  onOpenChange={(v) => setOpenSections((prev) => ({ ...prev, location: v }))}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="pw-address" className="text-xs font-semibold text-slate-700">
                        Address
                      </Label>
                      <Input
                        id="pw-address"
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                        placeholder="12 Education Avenue"
                        className={field}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pw-city" className="text-xs font-semibold text-slate-700">
                        City
                      </Label>
                      <Input
                        id="pw-city"
                        value={form.city}
                        onChange={(e) => set('city', e.target.value)}
                        placeholder="Pune"
                        className={field}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pw-state" className="text-xs font-semibold text-slate-700">
                        State
                      </Label>
                      <Input
                        id="pw-state"
                        value={form.state}
                        onChange={(e) => set('state', e.target.value)}
                        placeholder="Maharashtra"
                        className={field}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pw-country" className="text-xs font-semibold text-slate-700">
                        Country
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
                      <Label htmlFor="pw-tz" className="text-xs font-semibold text-slate-700">
                        Timezone
                      </Label>
                      <select
                        id="pw-tz"
                        value={form.timezone}
                        onChange={(e) => set('timezone', e.target.value)}
                        className={`${field} w-full rounded-md border border-slate-200 bg-white px-3 text-sm`}
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="pw-year" className="text-xs font-semibold text-slate-700">
                        Academic session
                      </Label>
                      <Input
                        id="pw-year"
                        value={form.academicYear}
                        onChange={(e) => set('academicYear', e.target.value)}
                        placeholder="2026-2027"
                        className={field}
                      />
                    </div>
                  </div>
                </OptionalSection>
              </div>
            ) : null}

            {/* STEP 4 — REVIEW & CREATE */}
            {step === 4 ? (
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
                <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  {[
                    ['School', `${form.name}${form.shortName ? ` (${form.shortName})` : ''}`],
                    ['Slug · code', `${form.slug} · ${form.code}`],
                    [
                      'Board · plan · billing',
                      `${form.board} · ${form.plan} · ${BILLING_MODEL_LABELS[form.billingModel] ?? form.billingModel}`,
                    ],
                    [
                      'Location',
                      [form.city, form.state, form.country].filter(Boolean).join(', ') || '—',
                    ],
                    ['Address', form.address || '—'],
                    ['Contact', [form.contactEmail, form.contactPhone].filter(Boolean).join(' · ') || '—'],
                    ['Timezone', form.timezone],
                    ['Academic session', form.academicYear || '—'],
                    ['Branding', `${form.themeColor} / ${form.accentColor}${form.tagline ? ' · tagline' : ''}`],
                    [
                      'Website',
                      form.websiteEnabled
                        ? `enabled · slug ${form.slug}${form.customDomain ? ` · ${form.customDomain} (pending DNS verification)` : ''}`
                        : 'disabled',
                    ],
                    ['Temporary domain', tempDomain || '—'],
                    ['Principal', `${form.principalName} · ${form.principalEmail}`],
                    [
                      'Classes',
                      form.classRows.filter((r) => r.name.trim()).length > 0
                        ? form.classRows
                            .filter((r) => r.name.trim())
                            .map((r) => (r.sections.trim() ? `${r.name} (${r.sections})` : r.name))
                            .join(', ')
                        : '—',
                    ],
                    ['Subjects', parsedSubjects.length > 0 ? parsedSubjects.join(', ') : '—'],
                    ['Rooms', parsedRooms.length > 0 ? parsedRooms.join(', ') : '—'],
                    ['Working days', form.workingDays.join(', ')],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <span className="shrink-0 text-slate-500">{label}</span>
                      <span className="truncate text-right text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  CREATE SCHOOL provisions the whole tenant ecosystem in one transaction: school
                  identity, branding, website configuration, domain record, the principal
                  account, and the initial academic setup. The school is created in PENDING
                  state — sign-in is blocked until you activate it from the school record.
                </p>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <Button
                variant="outline"
                onClick={back}
                disabled={step === 1 || busy}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 h-10 focus-ring"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
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
        )}
      </DialogContent>
    </Dialog>
  )
}
