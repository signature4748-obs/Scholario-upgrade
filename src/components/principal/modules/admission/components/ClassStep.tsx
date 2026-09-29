'use client'

/**
 * Wizard Step 4 — Applying For (Class & Section).
 *
 * Minimal: just Class + Section + seat availability indicator.
 * The academic session is shown in the step subtitle (no separate banner,
 * no "Auto-fetched from school settings" description).
 */
import { useMemo } from 'react'
import { GraduationCap, X, Clock, CheckCircle2 } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { classList } from '@/lib/mock/school'
import {
  useAdmissionFeatureFlags,
  useSeatCapacity,
  getSeatInfo,
} from '../lib/admission-utils'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import type { FormData } from '../constants'
import { StepHeader, Field } from './StepShared'

export function ClassStep({
  data, set, flags: _flags, seatCapacity,
}: {
  data: FormData
  set: <K extends keyof FormData>(k: K, v: FormData[K]) => void
  flags: ReturnType<typeof useAdmissionFeatureFlags>
  seatCapacity: ReturnType<typeof useSeatCapacity>
}) {
  const seatInfo = getSeatInfo(seatCapacity, data.className)
  const waitlisted = seatInfo.waitlisted
  const activeSession = useSchoolSettingsStore.getState().academics.currentSession

  const allClasses = useMemo(() => {
    const fromConfig = seatCapacity.map((c) => c.className)
    const fromList = classList.map((c) => (typeof c === 'string' ? c : c.name))
    return Array.from(new Set([...fromConfig, ...fromList]))
  }, [seatCapacity])

  const handleClassChange = (cls: string) => {
    set('className', cls)
    const info = getSeatInfo(seatCapacity, cls)
    set('waitlisted', info.waitlisted)
  }

  return (
    <div>
      <StepHeader
        title="Applying For"
        subtitle={`Academic Session ${activeSession}`}
        icon={<GraduationCap className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Field label="Applying for Class">
          <Select value={data.className} onValueChange={handleClassChange}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {allClasses.map((name) => {
                const info = getSeatInfo(seatCapacity, name)
                return (
                  <SelectItem key={name} value={name}>
                    {name} {info.status === 'full' ? '(Full)' : info.status === 'waitlist' ? '(Waitlist)' : `(${info.available} seats)`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Section (Optional)">
          <Select value={data.section || 'NONE'} onValueChange={(v) => set('section', v === 'NONE' ? '' : v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="No preference" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">No preference</SelectItem>
              {['A', 'B', 'C', 'D'].map((s) => (
                <SelectItem key={s} value={s}>Section {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Seat availability — provides real value (informs waitlist decision) */}
        {data.className && (
          <div className={cn(
            'sm:col-span-2 rounded-xl border p-3 flex items-center justify-between gap-3',
            seatInfo.status === 'full' ? 'border-rose-500/30 bg-rose-500/5'
              : seatInfo.status === 'waitlist' ? 'border-amber-500/30 bg-amber-500/5'
              : seatInfo.status === 'limited' ? 'border-amber-500/20 bg-amber-500/5'
              : 'border-emerald-500/30 bg-emerald-500/5'
          )}>
            <div className="flex items-center gap-2.5">
              <div className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg',
                seatInfo.status === 'full' ? 'bg-rose-500/15 text-rose-600'
                  : seatInfo.status === 'waitlist' ? 'bg-amber-500/15 text-amber-600'
                  : 'bg-emerald-500/15 text-emerald-600'
              )}>
                {seatInfo.status === 'full' ? <X className="h-4 w-4" /> : seatInfo.status === 'waitlist' ? <Clock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </div>
              <div>
                <p className="text-xs font-semibold">
                  {seatInfo.status === 'full' ? 'Class Full — Waitlist Only'
                    : seatInfo.status === 'waitlist' ? 'Near Capacity — Waitlist'
                    : seatInfo.status === 'limited' ? 'Limited Seats'
                    : 'Seats Available'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {seatInfo.enrolled}/{seatInfo.capacity} enrolled · {seatInfo.available} available · {Math.round(seatInfo.fillRate * 100)}% full
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', seatInfo.status === 'full' ? 'bg-rose-500' : seatInfo.status === 'waitlist' ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.min(100, seatInfo.fillRate * 100)}%` }}
                />
              </div>
              {waitlisted && <Badge variant="outline" className="border-amber-500/40 text-amber-600 text-[10px]">Waitlist</Badge>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
