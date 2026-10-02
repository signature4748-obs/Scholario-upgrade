'use client'

/**
 * salary-payslip-pdf — the teacher's own monthly payslip, as a real PDF
 * download ("My Salary & Payments" → Payslips → Download PDF).
 *
 * PHASE 8B: the slip shows EXACTLY the fixed-monthly-salary record —
 * the configured Monthly Salary and the canonical payment that settled
 * the month. No earnings/deductions tables or net-pay arithmetic exist.
 *
 * Official document frame: school header, identity strip, amount-paid
 * band, payment details (paid-on / method / reference — only what
 * actually exists on the payment record), footer + timestamp.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { schoolPrintIdentity } from '@/lib/school-print-identity'

export interface TeacherPayslipInput {
  teacherName: string
  designation?: string
  employeeId: string
  monthLabel: string
  /** The configured fixed monthly salary (0 = not configured). */
  monthlySalary: number
  /** The amount actually paid for the month (the canonical row). */
  amountPaid: number
  payment: {
    paidOn: string
    method?: string | null
    reference?: string | null
  } | null
}

// jsPDF's built-in helvetica has no ₹ glyph — "Rs" renders correctly
// everywhere (screen, print, PDF viewers) and stays audit-legible.
const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "Rohan Mehta" + "Aug 2026" → "Payslip-RohanMehta-Aug2026.pdf" */
function payslipFileName(teacherName: string, monthLabel: string): string {
  const safe = (s: string) => s.replace(/\s+/g, '').replace(/[^A-Za-z0-9-]/g, '')
  return `Payslip-${safe(teacherName) || 'Teacher'}-${safe(monthLabel) || 'Month'}.pdf`
}

export function downloadTeacherPayslip(input: TeacherPayslipInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 40

  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // ── Official school header (active tenant identity — never a hardcoded
  //    demo school profile on another tenant's documents) ──────────────
  const schoolIdentity = schoolPrintIdentity()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(16, 24, 40)
  doc.text(schoolIdentity.name, marginX, 46)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(schoolIdentity.line2, marginX, 60)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(16, 24, 40)
  doc.text('Payslip', marginX, 92)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  doc.text(input.monthLabel, marginX, 106)

  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generated ${generatedAt}`, pageWidth - marginX, 106, { align: 'right' })

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.75)
  doc.line(marginX, 118, pageWidth - marginX, 118)

  // ── Identity strip ───────────────────────────────────────────────────
  const identity: Array<[string, string]> = [
    ['Employee Name', input.teacherName],
    ...(input.designation ? [['Designation', input.designation] as [string, string]] : []),
    ['Employee ID', input.employeeId || '—'],
  ]
  let y = 140
  identity.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(148, 163, 184)
    doc.text(label.toUpperCase(), marginX, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(16, 24, 40)
    doc.text(value, marginX + 110, y)
    y += 18
  })

  // ── Salary for the month — the fixed monthly salary record ─────────
  const tableStyles = {
    styles: { fontSize: 9, cellPadding: 5, lineColor: [226, 232, 240] as [number, number, number], lineWidth: 0.5 },
    headStyles: { fillColor: [22, 101, 80] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const, fontSize: 8 },
    columnStyles: { 1: { halign: 'right' as const } },
    margin: { left: marginX, right: marginX },
  }

  const rows: Array<[string, string]> = [
    ['Monthly Salary', input.monthlySalary > 0 ? inr(input.monthlySalary) : 'Not configured'],
  ]
  autoTable(doc, {
    startY: y + 2,
    theme: 'grid',
    ...tableStyles,
    head: [['Salary for the month', 'Amount']],
    body: rows,
  })
  const afterTables = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 80

  // ── Amount-paid band — the canonical payment record ───────────────
  const bandY = afterTables + 16
  const bandH = 26
  doc.setFillColor(22, 101, 80)
  doc.rect(marginX, bandY, pageWidth - marginX * 2, bandH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('AMOUNT PAID', marginX + 10, bandY + bandH / 2 + 3.5)
  doc.setFontSize(12)
  doc.text(inr(input.amountPaid), pageWidth - marginX - 10, bandY + bandH / 2 + 3.5, { align: 'right' })

  // ── Payment details ──────────────────────────────────────────────────
  let py = bandY + bandH + 26
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(16, 24, 40)
  doc.text('Payment Details', marginX, py)
  py += 6
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.5)
  doc.line(marginX, py, pageWidth - marginX, py)

  if (input.payment) {
    const details: Array<[string, string]> = [
      ['Paid On', fmtDate(input.payment.paidOn)],
      ...(input.payment.method ? [['Method', input.payment.method] as [string, string]] : []),
      ...(input.payment.reference ? [['Payment Reference', input.payment.reference] as [string, string]] : []),
    ]
    py += 14
    details.forEach(([label, value]) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(148, 163, 184)
      doc.text(label.toUpperCase(), marginX, py)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(16, 24, 40)
      doc.text(value, marginX + 130, py)
      py += 16
    })
  } else {
    py += 16
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(100, 116, 139)
    doc.text('No payment has been recorded for this month yet.', marginX, py)
  }

  // ── Footer ───────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240)
  doc.line(marginX, pageHeight - 40, pageWidth - marginX, pageHeight - 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(`${schoolIdentity.name} — system-generated payslip for employee records`, marginX, pageHeight - 26)
  doc.text(`Generated ${generatedAt}`, pageWidth - marginX, pageHeight - 26, { align: 'right' })

  doc.save(payslipFileName(input.teacherName, input.monthLabel))
}
