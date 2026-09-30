'use client'

/**
 * DownloadsModule — Document Library.
 *
 * Converged to the Academics (Exams + Attendance) shell pattern:
 *   <PageTransition className="space-y-4 downloads-shell">
 *     <div className="flex items-center justify-between gap-3 flex-wrap">
 *       <SegmentedTabs ... />   // All · Recent · Generated · Forms · Templates · Reports
 *       <search · filter · sort · clear>   // right-side controls
 *     </div>
 *     <QuickAccess />  // optional, when there are quick-access docs
 *     <DocumentList />
 *   </PageTransition>
 *
 * NO sticky header, NO eyebrow, NO h1 (sidebar already says "Downloads"),
 * NO summary pill row (counts already live as tab badges), NO double-scroll.
 * The AppShell already provides the scroll container + padding.
 *
 * Preserved from the previous pass:
 *   · Slide-from-right detail drawer
 *   · Document list (table) with file-type icon, name, badges, updated date
 *     and Preview / Download / More actions
 *   · Cert bridge — generated counts update live from the certificates store
 *   · Keyboard shortcut "/" focuses the search input
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Filter, ArrowUpDown, Zap,
  X, Download as DownloadIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useDownloadsStore, type DownloadDocument, type CategoryTab } from '@/lib/store/downloads-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { useCertificatesStore } from '@/lib/store/certificates-store'
import { useDownloadsActions } from './downloads-actions'
import {
  SORT_OPTIONS, CATEGORY_OPTIONS,
  DOWNLOADS_GLOBAL_STYLES,
} from './downloads-shared'
import {
  DocumentThumbnail, FileTypeBadge,
} from '@/components/shared/document-primitives'
import type { DocFormat } from '@/components/shared/document-primitives'
import { DocumentList } from './document-list'
import { DocumentDetail } from './document-detail'

const TABS = [
  { value: 'All', label: 'All' },
  { value: 'Recent', label: 'Recent' },
  { value: 'Generated', label: 'Generated' },
  { value: 'Forms', label: 'Forms' },
  { value: 'Templates', label: 'Templates' },
  { value: 'Reports', label: 'Reports' },
]

export function DownloadsModule() {
  // Selected document ID — the drawer re-resolves the LIVE record from the
  // store, so regenerated / updated / re-opened documents never go stale.
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned static
  // library once (module root); a real tenant sees only its real generated
  // documents plus the honest empty state.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useDownloadsStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  // Shared REAL action implementations (download produces a real file).
  const { handleDownload } = useDownloadsActions()

  // Subscribe to store
  const query = useDownloadsStore((s) => s.query)
  const setQuery = useDownloadsStore((s) => s.setQuery)
  const categoryFilter = useDownloadsStore((s) => s.categoryFilter)
  const setCategoryFilter = useDownloadsStore((s) => s.setCategoryFilter)
  const categoryTab = useDownloadsStore((s) => s.categoryTab)
  const setCategoryTab = useDownloadsStore((s) => s.setCategoryTab)
  const sortBy = useDownloadsStore((s) => s.sortBy)
  const setSortBy = useDownloadsStore((s) => s.setSortBy)
  const resetFilters = useDownloadsStore((s) => s.resetFilters)
  const getFilteredDocuments = useDownloadsStore((s) => s.getFilteredDocuments)
  const getCountsByTab = useDownloadsStore((s) => s.getCountsByTab)
  const getQuickAccess = useDownloadsStore((s) => s.getQuickAccess)

  // Subscribe to cert store so generated documents update live
  const certDocs = useCertificatesStore((s) => s.documents)
  // FINAL-GATE (EG-9F/R4) — subscribe to the static catalogue slice too:
  // the demo seed is applied AFTER mount (once /me resolves), and the
  // derived memos below must re-run when it lands.
  const staticDocs = useDownloadsStore((s) => s.staticDocs)

  // Re-derive counts whenever cert docs change (array identity — catches
  // delete+add sequences that keep the count equal).
  const counts = useMemo(() => getCountsByTab(), [getCountsByTab, certDocs, staticDocs])
  // Re-derive filtered list whenever any filter or the cert docs change
  const filtered = useMemo(
    () => getFilteredDocuments(),
    [getFilteredDocuments, certDocs, query, categoryFilter, categoryTab, sortBy, staticDocs],
  )
  const quickAccess = useMemo(() => getQuickAccess(), [getQuickAccess, certDocs, staticDocs])

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        const el = document.getElementById('downloads-search')
        el?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function handleQuickDownload(doc: DownloadDocument) {
    // Real file download (shared implementation with row + drawer actions).
    handleDownload(doc)
  }

  const hasActiveFilters = query.trim().length > 0 || categoryFilter !== 'All' || categoryTab !== 'All'

  // SegmentedTabs with per-tab count badges — counts are shown ONCE here
  // (no separate summary pill row).
  const tabs = TABS.map((t) => ({
    ...t,
    badge: counts[t.value as CategoryTab],
  }))

  return (
    <PageTransition className="space-y-4 downloads-shell">
      <style dangerouslySetInnerHTML={{ __html: DOWNLOADS_GLOBAL_STYLES }} />

      {/* Tab + filter row — SegmentedTabs on the left, search/filter/sort on the right. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={tabs}
          value={categoryTab}
          onValueChange={(v) => setCategoryTab(v as CategoryTab)}
        />

        {/* Right-side controls: search · category filter · sort · clear */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              id="downloads-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              className="h-9 pl-8 pr-8 text-xs"
              aria-label="Search documents"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as 'All' | typeof categoryFilter)}
          >
            <SelectTrigger className="h-9 text-xs w-[140px]" aria-label="Filter by category">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-9 text-xs w-[140px]" aria-label="Sort documents">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="outline" size="sm"
              className="h-9 text-xs gap-1.5"
              onClick={resetFilters}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Quick Access section — only when there are quick-access docs. */}
      {quickAccess.length > 0 && (
        <QuickAccess docs={quickAccess} onOpen={(doc) => setSelectedDocId(doc.id)} onDownload={handleQuickDownload} />
      )}

      {/* Document list — section header + the table. */}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {categoryTab === 'All' ? 'All documents' : categoryTab}
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
          </span>
          {query && (
            <span className="text-xs text-muted-foreground">
              · matching “<span className="text-foreground font-medium">{query}</span>”
            </span>
          )}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${categoryTab}-${categoryFilter}-${sortBy}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <DocumentList onSelectDoc={(doc) => setSelectedDocId(doc.id)} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Detail drawer — slide-from-right (resolves the live record). */}
      <DocumentDetail
        docId={selectedDocId}
        open={!!selectedDocId}
        onClose={() => setSelectedDocId(null)}
      />
    </PageTransition>
  )
}

