/**
 * role-features — PHASE 3 Role-wise Feature Control (security core).
 *
 * ONE new authorization layer, composed UNDER the existing ones:
 *
 *   effectiveAccess(school, role, feature) =
 *         module layers (PlatformSetting.modules → School.featureFlags)
 *       ∧ static RBAC baseline   (can(role, feature.permission) or the
 *                                  feature's explicit baseline roles)
 *       ∧ NOT roleFeatureDenied(school, role, feature)      ← THIS module
 *
 * Invariants (docs/super-admin-transformation/PHASE-3-ARCHITECTURE.md §5.2):
 *   · REMOVE-ONLY: an override row can only DENY a feature the role
 *     baseline already grants. Nothing here can grant access the RBAC
 *     baseline refuses, and nothing here re-enables a disabled module —
 *     those layers stay upstream and untouched.
 *   · Missing rows ⇒ INHERIT the RBAC baseline: every school that never
 *     used Role-wise Feature Control behaves exactly as before Phase 3.
 *   · Unknown feature key ⇒ FAIL CLOSED (mirrors can()'s unknown-
 *     permission rule in ./permissions).
 *   · The role always comes from the authenticated session (never client
 *     input) — callers pass ctx.schoolId / user.role only.
 *
 * The catalog is CODE-OWNED: a feature exists only where a real
 * enforcement point exists. `permission`-backed entries resolve their
 * baseline through the server matrix in ./permissions; `baselineRoles`
 * entries mirror the exact role lists their wired routes enforce (unit
 * tests pin both sides — a drift breaks tests, never silently widens).
 */

import { db } from '@/lib/db'
import { AppError } from './errors'
import { can, type CanonicalSchoolRole, CANONICAL_SCHOOL_ROLES, isCanonicalSchoolRole } from './permissions'

// ─────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────

/** UI grouping — mirrors school modules/surfaces (display only). */
export const FEATURE_GROUPS = [
  'people',
  'attendance',
  'exams',
  'homework',
  'fees',
  'communication',
  'operations',
  'academics',
] as const
export type FeatureGroupKey = (typeof FEATURE_GROUPS)[number]

export interface FeatureDef {
  /** Stable key. For permission-backed features this IS the PERMISSIONS key. */
  key: string
  group: FeatureGroupKey
  /** L3 baseline via the server matrix (can()). Exactly one baseline kind. */
  permission?: string
  /** L3 baseline for surfaces whose routes guard by explicit role list. */
  baselineRoles?: readonly CanonicalSchoolRole[]
  /** Human title — the UI never shows raw keys as the primary label. */
  label: string
  /** One-line plain-language description for non-technical operators. */
  description: string
}

