export interface ClassConfig {
  id: string
  name: string
  sections: string[]
  stream?: string
}

export interface SubjectConfig {
  id: string
  name: string
  code: string
  category: 'Core' | 'Elective' | 'Vocational' | 'Activity'
  color: string
}

export interface BookItem {
  id: string
  classId: string
  className: string
  bookName: string
  publisher: string
  category: string
  price: number
  stock: number
  isMandatory: boolean
}

export interface UniformItem {
  id: string
  name: string
  category: 'Summer' | 'Winter' | 'Sports' | 'Formal'
  price: number
  sizes: string[]
  stock: number
}

/**
 * FINANCIAL CLASSIFICATION (Core vs Additional vs Examination).
 *
 * Every master catalogue head carries a coarse financial `kind` so the
 * system can distinguish three financially different concepts:
 *
 *   CORE        — Regular school fees that belong in a class's standard
 *                 annual fee structure (Tuition, Transport, Library…).
 *   EXAMINATION — Per-examination charges tied to exam definitions in the
 *                 Examination module (fee heads of this kind are hints for
 *                 the per-exam schedule, not ad-hoc charges).
 *   ADDITIONAL  — TEMPLATES for event-based / special collections
 *                 (Educational Tour, Workshop, Competition…). A catalogue
 *                 template does NOT mean every student owes it — the
 *                 Principal creates an actual Additional Charge event
 *                 (fee-store.additionalCharges) when the tour occurs.
 *
 * Optional for backward compatibility: pre-v3 persisted entries have no
 * `kind`; consumers must derive it via `deriveFeeHeadKind()` (Exam-type
 * heads → EXAMINATION, everything else → CORE).
 */
export type FeeHeadKind = 'CORE' | 'EXAMINATION' | 'ADDITIONAL'

/** Derive the financial kind for any FeeHeadConfig (persisted or new). */
export function deriveFeeHeadKind(h: { kind?: FeeHeadKind; type: string }): FeeHeadKind {
  if (h.kind) return h.kind
  return h.type === 'Exam' ? 'EXAMINATION' : 'CORE'
}

export interface FeeHeadConfig {
  id: string
  name: string
  type: 'Tuition' | 'Admission' | 'Annual' | 'Transport' | 'Lab' | 'Library' | 'Exam' | 'Activity' | 'Board' | 'Other'
  /** Financial classification — see FeeHeadKind above. */
  kind?: FeeHeadKind
  defaultAmount: number
  /**
   * Billing frequency (SaaS-STAGE-2A §4). 'Per-Exam' marks the EXAMINATION
   * template heads whose amounts are charged per conducted examination
   * instance (mapped onto the structure's ExamFeeSchedule, never ×12).
   * 'Term'/'Per Term' are legacy synonyms retained for old persisted data.
   */
  frequency: 'Monthly' | 'Quarterly' | 'Term' | 'Annual' | 'One-Time' | 'Half-Yearly' | 'Per Term' | 'Per-Exam'
  /**
   * SaaS-STAGE-2A §6 — applicability template. `false` marks OPTIONAL
   * heads (Books, Uniform…): catalogue defaults a structure MAY include,
   * never auto-payable for every student. Default true (mandatory).
   */
  mandatory?: boolean
  /** When true, this head no longer appears in the "pick from catalogue"
   *  picker for new fee structures. Existing structures keep their
   *  snapshot (versioning integrity). Default false. */
  archived?: boolean
  /** Free-form note shown in the picker ("Computer Lab maintenance + internet"). */
  description?: string
  /** When true, GST applies on this head; default false (most school fees are GST-exempt). */
  isTaxable?: boolean
  /** GST rate (%) when isTaxable — default 18. */
  taxRate?: number
  /** Optional HSN/SAC code for invoices. */
  gstHsnCode?: string
  /** When this default amount became effective (ISO date). */
  effectiveFrom?: string
}

