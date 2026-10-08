'use client'

/**
 * add-student-dialog — the Principal "Add Student" flow (Phase 7-A).
 *
 * SERVER-FIRST: this dialog is the UI caller of the REAL hardened
 * POST /api/students contract (roles PRINCIPAL/MANAGEMENT, tenant from
 * schoolScoped(user), duplicate-email check, in-tenant classId/routeId
 * FK re-validation, trackedTransaction User+Student, mustChangePassword,
 * ACCOUNT_CREATED audit):
 *
 *   · collects EXACTLY the fields the route parses — name + email are
 *     required server-side; classId / admissionNo / rollNo /
 *     guardianName / guardianPhone / dob / gender / routeId are optional
 *     passthroughs; `password` is optional (absent ⇒ the server generates
 *     a random 12-char one-time credential, supplied ⇒ must pass the
 *     8–128 chars + letter + digit policy). There is NO `section` field
 *     on the route — a Class row IS section-level (name "10-A" carries
 *     its own section), so picking the class row picks the section;
 *   · a class is required HERE even though the route allows null, because
 *     the canonical roster (GET /api/students/roster) only lists students
 *     attached to one of the school's classes — an unassigned student
 *     would be created but never surface in the directory;
 *   · errors shown are the SERVER's safe public messages (duplicate
 *     email, foreign class, password-policy failure,
 *     PASSWORD_CHANGE_REQUIRED …) — never a fabricated success;
 *   · on success the ONE-TIME `tempPassword` (present only when the
 *     server generated it) is rendered once inside this dialog and
 *     nowhere else — no console, no store, no toast. The account is
 *     created with mustChangePassword=true, so the student must change
 *     it at first sign-in;
 *   · the roster refresh is the canonical store sync
 *     (resetRosterSyncGuard + syncStudentsFromServer) — the directory
 *     re-renders from server data, never from a fabricated local record
 *     (the legacy store `addStudent` is NOT used).
 */

import { useEffect, useRef, useState } from 'react'
import {
  UserPlus, Loader2, AlertTriangle, CheckCircle2, Copy, Eye, EyeOff, KeyRound,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/smart-inputs'
// Canonical roster refresh (server truth) — the same sync the app root runs.
import { resetRosterSyncGuard, syncStudentsFromServer } from '@/lib/store/students-store'
import { cn } from '@/lib/utils'

interface AddStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ── server payload shapes (mirror /api/classes + /api/transport + the
//    POST /api/students response) ─────────────────────────────────────

interface ClassOption {
  /** Canonical DB Class id (section-level) — what POST classId expects. */
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
}

interface RouteOption {
  id: string
  name: string
}

/** POST /api/students success data — the subset this dialog consumes. */
interface CreatedStudent {
  name: string
  email: string
  admissionNo: string
  /** Present ONLY when the server generated the password (one-time). */
  tempPassword?: string
}

// ── form state ───────────────────────────────────────────────────────

interface AddStudentForm {
  name: string
  email: string
  classId: string
  gender: string // '' | 'MALE' | 'FEMALE' — canonical DB enum values
  dob: string // YYYY-MM-DD or ''
  admissionNo: string
  rollNo: string
  guardianName: string
  guardianPhone: string
  routeId: string
  passwordMode: 'auto' | 'manual'
  manualPassword: string
}

const INITIAL_FORM: AddStudentForm = {
  name: '',
  email: '',
  classId: '',
  gender: '',
  dob: '',
  admissionNo: '',
  rollNo: '',
  guardianName: '',
  guardianPhone: '',
  routeId: '',
  passwordMode: 'auto',
  manualPassword: '',
}

type FieldErrors = Partial<Record<'name' | 'email' | 'classId' | 'password', string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRE_PRIMARY = ['nursery', 'lkg', 'ukg', 'ikg']

/** Sort school classes into human order (pre-primary → numeric grades). */
function sortClassOptions(classes: ClassOption[]): ClassOption[] {
  const key = (c: ClassOption): [number, number] => {
    const g = (c.gradeLevel ?? '').trim().toLowerCase()
    const n = Number(g)
    if (Number.isFinite(n) && n > 0 && g !== '') return [1, n]
    const idx = PRE_PRIMARY.indexOf(g)
    return [idx >= 0 ? 0 : 2, idx]
  }
  return [...classes].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)]
    return ka[0] !== kb[0] ? ka[0] - kb[0] : ka[1] - kb[1]
  })
}

