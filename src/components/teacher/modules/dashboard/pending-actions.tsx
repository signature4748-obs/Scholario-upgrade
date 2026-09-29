'use client'

/**
 * PendingActions (v2) — the dashboard's REAL action queue, rendered entirely
 * from the ONE aggregate (GET /api/teacher/dashboard) — no second fetch.
 *
 * Sources (all server-derived, teacher-session scoped, same rows the
 * modules show):
 *   • attendance snapshots   → unmarked class-attendance baselines (deep-link)
 *   • hub.unreadMessages     → unread parent messages (Communication Hub)
 *   • hub.needsAttention     → students needing attention (Student Growth)
 *   • hub.marksPending       → marks entries sitting in DRAFT (Marks Entry)
 *   • hub.followUps          → open follow-up rows (person, reason, due)
 *
 * Every row has a destination; an honest empty state renders when nothing
 * needs attention. No fabricated tasks, ever.
 */

import { motion, useReducedMotion } from 'framer-motion'
import {
  AlarmClock, ArrowRight, CalendarCheck, FileText, MessageSquareHeart, Shield, Inbox,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GlassCard, GradientAvatar } from '@/components/shared/ui'
import { useFocusStore } from '@/lib/store/focus-store'
import type { ClassTeacherClass, TeacherDashboardData } from './types'

interface PendingActionsProps {
  data: TeacherDashboardData
  onNavigate: (key: string) => void
}

function dueLabel(due: string): { text: string; tone: 'overdue' | 'today' | 'later' } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // `due` may be a plain "YYYY-MM-DD" day key OR a full ISO timestamp —
  // parse it as-is when it already carries a time part.
  const d = new Date(due.includes('T') ? due : `${due}T00:00:00`)
  if (Number.isNaN(d.getTime())) return { text: 'Scheduled', tone: 'later' }
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { text: `Overdue ${Math.abs(days)}d`, tone: 'overdue' }
  if (days === 0) return { text: 'Due today', tone: 'today' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'later' }
  return { text: `Due in ${days}d`, tone: 'later' }
}

