'use client'

/**
 * School → School Profile (formerly "Identity").
 *
 * SaaS-HARDENING §8 — the school's LEGAL identity (name, code,
 * affiliation) is PLATFORM-CONTROLLED: rendered read-only with a lock,
 * and changes go through the request workflow
 * (GET/POST /api/school-settings/profile-change-request → platform
 * review). The request ledger below shows every request with its status
 * and the platform reviewer's note.
 *
 * School-CONTROLLED presentation fields (shortName, tagline, address,
 * city, phone, email, website, principalName, established) stay a LOCAL
 * DRAFT saved explicitly through PATCH /api/school-settings
 * { identity } — the PATCH body never carries name/code/affiliation
 * (the API rejects those keys with a pointer to this workflow).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { School, Save, Lock, FileClock, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { FormattedInput } from '@/components/shared/formatted-input'
import { StatusBadge } from '@/components/shared/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
  type ServerSchoolIdentity,
} from '@/lib/store/school-settings-store'
import { patchSchoolSettings } from './server-api'
import { SettingsTab, FieldGroup, SyncGate, SyncChip } from './shared'

/* ── School-controlled presentation draft ─────────────────────────── */

interface IdentityDraft {
  shortName: string
  tagline: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  principalName: string
  established: string
}

/** Draft seeded from the SERVER identity (the canonical record). */
function draftFromServer(id: ServerSchoolIdentity): IdentityDraft {
  return {
    shortName: id.shortName ?? '',
    tagline: id.tagline ?? '',
    address: id.address ?? '',
    city: id.city ?? '',
    phone: id.phone ?? '',
    email: id.email ?? '',
    website: id.website ?? '',
    principalName: id.principalName ?? '',
    established: id.established ?? '',
  }
}

/** Fallback draft from the local store slice (pre-sync / offline). */
function draftFromGeneral(g: {
  shortName: string
  tagline: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  principalName: string
  established: number
}): IdentityDraft {
  return {
    shortName: g.shortName,
    tagline: g.tagline,
    address: g.address,
    city: g.city,
    phone: g.phone,
    email: g.email,
    website: g.website,
    principalName: g.principalName,
    established: g.established ? String(g.established) : '',
  }
}

/* ── Platform identity change-request workflow (client) ───────────── */

interface ProfileChangeRequestRow {
  id: string
  field: string
  fieldLabel: string
  currentValue: string | null
  requestedValue: string
  reason: string
  status: string
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
}

interface ProfileChangeField {
  value: string
  label: string
}

/** Fallback until the GET answers — mirrors the server's field map. */
const FALLBACK_FIELDS: ProfileChangeField[] = [
  { value: 'name', label: 'Legal school name' },
  { value: 'code', label: 'School code' },
  { value: 'affiliation', label: 'Affiliation number' },
]

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'APPROVED') return 'success'
  if (status === 'PENDING') return 'warning'
  if (status === 'REJECTED') return 'danger'
  return 'neutral'
}

