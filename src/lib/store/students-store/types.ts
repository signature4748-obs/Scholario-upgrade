// Type definitions for the students store.
//
// All entity types (StudentRecord, ClassRecord, House, etc.) and the
// `StudentsState` store contract live here so they can be imported
// independently of the store implementation.

export type StudentStatus = 'Active' | 'Archived'
export type FeeStatus = 'Paid' | 'Partial' | 'Pending'
export type Gender = 'Male' | 'Female'

export interface TimelineEvent {
  id: string
  type: 'admission' | 'promotion' | 'transfer' | 'fee' | 'house' | 'archive' | 'restore' | 'position'
  title: string
  description: string
  date: string
  by: string
}

// ============================================================
// STUDENT POSITIONS — Class Captain / Monitor responsibility model
// (see src/lib/student-positions.ts for the capability vocabulary).
// A position is a scoped, persisted assignment: the student remains a
// normal Student; capabilities derive from the ACTIVE position record.
// ============================================================

export type StudentPositionKey =
  | 'class-captain'
  | 'class-vice-captain'
  | 'class-monitor'
  | 'sports-captain'
  | 'eco-monitor'
  | 'library-monitor'

export interface StudentPosition {
  /** Stable id (POS-1, POS-2 …). */
  id: string
  /** Canonical student id (STU-x) — the holder. */
  studentId: string
  /** Holder display name at assignment time (snapshot for history rows). */
  studentName: string
  /** Academic session this position belongs to ('2026-2027' hyphen id —
   *  the shared convention from @/lib/academic-session / fee-store). A
   *  position is only authoritative in ITS session: filterActivePositions
   *  resolves activity per (studentId · sessionId). */
  sessionId: string
  /** Class + section the position is scoped to (derived from the student). */
  classId: string
  className: string
  section: string
  /** Position vocabulary key (titles/capabilities resolve from it). */
  key: StudentPositionKey
  /** Who assigned it (teacher id or 'PRINCIPAL'). */
  assignedById: string
  assignedByName: string
  assignedOn: string
  /** Active flag — ending a position flips this; history is preserved. */
  active: boolean
  endedOn?: string
  endedByName?: string
  notes?: string
}

export interface StudentRecord {
  id: string
  admissionNo: string
  rollNo: string
  name: string
  avatar: string
  gender: Gender
  classId: string
  className: string
  section: string
  dob: string
  bloodGroup: string
  category: string
  fatherName: string
  motherName: string
  guardianPhone: string
  guardianEmail: string
  guardianName: string
  city: string
  state: string
  hostel: boolean
  disciplinePoints: number
  address: string
  admissionDate: string
  previousSchool: string
  status: StudentStatus
  archiveReason?: string
  archiveDate?: string
  attendance: number
  feeStatus: FeeStatus
  feePaid: number
  feeTotal: number
  transport: boolean
  scholarship: number
  houseId?: string
  houseName?: string
  medical: string
  academics: {
    overallGrade: string
    overallPercent: number
    rankInClass: number
    subjects: { name: string; grade: string; percent: number; teacher: string }[]
  }
  attendanceTrend: { month: string; percent: number }[]
  achievements: { title: string; date: string; level: string }[]
  disciplineRecords: { date: string; type: string; description: string; points: number }[]
  documents: { id: string; title: string; type: string; uploadedDate: string; verified: boolean }[]
  transportRoute?: string
  timeline: TimelineEvent[]
  /** Server-sync link (canonical DB universe): login email of the student
   * account. Present when the record was hydrated from /api/students/roster. */
  email?: string
  /** Server-sync link: User.id of the student account (canonical id). */
  userId?: string
}

export interface SectionRecord {
  id: string
  name: string
  classId: string
  capacity: number
  classTeacherId?: string
  /** Section-level Assistant Class Teacher (real persisted assignment). */
  assistantTeacherId?: string
  room: string
}

/** Archived subject within a class — preserved for restore (Spec §7 / §25). */
export interface ArchivedSubject {
  /** Canonical subject id (stable across renames). */
  id: string
  /** Display name at archive time (snapshot — rename does NOT update this). */
  name: string
  archivedAt: string
}

