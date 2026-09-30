'use client'

/**
 * use-attendance-overview — the canonical school-wide attendance overview
 * feed (attendance-overview-real).
 *
 * GET /api/attendance/overview derives EVERYTHING from the Attendance table
 * (latest recorded day breakdown, 6-day trend, 6-month trend, per
 * grade-group rates, per-date daily series). This hook unwraps the
 * { ok, data } envelope and exposes it as `{ data, loading, error, refresh }`:
 *
 *   · `data` is undefined while the fetch is in flight — consumers render
 *     their existing skeleton / loading tile;
 *   · the fetch is module-level cached (stale-while-revalidate, 60s TTL) —
 *     one shared request per window, a NEW mount after the TTL keeps the
 *     data visible and refetches in the background;
 *   · a failed fetch is NOT cached — the next mount retries, and
 *     `refresh()` is the retry the KPI card's affordance calls;
 *   · `error` is true only when a fetch failed with nothing on screen
 *     (a failed background refetch keeps the visible data).
 */

import { useCallback, useEffect, useState } from 'react'

export interface AttendanceOverviewToday {
  present: number
  absent: number
  late: number
  leave: number
  /** distinct students marked on `date` (honest denominator — NOT school size) */
  total: number
  /** (present + late) / total * 100, 1 decimal */
  rate: number
  /** ISO date (YYYY-MM-DD) of the latest RECORDED day; null when no rows */
  date: string | null
  isLatestRecordedDate: boolean
}

export interface AttendanceWeekTrendPoint {
  /** weekday short label of the recorded date ('Mon') */
  day: string
  date: string
  present: number
  rate: number
}

export interface AttendanceMonthlyPoint {
  /** calendar month short label ('Apr') */
  month: string
  rate: number
}

export interface AttendanceClassRate {
  /** grade-group label — "Grade 9" / "Grade 11 (Science)" / "Grade 11 (Commerce)" */
  class: string
  /** rate over ALL the group's attendance rows */
  rate: number
  /** distinct students with rows in the group */
  students: number
  present: number
  absent: number
  late: number
  leave: number
  /** student-day records — the rate's denominator */
  records: number
}

export interface AttendanceDayRecord {
  /** ISO date (YYYY-MM-DD) */
  date: string
  present: number
  absent: number
  late: number
  leave: number
  total: number
  rate: number
}

export interface AttendanceOverviewData {
  today: AttendanceOverviewToday
  weekTrend: AttendanceWeekTrendPoint[]
  monthly: AttendanceMonthlyPoint[]
  byClass: AttendanceClassRate[]
  daily: AttendanceDayRecord[]
}

export interface UseAttendanceOverviewResult {
  data: AttendanceOverviewData | undefined
  loading: boolean
  /** True when a fetch failed with nothing on screen. */
  error: boolean
  /** Force a refetch (retry). Coalesced with any in-flight fetch. */
  refresh: () => void
}

/** Module-level session cache — one shared fetch per window (60s TTL). */
let cachedOverview: AttendanceOverviewData | null = null
let cachedAt = 0
let inflight: Promise<AttendanceOverviewData | null> | null = null
const FRESH_FOR_MS = 60_000

function fetchOverview(force = false): Promise<AttendanceOverviewData | null> {
  if (!force && cachedOverview && Date.now() - cachedAt < FRESH_FOR_MS) {
    return Promise.resolve(cachedOverview)
  }
  if (!inflight) {
    const run = fetch('/api/attendance/overview', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        let json: unknown = null
        try {
          json = await res.json()
        } catch {
          /* non-JSON error body — handled by the ok check below */
        }
        const envelope = json as { ok?: unknown; data?: AttendanceOverviewData } | null
        if (!res.ok || !envelope || envelope.ok !== true || !envelope.data) {
          throw new Error(`HTTP ${res.status}`)
        }
        return envelope.data
      })
      .then((data) => {
        // Stamp ONLY on a real network success (a fresh-cache resolve must
        // not re-arm the TTL).
        cachedOverview = data
        cachedAt = Date.now()
        return data
      })
      .catch((e: unknown) => {
        // Silent failure — data stays undefined; consumers keep their
        // loading pattern. The failure is not cached (next mount retries).
        console.warn('[attendance-overview] unavailable, staying on loading state:', e)
        return null
      })
    inflight = run
    run.finally(() => {
      if (inflight === run) inflight = null
    })
  }
  return inflight
}

export function useAttendanceOverview(): UseAttendanceOverviewResult {
  const [data, setData] = useState<AttendanceOverviewData | undefined>(cachedOverview ?? undefined)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchOverview().then((d) => {
      if (cancelled) return
      if (d) setData(d)
      else setError(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(() => {
    void fetchOverview(true).then((d) => {
      if (d) {
        setData(d)
        setError(false)
      } else if (!cachedOverview) {
        setError(true)
      }
    })
  }, [])

  return { data, loading: data === undefined && !error, error, refresh }
}
