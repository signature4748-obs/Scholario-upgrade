'use client'

/**
 * SalaryShell — Principal Salary & Payroll workspace.
 *
 * Seven tabs: Overview · Payments · Payslips · Reports · History ·
 * Salary Structure · Settings. The shell hosts the employee drawer and
 * the Record Payment dialog so any tab can open them.
 *
 * Record Payment lives exactly once per screen: in the Staff Salaries
 * panel on Overview, and in the Payments toolbar — never both.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Info } from 'lucide-react'

import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs, type SegmentedTab } from '../shared/segmented-tabs'
import { useSalaryData } from '@/lib/store/salary-store'
import type { SalaryTab } from './salary-shared'
import { SalaryUIProvider, useSalaryUI } from './salary-ui-context'
import { SalaryOverviewSection } from './salary-overview'
import { SalaryPaymentsSection } from './salary-payments'
import { SalaryEmployeeAccountsSection } from './salary-employee-accounts'
import { SalaryPayslipsSection } from './salary-payslips'
import { SalaryReportsSection } from './salary-reports'
import { SalaryHistorySection } from './salary-history'
import { SalaryStructuresSection } from './salary-structures'
import { SalarySettingsSection } from './salary-settings'
import { SalaryEmployeeDrawer } from './salary-employee-drawer'
import { RecordPaymentDialog } from './record-payment-dialog'


function SalaryShellInner() {
  const [tab, setTab] = useState<SalaryTab>('overview')
  const data = useSalaryData()

  const tabs: SegmentedTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'payments', label: 'Payments', badge: data.currentMonth.pending.count + data.pendingChangeRequests.length },
    { value: 'accounts', label: 'Employee Accounts' },
    { value: 'payslips', label: 'Payslips' },
    { value: 'reports', label: 'Reports' },
    { value: 'history', label: 'History' },
    { value: 'structures', label: 'Salary Structure' },
    { value: 'settings', label: 'Settings' },
  ]

  return (
    <PageTransition className="space-y-4">
      {/* PIH-4c — honest data-residency notice: the payroll ledger lives
          in this browser's local store (no server canonical yet); the same
          quiet info-strip pattern as the settings fees-tab banner. */}
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300"
      >
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        <span className="min-w-0 flex-1">
          Payroll data is currently stored locally in this browser — server-side persistence arrives with the infrastructure phase.
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1 max-w-full">
        <SegmentedTabs
          tabs={tabs}
          value={tab}
          onValueChange={(v) => setTab(v as SalaryTab)}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'overview' && <SalaryOverviewSection onNavigate={(t) => setTab(t as SalaryTab)} />}
          {tab === 'payments' && <SalaryPaymentsSection />}
          {tab === 'accounts' && <SalaryEmployeeAccountsSection />}
          {tab === 'payslips' && <SalaryPayslipsSection />}
          {tab === 'reports' && <SalaryReportsSection />}
          {tab === 'history' && <SalaryHistorySection />}
          {tab === 'structures' && <SalaryStructuresSection />}
          {tab === 'settings' && <SalarySettingsSection />}
        </motion.div>
      </AnimatePresence>
    </PageTransition>
  )
}

export function SalaryShell() {
  return (
    <SalaryUIProvider>
      <SalaryShellInner />
      <SalaryEmployeeDrawer />
      <HostedRecordPayment />
    </SalaryUIProvider>
  )
}

function HostedRecordPayment() {
  const { recordOpen, recordTarget, closeRecordPayment } = useSalaryUI()
  return (
    <RecordPaymentDialog
      open={recordOpen}
      onOpenChange={(o) => !o && closeRecordPayment()}
      employeeId={recordTarget?.employeeId}
      periodKey={recordTarget?.periodKey}
    />
  )
}