export interface DiscountConfig {
  id: string
  name: string
  type: 'Percentage' | 'Fixed'
  value: number
  code: string
}

export interface PayGradeConfig {
  id: string
  grade: string
  title: string
  basePay: number
  hra: number
  da: number
  pfDeduction: number
}

export interface TransportRouteConfig {
  id: string
  name: string
  fare: number
  vehicleNo: string
  driverName: string
  driverPhone: string
  stopsCount: number
}

export interface HouseConfig {
  id: string
  name: string
  color: string
  captain?: string
  viceCaptain?: string
}

/**
 * RESULTS / GRADING CONFIGURATION — the school-configured academic
 * behaviour behind the Student "My Results" module. THE source of
 * truth for the grading scale, result-privacy visibility and the
 * official report-card composition (Student Results §11/§15/§16/§20):
 *
 *   gradeScale   — ordered bands (desc). Student UI grades derive
 *                  from THIS scale — never hardcoded thresholds.
 *   showRank     — may the student see their own class rank?
 *   showClassTop — may the student see the Class Top 5 list?
 *                  (minimal fields only: rank, name, percentage)
 *   showComparison — may the student compare current vs previous
 *                  assessment (personal progress, not competition)?
 *   reportCard   — which optional blocks print on the official
 *                  document (attendance summary, principal remark,
 *                  seal/signature note).
 */
export interface ResultsGradeBand {
  /** Minimum percentage for the band (inclusive). */
  threshold: number
  grade: string
}

export interface ResultsSettings {
  gradeScale: ResultsGradeBand[]
  showRank: boolean
  showClassTop: boolean
  showComparison: boolean
  reportCard: {
    includeAttendance: boolean
    includePrincipalRemark: boolean
    includeSealNote: boolean
  }
}

export interface AdmissionFormFieldRule {
  fieldKey: string
  label: string
  section: string
  visible: boolean
  required: boolean
}

/* ------------------------------------------------------------------ */
/*  Admission document policy — SCHOOL-CONFIGURABLE (Wave 2.3 §1).     */
/*  'required'       → applicant must provide it before submission     */
/*  'optional'       → submission allowed without it                   */
/*  'not-collected'  → hidden from the digital admission workflow      */
/*  Keyed by the canonical document key in admission/lib/documents.    */
/* ------------------------------------------------------------------ */
export type AdmissionDocRequirement = 'required' | 'optional' | 'not-collected'
export type AdmissionDocumentPolicy = Record<string, AdmissionDocRequirement>

// Admission feature flags — single source of truth for wizard conditional rendering
export interface AdmissionFeatureFlags {
  enableMedical: boolean
  enableHostel: boolean
  enableTransport: boolean
  enablePreviousSchool: boolean
  enableScholarship: boolean
  enableFeeWaiver: boolean
  enableDocumentVerification: boolean
  enableAadhaar: boolean
  enableBloodGroup: boolean
  enableReligion: boolean
  enableCategory: boolean
  enableStudentPhoto: boolean
  // Classes for which previous school is auto-skipped on Fresh Admission
  previousSchoolSkipClasses: string[]
  // Board options if school follows multiple boards
  boards: string[]
}

// Per-class seat capacity & waitlist threshold
export interface ClassSeatConfig {
  className: string
  capacity: number
  enrolled: number
  waitlistThreshold: number
}

// Duplicate detection configuration
export interface DuplicateDetectionConfig {
  enabled: boolean
  blockThreshold: number       // 99-100 → block
  warnThreshold: number        // 70-95 → warn
  checkKeys: {
    aadhaar: boolean
    nameDob: boolean
    parentPhone: boolean
    parents: boolean
    previousSchool: boolean
    address: boolean
  }
}

// Waiver / concession audit record
export interface WaiverAuditEntry {
  id: string
  appliedBy: string
  appliedByRole: string
  approvalAuthority: string
  approvalDate: string
  reason: string
  amount: number
  timestamp: string
}

