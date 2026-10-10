'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAdmissionStore } from '@/lib/store/admission-store'
import { resetRosterSyncGuard, syncStudentsFromServer } from '@/lib/store/students-store'
import { toast } from 'sonner'

import { buildIssuanceArtifacts, type ServerFeeStatement } from './issuance/letter-data'
import { IssuanceHeader } from './issuance/IssuanceHeader'
import { IdentifiersMatrix } from './issuance/IdentifiersMatrix'
import { IssuanceTabs, type IssuanceTabKey } from './issuance/IssuanceTabs'
import { LetterTab } from './issuance/LetterTab'
import { FeeReceiptTab } from './issuance/FeeReceiptTab'
import { CredentialsTab } from './issuance/CredentialsTab'
import { WelcomeLetterTab } from './issuance/WelcomeLetterTab'
import { DispatchesTab } from './issuance/DispatchesTab'
import { EnrollStudentDialog } from './issuance/EnrollStudentDialog'
import {
  getServerApplication,
  fetchServerQuote,
  getServerFeeSnapshot,
} from '../lib/server-admissions-client'

interface IssuanceWorkspaceProps {
  appId: string
  onBack: () => void
  onCompleted: () => void
}

/**
 * Issuance workspace.
 *
 * FEE-ADMISSIONS MVP: for server-linked applications the official fee
 * statement is fetched from the server — the PERSISTED immutable
 * AdmissionFeeSnapshot once enrolled (GET fee-snapshot / the enrol
 * result), or the live server quote as a clearly-marked provisional
 * preview while still APPROVED (the definitive amounts are issued
 * atomically at enrolment). The legacy local fee pipeline only runs
 * for applications with no server link.
 */