export const ROLE_FEATURE_CATALOG: readonly FeatureDef[] = [
  // ── People ────────────────────────────────────────────────────────────
  {
    key: 'people.students.read', group: 'people', baselineRoles: ['PRINCIPAL', 'TEACHER'],
    label: 'View students',
    description: 'See the student directory, profiles and class rosters.',
  },
  {
    key: 'people.students.manage', group: 'people', baselineRoles: ['PRINCIPAL'],
    label: 'Manage students',
    description: 'Admit, edit and remove student records.',
  },
  {
    key: 'people.staff.manage', group: 'people', baselineRoles: ['PRINCIPAL'],
    label: 'Teachers & staff',
    description: 'View and manage teacher and staff records.',
  },
  {
    key: 'people.structure.read', group: 'people', baselineRoles: ['PRINCIPAL', 'TEACHER'],
    label: 'View classes & sections',
    description: 'See classes, sections and their teachers.',
  },
  {
    key: 'people.structure.manage', group: 'people', baselineRoles: ['PRINCIPAL'],
    label: 'Manage classes & sections',
    description: 'Create and edit classes, sections and class-teacher appointments.',
  },

  // ── Attendance ────────────────────────────────────────────────────────
  {
    key: 'attendance.mark', group: 'attendance', baselineRoles: ['PRINCIPAL', 'TEACHER'],
    label: 'Attendance (staff)',
    description: 'Mark and oversee daily and class-wise attendance.',
  },
  {
    key: 'attendance.student.view', group: 'attendance', baselineRoles: ['STUDENT'],
    label: 'Attendance (student view)',
    description: 'Students can see their own attendance record.',
  },

  // ── Exams (permission-backed — baselines come from the server matrix) ─
  {
    key: 'exams.read', group: 'exams', permission: 'exams.read',
    label: 'Examinations (view)',
    description: 'Access the examinations module, schedules, seating and admit cards.',
  },
  {
    key: 'exams.manage', group: 'exams', baselineRoles: ['PRINCIPAL'],
    label: 'Examinations (manage)',
    description: 'Create, publish and administer exams, schedules, duties and results declaration.',
  },
  {
    key: 'exams.marks.read', group: 'exams', permission: 'exams.marks.read',
    label: 'Marks (view)',
    description: 'View entered exam marks and mark sheets.',
  },
  {
    key: 'exams.marks.write', group: 'exams', permission: 'exams.marks.write',
    label: 'Marks (enter & edit)',
    description: 'Enter and edit exam marks, including exam-day attendance.',
  },
  {
    key: 'exams.marks.submit', group: 'exams', permission: 'exams.marks.submit',
    label: 'Marks (submit / lock)',
    description: 'Submit marks for finalisation (locks further edits).',
  },
  {
    key: 'exams.results.read', group: 'exams', permission: 'exams.results.read',
    label: 'Results (view)',
    description: 'View exam results and outcome summaries.',
  },
  {
    key: 'exams.settings.write', group: 'exams', permission: 'exams.settings.write',
    label: 'Exam settings',
    description: 'Configure exam types, grade scales, rules and report cards.',
  },
  {
    key: 'exams.audit.read', group: 'exams', permission: 'exams.audit.read',
    label: 'Exam audit trail',
    description: 'See the audit history of exam changes.',
  },

  // ── Homework (permission-backed) ──────────────────────────────────────
  {
    key: 'school.homework.read', group: 'homework', permission: 'school.homework.read',
    label: 'Homework (view)',
    description: 'View assigned homework and submissions.',
  },
  {
    key: 'school.homework.write', group: 'homework', permission: 'school.homework.write',
    label: 'Homework (create & review)',
    description: 'Create homework and review student submissions.',
  },
  {
    key: 'school.homework.oversight', group: 'homework', permission: 'school.homework.oversight',
    label: 'Homework (oversight)',
    description: 'School-wide homework analytics, grievances and no-homework days.',
  },

  // ── Fees ──────────────────────────────────────────────────────────────
  {
    key: 'school.finance.read', group: 'fees', permission: 'school.finance.read',
    label: 'Fees (view)',
    description: 'View fee records, dues and settlements.',
  },
  {
    key: 'fees.manage', group: 'fees', baselineRoles: ['PRINCIPAL'],
    label: 'Fees (manage)',
    description: 'Manage fee structures, catalogue, defaulters and verification.',
  },

  // ── Communication ─────────────────────────────────────────────────────
  {
    key: 'messaging.send', group: 'communication', baselineRoles: ['PRINCIPAL', 'TEACHER'],
    label: 'Messaging (staff)',
    description: 'Send and read staff messaging threads.',
  },
  {
    key: 'announcements.manage', group: 'communication', baselineRoles: ['PRINCIPAL'],
    label: 'Announcements (publish)',
    description: 'Publish school announcements and notices.',
  },

  // ── Operations (permission-backed) ────────────────────────────────────
  {
    key: 'school.library.manage', group: 'operations', permission: 'school.library.manage',
    label: 'Library management',
    description: 'Manage the library catalogue and book issues.',
  },
  {
    key: 'school.transport.read', group: 'operations', permission: 'school.transport.read',
    label: 'Transport (view)',
    description: 'View transport routes, vehicles and drivers.',
  },
  {
    key: 'school.events.write', group: 'operations', permission: 'school.events.write',
    label: 'Events & calendar',
    description: 'Create and manage school events.',
  },
  {
    key: 'school.questionbank.write', group: 'operations', permission: 'school.questionbank.write',
    label: 'Question bank',
    description: 'Manage the question bank and AI question generation.',
  },

  // ── Academics ─────────────────────────────────────────────────────────
  {
    key: 'subjects.manage', group: 'academics', baselineRoles: ['PRINCIPAL', 'TEACHER'],
    label: 'Subjects',
    description: 'View and manage the subject list.',
  },
  {
    key: 'timetable.publish', group: 'academics', baselineRoles: ['PRINCIPAL'],
    label: 'Publish timetables',
    description: 'Publish timetables to classes, teachers and students.',
  },
]

