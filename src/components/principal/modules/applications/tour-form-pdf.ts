'use client'

/**
 * tour-form-pdf — REAL A4 PDF exports for the built-in
 * "Educational Tour — Parent Consent Form", in BOTH document layouts
 * (AF-TPL): 'classic' (formal office document) and 'modern' (airy
 * Scholario layout). Every artefact is a genuine PDF drawn with jsPDF's
 * vector primitives — the same export infrastructure the Examinations /
 * Salary / Attendance modules use. No HTML blobs, no browser-page
 * substitutes: exact A4 geometry, print-safe margins, Times (serif)
 * typography.
 *
 *   • downloadTourFormPDF        — blank OR one completed form (one A4 page)
 *   • downloadTourFormsBundlePDF — many completed forms    (one page each)
 *   • downloadTourAttendancePDF  — trip attendance / master list (A4 landscape)
 *   • tourPdfFileName            — canonical artefact naming
 *
 * Notes:
 *   • jsPDF's built-in Times has no ₹ glyph — amounts render as "Rs 2,500"
 *     (same convention as the payroll PDF export).
 *   • Devanagari cannot be embedded with the standard font set, so the
 *     PDF title block stays English-only (the on-screen/print document
 *     keeps सहमति पत्र).
 *   • The drawn guardian signature (PNG data-URL) is embedded 1:1; the
 *     typed signature renders in Times italic exactly like the A4 page.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store/store'
import {
  deriveSubmissionPayment, docTemplateOf,
  type SchoolApplication, type ApplicationSubmission, type SubmissionPaymentInfo,
} from '@/lib/store/applications-store'
import { formatINR, formatDate } from '@/lib/format'

// ─── Geometry (A4 portrait, mm) — per-template skins ───────────────────

const PAGE_W = 210

const INK = { main: '#111', soft: '#333', mid: '#444', mute: '#555', faint: '#666', rule: '#b5b5b5', dotted: '#777', light: '#999' }

/** ₹ is not renderable in the standard fonts — "Rs 2,500" instead. */
function inr(amount: number): string {
  return formatINR(amount).replace(/^₹/, 'Rs ')
}

interface PdfSkin {
  /** Content margins. */
  ml: number
  mr: number
  mt: number
  /** Column layout. */
  colGap: number
  /** One field row (single-line) height + per wrapped line. */
  rowH: number
  rowLineH: number
  /** Rule weights — blank dotted / filled hairline. */
  blankWeight: number
  filledWeight: number
  blankDot: [number, number]
  /** Section titles. */
  sectionGap: number
  sectionRule: boolean
  /** Header + circular row treatment. */
  header: 'classic' | 'modern'
  /** Declaration. */
  declBoxed: boolean
  declLineH: number
  declItemGap: number
  declPlaceGap: number
  /** Signatures. */
  sigH: number
  sigMarginTop: number
  sigRule: 'dotted' | 'solid'
  /** Office-use strip. */
  officeMarginTop: number
  officeRule: 'dashed' | 'solid'
}

const CLASSIC_SKIN: PdfSkin = {
  ml: 13, mr: 13, mt: 12,
  colGap: 7,
  rowH: 4.2, rowLineH: 3.1,
  blankWeight: 0.35, filledWeight: 0.2,
  blankDot: [0.45, 0.6],
  sectionGap: 3.2, sectionRule: true,
  header: 'classic',
  declBoxed: true, declLineH: 3.1, declItemGap: 0.9, declPlaceGap: 4.5,
  sigH: 10, sigMarginTop: 4, sigRule: 'dotted',
  officeMarginTop: 4, officeRule: 'dashed',
}

const MODERN_SKIN: PdfSkin = {
  ml: 16, mr: 16, mt: 12,
  colGap: 9,
  rowH: 5.2, rowLineH: 3.2,
  blankWeight: 0.3, filledWeight: 0.18,
  blankDot: [0.4, 0.55],
  sectionGap: 5.3, sectionRule: false,
  header: 'modern',
  declBoxed: false, declLineH: 4.0, declItemGap: 0.8, declPlaceGap: 5.2,
  sigH: 10, sigMarginTop: 5.8, sigRule: 'solid',
  officeMarginTop: 5.5, officeRule: 'solid',
}

function skinOf(app: SchoolApplication): PdfSkin {
  return docTemplateOf(app) === 'modern' ? MODERN_SKIN : CLASSIC_SKIN
}

