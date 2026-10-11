'use client'

/**
 * useAdmissionWizard — central state + handlers for the admission form wizard.
 *
 * Extracted from the original admission.tsx monolith (Task ID: 21).
 * Holds wizard step state, the visible-steps computation, the field setter
 * (with permanent-address auto-sync), step navigation, post-submit duplicate
 * detection flow, and the auto-save-draft side effect.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { students } from '@/lib/mock/students'
import { toast } from 'sonner'
import { useAdmissionStore } from '@/lib/store/admission-store'
import {
  useAdmissionFeatureFlags,
  useDuplicateDetectionConfig,
  useAdmissionDocumentPolicy,
  checkDuplicates,
  type DuplicateMatch,
} from './admission-utils'
import {
  STEPS,
  createBlankData,
  initialData,
  type FormData,
} from '../constants'
import { getDocumentCompletion, getCollectedDocuments } from './documents'
import { useAdmissionsConfig } from './use-admissions-config'
import {
  submitServerApplication,
  serverDecide,
  type QuoteSelections,
} from './server-admissions-client'
import type { FeeDataState } from '../../FeeStructureStep'

export function useAdmissionWizard() {
  const admissionStore = useAdmissionStore()
  const flags = useAdmissionFeatureFlags()
  const dupConfig = useDuplicateDetectionConfig()
  const documentPolicy = useAdmissionDocumentPolicy()
  const admissionsConfig = useAdmissionsConfig()

  const [viewMode, setViewMode] = useState<'list' | 'form'>('list')
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(initialData)

  // The application this wizard session is editing (Resume on a draft, or
  // Edit on a returned-for-correction application). Null = brand-new
  // application. Kept in a ref too so the auto-save effect reads the latest
  // value without re-subscribing.
  const [editingAppId, setEditingAppId] = useState<string | null>(null)
  const editingAppIdRef = useRef<string | null>(null)
  const beginEdit = (appId: string | null) => {
    editingAppIdRef.current = appId
    setEditingAppId(appId)
  }

  // Stepper auto-scroll ref — effect wired after currentVisibleIndex is computed
  const stepperScrollRef = useRef<HTMLDivElement>(null)

  // Compute visible steps — auto-skip Previous School for pre-primary classes
  const visibleSteps = useMemo(() => {
    return STEPS.filter((s) => {
      // Personal (1), Parents (2), Address (3), Applying For (4) — always
      if (s.id <= 4) return true
      // Previous School (5) — auto-skip for Nursery/LKG/UKG/Class 1
      if (s.id === 5) {
        const cls = (data.className || '').toLowerCase()
        const skipClasses = flags.previousSchoolSkipClasses.map((c) => c.toLowerCase())
        const isPrePrimary = skipClasses.some((sc) => cls.includes(sc))
        if (isPrePrimary) return false
        return flags.enablePreviousSchool
      }
      // Transport (6) — conditional on transport/hostel facility
      if (s.id === 6) return flags.enableTransport || flags.enableHostel
      // Fee (7), Review (10) — always
      if (s.id === 7 || s.id === 10) return true
      // Photo (8) — conditional on enableStudentPhoto
      if (s.id === 8) return flags.enableStudentPhoto
      // Documents (9) — only when the school collects at least one
      // document (policy has required OR optional entries)
      if (s.id === 9) return getCollectedDocuments(documentPolicy).length > 0
      return true
    })
  }, [data.className, flags, documentPolicy])

  // Map visible steps to a sequential index for the stepper UI
  const stepIndex = visibleSteps.findIndex((s) => s.id === step)
  const currentVisibleIndex = stepIndex === -1 ? 0 : stepIndex

  // Stepper auto-scroll: keep current step centered in the horizontal nav
  useEffect(() => {
    const container = stepperScrollRef.current
    if (!container) return
    const currentBtn = container.querySelector(`[data-step-idx="${currentVisibleIndex}"]`) as HTMLElement | null
    if (currentBtn) {
      const scrollLeft = currentBtn.offsetLeft - container.offsetWidth / 2 + currentBtn.offsetWidth / 2
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' })
    }
  }, [currentVisibleIndex, step])

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setData((prev) => {
      const nextData = { ...prev, [key]: value }

      // Auto-synchronize Permanent Address when sameAsCurrentAddress is enabled
      if (nextData.sameAsCurrentAddress) {
        if (key === 'currentAddress') nextData.permAddress = value as string
        if (key === 'country') nextData.permCountry = value as string
        if (key === 'state') nextData.permState = value as string
        if (key === 'district') nextData.permDistrict = value as string
        if (key === 'city') nextData.permCity = value as string
        if (key === 'pincode') nextData.permPincode = value as string
      }

      return nextData
    })
  }

  const handleToggleSameAddress = (checked: boolean) => {
    setData((prev) => {
      if (checked) {
        return {
          ...prev,
          sameAsCurrentAddress: true,
          permAddress: prev.currentAddress,
          permCountry: prev.country,
          permState: prev.state,
          permDistrict: prev.district,
          permCity: prev.city,
          permPincode: prev.pincode,
        }
      }
      return { ...prev, sameAsCurrentAddress: false }
    })
  }

  // Navigate through visible steps only (skips conditional steps automatically)
  const next = () => {
    const curIdx = visibleSteps.findIndex((s) => s.id === step)
    if (curIdx < visibleSteps.length - 1) {
      setStep(visibleSteps[curIdx + 1].id)
    }
  }
  const back = () => {
    const curIdx = visibleSteps.findIndex((s) => s.id === step)
    if (curIdx > 0) {
      setStep(visibleSteps[curIdx - 1].id)
    }
  }

  // Duplicate detection runs ONLY on final submit (not while filling)
  const [postSubmitDup, setPostSubmitDup] = useState<DuplicateMatch | null>(null)
  const [pendingSubmitData, setPendingSubmitData] = useState<{ formData: Partial<FormData>; feeState: Partial<FeeDataState> } | null>(null)
  // Server-mode submission state: in-flight guard + the submission's
  // idempotency key (generated ONCE per submission session so a network
  // retry after a lost response replays the SAME key → the server
  // returns the existing application instead of a duplicate).
  const [submitting, setSubmitting] = useState(false)
  const clientRequestIdRef = useRef<string | null>(null)

  const finalizeSubmission = async (formDataPartial: Partial<FormData>, feeDataPartial: Partial<FeeDataState>) => {
    if (submitting) return
    // When editing an existing application (draft resume / correction
    // resubmission), the submission UPDATES that record in place — it keeps
    // its admission number, audit trail and identity. Only a brand-new
    // application gets a fresh record id.
    const appId =
      editingAppIdRef.current || `APP-${Date.now().toString().slice(-6)}`

    const serverMode = admissionsConfig.serverMode
    const existingRecord = admissionStore.applications.find((a) => a.id === appId)

    if (serverMode) {
      setSubmitting(true)
      try {
        if (existingRecord?.serverApplicationId) {
          // ── RESUBMIT after a request-correction: the server machine is
          // SUBMITTED (returned by the principal) and the corrected form
          // data re-fingerprints the payload (SUBMITTED → UNDER_REVIEW).
          await serverDecide(existingRecord.serverApplicationId, 'resubmit', {
            formData: formDataPartial as Record<string, unknown>,
          })
          const submittedId = admissionStore.createOrUpdateDraft(formDataPartial, feeDataPartial, appId)
          admissionStore.submitApplication(submittedId)
          admissionStore.applyServerStatus(submittedId, 'UNDER_REVIEW')
        } else {
          // ── NEW server application: submit with the idempotency key.
          // Same key + same payload (a retry after a lost response)
          // replays the existing application; a different payload with
          // the same key is rejected server-side (409) — never a silent
          // overwrite.
          if (!clientRequestIdRef.current) {
            clientRequestIdRef.current = crypto.randomUUID()
          }
          const feeSelections: QuoteSelections | undefined = formDataPartial.serverFeeSelections
          const res = await submitServerApplication({
            clientRequestId: clientRequestIdRef.current,
            formData: formDataPartial as Record<string, unknown>,
            ...(feeSelections && Object.keys(feeSelections).length ? { feeSelections } : {}),
            ...(formDataPartial.serverClassId ? { classId: formDataPartial.serverClassId } : {}),
            ...(formDataPartial.section ? { section: formDataPartial.section } : {}),
          })
          const submittedId = admissionStore.createOrUpdateDraft(formDataPartial, feeDataPartial, appId)
          admissionStore.submitApplication(submittedId)
          admissionStore.linkServerApplication(submittedId, {
            serverApplicationId: res.application.id,
            serverStatus: res.application.status,
            serverClassId: formDataPartial.serverClassId ?? null,
            ...(feeSelections ? { serverFeeSelections: feeSelections } : {}),
          })
          if (res.idempotentReplay) {
            toast.info('Submission replayed — the original application was returned unchanged.')
          }
        }
      } catch (err) {
        // Fail-closed: the server record is the authority for the new
        // workflow — when the submission fails, NO local record is
        // created (no half-linked state, no silent local-only fallback).
        toast.error('Application not submitted', {
          description:
            err instanceof Error ? err.message : 'The school server rejected the submission.',
        })
        setSubmitting(false)
        return
      }
      setSubmitting(false)
    } else {
      // Legacy client-only workflow — byte-for-byte unchanged.
      const submittedId = admissionStore.createOrUpdateDraft(formDataPartial, feeDataPartial, appId)
      admissionStore.submitApplication(submittedId)
    }

    toast.success('Application submitted', {
      description: `${data.firstName} ${data.lastName}'s application is now in the review queue.`,
    })

    setPostSubmitDup(null)
    setPendingSubmitData(null)
    clientRequestIdRef.current = null
    beginEdit(null)
    draftIdRef.current = null
    setData(createBlankData())
    setStep(1)
    setViewMode('list')
  }

  const handleSubmit = () => {
    if (submitting) return
    // Document completion gate: every document the school has marked
    // REQUIRED must be collected (marked received) before submission.
    // Optional documents never block; a school with no required
    // documents is never blocked (canonical policy — see lib/documents.ts).
    const docCompletion = getDocumentCompletion(data.docStatuses, documentPolicy)
    if (!docCompletion.complete) {
      toast.error('Required document missing', {
        description:
          docCompletion.missingRequired.length > 0
            ? `Collect and mark received ${docCompletion.missingRequired.join(', ')} before submitting — optional documents are not required.`
            : 'Collect all required documents before submitting.',
      })
      const docsStep = visibleSteps.find((s) => s.id === 9)
      if (docsStep) setStep(9)
      return
    }

    const formDataPartial: Partial<FormData> = { ...data }
    const feeDataPartial: Partial<FeeDataState> = data.feeState || {}

    // Check duplicates only at submit time. The application being edited
    // is excluded — a correction resubmission must never match itself.
    if (dupConfig.enabled) {
      const others = (admissionStore.applications || []).filter(
        (a) => a.id !== editingAppIdRef.current
      )
      const match = checkDuplicates(data, dupConfig, students as any, others)
      if (match && match.matchType !== 'none') {
        setPostSubmitDup(match)
        setPendingSubmitData({ formData: formDataPartial, feeState: feeDataPartial })
        return
      }
    }
    void finalizeSubmission(formDataPartial, feeDataPartial)
  }

  const handleContinueAnyway = () => {
    if (pendingSubmitData) {
      toast.success('Principal override logged', { description: 'Submission proceeding despite duplicate warning.' })
      void finalizeSubmission(pendingSubmitData.formData, pendingSubmitData.feeState)
    }
  }

  const handleCancelSubmission = () => {
    setPostSubmitDup(null)
    setPendingSubmitData(null)
    toast.info('Submission cancelled')
  }

  // Auto-save draft on browser close / tab switch — no Save Draft button needed.
  // If the principal exits midway, the application is silently saved as a Draft
  // and can be resumed later. Drafts do NOT appear in Pending Review.
  // FIX (fee-admissions E2E): the visibilitychange listener was never
  // removed in the cleanup — after the effect re-ran (every keystroke),
  // every STALE closure stayed subscribed, so a later tab-hide saved the
  // wizard's OLD data as a stray duplicate draft (observed live: a stale
  // draft got resumed instead of the returned-for-correction application
  // and produced a DUPLICATE server application). The cleanup now removes
  // BOTH listeners; each effect run owns exactly its own handlers.
  const draftIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewMode !== 'form') return
    // Only auto-save if the user has entered at least a name
    if (!data.firstName && !data.lastName) return

    const saveDraft = () => {
      if (!data.firstName && !data.lastName) return
      // Editing an existing application → auto-save targets THAT record
      // (never spawns a stray duplicate draft).
      const id = editingAppIdRef.current || draftIdRef.current || `DRAFT-${Date.now().toString().slice(-6)}`
      draftIdRef.current = id
      admissionStore.createOrUpdateDraft({ ...data }, data.feeState || {}, id)
    }

    const unloadHandler = () => saveDraft()
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') saveDraft()
    }
    window.addEventListener('beforeunload', unloadHandler)
    document.addEventListener('visibilitychange', visibilityHandler)
    return () => {
      window.removeEventListener('beforeunload', unloadHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
  }, [viewMode, data, admissionStore])

  return {
    flags,
    viewMode,
    setViewMode,
    step,
    setStep,
    data,
    setData,
    set,
    editingAppId,
    beginEdit,
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
  }
}
