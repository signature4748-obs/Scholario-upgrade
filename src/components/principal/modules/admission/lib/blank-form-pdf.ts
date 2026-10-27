/**
 * blank-form-pdf — the REAL downloadable A4 PDF of the official blank
 * admission application form.
 *
 * A genuine PDF drawn with jsPDF vector primitives (the same export
 * infrastructure as Examinations / Salary / the marks sheet) — NOT a
 * browser-print screenshot.
 *
 * ONE-PAGE CONTRACT (AF-2026.2): the complete form fits ONE A4 portrait
 * sheet (210 × 297 mm) — school staff print or scan a single page per
 * applicant. The layout itself is compact (two-column field grid,
 * third-width checklist, tightened letterhead and footer); no scaling
 * trick, no removed fields. Sections:
 *   A student · B parent/guardian · C address & previous academic ·
 *   D facilities & medical · E document checklist · F declaration.
 * Required fields print a trailing asterisk; optional fields print bare —
 * the words "(Required)" / "(Optional)" never appear on the form. The
 * footer carries the school identity + form version only (no page
 * numbers: the artefact is one page by design).
 *
 * Safety valve: if a pathological tenant configuration (e.g. a future
 * document registry larger than the current six) would overflow the
 * sheet, the painter continues on a continuation page instead of
 * clipping — content integrity always wins over page count.
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

/* ─── Geometry (A4 portrait, mm) — tuned for the one-page contract ───── */
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 9
const CONTENT_W = PAGE_W - MARGIN * 2 // 192
const GAP = 4
const HALF = (CONTENT_W - GAP) / 2 // 94
const THIRD = (CONTENT_W - 2 * GAP) / 3 // 61.33
const ROW = 6.0 // compact field row height (≈4.7 mm writing line — hand-fill safe)
const LABEL_BASE = 34 // aligned label column (grows for long labels)
const BOTTOM_LIMIT = PAGE_H - 13 // content must end above 284
const FOOTER_RULE_Y = PAGE_H - 10.2
const FOOTER_TEXT_Y = PAGE_H - 7.5

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
  p.y = MARGIN + 6

  const { doc, model } = p
  // Mini header (continuation pages — safety valve only)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  setRgb(doc, INK)
  doc.text((model.school.name || 'Our School').slice(0, 70).toUpperCase(), MARGIN, p.y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  setRgb(doc, MUTED)
  doc.text(
    `Admission Application Form${model.session ? ` · Academic Session ${model.session}` : ''} (continued)`,
    MARGIN,
    p.y + 4,
  )
  setRgb(doc, RULE)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, p.y + 6, PAGE_W - MARGIN, p.y + 6)
  p.y += 11
}

function setRgb(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setTextColor(c.r, c.g, c.b)
}

function setDraw(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setDrawColor(c.r, c.g, c.b)
}

function sectionBar(p: Painter, title: string) {
  const { doc } = p
  ensureSpace(p, 12)
  doc.setFillColor(PAPER_BAR.r, PAPER_BAR.g, PAPER_BAR.b)
  doc.rect(MARGIN, p.y, CONTENT_W, 5, 'F')
  doc.setFillColor(p.accent.r, p.accent.g, p.accent.b)
  doc.rect(MARGIN, p.y, 1.2, 5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  setRgb(doc, INK)
  doc.text(title, MARGIN + 3.4, p.y + 3.55)
  // 5 mm bar + 0.8 mm trailing gap — tightened from 1.2 mm (AF-2026.3) to
  // help fund the taller two-row office-use block; visually imperceptible.
  p.y += 5.8
}

/** Label width: aligned column, but long labels may grow (line ≥ 20 mm). */
function labelWidth(doc: jsPDF, label: string, colW: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  const needed = doc.getTextWidth(label) + 2.5
  return Math.min(Math.max(LABEL_BASE, needed), colW - 20)
}

/**
 * One labelled ruled blank (half / third / full width).
 * The label prints with a required asterisk when applicable; optional
 * guidance (`note`) is printed INLINE inside the ruled line, muted —
 * never as an extra row (the one-page contract).
 */
function lineField(p: Painter, f: BlankFormField, x: number, w: number) {
  const { doc } = p
  const label = f.label + (f.required ? ' *' : '')
  const labelW = labelWidth(doc, label, w)
  setRgb(doc, INK)
  doc.text(label, x, p.y + 3.7)

  const lineX = x + labelW
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(lineX, p.y + 4.9, x + w, p.y + 4.9)

  if (f.prefill) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
    setRgb(doc, MUTED)
    doc.text(f.prefill, lineX + 1.5, p.y + 3.7)
  }
  if (f.note) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(5.8)
    setRgb(doc, MUTED)
    doc.text(f.note, lineX + 1.5, p.y + 3.7)
  }
  p.y += ROW
}

