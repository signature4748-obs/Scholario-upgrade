'use client'

/**
 * Applications & Forms store — the SCHOOL APPLICATION + CONSENT + PAYMENT +
 * APPROVAL + DOCUMENT + RECORD system.
 *
 * SCOPE (TOUR-1 rebuild): the module operates EXACTLY ONE built-in form —
 * the "Educational Tour — Parent Consent Form". There is NO form builder
 * and NO create-form concept: the Principal (or an authorized Teacher,
 * subject to the existing approval workflow) reuses the permanent template
 * for each session/tour, configures the session-specific particulars
 * (destination, dates, fee, circular number…), publishes it, takes it down
 * and manages submissions + payments. The architecture stays generic
 * underneath (any "form + student participation + fee + approval +
 * printable document" workflow) so future Super Admin-controlled templates
 * slot in by registering here — no store surgery.
 *
 * ARCHITECTURE (financial integration — CRITICAL):
 *   Publishing an application with payment Required/Optional creates (or
 *   reuses) ONE Additional Charge in the canonical Fee Management store —
 *   that charge is the ONLY financial obligation, and it is linked both ways:
 *
 *     SchoolApplication.payment.chargeId ──► AdditionalCharge.id
 *     FeeTransaction.applicationId      ──► SchoolApplication.id
 *
 *   Payments are ALWAYS recorded through fee-store.recordPayment() bound to
 *   that additionalChargeId (+ applicationId) — the SAME transaction then
 *   shows up in:
 *     • the Application record          (this store reads txns by app id)
 *     • the student's Fee Account       (charges appear automatically)
 *     • Fee Management → Payments       (Additional Collections, unchanged)
 *     • Transactions ledger             (category = 'ADDITIONAL')
 *     • the receipt                     (genReceiptNo pipeline)
 *   Tour money NEVER touches the student's core yearly fee record (the
 *   charge lives outside the class fee structures). No duplicate financial
 *   entries are ever created. Cash payments enter as 'Under Verification'
 *   and must pass the EXISTING Principal-only cash verification workflow.
 *
 * LIFECYCLE (workflow-driven, not cosmetic):
 *   Draft → Published → [Deadline passes ⇒ auto-Locked] / Closed / Archived
 *   Submission: Submitted → Under Review → Approved | Rejected |
 *               Correction Required (→ resubmit) ; Withdrawn by student.
 *   Approve guard: guardian consent satisfied AND payment complete when the
 *   form requires money. Editing stops once closed/locked/archived.
 *
 * PERMANENT RECORDS: submissions, audit history and printable documents are
 * never destroyed by closing/archiving/locking — archive only hides from the
 * main list; historical records remain readable forever within the academic
 * session they belong to. Every submission preserves an immutable snapshot
 * of the student particulars (identity fields) as they were at submit time.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useFeeStore } from './fee-store'
import type { FeeTransaction } from './fee-store'
import { useStudentsStore } from '@/lib/store/students-store'
import type { AdditionalChargeCategory } from './fee-store'
import { CURRENT_ACADEMIC_YEAR } from './fee-store-data'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
// SaaS-STAGE-2A — TENANT-SCOPED persistence: every school gets its own
// applications namespace (drafts, published tours, submissions, audit).
// Switching tenants reloads the app and re-hydrates from the target
// school's namespace — application data can never leak across schools.
import { migrateLegacyScopedStore, createTenantScopedStorage, TENANT_SCOPED_BASES } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'
import { STALE_APPLICATION_PURGE } from './applications-purge'

// ─── Types ─────────────────────────────────────────────────────────────

/** Rich application categories (broader than AdditionalCharge's coarse set). */
export type ApplicationCategory =
  | 'Tour' | 'Trip' | 'Workshop' | 'Competition' | 'Camp' | 'Event'
  | 'Exam Application' | 'Board Form' | 'Transport' | 'Activity'
  | 'Certificate' | 'Donation' | 'Custom'

/** APPS-IA-1 — the form's PURPOSE, decoupled from its subject category.
 *  A form collects information/consent/registration; the category says what
 *  it is ABOUT (a tour, a workshop…). Templates fix both; free-form builder
 *  entries may pick any combination. */
export type FormPurpose =
  | 'Application' | 'Consent' | 'Registration' | 'Permission'
  | 'Information' | 'Other'

export type AppStatus =
  | 'Draft' | 'Pending Approval' | 'Changes Requested' | 'Approved' | 'Rejected'
  | 'Published' | 'Closed' | 'Archived'

/**
 * Where an application ORIGINATED. Every form is the same reusable entity;
 * the source just records the originating module so lists can show where
 * each application came from.
 */
export type ApplicationSource = 'Examination' | 'Event' | 'Activity' | 'Custom'

/** Pointer back to the originating module record (e.g. the Examination). */
export interface ApplicationSourceRef {
  module: string
  id?: string
  label?: string
}

/** Immutable approval-workflow trail between teacher and Principal. */
export interface ApplicationApprovalNote {
  id: string
  at: string
  by: string
  role: 'Principal' | 'Teacher'
  kind: 'submitted' | 'approval' | 'changes' | 'rejection' | 'note'
  note: string
}
export type ParticipationMode = 'Optional' | 'Mandatory'
export type PaymentModeConfig = 'None' | 'Required' | 'Optional'

/** Form field types supported by the (reusable) form architecture. */
export type FormFieldType =
  // ── Basic inputs ──
  | 'text' | 'longtext' | 'number' | 'date'
  | 'email' | 'phone' | 'time' | 'datetime'
  | 'dropdown' | 'radio' | 'checkbox' | 'multiselect'
  | 'yesno' | 'rating'
  // ── School profile (auto-populated from the student record) ──
  | 'student-select' | 'admission-no' | 'class' | 'section' | 'roll-no'
  | 'student-name' | 'guardian-name' | 'guardian-phone' | 'guardian-email'
  | 'emergency-contact'
  // ── Documents & evidence ──
  | 'file' | 'file-multi' | 'photo' | 'id-doc' | 'supporting-doc'
  // ── Special school components ──
  | 'signature' | 'declaration' | 'consent' | 'terms'
  | 'address' | 'medical' | 'transport-req' | 'dietary' | 'accommodation'
  // ── Layout (non-input) ──
  | 'heading' | 'description-block' | 'divider' | 'notice' | 'instruction'

/**
 * One configurable field on a school form. The fill view ALWAYS renders the
 * student + guardian identity sections first (snapshotted from the school
 * record at submit time); `formFields` holds everything after them.
 */
export interface ApplicationFormField {
  id: string
  type: FormFieldType
  label: string
  helpText?: string
  required: boolean
  /** Option list for dropdown/radio/multiselect fields. */
  options?: string[]
  /** Logical section this question belongs to (official form layout). */
  section?: string
  /** Numeric bounds (architecture — used by future templates). */
  min?: number
  max?: number
  /** Text character cap (0 = unlimited). */
  maxLength?: number
  /** Signature: who signs ('Student' | 'Guardian' | 'Teacher' | 'Principal'). */
  signatureRole?: 'Student' | 'Guardian' | 'Teacher' | 'Principal'
  /** Layout blocks: preformatted body text. */
  blockText?: string
}

/**
 * APPLICATION TEMPLATE REGISTRY — the extension point for future Super
 * Admin-controlled form templates. A template fixes the application-
 * specific questions a form collects (student particulars are ALWAYS
 * auto-filled from the school record and never part of a template).
 * Registering a template + gating it in the Super Admin Control Center is
 * all a future form type needs — the store, lifecycle, payments, review,
 * printing and audit pipeline are entirely generic.
 *
 * APPS-IA-1 — the module is now GENERAL: the tour template is one of four
 * seeds (tour · workshop · sports consent · blank/general). Educational
 * Tour no longer defines the module; it is simply a form type.
 */
export type ApplicationTemplateKey =
  | 'educational_tour' | 'workshop_registration' | 'sports_consent' | 'general_application'

// ─── Document templates (AF-TPL) ─────────────────────────────────────────

/**
 * The TWO official A4 document layouts a tour session can print on. The
 * layout is fixed (no editor); the choice is made when the application is
 * created and flows through the blank form, the student's completed
 * document, browser Print and every PDF download.
 */
export type TourDocTemplate = 'classic' | 'modern'

export interface TourDocTemplateDef {
  key: TourDocTemplate
  /** Product name on the selection card. */
  label: string
  /** One-line description on the selection card. */
  blurb: string
}

/** Catalogue shown while creating an application (order = display order). */
export const TOUR_DOC_TEMPLATES: Record<TourDocTemplate, TourDocTemplateDef> = {
  classic: {
    key: 'classic',
    label: 'Classic Office',
    blurb: 'Traditional school-office document — strong letterhead, ruled fill-in lines, formal throughout.',
  },
  modern: {
    key: 'modern',
    label: 'Scholario Modern',
    blurb: 'Clean sections and generous spacing — a lighter, airier A4 layout.',
  },
}

export const TOUR_DOC_TEMPLATE_ORDER: TourDocTemplate[] = ['classic', 'modern']

/** Resolves the document template of a tour application (default: classic). */
export function docTemplateOf(app: Pick<SchoolApplication, 'docTemplate'> | undefined): TourDocTemplate {
  return app?.docTemplate ?? 'classic'
}

/**
 * TOUR-1 — the FIXED field set of the built-in Educational Tour — Parent
 * Consent Form. The form is a permanent ready-made school template: its
 * layout and questions can NOT be redesigned or extended from the UI.
 * Student particulars are ALWAYS auto-filled from the school record and
 * never part of the template. The migration (v8) normalizes every existing
 * tour instance to exactly this set.
 */
export const TOUR_FORM_FIELDS: ApplicationFormField[] = [
  { id: 't-meal', type: 'dropdown', label: 'Food preference', required: true, options: ['Vegetarian', 'Non-Vegetarian', 'Jain'], section: 'Health & Care' },
  { id: 't-motion', type: 'yesno', label: 'Any motion sickness / travel-related concern?', required: true, section: 'Health & Care' },
  { id: 't-medical', type: 'longtext', label: 'Relevant health / medical note', helpText: 'Allergies, medication, doctor\u2019s advice. Leave blank if none.', required: false, section: 'Health & Care' },
  { id: 't-emergency', type: 'text', label: 'Emergency contact for the tour', helpText: 'Name and mobile of an adult reachable during the trip.', required: true, section: 'Parent / Guardian Details' },
]

export interface ApplicationTemplateDef {
  key: ApplicationTemplateKey
  /** Nav / button label ("Educational Tour"). */
  label: string
  category: ApplicationCategory
  /** One-line purpose shown in the builder header. */
  tagline: string
  /** Placeholder guidance for the builder description field. */
  descriptionPlaceholder: string
  /** Ledger label prefix for the linked Additional Charge. */
  defaultLedgerLabel: string
  /** Suggested per-student amount (editable by the office). */
  defaultAmount: number
  /** Application-specific fields every form of this type collects. */
  fields: ApplicationFormField[]
  /** Default guardian consent statement (editable per application). */
  consentStatement: string
}

