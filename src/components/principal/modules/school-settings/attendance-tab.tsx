'use client'

/**
 * Attendance tab (PHASE 7.5) — NEW home for the school's attendance
 * policy. The existing display thresholds (Excellent / Needs Attention)
 * plus the server's late-arrival + guardian-notify policy persist
 * together through
 * PATCH /api/school-settings { settings: { attendance: {…} } }.
 *
 * Student attendance status labels derive from the thresholds here —
 * never hardcoded institutional rules.
 */

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Save } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useSchoolSettingsStore,
  applySchoolConfig,
} from '@/lib/store/school-settings-store'
import { patchSettingsSlice } from './server-api'
import { SettingsTab, FieldGroup, SyncGate, SyncChip } from './shared'

interface AttendanceDraft {
  excellent: number
  needsAttention: number
  lateAfterMinutes: number
  notifyGuardianOnAbsent: boolean
}

const FALLBACK: AttendanceDraft = {
  excellent: 95,
  needsAttention: 85,
  lateAfterMinutes: 15,
  notifyGuardianOnAbsent: true,
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function draftFromServer(settings: Record<string, unknown>, local: { excellent: number; needsAttention: number }): AttendanceDraft {
  const raw = asRecord(settings.attendance)
  if (!raw) {
    // No server slice yet — start from the local thresholds the student
    // modules already use, with the server defaults for the rest.
    return { ...FALLBACK, excellent: local.excellent || FALLBACK.excellent, needsAttention: local.needsAttention || FALLBACK.needsAttention }
  }
  return {
    excellent: num(raw.excellent, local.excellent || FALLBACK.excellent),
    needsAttention: num(raw.needsAttention, local.needsAttention || FALLBACK.needsAttention),
    lateAfterMinutes: num(raw.lateAfterMinutes, FALLBACK.lateAfterMinutes),
    notifyGuardianOnAbsent: typeof raw.notifyGuardianOnAbsent === 'boolean' ? raw.notifyGuardianOnAbsent : FALLBACK.notifyGuardianOnAbsent,
  }
}

export function AttendanceTab() {
  const settings = useSchoolSettingsStore((s) => s.server.settings)
  const localThresholds = useSchoolSettingsStore((s) => s.academics.attendanceThresholds)
  const [draft, setDraft] = useState<AttendanceDraft>(draftFromServer(settings, localThresholds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromServer(settings, localThresholds))
    setError(null)
  }, [settings, localThresholds])

  const baseline = useMemo(
    () => JSON.stringify(draftFromServer(settings, localThresholds)),
    [settings, localThresholds],
  )
  const dirty = JSON.stringify(draft) !== baseline

  const set = (patch: Partial<AttendanceDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const handleSave = async () => {
    if (draft.excellent <= draft.needsAttention) {
      toast.error('The Excellent threshold must be higher than Needs Attention')
      return
    }
    if (draft.excellent > 100 || draft.needsAttention < 0 || draft.lateAfterMinutes < 0) {
      toast.error('Thresholds must be 0–100 and late-arrival minutes cannot be negative')
      return
    }
    setSaving(true)
    setError(null)
    const result = await patchSettingsSlice('attendance', draft)
    setSaving(false)
    if (result.ok && result.config) {
      applySchoolConfig(result.config)
      toast.success('Attendance policy saved', {
        description: 'Student attendance labels follow these thresholds.',
      })
    } else {
      setError(result.error)
      toast.error(result.error ?? 'Attendance settings could not be saved.')
    }
  }

  return (
    <SyncGate>
      <SettingsTab
        icon={CalendarCheck}
        title="Attendance Policy"
        description="Status-label thresholds and late-arrival rules applied across attendance modules."
        action={<SyncChip dirty={dirty} saving={saving} />}
      >
        <FieldGroup label="Status Thresholds (percent)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <Label htmlFor="att-excellent" className="text-xs font-semibold mb-1 block">
                Excellent from (%)
              </Label>
              <Input
                id="att-excellent"
                type="number"
                min={0}
                max={100}
                value={draft.excellent}
                onChange={(e) => set({ excellent: Number(e.target.value) })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Attendance at or above this shows as <strong>Excellent</strong>.
              </p>
            </div>
            <div>
              <Label htmlFor="att-attention" className="text-xs font-semibold mb-1 block">
                Needs Attention below (%)
              </Label>
              <Input
                id="att-attention"
                type="number"
                min={0}
                max={100}
                value={draft.needsAttention}
                onChange={(e) => set({ needsAttention: Number(e.target.value) })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Attendance below this shows as <strong>Needs Attention</strong>; between the two
                shows as <strong>Good</strong>.
              </p>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label="Late Arrival & Notifications">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="text-xs">
              <Label htmlFor="att-late" className="text-xs font-semibold mb-1 block">
                Marked late after (minutes)
              </Label>
              <Input
                id="att-late"
                type="number"
                min={0}
                max={120}
                value={draft.lateAfterMinutes}
                onChange={(e) => set({ lateAfterMinutes: Number(e.target.value) })}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Arrival later than this many minutes past day start counts as late.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
              <Switch
                id="att-notify"
                checked={draft.notifyGuardianOnAbsent}
                onCheckedChange={(v) => set({ notifyGuardianOnAbsent: v })}
                className="mt-0.5"
                aria-label="Notify guardians when a student is absent"
              />
              <div className="min-w-0">
                <Label htmlFor="att-notify" className="text-xs font-semibold cursor-pointer">
                  Notify guardian on absence
                </Label>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  When enabled, absent students trigger a guardian notification from the
                  attendance workflow.
                </p>
              </div>
            </div>
          </div>
        </FieldGroup>

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
            {saving ? 'Saving…' : 'Save Attendance Policy'}
          </Button>
        </div>
      </SettingsTab>
    </SyncGate>
  )
}
