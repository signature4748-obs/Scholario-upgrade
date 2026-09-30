'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TeachersStoreState } from './types'
import { DEFAULT_POSITIONS } from './constants'
import { createAuditSlice } from './slices/audit-slice'
import { createLifecycleSlice } from './slices/lifecycle-slice'
import { createPositionsSlice } from './slices/positions-slice'
import { createWorkloadSlice } from './slices/workload-slice'
import { createCredentialsSlice } from './slices/credentials-slice'
import { createPayrollSlice } from './slices/payroll-slice'
// SaaS-STAGE-2A — tenant-scoped persistence (per-school staff dataset).
import { migrateLegacyScopedStore, createTenantScopedStorage, TENANT_SCOPED_BASES } from '@/lib/tenant/tenant-storage'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/schools'
// W2.3B — real persisted-state migration chain + persistence shaping.
import {
  migrateTeachersStore,
  teachersStorePartialize,
  CURRENT_TEACHERS_STORE_VERSION,
  type TeachersPersistedState,
} from './migrate'

// PHASE 7 (Task 7-a) — the store starts EMPTY. The fabricated 20-member
// seed faculty (SEED_TEACHERS — retired, see ./seed-data.ts) is no longer
// imported at runtime: the canonical roster is hydrated from
// GET /api/teachers by src/lib/store/teachers-store/server-sync.ts on the
// principal panel mount. A failed sync keeps whatever real data the store
// already holds — seed rows are never re-injected.

migrateLegacyScopedStore(TENANT_SCOPED_BASES.teachers, DEFAULT_TENANT_ID)

export const useTeachersStore = create<TeachersStoreState>()(
  persist<TeachersStoreState, [], [], TeachersPersistedState>(
    (...a) => ({
      teachers: [],
      positionsList: DEFAULT_POSITIONS,
      syncStatus: 'idle',
      ...createAuditSlice(...a),
      ...createLifecycleSlice(...a),
      ...createPositionsSlice(...a),
      ...createWorkloadSlice(...a),
      ...createCredentialsSlice(...a),
      ...createPayrollSlice(...a),
    }),
    {
      name: TENANT_SCOPED_BASES.teachers,
      storage: createTenantScopedStorage<TeachersPersistedState>(TENANT_SCOPED_BASES.teachers),
      // Version history & the migration chain live in ./migrate.ts.
      //   v2 — faculty list derives the full 20-member canonical roster
      //        (was 2 detailed records; bump discarded the stale mock state
      //        once and re-seeded).
      //   v3 — pending Examination Incharge assignment re-dated to the
      //        2026–27 session (seed-data fix only).
      //   v4 — appointment letters drop the fake QR verification id and
      //        snapshot the teacher's address at issue time; photo/signature
      //        become stored media records (Wave 2.3).
      //   v5 — media records stop persisting the base64 dataUrl preview
      //        copy (server file is canonical); explicit partialize keeps
      //        only data slices (W2.3B).
      //   v6 — PHASE 7: the seeded faculty universe is RETIRED. The v6
      //        migration purges persisted seed teacher rows + their audit
      //        logs; the store hydrates from GET /api/teachers instead
      //        (server-sync.ts). Positions/letters/media recorded against
      //        ids that still exist on the server survive.
      version: CURRENT_TEACHERS_STORE_VERSION,
      migrate: migrateTeachersStore,
      partialize: teachersStorePartialize,
    }
  )
)