/** Label + square checkboxes (e.g. Gender, Category, TC), single row. */
function checkboxField(p: Painter, f: BlankFormField, x: number, w: number) {
  const { doc } = p
  const label = f.label + (f.required ? ' *' : '')
  const labelW = labelWidth(doc, label, w)
  setRgb(doc, INK)
  doc.text(label, x, p.y + 3.7)

  let cx = x + labelW
  const cy = p.y + 1.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  setRgb(doc, INK)
  for (const opt of f.options || []) {
    setDraw(doc, RULE)
    doc.setLineWidth(0.25)
    doc.rect(cx, cy, 3.1, 3.1)
    doc.text(opt, cx + 4.3, p.y + 3.7)
    cx += 4.3 + doc.getTextWidth(opt) + 3.2
    if (cx > x + w - 12 && opt !== (f.options || []).at(-1)) {
      // wrap options to a second visual row inside the same field row
      p.y += 4.4
      cx = x + labelW
    }
  }
  p.y += ROW
}

/**
 * Document-checklist row (Section E): a tick box followed by the
 * document name; required documents carry the asterisk, optional ones
 * print bare.
 */
function checklistField(p: Painter, f: BlankFormField, x: number, w: number) {
  const { doc } = p
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.rect(x, p.y + 1.5, 3.1, 3.1)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  setRgb(doc, INK)
  const label = f.label + (f.required ? ' *' : '')
  doc.text(doc.splitTextToSize(label, w - 5).slice(0, 1), x + 4.6, p.y + 3.7)
  p.y += ROW
}

/** Render a section's fields on the compact grid (2-col / 3-col packing). */
function sectionFields(p: Painter, fields: BlankFormField[]) {
  let i = 0
  while (i < fields.length) {
    const f = fields[i]
    const colW = f.span === 3 ? THIRD : f.span === 2 ? CONTENT_W : HALF
    const pack = f.span === 3 ? 3 : f.span === 2 ? 1 : 2

    ensureSpace(p, ROW + 2)
    const yBefore = p.y
    renderField(p, f, MARGIN, colW)
    let taken = 1
    while (taken < pack) {
      const g = fields[i + taken]
      if (!g || (g.span ?? 1) !== (f.span ?? 1)) break
      p.y = yBefore
      const gx = MARGIN + taken * (colW + GAP)
      renderField(p, g, gx, colW)
      taken += 1
    }
    i += taken
  }
}

function renderField(p: Painter, f: BlankFormField, x: number, w: number) {
  if (isChecklistEntry(p, f)) checklistField(p, f, x, w)
  else if (f.kind === 'checkbox') checkboxField(p, f, x, w)
  else lineField(p, f, x, w)
}

/** Section E entries render as tick-box checklist rows. */
function isChecklistEntry(p: Painter, f: BlankFormField): boolean {
  return p.model.sections.find((s) => s.key === 'E')?.fields.includes(f) === true
}

/* ─── Page furniture ─────────────────────────────────────────────────── */

