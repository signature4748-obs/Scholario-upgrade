'use client'

/**
 * fees-shared — Shared primitives for the Fee Management workspace.
 *
 * - FeeTab type
 * - FeeKpiCard (clickable KPI)
 * - FeeStat (compact stat block)
 * - FeePill (status/mode pill)
 * - FeePanel (rounded card container)
 * - FeeEmptyState
 * - ModeIcon + mode accent helpers
 */

import { motion } from 'framer-motion'
import {
  Smartphone, CreditCard, Building2, Banknote, FileText, Wallet, ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate, formatTime } from '@/lib/format'
import { collectorSourceLabel, type FeeTransaction, type PaymentMode } from '@/lib/store/fee-store'
import { Panel } from '../shared/panel'
import { ModuleEmptyState } from '../shared/empty-state'

// ─── Tab type ────────────────────────────────────────────────────────

/**
 * FINAL INFORMATION ARCHITECTURE (6 top-level sections):
 *
 *   Overview      — Insights: financial health + what needs attention
 *   Student Accts — Per-student fee accounts
 *   Fee Structures— Configured fee rules
 *   Payments      — Operations: collect + verify (actions)
 *   Transactions  — The authoritative payment history (ledger)
 *   Settings      — Configuration
 *
 * Payments is an operations page (no nested Overview/Transactions/Verify
 * sub-views); the ledger is a dedicated top-level section.
 */
export type FeeTab =
  | 'overview'
  | 'accounts'
  | 'structures'
  | 'payments'
  | 'outreach'
  | 'transactions'
  | 'settings'

// ─── Mode icon/accent ────────────────────────────────────────────────

export function ModeIcon({ mode, className }: { mode: PaymentMode; className?: string }) {
  switch (mode) {
    case 'UPI': return <Smartphone className={className} />
    case 'Card': return <CreditCard className={className} />
    case 'Net Banking': return <Building2 className={className} />
    case 'Cash': return <Banknote className={className} />
    case 'Cheque': return <FileText className={className} />
    case 'Bank Transfer': return <Wallet className={className} />
  }
}

export function modeAccent(mode: PaymentMode): string {
  switch (mode) {
    case 'UPI': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20'
    case 'Card': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20'
    case 'Net Banking': return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 ring-cyan-500/20'
    case 'Cash': return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20'
    case 'Cheque': return 'bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-violet-500/20'
    case 'Bank Transfer': return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20'
  }
}

// ─── Date + secondary time (FINAL PAYMENTS UI POLISH §2) ────────────

/**
 * Resolves the full wall-clock instant a payment was recorded:
 *   1. `recordedAt` (ISO timestamp — stamped by recordPayment / cash
 *      approval and present on all seeded rows);
 *   2. fallback — the `TXN-<epochMs>` id (live-recorded rows always carry
 *      an epoch id);
 *   3. null — date-only rows (nothing secondary to show).
 */
export function txnRecordedAt(t: Pick<FeeTransaction, 'id' | 'recordedAt'>): Date | null {
  if (t.recordedAt) {
    const d = new Date(t.recordedAt)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const ts = Number(t.id.replace(/^TXN-?/, ''))
  // Guard: seed ids like TXN001 parse to 1ms (1970) — treat as date-only.
  if (Number.isFinite(ts) && ts >= 1_000_000_000_000) return new Date(ts)
  return null
}

/**
 * Date + very small secondary timestamp — "30 Aug 2026 · 02:35 PM".
 * The date dominates; the time renders smaller and quieter right after it.
 * Rows without a wall-clock instant degrade to date-only. Used by the
 * Payments tables (Recent Payments / Cash Verification) and the
 * Transactions ledger so both speak the same visual language.
 */
export function DateTimeText({ date, instant, className }: { date: string; instant?: string | Date | null; className?: string }) {
  const d = instant ? (instant instanceof Date ? instant : new Date(instant)) : null
  const valid = d && !Number.isNaN(d.getTime())
  return (
    <span className={cn('whitespace-nowrap', className)}>
      {formatDate(date)}
      {valid && (
        <span className="ml-1 text-[10px] text-muted-foreground/70" aria-hidden>
          · {formatTime(d!).toUpperCase()}
        </span>
      )}
    </span>
  )
}

/** Transaction wrapper around DateTimeText — resolves the record instant
 *  via txnRecordedAt (recordedAt → TXN-<epochMs> fallback). */
export function TxnDateTime({ transaction, className }: { transaction: Pick<FeeTransaction, 'id' | 'recordedAt' | 'date'>; className?: string }) {
  return <DateTimeText date={transaction.date} instant={txnRecordedAt(transaction)} className={className} />
}

export function statusAccent(status: string): string {
  if (status === 'Success' || status === 'Paid' || status === 'Confirmed by Principal') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'Pending' || status === 'Partially Paid' || status === 'Collected by Teacher') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (status === 'Under Verification' || status === 'Clarification Requested') return 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
  if (status === 'Overdue' || status === 'Failed' || status === 'Rejected') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  return 'bg-muted text-muted-foreground'
}

