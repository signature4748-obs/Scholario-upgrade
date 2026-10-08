'use client'

/**
 * EnrollStudentDialog — the REAL enrollment step of admission issuance
 * (Phase 7-H, admissions honesty).
 *
 * This replaces the fake completion: the old "Complete Admission & Enrol"
 * button inserted a fabricated student into the client-side roster store
 * (localStorage) with placeholder guardian data. This dialog instead
 * gathers the applicant's REAL collected data and POSTs it to the
 * canonical hardened POST /api/students contract (roles
 * PRINCIPAL/MANAGEMENT, tenant from schoolScoped(user), duplicate-email
 * check, in-tenant classId FK re-validation, trackedTransaction
 * User+Student, mustChangePassword, ACCOUNT_CREATED audit) — the same
 * endpoint the Students & Classes "Add Student" dialog uses.
 *
 *   · name / email / class are REQUIRED (the wizard's email/class are
 *     best-effort pre-fills — the office confirms them here; NO
 *     placeholder email is ever defaulted in);
 *   · guardianName / guardianPhone / dob / gender are honest
 *     passthroughs of the wizard's collected fields when present;
 *   · the server generates the admission number and the first password
 *     (no password is set from here);
 *   · errors shown are the SERVER's safe public messages (duplicate
 *     email, foreign class, PASSWORD_CHANGE_REQUIRED …) — never a
 *     fabricated success;
 *   · on success the ONE-TIME `tempPassword` is rendered once inside
 *     this dialog (masked by default, reveal + copy) and nowhere else —
 *     no console, no store, no toast carries it;
 *   · the roster refresh after success is the canonical store sync
 *     (resetRosterSyncGuard + syncStudentsFromServer) driven by the
 *     parent — the local admission record is marked Completed with the
 *     SERVER-issued student id and admission number.
 */

import { useEffect, useRef, useState } from 'react'
import {
  UserCheck, Loader2, AlertTriangle, CheckCircle2, Copy, Eye, EyeOff,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { toast } from 'sonner'
import { PhoneInput } from '@/components/shared/smart-inputs'
import type { AdmissionApplication } from '@/lib/store/admission-store'

export interface EnrollServerResult {
  /** Canonical DB Student row id — cross-referenced onto the admission record. */
  studentId: string
  /** Server-issued admission number (ADM-…). */
  admissionNo: string
}

interface EnrollStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  app: AdmissionApplication
  /** Fired ONCE, only after the server confirms the enrollment. */
  onEnrolled: (result: EnrollServerResult) => void
}

// ── server payload shapes (mirror GET /api/classes + the POST
//    /api/students response — the same subset 7-A's dialog consumes) ──

interface ClassOption {
  /** Canonical DB Class id (section-level) — what POST classId expects. */
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
}

interface CreatedStudent {
  name: string
  email: string
  admissionNo: string
  /** Present ONLY when the server generated the password (one-time). */
  tempPassword?: string
}

// ── form state ───────────────────────────────────────────────────────

interface EnrollForm {
  name: string
  email: string
  classId: string
  gender: string // '' | 'MALE' | 'FEMALE' — canonical DB values
  dob: string // YYYY-MM-DD or ''
  guardianName: string
  guardianPhone: string
}

type FieldErrors = Partial<Record<'name' | 'email' | 'classId', string>>

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

/** The academic "level" of a class name — digits, or a pre-primary key. */
function classLevel(name: string): string {
  const n = name.toLowerCase()
  for (const p of PRE_PRIMARY) {
    if (n.includes(p)) return p
  }
  return n.replace(/[^0-9]/g, '')
}

/**
 * Best-effort pre-fill: match the wizard's free-text className (e.g.
 * "Grade 9", "Class 2") + section against the school's REAL server
 * classes (gradeLevel / name). Returns the single matching class id, or
 * '' when nothing matches unambiguously — the operator then picks the
 * class explicitly (a wrong guess would enroll into the wrong class).
 */
function matchServerClass(
  classes: ClassOption[],
  wizardClassName: string,
  wizardSection: string
): string {
  const wanted = classLevel(wizardClassName)
  if (!wanted) return ''
  let candidates = classes.filter((c) => {
    const level = classLevel(c.gradeLevel ?? '') || classLevel(c.name)
    return level === wanted
  })
  if (candidates.length > 1 && wizardSection) {
    const bySection = candidates.filter(
      (c) => c.section === wizardSection || c.name.toUpperCase().endsWith(`-${wizardSection.toUpperCase()}`)
    )
    if (bySection.length >= 1) candidates = bySection
  }
  return candidates.length === 1 ? candidates[0].id : ''
}

