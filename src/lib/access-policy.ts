/**
 * access-policy — the subscription-ready SCHOOL ACCESS MODEL.
 *
 * The single domain-layer policy that answers: "may this school's users
 * use the product right now?" — independent of WHO asks (the answer is
 * per-TENANT, evaluated server-side at authentication boundaries).
 *
 * Model (documented in docs/SCHOOL_SUBSCRIPTION_ACCESS_MODEL.md):
 *
 *   School.status (tenant lifecycle, owned by the platform control plane)
 *     ACTIVE    → full access for all school roles
 *     TRIAL     → full access for all school roles
 *     SUSPENDED → NO school-role access (data preserved, read-only for
 *                 the platform control plane only)
 *
 *   School.plan (FREE | STANDARD | PRO | ENTERPRISE)
 *     A feature-matrix INTERFACE only in this phase — no billing, no
 *     payment provider, no automatic enforcement beyond the module flag
 *     system already owned by the platform control plane. The matrix is
 *     the seam where future plan gating plugs in WITHOUT touching call
 *     sites (they ask can(school, capability), never plan strings).
 *
 * Contract guarantees (verified by tests/security/access-policy tests):
 *   · Expired/suspended tenants: Principal/Teacher/Student/Parent access
 *     is BLOCKED at the domain layer (login + every school API that
 *     routes through withUser's status gate).
 *   · The school RECORD and DATA are never deleted merely because the
 *     subscription lapsed — suspension revokes sessions, not rows.
 *   · The platform control plane RETAINS full management access (its own
 *     identity boundary, Phase 6) regardless of school status.
 *   · No school-side code path can flip a school back to ACTIVE.
 */

export type SchoolStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED'
export type SchoolPlan = 'FREE' | 'STANDARD' | 'PRO' | 'ENTERPRISE'

export interface SchoolAccessSubject {
  status: string | null | undefined
  plan: string | null | undefined
}

export type SchoolAccessDecision =
  | { allowed: true; status: SchoolStatus; plan: SchoolPlan; scope: 'full' }
  | { allowed: false; status: SchoolStatus; plan: SchoolPlan; scope: 'none'; reason: string }

const KNOWN_STATUSES: SchoolStatus[] = ['ACTIVE', 'TRIAL', 'SUSPENDED']
const KNOWN_PLANS: SchoolPlan[] = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE']

/** Tenant access for school roles (login + API gates). Fail-closed:
 *  unknown/missing status — including a missing subject — is treated as
 *  suspended, never open. */
export function evaluateSchoolAccess(school: SchoolAccessSubject | null | undefined): SchoolAccessDecision {
  const rawStatus = school?.status
  const rawPlan = school?.plan
  const status = (KNOWN_STATUSES.includes(rawStatus as SchoolStatus)
    ? rawStatus
    : 'SUSPENDED') as SchoolStatus
  const plan = (KNOWN_PLANS.includes(rawPlan as SchoolPlan) ? rawPlan : 'STANDARD') as SchoolPlan

  if (status === 'ACTIVE' || status === 'TRIAL') {
    return { allowed: true, status, plan, scope: 'full' }
  }
  return {
    allowed: false,
    status,
    plan,
    scope: 'none',
    reason:
      status === 'SUSPENDED'
        ? 'This school account is suspended. Please contact the school administrator or platform support.'
        : 'This school account is not active.',
  }
}

/* ─────────── Plan capability matrix (interface only, no billing) ─────────── */

export type SchoolCapability =
  | 'website-cms'
  | 'gallery'
  | 'announcements'
  | 'online-payments'
  | 'library'
  | 'transport'
  | 'hostel'
  | 'payroll'
  | 'analytics'
  | 'platform-support'

/**
 * Plan → capability matrix. FREE carries the core teaching workflow;
 * paid tiers progressively unlock the operating-platform surface.
 *
 * This phase: the matrix is a DOMAIN ABSTRACTION + documentation seam
 * (call sites ask can(), never plan strings) so the future billing
 * phase enforces plans centrally without re-writing call sites.
 * Runtime enforcement TODAY remains the module-flag system owned by
 * the platform control plane (School.featureFlags ?? PlatformSetting).
 */
const PLAN_CAPABILITIES: Record<SchoolPlan, SchoolCapability[]> = {
  FREE: ['announcements'],
  STANDARD: ['announcements', 'website-cms', 'gallery', 'library', 'transport'],
  PRO: [
    'announcements', 'website-cms', 'gallery', 'library', 'transport',
    'hostel', 'payroll', 'analytics',
  ],
  ENTERPRISE: [
    'announcements', 'website-cms', 'gallery', 'library', 'transport',
    'hostel', 'payroll', 'analytics', 'online-payments', 'platform-support',
  ],
}

/** Does this plan include the capability? (Pure function, no I/O.) */
export function planAllows(plan: string | null | undefined, capability: SchoolCapability): boolean {
  const p = (KNOWN_PLANS.includes(plan as SchoolPlan) ? plan : 'STANDARD') as SchoolPlan
  return PLAN_CAPABILITIES[p].includes(capability)
}
