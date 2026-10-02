'use client'

/**
 * SalarySettingsSection — compact settings for the fixed-salary payroll.
 *
 * PHASE 8B: the payroll model IS the setting — one fixed monthly salary
 * per teacher, recorded by the principal, stored in the school's server
 * ledger. The former client-only toggles (editing window, reference
 * requirements) are retired with the localStorage ledger; what remains:
 * the model card (read-only explanation + canonical sync state) and the
 * Payroll Records browser.
 */

import { useEffect } from 'react'
import { Check, Database, ShieldCheck } from 'lucide-react'

import { useSalaryStore } from '@/lib/store/salary-store'
import { fmtDayYear } from './salary-shared'
import { PayrollArchiveCard } from './salary-payroll-archive'

export function SalarySettingsSection() {
  const hydrate = useSalaryStore((s) => s.hydrate)
  const syncStatus = useSalaryStore((s) => s.syncStatus)
  const lastSyncedAt = useSalaryStore((s) => s.lastSyncedAt)
  const structures = useSalaryStore((s) => s.structures)

  // Free re-fire (once-per-session guard inside the store).
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <div className="space-y-4">
      {/* PAYROLL MODEL */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Payroll Model</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Fixed Monthly Salary</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One amount per teacher per month · principal records payments
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
              The school&apos;s payroll model has no components, allowances or deductions — the monthly
              salary is the salary. Payments are recorded against a month; voiding keeps the audit
              trail and frees the month.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">
            <Check className="h-2.5 w-2.5" />{structures.length} salary{structures.length === 1 ? '' : 's'} set
          </span>
        </div>
      </div>

      {/* DATA RESIDENCY */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Data</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">School server ledger</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {syncStatus === 'synced'
                    ? `Synced${lastSyncedAt ? ` · as of ${fmtDayYear(lastSyncedAt)}` : ''}`
                    : syncStatus === 'syncing'
                      ? 'Syncing…'
                      : syncStatus === 'error'
                        ? 'Last sync failed — retry by reopening the module'
                        : 'Not synced yet'}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
              Salary structures and payment records live in the school&apos;s database — every device
              and every teacher sees the same canonical rows. Nothing is stored in this browser.
            </p>
          </div>
        </div>
      </div>

      {/* PAYROLL RECORDS — session browser, read-only */}
      <PayrollArchiveCard />
    </div>
  )
}
