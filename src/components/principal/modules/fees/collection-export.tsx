'use client'

/**
 * collection-export — CSV + print outputs for one Additional Collection.
 *
 * APPS-IA-1 follow-up (§37 "reports & exports"): a Principal needs to answer
 * "who has paid and who hasn't?" OUTSIDE the app — for a staff meeting, an
 * auditor, a class-group message or the office notice board.
 *
 *   • Download CSV  — spreadsheet-ready (raw numbers, UTF-8 BOM for Excel,
 *                     ₹-free amount columns) with student + payment tables.
 *   • Print report  — an A4 official document styled like the Applications
 *                     print (letterhead, summary strip, tables, signature
 *                     line) rendered through a hidden iframe so popup
 *                     blockers can't eat it.
 *
 * Both outputs are derived ONLY from data the caller already computed for
 * the detail drawer (scoped students, per-student states, bound payments) —
 * no re-query, no drift.
 */

import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import type { AdditionalCharge, FeeTransaction } from '@/lib/store/fee-store'
import type { StudentRecord } from '@/lib/store/students-store'
import type { SchoolApplication } from '@/lib/store/applications-store'
import { formatINR, formatDate } from '@/lib/format'
import { toast } from 'sonner'

// ─── Shared input shape ────────────────────────────────────────────────

export interface CollectionExportData {
  charge: AdditionalCharge
  scoped: StudentRecord[]
  /** per-student paid totals + verifying flag (drawer computation) */
  studentStates: Map<string, { paid: number; verifying: boolean }>
  payments: FeeTransaction[]
  app?: SchoolApplication
  paidCount: number
  /** who triggered the export (for the report footer) */
  actor: string
}

interface RowModel {
  student: StudentRecord
  expected: number | null // null = custom amount (any contribution counts)
  paid: number
  outstanding: number | null
  status: 'Paid' | 'Partial' | 'Verifying' | 'Not paid'
}

function buildRows(d: CollectionExportData): RowModel[] {
  const isCustom = d.charge.allowCustomAmount === true
  return d.scoped.map((student) => {
    const st = d.studentStates.get(student.id)
    const paid = st?.paid ?? 0
    const expected = isCustom ? null : d.charge.amount
    const outstanding = isCustom ? null : Math.max(0, d.charge.amount - paid)
    const status: RowModel['status'] = isCustom
      ? paid > 0 ? 'Paid' : st?.verifying ? 'Verifying' : 'Not paid'
      : paid >= d.charge.amount
        ? 'Paid'
        : st?.verifying
          ? 'Verifying'
          : paid > 0
            ? 'Partial'
            : 'Not paid'
    return { student, expected, paid, outstanding, status }
  })
}

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v)
  // Quote fields containing commas, quotes or newlines; escape inner quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const STATUS_ORDER: Record<RowModel['status'], number> = {
  'Not paid': 0, Verifying: 1, Partial: 2, Paid: 3,
}

// ─── CSV ───────────────────────────────────────────────────────────────