/** The template catalogue (seeded; future: Super Admin-controlled). */
export const APPLICATION_TEMPLATES: Record<ApplicationTemplateKey, ApplicationTemplateDef> = {
  educational_tour: {
    key: 'educational_tour',
    label: 'Educational Tour — Parent Consent Form',
    category: 'Tour',
    tagline: 'The school\u2019s official tour consent form — reuse for every session.',
    descriptionPlaceholder: 'Itinerary summary, what the fee covers, conduct rules…',
    defaultLedgerLabel: 'Educational Tour',
    defaultAmount: 2500,
    fields: TOUR_FORM_FIELDS.map((f) => ({ ...f })),
    consentStatement: 'I give consent for my ward to participate in the tour and accept the school\u2019s conduct rules for the trip.',
  },
  workshop_registration: {
    key: 'workshop_registration',
    label: 'Workshop Registration',
    category: 'Workshop',
    tagline: 'Register participants for a workshop — with optional fee.',
    descriptionPlaceholder: 'What the workshop covers, what the fee includes, timings…',
    defaultLedgerLabel: 'Workshop',
    defaultAmount: 1000,
    fields: [
      { id: 'w-track', type: 'dropdown', label: 'Preferred track / batch', required: true, options: ['Morning batch', 'Afternoon batch'], section: 'Workshop Preferences' },
      { id: 'w-kit', type: 'yesno', label: 'Do you need the take-home kit?', helpText: 'Included in the fee — tells us how many kits to arrange.', required: true, section: 'Workshop Preferences' },
      { id: 'w-experience', type: 'dropdown', label: 'Experience level', required: true, options: ['Beginner', 'Intermediate', 'Advanced'], section: 'Workshop Preferences' },
      { id: 'w-notes', type: 'longtext', label: 'Anything we should know?', helpText: 'Allergies, accessibility needs…', required: false, section: 'Medical & Emergency Details' },
    ],
    consentStatement: 'I confirm my ward may attend the workshop described above and follow the instructor\u2019s safety instructions.',
  },
  sports_consent: {
    key: 'sports_consent',
    label: 'Sports / Activity Consent',
    category: 'Competition',
    tagline: 'Parent consent for sports & competitions — no fee needed.',
    descriptionPlaceholder: 'Competition/event details, team selection, gear requirements…',
    defaultLedgerLabel: 'Sports',
    defaultAmount: 0,
    fields: [
      { id: 's-events', type: 'multiselect', label: 'Events my ward will compete in', required: true, options: ['100 m sprint', 'Long jump', 'Relay', 'Chess', 'Table tennis'], section: 'Sports Preferences' },
      { id: 's-fitness', type: 'yesno', label: 'Is your ward fit for competitive sport?', helpText: 'A doctor\u2019s note is required for chronic conditions.', required: true, section: 'Medical & Emergency Details' },
      { id: 's-medical', type: 'longtext', label: 'Medical notes / allergies', helpText: 'Leave blank if none.', required: false, section: 'Medical & Emergency Details' },
      { id: 's-transport', type: 'yesno', label: 'May your ward travel for inter-school fixtures?', required: true, section: 'Consent' },
    ],
    consentStatement: 'I consent to my ward participating in school sports activities and understand participation involves normal physical risk.',
  },
  general_application: {
    key: 'general_application',
    label: 'General Form',
    category: 'Custom',
    tagline: 'Blank form — write your own questions.',
    descriptionPlaceholder: 'What this form is for and who should fill it…',
    defaultLedgerLabel: 'School Form',
    defaultAmount: 0,
    fields: [],
    consentStatement: 'I confirm that the information provided in this form is correct to the best of my knowledge.',
  },
}

/** Ordered section presets (kept for the generic architecture). */
export const FORM_SECTIONS = [
  'Student Details', 'Guardian Details', 'Application Details',
  'Travel Details', 'Medical / Emergency Details', 'Consent', 'Payment', 'Declaration',
] as const

export interface ApplicationPaymentConfig {
  mode: PaymentModeConfig
  /** Per-student amount (INR) when mode ≠ None. */
  amount: number
  /** Ledger label recorded on payments/receipts for this charge. */
  feeHeadLabel: string
  /**
   * AdditionalCharge id created/reused at publish time. Stable across the
   * whole lifecycle so payments never lose their connection.
   */
  chargeId?: string
}

export interface GuardianConsentConfig {
  required: boolean
  /** Digital checkbox during submission vs physical signature on paper. */
  method: 'Digital' | 'Physical Signature'
  statement?: string
  /** PART 19 — when true (default), digital consent also captures a real
   *  signature (draw/type) at submit time. Opt out for legacy checkbox-only
   *  forms. Absent on older records behaves as true. */
  signatureRequired?: boolean
}

/** Physical signed-document workflow state. */
export interface PhysicalDocState {
  status: 'Not Required' | 'Pending' | 'Received' | 'Verified'
  /** File name of the scanned/photo/PDF copy kept on record. */
  fileName?: string
  receivedAt?: string
  receivedBy?: string
  verifiedAt?: string
}

export interface SchoolApplication {
  id: string
  title: string
  /** Tour destination (e.g. "Jaipur, Rajasthan") — printed on the official form. */
  destination?: string
  description?: string
  category: ApplicationCategory
  /** Originating module — exam-generated forms stay linked to their exam. */
  source: ApplicationSource
  sourceRef?: ApplicationSourceRef
  /** Template this application was created from (tour forms: educational_tour). */
  templateKey?: ApplicationTemplateKey
  // ─── TOUR-1 — session-specific tour particulars. The form LAYOUT is
  // fixed; only these genuinely-change-per-session values are editable in
  // the configuration screen. All optional for backward compatibility.
  /** Last day of the tour (eventDate = first day). */
  tourEndDate?: string
  /** Human duration, e.g. "3 Days / 2 Nights". */
  durationDays?: string
  /** Circular / reference number printed on the official form. */
  circularNo?: string
  /** Date of the circular (yyyy-mm-dd). */
  circularDate?: string
  /** Accompanying staff (free text, printed on the form). */
  accompanyingStaff?: string
  /** Short tour information / instructions for parents. */
  tourInstructions?: string
  /** Gender eligibility when the tour is gender-specific. */
  genderEligibility?: 'All' | 'Boys' | 'Girls'
  /** How the tour fee may be paid: online, at the school counter, or both. */
  paymentAvailability?: 'Both' | 'Online' | 'Cash'
  /** AF-TPL — which of the two official A4 document layouts this session
   *  prints on (chosen at creation; blank form, student copy, print and
   *  PDF all follow it). Defaults to 'classic' for pre-choice records. */
  docTemplate?: TourDocTemplate
  /** APPS-IA-1 — the form's PURPOSE (what it collects). Derived from the
   *  template when omitted (backward compat). */
  formPurpose?: FormPurpose
  academicYear: string
  /**
   * Who can apply. targetStudentIds overrides class scoping entirely when
   * non-empty; otherwise the union of classes (+ optional section filter)
   * applies.
   */
  targetClassIds: string[]
  targetSectionNames?: string[]
  targetStudentIds?: string[]
  publishDate?: string
  startDate?: string
  deadline: string          // final submission deadline (yyyy-mm-dd)
  eventDate?: string        // the tour date
  lockDate?: string         // optional hard lock independent of deadline
  participation: ParticipationMode
  guardianConsent: GuardianConsentConfig
  teacherApprovalRequired: boolean
  physicalSignatureRequired: boolean
  inChargeTeacherId?: string
  inChargeName?: string
  payment: ApplicationPaymentConfig
  formFields: ApplicationFormField[]
  /** Definition version — bumped on structural edits after publish.
   *  Submissions record the version they answered (auditability). */
  formVersion?: number
  status: AppStatus
  createdBy: string
  createdByRole: 'Principal' | 'Teacher'
  /** Approval workflow trail (teacher ⇄ Principal), immutable. */
  approvalNotes: ApplicationApprovalNote[]
  createdAt: string
  updatedAt: string
}

export type SubmissionWorkflowStatus =
  | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected'
  | 'Correction Required' | 'Withdrawn'

export interface ReviewNote {
  id: string
  at: string
  by: string
  role: 'Principal' | 'Teacher' | 'Office'
  note: string
  kind: 'note' | 'rejection' | 'correction' | 'approval'
}

/** A captured signature (spec PART 19). `data` is a PNG data-URL when the
 *  guardian drew it, or the typed name when they typed it. */
export interface SubmissionSignature {
  mode: 'drawn' | 'typed'
  data: string
  /** Whose signature this claims to be (guardian name). */
  signerName: string
  signedAt: string
}

export interface ApplicationSubmission {
  id: string
  applicationId: string
  /** Canonical students-store id used for ALL financial linkage. */
  studentId: string
  // ── Identity snapshot — the permanent record stays truthful even if the
  //    roster changes later. Never re-derive display info from live records.
  //    NOTE: no House field — Scholario does not use a house system.
  studentName: string
  admissionNo: string
  className: string
  classId: string
  section: string
  rollNo?: string
  dob?: string
  gender?: string
  bloodGroup?: string
  address?: string
  guardianName: string
  guardianPhone: string
  /** TOUR-1 — unique application/participation number for THIS tour
   *  (e.g. TOUR-26-27-11-G-001). Assigned once at submission time; stable
   *  forever after; sequential within the class + gender group. */
  serialNo?: string
  /** Answers to the template's application-specific fields. */
  answers: Record<string, string | string[] | boolean>
  /** Uploaded file metadata (name/size snapshot). */
  attachments?: Record<string, { name: string; size: number }>
  submittedAt: string
  submittedByRole: 'Student' | 'Guardian' | 'Office'
  /** Digital submissions use the online form; Office recordings are Physical. */
  mode: 'Digital' | 'Physical'
  status: SubmissionWorkflowStatus
  /** Timestamp when digital guardian consent was ticked. */
  consentGivenAt?: string
  /** Actual captured signature (PART 19) — absent on legacy submissions
   *  (renders blank rules) and office-recorded (paper) submissions. */
  signature?: SubmissionSignature
  physicalDoc: PhysicalDocState
  reviewNotes: ReviewNote[]
  reviewedBy?: string
  reviewedAt?: string
  resubmissionCount: number
  /** Version of the form definition this submission answered. */
  formVersion?: number
  updatedAt: string
}

export interface ApplicationAuditEvent {
  id: string
  applicationId: string
  submissionId?: string
  ts: string
  actor: string
  actorRole: 'Principal' | 'Teacher' | 'Student' | 'Guardian' | 'Office' | 'System'
  action:
    | 'application.created' | 'application.updated' | 'application.published'
    | 'application.submitted_approval' | 'application.changes_requested'
    | 'application.approved' | 'application.rejected'
    | 'application.closed' | 'application.locked' | 'application.reopened'
    | 'application.archived' | 'application.duplicated' | 'application.note'
    | 'application.deleted'
    | 'submission.recorded' | 'submission.submitted' | 'submission.resubmitted'
    | 'submission.approved' | 'submission.rejected' | 'submission.correction'
    | 'submission.withdrawn' | 'payment.initiated' | 'payment.completed'
    | 'doc.received' | 'doc.verified'
  message: string
}

// ─── Payment derivation (single source of truth = fee ledger) ──────────

export type DerivedPaymentStatus = 'Not Paid' | 'Awaiting Verification' | 'Paid' | 'Not Applicable'

export interface SubmissionPaymentInfo {
  status: DerivedPaymentStatus
  paidAmount: number
  expectedAmount: number
  receiptNos: string[]
  pendingReceiptNo: string | null
}

/**
 * Payment history belonging to ONE application. Reads the canonical fee
 * ledger — the exact same rows Fee Management renders. A transaction is
 * bound to this application when it carries the applicationId stamp
 * (recordPayment) or, for office-recorded legacy rows, when it is bound to
 * the application's own Additional Charge. NOTHING is duplicated here.
 */
export function applicationPayments(app: SchoolApplication): FeeTransaction[] {
  if (app.payment.mode === 'None' || !app.payment.chargeId) return []
  const { transactions } = useFeeStore.getState()
  return transactions.filter((t) =>
    t.applicationId === app.id
    || (!t.applicationId && t.additionalChargeId === app.payment.chargeId),
  )
}

/**
 * Derives a submission's payment picture from the canonical ledger. NOTHING
 * is recomputed — the same rows the Fees module and the application's
 * payment history render.
 */
