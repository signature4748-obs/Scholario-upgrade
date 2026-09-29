'use client'

/**
 * previews — printable document previews.
 *
 * Renders four kinds of documents based on real data:
 *   - CertificatePreview  → Bonafide / Transfer / Character / Migration
 *   - MarksheetPreview    → exam results table
 *   - IDCardPreview       → student identity card
 *   - FeeReceiptPreview   → fee transaction receipt
 *
 * Each preview responds to the template's `style`:
 *   Certificates: Classic · Modern · Formal · Minimal
 *   Marksheets:   Standard · Modern · Compact
 *   ID Cards:     Classic · Modern · Compact
 *   Fee Receipts: Standard · Compact
 *
 * All previews wrap their content in a `print-area` className so the global
 * `@media print` rule in `cert-shared.tsx` isolates them when printing.
 */

import {
  GraduationCap, CreditCard,
  QrCode, Stamp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSchoolProfile } from '@/lib/school-profile'
import { formatINR, formatDate } from '@/lib/format'
import type {
  DocType, DocumentTemplate,
} from '@/lib/store/certificates-store'
import type { PreviewStudent, PreviewTransaction } from './cert-resolvers'

// ─── Shared marksheet row type ───────────────────────────────────────

export interface MarksheetRow {
  subject: string
  max: number
  pass: number
  obtained: number
  isAbsent?: boolean
}
export interface MarksheetData {
  examName: string
  className: string
  section: string
  session: string
  rows: MarksheetRow[]
  totalObtained: number
  totalMax: number
  percentage: number
  grade: string
  result: 'PASS' | 'FAIL' | '—'
  rank?: number
  remarks?: string
}

// ─── School header component ────────────────────────────────────────

function SchoolCrest({ accent, label }: { accent: string; label?: string }) {
  const school = useSchoolProfile()
  const text = label ?? school.shortName
  return (
    <div
      className="flex flex-col items-center justify-center h-14 w-14 rounded-full text-white shadow-sm shrink-0"
      style={{ background: accent, boxShadow: `0 0 0 3px ${accent}20` }}
    >
      <GraduationCap className="h-5 w-5" />
      <span className="text-[7px] font-bold mt-0.5 tracking-wider uppercase">{text.slice(0, 8)}</span>
    </div>
  )
}

function SchoolHeader({
  accent, style, docType: _docType,
}: {
  accent: string
  style: 'Classic' | 'Modern' | 'Formal' | 'Minimal'
  docType: DocType
}) {
  // Branding source of truth: School Settings → General (with safe fallbacks).
  const school = useSchoolProfile()
  if (style === 'Modern') {
    return (
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-300">
        <div className="flex items-center gap-2">
          <SchoolCrest accent={accent} />
          <div>
            <p className="font-bold text-slate-900 text-base leading-tight">{school.name}</p>
            <p className="text-[9px] text-slate-600">{school.affiliation}</p>
          </div>
        </div>
        <div className="text-right text-[9px] text-slate-600 leading-tight">
          <p>{school.address}</p>
          <p>{school.phone} · {school.email}</p>
        </div>
      </div>
    )
  }
  // Classic / Formal / Minimal — all centered (Minimal is just simpler).
  return (
    <div className={cn('flex flex-col items-center text-center', style === 'Minimal' && 'py-2')}>
      <SchoolCrest accent={accent} />
      <p className="font-serif font-bold text-slate-900 text-base sm:text-lg mt-2 leading-tight">{school.name}</p>
      <p className="text-[9px] text-slate-600 mt-0.5">{school.affiliation}</p>
      <p className="text-[9px] text-slate-600">{school.address}</p>
      <p className="text-[9px] text-slate-600">{school.phone} · {school.email}</p>
    </div>
  )
}

// ─── Border/frame per style ──────────────────────────────────────────

