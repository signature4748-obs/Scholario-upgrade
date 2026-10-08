export interface Qualification {
  degree: string
  specialization: string
  institution: string
  year: string
  score: string
}

export interface TeacherDocument {
  id: string
  title: string
  category: 'ID Proof' | 'Qualification' | 'Experience' | 'Appointment' | 'Other'
  fileName: string
  uploadDate: string
  status: 'Verified' | 'Pending'
}

export interface PositionAssignment {
  id: string
  positionId: string
  positionTitle: string
  classAssigned?: string
  assignedDate: string
  assignedBy: string
  status: 'Active' | 'Pending Acceptance' | 'Rejected' | 'Pending Removal'
  rejectionReason?: string
  clarificationRequest?: string
  effectiveDate: string
  isEmergencyOverride?: boolean
  overrideReason?: string
}

export interface PositionDefinition {
  id: string
  title: string
  category: 'Academic' | 'Administrative' | 'Co-Curricular' | 'Management' | 'Custom'
  description: string
  isCustom?: boolean
  permissions: string[]
}

export interface AppointmentLetterData {
  id: string
  officialLetterNo: string
  generatedDate: string
  teacherName: string
  employeeId: string
  designation: string
  department: string
  joiningDate: string
  monthlySalary: number
  annualSalary: number
  workingHours: string
  probationMonths: number
  noticePeriodDays: number
  termsAndConditions: string[]
  principalName: string
  schoolSealAttached: boolean
  reportingAuthority: string
  /** Teacher's postal address, snapshotted when the letter was issued —
   *  an issued document never re-renders from mutable profile data. */
  teacherAddress: string
}

/** A stored media record (photo / signature) for a teacher — the file
 *  lives server-side (db/uploads/teachers, magic-byte validated) and is
 *  served from /api/teachers/upload/<fileId>. The base64 `dataUrl` is a
 *  TRANSIENT in-session preview copy (wizard form state) and is never
 *  persisted — the server file is the canonical media (W2.3B). */
export interface TeacherMediaRecord {
  fileId: string
  fileName: string
  uploadedAt: string
  dataUrl?: string
}

export interface AuditLogItem {
  id: string
  timestamp: string
  category: 'Teacher Created' | 'Appointment Letter' | 'Subject Assigned' | 'Position Assigned' | 'Position Action' | 'Emergency Override' | 'Salary Updated' | 'Credentials Reset'
  actorName: string
  actorRole: string
  targetTeacherId: string
  targetTeacherName: string
  details: string
  isEmergencyOverride?: boolean
}

export interface TeacherRecord {
  id: string
  /** Server link — the Teacher row's USER id. Class.classTeacherId and
   *  ClassSubjectAssignment.teacherUserId store the teacher's USER id,
   *  so class-data lookups match `id` OR `serverUserId`. Present ONLY on
   *  server-hydrated records (server-sync.ts) — never fabricated. */
  serverUserId?: string
  employeeId: string
  teacherId: string
  name: string
  avatar: string
  gender: 'Male' | 'Female' | 'Other'
  dob: string
  bloodGroup: string
  aadhaarNo: string
  nationality: string
  religion: string
  category: string
  passportPhotoUrl?: string

  // Contact & Address
  email: string
  phone: string
  emergencyContact: {
    name: string
    relation: string
    phone: string
  }
  currentAddress: string
  permAddress: string
  sameAddress: boolean
  district: string
  state: string
  pincode: string

  // Qualifications & Experience
  educationalQualifications: Qualification[]
  professionalQualifications: string[]
  totalExperience: number // years
  keyAchievements?: string
  previousEmployment: {
    organization: string
    designation: string
    lastSalary: number
    duration: string
  }

  // Joining & Department
  joiningDate: string
  employmentType: 'Full Time' | 'Part Time' | 'Probation' | 'Contract' | 'Guest'
  department: string
  designation: string
  status: 'Active' | 'On Leave' | 'Suspended' | 'Probation' | 'Relieved'
  attendance: number // %

  // Salary
  salary: number // Gross Monthly
  salaryBreakdown: {
    basic: number
    hra: number
    da: number
    specialAllowance: number
    pfDeduction: number
    netPay: number
  }
  bankDetails: {
    bankName: string
    accountNo: string
    ifscCode: string
    branchName: string
  }

  // Allocations
  subjects: string[]
  classes: string[]
  examResponsibilities: string[]

  // Positions & Permissions
  positions: PositionAssignment[]

  // Documents & Appointment
  documents: TeacherDocument[]
  /** Current (latest) issued appointment letter — immutable snapshot. */
  appointmentLetter?: AppointmentLetterData
  /** Earlier issued appointment letters, oldest first. Issued documents
   *  are historical records: issuing a new letter archives, never
   *  overwrites, the previous one. */
  letterArchive?: AppointmentLetterData[]

  // Photo & signature — stored media records (server-validated uploads)
  photo?: TeacherMediaRecord
  signature?: TeacherMediaRecord

  // Login & Credentials
  isLocked?: boolean
  loginCredentials: {
    username: string
    /** Always empty on the client — a real temp credential is issued
     *  server-side (POST /api/teachers, PATCH reset-credential) and
     *  surfaced ONCE in the slip dialog; it is never persisted here. */
    tempPassword: string
    passwordResetRequired: boolean
    createdDate: string
    lastLogin?: string
  }

  remarks?: string
}

/** Server-hydration status for the canonical faculty roster (Phase 7).
 *  'idle' until the first principal-session sync starts; 'error' means the
 *  GET /api/teachers sync failed and the store keeps whatever it already
 *  has — seed data is NEVER re-injected. */
export type TeachersSyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

export interface TeachersStoreState {
  teachers: TeacherRecord[]
  positionsList: PositionDefinition[]
  auditLogs: AuditLogItem[]
  /** Canonical roster sync lineage (not persisted — per-session truth). */
  syncStatus: TeachersSyncStatus

  // Principal Actions
  addTeacher: (teacher: TeacherRecord) => void
  updateTeacher: (id: string, updates: Partial<TeacherRecord>) => void
  /** Creates a canonical school-position definition; returns it (so the
   *  calling UI can immediately preselect it in the assign flow). */
  addCustomPosition: (position: Omit<PositionDefinition, 'id'>) => PositionDefinition
  assignPositionToTeacher: (teacherId: string, positionId: string, assignedBy?: string, classAssigned?: string, effectiveDate?: string) => void
  removePositionFromTeacher: (teacherId: string, assignmentId: string, reason?: string) => void
  assignSubjectsAndClasses: (teacherId: string, subjects: string[], classes: string[], examResp?: string[]) => void
  regenerateAppointmentLetter: (teacherId: string, customTerms?: string[], newSalary?: number) => void
  /** Issue a NEW appointment letter (archives the previous one). */
  issueAppointmentLetter: (teacherId: string, customTerms?: string[], newSalary?: number) => AppointmentLetterData | null
  /** Replace the stored photo/signature media record for a teacher. */
  setTeacherMedia: (teacherId: string, kind: 'photo' | 'signature', media: TeacherMediaRecord | null) => void
  terminateTeacher: (teacherId: string, reason: string, lockLogin: boolean) => void

  // Teacher Actions (Approval Workflow)
  acceptPosition: (teacherId: string, assignmentId: string) => void
  rejectPosition: (teacherId: string, assignmentId: string, reason: string) => void
  requestPositionClarification: (teacherId: string, assignmentId: string, query: string) => void

  // Logging Helper
  logAudit: (log: Omit<AuditLogItem, 'id' | 'timestamp'>) => void
}