export function deriveSubmissionPayment(
  app: SchoolApplication,
  sub: ApplicationSubmission,
): SubmissionPaymentInfo {
  const noPay: SubmissionPaymentInfo = {
    status: 'Not Applicable', paidAmount: 0, expectedAmount: 0, receiptNos: [], pendingReceiptNo: null,
  }
  if (!app.payment.chargeId || app.payment.mode === 'None') return noPay
  const mine = applicationPayments(app).filter((t) => t.studentId === sub.studentId)
  const success = mine.filter((t) => t.status === 'Success')
  const pending = mine.find((t) => t.status === 'Under Verification')
  return {
    status:
      success.length > 0 ? 'Paid'
        : pending ? 'Awaiting Verification'
          : 'Not Paid',
    paidAmount: success.reduce((s, t) => s + t.amount, 0),
    expectedAmount: app.payment.amount,
    receiptNos: success.map((t) => t.receiptNo),
    pendingReceiptNo: pending?.receiptNo ?? null,
  }
}

// ─── Lifecycle derivation ──────────────────────────────────────────────

/** Contextual badge state — workflow-driven, never cosmetic. */
export type EffectiveAppStatus =
  | 'Draft' | 'Pending Approval' | 'Changes Requested' | 'Approved' | 'Rejected'
  | 'Scheduled' | 'Open' | 'Closing Soon' | 'Closed' | 'Locked' | 'Archived'

export function effectiveAppStatus(app: SchoolApplication, now: Date = new Date()): EffectiveAppStatus {
  // Approval workflow states are themselves the effective display state —
  // the form cannot be open/scheduled while it waits for the Principal.
  if (app.status === 'Pending Approval' || app.status === 'Changes Requested'
    || app.status === 'Approved' || app.status === 'Rejected') return app.status
  if (app.status === 'Draft') return 'Draft'
  if (app.status === 'Archived') return 'Archived'
  if (app.status === 'Closed') return 'Closed'
  const today = now.toISOString().slice(0, 10)
  const hardLock = !!app.lockDate && today >= app.lockDate
  const pastDeadline = today > app.deadline
  if (hardLock || pastDeadline) return 'Locked'
  if (app.startDate && today < app.startDate) return 'Scheduled'
  const daysLeft = Math.ceil((new Date(app.deadline).getTime() - now.getTime()) / 86_400_000)
  return daysLeft <= 7 ? 'Closing Soon' : 'Open'
}

/** True when NEW submissions may be accepted right now. */
export function isSubmittable(app: SchoolApplication, now: Date = new Date()): boolean {
  const st = effectiveAppStatus(app, now)
  return st === 'Open' || st === 'Closing Soon'
}

/** Can the definition still be edited? Editing stops once closed/locked/archived.
 *  Forms sitting in 'Pending Approval' or 'Approved' are frozen — material
 *  edits would silently bypass the review that state represents. */
export function isApplicationEditable(app: SchoolApplication, now: Date = new Date()): boolean {
  const st = effectiveAppStatus(app, now)
  return st === 'Draft' || st === 'Changes Requested' || st === 'Rejected'
    || st === 'Open' || st === 'Closing Soon' || st === 'Scheduled'
}

/** Classify a schema edit. Structural edits change WHAT a respondent
 *  answers; cosmetic edits only change presentation. On published forms
 *  structural edits create a new definition version. */
export function isStructuralSchemaChange(
  prev: ApplicationFormField[],
  next: ApplicationFormField[],
): boolean {
  if (prev.length !== next.length) return true
  const sig = (f: ApplicationFormField) => JSON.stringify([f.id, f.type, f.required, f.section ?? ''])
  for (let i = 0; i < prev.length; i++) {
    if (sig(prev[i]) !== sig(next[i])) return true
  }
  return false
}

/** Consent satisfied? Digital tick counts immediately; physical needs verification. */
export function isConsentSatisfied(app: SchoolApplication, sub: ApplicationSubmission): boolean {
  if (!app.guardianConsent.required) return true
  if (sub.consentGivenAt) return true
  if (app.guardianConsent.method === 'Physical Signature') {
    return sub.physicalDoc.status === 'Verified'
  }
  return false
}

/** The one contextual combined status shown in tables/badges. */
export type CombinedSubmissionStatus =
  | 'Submitted' | 'Awaiting Payment' | 'Awaiting Verification' | 'Paid · Under Review'
  | 'Under Review' | 'Approved' | 'Rejected' | 'Correction Required' | 'Withdrawn'
  | 'Physical Doc Pending' | 'Physical Doc Verification'

export function combinedSubmissionStatus(app: SchoolApplication, sub: ApplicationSubmission): CombinedSubmissionStatus {
  if (sub.status === 'Withdrawn') return 'Withdrawn'
  if (sub.status === 'Rejected') return 'Rejected'
  if (sub.status === 'Correction Required') return 'Correction Required'
  const pay = deriveSubmissionPayment(app, sub)
  if (pay.status === 'Awaiting Verification') return 'Awaiting Verification'
  if (sub.mode === 'Physical' && sub.physicalDoc.status === 'Pending') return 'Physical Doc Pending'
  if (sub.physicalDoc.status === 'Received') return 'Physical Doc Verification'
  if (sub.status === 'Approved') {
    // Approved but a required payment somehow missing (defensive) — surface honestly.
    if (pay.status === 'Not Paid' && app.payment.mode === 'Required') return 'Awaiting Payment'
    return 'Approved'
  }
  if (app.payment.mode === 'Required' && pay.status === 'Not Paid') return 'Awaiting Payment'
  if (sub.status === 'Under Review') return 'Under Review'
  return pay.status === 'Paid' ? 'Paid · Under Review' : 'Submitted'
}

// ─── Eligibility helpers ───────────────────────────────────────────────

export interface StudentLite {
  id: string
  admissionNo: string
  name: string
  className: string
  classId: string
  section: string
  gender?: string
}

export function isEligibleForApplication(app: SchoolApplication, student: Pick<StudentLite, 'classId' | 'section' | 'id' | 'gender'>): boolean {
  if (app.status !== 'Published') return false
  if (app.targetStudentIds?.length) return app.targetStudentIds.includes(student.id)
  if (!app.targetClassIds.includes(student.classId)) return false
  if (app.targetSectionNames?.length && !app.targetSectionNames.includes(student.section)) return false
  // TOUR-1 — gender-scoped tours only accept students of that gender.
  if (app.genderEligibility === 'Boys' || app.genderEligibility === 'Girls') {
    const g = (student.gender ?? '').toLowerCase()
    if (!g) return false
    const isBoy = g.startsWith('m') || g.startsWith('b')
    const isGirl = g.startsWith('f') || g.startsWith('g')
    if (app.genderEligibility === 'Boys' && !isBoy) return false
    if (app.genderEligibility === 'Girls' && !isGirl) return false
  }
  return true
}

// ─── TOUR-1 — unique tour serial / participation number ────────────────

/** "2026-2027" → "26-27" (session tag inside every serial number). */
export function tourSessionTag(academicYear: string): string {
  const m = academicYear.match(/(\d{4})\D+(\d{2,4})?/)
  if (!m) return academicYear.replace(/\D/g, '').slice(-4) || '00-00'
  const a = m[1].slice(2)
  const b = m[2] ? m[2].slice(-2) : String((Number(m[1]) + 1) % 100).padStart(2, '0')
  return `${a}-${b}`
}

/** "Class 11" → "11"; "Nursery" → "N" (class tag inside the serial). */
export function tourClassTag(className: string): string {
  const m = className.match(/Class\s*(\d+)/i)
  if (m) return m[1]
  return className.trim().charAt(0).toUpperCase() || 'X'
}

/** Gender code — B / G / X (unknown). */
export function tourGenderTag(gender?: string): 'B' | 'G' | 'X' {
  const g = (gender ?? '').toLowerCase()
  if (g.startsWith('m') || g.startsWith('b')) return 'B'
  if (g.startsWith('f') || g.startsWith('g')) return 'G'
  return 'X'
}

/**
 * The next serial number for a tour submission. Sequential within the
 * (class, gender) group, unique across the whole tour, stable once written.
 * Format: TOUR-26-27-11-G-001.
 */
export function nextTourSerial(
  app: SchoolApplication,
  allSubmissions: Array<Pick<ApplicationSubmission, 'applicationId' | 'className' | 'gender' | 'serialNo'>>,
  className: string,
  gender?: string,
): string {
  const classTag = tourClassTag(className)
  const genderTag = tourGenderTag(gender)
  const prefix = `TOUR-${tourSessionTag(app.academicYear)}-${classTag}-${genderTag}-`
  const used = new Set(
    allSubmissions
      .filter((s) => s.applicationId === app.id && s.serialNo?.startsWith(prefix))
      .map((s) => s.serialNo),
  )
  for (let i = 1; i <= 999; i++) {
    const candidate = `${prefix}${String(i).padStart(3, '0')}`
    if (!used.has(candidate)) return candidate
  }
  return `${prefix}${Date.now().toString(36).toUpperCase()}`
}

// ─── Store contract ───────────────────────────────────────────────────

export interface CreateApplicationInput {
  title: string
  destination?: string
  description?: string
  category: ApplicationCategory
  templateKey?: ApplicationTemplateKey
  formPurpose?: FormPurpose
  source?: ApplicationSource
  sourceRef?: ApplicationSourceRef
  academicYear?: string
  targetClassIds: string[]
  targetSectionNames?: string[]
  targetStudentIds?: string[]
  publishDate?: string
  startDate?: string
  deadline: string
  eventDate?: string
  lockDate?: string
  participation: ParticipationMode
  guardianConsentRequired: boolean
  guardianConsentMethod: 'Digital' | 'Physical Signature'
  consentStatement?: string
  teacherApprovalRequired: boolean
  physicalSignatureRequired: boolean
  inChargeTeacherId?: string
  inChargeName?: string
  paymentMode: PaymentModeConfig
  paymentAmount: number
  paymentFeeHeadLabel: string
  /** APPS-IA-1 (§13) — explicitly LINK an existing Additional Collection
   *  instead of creating one at publish time. Validation: the charge must
   *  exist and not already be linked to a published form. */
  paymentChargeId?: string
  formFields: ApplicationFormField[]
  // ─── TOUR-1 — session-specific tour particulars (see SchoolApplication). ───
  tourEndDate?: string
  durationDays?: string
  circularNo?: string
  circularDate?: string
  accompanyingStaff?: string
  tourInstructions?: string
  genderEligibility?: 'All' | 'Boys' | 'Girls'
  paymentAvailability?: 'Both' | 'Online' | 'Cash'
  /** AF-TPL — A4 document layout for this session ('classic' | 'modern'). */
  docTemplate?: TourDocTemplate
}

interface ApplicationsState {
  applications: SchoolApplication[]
  submissions: ApplicationSubmission[]
  audit: ApplicationAuditEvent[]

