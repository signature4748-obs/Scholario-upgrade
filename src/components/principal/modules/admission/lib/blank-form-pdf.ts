/**
 * blank-form-pdf — the REAL downloadable A4 PDF of the official blank
 * admission application form.
 *
 * A genuine PDF drawn with jsPDF vector primitives (the same export
 * infrastructure as Examinations / Salary / the marks sheet) — NOT a
 * browser-print screenshot. Exact A4 portrait geometry, print-safe
 * margins, white background, near-black text, thin borders, a restrained
 * brand accent (tenant primary color, defaulting to neutral slate), page
 * numbers + school identity on every page, and automatic page-break
 * safety so content is never clipped or overlapped.
 *
 * Layout contract (kept in sync with the on-screen preview):
 *   Page 1 — school letterhead (tenant identity only), form banner,
 *            form-number + date blanks, passport-photo box,
 *            Section A (student) + Section B (parent/guardian).
 *   Page 2 — Section C (address & previous academic record),
 *            Section D (policy-driven document checklist),
 *            Section E (declaration, signatures, office-use block).
 *
 * jsPDF standard fonts have no ₹/Devanagari glyphs — the form stays
 * English-only (same accepted convention as the other PDF exports).
 */

import jsPDF from 'jspdf'
import {
  BLANK_FORM_VERSION,
  type BlankFormModel,
  type BlankFormField,
} from './blank-form-model'

/* ─── Geometry (A4 portrait, mm) ─────────────────────────────────────── */
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 14
const CONTENT_W = PAGE_W - MARGIN * 2 // 182
const GAP = 6
const COL_W = (CONTENT_W - GAP) / 2 // 88
const LABEL_W = 46
const BOTTOM_LIMIT = PAGE_H - 22 // footer zone starts at 283

/* ─── Palette — white paper, near-black text, restrained accent ─────── */
const INK = { r: 17, g: 24, b: 39 } // #111827
const MUTED = { r: 107, g: 114, b: 128 } // #6B7280
const RULE = { r: 55, g: 65, b: 81 } // #374151
const PAPER_BAR = { r: 243, g: 244, b: 246 } // #F3F4F6
const DEFAULT_ACCENT = { r: 15, g: 23, b: 42 } // #0F172A (neutral slate)

function parseHexColor(hex: string | null | undefined) {
  if (!hex) return DEFAULT_ACCENT
  const m = hex.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(m)) {
    return {
      r: parseInt(m.slice(0, 2), 16),
      g: parseInt(m.slice(2, 4), 16),
      b: parseInt(m.slice(4, 6), 16),
    }
  }
  return DEFAULT_ACCENT
}

function slugify(v: string): string {
  return (
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'school'
  )
}

/** Canonical artefact file name for the blank form download. */
export function blankFormFileName(schoolName: string, session: string): string {
  const s = session && session !== '—' ? `-${session.replace(/[^0-9a-zA-Z-]/g, '')}` : ''
  return `admission-application-form-${slugify(schoolName)}${s}.pdf`
}

/* ─── Painter state ──────────────────────────────────────────────────── */
interface Painter {
  doc: jsPDF
  y: number
  page: number
  model: BlankFormModel
  accent: { r: number; g: number; b: number }
  logoDataUrl: string | null
}

function ensureSpace(p: Painter, needed: number) {
  if (p.y + needed > BOTTOM_LIMIT) addPage(p)
}

function addPage(p: Painter) {
  p.doc.addPage()
  p.page += 1
  p.y = MARGIN + 8

  const { doc, model } = p
  // Mini header (continuation pages)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  setRgb(doc, INK)
  doc.text((model.school.name || 'Our School').slice(0, 70).toUpperCase(), MARGIN, p.y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  setRgb(doc, MUTED)
  doc.text(
    `Admission Application Form${model.session ? ` · Academic Session ${model.session}` : ''}`,
    MARGIN,
    p.y + 4.5,
  )
  setRgb(doc, RULE)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, p.y + 7, PAGE_W - MARGIN, p.y + 7)
  p.y += 13
}

function setRgb(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setTextColor(c.r, c.g, c.b)
}

function setDraw(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setDrawColor(c.r, c.g, c.b)
}

