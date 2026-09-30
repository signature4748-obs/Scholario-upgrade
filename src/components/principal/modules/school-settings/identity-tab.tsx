'use client'

/**
 * Identity tab (PHASE 7.5) — rework of the old "General" tab.
 *
 * The school's OFFICIAL identity, server-backed through
 * PATCH /api/school-settings { identity: {…} }:
 *
 *   · fields are a LOCAL DRAFT — nothing saves until the explicit Save
 *   · "Synced with school record" / "Unsaved changes" chip (aria-live)
 *   · a successful save re-syncs the store from the server's response
 *   · a failed save surfaces the server's verbatim message
 *   · the school CODE is read-only (assigned by provisioning)
 */

import { useEffect, useMemo, useState } from 'react'
import { School, Save, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { FormattedInput } from '@/components/shared/formatted-input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
  type ServerSchoolIdentity,
} from '@/lib/store/school-settings-store'
import { patchSchoolSettings } from './server-api'
import { SettingsTab, FieldGroup, SyncGate, SyncChip } from './shared'

interface IdentityDraft {
  name: string
  shortName: string
  tagline: string
  affiliation: string
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
    name: id.name ?? '',
    shortName: id.shortName ?? '',
    tagline: id.tagline ?? '',
    affiliation: id.affiliation ?? '',
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
  schoolName: string
  shortName: string
  tagline: string
  affiliation: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  principalName: string
  established: number
}): IdentityDraft {
  return {
    name: g.schoolName,
    shortName: g.shortName,
    tagline: g.tagline,
    affiliation: g.affiliation,
    address: g.address,
    city: g.city,
    phone: g.phone,
    email: g.email,
    website: g.website,
    principalName: g.principalName,
    established: g.established ? String(g.established) : '',
  }
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

  const handleSave = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      toast.error('School name cannot be empty')
      return
    }
    setSaving(true)
    setError(null)
    const result = await patchSchoolSettings({
      identity: {
        name: draft.name,
        shortName: draft.shortName,
        tagline: draft.tagline,
        affiliation: draft.affiliation,
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
      toast.success('School identity saved', {
        description: 'Documents, receipts and the public site now use the updated record.',
      })
    } else {
      setError(result.error)
      toast.error(result.error ?? 'School identity could not be saved.')
    }
  }

  if (!draft) return null

  return (
    <SyncGate>
      <SettingsTab
        icon={School}
        title="School Identity"
        description="Official record printed on marksheets, fee receipts, certificates and the public website."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        {/* ── School Identity ─────────────────────────────────────────── */}
        <FieldGroup label="School Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div className="sm:col-span-2">
              <Label htmlFor="identity-name" className="text-xs font-semibold mb-1 block">
                School Full Name
              </Label>
              <Input
                id="identity-name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Official registered name"
                maxLength={120}
              />
            </div>

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
              <Label htmlFor="identity-code" className="text-xs font-semibold mb-1 block">
                School Code
              </Label>
              <Input
                id="identity-code"
                value={identity?.code ?? '—'}
                readOnly
                aria-readonly="true"
                className="font-mono bg-muted/50"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-px shrink-0" aria-hidden />
                Assigned by the platform at provisioning — read-only.
              </p>
            </div>

            <div>
              <Label htmlFor="identity-affiliation" className="text-xs font-semibold mb-1 block">
                Board / Affiliation
              </Label>
              <Input
                id="identity-affiliation"
                value={draft.affiliation}
                onChange={(e) => set({ affiliation: e.target.value })}
                placeholder="CBSE — Affiliation No. …"
                maxLength={400}
              />
            </div>
          </div>
        </FieldGroup>

        {/* ── Contact & Location ──────────────────────────────────────── */}
        <FieldGroup label="Contact & Location">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <Label htmlFor="identity-phone" className="text-xs font-semibold mb-1 block">
                Official Phone
              </Label>
              <FormattedInput
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
          </div>
        </FieldGroup>

        {/* ── Leadership ──────────────────────────────────────────────── */}
        <FieldGroup label="Leadership">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
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

        {/* ── Error banner + Save ─────────────────────────────────────── */}
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
            {saving ? 'Saving…' : 'Save Identity'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
