/**
 * PHASE 2 — SUPER ADMIN SCHOOL SETUP WIZARD — shared state model.
 *
 * The Setup wizard is a guided view over REAL, PERSISTED configuration.
 * Its single source of truth is the same DB-computed readiness engine the
 * whole platform already shares (computeSetupReadiness), extended with the
 * few wizard-specific counts the readiness document deliberately does not
 * carry (initial fee catalogue heads, exam-type configuration, explicit
 * module overrides).
 *
 * THIS MODULE IS PURE: no DB, no React. The setup-wizard route assembles
 * the inputs from the live database; the wizard UI renders the output;
 * the activation route enforces the same requirements server-side. One
 * derivation, three consumers — the client can never "say setup is
 * complete".
 *
 * Lifecycle invariant (preserved): activation remains the sign-in unlock.
 * The wizard's strict checklist is an OPT-IN contract — the wizard sends
 * `{ requireComplete: true }`; every pre-existing caller (danger zone,
 * journeys) keeps the exact old behavior. Requirements are always
 * REPORTED, enforced only where explicitly requested.
 */
import type { SetupReadiness } from '@/lib/school/setup-readiness'

/** The nine guided steps, in display order. */
export const WIZARD_STEP_IDS = [
  'identity',
  'branding',
  'academic',
  'principal',
  'people',
  'fees',
  'exams',
  'website',
  'modules',
] as const

export type WizardStepId = (typeof WIZARD_STEP_IDS)[number]

export type WizardStepState = 'not_started' | 'in_progress' | 'completed'

export interface WizardStep {
  id: WizardStepId
  label: string
  /** Skippable without blocking activation (school-owned routine work). */
  optional: boolean
  status: WizardStepState
  detail: string
  /** Anchor of the ongoing governance editor for this domain (Setup tab). */
  manageAnchor?: string
}

/** Steps the platform VERIFIES server-side before a wizard-driven activation. */
export const WIZARD_REQUIRED_STEP_IDS: readonly WizardStepId[] = [
  'identity',
  'academic',
  'principal',
] as const

export const WIZARD_STEP_LABELS: Record<WizardStepId, string> = {
  identity: 'School identity',
  branding: 'Branding',
  academic: 'Academic configuration',
  principal: 'Principal account',
  people: 'Teachers & staff',
  fees: 'Fees configuration',
  exams: 'Examination configuration',
  website: 'Website & presence',
  modules: 'Modules & initial access',
}

/** Where the ONGOING governance editor for each domain lives (Setup tab
 *  sub-section anchors from school-detail-tabs.ts). The wizard is the
 *  first-time guided path; these editors remain the single ongoing home. */
export const WIZARD_MANAGE_ANCHORS: Partial<Record<WizardStepId, string>> = {
  identity: 'section-metadata',
  branding: 'section-identity',
  academic: 'section-metadata',
  principal: 'section-setup',
  fees: 'section-modules',
  modules: 'section-modules',
  website: 'section-domains',
}

/** Location fields the platform persists in School.settings (same keys the
 *  provisioning wizard writes — one vocabulary, no parallel storage). */
export interface WizardSchoolLocation {
  state: string | null
  district: string | null
  pincode: string | null
  country: string | null
  timezone: string | null
  workingDays: string[]
}

export interface WizardSchoolSnapshot {
  name: string
  shortName: string | null
  tagline: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  website: string | null
  established: string | null
  academicYear: string | null
  board: string
  status: string
  themeColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  location: WizardSchoolLocation
}

/** Wizard-specific DB counts the readiness document does not carry. */
export interface WizardExtraCounts {
  masterFeeHeads: number
  feeStructures: number
  examTypes: number
  gradeScales: number
  teachers: number
  schoolFlagOverrides: number
}

/** Core contact block the identity step insists on (name/slug/code exist
 *  by construction post-provision — the wizard adds the honest contact
 *  requirement the readiness document deliberately leaves soft). */
export const IDENTITY_CORE_FIELDS = ['address', 'city', 'phone', 'email'] as const

export function identityCoreComplete(school: WizardSchoolSnapshot): boolean {
  return (
    Boolean(school.address?.trim()) &&
    Boolean(school.city?.trim()) &&
    Boolean(school.phone?.trim()) &&
    Boolean(school.email?.trim())
  )
}

function sectionMap(readiness: SetupReadiness): Map<string, { done: boolean; counts: Record<string, number>; detail: string }> {
  return new Map(readiness.sections.map((s) => [s.id, { done: s.done, counts: s.counts, detail: s.detail }]))
}

function stepState(done: boolean, started: boolean): WizardStepState {
  return done ? 'completed' : started ? 'in_progress' : 'not_started'
}

/**
 * Derive the nine wizard steps from the live readiness document + the
 * wizard-specific counts. Pure — fully unit-testable.
 */
