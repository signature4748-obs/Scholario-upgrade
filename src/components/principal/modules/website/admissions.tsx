'use client'

/**
 * Website Management — Admissions section (task 2-a).
 *
 * The admissions status singleton ("Admissions Open for Session
 * 2027–28"). GET /api/school/website/admissions returns the row (or a
 * null-shaped default); PUT upserts it. classesAccepting is a multi-
 * select over the school's REAL classes (/api/classes) — only classes
 * that actually exist can be advertised.
 *
 * Honest states: skeleton → form; error → server message + retry;
 * never-configured → the honest first-use defaults (CLOSED, unpublished).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DoorOpen, Loader2, AlertTriangle, RefreshCw, Save, Check, Globe, GlobeLock, Info,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiJson } from './shared'

interface AdmissionForm {
  status: 'OPEN' | 'CLOSED'
  session: string
  classesAccepting: string[]
  openingDate: string
  closingDate: string
  noticeTitle: string
  noticeBody: string
  applicationUrl: string
  contactEmail: string
  contactPhone: string
  published: boolean
}

interface AdmissionRow {
  status: string
  session: string | null
  classesAccepting: string[]
  openingDate: string | null
  closingDate: string | null
  noticeTitle: string | null
  noticeBody: string | null
  applicationUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  published: boolean
}

const BLANK: AdmissionForm = {
  status: 'CLOSED',
  session: '',
  classesAccepting: [],
  openingDate: '',
  closingDate: '',
  noticeTitle: '',
  noticeBody: '',
  applicationUrl: '',
  contactEmail: '',
  contactPhone: '',
  published: false,
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface ClassRow { id: string; name: string; section?: string | null }

export function AdmissionsSection() {
  const [row, setRow] = useState<AdmissionRow | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [form, setForm] = useState<AdmissionForm>(BLANK)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    const result = await apiJson<{ admission: AdmissionRow | null }>('/api/school/website/admissions')
    if (result.ok) {
      const adm = result.data?.admission ?? null
      setRow(adm)
      setConfigured(adm !== null)
      setForm(
        adm
          ? {
              status: adm.status === 'OPEN' ? 'OPEN' : 'CLOSED',
              session: adm.session ?? '',
              classesAccepting: adm.classesAccepting ?? [],
              openingDate: isoToDateInput(adm.openingDate),
              closingDate: isoToDateInput(adm.closingDate),
              noticeTitle: adm.noticeTitle ?? '',
              noticeBody: adm.noticeBody ?? '',
              applicationUrl: adm.applicationUrl ?? '',
              contactEmail: adm.contactEmail ?? '',
              contactPhone: adm.contactPhone ?? '',
              published: adm.published,
            }
          : BLANK,
      )
    } else {
      setLoadError(result.error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The school's real class registry powers the multi-select.
  useEffect(() => {
    fetch('/api/classes', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const rows = j && typeof j === 'object' && 'data' in j ? (j as { data?: unknown }).data : j
        if (Array.isArray(rows)) {
          setClasses(
            rows.map((c: { id: string; name: string; section?: string | null }) => ({
              id: c.id,
              name: c.name,
              section: c.section ?? null,
            })),
          )
        }
      })
      .catch(() => {
        /* class list stays empty — the free-entry chips still work */
      })
  }, [])

  const set = (patch: Partial<AdmissionForm>) => setForm((f) => ({ ...f, ...patch }))

  const toggleClass = (name: string) => {
    setForm((f) => ({
      ...f,
      classesAccepting: f.classesAccepting.includes(name)
        ? f.classesAccepting.filter((c) => c !== name)
        : [...f.classesAccepting, name],
    }))
  }

  const dirty = useMemo(
    () =>
      row !== null
        ? JSON.stringify({
            status: row.status,
            session: row.session ?? '',
            classesAccepting: row.classesAccepting ?? [],
            openingDate: isoToDateInput(row.openingDate),
            closingDate: isoToDateInput(row.closingDate),
            noticeTitle: row.noticeTitle ?? '',
            noticeBody: row.noticeBody ?? '',
            applicationUrl: row.applicationUrl ?? '',
            contactEmail: row.contactEmail ?? '',
            contactPhone: row.contactPhone ?? '',
            published: row.published,
          }) !== JSON.stringify(form)
        : JSON.stringify(BLANK) !== JSON.stringify(form),
    [row, form],
  )

  const validate = (): string | null => {
    if (form.session.trim() && form.session.trim().length > 20) return 'Session must be at most 20 characters.'
    if (form.applicationUrl.trim() && !/^https?:\/\//i.test(form.applicationUrl.trim())) {
      return 'Application URL must start with http:// or https://.'
    }
    if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) {
      return 'Contact email is not a valid address.'
    }
    const open = form.openingDate ? new Date(form.openingDate) : null
    const close = form.closingDate ? new Date(form.closingDate) : null
    if (open && close && close.getTime() <= open.getTime()) {
      return 'Closing date must be after the opening date.'
    }
    return null
  }

  const save = async () => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    const result = await apiJson<{ admission: AdmissionRow }>('/api/school/website/admissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: form.status,
        session: form.session.trim() || null,
        classesAccepting: form.classesAccepting,
        openingDate: form.openingDate ? new Date(form.openingDate).toISOString() : null,
        closingDate: form.closingDate ? new Date(form.closingDate).toISOString() : null,
        noticeTitle: form.noticeTitle.trim() || null,
        noticeBody: form.noticeBody.trim() || null,
        applicationUrl: form.applicationUrl.trim() || null,
        contactEmail: form.contactEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        published: form.published,
      }),
    })
    setSaving(false)
    if (result.ok && result.data?.admission) {
      const adm = result.data.admission
      setRow(adm)
      setConfigured(true)
      toast.success(
        form.published
          ? `Admissions block saved and published (${adm.status === 'OPEN' ? 'open' : 'closed'}).`
          : 'Admissions block saved (not published yet).',
      )
    } else {
      toast.error(result.error ?? 'The admissions block could not be saved.')
    }
  }

  const inputCls = 'h-8 text-xs'

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
              <DoorOpen className="h-4 w-4 text-emerald-600" /> Admissions Status
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              The admissions block on the public website — status, session, accepting classes, dates and contacts.
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh admissions">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <div
          className="flex items-center gap-2 rounded-lg bg-muted/50 text-muted-foreground text-[11px] px-3 py-2"
          role="note"
        >
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>This appears on your public website when published{form.status === 'OPEN' ? ' — “Admissions Open” with your dates and classes' : ' — a calm “Admissions are currently closed” note'}. Until then it stays private.</span>
        </div>
      </GlassCard>

      {loadError !== null && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">Admissions block could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{loadError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </GlassCard>
      )}

      {configured === null && loadError === null && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the admissions block…
          </div>
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {configured !== null && (
        <GlassCard className="p-5 sm:p-6 space-y-5">
          {configured === false && (
            <p className="text-[11px] text-muted-foreground" role="note">
              No admissions block configured yet — the defaults below apply once you save.
            </p>
          )}

          {/* Status + published */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Admissions status</Label>
              <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 gap-1" role="radiogroup" aria-label="Admissions status">
                {(['OPEN', 'CLOSED'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={form.status === s}
                    onClick={() => set({ status: s })}
                    className={cn(
                      'px-3 h-8 rounded-md text-xs font-semibold transition-colors',
                      form.status === s
                        ? s === 'OPEN'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-600 text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s === 'OPEN' ? 'Open' : 'Closed'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
              <Switch
                id="adm-published"
                checked={form.published}
                onCheckedChange={(v) => set({ published: v })}
                className="mt-0.5"
                aria-label="Publish the admissions block to the website"
              />
              <div className="min-w-0">
                <Label htmlFor="adm-published" className="text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                  {form.published ? <Globe className="h-3 w-3 text-emerald-600" /> : <GlobeLock className="h-3 w-3 text-muted-foreground" />}
                  {form.published ? 'Published' : 'Not published'}
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Only a published block renders on the public website.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="adm-session" className="text-xs font-semibold mb-1 block">Session</Label>
              <Input
                id="adm-session"
                value={form.session}
                onChange={(e) => set({ session: e.target.value })}
                placeholder="2027-28"
                maxLength={20}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="adm-opening" className="text-xs font-semibold mb-1 block">Opening date</Label>
                <Input
                  id="adm-opening"
                  type="date"
                  value={form.openingDate}
                  onChange={(e) => set({ openingDate: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <Label htmlFor="adm-closing" className="text-xs font-semibold mb-1 block">Closing date</Label>
                <Input
                  id="adm-closing"
                  type="date"
                  value={form.closingDate}
                  onChange={(e) => set({ closingDate: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Classes accepting — multi-select over the school's real classes */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Classes accepting applications</Label>
            {classes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No classes found in the school registry yet — classes you create in Students &amp; Classes will appear here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto custom-scrollbar p-1" role="group" aria-label="Classes accepting applications">
                {classes.map((c) => {
                  const active = form.classesAccepting.includes(c.name)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.name)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-colors',
                        active
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                      )}
                    >
                      {active && <Check className="h-3 w-3" aria-hidden />}
                      {c.name}
                    </button>
                  )
                })}
              </div>
            )}
            {form.classesAccepting.length > 0 && (
              <Badge variant="secondary" className="mt-2 text-[10px]">
                {form.classesAccepting.length} selected
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="adm-notice-title" className="text-xs font-semibold mb-1 block">Notice headline</Label>
              <Input
                id="adm-notice-title"
                value={form.noticeTitle}
                onChange={(e) => set({ noticeTitle: e.target.value })}
                placeholder="Registration opens 1 February 2027"
                maxLength={120}
                className={inputCls}
              />
            </div>
            <div>
              <Label htmlFor="adm-notice-body" className="text-xs font-semibold mb-1 block">Notice body</Label>
              <Textarea
                id="adm-notice-body"
                rows={3}
                value={form.noticeBody}
                onChange={(e) => set({ noticeBody: e.target.value })}
                placeholder="Short factual instructions for parents (documents, process, office hours)."
                maxLength={2000}
                className="text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="adm-url" className="text-xs font-semibold mb-1 block">Application URL</Label>
              <Input
                id="adm-url"
                value={form.applicationUrl}
                onChange={(e) => set({ applicationUrl: e.target.value })}
                placeholder="https://…"
                maxLength={300}
                className={inputCls}
              />
            </div>
            <div>
              <Label htmlFor="adm-email" className="text-xs font-semibold mb-1 block">Contact email</Label>
              <Input
                id="adm-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => set({ contactEmail: e.target.value })}
                placeholder="admissions@school.edu"
                maxLength={160}
                className={inputCls}
              />
            </div>
            <div>
              <Label htmlFor="adm-phone" className="text-xs font-semibold mb-1 block">Contact phone</Label>
              <Input
                id="adm-phone"
                type="tel"
                value={form.contactPhone}
                onChange={(e) => set({ contactPhone: e.target.value })}
                placeholder="+91 98765 43210"
                maxLength={24}
                className={inputCls}
              />
            </div>
          </div>

          {/* Save bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-4">
            <span
              role="status"
              aria-live="polite"
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border',
                dirty
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                </>
              ) : dirty ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Saved
                </>
              )}
            </span>
            <Button
              size="sm"
              disabled={saving || !dirty}
              onClick={() => void save()}
              className="gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Admissions Block
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  )
}
