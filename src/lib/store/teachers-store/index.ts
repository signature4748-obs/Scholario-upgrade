export { useTeachersStore } from './store'
export { getTeacherActivePermissions } from './helpers'
export { DEFAULT_POSITIONS } from './constants'
export { createAppointmentLetterSnapshot, APPOINTMENT_DEFAULT_TERMS } from './letter-factory'
// PHASE 7 (Task 7-a) — canonical roster hydration from GET /api/teachers.
export {
  syncTeachersFromServer,
  resetTeachersSyncGuard,
  mapServerTeacher,
  type ServerTeacherDto,
} from './server-sync'
export type {
  Qualification,
  TeacherDocument,
  PositionAssignment,
  PositionDefinition,
  AppointmentLetterData,
  TeacherMediaRecord,
  AuditLogItem,
  TeacherRecord,
  TeachersStoreState,
  TeachersSyncStatus,
} from './types'
