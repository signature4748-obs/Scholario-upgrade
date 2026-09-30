'use client'

/**
 * comm-shell — Communication Center orchestrator.
 *
 * Converged to the Academics (Exams + Attendance) shell pattern:
 *   <PageTransition className="space-y-4 comm-shell">
 *     <div className="flex items-center justify-between gap-3 flex-wrap">
 *       <SegmentedTabs ... />   // Announcements · Circulars · Compose · History
 *     </div>
 *     <AnimatePresence mode="wait"> tab content </AnimatePresence>
 *   </PageTransition>
 *
 * NO sticky header, NO eyebrow, NO h1 (sidebar already says "Communication"),
 * NO summary pills (counts already live as tab badges on Announcements),
 * NO double-scroll. The AppShell already provides the scroll container +
 * padding.
 *
 * NO separate SMS/Email/Push tabs — channels live inside the Compose tab.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useFocusStore } from '@/lib/store/focus-store'
import type { CommTab } from './comm-shared'
import { COMM_GLOBAL_STYLES } from './comm-shared'
import { AnnouncementsSection } from './comm-announcements'
import { CircularsSection } from './comm-circulars'
import { ComposeSection } from './comm-compose'
import { HistorySection } from './comm-history'

const TABS = [
  { value: 'announcements', label: 'Announcements' },
  { value: 'circulars', label: 'Circulars' },
  { value: 'compose', label: 'Compose' },
  { value: 'history', label: 'History' },
]

export function CommShell() {
  const [tab, setTab] = useState<CommTab>('announcements')

  // Notice deep-link from the command palette: jump straight to History and
  // hand the notice title down so the search pre-fills and the matching
  // platform broadcast auto-opens.
  const focus = useFocusStore((s) => s.focus)
  const [noticeFocus, setNoticeFocus] = useState<{ id: string; title: string; ts: number } | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'notice') return
    setNoticeFocus({ id: focus.id, title: focus.title, ts: focus.ts })
    setTab('history')
  }, [focus?.ts, focus?.type])

  // Keyboard shortcuts: 1-4 switch tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1
        if (idx < TABS.length) {
          e.preventDefault()
          setTab(TABS[idx].value as CommTab)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const tabs = TABS.map((t) => ({ ...t }))

  return (
    <PageTransition className="space-y-4 comm-shell">
      <style dangerouslySetInnerHTML={{ __html: COMM_GLOBAL_STYLES }} />

      {/* Tab row — SegmentedTabs on the left, no right-side control. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={tabs}
          value={tab}
          onValueChange={(v) => setTab(v as CommTab)}
        />
      </div>

      {/* Active tab content. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'announcements' && <AnnouncementsSection onNavigate={setTab} />}
          {tab === 'circulars' && <CircularsSection />}
          {tab === 'compose' && <ComposeSection />}
          {tab === 'history' && (
            <HistorySection
              focusNotice={noticeFocus}
              onNoticeConsumed={() => setNoticeFocus(null)}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  )
}