export function IdentityTab() {
  const identity = useSchoolSettingsStore((s) => s.server.identity)
  const general = useSchoolSettingsStore((s) => s.general)
  const [draft, setDraft] = useState<IdentityDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // (Re)seed the draft whenever the server record arrives (first sync or
  // post-save re-sync). Before any server data exists, fall back to the
  // local slice so the tab is always editable.
  useEffect(() => {
    setDraft(identity ? draftFromServer(identity) : draftFromGeneral(general))
    setError(null)
  }, [identity, general])

  const baseline = useMemo(
    () => (identity ? JSON.stringify(draftFromServer(identity)) : null),
    [identity],
  )
  // No server identity yet (sync failed / never ran) → the local values are
  // NOT server-confirmed: treat the draft as unsaved (honest chip state).
  const dirty = identity === null || (draft !== null && JSON.stringify(draft) !== baseline)

  const set = (patch: Partial<IdentityDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  // The PATCH carries ONLY school-controlled keys — name/code/affiliation
  // are platform-controlled and the API rejects them (by design).
  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    const result = await patchSchoolSettings({
      identity: {
        shortName: draft.shortName,
        tagline: draft.tagline,
        address: draft.address,
        city: draft.city,
        phone: draft.phone,
        email: draft.email,
        website: draft.website,
        principalName: draft.principalName,
        established: draft.established,
      },
    })
    setSaving(false)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success('School profile saved', {
        description: 'Documents, receipts and the public site now use the updated record.',
      })
    } else {
      setError(result.error)
      toast.error(result.error ?? 'School profile could not be saved.')
    }
  }

  if (!draft) return null

  const legalName = identity?.name ?? general.schoolName
  const legalAffiliation = identity?.affiliation ?? general.affiliation
  const legalCode = identity?.code

  return (
    <SyncGate>
      <SettingsTab
        icon={School}
        title="School Profile"
        description="The school record printed on marksheets, fee receipts, certificates and the public website."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        {/* ── Legal identity (platform-controlled) ───────────────────── */}
        <FieldGroup label="Legal Identity — platform-controlled">
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-muted/30">
            <LockedRow label="Legal School Name" value={legalName || '—'} />
            <LockedRow label="School Code" value={legalCode ?? '—'} mono />
            <LockedRow label="Board / Affiliation" value={legalAffiliation || '—'} />
          </div>
          <IdentityChangeRequests />
        </FieldGroup>

        {/* ── Presentation & contact (school-controlled) ─────────────── */}
        <FieldGroup label="Presentation & contact — school-controlled">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <Label htmlFor="identity-short" className="text-xs font-semibold mb-1 block">
                Short Name / Abbreviation
              </Label>
              <Input
                id="identity-short"
                value={draft.shortName}
                onChange={(e) => set({ shortName: e.target.value })}
                placeholder="Greenwood"
                maxLength={40}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="identity-tagline" className="text-xs font-semibold mb-1 block">
                Tagline / Motto
              </Label>
              <Input
                id="identity-tagline"
                value={draft.tagline}
                onChange={(e) => set({ tagline: e.target.value })}
                placeholder="Excellence in Education"
                maxLength={400}
              />
            </div>

            <div>
              <Label htmlFor="identity-phone" className="text-xs font-semibold mb-1 block">
                Official Phone
              </Label>
              <FormattedInput
                id="identity-phone"
                formatType="mobile"
                value={draft.phone}
                onChangeRaw={(raw) => set({ phone: raw })}
              />
            </div>

            <div>
              <Label htmlFor="identity-email" className="text-xs font-semibold mb-1 block">
                Official Email Address
              </Label>
              <Input
                id="identity-email"
                type="email"
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="office@school.edu"
                maxLength={120}
              />
            </div>

            <div>
              <Label htmlFor="identity-website" className="text-xs font-semibold mb-1 block">
                Official Website
              </Label>
              <Input
                id="identity-website"
                value={draft.website}
                onChange={(e) => set({ website: e.target.value })}
                placeholder="https://school.edu"
                maxLength={200}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="identity-address" className="text-xs font-semibold mb-1 block">
                Official Campus Address
              </Label>
              <Textarea
                id="identity-address"
                rows={2}
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
                maxLength={400}
              />
            </div>

            <div>
              <Label htmlFor="identity-city" className="text-xs font-semibold mb-1 block">
                City
              </Label>
              <Input
                id="identity-city"
                value={draft.city}
                onChange={(e) => set({ city: e.target.value })}
                placeholder="Pune"
                maxLength={80}
              />
            </div>

            <div>
              <Label htmlFor="identity-principal" className="text-xs font-semibold mb-1 block">
                Principal Name
              </Label>
              <Input
                id="identity-principal"
                value={draft.principalName}
                onChange={(e) => set({ principalName: e.target.value })}
                placeholder="Signatory on official documents"
                maxLength={120}
              />
            </div>

            <div>
              <Label htmlFor="identity-established" className="text-xs font-semibold mb-1 block">
                Established Year
              </Label>
              <Input
                id="identity-established"
                inputMode="numeric"
                value={draft.established}
                onChange={(e) => set({ established: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
                placeholder="1995"
                maxLength={4}
              />
            </div>
          </div>
        </FieldGroup>

        {/* ── Error banner + Save ───────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={handleSave}
            className={cn(
              'gap-1.5 text-xs font-bold',
              'bg-emerald-600 hover:bg-emerald-700 text-white',
              !dirty && 'opacity-50',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save School Profile'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}

/* ── Locked (platform-controlled) row ─────────────────────────────── */

function LockedRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'text-xs font-semibold text-foreground mt-0.5 break-words',
            mono && 'font-mono',
          )}
        >
          {value}
        </p>
      </div>
      <span
        title="Platform-controlled"
        aria-label={`${label} is platform-controlled`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted"
      >
        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </span>
    </div>
  )
}

/* ── Identity change requests: launcher + dialog + ledger ─────────── */

/**
 * One panel owning the whole request workflow: the "Request identity
 * change" launcher (opens the dialog), the dialog form, and this
 * school's request ledger. The ledger refetches after every successful
 * submission.
 */
function IdentityChangeRequests() {
  const [rows, setRows] = useState<ProfileChangeRequestRow[] | null>(null)
  const [fields, setFields] = useState<ProfileChangeField[]>(FALLBACK_FIELDS)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLedgerError(null)
    try {
      const r = await fetch('/api/school-settings/profile-change-request', {
        cache: 'no-store',
      })
      const env = (await r.json().catch(() => null)) as
        | {
            ok?: boolean
            error?: string
            data?: { requests?: ProfileChangeRequestRow[]; fields?: ProfileChangeField[] }
          }
        | null
      if (r.ok && env?.ok && env.data) {
        setRows(env.data.requests ?? [])
        if (env.data.fields?.length) setFields(env.data.fields)
      } else {
        setLedgerError(env?.error ?? 'Identity change requests could not be loaded.')
      }
    } catch {
      setLedgerError('Identity change requests could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5 min-w-0">
          <Lock className="h-3 w-3 mt-px shrink-0" aria-hidden />
          <span>
            Legal identity fields are part of the school&apos;s record with SCHOLARIO and are
            managed by the platform — request a change and a platform admin reviews it.
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs font-bold shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <FileClock className="h-3.5 w-3.5" />
          Request identity change
        </Button>
      </div>

      {ledgerError ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
        >
          {ledgerError}
        </div>
      ) : rows === null ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center">
          <p className="text-xs font-semibold text-foreground">No identity change requests yet</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Requests you submit appear here with their review status.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5 max-h-96 overflow-y-auto custom-scrollbar pr-0.5">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{row.fieldLabel}</p>
                <StatusBadge status={row.status} variant={statusVariant(row.status)} dot />
              </div>
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                <p className="break-words">
                  <span className="text-muted-foreground/80">From:</span>{' '}
                  <span className="font-medium text-foreground">{row.currentValue || '—'}</span>
                  <span className="text-muted-foreground/80"> → to:</span>{' '}
                  <span className="font-medium text-foreground">{row.requestedValue}</span>
                </p>
                <p className="mt-1 break-words">
                  <span className="text-muted-foreground/80">Reason:</span> {row.reason}
                </p>
                {row.reviewNote && (
                  <p className="mt-1 break-words rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <span className="text-muted-foreground/80">Platform review note:</span>{' '}
                    {row.reviewNote}
                  </p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>Requested {formatDate(row.createdAt)}</span>
                  {row.reviewedAt && <span>· Reviewed {formatDate(row.reviewedAt)}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <IdentityChangeRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fields={fields}
        onSubmitted={() => void load()}
      />
    </div>
  )
}

function IdentityChangeRequestDialog({
  open,
  onOpenChange,
  fields,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: ProfileChangeField[]
  onSubmitted: () => void
}) {
  const [field, setField] = useState(fields[0]?.value ?? 'name')
  const [requestedValue, setRequestedValue] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Fresh defaults every time the dialog opens.
  useEffect(() => {
    if (open) {
      setField(fields[0]?.value ?? 'name')
      setRequestedValue('')
      setReason('')
      setFormError(null)
    }
  }, [open, fields])

  const submit = async () => {
    setFormError(null)
    if (requestedValue.trim().length < 2) {
      setFormError('Enter the new value (at least 2 characters).')
      return
    }
    if (requestedValue.trim().length > 160) {
      setFormError('The requested value is too long (160 characters maximum).')
      return
    }
    if (reason.trim().length < 10) {
      setFormError('Tell the platform team why the change is needed (at least 10 characters).')
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/school-settings/profile-change-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          requestedValue: requestedValue.trim(),
          reason: reason.trim(),
        }),
      })
      const env = (await r.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { message?: string } }
        | null
      if (r.ok && env?.ok) {
        toast.success('Identity change request submitted', {
          description:
            env.data?.message ??
            'A platform admin will review it. The outcome appears in the requests list.',
        })
        onOpenChange(false)
        onSubmitted()
      } else if (r.status === 409) {
        // Already pending / same value — the server's message is the honest UI.
        toast.error(env?.error ?? 'A request for this field is already pending review.')
      } else {
        setFormError(env?.error ?? 'The request could not be submitted — please try again.')
      }
    } catch {
      setFormError('The server is unreachable — check your connection and retry.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedLabel = fields.find((f) => f.value === field)?.label ?? 'value'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileClock className="h-5 w-5 text-emerald-600" /> Request identity change
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Legal identity fields are platform-controlled. Your request is reviewed by a
            SCHOLARIO platform admin — until it is approved, the current value stays in force.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1 text-xs">
          <div>
            <Label htmlFor="idreq-field" className="text-xs font-semibold mb-1 block">
              Field to change
            </Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger id="idreq-field" className="w-full">
                <SelectValue placeholder="Choose a field" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="idreq-value" className="text-xs font-semibold mb-1 block">
              Requested {selectedLabel.toLowerCase()}
            </Label>
            <Input
              id="idreq-value"
              value={requestedValue}
              onChange={(e) => setRequestedValue(e.target.value)}
              placeholder="New value as it should appear on official records"
              maxLength={160}
            />
          </div>

          <div>
            <Label htmlFor="idreq-reason" className="text-xs font-semibold mb-1 block">
              Reason for the change
            </Label>
            <Textarea
              id="idreq-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The board granted a new affiliation number effective this session…"
              maxLength={600}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Minimum 10 characters — this note is what the reviewing admin sees.
            </p>
          </div>

          {formError && (
            <p className="text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={submitting}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {submitting ? 'Submitting…' : 'Submit for review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