function drawHeader(p: Painter) {
  const { doc, model, logoDataUrl } = p
  const school = model.school
  const y0 = MARGIN

  // Logo box — tenant logo when available; otherwise an honest empty box.
  const LOGO = 15
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
    doc.setFontSize(5.5)
    setRgb(doc, MUTED)
    doc.text('School Logo', MARGIN + LOGO / 2, y0 + LOGO / 2 + 1, { align: 'center' })
  }

  // Identity block — ONLY what the tenant actually configured, capped at
  // the letterhead height (a very long identity never collides with the
  // passport-photo box or the divider).
  const ID_BOTTOM = y0 + 25
  const idLines: Array<{ text: string; size: number; bold: boolean }> = []
  const name = (school.name || 'Our School').toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  const nameLines = doc.splitTextToSize(name, 120).slice(0, 2) as string[]
  for (const l of nameLines) idLines.push({ text: l, size: 11, bold: true })

  const info: string[] = []
  if (school.affiliation) info.push(school.affiliation)
  if (school.address) {
    const addr = school.city ? `${school.address}, ${school.city}` : school.address
    info.push(...(doc.splitTextToSize(addr, 120) as string[]))
  }
  const contact = [
    school.phone ? `Phone: ${school.phone}` : '',
    school.email || '',
    school.website ? school.website.replace(/^https?:\/\//, '') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  if (contact) info.push(...(doc.splitTextToSize(contact, 120) as string[]))

  // Name lines consume ~4.6 mm each; info lines 3.4 mm each.
  let nameH = nameLines.length * 4.6
  const infoBudget = Math.max(0, Math.floor((ID_BOTTOM - (y0 + 7) - nameH) / 3.4))
  const infoShown = info.slice(0, infoBudget)

  let ty = y0 + 6.8
  for (const l of nameLines) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    setRgb(doc, INK)
    doc.text(l, MARGIN + LOGO + 5, ty)
    ty += 4.6
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.4)
  setRgb(doc, MUTED)
  for (const l of infoShown) {
    doc.text(l, MARGIN + LOGO + 5, ty)
    ty += 3.4
  }

  // Passport photo box (right)
  const PH_W = 20
  const PH_H = 24
  const PH_X = PAGE_W - MARGIN - PH_W
  doc.setLineWidth(0.3)
  setDraw(doc, RULE)
  doc.setLineDashPattern([1.3, 1.1], 0)
  doc.rect(PH_X, y0, PH_W, PH_H)
  doc.setLineDashPattern([], 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(5.5)
  setRgb(doc, MUTED)
  doc.text('AFFIX RECENT', PH_X + PH_W / 2, y0 + 8.8, { align: 'center' })
  doc.text('PASSPORT-SIZE', PH_X + PH_W / 2, y0 + 11.9, { align: 'center' })
  doc.text('PHOTOGRAPH', PH_X + PH_W / 2, y0 + 15, { align: 'center' })
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5)
  doc.text('(Self-attested)', PH_X + PH_W / 2, y0 + 18.4, { align: 'center' })

  // Header divider
  const hy = y0 + 26.5
  setDraw(doc, INK)
  doc.setLineWidth(0.55)
  doc.line(MARGIN, hy, PAGE_W - MARGIN, hy)
  p.y = hy + 3.5

  // Banner — restrained brand accent
  doc.setFillColor(p.accent.r, p.accent.g, p.accent.b)
  doc.rect(MARGIN, p.y, CONTENT_W, 6.2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(255, 255, 255)
  const banner =
    `ADMISSION APPLICATION FORM` +
    (model.session ? `  —  ACADEMIC SESSION ${model.session}` : '')
  doc.text(banner, PAGE_W / 2, p.y + 4.25, { align: 'center' })
  p.y += 6.2 + 1.2

  // Form number + application date blanks (hand-filled by the office)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  setRgb(doc, INK)
  doc.text(`Form No: ${model.formNoPrefix} / ____________`, MARGIN, p.y + 3.4)
  doc.text('Date: ________ / ________ / ____________', PAGE_W - MARGIN, p.y + 3.4, {
    align: 'right',
  })
  p.y += 5.2
}

function drawDeclarationAndSignatures(p: Painter) {
  const { doc, model } = p

  sectionBar(p, model.sections[5].title)

  // Declaration text
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.6)
  setRgb(doc, INK)
  const decl = doc.splitTextToSize(model.declaration.text, CONTENT_W - 3)
  ensureSpace(p, decl.length * 3.0 + 30)
  doc.text(decl, MARGIN + 1.5, p.y + 2.8)
  p.y += decl.length * 3.0 + 1.6

  // Place / Date row
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.8)
  doc.text('Place:', MARGIN, p.y + 3.4)
  doc.text('Date:', MARGIN + 70, p.y + 3.4)
  setDraw(doc, RULE)
  doc.setLineWidth(0.25)
  doc.line(MARGIN + 12, p.y + 4.4, MARGIN + 62, p.y + 4.4)
  doc.line(MARGIN + 78, p.y + 4.4, MARGIN + 128, p.y + 4.4)
  // 4.6 mm row (AF-2026.3, was 5.0) — line sits at +4.4, next block follows
  // 0.2 mm later; the freed space funds the taller office-use block.
  p.y += 4.6

  // Signature row — parent | office | principal
  ensureSpace(p, 13)
  // 4.0 mm writing space above the signature rule (AF-2026.3, was 4.6) —
  // still a comfortable signature gap; funds the two-row office block.
  const sigY = p.y + 4.0
  const colW = (CONTENT_W - 2 * GAP) / 3
  setDraw(doc, INK)
  doc.setLineWidth(0.3)
  const xs = [MARGIN, MARGIN + colW + GAP, MARGIN + (colW + GAP) * 2]
  xs.forEach((x) => doc.line(x, sigY, x + colW - 4, sigY))
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.3)
  setRgb(doc, INK)
  doc.text(model.declaration.parentSignLabel, xs[0], sigY + 3.1)
  doc.text(model.declaration.officeSignLabel, xs[1], sigY + 3.1)
  doc.text(model.declaration.principalSignLabel, xs[2], sigY + 3.1)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(5.6)
  setRgb(doc, MUTED)
  doc.text('(with date)', xs[0], sigY + 5.9)
  doc.text('Documents checked & verified', xs[1], sigY + 5.9)
  doc.text(
    model.school.principal ? model.school.principal : '(Signature & school seal)',
    xs[2],
    sigY + 5.9,
  )
  p.y = sigY + 7.4
}

