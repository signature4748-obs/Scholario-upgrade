import type { AdmissionFormData } from '@/components/principal/modules/admission/types'
import type { FeeDataState } from '@/components/principal/modules/FeeStructureStep'

export type AdmissionStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Need Correction'
  | 'Resubmitted'
  | 'Approved'
  | 'Rejected'
  | 'Completed'
  | 'Archived'

export type SectionKey =
  | 'personal'
  | 'parents'
  | 'address'
  | 'previousSchool'
  | 'medical'
  | 'classAllocation'
  | 'fees'
  | 'documents'
  | 'photo'

export interface SectionReviewState {
  status: 'Complete' | 'Incomplete' | 'Needs Review'
  remarks: string
  reviewedBy?: string
  reviewedAt?: string
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  action: string
  actor: string
  notes: string
}

export interface AdmissionApplication {
  id: string
  admissionNo: string
  studentId: string
  rollNo: string
  regNo: string
  applicantName: string
  className: string
  section: string
  academicSession: string
  submittedDate: string
  lastUpdatedDate: string
  status: AdmissionStatus
  formData: AdmissionFormData
  feeData: FeeDataState
  sectionReviews: Record<SectionKey, SectionReviewState>
  generalRemarks?: string
  decisionReason?: string
  decisionBy?: string
  decisionDate?: string
  rejectionRetentionDays?: number
  rejectedAt?: string
  auditTrail: AuditLogEntry[]
  /**
   * FINAL-GATE honesty: completion claims nothing that did not happen.
   * `generatedCredentials` (fabricated loginId/tempPassword/portalUrl)
   * is RETIRED — portal accounts are provisioned by the real Students &
   * Classes enrolment flow (which surfaces a one-time password once).
   */
  notificationsSent?: {
    sms: boolean
    email: boolean
    whatsapp: boolean
    dispatchedAt?: string
  }
}

export interface AdmissionStoreState {
  applications: AdmissionApplication[]
  selectedApplicationId: string | null

  selectApplication: (id: string | null) => void
  createOrUpdateDraft: (
    formData: Partial<AdmissionFormData>,
    feeData?: Partial<FeeDataState>,
    appId?: string
  ) => string
  submitApplication: (id: string) => void
  updateSectionReview: (
    appId: string,
    sectionKey: SectionKey,
    reviewState: Partial<SectionReviewState>
  ) => void
  approveApplication: (appId: string, remarks?: string) => void
  requestCorrection: (appId: string, generalRemarks: string) => void
  rejectApplication: (appId: string, reason: string, retentionDays?: number) => void
  restoreRejectedApplication: (appId: string) => void
  /**
   * PHASE 7-H (admissions honesty): completion is a RECORDER for a REAL
   * server enrollment. The issuance workspace first POSTs the applicant's
   * collected data to /api/students; on success it calls this action with
   * the SERVER-issued student id + admission number so the local record
   * references the real student. No roster insertion, no fabricated
   * credentials, no placeholder contact data happens here.
   */
  completeAdmission: (
    appId: string,
    issuanceDetails?: {
      /** Server Student row id from POST /api/students (the real record). */
      studentId?: string
      /** Server admission number from POST /api/students (ADM-…). */
      admissionNo?: string
      rollNo?: string
      regNo?: string
    }
  ) => AdmissionApplication | null
  deleteArchivedApplication: (appId: string) => void
}

// Re-export the imported types so existing type-only imports through this
// module keep working if other files re-route through us.
export type { AdmissionFormData, FeeDataState }
