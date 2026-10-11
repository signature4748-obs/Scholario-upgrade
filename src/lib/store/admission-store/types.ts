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
   * FEE-ADMISSIONS MVP — the SERVER-issued workflow link. Set when the
   * application was submitted through the flag-gated server flow
   * (POST /api/admissions/applications). While present, review decisions,
   * enrolment and official documents go through the server-owned
   * endpoints (decision / enrol / fee-snapshot). Absent → the legacy
   * client-only workflow runs unchanged.
   */
  serverApplicationId?: string
  /** Mirror of the server status machine (SUBMITTED/UNDER_REVIEW/…). */
  serverStatus?: string
  /** Server Class id resolved for the application (class FK on the server row). */
  serverClassId?: string | null
  /**
   * Server-issued fee selections + quote captured at submission (the
   * published-structure line items the principal selected).
   */
  serverFeeSelections?: {
    optionalHeadIds?: string[]
    quantities?: Record<string, number>
    discountCode?: string
  }
  /** The persisted AdmissionFeeSnapshot (fetched for official documents). */
  serverFeeSnapshot?: {
    totalAmount: number
    discountAmount: number
    discountName: string | null
    academicYear: string
    lineItems: {
      headId: string
      name: string
      category: string
      kind: string
      quantity: number
      unitAmount: number
      amount: number
      discounted: boolean
      discountCode?: string
    }[]
    issuedAt: string
  }
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
  /** FEE-ADMISSIONS MVP (Phase F) — server-workflow link actions. Run
   * only AFTER the corresponding server call succeeded. */
  linkServerApplication: (
    appId: string,
    info: {
      serverApplicationId: string
      serverStatus?: string
      serverClassId?: string | null
      serverFeeSelections?: {
        optionalHeadIds?: string[]
        quantities?: Record<string, number>
        discountCode?: string
      }
    }
  ) => void
  /** Mirror an accepted server transition onto the local record. */
  applyServerStatus: (appId: string, serverStatus: string) => void
  /** Persist the server-issued immutable fee snapshot locally. */
  attachServerFeeSnapshot: (
    appId: string,
    snapshot: {
      totalAmount: number
      discountAmount: number
      discountName: string | null
      academicYear?: string
      lineItems: {
        headId: string
        name: string
        category: string
        kind: string
        quantity: number
        unitAmount: number
        amount: number
        discounted: boolean
        discountCode?: string
      }[]
      issuedAt?: string
    }
  ) => void
}

// Re-export the imported types so existing type-only imports through this
// module keep working if other files re-route through us.
export type { AdmissionFormData, FeeDataState }
