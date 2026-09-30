import type { StateCreator } from 'zustand'
import type { AuditLogItem, TeachersStoreState } from '../types'

// PHASE 7 (Task 7-a) — the fabricated INITIAL_AUDIT_LOGS (seed events
// about the retired seed faculty) are no longer imported: the log starts
// EMPTY and records only real actions taken in this store. The roster
// sync additionally prunes log entries whose target teacher no longer
// exists on the server.
export const createAuditSlice: StateCreator<
  TeachersStoreState,
  [],
  [],
  Pick<TeachersStoreState, 'auditLogs' | 'logAudit'>
> = (set) => ({
  auditLogs: [],

  logAudit: (log) => {
    const newLogItem: AuditLogItem = {
      ...log,
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    }
    set((state) => ({ auditLogs: [newLogItem, ...state.auditLogs] }))
  },
})
