'use client'

/**
 * Finance → Salary pointer.
 *
 * HONEST IA: Salary & Payroll is a full module of its own (pay grades,
 * monthly salary structures, payment runs, payslips). Settings hosts no
 * salary editor — this card points at the module.
 */

import { Wallet } from 'lucide-react'
import { SettingsTab } from '../shared'
import { ModuleLinkCard } from './module-link-card'

export function SalaryPointerPage() {
  return (
    <SettingsTab
      icon={Wallet}
      title="Salary & Payroll"
      description="Payroll is managed in its own module — nothing to configure on this page."
    >
      <ModuleLinkCard
        icon={Wallet}
        title="Salary & Payroll module"
        description="Pay grades, monthly salary structures per teacher, payment recording and payslips live in the dedicated Salary & Payroll module — not in Settings."
        moduleKey="salary"
        ctaLabel="Open Salary & Payroll module"
      />
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        The library&apos;s overdue fine policy (the only other money-related rule set in Settings)
        is configured under <strong>Finance → Library Rules</strong> on this category rail.
      </p>
    </SettingsTab>
  )
}
