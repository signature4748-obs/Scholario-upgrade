'use client'

/**
 * use-effective-role-features — PHASE 3 Role-wise Feature Control on the
 * client (nav/UI courtesy ONLY — the server gates remain the authority).
 *
 * GET /api/school-settings returns `roleFeatures` — the CALLER's own
 * role's effective feature map (static RBAC baseline ∧ the school's
 * explicit role-feature denials), keyed by ROLE_FEATURE_CATALOG keys.
 *
 * Contract (mirrors use-effective-module-flags):
 *   · `features` — the server map verbatim (null until the first
 *     successful school-settings sync);
 *   · `loaded` — true once the sync delivered the config;
 *   · `isFeatureEnabled(key)` — while NOT loaded the answer is FAIL-OPEN
 *     (items stay visible, matching the module-flag client design); once
 *     loaded, a feature is hidden only when its key is explicitly false.
 *     Keys absent from the map are never gated (fail open) — the server
 *     only sends keys the role's baseline grants.
 *
 * The hook triggers `syncSchoolSettingsFromServer()` itself — the sync is
 * once-per-session (module-level promise guard), so this is free when the
 * panel mount (page.tsx) already fired it.
 */

import { useEffect } from 'react'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { syncSchoolSettingsFromServer } from '@/lib/store/school-settings-store/server-sync'

export interface EffectiveRoleFeatures {
  /** The caller's role's effective feature map — null until first sync. */
  features: Record<string, boolean> | null
  /** False while unsynced — callers fail open (server design). */
  loaded: boolean
  /** Gate: server map when loaded (fail-open otherwise / for unmapped keys). */
  isFeatureEnabled: (key: string) => boolean
}

export function useRoleFeatures(): EffectiveRoleFeatures {
  const syncStatus = useSchoolSettingsStore((s) => s.server.syncStatus)
  const roleFeatures = useSchoolSettingsStore((s) => s.server.roleFeatures)

  // Self-sufficient hydration — idempotent thanks to the sync's promise guard.
  useEffect(() => {
    void syncSchoolSettingsFromServer()
  }, [])

  const loaded = syncStatus === 'synced' && !!roleFeatures
  const features = loaded ? roleFeatures : null

  const isFeatureEnabled = (key: string): boolean => {
    if (!features) return true // not loaded — fail open
    if (!(key in features)) return true // unmapped key — never gated here
    return features[key] !== false // hidden only when explicitly disabled
  }

  return { features, loaded, isFeatureEnabled }
}
