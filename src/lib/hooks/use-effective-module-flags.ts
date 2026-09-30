'use client'

/**
 * use-effective-module-flags — the SERVER module vocabulary on the client
 * (PHASE 7.5-D module-flag wiring).
 *
 * GET /api/school-settings returns `moduleFlags` — the platform's
 * EFFECTIVE module availability in the SERVER vocabulary
 * (exams / fees / homework / library / transport). The client tenant
 * registry's 17-key `features` map (lib/tenant/registry.ts) is decorative
 * post-Phase-7.5 (all-on seeds, zero writers since Phase 6) — this hook
 * is the honest gate for every flaggable module. (The server `homework`
 * flag maps to no client module yet — homework is Wave-1-deferred.)
 *
 * Contract:
 *   · `effectiveFlags` — the server flags verbatim (null until the first
 *     successful school-settings sync);
 *   · `loaded` — true once the sync delivered a non-empty flag set;
 *   · `isServerModuleEnabled(key)` — the gate: while flags are NOT loaded
 *     the answer is FAIL-OPEN (items stay visible), matching the
 *     server-side design; once loaded, a module is hidden only when its
 *     server flag is explicitly false.
 *
 * The hook triggers `syncSchoolSettingsFromServer()` itself — the sync is
 * once-per-session (module-level promise guard), so this is free when the
 * panel mount (page.tsx) already fired it.
 */

import { useEffect } from 'react'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { syncSchoolSettingsFromServer } from '@/lib/store/school-settings-store/server-sync'
import type { ModuleKey } from '@/lib/tenant/types'

/**
 * Client module key (registry vocabulary) → server moduleFlags key.
 * EXPLICIT mapping — the two vocabularies differ ('examinations' client
 * vs 'exams' server); nothing is guessed. Modules without an entry have
 * no server flag and are never gated by this hook. (The server also flags
 * `homework` — the client has no homework module yet (Wave 1 deferral),
 * so it has no mapping until one exists.)
 */
export const SERVER_FLAG_BY_MODULE: Partial<Record<ModuleKey, string>> = {
  examinations: 'exams',
  fees: 'fees',
  library: 'library',
  transport: 'transport',
}

export interface EffectiveModuleFlags {
  /** Server moduleFlags (server vocabulary) — null until the first sync. */
  effectiveFlags: Record<string, boolean> | null
  /** False while unsynced — callers fail open (server design). */
  loaded: boolean
  /** Gate: server flag when loaded (fail-open otherwise / for unflaggable modules). */
  isServerModuleEnabled: (key: ModuleKey) => boolean
}

export function useEffectiveModuleFlags(): EffectiveModuleFlags {
  const syncStatus = useSchoolSettingsStore((s) => s.server.syncStatus)
  const moduleFlags = useSchoolSettingsStore((s) => s.server.moduleFlags)

  // Self-sufficient hydration — idempotent thanks to the sync's promise guard.
  useEffect(() => {
    void syncSchoolSettingsFromServer()
  }, [])

  const loaded =
    syncStatus === 'synced' && !!moduleFlags && Object.keys(moduleFlags).length > 0
  const effectiveFlags = loaded ? moduleFlags : null

  const isServerModuleEnabled = (key: ModuleKey): boolean => {
    const flagKey = SERVER_FLAG_BY_MODULE[key]
    if (!flagKey) return true // module has no server flag — never gated here
    if (!effectiveFlags) return true // flags not loaded — fail open
    return effectiveFlags[flagKey] !== false // hidden only when explicitly disabled
  }

  return { effectiveFlags, loaded, isServerModuleEnabled }
}
