'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { getSchoolSettings } from '@/lib/school-settings'
import { useSchoolProfile } from '@/lib/school-profile'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { downloadBlankAdmissionFormPdf } from './admission/lib/blank-form-download'
import { ApplicationFormPrintStyles } from './AdmissionApplicationFormModal/PrintStyles'
import { ModalTopBar } from './AdmissionApplicationFormModal/ModalTopBar'
import { ApplicationFormPage } from './AdmissionApplicationFormModal/ApplicationFormPage'
import type { AdmissionApplicationFormModalProps } from './AdmissionApplicationFormModal/types'

export function AdmissionApplicationFormModal({ open, onClose }: AdmissionApplicationFormModalProps) {
  useDismissOnEscape(onClose, open)
  const [downloading, setDownloading] = useState(false)
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

  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      const { fileName } = await downloadBlankAdmissionFormPdf()
      toast.success('Blank form PDF downloaded', {
        description: `${fileName} — print A4 copies for distribution; parents fill and return them for scanning.`,
      })
    } catch (err) {
      console.error('Blank form PDF download failed', err)
      toast.error('Could not generate the PDF', {
        description: 'Please try again, or use Print as a fallback.',
      })
    } finally {
      setDownloading(false)
    }
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
        <ModalTopBar
          onPrint={handlePrint}
          onDownload={() => void handleDownloadPdf()}
          downloading={downloading}
          onClose={onClose}
        />

        {/* ====================================================================== */}
        {/* A4 PRINTABLE FORM — the COMPLETE form on ONE A4 portrait sheet (AF-2026.2) */}
        {/* ====================================================================== */}
        <div
          id="a4-application-form"
          className="bg-white text-slate-900 rounded-xl border border-slate-300 shadow-sm font-sans w-[210mm] max-w-full mx-auto px-[9mm] pt-[6mm] pb-[4mm] print:border-none print:shadow-none print:rounded-none print:w-[210mm] print:max-w-none"
        >
          <ApplicationFormPage academicSession={academicSession} />
        </div>
      </motion.div>
    </div>
  )
}