/** "10-A" (section baked into the name) stays as-is; "Grade 5" + section
 *  "A" renders "Grade 5 · Sec A". */
function classLabel(c: ClassOption): string {
  if (c.section && !c.name.toLowerCase().includes(c.section.toLowerCase())) {
    return `${c.name} · Sec ${c.section}`
  }
  return c.name
}

export function AddStudentDialog({ open, onOpenChange }: AddStudentDialogProps) {
  const [form, setForm] = useState<AddStudentForm>(INITIAL_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // 'form' → 'credentials' (one-time slip) after a successful create
  const [step, setStep] = useState<'form' | 'credentials'>('form')
  const [created, setCreated] = useState<CreatedStudent | null>(null)
  const [pwRevealed, setPwRevealed] = useState(false)

  // reference data from the server (loaded on every open)
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [loadingRefData, setLoadingRefData] = useState(false)
  const [refDataError, setRefDataError] = useState<string | null>(null)

  const setF = <K extends keyof AddStudentForm>(key: K, val: AddStudentForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }))
    // clear the field's error the moment the operator edits it
    setErrors((prev) => (prev[key as keyof FieldErrors] ? { ...prev, [key]: undefined } : prev))
  }

  // ── reference data: real classes (GET /api/classes) + optional
  //    transport routes (GET /api/transport, hidden when unavailable) ──
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingRefData(true)
    setRefDataError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/classes', { credentials: 'same-origin', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: ClassOption[] }
          | null
        if (!res.ok || !json?.ok || !Array.isArray(json.data)) {
          throw new Error(`HTTP ${res.status}`)
        }
        if (cancelled) return
        setClasses(sortClassOptions(json.data))
        // routeId is an accepted passthrough on POST — offer it when the
        // transport register is reachable; silently skip when the module
        // is disabled or the fetch fails (route stays unassigned).
        try {
          const r = await fetch('/api/transport', { credentials: 'same-origin', cache: 'no-store' })
          const rj = (await r.json().catch(() => null)) as
            | { ok?: boolean; data?: { routes?: RouteOption[] } }
            | null
          if (!cancelled && r.ok && rj?.ok && Array.isArray(rj.data?.routes)) {
            setRoutes(rj.data.routes.map((x) => ({ id: x.id, name: x.name })))
          } else if (!cancelled) {
            setRoutes([])
          }
        } catch {
          if (!cancelled) setRoutes([])
        }
      } catch {
        if (!cancelled) {
          setRefDataError('Could not load the school’s classes. Close and reopen this dialog to retry.')
        }
      } finally {
        if (!cancelled) setLoadingRefData(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // ── reset on close (after the exit animation): the one-time credential
  //    and any manual password leave memory immediately afterwards ─────
  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current && !open) {
      const t = window.setTimeout(() => {
        setForm(INITIAL_FORM)
        setErrors({})
        setSubmitError(null)
        setCreated(null)
        setStep('form')
        setPwRevealed(false)
      }, 250)
      prevOpen.current = open
      return () => window.clearTimeout(t)
    }
    prevOpen.current = open
  }, [open])

  // The reveal flag resets whenever a different credential slip is shown.
  useEffect(() => {
    setPwRevealed(false)
  }, [created])

  const handleOpenChange = (o: boolean) => {
    // Never abandon an in-flight create — the request is already running.
    if (!o && submitting) return
    onOpenChange(o)
  }

  // ── client-side validation (minimal — the server is the authority for
  //    duplicates / policy / foreign ids) ──────────────────────────────
  const validate = (): boolean => {
    const errs: FieldErrors = {}
    if (!form.name.trim()) errs.name = 'Full name is required.'
    const email = form.email.trim().toLowerCase()
    if (!email) errs.email = 'Login email is required.'
    else if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.'
    if (!form.classId) {
      errs.classId = 'Select a class — students without a class never appear in the school roster.'
    }
    if (form.passwordMode === 'manual') {
      const pw = form.manualPassword
      if (!pw) errs.password = 'Enter a password, or switch back to auto-generate.'
      else if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
        errs.password = 'Password must be 8–128 characters with at least one letter and one number.'
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── submit → POST /api/students (real server create) ───────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)

    const email = form.email.trim().toLowerCase()
    // EXACTLY the route's parsed fields; empty optionals are omitted so
    // the server applies its own defaults (ADM-… admission no, generated
    // password).
    const body: Record<string, string> = { name: form.name.trim(), email }
    if (form.classId) body.classId = form.classId
    if (form.admissionNo.trim()) body.admissionNo = form.admissionNo.trim()
    if (form.rollNo.trim()) body.rollNo = form.rollNo.trim()
    if (form.guardianName.trim()) body.guardianName = form.guardianName.trim()
    if (form.guardianPhone.trim()) body.guardianPhone = form.guardianPhone.trim()
    if (form.gender) body.gender = form.gender
    if (form.dob) body.dob = form.dob
    if (form.routeId) body.routeId = form.routeId
    if (form.passwordMode === 'manual') body.password = form.manualPassword

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean
            error?: string
            code?: string
            data?: {
              id?: string
              admissionNo?: string | null
              user?: { name?: string | null; email?: string } | null
              tempPassword?: string
            }
          }
        | null
      if (!res.ok || !json?.ok || !json.data) {
        // The server's public message is guaranteed-safe copy — surface it
        // verbatim (duplicate email, foreign class, password policy,
        // PASSWORD_CHANGE_REQUIRED …). NO fake success.
        throw new Error(json?.error || `Could not create the student (HTTP ${res.status}).`)
      }

      // ONE-TIME credential — memory only, rendered once in the slip below.
      setCreated({
        name: form.name.trim(),
        email: json.data.user?.email ?? email,
        admissionNo: json.data.admissionNo ?? '',
        tempPassword: json.data.tempPassword,
      })
      setStep('credentials')

      // Roster refresh from the server: reset the once-per-session guard
      // and re-run the canonical sync so the directory re-renders from
      // REAL data (no fabricated local record). The new student's record
      // comes from GET /api/students/roster, not from this client.
      resetRosterSyncGuard()
      void syncStudentsFromServer().then((ok) => {
        if (!ok) {
          toast.error('Roster could not be refreshed', {
            description: 'The student was created on the server — reload the page to see the updated directory.',
          })
        }
      })

      toast.success(`${form.name.trim()} enrolled`, {
        description: `Account created · Login ID: ${email}${json.data.admissionNo ? ` · Admission No: ${json.data.admissionNo}` : ''}`,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the student.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyCredentials = async () => {
    if (!created) return
    const text = [
      `Student: ${created.name}`,
      `Admission No: ${created.admissionNo}`,
      `Login ID: ${created.email}`,
      ...(created.tempPassword ? [`Temporary Password: ${created.tempPassword}`] : []),
      'Note: The student must change this password at first sign-in.',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Credentials copied', { description: 'Hand them over securely — shown only once.' })
    } catch {
      toast.error('Could not copy to the clipboard', { description: 'Select the details manually.' })
    }
  }

  const fieldError = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p id={`add-student-${key}-error`} className="mt-1 text-[11px] font-medium text-destructive">
        {errors[key]}
      </p>
    ) : null

  // ── render ─────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {step === 'form' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Add Student
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Enroll a student and create their portal account on the school server. A one-time
                temporary password is shown at the end — the student changes it at first sign-in.
              </DialogDescription>
            </DialogHeader>

            {submitError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 break-words">{submitError}</p>
              </div>
            )}

            <form id="add-student-form" onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* identity + placement */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="add-student-name" className="text-xs font-semibold">
                    Full Name <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="add-student-name"
                    value={form.name}
                    onChange={(e) => setF('name', e.target.value)}
                    placeholder="e.g. Aarav Mehta"
                    autoComplete="off"
                    required
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? 'add-student-name-error' : undefined}
                    className="mt-1.5 h-10"
                  />
                  {fieldError('name')}
                </div>
                <div>
                  <Label htmlFor="add-student-email" className="text-xs font-semibold">
                    Login Email <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="add-student-email"
                    type="email"
                    inputMode="email"
                    value={form.email}
                    onChange={(e) => setF('email', e.target.value)}
                    placeholder="Guardian email — becomes the login ID"
                    autoComplete="off"
                    required
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'add-student-email-error' : undefined}
                    className="mt-1.5 h-10"
                  />
                  {fieldError('email')}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    This email is the student&apos;s portal username — duplicates are rejected by the server.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="add-student-class" className="text-xs font-semibold">
                    Class <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  {loadingRefData ? (
                    <div className="mt-1.5 flex h-10 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading classes…
                    </div>
                  ) : (
                    <Select value={form.classId} onValueChange={(v) => setF('classId', v)}>
                      <SelectTrigger
                        id="add-student-class"
                        aria-invalid={!!errors.classId}
                        className="mt-1.5 h-10 w-full text-xs"
                      >
                        <SelectValue placeholder={classes.length ? 'Select class & section…' : 'No classes found'} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {classLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {fieldError('classId')}
                  {refDataError && <p className="mt-1 text-[11px] font-medium text-amber-600">{refDataError}</p>}
                  {classes.length === 0 && !loadingRefData && !refDataError && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      No classes yet — create one from the Classes tab first.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="add-student-gender" className="text-xs font-semibold">
                    Gender <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Select value={form.gender} onValueChange={(v) => setF('gender', v)}>
                    <SelectTrigger id="add-student-gender" className="mt-1.5 h-10 w-full text-xs">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE" className="text-xs">Male</SelectItem>
                      <SelectItem value="FEMALE" className="text-xs">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {routes.length > 0 && (
                <div>
                  <Label htmlFor="add-student-route" className="text-xs font-semibold">
                    Transport Route <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Select value={form.routeId} onValueChange={(v) => setF('routeId', v)}>
                    <SelectTrigger id="add-student-route" className="mt-1.5 h-10 w-full text-xs">
                      <SelectValue placeholder="No route" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {routes.map((r) => (
                        <SelectItem key={r.id} value={r.id} className="text-xs">
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* enrollment details */}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                  Enrollment Details
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="add-student-admission" className="text-xs font-semibold">
                      Admission No. <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="add-student-admission"
                      value={form.admissionNo}
                      onChange={(e) => setF('admissionNo', e.target.value)}
                      placeholder="Auto-generated when blank"
                      autoComplete="off"
                      className="mt-1.5 h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="add-student-roll" className="text-xs font-semibold">
                      Roll No. <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="add-student-roll"
                      value={form.rollNo}
                      onChange={(e) => setF('rollNo', e.target.value)}
                      placeholder="e.g. 21"
                      autoComplete="off"
                      className="mt-1.5 h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="add-student-guardian" className="text-xs font-semibold">
                      Guardian Name <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="add-student-guardian"
                      value={form.guardianName}
                      onChange={(e) => setF('guardianName', e.target.value)}
                      placeholder="e.g. Rajesh Mehta"
                      autoComplete="off"
                      className="mt-1.5 h-10"
                    />
                  </div>
                  <div>
                    <Label htmlFor="add-student-guardian-phone" className="text-xs font-semibold">
                      Guardian Phone <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <PhoneInput
                      value={form.guardianPhone}
                      onChange={(v) => setF('guardianPhone', v)}
                      placeholder="e.g. 98765 43210"
                      className="mt-1.5 h-10"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="add-student-dob" className="text-xs font-semibold">
                      Date of Birth <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="add-student-dob"
                      type="date"
                      value={form.dob}
                      onChange={(e) => setF('dob', e.target.value)}
                      className="mt-1.5 h-10"
                    />
                  </div>
                </div>
              </div>

              {/* credentials */}
              <div className="rounded-xl border border-border bg-muted/30 p-3.5">
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> First Password
                </p>
                <RadioGroup
                  value={form.passwordMode}
                  onValueChange={(v) => setF('passwordMode', v as AddStudentForm['passwordMode'])}
                  className="mt-2 gap-2"
                  aria-label="First password provisioning mode"
                >
                  <label
                    htmlFor="add-student-pw-auto"
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                      form.passwordMode === 'auto'
                        ? 'border-emerald-500/50 bg-emerald-500/[0.06]'
                        : 'border-border bg-background hover:bg-muted/50',
                    )}
                  >
                    <RadioGroupItem id="add-student-pw-auto" value="auto" className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        Auto-generate temporary password
                        <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                          Recommended
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                        The server generates a random 12-character password and shows it to you exactly once
                        below. The student must change it at first sign-in.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="add-student-pw-manual"
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                      form.passwordMode === 'manual'
                        ? 'border-primary/50 bg-primary/[0.05]'
                        : 'border-border bg-background hover:bg-muted/50',
                    )}
                  >
                    <RadioGroupItem id="add-student-pw-manual" value="manual" className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">Set password manually</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                        Choose the first password yourself. It must satisfy the school password policy.
                      </span>
                      {form.passwordMode === 'manual' && (
                        <>
                          <Input
                            type="password"
                            value={form.manualPassword}
                            onChange={(e) => setF('manualPassword', e.target.value)}
                            placeholder="8–128 chars, at least one letter and one number"
                            autoComplete="new-password"
                            aria-invalid={!!errors.password}
                            aria-describedby={errors.password ? 'add-student-password-error' : undefined}
                            className="mt-2 h-10"
                          />
                          {fieldError('password')}
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            The student still must change it at first sign-in. The password is never shown
                            again after you close this dialog.
                          </p>
                        </>
                      )}
                    </span>
                  </label>
                </RadioGroup>
              </div>
            </form>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="h-10 px-4 text-xs">
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-student-form"
                disabled={submitting}
                aria-busy={submitting}
                className="h-10 bg-emerald-600 px-5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Creating…
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Create Student
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ── ONE-TIME credential slip (server-generated password only) ── */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Student Enrolled — Account Created
              </DialogTitle>
              <DialogDescription className="text-xs">
                {created?.name} was created on the school server. Hand over the sign-in details now.
              </DialogDescription>
            </DialogHeader>

            {created && (
              <div className="space-y-3">
                <dl className="divide-y divide-border rounded-xl border border-border">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Student
                    </dt>
                    <dd className="text-sm font-semibold text-foreground">{created.name}</dd>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Admission No.
                    </dt>
                    <dd className="font-mono text-sm text-foreground">{created.admissionNo || '—'}</dd>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Login ID
                    </dt>
                    <dd className="break-all text-sm text-foreground">{created.email}</dd>
                  </div>
                  {created.tempPassword ? (
                    <div className="px-3.5 py-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Temporary Password
                      </dt>
                      <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        {pwRevealed ? (
                          <code className="break-all font-mono text-sm font-semibold tracking-wide text-foreground">
                            {created.tempPassword}
                          </code>
                        ) : (
                          <span className="font-mono text-sm tracking-[0.3em] text-muted-foreground" aria-hidden="true">
                            ••••••••••••
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setPwRevealed((v) => !v)}
                          aria-label={pwRevealed ? 'Hide temporary password' : 'Show temporary password'}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        >
                          {pwRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </dd>
                    </div>
                  ) : (
                    <div className="px-3.5 py-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Password
                      </dt>
                      <dd className="mt-1 text-xs text-muted-foreground">
                        The password you set — known to you, never displayed by Scholario.
                      </dd>
                    </div>
                  )}
                </dl>

                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border-l-2 border-amber-500/60 bg-amber-500/[0.06] py-2.5 pl-3.5 pr-3"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    {created.tempPassword ? (
                      <>
                        <span className="font-semibold">Shown only once.</span> Scholario will not display or
                        send this password again — copy it now and hand it over securely. The student must
                        change it at first sign-in.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">One-time bootstrap.</span> Scholario never displays or
                        re-sends the password you set. The student must change it at first sign-in.
                      </>
                    )}
                  </p>
                </div>

                <Separator />

                <p className="text-[11px] text-muted-foreground">
                  The directory below now refreshes from the school server — {created.name} appears in the
                  class you selected.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="h-10 px-4 text-xs">
                Close
              </Button>
              {created?.tempPassword && (
                <Button
                  type="button"
                  onClick={() => void copyCredentials()}
                  className="h-10 bg-emerald-600 px-5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy Credentials
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
