/**
 * Teachers store — persisted-state migration & persistence shaping
 * (Wave 2.3B §10–§12, extended by Phase 7 Task 7-a).
 *
 * WHY THIS EXISTS
 * ───────────────
 * Zustand's persist middleware, on a version mismatch with NO migrate
 * function, logs
 *   "State loaded from storage couldn't be migrated since no migrate
 *    function was provided"
 * and silently DISCARDS the persisted state. This module is the real,
 * shape-transforming migration chain that prevents that.
 *
 * VERSION HISTORY
 * ───────────────
 *  v0/v1 — legacy 2-record mock dataset (pre-canonical roster).
 *  v2    — canonical 20-member roster persisted shape.
 *  v3    — same shape as v2 (seed-data date fix only).
 *  v4    — appointment letters dropped the fake `qrVerificationId` and
 *          snapshot `teacherAddress` at issue time; photo/signature become
 *          stored media records (Wave 2.3).
 *  v5    — media records no longer persist their base64 `dataUrl` copy:
 *          the server file (db/uploads/teachers/<fileId>) is canonical.
 *  v6    — PHASE 7 (Task 7-a): the fabricated seed faculty is RETIRED.
 *          The migration clears persisted seeded teacher rows and their
 *          audit logs from every browser; the roster now hydrates from
 *          GET /api/teachers (server-sync.ts). Seed data is NEVER
 *          re-injected by any migration path — an uninterpretable or
 *          pre-v6 state simply starts EMPTY and waits for the sync.
 *
 * GUARANTEES
 * ──────────
 *  · Valid teacher data from v6+ states SURVIVES migrations (records are
 *    transformed, not re-seeded).
 *  · No fake teacher records, names, letters or media are ever created.
 *  · Malformed per-teacher entries are dropped individually with a dev
 *    diagnostic; the rest of the roster is kept.
 *  · A state that is impossible to interpret (not an object, teachers not
 *    an array) is discarded as a whole — ONLY this store's persisted slice
 *    resets to the (empty) initial data; unrelated stores are untouched.
 *  · Development diagnostics use console.warn (visible, greppable);
 *    production stays quiet and simply recovers.
 */

import type {
  AppointmentLetterData,
  AuditLogItem,
  PositionAssignment,
  PositionDefinition,
  TeacherMediaRecord,
  TeacherRecord,
  TeachersStoreState,
} from './types'
import { DEFAULT_POSITIONS } from './constants'

/** Only data slices are persisted — actions live on the store instance.
 *  `syncStatus` is per-session lineage and is never persisted. */
export type TeachersPersistedState = Pick<
  TeachersStoreState,
  'teachers' | 'positionsList' | 'auditLogs'
>

export const CURRENT_TEACHERS_STORE_VERSION = 6

const devWarn = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[teachers-store migrate]', ...args)
  }
}

/* ------------------------------------------------------------------ */
/*  Small validation helpers                                           */
/* ------------------------------------------------------------------ */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback

/* ------------------------------------------------------------------ */
/*  Field-level normalizers                                            */
/* ------------------------------------------------------------------ */

/**
 * Media record → v5 persisted shape. The base64 `dataUrl` (a transient
 * in-session preview copy) is NEVER persisted — the server file that
 * `fileId` points to is canonical. A media entry without a usable fileId
 * cannot be resolved to any real file and is dropped (record = absent).
 */
function normalizeMedia(v: unknown): TeacherMediaRecord | undefined {
  if (!isPlainObject(v)) return undefined
  const fileId = asString(v.fileId).trim()
  if (!fileId) return undefined
  return {
    fileId,
    fileName: asString(v.fileName, fileId),
    uploadedAt: asString(v.uploadedAt),
  }
}

/** Teacher for partialize() — strips the transient dataUrl copy on write. */
export function stripTeacherMediaForPersist(teacher: TeacherRecord): TeacherRecord {
  if (!teacher.photo?.dataUrl && !teacher.signature?.dataUrl) return teacher
  return {
    ...teacher,
    photo: teacher.photo ? { fileId: teacher.photo.fileId, fileName: teacher.photo.fileName, uploadedAt: teacher.photo.uploadedAt } : undefined,
    signature: teacher.signature ? { fileId: teacher.signature.fileId, fileName: teacher.signature.fileName, uploadedAt: teacher.signature.uploadedAt } : undefined,
  }
}

/**
 * Appointment letter → current shape. Pre-v4 letters carry the fake
 * `qrVerificationId` (removed) and lack `teacherAddress`; the honest
 * migration sets an empty address (the renderer hides an empty address
 * block — no fabricated value) and archives nothing implicitly.
 */
