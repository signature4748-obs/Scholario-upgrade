/**
 * permissions — effective permission resolution (SaaS-STAGE-2A).
 *
 * The school UI must NEVER hard-code "who may edit/publish" — it consumes
 * the EFFECTIVE permissions derived from the ACTIVE school's (tenant's)
 * configuration:
 *
 *   Super Admin (platform)
 *     → school capability (tenant config, per school — see lib/tenant)
 *       → getEffectivePermissions(role, tenantConfig)
 *         → UI gates + STORE-ACTION guards (fee-store enforces these too)
 *
 * Keys follow the agreed capability vocabulary:
 *   fee_structure_edit / fee_structure_publish / fee_structure_archive /
 *   fee_structure_delete / fee_catalogue_manage / fee_entry_policy_manage
 *
 * PLATFORM-RESERVED CAPABILITY: fee_structure_delete is ALWAYS false for
 * school roles. Principals archive structures; permanent deletion belongs
 * to the platform (retention expiry or Super Admin tooling). No school-side
 * configuration can enable it — the guard here AND in the tenant store AND
 * in the fee-store actions.
 *
 * When edit is disabled for the viewer: the structure is READ-ONLY (edit
 * controls disabled AND store actions reject). When publish is disabled:
 * drafts can still be EDITED and SAVED (if edit is on), but the publish
 * action is unavailable, and historical versions remain read-only.
 */

import type { CapabilityKey } from './tenant/types'
export type { CapabilityKey }
/** Effective permission record — one boolean per CapabilityKey. */
export type EffectivePermissions = Record<CapabilityKey, boolean>

export type PrincipalRole = 'principal' | 'teacher' | 'student'

/** Per-school capability configuration — fed from the ACTIVE tenant. */
export interface SchoolPermissionConfig {
  capabilities?: Partial<Record<CapabilityKey, boolean>>
}

const ALL_CAPABILITY_KEYS: CapabilityKey[] = [
  'fee_structure_edit',
  'fee_structure_publish',
  'fee_structure_archive',
  'fee_structure_delete',
  'fee_catalogue_manage',
  'fee_entry_policy_manage',
]

/**
 * Role baselines. The school capability layer can only REMOVE capabilities
 * from the principal baseline (explicit false wins) — it can never grant a
 * capability the role does not hold, and it can never re-enable the
 * platform-reserved permanent delete.
 */
const ROLE_BASE: Record<PrincipalRole, EffectivePermissions> = {
  principal: {
    fee_structure_edit: true,
    fee_structure_publish: true,
    fee_structure_archive: true,
    fee_structure_delete: false, // platform-reserved
    fee_catalogue_manage: true,
    fee_entry_policy_manage: true,
  },
  teacher: {
    fee_structure_edit: false,
    fee_structure_publish: false,
    fee_structure_archive: false,
    fee_structure_delete: false,
    fee_catalogue_manage: false,
    fee_entry_policy_manage: false,
  },
  student: {
    fee_structure_edit: false,
    fee_structure_publish: false,
    fee_structure_archive: false,
    fee_structure_delete: false,
    fee_catalogue_manage: false,
    fee_entry_policy_manage: false,
  },
}

/**
 * Resolve the effective permission set for a role under a school's
 * (tenant's) configuration. School-level overrides WIN over the role
 * baseline for school-grantable capabilities (explicit false keeps a
 * capability off even for principals — that is what makes "read-only fee
 * structures" possible).
 */
export function getEffectivePermissions(
  role: PrincipalRole,
  config: SchoolPermissionConfig = {},
): EffectivePermissions {
  const base = ROLE_BASE[role] ?? ROLE_BASE.student
  const caps = config.capabilities ?? {}
  const out = {} as EffectivePermissions
  for (const key of ALL_CAPABILITY_KEYS) {
    if (key === 'fee_structure_delete') {
      // Platform-reserved: false for every school role regardless of config.
      out[key] = base[key] === true
      continue
    }
    out[key] = base[key] === true && caps[key] !== false
  }
  return out
}

/** Back-compat default (single-school baseline) — prefer the tenant hook. */
export const DEFAULT_SCHOOL_PERMISSIONS: SchoolPermissionConfig = {}
