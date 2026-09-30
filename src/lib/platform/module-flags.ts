/**
 * Platform module switches — PHASE 6.
 *
 * Effective module availability for a school:
 *
 *     school.featureFlags[key]  ??  PlatformSetting.modules[key]  ??  true
 *
 *   · Per-school overrides (managed in the control plane) take priority.
 *   · The platform-wide master switch applies to schools without an
 *     explicit override.
 *   · Absent key = ENABLED (fail-open for existing tenants — these are
 *     product availability toggles, NOT security boundaries; tenant
 *     isolation is enforced by the Phase-2 authz pipeline, not here).
 *
 * School-facing module root routes call `assertModuleEnabled` so a
 * disabled module fails with FEATURE_DISABLED (a deliberate,
 * user-facing code) instead of silently behaving.
 */

import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'

/** Modules that honor the flag system (root school routes). */
export const FLAGGABLE_MODULES = ['exams', 'fees', 'homework', 'library', 'transport'] as const
export type FlaggableModule = (typeof FLAGGABLE_MODULES)[number]

/** Parse a flags JSON blob defensively (corrupt → {}). Shared shape. */
export function parseFlags(json: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>
    }
  } catch {
    // Corrupt JSON → treat as no overrides (fail-open).
  }
  return {}
}

/** Resolve the effective switch (school override → platform master → on). */
export async function isModuleEnabled(schoolId: string, module: FlaggableModule): Promise<boolean> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { featureFlags: true },
  })
  if (!school) return true
  const schoolFlags = parseFlags(school.featureFlags)
  if (typeof schoolFlags[module] === 'boolean') return schoolFlags[module]
  const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
  const master = parseFlags(setting?.modules ?? '{}')
  if (typeof master[module] === 'boolean') return master[module]
  return true
}

/**
 * PHASE 7.5 — every effective flag for a school in one read (the settings
 * Modules tab + client nav gating consume this; server vocabulary only).
 */
export async function effectiveModuleFlags(schoolId: string): Promise<Record<string, boolean>> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { featureFlags: true },
  })
  const schoolFlags = school ? parseFlags(school.featureFlags) : {}
  const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
  const master = parseFlags(setting?.modules ?? '{}')
  const out: Record<string, boolean> = {}
  for (const m of FLAGGABLE_MODULES) {
    const sf = schoolFlags[m]
    const mf = master[m]
    out[m] = typeof sf === 'boolean' ? sf : typeof mf === 'boolean' ? mf : true
  }
  return out
}

/** Guard for school module routes: throws FEATURE_DISABLED when off. */
export async function assertModuleEnabled(schoolId: string, module: FlaggableModule): Promise<void> {
  const enabled = await isModuleEnabled(schoolId, module)
  if (!enabled) {
    throw new AppError('FEATURE_DISABLED', {
      publicMessage: `The ${module} module is currently disabled for your school. Please contact your school administrator.`,
      internalDetail: `assertModuleEnabled: ${module} disabled for school ${schoolId.slice(0, 8)}…`,
    })
  }
}

/** Validate + normalize a feature-flags PATCH body. */
export function validateFlagPatch(
  body: Record<string, unknown>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const key of Object.keys(body)) {
    if (!(FLAGGABLE_MODULES as readonly string[]).includes(key)) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Unknown module flag: ${key}`,
      })
    }
    const value = body[key]
    if (typeof value !== 'boolean') {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Flag ${key} must be true or false`,
      })
    }
    out[key] = value
  }
  return out
}
