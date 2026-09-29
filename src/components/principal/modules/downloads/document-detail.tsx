'use client'

/**
 * document-detail — slide-from-right detail drawer.
 *
 * THE PREVIEW FIX, Downloads side:
 *   · Resolves the document LIVE from the store by id (never a stale object).
 *   · Generated cert documents → renders the actual certificate /
 *     marksheet / ID card / fee receipt via the certificates renderers,
 *     with snapshot-first student/transaction resolution.
 *   · Static library documents (forms, templates, reports) → renders the
 *     real A4 institutional document (StaticDocPreview) — school
 *     letterhead, fields, tables, signatures. Never a bare logo.
 *
 * Every action is real:
 *   · Download → a genuine branded HTML document file (blob).
 *   · Print → opens a printable document window.
 *   · Share → Web Share API (clipboard fallback).
 *   · Favourite → persisted pin (star reflects state).
 *   · Regenerate → re-issues the generated document with a new number.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Download, Printer, X, FileText, Calendar, Hash, User, HardDrive,
  Tag, FolderTree, Share2, Star, RotateCcw, Info, CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer, DrawerContent, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import { toast } from 'sonner'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { useDownloadsStore, type DownloadDocument } from '@/lib/store/downloads-store'
import {
  useCertificatesStore, type DocumentTemplate, type GeneratedDocument,
} from '@/lib/store/certificates-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { DocIcon, FormatBadge, SourceBadge, CategoryPill } from './downloads-shared'
import { Avatar } from '@/components/shared/avatar'
import {
  resolvePreviewStudent, resolvePreviewTransaction, buildDocumentHTML,
} from '../certificates/cert-resolvers'
import type { MarksheetData } from '../certificates/previews'
import {
  CertificatePreview, MarksheetPreview, IDCardPreview, FeeReceiptPreview,
} from '../certificates/previews'
import { StaticDocPreview, buildStaticDocHTML } from './static-doc-preview'
import { useSchoolProfile } from '@/lib/school-profile'
import {
  downloadHTMLFile, openPrintWindow, shareText, safeFileName,
} from '@/lib/download-file'

interface DocumentDetailProps {
  /** Document id — resolved LIVE inside the drawer (never stale). */
  docId: string | null
  open: boolean
  onClose: () => void
}

