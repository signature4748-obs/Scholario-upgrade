'use client'

import { useState, useEffect } from 'react'
import { useLiveAlerts } from '@/lib/store/live-alerts-store'
import { useDuesSummaryStore, selectLiveDues } from '@/lib/store/dues-summary-store'
import { toast } from 'sonner'
import {
  alertIcons, fallbackAlertIcon, type LiveAlertWithIcon,
} from './data'
import { LiveAlertsToolbar } from './live-alerts-toolbar'
import { LiveAlertsContent } from './live-alerts-content'
import { LiveFeeAlert } from './live-fee-alert'
import { Panel } from '../shared/panel'

export interface LiveAlertsProps {
  onNavigate?: (module: string) => void
}

/**
 * LiveAlerts — compact "Principal Attention" panel.
 *
 * Redesigned (DASH-1) from a giant red container with:
 *   - h-44 blur blob, h-11 gradient Megaphone hero, ping/pulse badges
 *   - 7 toolbar buttons including 3 demo features (Simulate, Auto, Reset)
 *   - 4-button stats strip (redundant with the list itself)
 *   - "Today's Alert Activity" fake bar chart
 *   - storytelling subtitle
 *
 * Into a flat `Panel` with:
 *   - "Principal Attention" title + small "N active · M critical" meta
 *   - 3 real actions (Resolve All, Snooze All, More) using the shared
 *     `LiveAlertsToolbar` (More hides Simulate/Auto/Reset/Restore)
 *   - the alert list itself (kept) wired so clicking a row navigates to
 *     the alert's `navKey` module via `onNavigate`
 *
 * The Zustand store (`live-alerts-store`) is preserved unchanged — only the
 * visual presentation was rebuilt.
 */
export function LiveAlerts({ onNavigate }: LiveAlertsProps) {
  const {
    alerts: storeAlerts, dismissed, snoozed, severityFilter,
    autoAlertsEnabled, toggleAutoAlerts, resolve, resolveAll, restore, reset,
    snooze, snoozeAll, unsnooze, unsnoozeExpired, addAlert, clearNewFlag, setSeverityFilter,
  } = useLiveAlerts()

  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null)
  const [snoozeAllMenuOpen, setSnoozeAllMenuOpen] = useState(false)

  // QA-FIX-A: real time-based snooze — sweep expired snoozes on mount and
  // every 30s so alerts auto-return to the active list when their snooze
  // window passes (the store's snoozedUntil map is the clock).
  useEffect(() => {
    unsnoozeExpired()
    const interval = setInterval(() => { unsnoozeExpired() }, 30_000)
    return () => clearInterval(interval)
  }, [unsnoozeExpired])

  // Hydrate alert objects with icon JSX (store keeps them serializable)
  const alerts: LiveAlertWithIcon[] = storeAlerts.map((a) => ({
    ...a,
    icon: alertIcons[a.id] ?? fallbackAlertIcon,
  }))

  const handleResolve = (id: string) => {
    const alert = alerts.find((a) => a.id === id)
    if (!alert) return
    resolve(id)
    toast.success('Alert resolved', { description: alert.title })
  }

  const handleResolveAll = () => {
    if (alerts.length === 0) return
    const count = alerts.length
    resolveAll()
    toast.success(`${count} alerts resolved`, { description: 'All active alerts have been dismissed' })
  }

  const handleSnooze = (id: string, minutes: number) => {
    const alert = alerts.find((a) => a.id === id)
    if (!alert) return
    snooze(id, minutes)
    setSnoozeMenuFor(null)
    const durLabel = minutes < 60 ? `${minutes} min` : minutes < 240 ? `${minutes / 60} hour` : `${minutes / 60} hours`
    toast.info(`Snoozed for ${durLabel}`, { description: alert.title })
  }

  const handleSnoozeAll = (minutes: number) => {
    if (alerts.length === 0) return
    const count = alerts.length
    snoozeAll(minutes)
    setSnoozeAllMenuOpen(false)
    const durLabel = minutes < 60 ? `${minutes} min` : minutes < 240 ? `${minutes / 60} hour` : `${minutes / 60} hours`
    toast.info(`${count} alerts snoozed for ${durLabel}`, { description: 'All active alerts have been snoozed' })
  }

  const handleUnsnooze = (id: string) => {
    const alert = snoozed.find((a) => a.id === id)
    if (!alert) return
    unsnooze(id)
    toast.success('Alert restored', { description: alert.title })
  }

  const handleRestore = () => {
    if (dismissed.length === 0) return
    restore()
    toast.info('All alerts restored', { description: `${dismissed.length} alert${dismissed.length > 1 ? 's' : ''} brought back` })
  }

  const handleAlertClick = (alert: LiveAlertWithIcon) => {
    if (onNavigate) {
      onNavigate(alert.navKey)
    } else {
      toast.info('Navigating…', { description: `Opening ${alert.navKey} module for: ${alert.title}` })
    }
  }

  const handleResetAll = () => {
    reset()
    setSeverityFilter('all')
    toast.info('Alerts reset', { description: 'All alerts restored to initial state' })
  }

  // PHASE 7 — the simulated auto-alert generator is retired (fabrication);
  // real alerts arrive via the dues store + the platform event stream.

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length
  const activeCount = alerts.length

  // Round-7 — the pinned LIVE fee-dues alert (server truth, distinct from
  // the simulated rows) and its "1 live" hint in the subtitle.
  const liveDues = useDuesSummaryStore(selectLiveDues)
  const showLiveFee = !!liveDues && liveDues.defaulterCount > 0

  return (
    <Panel
      title="Principal Attention"
      action={
        <LiveAlertsToolbar
          alertsLength={alerts.length}
          dismissedCount={dismissed.length}
          snoozedCount={snoozed.length}
          snoozeAllMenuOpen={snoozeAllMenuOpen}
          setSnoozeAllMenuOpen={setSnoozeAllMenuOpen}
          onResolveAll={handleResolveAll}
          onSnoozeAll={handleSnoozeAll}
          onResetAll={handleResetAll}
          onRestore={handleRestore}
        />
      }
      subtitle={
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${activeCount > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} aria-hidden="true" />
            <span>{activeCount} active</span>
          </span>
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
              <span>{criticalCount} critical</span>
            </span>
          )}
          {showLiveFee && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              <span>1 live</span>
            </span>
          )}
        </span>
      }
    >
      {/* Round-7 — pinned LIVE server alert (real dues) above the
          simulated operational rows. */}
      <LiveFeeAlert onNavigate={onNavigate} />
      <LiveAlertsContent
        alerts={alerts}
        dismissed={dismissed}
        snoozed={snoozed}
        severityFilter={severityFilter}
        snoozeMenuFor={snoozeMenuFor}
        setSnoozeMenuFor={setSnoozeMenuFor}
        setSeverityFilter={setSeverityFilter}
        onResolve={handleResolve}
        onSnooze={handleSnooze}
        onUnsnooze={handleUnsnooze}
        onRestore={handleRestore}
        onAlertClick={handleAlertClick}
      />
    </Panel>
  )
}
