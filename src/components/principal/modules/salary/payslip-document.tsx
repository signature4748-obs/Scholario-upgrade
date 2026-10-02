'use client'

/**
 * PayslipDocument — a minimal school salary slip.
 *
 * PHASE 8B: the slip shows EXACTLY the fixed-monthly-salary model —
 * the configured Monthly Salary and the payment record that settled the
 * month. No gross/deduction/net blocks exist (the school's payroll model
 * has no components); nothing is independently calculated.
 *
 * Visual direction: "Payment detail card + small school-document header".
 * The same quiet label-left / value-right rhythm as PaymentDetailDialog,
 * compact spacing, hairline dividers, restrained badges.
 *
 * Print: window.print() prints ONLY this document (print CSS isolates
 * .payslip-print), with an A5 PORTRAIT default page size so the slip fits
 * one page. No mention of paper size on the document itself.
 */

import { Check } from 'lucide-react'

import { useSchoolProfile } from '@/lib/school-profile'
import { amountInWordsINR } from '@/lib/format'
import type { SalaryPayment } from '@/lib/store/salary-store'
import { periodLabel } from '@/lib/store/salary-store'
import { fmtDayYear } from './salary-shared'

// ─── Slip identity ───────────────────────────────────────────────────

/** Stable, human slip no. — e.g. EMP-014 · 2026-08 → SLIP-2026-08-0014 */
function slipNumberFor(employeeId: string, periodKey: string): string {
  const digits = employeeId.match(/(\d+)\s*$/)?.[1]
  const tail = digits ? digits.padStart(4, '0') : employeeId || '0000'
  return `SLIP-${periodKey}-${tail}`
}

// ─── Print ───────────────────────────────────────────────────────────

/**
 * Prints ONLY the salary slip, nothing else.
 *
 * The slip is cloned into a dedicated #print-root element at document.body
 * level, every other top-level element (app shell, dialogs, portals, toasts)
 * is display:none while the body carries .salary-printing. Restored on
 * afterprint.
 */
export function printPayslip(): void {
  const node = document.querySelector('.payslip-print')
  if (!node) return window.print()

  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.appendChild(root)
  }
  root.replaceChildren(node.cloneNode(true))
  document.body.classList.add('salary-printing')

  const cleanup = () => {
    document.body.classList.remove('salary-printing')
    root?.replaceChildren()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  // Safety net: browsers that never fire afterprint (or cancel paths).
  setTimeout(cleanup, 60_000)

  window.print()
}

// ─── Document ────────────────────────────────────────────────────────

export interface PayslipDocumentProps {
  /** Teacher identity (canonical Teacher row). */
  teacher: {
    name: string
    employeeId: string
    department: string
  }
  /** The configured fixed monthly salary (null = not configured). */
  structure: { monthlyAmount: number; effectiveFrom: string | null } | null
  /** 'YYYY-MM' */
  periodKey: string
  /** The canonical RECORDED payment for the month (null = not paid yet). */
  payment: SalaryPayment | null
}