function Frame({
  style, accent, children, className: _className,
}: {
  style: 'Classic' | 'Modern' | 'Formal' | 'Minimal'
  accent: string
  children: React.ReactNode
  className?: string
}) {
  if (style === 'Classic') {
    return (
      <div
        className="p-1.5 shadow-md shadow-slate-900/10"
        style={{ background: accent, borderRadius: 4 }}
      >
        <div
          className="bg-white p-3 sm:p-5"
          style={{ outline: `1px solid ${accent}80` }}
        >
          {children}
        </div>
      </div>
    )
  }
  if (style === 'Formal') {
    return (
      <div
        className="bg-white p-3 sm:p-6 shadow-md shadow-slate-900/10"
        style={{ border: `3px double ${accent}`, outline: `1px solid ${accent}`, outlineOffset: '3px' }}
      >
        {children}
      </div>
    )
  }
  if (style === 'Modern') {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-md border border-slate-300 shadow-md shadow-slate-900/10">
        {children}
      </div>
    )
  }
  // Minimal
  return (
    <div className="bg-white p-6 sm:p-10 shadow-md shadow-slate-900/10" style={{ border: `1px solid ${accent}40` }}>
      {children}
    </div>
  )
}

// ─── CertificatePreview ─────────────────────────────────────────────