export function deriveWizardSteps(
  school: WizardSchoolSnapshot,
  readiness: SetupReadiness,
  extras: WizardExtraCounts,
): WizardStep[] {
  const byId = sectionMap(readiness)
  const identityCore = identityCoreComplete(school)
  const contactFields = [school.address, school.city, school.phone, school.email].filter(Boolean).length

  const academic = byId.get('academic')
  const academicStarted = Boolean(school.academicYear) || (academic?.counts.classes ?? 0) > 0

  const principal = byId.get('principal')
  const fees = byId.get('fees')
  const exams = byId.get('exams')
  const website = byId.get('website')
  const branding = byId.get('branding')

  return [
    {
      id: 'identity',
      label: WIZARD_STEP_LABELS.identity,
      optional: false,
      status: stepState(identityCore, contactFields > 0),
      detail: identityCore
        ? 'Core contact block complete'
        : `Core contact block — ${contactFields}/4 saved`,
      manageAnchor: WIZARD_MANAGE_ANCHORS.identity,
    },
    {
      id: 'branding',
      label: WIZARD_STEP_LABELS.branding,
      optional: true,
      status: stepState(Boolean(branding?.done), Boolean(branding?.done)),
      detail: branding?.done ? (branding.detail || 'custom branding in use') : 'default branding in use',
      manageAnchor: WIZARD_MANAGE_ANCHORS.branding,
    },
    {
      id: 'academic',
      label: WIZARD_STEP_LABELS.academic,
      optional: false,
      status: stepState(Boolean(academic?.done), academicStarted),
      detail: academic?.detail ?? 'no session year',
      manageAnchor: WIZARD_MANAGE_ANCHORS.academic,
    },
    {
      id: 'principal',
      label: WIZARD_STEP_LABELS.principal,
      optional: false,
      status: stepState(Boolean(principal?.done), Boolean(principal?.done)),
      detail: principal?.done ? 'active principal account' : 'no principal account',
      manageAnchor: WIZARD_MANAGE_ANCHORS.principal,
    },
    {
      id: 'people',
      label: WIZARD_STEP_LABELS.people,
      // School-owned routine work: onboarding people is OPTIONAL in the
      // wizard (the school completes its roster after handover).
      optional: true,
      status: stepState(extras.teachers > 0, extras.teachers > 0),
      detail:
        extras.teachers > 0
          ? `${extras.teachers} teacher${extras.teachers === 1 ? '' : 's'} onboarded`
          : 'no teachers yet — the school adds its own roster after handover',
      manageAnchor: undefined,
    },
    {
      id: 'fees',
      label: WIZARD_STEP_LABELS.fees,
      optional: true,
      status: stepState(Boolean(fees?.done) || extras.masterFeeHeads > 0, extras.masterFeeHeads > 0 || Boolean(fees?.done)),
      detail:
        extras.masterFeeHeads > 0
          ? `${extras.masterFeeHeads} catalogue head${extras.masterFeeHeads === 1 ? '' : 's'} · ${extras.feeStructures} structure${extras.feeStructures === 1 ? '' : 's'}`
          : (fees?.detail ?? 'no fee configuration'),
      manageAnchor: WIZARD_MANAGE_ANCHORS.fees,
    },
    {
      id: 'exams',
      label: WIZARD_STEP_LABELS.exams,
      optional: true,
      status: stepState(Boolean(exams?.done) || extras.examTypes > 0, extras.examTypes > 0 || Boolean(exams?.done)),
      detail:
        extras.examTypes > 0
          ? `${extras.examTypes} exam type${extras.examTypes === 1 ? '' : 's'} configured`
          : 'no examination configuration',
      manageAnchor: undefined,
    },
    {
      id: 'website',
      label: WIZARD_STEP_LABELS.website,
      optional: true,
      status: stepState(Boolean(website?.done), Boolean(website?.done)),
      detail: website?.detail ?? 'default tenant URL only',
      manageAnchor: WIZARD_MANAGE_ANCHORS.website,
    },
    {
      id: 'modules',
      label: WIZARD_STEP_LABELS.modules,
      optional: true,
      status: stepState(extras.schoolFlagOverrides > 0, extras.schoolFlagOverrides > 0),
      detail:
        extras.schoolFlagOverrides > 0
          ? `${extras.schoolFlagOverrides} school override${extras.schoolFlagOverrides === 1 ? '' : 's'} saved`
          : 'platform master defaults apply',
      manageAnchor: WIZARD_MANAGE_ANCHORS.modules,
    },
  ]
}

export interface ActivationMissingItem {
  id: string
  label: string
  fix: string
}

export interface ActivationRequirements {
  /** True when the school may activate under the REQUESTED strictness. */
  ok: boolean
  /** Exactly what remains — always computed, explained in UI + audit. */
  missing: ActivationMissingItem[]
  readinessSummary: SetupReadiness['summary']
  /** The strictness level the caller requested. */
  strict: boolean
}

/**
 * Server-side activation revalidation — the ONE derivation used by both
 * the wizard review screen (guidance) and the activate route
 * (enforcement). Requirements are recomputed from the live readiness
 * document; a client can never assert completion.
 *
 * Always-blocked: no principal account (a school cannot operate without
 * its administrator — provisioning guarantees one, but the check is the
 * safety net, not an assumption).
 *
 * Strict (wizard `{requireComplete: true}`): additionally blocks until
 * the identity core block AND the academic structure (session year + at
 * least one class) are persisted. People/fees/website/etc. stay
 * school-owned routine work and never block activation — matching the
 * task's "optional sections must not block activation" rule and the
 * established lifecycle invariant.
 */
export function computeActivationRequirements(
  school: Pick<WizardSchoolSnapshot, 'name' | 'status'>,
  readiness: SetupReadiness,
  principalCount: number,
  strict: boolean,
  identityCoreDone: boolean,
): ActivationRequirements {
  const byId = sectionMap(readiness)
  const missing: ActivationMissingItem[] = []

  if (principalCount < 1) {
    missing.push({
      id: 'principal',
      label: 'Principal account',
      fix: 'Create or confirm the principal account (Setup → Principal account).',
    })
  }

  if (strict) {
    if (!identityCoreDone) {
      missing.push({
        id: 'identity',
        label: 'School identity (core contact block)',
        fix: 'Save the school’s address, city, official phone and email (Setup → School identity).',
      })
    }
    if (!byId.get('academic')?.done) {
      missing.push({
        id: 'academic',
        label: 'Academic configuration',
        fix: 'Set the session year and add at least one class (Setup → Academic configuration).',
      })
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    readinessSummary: readiness.summary,
    strict,
  }
}
