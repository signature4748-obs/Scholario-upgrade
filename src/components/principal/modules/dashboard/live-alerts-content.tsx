'use client'

import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  severityFilterColors, severityFilters, type LiveAlertWithIcon,
  type SeverityFilterValue,
} from './data'
import { LiveAlertsList } from './live-alerts-list'

// Shared store alert shape used for snoozed items (the store keeps these
// serializable — no JSX — so we use a lightweight type here).
interface SerializableAlert {
  id: string
  title: string
  severity: 'critical' | 'high' | 'info' | 'low'
}

export interface LiveAlertsContentProps {
  alerts: LiveAlertWithIcon[]
  dismissed: SerializableAlert[]
  snoozed: SerializableAlert[]
  severityFilter: SeverityFilterValue
  snoozeMenuFor: string | null
  setSnoozeMenuFor: (id: string | null) => void
  setSeverityFilter: (filter: SeverityFilterValue) => void
  onResolve: (id: string) => void
  onSnooze: (id: string, minutes: number) => void
  onUnsnooze: (id: string) => void
  onRestore: () => void
  onAlertClick: (alert: LiveAlertWithIcon) => void
}

/**
 * LiveAlertsContent — the body of the Principal Attention panel.
 *
 * Redesigned (DASH-1):
 *   - Removed the 4-button stats strip (redundant with the header meta)
 *   - Removed the "Today's Alert Activity" mini bar chart (fake-data viz)
 *   - Severity filter pills kept (matches Academics filter pill pattern)
 *   - Snoozed alerts flattened into the same list (no dashed sub-box)
 *   - Alert list itself is delegated to `live-alerts-list.tsx`
 */
export function LiveAlertsContent({
  alerts, dismissed, snoozed, severityFilter, snoozeMenuFor,
  setSnoozeMenuFor, setSeverityFilter, onResolve, onSnooze, onUnsnooze,
  onRestore, onAlertClick,
}: LiveAlertsContentProps) {
  const filtered = severityFilter === 'all' ? alerts : alerts.filter((a) => a.severity === severityFilter)

  return (
    <>
      {/* Severity filter pills — compact Academics-style row */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {severityFilters.map((filter) => {
            const count = filter === 'all' ? alerts.length : alerts.filter((a) => a.severity === filter).length
            if (filter !== 'all' && count === 0) return null
            const isActive = severityFilter === filter
            return (
              <button
                key={filter}
                onClick={() => setSeverityFilter(filter)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  isActive
                    ? severityFilterColors[filter]
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                )}
              >
                {filter}
                {count > 0 && <span className="opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Snoozed alerts — compact flattened row above the active list */}
      {snoozed.length > 0 && (
        <div className="mb-2 rounded-md border border-border bg-muted/20 px-2.5 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3" />
              Snoozed ({snoozed.length})
            </div>
          </div>
          <div className="space-y-0.5">
            {snoozed.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs rounded-sm px-1.5 py-1 hover:bg-muted/40 transition-colors">
                <span className="font-medium truncate opacity-70">{s.title}</span>
                <button
                  onClick={() => onUnsnooze(s.id)}
                  className="shrink-0 ml-2 text-[10px] font-semibold text-primary hover:underline"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <LiveAlertsList
        alerts={alerts}
        filtered={filtered}
        severityFilter={severityFilter}
        dismissedCount={dismissed.length}
        snoozeMenuFor={snoozeMenuFor}
        setSnoozeMenuFor={setSnoozeMenuFor}
        onResolve={onResolve}
        onSnooze={onSnooze}
        onRestore={onRestore}
        onAlertClick={onAlertClick}
        onClearFilter={() => setSeverityFilter('all')}
      />

      {/* Restore dismissed alerts — quiet link under the list */}
      {dismissed.length > 0 && alerts.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 text-center"
        >
          <button onClick={onRestore} className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
            Restore {dismissed.length} dismissed alert{dismissed.length > 1 ? 's' : ''}
          </button>
        </motion.div>
      )}
    </>
  )
}