export function DocumentDetail({ docId, open, onClose }: DocumentDetailProps) {
  const download = useDownloadsStore((s) => s.download)
  const toggleFavourite = useDownloadsStore((s) => s.toggleFavourite)
  const downloadsCount = useDownloadsStore((s) => s.downloadsCount)
  const favourites = useDownloadsStore((s) => s.favourites)
  const generateDocument = useCertificatesStore((s) => s.generateDocument)
  const certDocs = useCertificatesStore((s) => s.documents)
  const certTemplates = useCertificatesStore((s) => s.templates)
  const students = useStudentsStore((s) => s.students)
  const transactions = useFeeStore((s) => s.transactions)
  const school = useSchoolProfile()

  // Live resolution — re-resolves whenever the underlying stores change
  // (regenerated docs, status updates, deletions reflect instantly).
  const doc = useMemo(() => {
    if (!docId) return undefined
    return useDownloadsStore.getState().getDocumentById(docId)
  }, [docId, certDocs, downloadsCount, favourites])

  // ─── Cert bridge: resolve the underlying generated certificate doc ──
  const certDoc: GeneratedDocument | undefined =
    doc ? certDocs.find((c) => `doc-gen-${c.id}` === doc.id) : undefined
  const certTemplate: DocumentTemplate | undefined =
    certDoc ? certTemplates.find((t) => t.id === certDoc.templateId) : undefined
  // Snapshot-first resolution: live roster by id → by admission no → the
  // stored document snapshot. Seed + generated docs ALWAYS render.
  const certStudent = certDoc ? resolvePreviewStudent(certDoc, students) : undefined
  const certTxn = certDoc ? resolvePreviewTransaction(certDoc, transactions) : undefined
  const certMarksheet: MarksheetData | undefined =
    certDoc ? certDoc.data?.marksheet as MarksheetData | undefined : undefined

  const count = doc ? (downloadsCount[doc.id] ?? 0) : 0
  const isFavourite = doc ? !!favourites[doc.id] : false

  if (!doc) {
    return (
      <Drawer open={open} onOpenChange={(v) => { if (!v) onClose() }} direction="right">
        <DrawerContent className="sm:max-w-md w-full" aria-label="Document details">
          <div className="p-6 text-center text-xs text-muted-foreground">
            Document no longer available.
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  // ─── Real document HTML (download / print) ──────────────────────────
  function documentHTML(d: DownloadDocument): string | null {
    const cert = certDocs.find((c) => `doc-gen-${c.id}` === d.id)
    if (cert) return buildDocumentHTML(cert)
    if (d.content) return buildStaticDocHTML(d.content, school)
    return null
  }

  function handleDownload(d: DownloadDocument) {
    const html = documentHTML(d)
    if (!html) {
      toast.error('Document file unavailable', { description: d.name })
      return
    }
    const filename = download(d) // tracks usage + returns safe filename
    downloadHTMLFile(html, safeFileName(filename.replace(/\.[a-z]+$/i, ''), 'html'))
    toast.success('Document downloaded', { description: `${d.name} · ${d.format}` })
  }

  function handlePrint(d: DownloadDocument) {
    const html = documentHTML(d)
    if (!html) {
      toast.error('Print preview unavailable', { description: d.name })
      return
    }
    const w = openPrintWindow(html, d.name)
    if (!w) {
      toast.error('Print blocked', {
        description: 'Allow pop-ups for this site to print documents.',
      })
    }
  }

  async function handleShare(d: DownloadDocument) {
    const text = `${d.name}${d.docNumber ? ` (${d.docNumber})` : ''} — ${school.name}`
    const result = await shareText(d.name, text)
    if (result === 'copied') {
      toast.success('Copied to clipboard', { description: d.name })
    } else if (result === 'cancelled') {
      // dismissed / failed — no toast spam
    } else {
      toast.success('Shared', { description: d.name })
    }
  }

  function handleFavourite(d: DownloadDocument) {
    const next = toggleFavourite(d.id)
    toast.success(
      next ? 'Pinned to favourites' : 'Removed from favourites',
      { description: d.name },
    )
  }

  function handleRegenerate(d: DownloadDocument) {
    const cert = certDocs.find((c) => `doc-gen-${c.id}` === d.id)
    if (!cert) return
    const newDoc = generateDocument({
      docType: cert.docType,
      templateId: cert.templateId,
      student: cert.studentId
        ? undefined
        : undefined,
      studentId: cert.studentId,
      studentName: cert.studentName,
      admissionNo: cert.admissionNo,
      class: cert.class,
      data: cert.data,
    })
    toast.success('Document regenerated', { description: newDoc.docNumber })
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => { if (!v) onClose() }}
      direction="right"
    >
      <DrawerContent
        className="sm:max-w-md w-full"
        aria-label="Document details"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <DocIcon format={doc.format} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.14em]">
                Document Details
              </p>
              <DrawerTitle className="text-sm font-bold leading-tight truncate">
                {doc.name}
              </DrawerTitle>
              <DrawerDescription className="text-[11px] text-muted-foreground truncate mt-0.5">
                {doc.docNumber ?? doc.description}
              </DrawerDescription>
            </div>
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto downloads-list-scroll">
          {/* Preview area — THE ACTUAL DOCUMENT.
              · Generated cert docs → the real certificate / marksheet /
                ID card / fee receipt renderers.
              · Static forms / templates / reports → the real A4
                institutional document sheet. */}
          <div className="p-4">
            {certDoc && certTemplate ? (
              <DrawerCertPreview
                doc={doc}
                certDoc={certDoc}
                template={certTemplate}
                student={certStudent}
                txn={certTxn}
                marksheet={certMarksheet}
              />
            ) : doc.content ? (
              <StaticDocPreview content={doc.content} />
            ) : (
              <div className="rounded-xl border border-border bg-muted/30 p-6 aspect-[3/4] flex flex-col items-center justify-center text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-semibold">{doc.name}</p>
                <p className="mt-1 text-[10px] text-muted-foreground/70 max-w-[240px] leading-snug">
                  {doc.studentName ? `Issued to ${doc.studentName}` : doc.description}
                </p>
              </div>
            )}
          </div>

          {/* Action buttons row */}
          <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="flex-1 min-w-[100px] h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => handleDownload(doc)}
            >
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => handlePrint(doc)}
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-8 w-8 p-0"
              onClick={() => handleShare(doc)}
              aria-label="Share"
              title="Share"
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline" size="sm"
              className={isFavourite ? 'h-8 w-8 p-0 border-amber-400/60' : 'h-8 w-8 p-0'}
              onClick={() => handleFavourite(doc)}
              aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
              title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            >
              <Star className={isFavourite ? 'h-3.5 w-3.5 fill-amber-400 text-amber-400' : 'h-3.5 w-3.5'} />
            </Button>
          </div>

          {/* Metadata grid */}
          <div className="px-4 py-3 border-t border-border">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-2">
              Document information
            </p>
            <dl className="space-y-1.5">
              <MetaRow icon={<Tag className="h-3.5 w-3.5" />} label="Source">
                <SourceBadge source={doc.source} showIcon />
              </MetaRow>
              <MetaRow icon={<FolderTree className="h-3.5 w-3.5" />} label="Category">
                <CategoryPill category={doc.category} />
              </MetaRow>
              <MetaRow icon={<FileText className="h-3.5 w-3.5" />} label="Format">
                <FormatBadge format={doc.format} />
              </MetaRow>
              <MetaRow icon={<HardDrive className="h-3.5 w-3.5" />} label="File size">
                <span className="text-[11px] text-foreground tabular-nums">{doc.size ?? '—'}</span>
              </MetaRow>
              <MetaRow icon={<Calendar className="h-3.5 w-3.5" />} label="Last updated">
                <div className="text-right">
                  <p className="text-[11px] text-foreground leading-tight">
                    {formatRelativeTime(doc.updatedDate)}
                  </p>
                  <p className="text-[9px] text-muted-foreground tabular-nums">
                    {formatDate(doc.updatedDate)}
                  </p>
                </div>
              </MetaRow>
              {doc.docNumber && (
                <MetaRow icon={<Hash className="h-3.5 w-3.5" />} label="Document no.">
                  <span className="text-[11px] font-mono text-foreground">{doc.docNumber}</span>
                </MetaRow>
              )}
              {doc.studentName && (
                <MetaRow icon={<User className="h-3.5 w-3.5" />} label="Issued to">
                  <div className="flex items-center justify-end gap-2 min-w-0">
                    <div className="text-right min-w-0">
                      <p className="text-[11px] text-foreground leading-tight truncate">{doc.studentName}</p>
                      {doc.studentId && (
                        <p className="text-[9px] text-muted-foreground font-mono truncate">
                          {doc.studentId}
                        </p>
                      )}
                    </div>
                    <Avatar name={doc.studentName} size="sm" />
                  </div>
                </MetaRow>
              )}
            </dl>
          </div>

          {/* Activity + state info */}
          <div className="px-4 py-3 border-t border-border">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground mb-2">
              Activity
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-500/20">
                <Download className="h-2.5 w-2.5" />
                <span className="tabular-nums font-semibold">{count}</span> downloads
              </span>
              {isFavourite && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-500/20">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Pinned
                </span>
              )}
              {certDoc && (
                <>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-500/20">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {certDoc.status}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-muted text-muted-foreground border border-border">
                    <Info className="h-2.5 w-2.5" />
                    {certDoc.templateName}
                  </span>
                </>
              )}
            </div>
            {certDoc && (
              <div className="mt-3 rounded-lg bg-muted/40 border border-border p-2.5">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-[10px] text-muted-foreground leading-snug">
                    Generated by <strong className="text-foreground/80">{certDoc.generatedBy}</strong>{' '}
                    on <span className="tabular-nums">{formatDate(certDoc.generatedAt)}</span>.
                    {certDoc.admissionNo && (
                      <> Admission no. <span className="font-mono">{certDoc.admissionNo}</span>.</>
                    )}
                    {certDoc.class && (
                      <> Class <span className="font-medium text-foreground/80">{certDoc.class}</span>.</>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline" size="sm"
                  className="mt-2 h-7 text-[10px] gap-1.5"
                  onClick={() => handleRegenerate(doc)}
                >
                  <RotateCcw className="h-3 w-3" /> Regenerate
                </Button>
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function MetaRow({
  icon, label, children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
        <span className="shrink-0">{icon}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className="text-right min-w-0">{children}</div>
    </div>
  )
}

// ─── DrawerCertPreview ────────────────────────────────────────────────
//
// Renders the ACTUAL document preview (CertificatePreview / MarksheetPreview
// / IDCardPreview / FeeReceiptPreview) for a generated cert doc bridged
// into the Downloads library — snapshot-first resolution means every doc
// renders, even seeds without live roster records.

function DrawerCertPreview({
  doc, certDoc, template, student, txn, marksheet,
}: {
  doc: DownloadDocument
  certDoc: GeneratedDocument
  template: DocumentTemplate
  student?: ReturnType<typeof resolvePreviewStudent>
  txn?: ReturnType<typeof resolvePreviewTransaction>
  marksheet?: MarksheetData
}) {
  const dt = certDoc.docType
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-xl border border-border bg-slate-100 p-2 shadow-sm overflow-hidden"
    >
      {dt === 'Bonafide' || dt === 'Transfer' || dt === 'Character' || dt === 'Migration' ? (
        <CertificatePreview
          docType={dt}
          template={template}
          student={student}
          docNumber={certDoc.docNumber}
          purpose={certDoc.data?.purpose}
        />
      ) : dt === 'Marksheet' ? (
        <MarksheetPreview
          template={template}
          student={student}
          data={marksheet}
          docNumber={certDoc.docNumber}
        />
      ) : dt === 'ID Card' ? (
        <IDCardPreview template={template} student={student} />
      ) : dt === 'Fee Receipt' ? (
        <FeeReceiptPreview template={template} transaction={txn} docNumber={certDoc.docNumber} />
      ) : (
        <div className="py-12 text-center text-xs text-muted-foreground">
          Preview not available for this document type.
        </div>
      )}
      <div className="flex items-center justify-between px-2 py-1.5 text-[9px] text-muted-foreground/70 bg-slate-50 border-t border-slate-200 mt-1">
        <span>{dt} · {doc.format}</span>
        <span className="tabular-nums">{formatDate(certDoc.generatedAt)}</span>
      </div>
    </motion.div>
  )
}
