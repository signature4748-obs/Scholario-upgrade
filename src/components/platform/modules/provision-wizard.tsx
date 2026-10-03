'use client'

// ============================================================
// ProvisionWizard — self-service school onboarding (ARCHITECTURE
// RESET, Phase 4)
// ------------------------------------------------------------
// Platform → Schools → Add School. A six-step wizard that collects
// everything a new tenant needs, creates the school in ONE atomic
// POST /api/platform/schools call (PENDING state), and hands the
// platform admin the activation step + the one-time temp password.
//
// One application · one database · many tenants: everything here is
// DATA (School row + settings JSON + Class/Subject bootstrap rows) —
// no new deployment, repo, or code change per school.
//
// AUTH HONESTY: the Google SSO step shows the architecture's honest
// status ("Not connected" — the integration is not implemented yet)
// and cannot be selected. See docs/GOOGLE_SSO_ARCHITECTURE.md.
// ============================================================

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe2,
  UserCog,
  KeyRound,
  Palette,
  GraduationCap,
  ClipboardCheck,
  Copy,
  ExternalLink,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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

const BRAND_PRESETS = [
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Maroon', value: '#7f1d33' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Emerald', value: '#047852' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Slate', value: '#334155' },
] as const

interface ClassRow {
  name: string
  sections: string
}

interface WizardForm {
  // Step 1 — School
  name: string
  slug: string
  code: string
  officialEmail: string
  country: string
  city: string
  timezone: string
  academicYear: string
  board: string
  plan: string
  // Step 2 — Administrator
  principalName: string
  principalEmail: string
  principalPassword: string
  // Step 3 — Authentication
  authMethod: 'PASSWORD'
  // Step 4 — Branding
  themeColor: string
  // Step 5 — Academic
  classRows: ClassRow[]
  subjectsText: string
}

const EMPTY_FORM: WizardForm = {
  name: '',
  slug: '',
  code: '',
  officialEmail: '',
  country: '',
  city: '',
  timezone: 'Asia/Kolkata',
  academicYear: '',
  board: 'CBSE',
  plan: 'STANDARD',
  principalName: '',
  principalEmail: '',
  principalPassword: '',
  authMethod: 'PASSWORD',
  themeColor: '#0f766e',
  classRows: [{ name: '', sections: 'A' }],
  subjectsText: '',
}