export function PayslipDocument({
  teacher, structure, periodKey, payment,
}: PayslipDocumentProps) {
  // Letterhead identity — the sanctioned school-profile cascade (server
  // identity → settings → neutral), never a hardcoded demo school.
  const school = useSchoolProfile()
  const recorded = payment?.status === 'RECORDED'
  const monthName = periodLabel(periodKey)
  const slipNo = slipNumberFor(teacher.employeeId, periodKey)

  return (
    <div
      className="payslip-print bg-white text-slate-800 rounded-lg border border-slate-200 shadow-sm"
      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
    >
      {/* ── School header (small, professional) ── */}
      <div className="px-5 pt-5 pb-3.5 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-slate-800 text-[13px] font-bold leading-none">
          {school.shortName.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-bold tracking-[0.08em] uppercase leading-snug break-words">{school.name}</p>
          {school.address && <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">{school.address}</p>}
          {(school.phone || school.email) && (
            <p className="text-[9px] text-slate-500">
              {[school.phone ? `Ph ${school.phone}` : null, school.email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className="text-[10px] font-bold tracking-[0.22em] uppercase text-slate-700">Salary Slip</p>
          <p className="text-[11px] font-semibold mt-0.5">{monthName}</p>
        </div>
      </div>

      <div className="border-t border-slate-200" />

      {/* ── Employee ── */}
      <div className="px-5 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Employee</p>
        <p className="text-[14px] font-bold leading-tight mt-1">{teacher.name}</p>
        {teacher.department && <p className="text-[11px] text-slate-600 mt-0.5">{teacher.department}</p>}
        <p className="text-[11px] text-slate-600">
          Employee ID: <span className="font-mono">{teacher.employeeId || '—'}</span>
        </p>
      </div>

      <div className="border-t border-slate-200" />

      {/* ── Salary details — the fixed monthly salary only ── */}
      <div className="px-5 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Salary Details</p>
        <table className="w-full">
          <tbody>
            <tr className="border-b border-dashed border-slate-100">
              <td className="py-1 text-[11px] text-slate-700">Monthly Salary</td>
              <td className="py-1 text-right text-[11px] tabular-nums text-slate-800">
                {structure ? `₹${Math.round(structure.monthlyAmount).toLocaleString('en-IN')}` : 'Not configured'}
              </td>
            </tr>
            {structure?.effectiveFrom && (
              <tr className="border-b border-dashed border-slate-100 last:border-b-0">
                <td className="py-1 text-[11px] text-slate-600">Effective From</td>
                <td className="py-1 text-right text-[11px] tabular-nums text-slate-600">{fmtDayYear(structure.effectiveFrom)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Amount paid band — the canonical payment record for the month */}
        <div className="mt-2.5 pt-2.5 border-t-[1.5px] border-slate-700 flex items-end justify-between gap-3">
          <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-700 pb-0.5">Amount Paid</p>
          <p className="text-[19px] font-bold tabular-nums leading-none">
            {payment ? `₹${Math.round(payment.amount).toLocaleString('en-IN')}` : '—'}
          </p>
        </div>
        {payment && (
          <p className="text-[9px] italic text-slate-400 mt-1.5">{amountInWordsINR(payment.amount)}</p>
        )}
      </div>

      <div className="border-t border-slate-200" />

      {/* ── Payment details ── */}
      <div className="px-5 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Payment Details</p>
        <div className="space-y-1.5">
          <DetailRow
            label="Payment Status"
            value={
              recorded ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} /> Recorded
                </span>
              ) : payment ? (
                <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  Voided
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Not recorded yet
                </span>
              )
            }
          />
          <DetailRow label="Paid On" value={payment ? fmtDayYear(payment.paidOn) : '—'} />
          <DetailRow label="Payment Method" value={payment?.method ?? '—'} />
          {payment?.reference && (
            <DetailRow label="Payment Reference" value={<span className="font-mono text-[11px]">{payment.reference}</span>} />
          )}
          {payment?.note && <DetailRow label="Note" value={payment.note} />}
          <DetailRow label="Salary Slip No." value={<span className="font-mono text-[11px] font-semibold">{slipNo}</span>} />
        </div>
      </div>

      <div className="border-t border-slate-200" />

      {/* ── Footer ── */}
      <div className="px-5 py-3 flex items-center justify-between gap-4">
        <p className="text-[8.5px] text-slate-400">
          System-generated salary slip · SCHOLARIO
        </p>
        <div className="text-right">
          <p className="text-[8.5px] text-slate-400">For {school.name}</p>
          <p className="text-[9.5px] font-semibold text-slate-600 border-t border-slate-300 mt-1 pl-6">School Administration</p>
        </div>
      </div>

      <style jsx global>{`
        /* The cloned print root is screen-invisible; it only exists while printing. */
        #print-root { display: none; }
        @media print {
          /* A5 portrait default — compact one-page slip. The user can still
             choose another paper size in the browser's print dialog. */
          @page { size: A5 portrait; margin: 9mm; }
          html, body {
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            background: #fff !important;
          }
          /* While printing a slip: only #print-root stays in the layout. */
          body.salary-printing > *:not(#print-root) { display: none !important; }
          body.salary-printing #print-root { display: block !important; }
          .payslip-print {
            box-shadow: none !important;
            border-radius: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Document primitives (payment-detail-card rhythm) ────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="text-slate-400 shrink-0 pt-px">{label}</span>
      <span className="font-medium text-slate-700 text-right">{value}</span>
    </div>
  )
}
