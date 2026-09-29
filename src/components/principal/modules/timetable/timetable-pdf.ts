'use client'

/**
 * timetable-pdf — content-aware timetable export HTML builder.
 *
 * Brief section 4-15: One canonical export pipeline.
 *
 * Layouts (Brief 6 + 7):
 *   - Master:    landscape, multi-class grid, paginates if needed.
 *   - Classwise: compact single-class layout. Smart orientation:
 *                  portrait if periods ≤ 8, landscape if more.
 *   - Teacher:   compact single-teacher layout. Same smart logic.
 *
 * Brief section 8 + 15: Preview == PDF — the SAME HTML string is used for the
 * preview iframe AND for the print window. Orientation is encoded in `@page`
 * so the browser respects it on print.
 *
 * Brief section 14: Always uses the current validated state (draftSlots in
 * edit mode, store slots in view mode) — the caller passes that in.
 */
import type { TimetableSlot } from './data'
import type { TimetableRow } from './schedule-grid'
import { teacherNameById } from '@/lib/store/teacher-roster-store'
import { school } from '@/lib/mock/school'
import { DAYS } from './data'

export interface ExportResult {
  /** Complete standalone HTML document — used for BOTH preview and print. */
  html: string
  /** Human-readable title shown in the preview header. */
  title: string
  /** Subtitle / context line. */
  subtitle: string
  /** Chosen page orientation (Brief 11). */
  orientation: 'portrait' | 'landscape'
}

/* ────────────── Smart orientation logic (Brief 11) ────────────── */

/**
 * Deterministic orientation picker. Considers:
 *   - column count (more columns → landscape)
 *   - period count (more rows → portrait is fine, taller is OK)
 *   - longest cell text (long subject+teacher+room strings → wider cells)
 */
export function chooseOrientation(opts: {
  columns: string[]
  periodCount: number
  longestCellTextLength: number
}): 'portrait' | 'landscape' {
  const colCount = opts.columns.length
  // Master-style wide tables → always landscape.
  if (colCount >= 3) return 'landscape'
  // Single-column narrow tables (1 class) → portrait up to 9 periods,
  // landscape beyond that to give text room to breathe.
  if (colCount <= 1) {
    if (opts.periodCount > 8) return 'landscape'
    if (opts.longestCellTextLength > 30) return 'landscape'
    return 'portrait'
  }
  // 2 columns: portrait if cells are short, landscape otherwise.
  if (opts.longestCellTextLength > 25) return 'landscape'
  return 'portrait'
}

/* ────────────── Master timetable export ────────────── */

/**
 * Master timetable — landscape multi-class grid.
 *
 * Brief 5: master can be landscape + multi-page if genuine content size needs it.
 * No cropping, no microscopic text.
 */
export function exportTimetablePDF(
  slots: TimetableSlot[],
  rows: TimetableRow[],
  selectedDay: string,
  selectedClass: string,
  visibleClasses: string[]
): ExportResult {
  const daySlots = slots.filter((s) => s.day === selectedDay)
  const isAllClasses = selectedClass === 'all'
  const title = isAllClasses ? 'Master Timetable' : `${selectedClass} Timetable`
  const subtitle = isAllClasses
    ? `${selectedDay} · ${visibleClasses.length} classes`
    : `${selectedDay} · ${selectedClass}`

  // Brief 11: master is always landscape when ≥3 classes; single-class is "classwise"
  const orientation = chooseOrientation({
    columns: visibleClasses,
    periodCount: rows.filter((r) => !r.isBreak).length,
    longestCellTextLength: estimateLongestCellText(daySlots, visibleClasses, selectedClass),
  })

  const html = buildGridHTML({
    daySlots,
    rows,
    dayLabel: selectedDay,
    title,
    contextLabel: selectedClass,
    columns: visibleClasses,
    orientation,
  })

  return { html, title, subtitle, orientation }
}

/* ────────────── Teacher timetable export ────────────── */

/**
 * Teacher timetable — shows ONE teacher's full schedule across all days.
 * Columns: Subject, Class, Room. Rows: Periods (from canonical rows).
 */
export function exportTeacherTimetablePDF(
  slots: TimetableSlot[],
  rows: TimetableRow[],
  teacherId: string,
  teacherName: string
): ExportResult {
  const teacherSlots = slots.filter((s) => s.teacherId === teacherId)
  const title = `${teacherName} — Teacher Timetable`
  const subtitle = `${teacherName} · all active days`

  // For teachers, columns are: Subject | Class | Room
  const columns = ['Subject', 'Class', 'Room']
  const orientation = chooseOrientation({
    columns,
    periodCount: rows.filter((r) => !r.isBreak).length,
    longestCellTextLength: estimateTeacherCellTextLength(teacherSlots),
  })

  const html = buildTeacherHTML({
    teacherSlots,
    rows,
    title,
    teacherName,
    columns,
    orientation,
  })

  return { html, title, subtitle, orientation }
}

/* ────────────── HTML builders ────────────── */

interface BuildGridOpts {
  daySlots: TimetableSlot[]
  rows: TimetableRow[]
  dayLabel: string
  title: string
  contextLabel: string
  columns: string[]
  orientation: 'portrait' | 'landscape'
}