// ─── Quick Access section ─────────────────────────────────────────────
//
// Each Quick Access item is a compact document card (md thumbnail + name +
// format badge + small download icon) — reads like a real document, not
// a pill. Single column on mobile (names stay readable), 3-up ≥ sm.

function QuickAccess({
  docs, onOpen, onDownload,
}: {
  docs: DownloadDocument[]
  onOpen: (doc: DownloadDocument) => void
  onDownload: (doc: DownloadDocument) => void
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Quick Access</h3>
          <span className="text-xs text-muted-foreground/70 truncate">
            · most used documents
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
          click to open · icon to download
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {docs.map((doc, i) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, delay: i * 0.03 }}
            className="group relative flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 hover:border-emerald-500/40 hover:shadow-sm transition-all"
          >
            <button
              type="button"
              onClick={() => onOpen(doc)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              aria-label={`Open ${doc.name}`}
            >
              <DocumentThumbnail format={doc.format as DocFormat} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate leading-tight">
                  {doc.name}
                </p>
                <div className="mt-1">
                  <FileTypeBadge format={doc.format as DocFormat} size="xs" />
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDownload(doc)}
              className="inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-md bg-muted text-muted-foreground hover:bg-emerald-600 hover:text-white transition-colors"
              aria-label={`Download ${doc.name}`}
              title="Download"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}