function normalizeLetter(v: unknown): AppointmentLetterData | null {
  if (!isPlainObject(v)) return null
  return {
    id: asString(v.id),
    officialLetterNo: asString(v.officialLetterNo),
    generatedDate: asString(v.generatedDate),
    teacherName: asString(v.teacherName),
    employeeId: asString(v.employeeId),
    designation: asString(v.designation),
    department: asString(v.department),
    joiningDate: asString(v.joiningDate),
    monthlySalary: typeof v.monthlySalary === 'number' ? v.monthlySalary : 0,
    annualSalary: typeof v.annualSalary === 'number' ? v.annualSalary : 0,
    workingHours: asString(v.workingHours),
    probationMonths: typeof v.probationMonths === 'number' ? v.probationMonths : 0,
    noticePeriodDays: typeof v.noticePeriodDays === 'number' ? v.noticePeriodDays : 0,
    termsAndConditions: asArray(v.termsAndConditions).filter(
      (t): t is string => typeof t === 'string'
    ),
    principalName: asString(v.principalName),
    schoolSealAttached: v.schoolSealAttached === true,
    reportingAuthority: asString(v.reportingAuthority),
    teacherAddress: asString(v.teacherAddress), // '' for pre-v4 letters — honest, hidden when empty
    // NOTE: qrVerificationId (v3 fake-verification field) is intentionally
    // not carried over.
  }
}

function normalizePosition(v: unknown): PositionAssignment | null {
  if (!isPlainObject(v)) return null
  return {
    id: asString(v.id),
    positionId: asString(v.positionId),
    positionTitle: asString(v.positionTitle),
    classAssigned: typeof v.classAssigned === 'string' ? v.classAssigned : undefined,
    assignedDate: asString(v.assignedDate),
    assignedBy: asString(v.assignedBy),
    status: (['Active', 'Pending Acceptance', 'Rejected', 'Pending Removal'] as const).includes(
      v.status as PositionAssignment['status']
    )
      ? (v.status as PositionAssignment['status'])
      : 'Pending Acceptance',
    rejectionReason: typeof v.rejectionReason === 'string' ? v.rejectionReason : undefined,
    clarificationRequest:
      typeof v.clarificationRequest === 'string' ? v.clarificationRequest : undefined,
    effectiveDate: asString(v.effectiveDate),
    isEmergencyOverride: v.isEmergencyOverride === true || undefined,
    overrideReason: typeof v.overrideReason === 'string' ? v.overrideReason : undefined,
  }
}

/**
 * Teacher record → current schema. Keeps every valid persisted value;
 * defaults only fields that are structurally required for the UI to render
 * without crashing (empty strings / empty arrays / zero numbers — never
 * fabricated names, media, or documents). Returns null for entries that
 * are not identifiable teacher records.
 */
function normalizeTeacher(v: unknown): TeacherRecord | null {
  if (!isPlainObject(v)) return null
  const id = asString(v.id).trim()
  const name = asString(v.name).trim()
  const employeeId = asString(v.employeeId).trim()
  // Identity is non-negotiable — an entry without id/name/employeeId is
  // not a teacher record we can meaningfully keep.
  if (!id || !name || !employeeId) return null

  const letter = normalizeLetter(v.appointmentLetter)
  const archive = asArray(v.letterArchive)
    .map(normalizeLetter)
    .filter((l): l is AppointmentLetterData => l !== null)

  return {
    ...(v as Record<string, unknown>),
    id,
    name,
    employeeId,
    subjects: asArray(v.subjects).filter((s): s is string => typeof s === 'string'),
    classes: asArray(v.classes).filter((s): s is string => typeof s === 'string'),
    examResponsibilities: asArray(v.examResponsibilities).filter(
      (s): s is string => typeof s === 'string'
    ),
    positions: asArray(v.positions)
      .map(normalizePosition)
      .filter((p): p is PositionAssignment => p !== null),
    photo: normalizeMedia(v.photo),
    signature: normalizeMedia(v.signature),
    appointmentLetter: letter ?? undefined,
    letterArchive: archive,
    // Structural safety for hand-tampered states — empty defaults, no fakes.
    emergencyContact: isPlainObject(v.emergencyContact)
      ? {
          name: asString(v.emergencyContact.name),
          relation: asString(v.emergencyContact.relation),
          phone: asString(v.emergencyContact.phone),
        }
      : { name: '', relation: '', phone: '' },
    loginCredentials: isPlainObject(v.loginCredentials)
      ? {
          username: asString(v.loginCredentials.username),
          tempPassword: asString(v.loginCredentials.tempPassword),
          passwordResetRequired: v.loginCredentials.passwordResetRequired === true,
          createdDate: asString(v.loginCredentials.createdDate),
          lastLogin:
            typeof v.loginCredentials.lastLogin === 'string'
              ? v.loginCredentials.lastLogin
              : undefined,
        }
      : {
          username: '',
          tempPassword: '',
          passwordResetRequired: true,
          createdDate: '',
        },
  } as TeacherRecord
}

