'use client'

/**
 * Full detail content for one verification section — rendered only when
 * the officer expands the section (View). REAL application data only:
 * no invented fallbacks, no fake OCR metrics, no compliance claims.
 * Aadhaar numbers are masked (XXXX XXXX 3847) per the privacy policy.
 */
import { ExternalLink, Download } from 'lucide-react'
import { useSignedFileUrl } from '@/lib/secure-media'
import type { AdmissionApplication } from '@/lib/store/admission-store'
import type { SectionKey } from '@/lib/store/admission-store'
import type { AdmissionDocumentPolicy } from '@/lib/store/school-settings-store'
import { maskAadhaar, getDocumentRows } from './section-status'

interface SectionDataContentProps {
  sectionKey: SectionKey
  app: AdmissionApplication
  documentPolicy?: AdmissionDocumentPolicy
}

/**
 * Phase 1 — View/Download links for a stored admission document resolve
 * through a short-lived signed URL (no anonymous file reads). The links
 * appear once the grant resolves; the fileId is unguessable otherwise.
 */
function SignedDocLinks({ fileId }: { fileId: string }) {
  const viewUrl = useSignedFileUrl(fileId, 'admissions', false)
  const downloadUrl = useSignedFileUrl(fileId, 'admissions', true)
  if (!viewUrl && !downloadUrl) return null
  return (
    <span className="flex items-center gap-1 shrink-0">
      {viewUrl && (
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium"
        >
          <ExternalLink className="h-3 w-3" /> View
        </a>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium"
        >
          <Download className="h-3 w-3" /> Download
        </a>
      )}
    </span>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wide">
        {label}
      </span>
      <span className="text-foreground text-xs font-medium break-words">{value}</span>
    </div>
  )
}

const orDash = (v?: string | null) => (v && v.trim() ? v : '—')