export function IssuanceWorkspace({
  appId,
  onBack,
  onCompleted,
}: IssuanceWorkspaceProps) {
  const store = useAdmissionStore()
  const app = store.applications.find((a) => a.id === appId)

  const [activeTab, setActiveTab] = useState<IssuanceTabKey>('letter')
  // PHASE 7-H — real enrollment: "Complete & Enrol" opens the enroll
  // dialog (POST /api/students). The workspace only leaves the issuance
  // view after the SERVER has confirmed the enrollment.
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrolled, setEnrolled] = useState(false)

  // ── Server fee statement state (server-linked applications) ────────
  const [serverFees, setServerFees] = useState<ServerFeeStatement | null>(null)
  const [serverFeesLoading, setServerFeesLoading] = useState(false)
  const [serverFeesError, setServerFeesError] = useState<string | null>(null)

  const serverLinked = !!app?.serverApplicationId

  useEffect(() => {
    if (!app?.serverApplicationId) {
      setServerFees(null)
      setServerFeesError(null)
      return
    }
    // Already-stamped locally (the enrol dialog persisted the snapshot
    // right after the atomic enrolment) — use it directly.
    if (app.serverFeeSnapshot) {
      setServerFees({
        kind: 'snapshot',
        lineItems: app.serverFeeSnapshot.lineItems,
        discountName: app.serverFeeSnapshot.discountName,
        discountAmount: app.serverFeeSnapshot.discountAmount,
        totalAmount: app.serverFeeSnapshot.totalAmount,
        academicYear: app.serverFeeSnapshot.academicYear,
        issuedAt: app.serverFeeSnapshot.issuedAt,
      })
      setServerFeesError(null)
      return
    }
    // Not yet stamped → fetch from the server.
    let cancelled = false
    setServerFeesLoading(true)
    setServerFeesError(null)
    ;(async () => {
      try {
        const detail = await getServerApplication(app.serverApplicationId!)
        if (cancelled) return
        if (detail.feeSnapshot) {
          // Persisted snapshot exists (e.g. enrolled in another session).
          const stmt: ServerFeeStatement = {
            kind: 'snapshot',
            lineItems: detail.feeSnapshot.lineItems ?? [],
            discountName: detail.feeSnapshot.discountName ?? null,
            discountAmount: detail.feeSnapshot.discountAmount ?? 0,
            totalAmount: detail.feeSnapshot.totalAmount ?? 0,
            academicYear: detail.feeSnapshot.academicYear,
            structureVersion: detail.feeSnapshot.structureVersion ?? null,
            issuedAt: detail.feeSnapshot.issuedAt,
          }
          useAdmissionStore.getState().attachServerFeeSnapshot(app.id, {
            totalAmount: stmt.totalAmount,
            discountAmount: stmt.discountAmount,
            discountName: stmt.discountName,
            academicYear: stmt.academicYear,
            lineItems: stmt.lineItems,
            issuedAt: stmt.issuedAt,
          })
          setServerFees(stmt)
          return
        }
        if (detail.application.classId) {
          // APPROVED, not yet enrolled → provisional server quote.
          const quote = await fetchServerQuote(
            detail.application.classId,
            detail.application.payload.feeSelections,
          )
          if (cancelled) return
          setServerFees({
            kind: 'quote',
            lineItems: quote.quote.lineItems,
            discountName: quote.quote.discount?.name ?? null,
            discountAmount: quote.quote.totals.discount,
            totalAmount: quote.quote.totals.net,
            academicYear: quote.academicYear,
            structureVersion: quote.structureVersion,
          })
        } else {
          // No class allocation on the application — the enrolment
          // dialog will require one; no fee statement can be quoted.
          setServerFees(null)
        }
      } catch (err) {
        if (cancelled) return
        // FEE_CONFIGURATION_REQUIRED / SESSION_NOT_SET / network — the
        // official amounts are unavailable; fail closed (never fall back
        // to client-side amounts for a server-linked application).
        setServerFees(null)
        setServerFeesError(err instanceof Error ? err.message : 'The fee statement could not be loaded.')
      } finally {
        if (!cancelled) setServerFeesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [app?.id, app?.serverApplicationId, app?.serverFeeSnapshot, app?.status])

  if (!app) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Application record not found.</p>
        <Button onClick={onBack}>Back to Dashboard</Button>
      </div>
    )
  }

  const formData = app.formData
  const isCompleted = app.status === 'Completed'
  const artifacts = buildIssuanceArtifacts(app, serverFees)

  const handleCompleteAndEnroll = () => {
    setEnrolled(false)
    setEnrollOpen(true)
  }

  // Fired ONCE by the dialog, only after the server confirms the create.
  // The local record is marked Completed WITH the server student id +
  // admission number, and the roster re-syncs from the server (the fake
  // localStorage roster insertion is gone).
  const handleEnrolled = ({
    studentId,
    admissionNo,
  }: {
    studentId: string
    admissionNo: string
  }) => {
    setEnrolled(true)
    store.completeAdmission(app.id, {
      studentId,
      admissionNo,
      rollNo: artifacts.rollNo,
      regNo: artifacts.regNo,
    })

    resetRosterSyncGuard()
    void syncStudentsFromServer().then((ok) => {
      if (!ok) {
        toast.error('Roster could not be refreshed', {
          description:
            'The student was enrolled on the server — reload the page to see the updated roster.',
        })
      }
    })

    // Refresh the authoritative snapshot view for a server enrolment
    // (the dialog already stamped the local record; this reconciles the
    // statement state for the now-Completed application).
    if (app.serverApplicationId) {
      void getServerFeeSnapshot(app.serverApplicationId)
        .then((snap) => {
          useAdmissionStore.getState().attachServerFeeSnapshot(app.id, {
            totalAmount: snap.totalAmount,
            discountAmount: snap.discountAmount,
            discountName: snap.discountName,
            academicYear: snap.academicYear,
            lineItems: snap.lineItems,
            issuedAt: snap.issuedAt,
          })
          setServerFees({
            kind: 'snapshot',
            lineItems: snap.lineItems,
            discountName: snap.discountName,
            discountAmount: snap.discountAmount,
            totalAmount: snap.totalAmount,
            academicYear: snap.academicYear,
            issuedAt: snap.issuedAt,
          })
        })
        .catch(() => undefined)
    }
  }

  const handleEnrollDialogClose = (open: boolean) => {
    setEnrollOpen(open)
    // Leaving the dialog after a successful enrollment returns to the
    // applications dashboard (the record now shows as Enrolled there).
    if (!open && enrolled) {
      setEnrolled(false)
      onCompleted()
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <IssuanceHeader
        app={app}
        isCompleted={isCompleted}
        onBack={onBack}
        onCompleteAndEnroll={handleCompleteAndEnroll}
      />

      {/* Server fee statement status (server-linked applications) */}
      {serverLinked && (
        <div className="space-y-2">
          {serverFeesLoading && (
            <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading the server fee statement…
            </div>
          )}
          {serverFees?.kind === 'snapshot' && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950 dark:text-emerald-300">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                Official amounts come from the server&apos;s immutable fee snapshot (structure
                {serverFees.structureVersion ? ` v${serverFees.structureVersion}` : ''}
                {serverFees.academicYear ? ` · ${serverFees.academicYear}` : ''}) — later fee-structure
                edits never change issued documents.
              </p>
            </div>
          )}
          {serverFees?.kind === 'quote' && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                Provisional amounts from the currently published structure — the definitive fee
                snapshot is issued atomically when you enrol this student.
              </p>
            </div>
          )}
          {serverFeesError && !serverFeesLoading && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 break-words">{serverFeesError}</p>
            </div>
          )}
        </div>
      )}

      {/* Identifiers Card Matrix */}
      <IdentifiersMatrix app={app} artifacts={artifacts} />

      {/* Tabs Navigation for Issuance Artifacts */}
      <IssuanceTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab 1: Embedded Official Admission Letter */}
      {activeTab === 'letter' && (
        <LetterTab artifacts={artifacts} onBack={onBack} />
      )}

      {/* Tab 2: Fee Receipt */}
      {activeTab === 'receipt' && (
        <FeeReceiptTab app={app} artifacts={artifacts} serverFees={artifacts.serverFees} />
      )}

      {/* Tab 3: Credentials */}
      {activeTab === 'credentials' && (
        <CredentialsTab
          artifacts={artifacts}
          guardianEmail={formData.fatherEmail || formData.motherEmail || null}
          studentId={isCompleted ? app.studentId : null}
        />
      )}

      {/* Tab 4: Welcome Letter */}
      {activeTab === 'welcome' && (
        <WelcomeLetterTab app={app} />
      )}

      {/* Tab 5: Multi-channel Dispatches */}
      {activeTab === 'dispatches' && (
        <DispatchesTab app={app} />
      )}

      {/* REAL server enrollment (POST /api/students) — replaces the fake
          local roster insertion that used to run on "Complete & Enrol". */}
      <EnrollStudentDialog
        open={enrollOpen}
        onOpenChange={handleEnrollDialogClose}
        app={app}
        onEnrolled={handleEnrolled}
      />
    </div>
  )
}
