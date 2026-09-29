'use client'

/**
 * exams-pdf — Official PDF exports for the Examinations module.
 * Single merged file (was exams-pdf-real.ts + exams-pdf-extended.ts).
 * School info is passed in via SchoolContextDTO — no hardcoding.
 * AdmitCardConfig + ReportCardConfig toggles are honored by the generators.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  type ExamDTO,
  type StudentResult,
  type ExamAnalyticsDTO,
  type SeatAssignmentDTO,
  type AdmitCardStudent,
  type SchoolContextDTO,
  type AdmitCardConfigDTO,
  type ReportCardConfigDTO,
} from './types'

// ─── Shared helpers ──────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface PdfResult {
  filename: string
  blobUrl: string
}

function saveDoc(doc: jsPDF, filename: string): PdfResult {
  const blobUrl = doc.output('bloburl') as unknown as string
  doc.save(filename)
  return { filename, blobUrl }
}

function drawSchoolHeader(doc: jsPDF, school: SchoolContextDTO, subtitle?: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  // Optional logo (drawn as a placeholder square if logoUrl is set)
  if (school.logoUrl) {
    try {
      doc.addImage(school.logoUrl, 'PNG', 14, 10, 16, 16)
    } catch {
      // Ignore — image may be on a different origin
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(school.schoolName, pageWidth / 2, 18, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const addr = [school.address, school.city].filter(Boolean).join(', ')
  if (addr) doc.text(addr, pageWidth / 2, 25, { align: 'center' })
  const contact = [school.phone, school.email].filter(Boolean).join('  |  ')
  if (contact) doc.text(contact, pageWidth / 2, 30, { align: 'center' })
  if (subtitle) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(subtitle, pageWidth / 2, 40, { align: 'center' })
  }
  // Horizontal rule
  doc.setDrawColor(15, 118, 110)
  doc.setLineWidth(0.8)
  doc.line(14, 44, pageWidth - 14, 44)
}

// ─── 1. Class Grade Sheet (all students × all subjects) ──────────────

export function generateClassGradeSheetPDF(
  exam: ExamDTO,
  className: string,
  results: StudentResult[],
  analytics: ExamAnalyticsDTO,
  school: SchoolContextDTO,
): PdfResult {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  drawSchoolHeader(doc, school, `${exam.name} — Class ${className} Grade Sheet`)

  const head: string[][] = [['Roll', 'Name', ...results[0]?.subjects.map((s) => s.subjectName) ?? [], 'Total', '%', 'Grade', 'Rank']]
  const body: string[][] = results.map((r) => [
    r.rollNo ?? '—',
    r.studentName,
    ...(r.subjects.map((s) => (s.isAbsent ? 'AB' : s.marksObtained !== null ? String(s.marksObtained) : '—'))),
    `${r.totalObtained}/${r.totalMax}`,
    `${r.percentage.toFixed(1)}%`,
    r.grade,
    r.rank ? String(r.rank) : '—',
  ])

  autoTable(doc, {
    head,
    body,
    startY: 50,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 250, 249] },
    margin: { left: 14, right: 14 },
  })

  // Summary
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Summary — Pass ${analytics.passRate}% • Avg ${analytics.averagePercentage}% • Highest ${analytics.highestPercentage}% • Lowest ${analytics.lowestPercentage}%`, 14, endY)

  const filename = `${exam.name.replace(/\s+/g, '_')}_GradeSheet_${className}.pdf`
  return saveDoc(doc, filename)
}

// ─── 2. Single Student Report Card ──────────────────────────────────

export function generateStudentReportCardPDF(
  exam: ExamDTO,
  result: StudentResult,
  school: SchoolContextDTO,
  config: ReportCardConfigDTO,
): PdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  drawSchoolHeader(doc, school, `${exam.name} — Report Card`)

  // Student info box
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(result.studentName, 14, 56)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Roll No: ${result.rollNo ?? '—'}`, 14, 62)
  doc.text(`Class: ${result.className}`, 14, 67)
  if (school.academicYear) doc.text(`Academic Year: ${school.academicYear}`, 14, 72)
  if (exam.session) doc.text(`Session: ${exam.session}`, 120, 62)

  // Subject marks table
  const head = [['Subject', 'Max', 'Obtained', '%', 'Grade', 'Status']]
  const body = result.subjects.map((s) => [
    s.subjectName,
    String(s.maxMarks),
    s.isAbsent ? 'AB' : s.marksObtained !== null ? String(s.marksObtained) : '—',
    s.isAbsent ? '—' : `${s.percentage.toFixed(1)}%`,
    s.isAbsent ? '—' : s.passed ? 'PASS' : 'FAIL',
    s.isAbsent ? 'ABSENT' : '',
  ])
  if (config.showPercentage !== false) {
    // Append totals row
    body.push([
      'TOTAL',
      String(result.totalMax),
      String(result.totalObtained),
      `${result.percentage.toFixed(1)}%`,
      result.grade,
      result.passed ? 'PASS' : 'FAIL',
    ])
  }

  autoTable(doc, {
    head,
    body,
    startY: 78,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    columnStyles: { 5: { halign: 'center' } },
    margin: { left: 14, right: 14 },
  })

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Conditional blocks per ReportCardConfig
  if (config.showRank !== false && result.rank) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`Class Rank: ${result.rank}`, 14, y)
    y += 8
  }
  if (config.showPercentage !== false) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(`Overall: ${result.percentage.toFixed(2)}%  •  Grade: ${result.grade}`, 14, y)
    y += 10
  }
  if (config.showRemarks) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Remarks:', 14, y)
    doc.rect(14, y + 2, 180, 18)
    y += 26
  }
  if (config.showClassTeacherSign) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Class Teacher Signature', 14, y + 12)
    doc.line(14, y + 14, 80, y + 14)
  }
  if (config.showPrincipalSign) {
    doc.text('Principal Signature', 120, y + 12)
    doc.line(120, y + 14, 180, y + 14)
  }

  const filename = `${exam.name.replace(/\s+/g, '_')}_ReportCard_${result.studentName.replace(/\s+/g, '_')}.pdf`
  return saveDoc(doc, filename)
}

// ─── 3. Admit Card (batch — all students of a class) ─────────────────

export function generateBatchAdmitCardPDF(
  exam: ExamDTO,
  className: string,
  students: AdmitCardStudent[],
  school: SchoolContextDTO,
  config: AdmitCardConfigDTO,
  layout: '1' | '2' = '1',
): PdfResult {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  if (layout === '2') {
    // ─── 2-per-A4 Mode (paper-saving) ──────────────────────────
    let pairCount = 0
    for (let i = 0; i < students.length; i += 2) {
      if (pairCount > 0) doc.addPage()
      pairCount++

      // Top card (y: 10–135)
      drawAdmitCardCompact(doc, students[i], exam, school, config, 10)

      // Dotted cutting line with scissors
      const cutY = pageHeight / 2
      doc.setLineDashPattern([2, 2], 0)
      doc.setDrawColor(150)
      doc.setLineWidth(0.3)
      doc.line(10, cutY, pageWidth - 10, cutY)
      doc.setLineDashPattern([], 0)
      doc.setFontSize(7)
      doc.setTextColor(120)
      doc.text('✂', pageWidth / 2 - 2, cutY + 3)
      doc.setTextColor(0)

      // Bottom card (y: 150–275)
      if (students[i + 1]) {
        drawAdmitCardCompact(doc, students[i + 1], exam, school, config, cutY + 15)
      }
    }
  } else {
    // ─── 1-per-A4 Mode (standard) ──────────────────────────────
    students.forEach((s, idx) => {
      if (idx > 0) doc.addPage()
      drawAdmitCardFull(doc, s, exam, school, config)
    })
  }

  const filename = `${exam.name.replace(/\s+/g, '_')}_AdmitCards_${className}${layout === '2' ? '_2x' : ''}.pdf`
  return saveDoc(doc, filename)
}

/** Draw a compact admit card for 2-per-A4 mode. */
function drawAdmitCardCompact(doc: any, student: AdmitCardStudent, exam: ExamDTO, school: SchoolContextDTO, config: AdmitCardConfigDTO, startY: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 12

  // School header (compact)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(school.schoolName || 'School', pageWidth / 2, startY + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  if (school.address) doc.text(school.address, pageWidth / 2, startY + 7.5, { align: 'center' })
  doc.text(`${exam.name} · ${school.academicYear ?? ''}`, pageWidth / 2, startY + 10, { align: 'center' })

  // Admit Card label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setFillColor(15, 118, 110)
  doc.rect(margin, startY + 12, pageWidth - margin * 2, 5, 'F')
  doc.setTextColor(255)
  doc.text('EXAMINATION ADMIT CARD', pageWidth / 2, startY + 15.5, { align: 'center' })
  doc.setTextColor(0)

  // Student info (compact, two columns)
  let y = startY + 20
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(student.name, margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(`Class: ${student.className}${student.section ? ` (${student.section})` : ''}`, pageWidth - 60, y)
  y += 4
  if (config.showRollNumber) {
    doc.text(`Roll No: ${student.rollNo ?? '—'}`, margin, y)
  }
  if (student.stream && student.stream !== 'General') {
    doc.text(`Stream: ${student.stream}`, pageWidth - 60, y)
  }
  y += 4

  // Timetable (compact)
  if (config.showTimetable && student.schedule.length > 0) {
    const head = [['Subject', 'Date', 'Time', 'Room', 'Seat']]
    const body = student.schedule.map((sch: any) => [
      sch.subjectName.substring(0, 15),
      formatDate(sch.date),
      `${sch.startTime}-${sch.endTime}`,
      sch.room ?? '—',
      sch.seatNumber !== null ? String(sch.seatNumber) : '—',
    ])
    autoTable(doc, {
      head, body,
      startY: y,
      styles: { fontSize: 6, cellPadding: 1.2 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 6 },
      margin: { left: margin, right: margin },
    })
    y = (doc as any).lastAutoTable?.finalY + 3
  }

  // Instructions (compact, only 3 lines)
  if (config.showInstructions) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.text('Instructions:', margin, y)
    y += 3
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5)
    const inst = [
      '1. Report 15 min before exam time. 2. No mobile phones. 3. Follow seating plan.',
    ]
    for (const line of inst) {
      doc.text(line, margin, y)
      y += 3
    }
  }

  // Signature line
  doc.setFontSize(6)
  doc.text('Student Sign.', margin, startY + 125)
  doc.line(margin, startY + 126, margin + 30, startY + 126)
  doc.text('Principal Sign.', pageWidth - 42, startY + 125)
  doc.line(pageWidth - 42, startY + 126, pageWidth - 12, startY + 126)
}

