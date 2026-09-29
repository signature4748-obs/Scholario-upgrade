/**
 * fee-store-data — seed + default data for the Fee store.
 *
 * FEE-POLICY 2026-27 (canonical, single source of truth for demo data):
 *   Monthly Tuition ......... ₹250 N–C8 · ₹300 C9–10 · ₹400 C11–12
 *   Examination Fee ........ session-wide: ₹700 (N–C5) · ₹900 (C8–10) · ₹1,000 (C11–12)
 *                            split across the 6 planned examinations.
 *                            Class 6 & 7 intentionally left UNCONFIGURED (₹0).
 *   Board Form Fee ......... ₹1,500 one-time — only Class 10 / Class 12
 *   Registration Fee ....... ₹300 one-time — only Class 9 / Class 11 entry points
 *   Transport .............. ₹500/month — charged ONLY when a student is
 *                            actually enrolled in transport (engine gate).
 *   Management & Maint ..... ₹500/year — every student. Annual: never ×12.
 *   Subject/Practical ...... ₹300 per applicable lab subject per session
 *                            (Physics / Chemistry / Biology) — senior-secondary
 *                            science streams only.
 *   Admission Fee .......... policy-driven, NOT billed with regular fees:
 *                            ₹500 one-time, charged only to the students the
 *                            entry-fee policy includes
 *                            (see DEFAULT_ENTRY_FEE_POLICY + admissionFeeFor()).
 *
 * Extracted from fee-store.ts (V6 modularization pass). Behaviour-preserving:
 * fee-store.ts re-exports previously public symbols so imports keep working.
 */

import type {
  FeeHead, ExamFeeSchedule, FeeStructureConfig, FeeStructureVersion,
  FeeTransaction, CashRequest, AuditRecord, PaymentModeConfig, LateFeeRule,
  ConcessionRule, ReceiptSettings, GatewayConfig, BankAccount, UpiQrConfig,
  Settlement, ReconciliationRecord, WebhookEvent, AdditionalCharge,
  StudentConcession,
} from './fee-store'
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
import { SS } from './students-store/seed-data'
// SaaS-STAGE-2A — the seed factory is TENANT-AWARE: each school's namespace
// is seeded with its own exam pattern (Pattern A vs B) from the tenant
// registry. No store cloning — one builder, per-tenant output.
import { getActiveTenantSync } from '@/lib/tenant/active-tenant'

/**
 * CURRENT_ACADEMIC_YEAR — single source of truth for the fee session label.
 *
 * The demo dataset (transactions, ledger dates, receipt numbers, gateway
 * settlements) is seeded inside this session; runtime writers (recordPayment,
 * approveCashRequest) and the useFeeData default stamp new records with the
 * same label so today's collections always land in the live session view.
 */
export const CURRENT_ACADEMIC_YEAR = '2026-2027'

export const FREQUENCY_MULTIPLIER: Record<FeeHead['frequency'], number> = {
  'Annual': 1,
  'Half-Yearly': 2,
  'Quarterly': 4,
  'Monthly': 12,
  'Per Term': 3, // assuming 3 terms per academic year
  'One-Time': 1,
}

/** All valid frequency values (used for runtime validation in mutations). */
export const VALID_FREQUENCIES: FeeHead['frequency'][] = [
  'Annual', 'Half-Yearly', 'Quarterly', 'Monthly', 'Per Term', 'One-Time',
]

// ─── Fee policy constants ─────────────────────────────────────────────

export const FEE_POLICY = {
  tuitionByGrade: { early: 250, middle: 250, secondary: 300, seniorSecondary: 400 },
  examSessionSplit: {
    // Pattern A reference values (4 Unit Tests + Half-Yearly + Annual).
    // Pattern B schools (quarterly-hy-annual) get their tier-scaled rows
    // from examSplitForActiveTenant() below — see SaaS-STAGE-2A §7.
    /** N–C5 → ₹700 total across the six examinations */
    early: [{ examType: 'Unit Test', amount: 100, plannedInstances: 4 }, { examType: 'Half-Yearly', amount: 150 }, { examType: 'Annual Examination', amount: 150 }],
    /** C8–C10 → ₹900 total */
    secondary: [{ examType: 'Unit Test', amount: 125, plannedInstances: 4 }, { examType: 'Half-Yearly', amount: 200 }, { examType: 'Annual Examination', amount: 200 }],
    /** C11–C12 → ₹1,000 total */
    senior: [{ examType: 'Unit Test', amount: 150, plannedInstances: 4 }, { examType: 'Half-Yearly', amount: 200 }, { examType: 'Annual Examination', amount: 200 }],
  } as Record<'early' | 'secondary' | 'senior', Array<{ examType: string; amount: number; plannedInstances?: number }>>,
  transportMonthly: 500,
  managementAnnual: 500,
  boardFormFee: 1500,
  registrationFee: 300,
  // SaaS-STAGE-2A §6 — optional-head seed amounts (Books / Uniform).
  booksFee: 2500,
  uniformFee: 1800,
  practicalFeePerSubject: 300,
} as const

/** Lab subjects per senior-secondary science stream → practical fee heads. */
const STREAM_PRACTICAL_SUBJECTS: Record<string, string[]> = {
  PCM: ['Physics Practical Fee', 'Chemistry Practical Fee'],
  PCB: ['Physics Practical Fee', 'Chemistry Practical Fee', 'Biology Practical Fee'],
}

/** Master catalogue ids (src/lib/store/school-settings-store/initial-state.ts). */
const CATALOGUE = { tuition: 'fh-1', registration: 'fh-2', mgmt: 'fh-9', transport: 'fh-7', board: 'fh-8', physPrac: 'fh-17', chemPrac: 'fh-18', bioPrac: 'fh-19', books: 'fh-20', uniform: 'fh-21' }

function tuitionFor(c: { grade: number }): number {
  return c.grade >= 11 ? FEE_POLICY.tuitionByGrade.seniorSecondary
    : c.grade >= 9 ? FEE_POLICY.tuitionByGrade.secondary
    : FEE_POLICY.tuitionByGrade.early
}

function streamOf(classId: string): string | undefined {
  const m = classId.match(/-(PCM|PCB)$/)
  return m?.[1]
}

// ─── SaaS-STAGE-2A — tenant-aware examination pattern (§7/§8) ──────────
//
// The exam fee split seeded into each structure follows the ACTIVE
// school's examination template:
//   Pattern A (ut4-hy-annual)  → 4 Unit Tests + Half-Yearly + Annual
//   Pattern B (quarterly-hy-annual) → Quarterly + Half-Yearly + Annual
// Pattern A keeps the historical tier table verbatim (demo-school values);
// Pattern B uses its own tier-scaled amounts. Fee configuration here is
// NOT exam creation — actual exams live in the Examination module.
const PATTERN_B_SPLIT: Record<'early' | 'secondary' | 'senior', Array<{ examType: string; amount: number; plannedInstances?: number }>> = {
  early: [{ examType: 'Quarterly', amount: 200 }, { examType: 'Half-Yearly', amount: 200 }, { examType: 'Annual Examination', amount: 250 }],
  secondary: [{ examType: 'Quarterly', amount: 250 }, { examType: 'Half-Yearly', amount: 250 }, { examType: 'Annual Examination', amount: 300 }],
  senior: [{ examType: 'Quarterly', amount: 300 }, { examType: 'Half-Yearly', amount: 300 }, { examType: 'Annual Examination', amount: 350 }],
}

function examSplitForActiveTenant(tier: 'early' | 'secondary' | 'senior') {
  const templateId = getActiveTenantSync().feeProfile.examTemplateId
  return templateId === 'quarterly-hy-annual' ? PATTERN_B_SPLIT[tier] : FEE_POLICY.examSessionSplit[tier]
}

