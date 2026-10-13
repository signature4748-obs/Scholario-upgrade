/**
 * entitlement/student — THE centralized per-student entitlement service
 * (SUBSCRIPTION & ENTITLEMENT SYSTEM, Model B/C).
 *
 * Pure composition over server-loaded rows — no I/O, no client input.
 * Composes the EXISTING tenant entitlement (evaluateTenantEntitlement)
 * with the school's billing model and the student's entitlement row.
 *
 * Precedence (each rule stated in docs/SUBSCRIPTION_ENTITLEMENT_SYSTEM.md §5):
 *   1. Account lock (User.subscriptionStatus LOCKED) → restricted.
 *   2. Tenant state wins: a RESTRICTED/SUSPENDED tenant locks students
 *      regardless of individual entitlements (per-student payments never
 *      override a tenant suspension).
 *   3. School-wide coverage: billingModel SCHOOL_WIDE + tenant
 *      ACTIVE/GRACE → the student is COVERED (an absent individual
 *      subscription must NOT lock a student on a school-wide plan).
 *   4. MIXED model → students still need their own entitlement (the school
 *      plan covers staff-run modules only).
 *   5. Student row: PENDING (validity in the future), ACTIVE (inside the
 *      explicit window — computed LIVE at evaluation time, never dependent
 *      on a scheduled job), EXPIRED (past validityEnd), REVOKED, SUSPENDED.
 *   6. No row → NOT_SUBSCRIBED.
 *
 * Enforced server-side in withUser for STUDENT sessions on business routes
 * (the exempt renewal/claim surface stays reachable so a locked student can
 * activate — authentication never depends on subscription state).
 */

import type { TenantEntitlement } from './entitlement'

export type StudentEntitlementState =
  | 'COVERED_BY_SCHOOL'
  | 'ACTIVE'
  | 'PENDING'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'NOT_SUBSCRIBED'
  | 'ACCOUNT_LOCKED'
  | 'TENANT_RESTRICTED'
  | 'TENANT_SUSPENDED'

export interface StudentEntitlementSnapshot {
  status: string | null
  validityStart: Date | null
  validityEnd: Date | null
  source: string | null
}

export interface StudentEntitlementInput {
  accountSubscriptionStatus: string | null | undefined
  tenant: TenantEntitlement
  billingModel: string | null | undefined
  entitlement: StudentEntitlementSnapshot | null
  now?: Date
}

export interface StudentEntitlementDecision {
  state: StudentEntitlementState
  /** May this student reach business (paid student) APIs? Server-enforced. */
  businessAllowed: boolean
  /** True when an individual entitlement would add access (used by UX). */
  needsIndividualEntitlement: boolean
  message: string | null
  validityEnd: Date | null
}

const BILLING_MODELS_REQUIRING_STUDENT_ENTITLEMENT = new Set(['PER_STUDENT', 'MIXED'])

const MESSAGES: Partial<Record<StudentEntitlementState, string>> = {
  ACCOUNT_LOCKED:
    'This account is locked. You can still sign in and review your account status. Contact your school administrator or SCHOLARIO support.',
  TENANT_RESTRICTED:
    'Your school\u2019s SCHOLARIO subscription needs renewal. Business modules are locked until it is renewed.',
  TENANT_SUSPENDED:
    'Your school\u2019s SCHOLARIO subscription is suspended. Please contact SCHOLARIO support.',
  NOT_SUBSCRIBED:
    'Your annual student subscription is not active yet. Ask your school office for an activation code, or pay online from the subscription page.',
  PENDING:
    'Your student subscription starts on the validity start date. Until then, student modules are locked.',
  EXPIRED:
    'Your annual student subscription has expired. Renew with an activation code from your school office, or pay online.',
  REVOKED:
    'Your student subscription was withdrawn. Contact your school administrator or SCHOLARIO support.',
  SUSPENDED:
    'Your student subscription is suspended. Contact your school administrator or SCHOLARIO support.',
}