const CATALOG_BY_KEY: ReadonlyMap<string, FeatureDef> = new Map(
  ROLE_FEATURE_CATALOG.map((f) => [f.key, f]),
)

export function featureDef(key: string): FeatureDef | null {
  return CATALOG_BY_KEY.get(key) ?? null
}

export function isKnownFeatureKey(key: string): boolean {
  return CATALOG_BY_KEY.has(key)
}

/** All catalog keys for a group (UI ordering). */
export function featuresByGroup(group: FeatureGroupKey): FeatureDef[] {
  return ROLE_FEATURE_CATALOG.filter((f) => f.group === group)
}

/** Human group titles (UI). */
export const FEATURE_GROUP_LABELS: Record<FeatureGroupKey, string> = {
  people: 'People',
  attendance: 'Attendance',
  exams: 'Examinations',
  homework: 'Homework',
  fees: 'Fees',
  communication: 'Communication',
  operations: 'Operations',
  academics: 'Academics',
}

// ─────────────────────────────────────────────────────────────────────────
// Resolution (L3 baseline ∧ L4 override)
// ─────────────────────────────────────────────────────────────────────────

/** L3 — does the static RBAC baseline grant this feature to this role? */
export function featureBaselineAllows(def: FeatureDef, role: string): boolean {
  if (!isCanonicalSchoolRole(role)) return false
  if (def.permission) return can(role, def.permission)
  if (def.baselineRoles) return def.baselineRoles.includes(role)
  return false // malformed catalog entry — fail closed
}

/**
 * L4 — the school's explicit denials for one (school, role).
 * Unknown roles ⇒ empty set (nothing to deny; the baseline layer refuses
 * non-canonical roles independently).
 */
export async function roleFeatureDenials(
  schoolId: string,
  role: string,
): Promise<ReadonlySet<string>> {
  if (!schoolId || !isCanonicalSchoolRole(role)) return new Set()
  const rows = await db.roleFeatureOverride.findMany({
    where: { schoolId, role, denied: true },
    select: { featureKey: true },
  })
  return new Set(rows.map((r) => r.featureKey))
}

/**
 * The FULL effective decision for one feature. Both baseline kinds and
 * the override layer must permit. Unknown feature ⇒ false (fail closed).
 */
export async function isRoleFeatureAllowed(
  schoolId: string,
  role: string,
  featureKey: string,
): Promise<boolean> {
  const def = featureDef(featureKey)
  if (!def) return false
  if (!featureBaselineAllows(def, role)) return false
  if (!schoolId) return false
  const denied = await db.roleFeatureOverride.findFirst({
    where: { schoolId, role, featureKey, denied: true },
    select: { id: true },
  })
  return !denied
}

/**
 * The enforcement gate for routes/authorize(): throws the typed 403 when
 * the effective decision refuses. Fail-closed on unknown feature keys and
 * non-canonical roles (the latter is already refused by withUser — this
 * is defense in depth, never the only check).
 */
