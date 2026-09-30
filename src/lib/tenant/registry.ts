/**
 * Tenant REGISTRY (SaaS-STAGE-2A) — the single source of truth for the
 * platform's module catalog, sub-feature catalog, capability catalog and
 * default examination templates.
 *
 * Both the Super Admin control plane AND the school panels consume this
 * catalog — so adding a new flag later is a one-line change here, never a
 * UI rewrite. No component hardcodes school ids.
 *
 * PHASE 7.5-D NOTE: the registry's per-tenant module `features` flags are
 * DECORATIVE post-Phase-7.5 (all-on seeds, zero writers) — the SERVER's
 * effective moduleFlags (GET /api/school-settings) are the truth; nav
 * gating consumes them via src/lib/hooks/use-effective-module-flags.ts.
 * The catalog + mapping helpers below remain load-bearing — do not delete.
 */

import type {
  CapabilityKey,
  ExamTemplateId,
  FeatureKey,
  ModuleKey,
} from './types'

// ─── Module catalog ─────────────────────────────────────────────────────

export type ModuleGroupId = 'core' | 'finance' | 'academics' | 'operations' | 'communication'

export interface ModuleDef {
  key: ModuleKey
  label: string
  description: string
  group: ModuleGroupId
}

export const MODULE_CATALOG: ModuleDef[] = [
  // Core modules
  { key: 'admissions', label: 'Admissions', description: 'Application forms, review workflow and enrolment', group: 'core' },
  { key: 'students', label: 'Students & Classes', description: 'Student register, classes, sections and promotions', group: 'core' },
  { key: 'teachers', label: 'Teachers', description: 'Staff records, workload and lifecycle', group: 'core' },
  { key: 'attendance', label: 'Attendance', description: 'Daily attendance for students and staff', group: 'core' },
  { key: 'timetable', label: 'Timetable', description: 'Period-wise scheduling and substitutions', group: 'core' },
  // Finance
  { key: 'fees', label: 'Fee Management', description: 'Structures, catalogue, collections, transactions and receipts', group: 'finance' },
  { key: 'payroll', label: 'Salary & Payroll', description: 'Salary structures, payroll runs and salary payments', group: 'finance' },
  { key: 'finance', label: 'Finance Dashboard', description: 'Cross-module financial overview and reports', group: 'finance' },
  // Academics
  { key: 'examinations', label: 'Examinations', description: 'Exam creation, scheduling, marks and results', group: 'academics' },
  // Operations
  { key: 'library', label: 'Library', description: 'Catalogue, issues and returns', group: 'operations' },
  { key: 'transport', label: 'Transport', description: 'Routes, vehicles and student transport', group: 'operations' },
  { key: 'inventory', label: 'Inventory', description: 'Uniforms, books and store management', group: 'operations' },
  { key: 'certificates', label: 'Certificates', description: 'Certificate templates and issuance', group: 'operations' },
  { key: 'downloads', label: 'Downloads', description: 'Documents and downloadable resources', group: 'operations' },
  { key: 'calendar', label: 'Calendar', description: 'Academic calendar, events and holidays', group: 'operations' },
  // Communication
  { key: 'communication', label: 'Communication', description: 'Announcements, broadcasts and circulars', group: 'communication' },
  { key: 'messages', label: 'Messages', description: 'Direct messaging between staff and parents', group: 'communication' },
]

export const MODULE_GROUP_LABELS: Record<ModuleGroupId, string> = {
  core: 'Modules',
  finance: 'Finance',
  academics: 'Academics',
  operations: 'Operations',
  communication: 'Communication',
}

// ─── Sub-feature catalog ────────────────────────────────────────────────

export interface SubFeatureDef {
  key: FeatureKey
  parent: ModuleKey
  label: string
  description: string
}

export const SUB_FEATURE_CATALOG: SubFeatureDef[] = [
  // Fee Management
  { key: 'fee_structures', parent: 'fees', label: 'Fee Structures', description: 'Class-specific fee structure management' },
  { key: 'fee_catalogue', parent: 'fees', label: 'Fee Catalogue', description: 'School-wide reusable fee-head catalogue' },
  { key: 'fee_collect', parent: 'fees', label: 'Fee Collection', description: 'Office / teacher fee collection workflow' },
  { key: 'fee_online_payments', parent: 'fees', label: 'Online Payment Gateway', description: 'Gateway channel for online payments (mock provider; school-level onlinePayments.enabled)' },
  { key: 'fee_transactions', parent: 'fees', label: 'Transactions', description: 'Authoritative payment ledger and filters' },
  { key: 'receipt_templates', parent: 'fees', label: 'Receipt Settings', description: 'Canonical A5 dual-copy receipt configuration' },
  // Examinations
  { key: 'exam_create', parent: 'examinations', label: 'Create Exam', description: 'Create new examinations' },
  { key: 'exam_edit_draft', parent: 'examinations', label: 'Edit Draft Exam', description: 'Edit examinations while in Draft' },
  { key: 'exam_publish', parent: 'examinations', label: 'Publish Exam', description: 'Publish draft examinations to schedule' },
  { key: 'exam_modify_published', parent: 'examinations', label: 'Modify Published Exam', description: 'Governed changes to published exams (platform-controlled)' },
  // Salary & Payroll
  { key: 'payroll_structures', parent: 'payroll', label: 'Salary Structures', description: 'Salary structure builder' },
  { key: 'payroll_run', parent: 'payroll', label: 'Payroll', description: 'Monthly payroll processing' },
  { key: 'payroll_payments', parent: 'payroll', label: 'Salary Payments', description: 'Disbursements and payslips' },
]

