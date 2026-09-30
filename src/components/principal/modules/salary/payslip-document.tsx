'use client'

/**
 * PayslipDocument — a minimal school salary slip.
 *
 * Visual direction: "Payment detail card + small school-document header".
 * The same quiet label-left / value-right rhythm as PaymentDetailDialog,
 * compact spacing, hairline dividers, restrained badges — NOT a corporate
 * payroll dashboard. Only real salary/payment data appears here.
 *
 * Every number comes from the salary store's single calculation path:
 * gross − deductions must land exactly on payable. Nothing is an
 * independent calculation.
 *
 * Print: window.print() prints ONLY this document (print CSS isolates
 * .payslip-print), with an A5 PORTRAIT default page size so the slip fits
 * one page without oversized A4 output. The user can still pick another
 * paper size manually. No mention of paper size on the document itself.
 */

import { Check } from 'lucide-react'

import { useSchoolProfile } from '@/lib/school-profile'
import { amountInWordsINR } from '@/lib/format'
import type {
  Employee, MonthlyAdjustment, SalaryPayment, SessionSalary,
} from '@/lib/store/salary-store'
import { periodLabel } from '@/lib/store/salary-store'
import { fmtDayYear } from './salary-shared'

// ─── Slip identity ───────────────────────────────────────────────────

/** Stable, human slip no. — e.g. EMP-014 · 2026-08 → SLIP-2026-08-0014 */
function slipNumberFor(employee: Pick<Employee, 'employeeId'>, periodKey: string): string {
  const digits = employee.employeeId.match(/(\d+)\s*$/)?.[1]
  const tail = digits ? digits.padStart(4, '0') : employee.employeeId
  return `SLIP-${periodKey}-${tail}`
}

/** The month's primary payment line for the details block. */
function primaryPayment(payments: SalaryPayment[]): SalaryPayment | null {
  return payments.find((p) => p.status === 'Confirmed')
    ?? payments.find((p) => p.status === 'Pending Receipt')
    ?? payments.find((p) => p.status === 'Not Received')
    ?? null
}

// ─── Print ───────────────────────────────────────────────────────────

/**
 * Prints ONLY the salary slip, nothing else.
 *
 * The slip is cloned into a dedicated #print-root element at document.body
 * level, every other top-level element (app shell, dialogs, portals, toasts)
 * is display:none while the body carries .salary-printing. This avoids the
 * classic clipping bug where the slip lives inside a scrolling dialog and
 * the old visibility-hack printed half a page. Restored on afterprint.
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
  employee: Employee
  session: SessionSalary
  periodKey: string
  /** Month adjustments for this employee (already inside `payable`). */
  adjustments: MonthlyAdjustment[]
  /** This employee's payments for the month (reversed excluded). */
  payments: SalaryPayment[]
  /** Net payable for the month (session net + adjustments). */
  payable: number
}