  createApplication: (input: CreateApplicationInput, actor: string, opts?: { actorRole?: 'Principal' | 'Teacher'; teacherId?: string }) => { success: boolean; application?: SchoolApplication; error?: string }
  updateApplication: (id: string, patch: Partial<CreateApplicationInput>, actor: string, opts?: { actorRole?: 'Principal' | 'Teacher'; teacherId?: string }) => { success: boolean; error?: string }
  /** Patches schema fields on a DRAFT and bumps `formVersion` on PUBLISHED
   *  forms when edits are structural. Returns `versionBumped`. */
  updateFormSchema: (id: string, fields: ApplicationFormField[], actor: string) => { success: boolean; error?: string; versionBumped?: boolean }
  publishApplication: (id: string, actor: string, opts?: { actorRole?: 'Principal' | 'Teacher'; teacherId?: string }) => { success: boolean; error?: string; chargeCreated?: boolean }
  /** TEACHER → PRINCIPAL workflow. */
  submitForApproval: (id: string, actor: string, actorRole: 'Principal' | 'Teacher', note?: string, opts?: { teacherId?: string }) => { success: boolean; error?: string }
  requestApprovalChanges: (id: string, note: string, actor: string) => { success: boolean; error?: string }
  approveApplication: (id: string, note: string, actor: string) => { success: boolean; error?: string }
  rejectApplication: (id: string, note: string, actor: string) => { success: boolean; error?: string }
  closeApplication: (id: string, actor: string, reason?: string) => void
  lockApplication: (id: string, actor: string, reason?: string) => void
  reopenApplication: (id: string, actor: string) => { success: boolean; error?: string }
  archiveApplication: (id: string, actor: string) => void
  duplicateApplication: (id: string, actor: string) => { success: boolean; application?: SchoolApplication }
  /** APPS-IA-1 (§6/§17) — permanently delete a DRAFT form. Only possible
   *  with zero submissions (a submitted form is a school record). The
   *  store refuses everything else with an honest reason. */
  deleteApplicationDraft: (id: string, actor: string) => { success: boolean; error?: string }

  submitApplication: (input: {
    applicationId: string
    student: StudentSubmissionIdentity
    answers: Record<string, string | string[] | boolean>
    attachments?: Record<string, { name: string; size: number }>
    consentAccepted: boolean
    /** PART 19 — the captured guardian signature (required by the dialog
     *  whenever the form's digital consent requires signing). */
    signature?: SubmissionSignature
    submittedByRole?: 'Student' | 'Guardian'
  }) => { success: boolean; submission?: ApplicationSubmission; existingSubmissionId?: string; error?: string }

  withdrawSubmission: (submissionId: string, actor: string) => { success: boolean; error?: string }
  resubmitSubmission: (submissionId: string, answers: Record<string, string | string[] | boolean>, attachments: Record<string, { name: string; size: number }> | undefined, actor: string) => { success: boolean; error?: string }
  reviewSubmission: (
    submissionId: string,
    decision: 'approve' | 'reject' | 'request_correction',
    note: string,
    actor: string,
    actorRole: 'Principal' | 'Teacher',
  ) => { success: boolean; error?: string }
  addReviewNote: (submissionId: string, note: string, actor: string, role: 'Principal' | 'Teacher' | 'Office') => void

  recordOfflineSubmission: (input: {
    applicationId: string
    student: StudentSubmissionIdentity
    attachmentName?: string
    recordedBy: string
    recorderRole: 'Principal' | 'Teacher' | 'Office'
  }) => { success: boolean; submission?: ApplicationSubmission; error?: string }
  markDocumentReceived: (submissionId: string, fileName: string, actor: string, recorderRole: 'Principal' | 'Teacher' | 'Office') => { success: boolean; error?: string }
  verifyPhysicalDocument: (submissionId: string, actor: string) => { success: boolean; error?: string }
}

/** Identity snapshot bundle used for every submission. Carries the school
 *  record particulars the official document prints — House is deliberately
 *  absent (Scholario has no house system). */