export function evaluateStudentEntitlement(input: StudentEntitlementInput): StudentEntitlementDecision {
  const now = input.now ?? new Date()

  // 1 — account-level lock (legacy Phase-10 semantics preserved).
  if ((input.accountSubscriptionStatus ?? 'ACTIVE') === 'LOCKED') {
    return { state: 'ACCOUNT_LOCKED', businessAllowed: false, needsIndividualEntitlement: false, message: MESSAGES.ACCOUNT_LOCKED!, validityEnd: null }
  }

  // 2 — tenant state wins over individual entitlements.
  if (input.tenant.state === 'SUSPENDED' || input.tenant.state === 'NOT_ACTIVATED') {
    return { state: 'TENANT_SUSPENDED', businessAllowed: false, needsIndividualEntitlement: false, message: input.tenant.message ?? MESSAGES.TENANT_SUSPENDED!, validityEnd: null }
  }
  if (!input.tenant.businessAllowed) {
    return { state: 'TENANT_RESTRICTED', businessAllowed: false, needsIndividualEntitlement: false, message: input.tenant.message ?? MESSAGES.TENANT_RESTRICTED!, validityEnd: null }
  }

  // 3 — school-wide coverage (SCHOOL_WIDE + tenant ACTIVE/GRACE).
  const billingModel = String(input.billingModel ?? 'SCHOOL_WIDE')
  const requiresIndividual = BILLING_MODELS_REQUIRING_STUDENT_ENTITLEMENT.has(billingModel)
  if (!requiresIndividual) {
    return { state: 'COVERED_BY_SCHOOL', businessAllowed: true, needsIndividualEntitlement: false, message: null, validityEnd: null }
  }

  // 4/5 — the student's own entitlement, evaluated LIVE from the window.
  const row = input.entitlement
  if (!row) {
    return { state: 'NOT_SUBSCRIBED', businessAllowed: false, needsIndividualEntitlement: true, message: MESSAGES.NOT_SUBSCRIBED!, validityEnd: null }
  }
  const start = row.validityStart ? new Date(row.validityStart) : null
  const end = row.validityEnd ? new Date(row.validityEnd) : null

  if (row.status === 'REVOKED') {
    return { state: 'REVOKED', businessAllowed: false, needsIndividualEntitlement: true, message: MESSAGES.REVOKED!, validityEnd: end }
  }
  if (row.status === 'SUSPENDED') {
    return { state: 'SUSPENDED', businessAllowed: false, needsIndividualEntitlement: true, message: MESSAGES.SUSPENDED!, validityEnd: end }
  }
  // LIVE expiry computation — never trust the stored status alone.
  if (end && end.getTime() <= now.getTime()) {
    return { state: 'EXPIRED', businessAllowed: false, needsIndividualEntitlement: true, message: MESSAGES.EXPIRED!, validityEnd: end }
  }
  if (start && start.getTime() > now.getTime()) {
    return { state: 'PENDING', businessAllowed: false, needsIndividualEntitlement: true, message: MESSAGES.PENDING!, validityEnd: end }
  }
  return { state: 'ACTIVE', businessAllowed: true, needsIndividualEntitlement: false, message: null, validityEnd: end }
}

/** Serializable projection for API responses. */
export interface StudentEntitlementPublic {
  state: StudentEntitlementState
  businessAllowed: boolean
  message: string | null
  validityEnd: string | null
  source: string | null
  planCode: string | null
}

export function publicStudentEntitlement(
  decision: StudentEntitlementDecision,
  snapshot: { source?: string | null; planCode?: string | null } = {},
): StudentEntitlementPublic {
  return {
    state: decision.state,
    businessAllowed: decision.businessAllowed,
    message: decision.message,
    validityEnd: decision.validityEnd ? decision.validityEnd.toISOString() : null,
    source: snapshot.source ?? null,
    planCode: snapshot.planCode ?? null,
  }
}
