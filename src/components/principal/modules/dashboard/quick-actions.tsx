'use client'

/**
 * QuickActionsRow — compact flat action buttons + Notice Board.
 *
 * Redesigned (DASH-1) from 6 colorful gradient tiles (with NO onClick
 * handlers — all dead) into:
 *   - "Quick Actions" Panel with a compact row of flat h-8 buttons:
 *       New Admission (primary emerald) → admission
 *       Mark Attendance → attendance
 *       Collect Fees → fees
 *       Create Examination → exams
 *       Add Notice (secondary) → communication
 *       Pay Salary (secondary) → salary
 *     All wired to `onNavigate(moduleKey)`.
 *   - "Notice Board" Panel with 4 latest announcements from the shared
 *     communication store (with fallback to mock). Each row uses the
 *     Academics pattern: small category chip + title + meta. "View all"
 *     is wired to `onNavigate('communication')`.
 *
 * Removed: 6 colorful gradient tiles + their h-9 w-9 icon tiles.
 */

import { motion } from 'framer-motion'
import {
  UserPlus, CalendarCheck, IndianRupee, FileText, Megaphone, Wallet,
  ArrowUpRight,
} from 'lucide-react'
import { Panel } from '../shared/panel'
import { useCommunicationStore } from '@/lib/store/communication-store'
import { announcements as mockAnnouncements } from '@/lib/mock/operations'
import { cn } from '@/lib/utils'

export interface QuickActionsRowProps {
  onNavigate?: (module: string) => void
}

// ─── Quick Actions ───────────────────────────────────────────────────

interface ActionDef {
  label: string
  icon: React.ReactNode
  navKey: string
  /** 'primary' = emerald solid, 'secondary' = subtle outline. */
  variant: 'primary' | 'secondary'
}

function QuickActionsCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  const actions: ActionDef[] = [
    { label: 'New Admission', icon: <UserPlus className="h-3.5 w-3.5" />, navKey: 'admission', variant: 'primary' },
    { label: 'Mark Attendance', icon: <CalendarCheck className="h-3.5 w-3.5" />, navKey: 'attendance', variant: 'secondary' },
    { label: 'Collect Fees', icon: <IndianRupee className="h-3.5 w-3.5" />, navKey: 'fees', variant: 'secondary' },
    { label: 'Create Exam', icon: <FileText className="h-3.5 w-3.5" />, navKey: 'exams', variant: 'secondary' },
    { label: 'Add Notice', icon: <Megaphone className="h-3.5 w-3.5" />, navKey: 'communication', variant: 'secondary' },
    { label: 'Pay Salary', icon: <Wallet className="h-3.5 w-3.5" />, navKey: 'salary', variant: 'secondary' },
  ]

  return (
    <Panel title="Quick Actions" subtitle="Frequent principal workflows">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => onNavigate?.(a.navKey)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors',
              a.variant === 'primary'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'border border-border bg-card hover:bg-muted/60 text-foreground',
            )}
          >
            <span className={cn(a.variant === 'primary' ? 'text-white' : 'text-emerald-600 dark:text-emerald-400')}>
              {a.icon}
            </span>
            {a.label}
          </button>
        ))}
      </div>
    </Panel>
  )
}

// ─── Notice Board ─────────────────────────────────────────────────────

const CATEGORY_TONES: Record<string, string> = {
  Urgent: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  Event: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  Holiday: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  Academic: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  General: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
}

function NoticeBoardCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  // Prefer the real communication-store announcements (which has the latest
  // created/scheduled/pinned notices); fall back to mock if the store is empty.
  const storeAnnouncements = useCommunicationStore((s) => s.announcements)
  const notices = storeAnnouncements.length > 0
    ? storeAnnouncements.slice(0, 4).map((a) => ({
        id: a.id,
        title: a.title,
        content: a.message,
        category: a.category,
        postedBy: a.author,
        date: a.createdAt,
      }))
    : mockAnnouncements.slice(0, 4).map((a) => ({
        id: a.id,
        title: a.title,
        content: a.content,
        category: a.category,
        postedBy: a.postedBy,
        date: a.date,
      }))

  return (
    <Panel
      title="Notice Board"
      subtitle="Latest announcements"
      action={
        <button
          onClick={() => onNavigate?.('communication')}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          title="Open Communication"
        >
          View all
          <ArrowUpRight className="h-3 w-3" />
        </button>
      }
    >
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
        {notices.map((a, i) => (
          <motion.button
            key={a.id}
            type="button"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted/40 transition-colors cursor-pointer text-left focus-ring"
            onClick={() => onNavigate?.('communication')}
          >
            <span className={cn(
              'inline-flex items-center justify-center h-6 w-6 shrink-0 rounded-md text-[9px] font-bold uppercase tracking-wider',
              CATEGORY_TONES[a.category] ?? CATEGORY_TONES.General,
            )}>
              {a.category.slice(0, 3)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{a.title}</p>
              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{a.content}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {a.postedBy} · {new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </Panel>
  )
}

// ─── Composition ─────────────────────────────────────────────────────

export function QuickActionsRow({ onNavigate }: QuickActionsRowProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1">
        <QuickActionsCard onNavigate={onNavigate} />
      </div>
      <div className="lg:col-span-2">
        <NoticeBoardCard onNavigate={onNavigate} />
      </div>
    </div>
  )
}