export interface StudentSubmissionIdentity extends StudentLite {
  rollNo?: string
  dob?: string
  gender?: string
  bloodGroup?: string
  address?: string
  guardianName: string
  guardianPhone: string
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function pushAudit(state: Pick<ApplicationsState, 'audit'>, ev: Omit<ApplicationAuditEvent, 'id'>): ApplicationAuditEvent[] {
  return [{ ...ev, id: newId('AEV') }, ...state.audit]
}

// ─── Coarse category mapping into Additional Charges vocabulary ────────

function chargeCategoryOf(c: ApplicationCategory): AdditionalChargeCategory {
  switch (c) {
    case 'Tour': case 'Trip': return 'Tour'
    case 'Workshop': return 'Workshop'
    case 'Competition': return 'Competition'
    case 'Camp': return 'Camp'
    case 'Transport': return 'Material' // closest coarse bucket available
    default: return 'Other'
  }
}

// ─── Purpose helpers (APPS-IA-1) ───────────────────────────────────────

/** Template → default form purpose. Older records without formPurpose
 *  derive theirs here so every list can show a TYPE column. */
export function formPurposeOf(app: Pick<SchoolApplication, 'templateKey' | 'formPurpose' | 'category'>): FormPurpose {
  if (app.formPurpose) return app.formPurpose
  if (app.templateKey === 'educational_tour' || app.templateKey === 'sports_consent') return 'Consent'
  if (app.templateKey === 'workshop_registration') return 'Registration'
  if (app.templateKey === 'general_application') return 'Application'
  return 'Application'
}

/** Template → default form purpose (input-side convenience). */
function templatePurposeOf(templateKey?: ApplicationTemplateKey): FormPurpose {
  if (templateKey === 'educational_tour' || templateKey === 'sports_consent') return 'Consent'
  if (templateKey === 'workshop_registration') return 'Registration'
  return 'Application'
}

// ─── Student eligibility notification (existing announcements system) ──

/**
 * Fires the EXISTING school announcement pipeline (`POST /api/announcements`
 * → DB Notification → live notification feed) so every student of the
 * target classes is told the moment they become eligible to apply.
 * Class-scoped audiences keep the notice out of unrelated students' feeds.
 * Fire-and-forget: a notification failure must never block publishing.
 */
export async function notifyEligibleStudents(app: SchoolApplication): Promise<void> {
  try {
    const classNameOf = (id: string) => ACADEMIC_CLASSES.find((c) => c.id === id)?.name
    // The announcements API maps any class-like audience to its canonical
    // `CLASS:<name>` tag itself — send the PLAIN class name (sending a
    // pre-prefixed value produces "CLASS:CLASS:…" and the notice never
    // reaches the class roster).
    const audiences: string[] = app.targetStudentIds?.length
      ? ['All Students']
      : Array.from(new Set(app.targetClassIds.map(classNameOf).filter((n): n is string => !!n)))
    if (audiences.length === 0) return
    const fee = app.payment.mode !== 'None'
      ? ` Fee ₹${app.payment.amount.toLocaleString('en-IN')} per student — pay online or at the school office.`
      : ' There is no fee for this form.'
    await Promise.all(audiences.map((audience) => fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${app.title} — applications open`,
        message: `The school has published "${app.title}". Submit your application by ${app.deadline}.${fee}`,
        category: 'Event',
        audience,
      }),
    })))
  } catch {
    /* notification is best-effort — never block the publish */
  }
}

// ─── Store ─────────────────────────────────────────────────────────────

/** Legacy (un-scoped) data migrates once into the school's tenant namespace. */
migrateLegacyScopedStore(TENANT_SCOPED_BASES.applications, DEFAULT_TENANT_ID)

/** Session year used by the seed data — declared BEFORE the store so the
 *  initializer's seedApplications() call can never hit a TDZ error. */
const YEAR = CURRENT_ACADEMIC_YEAR

export const useApplicationsStore = create<ApplicationsState>()(
  persist(
    (set, get) => ({
      applications: seedApplications(),
      submissions: [],
      audit: [],

      /** Builder autosave — structural edits on a PUBLISHED form bump the
       *  definition version; drafts mutate freely. */
      updateFormSchema: (id, fields, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        if (!isApplicationEditable(app)) {
          return { success: false, error: `"${app.title}" is ${effectiveAppStatus(app)} — the form definition is locked.` }
        }
        const published = app.status === 'Published'
        const structural = published && isStructuralSchemaChange(app.formFields, fields)
        const nextVersion = structural ? (app.formVersion ?? 1) + 1 : (app.formVersion ?? 1)
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            formFields: fields,
            ...(structural ? { formVersion: nextVersion } : {}),
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.updated',
            message: structural
              ? `Form structure changed on published "${app.title}" — definition moved to v${nextVersion} (existing submissions stay on v${app.formVersion ?? 1}).`
              : `Form schema saved on "${app.title}".`,
          }),
        })
        return { success: true, versionBumped: structural }
      },

      createApplication: (input, actor, opts) => {
        const state = get()
        const trimmed = input.title.trim()
        if (!trimmed) return { success: false, error: 'Title is required.' }
        const year = input.academicYear ?? CURRENT_ACADEMIC_YEAR
        if (state.applications.some(
          (a) => a.academicYear === year && a.title.trim().toLowerCase() === trimmed.toLowerCase(),
        )) {
          return { success: false, error: `An application titled "${trimmed}" already exists this session.` }
        }
        // APPS-IA-1 (§13) — explicit collection LINK validation. The charge
        // must exist and not already be the financial engine of ANOTHER
        // published form (one charge, one live form — no duplicate money).
        let linkedChargeId: string | undefined
        if (input.paymentMode !== 'None' && input.paymentChargeId) {
          const charge = useFeeStore.getState().additionalCharges.find((c) => c.id === input.paymentChargeId)
          if (!charge) return { success: false, error: 'The linked collection no longer exists.' }
          const owner = state.applications.find(
            (a) => a.payment.chargeId === charge.id && a.status === 'Published' && a.id !== undefined,
          )
          if (owner) {
            return { success: false, error: `That collection is already linked to "${owner.title}". Link a different collection or create a new one.` }
          }
          linkedChargeId = charge.id
          // The charge's amount is the financial truth — the form follows it.
          input = { ...input, paymentAmount: charge.allowCustomAmount ? charge.amount : charge.amount }
        }
        const nowIso = new Date().toISOString()
        const actorRole = opts?.actorRole ?? 'Principal'
        // TEACHER PERMISSION: a teacher creating a form is its in-charge by
        // construction — the store FORCES the in-charge to the creating
        // teacher so nobody can create a form assigned to someone else.
        const inChargeId = actorRole === 'Teacher' && opts?.teacherId
          ? opts.teacherId
          : (input.inChargeTeacherId || undefined)
        const app: SchoolApplication = {
          id: newId('APP'),
          title: trimmed,
          destination: input.destination?.trim() || undefined,
          description: input.description?.trim() || undefined,
          category: input.category,
          templateKey: input.templateKey,
          source: input.source ?? 'Custom',
          sourceRef: input.sourceRef,
          academicYear: year,
          formVersion: 1,
          // TOUR-1 — session-specific tour particulars.
          ...(input.tourEndDate ? { tourEndDate: input.tourEndDate } : {}),
          ...(input.durationDays?.trim() ? { durationDays: input.durationDays.trim() } : {}),
          ...(input.circularNo?.trim() ? { circularNo: input.circularNo.trim() } : {}),
          ...(input.circularDate ? { circularDate: input.circularDate } : {}),
          ...(input.accompanyingStaff?.trim() ? { accompanyingStaff: input.accompanyingStaff.trim() } : {}),
          ...(input.tourInstructions?.trim() ? { tourInstructions: input.tourInstructions.trim() } : {}),
          ...(input.genderEligibility && input.genderEligibility !== 'All' ? { genderEligibility: input.genderEligibility } : {}),
          ...(input.paymentAvailability ? { paymentAvailability: input.paymentAvailability } : {}),
          docTemplate: input.docTemplate ?? 'classic',
          targetClassIds: [...input.targetClassIds],
          targetSectionNames: input.targetSectionNames?.length ? [...input.targetSectionNames] : undefined,
          targetStudentIds: input.targetStudentIds?.length ? [...input.targetStudentIds] : undefined,
          publishDate: input.publishDate,
          startDate: input.startDate,
          deadline: input.deadline,
          eventDate: input.eventDate,
          lockDate: input.lockDate,
          participation: input.participation,
          guardianConsent: {
            required: input.guardianConsentRequired,
            method: input.guardianConsentMethod,
            statement: input.consentStatement,
          },
          teacherApprovalRequired: input.teacherApprovalRequired,
          physicalSignatureRequired: input.physicalSignatureRequired,
          inChargeTeacherId: inChargeId,
          inChargeName: input.inChargeName || undefined,
          payment: {
            mode: input.paymentMode,
            amount: Math.max(0, input.paymentAmount),
            feeHeadLabel: input.paymentFeeHeadLabel.trim() || trimmed,
            ...(linkedChargeId ? { chargeId: linkedChargeId } : {}),
          },
          formPurpose: input.formPurpose ?? templatePurposeOf(input.templateKey),
          formFields: input.formFields.map((f) => ({ ...f })),
          status: 'Draft',
          createdBy: actor,
          createdByRole: actorRole,
          approvalNotes: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        set({
          applications: [app, ...state.applications],
          audit: pushAudit(state, {
            ts: nowIso, applicationId: app.id, actor, actorRole,
            action: 'application.created', message: `Application "${app.title}" created as draft by ${actor} (${actorRole}).`,
          }),
        })
        return { success: true, application: app }
      },

      updateApplication: (id, patch, actor, opts) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        // TEACHER BOUNDARY: only the assigned in-charge may edit their own
        // draft-level forms, only before approval/publish, and NEVER the
        // protected financial configuration.
        if (opts?.actorRole === 'Teacher') {
          if (app.createdByRole !== 'Teacher' || app.inChargeTeacherId !== opts.teacherId) {
            return { success: false, error: 'You can only edit forms assigned to you.' }
          }
          if (!['Draft', 'Changes Requested', 'Rejected'].includes(app.status)) {
            return { success: false, error: `This form is ${app.status.toLowerCase()} — editing is locked. Request changes via the Principal.` }
          }
          const moneyChanged =
            (patch.paymentMode !== undefined && patch.paymentMode !== app.payment.mode)
            || (patch.paymentAmount !== undefined && Math.max(0, patch.paymentAmount) !== app.payment.amount)
            || (patch.paymentFeeHeadLabel !== undefined && patch.paymentFeeHeadLabel.trim() !== app.payment.feeHeadLabel)
          if (moneyChanged) {
            return { success: false, error: 'Financial configuration is protected — only the school office can change charges.' }
          }
        }
        if (!isApplicationEditable(app)) {
          return { success: false, error: `"${app.title}" is ${effectiveAppStatus(app)} — editing is locked. Historical data stays preserved.` }
        }
        // AF-TPL — the A4 document layout is a print contract: once the
        // session is live, students' submitted documents must keep the
        // layout they were issued on.
        if (patch.docTemplate !== undefined && patch.docTemplate !== app.docTemplate
          && ['Published', 'Open', 'Closing Soon', 'Closed', 'Locked'].includes(effectiveAppStatus(app))) {
          return { success: false, error: 'The document template is locked once the session is published — existing submissions keep their layout.' }
        }
        const publishedLockedMoney = app.status === 'Published'
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
            ...(patch.destination !== undefined ? { destination: patch.destination.trim() || undefined } : {}),
            ...(patch.description !== undefined ? { description: patch.description.trim() || undefined } : {}),
            ...(patch.targetClassIds !== undefined ? { targetClassIds: patch.targetClassIds } : {}),
            ...(patch.targetSectionNames !== undefined ? { targetSectionNames: patch.targetSectionNames.length ? patch.targetSectionNames : undefined } : {}),
            ...(patch.targetStudentIds !== undefined ? { targetStudentIds: patch.targetStudentIds.length ? patch.targetStudentIds : undefined } : {}),
            ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
            ...(patch.deadline !== undefined ? { deadline: patch.deadline } : {}),
            ...(patch.eventDate !== undefined ? { eventDate: patch.eventDate } : {}),
            ...(patch.lockDate !== undefined ? { lockDate: patch.lockDate } : {}),
            ...(patch.participation !== undefined ? { participation: patch.participation } : {}),
            ...(patch.guardianConsentRequired !== undefined || patch.guardianConsentMethod !== undefined || patch.consentStatement !== undefined ? {
              guardianConsent: {
                required: patch.guardianConsentRequired ?? a.guardianConsent.required,
                method: patch.guardianConsentMethod ?? a.guardianConsent.method,
                statement: patch.consentStatement ?? a.guardianConsent.statement,
              },
            } : {}),
            ...(patch.teacherApprovalRequired !== undefined ? { teacherApprovalRequired: patch.teacherApprovalRequired } : {}),
            ...(patch.physicalSignatureRequired !== undefined ? { physicalSignatureRequired: patch.physicalSignatureRequired } : {}),
            ...(patch.inChargeTeacherId !== undefined ? { inChargeTeacherId: patch.inChargeTeacherId || undefined } : {}),
            ...(patch.inChargeName !== undefined ? { inChargeName: patch.inChargeName || undefined } : {}),
            // TOUR-1 — session-specific tour particulars (patch-through;
            // empty string clears an optional value).
            ...(patch.tourEndDate !== undefined ? { tourEndDate: patch.tourEndDate || undefined } : {}),
            ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays.trim() || undefined } : {}),
            ...(patch.circularNo !== undefined ? { circularNo: patch.circularNo.trim() || undefined } : {}),
            ...(patch.circularDate !== undefined ? { circularDate: patch.circularDate || undefined } : {}),
            ...(patch.accompanyingStaff !== undefined ? { accompanyingStaff: patch.accompanyingStaff.trim() || undefined } : {}),
            ...(patch.tourInstructions !== undefined ? { tourInstructions: patch.tourInstructions.trim() || undefined } : {}),
            ...(patch.genderEligibility !== undefined ? { genderEligibility: patch.genderEligibility } : {}),
            ...(patch.paymentAvailability !== undefined ? { paymentAvailability: patch.paymentAvailability } : {}),
            ...(patch.docTemplate !== undefined ? { docTemplate: patch.docTemplate } : {}),
            ...(patch.formFields !== undefined && !publishedLockedMoney ? { formFields: patch.formFields } : {}),
            updatedAt: nowIso,
            // NOTE: money config (mode/amount/label) intentionally NOT mutable
            // through update once published — the linked charge owns it.
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.updated', message: `Application "${app.title}" updated.`,
          }),
        })
        // ELIGIBILITY EXPANSION on a LIVE form: students of newly added
        // classes become eligible NOW — notify just those classes (the
        // already-targeted ones were notified at publish and must not be
        // re-notified). Fire-and-forget, same pipeline as publish.
        if (app.status === 'Published' && Array.isArray(patch.targetClassIds)) {
          const added = patch.targetClassIds.filter((cid) => !app.targetClassIds.includes(cid))
          if (added.length > 0) {
            void notifyEligibleStudents({
              ...app,
              targetClassIds: added,
              targetStudentIds: undefined,
            })
          }
        }
        return { success: true }
      },

      publishApplication: (id, actor, opts) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        const actorRole = opts?.actorRole ?? 'Principal'
        if (!app) return { success: false, error: 'Application not found.' }
        // PRINCIPAL APPROVAL ENFORCEMENT: teacher-created forms publish ONLY
        // after the Principal approved them — enforced at the store level.
        if (actorRole === 'Teacher') {
          if (app.createdByRole !== 'Teacher' || app.inChargeTeacherId !== opts?.teacherId) {
            return { success: false, error: 'You can only operate forms assigned to you.' }
          }
          if (app.status !== 'Approved') {
            return { success: false, error: 'Principal approval is required before this form can be published.' }
          }
        }
        if (!['Draft', 'Approved', 'Changes Requested', 'Rejected'].includes(app.status)) {
          return { success: false, error: `Cannot publish from "${app.status}".` }
        }
        if (!app.deadline) return { success: false, error: 'Set a submission deadline before publishing.' }
        if (!app.targetClassIds.length && !app.targetStudentIds?.length) {
          return { success: false, error: 'Select at least one target class or specific students.' }
        }
        if (!app.formFields.length) {
          return { success: false, error: 'Add at least one question to the form.' }
        }
        if (app.payment.mode !== 'None' && app.payment.amount <= 0) {
          return { success: false, error: 'Enter the per-student charge amount.' }
        }
        const nowIso = new Date().toISOString()

        // FINANCIAL LINKAGE — reuse OR create exactly ONE Additional Charge.
        // Reuse rule: an Active charge with the same name + year exists →
        // link to IT so any existing collection history stays attached.
        let chargeId = app.payment.chargeId
        let chargeCreated = false
        if (app.payment.mode !== 'None' && !chargeId) {
          const existing = useFeeStore.getState().additionalCharges.find(
            (c) => c.status === 'Active'
              && c.name.trim().toLowerCase() === app.title.trim().toLowerCase()
              && c.academicYear === app.academicYear,
          )
          if (existing) {
            chargeId = existing.id
          } else {
            const created = useFeeStore.getState().createAdditionalCharge({
              name: app.title,
              category: chargeCategoryOf(app.category),
              amount: app.payment.amount,
              academicYear: app.academicYear,
              applicableClassIds: app.targetClassIds.length ? app.targetClassIds : ['__DIRECT__'],
              studentIds: app.targetClassIds.length ? undefined : app.targetStudentIds,
              dueDate: app.deadline,
              mandatory: app.payment.mode === 'Required',
              description: app.description ?? app.title,
              reference: app.title,
              actor,
            })
            if (!created.success || !created.charge) {
              return { success: false, error: created.error ?? 'Could not create the linked charge.' }
            }
            chargeId = created.charge.id
            chargeCreated = true
          }
        }
        // APPS-IA-1 (§13) — a form explicitly linked to a DRAFT collection
        // brings that collection live with it: publishing the form is the
        // publish signal for the linked charge too (one action, one truth).
        if (chargeId) {
          const linked = useFeeStore.getState().additionalCharges.find((c) => c.id === chargeId)
          if (linked && linked.status === 'Draft') {
            useFeeStore.getState().publishAdditionalCharge(linked.id, actor)
          }
        }

        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            status: 'Published' as const,
            publishDate: nowIso.slice(0, 10),
            updatedAt: nowIso,
            payment: { ...a.payment, chargeId },
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole,
            action: 'application.published',
            message: `Application "${app.title}" published by ${actor} (${actorRole})${chargeCreated ? ' — linked Additional Charge created' : chargeId ? ' — linked to existing Additional Charge' : ''}. Deadline ${app.deadline}.`,
          }),
        })
        // Students of the target classes become eligible NOW — notify them
        // through the existing announcements pipeline (fire-and-forget).
        void notifyEligibleStudents({ ...app, status: 'Published', payment: { ...app.payment, chargeId } })
        return { success: true, chargeCreated }
      },

      // ── TEACHER → PRINCIPAL approval workflow ───────────────────────
      submitForApproval: (id, actor, actorRole, note, opts) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        if (actorRole === 'Teacher' && (app.createdByRole !== 'Teacher' || app.inChargeTeacherId !== opts?.teacherId)) {
          return { success: false, error: 'You can only submit your own forms for approval.' }
        }
        if (!['Draft', 'Changes Requested', 'Rejected'].includes(app.status)) {
          return { success: false, error: `This form is already ${app.status.toLowerCase()}.` }
        }
        if (!app.deadline || !app.targetClassIds.length && !app.targetStudentIds?.length || !app.formFields.length) {
          return { success: false, error: 'Complete the form first — title, target students, deadline and at least one question.' }
        }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            status: 'Pending Approval' as const,
            approvalNotes: note?.trim() ? [
              ...a.approvalNotes,
              { id: newId('AN'), at: nowIso, by: actor, role: actorRole, kind: 'submitted' as const, note: note.trim() },
            ] : a.approvalNotes,
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole,
            action: 'application.submitted_approval',
            message: `"${app.title}" submitted for Principal approval by ${actor} (${actorRole}).`,
          }),
        })
        return { success: true }
      },

      requestApprovalChanges: (id, note, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        if (app.status !== 'Pending Approval') {
          return { success: false, error: 'Only a form awaiting approval can be sent back for changes.' }
        }
        if (!note.trim()) return { success: false, error: 'Describe the changes you expect — the in-charge will act on your note.' }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            status: 'Changes Requested' as const,
            approvalNotes: [...a.approvalNotes, { id: newId('AN'), at: nowIso, by: actor, role: 'Principal' as const, kind: 'changes' as const, note: note.trim() }],
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.changes_requested',
            message: `Changes requested on "${app.title}" — ${note.trim()}`,
          }),
        })
        return { success: true }
      },

      approveApplication: (id, note, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        if (app.status !== 'Pending Approval') {
          return { success: false, error: 'Only a form awaiting approval can be approved.' }
        }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            status: 'Approved' as const,
            approvalNotes: [...a.approvalNotes, { id: newId('AN'), at: nowIso, by: actor, role: 'Principal' as const, kind: 'approval' as const, note: note.trim() }],
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.approved',
            message: `"${app.title}" APPROVED by Principal ${actor}${note.trim() ? ` — ${note.trim()}` : ''}. Ready to publish.`,
          }),
        })
        return { success: true }
      },

      rejectApplication: (id, note, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        if (app.status !== 'Pending Approval') {
          return { success: false, error: 'Only a form awaiting approval can be rejected.' }
        }
        if (!note.trim()) return { success: false, error: 'State the reason for rejection.' }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : {
            ...a,
            status: 'Rejected' as const,
            approvalNotes: [...a.approvalNotes, { id: newId('AN'), at: nowIso, by: actor, role: 'Principal' as const, kind: 'rejection' as const, note: note.trim() }],
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.rejected',
            message: `"${app.title}" rejected by Principal ${actor} — ${note.trim()}`,
          }),
        })
        return { success: true }
      },

      closeApplication: (id, actor, _reason) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return
        if (app.status !== 'Published') return
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : { ...a, status: 'Closed', updatedAt: nowIso }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.closed', message: `Application "${app.title}" taken down by ${actor} — new submissions stopped. All submissions, payments and history remain on record.`,
          }),
        })
      },

      lockApplication: (id, actor, reason) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : { ...a, lockDate: nowIso.slice(0, 10), updatedAt: nowIso }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.locked', message: `Application "${app.title}" locked${reason ? ` — ${reason}` : ''}. Final submitted data frozen.`,
          }),
        })
      },

      reopenApplication: (id, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Application not found.' }
        const today = new Date().toISOString().slice(0, 10)
        if (today > app.deadline) {
          return { success: false, error: `The deadline (${app.deadline}) has passed — reopening is not possible.` }
        }
        if (app.status !== 'Closed' && !app.lockDate) return { success: false, error: 'Only a closed or locked application needs reopening.' }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : { ...a, status: 'Published', lockDate: undefined, updatedAt: nowIso }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.reopened', message: `Application "${app.title}" reopened before its deadline.`,
          }),
        })
        return { success: true }
      },

      archiveApplication: (id, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.map((a) => a.id !== id ? a : { ...a, status: 'Archived', updatedAt: nowIso }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.archived', message: `Application "${app.title}" archived. Submissions, payments and audit history remain accessible.`,
          }),
        })
      },

      duplicateApplication: (id, actor) => {
        const state = get()
        const src = state.applications.find((a) => a.id === id)
        if (!src) return { success: false }
        const nowIso = new Date().toISOString()
        const copy: SchoolApplication = {
          ...structuredClone(src),
          id: newId('APP'),
          title: `${src.title} — Copy`,
          publishDate: undefined,
          startDate: undefined,
          deadline: '',
          eventDate: undefined,
          lockDate: undefined,
          payment: { ...src.payment, chargeId: undefined },
          formFields: src.formFields.map((f) => ({ ...f })),
          status: 'Draft',
          createdBy: actor,
          createdByRole: 'Principal',
          approvalNotes: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        set({
          applications: [copy, ...state.applications],
          audit: pushAudit(state, {
            ts: nowIso, applicationId: copy.id, actor, actorRole: 'Principal',
            action: 'application.duplicated', message: `Duplicated from "${src.title}" as a new draft.`,
          }),
        })
        return { success: true, application: copy }
      },

      // ── APPS-IA-1 (§6/§17): delete a DRAFT form (submissions make it a
      // permanent school record — the store refuses with an honest reason).
      deleteApplicationDraft: (id, actor) => {
        const state = get()
        const app = state.applications.find((a) => a.id === id)
        if (!app) return { success: false, error: 'Form not found.' }
        if (app.status !== 'Draft') {
          return { success: false, error: `This form is ${app.status.toLowerCase()} — submitted forms are school records. Close or archive it instead.` }
        }
        const submissions = state.submissions.filter((s) => s.applicationId === id)
        if (submissions.length > 0) {
          return { success: false, error: `${submissions.length} response${submissions.length === 1 ? '' : 's'} exist — this form cannot be deleted. Close it instead; responses stay on record.` }
        }
        const nowIso = new Date().toISOString()
        set({
          applications: state.applications.filter((a) => a.id !== id),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: id, actor, actorRole: 'Principal',
            action: 'application.deleted',
            message: `Draft form "${app.title}" deleted by ${actor} before publication (no submissions existed).`,
          }),
        })
        return { success: true }
      },

      submitApplication: (input) => {
        const state = get()
        const app = state.applications.find((a) => a.id === input.applicationId)
        if (!app) return { success: false, error: 'Application not found.' }
        if (!isSubmittable(app)) {
          return { success: false, error: `"${app.title}" is ${effectiveAppStatus(app)} — submissions are closed.` }
        }
        // Idempotency — one active submission per student per application.
        const existing = state.submissions.find(
          (s) => s.applicationId === input.applicationId && s.studentId === input.student.id && s.status !== 'Withdrawn',
        )
        if (existing) {
          return { success: true, existingSubmissionId: existing.id, submission: existing }
        }
        const nowIso = new Date().toISOString()
        const serialNo = nextTourSerial(app, state.submissions, input.student.className, input.student.gender)
        const sub: ApplicationSubmission = {
          id: newId('SUB'),
          applicationId: app.id,
          studentId: input.student.id,
          studentName: input.student.name,
          admissionNo: input.student.admissionNo,
          className: input.student.className,
          classId: input.student.classId,
          section: input.student.section,
          ...(input.student.rollNo ? { rollNo: input.student.rollNo } : {}),
          ...(input.student.dob ? { dob: input.student.dob } : {}),
          ...(input.student.gender ? { gender: input.student.gender } : {}),
          ...(input.student.bloodGroup ? { bloodGroup: input.student.bloodGroup } : {}),
          ...(input.student.address ? { address: input.student.address } : {}),
          guardianName: input.student.guardianName,
          guardianPhone: input.student.guardianPhone,
          serialNo,
          answers: input.answers,
          attachments: input.attachments,
          submittedAt: nowIso,
          submittedByRole: input.submittedByRole ?? 'Student',
          mode: 'Digital',
          status: 'Submitted',
          consentGivenAt: app.guardianConsent.required && input.consentAccepted ? nowIso : undefined,
          signature: input.signature,
          physicalDoc: {
            status: app.physicalSignatureRequired && app.guardianConsent.method === 'Physical Signature'
              ? 'Pending' : 'Not Required',
          },
          reviewNotes: [],
          resubmissionCount: 0,
          formVersion: app.formVersion ?? 1,
          updatedAt: nowIso,
        }
        set({
          submissions: [sub, ...state.submissions],
          audit: pushAudit(state, {
            ts: nowIso, applicationId: app.id, submissionId: sub.id,
            actor: input.student.name, actorRole: input.submittedByRole === 'Guardian' ? 'Guardian' : 'Student',
            action: 'submission.submitted',
            message: `${input.student.name} (${input.student.className}-${input.student.section}) submitted the application.`,
          }),
        })
        return { success: true, submission: sub }
      },

      withdrawSubmission: (submissionId, actor) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub) return { success: false, error: 'Submission not found.' }
        if (sub.status !== 'Submitted' && sub.status !== 'Under Review') {
          return { success: false, error: 'Only a not-yet-reviewed submission can be withdrawn.' }
        }
        const nowIso = new Date().toISOString()
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : { ...s, status: 'Withdrawn', updatedAt: nowIso }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole: 'Student',
            action: 'submission.withdrawn', message: `${sub.studentName} withdrew their submission.`,
          }),
        })
        return { success: true }
      },

      resubmitSubmission: (submissionId, answers, attachments, actor) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub) return { success: false, error: 'Submission not found.' }
        const app = state.applications.find((a) => a.id === sub.applicationId)
        if (!app) return { success: false, error: 'Application not found.' }
        if (sub.status !== 'Correction Required') return { success: false, error: 'This submission was not asked for corrections.' }
        if (!isSubmittable(app)) return { success: false, error: `"${app.title}" is locked — corrections are closed.` }
        const nowIso = new Date().toISOString()
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : {
            ...s,
            answers: answers ?? s.answers,
            ...(attachments !== undefined ? { attachments } : {}),
            status: 'Submitted' as const,
            resubmissionCount: s.resubmissionCount + 1,
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole: 'Student',
            action: 'submission.resubmitted', message: `${sub.studentName} resubmitted after correction.`,
          }),
        })
        return { success: true }
      },

      reviewSubmission: (submissionId, decision, note, actor, actorRole) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub) return { success: false, error: 'Submission not found.' }
        const app = state.applications.find((a) => a.id === sub.applicationId)
        if (!app) return { success: false, error: 'Application not found.' }
        if (sub.status === 'Withdrawn' || sub.status === 'Approved' || sub.status === 'Rejected') {
          return { success: false, error: `Submission is already ${sub.status.toLowerCase()}.` }
        }
        if (effectiveAppStatus(app) === 'Archived') {
          return { success: false, error: 'Application archived — records are read-only.' }
        }
        // TEACHER PERMISSION BOUNDARY: reviewing participation is fine;
        // moving money is impossible through this API by design. Approval
        // additionally REQUIRES payment completion when the form charges.
        const pay = deriveSubmissionPayment(app, sub)
        if (decision === 'approve') {
          if (!isConsentSatisfied(app, sub)) {
            return { success: false, error: 'Guardian consent is required before approval.' }
          }
          if (app.payment.mode === 'Required' && pay.status !== 'Paid') {
            return { success: false, error: `Payment (${app.payment.feeHeadLabel}) is still "${pay.status}". Complete payment first.` }
          }
        }
        const nowIso = new Date().toISOString()
        const nextStatus: SubmissionWorkflowStatus =
          decision === 'approve' ? 'Approved'
            : decision === 'reject' ? 'Rejected'
              : 'Correction Required'
        const kindMap = { approve: 'approval', reject: 'rejection', request_correction: 'correction' } as const
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : {
            ...s,
            status: nextStatus,
            reviewedBy: actor,
            reviewedAt: nowIso,
            updatedAt: nowIso,
            reviewNotes: [
              ...s.reviewNotes,
              { id: newId('RN'), at: nowIso, by: actor, role: actorRole, note: note.trim(), kind: kindMap[decision] },
            ],
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole,
            action: decision === 'approve' ? 'submission.approved'
              : decision === 'reject' ? 'submission.rejected' : 'submission.correction',
            message: decision === 'approve'
              ? `${sub.studentName}'s application approved by ${actor} (${actorRole}).`
              : decision === 'reject'
                ? `${sub.studentName}'s application rejected by ${actor} (${actorRole})${note.trim() ? ` — ${note.trim()}` : ''}.`
                : `Corrections requested from ${sub.studentName}${note.trim() ? ` — ${note.trim()}` : ''}.`,
          }),
        })
        return { success: true }
      },

      addReviewNote: (submissionId, note, actor, role) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub || !note.trim()) return
        const nowIso = new Date().toISOString()
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : {
            ...s,
            reviewNotes: [...s.reviewNotes, { id: newId('RN'), at: nowIso, by: actor, role, note: note.trim(), kind: 'note' }],
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole: role,
            action: 'application.note', message: `${role} note added on ${sub.studentName}'s submission.`,
          }),
        })
      },

      recordOfflineSubmission: (input) => {
        const state = get()
        const app = state.applications.find((a) => a.id === input.applicationId)
        if (!app) return { success: false, error: 'Application not found.' }
        const st = effectiveAppStatus(app)
        if (!(isSubmittable(app) || st === 'Closed')) {
          return { success: false, error: `This application (${st}) cannot accept offline records.` }
        }
        const existing = state.submissions.find(
          (s) => s.applicationId === input.applicationId && s.studentId === input.student.id && s.status !== 'Withdrawn',
        )
        if (existing) {
          return { success: false, error: 'A submission already exists for this student.', submission: existing }
        }
        const nowIso = new Date().toISOString()
        const serialNo = nextTourSerial(app, state.submissions, input.student.className, input.student.gender)
        const sub: ApplicationSubmission = {
          id: newId('SUB'),
          applicationId: app.id,
          studentId: input.student.id,
          studentName: input.student.name,
          admissionNo: input.student.admissionNo,
          className: input.student.className,
          classId: input.student.classId,
          section: input.student.section,
          ...(input.student.rollNo ? { rollNo: input.student.rollNo } : {}),
          ...(input.student.dob ? { dob: input.student.dob } : {}),
          ...(input.student.gender ? { gender: input.student.gender } : {}),
          ...(input.student.bloodGroup ? { bloodGroup: input.student.bloodGroup } : {}),
          ...(input.student.address ? { address: input.student.address } : {}),
          guardianName: input.student.guardianName,
          guardianPhone: input.student.guardianPhone,
          serialNo,
          answers: {}, // paper form — answers live on the signed physical document
          submittedAt: nowIso,
          submittedByRole: 'Office',
          mode: 'Physical',
          status: 'Submitted',
          physicalDoc: {
            status: 'Received',
            ...(input.attachmentName ? { fileName: input.attachmentName } : {}),
            receivedAt: nowIso,
            receivedBy: input.recordedBy,
          },
          reviewNotes: [],
          resubmissionCount: 0,
          formVersion: app.formVersion ?? 1,
          updatedAt: nowIso,
        }
        set({
          submissions: [sub, ...state.submissions],
          audit: pushAudit(state, {
            ts: nowIso, applicationId: app.id, submissionId: sub.id,
            actor: input.recordedBy, actorRole: input.recorderRole,
            action: 'submission.recorded',
            message: `Offline (paper) submission recorded for ${input.student.name}${input.attachmentName ? ` — scan "${input.attachmentName}" kept on file` : ''}.`,
          }),
        })
        return { success: true, submission: sub }
      },

      markDocumentReceived: (submissionId, fileName, actor, recorderRole) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub) return { success: false, error: 'Submission not found.' }
        const nowIso = new Date().toISOString()
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : {
            ...s,
            physicalDoc: { ...s.physicalDoc, status: 'Received', fileName, receivedAt: nowIso, receivedBy: actor },
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole: recorderRole,
            action: 'doc.received', message: `Signed document received for ${sub.studentName}: "${fileName}".`,
          }),
        })
        return { success: true }
      },

      verifyPhysicalDocument: (submissionId, actor) => {
        const state = get()
        const sub = state.submissions.find((s) => s.id === submissionId)
        if (!sub) return { success: false, error: 'Submission not found.' }
        if (sub.physicalDoc.status !== 'Received') {
          return { success: false, error: 'Receive the signed document before verifying it.' }
        }
        const nowIso = new Date().toISOString()
        set({
          submissions: state.submissions.map((s) => s.id !== submissionId ? s : {
            ...s,
            physicalDoc: { ...s.physicalDoc, status: 'Verified', verifiedAt: nowIso },
            updatedAt: nowIso,
          }),
          audit: pushAudit(state, {
            ts: nowIso, applicationId: sub.applicationId, submissionId,
            actor, actorRole: 'Principal',
            action: 'doc.verified', message: `Physical signature/document VERIFIED for ${sub.studentName}.`,
          }),
        })
        return { success: true }
      },
    }),
    {
      name: 'scholario-applications-v1',
      // v9 (AF-TPL) — tour sessions now print on one of TWO official A4
      // document layouts chosen at creation ('classic' | 'modern'). The
      // layout is fixed (no editor); pre-choice records default to the
      // classic office document. v8's field-set normalization and the
      // stale-id purge list remain authoritative.
      version: 9,
      storage: createTenantScopedStorage(TENANT_SCOPED_BASES.applications),
      // v4→v5 — (historical) Educational Tour scope rebuild: namespaces were
      // narrowed to Tour forms. v7 SUPERSEDES this — the module is general
      // again and every category survives migration. Snapshot fields added
      // in v5 (rollNo/dob/gender/bloodGroup/address) are optional and simply
      // absent on pre-migration records — the print document renders only
      // what exists.
      //
      // v5→v6 — APPS-FIN-LINK-1 demo hygiene: drop the three throwaway
      // dev-session tour applications (see applications-purge.ts) so
      // namespaces rehydrated from older builds hold the canonical dataset.
      // The submission/audit filters below then drop every orphan of a
      // dropped application, and the companion fee-store v12 migration purges
      // the matching Additional Charges + application-bound payments in the
      // same release so both sides of the linkage stay consistent.
      migrate: (persisted) => {
        const st = persisted as {
          applications?: SchoolApplication[]
          submissions?: ApplicationSubmission[]
          audit?: ApplicationAuditEvent[]
        } | undefined
        if (st?.applications) {
          // v7 (APPS-IA-1) — the module is GENERAL: keep every category
          // (previously only Tour forms survived this migration). The
          // stale-id purge list stays authoritative for demo hygiene.
          const purge = new Set<string>(STALE_APPLICATION_PURGE.applicationIds)
          st.applications = st.applications
            .filter((a) => !purge.has(a.id))
            .map((a) => ({
              ...a,
              source: a.source ?? 'Custom',
              createdByRole: a.createdByRole ?? 'Principal',
              approvalNotes: a.approvalNotes ?? [],
              // v8 (TOUR-1) — normalize the tour template's field set: the
              // built-in consent form is FIXED; legacy builder-era fields
              // (t-shirt size, photo consent…) are retired. Submissions keep
              // their answers — retired ids simply no longer render.
              formFields: (a.templateKey === 'educational_tour' || a.category === 'Tour' || a.category === 'Trip')
                ? TOUR_FORM_FIELDS.map((f) => ({ ...f }))
                : (a.formFields ?? []).map((f) => ({ ...f, section: f.section ?? 'Tour Preferences' })),
              // v9 (AF-TPL) — the two official A4 document layouts. Sessions
              // predating the choice keep the classic office document;
              // demo variety: sessions titled for Mysuru showcase 'modern'.
              docTemplate: a.docTemplate ?? (a.title?.toLowerCase().includes('mysuru') ? 'modern' : 'classic'),
            }))
        }
        if (st?.submissions && st.applications) {
          const ids = new Set(st.applications.map((a) => a.id))
          st.submissions = st.submissions.filter((s) => ids.has(s.applicationId))
        }
        if (st?.audit && st.applications) {
          const ids = new Set(st.applications.map((a) => a.id))
          st.audit = st.audit.filter((e) => ids.has(e.applicationId))
        }
        return st
      },
    },
  ),
)

