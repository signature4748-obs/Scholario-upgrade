'use client'

/**
 * use-school-holidays — the authoritative DB holiday feed (Phase B, shared).
 *
 * GET /api/events?type=HOLIDAY (tenant-scoped SchoolEvent rows), expanded
 * into the per-date Holiday map calendar surfaces consume. Module-level
 * cache + in-flight guard for the window; consumers fall back to the
 * bundled client mirror (`@/lib/mock/school-calendar`) while loading / on
 * failure — never fabricated data.
 *
 * Extracted from principal/attendance/data.tsx (Phase B) so BOTH planes
 * consume one feed: the principal attendance heatmap AND the student
 * attendance month grid / timetable next-school-day logic (this module is
 * role-agnostic — /api/events is school-scoped for any session role).
 */
import { useEffect, useState } from 'react'
import type { Holiday } from '@/lib/mock/school-calendar'

/** DB SchoolEvent row subset (GET /api/events?type=HOLIDAY). */
export interface HolidayEvent {
  title: string
  startDate: string
  endDate?: string | null
}

/**
 * Expand DB HOLIDAY events (inclusive date ranges) into the per-date
 * Holiday map the calendar consumes. Type mapping: SchoolEvent HOLIDAY
 * rows carry no sub-type — 'school' keeps the neutral violet styling.
 */
export function holidaysFromEvents(events: HolidayEvent[]): Record<string, Holiday> {
  const map: Record<string, Holiday> = {}
  for (const ev of events) {
    const start = ev.startDate.slice(0, 10)
    const end = (ev.endDate ?? ev.startDate).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue
    // Guard against pathological ranges (bounded expansion, ≤370 days).
    let cursor = new Date(`${start}T00:00:00.000Z`)
    const last = new Date(`${end}T00:00:00.000Z`)
    let guard = 0
    while (cursor <= last && guard < 370) {
      const dateStr = cursor.toISOString().slice(0, 10)
      if (!(dateStr in map)) {
        map[dateStr] = { dateStr, name: ev.title, type: 'school' }
      }
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
      guard++
    }
  }
  return map
}

let cachedHolidays: Record<string, Holiday> | null = null
let holidaysInflight: Promise<Record<string, Holiday> | null> | null = null

function fetchHolidays(): Promise<Record<string, Holiday> | null> {
  if (cachedHolidays) return Promise.resolve(cachedHolidays)
  if (!holidaysInflight) {
    holidaysInflight = fetch('/api/events?type=HOLIDAY', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        let json: unknown = null
        try {
          json = await res.json()
        } catch {
          /* non-JSON body — treated as failure below */
        }
        const envelope = json as { ok?: unknown; data?: HolidayEvent[] } | null
        if (!res.ok || !envelope || envelope.ok !== true || !Array.isArray(envelope.data)) {
          return null
        }
        return holidaysFromEvents(envelope.data)
      })
      .then((map) => {
        if (map) cachedHolidays = map
        return map
      })
      .catch(() => null)
      .finally(() => {
        holidaysInflight = null
      })
  }
  return holidaysInflight
}

/**
 * useSchoolHolidays — the DB holiday map once fetched, `undefined` while
 * loading / on failure (consumers then use the bundled mirror as the
 * documented fallback).
 */
export function useSchoolHolidays(): Record<string, Holiday> | undefined {
  const [holidays, setHolidays] = useState<Record<string, Holiday> | undefined>(cachedHolidays ?? undefined)
  useEffect(() => {
    if (cachedHolidays) return
    let cancelled = false
    void fetchHolidays().then((map) => {
      if (!cancelled && map) setHolidays(map)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return holidays
}
