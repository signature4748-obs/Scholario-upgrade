'use client'

/**
 * Wizard Step 9 — Documents.
 *
 * Document policy (lib/documents.ts) is SCHOOL-CONFIGURABLE (Admission
 * Settings → Documents): each canonical document is Required, Optional,
 * or Not Collected. Not-collected documents do not appear here at all.
 * Group headers carry the live counts ("Required 1/1 complete", "Optional
 * 0/5 uploaded") — no explanatory paragraphs.
 *
 * Uploads are REAL: the file is client-validated (type + ≤5 MB), sent to
 * /api/admissions/upload where the server re-validates by magic bytes and
 * stores it, and the returned fileId is kept on the application record so
 * the verification workspace can View / Download the actual document.
 */
import { useMemo, useRef, useState } from 'react'
import { FileText, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import type { DocStatus } from '../types'
import { useAdmissionFeatureFlags, useAdmissionDocumentPolicy } from '../lib/admission-utils'
import {
  getRequiredDocuments,
  getOptionalDocuments,
  getDocumentCompletion,
  validateDocumentFile,
  uploadAdmissionDocument,
  deleteAdmissionDocumentFile,
  DOC_ACCEPT,
  type AdmissionDocumentDef,
} from '../lib/documents'
import type { FormData } from '../constants'
import { StepHeader } from './StepShared'
import { DocumentCard } from './DocumentCard'

const nowTimeStr = () =>
  new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeUploadKey, setActiveUploadKey] = useState<string | null>(null)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

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

  const handleUploadClick = (key: string) => {
    setActiveUploadKey(key)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const key = activeUploadKey
    // A closed dialog with no selection changes nothing — never invent a file.
    if (!file || !key) {
      setActiveUploadKey(null)
      if (e.target) e.target.value = ''
      return
    }
    const doc = [...requiredDocs, ...optionalDocs].find((d) => d.key === key)

    // Client-side policy check (the server re-checks on arrival).
    const validationError = validateDocumentFile(file)
    if (validationError) {
      toast.error(validationError)
      setActiveUploadKey(null)
      e.target.value = ''
      return
    }

    setUploadingKey(key)
    try {
      const uploaded = await uploadAdmissionDocument(file)
      const oldFileId = data.docStatuses[key]?.fileId
      handleUpdateDoc(key, {
        status: 'uploaded',
        fileName: uploaded.fileName,
        fileId: uploaded.fileId,
        fileSize: uploaded.size,
        // Honest upload — no invented OCR score. OCR confidence is only
        // ever set by the real OCR scan flow.
        ocrConfidence: undefined,
        verificationStatus: verificationEnabled ? 'pending' : undefined,
        verifiedBy: undefined,
        verificationTime: undefined,
        rejectionReason: undefined,
      })
      // Replacing an existing upload — remove the previous stored file.
      if (oldFileId && oldFileId !== uploaded.fileId) {
        deleteAdmissionDocumentFile(oldFileId)
      }
      toast.success(`${doc?.name} uploaded`, {
        description: verificationEnabled
          ? 'Awaiting verifier review'
          : doc?.required
            ? 'Required document received'
            : undefined,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploadingKey(null)
      setActiveUploadKey(null)
      e.target.value = ''
    }
  }

  const handleVerify = (key: string) => {
    const timeStr = nowTimeStr()
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
    const stored = data.docStatuses[key]
    // Remove the stored file along with the record.
    if (stored?.fileId) deleteAdmissionDocumentFile(stored.fileId)
    handleUpdateDoc(key, {
      status: 'pending',
      fileName: undefined,
      fileId: undefined,
      fileSize: undefined,
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
        uploading={uploadingKey === doc.key}
        onUploadClick={handleUploadClick}
        onVerify={handleVerify}
        onRemove={handleRemove}
      />
    )
  }

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

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
              {completion.optionalUploaded} / {completion.optionalTotal} uploaded
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