/**
 * Build one FeeStructureConfig per canonical class. Every active student in
 * the roster now has an EXACT structure match, so the legacy student.feeTotal
 * fallback no longer fires for seeded classes.
 *
 * The cached `annual` field is the BASE total (all mandatory active heads EXCLUDING
 * the conditional Transport head) — the per-student payable adds Transport back
 * only for students actually enrolled (`computeAccount` gate).
 */
function buildStructures(): FeeStructureConfig[] {
  let fhSeq = 100 // head-id counter (FH1xx) to avoid collisions with legacy ids
  const nextHeadId = () => `FH${(fhSeq += 1)}`

  return ACADEMIC_CLASSES.map((c) => {
    const level = c.level
    const isSeniorStream = Boolean(streamOf(c.id))
    // Exam session band follows the ACTIVE TENANT'S examination pattern
    // (SaaS-STAGE-2A §7/§8). C6/C7 intentionally UNCONFIGURED (₹0, per
    // school policy).
    const examUnconfigured = c.grade === 6 || c.grade === 7
    const examRows = examUnconfigured
      ? []
      : c.grade >= 11 || isSeniorStream
        ? examSplitForActiveTenant('senior')
        : c.grade >= 8
          ? examSplitForActiveTenant('secondary')
          : examSplitForActiveTenant('early')

    const components: FeeHead[] = [
      { id: nextHeadId(), name: 'Tuition', amount: tuitionFor(c), frequency: 'Monthly', mandatory: true, active: true, catalogueId: CATALOGUE.tuition, category: 'Tuition' },
      { id: nextHeadId(), name: 'Management & Maintenance', amount: FEE_POLICY.managementAnnual, frequency: 'Annual', mandatory: true, active: true, catalogueId: CATALOGUE.mgmt, category: 'Other' },
      { id: nextHeadId(), name: 'Transport', amount: FEE_POLICY.transportMonthly, frequency: 'Monthly', mandatory: false, active: true, catalogueId: CATALOGUE.transport, category: 'Transport' },
      // SaaS-STAGE-2A §6 — OPTIONAL heads. Books & Uniform exist in every
      // structure as OPTIONAL (mandatory: false): they are catalogue
      // offerings, NOT universal charges. isHeadApplicableToStudent keeps
      // them out of every student's auto-billed dues until an explicit
      // per-student applicability exists (student-level opt-in, later
      // stage). baseTotal below already excludes non-mandatory heads, so
      // seeded dues stay consistent.
      { id: nextHeadId(), name: 'Books & Material', amount: FEE_POLICY.booksFee, frequency: 'One-Time', mandatory: false, active: true, catalogueId: CATALOGUE.books, category: 'Other' },
      { id: nextHeadId(), name: 'Uniform & Sports Kit', amount: FEE_POLICY.uniformFee, frequency: 'Annual', mandatory: false, active: true, catalogueId: CATALOGUE.uniform, category: 'Other' },
    ]

    if (c.grade === 9 || c.grade === 11) {
      components.push({ id: nextHeadId(), name: 'Registration Fee', amount: FEE_POLICY.registrationFee, frequency: 'One-Time', mandatory: true, active: true, catalogueId: CATALOGUE.registration, category: 'Admission' })
    }
    if (c.grade === 10 || c.grade === 12) {
      components.push({ id: nextHeadId(), name: 'Board Form Fee', amount: FEE_POLICY.boardFormFee, frequency: 'One-Time', mandatory: true, active: true, catalogueId: CATALOGUE.board, category: 'Board' })
    }
    for (const subject of STREAM_PRACTICAL_SUBJECTS[streamOf(c.id) ?? ''] ?? []) {
      const cid = subject.startsWith('Physics') ? CATALOGUE.physPrac : subject.startsWith('Chemistry') ? CATALOGUE.chemPrac : CATALOGUE.bioPrac
      components.push({ id: nextHeadId(), name: subject, amount: FEE_POLICY.practicalFeePerSubject, frequency: 'Annual', mandatory: true, active: true, catalogueId: cid, category: 'Lab' })
    }

    const baseTotal = components
      .filter((h) => h.active && h.mandatory && h.category !== 'Transport')
      .reduce((sum, h) => sum + h.amount * (FREQUENCY_MULTIPLIER[h.frequency] ?? 1), 0)

    const displayName = streamOf(c.id) ? `${c.name} — Science (${streamOf(c.id)})` : c.name

    return {
      id: `FS-${c.id}`,
      category: level,
      className: displayName,
      classLevel: level,
      classId: c.id,
      applicableClassIds: [c.id],
      annual: baseTotal,
      effectiveFrom: '2026-04-01',
      version: 1,
      // STRUCT-SESSION: every seeded structure belongs to the live session.
      academicYear: CURRENT_ACADEMIC_YEAR,
      components,
      examFeeSchedule: examRows.map((row, i) => ({
        id: `EF-FS-${c.id}-${String(i + 1).padStart(2, '0')}`,
        examType: row.examType,
        amount: row.amount,
        plannedInstances: row.plannedInstances ?? 1,
        mandatory: true,
        active: true,
      })),
    }
  })
}

export const FEE_STRUCTURES: FeeStructureConfig[] = buildStructures()

// ─── Helper: compute ACADEMIC YEAR TOTAL of active fee heads ────────
//
// Fix 2 (FEE-CORRECT): the per-period `amount` (e.g. ₹300 Monthly Tuition)
// is multiplied by `FREQUENCY_MULTIPLIER[h.frequency]` so the returned
// figure is the ANNUAL total (e.g. ₹3,600). Accepts an OPTIONAL list of
// pre-filtered heads (callers that apply per-student applicability gates
// pass the filtered subset — see `isHeadApplicableToStudent`).

export function computeHeadsTotal(heads: FeeHead[]): number {
  return heads
    .filter((h) => h.active)
    .reduce((sum, h) => sum + h.amount * (FREQUENCY_MULTIPLIER[h.frequency] ?? 1), 0)
}

/** Structure-level BASE annual (mandatory heads, conditional Transport excluded). */
export function computeStructureBaseTotal(structure: Pick<FeeStructureConfig, 'components'>): number {
  return structure.components
    .filter((h) => h.active && h.mandatory && h.category !== 'Transport')
    .reduce((sum, h) => sum + h.amount * (FREQUENCY_MULTIPLIER[h.frequency] ?? 1), 0)
}

/**
 * Per-student head applicability gate (FEE-POLICY + SaaS-STAGE-2A §6 +
 * optional-head APPLICABILITY BOUNDARY):
 *
 *   CATALOGUE  → available fee type (master definitions)
 *   STRUCTURE  → fee configured/offered for the class
 *   STUDENT    → fee actually applicable to THIS student (this gate)
 *   LEDGER     → actual charge (computeAccount, only for applicable heads)
 *
 *   Transport → charged ONLY when the student is actually enrolled
 *   (student.transport) — never because the head exists in the structure.
 *   OPTIONAL heads (mandatory === false — e.g. Books & Material, Uniform
 *     & Sports Kit) are NEVER auto-billed. They become applicable ONLY
 *     through an explicit per-student opt-in (`opts.optedInHeadIds` —
 *     fee-store.optionalHeadApplicability), so "Catalogue Books Fee ≠
 *     every student's Books Fee". Omitting `opts` keeps the strict
 *     never-auto-bill behaviour (aggregate/defensive callers).
 *   Everything else follows from structure membership (stream-level
 *   practicals are already bound via applicableClassIds).
 */