// ─── Seed data (single Educational Tour, stable IDs) ───────────────────

function seedApplications(): SchoolApplication[] {
  const tour = APPLICATION_TEMPLATES.educational_tour
  return [
    {
      id: 'APP-JAIPUR-2026',
      title: 'Educational Tour — Jaipur',
      destination: 'Jaipur, Rajasthan',
      description: 'Three-day educational tour to Jaipur covering Amber Fort, City Palace and Jantar Mantar. Fee covers transport, boarding/lodging, entry tickets and insurance.',
      category: 'Tour',
      templateKey: 'educational_tour',
      source: 'Event',
      academicYear: YEAR,
      tourEndDate: '2026-10-10',
      durationDays: '3 Days / 2 Nights',
      circularNo: 'GW/EDU/TOUR/2026-27/07',
      circularDate: '2026-08-18',
      accompanyingStaff: 'Ms. Kavita Joshi (PGT History) · Mr. Deepak Nair (Sports Coach) · Ms. Farah Khan (Lady Attendant)',
      tourInstructions: 'Reporting time 6:00 AM at the school gate on the day of departure. Students must carry their school ID card, comfortable walking shoes and a light jacket. Electronic items above a smartphone are not permitted.',
      genderEligibility: 'All',
      paymentAvailability: 'Both',
      docTemplate: 'classic',
      targetClassIds: ['C11'],
      deadline: '2026-09-15',
      eventDate: '2026-10-08',
      participation: 'Optional',
      guardianConsent: {
        required: true,
        method: 'Physical Signature',
        statement: tour.consentStatement,
      },
      teacherApprovalRequired: true,
      physicalSignatureRequired: true,
      inChargeTeacherId: 'T-014',
      inChargeName: 'Rohan Mehta',
      payment: { mode: 'Required', amount: 2500, feeHeadLabel: 'Educational Tour — Jaipur', chargeId: 'AC-01' },
      formFields: tour.fields.map((f) => ({ ...f })),
      status: 'Published',
      createdBy: 'Dr. Ananya Iyer',
      createdByRole: 'Principal',
      approvalNotes: [],
      createdAt: '2026-08-20T09:35:00Z',
      updatedAt: '2026-08-22T10:00:00Z',
    },
    // AF-TPL — the second seeded session, printed on the Scholario Modern
    // A4 document (digital consent, Class 4) so a fresh demo shows BOTH
    // document layouts side by side.
    {
      id: 'APP-MYSURU-2026',
      title: 'Educational Tour — Mysuru',
      destination: 'Mysuru, Karnataka',
      description: 'Two-day educational tour to Mysuru covering the Mysore Palace, Chamundi Hills and the Regional Museum of Natural History. Fee covers transport, boarding, entry tickets and insurance.',
      category: 'Tour',
      templateKey: 'educational_tour',
      source: 'Event',
      academicYear: YEAR,
      tourEndDate: '2027-01-16',
      durationDays: '2 Days / 1 Night',
      circularNo: 'GW/EDU/TOUR/2026-27/09',
      circularDate: '2026-09-02',
      accompanyingStaff: 'Ms. Kavita Joshi (PGT History) · Ms. Farah Khan (Lady Attendant)',
      tourInstructions: 'Report at the school gate by 7:00 AM on the day of departure. Carry the school ID card, a water bottle and a cap.',
      genderEligibility: 'All',
      paymentAvailability: 'Both',
      docTemplate: 'modern',
      targetClassIds: ['C07'],
      deadline: '2026-12-20',
      eventDate: '2027-01-15',
      participation: 'Optional',
      guardianConsent: {
        required: true,
        method: 'Digital',
        statement: tour.consentStatement,
      },
      teacherApprovalRequired: true,
      physicalSignatureRequired: false,
      inChargeTeacherId: 'T-014',
      inChargeName: 'Rohan Mehta',
      payment: { mode: 'Required', amount: 1500, feeHeadLabel: 'Educational Tour — Mysuru', chargeId: 'AC-04' },
      formFields: tour.fields.map((f) => ({ ...f })),
      status: 'Published',
      createdBy: 'Dr. Ananya Iyer',
      createdByRole: 'Principal',
      approvalNotes: [],
      createdAt: '2026-09-02T09:40:00Z',
      updatedAt: '2026-09-03T10:00:00Z',
    },
  ]
}

