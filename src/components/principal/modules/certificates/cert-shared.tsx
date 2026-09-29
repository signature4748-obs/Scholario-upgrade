'use client'

/**
 * cert-shared — shared primitives for the Document Generation module.
 *
 * Design language (per Academics spec):
 *   - ONE primary hue (emerald) for all doc-type accents. The icon
 *     differentiates the type; the color stays consistent.
 *   - Color appears only as small chips/pills/dots, never as large color
 *     blocks. No indigo or blue.
 *   - Section containers use CertPanel (flat, no card-in-card).
 *   - Icons default to h-3.5/h-4; h-5 max for doc-type selection tiles.
 */

import { motion } from 'framer-motion'
import {
  ScrollText, FileOutput, FileSignature, IdCard, Receipt,
  GraduationCap, FileBarChart, ArrowRight, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '../shared/panel'
import type { DocType, DocStatus, TemplateStyle } from '@/lib/store/certificates-store'

// ─── Doc-type metadata (icons only — all share emerald accent) ────────

export interface DocTypeMeta {
  label: DocType
  short: string
  icon: LucideIcon
  /** Always 'emerald' — kept on the interface for backward compatibility. */
  accent: 'emerald'
  needsStudent: boolean
  needsExam?: boolean
  needsFeeTxn?: boolean
  description: string
}

export const DOC_TYPES: DocTypeMeta[] = [
  {
    label: 'Bonafide',
    short: 'Bonafide',
    icon: ScrollText,
    accent: 'emerald',
    needsStudent: true,
    description: 'Confirm student enrolment at the school.',
  },
  {
    label: 'Transfer',
    short: 'Transfer',
    icon: FileOutput,
    accent: 'emerald',
    needsStudent: true,
    description: 'Issue transfer certificate (TC) on exit.',
  },
  {
    label: 'Character',
    short: 'Character',
    icon: FileSignature,
    accent: 'emerald',
    needsStudent: true,
    description: 'Attest good moral conduct of student.',
  },
  {
    label: 'ID Card',
    short: 'ID Card',
    icon: IdCard,
    accent: 'emerald',
    needsStudent: true,
    description: 'Print student identity card for the year.',
  },
  {
    label: 'Fee Receipt',
    short: 'Fee Receipt',
    icon: Receipt,
    accent: 'emerald',
    needsStudent: true,
    needsFeeTxn: true,
    description: 'Reprint official fee payment receipt.',
  },
  {
    label: 'Migration',
    short: 'Migration',
    icon: GraduationCap,
    accent: 'emerald',
    needsStudent: true,
    description: 'Migration certificate for board/college.',
  },
  {
    label: 'Marksheet',
    short: 'Marksheet',
    icon: FileBarChart,
    accent: 'emerald',
    needsStudent: true,
    needsExam: true,
    description: 'Issue marks/report card from an examination.',
  },
]

export const DOC_TYPE_BY_LABEL: Record<DocType, DocTypeMeta> =
  DOC_TYPES.reduce((acc, d) => { acc[d.label] = d; return acc }, {} as Record<DocType, DocTypeMeta>)

// ─── Fields printed per doc type (for template cards) ─────────────────
// Honest capability list — describes what each document template renders,
// derived from the actual preview bodies in previews.tsx.

export const DOC_FIELDS: Record<DocType, string[]> = {
  'Bonafide': ['Name', 'Admission no', 'Class & section', 'Date of birth', 'Academic year', 'Purpose'],
  'Transfer': ['Name', 'Parents', 'Date of birth', 'Admission no', 'Class at leaving', 'Fee status', 'Conduct', 'Result'],
  'Character': ['Name', 'Admission no', 'Enrolment period', 'Conduct', 'Purpose'],
  'ID Card': ['Photo', 'Name', 'Class & section', 'Admission no', 'Roll no', 'Date of birth', 'Blood group', 'Validity'],
  'Fee Receipt': ['Receipt no', 'Date', 'Student', 'Class', 'Payment mode', 'Fee head', 'Amount', 'Signatories'],
  'Migration': ['Name', 'Parents', 'Date of birth', 'Class', 'Academic year', 'Eligibility'],
  'Marksheet': ['Exam', 'Session', 'Class', 'Roll no', 'Subject marks', 'Totals', 'Grade', 'Division', 'Remarks'],
}

// ─── Accent map (single emerald hue only) ─────────────────────────────
//
// All doc-type accents resolve to emerald so the module reads as ONE
// family instead of a 7-hue rainbow. The DOC_TYPES array keeps an
// `accent` field for backward-compat with any external callers, but
// it is always 'emerald'.

const ACCENT_MAP = {
  emerald: {
    bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    cardBg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]',
    cardBorder: 'border-emerald-500/20',
  },
} as const

export type CertAccent = keyof typeof ACCENT_MAP

export function accentClasses(_accent: CertAccent = 'emerald') {
  return ACCENT_MAP.emerald
}

// ─── CertKpiCard (retained for callers, but no longer used by the
//     Certificates shell — header uses meta strip + tab counts only). ───

interface KpiProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent?: CertAccent
  onClick?: () => void
  delay?: number
}

export function CertKpiCard({ icon, label, value, sub, accent: _accent, onClick, delay = 0 }: KpiProps) {
  const a = ACCENT_MAP.emerald
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'group relative w-full text-left rounded-xl border p-3.5 transition-all duration-200 overflow-hidden',
        a.cardBg, a.cardBorder,
        onClick && `cursor-pointer hover:shadow-md hover:-translate-y-0.5`,
        onClick && 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <div className={cn('absolute -top-6 -right-6 h-16 w-16 rounded-full blur-2xl opacity-30', a.bg)} aria-hidden />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider truncate">{label}</p>
          <p className="font-display text-xl sm:text-2xl font-bold tabular-nums mt-1.5 leading-none">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-1.5 truncate">{sub}</p>}
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', a.bg, a.ring)}>
          {icon}
        </span>
      </div>
      {onClick && (
        <ArrowRight className="absolute bottom-2 right-2 h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </motion.button>
  )
}

// ─── CertPanel (flat section container — re-exports shared Panel) ────
//
// Converged to the shared Academics-pattern Panel: flat rounded card with
// title + optional subtitle + optional action on a header row, then body
// content below. NO `border-b bg-muted/20` header strip — the Academics
// visual language uses a single flat surface for all section containers.

export const CertPanel = Panel

// ─── Status badge ─────────────────────────────────────────────────────

export function DocStatusBadge({ status }: { status: DocStatus }) {
  // Status colours only — these are status semantics, not doc-type accents,
  // so they intentionally use the canonical Academics status palette.
  const map: Record<DocStatus, string> = {
    'Generated': 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
    'Printed': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    'Downloaded': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    'Issued': 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold', map[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

// ─── Style pill ─────────────────────────────────────────────────────────

export function StylePill({ style, accent }: { style: TemplateStyle; accent?: string }) {
  return (
    <span
      className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap')}
      style={accent ? { background: `${accent}15`, color: accent } : undefined}
    >
      {style}
    </span>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────

export function CertEmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/60 mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  )
}

// ─── Print-only global styles (injected by the module shell) ──────────

export const CERT_PRINT_STYLES = `
@media print {
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area {
    position: absolute !important;
    inset: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    box-shadow: none !important;
    border: none !important;
  }
  .no-print { display: none !important; }
  @page { margin: 12mm; }
}
@media (prefers-reduced-motion: reduce) {
  .cert-shell * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`
