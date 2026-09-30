'use client'

import { useRef } from 'react'
import { toast } from 'sonner'
import { useSchoolProfile } from '@/lib/school-profile'
import { downloadHTMLFile, safeFileName } from '@/lib/download-file'
// Print isolation — the letter sheet prints ALONE (no app shell).
import { printIsolated } from '@/lib/print-isolate'
import { TopActionBar } from './OfficialAdmissionLetter/TopActionBar'
import { Watermark, SchoolHeader } from './OfficialAdmissionLetter/SchoolHeader'
import { StudentProfileGrid } from './OfficialAdmissionLetter/StudentProfileGrid'
import { FeeBreakdownTable } from './OfficialAdmissionLetter/FeeBreakdownTable'
import { DigitalVerification, StatutoryDeclaration, Signatures } from './OfficialAdmissionLetter/DigitalVerification'
import { buildAdmissionLetterHTML } from './OfficialAdmissionLetter/letter-html'
import type { OfficialAdmissionLetterProps as Props } from './OfficialAdmissionLetter/types'

export type { AdmissionLetterData } from './OfficialAdmissionLetter/types'

export function OfficialAdmissionLetter({ data, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const profile = useSchoolProfile()

  const handlePrint = () => {
    // Prints ONLY the letter sheet — the app shell never leaks onto the
    // page (clone-to-#print-root isolation, see lib/print-isolate.ts).
    printIsolated(printRef.current)
  }

  const fullName = `${data.student.firstName} ${data.student.lastName}`

  // QA-FIX-A: REAL download — a standalone branded HTML letter mirroring
  // the preview (letterhead from school profile, student profile grid, fee
  // summary, verification block, statutory declaration, signatures).
  const handleDownloadPdf = () => {
    try {
      const html = buildAdmissionLetterHTML(data, profile)
      const filename = safeFileName(`admission-letter-${fullName}`, 'html')
      downloadHTMLFile(html, filename)
      toast.success('Admission Letter downloaded', {
        description: filename,
      })
    } catch {
      toast.error('Unable to generate letter', {
        description: 'Please try again.',
      })
    }
  }

  // Signatory follows the identity cascade; a school that never recorded
  // a principal signs as the neutral role, never a demo person.
  const principalName = profile.principal || 'Principal'

  return (
    <div className="space-y-6">
      {/* Top Action Bar (hidden on print) */}
      <TopActionBar
        admissionNo={data.admissionNo}
        onPrint={handlePrint}
        onDownloadPdf={handleDownloadPdf}
        onClose={onClose}
      />

      {/* Printable Institutional Document Box */}
      <div
        ref={printRef}
        className="bg-white text-slate-900 p-8 sm:p-12 rounded-2xl shadow-xl border border-slate-200 relative overflow-hidden font-sans print:shadow-none print:border-none print:p-0 print:m-0"
      >
        {/* Subtle Diagonal Watermark */}
        <Watermark />

        {/* School Header */}
        <SchoolHeader data={data} />

        {/* Student Profile Overview Grid */}
        <StudentProfileGrid data={data} fullName={fullName} />

        {/* Section: Official Fee Summary */}
        <FeeBreakdownTable data={data} />

        {/* Digital Verification reference & seal */}
        <DigitalVerification data={data} />

        {/* Statutory Declaration */}
        <StatutoryDeclaration data={data} />

        {/* Official Signatures Area */}
        <Signatures data={data} principalName={principalName} />
      </div>
    </div>
  )
}
