'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AlertSeverity = 'critical' | 'high' | 'info' | 'low'

export interface LiveAlert {
  id: string
  severity: AlertSeverity
  title: string
  desc: string
  time: string
  color: string
  navKey: string
  snoozed?: boolean
  snoozedUntil?: number // epoch ms
  isNew?: boolean // marks recently added alerts for pulse animation
}

export type SeverityFilter = 'all' | AlertSeverity

export interface ActivityEvent {
  hour: string // e.g. "8 AM"
  resolved: number
  snoozed: number
  new: number
}

interface LiveAlertState {
  alerts: LiveAlert[]
  dismissed: LiveAlert[]
  snoozed: LiveAlert[]
  /** QA-FIX-A: alertId → epoch ms when its snooze ends. Canonical snooze
   * clock — read by `unsnoozeExpired` so expired snoozes auto-return. */
  snoozedUntil: Record<string, number>
  severityFilter: SeverityFilter
  lastAddedId: string | null
  activityLog: ActivityEvent[]
  autoAlertsEnabled: boolean
  resolve: (id: string) => void
  resolveAll: () => void
  snooze: (id: string, minutes: number) => void
  snoozeAll: (minutes: number) => void
  /** Snooze the given alerts for a real duration in milliseconds. */
  snoozeAlerts: (ids: string[], durationMs: number) => void
  /** Return expired snoozes to the active list (compute-on-read sweeper). */
  unsnoozeExpired: (now?: number) => number
  restore: () => void
  unsnooze: (id: string) => void
  addAlert: (alert: LiveAlert) => void
  clearNewFlag: (id: string) => void
  toggleAutoAlerts: () => void
  reset: () => void
  setSeverityFilter: (filter: SeverityFilter) => void
  filteredAlerts: () => LiveAlert[]
  activeCount: () => number
}

// PHASE 7 — REAL DATA CONTRACT: the fabricated seed universe is
// RETIRED. Alerts start EMPTY: the live list is driven by REAL events
// only (the LiveFeeAlert rows from the dues store; the platform event
// stream). The "simulate new alert" demo feature (fabricated alert
// pool) is likewise retired — no UI may fabricate alert content.
const initialAlerts: LiveAlert[] = []
const initialActivityLog: ActivityEvent[] = []


/** PHASE 7 — empty-safe activity bump: rows only exist for THIS
 * session's real actions (no fabricated hour grid). */
function bumpLogEntry(
  log: ActivityEvent[],
  field: 'resolved' | 'snoozed' | 'new',
  count: number,
): ActivityEvent[] {
  if (log.length === 0) {
    return [{ hour: 'This session', resolved: 0, snoozed: 0, new: 0, [field]: count }]
  }
  const nowIdx = log.length - 1
  const next = [...log]
  next[nowIdx] = { ...next[nowIdx]!, [field]: (next[nowIdx]![field] ?? 0) + count }
  return next
}

