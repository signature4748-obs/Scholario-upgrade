'use client'

/**
 * FinanceShell — Principal's financial command center orchestrator.
 *
 * Visually converged to the Academics (Examinations + Attendance) canonical
 * pattern: a single PageTransition wrapper with one row of SegmentedTabs on
 * the left + the FY selector + Export button on the right, then
 * AnimatePresence tab content.
 *
 * The AppShell provides the scroll container + outer padding — this shell
 * does NOT add its own scroll wrapper (which previously caused double
 * scroll + double padding).
 *
 * Tabs: Overview · Statements · Reports · Settings
 *
 * The Settings tab IS the centralized Finance Settings capability — global
 * payment infrastructure (methods, banks, UPI/QR, gateway), receipts and
 * finance alerts. No separate sidebar module exists by design.
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Calendar, ChevronDown, Landmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs, type SegmentedTab } from '../shared/segmented-tabs'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { ModuleEmptyState } from '../shared/empty-state'
import { useFocusStore } from '@/lib/store/focus-store'
import { useFinanceData, useFinanceAttention, FINANCE_PERIODS } from '@/lib/store/finance-store'
import { downloadCSVFile, safeFileName } from '@/lib/download-file'
import { toCsv } from '@/lib/csv'
import { FinanceOverviewSection } from './finance-overview'
import { FinanceStatementsSection } from './finance-statements'
import { FinanceReportsSection } from './finance-reports'
import { FinanceSettingsSection } from './finance-settings'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

type FinanceTab = 'overview' | 'statements' | 'reports' | 'settings'

const TAB_VALUES: FinanceTab[] = ['overview', 'statements', 'reports', 'settings']

export function FinanceShell({ onModuleNavigate }: { onModuleNavigate?: (moduleKey: string) => void } = {}) {
  const [tab, setTab] = useState<FinanceTab>('overview')
  const [periodId, setPeriodId] = useState('fy25-26')
  const [periodOpen, setPeriodOpen] = useState(false)

  // Escape closes the period-selector dropdown (click-catcher already does).
  useDismissOnEscape(() => setPeriodOpen(false), periodOpen)
  const data = useFinanceData(periodId)
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

  // QA-FIX-A: REAL CSV export — the financial KPI summary (the same store
  // values the Overview panels display), numbers plain (no ₹ in cells).
  const handleExportSummary = () => {
    const rows: (string | number)[][] = [
      ['Period', data.period.label],
      ['Total Revenue', data.totalRevenue],
      ['Total Expenses', data.totalExpenses],
      ['Net Surplus', data.netSurplus],
      ['Surplus Margin (%)', data.surplusMargin],
      ['Cash Available', data.cashAvailable],
      ['Reserve Coverage (months)', data.reserveCoverage],
      ['Fee Revenue (Collected)', data.feeRevenue],
      ['Fees Outstanding', data.feeOutstanding],
      ['Fee Collection Rate (%)', data.feeCollectionRate],
      ['Monthly Payroll', data.monthlyPayroll],
      ['Annualized Payroll', data.annualizedPayroll],
      ['Total Assets', data.totalAssets],
      ['Total Liabilities', data.totalLiabilities],
      ['Net Worth', data.netWorth],
      ['Net Cash Change', data.netCashChange],
      ['Closing Cash Balance', data.closingCash],
    ]
    const filename = safeFileName(`financial-summary-${data.period.id}`, 'csv')
    downloadCSVFile(toCsv(['Metric', 'Value'], rows), filename)
    toast.success('Financial summary exported', { description: filename })
  }

  // PHASE 6 (§14) — the Finance Dashboard's P&L / balance-sheet / cashflow
  // statements are ILLUSTRATIVE demo-tier content (the documented demo
  // corpus — see lib/mock/finance-dashboard.ts). They render ONLY for the
  // sanctioned demo tenant; a real production tenant gets the honest
  // empty state instead of fabricated ₹-crore analytics. A real school's
  // financial truth lives in the Fees and Salary modules (server ledger).
  const isDemo = useIsDemoTenant()

  if (!isDemo) {
    return (
      <PageTransition className="space-y-4">
        <ModuleEmptyState
          icon={<Landmark className="h-10 w-10 text-muted-foreground/40" />}
          title="Financial statements are not generated for this school"
          description="The Finance Dashboard (P&L, balance sheet, cashflow) is illustrative content available on the demo tenant. This school's live financial data is in the Fees and Salary modules — collections, dues, payroll and their audit trails."
        />
      </PageTransition>
    )
  }

  return (
    <PageTransition className="space-y-4">
      {/* Tab row + right-side FY selector + Export (Academics canonical layout) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="overflow-x-auto -mx-1 px-1 pb-1 max-w-full">
          <SegmentedTabs
            tabs={tabs}
            value={tab}
            onValueChange={(v) => setTab(v as FinanceTab)}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Period selector */}
          <div className="relative">
            <button
              onClick={() => setPeriodOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-transparent bg-muted/60 hover:bg-muted text-foreground hover:border-border/60 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {data.period.label}
              <ChevronDown className={cn('h-3 w-3 transition-transform', periodOpen && 'rotate-180')} />
            </button>
            {periodOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
                <div className="absolute right-0 mt-1 w-48 rounded-md border border-border bg-card shadow-md z-20 py-1">
                  {FINANCE_PERIODS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setPeriodId(p.id); setPeriodOpen(false) }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/40 transition-colors',
                        periodId === p.id && 'bg-primary/5 font-semibold',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1.5"
            onClick={handleExportSummary}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
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
          {tab === 'overview' && <FinanceOverviewSection data={data} onNavigate={setTab} onModuleNavigate={onModuleNavigate} />}
          {tab === 'statements' && <FinanceStatementsSection data={data} />}
          {tab === 'reports' && <FinanceReportsSection data={data} />}
          {tab === 'settings' && <FinanceSettingsSection />}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  )
}