export function SectionDataContent({ sectionKey, app, documentPolicy }: SectionDataContentProps) {
  const formData = app.formData

  if (sectionKey === 'personal') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Name" value={`${formData.firstName} ${formData.lastName}`} />
        <Field label="Date of Birth" value={orDash(formData.dob)} />
        <Field label="Gender" value={orDash(formData.gender)} />
        <Field label="Aadhaar" value={maskAadhaar(formData.aadhaarNo)} />
        <Field label="Social Category" value={orDash(formData.category)} />
        <Field label="Blood Group" value={orDash(formData.bloodGroup)} />
        <Field label="Religion" value={orDash(formData.religion)} />
        <Field label="Nationality" value={orDash(formData.nationality)} />
      </div>
    )
  }

  if (sectionKey === 'parents') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Father"
          value={`${orDash(formData.fatherName)}${formData.fatherOccupation ? ` · ${formData.fatherOccupation}` : ''}`}
        />
        <Field label="Father Contact" value={orDash(formData.fatherPhone)} />
        <Field
          label="Mother"
          value={`${orDash(formData.motherName)}${formData.motherOccupation ? ` · ${formData.motherOccupation}` : ''}`}
        />
        <Field label="Mother Contact" value={orDash(formData.motherPhone)} />
        <Field label="Father Aadhaar" value={maskAadhaar(formData.fatherAadhaar)} />
        <Field label="Mother Aadhaar" value={maskAadhaar(formData.motherAadhaar)} />
        <Field
          label="Emergency Contact"
          value={
            formData.emergencyName
              ? `${formData.emergencyName}${formData.emergencyRelation ? ` (${formData.emergencyRelation})` : ''} · ${orDash(formData.emergencyPhone)}`
              : '—'
          }
        />
      </div>
    )
  }

  if (sectionKey === 'address') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Current Address"
          value={orDash(
            [formData.currentAddress, formData.district, formData.state].filter(Boolean).join(', ')
          )}
        />
        <Field
          label="State / PIN"
          value={orDash([formData.state, formData.pincode].filter(Boolean).join(' – '))}
        />
        <Field
          label="Permanent Address"
          value={formData.sameAsCurrentAddress ? 'Same as current address' : orDash(formData.permAddress)}
        />
      </div>
    )
  }

  if (sectionKey === 'previousSchool') {
    const isFresh = formData.admissionType === 'fresh' && !formData.previousSchool
    if (isFresh) {
      return (
        <p className="text-xs text-muted-foreground">
          Fresh admission — no previous school record required.
        </p>
      )
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Previous School" value={orDash(formData.previousSchool)} />
        <Field label="Board" value={orDash(formData.previousBoard)} />
        <Field label="Year" value={orDash(formData.previousYear)} />
        <Field label="TC Status" value={orDash(formData.tcStatus)} />
        <Field label="TC Number" value={orDash(formData.tcNumber)} />
        <Field label="Reason for Leaving" value={orDash(formData.reasonForLeaving)} />
      </div>
    )
  }

  if (sectionKey === 'medical') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Allergies" value={orDash(formData.allergies)} />
        <Field label="Conditions" value={orDash(formData.conditions)} />
        <Field label="Special Needs" value={orDash(formData.specialNeeds)} />
        <Field label="Height / Weight" value={orDash([formData.heightCm, formData.weightKg].filter(Boolean).join(' / '))} />
        <Field label="Family Doctor" value={orDash(formData.doctorName)} />
        <Field label="Doctor Contact" value={orDash(formData.doctorPhone)} />
      </div>
    )
  }

  if (sectionKey === 'classAllocation') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Class & Section" value={`Class ${formData.className} – ${formData.section}`} />
        <Field label="Stream" value={orDash(formData.stream)} />
        <Field label="Admission Type" value={orDash(formData.admissionType)} />
      </div>
    )
  }

  if (sectionKey === 'fees') {
    const fee = app.feeData
    const concession =
      fee?.discountCode && fee.discountCode !== 'NONE'
        ? fee.discountCode === 'CUSTOM'
          ? `Custom waiver${fee.customDiscountValue ? ` (₹${fee.customDiscountValue.toLocaleString('en-IN')})` : ''}`
          : fee.discountCode
        : 'None'
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Concession" value={concession} />
        <Field label="Transport" value={fee?.transportSelected ? 'Selected' : 'Not selected'} />
        <Field label="Hostel" value={fee?.hostelSelected ? 'Selected' : 'Not selected'} />
      </div>
    )
  }

  if (sectionKey === 'documents') {
    const rows = getDocumentRows(app, documentPolicy)
    return (
      <div className="space-y-1.5">
        {rows.map((d) => (
          <div
            key={d.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-card px-3 py-2"
          >
            <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">
              {d.name}
            </span>
            <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground shrink-0">
              {d.required ? 'Required' : 'Optional'}
            </span>
            <span
              className={
                'text-[11px] font-semibold shrink-0 ' +
                (d.verified
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : d.uploaded
                    ? 'text-foreground'
                    : d.required
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-muted-foreground')
              }
            >
              {d.verified ? '✓ Verified' : d.uploaded ? 'Uploaded' : d.required ? '✕ Missing' : 'Not uploaded'}
            </span>
            {d.fileId && <SignedDocLinks fileId={d.fileId} />}
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1">
          Replace an upload from the application form (Documents step).
        </p>
      </div>
    )
  }

  if (sectionKey === 'photo') {
    const photoOnFile = !!formData.photoDataUrl || !!formData.photoUploaded
    return (
      <div className="flex items-center gap-4">
        {formData.photoDataUrl ? (
          <img
            src={formData.photoDataUrl}
            alt={`${formData.firstName} ${formData.lastName} passport photo`}
            className="h-24 w-20 rounded-md border border-border object-cover"
          />
        ) : (
          <div className="h-24 w-20 rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">
            {photoOnFile ? 'On file' : 'No photo'}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {formData.photoDataUrl
            ? 'Uploaded passport photo on the application record.'
            : photoOnFile
              ? 'Photo on file — no digital copy attached to this record.'
              : 'No photo uploaded with this application.'}
        </p>
      </div>
    )
  }

  return null
}
