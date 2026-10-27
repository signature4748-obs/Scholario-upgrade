'use client'

import { useSchoolProfile } from '@/lib/school-profile'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { getCollectedDocuments, resolveDocumentPolicy } from '../admission/lib/documents'
import { BLANK_FORM_VERSION } from '../admission/lib/blank-form-model'

/** Standard Indian admission category checkboxes (blank form furniture,
 * not school data — the applicant ticks one). */
const ADMISSION_CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS']
const GENDERS = ['Male', 'Female', 'Other']
const TC_OPTIONS = ['Yes (enclosed)', 'No (to follow)', 'Not applicable']

/** One labelled ruled blank. Required fields print a trailing asterisk;
 * optional fields print bare — "(Required)"/"(Optional)" never appear. */
function Line({
  label,
  required,
  hint,
  prefill,
  className = '',
  lineClass = '',
}: {
  label: string
  required?: boolean
  hint?: string
  prefill?: string
  className?: string
  lineClass?: string
}) {
  return (
    <div className={`flex items-end gap-[1.6mm] h-[4.6mm] ${className}`}>
      <span className="font-bold text-[6.9pt] leading-none whitespace-nowrap text-slate-900">
        {label}
        {required && <span className="text-slate-900">*</span>}
      </span>
      <div className={`flex-1 border-b border-slate-500 h-[3.8mm] text-[6.9pt] text-slate-500 flex items-end pb-[0.3mm] ${lineClass}`}>
        {hint && <span className="italic text-slate-400 text-[5.8pt]">{hint}</span>}
        {prefill && <span className="text-slate-500">{prefill}</span>}
      </div>
    </div>
  )
}

function CheckRow({
  label,
  options,
  required,
  className = '',
}: {
  label: string
  options: string[]
  required?: boolean
  className?: string
}) {
  return (
    <div className={`flex items-end gap-[1.6mm] h-[4.6mm] ${className}`}>
      <span className="font-bold text-[6.9pt] leading-none whitespace-nowrap text-slate-900">
        {label}
        {required && <span className="text-slate-900">*</span>}
      </span>
      <div className="flex items-center gap-[2.6mm] h-[3.8mm]">
        {options.map((opt) => (
          <span key={opt} className="flex items-center gap-[1.1mm] text-[6.8pt] text-slate-800 whitespace-nowrap">
            <span className="inline-block h-[2.9mm] w-[2.9mm] border-[0.25mm] border-slate-600 shrink-0" />
            {opt}
          </span>
        ))}
      </div>
    </div>
  )
}

function SectionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-100 border-l-[1.2mm] border-slate-900 px-[2.6mm] h-[5mm] flex items-center font-bold text-[7.4pt] uppercase tracking-wide text-slate-800">
      {children}
    </div>
  )
}

/**
 * The COMPLETE admission application form on ONE A4 portrait page
 * (AF-2026.2 one-page contract — mirrors lib/blank-form-pdf.ts exactly:
 * same sections A–F, same asterisk convention, single-sheet footer with
 * no page numbering). Used by both the on-screen preview and the Print
 * action; @page rules in ApplicationFormPrintStyles keep the printed
 * output to exactly one sheet.
 */
