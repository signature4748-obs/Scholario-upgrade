'use client'

/**
 * use-dashboard-finance — PHASE 7 real-data contract + PHASE 7.5-D
 * stale-while-revalidate lifecycle.
 *
 * The dashboard's finance surfaces (collections chart, fee donut) read
 * the canonical school-scoped aggregate from `GET /api/dashboard`
 * (stats.feesTotal / feesPaid / overdue + the 6-month payment `trend`
 * built from real Payment rows). NO mock fallback: while the fetch is
 * in flight the UI shows skeletons, on failure an honest retry state,
 * and when a school has no fee/collection history it gets real zeros /
 * empty states — never fabricated rupees.
 *
 * PHASE 7.5-D lifecycle (was: one fetch per session, an error stuck
 * until a full page reload):
 *   · module-level cache = stale-while-revalidate store — a NEW mount
 *     within the 60s TTL serves the cache with zero requests; a mount
 *     after the TTL keeps the data VISIBLE and refetches in the
 *     background (status only goes 'loading' when there is no data yet);
 *   · in-flight guard (teachers-store `ensure()` pattern) — concurrent
 *     consumers share ONE fetch, never duplicated;
 *   · a FAILED fetch is never cached — the next mount retries, and the
 *     hook exposes `refresh()` so the UI's retry affordance actually
 *     retries (the charts render it on status:'error');
 *   · `refresh()` bypasses the TTL (manual retry / post-mutation
 *     invalidation) and reuses the in-flight fetch when one is running.
 */

import { useCallback, useEffect, useState } from 'react'

export interface DashboardFinance {
  /** Total fee amounts billed (Fee.amount sum). */
  feesTotal: number
  /** Total actually collected (Fee.paid sum). */
  feesPaid: number
  /** Count of UNPAID/OVERDUE fee rows. */
  overdue: number
  /** Real monthly collection series [{month:'2026-01', amount}] (≤6). */
  trend: Array<{ month: string; amount: number }>
  status: 'loading' | 'ready' | 'error'
}

export interface UseDashboardFinanceResult extends DashboardFinance {
  /**
   * Force a refetch (retry on error / manual refresh). Coalesced with any
   * in-flight fetch; on failure existing data stays on screen.
   */
  refresh: () => void
}

const EMPTY: DashboardFinance = { feesTotal: 0, feesPaid: 0, overdue: 0, trend: [], status: 'loading' }

/** Background-refetch window — a fresh cache serves without a request. */
const FRESH_FOR_MS = 60_000

let cached: DashboardFinance | null = null
let cachedAt = 0
let inflight: Promise<DashboardFinance | null> | null = null

async function fetchFinance(): Promise<DashboardFinance | null> {
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' })
    if (!res.ok) return null
    const envelope = (await res.json()) as {
      ok?: boolean
      data?: {
        scope?: string
        stats?: { feesTotal?: number; feesPaid?: number; overdue?: number }
        trend?: Array<{ month: string; amount: number }>
      }
    }
    const data = envelope.data
    if (!data || data.scope !== 'SCHOOL' || !data.stats) return null
    return {
      feesTotal: data.stats.feesTotal ?? 0,
      feesPaid: data.stats.feesPaid ?? 0,
      overdue: data.stats.overdue ?? 0,
      trend: Array.isArray(data.trend) ? data.trend : [],
      status: 'ready',
    }
  } catch {
    return null
  }
}

/**
 * Fetch-on-demand with the in-flight guard:
 *   · fresh (<60s) cache → resolved immediately, zero requests;
 *   · an in-flight fetch is shared — never duplicated;
 *   · success updates the module cache (visible data survives later
 *     refresh failures — stale-while-revalidate);
 *   · failure is NEVER cached — the next ensure()/refresh() retries.
 * `force` bypasses the TTL (explicit retry / invalidation).
 */
function ensureFinance(force = false): Promise<DashboardFinance | null> {
  if (inflight) return inflight
  if (!force && cached && Date.now() - cachedAt < FRESH_FOR_MS) {
    return Promise.resolve(cached)
  }
  const run = (async () => {
    const fetched = await fetchFinance()
    if (fetched) {
      cached = fetched
      cachedAt = Date.now()
    }
    return fetched
  })()
  inflight = run
  run.finally(() => {
    // Reset only when this promise is still the guarded one (a refresh
    // never overwrites a newer in-flight fetch's guard slot).
    if (inflight === run) inflight = null
  })
  return run
}

export function useDashboardFinance(): UseDashboardFinanceResult {
  // Module cache first: a remount with data paints immediately; the
  // status only starts at 'loading' when there is NO data yet.
  const [finance, setFinance] = useState<DashboardFinance>(cached ?? EMPTY)

  useEffect(() => {
    let cancelled = false
    // Stale cache (past TTL) → keep the data visible; the background
    // refetch below refreshes it silently.
    void ensureFinance().then(() => {
      if (cancelled) return
      if (cached) setFinance(cached)
      else setFinance({ ...EMPTY, status: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(() => {
    void ensureFinance(true).then(() => {
      setFinance((prev) =>
        cached ? cached : prev.status === 'ready' ? prev : { ...EMPTY, status: 'error' },
      )
    })
  }, [])

  return { ...finance, refresh }
}