// ─── Audience-aware payment status wording (PAY-REWORK-1 spec §9) ────
// One canonical status, role-appropriate words — the school office sees a
// verification QUEUE, the teacher sees THEIR collection waiting, the
// student sees a submission. Same record, honest phrasing everywhere.

export type StatusAudience = 'principal' | 'teacher' | 'student'

export function paymentStatusLabel(status: string, audience: StatusAudience): string {
  if (status === 'Under Verification') {
    if (audience === 'teacher') return 'Collected — Awaiting verification'
    if (audience === 'student') return 'Payment submitted — Awaiting confirmation'
    return 'Pending verification'
  }
  if (status === 'Success') return 'Paid'
  if (status === 'Failed') {
    if (audience === 'teacher') return 'Rejected by office'
    if (audience === 'student') return 'Payment could not be confirmed'
    return 'Rejected'
  }
  return status
}

// ─── FeeKpiCard ──────────────────────────────────────────────────────

interface KpiProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' | 'cyan' | 'slate'
  onClick?: () => void
  delay?: number
}

// Soft tinted backgrounds matching the Students & Classes module's KPI design.
// Each accent has a soft pastel card background, semantic icon chip, and subtle border.
const ACCENT_MAP: Record<KpiProps['accent'], { bg: string; ring: string; hover: string; cardBg: string; cardBorder: string }> = {
  emerald: { bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/20', hover: 'hover:shadow-emerald-500/20', cardBg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]', cardBorder: 'border-emerald-500/20' },
  rose: { bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', ring: 'ring-rose-500/20', hover: 'hover:shadow-rose-500/20', cardBg: 'bg-rose-500/[0.04] dark:bg-rose-500/[0.06]', cardBorder: 'border-rose-500/20' },
  amber: { bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', ring: 'ring-amber-500/20', hover: 'hover:shadow-amber-500/20', cardBg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]', cardBorder: 'border-amber-500/20' },
  sky: { bg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', ring: 'ring-sky-500/20', hover: 'hover:shadow-sky-500/20', cardBg: 'bg-sky-500/[0.04] dark:bg-sky-500/[0.06]', cardBorder: 'border-sky-500/20' },
  violet: { bg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', ring: 'ring-violet-500/20', hover: 'hover:shadow-violet-500/20', cardBg: 'bg-violet-500/[0.04] dark:bg-violet-500/[0.06]', cardBorder: 'border-violet-500/20' },
  cyan: { bg: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300', ring: 'ring-cyan-500/20', hover: 'hover:shadow-cyan-500/20', cardBg: 'bg-cyan-500/[0.04] dark:bg-cyan-500/[0.06]', cardBorder: 'border-cyan-500/20' },
  slate: { bg: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', ring: 'ring-slate-500/20', hover: 'hover:shadow-slate-500/20', cardBg: 'bg-slate-500/[0.04] dark:bg-slate-500/[0.06]', cardBorder: 'border-slate-500/20' },
}

export function FeeKpiCard({ icon, label, value, sub, accent, onClick, delay = 0 }: KpiProps) {
  const a = ACCENT_MAP[accent]
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
        onClick && `cursor-pointer hover:shadow-md ${a.hover} hover:-translate-y-0.5`,
        onClick && 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      {/* subtle top-right glow */}
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

// SettingsCard has moved to the canonical shared location —
//   modules/shared/settings-card.tsx
// (consumed by Fee Settings + the central Finance Settings).

// ─── FeePanel (flat section container — re-exports shared Panel) ────
// Visually converged to the Academics canonical pattern: flat card with
// title (h3 text-sm font-semibold) + optional subtitle + optional action
// on one row, then body content with p-4 padding.
// No colored header strip with border-b + bg-muted/20 — that was the old
// Finance-specific pattern that visually diverged from Academics.
export const FeePanel = Panel

// ─── FeeStat (compact stat block) ────────────────────────────────────

interface StatProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'emerald' | 'rose' | 'amber'
  className?: string
}

export function FeeStat({ label, value, sub, accent = 'default', className }: StatProps) {
  const accentMap = {
    default: '',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
  }
  return (
    <div className={cn('rounded-lg bg-muted/30 px-2.5 py-1.5', className)}>
      <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', accentMap[accent])}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// ─── FeePill ─────────────────────────────────────────────────────────

export function FeePill({ children, accent, className }: { children: React.ReactNode; accent?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap', accent, className)}>
      {children}
    </span>
  )
}

// ─── FeeEmptyState ───────────────────────────────────────────────────

// Rendered through the shared ModuleEmptyState (unframed variant) so every
// fee empty state shares the Phase-5 icon-tile/title/description/action
// hierarchy with the dashboard, exams and timetable modules.
export function FeeEmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <ModuleEmptyState framed={false} icon={icon} title={title} description={description} action={action} />
  )
}

// ─── FeeStatusBadge (with dot indicator) ─────────────────────────────

export function FeeStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap', statusAccent(status))}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

// ─── SourceChip — operational payment source (SaaS-STAGE-1) ──────────
// ONE vocabulary on every fee surface: Office / Teacher / Class Teacher /
// Student. Gateway is a payment CHANNEL (mode/processor) and NEVER renders
// as a source — online gateway-confirmed payments still show the counter
// or portal that operationally owns the collection.

const SOURCE_TONES: Record<string, string> = {
  Office: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  Teacher: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'Class Teacher': 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Student: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
}

export function SourceChip({
  role, collectedBy, className, showName = true, maxW = 'max-w-[140px]',
}: {
  role: FeeTransaction['collectorRole']
  collectedBy?: string
  className?: string
  showName?: boolean
  maxW?: string
}) {
  const label = collectorSourceLabel(role)
  const isOffice = !role || role === 'principal'
  // Office chips stay clean ('Office'); collector names enrich the
  // teacher/class-teacher chips; student self-service stays 'Student'.
  const nameSuffix = showName && !isOffice && role !== 'self' && collectedBy ? ` · ${collectedBy}` : ''
  const title = isOffice
    ? 'Collected at the school office'
    : role === 'self'
      ? 'Self-service payment via the student portal'
      : `Collected by ${label.toLowerCase()} ${collectedBy ?? ''}`.trim()
  return (
    <span
      className={cn('inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap', maxW, 'truncate', SOURCE_TONES[label], className)}
      title={title}
    >
      {label}
      {nameSuffix}
    </span>
  )
}

/** Filter facet value for a transaction's operational source. */
export function txnSourceKey(t: Pick<FeeTransaction, 'collectorRole'>): 'office' | 'teacher' | 'class_teacher' | 'self' {
  if (t.collectorRole === 'teacher') return 'teacher'
  if (t.collectorRole === 'class_teacher') return 'class_teacher'
  if (t.collectorRole === 'self') return 'self'
  return 'office'
}

// ─── Reduced motion + print styles ──────────────────────────────────
// Honour the user's preference for reduced motion across the fees workspace.
// Framer Motion's `motion` components respect this automatically when
// MotionConfig is used; we additionally suppress transitions via CSS.
export const FEES_GLOBAL_STYLES = `
@media (prefers-reduced-motion: reduce) {
  .fees-shell * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`
