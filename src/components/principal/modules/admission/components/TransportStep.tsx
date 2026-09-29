'use client'

/**
 * Wizard Step 6 — Transport & Hostel Facilities.
 * Extracted from the original admission.tsx monolith (Task ID: 21).
 */
import { Bus } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { getSchoolSettings } from '@/lib/school-settings'
import {
  useAdmissionFeatureFlags,
} from '../lib/admission-utils'
import type { FormData } from '../constants'
import { StepHeader, Field } from './StepShared'

export function TransportStep({ data, set, flags: _flags }: { data: FormData; set: <K extends keyof FormData>(k: K, v: FormData[K]) => void; flags: ReturnType<typeof useAdmissionFeatureFlags> }) {
  const schoolSettings = getSchoolSettings()
  const allowHostel = schoolSettings.allowHostel

  return (
    <div>
      <StepHeader
        title={allowHostel ? 'Transport & Hostel' : 'Transport'}
        icon={<Bus className="h-5 w-5" />}
      />
      <div className="space-y-4">
        <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-foreground">School Bus Transport Facility</p>
            <p className="text-[11px] text-muted-foreground">Opt in for daily door-step pickup & drop transport</p>
          </div>
          <Checkbox
            checked={data.transportRequired}
            onCheckedChange={(c) => set('transportRequired', !!c)}
          />
        </div>

        {data.transportRequired && (
          <Field label="Transport Route Selection">
            <Select value={data.transportRoute} onValueChange={(v) => set('transportRoute', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Route 1 — Sector 15 → School">Route 1 — Sector 15 → School</SelectItem>
                <SelectItem value="Route 3 — City Center → School">Route 3 — City Center → School</SelectItem>
                <SelectItem value="Route 7 — Sector 62 → School">Route 7 — Sector 62 → School</SelectItem>
                <SelectItem value="Route 12 — Vaishali → School">Route 12 — Vaishali → School</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {allowHostel && (
          <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-foreground">Hostel & Boarding Accommodation</p>
              <p className="text-[11px] text-muted-foreground">Opt in for campus residential hostel facility</p>
            </div>
            <Checkbox
              checked={data.hostelRequired}
              onCheckedChange={(c) => set('hostelRequired', !!c)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
