import { FileText } from 'lucide-react'
import { formatINR } from '@/lib/format'
import type { AdmissionLetterData } from './types'

/** THREE-STATE cell: configured amount → INR; UNDEFINED → "Not configured".
 *  Never a fabricated ₹0 on an official document (PR-3 spec, finding F7). */
function amountOr(amount: number | undefined): string {
  return amount === undefined ? 'Not configured' : formatINR(amount)
}

/**
 * Official fee summary — a restrained institutional table. Amounts come
 * from the application's own fee record (Fee Management configuration +
 * the applicant's selections). No payment-status claims, no receipt
 * references — receipts are separate documents.
 */
export function FeeBreakdownTable({ data }: { data: AdmissionLetterData }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 mb-2">
        <FileText className="h-3.5 w-3.5 text-slate-500" /> Fee Summary
      </h3>

      <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
          <table className="w-full text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase">
              <tr>
                <th className="p-2.5">Fee Head / Component</th>
                <th className="p-2.5 text-right">Amount (INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {data.fees.registrationFee !== undefined && (
                <tr>
                  <td className="p-2">Registration Fee</td>
                  <td className="p-2 text-right font-mono">{amountOr(data.fees.registrationFee)}</td>
                </tr>
              )}
              <tr>
                <td className="p-2">Admission Fee (One-Time)</td>
                <td className="p-2 text-right font-mono">{amountOr(data.fees.admissionFee)}</td>
              </tr>
              <tr>
                <td className="p-2">Annual Tuition Fee</td>
                <td className="p-2 text-right font-mono">{amountOr(data.fees.tuitionFee)}</td>
              </tr>
              {(data.fees.booksTotal || 0) > 0 && (
                <tr>
                  <td className="p-2">Textbooks & Course Material</td>
                  <td className="p-2 text-right font-mono">{formatINR(data.fees.booksTotal || 0)}</td>
                </tr>
              )}
              {(data.fees.examFee || 0) > 0 && (
                <tr>
                  <td className="p-2">Examination & Assessment</td>
                  <td className="p-2 text-right font-mono">{formatINR(data.fees.examFee || 0)}</td>
                </tr>
              )}
              {(data.fees.otherHeadsTotal || 0) > 0 && (
                <tr>
                  <td className="p-2">Development & Other Charges</td>
                  <td className="p-2 text-right font-mono">{formatINR(data.fees.otherHeadsTotal || 0)}</td>
                </tr>
              )}
              {(data.fees.transportFee || 0) > 0 && (
                <tr>
                  <td className="p-2">Transport Fee</td>
                  <td className="p-2 text-right font-mono">{formatINR(data.fees.transportFee || 0)}</td>
                </tr>
              )}
              <tr className="bg-slate-50 font-bold text-slate-800">
                <td className="p-2">Fee Subtotal</td>
                <td className="p-2 text-right font-mono">{amountOr(data.fees.subtotal ?? data.fees.totalAnnualFee)}</td>
              </tr>
              {((data.fees.discountAmount || 0) > 0) && (
                <tr className="bg-emerald-50/70 text-emerald-900 font-bold">
                  <td className="p-2">Concession{data.fees.discountName ? ` — ${data.fees.discountName}` : ''}</td>
                  <td className="p-2 text-right font-mono text-emerald-800">- {formatINR(data.fees.discountAmount || 0)}</td>
                </tr>
              )}
              <tr className="bg-slate-900 text-white font-extrabold text-sm">
                <td className="p-2.5 uppercase tracking-wider">Net Payable Amount</td>
                <td className="p-2.5 text-right font-mono">{amountOr(data.fees.finalPayable)}</td>
              </tr>
            </tbody>
          </table>
      </div>
      <p className="text-[9px] text-slate-500 mt-1.5 italic">
        Payment terms and the installment schedule are specified in the enclosed fee schedule. Receipts are issued separately on payment.
      </p>
    </div>
  )
}
