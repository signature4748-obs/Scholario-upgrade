'use client'

/**
 * monthly-report-pdf — Official Excel-style monthly attendance PDF reports.
 *
 * Brief PART 30-39 (Phase 8):
 *   - Looks like an official school attendance register printed from Excel
 *   - NOT a dashboard/card UI — structured rows + columns + borders
 *   - Professional header with school name, report title, month, scope
 *   - Working-day calculation respects school calendar
 *   - Page numbers, repeated headers, print-ready A4
 *   - Semantic text colors (Present=green, Absent=red, Late=amber, Leave=blue)
 *   - Holidays shown as "HOLIDAY" (not counted as absent)
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { school } from '@/lib/mock/school'
import {
  classSections,
  STAFF_DEFS,
} from '@/lib/mock/attendance'
import {
  isHoliday as isSchoolHoliday,
  isWeekend,
} from '@/lib/mock/school-calendar'

function formatMonthLabel(monthValue: string): string {
  const [y, m] = monthValue.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  })
}

function getDaysInMonth(year: number, month: number): { dateStr: string; day: number; isWorking: boolean; isWeekend: boolean; isHoliday: boolean; holidayName?: string }[] {
  const days: { dateStr: string; day: number; isWorking: boolean; isWeekend: boolean; isHoliday: boolean; holidayName?: string }[] = []
  const daysInMonth = new Date(year, month, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const weekend = isWeekend(dateStr)
    const holiday = isSchoolHoliday(dateStr)
    days.push({
      dateStr,
      day: d,
      isWorking: !weekend && !holiday,
      isWeekend: weekend,
      isHoliday: holiday,
    })
  }
  return days
}

function getWorkingDaysCount(days: ReturnType<typeof getDaysInMonth>): number {
  return days.filter((d) => d.isWorking).length
}

// Deterministic per-student-per-date status
function getStudentStatus(dateStr: string, rollNo: string): 'P' | 'A' | 'L' | 'LV' | 'H' | '—' {
  const today = '2025-12-10'
  if (dateStr > today) return '—'
  if (isWeekend(dateStr)) return '—'
  if (isSchoolHoliday(dateStr)) return 'H'
  let seed = 0
  const key = `${dateStr}-${rollNo}`
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0
  const r = seed / 0x7fffffff
  if (r < 0.88) return 'P'
  if (r < 0.93) return 'L'
  if (r < 0.97) return 'LV'
  return 'A'
}

function getStaffStatus(dateStr: string, staffId: string): 'P' | 'A' | 'L' | 'LV' | 'H' | '—' {
  const today = '2025-12-10'
  if (dateStr > today) return '—'
  if (isWeekend(dateStr)) return '—'
  if (isSchoolHoliday(dateStr)) return 'H'
  let seed = 0
  const key = `${dateStr}-${staffId}`
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0
  const r = seed / 0x7fffffff
  if (r < 0.88) return 'P'
  if (r < 0.93) return 'L'
  if (r < 0.97) return 'LV'
  return 'A'
}

const STATUS_COLORS: Record<string, [number, number, number]> = {
  P: [16, 185, 129],   // emerald
  A: [244, 63, 94],     // rose
  L: [245, 158, 11],    // amber
  LV: [14, 165, 233],   // sky
  H: [139, 92, 246],    // violet
  '—': [150, 150, 150], // gray
}

/* ──────────────────────────────────────────────────────────
   Brief PART 31-35: Student Monthly PDF — Excel-style
   ────────────────────────────────────────────────────────── */
