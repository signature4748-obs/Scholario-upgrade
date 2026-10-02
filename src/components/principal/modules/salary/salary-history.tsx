'use client'

/**
 * SalaryHistorySection — the payroll event trail, compact.
 *
 * PHASE 8B: the honest trail is derived from the CANONICAL payment rows
 * only — a row's creation is its "recorded" event, a VOIDED row's last
 * update is its "voided" event. No client-local audit log exists (the
 * server's ActivityLog owns the security trail); nothing is invented.
 */

import { useMemo, useState } from 'react'
import { History } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useSalaryStore, salaryEventsOf } from '@/lib/store/salary-store'
import { CompactEmpty } from './salary-shared'
import { EventRow } from './salary-overview'

type Filter = 'all' | 'payments'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'payments', label: 'Recorded' },
]

export function SalaryHistorySection() {
  const payments = useSalaryStore((s) => s.payments)
  const teacherNames = useSalaryStore((s) => s.teacherNames)
  const [filter, setFilter] = useState<Filter>('all')

  const events = useMemo(() => salaryEventsOf(payments, teacherNames), [payments, teacherNames])

  const filtered = useMemo(() => {
    if (filter === 'all') return events
    return events.filter((e) => e.kind === 'payment.recorded')
  }, [events, filter])

  return (
    <div className="space-y-3">
      {/* Filter row — the "History" tab already establishes context, so
          no page heading; filters lead directly. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                filter === f.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <CompactEmpty icon={<History className="h-3.5 w-3.5" />}>No payroll events yet</CompactEmpty>
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto salary-scroll">
            <div className="divide-y divide-border">
              {filtered.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">{filtered.length} events · derived from the canonical payment ledger</p>
    </div>
  )
}
