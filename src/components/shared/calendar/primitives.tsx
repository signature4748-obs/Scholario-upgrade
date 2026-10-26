'use client'

/**
 * calendar/primitives — small shared visual pieces for the Calendar
 * workspace: type badge, source pill, event rows (upcoming + day
 * variants) and the empty state. All surfaces follow the clean
 * Scholario enterprise language — white cards, hairline borders,
 * muted neutrals, with colour reserved for the small functional
 * type indicators.
 */

import { motion } from 'framer-motion'
import { Clock, MapPin, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/lib/store/calendar-store'
import {
  TYPE_TOKENS,
  formatDayMonth,
  formatTimeLabel,
} from './data'

// ─── TypeBadge ────────────────────────────────────────────────────────

export function TypeBadge({ type, className }: { type: string; className?: string }) {
  const token = TYPE_TOKENS[type] ?? TYPE_TOKENS.General
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-semibold leading-none',
        token.badge,
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: token.solid }}
        aria-hidden
      />
      {type}
    </span>
  )
}

// ─── EventRow ─────────────────────────────────────────────────────────

/**
 * One scannable event row used by the Upcoming rail, the selected-day
 * rail and the mobile day sheet.
 *   - variant="upcoming" → leading date tile (day + month)
 *   - variant="day"      → leading time label (the date is known)
 * Clicking opens the event detail dialog.
 */
export function EventRow({
  event,
  index = 0,
  variant = 'upcoming',
  onOpen,
}: {
  event: CalendarEvent
  index?: number
  variant?: 'upcoming' | 'day'
  onOpen: (e: CalendarEvent) => void
}) {
  const isAllDay = !event.time || event.time === '—'
  const timeLabel = isAllDay ? 'All day' : formatTimeLabel(event.time)
  const tile = formatDayMonth(event.date)

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.12), duration: 0.16 }}
      onClick={() => onOpen(event)}
      className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {variant === 'upcoming' ? (
        /* Date tile — compact, neutral */
        <span
          className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-card"
          aria-hidden
        >
          <span className="text-sm font-semibold leading-none tabular-nums text-foreground">
            {tile.day}
          </span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">
            {tile.month}
          </span>
        </span>
      ) : (
        /* Time label — the date is already known in day view */
        <span className="w-[52px] shrink-0 text-right text-[11px] font-medium tabular-nums leading-tight text-muted-foreground">
          {timeLabel.split(' ').map((w) => (
            <span key={w} className="block">
              {w}
            </span>
          ))}
        </span>
      )}

      {/* Title + meta */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
          {event.title}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[11px] leading-none text-muted-foreground">
          {variant === 'day' && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              {timeLabel}
            </span>
          )}
          {variant === 'upcoming' && (
            <>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {timeLabel}
              </span>
              {event.location && (
                <span className="inline-flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{event.location}</span>
                </span>
              )}
            </>
          )}
        </span>
      </span>

      {/* Type indicator — dot on sm+, badge on phones */}
      <span className="flex shrink-0 items-center pr-0.5">
        <span
          className="hidden h-2 w-2 rounded-full sm:block"
          style={{ background: (TYPE_TOKENS[event.type] ?? TYPE_TOKENS.General).solid }}
          aria-hidden
        />
        <span className="sm:hidden">
          <TypeBadge type={event.type} />
        </span>
      </span>
    </motion.button>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────

export function CalendarEmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground/80">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-muted-foreground/70">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
