'use client'

/**
 * Wizard Step 2 — Parents & Emergency Contacts.
 * Extracted from the original admission.tsx monolith (Task ID: 21).
 */
import { Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { PhoneInput, EmailInput } from '@/components/shared/smart-inputs'
import {
  useAdmissionFeatureFlags,
} from '../lib/admission-utils'
import type { FormData } from '../constants'
import { StepHeader, Field } from './StepShared'

export function ParentsStep({ data, set, flags: _flags }: { data: FormData; set: <K extends keyof FormData>(k: K, v: FormData[K]) => void; flags: ReturnType<typeof useAdmissionFeatureFlags> }) {
  return (
    <div>
      <StepHeader title="Parents & Emergency Contacts" icon={<Users className="h-5 w-5" />} />
      <div className="space-y-5">
        {/* FATHER DETAILS */}
        <div>
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">FATHER DETAILS</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Father's Name"><Input value={data.fatherName} onChange={(e) => set('fatherName', e.target.value)} placeholder="Enter father's full name" /></Field>
            <Field label="Occupation"><Input value={data.fatherOccupation} onChange={(e) => set('fatherOccupation', e.target.value)} placeholder="Occupation" /></Field>
            <Field label="Mobile Phone"><PhoneInput value={data.fatherPhone} onChange={(v) => set('fatherPhone', v)} /></Field>
            <Field label="Email Address"><EmailInput value={data.fatherEmail} onChange={(v) => set('fatherEmail', v)} /></Field>
          </div>
        </div>

        {/* MOTHER DETAILS */}
        <div className="pt-3 border-t border-border">
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">MOTHER DETAILS</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Mother's Name"><Input value={data.motherName} onChange={(e) => set('motherName', e.target.value)} placeholder="Enter mother's full name" /></Field>
            <Field label="Occupation"><Input value={data.motherOccupation} onChange={(e) => set('motherOccupation', e.target.value)} placeholder="Occupation" /></Field>
            <Field label="Mobile Phone"><PhoneInput value={data.motherPhone} onChange={(v) => set('motherPhone', v)} /></Field>
            <Field label="Email Address"><EmailInput value={data.motherEmail} onChange={(v) => set('motherEmail', v)} /></Field>
          </div>
        </div>

        {/* EMERGENCY CONTACT */}
        <div className="pt-3 border-t border-border">
          <p className="text-xs font-bold text-primary mb-3 uppercase tracking-wider">EMERGENCY CONTACT DETAILS</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <Field label="Emergency Contact Person">
              <Input value={data.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} placeholder="Enter emergency contact name" />
            </Field>
            <Field label="Relationship">
              <Select value={data.emergencyRelation || 'Guardian'} onValueChange={(v) => set('emergencyRelation', v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Father', 'Mother', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Guardian'].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Emergency Phone Number">
              <PhoneInput value={data.emergencyPhone} onChange={(v) => set('emergencyPhone', v)} />
            </Field>
          </div>
        </div>
      </div>
    </div>
  )
}
