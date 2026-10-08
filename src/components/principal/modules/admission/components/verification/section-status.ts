/**
 * Section status derivation for the Verification workspace.
 *
 * Statuses are COMPUTED from the application's actual data (spec §36) —
 * never defaulted to "Complete". The officer's stored review overrides
 * (Needs Review / Incomplete + issue note) take precedence over the
 * derived status; "Complete" in the store means "no officer flag".
 */

import type {
  AdmissionApplication,
  SectionKey,
  SectionReviewState,
} from '@/lib/store/admission-store'
import type { AdmissionDocumentPolicy } from '@/lib/store/school-settings-store'
import {
  getDocumentCompletion,
  getRequiredDocuments,
  getCollectedDocuments,
} from '../../lib/documents'

export type DerivedSectionStatus = 'Verified' | 'Needs Review' | 'Incomplete'

export interface SectionStatus {
  status: DerivedSectionStatus
  /** Concrete, actionable issue line — shown when not Verified. */
  issue?: string
  /** True when an officer flag (not data) caused this status. */
  flaggedByOfficer: boolean
}

/** Mask an Aadhaar number for display: XXXX XXXX 3847 (spec §23). */
export function maskAadhaar(aadhaar?: string | null): string {
  if (!aadhaar) return '—'
  const digits = aadhaar.replace(/\D/g, '')
  if (digits.length < 4) return `XXXX XXXX ${digits}`
  return `XXXX XXXX ${digits.slice(-4)}`
}

/** Compute the DATA-derived status for one section (no officer input). */
export function deriveSectionStatus(
  key: SectionKey,
  app: AdmissionApplication,
  policy?: AdmissionDocumentPolicy
): SectionStatus {
  const formData = app.formData

  if (key === 'documents') {
    const collected = getCollectedDocuments(policy)
    // A school that collects no documents trivially passes this section.
    if (collected.length === 0) return { status: 'Verified', flaggedByOfficer: false }
    const completion = getDocumentCompletion(formData.docStatuses, policy)
    if (completion.complete) return { status: 'Verified', flaggedByOfficer: false }
    const isOnFile = (k: string) => {
      const s = formData.docStatuses[k]?.status
      return s === 'received' || s === 'uploaded'
    }
    const missing = getRequiredDocuments(policy)
      .filter((d) => !isOnFile(d.key))
      .map((d) => d.name)
    return {
      status: 'Incomplete',
      issue: `Missing ${missing.join(', ')}`,
      flaggedByOfficer: false,
    }
  }

  if (key === 'photo') {
    // A photo is on file when either a digital copy exists (photoDataUrl,
    // from the wizard's crop pipeline) or the record's photoUploaded flag is
    // set (photo collected offline / on paper).
    if (!formData.photoDataUrl && !formData.photoUploaded) {
      return {
        status: 'Incomplete',
        issue: 'Photo not uploaded',
        flaggedByOfficer: false,
      }
    }
    return { status: 'Verified', flaggedByOfficer: false }
  }

  return { status: 'Verified', flaggedByOfficer: false }
}

/**
 * Resolve the FINAL status for a section: the officer's flag (stored in
 * sectionReviews) overrides the derived status, with their issue note.
 */
export function resolveSectionStatus(
  key: SectionKey,
  app: AdmissionApplication,
  policy?: AdmissionDocumentPolicy
): SectionStatus {
  const derived = deriveSectionStatus(key, app, policy)
  const review: SectionReviewState | undefined = app.sectionReviews?.[key]

  if (review && (review.status === 'Needs Review' || review.status === 'Incomplete')) {
    return {
      status: review.status,
      issue: review.remarks?.trim() || derived.issue,
      flaggedByOfficer: true,
    }
  }
  return derived
}

/** Count of sections with no issues or flags. */
export function countVerified(
  sections: { key: SectionKey }[],
  app: AdmissionApplication,
  policy?: AdmissionDocumentPolicy
): { verified: number; total: number; incomplete: number; flagged: number } {
  let verified = 0
  let incomplete = 0
  let flagged = 0
  for (const s of sections) {
    const st = resolveSectionStatus(s.key, app, policy)
    if (st.status === 'Verified') verified++
    else if (st.status === 'Incomplete') incomplete++
    else flagged++
  }
  return { verified, total: sections.length, incomplete, flagged }
}

