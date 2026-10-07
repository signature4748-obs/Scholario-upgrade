'use client'

/**
 * use-upcoming-exams — REAL upcoming-exam KPI (was the mock
 * "Pre-Board in 12 days" constant). Derives from /api/exams
 * (canonical DB rows): count = status 'SCHEDULED', sub = the nearest
 * upcoming exam's name + day delta.
 *
 * PHASE 7.5-D lifecycle (was: one fetch per session — no retry, no
 * invalidation):
 *   · module cache = stale-while-revalidate store with a 60s TTL;
 *   · in-flight guard — concurrent consumers share ONE fetch;
 *   · a failed fetch is never cached — the next mount retries, and
 *     `refresh()` lets the KPI card's "tap to retry" affordance work;
 *   · a failed background refetch keeps the visible data.
 */

import { useCallback, useEffect, useState } from 'react'

export interface UpcomingExamsKpi {
  count: number
  sub: string
}

export interface UseUpcomingExamsResult {
  /** Real KPI, or null while loading / after a failure. */
  kpi: UpcomingExamsKpi | null
  loading: boolean
  /** True when the fetch failed and there is no data to show. */
  error: boolean
  /** Force a refetch (retry). Coalesced with any in-flight fetch. */
  refresh: () => void
}

interface ExamRow {
  id: string
  name: string
  status: string
  startDate: string | null
}

const FRESH_FOR_MS = 60_000

let cached: UpcomingExamsKpi | null = null
let cachedAt = 0
let inflight: Promise<UpcomingExamsKpi | null> | null = null

async function fetchUpcoming(): Promise<UpcomingExamsKpi | null> {
  try {
    const res = await fetch('/api/exams', { cache: 'no-store' })
    if (!res.ok) return null
    const envelope = (await res.json()) as { ok?: boolean; data?: unknown }
    const raw = envelope.data
    const rows: ExamRow[] = Array.isArray(raw)
      ? (raw as ExamRow[])
      : Array.isArray((raw as { exams?: ExamRow[] })?.exams)
        ? (raw as { exams: ExamRow[] }).exams
        : []
    // Canonical status vocabulary is title-case ('Scheduled'/'Ongoing'),
    // legacy-seeded rows can carry uppercase — compare case-insensitively.
    // "Upcoming" = Scheduled (any date) + future-dated Ongoing, matching
    // the /api/dashboard server filter.
    const scheduled = rows
      .filter((e) => {
        const st = (e.status ?? '').toLowerCase()
        if (st === 'scheduled') return true
        if (st === 'ongoing') return !!e.startDate
        return false
      })
      .filter((e) => !e.startDate || new Date(e.startDate).getTime() >= Date.now() - 86400000)
    let sub = 'No scheduled exams'
    if (scheduled.length > 0) {
      const next = [...scheduled].sort((a, b) =>
        (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'),
      )[0]
      if (next.startDate) {
        const days = Math.max(
          0,
          Math.round((new Date(next.startDate).getTime() - Date.now()) / 86400000),
        )
        sub = `${next.name} in ${days} day${days === 1 ? '' : 's'}`
      } else {
        sub = `${next.name} · date to be announced`
      }
    }
    return { count: scheduled.length, sub }
  } catch {
    return null
  }
}

function ensureUpcoming(force = false): Promise<UpcomingExamsKpi | null> {
  if (inflight) return inflight
  if (!force && cached && Date.now() - cachedAt < FRESH_FOR_MS) {
    return Promise.resolve(cached)
  }
  const run = (async () => {
    const fetched = await fetchUpcoming()
    if (fetched) {
      cached = fetched
      cachedAt = Date.now()
    }
    return fetched
  })()
  inflight = run
  run.finally(() => {
    if (inflight === run) inflight = null
  })
  return run
}

export function useUpcomingExams(): UseUpcomingExamsResult {
  const [state, setState] = useState<{ kpi: UpcomingExamsKpi | null; loading: boolean; error: boolean }>(() => ({
    kpi: cached,
    loading: cached === null,
    error: false,
  }))

  useEffect(() => {
    let cancelled = false
    if (!cached) setState({ kpi: null, loading: true, error: false })
    void ensureUpcoming().then(() => {
      if (cancelled) return
      if (cached) setState({ kpi: cached, loading: false, error: false })
      else setState({ kpi: null, loading: false, error: true })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(() => {
    void ensureUpcoming(true).then(() => {
      setState((prev) =>
        cached
          ? { kpi: cached, loading: false, error: false }
          : prev.kpi
            ? prev // failed refresh, visible data kept
            : { kpi: null, loading: false, error: true },
      )
    })
  }, [])

  return { ...state, refresh }
}
