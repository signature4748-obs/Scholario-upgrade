'use client'

/**
 * student-attendance-store — canonical student attendance records.
 *
 * The single source of truth connecting the MARKING side (Teacher /
 * Principal attendance UI) to the READING side (Student "My Attendance"):
 *
 *   Teacher/Principal marks a class  →  records upserted here
 *                                     →  Student Attendance reflects it live
 *                                     →  later edits overwrite the same
 *                                        (studentId, date) row — the student
 *                                        always sees the latest status.
 *
 * Seed: a deterministic window of the last 25 school days (Mon–Fri,
 * holidays skipped via the canonical school calendar) ending today, with
 * a fixed status pattern — 23 present + 1 late + 1 absent = 96% for the
 * demo student STU-58 (matches students-store `attendance: 96` exactly).
 * Dates are derived from the REAL clock at first load so the tenant
 * always has fresh, current data; after the first write the records
 * persist and age like real institutional data.
 *
 * NO second attendance dataset exists for the student role — the UI
 * derives every number (percentage, present/absent/late counts, trends)
 * from these records.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { getHoliday } from '@/lib/mock/school-calendar'

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

interface StudentAttendanceStoreState {
  records: StudentAttendanceRecord[]
  /**
   * Upsert a batch of records for one class on one date (Teacher/Principal
   * "Save Attendance"). Existing (studentId, date) rows are UPDATED — the
   * student sees corrections immediately.
   */
  markClassAttendance: (input: {
    date: string
    entries: { studentId: string; status: AttendanceStatus; note?: string }[]
    markedBy: string
  }) => number
  /** Upsert a single student's record. */
  markStudent: (input: { studentId: string; date: string; status: AttendanceStatus; note?: string; markedBy: string }) => void
  /** Reset to the deterministic seed (dev/QA helper). */
  resetToSeed: () => void
}

/* ─── Seed derivation ────────────────────────────────────────────────
 * Deterministic: same calendar day → same window + same status pattern.
 * 25 school days: present except #9 (absent) and #20 (late) → 96%.
 * ──────────────────────────────────────────────────────────────────── */

const SEED_STUDENT_ID = 'STU-58'
const SEED_MARKER = 'Rohan Mehta'
const ABSENT_INDEX = 8
const LATE_INDEX = 19

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** School day = Mon–Fri (weekday) and not a canonical school holiday. */
function isSchoolDay(d: Date): boolean {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false
  return getHoliday(isoDate(d)) === null
}

/** Walk backwards from `from` collecting the last `count` school days (inclusive of `from` when it is one). */
function lastSchoolDays(count: number, from: Date = new Date()): string[] {
  const days: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let guard = 0; days.length < count && guard < count * 4 + 40; guard++) {
    if (isSchoolDay(cursor)) days.push(isoDate(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return days.reverse()
}

function buildSeed(): StudentAttendanceRecord[] {
  const days = lastSchoolDays(25)
  return days.map((date, i) => ({
    studentId: SEED_STUDENT_ID,
    date,
    status: i === ABSENT_INDEX ? 'absent' : i === LATE_INDEX ? 'late' : 'present',
    markedBy: SEED_MARKER,
    markedAt: `${date}T09:05:00`,
  }))
}

const SEED = buildSeed()

/* ─── Store ─────────────────────────────────────────────────────────── */

export const useStudentAttendanceStore = create<StudentAttendanceStoreState>()(
  persist(
    (set, _get) => ({
      records: SEED,

      markClassAttendance: ({ date, entries, markedBy }) => {
        const now = new Date().toISOString()
        let written = 0
        set((state) => {
          const byKey = new Map(state.records.map((r) => [`${r.studentId}|${r.date}`, r]))
          for (const e of entries) {
            // NOTE: entries carry {studentId, status, note} — the DATE comes
            // from the outer parameter. Keying on the outer `date` (not
            // e.date, which does not exist) is what makes a re-save UPDATE
            // the existing row instead of duplicating it — the student then
            // always sees the corrected status.
            const key = `${e.studentId}|${date}`
            const existing = byKey.get(key)
            if (existing) {
              byKey.set(key, { ...existing, status: e.status, note: e.note ?? existing.note, markedBy, markedAt: now })
            } else {
              byKey.set(key, { studentId: e.studentId, date, status: e.status, note: e.note, markedBy, markedAt: now })
            }
            written++
          }
          return { records: [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.studentId < b.studentId ? -1 : 1)) }
        })
        return written
      },

      markStudent: ({ studentId, date, status, note, markedBy }) => {
        const now = new Date().toISOString()
        set((state) => {
          const existing = state.records.find((r) => r.studentId === studentId && r.date === date)
          if (existing) {
            return {
              records: state.records.map((r) =>
                r.studentId === studentId && r.date === date ? { ...r, status, note: note ?? r.note, markedBy, markedAt: now } : r
              ),
            }
          }
          return { records: [...state.records, { studentId, date, status, note, markedBy, markedAt: now }] }
        })
      },

      resetToSeed: () => set({ records: SEED }),
    }),
    {
      name: 'scholario-student-attendance-v1',
      storage: createJSONStorage(() => localStorage),
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

/** Monthly aggregation → trend points ending at the latest recorded month. */
export function monthlyTrend(records: StudentAttendanceRecord[], months = 6): { name: string; v: number }[] {
  if (records.length === 0) return []
  const byMonth = new Map<string, { attended: number; total: number }>()
  for (const r of records) {
    const key = r.date.slice(0, 7)
    const agg = byMonth.get(key) ?? { attended: 0, total: 0 }
    agg.total++
    if (r.status === 'present' || r.status === 'late') agg.attended++
    byMonth.set(key, agg)
  }
  const latest = [...byMonth.keys()].sort().at(-1)!
  const [y, m] = latest.split('-').map(Number)
  const points: { name: string; v: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const agg = byMonth.get(key)
    if (agg && agg.total > 0) {
      points.push({ name: d.toLocaleDateString('en-IN', { month: 'short' }), v: Math.round((agg.attended / agg.total) * 100) })
    } else if (i === 0) {
      // Latest month with no records yet → overall window rate keeps the
      // chart endpoint honest instead of dropping to zero.
      const overall = computeStats(records)
      points.push({ name: d.toLocaleDateString('en-IN', { month: 'short' }), v: overall.percent })
    }
  }
  return points
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
    const key = isoDate(monday)
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
