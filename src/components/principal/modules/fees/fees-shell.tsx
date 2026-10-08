'use client'

/**
 * FeesShell — Principal Fee Management workspace.
 *
 * FINAL INFORMATION ARCHITECTURE (6 top-level sections):
 *   Overview · Payments · Transactions · Student Accounts · Fee Structures · Settings
 *
 * Clear responsibilities, no duplicated pages:
 *   Overview      — Insights (KPIs, trend, dues, recent payments, mode mix)
 *   Payments      — OPERATIONS: Collect Fee + cash verification queue
 *   Transactions  — The complete authoritative payment history (ledger)
 *   Student Accts — Per-student fee accounts
 *   Fee Structures— Configured fee rules
 *   Settings      — Configuration
 *
 * LAYOUT: follows the Academics canonical pattern (Attendance/Salary
 * shells) — one PageTransition wrapper, the SegmentedTabs row in NORMAL
 * document flow, and the page itself scrolling inside the AppShell
 * content area. No sticky bar, no internal scroll container.
 *
 * All numbers derive from the canonical useFeeData() hook.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs, type SegmentedTab } from '../shared/segmented-tabs'
import { useFeeData, CURRENT_ACADEMIC_YEAR } from '@/lib/store/fee-store'
import { useFocusStore } from '@/lib/store/focus-store'
// Session for the fee analytics year filter — the identity cascade's
// academic year (server session) with the fee ledger's canonical year as
// the fallback; the old mock snapshot carried an EN-dash year that never
// matched the ledger's hyphenated keys.
import { useSchoolProfile } from '@/lib/school-profile'
// SaaS-STAGE-2A (Task 7-b) — tenant-aware feature gating: the tab list is
// FILTERED by the ACTIVE school's sub-feature configuration. Overview /
// Payments / Student Accounts are always present (core operations); the
// store already enforces every capability — these gates are the
// convenience layer so disabled surfaces are simply not reachable.
import { useFeatureGate } from '@/lib/tenant/store'
import type { FeeTab } from './fees-shared'
import { FeesOverviewSection } from './fees-overview'
import { FeesDefaultersSection } from './fees-defaulters'
import { FeesStudentAccountsSection } from './fees-student-accounts'
import { FeesStructuresSection } from './fees-structures'
import { PaymentsSection } from './payments/payments-section'
import { FeesTransactionsSection } from './fees-transactions'
import { FeesSettingsSection } from './fees-settings'
import { CollectPaymentModal } from './fees-collect-payment'

// Phase 7-D — `onNavigate` stays in the module contract (principal-panel
// wires it), but the structures tab no longer needs cross-module hops now
// that it is server-backed; no other fee section consumes it, so the
// binding is parked under the eslint-allowed `_` prefix.
export function FeesShell({ onNavigate: _onNavigate }: { onNavigate?: (moduleKey: string) => void }) {
  const [tab, setTab] = useState<FeeTab>('overview')
  const [collectOpen, setCollectOpen] = useState(false)
  const [preselectStudentId, setPreselectStudentId] = useState<string | undefined>(undefined)
  const [feeFocusStudent, setFeeFocusStudent] = useState<{ name: string; ts: number } | null>(null)
  const profile = useSchoolProfile()
  const data = useFeeData(profile.academicYear || CURRENT_ACADEMIC_YEAR)

  // Deep-link: command palette fee results jump to the Student Accounts tab
  // and open the fee account workspace for the student named in the result
  // title ("<Fee title> — <Student name>"). Matched by name inside the
  // accounts section; a miss shows an honest directory toast there.
  const focus = useFocusStore((s) => s.focus)
  const clearFocus = useFocusStore((s) => s.clearFocus)
  const handledFocusTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'fee' || handledFocusTs.current === focus.ts) return
    handledFocusTs.current = focus.ts
    clearFocus()
    const studentName = focus.title.split(' — ').slice(1).join(' — ').trim()
    if (!studentName) return
    setFeeFocusStudent({ name: studentName, ts: focus.ts })
    setTab('accounts')
  }, [focus?.ts])

  // Round-7 deep-link: the dashboard "Pending Fees" KPI and the Principal
  // Attention live fee alert quote the Outreach tab's numbers — clicking
  // them lands here and jumps straight to the Outreach workspace.
  useEffect(() => {
    if (!focus || focus.type !== 'fee-outreach' || handledFocusTs.current === focus.ts) return
    handledFocusTs.current = focus.ts
    clearFocus()
    setTab('outreach')
  }, [focus?.ts])

  // Live verification count for the Payments tab badge — the Principal's
  // actionable queue (cash collections awaiting verification).
  const pendingVerification = data.analytics.pendingCashRequests

  // SaaS-STAGE-2A (Task 7-b) — tenant-aware sub-feature gates for the tab
  // list. Overview / Payments / Student Accounts are ALWAYS present (core
  // operations; payments includes cash verification). Transactions, Fee
  // Structures and Settings render only when the ACTIVE school's platform
  // configuration enables their sub-features.
  const gate = useFeatureGate()
  const showTransactions = gate.isSubFeatureEnabled('fee_transactions')
  const showStructures = gate.isSubFeatureEnabled('fee_structures')
  const showSettings = gate.isSubFeatureEnabled('receipt_templates')

  // Primary navigation ORDER everywhere the tab bar renders:
  // Overview → Payments → Transactions → Student Accounts → Outreach → Fee Structures → Settings
  // (Transactions / Fee Structures / Settings are gated per tenant — the
  // filtered list drives BOTH the tab bar and the keyboard shortcuts.)
  const tabs: SegmentedTab[] = useMemo(() => {
    const list: SegmentedTab[] = [
      { value: 'overview', label: 'Overview' },
      { value: 'payments', label: 'Payments', badge: pendingVerification > 0 ? pendingVerification : undefined },
    ]
    if (showTransactions) list.push({ value: 'transactions', label: 'Transactions' })
    list.push({ value: 'accounts', label: 'Student Accounts' })
    list.push({ value: 'outreach', label: 'Outreach' })
    if (showStructures) list.push({ value: 'structures', label: 'Fee Structures' })
    if (showSettings) list.push({ value: 'settings', label: 'Settings' })
    return list
  }, [pendingVerification, showTransactions, showStructures, showSettings])

  // Keyboard-shortcut mapping (1-6 → tab index) FOLLOWS the FILTERED tab
  // list, so a hidden tab can never be focused by its old shortcut.
  const tabValues = useMemo(() => tabs.map((t) => t.value) as FeeTab[], [tabs])

  // If the CURRENT tab becomes disabled by a configuration change (e.g.
  // the platform turned a sub-feature off for this school), fall back to
  // 'overview' — never leave the user on an orphaned tab.
  useEffect(() => {
    if (!tabValues.includes(tab)) setTab('overview')
  }, [tabValues, tab])

  // Keyboard shortcuts: number keys switch tabs (kept for power users, not
  // displayed). Range covers every slot in the FILTERED list (bounds-checked).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        // Guard: the index must resolve inside the FILTERED list.
        if (idx >= 0 && idx < tabValues.length) {
          e.preventDefault()
          setTab(tabValues[idx])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tabValues])

  const openCollect = (studentId?: string) => {
    setPreselectStudentId(studentId)
    setCollectOpen(true)
  }

  const closeCollect = () => {
    setCollectOpen(false)
    setPreselectStudentId(undefined)
  }

  return (
    <div data-testid="fees-module">
      <PageTransition className="space-y-4">
        {/* Tab row only — NO global action buttons. Each tab owns its actions.
            Normal document flow (Academics canonical layout): the row scrolls
            horizontally on narrow screens and never overlaps content. */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="overflow-x-auto -mx-1 px-1 pb-1 max-w-full">
            <SegmentedTabs
              tabs={tabs}
              value={tab}
              onValueChange={(v) => setTab(v as FeeTab)}
            />
          </div>
        </div>

        {/* Content — normal flow; the AppShell page scrolls naturally */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="max-w-7xl mx-auto"
          >
            {tab === 'overview' && <FeesOverviewSection data={data} onNavigate={setTab} />}
            {tab === 'accounts' && <FeesStudentAccountsSection data={data} onCollect={(id) => openCollect(id)} focusStudent={feeFocusStudent} />}
            {tab === 'structures' && <FeesStructuresSection />}
            {tab === 'payments' && <PaymentsSection data={data} onCollect={() => openCollect()} onOpenTransactions={() => setTab('transactions')} />}
            {tab === 'outreach' && <FeesDefaultersSection />}
            {tab === 'transactions' && <FeesTransactionsSection data={data} />}
            {tab === 'settings' && <FeesSettingsSection />}
          </motion.div>
        </AnimatePresence>
      </PageTransition>

      {/* Collect Fee — shared modal (Payments page + Student Accounts +
          any contextual "Record Payment" flow). */}
      <CollectPaymentModal
        open={collectOpen}
        onOpenChange={(open) => (open ? setCollectOpen(true) : closeCollect())}
        preselectStudentId={preselectStudentId}
      />
    </div>
  )
}