function sectionBar(p: Painter, title: string) {
  const { doc } = p
  ensureSpace(p, 14)
  doc.setFillColor(PAPER_BAR.r, PAPER_BAR.g, PAPER_BAR.b)
  doc.rect(MARGIN, p.y, CONTENT_W, 6.5, 'F')
  doc.setFillColor(p.accent.r, p.accent.g, p.accent.b)
  doc.rect(MARGIN, p.y, 1.4, 6.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  setRgb(doc, INK)
  doc.text(title, MARGIN + 4, p.y + 4.4)
  p.y += 6.5 + 3.5
}

/** One labelled ruled blank (half or full width). */
function lineField(p: Painter, f: BlankFormField, x: number, w: number) {
  const { doc } = p
  const label = f.label + (f.required ? ' *' : '')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  setRgb(doc, INK)
  const lines = doc.splitTextToSize(label, LABEL_W - 2)
  doc.text(lines, x, p.y + 4)

  const lineX = x + LABEL_W
  const lineW = w - LABEL_W
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(lineX, p.y + 5.5, x + w, p.y + 5.5)

  if (f.prefill) {
    doc.setFont('helvetica', 'normal')
    setRgb(doc, MUTED)
    doc.text(f.prefill, lineX + 1.5, p.y + 4)
  }
  if (f.note) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    setRgb(doc, MUTED)
    doc.text(f.note, x + LABEL_W + 2, p.y + 8.6)
  }
  p.y += 9
}

/** Label + square checkboxes (e.g. Gender, Category, TC, documents). */
function checkboxField(p: Painter, f: BlankFormField, x: number, w: number) {
  const { doc } = p
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  setRgb(doc, INK)
  const label = f.label + (f.required ? ' *' : '')
  const labelW = LABEL_W - 2
  const lines = doc.splitTextToSize(label, labelW)
  doc.text(lines, x, p.y + 4)

  let cx = x + LABEL_W
  let cy = p.y + 1.6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  setRgb(doc, INK)
  for (const opt of f.options || []) {
    setDraw(doc, RULE)
    doc.setLineWidth(0.25)
    doc.rect(cx, cy, 3.4, 3.4)
    doc.text(opt, cx + 4.6, p.y + 4.1)
    cx += 4.6 + doc.getTextWidth(opt) + 5
    if (cx > x + w - 14 && opt !== (f.options || []).at(-1)) {
      // wrap options to a second visual row inside the same field row
      p.y += 5.5
      cx = x + LABEL_W
      cy = p.y + 1.6
    }
  }
  if (f.note) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    setRgb(doc, MUTED)
    doc.text(f.note, x, p.y + 8.6)
  }
  p.y += 9
}

/** Render a section's fields in the 2-column grid with auto page-break. */
function sectionFields(p: Painter, fields: BlankFormField[]) {
  let i = 0
  while (i < fields.length) {
    const f = fields[i]
    if (f.span === 2) {
      ensureSpace(p, 11)
      if (f.kind === 'checkbox') checkboxField(p, f, MARGIN, CONTENT_W)
      else lineField(p, f, MARGIN, CONTENT_W)
      i += 1
      continue
    }
    // Half-width field — pair it with the next half-width field on one row.
    const g: BlankFormField | undefined = fields[i + 1]
    ensureSpace(p, 11)
    const yBefore = p.y
    if (f.kind === 'checkbox') checkboxField(p, f, MARGIN, COL_W)
    else lineField(p, f, MARGIN, COL_W)
    if (g && g.span !== 2) {
      // Right half renders on the SAME visual row (rewind cursor).
      p.y = yBefore
      if (g.kind === 'checkbox') checkboxField(p, g, MARGIN + COL_W + GAP, COL_W)
      else lineField(p, g, MARGIN + COL_W + GAP, COL_W)
      i += 2
    } else {
      i += 1
    }
  }
}

/* ─── Page furniture ─────────────────────────────────────────────────── */