export function isHeadApplicableToStudent(
  head: Pick<FeeHead, 'id' | 'category' | 'name' | 'mandatory'>,
  student: { transport?: boolean; hostel?: boolean } | null | undefined,
  opts?: { optedInHeadIds?: string[] },
): boolean {
  // Defensive aggregate path (no student context) — exclude conditional
  // and optional charges.
  if (!student) return head.category !== 'Transport' && head.mandatory !== false
  if (head.category === 'Transport') return Boolean(student.transport)
  // Optional heads require an explicit per-student opt-in — they must not
  // silently become payable for everyone.
  if (head.mandatory === false) {
    return Boolean(opts?.optedInHeadIds?.includes(head.id))
  }
  return true
}

// ─── BILLING SCHEDULE ENGINE (frequency-aware accounting layer) ────────
//
// The ACCOUNTING layer must understand the actual billing frequency: a
// ₹250/month Tuition is APR ₹250 + MAY ₹250 + … (12 scheduled charges),
// not one pretend "Annual Tuition ₹3,000". The UI may keep summarising
// ₹3,000/yr — totals are IDENTICAL either way; only the ledger's
// granularity becomes honest. One-Time heads emit exactly ONE charge so
// an Admission Fee ₹5,000 one-time can never become ₹5,000 every month.

/** Day of month a period's fee falls due (school policy). */
export const BILLING_DUE_DAY = 10

