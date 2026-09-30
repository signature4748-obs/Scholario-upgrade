'use client'

/**
 * use-school-stats — school overview figures from /api/dashboard
 * (principal/management), used by the dashboard surfaces that need REAL
 * school-wide numbers (teacher count, …) instead of the retired mock
 * constants (production data reduction 2026-10).
 *
 * PHASE 7.5-D lifecycle (was: one fetch per session — no retry, no
 * invalidation; a failure stuck as "—" until a full page reload):
 *   · module cache = stale-while-revalidate store with a 60s TTL;
 *   · in-flight guard — concurrent consumers share ONE fetch;
 *   · a failed fetch is never cached — the next mount retries, and
 *     `refresh()` lets the UI's retry affordance actually retry;
 *   · a failed background refetch keeps the visible data (only flags
 *     `error` when there is nothing on screen to show).
 */

import { useCallback, useEffect, useState } from 'react'

export interface SchoolStats {
  students: number
  teachers: number
  classes: number
}

export interface UseSchoolStatsResult {
  /** Real figures, or null while loading / after a failure. */
  stats: SchoolStats | null
  loading: boolean
  /** True when the fetch failed and there is no data to show. */
  error: boolean
  /** Force a refetch (retry). Coalesced with any in-flight fetch. */
  refresh: () => void
}

const FRESH_FOR_MS = 60_000

let cached: SchoolStats | null = null
let cachedAt = 0
let inflight: Promise<SchoolStats | null> | null = null

async function fetchStats(): Promise<SchoolStats | null> {
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' })
    if (!res.ok) return null
    const envelope = (await res.json()) as {
      ok?: boolean
      data?: { stats?: Partial<SchoolStats>; teachers?: number; students?: number; classes?: number }
    }
    const data = envelope.data
    const stats = data?.stats ?? data
    if (!stats || typeof stats.teachers !== 'number') return null
    return {
      students: stats.students ?? 0,
      teachers: stats.teachers ?? 0,
      classes: stats.classes ?? 0,
    }
  } catch {
    return null
  }
}

function ensureStats(force = false): Promise<SchoolStats | null> {
  if (inflight) return inflight
  if (!force && cached && Date.now() - cachedAt < FRESH_FOR_MS) {
    return Promise.resolve(cached)
  }
  const run = (async () => {
    const fetched = await fetchStats()
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

export function useSchoolStats(): UseSchoolStatsResult {
  const [state, setState] = useState<{ stats: SchoolStats | null; loading: boolean; error: boolean }>(() => ({
    stats: cached,
    loading: cached === null,
    error: false,
  }))

  useEffect(() => {
    let cancelled = false
    // Stale cache (past TTL) keeps the data visible while the background
    // refetch runs — loading only when there is no data yet.
    if (!cached) setState({ stats: null, loading: true, error: false })
    void ensureStats().then(() => {
      if (cancelled) return
      if (cached) setState({ stats: cached, loading: false, error: false })
      else setState({ stats: null, loading: false, error: true })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(() => {
    void ensureStats(true).then(() => {
      setState((prev) =>
        cached
          ? { stats: cached, loading: false, error: false }
          : prev.stats
            ? prev // failed refresh, visible data kept
            : { stats: null, loading: false, error: true },
      )
    })
  }, [])

  return { ...state, refresh }
}
