'use client'

/**
 * CalendarWorkspace — the shared calendar used by BOTH the Principal
 * panel (full management) and the Student panel (read-only).
 *
 * Visual language: the clean Scholario-OS enterprise system used by
 * Finance / Messages — white card surfaces, hairline borders, subtle
 * shadows and a restrained Scholario green as the only UI accent.
 * Colour appears ONLY where it carries meaning: event-type dots and
 * chips, the Today marker, selection state and the primary action.
 * No gradients, no glass, no colour washes.
 *
 * UX structure:
 *   - The calendar is the primary focus; Add Event is the single
 *     primary action.
 *   - Progressive disclosure: chips/dots in the grid, day details in
 *     the rail (desktop) / bottom sheet (below lg), full context in
 *     the event detail dialog, creation in a focused form.
 *   - Type filters double as the colour legend and filter the grid
 *     AND the upcoming list consistently.
 *
 * Data: the SAME unified sources as before — `getUnifiedEvents`
 * (school events + canonical holidays + exam schedule) and
 * `useCalendarStore` user events, evaluated over a rolling window
 * (visible month + today + two following months, deduped by id).
 *
 * "Today" anchors to the app's canonical academic timeline
 * (Dec 10 2025) so the calendar opens on the month the rest of
 * Scholario-OS is showing.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, ChevronLeft, ChevronRight, EyeOff, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { PageTransition, SectionHeading, StatusBadge } from '@/components/shared/ui'
import { getUnifiedEvents, useCalendarStore, type CalendarEvent } from '@/lib/store/calendar-store'
import { useMockExamsStore } from '@/lib/exams/mock-exams-data'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { cn } from '@/lib/utils'
import {
  ALL_TYPES,
  CANONICAL_TODAY,
  DEMO_SEED_ANCHOR_TODAY,
  MONTH_NAMES,
  buildMonthMatrix,
  pad,
  todayParts,
  type MonthCell,
} from './data'
import { MonthGrid } from './month-grid'
import { TypeFilters } from './type-filters'
import { UpcomingContent, DayContent } from './side-panels'
import { EventDetailDialog } from './event-detail-dialog'
import { AddEventDialog } from './add-event-dialog'

export interface CalendarWorkspaceProps {
  /** Principal/teacher can create + remove events; students cannot. */
  canCreate: boolean
  /** Student panels keep their module heading pattern. */
  showHeading?: boolean
}

