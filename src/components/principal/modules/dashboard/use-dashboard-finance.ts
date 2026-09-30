'use client'

/**
 * use-dashboard-finance — PHASE 7 real-data contract + PHASE 7.5-D
 * stale-while-revalidate lifecycle + FINAL-GATE trend display series.
 *
 * The dashboard's finance surfaces (collections chart, fee collection card) read
 * the canonical school-scoped aggregate from `GET /api/dashboard`
 * (stats.feesTotal / feesPaid / overdue + the 6-month payment `trend`
 * built from real Payment rows). NO mock fallback: while the fetch is
 * in flight the UI shows skeletons, on failure an honest retry state,
 * and when a school has no fee/collection history it gets real zeros /
 * empty states — never fabricated rupees.
 *
 * FINAL-GATE (trendDisplay): the API returns only months that HAVE
 * payments (a discontinuous series). A line chart read as continuous time
 * would silently skip zero-collection months. `trendDisplay` is the honest
 * display series: continuous calendar months from the first to the last
 * payment month, every gap filled with a REAL zero ("no payments recorded
 * that month"), ≤6 buckets ending at the newest data month, each with a
 * human label ("Apr 26"). Raw `trend` keeps the API contract untouched.
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
  /** Total actually collected (Fee.paid sum, all rows — FINAL-GATE). */
  feesPaid: number
  /** Count of UNPAID/OVERDUE fee rows. */
  overdue: number
  /** Real monthly collection series [{month:'2026-01', amount}] (≤6, API contract). */
  trend: Array<{ month: string; amount: number }>
  /** Continuous display series with human labels + real zeros (FINAL-GATE). */
  trendDisplay: Array<{ month: string; label: string; amount: number }>
  status: 'loading' | 'ready' | 'error'
}

export interface UseDashboardFinanceResult extends DashboardFinance {
  /**
   * Force a refetch (retry on error / manual refresh). Coalesced with any
   * in-flight fetch; on failure existing data stays on screen.
   */
  refresh: () => void
}

const EMPTY: DashboardFinance = {
  feesTotal: 0, feesPaid: 0, overdue: 0, trend: [], trendDisplay: [], status: 'loading',
}

/** Background-refetch window — a fresh cache serves without a request. */
const FRESH_FOR_MS = 60_000

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-04' → 'Apr 26' (stable, locale-independent display label). */
function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/**
 * Continuous display series from a sparse API trend:
 *   · buckets = every calendar month from the first to the last payment
 *     month (gaps carry amount 0 — an honest "no payments that month",
 *     never an invented rupee);
 *   · capped at the 6 most recent buckets (the chart's window);
 *   · a single-month history gets its previous month prepended as a real
 *     zero so the line has a segment to draw.
 */
export function buildTrendDisplay(
  trend: Array<{ month: string; amount: number }>,
): Array<{ month: string; label: string; amount: number }> {
  if (trend.length === 0) return []
  const byMonth = new Map(trend.map((p) => [p.month, p.amount]))
  const [fy, fm] = trend[0].month.split('-').map(Number)
  const [ly, lm] = trend[trend.length - 1].month.split('-').map(Number)
  if (!fy || !fm || !ly || !lm) return trend.map((p) => ({ ...p, label: monthLabel(p.month) }))

  const buckets: string[] = []
  let y = fy
  let m = fm
  // guard: iterate at most 24 months (defensive against corrupt spans)
  while ((y < ly || (y === ly && m <= lm)) && buckets.length < 24) {
    buckets.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  let series = buckets.map((month) => ({
    month,
    label: monthLabel(month),
    amount: byMonth.get(month) ?? 0,
  }))
  if (series.length === 1) {
    // single data point — prepend the previous calendar month as a real zero
    const [py, pm] = [series[0].month.split('-')].map(([yy, mm]) => {
      const yv = Number(yy)
      const mv = Number(mm)
      return mv === 1 ? [yv - 1, 12] : [yv, mv - 1]
    })[0] as [number, number]
    series = [
      { month: `${py}-${String(pm).padStart(2, '0')}`, label: monthLabel(`${py}-${String(pm).padStart(2, '0')}`), amount: 0 },
      ...series,
    ]
  }
  return series.slice(-6)
}

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
    const trend = Array.isArray(data.trend) ? data.trend : []
    return {
      feesTotal: data.stats.feesTotal ?? 0,
      feesPaid: data.stats.feesPaid ?? 0,
      overdue: data.stats.overdue ?? 0,
      trend,
      trendDisplay: buildTrendDisplay(trend),
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
