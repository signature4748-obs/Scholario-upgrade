'use client'

/**
 * FinanceShell — Principal's financial command center orchestrator.
 *
 * Visually converged to the Academics (Examinations + Attendance) canonical
 * pattern: a single PageTransition wrapper with one row of SegmentedTabs,
 * then AnimatePresence tab content. The AppShell provides the scroll
 * container + outer padding.
 *
 * Tabs: Overview · Statements · Reports · Settings
 *
 * The Settings tab IS the centralized Finance Settings capability — global
 * payment infrastructure (methods, banks, UPI/QR, gateway), receipts and
 * finance alerts. No separate sidebar module exists by design.
 *
 * BATCH2-B5 — the shell no longer derives anything from the fabricated
 * finance store: the FY period selector (which sliced mock periods) and
 * the mock-figure summary export are REMOVED, and the demo-tenant gate
 * is retired — the honest dashboard (server fee-revenue truth + explicit
 * not-available lines) renders for every tenant. The Overview tab badge
 * still counts the operational Needs Attention feed (finance-store).
 */

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs, type SegmentedTab } from '../shared/segmented-tabs'
import { useFocusStore } from '@/lib/store/focus-store'
import { useFinanceAttention } from '@/lib/store/finance-store'
import { FinanceOverviewSection } from './finance-overview'
import { FinanceStatementsSection } from './finance-statements'
import { FinanceReportsSection } from './finance-reports'
import { FinanceSettingsSection } from './finance-settings'

type FinanceTab = 'overview' | 'statements' | 'reports' | 'settings'

const TAB_VALUES: FinanceTab[] = ['overview', 'statements', 'reports', 'settings']

export function FinanceShell({ onModuleNavigate }: { onModuleNavigate?: (moduleKey: string) => void } = {}) {
  const [tab, setTab] = useState<FinanceTab>('overview')

  // Operational attention badge (counts — never currency figures).
  const attention = useFinanceAttention()

  // Deep-link: "open Finance Settings" requests (fee-settings link card,
  // attention-feed CTA from other modules) land directly on the Settings
  // tab. Mirrors the fee-shell focus pattern.
  const focus = useFocusStore((s) => s.focus)
  const clearFocus = useFocusStore((s) => s.clearFocus)
  const handledFocusTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'finance-settings' || handledFocusTs.current === focus.ts) return
    handledFocusTs.current = focus.ts
    clearFocus()
    setTab('settings')
  }, [focus?.ts])

  // Build tab list with optional alerts badge on the Overview tab.
  const tabs: SegmentedTab[] = [
    { value: 'overview', label: 'Overview', badge: attention.length },
    { value: 'statements', label: 'Statements' },
    { value: 'reports', label: 'Reports' },
    { value: 'settings', label: 'Settings' },
  ]

  // Keyboard shortcuts: 1-4 switch tabs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1
        if (idx < TAB_VALUES.length) {
          e.preventDefault()
          setTab(TAB_VALUES[idx])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <PageTransition className="space-y-4">
      {/* Tab row (Academics canonical layout) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="overflow-x-auto -mx-1 px-1 pb-1 max-w-full">
          <SegmentedTabs
            tabs={tabs}
            value={tab}
            onValueChange={(v) => setTab(v as FinanceTab)}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'overview' && <FinanceOverviewSection onNavigate={setTab} onModuleNavigate={onModuleNavigate} />}
          {tab === 'statements' && <FinanceStatementsSection />}
          {tab === 'reports' && <FinanceReportsSection />}
          {tab === 'settings' && <FinanceSettingsSection />}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  )
}