/** Right margin as an x coordinate (page edge minus margin). */
function rightX(k: PdfSkin): number {
  return PAGE_W - k.mr
}

/** Content width for a skin. */
function contentW(k: PdfSkin): number {
  return PAGE_W - k.ml - k.mr
}

// ─── Field row engine (the "label …… value-on-rule" rows) ─────────────

interface FieldRow {
  label: string
  value?: string
  /** Spans the full content width. */
  wide?: boolean
  /** Monospace value (admission numbers etc.). */
  mono?: boolean
}

function drawFieldRows(doc: jsPDF, y: number, rows: FieldRow[], k: PdfSkin): number {
  const cw = contentW(k)
  const colW = (cw - k.colGap) / 2
  let cursor = y
  let i = 0
  while (i < rows.length) {
    const left = rows[i]
    if (left.wide) {
      // Full-width row (address, emergency contact, medical note…).
      const lines = renderCell(doc, k.ml, left, cw, cursor, k)
      cursor += k.rowH + (lines - 1) * k.rowLineH
      i += 1
      continue
    }
    const right = (i + 1 < rows.length && !rows[i + 1].wide) ? rows[i + 1] : undefined
    const leftLines = renderCell(doc, k.ml, left, colW, cursor, k)
    const rightLines = right
      ? renderCell(doc, k.ml + colW + k.colGap, right, colW, cursor, k)
      : 1
    cursor += k.rowH + (Math.max(leftLines, rightLines) - 1) * k.rowLineH
    i += right ? 2 : 1
  }
  return cursor
}

