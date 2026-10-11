'use client'

/**
 * Form Wizard view — the multi-step admission form.
 * Extracted from the original admission.tsx monolith (Task ID: 21).
 *
 * Renders the stepper header, post-submit duplicate modal, scanned-attachment
 * badge, the active step's content, and the bottom navigation controls.
 */
import { RefObject } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GlassCard } from '@/components/shared/ui'
import type { FeeDataState } from '../../FeeStructureStep'
import { FeeStructureStep } from '../../FeeStructureStep'
import { ServerFeeStep } from './ServerFeeStep'
import { PhotoStep as PhotoStepEditor } from './PhotoStep'
import { StepperHeader, type WizardStep } from './StepperHeader'
import { PostSubmitDuplicateModal } from './PostSubmitDuplicateModal'
import { ScannedAttachmentBadge } from './ScannedAttachmentBadge'
import { NavigationControls } from './NavigationControls'
import { PersonalStep } from './PersonalStep'
import { ParentsStep } from './ParentsStep'
import { AddressStep } from './AddressStep'
import { PreviousSchoolStep } from './PreviousSchoolStep'
import { ClassStep } from './ClassStep'
import { TransportStep } from './TransportStep'
import { DocumentsStep } from './DocumentsStep'
import { ReviewStep } from './ReviewStep'
import type { FormData } from '../constants'
import type { DuplicateMatch } from '../lib/admission-utils'

export interface FormWizardProps {
  data: FormData
  set: <K extends keyof FormData>(key: K, value: FormData[K]) => void
  step: number
  setStep: (step: number) => void
  visibleSteps: WizardStep[]
  currentVisibleIndex: number
  stepperScrollRef: RefObject<HTMLDivElement | null>
  postSubmitDup: DuplicateMatch | null
  handleToggleSameAddress: (checked: boolean) => void
  onCancelSubmission: () => void
  onContinueAnyway: () => void
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
  flags: ReturnType<typeof import('../lib/admission-utils').useAdmissionFeatureFlags>
  seatCapacity: ReturnType<typeof import('../lib/admission-utils').useSeatCapacity>
  initialFeeState: FeeDataState
  /** FEE-ADMISSIONS MVP — render the server quote fee step instead of the
   * local school-settings one while the flag is ON for the school. */
  serverMode?: boolean
  /** Server submission in flight (disables submit — TQA-14). */
  submitting?: boolean
}

export function FormWizard({
  data,
  set,
  step,
  setStep,
  visibleSteps,
  currentVisibleIndex,
  stepperScrollRef,
  postSubmitDup,
  handleToggleSameAddress,
  onCancelSubmission,
  onContinueAnyway,
  onBack,
  onNext,
  onSubmit,
  flags,
  seatCapacity,
  initialFeeState,
  serverMode = false,
  submitting = false,
}: FormWizardProps) {
  return (
    <>
      <StepperHeader
        visibleSteps={visibleSteps}
        step={step}
        currentVisibleIndex={currentVisibleIndex}
        stepperScrollRef={stepperScrollRef}
        onSelect={setStep}
      />

      <PostSubmitDuplicateModal
        postSubmitDup={postSubmitDup}
        onCancel={onCancelSubmission}
        onContinueAnyway={onContinueAnyway}
      />

      {/* OCR Scanned Form Attachment Badge if loaded */}
      {data.scannedAttachment && <ScannedAttachmentBadge attachment={data.scannedAttachment} />}

      {/* Step Container */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25 }}
        >
          <GlassCard className="p-4 sm:p-6">
            {step === 1 && <PersonalStep data={data} set={set} flags={flags} />}
            {step === 2 && <ParentsStep data={data} set={set} flags={flags} />}
            {step === 3 && <AddressStep data={data} set={set} onToggleSameAddress={handleToggleSameAddress} />}
            {step === 4 && <ClassStep data={data} set={set} flags={flags} seatCapacity={seatCapacity} />}
            {step === 5 && <PreviousSchoolStep data={data} set={set} admissionType={data.admissionType} onSkip={onNext} />}
            {step === 6 && <TransportStep data={data} set={set} flags={flags} />}
            {step === 7 &&
              (serverMode ? (
                <ServerFeeStep
                  className={data.className}
                  section={data.section}
                  classId={data.serverClassId}
                  selections={data.serverFeeSelections}
                  onClassIdResolved={(id) => set('serverClassId', id ?? '')}
                  onChangeSelections={(sel) => set('serverFeeSelections', sel)}
                />
              ) : (
                <FeeStructureStep
                  className={data.className}
                  feeState={data.feeState || initialFeeState}
                  onChangeFeeState={(newState) => set('feeState', newState)}
                  flags={flags}
                />
              ))}
            {step === 8 && (
              <PhotoStepEditor
                photoDataUrl={data.photoDataUrl ?? null}
                onChange={(url) => {
                  set('photoDataUrl', url)
                  set('photoUploaded', !!url)
                }}
              />
            )}
            {step === 9 && <DocumentsStep data={data} set={set} flags={flags} />}
            {step === 10 && <ReviewStep data={data} set={set} flags={flags} onJumpTo={setStep} />}
          </GlassCard>
        </motion.div>
      </AnimatePresence>

      <NavigationControls
        visibleSteps={visibleSteps}
        step={step}
        currentVisibleIndex={currentVisibleIndex}
        onBack={onBack}
        onNext={onNext}
        onSubmit={onSubmit}
        submitDisabled={submitting}
        submitLabel={submitting ? 'Submitting…' : 'Submit Application'}
      />
    </>
  )
}