function buildGridHTML(opts: BuildGridOpts): string {
  const { daySlots, rows, dayLabel, title, contextLabel, columns, orientation } = opts
  const resolveTeacherName = (slot: TimetableSlot) =>
    slot.teacherName || teacherNameById(slot.teacherId) || '—'

  // Cell width: tuned so master grid has comfortable columns without cropping.
  const isMaster = contextLabel === 'all'
  const periodColWidth = isMaster ? 110 : 120
  const cellMinWidth = isMaster ? 150 : 220

  return wrapHTML({
    title,
    orientation,
    body: `
      <header class="doc-header">
        <div class="doc-school">
          <div class="school-name">${escapeHtml(school.name)}</div>
          <div class="school-aff">${escapeHtml(school.affiliation)}</div>
        </div>
        <div class="doc-title-block">
          <h1>${escapeHtml(title)}</h1>
          <p class="doc-sub">${escapeHtml(dayLabel)}${contextLabel === 'all' ? '' : ' · ' + escapeHtml(contextLabel)} · Session ${escapeHtml(school.session)}</p>
        </div>
      </header>
      <table class="tt-grid ${isMaster ? 'master' : 'single'}">
        <thead>
          <tr>
            <th class="period-col" style="width:${periodColWidth}px">Period</th>
            ${columns.map((col) => `<th style="min-width:${cellMinWidth}px">${escapeHtml(col)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => buildRowHTML(row, daySlots, columns, resolveTeacherName)).join('')}
        </tbody>
      </table>
      <footer class="doc-footer">Generated by Scholario · ${escapeHtml(school.shortName)}</footer>
    `,
  })
}

function buildRowHTML(
  row: TimetableRow,
  daySlots: TimetableSlot[],
  columns: string[],
  resolveTeacherName: (slot: TimetableSlot) => string
): string {
  if (row.isBreak) {
    return `
      <tr class="break-row">
        <td class="period-col">
          <div class="period-name">${escapeHtml(row.name)}</div>
          <div class="period-time">${escapeHtml(row.time)}</div>
        </td>
        <td colspan="${columns.length}" class="break-cell">— ${escapeHtml(row.name)} (${escapeHtml(row.time)}) —</td>
      </tr>
    `
  }
  return `
    <tr>
      <td class="period-col">
        <div class="period-name">${escapeHtml(row.name)}</div>
        <div class="period-time">${escapeHtml(row.time)}</div>
      </td>
      ${columns.map((col) => {
        const slot = daySlots.find((s) => s.period === row.number && s.className === col)
        if (!slot) {
          return `<td class="empty-cell">—</td>`
        }
        return `
          <td>
            <div class="cell-subject">${escapeHtml(slot.subject)}</div>
            <div class="cell-teacher">${escapeHtml(resolveTeacherName(slot))}</div>
            <div class="cell-room">${escapeHtml(slot.room)}</div>
          </td>
        `
      }).join('')}
    </tr>
  `
}

interface BuildTeacherOpts {
  teacherSlots: TimetableSlot[]
  rows: TimetableRow[]
  title: string
  teacherName: string
  columns: string[]
  orientation: 'portrait' | 'landscape'
}

function buildTeacherHTML(opts: BuildTeacherOpts): string {
  const { teacherSlots, rows, title, teacherName, columns, orientation } = opts

  // Group teacher slots by day so we can render one block per day.
  const dayGroups = DAYS.map((day) => ({
    day,
    slots: teacherSlots.filter((s) => s.day === day),
  })).filter((g) => g.slots.length > 0)

  // If teacher only teaches on one day, render a single section.
  // Otherwise render one section per day with a day divider.
  const sectionsHTML = dayGroups.length === 0
    ? `<p class="empty-state">No classes assigned to ${escapeHtml(teacherName)}.</p>`
    : dayGroups.map((g) => {
        return `
          <div class="day-section">
            <h2 class="day-heading">${escapeHtml(g.day)}</h2>
            <table class="tt-grid teacher">
              <thead>
                <tr>
                  <th class="period-col" style="width:120px">Period</th>
                  ${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => buildTeacherRowHTML(row, g.slots, g.day)).join('')}
              </tbody>
            </table>
          </div>
        `
      }).join('<div class="day-divider"></div>')

  return wrapHTML({
    title,
    orientation,
    body: `
      <header class="doc-header">
        <div class="doc-school">
          <div class="school-name">${escapeHtml(school.name)}</div>
          <div class="school-aff">${escapeHtml(school.affiliation)}</div>
        </div>
        <div class="doc-title-block">
          <h1>${escapeHtml(title)}</h1>
          <p class="doc-sub">${escapeHtml(teacherName)} · Session ${escapeHtml(school.session)}</p>
        </div>
      </header>
      <div class="teacher-body">
        ${sectionsHTML}
      </div>
      <footer class="doc-footer">Generated by Scholario · ${escapeHtml(school.shortName)}</footer>
    `,
  })
}

function buildTeacherRowHTML(row: TimetableRow, daySlots: TimetableSlot[], _day: string): string {
  if (row.isBreak) {
    return `
      <tr class="break-row">
        <td class="period-col">
          <div class="period-name">${escapeHtml(row.name)}</div>
          <div class="period-time">${escapeHtml(row.time)}</div>
        </td>
        <td colspan="3" class="break-cell">— ${escapeHtml(row.name)} (${escapeHtml(row.time)}) —</td>
      </tr>
    `
  }
  const slot = daySlots.find((s) => s.period === row.number)
  if (!slot) {
    return `
      <tr>
        <td class="period-col">
          <div class="period-name">${escapeHtml(row.name)}</div>
          <div class="period-time">${escapeHtml(row.time)}</div>
        </td>
        <td class="empty-cell">—</td>
        <td class="empty-cell">—</td>
        <td class="empty-cell">—</td>
      </tr>
    `
  }
  return `
    <tr>
      <td class="period-col">
        <div class="period-name">${escapeHtml(row.name)}</div>
        <div class="period-time">${escapeHtml(row.time)}</div>
      </td>
      <td><div class="cell-subject">${escapeHtml(slot.subject)}</div></td>
      <td>${escapeHtml(slot.className)}</td>
      <td>${escapeHtml(slot.room)}</td>
    </tr>
  `
}

/* ────────────── HTML wrapper with print CSS ────────────── */

function wrapHTML(opts: {
  title: string
  orientation: 'portrait' | 'landscape'
  body: string
}): string {
  const { title, orientation, body } = opts
  const pageRule = orientation === 'landscape'
    ? '@page { size: A4 landscape; margin: 12mm; }'
    : '@page { size: A4 portrait; margin: 14mm; }'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #ffffff; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1a1a1a;
    padding: 24px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 2px solid #059669;
  }
  .school-name { font-size: 18px; font-weight: 700; color: #059669; letter-spacing: -0.01em; }
  .school-aff { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .doc-title-block { text-align: right; }
  .doc-title-block h1 { font-size: 14px; font-weight: 600; color: #1a1a1a; }
  .doc-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }

  table.tt-grid { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.tt-grid th, table.tt-grid td {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
    font-size: 10px;
  }
  table.tt-grid th {
    background: #f3f4f6;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
    color: #4b5563;
  }
  .period-col { white-space: nowrap; }
  .period-name { font-weight: 700; font-size: 10px; color: #1a1a1a; }
  .period-time { font-size: 8.5px; color: #9ca3af; margin-top: 2px; }

  .break-row { background: #fef3c7; }
  .break-row .period-name { color: #92400e; }
  .break-cell {
    text-align: center;
    font-style: italic;
    color: #92400e;
    font-weight: 600;
  }

  .cell-subject { font-weight: 700; color: #059669; font-size: 10.5px; }
  .cell-teacher { color: #4b5563; margin-top: 2px; font-size: 9.5px; }
  .cell-room { color: #9ca3af; margin-top: 1px; font-size: 9px; }
  .empty-cell { text-align: center; color: #d1d5db; }

  .teacher-body { display: flex; flex-direction: column; gap: 16px; }
  .day-section { page-break-inside: avoid; }
  .day-heading {
    font-size: 12px; font-weight: 700; color: #059669;
    padding: 4px 0; margin-bottom: 4px;
    border-bottom: 1px solid #d1fae5;
  }
  .day-divider { height: 1px; background: transparent; }
  .empty-state { font-size: 11px; color: #6b7280; padding: 16px 0; text-align: center; }

  .doc-footer {
    margin-top: 18px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    font-size: 9px;
    color: #9ca3af;
    text-align: center;
  }

  /* Smart pagination: keep table headers + each row together */
  table.tt-grid { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }

  @media print {
    body { padding: 0; }
    ${pageRule}
  }

  /* On-screen preview: simulate page width so what you see == what you print */
  @media screen {
    body {
      background: #f3f4f6;
      min-height: 100vh;
    }
    .doc-page {
      max-width: ${orientation === 'landscape' ? '1100px' : '780px'};
      margin: 0 auto;
      background: #ffffff;
      padding: 32px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
      min-height: 100vh;
    }
  }
</style>
</head>
<body>
  <div class="doc-page">
    ${body}
  </div>
</body>
</html>`
}

/* ────────────── Heuristics ────────────── */

function estimateLongestCellText(
  daySlots: TimetableSlot[],
  visibleClasses: string[],
  selectedClass: string
): number {
  const cols = selectedClass === 'all' ? visibleClasses : [selectedClass]
  let longest = 0
  for (const slot of daySlots) {
    if (!cols.includes(slot.className)) continue
    const teacherName = slot.teacherName || teacherNameById(slot.teacherId) || ''
    const text = `${slot.subject} ${teacherName} ${slot.room}`
    if (text.length > longest) longest = text.length
  }
  return longest
}

function estimateTeacherCellTextLength(teacherSlots: TimetableSlot[]): number {
  let longest = 0
  for (const slot of teacherSlots) {
    const text = `${slot.subject} ${slot.className} ${slot.room}`
    if (text.length > longest) longest = text.length
  }
  return longest
}

/* ────────────── Helpers ────────────── */

function escapeHtml(str: string): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
