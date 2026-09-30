'use client'

/**
 * MyCertificatesModule — the STUDENT certificate view.
 *
 * Reads the SAME canonical certificates-store as the Principal module,
 * filtered to the logged-in student. Students see only their own records
 * and can preview / download them — no generation or admin controls.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Award, Eye, Download, FileText, X } from 'lucide-react'
import { GlassCard, StatusBadge } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useCertificatesStore } from '@/lib/store/certificates-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import type { GeneratedDocument } from '@/lib/store/certificates-store'
import { useMyStudentRecord } from '@/lib/store/students-store'
// Certificate letterhead — the identity cascade (server → settings →
// neutral); the session line is the school's real academic year, never
// `new Date().getFullYear()` guessing.
import { useSchoolProfile, getSchoolProfile } from '@/lib/school-profile'
import { formatDate } from '@/lib/format'
import { toast } from 'sonner'

// (Identity: the module resolves the session student's OWN records — no
// hardcoded id; the canonical resolver lives in useMyStudentRecord.)

function statusVariant(status: string): 'success' | 'primary' | 'neutral' {
  if (status === 'Issued' || status === 'Downloaded' || status === 'Printed') return 'success'
  if (status === 'Draft') return 'primary'
  return 'neutral'
}

function docHtml(doc: GeneratedDocument): string {
  const school = getSchoolProfile()
  const purpose = typeof doc.data?.purpose === 'string' && doc.data.purpose !== '—' ? doc.data.purpose : ''
  const sessionLine = school.academicYear ? `Session ${school.academicYear}` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${doc.docNumber} — ${doc.docType}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 48px; color: #111827; }
  .head { text-align: center; border-bottom: 3px double #0d9488; padding-bottom: 16px; }
  .head h1 { margin: 0; font-size: 26px; color: #0f766e; letter-spacing: 1px; }
  .head p { margin: 4px 0 0; font-size: 12px; color: #475569; }
  .type { text-align: center; margin: 28px 0 8px; font-size: 20px; font-weight: bold; text-transform: uppercase; letter-spacing: 3px; }
  .no { text-align: center; font-size: 11px; color: #64748b; margin-bottom: 24px; }
  .body { font-size: 15px; line-height: 1.9; }
  .sig { display: flex; justify-content: space-between; margin-top: 64px; font-size: 13px; }
  .sig div { text-align: center; border-top: 1px solid #94a3b8; padding-top: 6px; width: 220px; }
</style>
</head>
<body>
  <div class="head">
    <h1>${school.name}</h1>
    <p>${[school.address, school.phone ? 'Ph: ' + school.phone : ''].filter(Boolean).join(' · ') || '—'}</p>
    <p>${[school.affiliation, sessionLine].filter(Boolean).join(' · ') || '—'}</p>
  </div>
  <div class="type">${doc.docType}</div>
  <div class="no">Certificate No. ${doc.docNumber}</div>
  <div class="body">
    <p>This is to certify that <strong>${doc.studentName}</strong>, Admission No. <strong>${doc.admissionNo ?? '—'}</strong>, class <strong>${doc.class ?? '—'}</strong>, is a bona fide student of this school.${purpose ? ' This certificate is issued for the purpose of <strong>' + purpose + '</strong>.' : ''}</p>
    <p>Issued on ${formatDate(doc.generatedAt.slice(0, 10))}.</p>
  </div>
  <div class="sig">
    <div>Class Teacher</div>
    <div>Principal</div>
  </div>
</body>
</html>`
}

export function MyCertificatesModule() {
  const documents = useCertificatesStore((s) => s.documents)

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned seed history
  // once (module root); a real tenant keeps the honest empty view (its own
  // certificates appear as the principal generates them).
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useCertificatesStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])
  const [previewDoc, setPreviewDoc] = useState<GeneratedDocument | null>(null)
  const school = useSchoolProfile()

  // Canonical identity — the session user's own roster record.
  const me = useMyStudentRecord()
  const studentId = me?.id ?? ''

  const mine = useMemo(
    () => documents
      .filter((d) => d.studentId === studentId || d.admissionNo === me?.admissionNo)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    [documents, studentId, me?.admissionNo],
  )

  function handleDownload(doc: GeneratedDocument) {
    const blob = new Blob([docHtml(doc)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.docNumber.replace(/[\\/]/g, '-')}.html`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Certificate downloaded', { description: `${doc.docNumber} · ${doc.docType}` })
  }

  return (
    <div className="space-y-4">
      {/* LR-1 — compact context line, no giant module title */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          Bonafide, character & official certificates issued to you
        </p>
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {mine.length > 0 ? `${mine.length} certificate${mine.length > 1 ? 's' : ''}` : 'None yet'}
        </span>
      </div>

      <GlassCard className="p-3 sm:p-4 lg:p-5">
        {mine.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60 mb-3">
              <Award className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No certificates issued yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              Certificates issued by the school office will appear here for you to view and download.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {mine.map((doc, i) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-foreground/20 transition-colors"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{doc.docType}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    No. {doc.docNumber} · Issued {formatDate(doc.generatedAt.slice(0, 10))}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <StatusBadge status={doc.status} variant={statusVariant(doc.status)} />
                  <Button
                    size="sm" variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setPreviewDoc(doc)}
                    aria-label={`Preview ${doc.docType}`}
                    title="Preview"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => handleDownload(doc)}
                    aria-label={`Download ${doc.docType}`}
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Preview dialog — official document look (paper, serif, school header) */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-lg p-0 overflow-hidden bg-white dark:bg-paper max-h-[85vh] overflow-y-auto">
          {previewDoc && (
            <div className="relative">
              <DialogHeader className="sr-only">
                <DialogTitle>{previewDoc.docType} — {previewDoc.docNumber}</DialogTitle>
                <DialogDescription>Certificate preview</DialogDescription>
              </DialogHeader>
              <button
                onClick={() => setPreviewDoc(null)}
                className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-slate-500 hover:bg-black/10 transition-colors"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="px-8 py-8 font-serif text-slate-800">
                <div className="border-b-[3px] border-double border-teal-700 pb-3 text-center">
                  <h1 className="text-xl font-bold tracking-wide text-teal-800">{school.name}</h1>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {school.address || '—'}{school.phone ? ` · ${school.phone}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-500">{school.affiliation || '—'}</p>
                </div>
                <p className="mt-6 text-center text-sm font-bold uppercase tracking-[0.2em]">{previewDoc.docType}</p>
                <p className="mt-1 text-center text-[10px] text-slate-500">Certificate No. {previewDoc.docNumber}</p>
                <div className="mt-5 text-[13px] leading-7 text-center">
                  This is to certify that <strong>{previewDoc.studentName}</strong>, Admission No.{' '}
                  <strong>{previewDoc.admissionNo}</strong>, class <strong>{previewDoc.class}</strong>, is a bona fide
                  student of this school.
                  {typeof previewDoc.data?.purpose === 'string' && previewDoc.data.purpose !== '—' && (
                    <> This certificate is issued for the purpose of <strong>{previewDoc.data.purpose}</strong>.</>
                  )}
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-500">
                  Issued on {formatDate(previewDoc.generatedAt.slice(0, 10))}
                </p>
                <div className="mt-10 flex justify-between text-[11px] text-slate-600">
                  <div className="border-t border-slate-400 pt-1 w-40 text-center">Class Teacher</div>
                  <div className="border-t border-slate-400 pt-1 w-40 text-center">Principal</div>
                </div>
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-8 py-3 flex justify-end">
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => handleDownload(previewDoc)}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