/* ──────────────────────────────────────────────────────────────────── */
/*  SERVER CONFIG SLICE (PHASE 7.5)                                     */
/*  The canonical school configuration fetched from                      */
/*  GET /api/school-settings (School columns + settings JSON + module    */
/*  flags). The Identity/Branding tabs draft against it and PATCH back;  */
/*  document consumers (school-profile) read it FIRST so a second        */
/*  tenant never renders Greenwood letterheads. Persisted as a cached    */
/*  snapshot — the once-per-session server-sync refreshes it.            */
/* ──────────────────────────────────────────────────────────────────── */

export interface ServerSchoolIdentity {
  name: string
  shortName: string | null
  tagline: string | null
  affiliation: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  principalName: string | null
  established: string | null
  /** Read-only on the client — set by provisioning. */
  code: string
  board: string
  academicYear: string | null
}

export interface ServerSchoolBranding {
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
}

export type ServerSettingsSyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

export interface ServerSchoolConfigState {
  identity: ServerSchoolIdentity | null
  branding: ServerSchoolBranding | null
  /** Effective module availability (server flags ?? platform defaults). */
  moduleFlags: Record<string, boolean>
  /** Raw settings-JSON slices (timetable, attendance, uniforms, …). */
  settings: Record<string, unknown>
  syncStatus: ServerSettingsSyncStatus
  /** ISO timestamp of the last successful sync (null = never). */
  syncedAt: string | null
}

export interface SchoolSettingsState {
  /** Server-backed configuration snapshot (see server-sync.ts). */
  server: ServerSchoolConfigState

  // General Profile
  general: {
    schoolName: string
    shortName: string
    tagline: string
    affiliation: string
    address: string
    city: string
    phone: string
    email: string
    website: string
    principalName: string
    vicePrincipalName: string
    established: number
    logoText: string
    brandColor: string
    principalSignatureUrl?: string
    officialSealUrl?: string
  }

  // Academics
  academics: {
    currentSession: string
    academicSessions: string[]
    board: string
    curriculum: string
    streams: string[]
    categories: string[]
    classes: ClassConfig[]
    subjects: SubjectConfig[]
    examStructures: { id: string; name: string; weightage: number }[]
    /**
     * School-configured attendance policy thresholds (percent). Student
     * attendance status labels (Excellent / Good / Needs Attention) derive
     * from THIS config — never hardcoded institutional rules.
     */
    attendanceThresholds: { excellent: number; needsAttention: number }
  }

  // Timetable
  timetable: {
    workingDays: string[]
    startTime: string
    endTime: string
    periodDurationMinutes: number
    lunchBreakStart: string
    lunchBreakDurationMinutes: number
    assemblyDurationMinutes: number
    holidayRules: string
  }

  // Fees
  fees: {
    feeHeads: FeeHeadConfig[]
    discounts: DiscountConfig[]
    installmentsCount: number
    lateFeePerDay: number
    paymentRules: string
  }

  // Payroll
  payroll: {
    payGrades: PayGradeConfig[]
    pfRate: number
    esiRate: number
    tdsApplicable: boolean
  }

  // Bookstore
  bookStore: BookItem[]

  // Uniforms
  uniforms: UniformItem[]

  // Transport
  transport: {
    routes: TransportRouteConfig[]
  }

  // Library
  library: {
    categories: string[]
    maxBooksPerStudent: number
    issueDays: number
    lateFinePerDay: number
  }

  // House System
  houses: HouseConfig[]

  // Results / Grading configuration (Student Results module §11/§15/§16/§20)
  results: ResultsSettings

  // Facilities
  facilities: {
    hasHostelFacility: boolean
    hasTransportFacility: boolean
  }

