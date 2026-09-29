/**
 * authz — THE centralized request authorization model.
 *
 * PHASE 2 — Multi-Tenant Isolation + Authorization.
 *
 * The fundamental invariant this module enforces:
 *
 *   NO USER FROM SCHOOL A MAY READ, WRITE, MODIFY, DELETE, SEARCH, EXPORT,
 *   DOWNLOAD OR INFER SCHOOL B DATA.
 *
 * Every request flows through one pipeline:
 *
 *   Request
 *     → authenticated identity     (session cookie → User row; status ACTIVE)
 *     → tenant context             (User.schoolId from the DB — NEVER from
 *                                   query/body/headers; school-scoped routes
 *                                   additionally reject SUPER_ADMIN)
 *     → role                       (User.role from the DB)
 *     → permission                 (server-side matrix: can(role, permission)
 *                                   or an explicit role list)
 *     → resource scope             (assertSameTenant / scopedId /
 *                                   assertTenantRow / assertFkInTenant —
 *                                   every by-id lookup is tenant-checked)
 *     → database operation         (Prisma where ALWAYS carries schoolId for
 *                                   tenant-owned models)
 *
 * DESIGN RULES (hostile-tenant posture):
 *   · Frontend hiding is never authorization.
 *   · URL/path ids are never trusted — they are re-verified against the
 *     caller's tenant before any read or write ("fail-safe 404").
 *   · Client-provided `schoolId` is never trusted. Where a body carries
 *     schoolId it is ignored in favor of the session tenant; spoofing it
 *     cannot change behavior (covered by tests).
 *   · Cross-tenant resources "do not exist": mismatch returns 404 (never
 *     403-with-distinction, never data) — no existence oracle, no inference.
 */

import type { AuthUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { AppError } from './errors'
import { can } from './permissions'

// ─────────────────────────────────────────────────────────────────────────
// Tenant / request context
// ─────────────────────────────────────────────────────────────────────────

/**
 * The resolved authorization context handed to route handlers.
 * `schoolId` is the TENANT — derived exclusively from the authenticated
 * user's DB row.
 */
export interface Authz {
  /** The authenticated identity (session-resolved). */
  user: AuthUser
  /** Role from the DB (never client input). */
  role: string
  /** Tenant id from the DB. Present for every school-scoped authorization. */
  schoolId: string
  /** True only for the platform role (SUPER_ADMIN, schoolId null). */
  isPlatform: boolean
  /** Prisma `where` fragment for tenant-owned models. */
  tenant: { schoolId: string }
}

export interface AuthzPolicy {
  /**
   * Explicit role allowlist (legacy style). Mutually exclusive with
   * `permission` in spirit — if both are given BOTH must pass.
   */
  roles?: string[]
  /**
   * Capability name resolved through the server-side permission matrix
   * (src/lib/security/permissions.ts). Unknown capabilities fail closed.
   */
  permission?: string
  /**
   * Tenant resolution:
   *   'school'   (default) — the caller MUST have a session school; the
   *                          route is school-scoped and SUPER_ADMIN is
   *                          refused (platform admins use platform routes).
   *   'any'      — authenticated identity only (self-service / platform
   *                routes that enforce ownership themselves).
   */
  tenant?: 'school' | 'any'
}

/** Resolve identity → tenant context (+ role/permission gates). */
export async function authorize(user: AuthUser | null, policy: AuthzPolicy = {}): Promise<Authz> {
  // 1 — Authenticated identity (withUser already rejects missing/inactive,
  //     this guard covers direct authorize() callers).
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError('UNAUTHORIZED', { internalDetail: 'authorize: no active identity' })
  }

  const role = user.role
  const isPlatform = role === 'SUPER_ADMIN'

  // 2 — Role gate.
  if (policy.roles && !policy.roles.includes(role)) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You do not have access to this resource',
      internalDetail: `authorize: role ${role} not in ${policy.roles.join('|')}`,
    })
  }
  // 3 — Permission gate (server-side matrix; unknown → closed).
  if (policy.permission && !can(role, policy.permission)) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You do not have access to this resource',
      internalDetail: `authorize: role ${role} lacks permission ${policy.permission}`,
    })
  }

  // 4 — Tenant context.
  const tenantMode = policy.tenant ?? 'school'
  if (tenantMode === 'school') {
    if (isPlatform || !user.schoolId) {
      throw new AppError('FORBIDDEN', {
        publicMessage: 'This resource is school-scoped and not available to your account',
        internalDetail: `authorize: school-scoped route, role=${role} schoolId=${user.schoolId ?? 'null'}`,
      })
    }
  }

  // The tenant ALWAYS comes from the authenticated context. For a
  // schoolless identity (platform admin) no tenant is minted — school-
  // scoped operations above already refused them.
  const schoolId = user.schoolId ?? ''
  return { user, role, schoolId, isPlatform, tenant: { schoolId } }
}

