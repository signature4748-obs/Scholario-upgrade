/**
 * entitlement/staff — THE centralized per-staff (TEACHER) entitlement
 * service (2026-10-30, STAFF ENTITLEMENTS).
 *
 * Pure composition over server-loaded rows — no I/O, no client input.
 * Composes the EXISTING tenant entitlement (evaluateTenantEntitlement)
 * with the school's staffCoverage policy and the teacher's own
 * StaffEntitlement row.
 *
 * Precedence:
 *   1. Account lock (User.subscriptionStatus LOCKED) → restricted.
 *   2. Tenant state wins: a RESTRICTED/SUSPENDED tenant locks staff
 *      regardless of individual entitlements (per-seat payments never
 *      override a tenant suspension — the tenant gate always applies).
 *   3. staffCoverage TENANT (default) → the teacher is COVERED by the
 *      tenant subscription exactly as today (zero behavior change for
 *      every existing tenant; PRINCIPAL accounts are never evaluated
 *      here at all — administrative privileges are not a paid seat).
 *   4. staffCoverage PER_SEAT → the teacher's own entitlement, evaluated
 *      LIVE from its explicit validity window (access never depends on a
 *      scheduled job): PENDING (future start), ACTIVE (inside the
 *      window), EXPIRED (past validityEnd), REVOKED, SUSPENDED.
 *   5. No row → NOT_SUBSCRIBED.
 *
 * Enforced server-side in withUser for TEACHER sessions on business
 * routes (the exempt renewal/claim surface stays reachable so a locked
 * teacher can activate — authentication never depends on subscription
 * state).
 */

import type { TenantEntitlement } from './entitlement'

export type StaffEntitlementState =
  | 'COVERED_BY_TENANT'
  | 'ACTIVE'
  | 'PENDING'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'NOT_SUBSCRIBED'
  | 'ACCOUNT_LOCKED'
  | 'TENANT_RESTRICTED'
  | 'TENANT_SUSPENDED'

export interface StaffEntitlementSnapshot {
  status: string | null
  validityStart: Date | null
  validityEnd: Date | null
  source: string | null
}

export interface StaffEntitlementInput {
  accountSubscriptionStatus: string | null | undefined
  tenant: TenantEntitlement
  staffCoverage: string | null | undefined
  entitlement: StaffEntitlementSnapshot | null
  now?: Date
}

export interface StaffEntitlementDecision {
  state: StaffEntitlementState
  /** May this teacher reach business (paid) APIs? Server-enforced. */
  businessAllowed: boolean
  /** True when an individual entitlement would add access (used by UX). */
  needsIndividualEntitlement: boolean
  message: string | null
  validityEnd: Date | null
}

/** Only PER_SEAT requires an individual staff entitlement — every other
 *  value (including unknown/legacy) maps to TENANT coverage, the safe
 *  default that preserves today's behavior for every existing tenant. */
export function requiresStaffEntitlement(staffCoverage: string | null | undefined): boolean {
  return String(staffCoverage ?? 'TENANT') === 'PER_SEAT'
}

const MESSAGES: Partial<Record<StaffEntitlementState, string>> = {
  ACCOUNT_LOCKED:
    'This account is locked. You can still sign in and review your account status. Contact your school administrator or SCHOLARIO support.',
  TENANT_RESTRICTED:
    'Your school\u2019s SCHOLARIO subscription needs renewal. Business modules are locked until it is renewed.',
  TENANT_SUSPENDED:
    'Your school\u2019s SCHOLARIO subscription is suspended. Please contact SCHOLARIO support.',
  NOT_SUBSCRIBED:
    'Your staff subscription is not active yet. Ask your school office for a staff activation code.',
  PENDING:
    'Your staff subscription starts on the validity start date. Until then, teacher modules are locked.',
  EXPIRED:
    'Your staff subscription has expired. Renew with a staff activation code from your school office.',
  REVOKED:
    'Your staff subscription was withdrawn. Contact your school administrator or SCHOLARIO support.',
  SUSPENDED:
    'Your staff subscription is suspended. Contact your school administrator or SCHOLARIO support.',
}

export function evaluateStaffEntitlement(input: StaffEntitlementInput): StaffEntitlementDecision {
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

  // 3 — tenant coverage (staffCoverage TENANT + tenant ACTIVE/GRACE).
  if (!requiresStaffEntitlement(input.staffCoverage)) {
    return { state: 'COVERED_BY_TENANT', businessAllowed: true, needsIndividualEntitlement: false, message: null, validityEnd: null }
  }

  // 4/5 — the teacher's own entitlement, evaluated LIVE from the window.
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
export interface StaffEntitlementPublic {
  state: StaffEntitlementState
  businessAllowed: boolean
  message: string | null
  validityEnd: string | null
  source: string | null
  planCode: string | null
}

export function publicStaffEntitlement(
  decision: StaffEntitlementDecision,
  snapshot: { source?: string | null; planCode?: string | null } = {},
): StaffEntitlementPublic {
  return {
    state: decision.state,
    businessAllowed: decision.businessAllowed,
    message: decision.message,
    validityEnd: decision.validityEnd ? decision.validityEnd.toISOString() : null,
    source: snapshot.source ?? null,
    planCode: snapshot.planCode ?? null,
  }
}