/** Draw a full-page admit card for 1-per-A4 mode. */
function drawAdmitCardFull(doc: any, student: AdmitCardStudent, exam: ExamDTO, school: SchoolContextDTO, config: AdmitCardConfigDTO) {
  const pageWidth = doc.internal.pageSize.getWidth()

  // School header
  drawSchoolHeader(doc, school, `${exam.name} — Admit Card`)

  // Admit Card banner
  doc.setFillColor(15, 118, 110)
  doc.rect(14, 50, pageWidth - 28, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(255)
  doc.text('EXAMINATION ADMIT CARD', pageWidth / 2, 54, { align: 'center' })
  doc.setTextColor(0)

  // Student identity section
  let y = 62
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(student.name, 14, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (config.showRollNumber) {
    doc.text(`Roll No: ${student.rollNo ?? '—'}`, 14, y)
    y += 5
  }
  doc.text(`Class: ${student.className}${student.section ? ` (${student.section})` : ''}`, 14, y)
  if (student.stream && student.stream !== 'General') {
    doc.text(`Stream: ${student.stream}`, 100, y)
  }
  y += 5
  if (school.academicYear) {
    doc.text(`Session: ${school.academicYear}`, 14, y)
    y += 5
  }
  if (student.admissionNo) {
    doc.text(`Admission No: ${student.admissionNo}`, 100, y - 5)
  }
  // Exam date range
  if (exam.startDate && exam.endDate) {
    doc.text(`Exam Period: ${formatDate(exam.startDate)} — ${formatDate(exam.endDate)}`, 14, y)
    y += 5
  }
  y += 4

  // Timetable
  if (config.showTimetable && student.schedule.length > 0) {
    const head = [['Subject', 'Date', 'Day', 'Time', 'Room', 'Seat']]
    const body = student.schedule.map((sch: any) => {
      const day = new Date(sch.date).toLocaleDateString('en-IN', { weekday: 'short' })
      return [
        sch.subjectName,
        formatDate(sch.date),
        day,
        `${sch.startTime} - ${sch.endTime}`,
        sch.room ?? '—',
        sch.seatNumber !== null ? String(sch.seatNumber) : '—',
      ]
    })
    autoTable(doc, {
      head, body,
      startY: y,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255 },
      margin: { left: 14, right: 14 },
    })
    y = (doc as any).lastAutoTable?.finalY + 8
  }

  // Instructions
  if (config.showInstructions) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Examination Instructions:', 14, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const instructions = [
      '1. Report to the examination hall 15 minutes before the scheduled time.',
      '2. Bring your own stationery. Borrowing is not permitted during the exam.',
      '3. Mobile phones and smart devices are strictly prohibited.',
      '4. Any form of malpractice will lead to disqualification.',
      '5. Follow the seating plan displayed outside the examination hall.',
    ]
    for (const line of instructions) {
      doc.text(line, 14, y)
      y += 4
    }
  }

  // Signatures
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Student Signature', 14, 280)
  doc.line(14, 282, 60, 282)
  doc.text('Principal Signature', pageWidth - 60, 280)
  doc.line(pageWidth - 60, 282, pageWidth - 14, 282)
}

