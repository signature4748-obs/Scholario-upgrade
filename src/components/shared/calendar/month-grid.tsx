'use client'

/**
 * MonthGrid — the month view, rendered in the clean Scholario
 * enterprise language.
 *
 * Design notes:
 *   - One white card with hairline cell separators (border-border) —
 *     no per-cell cards, no coloured cell backgrounds, no tints on
 *     rows/columns. Weekend columns get the faintest neutral shading.
 *   - Adjacent-month days render muted and clickable (navigate to
 *     that month) instead of blank spacers.
 *   - Today: a small filled primary circle behind the day number —
 *     the single coloured marker in the grid. Selected: a subtle
 *     primary ring + tint. Both are functional states, kept restrained.
 *   - Event chips: neutral surfaces with a type-coloured dot and a
 *     very subtle type tint (≤ ~7%) so the dot reads instantly; up to
 *     2 chips + "+N more" on sm+, type dots on phones — comfortable
 *     touch targets, no horizontal overflow.
 *   - Month changes animate with a short, quiet slide (direction aware).
 *
 * a11y: each cell is a focusable div[role=button] (keyboard:
 * Enter/Space) containing real <button> chips for its events —
 * valid nesting, full keyboard access.
 */

import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  MONTH_NAMES,
  TYPE_TOKENS,
  WEEK_DAYS,
  typeColor,
  type CalendarEvent,
  type MonthCell,
} from './data'

export interface MonthGridProps {
  year: number
  month: number
  cells: MonthCell[]
  /** eventsByDay keyed by ISO date (only visible-month events). */
  eventsByDate: Record<string, CalendarEvent[]>
  /** ISO date of the selected day (null when nothing selected). */
  selectedDate: string | null
  /** ISO date of canonical today when it falls in the visible month. */
  todayDate: string | null
  /** +1 when navigating forward, -1 backward (slide direction). */
  navDirection: number
  onSelectDay: (cell: MonthCell) => void
  /** Open the event detail view (chips are clickable). */
  onOpenEvent: (event: CalendarEvent) => void
}

function isSelectableKey(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' '
}

export const MonthGrid = memo(function MonthGrid({
  year,
  month,
  cells,
  eventsByDate,
  selectedDate,
  todayDate,
  navDirection,
  onSelectDay,
  onOpenEvent,
}: MonthGridProps) {
  const monthTotal = cells.filter((c) => c.inMonth).reduce(
    (n, c) => n + (eventsByDate[c.dateISO]?.length ?? 0),
    0,
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
      {/* Week-day header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {WEEK_DAYS.map((w) => (
          <div
            key={w}
            className="py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:py-2.5 sm:text-[11px]"
          >
            <span className="hidden sm:inline">{w}</span>
            <span className="sm:hidden">{w.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {/* Day cells — keyed by month so navigation slides */}
      <AnimatePresence initial={false} custom={navDirection} mode="popLayout">
        <motion.div
          key={`${year}-${month}`}
          initial={{ opacity: 0, x: 16 * navDirection }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 * navDirection }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="grid grid-cols-7"
          aria-label={`${MONTH_NAMES[month]} ${year} calendar, ${monthTotal} events`}
        >
          {cells.map((cell, i) => {
            const dayEvents = cell.inMonth ? (eventsByDate[cell.dateISO] ?? []) : []
            const isToday = cell.dateISO === todayDate
            const isSelected = cell.dateISO === selectedDate
            const isWeekendCol = i % 7 === 0 || i % 7 === 6
            const cellLabel = `${cell.day} ${MONTH_NAMES[Number(cell.dateISO.slice(5, 7)) - 1]} ${cell.dateISO.slice(0, 4)}${cell.inMonth ? '' : ' (adjacent month)'}${dayEvents.length > 0 ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`

            return (
              <div
                key={cell.dateISO}
                role="button"
                tabIndex={0}
                aria-label={cellLabel}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                onClick={() => onSelectDay(cell)}
                onKeyDown={(e) => {
                  if (isSelectableKey(e)) {
                    e.preventDefault()
                    onSelectDay(cell)
                  }
                }}
                className={cn(
                  // Base cell — hairline separators, comfortable heights
                  'group relative flex min-h-[52px] cursor-pointer flex-col p-1 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[84px] sm:p-1.5 lg:min-h-[92px]',
                  // Hairline grid lines (skip first row / first column)
                  i >= 7 && 'border-t border-border',
                  i % 7 !== 0 && 'border-l border-border',
                  // Weekend shading — faintest neutral tint
                  isWeekendCol && 'bg-muted/30',
                  // States — selection is functional colour, kept subtle
                  isSelected
                    ? 'bg-primary/[0.06] shadow-[inset_0_0_0_1.5px] shadow-primary/40'
                    : 'hover:bg-muted/50',
                  !cell.inMonth && 'opacity-55 hover:opacity-90',
                )}
              >
                {/* Day number */}
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center text-xs tabular-nums leading-none sm:-ml-0.5 sm:-mt-0.5 sm:h-[22px] sm:w-[22px] sm:text-[13px]',
                    isToday
                      ? 'rounded-full bg-primary font-semibold text-primary-foreground'
                      : cell.inMonth
                        ? cn(
                          'font-medium text-foreground/75 group-hover:text-foreground',
                          isSelected && 'font-semibold text-primary',
                        )
                        : 'font-medium text-muted-foreground/70',
                  )}
                >
                  {cell.day}
                </span>

                {/* Event chips — sm and up (dot + subtle type tint) */}
                {dayEvents.length > 0 && (
                  <div className="mt-auto hidden w-full flex-col gap-[3px] sm:flex">
                    {dayEvents.slice(0, 2).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        title={e.title}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onOpenEvent(e)
                        }}
                        className={cn(
                          'flex h-[22px] items-center gap-1 rounded-md px-1 text-[10px] font-medium leading-none truncate text-left text-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          TYPE_TOKENS[e.type]?.chip ?? TYPE_TOKENS.General.chip,
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: typeColor(e.type) }}
                          aria-hidden
                        />
                        <span className="truncate">{e.title}</span>
                      </button>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="pl-1.5 text-[10px] leading-tight text-muted-foreground tabular-nums">
                        +{dayEvents.length - 2} more
                      </span>
                    )}
                  </div>
                )}

                {/* Event dots — phones only */}
                {dayEvents.length > 0 && (
                  <div className="mt-auto flex flex-wrap items-center gap-[3px] px-0.5 pb-0.5 sm:hidden">
                    {dayEvents.slice(0, 4).map((e) => (
                      <span
                        key={e.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: typeColor(e.type) }}
                        aria-hidden
                      />
                    ))}
                    {dayEvents.length > 4 && (
                      <span className="text-[9px] leading-none text-muted-foreground tabular-nums">
                        +{dayEvents.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
})