export async function assertRoleFeatureAllowed(
  schoolId: string,
  role: string,
  featureKey: string,
): Promise<void> {
  const def = featureDef(featureKey)
  if (!def) {
    throw new AppError('FEATURE_DISABLED_FOR_ROLE', {
      publicMessage: 'This feature is not available.',
      internalDetail: `role-features: unknown featureKey '${featureKey}' (fail closed)`,
    })
  }
  if (!isCanonicalSchoolRole(role)) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You do not have access to this resource',
      internalDetail: `role-features: non-canonical role ${role} for feature ${featureKey}`,
    })
  }
  if (!featureBaselineAllows(def, role)) {
    throw new AppError('FEATURE_DISABLED_FOR_ROLE', {
      publicMessage: roleBaselineMessage(def),
      internalDetail: `role-features: baseline refuses ${role} for ${featureKey}`,
    })
  }
  if (!schoolId) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You do not have access to this resource',
      internalDetail: `role-features: no tenant context for ${featureKey}`,
    })
  }
  const denied = await db.roleFeatureOverride.findFirst({
    where: { schoolId, role, featureKey, denied: true },
    select: { id: true },
  })
  if (denied) {
    throw new AppError('FEATURE_DISABLED_FOR_ROLE', {
      publicMessage: `Your school administrator has restricted "${def.label}" for your role.`,
      internalDetail: `role-features: ${featureKey} denied for ${role} in school ${schoolId.slice(0, 8)}…`,
    })
  }
}

function roleBaselineMessage(def: FeatureDef): string {
  return `"${def.label}" is not part of your role's base permissions.`
}

// ─────────────────────────────────────────────────────────────────────────
// Configuration read/write (platform plane)
// ─────────────────────────────────────────────────────────────────────────

export interface RoleFeatureCell {
  key: string
  label: string
  description: string
  group: FeatureGroupKey
  /** Effective decision for the role (baseline ∧ not denied). */
  enabled: boolean
  /** No explicit override row — the value IS the RBAC baseline. */
  inherited: boolean
  /** An explicit override row exists for this cell. */
  overridden: boolean
  /** The RBAC baseline refuses this role — shown locked, never configurable. */
  locked: boolean
}

export interface RoleFeatureConfigDTO {
  roles: Array<{
    role: CanonicalSchoolRole
    cells: RoleFeatureCell[]
    restrictedCount: number
  }>
  /** max(updatedAt) across this school's rows — the optimistic-lock token. */
  updatedAt: string | null
}

/** Full configuration view for the platform UI (one school, all roles). */
export async function roleFeaturesConfig(schoolId: string): Promise<RoleFeatureConfigDTO> {
  const rows = await db.roleFeatureOverride.findMany({
    where: { schoolId },
    select: { role: true, featureKey: true, updatedAt: true },
  })
  const deniedByKey = new Map<string, boolean>()
  let maxUpdated: Date | null = null
  for (const r of rows) {
    deniedByKey.set(`${r.role}|${r.featureKey}`, true)
    if (!maxUpdated || r.updatedAt > maxUpdated) maxUpdated = r.updatedAt
  }
  const roles = CANONICAL_SCHOOL_ROLES.map((role) => {
    const cells: RoleFeatureCell[] = ROLE_FEATURE_CATALOG.map((def) => {
      const baseline = featureBaselineAllows(def, role)
      const overridden = deniedByKey.get(`${role}|${def.key}`) === true
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        group: def.group,
        enabled: baseline && !overridden,
        inherited: !overridden,
        overridden,
        locked: !baseline,
      }
    })
    return {
      role,
      cells,
      restrictedCount: cells.filter((c) => c.overridden).length,
    }
  })
  return { roles, updatedAt: maxUpdated ? maxUpdated.toISOString() : null }
}

export interface RoleFeatureChange {
  role: CanonicalSchoolRole
  featureKey: string
  /** true = create/keep the denial; false = remove it (inherit baseline). */
  denied: boolean
}