export function ApplicationFormPage({ academicSession }: { academicSession: string }) {
  const school = useSchoolProfile()
  const documentPolicy = useSchoolSettingsStore((s) => s.admissionSettings.documentPolicy)
  // The printed Aadhaar row appears ONLY when this school's policy collects
  // it — the form never implies a universal legal requirement (it is
  // optional, so it prints with NO asterisk and no qualifier).
  const aadhaarCollected = resolveDocumentPolicy(documentPolicy).aadhaar !== 'not-collected'
  // The checklist mirrors the school's configurable document policy —
  // 'not-collected' documents are omitted, required ones carry the asterisk.
  const collectedDocuments = getCollectedDocuments(documentPolicy)

  return (
    <div className="space-y-[1.4mm] text-slate-900">
      {/* ── Letterhead ─────────────────────────────────────────────── */}
      <div className="border-b-[0.55mm] border-slate-900 pb-[1.6mm] flex items-start justify-between gap-[3mm]">
        <div className="flex items-start gap-[2.6mm] min-w-0">
          <div className="h-[15mm] w-[15mm] shrink-0 border border-slate-500 rounded-sm flex items-center justify-center overflow-hidden bg-slate-50">
            {school.logoUrl ? (
              <img src={school.logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="italic text-[5.5pt] text-slate-400">School Logo</span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-[11pt] font-extrabold uppercase tracking-tight leading-[1.08] text-slate-900">
              {school.name}
            </h1>
            {school.affiliation && (
              <p className="text-[6.4pt] text-slate-600 leading-[1.25]">{school.affiliation}</p>
            )}
            {(school.address || school.phone || school.email) && (
              <p className="text-[6.4pt] text-slate-600 leading-[1.25] truncate">
                {[
                  school.address && school.city ? `${school.address}, ${school.city}` : school.address,
                  school.phone ? `Phone: ${school.phone}` : null,
                  school.email,
                  school.website?.replace(/^https?:\/\//, ''),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Passport photo box */}
        <div className="h-[24mm] w-[20mm] shrink-0 border border-dashed border-slate-400 bg-slate-50 flex flex-col items-center justify-center text-center text-[5.5pt] font-semibold text-slate-500 leading-[1.35]">
          <span>AFFIX RECENT</span>
          <span>PASSPORT-SIZE</span>
          <span>PHOTOGRAPH</span>
          <span className="italic font-normal text-[5pt] text-slate-400">(Self-attested)</span>
        </div>
      </div>

      {/* ── Form title banner + office blanks ──────────────────────── */}
      <div className="bg-slate-900 text-white text-center h-[6.2mm] flex items-center justify-center rounded-[0.8mm]">
        <span className="font-bold tracking-wider uppercase text-[8.5pt]">
          ADMISSION APPLICATION FORM{academicSession !== '—' ? ` — ACADEMIC SESSION ${academicSession}` : ''}
        </span>
      </div>
      <div className="flex items-center justify-between text-[7pt] font-bold h-[5mm]">
        <span>
          Form No: ADM-{academicSession !== '—' ? academicSession.slice(0, 4) : '____'} / ____________
        </span>
        <span>Date: ________ / ________ / ____________</span>
      </div>

      {/* ── SECTION A — STUDENT DETAILS ────────────────────────────── */}
      <SectionBar>SECTION A — STUDENT DETAILS</SectionBar>
      <div className="grid grid-cols-2 gap-x-[4mm]">
        <Line label="First Name" required />
        <Line label="Last Name" required />
        <Line label="Date of Birth" required hint="dd / mm / yyyy" />
        <Line label="Blood Group" />
        <CheckRow label="Gender" options={GENDERS} />
        <Line label="Religion" />
        <Line label="Nationality" prefill="Indian" />
        <Line label="Class Applying For" required />
        <Line label="Preferred Section" />
        {aadhaarCollected && <Line label="Aadhaar Number" lineClass="font-mono" />}
      </div>
      <CheckRow label="Category" options={ADMISSION_CATEGORIES} />

      {/* ── SECTION B — PARENT / GUARDIAN DETAILS ──────────────────── */}
      <SectionBar>SECTION B — PARENT / GUARDIAN DETAILS</SectionBar>
      <div className="grid grid-cols-2 gap-x-[4mm]">
        <Line label="Father's Name" required />
        <Line label="Father's Occupation" />
        <Line label="Father's Mobile" required lineClass="font-mono" />
        <Line label="Father's Email" />
        <Line label="Mother's Name" />
        <Line label="Mother's Occupation" />
        <Line label="Mother's Mobile" lineClass="font-mono" />
        <Line label="Mother's Email" />
      </div>
      <div className="grid grid-cols-3 gap-x-[4mm]">
        <Line label="Emergency Contact Name" />
        <Line label="Relationship" />
        <Line label="Emergency Phone" lineClass="font-mono" />
      </div>

      {/* ── SECTION C — ADDRESS & PREVIOUS ACADEMIC RECORD ─────────── */}
      <SectionBar>SECTION C — ADDRESS &amp; PREVIOUS ACADEMIC RECORD</SectionBar>
      <Line label="Current Address" required className="!h-auto" />
      <Line label="Permanent Address" className="!h-auto" />
      <div className="grid grid-cols-2 gap-x-[4mm]">
        <Line label="City / Town" />
        <Line label="District" />
        <Line label="State" />
        <Line label="Pincode" lineClass="font-mono" />
      </div>
      <Line label="Previous School Name" className="!h-auto" />
      <div className="grid grid-cols-2 gap-x-[4mm]">
        <Line label="Last Class Passed" />
        <Line label="Previous Academic Year" />
        <Line label="Previous Board" />
        <Line label="Previous Marks" />
      </div>
      <CheckRow label="Transfer Certificate" options={TC_OPTIONS} />

      {/* ── SECTION D — FACILITIES & MEDICAL DETAILS ───────────────── */}
      <SectionBar>SECTION D — FACILITIES &amp; MEDICAL DETAILS</SectionBar>
      <div className="grid grid-cols-2 gap-x-[4mm]">
        <CheckRow label="School Transport Facility" options={['Yes', 'No']} />
        <Line label="Transport Route / Landmark" />
        <CheckRow label="School Hostel Facility" options={['Yes', 'No']} />
        <Line label="Allergies" />
        <Line label="Family Doctor" />
        <Line label="Doctor Phone" lineClass="font-mono" />
      </div>
      <Line label="Medical Conditions" className="!h-auto" />

      {/* ── SECTION E — DOCUMENT CHECKLIST ─────────────────────────── */}
      <SectionBar>SECTION E — DOCUMENT CHECKLIST</SectionBar>
      {collectedDocuments.length === 0 ? (
        <p className="text-[6.5pt] text-slate-500">
          No documents are collected under this school&rsquo;s current admission settings.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-x-[4mm]">
          {collectedDocuments.map((doc) => (
            <div key={doc.key} className="flex items-center gap-[1.4mm] h-[4.6mm]">
              <span className="inline-block h-[2.9mm] w-[2.9mm] border-[0.25mm] border-slate-600 shrink-0" />
              <span className="text-[6.8pt] text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {doc.name}
                {doc.required && <span className="text-slate-900">*</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── SECTION F — DECLARATION & SIGNATURES ───────────────────── */}
      <SectionBar>SECTION F — DECLARATION &amp; SIGNATURES</SectionBar>
      <p className="text-[6.6pt] text-slate-800 leading-[1.45] text-justify">
        I/We declare that the information furnished in this form is true and complete to the best
        of my/our knowledge and belief. I/We understand that submission of this form does not by
        itself guarantee admission; admission is subject to verification of documents and
        availability of seats, and the decision of <strong>{school.name}</strong> shall be final.
        I/We agree to abide by the rules, discipline and fee regulations of{' '}
        <strong>{school.name}</strong>.
      </p>
      <div className="grid grid-cols-2 gap-x-[6mm] w-3/4">
        <Line label="Place:" />
        <Line label="Date:" />
      </div>
      <div className="grid grid-cols-3 gap-x-[4mm] pt-[3mm]">
        <div className="border-t-[0.3mm] border-slate-900 pt-[0.8mm] text-center">
          <span className="font-bold text-[6.3pt] block text-slate-900">Signature of Parent / Guardian</span>
          <span className="italic text-[5.6pt] text-slate-500">(with date)</span>
        </div>
        <div className="border-t-[0.3mm] border-slate-900 pt-[0.8mm] text-center">
          <span className="font-bold text-[6.3pt] block text-slate-900">Verified by (Admission Office)</span>
          <span className="italic text-[5.6pt] text-slate-500">Documents checked &amp; verified</span>
        </div>
        <div className="border-t-[0.3mm] border-slate-900 pt-[0.8mm] text-center">
          <span className="font-bold text-[6.3pt] block text-slate-900">Principal</span>
          <span className="italic text-[5.6pt] text-slate-500">{school.principal || '(Signature & school seal)'}</span>
        </div>
      </div>

      {/* Office-use block — mirrors blank-form-pdf.ts exactly: row 1 is the
          three ruled office blanks (Application No. | Date Received |
          Verified by) on one grid, row 2 is the Principal Decision
          checkboxes. Two distinct rows — nothing overlaps. */}
      <div className="relative border-[0.3mm] border-slate-600 px-[2mm] pt-[4.6mm] pb-[1.2mm] mt-[1mm]">
        <span className="absolute top-[0.8mm] left-[2mm] bg-slate-100 px-[1.6mm] py-[0.4mm] font-bold text-[6pt] text-slate-800">
          OFFICE USE ONLY
        </span>
        <div className="grid grid-cols-3 gap-x-[4mm]">
          <Line label="Application No.:" className="!h-[4.6mm]" />
          <Line label="Date Received:" className="!h-[4.6mm]" />
          <Line label="Verified by:" className="!h-[4.6mm]" />
        </div>
        <div className="flex items-center gap-[1.6mm] h-[4.6mm] mt-[0.8mm]">
          <span className="font-bold text-[6.9pt] whitespace-nowrap">Principal Decision:</span>
          <div className="flex items-center gap-[3mm]">
            {['Granted', 'Deferred', 'Rejected'].map((opt) => (
              <span key={opt} className="flex items-center gap-[1mm] text-[6.8pt] text-slate-800">
                <span className="inline-block h-[2.9mm] w-[2.9mm] border-[0.25mm] border-slate-600" />
                {opt}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Single-page footer — form version only, NO page numbering */}
      <div className="border-t-[0.2mm] border-slate-300 pt-[1mm] flex items-center justify-between text-[6pt] text-slate-500">
        <span>{school.name} · Admission Application Form</span>
        <span>Form version {BLANK_FORM_VERSION}</span>
      </div>
    </div>
  )
}