export function generateStudentMonthlyPDF(
  monthValue: string,
  classFilter: string = 'all'
): { filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const monthLabel = formatMonthLabel(monthValue)
  const [year, month] = monthValue.split('-').map(Number)
  const days = getDaysInMonth(year, month)
  const workingDays = getWorkingDaysCount(days)
  const today = '2025-12-10'
  const applicableWorkingDays = days.filter((d) => d.isWorking && d.dateStr <= today).length

  const targetClasses = classFilter === 'all'
    ? classSections
    : classSections.filter((c) => c.id === classFilter)

  const pageWidth = doc.internal.pageSize.getWidth()

  // ── REPORT HEADER (Brief PART 32) ──
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(school.name.toUpperCase(), pageWidth / 2, 14, { align: 'center' })

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('MONTHLY ATTENDANCE REPORT', pageWidth / 2, 20, { align: 'center' })

  doc.setFontSize(10)
  doc.text(monthLabel.toUpperCase(), pageWidth / 2, 26, { align: 'center' })

  const scopeLabel = classFilter !== 'all'
    ? classSections.find((c) => c.id === classFilter)?.name || ''
    : 'ALL CLASSES'
  doc.text(scopeLabel, pageWidth / 2, 32, { align: 'center' })

  // Thin separator line
  doc.setLineWidth(0.5)
  doc.line(14, 36, pageWidth - 14, 36)

  // ── METADATA ROW (Brief PART 32) ──
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Working Days: ${workingDays}`, 14, 42)
  doc.text(`Applicable Days: ${applicableWorkingDays}`, 60, 42)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 60, 42)

  let yPos = 48

  for (const cls of targetClasses) {
    // Class section header
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(`CLASS: ${cls.name}`, 14, yPos)
    doc.setFont('helvetica', 'normal')
    doc.text(`(Class Teacher: ${cls.teacher} · ${cls.total} students)`, 14 + doc.getTextWidth(`CLASS: ${cls.name}`) + 5, yPos)
    yPos += 4

    // Build per-student summary rows
    const studentRows = cls.roster.map((s, idx) => {
      let present = 0, late = 0, absent = 0, leave = 0
      for (const d of days) {
        if (!d.isWorking || d.dateStr > today) continue
        const st = getStudentStatus(d.dateStr, s.rollNo)
        if (st === 'P') present++
        else if (st === 'L') late++
        else if (st === 'A') absent++
        else if (st === 'LV') leave++
      }
      const totalMarked = present + late + absent + leave
      const rate = totalMarked > 0 ? ((present + late) / totalMarked * 100).toFixed(1) + '%' : '—'
      return [
        String(idx + 1),
        s.rollNo,
        s.name,
        String(applicableWorkingDays),
        String(present),
        String(absent),
        String(late),
        String(leave),
        rate,
      ]
    })

    // Class summary row
    const classTotalPresent = studentRows.reduce((s, r) => s + parseInt(r[4]), 0)
    const classTotalAbsent = studentRows.reduce((s, r) => s + parseInt(r[5]), 0)
    const classTotalLate = studentRows.reduce((s, r) => s + parseInt(r[6]), 0)
    const classTotalLeave = studentRows.reduce((s, r) => s + parseInt(r[7]), 0)
    const classAvgRate = studentRows.length > 0
      ? (studentRows.reduce((s, r) => s + parseFloat(r[8].replace('%', '') || '0'), 0) / studentRows.length).toFixed(1) + '%'
      : '—'

    autoTable(doc, {
      startY: yPos,
      head: [['S.No.', 'Roll', 'Student Name', 'Days', 'Present', 'Absent', 'Late', 'Leave', 'Att %']],
      body: studentRows,
      foot: [['', '', 'CLASS TOTAL', String(applicableWorkingDays), String(classTotalPresent), String(classTotalAbsent), String(classTotalLate), String(classTotalLeave), classAvgRate]],
      theme: 'grid',
      headStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontSize: 7, fontStyle: 'bold', lineColor: [180, 180, 180], lineWidth: 0.2 },
      bodyStyles: { fontSize: 7, lineColor: [200, 200, 200], lineWidth: 0.1 },
      footStyles: { fillColor: [245, 245, 245], textColor: [40, 40, 40], fontSize: 7, fontStyle: 'bold', lineColor: [180, 180, 180], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 12, halign: 'center' },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 12, halign: 'center' },
        4: { cellWidth: 16, halign: 'center', textColor: STATUS_COLORS.P },
        5: { cellWidth: 16, halign: 'center', textColor: STATUS_COLORS.A },
        6: { cellWidth: 14, halign: 'center', textColor: STATUS_COLORS.L },
        7: { cellWidth: 14, halign: 'center', textColor: STATUS_COLORS.LV },
        8: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    })

    // @ts-expect-error
    yPos = doc.lastAutoTable.finalY + 8

    if (yPos > 170) {
      doc.addPage()
      yPos = 20
    }
  }

  // ── PAGE FOOTER (Brief PART 39) ──
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(`${school.shortName} · Scholario-OS`, 14, doc.internal.pageSize.getHeight() - 6)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 30, doc.internal.pageSize.getHeight() - 6)
    doc.setTextColor(0)
  }

  const filename = classFilter !== 'all'
    ? `SCHOLARIO_${classSections.find((c) => c.id === classFilter)?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Class'}_Attendance_${monthValue}.pdf`
    : `SCHOLARIO_Student_Attendance_All_Classes_${monthValue}.pdf`
  doc.save(filename)
  return { filename }
}

/* ──────────────────────────────────────────────────────────
   Brief PART 36-37: Staff Monthly PDF — Excel-style
   ────────────────────────────────────────────────────────── */
export function generateStaffMonthlyPDF(monthValue: string): { filename: string } {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const monthLabel = formatMonthLabel(monthValue)
  const [year, month] = monthValue.split('-').map(Number)
  const days = getDaysInMonth(year, month)
  const workingDays = getWorkingDaysCount(days)
  const today = '2025-12-10'
  const applicableWorkingDays = days.filter((d) => d.isWorking && d.dateStr <= today).length
  const pageWidth = doc.internal.pageSize.getWidth()

  // ── REPORT HEADER (Brief PART 36) ──
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(school.name.toUpperCase(), pageWidth / 2, 14, { align: 'center' })

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('TEACHERS & EMPLOYEES', pageWidth / 2, 20, { align: 'center' })
  doc.text('MONTHLY ATTENDANCE REPORT', pageWidth / 2, 26, { align: 'center' })

  doc.setFontSize(10)
  doc.text(monthLabel.toUpperCase(), pageWidth / 2, 32, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(14, 36, pageWidth - 14, 36)

  doc.setFontSize(8)
  doc.text(`Working Days: ${workingDays}`, 14, 42)
  doc.text(`Staff: ${STAFF_DEFS.length}`, 60, 42)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 60, 42)

  // ── STAFF SUMMARY TABLE (Brief PART 36) ──
  const staffRows = STAFF_DEFS.map((s, idx) => {
    let present = 0, late = 0, absent = 0, leave = 0
    for (const d of days) {
      if (!d.isWorking || d.dateStr > today) continue
      const st = getStaffStatus(d.dateStr, s.id)
      if (st === 'P') present++
      else if (st === 'L') late++
      else if (st === 'A') absent++
      else if (st === 'LV') leave++
    }
    const totalMarked = present + late + absent + leave
    const rate = totalMarked > 0 ? ((present + late) / totalMarked * 100).toFixed(1) + '%' : '—'
    return [
      String(idx + 1),
      s.id,
      s.name,
      s.role,
      s.department,
      String(applicableWorkingDays),
      String(present),
      String(late),
      String(absent),
      String(leave),
      rate,
    ]
  })

  // Totals row
  const totalPresent = staffRows.reduce((s, r) => s + parseInt(r[6]), 0)
  const totalLate = staffRows.reduce((s, r) => s + parseInt(r[7]), 0)
  const totalAbsent = staffRows.reduce((s, r) => s + parseInt(r[8]), 0)
  const totalLeave = staffRows.reduce((s, r) => s + parseInt(r[9]), 0)
  const avgRate = staffRows.length > 0
    ? (staffRows.reduce((s, r) => s + parseFloat(r[10].replace('%', '') || '0'), 0) / staffRows.length).toFixed(1) + '%'
    : '—'

  autoTable(doc, {
    startY: 48,
    head: [['S.No.', 'Emp ID', 'Name', 'Role', 'Department', 'Days', 'Present', 'Late', 'Absent', 'Leave', 'Att %']],
    body: staffRows,
    foot: [['', '', 'TOTAL', '', '', String(applicableWorkingDays), String(totalPresent), String(totalLate), String(totalAbsent), String(totalLeave), avgRate]],
    theme: 'grid',
    headStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontSize: 7, fontStyle: 'bold', lineColor: [180, 180, 180], lineWidth: 0.2 },
    bodyStyles: { fontSize: 7, lineColor: [200, 200, 200], lineWidth: 0.1 },
    footStyles: { fillColor: [245, 245, 245], textColor: [40, 40, 40], fontSize: 7, fontStyle: 'bold', lineColor: [180, 180, 180], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 16, halign: 'center' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 22 },
      4: { cellWidth: 28 },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 16, halign: 'center', textColor: STATUS_COLORS.P },
      7: { cellWidth: 14, halign: 'center', textColor: STATUS_COLORS.L },
      8: { cellWidth: 16, halign: 'center', textColor: STATUS_COLORS.A },
      9: { cellWidth: 14, halign: 'center', textColor: STATUS_COLORS.LV },
      10: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Page footer
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(`${school.shortName} · Scholario-OS`, 14, doc.internal.pageSize.getHeight() - 6)
      doc.text(`Page ${data.pageNumber}`, pageWidth - 30, doc.internal.pageSize.getHeight() - 6)
      doc.setTextColor(0)
    },
  })

  const filename = `SCHOLARIO_Teachers_Employees_Attendance_${monthValue}.pdf`
  doc.save(filename)
  return { filename }
}