/**
 * Seeds realistic submissions resolved from the canonical roster so student
 * identity snapshots match real Class 11 students — which makes their
 * payments resolve correctly inside Fee Management accounts. Safe to call
 * repeatedly; only seeds while both collections are empty.
 */
export function ensureApplicationSeedData(): void {
  try {
    const state = useApplicationsStore.getState()
    if (state.submissions.length > 0 || state.audit.length > 0) return
    const apps = state.applications.length > 0 ? state.applications : seedApplications()
    const students = useStudentsStore.getState().students.filter((s) => s.status === 'Active')
    const tour = apps.find((a) => a.id === 'APP-JAIPUR-2026')
    if (!tour) return

    const c11 = students.filter((s) => s.classId === 'C11').slice(0, 4)
    const _mkIdentity = (stu: typeof students[number]): StudentSubmissionIdentity => ({
      id: stu.id,
      name: stu.name,
      admissionNo: stu.admissionNo,
      className: stu.className,
      classId: stu.classId,
      section: stu.section,
      rollNo: stu.rollNo,
      dob: stu.dob,
      gender: stu.gender,
      bloodGroup: stu.bloodGroup,
      address: stu.address,
      guardianName: stu.guardianName,
      guardianPhone: stu.guardianPhone,
    })

    const answerSets: Array<Record<string, string | string[] | boolean>> = [
      { 't-meal': 'Vegetarian', 't-shirt': 'M', 't-emergency': 'Vikram Rao — 98110 22334', 't-medical': '', 't-photo': true },
      { 't-meal': 'Non-Vegetarian', 't-shirt': 'L', 't-emergency': 'Sunita Kaur — 98730 44556', 't-medical': 'Mild pollen allergy — carries antihistamine.', 't-photo': true },
      { 't-meal': 'Jain', 't-shirt': 'S', 't-emergency': '96432', 't-medical': '', 't-photo': false },
      { 't-meal': 'Vegetarian', 't-shirt': 'XL', 't-emergency': 'Mahesh Verma — 99100 55667', 't-medical': 'Lactose intolerant.', 't-photo': true },
    ]

    // Serials are assigned sequentially over the generated set (class +
    // gender aware) — the same rules as a live submission.
    const seeded: ApplicationSubmission[] = []
    for (const [i, stu] of c11.entries()) {
      const submittedAt = '2026-08-24T09:00:00Z'
      const isCorrection = i === 2
      seeded.push({
        id: `SUB-SEED-JP-${i + 1}`,
        applicationId: tour.id,
        studentId: stu.id,
        studentName: stu.name,
        admissionNo: stu.admissionNo,
        className: stu.className,
        classId: stu.classId,
        section: stu.section,
        rollNo: stu.rollNo,
        dob: stu.dob,
        gender: stu.gender,
        bloodGroup: stu.bloodGroup,
        address: stu.address,
        guardianName: stu.guardianName,
        guardianPhone: stu.guardianPhone,
        serialNo: nextTourSerial(tour, seeded, stu.className, stu.gender),
        answers: answerSets[i % answerSets.length],
        submittedAt,
        submittedByRole: 'Student' as const,
        mode: 'Digital' as const,
        status: (isCorrection ? 'Correction Required' : 'Submitted') as SubmissionWorkflowStatus,
        physicalDoc: { status: tour.physicalSignatureRequired && tour.guardianConsent.method === 'Physical Signature' ? 'Pending' as const : 'Not Required' as const },
        reviewNotes: isCorrection ? [{
          id: 'RN-SEED-1', at: '2026-08-25T10:30:00Z', by: 'Rohan Mehta', role: 'Teacher' as const,
          note: 'Emergency contact number looks incomplete — please re-enter the full 10-digit mobile number.', kind: 'correction' as const,
        }] : [],
        resubmissionCount: 0,
        formVersion: 1,
        updatedAt: submittedAt,
      })
    }
    const out = seeded

    // AF-TPL — Mysuru (Scholario Modern document) submissions: two Class 4
    // applicants through the digital-consent flow. The demo student (STU-18,
    // Class 4-B) is deliberately NOT seeded so the live apply wizard stays
    // available on a fresh demo.
    const mysuru = apps.find((a) => a.id === 'APP-MYSURU-2026')
    if (mysuru) {
      const c07 = students.filter((s) => s.classId === 'C07').slice(0, 2)
      const mysuruAnswers: Array<Record<string, string | string[] | boolean>> = [
        { 't-meal': 'Vegetarian', 't-motion': false, 't-emergency': 'Ramesh Iyer — 98450 12345', 't-medical': '' },
        { 't-meal': 'Jain', 't-motion': true, 't-emergency': 'Priya Nair — 99020 33445', 't-medical': 'Bus-sickness — carries medication for long drives.' },
      ]
      const mysuruSubs: ApplicationSubmission[] = []
      for (const [i, stu] of c07.entries()) {
        const submittedAt = '2026-09-03T10:30:00Z'
        mysuruSubs.push({
          id: `SUB-SEED-MY-${i + 1}`,
          applicationId: mysuru.id,
          studentId: stu.id,
          studentName: stu.name,
          admissionNo: stu.admissionNo,
          className: stu.className,
          classId: stu.classId,
          section: stu.section,
          rollNo: stu.rollNo,
          dob: stu.dob,
          gender: stu.gender,
          bloodGroup: stu.bloodGroup,
          address: stu.address,
          guardianName: stu.guardianName,
          guardianPhone: stu.guardianPhone,
          serialNo: nextTourSerial(mysuru, mysuruSubs, stu.className, stu.gender),
          answers: mysuruAnswers[i % mysuruAnswers.length],
          submittedAt,
          submittedByRole: 'Student' as const,
          mode: 'Digital' as const,
          status: 'Submitted' as SubmissionWorkflowStatus,
          physicalDoc: { status: 'Not Required' as const },
          reviewNotes: [],
          resubmissionCount: 0,
          formVersion: 1,
          updatedAt: submittedAt,
        })
      }
      out.push(...mysuruSubs)
    }

    useApplicationsStore.setState({
      submissions: out,
      audit: out.length ? SEED_APP_AUDIT() : [],
    })
  } catch {
    /* roster unavailable — skip seeding silently */
  }
}

