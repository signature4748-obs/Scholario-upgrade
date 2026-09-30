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
 *   - "Notice Board" Panel with the 4 latest REAL school announcements
 *     (GET /api/announcements — PHASE 7: the communication-store/mock
 *     fallback is retired; loading shows skeletons, none shows an honest
 *     empty state). Each row uses the Academics pattern: small category
 *     chip + title + meta. "View all" is wired to
 *     `onNavigate('communication')`.
 *
 * Removed: 6 colorful gradient tiles + their h-9 w-9 icon tiles.
 */

import { motion } from 'framer-motion'
import {
  UserPlus, CalendarCheck, IndianRupee, FileText, Megaphone, Wallet,
  ArrowUpRight, Megaphone as MegaphoneIcon,
} from 'lucide-react'
import { Panel } from '../shared/panel'
import { useServerAnnouncements } from './use-server-announcements'
import { Skeleton } from '@/components/ui/skeleton'
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

/** Real notifications carry an audience tag, not a display category —
 * mapped to the closest chip tone (honest labeling, no invented tone). */
function audienceTone(audience: string): { tone: string; label: string } {
  const key = (audience || '').toUpperCase()
  if (key.includes('ALL')) return { tone: CATEGORY_TONES.General, label: 'All' }
  if (key.includes('TEACHER')) return { tone: CATEGORY_TONES.Academic, label: 'Staff' }
  if (key.includes('PARENT')) return { tone: CATEGORY_TONES.Event, label: 'Parents' }
  if (key.includes('CLASS')) return { tone: CATEGORY_TONES.Academic, label: 'Class' }
  return { tone: CATEGORY_TONES.General, label: 'Notice' }
}

function NoticeBoardCard({ onNavigate }: { onNavigate?: (m: string) => void }) {
  // PHASE 7 — REAL school notifications via GET /api/announcements
  // (role-visible rows). No store/mock fallback: skeletons while loading,
  // honest empty state when the school has not published any.
  const { announcements, status, refresh } = useServerAnnouncements()
  const notices = announcements.slice(0, 4)

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
        {status === 'loading' && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-2.5 px-2.5 py-2">
                <Skeleton className="h-6 w-6 rounded-md shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}
        {status === 'error' && (
          <button
            type="button"
            onClick={refresh}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-4 text-xs text-muted-foreground hover:bg-muted/40 transition-colors focus-ring"
          >
            <MegaphoneIcon className="h-4 w-4" aria-hidden="true" />
            Could not load announcements — tap to retry
          </button>
        )}
        {status === 'ready' && notices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-1.5 text-center">
            <div className="h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center">
              <MegaphoneIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-foreground">No announcements yet</p>
            <p className="text-xs text-muted-foreground max-w-[260px]">
              Notices published from the Communication module appear here.
            </p>
          </div>
        )}
        {notices.map((a, i) => {
          const chip = audienceTone(a.audience)
          return (
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
                chip.tone,
              )}>
                {chip.label.slice(0, 3)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{a.title}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{a.message}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {a.sender} · {new Date(a.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </motion.button>
          )
        })}
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
