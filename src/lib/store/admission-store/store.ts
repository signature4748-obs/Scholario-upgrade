import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AdmissionStoreState } from './types'
import { createSelectionSlice } from './slices/selection-slice'
import { createDraftSlice } from './slices/draft-slice'
import { createReviewSlice } from './slices/review-slice'
import { createDecisionSlice } from './slices/decision-slice'
import { createCompletionSlice } from './slices/completion-slice'
import { createServerLinkSlice } from './slices/server-link-slice'
// SaaS-STAGE-2A — tenant-scoped persistence (per-school admissions data).
import { migrateLegacyScopedStore, createTenantScopedStorage, TENANT_SCOPED_BASES } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'

migrateLegacyScopedStore(TENANT_SCOPED_BASES.admission, DEFAULT_TENANT_ID)

export const useAdmissionStore = create<AdmissionStoreState>()(
  persist(
    (...a) => ({
      // PHASE 7 — honest-empty contract: applications start EMPTY (the
      // fabricated seed applicants are retired; the workspace data is
      // in-session — see docs/DATA_SOURCE_MAP.md).
      applications: [],
      ...createSelectionSlice(...a),
      ...createDraftSlice(...a),
      ...createReviewSlice(...a),
      ...createDecisionSlice(...a),
      ...createCompletionSlice(...a),
      ...createServerLinkSlice(...a),
    }),
    {
      name: TENANT_SCOPED_BASES.admission,
      storage: createTenantScopedStorage(TENANT_SCOPED_BASES.admission),
      // v2 (PHASE 7) — purge the retired fabricated seed applicants from
      // persisted browsers: the workspace starts honest-empty.
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          const state = persisted as { applications?: unknown[] } | undefined
          return { ...state, applications: [] }
        }
        return persisted
      },
    }
  )
)
