'use client'

/**
 * Wizard Step 9 — Documents.
 *
 * Document policy (lib/documents.ts) is SCHOOL-CONFIGURABLE (Admission
 * Settings → Documents): each canonical document is Required, Optional,
 * or Not Collected. Not-collected documents do not appear here at all.
 * Group headers carry the live counts ("Required 1/1 complete", "Optional
 * 0/5 collected") — no explanatory paragraphs.
 *
 * PHASE 7-H (admissions honesty): DIGITAL UPLOADS ARE NOT BUILT. The
 * former upload path targeted an admissions upload route that was
 * never built (phantom endpoint) and showed a fake success toast.
 * It is removed. The checklist below is the office's paper-collection
 * record: "Mark Received" notes that a physical copy is on file, which
 * is exactly what the required-document gate keys on. Server-backed
 * document uploads are coming soon.
 */
import { useMemo } from 'react'
import { FileText, ShieldCheck, CheckCircle2, Info } from 'lucide-react'
import { toast } from 'sonner'
import type { DocStatus } from '../types'
import { useAdmissionFeatureFlags, useAdmissionDocumentPolicy } from '../lib/admission-utils'
import {
  getRequiredDocuments,
  getOptionalDocuments,
  getDocumentCompletion,
  type AdmissionDocumentDef,
} from '../lib/documents'
import type { FormData } from '../constants'
import { StepHeader } from './StepShared'
import { DocumentCard } from './DocumentCard'

export function DocumentsStep({
  data,
  set,
  flags,
}: {
  data: FormData
  set: <K extends keyof FormData>(k: K, v: FormData[K]) => void
  flags: ReturnType<typeof useAdmissionFeatureFlags>
}) {
  const verificationEnabled = !!flags.enableDocumentVerification
  const policy = useAdmissionDocumentPolicy()
  const requiredDocs = useMemo(() => getRequiredDocuments(policy), [policy])
  const optionalDocs = useMemo(() => getOptionalDocuments(policy), [policy])

  const completion = useMemo(
    () => getDocumentCompletion(data.docStatuses, policy),
    [data.docStatuses, policy]
  )

  const handleUpdateDoc = (key: string, patch: Partial<DocStatus>) => {
    const existing = data.docStatuses[key] || { status: 'pending' as const }
    set('docStatuses', {
      ...data.docStatuses,
      [key]: { ...existing, ...patch },
    })
  }

  // The office physically collected the document — record exactly that
  // (no fileId, no invented filename, no invented OCR score). The
  // verification workspace can still review it as demo state.
  const handleMarkReceived = (key: string) => {
    handleUpdateDoc(key, {
      status: 'received',
      fileName: undefined,
      ocrConfidence: undefined,
      verificationStatus: verificationEnabled ? 'pending' : undefined,
      verifiedBy: undefined,
      verificationTime: undefined,
      rejectionReason: undefined,
    })
    const doc = [...requiredDocs, ...optionalDocs].find((d) => d.key === key)
    toast.success(`${doc?.name} marked received`, {
      description: verificationEnabled
        ? 'Awaiting verifier review'
        : doc?.required
          ? 'Required document collected'
          : undefined,
    })
  }

  const handleVerify = (key: string) => {
    const timeStr = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    handleUpdateDoc(key, {
      verificationStatus: 'verified',
      verifiedBy: 'Principal',
      verificationTime: timeStr,
      rejectionReason: undefined,
    })
    toast.success('Document verified', {
      description: `Verified by Principal · ${timeStr}`,
    })
  }

  const handleRemove = (key: string) => {
    handleUpdateDoc(key, {
      status: 'pending',
      fileName: undefined,
      ocrConfidence: undefined,
      verificationStatus: undefined,
      verifiedBy: undefined,
      verificationTime: undefined,
      rejectionReason: undefined,
    })
    const doc = [...requiredDocs, ...optionalDocs].find(
      (d) => d.key === key
    )
    if (doc?.required) {
      toast.warning(`${doc.name} removed`, {
        description: 'This application cannot be submitted without it.',
      })
    } else {
      toast.info(`${doc?.name} removed`)
    }
  }

  const renderDoc = (doc: AdmissionDocumentDef) => {
    const st = data.docStatuses[doc.key] || { status: 'pending' as const }
    return (
      <DocumentCard
        key={doc.key}
        doc={doc}
        st={st}
        verificationEnabled={verificationEnabled}
        onMarkReceived={handleMarkReceived}
        onVerify={handleVerify}
        onRemove={handleRemove}
      />
    )
  }

  return (
    <div className="space-y-5">
      <StepHeader
        title="Documents"
        icon={<FileText className="h-5 w-5" />}
        right={
          <span
            className={
              completion.complete
                ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold'
                : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold'
            }
          >
            {completion.complete ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" /> Required pending
              </>
            )}
          </span>
        }
      />

      {/* Honest state — no server upload exists (the old upload button
          hit a route that was never built). */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Document uploads are coming soon. Until then, collect physical copies at the office and
          mark them received below — this checklist records exactly what has been collected, and
          the required documents gate the submission on it. Nothing is uploaded or stored on a
          server from this step.
        </p>
      </div>

      {/* REQUIRED group — emphasised, live count in the header */}
      {requiredDocs.length > 0 && (
        <section aria-label="Required documents">
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Required
            </h3>
            <span
              className={
                'text-[11px] font-semibold tabular-nums ' +
                (completion.complete
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400')
              }
            >
              {completion.requiredCompleted} / {completion.requiredTotal} complete
              {completion.complete ? ' ✓' : ''}
            </span>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3 space-y-2.5">
            {requiredDocs.map(renderDoc)}
          </div>
        </section>
      )}

      {/* OPTIONAL group — neutral, live count in the header */}
      {optionalDocs.length > 0 && (
        <section aria-label="Optional documents">
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Optional
            </h3>
            <span className="text-[11px] text-muted-foreground font-semibold tabular-nums">
              {completion.optionalReceived} / {completion.optionalTotal} collected
            </span>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2.5">
            {optionalDocs.map(renderDoc)}
          </div>
        </section>
      )}
    </div>
  )
}
