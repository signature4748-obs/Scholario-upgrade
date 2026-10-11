'use client'

/**
 * finance-shared — Shared primitives for the Finance Dashboard.
 *
 * - FinanceKpiCard (soft tinted backgrounds, semantic colors)
 * - FinancePanel (rounded card container)
 * - FinanceStat (compact stat block)
 * - HealthStatusBadge
 * - FinanceEmptyState
 * - Severity pill accents
 */

import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '../shared/panel'

// ─── FinanceKpiCard ──────────────────────────────────────────────────

interface KpiProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' }
  accent: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' | 'cyan'
  onClick?: () => void
  delay?: number
}

const ACCENT_MAP: Record<KpiProps['accent'], { bg: string; ring: string; hover: string; cardBg: string; cardBorder: string }> = {
  emerald: { bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/20', hover: 'hover:shadow-emerald-500/20', cardBg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]', cardBorder: 'border-emerald-500/20' },
  rose: { bg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', ring: 'ring-rose-500/20', hover: 'hover:shadow-rose-500/20', cardBg: 'bg-rose-500/[0.04] dark:bg-rose-500/[0.06]', cardBorder: 'border-rose-500/20' },
  amber: { bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', ring: 'ring-amber-500/20', hover: 'hover:shadow-amber-500/20', cardBg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]', cardBorder: 'border-amber-500/20' },
  sky: { bg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', ring: 'ring-sky-500/20', hover: 'hover:shadow-sky-500/20', cardBg: 'bg-sky-500/[0.04] dark:bg-sky-500/[0.06]', cardBorder: 'border-sky-500/20' },
  violet: { bg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', ring: 'ring-violet-500/20', hover: 'hover:shadow-violet-500/20', cardBg: 'bg-violet-500/[0.04] dark:bg-violet-500/[0.06]', cardBorder: 'border-violet-500/20' },
  cyan: { bg: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300', ring: 'ring-cyan-500/20', hover: 'hover:shadow-cyan-500/20', cardBg: 'bg-cyan-500/[0.04] dark:bg-cyan-500/[0.06]', cardBorder: 'border-cyan-500/20' },
}

export function FinanceKpiCard({ icon, label, value, sub, trend, accent, onClick, delay = 0 }: KpiProps) {
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
      <div className={cn('absolute -top-6 -right-6 h-16 w-16 rounded-full blur-2xl opacity-30', a.bg)} aria-hidden />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider truncate">{label}</p>
          <p className="font-display text-xl sm:text-2xl font-bold tabular-nums mt-1.5 leading-none">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-1.5 truncate">{sub}</p>}
          {trend && (
            <p className={cn('text-[10px] font-semibold mt-1 tabular-nums',
              trend.direction === 'up' ? 'text-emerald-600' :
              trend.direction === 'down' ? 'text-rose-600' : 'text-muted-foreground')}>
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
            </p>
          )}
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

// ─── FinancePanel (flat section container — re-exports shared Panel) ─
// Visually converged to the Academics canonical pattern: flat card with
// title (h3 text-sm font-semibold) + optional subtitle + optional action
// on one row, then body content with p-4 padding.
// No colored header strip with border-b + bg-muted/20 — that was the old
// Finance-specific pattern that visually diverged from Academics.
export const FinancePanel = Panel

// ─── FinanceStat ─────────────────────────────────────────────────────

interface StatProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'emerald' | 'rose' | 'amber'
  className?: string
}

export function FinanceStat({ label, value, sub, accent = 'default', className }: StatProps) {
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

// ─── Health Status Badge ─────────────────────────────────────────────

export function HealthStatusBadge({ status }: { status: 'Healthy' | 'Watch' | 'Attention' }) {
  const accentMap = {
    Healthy: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
    Watch: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20',
    Attention: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1', accentMap[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

export function severityAccent(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20'
  if (severity === 'warning') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20'
  return 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20'
}

export function severityColor(severity: 'healthy' | 'watch' | 'attention'): string {
  if (severity === 'healthy') return 'text-emerald-600'
  if (severity === 'watch') return 'text-amber-600'
  return 'text-rose-600'
}

// ─── FinanceEmptyState ───────────────────────────────────────────────

export function FinanceEmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
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

// ─── BATCH2-B5 — honest unavailability primitives ────────────────────
// Scholario's server ledger covers FEE REVENUE only. There is no expense
// / bank / asset ledger model yet, so those statement lines render as
// visually-distinct muted "not available" surfaces instead of fabricated
// ₹ figures. Used by Statements, Overview and Reports.

/** One muted statement row: label + "requires … — not available" chip. */
export function UnavailableLine({ label, note = 'requires expense ledger' }: { label: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0 opacity-60">
      <p className="text-[11px] font-medium truncate text-muted-foreground">{label}</p>
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap bg-muted text-muted-foreground ring-1 ring-border shrink-0"
        title={`${note} — not available`}
      >
        {note} — not available
      </span>
    </div>
  )
}

/** Full-width muted note explaining an unavailable section. */
export function UnavailableNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5" role="note">
      <p className="text-[10px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

// ─── Reduced motion styles ───────────────────────────────────────────

export const FINANCE_GLOBAL_STYLES = `
@media (prefers-reduced-motion: reduce) {
  .finance-shell * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`
