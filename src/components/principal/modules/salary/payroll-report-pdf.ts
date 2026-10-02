'use client'

/**
 * payroll-report-pdf — Principal-ready payroll session report (PDF).
 *
 * PHASE 8B: the report renders the CANONICAL server payroll — fixed
 * monthly salaries + RECORDED payments. Totals are sums of RECORDED
 * amounts (no payable/outstanding arithmetic is invented: "payroll" is
 * the configured monthly commitment, "paid" is what was actually
 * recorded). Follows the app's established export architecture (jsPDF +
 * autotable, same as the attendance monthly register):
 *   - Official header: school name, report title, academic session
 *   - Summary block: employees · monthly payroll · recorded · payments
 *   - Employee register table (identity + recorded totals)
 *   - Payment history table (every payment with method/reference/status)
 *   - Page numbers, repeated table headers, print-ready A4
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getSchoolProfile } from '@/lib/school-profile'
import type { SalaryPayment, SalaryTeacher } from '@/lib/store/salary-store'
import { METHOD_LABELS } from '@/lib/store/salary-store'

export interface PayrollReportInput {
  sessionId: string
  sessionLabel: string
  /** True when the session month range includes the current month. */
  isCurrent: boolean
  /** Teacher-month scope of the report (for the header line). */
  monthRangeLabel?: string
  teachers: SalaryTeacher[]
  structures: Array<{ teacherId: string; monthlyAmount: number }>
  payments: SalaryPayment[]
  summary: {
    employees: number
    /** Sum of configured monthly salaries (the payroll commitment). */
    monthlyPayroll: number
    /** Sum of RECORDED amounts in the session. */
    recordedTotal: number
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

const STATUS_LABEL: Record<string, string> = {
  RECORDED: 'Recorded',
  VOIDED: 'Voided',
}

function methodLabel(method: string | null): string {
  return method && method in METHOD_LABELS ? METHOD_LABELS[method as keyof typeof METHOD_LABELS] : (method ?? '—')
}

export function downloadPayrollReport(input: PayrollReportInput): void {
  // Report letterhead — the identity cascade (server → settings →
  // neutral); the sub-line prefers the tagline, else city · session.
  const school = getSchoolProfile()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 36

  const kindLabel = input.isCurrent ? 'Session in progress' : 'Historical record — read-only'
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
    doc.text(`Generated ${generatedAt}`, marginX, 108)
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
    head: [['Teachers', 'Monthly Payroll', 'Recorded Paid', 'Payments']],
    body: [[
      String(input.summary.employees),
      inr(input.summary.monthlyPayroll),
      inr(input.summary.recordedTotal),
      String(input.summary.paymentsCount),
    ]],
  })

  // ── Employee register ────────────────────────────────────────────────
  const structureByTeacher = new Map(input.structures.map((s) => [s.teacherId, s]))
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]))

  autoTable(doc, {
    margin: { left: marginX, right: marginX, top: 118 },
    theme: 'striped',
    styles: { fontSize: 7.2, cellPadding: 3.5, lineColor: [226, 232, 240], lineWidth: 0.4, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 101, 80], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['#', 'Teacher', 'ID', 'Department', 'Salary / mo', 'Recorded', 'Payments']],
    body: Array.from(new Set(input.payments.map((p) => p.teacherId))).map((teacherId, i) => {
      const t = teacherById.get(teacherId)
      const monthly = structureByTeacher.get(teacherId)?.monthlyAmount ?? 0
      const empPayments = input.payments.filter((p) => p.teacherId === teacherId && p.status === 'RECORDED')
      return [
        String(i + 1),
        t?.name ?? '—',
        t?.employeeId ?? '—',
        t?.department ?? '—',
        monthly > 0 ? inr(monthly) : '—',
        inr(empPayments.reduce((s, p) => s + p.amount, 0)),
        String(empPayments.length),
      ]
    }),
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 96 },
      2: { cellWidth: 52 },
      3: { cellWidth: 84 },
      4: { cellWidth: 54, halign: 'right' },
      5: { cellWidth: 54, halign: 'right' },
      6: { cellWidth: 42, halign: 'center' },
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
    head: [['Date', 'Teacher', 'Salary Month', 'Amount', 'Method', 'Reference', 'Status', 'Note']],
    body: input.payments
      // VOIDED payments are kept deliberately — a truthful audit trail
      // must show them, not hide them.
      .slice()
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
      .map((p) => [
        fmtDate(p.paidOn),
        teacherById.get(p.teacherId)?.name ?? '—',
        p.month,
        inr(p.amount),
        methodLabel(p.method),
        p.reference ?? '—',
        STATUS_LABEL[p.status] ?? p.status,
        p.note ?? '',
      ]),
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 90 },
      2: { cellWidth: 54 },
      3: { cellWidth: 52, halign: 'right' },
      4: { cellWidth: 58 },
      5: { cellWidth: 62 },
      6: { cellWidth: 44 },
      7: { cellWidth: 66 },
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