  /**
   * IDENTITY-CARD SYSTEM (Student ID Card §27–28) — the school-level
   * template the Principal/Admin configures; every student's physical
   * ID card renders FROM THIS CONFIG (the student can never redesign the
   * school's card). `theme` drives the card's institutional accent; the
   * field visibility flags decide which particulars print on the card —
   * sensitive fields (DOB / blood group / emergency contact) stay OFF
   * until the school explicitly enables them.
   */
  idCard: {
    /** Institutional card accent — one of the curated school themes. */
    theme: 'violet' | 'sky' | 'emerald' | 'rose' | 'amber'
    /** Print the student's house on the card (only when the student has one). */
    showHouse: boolean
    /** Print the admission number on the card. */
    showAdmissionNo: boolean
    /** Print the date of birth (sensitive — off by default). */
    showDob: boolean
    /** Print the blood group (medical — off by default). */
    showBloodGroup: boolean
    /** Print the session-validity line ("Valid till …"). */
    showValidUntil: boolean
    /** Office line printed on the card reverse/footer (return-if-found note). */
    verificationNote: string
  }

  // Admission Settings
  admissionSettings: {
    showPersonalDataOnLetter: boolean
    showDiscountBreakdown?: boolean
    rejectionRetentionDays: number
    fieldRules: AdmissionFormFieldRule[]
    featureFlags: AdmissionFeatureFlags
    seatCapacity: ClassSeatConfig[]
    duplicateDetection: DuplicateDetectionConfig
    waiverAudit: WaiverAuditEntry[]
    // Document requirement policy — one entry per canonical document key.
    // Missing keys fall back to the registry default (see lib/documents).
    documentPolicy: AdmissionDocumentPolicy
    // Admission defaults — inherited by new applications automatically
    defaultNationality: string
    defaultReligion: string
    schoolState: string
    schoolDistrict: string
    previousBoards: string[]
  }

  // Actions
  updateGeneral: (data: Partial<SchoolSettingsState['general']>) => void
  updateAcademics: (data: Partial<SchoolSettingsState['academics']>) => void
  updateTimetable: (data: Partial<SchoolSettingsState['timetable']>) => void
  updateFees: (data: Partial<SchoolSettingsState['fees']>) => void
  updatePayroll: (data: Partial<SchoolSettingsState['payroll']>) => void
  updateLibrary: (data: Partial<SchoolSettingsState['library']>) => void
  addBook: (book: Omit<BookItem, 'id'>) => void
  removeBook: (id: string) => void
  addUniformItem: (item: Omit<UniformItem, 'id'>) => void
  removeUniformItem: (id: string) => void
  addHouse: (house: Omit<HouseConfig, 'id'>) => void
  updateHouse: (id: string, data: Partial<HouseConfig>) => void
  addFeeHead: (feeHead: Omit<FeeHeadConfig, 'id'>) => void
  updateFeeHead: (id: string, patch: Partial<FeeHeadConfig>) => void
  archiveFeeHead: (id: string) => void
  restoreFeeHead: (id: string) => void
  removeFeeHead: (id: string) => void
  addSubject: (sub: Omit<SubjectConfig, 'id'>) => void
  removeSubject: (id: string) => void
  addClass: (cls: Omit<ClassConfig, 'id'>) => void
  removeClass: (id: string) => void
  updateAdmissionSettings: (data: Partial<SchoolSettingsState['admissionSettings']>) => void
  updateAdmissionFeatureFlags: (data: Partial<AdmissionFeatureFlags>) => void
  updateAdmissionDocumentPolicy: (policy: AdmissionDocumentPolicy) => void
  updateSeatCapacity: (className: string, data: Partial<ClassSeatConfig>) => void
  updateDuplicateDetection: (data: Partial<DuplicateDetectionConfig>) => void
  addWaiverAudit: (entry: Omit<WaiverAuditEntry, 'id' | 'timestamp'>) => void
  updateFacilities: (data: Partial<SchoolSettingsState['facilities']>) => void
  updateIdCard: (data: Partial<SchoolSettingsState['idCard']>) => void
  updateResults: (data: Partial<SchoolSettingsState['results']>) => void
}
