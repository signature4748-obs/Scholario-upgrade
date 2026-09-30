'use client'

/**
 * payroll-report-pdf — Principal-ready payroll session report (PDF).
 *
 * Follows the app's established export architecture (jsPDF + autotable,
 * same as the attendance monthly register) so the output looks like an
 * official school document, not a database dump:
 *   - Official header: school name, report title, academic session
 *   - Summary block: employees · payroll · paid · outstanding · payments
 *   - Employee register table (identity + frozen session totals)
 *   - Payment history table (every payment with method/reference/status)
 *   - Page numbers, repeated table headers, print-ready A4
 *
 * Works for BOTH sources of truth:
 *   - an archived session (frozen SessionPayrollArchive), and
 *   - the in-progress session (live SessionPayrollSnapshot),
 * labelled accordingly.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getSchoolProfile } from '@/lib/school-profile'
import type { ArchivedEmployeeRecord, SalaryPayment } from '@/lib/store/salary-store'

export interface PayrollReportInput {
  sessionId: string
  sessionLabel: string
  /** 'archived' = frozen historical record · 'live' = session in progress. */
  kind: 'archived' | 'live'
  archivedAt?: string
  archivedBy?: string
  records: ArchivedEmployeeRecord[]
  payments: SalaryPayment[]
  summary: {
    employees: number
    totalPayroll: number
    totalPaid: number
    totalOutstanding: number
    paymentsCount: number
  }
}

// jsPDF's built-in helvetica has no ₹ glyph — "Rs" renders correctly
// everywhere (screen, print, PDF viewers) and stays audit-legible.
const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_LABEL: Record<SalaryPayment['status'], string> = {
  'Confirmed': 'Confirmed',
  'Pending Receipt': 'Pending',
  'Not Received': 'Not Received',
  'Reversed': 'Reversed',
}

const paymentNotes = (p: SalaryPayment): string =>
  p.rejectionReason ? `Not received: ${p.rejectionReason}` : p.reversalReason ? `Reversed: ${p.reversalReason}` : ''

export function downloadPayrollReport(input: PayrollReportInput): void {
  // Report letterhead — the identity cascade (server → settings →
  // neutral); the sub-line prefers the tagline, else city · session.
  const school = getSchoolProfile()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 36

  const kindLabel = input.kind === 'archived' ? 'Archived record — read-only' : 'Session in progress'
  const generatedAt = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(16, 24, 40)
    doc.text(school.name, marginX, 46)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text(
      school.tagline || [school.city, school.academicYear ? `Session ${school.academicYear}` : ''].filter(Boolean).join(' · ') || '—',
      marginX, 60,
    )

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(16, 24, 40)
    doc.text('Payroll Report', marginX, 82)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    doc.text(`Academic Session ${input.sessionLabel}  ·  ${kindLabel}`, marginX, 96)
    doc.text(`Generated ${generatedAt}${input.kind === 'archived' && input.archivedAt ? `  ·  Archived ${fmtDate(input.archivedAt)} by ${input.archivedBy ?? 'Principal'}` : ''}`, marginX, 108)
  }

  const drawFooter = (page: number, total: number) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`${school.name} — payroll records for internal and audit use`, marginX, pageHeight - 20)
    doc.text(`Page ${page} of ${total}`, pageWidth - marginX, pageHeight - 20, { align: 'right' })
  }

  // ── Summary strip ────────────────────────────────────────────────────
  drawHeader()
  autoTable(doc, {
    startY: 122,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontStyle: 'bold', textColor: [16, 24, 40], halign: 'center' },
    head: [['Employees', 'Total Payroll', 'Total Paid', 'Outstanding', 'Payments']],
    body: [[
      String(input.summary.employees),
      inr(input.summary.totalPayroll),
      inr(input.summary.totalPaid),
      inr(input.summary.totalOutstanding),
      String(input.summary.paymentsCount),
    ]],
  })

  // ── Employee register ────────────────────────────────────────────────
  autoTable(doc, {
    margin: { left: marginX, right: marginX, top: 118 },
    theme: 'striped',
    styles: { fontSize: 7.2, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 101, 80], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['#', 'Employee', 'ID', 'Department', 'Designation', 'Salary / mo', 'Payable', 'Paid', 'Outstanding', 'Status']],
    body: input.records.map((r, i) => [
      String(i + 1),
      r.name,
      r.employeeCode,
      r.department,
      r.designation,
      r.monthlySalary ? inr(r.monthlySalary) : '—',
      inr(r.totalPayable),
      inr(r.totalPaid),
      r.outstanding > 0 ? inr(r.outstanding) : 'Clear',
      r.employmentStatus,
    ]),
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 78 },
      2: { cellWidth: 42 },
      3: { cellWidth: 62 },
      4: { cellWidth: 66 },
      5: { cellWidth: 46, halign: 'right' },
      6: { cellWidth: 50, halign: 'right' },
      7: { cellWidth: 50, halign: 'right' },
      8: { cellWidth: 54, halign: 'right' },
      9: { cellWidth: 40 },
    },
    didDrawPage: (data) => {
      if (data.pageNumber === 1) return // title block already drawn
      drawHeader()
    },
  })

  // ── Payment history ──────────────────────────────────────────────────
  doc.addPage()
  drawHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(16, 24, 40)
  doc.text('Payment History', marginX, 128)

  autoTable(doc, {
    startY: 136,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    styles: { fontSize: 7.5, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 101, 80], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['Date', 'Employee', 'Salary Period', 'Payable', 'Paid', 'Method', 'Reference', 'Status', 'Notes']],
    body: input.payments
      // Reversed payments are kept deliberately — a truthful audit trail
      // must show them (with their reversal reason), not hide them.
      .map((p) => [
        fmtDate(p.date),
        p.employeeName,
        p.monthLabel,
        p.netPayable ? inr(p.netPayable) : '—',
        inr(p.amount),
        p.method,
        p.reference ?? '—',
        STATUS_LABEL[p.status],
        paymentNotes(p),
      ]),
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 78 },
      2: { cellWidth: 50 },
      3: { cellWidth: 52, halign: 'right' },
      4: { cellWidth: 52, halign: 'right' },
      5: { cellWidth: 58 },
      6: { cellWidth: 62 },
      7: { cellWidth: 52 },
      8: { cellWidth: 70 },
    },
  })

  if (input.payments.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('No payments were recorded for this session.', marginX, 150)
  }

  // ── Page numbers ─────────────────────────────────────────────────────
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    drawFooter(i, total)
  }

  doc.save(`Payroll-Report-${input.sessionId}.pdf`)
}