/**
 * Office Use Only — TWO clearly separated rows inside one bordered box:
 *
 *   row 1 · Application No.: ______   Date Received: ______   Verified by: ______
 *   row 2 · Principal Decision:  ☐ Granted   ☐ Deferred   ☐ Rejected
 *
 * Geometry contract (mm from the box top): the box is 14.6 tall — it
 * deliberately uses the whitespace left at the sheet bottom so each row
 * gets ≥ 1.8 mm of clearance from its neighbours. Row 1's writing lines
 * sit at 8.6 (baseline 7.6); row 2's checkboxes span 10.4 → 13.3 — fully
 * BELOW row 1's lines, so no checkbox can ever intrude into the
 * Application No. / Date Received / Verified by ruled blanks (regression:
 * the pre-AF-2026.3 9.8 mm box drew both rows 3 mm apart and the decision
 * boxes crossed the first row's lines). The three decision checkboxes are
 * evenly pitched (26 mm) with their labels, and the three label/line
 * columns share one 64 mm grid so the box's interior aligns cleanly.
 */
function drawOfficeUseBlock(p: Painter) {
  const { doc } = p
  const boxH = 14.6
  ensureSpace(p, boxH + 4)
  setDraw(doc, RULE)
  doc.setLineWidth(0.3)
  doc.rect(MARGIN, p.y, CONTENT_W, boxH)

  // label chip
  doc.setFillColor(PAPER_BAR.r, PAPER_BAR.g, PAPER_BAR.b)
  doc.rect(MARGIN, p.y, 28, 4.4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  setRgb(doc, INK)
  doc.text('OFFICE USE ONLY', MARGIN + 1.8, p.y + 3.1)

  // Row 1 — three label/writing-line columns on one 64 mm grid.
  // Line start = measured label end + 2.5 (no label/line collision is
  // possible at any Helvetica metric); line end = column end − 2.
  const row1Y = p.y + 7.6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.3)
  setRgb(doc, INK)
  const cols = [
    { label: 'Application No.:', x: MARGIN + 2, lineEnd: MARGIN + 62 },
    { label: 'Date Received:', x: MARGIN + 66, lineEnd: MARGIN + 126 },
    { label: 'Verified by:', x: MARGIN + 130, lineEnd: MARGIN + 188 },
  ]
  setDraw(doc, RULE)
  doc.setLineWidth(0.2)
  for (const c of cols) {
    doc.text(c.label, c.x, row1Y)
    const lineStart = c.x + doc.getTextWidth(c.label) + 2.5
    doc.line(lineStart, row1Y + 1.0, c.lineEnd, row1Y + 1.0)
  }

  // Row 2 — decision checkboxes on their own row, evenly pitched,
  // fully below row 1's ruled lines (box top 10.4 vs lines at 8.6).
  const row2Y = p.y + 12.6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.3)
  setRgb(doc, INK)
  doc.text('Principal Decision:', MARGIN + 2, row2Y)
  doc.setFont('helvetica', 'normal')
  const DECISION_PITCH = 26
  const cy = row2Y - 2.2
  ;['Granted', 'Deferred', 'Rejected'].forEach((opt, i) => {
    const dx = MARGIN + 32 + i * DECISION_PITCH
    setDraw(doc, RULE)
    doc.setLineWidth(0.25)
    doc.rect(dx, cy, 2.9, 2.9)
    doc.text(opt, dx + 3.9, row2Y)
  })
  p.y += boxH + 2.6
}