export interface ClassRecord {
  id: string
  name: string
  grade: number
  level: 'Pre-Primary' | 'Primary' | 'Middle' | 'Secondary' | 'Senior Secondary'
  sections: SectionRecord[]
  capacity: number
  classTeacherId: string
  /** Class-level Assistant Class Teacher (real persisted assignment). */
  assistantTeacherId?: string
  /**
   * Canonical subject ids (Spec §28 — IDs are stable across renames).
   * The Students & Classes UI hydrates display names from the store's
   * `academicSubjects` registry. This is the source of truth consumed
   * by Examination.
   */
  subjectIds: string[]
  /**
   * Subject display names (legacy / convenience). Derived from
   * `subjectIds` + the `academicSubjects` registry. Mutations to
   * subjects should go through `subjectIds`, NOT this array. We keep
   * it for backward-compat with components that still read names.
   */
  subjects: string[]
  /** Subjects archived from this class — preserved for restore. */
  archivedSubjects: ArchivedSubject[]
  /** Per-subject teacher assignment map (subject id → teacher ID). */
  subjectTeachers: Record<string, string>
  /** Stream key — only set for Class 11/12 (e.g. 'PCM' / 'PCB'). */
  stream?: import('@/lib/mock/academic').StreamKey | null
  room: string
  status: 'Active' | 'Archived'
}

export interface House {
  id: string
  name: string
  color: string
  motto: string
  captainId?: string
  viceCaptainId?: string
  points: number
  competitionWins: number
}

export interface PromotionRecord {
  id: string
  studentId: string
  studentName: string
  fromClass: string
  toClass: string
  academicYear: string
  feeCleared: boolean
  resultCleared: boolean
  attendanceCleared: boolean
  status: 'Pending' | 'Approved' | 'Completed' | 'Rejected'
  date: string
  requestedBy: string
}

export interface TransferRecord {
  id: string
  studentId: string
  studentName: string
  type: 'Section Change' | 'Class Change' | 'School Transfer' | 'Graduation' | 'Archive'
  fromClass: string
  toClass: string
  reason: string
  status: 'Pending' | 'Completed'
  date: string
}

