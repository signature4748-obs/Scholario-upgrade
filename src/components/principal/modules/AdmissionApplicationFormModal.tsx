'use client'

import { motion } from 'framer-motion'
import { getSchoolSettings } from '@/lib/school-settings'
import { useSchoolProfile } from '@/lib/school-profile'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { ApplicationFormPrintStyles } from './AdmissionApplicationFormModal/PrintStyles'
import { ModalTopBar } from './AdmissionApplicationFormModal/ModalTopBar'
import { ApplicationFormPage1 } from './AdmissionApplicationFormModal/Page1'
import { ApplicationFormPage2 } from './AdmissionApplicationFormModal/Page2'
import type { AdmissionApplicationFormModalProps } from './AdmissionApplicationFormModal/types'

export function AdmissionApplicationFormModal({ open, onClose }: AdmissionApplicationFormModalProps) {
  useDismissOnEscape(onClose, open)
  // Form session — the canonical identity cascade (server academic year
  // first), then the admissions engine's configured session; a school
  // with neither prints an honest em-dash, never a stale year.
  const profile = useSchoolProfile()
  if (!open) return null

  const schoolSettings = getSchoolSettings()
  const academicSession = profile.academicYear || schoolSettings.defaultAcademicSession || '—'

  const handlePrint = () => {
    window.print()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admission application form"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:z-auto"
    >
      {/* Print Specific CSS to isolate A4 pages during browser print */}
      <ApplicationFormPrintStyles />

      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-4xl rounded-2xl border border-border bg-background p-4 sm:p-6 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto no-scrollbar print:max-h-none print:overflow-visible print:p-0 print:border-none print:shadow-none print:bg-white print:max-w-none"
      >
        {/* Modal Top Control Bar (Hidden on Print) */}
        <ModalTopBar onPrint={handlePrint} onClose={onClose} />

        {/* ====================================================================== */}
        {/* A4 PRINTABLE FORM CONTAINER (PAGE 1 & PAGE 2)                           */}
        {/* ====================================================================== */}
        <div
          id="a4-application-form"
          className="bg-white text-slate-900 p-6 sm:p-10 rounded-xl border border-slate-300 shadow-sm space-y-8 font-sans text-xs max-w-[210mm] mx-auto print:border-none print:shadow-none print:p-0 print:w-full print:max-w-none"
        >
          {/* ==================== PAGE 1 ==================== */}
          <ApplicationFormPage1 academicSession={academicSession} />

          {/* PAGE BREAK FOR PRINTING */}
          <div className="page-break my-8 border-b-2 border-dashed border-slate-300 no-print" />

          {/* ==================== PAGE 2 ==================== */}
          <ApplicationFormPage2 academicSession={academicSession} />
        </div>
      </motion.div>
    </div>
  )
}
