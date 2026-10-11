'use client'

import { useRef } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/shared/ui'
import { formatDate, formatINR } from '@/lib/format'
import { useSchoolProfile } from '@/lib/school-profile'
import { printIsolated } from '@/lib/print-isolate'
import { computeFeeSnapshot } from '../../../FeeStructureStep/fee-snapshot'
import { defaultFeeDataState } from '../../../FeeStructureStep/types'
import type { AdmissionApplication } from '@/lib/store/admission-store'
import type { IssuanceArtifacts, ServerFeeStatement } from './letter-data'

interface FeeReceiptTabProps {
  app: AdmissionApplication
  artifacts: IssuanceArtifacts
  /** FEE-ADMISSIONS MVP — server-issued fee statement (immutable snapshot
   * once enrolled; provisional quote before). Null → legacy pipeline. */
  serverFees?: ServerFeeStatement | null
}

/**
 * FINANCIAL RECORD — the admission fee settlement receipt. Every amount
 * comes from the applicant's own fee snapshot (same pipeline as the Fee
 * step and the admission letter). No hardcoded figures, no invented
 * receipt numbers: the receipt number derives from the admission number.
 *
 * FEE-ADMISSIONS MVP: server-linked applications render the EXACT
 * server-issued line items (one row per head with its quantity) — the
 * persisted immutable snapshot once enrolled.
 */
export function FeeReceiptTab({ app, artifacts, serverFees }: FeeReceiptTabProps) {
  const school = useSchoolProfile()
  const sheetRef = useRef<HTMLDivElement>(null)
  const { admissionNo } = artifacts
  const formData = app.formData

  // ── LEGACY pipeline (no server link) — unchanged ───────────────────
  const feeState = { ...defaultFeeDataState, ...(app.feeData || {}) }
  const snap = computeFeeSnapshot(formData.className || '', feeState, {
    enableTransport: true,
    enableHostel: true,
  })

  // Deterministic receipt number derived from the admission number.
  const tail = admissionNo.replace(/[^0-9A-Z]/g, '').slice(-6)
  const receiptNo = `REC-${new Date().getFullYear()}-${tail}`
  const today = new Date().toISOString().split('T')[0]

  const rows: { label: string; amount: number }[] = serverFees
    ? serverFees.lineItems.map((li) => ({
        label:
          li.quantity > 1
            ? `${li.name} (× ${li.quantity} @ ${formatINR(li.unitAmount)})`
            : li.name,
        amount: li.amount,
      }))
    : [
        { label: 'Registration Fee', amount: snap.registrationFee },
        { label: 'Admission Fee (One-Time)', amount: snap.admissionFee },
        { label: 'Annual Tuition Fee', amount: snap.tuitionFee },
      ].concat(
        snap.examTotal > 0 ? [{ label: 'Examination & Assessment', amount: snap.examTotal }] : [],
        snap.booksTotal > 0 ? [{ label: 'Textbooks & Course Material', amount: snap.booksTotal }] : [],
        snap.uniformTotal > 0 ? [{ label: 'Uniform', amount: snap.uniformTotal }] : [],
        snap.activityKitTotal > 0 ? [{ label: 'Activity Kit', amount: snap.activityKitTotal }] : [],
        snap.transportTotal > 0 ? [{ label: 'Transport Fee', amount: snap.transportTotal }] : [],
        snap.hostelTotal > 0 ? [{ label: 'Hostel Fee', amount: snap.hostelTotal }] : [],
        snap.otherHeadsTotal > 0 ? [{ label: 'Other Fee Heads', amount: snap.otherHeadsTotal }] : [],
      )

  const gross = serverFees
    ? serverFees.totalAmount + serverFees.discountAmount
    : snap.grossFee
  const discountAmount = serverFees ? serverFees.discountAmount : snap.discountAmount
  const discountName = serverFees ? (serverFees.discountName ?? undefined) : snap.discountName
  const net = serverFees ? serverFees.totalAmount : snap.netTotal

  return (
    <GlassCard ref={sheetRef} className="p-6 max-w-2xl mx-auto space-y-6 border">
      <div className="flex justify-between items-start border-b pb-4">
        <div>
          <h3 className="font-extrabold text-lg">Fee Receipt</h3>
          <p className="text-xs text-muted-foreground">{school.name}</p>
          {serverFees?.kind === 'snapshot' && (
            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
              Issued from the server&apos;s immutable fee snapshot
              {serverFees.issuedAt ? ` · ${formatDate(serverFees.issuedAt)}` : ''}
            </p>
          )}
          {serverFees?.kind === 'quote' && (
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
              Provisional — finalized from the immutable snapshot at enrolment
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="text-xs font-mono font-bold block">Receipt No: {receiptNo}</span>
          <span className="text-xs text-muted-foreground">Date: {formatDate(today)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Student Name</span>
          <span className="font-bold text-sm text-foreground">{formData.firstName} {formData.lastName}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Class & Section</span>
          <span className="font-bold text-foreground">{formData.className} - {formData.section}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Admission No.</span>
          <span className="font-mono font-bold">{admissionNo}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-[10px] uppercase font-bold">Session</span>
          <span className="font-semibold">{app.academicSession}</span>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden text-xs">
        <div className="grid grid-cols-12 p-2.5 bg-muted/60 font-bold uppercase text-[10px]">
          <div className="col-span-8">Fee Particulars</div>
          <div className="col-span-4 text-right">Amount (INR)</div>
        </div>
        <div className="divide-y">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between p-2.5">
              <span>{r.label}</span>
              <span className="font-mono">{formatINR(r.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between p-2.5 bg-muted/40 font-bold">
            <span>Fee Subtotal</span>
            <span className="font-mono">{formatINR(gross)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between p-2.5 text-emerald-600 font-semibold">
              <span>Concession{discountName ? ` — ${discountName}` : ''}</span>
              <span className="font-mono">- {formatINR(discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-extrabold text-sm p-2.5">
            <span>Net Payable</span>
            <span className="font-mono text-emerald-700 dark:text-emerald-300">{formatINR(net)}</span>
          </div>
        </div>
      </div>

      <div className="pt-2 flex justify-end gap-2 print:hidden">
        <Button size="sm" variant="outline" onClick={() => printIsolated(sheetRef.current)} className="text-xs">
          <Printer className="h-3.5 w-3.5 mr-1" />
          Print Receipt
        </Button>
      </div>
    </GlassCard>
  )
}