export function CertificatePreview({
  docType, template, student, docNumber, purpose,
}: {
  docType: DocType
  template: DocumentTemplate
  student?: PreviewStudent
  docNumber?: string
  purpose?: string
}) {
  const school = useSchoolProfile()
  if (!student) {
    return (
      <div className="print-area text-center py-12 text-xs text-muted-foreground">
        Select a student to preview the certificate.
      </div>
    )
  }
  const accent = template.accentColor
  const style = template.style as 'Classic' | 'Modern' | 'Formal' | 'Minimal'
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

  const docTitle: Record<DocType, string> = {
    'Bonafide': 'BONAFIDE CERTIFICATE',
    'Transfer': 'TRANSFER CERTIFICATE',
    'Character': 'CHARACTER CERTIFICATE',
    'Migration': 'MIGRATION CERTIFICATE',
    'ID Card': 'ID CARD',
    'Fee Receipt': 'FEE RECEIPT',
    'Marksheet': 'MARKSHEET',
  }
  const isSerif = style === 'Classic' || style === 'Formal'
  const titleCls = isSerif ? 'font-serif tracking-[0.18em] text-slate-900' : 'font-sans tracking-tight text-slate-900'

  // Body text differs per docType
  const purposeText = purpose ?? (docType === 'Bonafide' ? 'bank account opening' : 'all official purposes')

  let body: React.ReactNode = null
  if (docType === 'Bonafide') {
    body = (
      <p className={cn('text-[11px] sm:text-[13px] leading-relaxed text-slate-800', isSerif && 'font-serif')}>
        This is to certify that <strong>{student.name}</strong>,
        bearing admission number <strong>{student.admissionNo}</strong>,
        is a bonafide student of <strong>{school.name}</strong>,
        studying in Class <strong>{student.className}</strong>
        {student.section ? `, Section ${student.section}` : ''} for the
        academic year <strong>{school.academicYear}</strong>. Date of birth
        recorded: <strong>{formatDate(student.dob)}</strong>.
        This certificate is issued for the purpose of{' '}
        <strong>{purposeText}</strong>.
      </p>
    )
  } else if (docType === 'Transfer') {
    body = (
      <div className="space-y-2">
        <p className={cn('text-[11px] sm:text-[13px] leading-relaxed text-slate-800', isSerif && 'font-serif')}>
          This is to certify that <strong>{student.name}</strong>,
          son/daughter of <strong>{student.fatherName}</strong>,
          was a student of this school from{' '}
          <strong>{formatDate(student.admissionDate)}</strong> to{' '}
          <strong>{today}</strong>, studying in Class <strong>{student.className}</strong>.
          His/her date of birth is <strong>{formatDate(student.dob)}</strong>{' '}
          (in words: {birthWords(student.dob)}).
        </p>
        <table className="w-full text-[10px] sm:text-[12px] text-slate-800">
          <tbody className="divide-y divide-slate-200">
            <TCRow label="Admission No." value={student.admissionNo} serif={isSerif} />
            <TCRow label="Father's Name" value={student.fatherName} serif={isSerif} />
            <TCRow label="Mother's Name" value={student.motherName} serif={isSerif} />
            <TCRow label="Date of Birth" value={formatDate(student.dob)} serif={isSerif} />
            <TCRow label="Class at leaving" value={student.className} serif={isSerif} />
            <TCRow label="Last fee month paid" value="March 2026" serif={isSerif} />
            <TCRow label="Conduct" value="Excellent" serif={isSerif} />
            <TCRow label="Result" value="Promoted" serif={isSerif} />
            <TCRow label="Category" value={student.category ?? '—'} serif={isSerif} />
          </tbody>
        </table>
        <p className={cn('text-[10px] sm:text-[11px] text-slate-600 italic', isSerif && 'font-serif')}>
          Certified that the student has paid all school dues and to the best
          of my knowledge has been a regular student of good conduct. This
          transfer certificate is issued at the request of the parent /
          guardian.
        </p>
      </div>
    )
  } else if (docType === 'Character') {
    body = (
      <p className={cn('text-[11px] sm:text-[13px] leading-relaxed text-slate-800', isSerif && 'font-serif')}>
        This is to certify that <strong>{student.name}</strong>,
        bearing admission number <strong>{student.admissionNo}</strong>,
        has been a student of {school.name} from{' '}
        <strong>{formatDate(student.admissionDate)}</strong> to{' '}
        <strong>{today}</strong>. During this period, he/she has borne an{' '}
        <strong>excellent moral character</strong>, has been disciplined and
        respectful, and has shown a positive attitude towards studies and
        fellow students. To the best of our knowledge, he/she has not been
        involved in any unlawful activity. This certificate is issued for{' '}
        <strong>{purposeText}</strong>.
      </p>
    )
  } else if (docType === 'Migration') {
    body = (
      <p className={cn('text-[11px] sm:text-[13px] leading-relaxed text-slate-800', isSerif && 'font-serif')}>
        This is to certify that <strong>{student.name}</strong>,
        son/daughter of <strong>{student.fatherName}</strong>, date of birth{' '}
        <strong>{formatDate(student.dob)}</strong>, was a regular student of
        this institution and was studying in Class{' '}
        <strong>{student.className}</strong> for the academic year{' '}
        {school.academicYear}. He/she has successfully cleared the prescribed
        examinations and is eligible for migration to another board /
        institution. This migration certificate is issued at the request of
        the student.
      </p>
    )
  }

  return (
    <div className="print-area w-full bg-slate-100 dark:bg-slate-800/70 p-3 sm:p-5">
      <Frame style={style} accent={accent}>
        <SchoolHeader accent={accent} style={style} docType={docType} />

        {/* Title */}
        <div className={cn('mt-4 mb-3 text-center', style === 'Minimal' && 'mt-8')}>
          <p className={cn('text-[11px] uppercase text-slate-500 font-semibold tracking-widest', isSerif && 'font-serif')}>
            {docType === 'Migration' ? 'School' : 'Office'} of the Principal
          </p>
          <h2 className={cn('text-base sm:text-xl font-bold mt-1', titleCls)}>
            {docTitle[docType]}
          </h2>
          <div
            className="h-0.5 w-24 mx-auto mt-2 rounded"
            style={{ background: accent }}
          />
        </div>

        {/* Doc number strip — honest: the number is assigned at issue time */}
        <div className="flex items-center justify-between text-[9px] text-slate-600 mb-4">
          <span>Certificate No: <strong className="text-slate-800">{docNumber ?? 'assigned on issue'}</strong></span>
          <span>Session: <strong className="text-slate-800">{school.academicYear}</strong></span>
        </div>

        {/* Body */}
        <div className={cn(style === 'Minimal' ? 'py-6' : 'py-2')}>
          {body}
        </div>

        {/* Footer signatures */}
        <div className="mt-10 sm:mt-14 grid grid-cols-2 gap-6">
          <div className="text-center">
            <div className="h-0.5 bg-slate-400 w-full mb-1" />
            <p className={cn('text-[9px] text-slate-600', isSerif && 'font-serif')}>Clerk / Office</p>
          </div>
          <div className="text-center">
            <div className="flex items-end justify-center gap-1">
              <Stamp className="h-5 w-5 text-rose-700/70 -rotate-12" />
              <div className="h-0.5 bg-slate-400 w-full mb-1 ml-1" />
            </div>
            <p className={cn('text-[9px] text-slate-600 font-semibold', isSerif && 'font-serif')}>
              {school.principal}
            </p>
            <p className={cn('text-[8px] text-slate-500', isSerif && 'font-serif')}>Principal</p>
          </div>
        </div>

        <div className="text-center mt-4 text-[8px] text-slate-400">
          Date of issue: {today} · This is a computer-generated certificate.
        </div>
      </Frame>
    </div>
  )
}