/**
 * The request-pipeline wrapper: `withAuthz(policy, handler)` replaces
 * `withUser(handler, { roles })` on hardened routes. It composes the Phase-1
 * envelope (safe errors, request ids) with the Phase-2 authorization
 * pipeline. `schoolId` inside the handler is authoritative — never a
 * client-supplied value.
 *
 * NOTE: the return type is `Promise<Response>` (not `Promise<unknown>`) so
 * route exports satisfy Next's route-handler contract
 * (`void | Response | Promise<void | Response>`); behavior is unchanged —
 * the promise still resolves to the Phase-1 envelope response.
 */
export function withAuthz(
  policy: AuthzPolicy,
  handler: (ctx: Authz) => Promise<unknown>,
): Promise<Response> {
  return withUser(async (user) => {
    const ctx = await authorize(user, policy)
    return handler(ctx)
  }, policy.roles ? { roles: policy.roles } : undefined)
}

// ─────────────────────────────────────────────────────────────────────────
// Resource-scope guards (fail-safe 404 semantics)
// ─────────────────────────────────────────────────────────────────────────

/** Prisma `where` fragment for a by-id lookup scoped to the tenant. */
export function scopedId(ctx: Authz, id: string): { id: string; schoolId: string } {
  return { id, schoolId: ctx.schoolId }
}

/** Tenant fragment to spread into list queries. */
export function scopedWhere(ctx: Authz): { schoolId: string } {
  return ctx.tenant
}

/**
 * Post-fetch tenant check: a row fetched by id "does not exist" unless it
 * belongs to the caller's school. Returns the row for chaining; throws 404
 * on null/mismatch. Never reveals whether the id exists in another tenant.
 */
export function assertTenantRow<T extends { schoolId: string | null }>(
  row: T | null | undefined,
  ctx: Authz,
  label = 'Resource',
): T {
  if (!row || row.schoolId !== ctx.schoolId) {
    throw new AppError('NOT_FOUND', {
      publicMessage: `${label} not found`,
      internalDetail: `assertTenantRow: ${label} missing or foreign tenant`,
    })
  }
  return row
}

/**
 * Same check for a raw schoolId value (post-fetch or relation-derived).
 * Mismatch → 404. Kept deliberately separate from assertTenantRow for rows
 * whose shape is not under our control.
 */
export function assertSameTenant(
  ctx: Authz,
  resourceSchoolId: string | null | undefined,
  label = 'Resource',
): void {
  if (resourceSchoolId !== ctx.schoolId) {
    throw new AppError('NOT_FOUND', {
      publicMessage: `${label} not found`,
      internalDetail: `assertSameTenant: ${label} school ${resourceSchoolId ?? 'null'} ≠ caller ${ctx.schoolId}`,
    })
  }
}

/**
 * FK-in-tenant validation for WRITE paths: before linking resource `id`
 * (classId / subjectId / studentId / teacherUserId / routeId / …) into a
 * tenant row, verify the target exists in the CALLER's school.
 *
 * `fetch` must return the candidate row (or null); only its schoolId is
 * inspected. Throws 404 ("not found in your school") for foreign ids —
 * again no existence oracle.
 */
export async function assertFkInTenant(
  ctx: Authz,
  id: string | null | undefined,
  fetch: (id: string) => Promise<{ schoolId: string | null } | null>,
  label: string,
): Promise<void> {
  if (!id) return
  const row = await fetch(id)
  if (!row || row.schoolId !== ctx.schoolId) {
    throw new AppError('NOT_FOUND', {
      publicMessage: `${label} not found`,
      internalDetail: `assertFkInTenant: ${label} ${id} missing or foreign tenant`,
    })
  }
}

/**
 * Student FK-in-tenant validation (the single hottest write-path guard —
 * marks, attendance, fees, library issues all link students). Verifies the
 * student exists AND belongs to the caller's school; optionally that the
 * student sits in the given class.
 */
export async function assertStudentInTenant(
  ctx: Authz,
  studentId: string,
  opts: { classId?: string | null } = {},
): Promise<{ id: string; schoolId: string; classId: string | null }> {
  const student = await db.student.findFirst({
    where: {
      id: studentId,
      schoolId: ctx.schoolId,
      ...(opts.classId ? { classId: opts.classId } : {}),
    },
    select: { id: true, schoolId: true, classId: true },
  })
  if (!student) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Student not found',
      internalDetail: `assertStudentInTenant: student ${studentId} missing or foreign tenant`,
    })
  }
  return student
}

// ─────────────────────────────────────────────────────────────────────────
// Client-supplied schoolId defense
// ─────────────────────────────────────────────────────────────────────────

/**
 * Client-provided schoolId is NEVER trusted. Routes that accept a body may
 * call this to strip the field before use so a spoofed tenant cannot leak
 * into any downstream logic. (Real protection is that ctx.schoolId is the
 * ONLY value routes use; this makes the invariant mechanical.)
 */
export function stripClientSchoolId<T extends Record<string, unknown>>(body: T): T {
  if ('schoolId' in body) delete (body as Record<string, unknown>).schoolId
  return body
}
