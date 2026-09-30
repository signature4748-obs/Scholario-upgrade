// ──────────────────────────────────────────────────────────────────────
// Session Top Performers — types + pure helpers.
//
// RETIRED (7-b — Mock Data Elimination): the per-session mock topper
// rosters (TOPPERS_2025_2026 / TOPPERS_2024_2025 / SESSION_DATA /
// getSessionSummary) are GONE — they were fabricated students with
// fabricated aggregates. The Session Top Performers section now
// computes REAL toppers from GET /api/results (PRINCIPAL scope = the
// school's published Result rows), aggregated per student across the
// session's declared exams (see tabs/session-top-performers.tsx).
//
// This file keeps the shared SHAPE (SessionTopper / SessionSummary),
// the session picker options and the pure rank helper so consumers
// stay compatible.
// ──────────────────────────────────────────────────────────────────────

export interface SessionTopper {
  studentId: string
  name: string
  rollNo: string
  className: string
  section: string | null
  stream: string | null
  totalObtained: number
  totalMax: number
  percentage: number
  grade: string
  examsConsidered: number
  avatarColor: string // tailwind color token, used for the avatar circle
}

export interface SessionSummary {
  session: string
  studentCount: number
  examsConsidered: number
  toppers: SessionTopper[]
}

export const AVAILABLE_SESSIONS = [
  { value: '2025-2026', label: '2025–26' },
  { value: '2024-2025', label: '2024–25' },
]

/**
 * Returns the rank for a topper at the given index. Toppers with the same
 * percentage share the same rank (standard competition ranking).
 */
export function rankForIndex(toppers: SessionTopper[], index: number): number {
  if (index === 0) return 1
  if (toppers[index].percentage === toppers[index - 1].percentage) {
    return rankForIndex(toppers, index - 1)
  }
  return index + 1
}