function normalizePositionDefinition(v: unknown): PositionDefinition | null {
  if (!isPlainObject(v)) return null
  const id = asString(v.id).trim()
  const title = asString(v.title).trim()
  if (!id || !title) return null
  return {
    id,
    title,
    category: (['Academic', 'Administrative', 'Co-Curricular', 'Management', 'Custom'] as const).includes(
      v.category as PositionDefinition['category']
    )
      ? (v.category as PositionDefinition['category'])
      : 'Custom',
    description: asString(v.description),
    isCustom: v.isCustom === true || undefined,
    permissions: asArray(v.permissions).filter(
      (p): p is string => typeof p === 'string'
    ),
  }
}

function normalizeAuditLog(v: unknown): AuditLogItem | null {
  if (!isPlainObject(v)) return null
  const id = asString(v.id).trim()
  if (!id) return null
  return {
    id,
    timestamp: asString(v.timestamp),
    category: (v.category ?? 'Position Action') as AuditLogItem['category'],
    actorName: asString(v.actorName),
    actorRole: asString(v.actorRole),
    targetTeacherId: asString(v.targetTeacherId),
    targetTeacherName: asString(v.targetTeacherName),
    details: asString(v.details),
    isEmergencyOverride: v.isEmergencyOverride === true || undefined,
  }
}

/* ------------------------------------------------------------------ */
/*  The migrate function (zustand contract)                            */
/* ------------------------------------------------------------------ */

/**
 * Transform a persisted teachers-store state of ANY known version into the
 * current persisted shape.
 *
 * PHASE 7 (v6): every discard path — the legacy pre-v6 seed era and any
 * malformed state — resolves to an EMPTY roster (never a re-seed). The
 * canonical faculty list arrives from GET /api/teachers via
 * server-sync.ts. Only THIS store's persisted slice is affected.
 */
export function migrateTeachersStore(
  persisted: unknown,
  version: number
): TeachersPersistedState {
  // ── v0–v5: the fabricated seed faculty era. Purge the seeded rows (and
  // their fabricated audit trail) once — the store starts empty and the
  // principal-session server sync hydrates the real roster.
  if (version < 6) {
    devWarn(
      `persisted version ${version} predates the server-hydrated faculty roster — ` +
        'clearing seeded rows (Phase 7; the roster syncs from /api/teachers)'
    )
    return emptySnapshot()
  }

  if (!isPlainObject(persisted)) {
    devWarn('persisted state is not an object — discarding (empty until server sync)')
    return emptySnapshot()
  }

  const rawTeachers = persisted.teachers
  if (!Array.isArray(rawTeachers)) {
    devWarn('persisted state has no valid teachers array — discarding (empty until server sync)')
    return emptySnapshot()
  }

  // ── Per-record normalization: keep every valid teacher, drop only the
  // malformed ones (with a diagnostic — never a wholesale wipe).
  const teachers: TeacherRecord[] = []
  let dropped = 0
  for (const entry of rawTeachers) {
    const normalized = normalizeTeacher(entry)
    if (normalized) teachers.push(normalized)
    else dropped++
  }
  if (dropped > 0) {
    devWarn(`${dropped} malformed teacher record(s) could not be interpreted and were skipped`)
  }
  if (teachers.length === 0) {
    devWarn('no interpretable teacher records survived — starting empty (server sync will hydrate)')
    return emptySnapshot()
  }

  const result: TeachersPersistedState = {
    teachers,
    // A missing/invalid persisted slice falls back to the exact values the
    // store's initial state would have provided (merge-equivalent).
    positionsList: DEFAULT_POSITIONS,
    auditLogs: [],
  }

  const rawPositions = persisted.positionsList
  if (Array.isArray(rawPositions)) {
    const positionsList = rawPositions
      .map(normalizePositionDefinition)
      .filter((p): p is PositionDefinition => p !== null)
    if (positionsList.length > 0) result.positionsList = positionsList
    else devWarn('persisted positionsList was empty/invalid — keeping the default position catalogue')
  }

  const rawLogs = persisted.auditLogs
  if (Array.isArray(rawLogs)) {
    const auditLogs = rawLogs
      .map(normalizeAuditLog)
      .filter((l): l is AuditLogItem => l !== null)
    if (auditLogs.length > 0) result.auditLogs = auditLogs
  }

  return result
}

/** Empty snapshot — the store's initial (un-hydrated) data slices. The
 *  roster arrives from the server; NOTHING is seeded here (Phase 7). */
function emptySnapshot(): TeachersPersistedState {
  return {
    teachers: [],
    positionsList: DEFAULT_POSITIONS,
    auditLogs: [],
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence shaping (partialize)                                   */
/* ------------------------------------------------------------------ */

/** Persist data slices only; strip transient media previews on every write. */
export function teachersStorePartialize(state: TeachersStoreState): TeachersPersistedState {
  return {
    teachers: state.teachers.map(stripTeacherMediaForPersist),
    positionsList: state.positionsList,
    auditLogs: state.auditLogs,
  }
}
