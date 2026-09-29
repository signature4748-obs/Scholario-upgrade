'use client'

/**
 * timetable-export — the teacher's personal timetable as real documents.
 *
 *   PDF  (jsPDF + autotable, same architecture as the payslip / payroll
 *         reports): A4 LANDSCAPE weekly grid — print-ready, no app chrome,
 *         professional school-document frame (header, rule, footer).
 *   DOCX (the `docx` package): a GENUINE editable Word document —
 *         heading block + a real Word table (Day | Period | Time |
 *         Subject | Class | Room) with editable text in every cell.
 *         NOT a screenshot pasted into a document.
 *
 * Both exports are generated from the SAME validated timetable data the
 * on-screen module renders (/api/teacher/timetable — every cell already
 * gated by the Principal's ClassSubjectAssignment configuration).
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import { schoolPrintIdentity } from '@/lib/school-print-identity'

export interface TimetableExportCell {
  day: string
  period: number
  startTime: string | null
  endTime: string | null
  subjectName: string
  classLabel: string
  room: string | null
}

export interface TimetableExportInput {
  teacherName: string
  session: string | null
  days: string[]
  periodTimes: { period: number; startTime: string | null; endTime: string | null }[]
  cells: TimetableExportCell[]
}

// ── Shared helpers ─────────────────────────────────────────────────────

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PERIOD_LABEL = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']

function dayRank(day: string): number {
  const i = DAY_ORDER.indexOf(day)
  return i === -1 ? DAY_ORDER.length : i
}

function timeRange(start: string | null, end: string | null): string {
  const fmt = (t: string | null) => {
    if (!t) return ''
    const m = t.match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return t
    let h = Number(m[1])
    const ap = h >= 12 ? 'PM' : 'AM'
    h = h % 12 === 0 ? 12 : h % 12
    return `${h}:${m[2]} ${ap}`
  }
  if (!start && !end) return '—'
  return `${fmt(start)}${end ? ` – ${fmt(end)}` : ''}`
}

function safeFileName(teacherName: string, ext: string): string {
  const safe = teacherName.replace(/\s+/g, '').replace(/[^A-Za-z0-9-]/g, '') || 'Teacher'
  return `Teacher-Timetable-${safe}.${ext}`
}

function sortedCells(cells: TimetableExportCell[]): TimetableExportCell[] {
  return [...cells].sort((a, b) => dayRank(a.day) - dayRank(b.day) || a.period - b.period)
}

function generatedAtLabel(): string {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── PDF (A4 landscape weekly grid) ────────────────────────────────────

export function downloadTeacherTimetablePdf(input: TimetableExportInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginX = 32

  // ── Document header ──────────────────────────────────────────────────
  const identity = schoolPrintIdentity()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(16, 24, 40)
  doc.text(identity.name, marginX, 40)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  doc.text(identity.line2, marginX, 53)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(16, 24, 40)
  doc.text('Teacher Timetable', marginX, 78)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  const sessionLine = `Teacher: ${input.teacherName}`
    + (input.session ? `   ·   Academic Session: ${input.session.replace('-', '–')}` : '')
  doc.text(sessionLine, marginX, 92)

  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`Generated ${generatedAtLabel()}`, pageWidth - marginX, 92, { align: 'right' })

  doc.setDrawColor(22, 101, 80)
  doc.setLineWidth(1.2)
  doc.line(marginX, 100, pageWidth - marginX, 100)

  // ── Weekly grid ──────────────────────────────────────────────────────
  // Rows = periods (with real times), columns = the school's teaching days.
  const days = input.days.length > 0 ? input.days : DAY_ORDER.slice(0, 6)
  const periods = input.periodTimes.length > 0
    ? input.periodTimes
    : [...new Set(input.cells.map((c) => c.period))].sort((a, b) => a - b)
        .map((p) => ({ period: p, startTime: null, endTime: null }))

  const bySlot = new Map<string, TimetableExportCell[]>()
  for (const c of input.cells) {
    const k = `${c.day}|${c.period}`
    const arr = bySlot.get(k) ?? []
    arr.push(c)
    bySlot.set(k, arr)
  }

  const head = [['Period', 'Time', ...days]]
  const body = periods.map((pt) => {
    const row = [
      PERIOD_LABEL[pt.period - 1] ?? `P${pt.period}`,
      timeRange(pt.startTime, pt.endTime),
    ]
    for (const d of days) {
      const cellCells = bySlot.get(`${d}|${pt.period}`) ?? []
      if (cellCells.length === 0) row.push('—')
      else if (cellCells.length === 1) {
        const c = cellCells[0]
        row.push(`${c.subjectName}\n${c.classLabel}${c.room ? `\n${c.room}` : ''}`)
      } else {
        // Multiple entries in one slot (a conflict) — every entry is shown.
        row.push(cellCells.map((c) => `${c.subjectName} · ${c.classLabel}`).join('\n'))
      }
    }
    return row
  })

  autoTable(doc, {
    startY: 112,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 4,
      lineColor: [226, 232, 240] as [number, number, number],
      lineWidth: 0.5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [22, 101, 80] as [number, number, number],
      textColor: [255, 255, 255] as [number, number, number],
      fontStyle: 'bold' as const,
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 42, halign: 'center', fontStyle: 'bold' as const },
      1: { cellWidth: 84, fontSize: 6.5, textColor: [100, 116, 139] as [number, number, number] },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    margin: { left: marginX, right: marginX },
    head,
    body,
  })

  // ── Footer ───────────────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.75)
  doc.line(marginX, pageHeight - 30, pageWidth - marginX, pageHeight - 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(148, 163, 184)
  doc.text(`${identity.name} — system-generated teacher timetable`, marginX, pageHeight - 18)
  doc.text(`Generated ${generatedAtLabel()}`, pageWidth - marginX, pageHeight - 18, { align: 'right' })

  doc.save(safeFileName(input.teacherName, 'pdf'))
}

// ── DOCX (real editable Word table) ───────────────────────────────────

const INK = '1F2937'
const MUTED = '64748B'
const BRAND = '166550'
const ROW_ALT = 'F8FAFC'

export async function downloadTeacherTimetableDocx(input: TimetableExportInput): Promise<void> {
  const sessionLabel = input.session ? input.session.replace('-', '–') : ''
  const identity = schoolPrintIdentity()

  const heading = (text: string, size: number, opts: { bold?: boolean; color?: string; spacingBefore?: number; spacingAfter?: number } = {}) =>
    new Paragraph({
      spacing: { before: opts.spacingBefore ?? 0, after: opts.spacingAfter ?? 2 },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: opts.bold ?? false, size, color: opts.color ?? INK, font: 'Calibri' })],
    })

  const thinBorders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
  }

  const cell = (text: string, opts: { bold?: boolean; color?: string; fill?: string; width?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new TableCell({
      width: opts.width != null ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold ?? false, size: 18, color: opts.color ?? INK, font: 'Calibri' })],
      })],
    })

  // Header row — the exact suggested structure.
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('Day', { bold: true, color: 'FFFFFF', fill: BRAND, width: 12 }),
      cell('Period', { bold: true, color: 'FFFFFF', fill: BRAND, width: 9, align: AlignmentType.CENTER }),
      cell('Time', { bold: true, color: 'FFFFFF', fill: BRAND, width: 19 }),
      cell('Subject', { bold: true, color: 'FFFFFF', fill: BRAND, width: 20 }),
      cell('Class', { bold: true, color: 'FFFFFF', fill: BRAND, width: 20 }),
      cell('Room', { bold: true, color: 'FFFFFF', fill: BRAND, width: 20 }),
    ],
  })

  const rows = sortedCells(input.cells).map((c, i) => {
    const fill = i % 2 === 1 ? ROW_ALT : undefined
    return new TableRow({
      children: [
        cell(c.day, { bold: true, fill, width: 12 }),
        cell(PERIOD_LABEL[c.period - 1] ?? `P${c.period}`, { fill, width: 9, align: AlignmentType.CENTER }),
        cell(timeRange(c.startTime, c.endTime), { fill, width: 19, color: MUTED }),
        cell(c.subjectName, { bold: true, fill, width: 20 }),
        cell(c.classLabel, { fill, width: 20 }),
        cell(c.room ?? '—', { fill, width: 20, color: MUTED }),
      ],
    })
  })

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      ...thinBorders,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
    rows: [headerRow, ...rows],
  })

  const doc = new Document({
    creator: 'SCHOLARIO',
    title: `Teacher Timetable — ${input.teacherName}`,
    description: `Weekly teaching timetable for ${input.teacherName}${sessionLabel ? ` · Academic Session ${sessionLabel}` : ''}`,
    sections: [{
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 900, right: 900 },
        },
      },
      children: [
        heading('SCHOLARIO', 32, { bold: true, color: BRAND, spacingAfter: 2 }),
        heading('Teacher Timetable', 44, { bold: true, spacingAfter: 10 }),
        heading(`Teacher: ${input.teacherName}`, 22, { spacingAfter: 2 }),
        ...(sessionLabel ? [heading(`Academic Session: ${sessionLabel}`, 22, { color: MUTED, spacingAfter: 2 })] : []),
        heading(`Weekly teaching schedule · ${input.cells.length} periods`, 18, { color: MUTED, spacingAfter: 14 }),
        table,
        heading('', 18, { spacingAfter: 8 }),
        heading(
          `${identity.name} — system-generated timetable · Generated ${generatedAtLabel()}`,
          15, { color: MUTED },
        ),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(input.teacherName, 'docx')
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
