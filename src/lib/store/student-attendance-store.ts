'use client'

/**
 * student-attendance-store — the Student "My Attendance" data cache.
 *
 * 7-b (Mock Data Elimination): the STU-58 demo seed (25 fabricated days
 * at 96%) is RETIRED. The store starts EMPTY and is hydrated from the
 * REAL server rows via GET /api/student/attendance (the canonical
 * Attendance rows the Teacher/Principal marking flow writes — identity
 * resolved server-side, so these are always the caller's own records).
 *
 *   hydrate(studentId) → fetch /api/student/attendance
 *                     → records replaced with the real rows
 *                     → the module's percentage / calendar / trend all
 *                       re-derive from REAL data (0 records → honest
 *                       zeros, never a fabricated 96%).
 *
 * The store persists as a CACHE of the last server response (survives
 * tab switches; every mount re-hydrates and overwrites). The legacy
 * v1 seed was purged via the persist migration below.
 *
 * NO second attendance dataset exists for the student role — every number
 * the student sees (percentage, present/absent/late counts, trends)
 * derives from these records or is honestly empty.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave'

export interface StudentAttendanceRecord {
  studentId: string
  /** YYYY-MM-DD */
  date: string
  status: AttendanceStatus
  /** Optional reason/note recorded by the marker. */
  note?: string
  /** Who marked the record (teacher/principal display name). */
  markedBy?: string
  /** ISO timestamp of the last write to this record. */
  markedAt: string
}

/** One server row (as returned by GET /api/student/attendance). */
interface AttendanceApiRecord {
  date: string
  status: 'present' | 'late' | 'absent' | 'leave'
  className: string | null
  note: null
  markedAt: string
}

export type AttendanceFetchStatus = 'idle' | 'loading' | 'ready' | 'error'

interface StudentAttendanceStoreState {
  records: StudentAttendanceRecord[]
  status: AttendanceFetchStatus
  /** First error message while hydrating (null when none). */
  error: string | null
  /**
   * Fetch the caller's own records from the server and replace the store.
   * In-flight guarded; a 60s freshness window prevents duplicate fetches
   * when several surfaces mount at once.
   */
  hydrate: (studentId: string) => Promise<void>
}

/* ─── Store ─────────────────────────────────────────────────────────── */

const FETCH_FRESH_MS = 60_000
let inFlight: Promise<void> | null = null
let lastFetchedFor: string | null = null
let lastFetchedAt = 0

export const useStudentAttendanceStore = create<StudentAttendanceStoreState>()(
  persist(
    (set, get) => ({
      records: [],
      status: 'idle',
      error: null,

      hydrate: async (studentId) => {
        if (!studentId) return
        // Fresh enough — the caller is rendering the same data already.
        const now = Date.now()
        if (
          inFlight ||
          (lastFetchedFor === studentId &&
            get().status === 'ready' &&
            now - lastFetchedAt < FETCH_FRESH_MS)
        ) {
          return inFlight ?? Promise.resolve()
        }
        lastFetchedFor = studentId
        const job = (async () => {
          set({ status: 'loading', error: null })
          try {
            const r = await fetch('/api/student/attendance', {
              cache: 'no-store',
              credentials: 'same-origin',
            })
            if (!r.ok) {
              // 401 etc. — surface a concise, honest error the module can
              // render with a retry control.
              let message = `Attendance could not load (${r.status}).`
              try {
                const j = await r.json()
                if (j && typeof j === 'object' && typeof j.error === 'string') {
                  message = j.error
                }
              } catch {
                /* non-JSON error body — keep the fallback */
              }
              throw new Error(message)
            }
            const j = await r.json()
            if (!j || typeof j !== 'object' || j.ok !== true || !('data' in j)) {
              throw new Error('Unexpected response from the server.')
            }
            const rows = ((j.data as { records?: AttendanceApiRecord[] }).records ?? []).map(
              (row): StudentAttendanceRecord => ({
                studentId,
                date: row.date,
                status: row.status,
                note: row.note ?? undefined,
                markedAt: row.markedAt,
              }),
            )
            lastFetchedAt = Date.now()
            set({ records: rows, status: 'ready', error: null })
          } catch (e) {
            set({
              status: 'error',
              error: e instanceof Error ? e.message : 'Attendance could not load.',
            })
          } finally {
            inFlight = null
          }
        })()
        inFlight = job
        return job
      },
    }),
    {
      // Same key as the retired seeded store — persisted browsers holding
      // the STU-58 demo rows (persisted version 0) are PURGED in place by
      // the v2 migration below (the 7-a same-key + version-bump pattern);
      // a renamed key would orphan the stale data instead of clearing it.
      name: 'scholario-student-attendance-v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // 7-b — purge the retired STU-58 seed (and any stale cache) on
      // upgrade; the store re-hydrates from the server on next mount.
      migrate: () => ({ records: [], status: 'idle', error: null }),
      partialize: (state) => ({ records: state.records }) as StudentAttendanceStoreState,
    }
  )
)

/* ─── Derived helpers (pure — usable outside React) ─────────────────── */

export interface AttendanceStats {
  total: number
  present: number
  late: number
  absent: number
  leave: number
  /** Days attended (present + late — late arrivals count as attended). */
  attended: number
  /** Attendance percentage over recorded days (0 when no records). */
  percent: number
}

export function computeStats(records: StudentAttendanceRecord[]): AttendanceStats {
  const s: AttendanceStats = { total: 0, present: 0, late: 0, absent: 0, leave: 0, attended: 0, percent: 0 }
  for (const r of records) {
    s.total++
    s[r.status]++
  }
  s.attended = s.present + s.late
  s.percent = s.total > 0 ? Math.round((s.attended / s.total) * 100) : 0
  return s
}

/** Records for one student, oldest → newest. */
export function studentRecords(all: StudentAttendanceRecord[], studentId: string): StudentAttendanceRecord[] {
  return all.filter((r) => r.studentId === studentId).sort((a, b) => (a.date < b.date ? -1 : 1))
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/**
 * Weekly aggregation → the honest "improving or declining?" curve.
 * One point per ISO week (Mon-based) that has records, oldest → newest,
 * labeled by the week's Monday ("10 Nov"). NO synthetic history — weeks
 * without records simply do not appear. Late arrivals count as attended
 * (same convention as computeStats).
 */
export function weeklyTrend(records: StudentAttendanceRecord[], weeks = 8): { name: string; v: number }[] {
  if (records.length === 0) return []
  const byWeek = new Map<string, { attended: number; total: number }>()
  for (const r of records) {
    const d = new Date(`${r.date}T00:00:00`)
    if (Number.isNaN(d.getTime())) continue
    // ISO week start (Monday)
    const dow = (d.getDay() + 6) % 7
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
    const key = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
    const agg = byWeek.get(key) ?? { attended: 0, total: 0 }
    agg.total++
    if (r.status === 'present' || r.status === 'late') agg.attended++
    byWeek.set(key, agg)
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-weeks)
    .map(([key, agg]) => ({
      name: new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      v: Math.round((agg.attended / agg.total) * 100),
    }))
}