// ─── 4. Seating Plan (room-by-room layout) ───────────────────────────

export function generateSeatingPlanPDF(
  exam: ExamDTO,
  seatAssignments: SeatAssignmentDTO[],
  school: SchoolContextDTO,
): PdfResult {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  drawSchoolHeader(doc, school, `${exam.name} — Seating Plan`)

  // Group by room
  const byRoom = new Map<string, SeatAssignmentDTO[]>()
  for (const s of seatAssignments) {
    if (!byRoom.has(s.room)) byRoom.set(s.room, [])
    byRoom.get(s.room)!.push(s)
  }

  const rooms = Array.from(byRoom.keys()).sort()
  let y = 52
  for (const room of rooms) {
    const seats = byRoom.get(room)!
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`Room: ${room}  (${seats.length} students)`, 14, y)
    y += 4

    const head = [['Seat #', 'Roll', 'Student Name', 'Class']]
    const body = seats
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((s) => [String(s.seatNumber), s.studentRollNo ?? '—', s.studentName, s.className])

    autoTable(doc, {
      head,
      body,
      startY: y,
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255 },
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    if (y > 180) {
      doc.addPage()
      y = 20
    }
  }

  const filename = `${exam.name.replace(/\s+/g, '_')}_SeatingPlan.pdf`
  return saveDoc(doc, filename)
}