function SEED_APP_AUDIT(): ApplicationAuditEvent[] {
  return [
    {
      id: 'AEV-SEED-1', ts: '2026-08-22T09:00:00Z', applicationId: 'APP-JAIPUR-2026',
      actor: 'Dr. Ananya Iyer', actorRole: 'Principal', action: 'application.published',
      message: 'Linked to existing charge "Educational Tour — Jaipur" (₹2,500). Deadline 2026-09-15.',
    },
    {
      id: 'AEV-SEED-2', ts: '2026-08-25T10:30:00Z', applicationId: 'APP-JAIPUR-2026', submissionId: 'SUB-SEED-JP-3',
      actor: 'Rohan Mehta', actorRole: 'Teacher', action: 'submission.correction',
      message: 'Corrections requested from a Class 11 applicant — emergency contact incomplete.',
    },
    {
      id: 'AEV-SEED-3', ts: '2026-09-03T09:00:00Z', applicationId: 'APP-MYSURU-2026',
      actor: 'Dr. Ananya Iyer', actorRole: 'Principal', action: 'application.published',
      message: 'Published on the Scholario Modern A4 document — linked charge "Educational Tour — Mysuru" (₹1,500). Deadline 2026-12-20.',
    },
    {
      id: 'AEV-SEED-4', ts: '2026-09-03T10:30:00Z', applicationId: 'APP-MYSURU-2026', submissionId: 'SUB-SEED-MY-1',
      actor: 'System', actorRole: 'Principal', action: 'submission.submitted',
      message: 'Two Class 4 applications received with digital guardian consent — awaiting payment.',
    },
  ]
}

// ─── Examinations module integration (architecture, retained) ──────────
//
// Called automatically by the Examinations module when a created exam
// REQUIRES an application form. The generated record is the SAME generic
// SchoolApplication entity (never a special-cased implementation) with
// source 'Examination' and a permanent sourceRef back to the exam, so the
// future Super Admin template catalogue can govern it. Idempotent.

export interface ExaminationFormRequest {
  examId: string
  examName: string
  examType?: string
  classIds: string[]
  classLabel?: string
  endDate?: string | null
  inChargeTeacherId?: string
  inChargeName?: string
  actor?: string
}

export function createExaminationFormApplication(
  input: ExaminationFormRequest,
): { success: boolean; applicationId?: string; error?: string; alreadyLinked?: boolean } {
  try {
    const state = useApplicationsStore.getState()
    // IDEMPOTENT — an application for this exam already exists → keep it.
    const existing = state.applications.find(
      (a) => a.source === 'Examination' && a.sourceRef?.id === input.examId,
    )
    if (existing) return { success: true, applicationId: existing.id, alreadyLinked: true }

    // Deadline: two weeks after the exam ends (or 30 days out when the exam
    // has no end date) — always a real, future, editable date.
    const base = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : new Date()
    if (Number.isNaN(base.getTime())) base.setTime(Date.now())
    if (!input.endDate) base.setTime(Date.now() + 30 * 86_400_000)
    const deadline = new Date(base.getTime() + 14 * 86_400_000).toISOString().slice(0, 10)

    const title = `${input.examName} — Application Form`
    const actor = input.actor ?? 'Dr. Ananya Iyer'
    const res = useApplicationsStore.getState().createApplication(
      {
        title,
        description: `Auto-generated from the Examinations module for "${input.examName}"${input.examType ? ` (${input.examType})` : ''}. Confirmation of entry, answer-sheet medium and examination-day contact details. This form remains linked to its examination.`,
        category: 'Exam Application',
        source: 'Examination',
        sourceRef: { module: 'Examinations', id: input.examId, label: input.examName },
        academicYear: CURRENT_ACADEMIC_YEAR,
        targetClassIds: [...input.classIds],
        deadline,
        participation: 'Mandatory',
        guardianConsentRequired: false,
        guardianConsentMethod: 'Digital',
        teacherApprovalRequired: true,
        physicalSignatureRequired: false,
        inChargeTeacherId: input.inChargeTeacherId,
        inChargeName: input.inChargeName,
        // Exam fees are governed by the Fee Structure (examFeeSchedule) —
        // the generated form starts free so no double-charge can occur.
        paymentMode: 'None',
        paymentAmount: 0,
        paymentFeeHeadLabel: '',
        formFields: [
          { id: `f-xm-${Math.random().toString(36).slice(2, 7)}`, type: 'text', label: 'Board Registration Number', helpText: 'Leave blank if not yet allotted.', required: false, section: 'Application Details' },
          { id: `f-xm-${Math.random().toString(36).slice(2, 7)}`, type: 'dropdown', label: 'Medium of answer sheet', required: true, options: ['English', 'Hindi'], section: 'Application Details' },
          { id: `f-xm-${Math.random().toString(36).slice(2, 7)}`, type: 'emergency-contact', label: 'Emergency Contact (examination days)', required: true, section: 'Medical / Emergency Details' },
        ],
      },
      actor,
      { actorRole: 'Principal' },
    )
    if (!res.success || !res.application) return { success: false, error: res.error }
    return { success: true, applicationId: res.application.id }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Could not generate the examination form.' }
  }
}
