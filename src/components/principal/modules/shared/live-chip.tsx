'use client'

/**
 * LiveChip — the established "server-truth is on screen" lineage badge.
 *
 * Used wherever a surface swaps a mock/ledger value for the live server
 * aggregation (dues KPIs, the Principal Attention fee alert): a tiny
 * emerald pill with a pulsing dot. It answers "is this number real?"
 * at a glance — and never renders next to a value that is not.
 */

import { cn } from '@/lib/utils'

export function LiveChip({
  label = 'live',
  className,
  title = 'Live server value — synced from the school database',
}: {
  label?: string
  className?: string
  title?: string
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      {label}
    </span>
  )
}
