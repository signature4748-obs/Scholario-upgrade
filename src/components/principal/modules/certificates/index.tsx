'use client'

/**
 * CertificatesModule — Document Generation workspace.
 *
 * Converged to the Academics (Exams + Attendance) shell pattern:
 *   <PageTransition className="space-y-4">
 *     <div className="flex items-center justify-between gap-3 flex-wrap">
 *       <SegmentedTabs ... />   // Generate · Templates · History
 *     </div>
 *     <AnimatePresence mode="wait"> tab content </AnimatePresence>
 *   </PageTransition>
 *
 * NO sticky header, NO eyebrow, NO h1 (sidebar already says "Certificates"),
 * NO summary pills, NO double-scroll. The AppShell already provides the
 * scroll container + padding.
 *
 * Each metric has ONE home:
 *   · Total / This Month / Pending  → History tab stats line.
 *   · Active Templates / total      → Templates tab filter chips.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useCertificatesStore } from '@/lib/store/certificates-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { CERT_PRINT_STYLES } from './cert-shared'
import { DemoModuleNotice } from '../shared/demo-module-notice'
import { GenerateTab } from './generate-tab'
import { TemplatesTab } from './templates-tab'
import { HistoryTab } from './history-tab'

type Tab = 'generate' | 'templates' | 'history'

const TABS = [
  { value: 'generate', label: 'Generate' },
  { value: 'templates', label: 'Templates' },
  { value: 'history', label: 'History' },
]

export function CertificatesModule() {
  const [tab, setTab] = useState<Tab>('generate')

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned seed history
  // once (module root); a real tenant keeps the honest empty history.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useCertificatesStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  // Keyboard shortcuts: 1-3 switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '1') setTab('generate')
      if (e.key === '2') setTab('templates')
      if (e.key === '3') setTab('history')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <PageTransition className="space-y-4 cert-shell">
      <style dangerouslySetInnerHTML={{ __html: CERT_PRINT_STYLES }} />

      {/* 7-I — honest label: client-side demo state, no server API. */}
      <DemoModuleNotice moduleName="Certificates" />

      {/* Tab row — SegmentedTabs on the left, no right-side control. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={TABS}
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
        />
      </div>

      {/* Active tab content — flat, no KPI row (duplicates metrics). */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'generate' && <GenerateTab />}
          {tab === 'templates' && <TemplatesTab />}
          {tab === 'history' && <HistoryTab onGoGenerate={() => setTab('generate')} />}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  )
}
