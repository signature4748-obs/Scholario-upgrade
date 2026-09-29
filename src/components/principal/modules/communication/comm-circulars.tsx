'use client'

/**
 * comm-circulars — official circulars with View/Download/Archive.
 *
 * - Search + filter by status
 * - Circular cards with ref number, title, audience, date, category, status
 * - Actions: View PDF, Download, Share, Archive
 */

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, Download, Share2, Archive, Eye, Search, RotateCcw, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCommunicationStore, type Circular } from '@/lib/store/communication-store'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { downloadHTMLFile, safeFileName, shareText } from '@/lib/download-file'
import { getSchoolProfile } from '@/lib/school-profile'
import { CommPanel, CommEmptyState } from './comm-shared'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'


// ─── QA-FIX-A: REAL Download / Share actions ────────────────────────

function esc(v: unknown): string {
  return String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Branded standalone HTML memo for one circular (school letterhead,
 * title, ref/date/audience/category, principal signature). */
function buildCircularHTML(circular: Circular): string {
  const p = getSchoolProfile()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(circular.title)} — ${esc(p.shortName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; margin: 40px auto; max-width: 720px; color: #1e293b; }
  .letterhead { text-align: center; border-bottom: 3px double #0f766e; padding-bottom: 14px; margin-bottom: 22px; }
  .school { font-size: 22px; font-weight: bold; color: #0f172a; letter-spacing: 0.02em; }
  .aff { font-size: 11px; color: #475569; margin-top: 4px; }
  .contact { font-size: 10px; color: #64748b; margin-top: 2px; }
  h1 { text-align: center; font-size: 15px; letter-spacing: 0.25em; margin: 18px 0 6px; color: #0f172a; }
  .docmeta { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin: 0 0 16px; font-family: ui-monospace, monospace; }
  table.meta { border-collapse: collapse; width: 100%; margin: 12px 0; }
  table.meta td, table.meta th { border: 1px solid #cbd5e1; padding: 7px 10px; font-size: 12px; }
  table.meta th { background: #f8fafc; color: #475569; text-align: left; width: 34%; font-weight: 600; }
  p.body { font-size: 13px; line-height: 1.75; margin: 14px 0; }
  .sign { text-align: right; margin-top: 56px; font-size: 11px; color: #334155; }
  .sign .line { border-top: 1px solid #64748b; display: inline-block; padding: 18px 24px 0; }
  .foot { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 26px; }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="school">${esc(p.name)}</div>
    <div class="aff">${esc(p.affiliation)}</div>
    <div class="contact">${esc(p.address)} · ${esc(p.phone)} · ${esc(p.email)}</div>
  </div>
  <h1>CIRCULAR</h1>
  <div class="docmeta"><span>Ref: ${esc(circular.refNo)}</span><span>Date: ${esc(formatDate(circular.date))}</span></div>
  <p class="body"><strong>${esc(circular.title)}</strong></p>
  <p class="body">This circular is issued for the attention of <strong>${esc(circular.audience)}</strong> (${esc(circular.category)}). It is currently <strong>${esc(circular.status)}</strong>.</p>
  <table class="meta">
    <tr><th>Reference No</th><td>${esc(circular.refNo)}</td></tr>
    <tr><th>Title</th><td>${esc(circular.title)}</td></tr>
    <tr><th>Audience</th><td>${esc(circular.audience)}</td></tr>
    <tr><th>Category</th><td>${esc(circular.category)}</td></tr>
    <tr><th>Date</th><td>${esc(formatDate(circular.date))}</td></tr>
    <tr><th>Status</th><td>${esc(circular.status)}</td></tr>
  </table>
  <div class="sign"><span class="line">${esc(p.principal)}<br />Principal</span></div>
  <p class="foot">Issued by ${esc(p.name)} · ${esc(p.website)}</p>
</body>
</html>`
}

/** Download a branded HTML memo of the circular (QA-FIX-A). */
function downloadCircular(circular: Circular) {
  const filename = safeFileName(`circular-${circular.refNo}`, 'html')
  downloadHTMLFile(buildCircularHTML(circular), filename)
  toast.success('Circular downloaded', { description: filename })
}

/** Share the circular reference — Web Share API, else clipboard (QA-FIX-A). */
async function shareCircular(circular: Circular) {
  const p = getSchoolProfile()
  const result = await shareText(
    circular.title,
    `${circular.title} — ${p.name} (Ref: ${circular.refNo})`,
  )
  if (result === 'copied') {
    toast.success('Copied to clipboard', { description: `${circular.title} · ${p.shortName}` })
  } else if (result === 'shared') {
    toast.success('Circular shared', { description: circular.title })
  }
  // 'cancelled' — user dismissed the share sheet; no toast.
}

export function CircularsSection() {
  const circulars = useCommunicationStore((s) => s.circulars)
  const archiveCircular = useCommunicationStore((s) => s.archiveCircular)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all')
  const [viewing, setViewing] = useState<Circular | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return circulars.filter((c) => {
      if (q && !c.title.toLowerCase().includes(q) && !c.refNo.toLowerCase().includes(q)) return false
      if (filter === 'active' && c.status !== 'Active') return false
      if (filter === 'archived' && c.status !== 'Archived') return false
      return true
    })
  }, [circulars, search, filter])

  return (
    <div className="space-y-3 max-w-7xl mx-auto">
      {/* Search + filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search circular by title or reference number…"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          {[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value as any)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
                filter === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Circulars grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c, i) => (
          <CircularCard
            key={c.id}
            circular={c}
            index={i}
            onView={() => setViewing(c)}
            onArchive={() => { archiveCircular(c.id); toast.success(c.status === 'Active' ? 'Circular archived' : 'Circular restored') }}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full">
            <CommPanel>
              <CommEmptyState icon={<FileText className="h-6 w-6" />} title="No circulars found" description={search ? "Try a different search." : "No circulars match this filter."} />
            </CommPanel>
          </div>
        )}
      </div>

      {/* View modal */}
      {viewing && (
        <CircularViewModal circular={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function CircularCard({ circular, index, onView, onArchive }: {
  circular: Circular
  index: number
  onView: () => void
  onArchive: () => void
}) {
  const color = circular.color
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-all hover:shadow-md',
        circular.status === 'Archived' ? 'opacity-60 border-border' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-white shadow-sm" style={{ background: color }}>
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">{circular.refNo}</p>
          <h3 className="font-semibold text-sm leading-tight mt-0.5">{circular.title}</h3>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-muted/60 text-muted-foreground">{circular.audience}</span>
            <span className="text-[9px] text-muted-foreground">{formatDate(circular.date)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
        <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
          circular.status === 'Active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground line-through')}>
          {circular.status}
        </span>
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onView} title="View PDF">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => downloadCircular(circular)} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { void shareCircular(circular) }} title="Share">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600" onClick={onArchive} title={circular.status === 'Active' ? 'Archive' : 'Restore'}>
            {circular.status === 'Active' ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function CircularViewModal({ circular, onClose }: { circular: Circular; onClose: () => void }) {
  // Escape closes the circular view (backdrop click already does).
  useDismissOnEscape(onClose)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Circular — ${circular.title}`}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-white" style={{ background: circular.color }}>
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{circular.title}</h3>
              <p className="font-mono text-[10px] text-muted-foreground">{circular.refNo}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close circular">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* PDF preview placeholder */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-lg border-2 border-dashed border-border bg-muted/20 p-8 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">{circular.title}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{circular.refNo} · {formatDate(circular.date)}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-3 max-w-md mx-auto">
              This is a demo circular. In production, the actual PDF document would render here.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Audience</p>
              <p className="font-medium">{circular.audience}</p>
            </div>
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Category</p>
              <p className="font-medium">{circular.category}</p>
            </div>
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Date</p>
              <p className="font-medium">{formatDate(circular.date)}</p>
            </div>
            <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
              <p className="text-[9px] text-muted-foreground uppercase font-semibold">Status</p>
              <p className="font-medium">{circular.status}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-1">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => { void shareCircular(circular) }}>
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => downloadCircular(circular)}>
            <Download className="h-3.5 w-3.5" /> Download PDF
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