export function CalendarWorkspace({ canCreate, showHeading = false }: CalendarWorkspaceProps) {
  // ─── Demo-tier gating (FINAL-GATE EG-9F/R4+R6) ───────────────────
  //   · the mock-exams seed corpus applies once, only for the demo tenant;
  //   · the illustrative school-events/holidays corpora render only for
  //     the demo tenant (a real tenant sees its own user events + an
  //     honest empty calendar).
  const isDemo = useIsDemoTenant()

  // PIH-4c — "today" anchors on the REAL clock: every real tenant's
  // calendar opens on its actual current month (CANONICAL_TODAY, UTC
  // day). Only the demo tenant keeps the seed-corpus anchor (Dec 10
  // 2025) so its illustrative events/exams stay around "today".
  const anchorToday = isDemo ? DEMO_SEED_ANCHOR_TODAY : CANONICAL_TODAY
  const t = todayParts(anchorToday)

  // ─── State ──────────────────────────────────────────────────────
  // (Initialized from the real clock; the async demo signal moves the
  // demo tenant's view to its anchor month once it arrives.)
  const [year, setYear] = useState<number>(t.year)
  const [month, setMonth] = useState<number>(t.month)
  const [navDirection, setNavDirection] = useState<number>(1)
  const [selectedDateISO, setSelectedDateISO] = useState<string | null>(null)
  const [mobileDayOpen, setMobileDayOpen] = useState(false)
  const [filterTypes, setFilterTypes] = useState<string[]>([...ALL_TYPES])
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addDefaultDate, setAddDefaultDate] = useState<string>(anchorToday)

  // ─── Data (single unified source) ───────────────────────────────
  const exams = useMockExamsStore((s) => s.exams)
  const userEvents = useCalendarStore((s) => s.userEvents)
  const ensureDemoSeed = useMockExamsStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  // Once the (async) demo signal arrives, move the view to the demo
  // seed corpus's anchor month — identical to the pre-PIH-4c showcase
  // behavior; real tenants stay on their real current month.
  useEffect(() => {
    if (isDemo) {
      const a = todayParts(DEMO_SEED_ANCHOR_TODAY)
      setYear(a.year)
      setMonth(a.month)
    }
  }, [isDemo])

  /**
   * Rolling window: visible month + today's month + the next two.
   * Deduped by id (school + user events are month-independent and are
   * returned by every call).
   */
  const rollingEvents = useMemo(() => {
    const keys = new Set<string>([`${year}-${month}`])
    for (let i = 0; i <= 2; i++) {
      const d = new Date(t.year, t.month + i, 1)
      keys.add(`${d.getFullYear()}-${d.getMonth()}`)
    }
    const byId = new Map<string, CalendarEvent>()
    for (const key of keys) {
      const [y, m] = key.split('-').map(Number)
      for (const e of getUnifiedEvents(y, m, exams, userEvents, { includeSeedCalendar: isDemo })) {
        byId.set(e.id, e)
      }
    }
    return [...byId.values()]
  }, [year, month, exams, userEvents, isDemo])

  // Type-filtered view of everything.
  const visibleEvents = useMemo(
    () => rollingEvents.filter((e) => filterTypes.includes(e.type)),
    [rollingEvents, filterTypes],
  )

  // Events per date — visible month only (drives the grid + day views).
  const eventsByDate = useMemo(() => {
    const prefix = `${year}-${pad(month + 1)}-`
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of visibleEvents) {
      if (!e.date.startsWith(prefix)) continue
      ;(map[e.date] ??= []).push(e)
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => (a.time === '—' ? 1 : 0) - (b.time === '—' ? 1 : 0) || a.time.localeCompare(b.time))
    }
    return map
  }, [visibleEvents, year, month])

  // Per-type counts in the visible month (unfiltered — shows availability).
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const prefix = `${year}-${pad(month + 1)}-`
    for (const e of rollingEvents) {
      if (!e.date.startsWith(prefix)) continue
      counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    return counts
  }, [rollingEvents, year, month])

  const monthTotal = useMemo(
    () => Object.values(typeCounts).reduce((a, b) => a + b, 0),
    [typeCounts],
  )

  // Upcoming: from the anchor today onward, filtered, nearest first.
  const upcomingEvents = useMemo(
    () =>
      visibleEvents
        .filter((e) => e.date >= anchorToday)
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
    [visibleEvents, anchorToday],
  )

  // Is the upcoming list empty only because of the type filters?
  const upcomingEmptyDueToFilter = useMemo(
    () => rollingEvents.some((e) => e.date >= anchorToday) && upcomingEvents.length === 0,
    [rollingEvents, upcomingEvents, anchorToday],
  )

  // Grid inputs.
  const cells = useMemo(() => buildMonthMatrix(year, month), [year, month])
  const todayDate = useMemo(
    () => (t.year === year && t.month === month ? `${year}-${pad(month + 1)}-${pad(t.day)}` : null),
    [year, month],
  )

  const isTodayMonth = t.year === year && t.month === month
  const monthKey = `${year}-${month}`

  // ─── Navigation ─────────────────────────────────────────────────

  const shiftMonth = (delta: number) => {
    setNavDirection(delta)
    setSelectedDateISO(null)
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const goToToday = () => {
    setNavDirection(t.year * 12 + t.month > year * 12 + month ? 1 : -1)
    setYear(t.year)
    setMonth(t.month)
    setSelectedDateISO(null)
  }

  const showAllTypes = () => setFilterTypes([...ALL_TYPES])
  const toggleType = (type: string) =>
    setFilterTypes((prev) =>
      prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type],
    )

  /** Open the mobile day sheet when the viewport is below lg. */
  const openSheetIfMobile = () => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) {
      setMobileDayOpen(true)
    }
  }

  const handleSelectDay = (cell: MonthCell) => {
    if (!cell.inMonth) {
      // Adjacent-month day → navigate there and keep it selected.
      shiftMonth(cell.monthOffset)
      setSelectedDateISO(cell.dateISO)
      openSheetIfMobile()
      return
    }
    if (selectedDateISO === cell.dateISO) {
      setSelectedDateISO(null) // tap again to clear
      return
    }
    setSelectedDateISO(cell.dateISO)
    openSheetIfMobile()
  }

  const openAdd = (dateISO?: string) => {
    setAddDefaultDate(dateISO ?? selectedDateISO ?? todayDate ?? `${year}-${pad(month + 1)}-01`)
    setAddOpen(true)
  }

  const handleEventAdded = (event: CalendarEvent) => {
    // Navigate to the event's month, select its day and make sure its
    // type is visible in the current filter.
    const [y, m] = event.date.split('-').map(Number)
    if (y !== year || m - 1 !== month) {
      setNavDirection(y * 12 + (m - 1) > year * 12 + month ? 1 : -1)
      setYear(y)
      setMonth(m - 1)
    }
    setSelectedDateISO(event.date)
    setFilterTypes((prev) => (prev.includes(event.type) ? prev : [...prev, event.type]))
  }

  const selectedDayEvents = selectedDateISO ? (eventsByDate[selectedDateISO] ?? []) : []

  // ─── Shared rail contents ────────────────────────────────────────

  const upcomingNode = (
    <UpcomingContent
      events={upcomingEvents}
      emptyDueToFilter={upcomingEmptyDueToFilter}
      onShowAll={showAllTypes}
      onOpen={setDetailEvent}
    />
  )

  const dayNode = selectedDateISO ? (
    <DayContent
      dateISO={selectedDateISO}
      events={selectedDayEvents}
      canCreate={canCreate}
      onAdd={(d) => openAdd(d)}
      onOpen={setDetailEvent}
      onClear={() => setSelectedDateISO(null)}
    />
  ) : null

  return (
    <PageTransition className="space-y-4 sm:space-y-5">
      {/* Module heading — student panels keep their heading pattern. */}
      {showHeading && (
        <SectionHeading
          title="School Calendar"
          subtitle="Events, exams & school holidays"
          icon={<CalendarDays className="h-5 w-5" />}
          action={
            <StatusBadge
              status={`${monthTotal} event${monthTotal === 1 ? '' : 's'} this month`}
              variant="primary"
              dot
            />
          }
        />
      )}

      {/* Toolbar — month/year + event count (left), navigation and the
          single primary action (right). Clean enterprise grouping. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {/* Title cross-fades subtly with month navigation */}
          <AnimatePresence mode="wait" initial={false} custom={navDirection}>
            <motion.div
              key={monthKey}
              initial={{ opacity: 0, y: 4 * navDirection }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 * navDirection }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <h2
                className="font-display text-xl font-bold leading-none tracking-tight text-foreground sm:text-2xl"
                aria-live="polite"
                aria-atomic="true"
              >
                {MONTH_NAMES[month]}
              </h2>
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                {year}
              </span>
            </motion.div>
          </AnimatePresence>

          <p className="mt-1.5 text-xs text-muted-foreground">
            {monthTotal === 0
              ? 'No events this month'
              : `${monthTotal} event${monthTotal === 1 ? '' : 's'} this month`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Segmented month navigation — ‹ · Today · › */}
          <nav
            className="inline-flex items-center overflow-hidden rounded-lg border border-border bg-card shadow-2xs"
            aria-label="Month navigation"
          >
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={goToToday}
              aria-label="Jump to today"
              className={cn(
                'flex h-9 items-center border-l border-border px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                isTodayMonth
                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </nav>

          {canCreate && (
            <Button
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={() => openAdd()}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add Event
            </Button>
          )}
        </div>
      </header>

      {/* Filters — toggle chips that double as the type legend. */}
      <TypeFilters
        filterTypes={filterTypes}
        onToggle={toggleType}
        counts={typeCounts}
        onShowAll={showAllTypes}
      />

      {/* All types hidden → slim inline notice instead of a dead grid. */}
      {filterTypes.length === 0 && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 py-2.5 text-xs text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          All event types are hidden.
          <button
            type="button"
            onClick={showAllTypes}
            className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show all
          </button>
        </div>
      )}

      {/* Calendar (primary) + rail. Below lg: single column, upcoming
          card under the grid, day details via bottom sheet. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5 lg:items-stretch">
        <MonthGrid
          year={year}
          month={month}
          cells={cells}
          eventsByDate={eventsByDate}
          selectedDate={selectedDateISO}
          todayDate={todayDate}
          navDirection={navDirection}
          onSelectDay={handleSelectDay}
          onOpenEvent={setDetailEvent}
        />

        {/* Desktop rail — day details when a day is selected, else upcoming. */}
        <div className="hidden h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xs lg:flex">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedDateISO ?? 'upcoming'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex h-full min-h-0 flex-col"
            >
              {dayNode ?? upcomingNode}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mobile/tablet rail — upcoming below the calendar. */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs lg:hidden">
          {upcomingNode}
        </div>
      </div>

      {/* Mobile day sheet (below lg) — bottom sheet with the same Day
          content as the desktop rail. */}
      <Sheet open={mobileDayOpen} onOpenChange={setMobileDayOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl px-0 pb-0"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden />
          <SheetTitle className="sr-only">
            {selectedDateISO ? `Events on ${selectedDateISO}` : 'Events'}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Events scheduled for the selected day
          </SheetDescription>
          <div className="min-h-0 flex-1 overflow-hidden pt-1">
            {selectedDateISO && (
              <DayContent
                dateISO={selectedDateISO}
                events={selectedDayEvents}
                canCreate={canCreate}
                onAdd={(d) => {
                  setMobileDayOpen(false)
                  openAdd(d)
                }}
                onOpen={setDetailEvent}
              />
            )}
          </div>
          {canCreate && selectedDateISO && (
            <div className="border-t border-border p-3">
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => {
                  setMobileDayOpen(false)
                  openAdd(selectedDateISO)
                }}
              >
                <Plus className="h-4 w-4" aria-hidden /> Add event on this day
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Event detail — progressive disclosure for full event context. */}
      <EventDetailDialog
        event={detailEvent}
        onOpenChange={(o) => !o && setDetailEvent(null)}
        canManage={canCreate}
      />

      {/* Add event — focused creation form. */}
      {canCreate && (
        <AddEventDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          defaultDate={addDefaultDate}
          onAdded={handleEventAdded}
        />
      )}
    </PageTransition>
  )
}