function downloadCsv(d: CollectionExportData, schoolName: string) {
  const rows = buildRows(d)
  const lines: string[] = []
  const push = (...cells: Array<string | number | null | undefined>) =>
    lines.push(cells.map(csvCell).join(','))

  // Header block — context rows first so the file is self-describing.
  push('Scholario — Additional Collection Report')
  push('School', schoolName)
  push('Collection', d.charge.name)
  push('Category', d.charge.category)
  push('Status', d.charge.status)
  push('Session', d.charge.academicYear)
  push('Due date', d.charge.dueDate)
  push('Linked form', d.app ? d.app.title : 'Standalone')
  push('Scope', `${d.scoped.length} student(s) across ${new Set(d.scoped.map((s) => s.classId)).size} class(es)`)
  push('Amount', d.charge.allowCustomAmount ? `Custom (target ${d.charge.targetAmount ?? 0})` : d.charge.amount)
  push('Expected total', d.charge.allowCustomAmount ? d.charge.targetAmount ?? 0 : d.charge.amount * d.scoped.length)
  push('Collected', d.payments
    .filter((t) => t.status === 'Success' || t.status === 'Under Verification')
    .reduce((sum, t) => sum + t.amount, 0))
  push('Paid students', `${d.paidCount} of ${d.scoped.length}`)
  push()

  // Students table — amounts as RAW numbers (spreadsheet-friendly).
  push('STUDENTS')
  push('Admission No', 'Roll', 'Name', 'Class', 'Section', 'Expected', 'Paid', 'Outstanding', 'Status')
  for (const r of [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.student.name.localeCompare(b.student.name))) {
    push(
      r.student.admissionNo, r.student.rollNo, r.student.name, r.student.className, r.student.section,
      r.expected ?? 'custom', r.paid, r.outstanding ?? '—', r.status,
    )
  }
  push()

  // Payments table — the transaction record (§37: money trail).
  if (d.payments.length > 0) {
    push('PAYMENTS')
    push('Receipt No', 'Date', 'Student', 'Class', 'Mode', 'Amount', 'Status', 'Collected by')
    for (const t of [...d.payments].sort((a, b) => b.date.localeCompare(a.date))) {
      push(t.receiptNo, t.date, t.studentName, t.className, t.mode, t.amount, t.status, t.collectedBy)
    }
  } else {
    push('PAYMENTS', 'None recorded')
  }
  push()
  push(`Generated ${new Date().toLocaleString('en-IN')} by ${d.actor}`)

  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = d.charge.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'collection'
  a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success('CSV downloaded', {
    description: `"${d.charge.name}" — ${rows.length} student row(s)${d.payments.length ? `, ${d.payments.length} payment(s)` : ''}.`,
  })
}

