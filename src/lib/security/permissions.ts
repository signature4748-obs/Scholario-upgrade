/**
 * Server-side role → capability permission matrix.
 *
 * PHASE 2 — Multi-Tenant Isolation + Authorization.
 *
 * This is the AUTHORITATIVE server-side permission source for Scholario-OS.
 * A client-side matrix may exist for UI affordances (hiding buttons), but
 * server routes MUST gate through this module (or an explicit role list) —
 * never through frontend hiding.
 *
 * Semantics:
 *   · A permission is a CAPABILITY, granted to a set of roles.
 *   · Role membership is resolved from the authenticated session (never
 *     client input).
 *   · Capabilities marked `school-scoped` additionally require a tenant
 *     context (session school) and are refused for SUPER_ADMIN (platform
 *     admins operate through platform routes, not school routes).
 *   · Resource-level ownership (teacher CSA scope, class-teacher scope,
 *     student self-service, guardian scope) is enforced SEPARATELY by the
 *     resource-scope guards in authz.ts — a capability never implies
 *     ownership of another tenant's or another user's rows.
 */

export type Role =
  | 'SUPER_ADMIN'
  | 'PRINCIPAL'
  | 'MANAGEMENT'
  | 'ACCOUNTANT'
  | 'TEACHER'
  | 'STUDENT'
  | 'PARENT'
  | 'DRIVER'

/**
 * The capability matrix. Keys are stable permission strings; values are the
 * roles that hold the capability (order irrelevant).
 *
 * Naming: `<domain>.<resource>.<action>`.
 */
export const PERMISSIONS: Record<string, readonly Role[]> = {
  // ── Platform ─────────────────────────────────────────────────────────
  'platform.admin': ['SUPER_ADMIN'],

  // ── School people ────────────────────────────────────────────────────
  'school.students.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.students.export': ['PRINCIPAL', 'MANAGEMENT'],
  'school.students.write': ['PRINCIPAL', 'MANAGEMENT'],
  'school.staff.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.staff.write': ['PRINCIPAL', 'MANAGEMENT'],
  'school.contacts.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'ACCOUNTANT'],

  // ── School master data ───────────────────────────────────────────────
  'school.masterdata.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.masterdata.write': ['PRINCIPAL', 'MANAGEMENT'],

  // ── Finance ──────────────────────────────────────────────────────────
  'school.finance.read': ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'],
  'school.finance.write': ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'],
  'school.finance.export': ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'],
  'school.finance.reconcile': ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'],

  // ── Exams ────────────────────────────────────────────────────────────
  'exams.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'exams.marks.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'exams.marks.write': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'exams.marks.submit': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'exams.results.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'exams.results.manage': ['PRINCIPAL', 'MANAGEMENT'],
  'exams.settings.write': ['PRINCIPAL', 'MANAGEMENT'],
  'exams.audit.read': ['PRINCIPAL', 'MANAGEMENT'],

  // ── Question bank / AI ───────────────────────────────────────────────
  'school.questionbank.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.questionbank.write': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],

  // ── Homework ─────────────────────────────────────────────────────────
  'school.homework.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.homework.write': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],
  'school.homework.oversight': ['PRINCIPAL', 'MANAGEMENT'],

  // ── Communication ────────────────────────────────────────────────────
  'school.announcements.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'ACCOUNTANT'],
  'school.announcements.publish': ['PRINCIPAL', 'MANAGEMENT'],
  'school.messages.send': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'ACCOUNTANT'],

  // ── Operations ───────────────────────────────────────────────────────
  'school.events.write': ['PRINCIPAL', 'MANAGEMENT'],
  'school.library.manage': ['PRINCIPAL', 'MANAGEMENT'],
  'school.transport.read': ['PRINCIPAL', 'MANAGEMENT'],
  'school.rooms.write': ['PRINCIPAL', 'MANAGEMENT'],
  'school.timetable.publish': ['PRINCIPAL'],
  'school.dashboard.read': ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'],

  // ── Self-service (identity-derived; always additionally ownership-checked) ──
  'self.read': ['STUDENT', 'PARENT', 'TEACHER', 'PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'DRIVER', 'SUPER_ADMIN'],
}

/**
 * Does `role` hold `permission`?
 * Unknown permissions fail CLOSED (false) — a typo must never open a door.
 */
export function can(role: string, permission: string): boolean {
  const allowed = PERMISSIONS[permission]
  if (!allowed) return false
  return (allowed as readonly string[]).includes(role)
}

/** Roles that hold a permission (for route-layer role derivation). */
export function rolesWith(permission: string): string[] {
  return [...(PERMISSIONS[permission] ?? [])]
}