/** One scheduled billing period of the academic session (April–March). */
export interface BillingPeriod {
  /** Human label, e.g. "Apr 2026". */
  label: string
  /** ISO due date (yyyy-mm-dd), e.g. "2026-04-10". */
  date: string
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Scheduled billing periods for a frequency within an academic session
 * (Apr→Mar). Monthly = 12, Quarterly = 4 (Apr/Jul/Oct/Jan), Per Term = 3
 * (Apr/Aug/Dec), Half-Yearly = 2 (Apr/Oct), Annual = 1 (Apr), One-Time = 1
 * (Apr — charged once, at session start).
 */
export function billingPeriodsFor(frequency: FeeHead['frequency'], sessionStartYear: number): BillingPeriod[] {
  // Start month index (0-based): April = 3.
  const monthOffsets: Record<FeeHead['frequency'], number[]> = {
    'Monthly': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Quarterly': [0, 3, 6, 9],
    'Per Term': [0, 4, 8],
    'Half-Yearly': [0, 6],
    'Annual': [0],
    'One-Time': [0],
  }
  return monthOffsets[frequency].map((offset) => {
    const month = (3 + offset) % 12
    const year = sessionStartYear + Math.floor((3 + offset) / 12)
    return {
      label: `${MONTH_SHORT[month]} ${year}`,
      date: `${year}-${String(month + 1).padStart(2, '0')}-${String(BILLING_DUE_DAY).padStart(2, '0')}`,
    }
  })
}

/** One per-period (or per-instance) scheduled charge emitted to the ledger. */
export interface ScheduledCharge {
  date: string
  feeHead: string
  amount: number
  description: string
  /** Ledger entryType — exam-like heads keep their Exam Fee type. */
  entryType: 'core' | 'exam'
  /** Whether the charge originates from a MANDATORY head (drives the
   *  late-fee rule's appliesTo='mandatory_only' behaviour). Optional
   *  opt-in heads and Transport are never late-fee'd under that policy. */
  fromMandatoryHead: boolean
  /** True for Additional-Charge lines — never late-fee'd (they carry
   *  their own due dates and event semantics). */
  isAdditional?: boolean
}

/**
 * Expand ONE recurring fee head into its scheduled per-period charges.
 * Σ(amount per period) === amount × FREQUENCY_MULTIPLIER — the annual
 * total every summary shows is unchanged; only granularity is honest.
 */
export function expandHeadChargeEntries(head: FeeHead, sessionStartYear: number): ScheduledCharge[] {
  const isExamLike = head.category === 'Exam' || head.category === 'Board' || /exam/i.test(head.name)
  return billingPeriodsFor(head.frequency, sessionStartYear).map((p) => ({
    date: p.date,
    feeHead: head.name,
    amount: head.amount,
    description: `${head.frequency} charge — ${head.name} · ${p.label}`,
    entryType: isExamLike ? ('exam' as const) : ('core' as const),
    fromMandatoryHead: head.mandatory !== false,
  }))
}

/**
 * Expand ONE exam-fee schedule entry into PER-INSTANCE scheduled charges
 * (Unit Test × 4 → four lines). EXAM FEE CONFIGURATION ≠ ACTUAL
 * EXAMINATION EVENT: the description marks the charge as SCHEDULED — the
 * schedule creates the fee plan, the Examination module conducts the
 * exams. All instances are dated at session start (the fee schedule is
 * a session-level plan; no fake exam dates are invented).
 */
export function expandExamChargeEntries(
  entry: { id: string; examType: string; amount: number; plannedInstances?: number },
  sessionStartYear: number,
): ScheduledCharge[] {
  const instances = entry.plannedInstances ?? 1
  const start = `${sessionStartYear}-04-${String(BILLING_DUE_DAY).padStart(2, '0')}`
  return Array.from({ length: instances }, (_, i) => ({
    date: start,
    feeHead: `Exam Fee — ${entry.examType}`,
    amount: entry.amount,
    description: instances > 1
      ? `Scheduled per-exam fee — ${entry.examType} (instance ${i + 1} of ${instances}) · charged when conducted`
      : `Scheduled per-exam fee — ${entry.examType} · charged when conducted`,
    entryType: 'exam' as const,
    fromMandatoryHead: true,
  }))
}

/**
 * Compute the TOTAL of all active exam fee schedule entries.
 * Each entry is a per-examination charge (NOT frequency-multiplied);
 * total = Σ amount × plannedInstances over active entries.
 */
export function computeExamFeeTotal(schedule: ExamFeeSchedule | undefined | null): number {
  if (!schedule || schedule.length === 0) return 0
  return schedule
    .filter((e) => e.active)
    .reduce((sum, e) => sum + e.amount * (e.plannedInstances ?? 1), 0)
}

// ─── One-time entry fees (admission events ONLY — never monthly billing) ──
//
// Model (WHAT vs WHO kept strictly separate):
//   · WHAT the fee is  → the Fee Head Catalogue (headId) + the canonical
//     amount (admission: policy.admissionAmount — the value the admission
//     engine charges; registration: the published fee structures).
//   · WHO it applies to → EntryFeeAudience, an extensible applicability
//     rule that can express: everyone, selected classes, one gender,
//     or classes ∩ gender. Sections can slot in later without a model
//     change (classIds already point at canonical AcademicClassDef ids).

export type EntryFeeGender = 'boys' | 'girls'
export type EntryFeeScope = 'all' | 'classes' | 'gender' | 'classes_gender'

export interface EntryFeeAudience {
  scope: EntryFeeScope
  /** Required when the scope involves gender. */
  gender?: EntryFeeGender
  /** Canonical AcademicClassDef ids — required when the scope involves classes. */
  classIds?: string[]
}

export interface EntryFeeRule {
  /** Stable id — 'admission' and 'registration' are seeded; future entry fees extend the list. */
  id: string
  /** Fee Head Catalogue id this rule points at (canonical fee identity). */
  headId: string
  /** WHO receives the fee. */
  applies: EntryFeeAudience
}

export interface EntryFeePolicy {
  enabled: boolean
  /** Canonical one-time admission amount (the value admissionFeeFor charges). */
  admissionAmount: number
  rules: EntryFeeRule[]
}

/** The demo school's policy: admission fee for boys; registration at the
 *  Class 9 / Class 11 entry points (both streams). */
export const DEFAULT_ENTRY_FEE_POLICY: EntryFeePolicy = {
  enabled: true,
  admissionAmount: 500,
  rules: [
    { id: 'admission', headId: 'fh-2', applies: { scope: 'gender', gender: 'boys' } },
    { id: 'registration', headId: 'fh-2', applies: { scope: 'classes', classIds: ['C12', 'C14-PCM', 'C14-PCB'] } },
  ],
}

/** Does this applicability rule include the given student? The ONE matcher
 *  every entry-fee decision goes through (admission engine + previews). */
export function entryFeeApplies(
  audience: EntryFeeAudience,
  input: { gender?: string; classId?: string; className?: string },
): boolean {
  const wantsGender = audience.scope === 'gender' || audience.scope === 'classes_gender'
  const wantsClasses = audience.scope === 'classes' || audience.scope === 'classes_gender'
  if (wantsGender) {
    const g = (input.gender ?? '').toLowerCase()
    const isBoy = g === 'male' || g === 'boy'
    const isGirl = g === 'female' || g === 'girl'
    if (audience.gender === 'boys' && !isBoy) return false
    if (audience.gender === 'girls' && !isGirl) return false
  }
  if (wantsClasses) {
    const ids = audience.classIds ?? []
    if (ids.length === 0) return false
    if (input.classId && ids.includes(input.classId)) return true
    // Fall back to class-name matching (students without a classId).
    if (input.className) {
      const named = ACADEMIC_CLASSES.filter((c) => ids.includes(c.id)).map((c) => c.name)
      if (named.includes(input.className)) return true
    }
    return false
  }
  return true
}

/**
 * One-time admission fee for a student under the current policy.
 * Amount comes from policy.admissionAmount; eligibility from the
 * 'admission' rule's applicability. ₹0 when disabled / not applicable.
 */
export function admissionFeeFor(
  policy: EntryFeePolicy,
  input: { gender?: string; classId?: string; className?: string },
): number {
  if (!policy.enabled) return 0
  const rule = policy.rules.find((r) => r.id === 'admission')
  if (!rule) return 0
  return entryFeeApplies(rule.applies, input) ? policy.admissionAmount : 0
}

// ─── ADDITIONAL CHARGES seed ──────────────────────────────────────────
//
// Event-based / special collections that exist INDEPENDENTLY of the
// per-class annual fee structures. Payments against them carry
// category='ADDITIONAL' and never reduce core fee outstanding.
export const SEED_ADDITIONAL_CHARGES: AdditionalCharge[] = [
  {
    id: 'AC-01',
    name: 'Educational Tour — Jaipur',
    category: 'Tour',
    amount: 2500,
    academicYear: '2026-2027',
    applicableClassIds: ['C11'],
    dueDate: '2026-09-15',
    mandatory: false,
    description: 'Three-day educational tour to Jaipur (transport, stay, entry fees). Opt-out possible — inform the class teacher.',
    reference: 'Jaipur Educational Tour 2026',
    createdBy: 'Principal',
    createdAt: '2026-08-20T09:30:00Z',
    status: 'Active',
  },
  {
    id: 'AC-02',
    name: 'Robotics Workshop',
    category: 'Workshop',
    amount: 1000,
    academicYear: '2026-2027',
    applicableClassIds: ['C12'],
    dueDate: '2026-10-30',
    mandatory: true,
    description: 'Two-day robotics workshop conducted with an external partner. Kit included.',
    reference: 'Science Club — Autumn Workshop',
    createdBy: 'Principal',
    createdAt: '2026-08-21T11:00:00Z',
    status: 'Active',
  },
  // FIN-COLLECTION — standalone donation drive (no application needed).
  // Custom amounts: `amount` is only the suggested contribution; progress
  // reads against targetAmount instead of students × amount.
  {
    id: 'AC-03',
    name: 'School Development Fund',
    category: 'Donation',
    amount: 500,
    academicYear: '2026-2027',
    applicableClassIds: ['C11', 'C12'],
    dueDate: '2026-11-30',
    mandatory: false,
    allowCustomAmount: true,
    targetAmount: 100000,
    description: 'Voluntary contribution towards library expansion and smart-class upgrades. Every rupee is receipted — contribute any amount you wish.',
    reference: 'Development Fund 2026-27',
    createdBy: 'Principal',
    createdAt: '2026-08-24T10:15:00Z',
    status: 'Active',
  },
  // AF-TPL — the second seeded tour session (Scholario Modern A4 document).
  {
    id: 'AC-04',
    name: 'Educational Tour — Mysuru',
    category: 'Tour',
    amount: 1500,
    academicYear: '2026-2027',
    applicableClassIds: ['C07'],
    dueDate: '2026-12-20',
    mandatory: false,
    description: 'Two-day educational tour to Mysuru (transport, stay, entry fees). Digital consent — submit the form online, pay online or at the counter.',
    reference: 'Mysuru Educational Tour 2026-27',
    createdBy: 'Principal',
    createdAt: '2026-09-02T09:30:00Z',
    status: 'Active',
  },
]

// ─── Concession seed (PART 11 — auditable concession records) ─────────
//
// Every register scholarship (`student.scholarship > 0`) becomes an
// APPROVED concession record so the account's concession total stays
// EXACTLY what it was (₹500 per scholarship student) while gaining type,
// approver, reason and audit provenance. computeAccount uses records when
// they exist and falls back to the register scalar only for legacy
// persisted namespaces without records — no data ever regresses.
export const SEED_CONCESSIONS: StudentConcession[] = SS
  .filter((s) => s.scholarship > 0 && s.status === 'Active')
  .map((s) => ({
    id: `CONC-${s.id}-SEED`,
    studentId: s.id,
    type: 'Scholarship' as const,
    basis: 'amount' as const,
    value: s.scholarship,
    appliesTo: 'core_all' as const,
    effectiveFrom: '2026-04-01',
    status: 'Approved' as const,
    reason: 'Register scholarship — seeded concession (sibling/scholarship policy)',
    requestedBy: 'Principal',
    requestedAt: '2026-04-01T09:00:00.000Z',
    approvedBy: 'Principal',
    approvedAt: '2026-04-01T09:05:00.000Z',
  }))

// ─── Optional-head per-student opt-in seed (PART 9) ────────────────────
//
// Books & Uniform are optional structure heads. Opt-ins demonstrate the
// FULL applicability matrix on ONE class's roster (first class, first
// three students — deterministic ids):
//   student 1 → Books ✓ AND Uniform ✓
//   student 2 → Books ✓, Uniform ✗
//   student 3 → Books ✗, Uniform ✓
// Everyone else: neither (the default — optional ≠ automatic).
function buildOptionalHeadOptins(): Record<string, string[]> {
  const headIdFor = (structureClassId: string, name: string): string | undefined =>
    FEE_STRUCTURES.find((f) => f.classId === structureClassId)?.components.find((h) => h.name === name)?.id
  const classId = ACADEMIC_CLASSES[0]?.id
  if (!classId) return {}
  const booksId = headIdFor(classId, 'Books & Material')
  const uniformId = headIdFor(classId, 'Uniform & Sports Kit')
  const roster = SS.filter((s) => s.classId === classId).slice(0, 3)
  const map: Record<string, string[]> = {}
  const assign = (studentId: string | undefined, headId: string | undefined) => {
    if (!studentId || !headId) return
    map[studentId] = [...(map[studentId] ?? []), headId]
  }
  assign(roster[0]?.id, booksId)
  assign(roster[0]?.id, uniformId)
  assign(roster[1]?.id, booksId)
  assign(roster[2]?.id, uniformId)
  return map
}
export const SEED_OPTIONAL_HEAD_OPTINS: Record<string, string[]> = buildOptionalHeadOptins()

// ─── Phase 3: seed version snapshots from FEE_STRUCTURES ────────────
// Derived so live structures and immutable history stay in lockstep.
export const SEED_VERSIONS: FeeStructureVersion[] = FEE_STRUCTURES.map((s) => ({
  id: `FSV-${s.id}-1`,
  structureId: s.id,
  version: 1,
  status: 'current' as const,
  heads: s.components.map((h) => ({ ...h })),
  totalAmount: computeStructureBaseTotal(s),
  effectiveFrom: s.effectiveFrom,
  createdBy: 'System',
  createdAt: '2026-04-01T10:00:00Z',
  changeReason: 'Fee policy revision — 2026-27 schedule',
  notes: 'Seeded from the canonical 2026-27 fee policy (tuition bands, session exam fees, conditional transport/practicals)',
  examFeeSchedule: s.examFeeSchedule?.map((e) => ({ ...e })),
}))


export const DEFAULT_PAYMENT_MODES: PaymentModeConfig[] = [
  { id: 'UPI', label: 'UPI', active: true, requiresReference: true },
  { id: 'Card', label: 'Card', active: true, requiresReference: true },
  { id: 'Net Banking', label: 'Net Banking', active: true, requiresReference: true },
  { id: 'Cash', label: 'Cash', active: true, requiresReference: false },
  // Cheque is DEPRECATED for new transactions (per product spec — supported
  // methods are UPI/Card/Net Banking online, Cash/Bank Transfer offline).
  { id: 'Cheque', label: 'Cheque', active: false, requiresReference: true, requiresBankName: true, requiresChequeDetails: true },
  { id: 'Bank Transfer', label: 'Bank Transfer', active: true, requiresReference: true },
]

export const DEFAULT_LATE_FEE_RULE: LateFeeRule = {
  enabled: true,
  amountPerMonth: 50,
  gracePeriodDays: 7,
  maxLateFee: 500,
  appliesTo: 'mandatory_only',
}

export const DEFAULT_CONCESSION_RULE: ConcessionRule = {
  enabled: true,
  siblingDiscountPct: 10,
  staffWardDiscountPct: 25,
  scholarshipDiscountPct: 50,
  requiresApproval: true,
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  prefix: 'RCP-2026-',
  startNumber: 1042,
  footerMessage: 'Thank you for your payment.',
  showAuthorizedSignature: true,
  paperSize: 'A5',
}

// ─── Payment Infrastructure seed (Phase 4) ───────────────────────────
// Gateway fees modeled at 2% + 18% GST on the fee (Razorpay standard
// domestic pricing); settlement aggregates are the exact sum of their
// member transactions (validated in-worklog QA script).

export const SEED_GATEWAY_CONFIG: GatewayConfig = {
  id: 'GC-01',
  provider: 'razorpay',
  environment: 'test',
  status: 'test_mode',
  merchantId: 'rzp_test_DEMO1234',
  apiKeyId: 'key_DEMO1234',
  // webhookSecret is intentionally NOT seeded here — server-side only.
  webhookUrl: '/api/webhooks/razorpay',
  webhookStatus: 'healthy',
  lastWebhookAt: '2026-08-27T09:45:00Z',
  failedWebhookCount: 0,
  settlementAccountId: 'BA-01',
  connectedAt: '2026-08-15T10:00:00Z',
  connectedBy: 'Principal',
  testModePassed: true,
}

export const SEED_BANK_ACCOUNTS: BankAccount[] = [
  {
    id: 'BA-01',
    holderName: 'Scholario Education Society',
    bankName: 'HDFC Bank',
    accountNumber: '50100123456789',
    ifsc: 'HDFC0001234',
    branch: 'MG Road, Bengaluru',
    accountType: 'current',
    status: 'active',
    isPrimary: true,
    addedAt: '2026-04-01T09:00:00Z',
    addedBy: 'Principal',
    parentDisplayInstructions: 'Use this account for NEFT/RTGS transfers. Email the transfer reference to accounts@scholario.edu for verification.',
  },
  {
    id: 'BA-02',
    holderName: 'Scholario Education Society',
    bankName: 'State Bank of India',
    accountNumber: '39876543210',
    ifsc: 'SBIN0007654',
    branch: 'Indiranagar, Bengaluru',
    accountType: 'savings',
    status: 'active',
    isPrimary: false,
    addedAt: '2026-06-15T11:00:00Z',
    addedBy: 'Principal',
    parentDisplayInstructions: 'Secondary account — use only if HDFC is unavailable. Confirm with the accounts office before transfer.',
  },
]

export const SEED_UPI_QR_CONFIGS: UpiQrConfig[] = [
  {
    id: 'UQR-01',
    name: 'Main Counter UPI',
    upiId: 'scholario@hdfc',
    payeeName: 'Scholario Education Society',
    qrType: 'static',
    status: 'active',
    notes: 'Static QR displayed at the fee counter. Parents can scan to pay any amount.',
    addedAt: '2026-04-01T09:00:00Z',
    addedBy: 'Principal',
  },
]

// ─── Seed Transactions (bound to the CANONICAL roster) ───────────────
//
// Every row derives studentName / admissionNo / className / classId from the
// deterministic students seed, so receipts can never contradict the Students
// module. Amounts follow the 2026-27 fee policy (small, realistic instalments).
//   gwFee = round(amount × 2%), taxOnFee = round(gwFee × 18%)

const S = (id: string) => SS.find((s) => s.id === id)
const secLabel = (id: string) => {
  const st = S(id)
  return st ? `${st.className}-${st.section}` : '—'
}
const f = (n: number) => n.toLocaleString('en-IN')

// Settlement aggregates derive from members so they stay additive & true.
const gwMembersSET1 = [1650, 1100, 700, 700]
const gwMembersSET2 = [2600, 2800]
const gwMembersSET3 = [2450, 2250, 900]
const agg = (amounts: number[]) => ({
  grossAmount: amounts.reduce((a, b) => a + b, 0),
  gatewayFee: amounts.reduce((a, x) => a + Math.round(x * 0.02), 0),
  taxOnFee: amounts.reduce((a, x) => a + Math.round(Math.round(x * 0.02) * 0.18), 0),
})

type TxnSeed = Omit<FeeTransaction, 'studentName' | 'admissionNo' | 'className' | 'classId'> & Partial<Pick<FeeTransaction, 'className'>>
// Recipients are Pending/Partial students only (never overpay a cleared
// account); every seeded total stays within the student's outstanding gap.
const RAW_TXNS: TxnSeed[] = [
  { id: 'TXN001', receiptNo: 'RCP-2026-1042', studentId: 'STU-28', amount: 1650, mode: 'UPI', status: 'Success', date: '2026-04-10', recordedAt: '2026-04-10T05:05:00.000Z', purpose: 'Term 1 Tuition — Apr–Jun', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-04-10', referenceNo: 'UPI-9632587410', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD001', gatewayOrderId: 'order_NJ7aBcD001', gatewayFee: 33, taxOnFee: 6, netAmount: 1611, settlementId: 'SET-01', settlementStatus: 'settled', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled' },
  { id: 'TXN002', receiptNo: 'RCP-2026-1043', studentId: 'STU-30', amount: 1100, mode: 'Card', status: 'Success', date: '2026-04-12', recordedAt: '2026-04-12T06:50:00.000Z', purpose: 'Apr tuition + May instalment', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-04-12', referenceNo: 'CARD-****4521', academicYear: '2026-2027', meta: { cardLast4: '4521' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD002', gatewayOrderId: 'order_NJ7aBcD002', gatewayFee: 22, taxOnFee: 4, netAmount: 1074, settlementId: 'SET-01', settlementStatus: 'settled', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled' },
  { id: 'TXN003', receiptNo: 'RCP-2026-1044', studentId: 'STU-17', amount: 700, mode: 'Net Banking', status: 'Success', date: '2026-04-15', recordedAt: '2026-04-15T03:42:00.000Z', purpose: 'Term 1 Tuition — part', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-04-15', referenceNo: 'NB-NEFT-884120', academicYear: '2026-2027', meta: { neftUtr: 'NB-NEFT-884120' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD003', gatewayOrderId: 'order_NJ7aBcD003', gatewayFee: 14, taxOnFee: 3, netAmount: 683, settlementId: 'SET-01', settlementStatus: 'settled', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled' },
  { id: 'TXN004', receiptNo: 'RCP-2026-1045', studentId: 'STU-12', amount: 700, mode: 'UPI', status: 'Success', date: '2026-04-18', recordedAt: '2026-04-18T09:17:00.000Z', purpose: 'Term 1 Tuition — part', feeHead: 'Tuition', collectedBy: 'Meera Nair', collectorRole: 'class_teacher', verifiedBy: 'Principal', verifiedAt: '2026-04-19', referenceNo: 'UPI-7845120369', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD004', gatewayOrderId: 'order_NJ7aBcD004', gatewayFee: 14, taxOnFee: 3, netAmount: 683, settlementId: 'SET-01', settlementStatus: 'settled', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled' },
  { id: 'TXN005', receiptNo: 'RCP-2026-1046', studentId: 'STU-29', amount: 1500, mode: 'Cash', status: 'Under Verification', date: '2026-08-26', recordedAt: '2026-08-26T05:35:00.000Z', purpose: 'Term 2 Tuition — Jul–Sep', feeHead: 'Tuition', collectedBy: 'Rohan Mehta', collectorRole: 'teacher', verifiedBy: null, verifiedAt: null, referenceNo: null, academicYear: '2026-2027', paymentSource: 'offline' },
  { id: 'TXN006', receiptNo: 'RCP-2026-1047', studentId: 'STU-16', amount: 1600, mode: 'Cheque', status: 'Success', date: '2026-04-11', recordedAt: '2026-04-11T07:33:00.000Z', purpose: 'Transport Term 1 + April management fee', feeHead: 'Transport', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-04-14', referenceNo: 'CHQ-HDFC-258963', academicYear: '2026-2027', meta: { bankName: 'HDFC', chequeNumber: '258963', chequeDate: '2026-04-11' }, paymentSource: 'offline' },
  { id: 'TXN007', receiptNo: 'RCP-2026-1048', studentId: 'STU-39', amount: 2600, mode: 'UPI', status: 'Success', date: '2026-07-08', recordedAt: '2026-07-08T11:12:00.000Z', purpose: 'Term 2 Tuition — Jul–Sep', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-07-08', referenceNo: 'UPI-4569871230', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD007', gatewayOrderId: 'order_NJ7aBcD007', gatewayFee: 52, taxOnFee: 9, netAmount: 2539, settlementId: 'SET-02', settlementStatus: 'settled', utr: 'RZPSET0720260002', reconciliationStatus: 'reconciled' },
  { id: 'TXN008', receiptNo: 'RCP-2026-1049', studentId: 'STU-33', amount: 2800, mode: 'Card', status: 'Success', date: '2026-07-09', recordedAt: '2026-07-09T04:56:00.000Z', purpose: 'Board Form Fee + Jul tuition', feeHead: 'Board Form Fee', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-07-09', referenceNo: 'CARD-****7890', academicYear: '2026-2027', meta: { cardLast4: '7890' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD008', gatewayOrderId: 'order_NJ7aBcD008', gatewayFee: 56, taxOnFee: 10, netAmount: 2734, settlementId: 'SET-02', settlementStatus: 'settled', utr: 'RZPSET0720260002', reconciliationStatus: 'reconciled' },
  { id: 'TXN009', receiptNo: 'RCP-2026-1050', studentId: 'STU-34', amount: 1750, mode: 'Net Banking', status: 'Pending', date: '2026-08-26', recordedAt: '2026-08-26T09:48:00.000Z', purpose: 'Board form fee + Aug tuition', feeHead: 'Board Form Fee', collectedBy: 'Principal', verifiedBy: null, verifiedAt: null, referenceNo: 'NB-RTGS-556677', academicYear: '2026-2027', meta: { neftUtr: 'NB-RTGS-556677' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD009', gatewayOrderId: 'order_NJ7aBcD009', reconciliationStatus: 'pending' },
  { id: 'TXN010', receiptNo: 'RCP-2026-1051', studentId: 'STU-42', amount: 2450, mode: 'UPI', status: 'Success', date: '2026-08-27', recordedAt: '2026-08-27T04:11:00.000Z', purpose: 'Aug tuition + chemistry practical', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-08-27', referenceNo: 'UPI-1234567890', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD010', gatewayOrderId: 'order_NJ7aBcD010', gatewayFee: 49, taxOnFee: 9, netAmount: 2392, settlementId: 'SET-03', settlementStatus: 'pending', reconciliationStatus: 'pending' },
  { id: 'TXN011', receiptNo: 'RCP-2026-1052', studentId: 'STU-37', amount: 1750, mode: 'Cash', status: 'Under Verification', date: '2026-08-25', recordedAt: '2026-08-25T06:44:00.000Z', purpose: 'Term 2 Tuition — Aug instalment', feeHead: 'Tuition', collectedBy: 'Meera Nair', collectorRole: 'class_teacher', verifiedBy: null, verifiedAt: null, referenceNo: null, academicYear: '2026-2027', paymentSource: 'offline' },
  { id: 'TXN012', receiptNo: 'RCP-2026-1053', studentId: 'STU-32', amount: 1550, mode: 'Cheque', status: 'Success', date: '2026-07-20', recordedAt: '2026-07-20T06:02:00.000Z', purpose: 'Session examination fee (six exams)', feeHead: 'Examination Fee', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-07-22', referenceNo: 'CHQ-ICICI-145896', academicYear: '2026-2027', meta: { bankName: 'ICICI', chequeNumber: '145896', chequeDate: '2026-07-19' }, paymentSource: 'offline' },
  { id: 'TXN013', receiptNo: 'RCP-2026-1054', studentId: 'STU-41', amount: 2250, mode: 'UPI', status: 'Success', date: '2026-08-04', recordedAt: '2026-08-04T10:26:00.000Z', purpose: 'Term 2 Tuition + biology practical', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-08-04', referenceNo: 'UPI-7788990011', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD013', gatewayOrderId: 'order_NJ7aBcD013', gatewayFee: 45, taxOnFee: 8, netAmount: 2197, settlementId: 'SET-03', settlementStatus: 'pending', reconciliationStatus: 'pending' },
  { id: 'TXN014', receiptNo: 'RCP-2026-1055', studentId: 'STU-23', amount: 900, mode: 'UPI', status: 'Success', date: '2026-08-14', recordedAt: '2026-08-14T04:38:00.000Z', purpose: 'Unit test fees + Aug tuition', feeHead: 'Examination Fee', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-08-14', referenceNo: 'UPI-9988776655', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD014', gatewayOrderId: 'order_NJ7aBcD014', gatewayFee: 18, taxOnFee: 3, netAmount: 879, settlementId: 'SET-03', settlementStatus: 'pending', reconciliationStatus: 'pending' },
  { id: 'TXN015', receiptNo: 'RCP-2026-1056', studentId: 'STU-31', amount: 1400, mode: 'Cash', status: 'Under Verification', date: '2026-08-26', recordedAt: '2026-08-26T07:57:00.000Z', purpose: 'Jul + Aug tuition', feeHead: 'Tuition', collectedBy: 'Rohan Mehta', collectorRole: 'teacher', verifiedBy: null, verifiedAt: null, referenceNo: null, academicYear: '2026-2027', paymentSource: 'offline' },
  { id: 'TXN016', receiptNo: 'RCP-2026-1057', studentId: 'STU-22', amount: 1000, mode: 'Bank Transfer', status: 'Success', date: '2026-08-25', recordedAt: '2026-08-25T10:33:00.000Z', purpose: 'Term 2 NEFT — Jun–Jul portion', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-08-25', referenceNo: 'BT-NEFT-991234', academicYear: '2026-2027', meta: { neftUtr: 'BT-NEFT-991234' }, paymentSource: 'offline' },
  { id: 'TXN017', receiptNo: 'RCP-2026-1058', studentId: 'STU-40', amount: 2600, mode: 'UPI', status: 'Failed', date: '2026-08-15', recordedAt: '2026-08-15T07:19:00.000Z', purpose: 'Term 2 Tuition', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: null, verifiedAt: null, referenceNo: 'UPI-FAIL-558899', academicYear: '2026-2027', paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD017', gatewayOrderId: 'order_NJ7aBcD017', reconciliationStatus: 'exception', refundReason: 'Payment failed at gateway — insufficient funds in payer account' },
  { id: 'TXN018', receiptNo: 'RCP-2026-1059', studentId: 'STU-35', amount: 3100, mode: 'Card', status: 'Failed', date: '2026-08-06', recordedAt: '2026-08-06T11:51:00.000Z', purpose: 'Term 2 Tuition', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: null, verifiedAt: null, referenceNo: 'CARD-FAIL-9981', academicYear: '2026-2027', meta: { cardLast4: '9981' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD018', gatewayOrderId: 'order_NJ7aBcD018', reconciliationStatus: 'exception', refundReason: 'Card declined by issuing bank — parent to retry with different card' },
  { id: 'TXN019', receiptNo: 'RCP-2026-1060', studentId: 'STU-41', amount: 1500, mode: 'Card', status: 'Refunded', date: '2026-08-15', recordedAt: '2026-08-15T04:27:00.000Z', purpose: 'Duplicate instalment — refunded to source', feeHead: 'Tuition', collectedBy: 'Principal', verifiedBy: 'Principal', verifiedAt: '2026-08-15', referenceNo: 'CARD-****2244', academicYear: '2026-2027', meta: { cardLast4: '2244' }, paymentSource: 'online', gateway: 'razorpay', gatewayPaymentId: 'pay_NJ7aBcD019', gatewayOrderId: 'order_NJ7aBcD019', gatewayFee: 30, taxOnFee: 5, netAmount: 1465, reconciliationStatus: 'reconciled', refundedAmount: 1500, refundReason: 'Duplicate payment — parent requested refund for second transaction' },
  // STU-B — the demo student's Term-1 payment (Class 2-A, fee-engine scale:
  // ₹3,000 tuition + ₹500 management + ₹6,000 transport; ₹4,750 of ₹9,500
  // paid → matches the canonical STU-58 record exactly). Direct-to-VPA UPI,
  // office-verified — no gateway involvement (paymentSource 'offline').
  { id: 'TXN020', receiptNo: 'RCP-2026-1061', studentId: 'STU-58', amount: 4750, mode: 'UPI', status: 'Success', date: '2026-07-10', recordedAt: '2026-07-10T06:30:00.000Z', purpose: 'Term 1 fees — tuition, management & part transport', feeHead: 'Tuition', collectedBy: 'Rohan Mehta', collectorRole: 'class_teacher', verifiedBy: 'Principal', verifiedAt: '2026-07-11', referenceNo: 'UPI-5544332211', academicYear: '2026-2027', paymentSource: 'offline' },
]

export const SEED_TRANSACTIONS: FeeTransaction[] = RAW_TXNS.map(({ className: _ignored, ...rest }) => {
  const st = S(rest.studentId)
  return {
    ...rest,
    studentName: st?.name ?? 'Unknown Student',
    admissionNo: st?.admissionNo ?? '—',
    className: st?.className ?? '—',
    classId: st?.classId ?? '—',
  }
})

export const SEED_FEE_TRANSACTIONS = SEED_TRANSACTIONS

// STU-B — the demo student's seed payment, isolated so the fee store's v14
// migration can backfill it into persisted states that predate the roster
// unification (the student-side fee history derives from the ONE ledger).
export const STU58_SEED_TXNS: FeeTransaction[] = SEED_TRANSACTIONS.filter((t) => t.studentId === 'STU-58')

// ─── Cash Request seed ───────────────────────────────────────────────
// Teacher-collected cash awaiting Principal verification. Amounts mirror the
// matching "Under Verification" transactions exactly.

export const SEED_CASH_REQUESTS: CashRequest[] = [
  {
    id: 'PCR-01', studentId: 'STU-29', studentName: S('STU-29')?.name ?? '', admissionNo: S('STU-29')?.admissionNo ?? '',
    className: secLabel('STU-29'), amount: 1500, feeHead: 'Tuition',
    collectedBy: `Class Teacher · ${secLabel('STU-29')}`, collectedAt: '2026-08-26T03:10:00.000Z',
    submittedAt: '2026-08-26T03:40:00.000Z', status: 'Pending Principal Acceptance',
    notes: 'Cash received at morning assembly — ₹100 and ₹500 denominations, counted twice.',
    contextBalanceAtSubmission: 2400,
  },
  {
    id: 'PCR-02', studentId: 'STU-37', studentName: S('STU-37')?.name ?? '', admissionNo: S('STU-37')?.admissionNo ?? '',
    className: secLabel('STU-37'), amount: 1750, feeHead: 'Tuition',
    collectedBy: `Class Teacher · ${secLabel('STU-37')}`, collectedAt: '2026-08-25T03:50:00.000Z',
    submittedAt: '2026-08-25T04:05:00.000Z', status: 'Collected by Teacher',
    notes: 'Cash deposited at the school counter; deposit slip attached.',
    contextBalanceAtSubmission: 12750,
  },
  {
    id: 'PCR-03', studentId: 'STU-31', studentName: S('STU-31')?.name ?? '', admissionNo: S('STU-31')?.admissionNo ?? '',
    className: secLabel('STU-31'), amount: 1400, feeHead: 'Tuition',
    collectedBy: `Class Teacher · ${secLabel('STU-31')}`, collectedAt: '2026-08-26T07:10:00.000Z',
    submittedAt: '2026-08-26T07:25:00.000Z', status: 'Pending Principal Acceptance',
    notes: 'Parent requested a monthly instalment plan; paying two months together.',
    contextBalanceAtSubmission: 2300,
  },
]

// ─── Settlements / reconciliations / webhooks ────────────────────────
const SET1 = agg(gwMembersSET1)
const SET2 = agg(gwMembersSET2)
const SET3 = agg(gwMembersSET3)

export const SEED_SETTLEMENTS: Settlement[] = [
  {
    id: 'SET-01',
    gateway: 'razorpay',
    settlementDate: '2026-04-18',
    grossAmount: SET1.grossAmount,
    gatewayFee: SET1.gatewayFee,
    taxOnFee: SET1.taxOnFee,
    netAmount: SET1.grossAmount - SET1.gatewayFee - SET1.taxOnFee,
    bankAccountId: 'BA-01',
    utr: 'RZPSET0420260001',
    status: 'settled',
    transactionIds: ['TXN001', 'TXN002', 'TXN003', 'TXN004'],
    createdAt: '2026-04-18T08:00:00Z',
    reconciledAt: '2026-04-19T10:00:00Z',
    reconciledBy: 'Principal',
  },
  {
    id: 'SET-02',
    gateway: 'razorpay',
    settlementDate: '2026-07-15',
    grossAmount: SET2.grossAmount,
    gatewayFee: SET2.gatewayFee,
    taxOnFee: SET2.taxOnFee,
    netAmount: SET2.grossAmount - SET2.gatewayFee - SET2.taxOnFee,
    bankAccountId: 'BA-01',
    utr: 'RZPSET0720260002',
    status: 'settled',
    transactionIds: ['TXN007', 'TXN008'],
    createdAt: '2026-07-15T08:00:00Z',
    reconciledAt: '2026-07-16T10:00:00Z',
    reconciledBy: 'Principal',
  },
  {
    id: 'SET-03',
    gateway: 'razorpay',
    settlementDate: '2026-08-29',
    grossAmount: SET3.grossAmount,
    gatewayFee: SET3.gatewayFee,
    taxOnFee: SET3.taxOnFee,
    netAmount: SET3.grossAmount - SET3.gatewayFee - SET3.taxOnFee,
    bankAccountId: 'BA-01',
    status: 'pending',
    transactionIds: ['TXN010', 'TXN013', 'TXN014'],
    createdAt: '2026-08-27T08:00:00Z',
  },
]

export const SEED_RECONCILIATION_RECORDS: ReconciliationRecord[] = [
  { id: 'REC-001', transactionId: 'TXN001', settlementId: 'SET-01', gatewayPaymentId: 'pay_NJ7aBcD001', gatewayOrderId: 'order_NJ7aBcD001', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-04-19T10:00:00Z' },
  { id: 'REC-002', transactionId: 'TXN002', settlementId: 'SET-01', gatewayPaymentId: 'pay_NJ7aBcD002', gatewayOrderId: 'order_NJ7aBcD002', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-04-19T10:00:00Z' },
  { id: 'REC-003', transactionId: 'TXN003', settlementId: 'SET-01', gatewayPaymentId: 'pay_NJ7aBcD003', gatewayOrderId: 'order_NJ7aBcD003', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-04-19T10:00:00Z' },
  { id: 'REC-004', transactionId: 'TXN004', settlementId: 'SET-01', gatewayPaymentId: 'pay_NJ7aBcD004', gatewayOrderId: 'order_NJ7aBcD004', utr: 'RZPSET0420260001', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-04-19T10:00:00Z' },
  { id: 'REC-005', transactionId: 'TXN007', settlementId: 'SET-02', gatewayPaymentId: 'pay_NJ7aBcD007', gatewayOrderId: 'order_NJ7aBcD007', utr: 'RZPSET0720260002', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-07-16T10:00:00Z' },
  { id: 'REC-006', transactionId: 'TXN008', settlementId: 'SET-02', gatewayPaymentId: 'pay_NJ7aBcD008', gatewayOrderId: 'order_NJ7aBcD008', utr: 'RZPSET0720260002', reconciliationStatus: 'reconciled', reconciledBy: 'Principal', reconciledAt: '2026-07-16T10:00:00Z' },
]

export const SEED_WEBHOOK_EVENTS: WebhookEvent[] = [
  { id: 'WH-001', provider: 'razorpay', eventId: 'evt_1abc234def', eventType: 'payment.success', receivedAt: '2026-04-12T11:35:00Z', processedAt: '2026-04-12T11:35:01Z', status: 'processed', transactionId: 'TXN001' },
  { id: 'WH-002', provider: 'razorpay', eventId: 'evt_2ghi567jkl', eventType: 'payment.success', receivedAt: '2026-04-12T11:36:00Z', processedAt: '2026-04-12T11:36:01Z', status: 'processed', transactionId: 'TXN002' },
  { id: 'WH-003', provider: 'razorpay', eventId: 'evt_3mno890pqr', eventType: 'payment.failed', receivedAt: '2026-08-15T10:20:00Z', processedAt: '2026-08-15T10:20:01Z', status: 'processed', transactionId: 'TXN017' },
  { id: 'WH-004', provider: 'razorpay', eventId: 'evt_4stu123vwx', eventType: 'payment.success', receivedAt: '2026-07-08T14:15:00Z', processedAt: '2026-07-08T14:15:01Z', status: 'processed', transactionId: 'TXN007' },
]

// ─── Audit log seed ──────────────────────────────────────────────────

export const SEED_AUDIT: AuditRecord[] = [
  { id: 'AUD-001', action: 'payment.recorded', actor: 'Principal', timestamp: '2026-08-27T10:05:00Z', entityId: 'TXN010', entityType: 'transaction', description: `Payment ₹${f(2450)} recorded for ${S('STU-42')?.name ?? ''} via UPI (RCP-2026-1051)` },
  { id: 'AUD-002', action: 'cash.submitted', actor: `Class Teacher · ${secLabel('STU-29')}`, timestamp: '2026-08-26T09:15:00Z', entityId: 'PCR-01', entityType: 'cash_request', description: `Cash ₹${f(1500)} submitted for ${S('STU-29')?.name ?? ''}` },
  { id: 'AUD-003', action: 'concession.granted', actor: 'Principal', timestamp: '2026-04-11T14:00:00Z', entityId: 'STU-40', entityType: 'concession', description: `Sibling concession (₹500) granted to ${S('STU-40')?.name ?? ''} per concession rule` },
  { id: 'AUD-004', action: 'fee_structure.changed', actor: 'Principal', timestamp: '2026-04-01T10:00:00Z', entityId: 'FS-C12', entityType: 'fee_structure', description: '2026-27 fee policy published — tuition ₹250/₹300/₹400 bands, session exam fees ₹700/₹900/₹1,000, transport ₹500/mo opt-in' },
  { id: 'AUD-005', action: 'receipt.reprinted', actor: 'Principal', timestamp: '2026-08-20T15:20:00Z', entityId: 'TXN007', entityType: 'receipt', description: 'Receipt RCP-2026-1048 reprinted (no second transaction created)' },
]

// ─── STABILIZATION: seed-row ID registry (v15 purge) ─────────────────
//
// The fabricated financial-history seeds are RETIRED as store initial
// state (see fee-store.ts): a production fee module must never present
// receipts, cash submissions, structures, obligations, settlements or
// concessions that no one actually created. The canonical fee ledger
// lives in the DB (Fee + FeeTransaction + Payment rows via
// /api/fees + /api/fees/transactions); this client store remains the
// configuration layer only (payment modes, late-fee/concession/entry
// policy, receipt settings).
//
// This registry is the ONE list the store's v15 migration filters
// persisted namespaces against — user-created rows are ALWAYS kept.
export const SEED_FINANCIAL_ROW_IDS = {
  transactions: new Set(SEED_TRANSACTIONS.map((t) => t.id)),
  cashRequests: new Set(SEED_CASH_REQUESTS.map((r) => r.id)),
  audit: new Set(SEED_AUDIT.map((a) => a.id)),
  feeStructures: new Set(FEE_STRUCTURES.map((s) => s.id)),
  versions: new Set(SEED_VERSIONS.map((v) => v.id)),
  additionalCharges: new Set(SEED_ADDITIONAL_CHARGES.map((c) => c.id)),
  settlements: new Set(SEED_SETTLEMENTS.map((s) => s.id)),
  reconciliationRecords: new Set(SEED_RECONCILIATION_RECORDS.map((r) => r.id)),
  webhookEvents: new Set(SEED_WEBHOOK_EVENTS.map((w) => w.id)),
  concessions: new Set(SEED_CONCESSIONS.map((c) => c.id)),
  bankAccounts: new Set(SEED_BANK_ACCOUNTS.map((b) => b.id)),
  upiQrConfigs: new Set(SEED_UPI_QR_CONFIGS.map((q) => q.id)),
} as const

/** Seed optional-head opt-ins (headId → studentIds) — used by the v15
 *  migration to strip seeded opt-ins from the persisted applicability
 *  map while keeping principal-approved ones. */
export const SEED_OPTIONAL_HEAD_OPTINS_SNAPSHOT: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(SEED_OPTIONAL_HEAD_OPTINS).map(([k, v]) => [k, Object.freeze([...v])])),
)
