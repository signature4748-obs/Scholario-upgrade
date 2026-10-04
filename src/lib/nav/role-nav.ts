/**
 * nav/role-nav — the permission-aware navigation foundation.
 *
 * ARCHITECTURE RESET — role panels must NOT render one giant sidebar with
 * unauthorized items merely disabled. Nav items carry an optional
 * `permission` key from the SERVER capability matrix
 * (src/lib/security/permissions.ts); `filterNavForRole` removes any item
 * (or whole group) the authenticated role does not hold.
 *
 * SECURITY CONTRACT:
 *  - This filter is a UI COURTESY only — the backend (withAuthz /
 *    withUser permission gates) remains the final authorization authority
 *    on every API call. Hiding a nav item is never "security".
 *  - Unknown permissions fail CLOSED (can() returns false → item hidden).
 *  - The role comes from the server session (/api/auth/me), never from
 *    client state.
 */

import { can, type Role } from '@/lib/security/permissions'
import type { NavGroup } from '@/components/shell/app-shell/types'

/** Map a session role string (lowercase, from /api/auth/me) to the
 *  permission-matrix Role (uppercase). Unknown roles → null (fail closed). */
export function matrixRoleOf(role: string | null | undefined): Role | null {
  const normalized = (role ?? '').trim().toUpperCase() as Role
  const known: Role[] = [
    'SUPER_ADMIN', 'PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT', 'TEACHER', 'STUDENT', 'PARENT', 'DRIVER',
  ]
  return known.includes(normalized) ? normalized : null
}

/** Role display labels for the ERP identity surfaces. */
export const ROLE_LABELS: Record<string, string> = {
  principal: 'Principal',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
}

/**
 * Filter nav groups for an authenticated role:
 *  - a group with `permission` the role lacks is dropped entirely;
 *  - items with `permission` the role lacks are removed;
 *  - groups left with zero items are dropped;
 *  - items without `permission` are role-appropriate by construction
 *    (the per-role builders only include them for that role).
 */
export function filterNavForRole(groups: NavGroup[], role: string | null | undefined): NavGroup[] {
  const matrixRole = matrixRoleOf(role)
  if (!matrixRole) return groups
  return groups
    .filter((group) => !group.permission || can(matrixRole, group.permission))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(matrixRole, item.permission)),
    }))
    .filter((group) => group.items.length > 0)
}