export function PayslipDocument({
  employee, session, periodKey, adjustments, payments, payable,
}: PayslipDocumentProps) {
  // Letterhead identity — the sanctioned school-profile cascade (server
  // identity → settings → neutral), never a hardcoded demo school.
  const school = useSchoolProfile()
  // Structure components + month adjustments = the full slip line items.
  const earningLines = [
    ...session.earnings,
    ...adjustments.filter((a) => a.amount > 0).map((a) => ({ name: a.label, type: 'Earning' as const, amount: a.amount })),
  ]
  const deductionLines = [
    ...session.deductions,
    ...adjustments.filter((a) => a.amount < 0).map((a) => ({ name: a.label, type: 'Deduction' as const, amount: Math.abs(a.amount) })),
  ]
  const gross = earningLines.reduce((s, c) => s + c.amount, 0)
  const totalDeductions = deductionLines.reduce((s, c) => s + c.amount, 0)

  const primary = primaryPayment(payments)
  const confirmed = payments.some((p) => p.status === 'Confirmed')
  const monthName = periodLabel(periodKey)
  const slipNo = slipNumberFor(employee, periodKey)

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
        <p className="text-[14px] font-bold leading-tight mt-1">{employee.name}</p>
        <p className="text-[11px] text-slate-600 mt-0.5">{employee.designation} · {employee.department}</p>
        <p className="text-[11px] text-slate-600">
          Employee ID: <span className="font-mono">{employee.employeeId}</span>
        </p>
      </div>

      <div className="border-t border-slate-200" />

      {/* ── Salary details — configuration-driven ── */}
      <div className="px-5 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Salary Details</p>

        {(session.mode ?? 'detailed') === 'simple' ? (
          <>
            {/* SIMPLE — the Principal's configured Monthly Salary and any
                actual adjustments. No gross/deduction lines are invented. */}
            <table className="w-full">
              <tbody>
                <AmountRow name="Monthly Salary" amount={session.netBase} />
                {adjustments.filter((a) => a.amount > 0).map((a) => (
                  <AmountRow key={`sa-${a.id}`} name={a.label} amount={a.amount} />
                ))}
                {adjustments.filter((a) => a.amount < 0).map((a) => (
                  <AmountRow key={`sd-${a.id}`} name={a.label} amount={a.amount} />
                ))}
              </tbody>
            </table>

            <div className="mt-2.5 pt-2.5 border-t-[1.5px] border-slate-700 flex items-end justify-between gap-3">
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-700 pb-0.5">Amount Payable</p>
              <p className="text-[19px] font-bold tabular-nums leading-none">{`₹${Math.round(payable).toLocaleString('en-IN')}`}</p>
            </div>
            <p className="text-[9px] italic text-slate-400 mt-1.5">{amountInWordsINR(payable)}</p>
          </>
        ) : (
          <>
            <table className="w-full">
              <tbody>
                {earningLines.map((c, i) => (
                  <AmountRow key={`e-${c.name}-${i}`} name={c.name} amount={c.amount} />
                ))}
                {deductionLines.map((c, i) => (
                  <AmountRow key={`d-${c.name}-${i}`} name={c.name} amount={-c.amount} muted />
                ))}
                {deductionLines.length === 0 && (
                  <tr><td colSpan={2} className="py-1 text-[10px] italic text-slate-400">No deductions</td></tr>
                )}
              </tbody>
            </table>

            {/* Subtotals */}
            <div className="mt-2 pt-2 border-t border-dashed border-slate-300 space-y-1">
              <SubtotalRow label="Gross Earnings" value={`₹${gross.toLocaleString('en-IN')}`} />
              <SubtotalRow label="Total Deductions" value={`₹${totalDeductions.toLocaleString('en-IN')}`} />
            </div>

            {/* Net pay */}
            <div className="mt-2.5 pt-2.5 border-t-[1.5px] border-slate-700 flex items-end justify-between gap-3">
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-slate-700 pb-0.5">Net Pay</p>
              <p className="text-[19px] font-bold tabular-nums leading-none">{`₹${Math.round(payable).toLocaleString('en-IN')}`}</p>
            </div>
            <p className="text-[9px] italic text-slate-400 mt-1.5">{amountInWordsINR(payable)}</p>
          </>
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
              confirmed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} /> Paid
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Pending Receipt
                </span>
              )
            }
          />
          <DetailRow label="Payment Date" value={primary ? fmtDayYear(primary.date) : '—'} />
          <DetailRow label="Payment Method" value={primary?.method ?? '—'} />
          {primary?.reference && (
            <DetailRow label="Payment Reference" value={<span className="font-mono text-[11px]">{primary.reference}</span>} />
          )}
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

function SubtotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[10px]">
      <span className="uppercase tracking-wider font-semibold text-slate-500">{label}</span>
      <span className="font-bold tabular-nums text-slate-700">{value}</span>
    </div>
  )
}

function AmountRow({ name, amount, muted = false }: { name: string; amount: number; muted?: boolean }) {
  return (
    <tr className="border-b border-dashed border-slate-100 last:border-b-0">
      <td className={`py-1 text-[11px] ${muted ? 'text-slate-600' : 'text-slate-700'}`}>{name}</td>
      <td className={`py-1 text-right text-[11px] tabular-nums ${muted ? 'text-slate-500' : 'text-slate-800'}`}>
        {`${amount < 0 ? '-₹' : '₹'}${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`}
      </td>
    </tr>
  )
}
