// Barrel module for the students store.
//
// Re-exports the zustand `useStudentsStore` and every entity type so
// that `@/lib/store/students-store` continues to resolve to the same
// public surface as the original monolithic file. (The deterministic
// `getVirtualOccupied` display-only seat-occupancy helper was removed —
// every student/class count is now derived from the real roster.)

export { useStudentsStore, ensureStudentsDemoSeed } from './store'
export {
  syncStudentsFromServer,
  resetRosterSyncGuard,
  purgeSeedRosterForRealTenant,
  resolveMyStudentRecord,
  useMyStudentRecord,
} from './server-sync'
export type {
  StudentStatus,
  FeeStatus,
  Gender,
  TimelineEvent,
  StudentRecord,
  SectionRecord,
  ClassRecord,
  ArchivedSubject,
  House,
  PromotionRecord,
  TransferRecord,
  StudentPosition,
  StudentPositionKey,
  StudentsState,
} from './types'