export function PendingActions({ data, onNavigate }: PendingActionsProps) {
  const reduce = useReducedMotion()
  const unmarked = data.attendance.filter((s) => !s.marked)
  const { unreadMessages, needsAttention, marksPending, followUps } = data.hub
  const empty =
    unmarked.length === 0 && unreadMessages === 0 && needsAttention === 0 && marksPending === 0 && followUps.length === 0

  return (
    <GlassCard className="flex flex-col p-3.5 sm:p-4 lg:p-5">
      <div className="mb-3.5">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold tracking-tight">
          <AlarmClock className="h-4 w-4 text-amber-500" aria-hidden /> Pending Actions
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">What needs your attention right now</p>
      </div>

      {empty && (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <Inbox className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </div>
          <p className="text-sm font-medium text-muted-foreground">You&apos;re all caught up</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Nothing requires your attention right now.
          </p>
        </div>
      )}

      {!empty && (
        <div className="space-y-2.5">
          {unmarked.map((s) => (
            <ActionRow
              key={`att-${s.classId}`}
              reduce={reduce}
              onClick={() => {
                // Same deep-link the attendance prompt uses — the exact
                // class lands focused in the Class Attendance module.
                useFocusStore.getState().setFocus({
                  type: 'class',
                  id: s.classId,
                  title: s.classLabel,
                  moduleKey: 'attendance',
                })
                onNavigate('attendance')
              }}
              icon={<CalendarCheck className="h-4.5 w-4.5" aria-hidden />}
              iconTone="amber"
              title={`${s.classLabel} attendance not marked`}
              subtitle={`${s.studentCount} student${s.studentCount === 1 ? '' : 's'} · today's baseline is still open`}
            />
          ))}

          {unreadMessages > 0 && (
            <ActionRow
              reduce={reduce}
              onClick={() => onNavigate('communication')}
              icon={<MessageSquareHeart className="h-4.5 w-4.5" aria-hidden />}
              iconTone="sky"
              title={`${unreadMessages} unread parent message${unreadMessages === 1 ? '' : 's'}`}
              subtitle="Communication Hub · reply from your conversations"
              chip={{ text: 'Reply', tone: 'sky' }}
            />
          )}

          {needsAttention > 0 && (
            <ActionRow
              reduce={reduce}
              onClick={() => onNavigate('growth')}
              icon={<Shield className="h-4.5 w-4.5" aria-hidden />}
              iconTone="rose"
              title={`${needsAttention} student${needsAttention === 1 ? '' : 's'} needing attention`}
              subtitle="Student Growth · review recent points"
            />
          )}

          {marksPending > 0 && (
            <ActionRow
              reduce={reduce}
              onClick={() => onNavigate('marks')}
              icon={<FileText className="h-4.5 w-4.5" aria-hidden />}
              iconTone="violet"
              title={`${marksPending} marks entr${marksPending === 1 ? 'y' : 'ies'} in draft`}
              subtitle="Marks Entry · review and submit"
              chip={{ text: 'Draft', tone: 'violet' }}
            />
          )}

          {followUps.map((f) => {
            const due = dueLabel(f.dueDate)
            return (
              <ActionRow
                key={f.id}
                reduce={reduce}
                onClick={() => onNavigate(f.kind === 'parent-connect' ? 'communication' : 'growth')}
                avatar={f.studentName ?? 'Follow-up'}
                title={f.studentName ?? 'Follow-up'}
                subtitle={f.reason}
                chip={{ text: due.text, tone: due.tone }}
              />
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}

const TONES = {
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
} as const

const CHIP_TONES = {
  overdue: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  today: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  later: 'bg-muted text-muted-foreground',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
} as const

function ActionRow({
  reduce,
  onClick,
  icon,
  iconTone,
  avatar,
  title,
  subtitle,
  chip,
}: {
  reduce: boolean | null
  onClick: () => void
  icon?: React.ReactNode
  iconTone?: keyof typeof TONES
  avatar?: string
  title: string
  subtitle: string
  chip?: { text: string; tone: keyof typeof CHIP_TONES }
}) {
  return (
    <motion.button
      type="button"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card/40 p-3 text-left transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {avatar ? (
        <GradientAvatar name={avatar} size="sm" />
      ) : (
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconTone && TONES[iconTone])}>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {chip && (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            CHIP_TONES[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </motion.button>
  )
}

// ─── Class Teacher Hub card ─────────────────────────────────────────

/**
 * ClassTeacherHubCard — the appointed class teacher's compact overview:
 * students, canonical 30-day attendance rate and open follow-ups per
 * class-teacher class, with the "Open My Class" entry. Rendered ONLY for
 * teachers with real appointments — a subject teacher never sees hub
 * affordances.
 */
export function ClassTeacherHubCard({ classes, onNavigate }: {
  classes: ClassTeacherClass[]
  onNavigate: (key: string) => void
}) {
  const reduce = useReducedMotion()
  if (classes.length === 0) return null
  const single = classes.length === 1

  return (
    <GlassCard className="flex flex-col p-3.5 sm:p-4 lg:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Shield className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold tracking-tight">
            {single ? 'My Class' : 'My Classes'}
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {single ? classes[0].classLabel : `${classes.length} class-teacher classes`}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-2.5">
        {classes.map((c) => (
          <div key={c.classId} className="rounded-xl border border-border/70 bg-background/40 p-3">
            {classes.length > 1 && (
              <p className="mb-2 text-[11px] font-semibold text-foreground/80">{c.classLabel}</p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Students</dt>
                <dd className="mt-0.5 font-display text-base font-bold tabular-nums">{c.studentCount}</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Attendance</dt>
                <dd
                  className={cn(
                    'mt-0.5 font-display text-base font-bold tabular-nums',
                    c.attendancePct == null ? 'text-muted-foreground/60' : c.attendancePct >= 90 ? 'text-emerald-600 dark:text-emerald-400' : c.attendancePct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {c.attendancePct == null ? '—' : `${c.attendancePct}%`}
                </dd>
                <dd className="text-[9px] text-muted-foreground/70">30 days</dd>
              </div>
              <div>
                <dt className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Follow-ups</dt>
                <dd className={cn('mt-0.5 font-display text-base font-bold tabular-nums', c.openFollowUps > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>
                  {c.openFollowUps}
                </dd>
                <dd className="text-[9px] text-muted-foreground/70">open</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <motion.button
        type="button"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={() => onNavigate('class-hub')}
        className="group mt-3 inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open My Class
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </motion.button>
    </GlassCard>
  )
}