/** Validate a changes payload against the catalog + canonical roles (422 on junk). */
export function validateRoleFeatureChanges(input: unknown): RoleFeatureChange[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new AppError('INVALID_INPUT', { publicMessage: 'changes must be a non-empty array' })
  }
  if (input.length > 500) {
    throw new AppError('INVALID_INPUT', { publicMessage: 'Too many changes in one request' })
  }
  const seen = new Set<string>()
  const out: RoleFeatureChange[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'Each change must be an object' })
    }
    const { role, featureKey, denied } = raw as Record<string, unknown>
    if (typeof role !== 'string' || !isCanonicalSchoolRole(role)) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Unknown role: ${String(role).slice(0, 40)}`,
      })
    }
    if (typeof featureKey !== 'string' || !isKnownFeatureKey(featureKey)) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Unknown feature: ${String(featureKey).slice(0, 40)}`,
      })
    }
    if (typeof denied !== 'boolean') {
      throw new AppError('INVALID_INPUT', { publicMessage: 'denied must be true or false' })
    }
    // A denial can only apply where the baseline grants (remove-only).
    const def = featureDef(featureKey)!
    if (denied && !featureBaselineAllows(def, role)) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `"${def.label}" is not part of the ${role.toLowerCase()}'s base permissions and cannot be configured.`,
      })
    }
    const k = `${role}|${featureKey}`
    if (seen.has(k)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'Duplicate change for the same feature and role' })
    }
    seen.add(k)
    out.push({ role, featureKey, denied })
  }
  return out
}

/**
 * Apply a validated change-set in ONE transaction with an optimistic
 * concurrency token: `baseUpdatedAt` must equal the school's current
 * max(row.updatedAt) (null = no rows yet). Mismatch ⇒ CONFLICT — the
 * caller reloads and reapplies; concurrent updates never silently
 * overwrite each other.
 */
export async function applyRoleFeatureChanges(
  schoolId: string,
  adminId: string,
  changes: RoleFeatureChange[],
  baseUpdatedAt: string | null,
): Promise<{ applied: number; updatedAt: string }> {
  const current = await db.roleFeatureOverride.aggregate({
    where: { schoolId },
    _max: { updatedAt: true },
  })
  const currentMax = current._max.updatedAt ? current._max.updatedAt.toISOString() : null
  if (currentMax !== (baseUpdatedAt ?? null)) {
    throw new AppError('CONFLICT', {
      publicMessage:
        'Role-wise feature configuration was changed by someone else. Reload the section and apply your changes again.',
      internalDetail: `role-features: optimistic lock mismatch (base=${baseUpdatedAt ?? 'null'} current=${currentMax ?? 'null'})`,
    })
  }
  const result = await db.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.denied) {
        await tx.roleFeatureOverride.upsert({
          where: {
            schoolId_role_featureKey: { schoolId, role: c.role, featureKey: c.featureKey },
          },
          create: { schoolId, role: c.role, featureKey: c.featureKey, denied: true, createdBy: adminId },
          update: { denied: true, createdBy: adminId },
        })
      } else {
        await tx.roleFeatureOverride.deleteMany({
          where: { schoolId, role: c.role, featureKey: c.featureKey },
        })
      }
    }
    const agg = await tx.roleFeatureOverride.aggregate({
      where: { schoolId },
      _max: { updatedAt: true },
    })
    return agg._max.updatedAt
  })
  return {
    applied: changes.length,
    updatedAt: (result ?? new Date()).toISOString(),
  }
}

/**
 * Effective feature map for ONE school user's own role — consumed by
 * GET /api/school-settings so the school UI can mirror what the server
 * enforces (nav courtesy only; the server remains the authority).
 * Unknown/unmapped features are simply absent — the client fails open
 * for absent keys exactly like module flags do.
 */
export async function effectiveFeaturesForRole(
  schoolId: string,
  role: string,
): Promise<Record<string, boolean>> {
  const def0 = CANONICAL_SCHOOL_ROLES.includes(role as CanonicalSchoolRole)
  if (!def0 || !schoolId) return {}
  const out: Record<string, boolean> = {}
  const denied = await roleFeatureDenials(schoolId, role)
  for (const def of ROLE_FEATURE_CATALOG) {
    if (featureBaselineAllows(def, role)) {
      out[def.key] = !denied.has(def.key)
    }
  }
  return out
}