function drawHeader(p: Painter) {
  const { doc, model, logoDataUrl } = p
  const school = model.school
  const y0 = MARGIN

  // Logo box — tenant logo when available; otherwise an honest empty box.
  const LOGO = 20
  doc.setLineWidth(0.3)
  setDraw(doc, RULE)
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, MARGIN + 0.5, y0 + 0.5, LOGO - 1, LOGO - 1)
    } catch {
      doc.rect(MARGIN, y0, LOGO, LOGO)
    }
  } else {
    doc.rect(MARGIN, y0, LOGO, LOGO)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6)
    setRgb(doc, MUTED)
    doc.text('School Logo', MARGIN + LOGO / 2, y0 + LOGO / 2 + 1, { align: 'center' })
  }

  // Identity block — ONLY what the tenant actually configured.
  let ty = y0 + 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  setRgb(doc, INK)
  const nameLines = doc.splitTextToSize((school.name || 'Our School').toUpperCase(), 118)
  doc.text(nameLines, MARGIN + LOGO + 6, ty)
  ty += nameLines.length * 5.4
  if (school.affiliation) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setRgb(doc, MUTED)
    doc.text(school.affiliation, MARGIN + LOGO + 6, ty)
    ty += 4
  }
  if (school.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setRgb(doc, MUTED)
    const addr = school.city ? `${school.address}, ${school.city}` : school.address
    doc.text(doc.splitTextToSize(addr, 118), MARGIN + LOGO + 6, ty)
    ty += 4
  }
  const contact = [
    school.phone ? `Phone: ${school.phone}` : '',
    school.email || '',
    school.website || '',
  ]
    .filter(Boolean)
    .join('  ·  ')
  if (contact) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setRgb(doc, MUTED)
    doc.text(doc.splitTextToSize(contact, 118), MARGIN + LOGO + 6, ty)
  }

  // Passport photo box (right)
  const PH_W = 25
  const PH_H = 32
  const PH_X = PAGE_W - MARGIN - PH_W
  doc.setLineWidth(0.3)
  setDraw(doc, RULE)
  doc.setLineDashPattern([1.4, 1.2], 0)
  doc.rect(PH_X, y0, PH_W, PH_H)
  doc.setLineDashPattern([], 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  setRgb(doc, MUTED)
  doc.text('AFFIX RECENT', PH_X + PH_W / 2, y0 + 12, { align: 'center' })
  doc.text('PASSPORT-SIZE', PH_X + PH_W / 2, y0 + 15.5, { align: 'center' })
  doc.text('PHOTOGRAPH', PH_X + PH_W / 2, y0 + 19, { align: 'center' })
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5.5)
  doc.text('(Self-attested)', PH_X + PH_W / 2, y0 + 23, { align: 'center' })

  // Header divider
  const hy = y0 + Math.max(LOGO + 4, PH_H + 4)
  setDraw(doc, INK)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, hy, PAGE_W - MARGIN, hy)
  p.y = hy + 5

  // Banner — restrained brand accent
  ensureSpace(p, 16)
  doc.setFillColor(p.accent.r, p.accent.g, p.accent.b)
  doc.rect(MARGIN, p.y, CONTENT_W, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(255, 255, 255)
  const banner =
    `ADMISSION APPLICATION FORM` +
    (model.session ? `  —  ACADEMIC SESSION ${model.session}` : '')
  doc.text(banner, PAGE_W / 2, p.y + 6.1, { align: 'center' })
  p.y += 13

  // Form number + application date blanks (hand-filled by the office)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  setRgb(doc, INK)
  doc.text(`Form No: ${model.formNoPrefix} / ____________`, MARGIN, p.y + 4)
  doc.text('Date: ________ / ________ / ____________', PAGE_W - MARGIN, p.y + 4, {
    align: 'right',
  })
  p.y += 10
}

function drawDeclarationAndSignatures(p: Painter) {
  const { doc, model } = p

  sectionBar(p, model.sections[4].title)

  // Declaration text
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  setRgb(doc, INK)
  const decl = doc.splitTextToSize(model.declaration.text, CONTENT_W - 4)
  ensureSpace(p, decl.length * 3.8 + 40)
  doc.text(decl, MARGIN + 2, p.y + 3.5)
  p.y += decl.length * 3.8 + 5

  // Place / Date row
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Place:', MARGIN, p.y + 4)
  doc.text('Date:', MARGIN + 90, p.y + 4)
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(MARGIN + 14, p.y + 5.2, MARGIN + 80, p.y + 5.2)
  doc.line(MARGIN + 100, p.y + 5.2, MARGIN + 166, p.y + 5.2)
  p.y += 14

  // Signature row — parent | office | principal
  ensureSpace(p, 34)
  const sigY = p.y + 22
  const third = CONTENT_W / 3
  setDraw(doc, INK)
  doc.setLineWidth(0.35)
  const xs = [MARGIN, MARGIN + third, MARGIN + third * 2]
  xs.forEach((x) => doc.line(x, sigY, x + third - 8, sigY))
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  setRgb(doc, INK)
  doc.text(model.declaration.parentSignLabel, xs[0], sigY + 4.5)
  doc.text(model.declaration.officeSignLabel, xs[1], sigY + 4.5)
  doc.text(model.declaration.principalSignLabel, xs[2], sigY + 4.5)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6.5)
  setRgb(doc, MUTED)
  doc.text('(with date)', xs[0], sigY + 8.5)
  doc.text('Documents checked & verified', xs[1], sigY + 8.5)
  doc.text(
    model.school.principal ? model.school.principal : '(Signature & school seal)',
    xs[2],
    sigY + 8.5,
  )
  p.y = sigY + 15
}

