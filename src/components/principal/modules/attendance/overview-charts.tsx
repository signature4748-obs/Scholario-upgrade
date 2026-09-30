'use client'

/**
 * OverviewCharts — Phase 3 redesign.
 *
 * Brief §10-§14 (Phase 3): "outside the box" — charts should feel like
 * editorial analytics sitting naturally on the page, NOT dashboard boxes.
 *
 * Layout (Brief §8 — Phase 2, refined):
 *   Row 1: Today's Breakdown (compact, no giant card) + Weekly Trend
 *   Row 2: Monthly Trend (full-width open section)
 *
 * Visual decisions:
 *   - Remove ChartCard wrapper for trend charts — use plain section with
 *     thin divider instead of bordered card.
 *   - Today's Breakdown uses a compact inline layout (no oversized card).
 *   - Trend chart heights reduced (160-180px from 240px).
 *   - Subtle gridlines (1-2 faint horizontal lines, no vertical).
 */

import {
  TrendLine,
  TodayBreakdownStack,
  InsightBadge,
  deriveTrendInsight,
  ATTENDANCE_PALETTE,
} from './attendance-charts'

interface OverviewChartsProps {
  todaysRate: number
  present: number
  absent: number
  late: number
  leave: number
  total: number
  weeklyTrend: { day: string; date?: string; present: number; rate: number }[]
  monthlyTrend: { month: string; rate: number }[]
}

/* FINAL-GATE — honest no-data placeholder. A school with zero attendance
 * rows must not render "0%" composition bars and empty chart frames that
 * look like real measurements. */
function ChartEmptyNote({ message }: { message: string }) {
  return (
    <p className="flex min-h-[96px] items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
      {message}
    </p>
  )
}

export function OverviewCharts({
  todaysRate, present, absent, late, leave, total,
  weeklyTrend, monthlyTrend,
}: OverviewChartsProps) {
  const weeklyInsight = deriveTrendInsight(weeklyTrend.map((d) => d.rate))
  const monthlyInsight = deriveTrendInsight(monthlyTrend.map((m) => m.rate))

  const monthlyAvg = monthlyTrend.reduce((s, m) => s + m.rate, 0) / Math.max(monthlyTrend.length, 1)
  const latestMonthly = monthlyTrend[monthlyTrend.length - 1]?.rate ?? 0

  // FINAL-GATE label honesty: say the window the data ACTUALLY covers —
  // "last 6" when fewer were recorded is a false claim. Day labels carry
  // the day-of-month so two "Tue"s from different weeks are distinct.
  const weeklyWindow = Math.min(6, weeklyTrend.length)
  const monthlyWindow = Math.min(6, monthlyTrend.length)

  const breakdownData = [
    { name: 'Present', value: present, color: ATTENDANCE_PALETTE.present },
    { name: 'Late',    value: late,    color: ATTENDANCE_PALETTE.late },
    { name: 'Absent',  value: absent,  color: ATTENDANCE_PALETTE.absent },
    { name: 'Leave',   value: leave,   color: ATTENDANCE_PALETTE.leave },
  ]

  return (
    <>
      {/* Row 1: Today's Breakdown (compact) + Weekly Trend — side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Today's Breakdown — compact, no oversized card */}
        <section className="py-2">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                Today's Breakdown
              </h3>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                Attendance composition
              </p>
            </div>
          </div>
          {total > 0 ? (
            <TodayBreakdownStack
              data={breakdownData}
              centerValue={`${todaysRate}%`}
              centerLabel="Attendance"
            />
          ) : (
            <ChartEmptyNote message="No attendance recorded yet — today's composition appears here." />
          )}
        </section>

        {/* Weekly Trend — thin divider on the left for lg+, no card */}
        <section className="py-2 lg:border-l lg:border-border/40 lg:pl-6">
          <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                Weekly Trend
              </h3>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                Attendance rate · last {weeklyWindow} recorded {weeklyWindow === 1 ? 'day' : 'days'}
              </p>
            </div>
            {weeklyTrend.length > 0 && <InsightBadge insight={weeklyInsight} />}
          </div>
          {weeklyTrend.length > 0 ? (
            <TrendLine
              data={weeklyTrend.map((d) => ({
                name: d.date ? `${d.day} ${parseInt(d.date.slice(8, 10), 10)}` : d.day,
                value: d.rate,
              }))}
              xKey="name"
              yKey="value"
              color={ATTENDANCE_PALETTE.trend}
              height={170}
            />
          ) : (
            <ChartEmptyNote message="No attendance recorded yet — the daily trend appears here." />
          )}
        </section>
      </div>

      {/* Thin horizontal divider — subtle, no heavy container */}
      <div className="border-t border-border/40 my-2" />

      {/* Row 2: Monthly Trend — full width, sits naturally on the page */}
      <section className="py-2">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
              Monthly Trend
            </h3>
            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
              Attendance rate · last {monthlyWindow} recorded {monthlyWindow === 1 ? 'month' : 'months'} · long-term direction
            </p>
          </div>
          {monthlyTrend.length > 0 && (
            <div className="flex items-baseline gap-3 text-[10px] text-muted-foreground">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono">6-mo avg</span>
                <span className="font-display font-bold tabular-nums text-foreground">{monthlyAvg.toFixed(1)}%</span>
              </div>
              <span className="text-muted-foreground/40">·</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono">Latest</span>
                <span className="font-display font-bold tabular-nums text-foreground">{latestMonthly}%</span>
              </div>
              <span className="text-muted-foreground/40">·</span>
              <InsightBadge insight={monthlyInsight} />
            </div>
          )}
        </div>
        {monthlyTrend.length > 0 ? (
          <TrendLine
            data={monthlyTrend.map((m) => ({ name: m.month, value: m.rate }))}
            xKey="name"
            yKey="value"
            color={ATTENDANCE_PALETTE.monthly}
            height={160}
            averageValue={monthlyAvg}
          />
        ) : (
          <ChartEmptyNote message="Not enough history yet — the monthly trend appears after a few recorded weeks." />
        )}
      </section>
    </>
  )
}