/** Draws one label + value-on-rule cell; returns the number of value lines. */
function renderCell(doc: jsPDF, x: number, row: FieldRow, w: number, y: number, k: PdfSkin): number {
  const label = row.label.toUpperCase()
  doc.setFont('times', 'bold')
  doc.setFontSize(k.header === 'modern' ? 5.75 : 6)
  doc.setTextColor(k.header === 'modern' ? '#6a6a6a' : INK.soft)
  const labelW = doc.getTextWidth(label) + label.length * (k.header === 'modern' ? 0.17 : 0.22)
  doc.text(label, x, y + 2.7, { charSpace: k.header === 'modern' ? 0.17 : 0.22 })

  const ruleX = x + labelW + 2.2
  const ruleW = Math.max(8, x + w - ruleX)

  doc.setDrawColor(INK.dotted)
  if (row.value !== undefined && row.value !== '') {
    const valueFont = row.mono ? 'courier' : 'times'
    doc.setFont(valueFont, 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(INK.main)
    // Wrap DOWNWARD: the first value line sits on the label baseline, wrapped
    // lines follow below, and the fill rule runs under the LAST line.
    const lines = doc.splitTextToSize(row.value, ruleW - 1) as string[]
    const list = Array.isArray(lines) ? lines : [String(lines)]
    for (let c = 0; c < list.length; c++) {
      doc.text(list[c], ruleX, y + 3.1 + c * k.rowLineH)
    }
    const lastRuleY = y + 3.4 + (list.length - 1) * k.rowLineH
    doc.setDrawColor(INK.rule)
    doc.setLineWidth(k.filledWeight)
    doc.setLineDashPattern([], 0)
    doc.line(ruleX, lastRuleY, x + w, lastRuleY)
    return list.length
  }
  // Blank copy — the classic dotted fill-in rule.
  const ruleY = y + 3.4
  doc.setLineWidth(k.blankWeight)
  doc.setLineDashPattern(k.blankDot, 0)
  doc.line(ruleX, ruleY, x + w, ruleY)
  doc.setLineDashPattern([], 0)
  return 1
}

/** Section heading — classic: caps + a rule to the margin; modern: bare caps. */
function drawSectionTitle(doc: jsPDF, y: number, text: string, k: PdfSkin): number {
  const label = text.toUpperCase()
  doc.setFont('times', k.header === 'modern' ? 'normal' : 'bold')
  doc.setFontSize(k.header === 'modern' ? 6.25 : 7)
  doc.setTextColor(k.header === 'modern' ? '#6a6a6a' : INK.main)
  const cs = k.header === 'modern' ? 0.62 : 0.5
  const w = doc.getTextWidth(label) + label.length * cs
  doc.text(label, k.ml, y + 3.4, { charSpace: cs })
  if (k.sectionRule) {
    doc.setDrawColor(INK.light)
    doc.setLineWidth(0.2)
    doc.setLineDashPattern([], 0)
    doc.line(k.ml + w + 2.5, y + 2.9, rightX(k), y + 2.9)
  }
  return y + (k.header === 'modern' ? 4.8 : 4.6)
}

// ─── School header (emblem · name · affiliation · address · photo box) ──

interface SchoolCtx {
  schoolName: string
  logoText: string
  affiliation: string
  address: string
  contact: string
}

function schoolCtx(): SchoolCtx {
  const g = useSchoolSettingsStore.getState().general
  const schoolName = g.schoolName?.trim() || 'School'
  const logoText = (g.logoText || schoolName.split(/\s+/).slice(0, 2).map((word) => word[0]).join('')).toUpperCase()
  return {
    schoolName,
    logoText,
    affiliation: g.affiliation ?? '',
    address: g.address ?? '',
    contact: [g.phone && `Phone: ${g.phone}`, g.email && `E-mail: ${g.email}`].filter(Boolean).join('  ·  '),
  }
}

function drawSchoolHeader(doc: jsPDF, s: SchoolCtx, y: number, k: PdfSkin): number {
  const modern = k.header === 'modern'
  // Emblem — classic: double ring; modern: single hairline circle.
  doc.setDrawColor(INK.soft)
  doc.setLineWidth(modern ? 0.25 : 0.4)
  doc.setLineDashPattern([], 0)
  const em = modern ? 5.5 : 7.5
  doc.circle(k.ml + em, y + em, em, 'S')
  if (!modern) {
    doc.setDrawColor(INK.mid)
    doc.setLineWidth(0.2)
    doc.circle(k.ml + em, y + em, em - 1.4, 'S')
  }
  doc.setFont('times', 'bold')
  doc.setFontSize(modern ? 8 : 10)
  doc.setTextColor(INK.main)
  doc.text(s.logoText.slice(0, 4), k.ml + em, y + em + (modern ? 1.2 : 1.4), { align: 'center' })

  // Student photograph box (dashed) — 22×28 on both layouts.
  const px = rightX(k) - 22
  doc.setDrawColor(modern ? '#aaa' : INK.mid)
  doc.setLineWidth(modern ? 0.25 : 0.3)
  doc.setLineDashPattern([0.9, 0.7], 0)
  doc.line(px, y, px + 22, y)
  doc.line(px + 22, y, px + 22, y + 28)
  doc.line(px + 22, y + 28, px, y + 28)
  doc.line(px, y + 28, px, y)
  doc.setLineDashPattern([], 0)
  doc.setFont('times', 'normal')
  doc.setFontSize(4.5)
  doc.setTextColor(modern ? '#888' : INK.faint)
  doc.text('Affix recent', px + 11, y + 10, { align: 'center' })
  doc.text('passport-size', px + 11, y + 12, { align: 'center' })
  doc.text('photograph', px + 11, y + 14, { align: 'center' })

  // Name · affiliation · address · contact (centred block).
  const cx = PAGE_W / 2
  doc.setFont('times', 'bold')
  doc.setFontSize(modern ? 10.5 : 13.5)
  doc.setTextColor(INK.main)
  doc.text(
    s.schoolName.toUpperCase(), cx, y + (modern ? 5.6 : 6),
    { align: 'center', charSpace: modern ? 1.1 : 0.45 },
  )
  let ly = y + (modern ? 10.2 : 10.6)
  if (s.affiliation) {
    doc.setFont('times', 'normal')
    doc.setFontSize(modern ? 6.25 : 6.5)
    doc.setTextColor(modern ? '#4a4a4a' : INK.soft)
    doc.text(s.affiliation, cx, ly, { align: 'center' })
    ly += modern ? 3.1 : 3.2
  }
  if (s.address) {
    doc.setFontSize(6)
    doc.setTextColor(modern ? '#666' : INK.mid)
    doc.text(s.address, cx, ly, { align: 'center' })
    ly += 3
  }
  if (s.contact) {
    doc.setFontSize(6)
    doc.text(s.contact, cx, ly, { align: 'center' })
  }

  if (modern) {
    // Single hairline, generous space below.
    doc.setDrawColor('#c9c9c9')
    doc.setLineWidth(0.18)
    doc.line(k.ml, y + 31.5, rightX(k), y + 31.5)
    return y + 31.5
  }
  return y + 28
}

/** Circular / ref row — classic: between two strong rules; modern: quiet line. */
function drawCircularRow(doc: jsPDF, y: number, app: SchoolApplication, k: PdfSkin): number {
  const modern = k.header === 'modern'
  if (modern) {
    doc.setFont('times', 'bold')
    doc.setFontSize(7.25)
    doc.setTextColor(INK.soft)
    doc.text('Ref. No.', k.ml, y + 4.2, { charSpace: 0.2 })
    doc.setFont('times', 'normal')
    doc.setTextColor(INK.main)
    doc.text(app.circularNo ?? '', k.ml + 19, y + 4.2)
    doc.setFont('times', 'bold')
    doc.setTextColor(INK.soft)
    doc.text('Dated', rightX(k) - 46, y + 4.2, { charSpace: 0.2 })
    doc.setFont('times', 'normal')
    doc.setTextColor(INK.main)
    doc.text(app.circularDate ? formatDate(app.circularDate) : '', rightX(k), y + 4.2, { align: 'right' })
    return y + 5.4
  }
  doc.setDrawColor(INK.soft)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([], 0)
  doc.line(k.ml, y, rightX(k), y)
  doc.setFont('times', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(INK.main)
  doc.text('Circular / Ref. No.:', k.ml, y + 3.7)
  doc.setFont('times', 'normal')
  doc.text(app.circularNo ?? '', k.ml + 36, y + 3.7)
  doc.setFont('times', 'bold')
  doc.text('Date:', rightX(k) - 44, y + 3.7)
  doc.setFont('times', 'normal')
  doc.text(app.circularDate ? formatDate(app.circularDate) : '', rightX(k), y + 3.7, { align: 'right' })
  doc.setDrawColor(INK.main)
  doc.setLineWidth(0.5)
  doc.line(k.ml, y + 5.2, rightX(k), y + 5.2)
  return y + 5.2
}

// ─── Signature image embedding ──────────────────────────────────────────

function loadImageSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// ─── The consent form page (one A4 sheet) ───────────────────────────────

interface FormPageOpts {
  sub?: ApplicationSubmission
  payment?: SubmissionPaymentInfo
}

async function buildTourFormPage(
  doc: jsPDF,
  s: SchoolCtx,
  app: SchoolApplication,
  opts: FormPageOpts = {},
): Promise<void> {
  const { sub, payment } = opts
  const k = skinOf(app)
  const pay = payment ?? (sub ? deriveSubmissionPayment(app, sub) : undefined)

  const destination = app.destination ?? '________________________'
  const datesLabel = app.eventDate
    ? `${formatDate(app.eventDate)}${app.tourEndDate ? ` – ${formatDate(app.tourEndDate)}` : ''}`
    : ''
  const feeLabel = app.payment.mode === 'None' ? 'Nil' : inr(app.payment.amount)

  const emergency = sub ? String(sub.answers['t-emergency'] ?? '') : ''
  const meal = sub ? String(sub.answers['t-meal'] ?? '') : ''
  const motion = sub ? sub.answers['t-motion'] : undefined
  const medical = sub ? String(sub.answers['t-medical'] ?? '') : ''

  let y = k.mt
  y = drawSchoolHeader(doc, s, y, k)
  if (k.header === 'classic') y += 2

  // Circular no. / date row.
  y = drawCircularRow(doc, y, app, k)

  // ── Title block ──
  if (k.header === 'modern') {
    y += 7
    doc.setFont('times', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(INK.main)
    doc.text('PARENT CONSENT FORM', PAGE_W / 2, y + 3.4, { align: 'center', charSpace: 2.4 })
    doc.setFont('times', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor('#3c3c3c')
    doc.text(`Educational Tour — ${destination}`, PAGE_W / 2, y + 7.4, { align: 'center' })
    if (sub) {
      doc.setFontSize(6.25)
      doc.setTextColor('#6a6a6a')
      doc.text(
        `Application No. ${sub.serialNo ?? sub.id}   ·   Session ${app.academicYear}`,
        PAGE_W / 2, y + 10.4, { align: 'center', charSpace: 0.25 },
      )
    }
    y += 12.5
  } else {
    y += 3.2
    doc.setFont('times', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(INK.main)
    doc.text('PARENT CONSENT FORM', PAGE_W / 2, y + 3.6, { align: 'center', charSpace: 1.0 })
    doc.setFont('times', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(INK.mid)
    doc.text(`Educational Tour — ${destination}`, PAGE_W / 2, y + 7.6, { align: 'center' })
    if (sub) {
      doc.setFont('times', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(INK.faint)
      doc.text(
        `Application No. ${sub.serialNo ?? sub.id}   ·   Session ${app.academicYear}`,
        PAGE_W / 2, y + 10.8, { align: 'center', charSpace: 0.15 },
      )
    }
    y += 13
  }

  // ── Tour information ──
  y = drawSectionTitle(doc, y, 'Tour Information', k)
  y = drawFieldRows(doc, y, [
    { label: 'Destination', value: app.destination },
    { label: 'Travel dates', value: datesLabel || undefined },
    { label: 'Duration', value: app.durationDays },
    { label: 'Tour fee per student', value: feeLabel },
    { label: 'Teacher / tour in-charge', value: app.inChargeName },
    { label: 'Accompanying staff', value: app.accompanyingStaff },
  ], k)
  if (app.tourInstructions) {
    doc.setFont('times', 'bold')
    doc.setFontSize(5.5)
    doc.setTextColor(INK.soft)
    doc.text('NOTE:', k.ml, y + 2.6, { charSpace: 0.15 })
    doc.setFont('times', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(INK.soft)
    const note = doc.splitTextToSize(app.tourInstructions, contentW(k) - 12) as string[]
    for (let c = 0; c < note.length; c++) doc.text(note[c], k.ml + 12, y + 2.6 + c * 2.9)
    y += Math.max(3.2, note.length * 2.9 + 0.6)
  }

  // ── Student details ──
  y = drawSectionTitle(doc, y, 'Student Details', k)
  y = drawFieldRows(doc, y, [
    { label: 'Student name', value: sub?.studentName, wide: true },
    { label: 'Admission no.', value: sub?.admissionNo, mono: true },
    { label: 'Class / section', value: sub ? `${sub.className} — ${sub.section}` : undefined },
    { label: 'Roll no.', value: sub?.rollNo },
    { label: 'Blood group', value: sub?.bloodGroup },
  ], k)

  // ── Parent / guardian details ──
  y = drawSectionTitle(doc, y, 'Parent / Guardian Details', k)
  y = drawFieldRows(doc, y, [
    { label: 'Parent / guardian name', value: sub?.guardianName },
    { label: 'Mobile number', value: sub?.guardianPhone },
    { label: 'Residential address', value: sub?.address, wide: true },
    { label: 'Emergency contact', value: emergency || undefined, wide: true },
  ], k)

  // ── Health / care information ──
  y = drawSectionTitle(doc, y, 'Health / Care Information', k)
  y = drawFieldRows(doc, y, [
    { label: 'Food preference', value: meal || undefined },
    {
      label: 'Motion sickness',
      value: sub ? (motion === undefined ? '—' : motion ? 'Yes — see note' : 'No') : undefined,
    },
    { label: 'Health / medical note', value: medical || (sub ? '—' : undefined), wide: true },
  ], k)

  // ── Parental undertaking & declaration ──
  y = drawSectionTitle(doc, y, 'Parental Undertaking & Declaration', k)
  y = drawDeclaration(doc, y, app, sub, destination, datesLabel, k)

  // ── Signature area ──
  y = await drawSignatureArea(doc, y, app, sub, k)

  // ── Office use strip ──
  y = drawOfficeUse(doc, y, app, sub, pay, s.schoolName, k)

  doc.setProperties({
    title: sub ? `${sub.serialNo ?? sub.id} — ${app.title}` : `${app.title} — Blank Form`,
    subject: 'Parent Consent Form — Educational Tour',
    author: s.schoolName,
    creator: 'Scholario',
  })
}

function drawDeclaration(
  doc: jsPDF,
  y: number,
  app: SchoolApplication,
  sub: ApplicationSubmission | undefined,
  destination: string,
  datesLabel: string,
  k: PdfSkin,
): number {
  const pad = 1.8
  const inner = contentW(k) - 2 * pad

  doc.setFont('times', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(INK.main)
  const intro = doc.splitTextToSize(
    `I/We, ${sub?.guardianName ?? '________________'}, parent/guardian of ${sub?.studentName ?? '________________'} of ${sub ? `${sub.className} — ${sub.section}` : '____________'}, hereby declare and undertake as follows:`,
    inner,
  ) as string[]

  const items = [
    `I/We give full consent for my/our ward to participate in the Educational Tour to ${destination}${datesLabel ? ` (${datesLabel})` : ''} organised by the school.`,
    'The particulars furnished above are true and correct to the best of my/our knowledge.',
    'I/We have noted the tour dates, the fee payable and the conditions stated in the school circular.',
    'In case of illness or emergency during the tour, I/We authorise the school and the escorting staff to secure necessary medical assistance and treatment for my/our ward.',
    'My/our ward shall abide by the school\u2019s rules and the instructions of the escorting staff throughout the tour.',
  ].map((t) => doc.splitTextToSize(t, inner - 4) as string[])

  const introH = intro.length * k.declLineH
  const itemsH = items.reduce((sum, lines) => sum + lines.length * k.declLineH + k.declItemGap, 0)
  const boxH = pad * 2 + introH + itemsH + k.declPlaceGap

  // Classic: the single box on the page. Modern: open text, no border.
  if (k.declBoxed) {
    doc.setDrawColor(INK.soft)
    doc.setLineWidth(0.3)
    doc.setLineDashPattern([], 0)
    doc.rect(k.ml, y, contentW(k), boxH, 'S')
  }

  const textX = k.ml + (k.declBoxed ? pad : 0.5)
  let cy = y + (k.declBoxed ? pad : 0.4) + 2.6
  for (const line of intro) {
    doc.text(line, textX, cy)
    cy += k.declLineH
  }
  cy += k.declItemGap
  let num = 1
  const numX = textX + (k.declBoxed ? 1 : 0)
  for (const lines of items) {
    doc.setFont('times', 'bold')
    doc.text(`${num}.`, numX, cy)
    doc.setFont('times', 'normal')
    for (const line of lines) {
      doc.text(line, textX + 4.5, cy)
      cy += k.declLineH
    }
    cy += k.declItemGap
    num++
  }
  doc.setFont('times', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(INK.soft)
  const placeY = y + boxH - 1.6
  doc.text('Place: ______________________', textX, placeY)
  doc.text('Date: ______________________', k.ml + contentW(k) - 62, placeY)
  return y + boxH + (k.declBoxed ? 0 : 0.8)
}

async function drawSignatureArea(
  doc: jsPDF,
  y: number,
  app: SchoolApplication,
  sub: ApplicationSubmission | undefined,
  k: PdfSkin,
): Promise<number> {
  const cw = contentW(k)
  const colW = (cw - (k.header === 'modern' ? 8 : 12)) / 3
  const cols = [
    { who: 'Student\u2019s Signature', name: sub?.studentName },
    { who: 'Parent / Guardian\u2019s Signature', name: sub?.guardianName, sig: sub?.signature },
    { who: 'Class Teacher / Tour In-charge', name: app.inChargeName },
  ]
  y += k.sigMarginTop
  for (let c = 0; c < cols.length; c++) {
    const x = k.ml + c * (colW + (k.header === 'modern' ? 4 : 6))
    const ruleY = y + k.sigH
    const sig = cols[c].sig
    if (sig && sig.mode === 'drawn' && sig.data.startsWith('data:image/png')) {
      const dims = await loadImageSize(sig.data)
      if (dims && dims.w > 0 && dims.h > 0) {
        const maxW = colW - 6
        const maxH = 9
        const scale = Math.min(maxW / dims.w, maxH / dims.h)
        const w = dims.w * scale
        const h = dims.h * scale
        try {
          doc.addImage(sig.data, 'PNG', x + (colW - w) / 2, ruleY - h - 0.6, w, h)
        } catch { /* unembeddable image — leave the blank rule */ }
      }
    } else if (sig && sig.mode === 'typed') {
      doc.setFont('times', 'italic')
      doc.setFontSize(10)
      doc.setTextColor(INK.main)
      doc.text(sig.data, x + colW / 2, ruleY - 0.8, { align: 'center' })
    }
    // Signature rule — dotted on the classic form, hairline on modern.
    doc.setDrawColor(INK.mute)
    doc.setLineWidth(k.sigRule === 'solid' ? 0.18 : 0.35)
    doc.setLineDashPattern(k.sigRule === 'solid' ? [] : [0.45, 0.6], 0)
    doc.line(x, ruleY, x + colW, ruleY)
    doc.setLineDashPattern([], 0)
    // Caption.
    doc.setFont('times', 'bold')
    doc.setFontSize(5.5)
    doc.setTextColor(INK.main)
    doc.text(cols[c].who, x + colW / 2, ruleY + 2.6, { align: 'center' })
    doc.setFont('times', 'normal')
    doc.setFontSize(5.25)
    doc.setTextColor(INK.mute)
    const caption = sig
      ? `Recorded online · ${formatDate(sig.signedAt)}`
      : cols[c].name ?? 'Name: ______________'
    doc.text(caption, x + colW / 2, ruleY + 5.2, { align: 'center' })
  }
  return y + k.sigH + 6.5
}

function drawOfficeUse(
  doc: jsPDF,
  y: number,
  app: SchoolApplication,
  sub: ApplicationSubmission | undefined,
  pay: SubmissionPaymentInfo | undefined,
  schoolName: string,
  k: PdfSkin,
): number {
  y += k.officeMarginTop
  // Top rule — dashed on the classic form, hairline on modern.
  doc.setDrawColor(INK.mute)
  doc.setLineWidth(k.officeRule === 'solid' ? 0.18 : 0.5)
  doc.setLineDashPattern(k.officeRule === 'solid' ? [] : [1.3, 0.9], 0)
  doc.line(k.ml, y, rightX(k), y)
  doc.setLineDashPattern([], 0)

  doc.setFont('times', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(k.header === 'modern' ? '#5a5a5a' : INK.main)
  doc.text(
    'FOR OFFICE USE ONLY',
    k.header === 'modern' ? k.ml : PAGE_W / 2,
    y + 2.8,
    { align: k.header === 'modern' ? 'left' : 'center', charSpace: 0.9 },
  )

  const verified =
    sub
      ? sub.physicalDoc.status === 'Verified' ? 'Verified'
        : sub.physicalDoc.status === 'Received' ? 'Received'
          : sub.status === 'Approved' ? 'Approved'
            : 'Pending'
      : undefined

  y += 4
  y = drawFieldRows(doc, y, [
    { label: 'Application no.', value: sub?.serialNo, mono: true },
    { label: 'Payment status', value: paymentOf(app, pay) },
    { label: 'Verified / received', value: verified },
    { label: 'Office date', value: sub ? formatDate(sub.submittedAt) : undefined },
  ], k)

  doc.setFont('times', 'normal')
  doc.setFontSize(5.25)
  doc.setTextColor(INK.faint)
  doc.text(
    `Detach and retain with the office record  ·  ${k.header === 'modern' ? app.academicYear : schoolName}`,
    k.header === 'modern' ? rightX(k) : PAGE_W / 2,
    y + 3,
    { align: k.header === 'modern' ? 'right' : 'center' },
  )
  return y + 3
}

function paymentOf(app: SchoolApplication, pay: SubmissionPaymentInfo | undefined): string | undefined {
  if (!pay || app.payment.mode === 'None') return undefined
  if (pay.status === 'Paid') return `PAID · Receipt ${pay.receiptNos.join(', ') || '—'}`
  if (pay.status === 'Awaiting Verification') return `PAYMENT PENDING · Receipt ${pay.pendingReceiptNo ?? '—'} (cash — under verification)`
  return 'NOT PAID'
}

// ─── Public API ─────────────────────────────────────────────────────────

/** File name for a saved/printed artefact (extension added by jsPDF). */
export function tourPdfFileName(app: SchoolApplication, sub?: ApplicationSubmission): string {
  const tour = app.title.replace(/[^\w]+/g, '-').slice(0, 36)
  return sub
    ? `${sub.serialNo ?? sub.id}-${sub.studentName.replace(/\s+/g, '-')}-${tour}`
    : `BLANK-${tour}`
}

/**
 * Downloads the official consent form as a genuine A4 PDF — the blank
 * template (no submission) or one student's completed form.
 * Returns false (and toasts nothing) when generation fails.
 */
export async function downloadTourFormPDF(
  app: SchoolApplication,
  sub?: ApplicationSubmission,
  opts?: { payment?: SubmissionPaymentInfo; filename?: string },
): Promise<boolean> {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    await buildTourFormPage(doc, schoolCtx(), app, { sub, payment: opts?.payment })
    doc.save(`${opts?.filename ?? tourPdfFileName(app, sub)}.pdf`)
    return true
  } catch {
    return false
  }
}

/**
 * Bulk download: every completed form in ONE multi-page A4 PDF — one
 * student per page, serial order. Returns the page count (0 on failure).
 */
export async function downloadTourFormsBundlePDF(
  app: SchoolApplication,
  subs: ApplicationSubmission[],
  scopeLabel?: string,
): Promise<number> {
  if (subs.length === 0) return 0
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const s = schoolCtx()
    for (let i = 0; i < subs.length; i++) {
      if (i > 0) doc.addPage('a4', 'portrait')
      await buildTourFormPage(doc, s, app, { sub: subs[i] })
    }
    const name = `TOUR-FORMS-${app.title.replace(/[^\w]+/g, '-').slice(0, 30)}-${subs.length}-students${scopeLabel ? `-${scopeLabel.replace(/[^\w]+/g, '-')}` : ''}`
    doc.save(`${name}.pdf`)
    return subs.length
  } catch {
    return 0
  }
}

// ─── Attendance / master list (A4 landscape) ────────────────────────────

export interface TourAttendanceRow {
  serialNo: string
  studentName: string
  className: string
  section: string
  gender: string
  rollNo?: string
  admissionNo: string
  guardianName: string
  guardianPhone: string
  paymentStatus: string
  verificationStatus: string
}

/**
 * The trip's official attendance / master list as a real A4-landscape
 * PDF: school letterhead, one row per student, payment + verification
 * status and an empty signature column for the trip itself.
 */
export function downloadTourAttendancePDF(
  app: SchoolApplication,
  rows: TourAttendanceRow[],
  scopeLabel: string,
): boolean {
  if (rows.length === 0) return false
  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const s = schoolCtx()
    const pw = doc.internal.pageSize.getWidth()

    doc.setFont('times', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(INK.main)
    doc.text(s.schoolName.toUpperCase(), pw / 2, 14, { align: 'center', charSpace: 0.4 })
    if (s.affiliation) {
      doc.setFont('times', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(INK.soft)
      doc.text(s.affiliation, pw / 2, 18.2, { align: 'center' })
    }
    doc.setFont('times', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(INK.main)
    doc.text(
      `Educational Tour Attendance / Master List — ${app.title}${app.destination ? ` (${app.destination})` : ''}  ·  Session ${app.academicYear}  ·  ${scopeLabel}  ·  ${rows.length} student${rows.length === 1 ? '' : 's'}`,
      pw / 2,
      22.4,
      { align: 'center' },
    )

    const body = rows.map((r) => [
      r.serialNo,
      r.studentName,
      r.className,
      r.section,
      r.gender,
      r.rollNo ?? '—',
      r.admissionNo,
      r.guardianName,
      r.guardianPhone,
      r.paymentStatus,
      r.verificationStatus,
      '',
    ])

    autoTable(doc, {
      startY: 26,
      head: [[
        'Tour No.', 'Student Name', 'Class', 'Sec', 'Gender', 'Roll',
        'Admission No.', 'Parent / Guardian', 'Mobile', 'Payment',
        'Verification', 'Signature / Attendance',
      ]],
      body,
      margin: { left: 10, right: 10 },
      styles: {
        font: 'times', fontSize: 7, cellPadding: 1.3,
        lineColor: [51, 51, 51], lineWidth: 0.2, textColor: [17, 17, 17],
      },
      headStyles: {
        fillColor: [238, 238, 238], textColor: [17, 17, 17],
        fontStyle: 'bold', halign: 'center',
      },
      columnStyles: {
        0: { cellWidth: 30, halign: 'left' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 9, halign: 'center' },
        4: { cellWidth: 14, halign: 'center' },
        5: { cellWidth: 10, halign: 'center' },
        6: { cellWidth: 25, halign: 'center' },
        7: { cellWidth: 'auto' },
        8: { cellWidth: 22, halign: 'center' },
        9: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
        10: { cellWidth: 18, halign: 'center' },
        11: { cellWidth: 32 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 9) {
          const v = String(data.cell.raw)
          if (v.includes('Paid')) data.cell.styles.textColor = [20, 115, 60]
          else data.cell.styles.textColor = [161, 98, 7]
        }
      },
    })

    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 26
    doc.setFont('times', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(INK.mute)
    const note = `In-charge: ${app.inChargeName ?? '—'}  ·  Prepared ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}  ·  Carry on the tour — mark attendance per row.`
    if (finalY > 192) {
      doc.addPage('a4', 'landscape')
      doc.text(note, 10, 12)
    } else {
      doc.text(note, 10, finalY + 6)
    }

    doc.setProperties({
      title: `Attendance list — ${app.title}`,
      subject: 'Educational Tour Attendance / Master List',
      author: s.schoolName,
      creator: 'Scholario',
    })
    const name = `ATTENDANCE-${app.title.replace(/[^\w]+/g, '-').slice(0, 36)}-${scopeLabel.replace(/[^\w]+/g, '-')}`
    doc.save(`${name}.pdf`)
    return true
  } catch {
    return false
  }
}
