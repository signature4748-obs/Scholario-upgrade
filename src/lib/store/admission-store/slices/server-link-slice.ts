import type { StateCreator } from 'zustand'
import type { AdmissionStatus, AdmissionStoreState } from '../types'

/**
 * FEE-ADMISSIONS MVP (Phase F) — the server-workflow LINK slice.
 *
 * The local admission store remains the UI source of truth, but when an
 * application carries a `serverApplicationId` the AUTHORITATIVE record
 * lives on the server (AdmissionApplication row). These actions only
 * ever run AFTER the corresponding server call succeeded
 * (server-first, fail-closed — see VerificationWorkspace /
 * EnrollStudentDialog / use-admission-wizard). They mirror the server
 * state onto the local record so the dashboards keep rendering.
 */

/** Map the server status vocabulary onto the local one. */
export function serverToLocalStatus(serverStatus: string): AdmissionStatus {
  switch (serverStatus) {
    case 'SUBMITTED':
      return 'Submitted'
    case 'UNDER_REVIEW':
      return 'Under Review'
    case 'APPROVED':
      return 'Approved'
    case 'ENROLLED':
      return 'Completed'
    case 'REJECTED':
      return 'Rejected'
    default:
      return 'Submitted'
  }
}

const stampAudit = (
  app: { auditTrail: { id: string; timestamp: string; action: string; actor: string; notes: string }[] },
  action: string,
  notes: string,
) => {
  const now = new Date()
  return [
    ...app.auditTrail,
    {
      id: `a-${now.getTime()}`,
      timestamp: `${now.toISOString().split('T')[0]} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      action,
      actor: 'School Server',
      notes,
    },
  ]
}

export interface ServerLinkInfo {
  serverApplicationId: string
  serverStatus?: string
  serverClassId?: string | null
  serverFeeSelections?: {
    optionalHeadIds?: string[]
    quantities?: Record<string, number>
    discountCode?: string
  }
}

export interface ServerFeeSnapshotPayload {
  totalAmount: number
  discountAmount: number
  discountName: string | null
  academicYear?: string
  lineItems: {
    headId: string
    name: string
    category: string
    kind: string
    quantity: number
    unitAmount: number
    amount: number
    discounted: boolean
    discountCode?: string
  }[]
  issuedAt?: string
}

export const createServerLinkSlice: StateCreator<
  AdmissionStoreState,
  [],
  [],
  Pick<
    AdmissionStoreState,
    'linkServerApplication' | 'applyServerStatus' | 'attachServerFeeSnapshot'
  >
> = (set, get) => ({
  /** Stamp the server link onto a freshly-submitted local application. */
  linkServerApplication: (appId, info) => {
    const state = get()
    set({
      applications: state.applications.map((app) =>
        app.id === appId
          ? {
              ...app,
              serverApplicationId: info.serverApplicationId,
              serverStatus: info.serverStatus ?? 'SUBMITTED',
              ...(info.serverClassId !== undefined ? { serverClassId: info.serverClassId } : {}),
              ...(info.serverFeeSelections ? { serverFeeSelections: info.serverFeeSelections } : {}),
            }
          : app
      ),
    })
  },

  /**
   * Mirror a server state change (decision / enrolment / resubmit)
   * onto the local record. Only call AFTER the server accepted the
   * transition. Keeps the local status vocabulary in sync and appends
   * a server-source audit entry.
   */
  applyServerStatus: (appId, serverStatus) => {
    const state = get()
    const local = serverToLocalStatus(serverStatus)
    set({
      applications: state.applications.map((app) =>
        app.id === appId
          ? {
              ...app,
              serverStatus,
              status: local,
              lastUpdatedDate: new Date().toISOString().split('T')[0],
              auditTrail: stampAudit(
                app,
                `Server: ${serverStatus.replace(/_/g, ' ')}`,
                `Server-issued workflow transitioned the application to ${serverStatus}.`,
              ),
            }
          : app
      ),
    })
  },

  /**
   * Persist the issued AdmissionFeeSnapshot onto the local record so
   * official documents (letter, receipt) render the IMMUTABLE
   * server-issued amounts — never a client recomputation.
   */
  attachServerFeeSnapshot: (appId, snapshot) => {
    const state = get()
    set({
      applications: state.applications.map((app) =>
        app.id === appId
          ? {
              ...app,
              serverFeeSnapshot: {
                totalAmount: snapshot.totalAmount,
                discountAmount: snapshot.discountAmount,
                discountName: snapshot.discountName,
                academicYear: snapshot.academicYear ?? app.academicSession,
                lineItems: snapshot.lineItems,
                issuedAt: snapshot.issuedAt ?? new Date().toISOString(),
              },
            }
          : app
      ),
    })
  },
})
