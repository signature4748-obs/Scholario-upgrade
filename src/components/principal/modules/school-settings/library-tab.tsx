'use client'

// Library tab (PHASE 7.5) — issue limits, lending period, and overdue
// fine inputs. LOCAL draft + explicit Save persisting through
// PATCH /api/school-settings { settings: { libraryRules: {…} } }.

import { useEffect, useMemo, useState } from 'react'
import { BookMarked, Save } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
} from '@/lib/store/school-settings-store'
import { patchSettingsSlice } from './server-api'
import { SettingsTab, SyncGate, SyncChip } from './shared'

interface LibraryDraft {
  maxBooksPerStudent: number
  issueDays: number
  lateFinePerDay: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function draftFromServer(settings: Record<string, unknown>, local: { maxBooksPerStudent: number; issueDays: number; lateFinePerDay: number }): LibraryDraft {
  const raw = asRecord(settings.libraryRules)
  if (!raw) return { ...local }
  return {
    maxBooksPerStudent: Math.trunc(num(raw.maxBooksPerStudent, local.maxBooksPerStudent)),
    issueDays: Math.trunc(num(raw.issueDays, local.issueDays)),
    lateFinePerDay: Math.trunc(num(raw.lateFinePerDay, local.lateFinePerDay)),
  }
}

export function LibraryTab() {
  const settings = useSchoolSettingsStore((s) => s.server.settings)
  const library = useSchoolSettingsStore((s) => s.library)
  const updateLibrary = useSchoolSettingsStore((s) => s.updateLibrary)
  const [draft, setDraft] = useState<LibraryDraft>({ ...library })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromServer(settings, library))
    setError(null)
  }, [settings, library])

  const baseline = useMemo(
    () => JSON.stringify(draftFromServer(settings, library)),
    [settings, library],
  )
  const dirty = JSON.stringify(draft) !== baseline

  const set = (patch: Partial<LibraryDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const result = await patchSettingsSlice('libraryRules', draft)
    setSaving(false)
    if (result.ok && result.config) {
      // Keep the local consumer slice aligned with the server value.
      updateLibrary(draft)
      applySchoolConfig(result.config)
      toast.success('Library rules saved')
    } else {
      setError(result.error)
      toast.error(result.error ?? 'Library rules could not be saved.')
    }
  }

  return (
    <SyncGate>
      <SettingsTab
        icon={BookMarked}
        title="Library Rules"
        description="Issue limits, lending period, and overdue fine calculations."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <Label htmlFor="lib-max" className="text-xs font-semibold mb-1 block">
              Max Books Per Student
            </Label>
            <Input
              id="lib-max"
              type="number"
              min={1}
              max={20}
              value={draft.maxBooksPerStudent}
              onChange={(e) => set({ maxBooksPerStudent: Number(e.target.value) })}
            />
          </div>

          <div>
            <Label htmlFor="lib-days" className="text-xs font-semibold mb-1 block">
              Issue Duration (Days)
            </Label>
            <Input
              id="lib-days"
              type="number"
              min={1}
              max={90}
              value={draft.issueDays}
              onChange={(e) => set({ issueDays: Number(e.target.value) })}
            />
          </div>

          <div>
            <Label htmlFor="lib-fine" className="text-xs font-semibold mb-1 block">
              Late Fine Per Day (₹)
            </Label>
            <Input
              id="lib-fine"
              type="number"
              min={0}
              max={500}
              value={draft.lateFinePerDay}
              onChange={(e) => set({ lateFinePerDay: Number(e.target.value) })}
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end pt-1">
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={handleSave}
            className={cn('gap-1.5 text-xs font-bold', 'bg-emerald-600 hover:bg-emerald-700 text-white')}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save Library Rules'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
