'use client'

/**
 * salary-shared — Shared primitives for the Salary & Payroll workspace.
 *
 * Status language is icon-first:
 *   ✓ Confirmed · 🕐 Pending · × Rejected · ↩ Reversed · 🔒 Locked
 * Primary actions keep text labels; status chips never use sentences.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Clock, X, Undo2, Lock, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/format'
import type { PaymentStatus, ChangeRequestStatus } from '@/lib/store/salary-store'
import { editPermissionLive, formatCountdown, useSalaryStore } from '@/lib/store/salary-store'
import { Panel } from '../shared/panel'

// ─── Tab type (7 tabs) ───────────────────────────────────────────────

export type SalaryTab =
  | 'overview'
  | 'payments'
  | 'accounts'
  | 'payslips'
  | 'reports'
  | 'history'
  | 'structures'
  | 'settings'

// ─── Money & date formatting ─────────────────────────────────────────

export const money = (n: number) => formatINR(n)
export const moneyMy = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export function fmtDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function fmtDayYear(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Status badges (icon-first) ──────────────────────────────────────

export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  const map: Record<PaymentStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    'Confirmed': { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: <Check className="h-3 w-3" strokeWidth={3} />, label: 'Confirmed' },
    'Pending Receipt': { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', icon: <Clock className="h-3 w-3" />, label: 'Pending Receipt' },
    'Not Received': { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', icon: <X className="h-3 w-3" strokeWidth={3} />, label: 'Not Received' },
    'Reversed': { cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', icon: <Undo2 className="h-3 w-3" />, label: 'Reversed' },
  }
  const m = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', m.cls, className)}>
      {m.icon}{m.label}
    </span>
  )
}

export function RequestStatusBadge({ status }: { status: ChangeRequestStatus }) {
  const map: Record<ChangeRequestStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    'Pending': { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', icon: <Clock className="h-3 w-3" />, label: 'Awaiting Approval' },
    'Accepted': { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: <Check className="h-3 w-3" strokeWidth={3} />, label: 'Accepted' },
    'Declined': { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', icon: <X className="h-3 w-3" strokeWidth={3} />, label: 'Declined' },
  }
  const m = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', m.cls)}>
      {m.icon}{m.label}
    </span>
  )
}

export function PayslipStateBadge({ state, label }: { state: 'Unpaid' | 'Pending' | 'Paid'; label?: string }) {
  const map = {
    'Paid': { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: <Check className="h-3 w-3" strokeWidth={3} /> },
    'Pending': { cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', icon: <Clock className="h-3 w-3" /> },
    'Unpaid': { cls: 'bg-muted text-muted-foreground', icon: <Ban className="h-3 w-3" /> },
  } as const
  const m = map[state]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap', m.cls)}>
      {m.icon}{label ?? state}
    </span>
  )
}

export function LockedBadge({ label = 'Locked' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-muted text-muted-foreground">
      <Lock className="h-3 w-3" />{label}
    </span>
  )
}

export function SessionSalaryBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-violet-500/10 text-violet-700 dark:text-violet-300">
      <Lock className="h-3 w-3" />Session Salary
    </span>
  )
}

// ─── Editing-window live hook (drives every lock indicator) ──────────

export function useEditingWindow(): { allowed: boolean; msLeft: number; label: string } {
  const editPermission = useSalaryStore((s) => s.editPermission)
  const normalize = useSalaryStore((s) => s.normalizeEditPermission)
  const [, setTick] = useState(0)

  useEffect(() => {
    const iv = setInterval(() => {
      setTick((t) => t + 1)
      normalize() // flips to OFF + records the audit entry the moment it expires
    }, 1000)
    return () => clearInterval(iv)
  }, [normalize])

  const live = editPermissionLive(editPermission)
  return { allowed: live.allowed, msLeft: live.msLeft, label: formatCountdown(live.msLeft) }
}

// ─── Panel (shared flat container) ───────────────────────────────────

export const SalaryPanel = Panel

// ─── Compact stat block ──────────────────────────────────────────────

interface StatProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'emerald' | 'rose' | 'amber' | 'violet'
  className?: string
}

export function SalaryStat({ label, value, sub, accent = 'default', className }: StatProps) {
  const accentMap = {
    default: '',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
  }
  return (
    <div className={cn('rounded-lg bg-muted/30 px-2.5 py-1.5', className)}>
      <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', accentMap[accent])}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// ─── Empty states ────────────────────────────────────────────────────

/** Compact one-line empty state — occupies only the space it needs. */
export function CompactEmpty({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground">
      {icon && <span className="shrink-0 opacity-70">{icon}</span>}
      <p className="text-xs font-medium">{children}</p>
    </div>
  )
}

export function SalaryEmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-10 text-center"
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