const STEPS = [
  { id: 1, label: 'School', icon: Building2 },
  { id: 2, label: 'Administrator', icon: UserCog },
  { id: 3, label: 'Authentication', icon: KeyRound },
  { id: 4, label: 'Branding', icon: Palette },
  { id: 5, label: 'Academics', icon: GraduationCap },
  { id: 6, label: 'Review', icon: ClipboardCheck },
] as const

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z0-9-]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const YEAR_RE = /^\d{4}[-/]\d{4}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface ProvisionResult {
  school: { id: string; name: string; slug: string; code: string; status: string; plan: string }
  principal: { id: string; email: string; name: string | null }
  tempPassword?: string
  bootstrap: { classes: number; sections: number; subjects: number }
  nextStep: string
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
  const [result, setResult] = useState<ProvisionResult | null>(null)

  useEffect(() => {
    if (open) {
      setStep(1)
      setForm(EMPTY_FORM)
      setError(null)
      setResult(null)
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

  const validateStep = (): string | null => {
    if (step === 1) {
      if (form.name.trim().length < 2) return 'School name is required (2+ characters)'
      if (!SLUG_RE.test(form.slug) || form.slug.length < 3)
        return 'Slug must be 3+ chars — lowercase letters, numbers and hyphens only'
      if (!CODE_RE.test(form.code) || form.code.length < 2)
        return 'Code must be 2+ chars — uppercase letters, numbers and hyphens only'
      if (form.officialEmail && !EMAIL_RE.test(form.officialEmail.trim()))
        return 'Official email must be a valid email address'
      if (form.academicYear && !YEAR_RE.test(form.academicYear.trim()))
        return 'Academic session must look like 2026-2027'
      return null
    }
    if (step === 2) {
      if (!form.principalName.trim()) return 'Administrator name is required'
      if (!EMAIL_RE.test(form.principalEmail.trim())) return 'A valid administrator email is required'
      if (form.principalPassword && form.principalPassword.length < 8)
        return 'Password must be at least 8 characters (or leave it blank to auto-generate)'
      return null
    }
    if (step === 4) {
      if (!HEX_RE.test(form.themeColor)) return 'Brand color must be a 6-digit hex value (e.g. #0f766e)'
      return null
    }
    if (step === 5) {
      for (const row of form.classRows) {
        if (!row.name.trim() && row.sections.trim()) return 'Every class row needs a class name'
      }
      return null
    }
    return null
  }

  const next = () => {
    const invalid = validateStep()
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setStep((s) => Math.min(s + 1, STEPS.length))
  }

  const back = () => {
    setError(null)
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
      slug: form.slug,
      code: form.code,
      city: form.city.trim() || undefined,
      country: form.country.trim() || undefined,
      timezone: form.timezone || undefined,
      academicYear: form.academicYear.trim() || undefined,
      officialEmail: form.officialEmail.trim() || undefined,
      plan: form.plan,
      board: form.board,
      principalName: form.principalName.trim(),
      principalEmail: form.principalEmail.trim(),
      principalPassword: form.principalPassword || undefined,
      authMethod: 'PASSWORD' as const,
      themeColor: form.themeColor,
      classes: classes.length > 0 ? classes : undefined,
      subjects: parsedSubjects.length > 0 ? parsedSubjects : undefined,
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await platformApi('/api/platform/schools', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      })
      setResult(res as unknown as ProvisionResult)
      toast.success('School created — activate it to enable sign-in')
      onProvisioned()
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Provisioning failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scrollbar bg-white border-slate-200 text-slate-900 sm:max-w-2xl">
        {result ? (
          // ── Success panel ────────────────────────────────────────────
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display text-slate-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                {result.school.name} created
              </DialogTitle>
              <DialogDescription className="text-slate-500">
                The tenant is in <span className="font-medium text-amber-700">PENDING</span> state —
                nobody can sign in until you activate it from the school record.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Slug</span>
                <span className="font-mono text-slate-900">{result.school.slug}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Founding principal</span>
                <span className="text-slate-900">{result.principal.email}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Bootstrap</span>
                <span className="text-slate-900">
                  {result.bootstrap.classes} classes · {result.bootstrap.subjects} subjects
                </span>
              </div>
            </div>

            {result.tempPassword ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
                  One-time temporary password
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Shown only once — hand it to the principal, who changes it at first sign-in.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900">
                    {result.tempPassword}
                  </code>
                  <Button
                    variant="outline"
                    onClick={() => copy(result.tempPassword as string)}
                    className="h-10 border-amber-300 bg-white text-amber-800 hover:bg-amber-100 focus-ring"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 h-10 focus-ring"
              >
                Close
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
                Provision a new tenant with its founding principal. One platform, one database —
                the school is data, not a deployment.
              </DialogDescription>
            </DialogHeader>

            <StepDots step={step} />

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            ) : null}

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
                    placeholder="Riverside Academy"
                    className={field}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-slug" className="text-xs font-semibold text-slate-700">
                    Slug *
                  </Label>
                  <Input
                    id="pw-slug"
                    value={form.slug}
                    onChange={(e) => set('slug', e.target.value.toLowerCase())}
                    placeholder="riverside-academy"
                    className={`${field} font-mono`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-code" className="text-xs font-semibold text-slate-700">
                    Code *
                  </Label>
                  <Input
                    id="pw-code"
                    value={form.code}
                    onChange={(e) => set('code', e.target.value.toUpperCase())}
                    placeholder="RVS-001"
                    className={`${field} font-mono`}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-email" className="text-xs font-semibold text-slate-700">
                    Official email
                  </Label>
                  <Input
                    id="pw-email"
                    type="email"
                    value={form.officialEmail}
                    onChange={(e) => set('officialEmail', e.target.value)}
                    placeholder="office@riverside.edu.in"
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
                <div className="space-y-1.5">
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
                    Plan *
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
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-pname" className="text-xs font-semibold text-slate-700">
                    Administrator name *
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
                    Administrator email *
                  </Label>
                  <Input
                    id="pw-pemail"
                    type="email"
                    value={form.principalEmail}
                    onChange={(e) => set('principalEmail', e.target.value)}
                    placeholder="principal@riverside.edu.in"
                    className={field}
                />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pw-ppass" className="text-xs font-semibold text-slate-700">
                    Initial password
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
                    creation. The principal changes it at first sign-in.
                  </p>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <button
                  type="button"
                  className="flex w-full items-start gap-3 rounded-xl border border-teal-300 bg-teal-50/60 p-4 text-left focus-ring"
                  aria-pressed="true"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      Email &amp; password
                      <Badge className="border-teal-200 bg-teal-100 text-teal-700 normal-case">
                        Ready
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      The principal signs in with the email and password from step 2. Always
                      available — no external setup needed.
                    </span>
                  </span>
                </button>
                <div
                  className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-70"
                  aria-disabled="true"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                    <Globe2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                      Google SSO / Google Workspace
                      <Badge className="border-slate-200 bg-white text-slate-500 normal-case">
                        Not connected
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Architected for Google Workspace domains (one platform OAuth client, tenant
                      domain restrictions) — not yet implemented. It can be enabled for this school
                      later without re-provisioning.{' '}
                      <a
                        href="https://github.com/akasharyan4748-droid/Scholario-oz/blob/main/docs/GOOGLE_SSO_ARCHITECTURE.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-teal-700 underline"
                      >
                        Architecture
                      </a>
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  School authentication stays separate from platform-admin authentication (which
                  always requires MFA), whichever method the school uses.
                </p>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-color" className="text-xs font-semibold text-slate-700">
                    Primary brand color *
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
                  <p className="text-[10px] text-slate-400">
                    Used across the school website and portal. High-contrast values are validated at
                    save time.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {BRAND_PRESETS.map((preset) => (
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
                <p className="text-[11px] text-slate-400">
                  The school controls its own identity — logo, website content and photography are
                  configured later from the school&rsquo;s settings (Website tab), never invented by
                  the platform.
                </p>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="space-y-4">
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
              </div>
            ) : null}

            {step === 6 ? (
              <div className="space-y-3">
                <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  {[
                    ['School', `${form.name} (${form.slug})`],
                    ['Board · Plan', `${form.board} · ${form.plan}`],
                    [
                      'Location',
                      [form.city, form.country].filter(Boolean).join(', ') || '—',
                    ],
                    ['Timezone', form.timezone],
                    ['Academic session', form.academicYear || '—'],
                    ['Administrator', `${form.principalName} · ${form.principalEmail}`],
                    ['Authentication', 'Email & password'],
                    ['Brand color', form.themeColor],
                    [
                      'Classes',
                      form.classRows.filter((r) => r.name.trim()).length > 0
                        ? form.classRows
                            .filter((r) => r.name.trim())
                            .map((r) =>
                              r.sections.trim() ? `${r.name} (${r.sections})` : r.name,
                            )
                            .join(', ')
                        : '—',
                    ],
                    ['Subjects', parsedSubjects.length > 0 ? parsedSubjects.join(', ') : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <span className="shrink-0 text-slate-500">{label}</span>
                      <span className="truncate text-right text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  The school is created in PENDING state. Sign-in is blocked until you activate it
                  from the school record after creation.
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
                  disabled={busy}
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
