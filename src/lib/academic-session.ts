'use client'

/**
 * academic-session — THE single resolution point for the school's active
 * academic session (SaaS-STAGE-1 rule; PHASE 7.5-D server-first).
 *
 * Resolution order (server truth wins — NO hardcoded fallback):
 *   1. school-settings `server` slice — GET /api/school-settings
 *      `identity.academicYear` (the canonical School row);
 *   2. the authenticated session — /api/auth/me `me.school.academicYear`
 *      (available for every school role through the current-user store);
 *   3. the local school-settings store's `academics.currentSession`
 *      (persisted client config, realigned by the server sync);
 *   4. null — the session is UNKNOWN. Callers must render an honest
 *      "Session not set" state / hide the chip. The retired hardcoded
 *      '2026-2027' fallback showed the WRONG year for every other tenant
 *      (Bluebell runs AY 2025-2026) — a year is never invented here.
 *
 * Rule: the Principal NEVER types a session. Every surface that needs the
 * academic session reads it from here. Display label format:
 * "AY 2026–2027" (en dash). Storage id format: "2026-2027" (hyphen —
 * matches FeeTransaction / FeeStructureVersion.academicYear and the fee
 * store's CURRENT_ACADEMIC_YEAR).
 *
 * Per-version snapshots: published fee structures keep the academicYear
 * they were published under (FeeStructureVersion / FeeStructureConfig
 * .academicYear). This module is only for the CURRENT active session —
 * never rewrite historical snapshots through it.
 */

import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { useCurrentUser } from '@/lib/store/current-user-store'

/** Normalize any session string ('2026–2027' en dash, '2026-2027' hyphen,
 *  '2026-27' short form) to the canonical hyphen id, or null when
 *  unparseable. Accepts any consecutive year pair. */
export function normalizeSessionId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{4})\s*[–-]\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const start = Number(m[1])
  const end = m[2].length === 4 ? Number(m[2]) : Number(`${String(start).slice(0, 2)}${m[2]}`)
  if (end !== start + 1) return null
  return `${start}-${end}`
}

/** "2026-2027" → "AY 2026–2027" (display label with en dash). */
export function formatSessionLabel(sessionId: string): string {
  return `AY ${sessionId.replace('-', '–')}`
}

/** Honest label when no source knows the school's year. */
export const SESSION_NOT_SET_LABEL = 'Session not set'

/**
 * Read the school's active academic session id (server-first — see the
 * resolution order in the header). Returns null when no source knows the
 * year; NEVER fabricates one. Non-hook variant for use outside React
 * (print engines, CSV export, store actions).
 */
export function getActiveAcademicSessionId(): string | null {
  const serverYear = useSchoolSettingsStore.getState().server?.identity?.academicYear
  const fromServer = normalizeSessionId(serverYear)
  if (fromServer) return fromServer
  const meYear = useCurrentUser.getState().me?.school?.academicYear
  const fromSession = normalizeSessionId(meYear)
  if (fromSession) return fromSession
  return normalizeSessionId(useSchoolSettingsStore.getState().academics?.currentSession)
}

/**
 * Non-hook: active session display label ("AY 2026–2027"), or null when
 * unknown — callers render SESSION_NOT_SET_LABEL instead of a wrong year.
 */
export function getActiveAcademicSessionLabel(): string | null {
  const id = getActiveAcademicSessionId()
  return id ? formatSessionLabel(id) : null
}

/**
 * React hook — the ONLY way UI components should read the active session.
 * Subscribes to all three resolution sources so a server sync (or the
 * auth-session identity arriving) re-renders consumers. `id` and `label`
 * are null when the school's year is unknown — render "Session not set"
 * or hide the chip; never substitute a year.
 */
export function useAcademicSession(): { id: string | null; label: string | null } {
  const serverYear = useSchoolSettingsStore((s) => s.server?.identity?.academicYear)
  const meYear = useCurrentUser((s) => s.me?.school?.academicYear)
  const localSession = useSchoolSettingsStore((s) => s.academics?.currentSession)
  const id =
    normalizeSessionId(serverYear) ?? normalizeSessionId(meYear) ?? normalizeSessionId(localSession)
  return { id, label: id ? formatSessionLabel(id) : null }
}