function TCRow({ label, value, serif }: { label: string; value: string; serif?: boolean }) {
  return (
    <tr>
      <td className={cn('py-1 pr-2 text-slate-500 w-1/3', serif && 'font-serif')}>{label}</td>
      <td className={cn('py-1 text-slate-900 font-medium', serif && 'font-serif')}>{value}</td>
    </tr>
  )
}

// Quick "in words" for date of birth (very compact).
function birthWords(dob: string): string {
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${ordinal(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── MarksheetPreview ──────────────────────────────────────────────

export function MarksheetPreview({
  template, student, data, docNumber,
}: {
  template: DocumentTemplate
  student?: PreviewStudent
  data?: MarksheetData
  docNumber?: string
}) {
  const school = useSchoolProfile()
  if (!student || !data) {
    return (
      <div className="print-area text-center py-12 text-xs text-muted-foreground">
        Select examination, class and student to preview the marksheet.
      </div>
    )
  }
  const accent = template.accentColor
  const style = template.style
  const isCompact = style === 'Compact'
  const isModern = style === 'Modern'

  return (
    <div className={cn('print-area w-full bg-slate-100 dark:bg-slate-800/70 p-3 sm:p-5')}>
      <div className={cn(
        'bg-white shadow-md shadow-slate-900/10',
        isCompact && 'p-4 border border-slate-300',
        !isCompact && 'p-5 sm:p-7 border-2',
      )} style={!isCompact ? { borderColor: accent } : undefined}>
        {/* Header */}
        <div className={cn(
          'flex items-center justify-between gap-3',
          isCompact && 'pb-2 border-b border-slate-300',
          !isCompact && 'pb-3 mb-3 border-b-2',
        )} style={!isCompact ? { borderColor: `${accent}40` } : undefined}>
          <div className="flex items-center gap-2">
            <SchoolCrest accent={accent} />
            <div>
              <p className={cn('font-bold text-slate-900 leading-tight', isCompact ? 'text-[13px]' : 'text-base')}>{school.name}</p>
              <p className="text-[9px] text-slate-600">{school.affiliation}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={cn('font-semibold uppercase tracking-wider text-slate-800', isCompact ? 'text-[10px]' : 'text-[12px]')}>
              {data.examName}
            </p>
            <p className="text-[9px] text-slate-600">
              Session {data.session} · Class {data.className}{data.section ? ` · Sec ${data.section}` : ''}
            </p>
            <p className="text-[8px] text-slate-500">Doc No: {docNumber ?? '—'}</p>
          </div>
        </div>

        {/* Student meta strip */}
        <div className={cn('flex items-center justify-between text-[10px] mb-2', isCompact && 'text-[9px]')}>
          <div className="space-y-0.5">
            <p><span className="text-slate-500">Name:</span> <strong className="text-slate-900">{student.name}</strong></p>
            <p><span className="text-slate-500">Adm. No:</span> <span className="text-slate-800">{student.admissionNo}</span></p>
          </div>
          <div className="text-right space-y-0.5">
            <p><span className="text-slate-500">Roll:</span> <span className="text-slate-800">{student.rollNo}</span></p>
            <p><span className="text-slate-500">DOB:</span> <span className="text-slate-800">{formatDate(student.dob)}</span></p>
          </div>
        </div>

        {/* Marks table */}
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr style={{ background: isModern ? accent : `${accent}10`, color: isModern ? '#fff' : accent }}>
              <th className="text-left px-2 py-1.5 font-semibold border border-slate-300">Subject</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">Max</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">Pass</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">Obtained</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">%</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">Grade</th>
              <th className="text-center px-2 py-1.5 font-semibold border border-slate-300">Result</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const pct = r.max > 0 ? Math.round((r.obtained / r.max) * 100) : 0
              const grade = gradeFor(pct)
              const pass = r.obtained >= r.pass
              return (
                <tr key={r.subject} className="even:bg-slate-50/50">
                  <td className="px-2 py-1 border border-slate-200 text-slate-800 font-medium">{r.subject}</td>
                  <td className="px-2 py-1 border border-slate-200 text-center text-slate-700">{r.max}</td>
                  <td className="px-2 py-1 border border-slate-200 text-center text-slate-700">{r.pass}</td>
                  <td className="px-2 py-1 border border-slate-200 text-center text-slate-900 font-semibold">
                    {r.isAbsent ? 'AB' : r.obtained}
                  </td>
                  <td className="px-2 py-1 border border-slate-200 text-center text-slate-700">{r.isAbsent ? '—' : pct}</td>
                  <td className="px-2 py-1 border border-slate-200 text-center font-semibold">{r.isAbsent ? 'E' : grade}</td>
                  <td className={cn('px-2 py-1 border border-slate-200 text-center font-semibold', pass ? 'text-emerald-700' : 'text-rose-700')}>
                    {pass ? 'P' : 'F'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td className="px-2 py-1.5 border border-slate-300 text-slate-900">Total</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-900">{data.totalMax}</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-500">—</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-900">{data.totalObtained}</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-900">{data.percentage.toFixed(1)}</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-900">{data.grade}</td>
              <td className="px-2 py-1.5 border border-slate-300 text-center text-slate-900">{data.result}</td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
          <div className="border border-slate-200 rounded px-2 py-1">
            <p className="text-slate-500 text-[8px] uppercase">Percentage</p>
            <p className="font-bold text-slate-900">{data.percentage.toFixed(2)}%</p>
          </div>
          <div className="border border-slate-200 rounded px-2 py-1">
            <p className="text-slate-500 text-[8px] uppercase">Division</p>
            <p className="font-bold text-slate-900">{divisionFor(data.percentage)}</p>
          </div>
          <div className="border border-slate-200 rounded px-2 py-1">
            <p className="text-slate-500 text-[8px] uppercase">Rank</p>
            <p className="font-bold text-slate-900">{data.rank ?? '—'}</p>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div className="text-[9px] text-slate-600 max-w-[60%]">
            <p className="font-semibold text-slate-800">Remarks:</p>
            <p className="italic">{data.remarks ?? 'Conduct: Excellent. Regularity: Satisfactory.'}</p>
          </div>
          <div className="text-center">
            <div className="h-0.5 w-32 bg-slate-400 mb-1" />
            <p className="text-[9px] text-slate-800 font-semibold">{school.principal}</p>
            <p className="text-[8px] text-slate-500">Principal</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function gradeFor(pct: number): string {
  if (pct >= 90) return 'A1'
  if (pct >= 80) return 'A2'
  if (pct >= 70) return 'B1'
  if (pct >= 60) return 'B2'
  if (pct >= 50) return 'C1'
  if (pct >= 33) return 'C2'
  return 'E'
}
function divisionFor(pct: number): string {
  if (pct >= 60) return 'First'
  if (pct >= 45) return 'Second'
  if (pct >= 33) return 'Third'
  return 'Fail'
}

// ─── ID Card preview ───────────────────────────────────────────────

export function IDCardPreview({
  template, student,
}: {
  template: DocumentTemplate
  student?: PreviewStudent
}) {
  const school = useSchoolProfile()
  if (!student) {
    return (
      <div className="print-area text-center py-12 text-xs text-muted-foreground">
        Select a student to preview the ID card.
      </div>
    )
  }
  const accent = template.accentColor
  const style = template.style
  const isLandscape = style === 'Modern'
  const isCompact = style === 'Compact'

  const Card = (
    <div
      className={cn(
        'bg-white shadow-md overflow-hidden relative flex flex-col',
        isLandscape
          ? 'w-[420px] h-[260px] rounded-lg'
          : isCompact
            ? 'w-[280px] h-[420px] rounded-md'
            : 'w-[300px] h-[460px] rounded-lg',
      )}
      style={{ border: `1px solid ${accent}30` }}
    >
      {/* Header strip */}
      <div
        className="flex items-center gap-2 px-3 py-2 text-white"
        style={{ background: accent }}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <GraduationCap className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold leading-tight truncate">{school.name}</p>
          <p className="text-[7px] opacity-90 leading-tight">{school.affiliation}</p>
        </div>
      </div>

      {/* Body */}
      <div className={cn('flex p-3 gap-3', isLandscape ? 'flex-row' : 'flex-col items-center')}>
        {/* Photo placeholder */}
        <div
          className={cn(
            'bg-slate-100 border-2 border-dashed flex items-center justify-center text-slate-400 shrink-0',
            isLandscape ? 'w-[90px] h-[110px]' : 'w-[100px] h-[120px]',
          )}
          style={{ borderColor: `${accent}40` }}
        >
          <CreditCard className="h-6 w-6" />
        </div>
        {/* Student info */}
        <div className={cn('flex-1 min-w-0', isLandscape ? '' : 'w-full text-center')}>
          <p className="text-[12px] font-bold text-slate-900 leading-tight truncate">{student.name}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Class {student.className} · Sec {student.section}</p>
          <div className={cn('mt-2 space-y-0.5 text-[9px] text-slate-700', isLandscape && 'grid grid-cols-2 gap-x-2')}>
            <p><span className="text-slate-500">Adm No:</span> <strong>{student.admissionNo}</strong></p>
            <p><span className="text-slate-500">Roll:</span> <strong>{student.rollNo}</strong></p>
            <p><span className="text-slate-500">DOB:</span> {student.dob ? formatDate(student.dob) : '—'}</p>
            <p><span className="text-slate-500">Blood:</span> {student.bloodGroup ?? '—'}</p>
            <p><span className="text-slate-500">House:</span> {student.houseName ?? '—'}</p>
          </div>
          <p className="text-[8px] text-slate-500 mt-1.5 truncate">{school.address}</p>
          <p className="text-[8px] text-slate-500">Valid: {school.academicYear}</p>
        </div>
        {/* QR placeholder for Modern */}
        {isLandscape && (
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="h-16 w-16 bg-slate-100 border border-slate-300 rounded flex items-center justify-center">
              <QrCode className="h-8 w-8 text-slate-500" />
            </div>
            <span className="text-[7px] text-slate-500">Scan to verify</span>
          </div>
        )}
      </div>

      {/* Footer strip */}
      <div
        className={cn('text-white text-center', isLandscape ? 'px-3 py-1.5 text-[8px]' : 'px-3 py-2 text-[8px] absolute bottom-0 w-[280px]')}
        style={{ background: accent }}
      >
        Authorised by {school.principal} · {school.phone}
      </div>
    </div>
  )

  return (
    <div className="print-area w-full bg-slate-100 dark:bg-slate-800/70 p-4 overflow-x-auto">
      <div className="flex min-w-max justify-center">
        <div className="flex flex-col items-center">
          {Card}
          {!isLandscape && (
            <p className="mt-3 text-[9px] text-slate-500 font-mono">{student.admissionNo} · {school.shortName}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Fee Receipt preview ────────────────────────────────────────────

export function FeeReceiptPreview({
  template, transaction, docNumber,
}: {
  template: DocumentTemplate
  transaction?: PreviewTransaction
  docNumber?: string
}) {
  const school = useSchoolProfile()
  if (!transaction) {
    return (
      <div className="print-area text-center py-12 text-xs text-muted-foreground">
        Select a student and a fee transaction to preview the receipt.
      </div>
    )
  }
  const accent = template.accentColor
  const style = template.style
  const isCompact = style === 'Compact'

  if (isCompact) {
    // Thermal-style narrow column
    return (
      <div className="print-area w-full bg-slate-100 dark:bg-slate-800/70 p-3 flex justify-center">
        <div className="w-[280px] bg-white font-mono text-[10px] leading-tight shadow-md p-3" style={{ border: `1px solid ${accent}30` }}>
          <div className="text-center mb-1">
            <p className="font-bold text-[11px] tracking-tight">{school.name.toUpperCase()}</p>
            <p className="text-[8px] text-slate-600">{school.address}</p>
            <p className="text-[8px] text-slate-600">Ph: {school.phone}</p>
            <p className="text-[8px] text-slate-600">Affiliation: {school.affiliation}</p>
          </div>
          <Dashed accent={accent} />
          <p className="text-center font-bold text-[10px] tracking-[0.2em] my-1">FEE RECEIPT</p>
          <Dashed accent={accent} />
          <div className="space-y-0.5 text-[9px]">
            <ReceiptRow label="Receipt No" value={transaction.receiptNo} />
            <ReceiptRow label="Doc No" value={docNumber ?? '—'} />
            <ReceiptRow label="Date" value={formatDate(transaction.date)} />
            <ReceiptRow label="Student" value={transaction.studentName} />
            <ReceiptRow label="Adm No" value={transaction.admissionNo} />
            <ReceiptRow label="Class" value={transaction.className} />
            <ReceiptRow label="Mode" value={transaction.mode} />
            {transaction.referenceNo && (
              <ReceiptRow label="Ref No" value={transaction.referenceNo} />
            )}
            <ReceiptRow label="Fee Head" value={transaction.feeHead} />
            <ReceiptRow label="Purpose" value={transaction.purpose} />
          </div>
          <Dashed accent={accent} />
          <div className="flex items-center justify-between font-bold text-[12px] my-1">
            <span>TOTAL</span>
            <span>{formatINR(transaction.amount)}</span>
          </div>
          <Dashed accent={accent} />
          <div className="mt-2 text-center text-[8px] text-slate-600">
            <p>Verified by: {transaction.verifiedBy ?? '—'}</p>
            <p className="mt-2 italic">Thank you for your payment.</p>
            <p className="mt-1 opacity-70">Computer-generated · {school.shortName}</p>
          </div>
        </div>
      </div>
    )
  }

  // Standard receipt
  return (
    <div className="print-area w-full bg-slate-100 dark:bg-slate-800/70 p-3 sm:p-5">
      <div
        className="bg-white p-4 sm:p-6 max-w-[640px] mx-auto shadow-md shadow-slate-900/10"
        style={{ border: `2px solid ${accent}` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b" style={{ borderColor: `${accent}40` }}>
          <div className="flex items-center gap-2">
            <SchoolCrest accent={accent} />
            <div>
              <p className="font-bold text-slate-900 text-base leading-tight">{school.name}</p>
              <p className="text-[9px] text-slate-600">{school.affiliation}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-[12px] uppercase tracking-wider" style={{ color: accent }}>Fee Receipt</p>
            <p className="text-[9px] text-slate-600">Receipt No: {transaction.receiptNo}</p>
            <p className="text-[9px] text-slate-600">Doc No: {docNumber ?? '—'}</p>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
          <KV label="Student" value={transaction.studentName} />
          <KV label="Admission No" value={transaction.admissionNo} />
          <KV label="Class" value={transaction.className} />
          <KV label="Date" value={formatDate(transaction.date)} />
          <KV label="Mode" value={transaction.mode} />
          <KV label="Reference" value={transaction.referenceNo ?? '—'} />
          <KV label="Academic Year" value={transaction.academicYear ?? school.academicYear} />
          <KV label="Status" value={transaction.status ?? 'Paid'} />
        </div>

        {/* Itemized table */}
        <table className="w-full text-[11px] mt-3 border-collapse">
          <thead>
            <tr style={{ background: `${accent}15`, color: accent }}>
              <th className="text-left px-2 py-1.5 font-semibold border border-slate-300">Fee Head</th>
              <th className="text-left px-2 py-1.5 font-semibold border border-slate-300">Purpose</th>
              <th className="text-right px-2 py-1.5 font-semibold border border-slate-300">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="even:bg-slate-50/50">
              <td className="px-2 py-1.5 border border-slate-200 text-slate-800 font-medium">{transaction.feeHead}</td>
              <td className="px-2 py-1.5 border border-slate-200 text-slate-700">{transaction.purpose}</td>
              <td className="px-2 py-1.5 border border-slate-200 text-right text-slate-900 font-semibold tabular-nums">
                {transaction.amount.toLocaleString('en-IN')}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-slate-100">
              <td className="px-2 py-1.5 border border-slate-300 font-semibold text-slate-900" colSpan={2}>Total Paid</td>
              <td className="px-2 py-1.5 border border-slate-300 text-right font-bold text-slate-900 tabular-nums">
                {formatINR(transaction.amount)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div className="mt-4 flex items-end justify-between">
          <div className="text-[10px] text-slate-600">
            <p>Collected by: <strong className="text-slate-800">{transaction.collectedBy ?? '—'}</strong></p>
            <p>Verified by: <strong className="text-slate-800">{transaction.verifiedBy ?? '—'}</strong></p>
          </div>
          <div className="text-center">
            <div className="h-0.5 w-32 bg-slate-400 mb-1" />
            <p className="text-[9px] text-slate-800 font-semibold">{school.principal}</p>
            <p className="text-[8px] text-slate-500">Principal</p>
          </div>
        </div>
        <div className="text-center mt-3 text-[8px] text-slate-400 italic">
          Thank you for your payment. This is a computer-generated receipt.
        </div>
      </div>
    </div>
  )
}

function Dashed({ accent }: { accent: string }) {
  return (
    <div
      className="my-1 h-0"
      style={{ borderTop: `1px dashed ${accent}60` }}
    />
  )
}
function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900 text-right truncate max-w-[150px]">{value}</span>
    </div>
  )
}
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="font-semibold text-slate-900 truncate">{value}</p>
    </div>
  )
}
