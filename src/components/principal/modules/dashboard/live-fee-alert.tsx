'use client'

/**
 * LiveFeeAlert — the pinned SERVER-TRUTH dues row at the top of
 * "Principal Attention" (Round-7).
 *
 * Every other alert in the panel is a simulated operational event from the
 * live-alerts store; this one is REAL: the school's actual defaulter
 * position from GET /api/fees/defaulters?summary=1 (dues-summary-store).
 * It renders only when there is something to act on (dues exist), is
 * visually distinct (rose/amber gradient stripe + LIVE pill — never
 * confused with the simulated rows), and one click deep-links into the
 * Outreach tab where the exact same numbers are worked.
 */

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { IndianRupee, Send } from 'lucide-react'
import { formatINR } from '@/lib/format'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { useFocusStore } from '@/lib/store/focus-store'
import { cn } from '@/lib/utils'

export function LiveFeeAlert({ onNavigate }: { onNavigate?: (module: string) => void }) {
  const dues = useDuesSummaryStore(selectLiveDues)
  const ensure = useDuesSummaryStore((s) => s.ensure)

  // Sync on mount — idempotent (the dashboard KPI shares the same fetch).
  useEffect(() => { void ensure() }, [ensure])

  if (!dues || dues.defaulterCount === 0) return null

  const urgent = dues.overdueCount > 0
  const accent = urgent
    ? { stripe: 'from-rose-500 to-amber-500', border: 'border-rose-500/30 hover:border-rose-500/50', chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' }
    : { stripe: 'from-amber-500 to-amber-400', border: 'border-amber-500/30 hover:border-amber-500/50', chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' }

  const openOutreach = () => {
    useFocusStore.getState().setFocus({
      type: 'fee-outreach',
      id: 'fee-outreach',
      title: 'Fee defaulter outreach',
      moduleKey: 'fees',
    })
    if (onNavigate) onNavigate('fees')
  }

  const detail = [
    `${dues.overdueCount} past due`,
    `${dues.remindedThisWeek} reminded this week`,
    dues.top ? `largest ${dues.top.name} · ${formatINR(dues.top.outstanding, true)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      onClick={openOutreach}
      aria-label={`Fee dues alert: ${dues.defaulterCount} students owe ${formatINR(dues.totalOutstanding)}. Open the outreach workspace.`}
      className={cn(
        'group relative mb-2 flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-gradient-to-r px-3.5 py-3 text-left transition-all hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30',
        urgent
          ? 'border-rose-500/30 hover:border-rose-500/50 from-rose-500/[0.07] via-rose-500/[0.04] to-transparent'
          : 'border-amber-500/30 hover:border-amber-500/50 from-amber-500/[0.07] via-amber-500/[0.04] to-transparent',
      )}
    >
      <span className={cn('absolute bottom-0 left-0 top-0 w-1 bg-gradient-to-b', accent.stripe)} aria-hidden />
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent.chip)}>
        <IndianRupee className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-bold text-foreground">
            {dues.defaulterCount} {dues.defaulterCount === 1 ? 'student owes' : 'students owe'}{' '}
            {formatINR(dues.totalOutstanding, true)}
          </span>
          <span
            role="status"
            aria-live="polite"
            title="Live server value — synced from the school database"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            live
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
      <span className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition-colors',
        urgent
          ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 group-hover:bg-rose-500/20'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 group-hover:bg-amber-500/20',
      )}>
        <Send className="h-3 w-3" aria-hidden />
        <span className="hidden sm:inline">Remind</span>
      </span>
    </motion.button>
  )
}