// ─── Print report ──────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function printReport(d: CollectionExportData, schoolName: string, g: {
  affiliation: string; address: string; phone: string; email: string; logoText: string
}) {
  const rows = buildRows(d)
  const isCustom = d.charge.allowCustomAmount === true
  const collected = d.payments
    .filter((t) => t.status === 'Success' || t.status === 'Under Verification')
    .reduce((sum, t) => sum + t.amount, 0)
  const expected = isCustom ? d.charge.targetAmount ?? 0 : d.charge.amount * d.scoped.length
  const pending = Math.max(0, expected - collected)

  const statusChip = (s: RowModel['status']): string => {
    const base = 'display:inline-block;padding:1px 8px;border-radius:99px;font-size:8.5px;font-weight:700;letter-spacing:.04em;'
    if (s === 'Paid') return `${base}background:#d1fae5;color:#065f46;`
    if (s === 'Verifying') return `${base}background:#fef3c7;color:#92400e;`
    if (s === 'Partial') return `${base}background:#e0e7ff;color:#3730a3;`
    return `${base}background:#f3f4f6;color:#6b7280;`
  }

  const studentRows = rows
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.student.name.localeCompare(b.student.name))
    .map((r, i) => `
      <tr style="${i % 2 ? 'background:#fafafa;' : ''}">
        <td class="mono">${esc(r.student.admissionNo)}</td>
        <td style="font-weight:600;">${esc(r.student.name)}</td>
        <td>${esc(r.student.className)}${r.student.section ? ` · ${esc(r.student.section)}` : ''}</td>
        <td style="text-align:right;">${r.expected == null ? 'any' : formatINR(r.expected)}</td>
        <td style="text-align:right;">${r.paid > 0 ? formatINR(r.paid) : '—'}</td>
        <td style="text-align:right;">${r.outstanding == null ? '—' : formatINR(r.outstanding)}</td>
        <td><span style="${statusChip(r.status)}">${r.status}</span></td>
      </tr>`)
    .join('')

  const paymentRows = d.payments.length
    ? [...d.payments]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((t, i) => `
          <tr style="${i % 2 ? 'background:#fafafa;' : ''}">
            <td class="mono">${esc(t.receiptNo)}</td>
            <td>${esc(formatDate(t.date))}</td>
            <td style="font-weight:600;">${esc(t.studentName)}</td>
            <td>${esc(t.className)}</td>
            <td>${esc(t.mode)}</td>
            <td style="text-align:right;font-weight:700;">${formatINR(t.amount)}</td>
            <td>${esc(t.status)}</td>
          </tr>`)
        .join('')
    : ''

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(d.charge.name)} — Collection Report</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:#111827;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:3px double #111827; padding-bottom:10px; }
  .logo { width:44px; height:44px; border-radius:10px; background:#111827; color:#fff;
    display:flex; align-items:center; justify-content:center; font-weight:800; font-size:15px; }
  .school h1 { margin:0; font-size:17px; letter-spacing:-.01em; }
  .school p { margin:2px 0 0; font-size:9px; color:#6b7280; line-height:1.45; }
  .doctag { text-align:right; }
  .doctag .t { font-size:13px; font-weight:800; letter-spacing:.14em; }
  .doctag .s { display:inline-block; margin-top:4px; padding:2px 10px; border-radius:99px;
    background:#111827; color:#fff; font-size:9px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  h2 { font-size:9.5px; text-transform:uppercase; letter-spacing:.12em; color:#6b7280; margin:18px 0 6px; }
  .title-block { display:flex; align-items:baseline; gap:10px; margin-top:14px; flex-wrap:wrap; }
  .title-block .name { font-size:16px; font-weight:800; }
  .title-block .cat { font-size:10px; color:#6b7280; }
  table { width:100%; border-collapse:collapse; }
  th { background:#f3f4f6; font-size:8.5px; text-transform:uppercase; letter-spacing:.08em;
    color:#374151; text-align:left; padding:5px 8px; border-bottom:1px solid #e5e7eb; }
  td { padding:5px 8px; font-size:10px; border-bottom:1px solid #f3f4f6; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:12px; }
  .stat { border:1px solid #e5e7eb; border-radius:8px; padding:7px 9px; }
  .stat b { display:block; font-size:12.5px; margin-top:1px; }
  .stat span { font-size:7.5px; text-transform:uppercase; letter-spacing:.1em; color:#6b7280; font-weight:700; }
  .note { margin-top:14px; font-size:9px; color:#374151; background:#f9fafb; border:1px solid #f3f4f6;
    border-radius:8px; padding:8px 10px; line-height:1.55; }
  .foot { margin-top:22px; display:flex; justify-content:space-between; align-items:flex-end; font-size:8.5px; color:#6b7280; }
  .sig { border-top:1px solid #9ca3af; padding-top:4px; width:180px; text-align:center; }
  .bar { height:5px; border-radius:99px; background:#e5e7eb; overflow:hidden; margin-top:14px; }
  .bar i { display:block; height:100%; background:#059669; }
  .pct { font-size:9px; color:#374151; margin-top:3px; text-align:right; }
</style></head>
<body>
  <div class="head">
    <div style="display:flex;gap:10px;">
      <div class="logo">${esc(g.logoText || schoolName.slice(0, 2).toUpperCase())}</div>
      <div class="school">
        <h1>${esc(schoolName)}</h1>
        <p>${esc(g.affiliation)}${g.address ? ` · ${esc(g.address)}` : ''}</p>
        <p>${[g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
    </div>
    <div class="doctag">
      <div class="t">COLLECTION REPORT</div>
      <span class="s">${esc(d.charge.status)}</span>
      <p style="margin:6px 0 0;font-size:8.5px;color:#6b7280;">Session ${esc(d.charge.academicYear)} · Generated ${esc(new Date().toLocaleString('en-IN'))}</p>
    </div>
  </div>

  <div class="title-block">
    <span class="name">${esc(d.charge.name)}</span>
    <span class="cat">${esc(d.charge.category)} · ${d.app ? `Linked form: ${esc(d.app.title)}` : 'Standalone'} · Due ${esc(formatDate(d.charge.dueDate))}</span>
  </div>

  <div class="grid">
    <div class="stat"><span>Expected</span><b>${expected > 0 ? formatINR(expected) : 'Open'}</b></div>
    <div class="stat"><span>Collected</span><b>${formatINR(collected)}</b></div>
    <div class="stat"><span>Pending</span><b>${formatINR(pending)}</b></div>
    <div class="stat"><span>Paid</span><b>${d.paidCount} / ${d.scoped.length} students</b></div>
  </div>
  ${expected > 0 ? `<div class="bar"><i style="width:${Math.min(100, Math.round((collected / expected) * 100))}%;"></i></div><div class="pct">${Math.min(100, Math.round((collected / expected) * 100))}% collected</div>` : ''}

  <h2>Students — payment status</h2>
  <table>
    <thead><tr><th>Adm No</th><th>Name</th><th>Class</th><th style="text-align:right;">Expected</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Outstanding</th><th>Status</th></tr></thead>
    <tbody>${studentRows || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:14px;">No students match this collection\u2019s scope.</td></tr>'}</tbody>
  </table>

  <h2>Payments on record</h2>
  <table>
    <thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Class</th><th>Mode</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
    <tbody>${paymentRows || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:14px;">No payments recorded against this collection yet.</td></tr>'}</tbody>
  </table>

  ${d.charge.description ? `<div class="note"><b>Description:</b> ${esc(d.charge.description)}</div>` : ''}
  <div class="note">
    Financial history for this collection is permanent — payments remain on record even after closing or archiving.
    ${isCustom ? ' This is a custom-amount collection: any contribution counts as paid.' : ' Amounts are per the collection definition.'}
  </div>

  <div class="foot">
    <div class="sig">${esc(d.actor)} — Principal<br><span style="font-size:8px;">Authorised signatory</span></div>
    <div>Scholario · Additional Collections · ${esc(d.charge.id.slice(0, 8))}</div>
  </div>
</body></html>`

  // Hidden iframe → immune to popup blockers; removed after printing.
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { iframe.remove(); return }
  doc.open()
  doc.write(html)
  doc.close()
  const win = iframe.contentWindow!
  // afterprint fires in real browsers once the print dialog closes; the
  // timeout is a fallback for embedded/headless contexts where it never
  // fires (both paths are idempotent — remove() on a detached node is a
  // no-op).
  const done = () => { setTimeout(() => iframe.remove(), 250) }
  win.addEventListener('afterprint', done)
  setTimeout(done, 10_000)
  setTimeout(() => { try { win.focus(); win.print() } finally { /* afterprint or timeout cleans up */ } }, 60)
}

// ─── Menu component ────────────────────────────────────────────────────

export function CollectionExportMenu({ data, compact }: { data: Omit<CollectionExportData, 'actor'> & { actor?: string }; compact?: boolean }) {
  const g = useSchoolSettingsStore((s) => s.general)
  const actor = data.actor ?? 'Principal'

  const run = (kind: 'csv' | 'print') => {
    const schoolName = g.schoolName?.trim() || 'School'
    const full: CollectionExportData = { ...data, actor }
    if (kind === 'csv') downloadCsv(full, schoolName)
    else printReport(full, schoolName, g)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[11px]"
          aria-label={`Export options for ${data.charge.name}`}
        >
          <Download className="h-3 w-3" />
          {!compact && 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => run('csv')} className="gap-2 text-xs">
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Download CSV</span>
          <span className="ml-auto text-[9px] text-muted-foreground">.csv</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('print')} className="gap-2 text-xs">
          <Printer className="h-3.5 w-3.5" />
          <span>Print report</span>
          <span className="ml-auto text-[9px] text-muted-foreground">A4</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Re-export for callers that compose print headers themselves.
export { buildRows }
