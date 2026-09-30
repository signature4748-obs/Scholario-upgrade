'use client'

import { useRef } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import { useSchoolProfile } from '@/lib/school-profile'
import { printIsolated } from '@/lib/print-isolate'
import type { AdmissionApplication } from '@/lib/store/admission-store'

interface WelcomeLetterTabProps {
  app: AdmissionApplication
}

/**
 * COMMUNICATION — orientation letter to the parents. Real school identity,
 * real applicant data; the commencement date derives from the academic
 * session (April of the year the session ends).
 */
export function WelcomeLetterTab({ app }: WelcomeLetterTabProps) {
  const school = useSchoolProfile()
  const sheetRef = useRef<HTMLDivElement>(null)
  const formData = app.formData

  // Session "2025–2026" → class commencement April 2026.
  const sessionEndYear = (app.academicSession || '').match(/(\d{4})\s*[–—-]\s*(\d{4})/)?.[2]
  const commencementYear = sessionEndYear || String(new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0))

  return (
    <GlassCard ref={sheetRef} className="p-6 max-w-2xl mx-auto space-y-4 border text-xs leading-relaxed print:shadow-none">
      <div className="border-b pb-3">
        <h3 className="font-bold text-base text-foreground">Welcome to {school.name}</h3>
        <p className="text-muted-foreground">{app.academicSession} · Class {formData.className} — Section {formData.section}</p>
      </div>

      <p>Dear {formData.fatherName} & {formData.motherName},</p>
      <p>
        It gives us immense joy to welcome <strong>{formData.firstName} {formData.lastName}</strong> into our school family for the <strong>{app.academicSession}</strong> academic session in <strong>Class {formData.className} — Section {formData.section}</strong>.
      </p>

      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
        <li><strong>Class Commencement:</strong> 1st April {commencementYear} at 08:00 AM.</li>
        <li><strong>Uniform & Bookstore Collection:</strong> Book counter open Monday to Saturday (9:00 AM – 2:00 PM).</li>
        <li><strong>Transport Bus Route:</strong> {formData.transportRequired ? formData.transportRoute : 'Self Conveyance'}.</li>
      </ul>

      <div className="pt-4 flex justify-end print:hidden">
        <Button size="sm" variant="outline" onClick={() => printIsolated(sheetRef.current)} className="text-xs">
          <Printer className="h-3.5 w-3.5 mr-1" />
          Print Welcome Letter
        </Button>
      </div>
    </GlassCard>
  )
}
