/**
 * Tenant-scoped persistence (SaaS-STAGE-2A).
 *
 * THE DATA-ISOLATION MECHANIC. Zustand `persist` stores that opt in get a
 * storage adapter whose real localStorage key is:
 *
 *     `${baseName}::t:${activeTenantId}`
 *
 * so every tenant has its OWN persisted namespace:
 *
 *   feeStore(tenantId) semantics — without cloning a single store.
 *
 *   School A → scholario-fee-store-v1::t:t-dsg-gur-01
 *   another school → scholario-fee-store-v1::t:<its-tenant-id>
 *
 * Tenant switching ALWAYS reloads the app (switchTenant in tenant/store.ts),
 * so every store re-hydrates from its new namespace with seed state as the
 * fallback. That guarantees School A's data can never leak into School B's
 * namespace: a fresh boot starts from the seed factory, then hydrates the
 * target tenant's saved slice — nothing else.
 *
 * LEGACY MIGRATION: data persisted before this stage lives under the
 * un-scoped key. On first boot we copy it into the DEFAULT tenant's
 * namespace (the default school) once, then remove the legacy key — the user's
 * existing demo data survives the upgrade, and the copy is idempotent.
 */

import { createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import { getActiveTenantIdSync } from './active-tenant'

/** Base keys of every store that is tenant-scoped in this stage. */
export const TENANT_SCOPED_BASES = {
  fee: 'scholario-fee-store-v1',
  schoolSettings: 'scholario_school_settings_v1',
  salary: 'scholario-salary-v4',
  teachers: 'gws-teachers-lifecycle-store',
  admission: 'scholario_admission_store',
  applications: 'scholario-applications-v1',
} as const

export function tenantScopedKey(baseName: string, tenantId?: string): string {
  return `${baseName}::t:${tenantId ?? getActiveTenantIdSync()}`
}

/**
 * One-time legacy copy: un-scoped `${base}` → `${base}::t:${defaultTenant}`.
 * Runs synchronously at module load of the scoped store (before hydration).
 */
export function migrateLegacyScopedStore(baseName: string, defaultTenantId: string): void {
  if (typeof window === 'undefined') return
  try {
    const legacy = window.localStorage.getItem(baseName)
    if (!legacy) return
    const scopedKey = tenantScopedKey(baseName, defaultTenantId)
    if (!window.localStorage.getItem(scopedKey)) {
      window.localStorage.setItem(scopedKey, legacy)
    }
    window.localStorage.removeItem(baseName)
  } catch {
    // Non-fatal: worst case the school starts from fresh seed data.
  }
}

/**
 * Build a tenant-scoped JSON storage for a zustand persist store.
 * Pass `baseName` and call `migrateLegacyScopedStore(baseName, DEFAULT_TENANT_ID)`
 * right before store creation.
 *
 * The generic types WHAT the caller expects the stored JSON to deserialize
 * into (the store's PersistedState). At runtime this is plain JSON.parse
 * output — callers that need shape guarantees provide a `migrate` fn.
 */
export function createTenantScopedStorage<T = unknown>(baseName: string) {
  return createJSONStorage((): StateStorage => ({
    getItem: (_name: string) => {
      if (typeof window === 'undefined') return null
      try {
        return window.localStorage.getItem(tenantScopedKey(baseName))
      } catch {
        return null
      }
    },
    setItem: (name: string, value: string) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(tenantScopedKey(baseName), value)
      } catch {
        // Storage full / private mode — persist is best-effort in mock dev.
      }
    },
    removeItem: (_name: string) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.removeItem(tenantScopedKey(baseName))
      } catch {
        // Ignore.
      }
    },
  })) as ReturnType<typeof createJSONStorage<T>>
}
