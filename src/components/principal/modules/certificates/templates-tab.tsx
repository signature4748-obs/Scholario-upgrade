'use client'

/**
 * templates-tab — manage document templates.
 *
 * Filter templates by document type, preview them in miniature, set a
 * default template per doc type, duplicate templates.
 *
 * Template cards stay honest: they show the doc type, the fields the
 * template prints (DOC_FIELDS), and a real usage count derived from the
 * issued-document log. No last-updated timestamp is shown — the store
 * does not track template edits.
 *
 * Design language:
 *   - Filter chips are text-only pills with a count badge — no per-type
 *     colored icons. With the single-emerald accent, the doc-type
 *     distinction lives in the label, not the color.
 *   - Template cards are professional document-template cards: a framed
 *     preview pane (muted desk, centered paper with a soft shadow), clean
 *     title/metadata rows, a subtle DEFAULT state, and a separated action
 *     row of consistent h-7 ghost icon buttons with title tooltips.
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Copy, Star, Eye, X, Check, Sparkles, Trash2, FileStack,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSchoolProfile } from '@/lib/school-profile'
import {
  useCertificatesStore,
  type DocType, type DocumentTemplate,
} from '@/lib/store/certificates-store'
import {
  DOC_TYPES, CertPanel, CertEmptyState, StylePill, DOC_FIELDS,
} from './cert-shared'
import {
  CertificatePreview, MarksheetPreview, IDCardPreview, FeeReceiptPreview,
} from './previews'
import type { StudentRecord } from '@/lib/store/students-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { sampleMarksheetData, sampleTransaction } from './cert-resolvers'
import { DocumentThumbnail } from '@/components/shared/document-primitives'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

export function TemplatesTab() {
  const templates = useCertificatesStore((s) => s.templates)
  const documents = useCertificatesStore((s) => s.documents)
  const setDefaultTemplate = useCertificatesStore((s) => s.setDefaultTemplate)
  const duplicateTemplate = useCertificatesStore((s) => s.duplicateTemplate)
  const toggleTemplateActive = useCertificatesStore((s) => s.toggleTemplateActive)
  const [filterType, setFilterType] = useState<DocType | 'all'>('all')
  const [previewTpl, setPreviewTpl] = useState<DocumentTemplate | null>(null)

  // Real usage count per template, derived from the issued-document log.
  const usageByTemplate = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of documents) {
      map.set(d.templateId, (map.get(d.templateId) ?? 0) + 1)
    }
    return map
  }, [documents])

  const filtered = useMemo(() => {
    if (filterType === 'all') return templates
    return templates.filter((t) => t.docType === filterType)
  }, [templates, filterType])

  // Group by doc type for display
  const grouped = useMemo(() => {
    const map = new Map<DocType, DocumentTemplate[]>()
    for (const t of filtered) {
      if (!map.has(t.docType)) map.set(t.docType, [])
      map.get(t.docType)!.push(t)
    }
    return map
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Filter row — text-only pills with count badge, no per-type icons. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip
          label="All"
          count={templates.length}
          active={filterType === 'all'}
          onClick={() => setFilterType('all')}
        />
        {DOC_TYPES.map((d) => (
          <FilterChip
            key={d.label}
            label={d.short}
            count={templates.filter((t) => t.docType === d.label).length}
            active={filterType === d.label}
            onClick={() => setFilterType(d.label)}
          />
        ))}
      </div>

      {/* Grouped grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={filterType}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="space-y-4"
        >
          {grouped.size === 0 && (
            <CertPanel>
              <CertEmptyState
                icon={<Sparkles className="h-5 w-5" />}
                title="No templates match the filter"
                description="Try a different document type — each type ships with ready-to-use templates."
              />
            </CertPanel>
          )}
          {Array.from(grouped.entries()).map(([docType, tpls]) => (
            <TemplateGroup
              key={docType}
              docType={docType}
              templates={tpls}
              usageByTemplate={usageByTemplate}
              onPreview={(t) => setPreviewTpl(t)}
              onSetDefault={(t) => {
                setDefaultTemplate(docType, t.id)
                toast.success(`Default ${docType} template`, {
                  description: t.name,
                })
              }}
              onDuplicate={(t) => {
                const copy = duplicateTemplate(t.id)
                if (copy) {
                  toast.success('Template duplicated', { description: copy.name })
                }
              }}
              onToggle={(t) => {
                toggleTemplateActive(t.id)
                toast.success(`${t.active ? 'Deactivated' : 'Activated'} template`, {
                  description: t.name,
                })
              }}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Preview dialog */}
      <AnimatePresence>
        {previewTpl && (
          <PreviewModal template={previewTpl} onClose={() => setPreviewTpl(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Filter chip (text-only, Academics-style) ─────────────────────────

function FilterChip({ label, count, active, onClick }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className={cn(
        'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-semibold tabular-nums',
        active
          ? 'bg-background/20 text-background'
          : 'bg-muted text-muted-foreground',
      )}>
        {count}
      </span>
    </button>
  )
}

// ─── Template group ──────────────────────────────────────────────────

function TemplateGroup({
  docType, templates, usageByTemplate, onPreview, onSetDefault, onDuplicate, onToggle,
}: {
  docType: DocType
  templates: DocumentTemplate[]
  usageByTemplate: Map<string, number>
  onPreview: (t: DocumentTemplate) => void
  onSetDefault: (t: DocumentTemplate) => void
  onDuplicate: (t: DocumentTemplate) => void
  onToggle: (t: DocumentTemplate) => void
}) {
  const fields = DOC_FIELDS[docType] ?? []
  return (
    <CertPanel
      title={`${docType} templates`}
      subtitle={fields.length > 0 ? `Fields: ${fields.join(' · ')}` : undefined}
      action={
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {templates.length} {templates.length === 1 ? 'template' : 'templates'}
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            usage={usageByTemplate.get(t.id) ?? 0}
            onPreview={() => onPreview(t)}
            onSetDefault={() => onSetDefault(t)}
            onDuplicate={() => onDuplicate(t)}
            onToggle={() => onToggle(t)}
          />
        ))}
      </div>
    </CertPanel>
  )
}

function TemplateCard({
  template, usage, onPreview, onSetDefault, onDuplicate, onToggle,
}: {
  template: DocumentTemplate
  usage: number
  onPreview: () => void
  onSetDefault: () => void
  onDuplicate: () => void
  onToggle: () => void
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-all hover:border-foreground/25 hover:shadow-sm">
      {/* Preview pane — a framed desk with the document paper centred on it.
          The whole pane is the preview button (with a title tooltip). */}
      <button
        onClick={onPreview}
        title="Preview template"
        aria-label={`Preview ${template.name}`}
        className="relative block w-full h-40 p-2.5 bg-muted/50 hover:bg-muted/70 transition-colors"
      >
        <div className="h-full w-full rounded-md shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          <MiniPreview template={template} />
        </div>
        {template.isDefault && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-card border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 shadow-sm">
            <Star className="h-2.5 w-2.5 fill-emerald-500 text-emerald-600 dark:text-emerald-400" />
            Default
          </span>
        )}
      </button>
      {/* Footer — document identity + metadata + actions */}
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <DocumentThumbnail docType={template.docType} size="sm" />
          <p className="text-xs font-semibold truncate flex-1 min-w-0" title={template.name}>{template.name}</p>
        </div>
        <div className="flex items-center gap-1.5 mb-2.5 min-w-0">
          <StylePill style={template.style} accent={template.accentColor} />
          <span className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0',
            template.active
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-500/10 text-slate-500',
          )}>
            {template.active ? 'Active' : 'Inactive'}
          </span>
          {/* Real usage count from the issued-document log */}
          <span className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-muted-foreground tabular-nums shrink-0" title="Documents generated with this template">
            <FileStack className="h-2.5 w-2.5" />
            {usage}
          </span>
        </div>
        {/* Fields the template prints — honest capability line */}
        <p className="text-[9px] text-muted-foreground leading-snug line-clamp-2 mb-3 flex-1">
          {DOC_FIELDS[template.docType]?.join(' · ')}
        </p>
        {/* Actions — consistent ghost icon buttons with tooltips; the
            deactivate action reads as destructive on hover without going
            loud. Separated from the content by a hairline. */}
        <div className="flex items-center gap-0.5 -mx-1 px-1 pt-2 border-t border-border/60">
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onPreview}
            title="Preview"
            aria-label={`Preview ${template.name}`}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onDuplicate}
            title="Duplicate"
            aria-label={`Duplicate ${template.name}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {!template.isDefault ? (
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onSetDefault}
              disabled={!template.active}
              title="Set as default"
              aria-label={`Set ${template.name} as default`}
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 text-emerald-600 dark:text-emerald-400"
              disabled
              title="Default template"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost" size="sm"
            className={cn(
              'h-7 w-7 p-0',
              template.active
                ? 'text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400'
                : 'text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400',
            )}
            onClick={onToggle}
            title={template.active ? 'Deactivate' : 'Activate'}
            aria-label={`${template.active ? 'Deactivate' : 'Activate'} ${template.name}`}
          >
            {template.active ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Mini preview (cheap, just a visual hint) ────────────────────────

function MiniPreview({ template }: { template: DocumentTemplate }) {
  const accent = template.accentColor
  const style = template.style
  // Just render a small abstract preview per style
  if (template.docType === 'Marksheet') {
    return (
      <div className="h-full w-full bg-white rounded-sm border border-slate-300 flex flex-col p-1.5 gap-0.5">
        <div className="h-2 w-2/3 rounded-sm" style={{ background: accent }} />
        <div className="h-1 w-full bg-slate-200 rounded-sm" />
        <div className="flex-1 grid grid-cols-3 gap-0.5 mt-0.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={cn('rounded-sm', i % 3 === 0 ? 'bg-slate-100' : 'bg-slate-200/70')} />
          ))}
        </div>
      </div>
    )
  }
  if (template.docType === 'ID Card') {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div
          className="rounded-md bg-white border border-slate-300 overflow-hidden"
          style={style === 'Modern' ? { width: '70%', aspectRatio: '1.6' } : { width: '40%', aspectRatio: '0.7' }}
        >
          <div className="h-2 w-full" style={{ background: accent }} />
          <div className="p-1 space-y-0.5">
            <div className="h-1.5 w-3/4 bg-slate-300 rounded-sm" />
            <div className="h-1 w-full bg-slate-200 rounded-sm" />
            <div className="h-1 w-2/3 bg-slate-200 rounded-sm" />
          </div>
        </div>
      </div>
    )
  }
  if (template.docType === 'Fee Receipt') {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div
          className="bg-white rounded-sm border border-slate-300 p-1.5"
          style={{ width: style === 'Compact' ? '50%' : '90%', height: '90%' }}
        >
          <div className="h-1 w-2/3 mx-auto bg-slate-800 rounded-sm mb-0.5" />
          <div className="h-px w-full border-t border-dashed border-slate-300 my-0.5" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between text-[6px]">
              <div className="h-0.5 w-1/2 bg-slate-200 rounded-sm my-0.5" />
              <div className="h-0.5 w-1/4 bg-slate-300 rounded-sm my-0.5" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  // Certificates — render abstract certificate frame
  const isClassic = style === 'Classic'
  const isFormal = style === 'Formal'
  const isMinimal = style === 'Minimal'
  return (
    <div
      className={cn('h-full w-full bg-white', isClassic ? 'p-1' : 'p-2', isMinimal ? '' : 'rounded-sm')}
      style={isClassic ? { background: accent, padding: 4 } : isFormal
        ? { border: `3px double ${accent}`, outline: `1px solid ${accent}`, outlineOffset: '2px' }
        : isMinimal ? { border: `1px solid ${accent}40` }
        : { border: '1px solid #cbd5e1' }}
    >
      <div className={cn('h-full w-full flex flex-col items-center justify-center gap-0.5', isClassic && 'bg-white p-1.5')}>
        <div className="h-3 w-3 rounded-full" style={{ background: accent }} />
        <div className="h-1 w-3/4 bg-slate-800 rounded-sm" />
        <div className="h-1 w-1/2 bg-slate-300 rounded-sm" />
        <div className="h-px w-full border-t border-slate-300 my-0.5" />
        <div className="space-y-0.5 w-full">
          <div className="h-0.5 w-full bg-slate-200 rounded-sm" />
          <div className="h-0.5 w-2/3 bg-slate-200 rounded-sm" />
        </div>
      </div>
    </div>
  )
}

// ─── Preview modal (uses real preview with sample student) ──────────

function PreviewModal({ template, onClose }: { template: DocumentTemplate; onClose: () => void }) {
  useDismissOnEscape(onClose)
  const school = useSchoolProfile()
  const students = useStudentsStore((s) => s.students)
  const transactions = useFeeStore((s) => s.transactions)
  // Sample student powering the live preview — a REAL roster student, so
  // every template preview renders actual document content.
  const sampleStudent: StudentRecord | undefined = useMemo(() => {
    return students[0]
  }, [students])
  // Sample marksheet (derived from the sample student's academic record)
  // + sample fee transaction — so Marksheet & Fee Receipt template previews
  // render the full document instead of an empty placeholder.
  const sampleData = useMemo(
    () => (sampleStudent ? sampleMarksheetData(sampleStudent) : undefined),
    [sampleStudent],
  )
  const sampleTxn = useMemo(
    () => sampleTransaction(sampleStudent, transactions),
    [sampleStudent, transactions],
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${template.name} preview`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-card rounded-xl border border-border max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{template.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {template.docType} · {template.style} · {school.shortName}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close preview" className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
          <ModalPreview template={template} student={sampleStudent} sampleMarksheet={sampleData} sampleTxn={sampleTxn} />
        </div>
      </motion.div>
    </motion.div>
  )
}

function ModalPreview({
  template, student, sampleMarksheet, sampleTxn,
}: {
  template: DocumentTemplate
  student?: StudentRecord
  sampleMarksheet?: ReturnType<typeof sampleMarksheetData>
  sampleTxn?: ReturnType<typeof sampleTransaction>
}) {
  const t = template
  const dt = t.docType
  if (dt === 'Bonafide' || dt === 'Transfer' || dt === 'Character' || dt === 'Migration') {
    return <CertificatePreview docType={dt} template={t} student={student} />
  }
  if (dt === 'Marksheet') {
    return <MarksheetPreview template={t} student={student} data={sampleMarksheet} />
  }
  if (dt === 'ID Card') {
    return <IDCardPreview template={t} student={student} />
  }
  if (dt === 'Fee Receipt') {
    return <FeeReceiptPreview template={t} transaction={sampleTxn} />
  }
  return null
}
