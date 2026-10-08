'use client'

/**
 * LibraryModule — Principal Library workspace orchestrator.
 *
 * Visual shell follows the Academics (Examinations + Attendance) canonical
 * pattern:
 *   <PageTransition className="space-y-4">
 *     <div className="flex items-center justify-between gap-3 flex-wrap">
 *       <SegmentedTabs ... />            ← left
 *       <Button>Issue Book</Button>      ← right (primary, solid emerald)
 *     </div>
 *     <AnimatePresence mode="wait">
 *       {tab === 'catalogue' && <motion.div key="catalogue" ...><BooksCatalogue /></motion.div>}
 *       ...
 *     </AnimatePresence>
 *   </PageTransition>
 *
 * NO sticky header, NO eyebrow, NO h1 — the sidebar already names the module.
 * A compact KPI overview strip sits between the tab row and the tab content
 * (module-level summary); per-tab panels carry their own detail metrics.
 *
 * Layout:
 *   - Tab row: Catalogue · Issued · Overdue · Fines · Reports (left)
 *              + Issue Book button (right)
 *   - KPI overview strip (compact LibKpiCards, clickable → relevant tab)
 *   - Active tab panel:
 *       * catalogue: BooksCatalogue
 *       * issues:    active-loans banner + IssuedBooksTable (all issued)
 *       * overdue:   IssuedBooksTable (overdue filter)
 *       * fines:     FinesSummary
 *       * reports:   LibraryReports
 *   - Issue Book dialog (preselects book when triggered from catalogue)
 *
 * State from library-store + useLibraryData. Keyboard shortcuts 1-5.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, AlertTriangle, IndianRupee, Plus, BookMarked, CheckCircle2,
  FileBarChart2, Library, BookCopy, BookPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useLibraryStore, useLibraryData } from '@/lib/store/library-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { formatINR, formatDate } from '@/lib/format'
import { toast } from 'sonner'
import type { Book, IssueRecord } from '@/lib/store/library-store'
import { LIB_GLOBAL_STYLES, LibPill, LibKpiCard, type LibTab } from './library-shared'
import { DemoModuleNotice } from '../shared/demo-module-notice'
import { BooksCatalogue, IssuedBooksTable } from './books-tables'
import { IssueBookDialog } from './issue-book-dialog'
import { AddBookDialog } from './add-book-dialog'
import { FinesSummary, LibraryReports } from './fines-summary'

const TABS: Array<{ value: LibTab; label: string; icon: React.ReactNode; badge?: number }> = [
  { value: 'catalogue', label: 'Catalogue', icon: <BookMarked className="h-3.5 w-3.5" /> },
  { value: 'issues', label: 'Issued', icon: <BookOpen className="h-3.5 w-3.5" /> },
  { value: 'overdue', label: 'Overdue', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { value: 'fines', label: 'Fines', icon: <IndianRupee className="h-3.5 w-3.5" /> },
  { value: 'reports', label: 'Reports', icon: <FileBarChart2 className="h-3.5 w-3.5" /> },
]

export function LibraryModule() {
  const [tab, setTab] = useState<LibTab>('catalogue')
  const [issueOpen, setIssueOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [preselectBook, setPreselectBook] = useState<Book | null>(null)

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned seed corpus
  // once (module root); a real tenant keeps the honest empty state.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useLibraryStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  const returnBook = useLibraryStore((s) => s.returnBook)
  const sendReminder = useLibraryStore((s) => s.sendReminder)
  const issues = useLibraryStore((s) => s.issues)
  const data = useLibraryData()
  const { analytics } = data

  // Tab badges (real counts). SegmentedTabs suppresses rendering when 0.
  const pendingFineCount = issues.filter((i) => i.fineStatus === 'Pending' && i.fine > 0).length
  const tabsWithBadges = TABS.map((t) => {
    const badgeMap: Partial<Record<LibTab, number>> = {
      issues: analytics.activeIssuesCount,
      overdue: analytics.overdueCount,
      fines: pendingFineCount,
    }
    return { ...t, badge: badgeMap[t.value] }
  })

  // Keyboard shortcuts: 1-5 switch tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1
        if (idx < TABS.length) {
          e.preventDefault()
          setTab(TABS[idx].value)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const openIssueDialog = (book?: Book) => {
    setPreselectBook(book ?? null)
    setIssueOpen(true)
  }

  const handleReturn = (issueId: string) => {
    const issue = issues.find((i) => i.id === issueId)
    if (!issue) return
    returnBook(issueId)
    toast.success('Book returned', {
      description: `${issue.bookTitle} returned by ${issue.borrowerName}${
        issue.status === 'Overdue' ? ` · Fine calculated based on days overdue` : ''
      }`,
    })
  }

  // QA-FIX-B — real store mutation: stamps reminderSentAt on the loan
  // record (persisted), then confirms to the user.
  const handleSendReminder = (issue: IssueRecord) => {
    sendReminder(issue.id)
    toast.success(`Reminder sent to ${issue.borrowerName}`, {
      description: `Overdue reminder for "${issue.bookTitle}" · due ${formatDate(issue.dueDate)}`,
    })
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LIB_GLOBAL_STYLES }} />
      <PageTransition className="space-y-4 library-shell">
      {/* 7-I — honest label: the UI runs client-side demo state (real
          read-only GET APIs exist, writes are demo-only). */}
      <DemoModuleNotice moduleName="Library" variant="preview" />

      {/* Tab row + Issue Book action on the right */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={tabsWithBadges}
          value={tab}
          onValueChange={(v) => setTab(v as LibTab)}
        />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
            onClick={() => setAddOpen(true)}
          >
            <BookPlus className="h-3.5 w-3.5" /> Add Book
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => openIssueDialog()}
          >
            <Plus className="h-3.5 w-3.5" /> Issue Book
          </Button>
        </div>
      </div>

      {/* KPI overview strip — compact summary above the tab content.
          All values come from useLibraryData().analytics; clicking a card
          jumps to the tab that owns that metric. Summary strip, not a hero. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5 sm:gap-3">
        <LibKpiCard
          icon={<Library className="h-4 w-4" />}
          label="Total Books"
          value={analytics.totalBooks}
          sub={`${data.books.length} titles`}
          accent="violet"
          delay={0}
          onClick={() => setTab('catalogue')}
        />
        <LibKpiCard
          icon={<BookCopy className="h-4 w-4" />}
          label="Available Copies"
          value={analytics.totalAvailable}
          sub={analytics.totalBooks > 0
            ? `${Math.round((analytics.totalAvailable / analytics.totalBooks) * 100)}% of inventory`
            : undefined}
          accent="emerald"
          delay={0.04}
          onClick={() => setTab('catalogue')}
        />
        <LibKpiCard
          icon={<BookOpen className="h-4 w-4" />}
          label="Active Loans"
          value={analytics.activeIssuesCount}
          sub={`${analytics.activeIssuesCount - analytics.overdueCount} on schedule`}
          accent="cyan"
          delay={0.08}
          onClick={() => setTab('issues')}
        />
        <LibKpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Overdue"
          value={analytics.overdueCount}
          sub={analytics.overdueCount > 0 ? 'needs follow-up' : 'all on time'}
          accent="rose"
          delay={0.12}
          onClick={() => setTab('overdue')}
        />
        <LibKpiCard
          icon={<IndianRupee className="h-4 w-4" />}
          label="Pending Fines"
          value={formatINR(analytics.totalFines, true)}
          sub={`${pendingFineCount} borrower${pendingFineCount === 1 ? '' : 's'}`}
          accent="amber"
          delay={0.16}
          onClick={() => setTab('fines')}
        />
      </div>

      {/* Active tab content with AnimatePresence transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="space-y-4"
        >
          {tab === 'catalogue' && (
            <BooksCatalogue onIssueBook={(b) => openIssueDialog(b)} />
          )}
          {tab === 'issues' && (
            <>
              {/* Active issued banner */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/[0.04] dark:bg-sky-500/[0.06] border border-sky-500/20">
                <CheckCircle2 className="h-4 w-4 text-sky-600" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{analytics.activeIssuesCount}</span> active loans ·{' '}
                  <span className="font-semibold text-rose-600">{analytics.overdueCount} overdue</span> ·{' '}
                  <span className="font-semibold text-emerald-600">{analytics.activeIssuesCount - analytics.overdueCount} on schedule</span>
                </p>
                <LibPill accent="bg-sky-500/10 text-sky-700 dark:text-sky-300" className="ml-auto">
                  14-day loan period
                </LibPill>
              </div>
              <IssuedBooksTable filter="all" onReturn={handleReturn} onSendReminder={handleSendReminder} />
            </>
          )}
          {tab === 'overdue' && (
            <IssuedBooksTable filter="overdue" onReturn={handleReturn} onSendReminder={handleSendReminder} />
          )}
          {tab === 'fines' && <FinesSummary />}
          {tab === 'reports' && <LibraryReports />}
        </motion.div>
      </AnimatePresence>

      <IssueBookDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        preselectBook={preselectBook}
      />

      <AddBookDialog
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      </PageTransition>
    </>
  )
}
