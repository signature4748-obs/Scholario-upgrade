'use client'

/**
 * fees-charts — Fee Management chart components.
 *
 * MiniAreaChart is built on the SAME chart architecture as the Attendance
 * module's TrendLine (attendance/attendance-charts.tsx): recharts
 * ResponsiveContainer + AreaChart with subtle horizontal-only gridlines,
 * quiet 9px axes, a restrained popover tooltip, and monotone curves
 * (no overshoot — mathematically honest). This keeps one chart language
 * across Scholario instead of a bespoke SVG system per module.
 *
 * Differences from the Attendance trend are semantic, not visual:
 *  - two series (Collected emerald + Pending rose; Pending renders only
 *    when the dataset carries it — e.g. Salary passes a single series)
 *  - currency Y-axis with a nice-rounded [0, max] domain so zero-value
 *    months read as ₹0 and the axis NEVER implies negative collection
 *  - NO internal legend — each section header owns its single legend
 */

import { useId } from 'react'
import { useReducedMotion } from 'framer-motion'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  DonutChart,
  PieChart,
  RadialProgress,
  GroupedBarChart,
  HorizontalBarChart,
  ProgressBar,
} from '@/components/shared/premium-charts'

/* ── Fee chart palette — same semantic system as the module's KPIs ── */
export const FEES_CHART_PALETTE = {
  collected: 'oklch(0.55 0.14 162)', // emerald — Collected semantic
  pending:   'oklch(0.62 0.2 25)',   // rose — Outstanding/Pending semantic
} as const

/* ── Compact currency axis labels: ₹1.5L · ₹60K · ₹0 ── */
function formatAxisINR(n: number): string {
  if (n >= 10000000) return `₹${+(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000) return `₹${+(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${+(n / 1000).toFixed(0)}K`
  return `₹${Math.round(n)}`
}

/* ── Nice ceiling for the Y domain (1 / 2 / 2.5 / 5 × 10^k) so the top
      gridline is a clean round currency value, never a raw data max. ── */
function niceCeil(v: number): number {
  if (v <= 0) return 0
  const exp = Math.floor(Math.log10(v))
  const base = Math.pow(10, exp)
  const frac = v / base
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10
  return nice * base
}

/* ── Tooltip — follows the AttendanceTooltip design (one consistent
      tooltip across the ERP): translucent popover, uppercase month
      header, dot + label left, bold tabular value right. ── */
interface FeesTrendTooltipProps {
  active?: boolean
  payload?: any[]
  label?: string | number
  format?: (n: number) => string
}

function FeesTrendTooltip({ active, payload, label, format }: FeesTrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const fmt = format ?? ((n: number) => n.toLocaleString('en-IN'))
  return (
    <div
      className="pointer-events-none rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-lg shadow-black/5 min-w-[150px]"
      role="tooltip"
    >
      {label != null && (
        <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
          {label}
        </div>
      )}
      <div className="px-2.5 py-2 space-y-1">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: entry.color }} />
              <span className="text-muted-foreground truncate">{entry.name}</span>
            </span>
            <span className="font-display font-bold tabular-nums">{fmt(entry.value ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── MiniAreaChart — monthly trend for { month, collected, pending? }.
      Renders Pending as a secondary line only when the dataset has it.
      Default height is the Overview's compact command-centre size (~180px);
      the Y domain stays ₹0-anchored ([0, niceCeil(max)]) so a zero month
      always reads as ₹0 and negative collection is never implied. ── */
export function MiniAreaChart({
  data,
  height = 180,
  format,
  showArea = false,
  strokeWidth = 2,
  secondaryStrokeWidth = 1.5,
}: {
  data: any[]
  height?: number
  format?: (n: number) => string
  showArea?: boolean
  strokeWidth?: number
  secondaryStrokeWidth?: number
}) {
  const uid = useId().replace(/:/g, '')
  const reduce = useReducedMotion()

  const hasPending = data.some((d) => typeof d.pending === 'number' && d.pending > 0)
  const maxVal = Math.max(
    0,
    ...data.flatMap((d) => [d.collected ?? 0, hasPending ? d.pending ?? 0 : 0]),
  )
  // Honest zero baseline + nice round top tick. No negative values are
  // ever implied for a non-negative dataset.
  const yMax = niceCeil(maxVal) || 1

  if (maxVal <= 0) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={`collected-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FEES_CHART_PALETTE.collected} stopOpacity={0.22} />
            <stop offset="60%" stopColor={FEES_CHART_PALETTE.collected} stopOpacity={0.08} />
            <stop offset="100%" stopColor={FEES_CHART_PALETTE.collected} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`pending-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FEES_CHART_PALETTE.pending} stopOpacity={0.12} />
            <stop offset="100%" stopColor={FEES_CHART_PALETTE.pending} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Subtle gridlines — 2-3 faint horizontal lines, no vertical */}
        <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" vertical={false} horizontal={true} opacity={0.3} />
        {/* Axis labels small, quiet, secondary — same as Attendance */}
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)', opacity: 0.7 }}
          axisLine={false}
          tickLine={false}
          dy={6}
          interval={0}
        />
        <YAxis
          domain={[0, yMax]}
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)', opacity: 0.7 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={formatAxisINR}
          tickCount={3}
        />
        <Tooltip
          content={<FeesTrendTooltip format={format} />}
          cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.25, strokeWidth: 1, strokeDasharray: '3 3' }}
          isAnimationActive={false}
        />
        {/* Pending (secondary) — thinner rose line behind the primary */}
        {hasPending && (
          <Area
            type="monotone"
            dataKey="pending"
            name="Pending"
            stroke={FEES_CHART_PALETTE.pending}
            strokeWidth={secondaryStrokeWidth}
            fill={showArea ? `url(#pending-${uid})` : 'transparent'}
            isAnimationActive={!reduce}
            animationDuration={650}
            animationEasing="ease-out"
            activeDot={{
              r: 3.5,
              stroke: FEES_CHART_PALETTE.pending,
              strokeWidth: 2,
              fill: 'var(--popover)',
            }}
            dot={false}
          />
        )}
        {/* Collected (primary) — emerald line + gradient area */}
        <Area
          type="monotone"
          dataKey="collected"
          name="Collected"
          stroke={FEES_CHART_PALETTE.collected}
          strokeWidth={strokeWidth}
          fill={showArea ? `url(#collected-${uid})` : 'transparent'}
          isAnimationActive={!reduce}
          animationDuration={650}
          animationEasing="ease-out"
          activeDot={{
            r: 4,
            stroke: FEES_CHART_PALETTE.collected,
            strokeWidth: 2,
            fill: 'var(--popover)',
          }}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// MiniDonut: direct passthrough (premium animated donut with gradient segments + pop-out hover)
export { DonutChart as MiniDonut }

// MiniPie: full pie variant (no center hole), same data model as MiniDonut
export { PieChart as MiniPie }

// MiniRadial: direct passthrough (animated counter, optional ticks + completion glow)
export { RadialProgress as MiniRadial }

// MiniBars: direct passthrough
export { HorizontalBarChart as MiniBars }

// GroupedBars: direct passthrough
export { GroupedBarChart as GroupedBars }

// ProgressBar: direct passthrough
export { ProgressBar }