// ─── Capability catalog ─────────────────────────────────────────────────

export interface CapabilityDef {
  key: CapabilityKey
  label: string
  description: string
  /** Platform-reserved capabilities can NEVER be enabled for school roles. */
  platformReserved?: boolean
}

export const CAPABILITY_CATALOG: CapabilityDef[] = [
  { key: 'fee_structure_edit', label: 'Fee Structure Editing', description: 'Principal may edit fee structures and save drafts' },
  { key: 'fee_structure_publish', label: 'Fee Structure Publishing', description: 'Principal may publish / schedule structure versions' },
  { key: 'fee_structure_archive', label: 'Fee Structure Archiving', description: 'Principal may archive structures (30-day retention applies)' },
  { key: 'fee_structure_delete', label: 'Permanent Delete', description: 'Reserved for the platform (retention expiry or Super Admin). Principals never permanently delete fee structures', platformReserved: true },
  { key: 'fee_catalogue_manage', label: 'Catalogue Management', description: 'Principal may create / edit / archive fee-head catalogue defaults' },
  { key: 'fee_entry_policy_manage', label: 'One-Time Fee Policy', description: 'Principal may manage one-time entry fee policy (admission / registration applicability)' },
]

// ─── Examination templates ──────────────────────────────────────────────
//
// Canonical exam type vocabulary lives in `@/lib/exams/types` (EXAM_TYPES).
// A pattern lists the exam instances a school plans for the year; the fee
// structure maps amounts onto these types via ExamFeeSchedule, and the
// Examination module consumes the same vocabulary. Fee configuration here
// is NOT exam creation — actual exams (dates, subjects, marks, publish
// state) are produced in the Examination module.

export interface ExamTemplateEntry {
  /** Canonical exam type string — must match the EXAM_TYPES vocabulary. */
  examType: string
  /** Instances planned for the academic year (Unit Test × 4, etc.). */
  plannedInstances: number
  /** Seed per-instance amount before the tenant fee scale is applied. */
  seedAmount: number
}

export interface ExamTemplate {
  id: ExamTemplateId
  label: string
  description: string
  entries: ExamTemplateEntry[]
}

export const EXAM_TEMPLATES: Record<ExamTemplateId, ExamTemplate> = {
  'ut4-hy-annual': {
    id: 'ut4-hy-annual',
    label: '4 Unit Tests + Half-Yearly + Annual',
    description: 'Pattern A — continuous assessment through four unit tests, then half-yearly and annual examinations.',
    entries: [
      { examType: 'Unit Test', plannedInstances: 4, seedAmount: 100 },
      { examType: 'Half-Yearly', plannedInstances: 1, seedAmount: 150 },
      { examType: 'Annual Examination', plannedInstances: 1, seedAmount: 150 },
    ],
  },
  'quarterly-hy-annual': {
    id: 'quarterly-hy-annual',
    label: 'Quarterly + Half-Yearly + Annual',
    description: 'Pattern B — term-wise assessment with quarterly, half-yearly and annual examinations.',
    entries: [
      { examType: 'Quarterly', plannedInstances: 1, seedAmount: 200 },
      { examType: 'Half-Yearly', plannedInstances: 1, seedAmount: 200 },
      { examType: 'Annual Examination', plannedInstances: 1, seedAmount: 250 },
    ],
  },
}

export function getExamTemplate(id: ExamTemplateId | undefined | null): ExamTemplate {
  return EXAM_TEMPLATES[id ?? 'ut4-hy-annual'] ?? EXAM_TEMPLATES['ut4-hy-annual']
}

// ─── Module ⇄ panel-nav mapping helpers ─────────────────────────────────

/**
 * Canonical MODULE_KEY_BY_NAV mapping for the Principal panel. Each panel
 * declares its nav key → ModuleKey once; gating happens in ONE place per
 * panel (never scattered `if (school === …)` conditions).
 */
export const PRINCIPAL_NAV_MODULE_KEYS: Record<string, ModuleKey> = {
  admission: 'admissions',
  teachers: 'teachers',
  students: 'students',
  timetable: 'timetable',
  attendance: 'attendance',
  exams: 'examinations',
  fees: 'fees',
  salary: 'payroll',
  finance: 'finance',
  communication: 'communication',
  messaging: 'messages',
  calendar: 'calendar',
  library: 'library',
  transport: 'transport',
  inventory: 'inventory',
  certificates: 'certificates',
  downloads: 'downloads',
}
