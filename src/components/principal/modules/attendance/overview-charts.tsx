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
  weeklyTrend: { day: string; present: number; rate: number }[]
  monthlyTrend: { month: string; rate: number }[]
}

export function OverviewCharts({
  todaysRate, present, absent, late, leave, total: _total,
  weeklyTrend, monthlyTrend,
}: OverviewChartsProps) {
  const weeklyInsight = deriveTrendInsight(weeklyTrend.map((d) => d.rate))
  const monthlyInsight = deriveTrendInsight(monthlyTrend.map((m) => m.rate))

  const monthlyAvg = monthlyTrend.reduce((s, m) => s + m.rate, 0) / Math.max(monthlyTrend.length, 1)
  const latestMonthly = monthlyTrend[monthlyTrend.length - 1]?.rate ?? 0

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
          <TodayBreakdownStack
            data={breakdownData}
            centerValue={`${todaysRate}%`}
            centerLabel="Present"
          />
        </section>

        {/* Weekly Trend — thin divider on the left for lg+, no card */}
        <section className="py-2 lg:border-l lg:border-border/40 lg:pl-6">
          <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                Weekly Trend
              </h3>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                Attendance rate · last 6 working days
              </p>
            </div>
            <InsightBadge insight={weeklyInsight} />
          </div>
          <TrendLine
            data={weeklyTrend.map((d) => ({ name: d.day, value: d.rate }))}
            xKey="name"
            yKey="value"
            color={ATTENDANCE_PALETTE.trend}
            height={170}
            yDomain={[80, 100]}
          />
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
              6-month attendance rate · long-term direction
            </p>
          </div>
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
        </div>
        <TrendLine
          data={monthlyTrend.map((m) => ({ name: m.month, value: m.rate }))}
          xKey="name"
          yKey="value"
          color={ATTENDANCE_PALETTE.monthly}
          height={160}
          yDomain={[88, 100]}
          averageValue={monthlyAvg}
        />
      </section>
    </>
  )
}