export function EnrollStudentDialog({
  open,
  onOpenChange,
  app,
  onEnrolled,
}: EnrollStudentDialogProps) {
  const [form, setForm] = useState<EnrollForm>({
    name: '',
    email: '',
    classId: '',
    gender: '',
    dob: '',
    guardianName: '',
    guardianPhone: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // 'form' → 'credentials' (one-time slip) after a successful enroll
  const [step, setStep] = useState<'form' | 'credentials'>('form')
  const [created, setCreated] = useState<CreatedStudent | null>(null)
  const [pwRevealed, setPwRevealed] = useState(false)

  // reference data from the server (loaded on every open)
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [loadingRefData, setLoadingRefData] = useState(false)
  const [refDataError, setRefDataError] = useState<string | null>(null)

  const setF = <K extends keyof EnrollForm>(key: K, val: EnrollForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }))
    // clear the field's error the moment the operator edits it
    setErrors((prev) => (prev[key as keyof FieldErrors] ? { ...prev, [key]: undefined } : prev))
  }

  // ── pre-fill from the application's REAL collected data + load the
  //    server class registry on every open ─────────────────────────────
  useEffect(() => {
    if (!open) return
    const f = app.formData
    const genderMap: Record<string, string> = { Male: 'MALE', Female: 'FEMALE' }
    setForm({
      name: app.applicantName?.trim() || `${f.firstName} ${f.lastName}`.trim(),
      email: (f.fatherEmail || f.motherEmail || '').trim(),
      classId: '',
      gender: genderMap[f.gender] ?? '',
      dob: f.dob || '',
      guardianName: (f.fatherName || f.motherName || '').trim(),
      guardianPhone: (f.fatherPhone || f.motherPhone || '').trim(),
    })
    setErrors({})
    setSubmitError(null)
    setStep('form')

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
        const sorted = sortClassOptions(json.data)
        setClasses(sorted)
        // best-effort class pre-fill from the wizard's choice
        const matched = matchServerClass(sorted, f.className || '', f.section || '')
        if (matched) setForm((prev) => ({ ...prev, classId: prev.classId || matched }))
      } catch {
        if (!cancelled) {
          setRefDataError('Could not load the school’s classes. Close and reopen to retry.')
        }
      } finally {
        if (!cancelled) setLoadingRefData(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, app])

  // ── reset on close (after the exit animation): the one-time credential
  //    and the form leave memory immediately afterwards ────────────────
  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current && !open) {
      const t = window.setTimeout(() => {
        setForm({ name: '', email: '', classId: '', gender: '', dob: '', guardianName: '', guardianPhone: '' })
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
    // Never abandon an in-flight enroll — the request is already running.
    if (!o && submitting) return
    onOpenChange(o)
  }

  // ── client-side validation (minimal — the server is the authority for
  //    duplicates / foreign ids) ──────────────────────────────────────
  const validate = (): boolean => {
    const errs: FieldErrors = {}
    if (!form.name.trim()) errs.name = 'Student name is required.'
    const email = form.email.trim().toLowerCase()
    if (!email) errs.email = 'A login email is required — the account cannot be created without one.'
    else if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.'
    if (!form.classId) {
      errs.classId = 'Select a class — students without a class never appear in the school roster.'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── submit → POST /api/students (the REAL server create) ───────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    setSubmitError(null)

    const email = form.email.trim().toLowerCase()
    // EXACTLY the route's parsed fields; empty optionals are omitted so
    // the server applies its own defaults (ADM-… admission number,
    // generated one-time password). No fabricated defaults live here.
    const body: Record<string, string> = { name: form.name.trim(), email }
    if (form.classId) body.classId = form.classId
    if (form.guardianName.trim()) body.guardianName = form.guardianName.trim()
    if (form.guardianPhone.trim()) body.guardianPhone = form.guardianPhone.trim()
    if (form.gender) body.gender = form.gender
    if (form.dob) body.dob = form.dob

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
      if (!res.ok || !json?.ok || !json.data?.id) {
        // The server's public message is guaranteed-safe copy — surface it
        // verbatim (duplicate email, foreign class, PASSWORD_CHANGE_REQUIRED…).
        throw new Error(json?.error || `Could not enroll the student (HTTP ${res.status}).`)
      }

      // ONE-TIME credential — memory only, rendered once in the slip below.
      setCreated({
        name: form.name.trim(),
        email: json.data.user?.email ?? email,
        admissionNo: json.data.admissionNo ?? '',
        tempPassword: json.data.tempPassword,
      })
      setStep('credentials')

      // The parent marks the admission Completed with the SERVER ids and
      // triggers the canonical roster sync. (The password never leaves
      // this dialog.)
      onEnrolled({
        studentId: json.data.id,
        admissionNo: json.data.admissionNo ?? '',
      })

      toast.success(`${form.name.trim()} enrolled on the server`, {
        description: `Account created · Login ID: ${email}${json.data.admissionNo ? ` · Admission No: ${json.data.admissionNo}` : ''}`,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not enroll the student.')
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
      <p id={`enroll-${key}-error`} className="mt-1 text-[11px] font-medium text-destructive">
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
                <UserCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Enroll {app.applicantName || 'Applicant'}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Create the student&apos;s account on the school server from the data collected on this
                application. The login email and class are required; a one-time temporary password
                is shown at the end — the student changes it at first sign-in.
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

            <form id="enroll-student-form" onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="enroll-name" className="text-xs font-semibold">
                    Student Name <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="enroll-name"
                    value={form.name}
                    onChange={(e) => setF('name', e.target.value)}
                    autoComplete="off"
                    required
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? 'enroll-name-error' : undefined}
                    className="mt-1.5 h-10"
                  />
                  {fieldError('name')}
                </div>
                <div>
                  <Label htmlFor="enroll-email" className="text-xs font-semibold">
                    Login Email <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="enroll-email"
                    type="email"
                    inputMode="email"
                    value={form.email}
                    onChange={(e) => setF('email', e.target.value)}
                    placeholder="Guardian email — becomes the login ID"
                    autoComplete="off"
                    required
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'enroll-email-error' : undefined}
                    className="mt-1.5 h-10"
                  />
                  {fieldError('email')}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Pre-filled from the application form when one was provided — this email is the
                    student&apos;s portal username, and duplicates are rejected by the server.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="enroll-class" className="text-xs font-semibold">
                    Class <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  {loadingRefData ? (
                    <div className="mt-1.5 flex h-10 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading classes…
                    </div>
                  ) : (
                    <Select value={form.classId} onValueChange={(v) => setF('classId', v)}>
                      <SelectTrigger
                        id="enroll-class"
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
                </div>
                <div>
                  <Label htmlFor="enroll-gender" className="text-xs font-semibold">
                    Gender <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Select value={form.gender} onValueChange={(v) => setF('gender', v)}>
                    <SelectTrigger id="enroll-gender" className="mt-1.5 h-10 w-full text-xs">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE" className="text-xs">Male</SelectItem>
                      <SelectItem value="FEMALE" className="text-xs">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="enroll-guardian-name" className="text-xs font-semibold">
                    Guardian Name <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="enroll-guardian-name"
                    value={form.guardianName}
                    onChange={(e) => setF('guardianName', e.target.value)}
                    autoComplete="off"
                    className="mt-1.5 h-10"
                  />
                </div>
                <div>
                  <Label htmlFor="enroll-guardian-phone" className="text-xs font-semibold">
                    Guardian Phone <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <PhoneInput
                    value={form.guardianPhone}
                    onChange={(v) => setF('guardianPhone', v)}
                    placeholder="e.g. 98765 43210"
                    className="mt-1.5 h-10"
                  />
                </div>
                <div>
                  <Label htmlFor="enroll-dob" className="text-xs font-semibold">
                    Date of Birth <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="enroll-dob"
                    type="date"
                    value={form.dob}
                    onChange={(e) => setF('dob', e.target.value)}
                    className="mt-1.5 h-10"
                  />
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The admission number and the first password are generated by the server. This
                enrollment creates the real student record — the school roster refreshes from the
                server afterwards.
              </p>
            </form>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="h-10 px-4 text-xs">
                Cancel
              </Button>
              <Button
                type="submit"
                form="enroll-student-form"
                disabled={submitting || loadingRefData}
                aria-busy={submitting}
                className="h-10 bg-emerald-600 px-5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Enrolling…
                  </>
                ) : (
                  <>
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Enroll Student
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ── ONE-TIME credential slip (server-generated password) ──── */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Student Enrolled — Account Created
              </DialogTitle>
              <DialogDescription className="text-xs">
                {created?.name} was created on the school server and this admission is complete.
                Hand over the sign-in details now.
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
                          className="h-7 w-7 p-0"
                        >
                          {pwRevealed ? (
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={copyCredentials}
                          className="h-7 gap-1.5 px-2.5 text-[11px]"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy Credentials
                        </Button>
                      </dd>
                      <p className="mt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        Shown only once — the student must change it at first sign-in. It is never
                        stored or printed again.
                      </p>
                    </div>
                  ) : (
                    <div className="px-3.5 py-2.5 text-[11px] text-muted-foreground">
                      No temporary password shown — the first password was set by the operator.
                    </div>
                  )}
                </dl>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="h-10 px-5 text-xs font-semibold"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
