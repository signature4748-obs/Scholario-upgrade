// ============================================================
// STUDENT POSITIONS — Class Captain / Monitor responsibility model
// ------------------------------------------------------------
// Spec §21–§25 (student-role brief): a Class Captain/Monitor is NOT a
// separate student role. They remain a normal Student with an additional
// SCOPED position. This module is the single source of truth for the
// position vocabulary, the capability allowlist each position grants, and
// the resolvers used by both the UI and the authorization-checked store
// actions (class-responsibility-store). The persisted assignment lives in
// the students-store (`studentPositions`) — the UI NEVER hardcodes
// `if student === 'Aarav'` style conditions.
//
// CONSTITUTION (RB-1): a position is SESSION-SCOPED — it belongs to the
// academic session it was awarded in (StudentPosition.sessionId, the
// '2026-2027' hyphen id convention shared with the fee engine /
// academic-session module). `filterActivePositions` below is the ONLY
// activity resolver in the codebase: NEVER check `p.active` directly and
// never hand-roll `active && studentId === …` filters. A position from a
// previous session is history, not authority.
// ============================================================

import type { StudentPosition } from '@/lib/store/students-store/types'

/** Scoped capabilities a position can grant. Deliberately narrow:
 *  NO grade editing, attendance editing, fee access, other-class access,
 *  private student records, disciplinary authority or unrestricted
 *  messaging (spec §22 hard exclusions). */
export type StudentCapability =
  | 'post-class-updates' // publish notices to the class board (teacher-reviewed)
  | 'report-issues' // report class issues to the class teacher / principal
  | 'view-class-tasks' // see + complete responsibility tasks assigned by staff
  | 'request-teacher' // request a meeting with the class/subject teacher
  | 'coordinate-activity' // coordinate teacher-approved class activities
  | 'class-noticeboard' // view the class notice board feed

export type StudentPositionKey =
  | 'class-captain'
  | 'class-vice-captain'
  | 'class-monitor'
  | 'sports-captain'
  | 'eco-monitor'
  | 'library-monitor'

export interface PositionDef {
  key: StudentPositionKey
  title: string
  short: string
  description: string
  capabilities: StudentCapability[]
}

/** The capability allowlist per position — the permission source of truth. */
export const POSITION_DEFS: Record<StudentPositionKey, PositionDef> = {
  'class-captain': {
    key: 'class-captain',
    title: 'Class Captain',
    short: 'Captain',
    description: 'Leads the class — publishes class updates, coordinates activities and reports class issues to the class teacher.',
    capabilities: [
      'post-class-updates',
      'report-issues',
      'view-class-tasks',
      'request-teacher',
      'coordinate-activity',
      'class-noticeboard',
    ],
  },
  'class-vice-captain': {
    key: 'class-vice-captain',
    title: 'Class Vice-Captain',
    short: 'Vice-Captain',
    description: 'Supports the captain — publishes class updates and reports class issues.',
    capabilities: ['post-class-updates', 'report-issues', 'view-class-tasks', 'request-teacher', 'class-noticeboard'],
  },
  'class-monitor': {
    key: 'class-monitor',
    title: 'Class Monitor',
    short: 'Monitor',
    description: 'Day-to-day monitor — reports class issues and liaises with the class teacher.',
    capabilities: ['report-issues', 'view-class-tasks', 'request-teacher'],
  },
  'sports-captain': {
    key: 'sports-captain',
    title: 'Sports Captain',
    short: 'Sports Capt.',
    description: 'Coordinates sports and physical-education class activities.',
    capabilities: ['post-class-updates', 'coordinate-activity', 'view-class-tasks'],
  },
  'eco-monitor': {
    key: 'eco-monitor',
    title: 'Eco Monitor',
    short: 'Eco',
    description: 'Looks after classroom sustainability and reports facility issues.',
    capabilities: ['report-issues', 'view-class-tasks', 'coordinate-activity'],
  },
  'library-monitor': {
    key: 'library-monitor',
    title: 'Library Monitor',
    short: 'Library',
    description: 'Helps the librarian with class library periods and book returns.',
    capabilities: ['view-class-tasks', 'report-issues'],
  },
}

export const POSITION_ORDER: StudentPositionKey[] = [
  'class-captain',
  'class-vice-captain',
  'class-monitor',
  'sports-captain',
  'eco-monitor',
  'library-monitor',
]

/** All capabilities granted by a single ACTIVE position record. */
export function capabilitiesOf(position: StudentPosition): StudentCapability[] {
  return POSITION_DEFS[position.key]?.capabilities ?? []
}

/**
 * THE canonical activity resolver (RB-1 constitution).
 *
 * Resolves the positions a student currently holds in a given academic
 * session: matching studentId AND sessionId AND still active. Every
 * consumer — nav derivation, the Class Captain workspace, dashboard
 * banner, profile chips, principal Leadership tab, and the store-side
 * authorization checks — MUST go through this function. Never read
 * `p.active` directly; a position from an earlier session is inactive by
 * definition even when its historical flag is still true.
 *
 * Pass the active session id from `useAcademicSession().id` (UI) or
 * `getActiveAcademicSessionId()` (stores) — both from
 * `@/lib/academic-session` ('2026-2027' hyphen convention). The id may be
 * NULL when no server/local source knows the school's year (PHASE 7.5-D:
 * never a hardcoded fallback) — a null session can never CONFIRM a
 * position is live, so the resolver honestly returns nothing rather than
 * guessing a year.
 */
export function filterActivePositions(
  positions: StudentPosition[],
  studentId: string,
  sessionId: string | null,
): StudentPosition[] {
  if (!sessionId) return []
  return positions.filter(
    (p) => p.active && p.studentId === studentId && p.sessionId === sessionId,
  )
}

/** Does the holder of these ACTIVE positions have the capability? */
export function hasCapability(positions: StudentPosition[], capability: StudentCapability): boolean {
  return positions.some((p) => capabilitiesOf(p).includes(capability))
}

/** Union of capabilities across all ACTIVE positions. */
export function allCapabilities(positions: StudentPosition[]): StudentCapability[] {
  const set = new Set<StudentCapability>()
  for (const p of positions) for (const c of capabilitiesOf(p)) set.add(c)
  return [...set]
}
