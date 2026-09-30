'use client'

/**
 * use-dashboard-finance — PHASE 7 real-data contract.
 *
 * The dashboard's finance surfaces (collections chart, fee donut) read
 * the canonical school-scoped aggregate from `GET /api/dashboard`
 * (stats.feesTotal / feesPaid / overdue + the 6-month payment `trend`
 * built from real Payment rows). NO mock fallback: while the fetch is
 * in flight the UI shows skeletons, on failure an honest retry state,
 * and when a school has no fee/collection history it gets real zeros /
 * empty states — never fabricated rupees.
 */

import { useEffect, useState } from 'react'

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

let cached: DashboardFinance | null = null

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

export function useDashboardFinance(): DashboardFinance {
  const [finance, setFinance] = useState<DashboardFinance>(
    cached ?? { feesTotal: 0, feesPaid: 0, overdue: 0, trend: [], status: 'loading' },
  )

  useEffect(() => {
    if (cached) {
      setFinance(cached)
      return
    }
    void fetchFinance().then((f) => {
      if (f) {
        cached = f
        setFinance(f)
      } else {
        setFinance((prev) => ({ ...prev, status: 'error' }))
      }
    })
  }, [])

  return finance
}
