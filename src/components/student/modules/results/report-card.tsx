'use client'

/**
 * results/report-card — the OFFICIAL REPORT CARD (§18/§20–§22, gen 2).
 *
 * A premium document section — not a dashboard button: the trigger reads
 * like the school-issued record it represents (document icon, official
 * title, quiet provenance line, two clear actions). The document itself
 * is a genuine institutional artifact — school letterhead (from School
 * Settings, the branding source of truth), student particulars, the
 * subject-wise marks table with the school's grading scale, totals, rank
 * (only when permitted), attendance (only when configured), the published
 * teacher remark and signature/seal furniture. Composition follows the
 * school's configured report-card flags; fields that don't exist never
 * print.
 *
 * Actions: in-app PREVIEW (A4 paper dialog), DOWNLOAD (real file) and
 * PRINT (the document itself — the preferred printable form). The
 * student can never alter official marks — this module is read-only.
 */

import { useRef } from 'react'
import { FileBadge2, Download, Printer, Eye } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { downloadHTMLFile, safeFileName } from '@/lib/download-file'
// Report-card letterhead — the sanctioned identity cascade (server
// identity → settings → neutral); never a demo-school fallback.
import { getSchoolProfile } from '@/lib/school-profile'
import { getActiveAcademicSessionLabel, SESSION_NOT_SET_LABEL } from '@/lib/academic-session'
import {
  useStudentAttendanceStore,
  computeStats,
  studentRecords,
} from '@/lib/store/student-attendance-store'
import {
  fmtPct,
  pctOf,
  gradeFor,
  totalsOf,
  type AssessmentDef,
  type AssessmentResult,
  type GradeBand,
  type ClassStanding,
} from '@/lib/store/student-results-store'
import { useState } from 'react'

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface ReportCardInput {
  assessment: AssessmentDef
  result: AssessmentResult
  gradeScale: GradeBand[]
  standings: ClassStanding[]
  showRank: boolean
  reportCardConfig: { includeAttendance: boolean; includePrincipalRemark: boolean; includeSealNote: boolean }
  identity: { studentId: string; name: string; admissionNo: string; classSection: string; rollNo: string }
}

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fullDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_FULL[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

/** Build the institutional document — every value derives from real records. */
function buildReportCardHTML(input: ReportCardInput): string {
  const { assessment, result, gradeScale, standings, showRank, reportCardConfig, identity } = input
  const profile = getSchoolProfile()
  const schoolName = profile.name
  const affiliation = profile.affiliation || '—'
  const address = profile.address || '—'
  const principal = profile.principal || 'Principal'

  const t = totalsOf(result)
  const overallGrade = gradeFor(t.pct, gradeScale)
  const mine = standings.find((s) => s.isMe)

  // Attendance — only when the school includes it on the report card.
  // Keyed to the session student's OWN canonical id (never a demo id).
  let attendanceLine = ''
  if (reportCardConfig.includeAttendance) {
    const records = studentRecords(useStudentAttendanceStore.getState().records, identity.studentId)
    const stats = computeStats(records)
    if (stats.total > 0) {
      attendanceLine = `<tr><th>Attendance</th><td>${stats.percent}% (${stats.attended} of ${stats.total} recorded school days)</td></tr>`
    }
  }

  const rows = result.subjects
    .map((s) => {
      const pct = pctOf(s.obtained, s.maxMarks)
      const grade = gradeFor(pct, gradeScale)
      const comp = (s.components?.length ?? 0) > 0
        ? `<div class="comp">${esc(s.components!.map((c) => `${esc(c.name)} ${c.obtained}/${c.max}`).join(' · '))}</div>`
        : ''
      return `<tr>
        <td><strong>${esc(s.subject)}</strong>${comp}</td>
        <td class="c">${s.maxMarks}</td>
        <td class="c"><strong>${s.obtained}</strong></td>
        <td class="c">${fmtPct(pct)}%</td>
        <td class="c">${esc(grade)}</td>
      </tr>`
    })
    .join('')

  const remark = result.remark
    ? `<div class="remarks">
        <strong>Class Teacher&apos;s Remarks</strong><br />
        ${esc(result.remark.text)}
        <div class="by">— ${esc(result.remark.by)}, ${esc(result.remark.role)}</div>
      </div>`
    : ''

  const principalBlock = reportCardConfig.includePrincipalRemark
    ? `<div class="remarks"><strong>Principal&apos;s Office</strong><br /><span class="muted">Promoted as per the school&apos;s assessment policy for ${esc(assessment.name)}.</span></div>`
    : ''

  const sealNote = reportCardConfig.includeSealNote
    ? `<div class="seal-note">This report card is issued electronically by ${esc(schoolName)}. Marks once published are official school records.</div>`
    : ''

  const issuedOn = fullDate(new Date().toISOString().slice(0, 10))
  // The ACADEMIC session (school settings) — never the exam's conducted
  // date range (which for a single-term exam would read e.g. 2026–2026).
  // PHASE 7.5-D — server-first, nullable session: the printed document
  // says "Session not set" rather than inventing a year.
  const sessionLabel = getActiveAcademicSessionLabel() ?? SESSION_NOT_SET_LABEL

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Report Card — ${esc(assessment.name)} — ${esc(identity.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; margin: 36px auto; max-width: 760px; color: #1f2a37; }
  .letterhead { text-align: center; border-bottom: 3px double #047857; padding-bottom: 14px; margin-bottom: 20px; }
  .school { font-size: 23px; font-weight: bold; color: #0f172a; letter-spacing: 0.02em; }
  .aff { font-size: 11px; color: #4b5563; margin-top: 4px; }
  .contact { font-size: 10px; color: #6b7280; margin-top: 2px; }
  h1 { text-align: center; font-size: 14px; letter-spacing: 0.28em; margin: 16px 0 4px; color: #065f46; }
  .docmeta { display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; margin: 0 0 14px; font-family: ui-monospace, monospace; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  table.data th, table.data td { border: 1px solid #9ca3af; padding: 6px 10px; font-size: 12px; }
  table.data thead th { background: #ecfdf5; color: #065f46; text-align: left; }
  table.data tfoot th, table.data tfoot td { background: #ecfdf5; color: #064e3b; font-weight: bold; }
  .c { text-align: center; }
  .comp { font-size: 9px; color: #6b7280; margin-top: 2px; font-family: ui-monospace, monospace; }
  table.meta td, table.meta th { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; }
  table.meta th { background: #f8fafc; text-align: left; width: 32%; color: #4b5563; }
  .summary { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
  .summary div { flex: 1; min-width: 118px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; text-align: center; font-size: 10px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.06em; }
  .summary strong { display: block; font-size: 16px; color: #0f172a; margin-top: 3px; text-transform: none; letter-spacing: 0; }
  .remarks { border: 1px solid #cbd5e1; border-radius: 6px; padding: 11px 14px; font-size: 12px; margin: 12px 0; background: #f8fafc; line-height: 1.55; }
  .remarks .by { margin-top: 7px; color: #6b7280; font-size: 11px; }
  .muted { color: #6b7280; }
  .sign { display: flex; justify-content: space-between; margin-top: 52px; }
  .sign div { text-align: center; font-size: 12px; color: #0f172a; }
  .sign .line { border-top: 1px solid #374151; width: 225px; margin: 0 auto 6px; padding-top: 8px; font-weight: bold; }
  .sign .role { color: #6b7280; font-size: 10px; margin-top: 2px; }
  .seal-note { text-align: center; font-size: 9px; color: #9ca3af; margin-top: 26px; font-family: ui-monospace, monospace; letter-spacing: 0.04em; }
  @media print { body { margin: 10mm auto; } }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="school">${esc(schoolName)}</div>
    <div class="aff">${esc(affiliation)}</div>
    <div class="contact">${esc(address)}</div>
  </div>
  <h1>STUDENT REPORT CARD</h1>
  <div class="docmeta"><span>${esc(assessment.name)} · ${esc(sessionLabel)}</span><span>Issued ${esc(issuedOn)}</span></div>
  <table class="meta">
    <tr><th>Student Name</th><td>${esc(identity.name)}</td></tr>
    <tr><th>Admission No</th><td>${esc(identity.admissionNo)}</td></tr>
    <tr><th>Class / Section</th><td>${esc(identity.classSection)}</td></tr>
    <tr><th>Roll No</th><td>${esc(identity.rollNo)}</td></tr>
    <tr><th>Examination</th><td>${esc(assessment.name)} (${esc(assessment.term)})</td></tr>
    ${attendanceLine}
  </table>
  <table class="data">
    <thead>
      <tr><th>Subject</th><th class="c">Max Marks</th><th class="c">Obtained</th><th class="c">Percentage</th><th class="c">Grade</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><th>Total</th><th class="c">${t.max}</th><th class="c">${t.obtained}</th><th class="c">${fmtPct(t.pct)}%</th><th class="c">${esc(overallGrade)}</th></tr>
    </tfoot>
  </table>
  <div class="summary">
    <div>Total Marks<strong>${t.obtained} / ${t.max}</strong></div>
    <div>Percentage<strong>${fmtPct(t.pct)}%</strong></div>
    <div>Overall Grade<strong>${esc(overallGrade)}</strong></div>
    ${showRank && mine ? `<div>Class Rank<strong>#${mine.rank} / ${standings.length}</strong></div>` : ''}
  </div>
  ${remark}
  ${principalBlock}
  <div class="sign">
    <div><div class="line">${esc(result.remark?.by ?? 'Class Teacher')}</div><div class="role">Class Teacher</div></div>
    <div><div class="line">${esc(principal)}</div><div class="role">Principal</div></div>
  </div>
  ${sealNote}
</body>
</html>`
}

interface ReportCardProps {
  assessment: AssessmentDef
  result: AssessmentResult
  gradeScale: GradeBand[]
  standings: ClassStanding[]
  showRank: boolean
  reportCardConfig: { includeAttendance: boolean; includePrincipalRemark: boolean; includeSealNote: boolean }
  identity: { studentId: string; name: string; admissionNo: string; classSection: string; rollNo: string }
}

export function ReportCard(props: ReportCardProps) {
  const [open, setOpen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const html = buildReportCardHTML(props)
  const filename = safeFileName(`Report Card ${props.assessment.name} ${props.identity.name}`, 'html')

  const handleDownload = () => {
    downloadHTMLFile(html, filename)
    toast.success('Report card downloaded', { description: `${filename} — open it and print directly.` })
  }

  const handlePrint = () => {
    const w = iframeRef.current?.contentWindow
    if (w) {
      try {
        w.focus()
        w.print()
        return
      } catch {
        // fall through to the file download
      }
    }
    downloadHTMLFile(html, filename)
    toast.info('Report card saved', { description: 'Open the downloaded file and print it.' })
  }

  return (
    <section aria-label="Official report card" className="flex h-full flex-col rounded-xl border border-border/70 bg-gradient-to-b from-violet-500/[0.04] to-transparent p-5">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/[0.08] text-violet-600 dark:text-violet-400" aria-hidden>
          <FileBadge2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold tracking-tight text-foreground">Official Report Card</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Your school-issued academic record</p>
          <p className="mt-1.5 truncate text-[11px] font-medium text-foreground/75">
            {props.assessment.name} · {getActiveAcademicSessionLabel() ?? SESSION_NOT_SET_LABEL}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 sm:flex-nowrap">
        <Button size="sm" onClick={() => setOpen(true)} className="h-8 flex-1 gap-1.5 text-xs">
          <Eye className="h-3.5 w-3.5" /> View Report Card
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload} className="h-8 flex-1 gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" /> Download
        </Button>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground/70">
        Marks, grade{props.reportCardConfig.includeAttendance ? ', attendance' : ''}
        {props.result.remark ? ' and the teacher\'s remark' : ''} — exactly as published by your school.
      </p>

      {/* In-app preview — the institutional document on an A4 sheet */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="text-sm">Report Card — {props.assessment.name}</DialogTitle>
            <DialogDescription className="text-xs">
              Official document preview · {props.identity.name} · {props.identity.classSection}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto bg-muted/40 p-4">
            <iframe
              ref={iframeRef}
              title={`Report card preview — ${props.assessment.name}`}
              srcDoc={html}
              className={cn('h-[62vh] w-full rounded-lg border border-border bg-white shadow-sm')}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            <Button size="sm" variant="outline" onClick={handlePrint} className="h-8 gap-1.5 text-xs">
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
            <Button size="sm" onClick={handleDownload} className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          </div>
      </DialogContent>
      </Dialog>
    </section>
  )
}