function drawOfficeUseBlock(p: Painter) {
  const { doc } = p
  const boxH = 26
  ensureSpace(p, boxH + 6)
  setDraw(doc, RULE)
  doc.setLineWidth(0.35)
  doc.rect(MARGIN, p.y, CONTENT_W, boxH)

  // label chip
  doc.setFillColor(PAPER_BAR.r, PAPER_BAR.g, PAPER_BAR.b)
  doc.rect(MARGIN, p.y, 34, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  setRgb(doc, INK)
  doc.text('OFFICE USE ONLY', MARGIN + 2, p.y + 4)

  const row1Y = p.y + 12
  doc.setFontSize(7.5)
  doc.text('Application No.:', MARGIN + 3, row1Y)
  doc.text('Date Received:', MARGIN + 92, row1Y)
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(MARGIN + 34, row1Y + 1.2, MARGIN + 86, row1Y + 1.2)
  doc.line(MARGIN + 119, row1Y + 1.2, MARGIN + 176, row1Y + 1.2)

  const row2Y = p.y + 20
  doc.text('Verified by:', MARGIN + 3, row2Y)
  doc.text('Principal Decision:', MARGIN + 92, row2Y)
  doc.line(MARGIN + 26, row2Y + 1.2, MARGIN + 86, row2Y + 1.2)

  // decision checkboxes
  let dx = MARGIN + 128
  const cy = row2Y - 3.4
  doc.setFont('helvetica', 'normal')
  for (const opt of ['Granted', 'Deferred', 'Rejected']) {
    doc.rect(dx, cy, 3.2, 3.2)
    doc.text(opt, dx + 4.2, row2Y)
    dx += 4.2 + doc.getTextWidth(opt) + 4
  }
  p.y += boxH + 4
}

function drawFooters(p: Painter) {
  const { doc, model } = p
  const total = doc.getNumberOfPages()
  const schoolLine = `${model.school.name || 'Our School'} · Admission Application Form`
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    setRgb(doc, MUTED)
    doc.text(doc.splitTextToSize(schoolLine, 120).slice(0, 1), MARGIN, PAGE_H - 8)
    doc.text(
      `Page ${i} of ${total} · Form version ${BLANK_FORM_VERSION}`,
      PAGE_W - MARGIN,
      PAGE_H - 8,
      { align: 'right' },
    )
    setDraw(doc, RULE)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, PAGE_H - 11, PAGE_W - MARGIN, PAGE_H - 11)
  }
}

/* ─── Public API ─────────────────────────────────────────────────────── */

export interface RenderBlankFormOptions {
  /** Resolved PNG/JPEG data-URL of the tenant logo (null → honest empty box). */
  logoDataUrl?: string | null
}

/**
 * Render the blank admission form as a jsPDF document (A4 portrait).
 * Pure: safe in Node (unit tests) and in the browser.
 */
export function renderBlankAdmissionFormPdf(
  model: BlankFormModel,
  options: RenderBlankFormOptions = {}
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const p: Painter = {
    doc,
    y: MARGIN,
    page: 1,
    model,
    accent: parseHexColor(model.school.primaryColor),
    logoDataUrl: options.logoDataUrl ?? null,
  }

  drawHeader(p)

  // Page 1: Sections A + B
  sectionBar(p, model.sections[0].title)
  sectionFields(p, model.sections[0].fields)
  sectionBar(p, model.sections[1].title)
  sectionFields(p, model.sections[1].fields)

  // Page 2: Sections C, D, E
  addPage(p)
  sectionBar(p, model.sections[2].title)
  sectionFields(p, model.sections[2].fields)
  sectionBar(p, model.sections[3].title)
  sectionFields(p, model.sections[3].fields)
  drawDeclarationAndSignatures(p)
  drawOfficeUseBlock(p)

  drawFooters(p)
  doc.setPage(1)
  return doc
}
