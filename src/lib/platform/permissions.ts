/**
 * Platform permission model — PHASE 6.
 *
 * The PLATFORM capability space is disjoint from the school permission
 * matrix (src/lib/security/permissions.ts). School roles can NEVER hold
 * platform capabilities; the school authorization pipeline has no code
 * path that consults this table.
 *
 * Resolution:
 *   · Root admins (PlatformAdmin.isRoot) implicitly hold EVERY capability.
 *   · Everyone else: explicit PlatformPermission rows (granted=true).
 *     Unknown keys fail CLOSED — a typo must never open a door.
 */

import { db } from '@/lib/db'

/** The canonical platform capability keys. */
export const PLATFORM_PERMISSION_KEYS = [
  'schools.read', // list schools, view school detail
  'schools.manage', // metadata, feature flags, activate/suspend/reactivate/delete
  'schools.provision', // create new schools
  'billing.manage', // plan/subscription configuration
  'announcements.manage', // platform announcements
  'settings.manage', // platform settings + module master switches
  'audit.read', // platform audit trail
  'support.access', // support sessions + school-session tools
  'admins.manage', // platform admin accounts + permission grants
] as const

export type PlatformPermissionKey = (typeof PLATFORM_PERMISSION_KEYS)[number]

/** Permissions granted to the seeded non-root ops admin. */
export const OPS_DEFAULT_PERMISSIONS: PlatformPermissionKey[] = [
  'schools.read',
  'schools.manage',
  'announcements.manage',
  'audit.read',
  'support.access',
]

/** Destructive actions that REQUIRE step-up authentication. */
export const STEP_UP_REQUIRED_HINT =
  'This action requires recent multi-factor verification. Re-enter your authenticator code and try again.'

/**
 * Resolve the effective permission set for an admin. Root → all keys.
 * Non-root → granted rows (invalid keys in the DB are ignored).
 */
export function effectivePermissions(
  admin: { isRoot: boolean },
  grants: { key: string; granted: boolean }[],
): Set<string> {
  if (admin.isRoot) return new Set<string>(PLATFORM_PERMISSION_KEYS)
  const set = new Set<string>()
  for (const g of grants) {
    if (g.granted && (PLATFORM_PERMISSION_KEYS as readonly string[]).includes(g.key)) {
      set.add(g.key)
    }
  }
  return set
}

/** DB-backed resolution (for route handlers). */
export async function loadEffectivePermissions(adminId: string, isRoot: boolean): Promise<Set<string>> {
  if (isRoot) return new Set<string>(PLATFORM_PERMISSION_KEYS)
  const rows = await db.platformPermission.findMany({ where: { adminId } })
  return effectivePermissions({ isRoot }, rows)
}

/**
 * Destructive-action policy table — the single source routes consult.
 * (Also mirrored in docs/PLATFORM_SECURITY_MODEL.md.)
 */
export const DESTRUCTIVE_ACTIONS = {
  suspendSchool: 'platform.school.suspend',
  deleteSchool: 'platform.school.delete',
  changePlan: 'platform.school.plan',
  modifyPermissions: 'platform.admin.permissions',
  createAdmin: 'platform.admin.create',
  suspendAdmin: 'platform.admin.suspend',
  accessSchoolData: 'platform.support.create',
} as const