/* ------------------------------------------------------------------ */
/*  One-line section summaries (collapsed row) — real data only.       */
/* ------------------------------------------------------------------ */

const emDash = (v: string | undefined | null): string => (v && v.trim() ? v.trim() : '—')

export function getSectionSummary(
  key: SectionKey,
  app: AdmissionApplication,
  policy?: AdmissionDocumentPolicy
): string {
  const f = app.formData
  switch (key) {
    case 'personal': {
      const parts = [`${f.firstName} ${f.lastName}`.trim()]
      if (f.dob) parts.push(`DOB ${f.dob}`)
      if (f.gender) parts.push(f.gender)
      if (f.category) parts.push(f.category)
      return parts.filter(Boolean).join(' · ')
    }
    case 'parents': {
      const parts: string[] = []
      if (f.fatherName) parts.push(`Father ${f.fatherName}`)
      if (f.motherName) parts.push(`Mother ${f.motherName}`)
      if (f.emergencyName) parts.push('Emergency contact on file')
      return parts.length ? parts.join(' · ') : '—'
    }
    case 'address': {
      const bits = [f.district, f.state].filter(Boolean).join(', ')
      return bits ? `${bits}${f.pincode ? ` – ${f.pincode}` : ''}` : '—'
    }
    case 'previousSchool': {
      if (f.admissionType === 'fresh' && !f.previousSchool) return 'Fresh admission'
      return f.previousSchool
        ? `${f.previousSchool}${f.previousBoard ? ` (${f.previousBoard})` : ''}`
        : '—'
    }
    case 'medical': {
      if (f.allergies) return `Allergies: ${f.allergies}`
      if (f.conditions) return `Conditions: ${f.conditions}`
      return 'No allergies or conditions recorded'
    }
    case 'classAllocation':
      return f.className
        ? `Class ${f.className}${f.section ? ` – ${f.section}` : ''}`
        : '—'
    case 'fees': {
      const fee = app.feeData
      const concession =
        fee?.discountCode && fee.discountCode !== 'NONE'
          ? fee.discountCode === 'CUSTOM'
            ? 'Custom waiver'
            : 'Concession applied'
          : 'No concession'
      return `${concession}${fee?.transportSelected ? ' · Transport' : ''}${fee?.hostelSelected ? ' · Hostel' : ''}`
    }
    case 'documents': {
      const collected = getCollectedDocuments(policy)
      if (collected.length === 0) return 'No documents collected'
      const c = getDocumentCompletion(f.docStatuses, policy)
      return `Required ${c.requiredCompleted}/${c.requiredTotal} · Optional ${c.optionalReceived}/${c.optionalTotal}`
    }
    case 'photo':
      return f.photoDataUrl || f.photoUploaded
        ? 'Passport photo on file'
        : 'No photo uploaded'
    default:
      return emDash(null)
  }
}

/** Document list with per-doc status + actions metadata (spec §21).
 *
 * PHASE 7-H: there is no server-stored file behind a document — the
 * `received` flag records the office's physical collection (legacy
 * 'uploaded' records count too), and fileName is display-only history. */
export interface VerificationDocRow {
  key: string
  name: string
  required: boolean
  received: boolean
  fileName?: string
  verified: boolean
}

export function getDocumentRows(
  app: AdmissionApplication,
  policy?: AdmissionDocumentPolicy
): VerificationDocRow[] {
  const statuses = app.formData.docStatuses || {}
  return getCollectedDocuments(policy).map((d) => {
    const st = statuses[d.key]
    const received = st?.status === 'received' || st?.status === 'uploaded'
    return {
      key: d.key,
      name: d.name,
      required: d.required,
      received,
      fileName: st?.fileName,
      verified: st?.verificationStatus === 'verified',
    }
  })
}