export const useLiveAlerts = create<LiveAlertState>()(
  persist(
    (set, get) => ({
      alerts: initialAlerts,
      dismissed: [],
      snoozed: [],
      snoozedUntil: {},
      severityFilter: 'all',
      lastAddedId: null,
      activityLog: initialActivityLog,
      autoAlertsEnabled: false,
      // Helper to bump the "Now" hour's activity count
      bumpActivity: (field: 'resolved' | 'snoozed' | 'new', count = 1) => {
        set({ activityLog: bumpLogEntry(get().activityLog, field, count) })
      },
      resolve: (id) => {
        const state = get()
        const alert = state.alerts.find((a) => a.id === id)
        if (!alert) return
        const log = bumpLogEntry(state.activityLog, 'resolved', 1)
        set({
          alerts: state.alerts.filter((a) => a.id !== id),
          dismissed: [...state.dismissed, alert],
          activityLog: log,
        })
      },
      resolveAll: () => {
        const state = get()
        if (state.alerts.length === 0) return
        const count = state.alerts.length
        const log = bumpLogEntry(state.activityLog, 'resolved', count)
        set({
          alerts: [],
          dismissed: [...state.dismissed, ...state.alerts],
          activityLog: log,
        })
      },
      // QA-FIX-A: single real-duration snooze path. Minutes-based legacy
      // actions below delegate here with minutes × 60 000 ms.
      snoozeAlerts: (ids, durationMs) => {
        const state = get()
        const idSet = new Set(ids)
        const moving = state.alerts.filter((a) => idSet.has(a.id))
        if (moving.length === 0) return
        const until = Date.now() + durationMs
        const snoozedUntil = { ...state.snoozedUntil }
        for (const a of moving) snoozedUntil[a.id] = until
        const log = bumpLogEntry(state.activityLog, 'snoozed', moving.length)
        set({
          alerts: state.alerts.filter((a) => !idSet.has(a.id)),
          snoozed: [...state.snoozed, ...moving.map((a) => ({ ...a, snoozed: true, snoozedUntil: until }))],
          snoozedUntil,
          activityLog: log,
        })
      },
      snooze: (id, minutes) => {
        get().snoozeAlerts([id], minutes * 60_000)
      },
      snoozeAll: (minutes) => {
        get().snoozeAlerts(get().alerts.map((a) => a.id), minutes * 60_000)
      },
      // Auto-unsnooze: moves snoozed alerts whose time has passed back to
      // the active list. Called on mount + a 30s interval by the panel so
      // snoozes are honoured in real time (compute-on-read semantics).
      unsnoozeExpired: (now) => {
        const t = now ?? Date.now()
        const state = get()
        if (state.snoozed.length === 0) return 0
        const expired = state.snoozed.filter((a) => !a.snoozedUntil || a.snoozedUntil <= t)
        if (expired.length === 0) return 0
        const expiredIds = new Set(expired.map((a) => a.id))
        const snoozedUntil = { ...state.snoozedUntil }
        for (const id of expiredIds) delete snoozedUntil[id]
        set({
          snoozed: state.snoozed.filter((a) => !expiredIds.has(a.id)),
          alerts: [...state.alerts, ...expired.map((a) => ({ ...a, snoozed: false, snoozedUntil: undefined }))],
          snoozedUntil,
        })
        return expired.length
      },
      unsnooze: (id) => {
        const state = get()
        const alert = state.snoozed.find((a) => a.id === id)
        if (!alert) return
        const snoozedUntil = { ...state.snoozedUntil }
        delete snoozedUntil[id]
        set({
          snoozed: state.snoozed.filter((a) => a.id !== id),
          alerts: [...state.alerts, { ...alert, snoozed: false, snoozedUntil: undefined }],
          snoozedUntil,
        })
      },
      restore: () => {
        const state = get()
        if (state.dismissed.length === 0) return
        set({
          alerts: [...state.alerts, ...state.dismissed],
          dismissed: [],
        })
      },
      addAlert: (alert) => {
        const state = get()
        const log = bumpLogEntry(state.activityLog, 'new', 1)
        set({
          alerts: [alert, ...state.alerts],
          lastAddedId: alert.id,
          activityLog: log,
        })
      },
      clearNewFlag: (id) => {
        const state = get()
        set({
          alerts: state.alerts.map((a) => a.id === id ? { ...a, isNew: false } : a),
        })
      },
      toggleAutoAlerts: () => set((state) => ({ autoAlertsEnabled: !state.autoAlertsEnabled })),
      reset: () => set({ alerts: initialAlerts, dismissed: [], snoozed: [], snoozedUntil: {}, severityFilter: 'all', lastAddedId: null, activityLog: initialActivityLog, autoAlertsEnabled: false }),
      setSeverityFilter: (filter) => set({ severityFilter: filter }),
      filteredAlerts: () => {
        const state = get()
        if (state.severityFilter === 'all') return state.alerts
        return state.alerts.filter((a) => a.severity === state.severityFilter)
      },
      activeCount: () => get().alerts.length,
    }),
    {
      name: 'scholario-live-alerts',
      // v2 (PHASE 7) — purge the retired fabricated seed universe from
      // persisted browsers: alerts/activityLog start empty on upgrade.
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          const state = persisted as { alerts?: unknown[]; activityLog?: unknown[] } | undefined
          return {
            ...state,
            alerts: [],
            dismissed: [],
            snoozed: [],
            snoozedUntil: {},
            activityLog: [],
          }
        }
        return persisted
      },
      // Only persist the data arrays, not the filter, functions, or transient flags
      partialize: (state) => ({
        alerts: state.alerts.map((a) => ({ ...a, isNew: false })),
        dismissed: state.dismissed,
        snoozed: state.snoozed,
        snoozedUntil: state.snoozedUntil,
        activityLog: state.activityLog,
      }),
    }
  )
)