export interface StudentsState {
  students: StudentRecord[]
  classes: ClassRecord[]
  houses: House[]
  promotions: PromotionRecord[]
  transfers: TransferRecord[]
  /** Class Captain / Monitor assignments (spec §21–§25) — the persisted
   *  permission source of truth for scoped student responsibilities. */
  studentPositions: StudentPosition[]
  /**
   * Canonical subject registry (Spec §28). Each entry has a stable id and
   * a display name that may be renamed. Both Students & Classes UI and
   * Examination hydrate subject names by looking up ids in this list.
   */
  academicSubjects: import('@/lib/mock/academic').SubjectDef[]
  /** DEMO-TIER seeder (PIH-4c/R8) — applies the STU-xxx demo corpus only
   * for the sanctioned demo tenant (module root, pristine-guarded). */
  ensureDemoSeed: () => void
  archiveStudent: (id: string, reason: string, by: string) => void
  restoreStudent: (id: string, by: string) => void
  transferStudent: (id: string, type: TransferRecord['type'], toClass: string, reason: string, by: string) => void
  assignHouse: (id: string, houseId: string, by: string) => void
  updateRollNumber: (id: string, roll: string, by: string) => void
  createPromotion: (ids: string[], from: string, to: string, year: string, by: string) => void
  approvePromotion: (id: string, by: string) => void
  executePromotion: (id: string, by: string) => void
  addHousePoints: (id: string, pts: number) => void
  assignHouseCaptain: (id: string, sid: string, role: 'captain' | 'vice') => void
  /** Assign a scoped student position (Class Captain/Monitor …). Validates the
   *  student is Active; one active holder per (class · section · position). */
  assignStudentPosition: (input: {
    studentId: string
    key: StudentPositionKey
    assignedById: string
    assignedByName: string
    notes?: string
  }) => { ok: true; record: StudentPosition } | { ok: false; error: string }
  /** End an active position (history preserved; capabilities disappear). */
  endStudentPosition: (
    positionId: string,
    byName: string,
  ) => { ok: true } | { ok: false; error: string }
  /** Replace the class-level Class Teacher. Pass null/undefined to clear. */
  updateClassTeacher: (classId: string, teacherId: string | null) => void
  /** Replace the class-level Assistant Class Teacher. Pass null/undefined to clear. */
  updateClassAssistantTeacher: (classId: string, teacherId: string | null) => void
  /** Replace a section's Class Teacher. Pass null/undefined to clear. */
  updateSectionTeacher: (classId: string, sectionId: string, teacherId: string | null) => void
  /** Replace a section's Assistant Class Teacher. Pass null/undefined to clear. */
  updateSectionAssistantTeacher: (classId: string, sectionId: string, teacherId: string | null) => void
  /** §5 room registry — assign a section's room (registry room name; null clears). */
  updateSectionRoom: (classId: string, sectionId: string, room: string | null) => void
  /** §5 room registry — rename a room across every class/section using it. */
  renameRoomEverywhere: (from: string, to: string) => void
  /**
   * Add an EXISTING canonical subject to a class (Spec §8). No-op if the
   * class already has the subject id. Does NOT create a new canonical
   * subject — use `createCustomSubject` for that.
   */
  addClassSubject: (classId: string, subjectId: string) => void
  /**
   * Archive a subject from a class — moves it to archivedSubjects for
   * recovery (Spec §7 / §25). Archived subjects do NOT appear in
   * Examination's class picker.
   */
  archiveClassSubject: (classId: string, subjectId: string) => void
  /** Restore a previously-archived subject — moves it back to active. */
  restoreClassSubject: (classId: string, subjectId: string) => void
  /** Permanently delete an archived subject (no recovery). */
  deleteArchivedSubject: (classId: string, subjectId: string) => void
  /** Assign / replace a teacher for a specific subject in a class (by id). */
  updateSubjectTeacher: (classId: string, subjectId: string, teacherId: string | null) => void
  /**
   * Rename a canonical subject (Spec §9). Updates the display name in the
   * `academicSubjects` registry — every consumer (Students & Classes,
   * Examination) instantly sees the new name because they resolve names
   * by id lookup. Id stays stable.
   */
  renameSubject: (subjectId: string, newName: string) => void
  /**
   * Create a NEW custom canonical subject and add it to a class (Spec §8).
   * Generates a stable id from the name. If a subject with the same name
   * already exists, returns its id instead of creating a duplicate.
   */
  createCustomSubject: (classId: string, name: string) => string
  /**
   * Look up a subject by id from the canonical registry.
   * Returns undefined if not found or archived.
   */
  getSubjectById: (subjectId: string) => import('@/lib/mock/academic').SubjectDef | undefined
  getStudentById: (id: string) => StudentRecord | undefined
  getClassById: (id: string) => ClassRecord | undefined
  getClassStudents: (classId: string) => StudentRecord[]
  /**
   * Create a new class (Add Class page). Derives id/grade/level from the
   * name, builds sections with capacities/rooms, and assigns optional
   * class/assistant teachers. Returns the created ClassRecord.
   */
  createClass: (input: {
    name: string
    sections: { name: string; capacity: number; room: string }[]
    capacity: number
    room: string
    classTeacherId?: string
    assistantTeacherId?: string
  }) => ClassRecord
  /**
   * Enrol a NEW student into the roster (used by the Admissions →
   * Complete & Enrol workflow). Auto-assigns admission no, roll no,
   * house and class-level academics. Returns the created StudentRecord.
   */
  addStudent: (input: {
    name: string
    dob: string
    gender: 'Male' | 'Female'
    classId: string
    section?: string
    fatherName: string
    motherName: string
    guardianPhone: string
    guardianEmail?: string
    address?: string
    category?: string
    bloodGroup?: string
    previousSchool?: string
    admissionDate?: string
  }) => StudentRecord
}
