'use client'

/**
 * AdmissionModule — top-level entry for the Admissions module.
 *
 * Split out from the original 2316-line admission.tsx monolith (Task ID: 21).
 * This file holds the orchestration state and view-switching only; every
 * wizard step, dialog, and presentational section now lives in its own file
 * under ./admission/.
 *
 * Behaviour is preserved byte-for-byte — only the file layout has changed.
 */
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { StatusBadge, PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

import { AdmissionApplicationFormModal } from './AdmissionApplicationFormModal'
import { type FeeDataState } from './FeeStructureStep'
import { AdmissionsDashboard } from './admission/components/AdmissionsDashboard'
import { VerificationWorkspace } from './admission/components/VerificationWorkspace'
import { IssuanceWorkspace } from './admission/components/IssuanceWorkspace'
import { AdmissionSettingsPage } from './admission/components/AdmissionSettingsPage'
import { FormWizard } from './admission/components/FormWizard'
import { OcrFormUploadModal } from './admission/components/OcrFormUploadModal'
import { useSeatCapacity } from './admission/lib/admission-utils'
import { useAdmissionWizard } from './admission/lib/use-admission-wizard'
import { initialData } from './admission/constants'

export function AdmissionModule() {
  const seatCapacity = useSeatCapacity()
  const wizard = useAdmissionWizard()
  const {
    flags,
    viewMode,
    setViewMode,
    step,
    setStep,
    data,
    setData,
    set,
    handleToggleSameAddress,
    next,
    back,
    visibleSteps,
    currentVisibleIndex,
    stepperScrollRef,
    postSubmitDup,
    handleSubmit,
    handleContinueAnyway,
    handleCancelSubmission,
    admissionStore,
    admissionsConfig,
    submitting,
    beginEdit,
  } = wizard

  const [activeWorkspace, setActiveWorkspace] = useState<'none' | 'verification' | 'issuance'>('none')
  const [selectedWorkspaceAppId, setSelectedWorkspaceAppId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false)
  const [isBlankFormModalOpen, setIsBlankFormModalOpen] = useState(false)

  return (
    <PageTransition className="space-y-6">
      {/* Wizard view: show back button + step indicator */}
      {viewMode === 'form' && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewMode('list')}
            className="text-xs gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
          </Button>
          <StatusBadge
            status={
              admissionsConfig.serverMode
                ? `Step ${currentVisibleIndex + 1} of ${visibleSteps.length} · Server-issued workflow`
                : `Step ${currentVisibleIndex + 1} of ${visibleSteps.length}`
            }
            variant="primary"
            dot
          />
        </div>
      )}

      {/* ====================================================================== */}
      {/* ENTERPRISE ADMISSION WORKSPACES & DASHBOARD                           */}
      {/* ====================================================================== */}
      {isSettingsOpen && (
        <AdmissionSettingsPage onBack={() => setIsSettingsOpen(false)} />
      )}

      {!isSettingsOpen && activeWorkspace === 'verification' && selectedWorkspaceAppId && (
        <VerificationWorkspace
          appId={selectedWorkspaceAppId}
          onBack={() => setActiveWorkspace('none')}
          onApprovedNext={(appId) => {
            setSelectedWorkspaceAppId(appId)
            setActiveWorkspace('issuance')
          }}
          onOpenWizardToEdit={(appId) => {
            // Load the flagged application's actual data into the wizard —
            // same load path as the dashboard's Resume/Edit (otherwise the
            // wizard would open with stale data from a previous session).
            beginEdit(appId)
            const appToEdit = admissionStore.applications.find((a) => a.id === appId)
            if (appToEdit) {
              setData({
                ...initialData,
                ...appToEdit.formData,
                feeState: appToEdit.formData.feeState || initialData.feeState,
              })
            }
            setActiveWorkspace('none')
            setViewMode('form')
            setStep(1)
          }}
        />
      )}

      {!isSettingsOpen && activeWorkspace === 'issuance' && selectedWorkspaceAppId && (
        <IssuanceWorkspace
          appId={selectedWorkspaceAppId}
          onBack={() => setActiveWorkspace('none')}
          onCompleted={() => setActiveWorkspace('none')}
        />
      )}

      {!isSettingsOpen && activeWorkspace === 'none' && viewMode === 'list' && (
        <AdmissionsDashboard
          onOpenWizard={(appId) => {
            // Track WHICH application this wizard session edits (null = new).
            beginEdit(appId ?? null)
            if (appId) {
              const appToEdit = admissionStore.applications.find((a) => a.id === appId)
              if (appToEdit) setData({ ...initialData, ...appToEdit.formData, feeState: appToEdit.formData.feeState || initialData.feeState })
            } else {
              setData(initialData)
            }
            setStep(1)
            setViewMode('form')
          }}
          onOpenVerificationWorkspace={(appId) => {
            setSelectedWorkspaceAppId(appId)
            setActiveWorkspace('verification')
          }}
          onOpenIssuanceWorkspace={(appId) => {
            setSelectedWorkspaceAppId(appId)
            setActiveWorkspace('issuance')
          }}
          onOpenSettingsModal={() => setIsSettingsOpen(true)}
          onOpenOcrModal={() => setIsOcrModalOpen(true)}
          onOpenBlankFormModal={() => setIsBlankFormModalOpen(true)}
        />
      )}

      {/* ====================================================================== */}
      {/* 2. FORM WIZARD STAGE (MULTI-STEP ADMISSION FORM)                      */}
      {/* ====================================================================== */}
      {viewMode === 'form' && (
        <FormWizard
          data={data}
          set={set}
          step={step}
          setStep={setStep}
          visibleSteps={visibleSteps}
          currentVisibleIndex={currentVisibleIndex}
          stepperScrollRef={stepperScrollRef}
          postSubmitDup={postSubmitDup}
          handleToggleSameAddress={handleToggleSameAddress}
          onCancelSubmission={handleCancelSubmission}
          onContinueAnyway={handleContinueAnyway}
          onBack={back}
          onNext={next}
          onSubmit={handleSubmit}
          flags={flags}
          seatCapacity={seatCapacity}
          initialFeeState={initialData.feeState as FeeDataState}
          serverMode={admissionsConfig.serverMode}
          submitting={submitting}
        />
      )}

      {/* ADMISSION APPLICATION FORM MODAL (2-Page A4 Sheet Printable) */}
      <AdmissionApplicationFormModal
        open={isBlankFormModalOpen}
        onClose={() => setIsBlankFormModalOpen(false)}
      />

      {/* SCAN / IMPORT APPLICATION MODAL (real on-device OCR) */}
      <OcrFormUploadModal
        open={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        onManualEntry={() => {
          setIsOcrModalOpen(false)
          beginEdit(null)
          setViewMode('form')
          setStep(1)
        }}
        onApplyData={(extracted, attachment) => {
          setData((prev) => ({
            ...prev,
            ...extracted,
            scannedAttachment: attachment,
          }))
          // A scanned import is always a NEW application draft.
          beginEdit(null)
          setIsOcrModalOpen(false)
          setViewMode('form')
          setStep(1)
          toast.success('Form fields populated from scan', {
            description: 'Please verify each section — the draft is not submitted until you review and submit it.',
          })
        }}
      />

      {/* DYNAMIC FIELD CONFIGURATION SETTINGS MODAL */}
      {/* (Replaced by AdmissionSettingsPage — now a full-page sub-route) */}
    </PageTransition>
  )
}
