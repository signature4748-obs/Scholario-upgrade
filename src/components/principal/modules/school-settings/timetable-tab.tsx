'use client'

/**
 * Timetable tab (PHASE 7.5 rework) — the school-day timing parameters,
 * now SERVER-backed through
 * PATCH /api/school-settings { settings: { timetable: {…} } }.
 *
 * The slice shape matches the server's `settings.timetable` document
 * (dayStart / dayEnd / periodMinutes / workingDays / break placements).
 * The master period LADDER used by every role's timetable grid derives
 * from this config — it maps onto the PERIODS defaults in
 * src/lib/timetable/config.ts (period length + break positions).
 */

import { useEffect, useMemo, useState } from 'react'
import { Clock, Save, Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
} from '@/lib/store/school-settings-store'
import { DAYS } from '@/lib/timetable/config'
import { patchSettingsSlice } from './server-api'
import { SettingsTab, FieldGroup, SyncGate, SyncChip } from './shared'

interface TimetableDraft {
  dayStart: string
  dayEnd: string
  periodMinutes: number
  shortBreakAfterPeriod: number
  shortBreakMinutes: number
  lunchAfterPeriod: number
  lunchMinutes: number
  workingDays: string[]
}

const FALLBACK: TimetableDraft = {
  dayStart: '08:30 AM',
  dayEnd: '02:45 PM',
  periodMinutes: 45,
  shortBreakAfterPeriod: 3,
  shortBreakMinutes: 15,
  lunchAfterPeriod: 6,
  lunchMinutes: 30,
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function draftFromServer(settings: Record<string, unknown>): TimetableDraft {
  const raw = asRecord(settings.timetable)
  if (!raw) return { ...FALLBACK }
  const days = Array.isArray(raw.workingDays)
    ? (raw.workingDays as unknown[]).filter((d): d is string => typeof d === 'string')
    : []
  return {
    dayStart: typeof raw.dayStart === 'string' && raw.dayStart.trim() ? raw.dayStart : FALLBACK.dayStart,
    dayEnd: typeof raw.dayEnd === 'string' && raw.dayEnd.trim() ? raw.dayEnd : FALLBACK.dayEnd,
    periodMinutes: num(raw.periodMinutes, FALLBACK.periodMinutes),
    shortBreakAfterPeriod: num(raw.shortBreakAfterPeriod, FALLBACK.shortBreakAfterPeriod),
    shortBreakMinutes: num(raw.shortBreakMinutes, FALLBACK.shortBreakMinutes),
    lunchAfterPeriod: num(raw.lunchAfterPeriod, FALLBACK.lunchAfterPeriod),
    lunchMinutes: num(raw.lunchMinutes, FALLBACK.lunchMinutes),
    workingDays: days.length ? days : [...FALLBACK.workingDays],
  }
}

export function TimetableTab() {
  const settings = useSchoolSettingsStore((s) => s.server.settings)
  const [draft, setDraft] = useState<TimetableDraft>(draftFromServer(settings))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromServer(settings))
    setError(null)
  }, [settings])

  const baseline = useMemo(() => JSON.stringify(draftFromServer(settings)), [settings])
  const dirty = JSON.stringify(draft) !== baseline

  const set = (patch: Partial<TimetableDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const toggleDay = (day: string) => {
    setDraft((d) => ({
      ...d,
      workingDays: d.workingDays.includes(day)
        ? d.workingDays.filter((x) => x !== day)
        : [...d.workingDays, day],
    }))
  }

  const handleSave = async () => {
    if (draft.workingDays.length === 0) {
      toast.error('Pick at least one working day')
      return
    }
    setSaving(true)
    setError(null)
    const result = await patchSettingsSlice('timetable', draft)
    setSaving(false)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success('Timetable parameters saved', {
        description: 'The master period ladder follows this configuration.',
      })
    } else {
      setError(result.error)
      toast.error(result.error ?? 'Timetable settings could not be saved.')
    }
  }

  return (
    <SyncGate>
      <SettingsTab
        icon={Clock}
        title="Timetable Engine Parameters"
        description="School-day timings that drive the master period ladder for every role's timetable."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        <FieldGroup label="School Day">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <Label htmlFor="tt-day-start" className="text-xs font-semibold mb-1 block">
                Day Start
              </Label>
              <Input
                id="tt-day-start"
                value={draft.dayStart}
                onChange={(e) => set({ dayStart: e.target.value })}
                placeholder="08:30 AM"
              />
            </div>
            <div>
              <Label htmlFor="tt-day-end" className="text-xs font-semibold mb-1 block">
                Day End
              </Label>
              <Input
                id="tt-day-end"
                value={draft.dayEnd}
                onChange={(e) => set({ dayEnd: e.target.value })}
                placeholder="02:45 PM"
              />
            </div>
            <div>
              <Label htmlFor="tt-period-min" className="text-xs font-semibold mb-1 block">
                Period Length (minutes)
              </Label>
              <Input
                id="tt-period-min"
                type="number"
                min={20}
                max={90}
                value={draft.periodMinutes}
                onChange={(e) => set({ periodMinutes: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label="Breaks">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <Label htmlFor="tt-short-after" className="text-xs font-semibold mb-1 block">
                Short Break After Period
              </Label>
              <Input
                id="tt-short-after"
                type="number"
                min={1}
                max={12}
                value={draft.shortBreakAfterPeriod}
                onChange={(e) => set({ shortBreakAfterPeriod: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor="tt-short-min" className="text-xs font-semibold mb-1 block">
                Short Break (minutes)
              </Label>
              <Input
                id="tt-short-min"
                type="number"
                min={5}
                max={60}
                value={draft.shortBreakMinutes}
                onChange={(e) => set({ shortBreakMinutes: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor="tt-lunch-after" className="text-xs font-semibold mb-1 block">
                Lunch After Period
              </Label>
              <Input
                id="tt-lunch-after"
                type="number"
                min={1}
                max={12}
                value={draft.lunchAfterPeriod}
                onChange={(e) => set({ lunchAfterPeriod: Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor="tt-lunch-min" className="text-xs font-semibold mb-1 block">
                Lunch Break (minutes)
              </Label>
              <Input
                id="tt-lunch-min"
                type="number"
                min={10}
                max={90}
                value={draft.lunchMinutes}
                onChange={(e) => set({ lunchMinutes: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label="Working Days">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
            {DAYS.map((day) => {
              const active = draft.workingDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'h-9 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary/40 bg-primary/[0.08] text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {day.slice(0, 3)}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {draft.workingDays.length} working {draft.workingDays.length === 1 ? 'day' : 'days'} per week.
          </p>
        </FieldGroup>

        <div className="flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span>
            The master period ladder (period count, lengths and break positions shown in every
            role&apos;s timetable grid) syncs from this configuration — it maps onto the canonical
            PERIODS defaults in <code className="font-mono">src/lib/timetable/config.ts</code>.
          </span>
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
            {saving ? 'Saving…' : 'Save Timetable Settings'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
