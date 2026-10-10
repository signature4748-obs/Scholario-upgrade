'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useAdmissionStore,
  type SectionKey,
} from '@/lib/store/admission-store'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { toast } from 'sonner'

import { serverDecide } from '../lib/server-admissions-client'
import { getSectionsConfig } from './verification/sections-config'
import { countVerified } from './verification/section-status'
import { VerificationHeader } from './verification/VerificationHeader'
import { VerificationSectionCard } from './verification/VerificationSectionCard'
import { OfficerNotes, AuditHistory } from './verification/OfficerNotes'
import { CorrectionDialog } from './verification/CorrectionDialog'
import { RejectionDialog } from './verification/RejectionDialog'

interface VerificationWorkspaceProps {
  appId: string
  onBack: () => void
  onApprovedNext: (appId: string) => void
  onOpenWizardToEdit: (appId: string) => void
}

/**
 * Verification (Review) workspace — a VERIFICATION WORKSPACE, not a full
 * application reproduction (spec §11–§24):
 *
 *   primary   → compact header + section statuses + decision actions
 *   secondary → full section details (View expands a section)
 *   tertiary  → audit history (collapsed by default)
 *
 * Every status is derived from the application's actual data and the
 * school's admission configuration — nothing is hardcoded.
 */
export function VerificationWorkspace({
  appId,
  onBack,
  onApprovedNext,
  onOpenWizardToEdit,
}: VerificationWorkspaceProps) {
  const store = useAdmissionStore()
  const admissionSettings = useSchoolSettingsStore((s) => s.admissionSettings)
  const featureFlags = admissionSettings.featureFlags
  const documentPolicy = admissionSettings.documentPolicy
  const app = store.applications.find((a) => a.id === appId)

  const [overallRemarks, setOverallRemarks] = useState(app?.generalRemarks || '')
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false)
  // Server-workflow decision state (server-linked applications only).
  const [serverBusy, setServerBusy] = useState(false)
  const startReviewLatch = useRef<string | null>(null)

  const serverLinked = !!app?.serverApplicationId

  // ── Server workflow: opening the review workspace IS the principal's
  //    start-review action (SUBMITTED → UNDER_REVIEW). Fires ONCE per
  //    application (latch), only for a first-review submission — after a
  //    request-correction the server stays SUBMITTED until the office
  //    amends and RESUBMITS (review restarts there, not here).
  useEffect(() => {
    if (!app?.serverApplicationId) return
    if (app.serverStatus !== 'SUBMITTED' || app.status !== 'Submitted') return
    if (startReviewLatch.current === app.id) return
    startReviewLatch.current = app.id
    const serverId = app.serverApplicationId
    setServerBusy(true)
    ;(async () => {
      try {
        const res = await serverDecide(serverId, 'start-review')
        useAdmissionStore.getState().applyServerStatus(app.id, res.status)
      } catch (err) {
        toast.error('Review could not be started on the server', {
          description: err instanceof Error ? err.message : 'Please retry in a moment.',
        })
      } finally {
        setServerBusy(false)
      }
    })()
  }, [app?.id, app?.serverApplicationId, app?.serverStatus, app?.status])

  /** Server-first decision helper: the server transition must SUCCEED
   * before the local mirror runs (fail-closed — an INVALID_STATE / flag
   * rejection never mutates the local record). */
  const decideOnServer = async (
    action: 'approve' | 'request-correction' | 'reject',
    payload: { notes?: string; reason?: string },
  ): Promise<boolean> => {
    if (!app?.serverApplicationId) return true
    setServerBusy(true)
    try {
      const res = await serverDecide(app.serverApplicationId, action, payload)
      useAdmissionStore.getState().applyServerStatus(app.id, res.status)
      return true
    } catch (err) {
      toast.error('The decision was not recorded', {
        description: err instanceof Error ? err.message : 'The school server rejected this action.',
      })
      return false
    } finally {
      setServerBusy(false)
    }
  }

  if (!app) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Application record not found.</p>
        <Button onClick={onBack}>Back to Dashboard</Button>
      </div>
    )
  }

  // Section list derives from the school's ACTUAL admission configuration.
  const visibleSections = getSectionsConfig({
    enableMedical: featureFlags.enableMedical,
    enablePreviousSchool: featureFlags.enablePreviousSchool,
    enableStudentPhoto: featureFlags.enableStudentPhoto,
  }, documentPolicy)

  const { verified, total, incomplete, flagged } = countVerified(visibleSections, app, documentPolicy)

  const handleFlag = (
    key: SectionKey,
    status: 'Needs Review' | 'Incomplete',
    issue: string
  ) => {
    store.updateSectionReview(app.id, key, { status, remarks: issue })
    toast.success(`${status} — issue attached to the section`)
  }

  const handleClearFlag = (key: SectionKey) => {
    store.updateSectionReview(app.id, key, { status: 'Complete', remarks: '' })
    toast.success('Section flag cleared')
  }

  const handleApprove = async () => {
    // Real ERP guard: data-incomplete sections block approval. Officer
    // "Needs Review" flags are advisory — the officer decides.
    if (incomplete > 0) {
      toast.error('Resolve incomplete sections before approving.', {
        description: 'Required data (documents, photo) is missing.',
      })
      return
    }
    if (!(await decideOnServer('approve', { notes: overallRemarks || undefined }))) return
    store.approveApplication(app.id, overallRemarks)
    toast.success('Application approved — opening issuance workspace…')
    onApprovedNext(app.id)
  }

  const handleConfirmCorrection = async () => {
    if (!overallRemarks.trim()) {
      toast.error('Please enter overall correction instructions for the applicant.')
      return
    }
    if (!(await decideOnServer('request-correction', { notes: overallRemarks }))) return
    store.requestCorrection(app.id, overallRemarks)
    toast.success('Application returned for correction.')
    setCorrectionDialogOpen(false)
    onBack()
  }

  const handleConfirmReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Please specify a rejection reason for compliance auditing.')
      return
    }
    if (
      !(await decideOnServer('reject', {
        reason: rejectionReason,
        notes: `Retention: ${admissionSettings.rejectionRetentionDays || 60} days`,
      }))
    )
      return
    store.rejectApplication(
      app.id,
      rejectionReason,
      admissionSettings.rejectionRetentionDays || 60
    )
    toast.success('Application moved to the Rejected queue.')
    setRejectDialogOpen(false)
    onBack()
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <Button variant="outline" size="sm" onClick={onBack} className="h-8 gap-1.5 text-xs w-fit">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Dashboard
      </Button>

      <VerificationHeader
        app={app}
        verified={verified}
        total={total}
        flagged={flagged}
        onOpenWizardToEdit={onOpenWizardToEdit}
        onNeedCorrection={() => setCorrectionDialogOpen(true)}
        onReject={() => setRejectDialogOpen(true)}
        onApprove={handleApprove}
      />

      {/* Server-workflow in-flight indicator (decision / start-review) */}
      {serverLinked && serverBusy && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Recording the decision on the school server…
        </div>
      )}
      {serverLinked && !serverBusy && app.serverStatus && app.status !== 'Draft' && (
        <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950 dark:text-emerald-300">
          Server-issued workflow · application state {app.serverStatus.replace(/_/g, ' ')} is authoritative on the
          school server; decisions record there first.
        </div>
      )}

      {/* Compact verification rows */}
      <div className="space-y-2.5">
        {visibleSections.map(({ key, title, icon }) => (
          <VerificationSectionCard
            key={key}
            app={app}
            sectionKey={key}
            title={title}
            icon={icon}
            documentPolicy={documentPolicy}
            onFlag={handleFlag}
            onClearFlag={handleClearFlag}
          />
        ))}
      </div>

      {/* ONE overall officer-notes field, near the decision area */}
      <OfficerNotes value={overallRemarks} onChange={setOverallRemarks} />

      {/* Audit history — collapsed by default */}
      <AuditHistory app={app} />

      <CorrectionDialog
        open={correctionDialogOpen}
        onOpenChange={setCorrectionDialogOpen}
        overallRemarks={overallRemarks}
        onOverallRemarksChange={setOverallRemarks}
        onConfirm={handleConfirmCorrection}
      />

      <RejectionDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        rejectionReason={rejectionReason}
        onRejectionReasonChange={setRejectionReason}
        onConfirm={handleConfirmReject}
      />
    </div>
  )
}
