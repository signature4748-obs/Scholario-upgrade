'use client'

/**
 * SalaryConfirmationsBanner — teacher-side notification shown on the
 * teacher dashboard when the school recently recorded a salary payment.
 *
 * PHASE 8B: honest by construction — the banner lists only REAL RECENT
 * canonical payments (RECORDED within the last 7 days, read from the
 * teacher's own server rows via GET /api/salary). The former fabricated
 * "awaiting your confirmation" queue (a localStorage-only workflow) is
 * retired; no unread-state is invented.
 */

import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, BadgeCheck } from 'lucide-react'

import { useSalaryStore, periodLabel } from '@/lib/store/salary-store'
import { fmtDay, moneyMy } from '@/components/principal/modules/salary/salary-shared'

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function SalaryConfirmationsBanner({
  onReview,
}: { onReview: () => void }) {
  const payments = useSalaryStore((s) => s.payments)
  const hydrate = useSalaryStore((s) => s.hydrate)

  // Canonical hydration (free re-fire — once-per-session guard inside the
  // store keeps this cheap on every dashboard render).
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const recent = useMemo(
    () => payments.filter(
      (p) => p.status === 'RECORDED' && Date.now() - new Date(p.paidOn).getTime() <= RECENT_WINDOW_MS,
    ),
    [payments],
  )

  if (recent.length === 0) return null

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onReview}
      className="w-full mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-3 text-left hover:bg-emerald-500/[0.12] transition-colors"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <BadgeCheck className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
          {recent.length} salary payment{recent.length === 1 ? '' : 's'} recorded by the school
        </p>
        <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70 mt-0.5 truncate">
          {recent.map((p) => `${moneyMy(p.amount)} · ${periodLabel(p.month)} · ${fmtDay(p.paidOn)}`).join(' · ')}
        </p>
      </div>
      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
        Review <ArrowUpRight className="h-3.5 w-3.5" />
      </span>
    </motion.button>
  )
}