function drawFooters(p: Painter) {
  const { doc, model } = p
  const total = doc.getNumberOfPages()
  const schoolLine = `${model.school.name || 'Our School'} · Admission Application Form`
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    setDraw(doc, RULE)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, FOOTER_RULE_Y, PAGE_W - MARGIN, FOOTER_RULE_Y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    setRgb(doc, MUTED)
    doc.text(doc.splitTextToSize(schoolLine, 120).slice(0, 1), MARGIN, FOOTER_TEXT_Y)
    doc.text(`Form version ${BLANK_FORM_VERSION}`, PAGE_W - MARGIN, FOOTER_TEXT_Y, {
      align: 'right',
    })
  }
}

/* ─── Public API ─────────────────────────────────────────────────────── */

export interface RenderBlankFormOptions {
  /** Resolved PNG/JPEG data-URL of the tenant logo (null → honest empty box). */
  logoDataUrl?: string | null
}

/**
 * Render the blank admission form as a jsPDF document (A4 portrait).
 * The default tenant configuration renders EXACTLY ONE page; the
 * painter only spills to a continuation page if a pathological
 * configuration would otherwise clip content.
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

  // Sections A → F flow on the single sheet (packing keeps every row tight)
  sectionBar(p, model.sections[0].title)
  sectionFields(p, model.sections[0].fields)
  sectionBar(p, model.sections[1].title)
  sectionFields(p, model.sections[1].fields)
  sectionBar(p, model.sections[2].title)
  sectionFields(p, model.sections[2].fields)
  sectionBar(p, model.sections[3].title)
  sectionFields(p, model.sections[3].fields)
  sectionBar(p, model.sections[4].title)
  sectionFields(p, model.sections[4].fields)
  drawDeclarationAndSignatures(p)
  drawOfficeUseBlock(p)

  drawFooters(p)
  doc.setPage(1)
  return doc
}
