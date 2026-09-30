'use client'

/**
 * attendance-charts — Attendance-specific premium chart components.
 *
 * These are scoped to the Attendance module so we don't disturb the shared
 * chart infrastructure used by other modules (Dashboard, Finance, etc.).
 *
 * Design principles (Brief sections 5–11, 15, 22):
 *  - Smooth line/area trends instead of giant bars
 *  - Compact ring with restrained palette
 *  - Compact ranking tracks instead of horizontal bar chart
 *  - Restrained tooltips — one consistent design
 *  - Subtle 400–700ms reveal animations; respects prefers-reduced-motion
 */

import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { formatNumber } from '@/lib/format'

/* ──────────────────────────────────────────────────────────
   Shared attendance palette — one consistent semantic system
   Brief section 23: green/teal/amber/rose. No rainbow.
   ────────────────────────────────────────────────────────── */
export const ATTENDANCE_PALETTE = {
  present: 'oklch(0.65 0.16 162)',  // emerald
  late:    'oklch(0.75 0.15 75)',   // amber
  absent:  'oklch(0.62 0.2 25)',    // rose
  leave:   'oklch(0.65 0.13 220)',  // blue-teal
  trend:   'oklch(0.6 0.14 200)',   // teal-blue (neutral info)
  monthly: 'oklch(0.55 0.14 162)',  // emerald (improvement signal)
} as const

/* ──────────────────────────────────────────────────────────
   AttendanceTooltip — one consistent tooltip for all charts
   Brief section 22: white/translucent, subtle shadow, small radius,
   clear label, strong value, minimal supporting info.
   ────────────────────────────────────────────────────────── */
interface AttendanceTooltipProps {
  active?: boolean
  payload?: any[]
  label?: string | number
  /** Suffix appended to the value (e.g. "%"). */
  valueSuffix?: string
  /** Label shown above value (e.g. "Attendance"). */
  valueLabel?: string
  /** Optional secondary lines: [{ label, value, color }]. */
  extra?: { label: string; value: string; color?: string }[]
}

export function AttendanceTooltip({
  active, payload, label, valueSuffix = '%', valueLabel = 'Attendance', extra,
}: AttendanceTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  // FINAL-GATE: payload[0] can be the dashed AVERAGE reference line (a Line
  // series rendered alongside the Area) — reporting the average as the
  // hovered month's value is a tooltip-correctness defect. Pick the real
  // data series first; the reference line is never a tooltip source.
  const entry = payload.find((p) => p.dataKey !== '__avg' && p.name !== '__avg') ?? payload[0]
  const v = typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value
  const color = entry.color || ATTENDANCE_PALETTE.trend

  return (
    <div
      className="pointer-events-none rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-lg shadow-black/5 min-w-[140px]"
      role="tooltip"
    >
      {label != null && (
        <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
          {label}
        </div>
      )}
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-muted-foreground truncate">{valueLabel}</span>
          </span>
          <span className="font-display font-bold tabular-nums">{v}{valueSuffix}</span>
        </div>
        {extra && extra.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-border/40 space-y-1">
            {extra.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[10px]">
                <span className="flex items-center gap-1.5 min-w-0">
                  {e.color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: e.color }} />}
                  <span className="text-muted-foreground truncate">{e.label}</span>
                </span>
                <span className="font-medium tabular-nums">{e.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────
   TrendLine — smooth line + subtle area fill for % trends
   Brief section 6 + 7: replaces giant BarTrend for weekly/monthly.
   ────────────────────────────────────────────────────────── */
interface TrendLineProps {
  data: any[]
  xKey: string
  yKey: string
  color?: string
  height?: number
  /** Domain for Y-axis. Omit to derive an honest domain from the data
   *  (default for % trends — see `derivedYDomain`): a multiple-of-5 floor
   *  with headroom BELOW the data minimum and a 100% ceiling, so no point
   *  is ever clipped and the visible axis ticks disclose the baseline. */
  yDomain?: [number, number] | 'auto'
  /** Optional average reference line value. */
  averageValue?: number
  /** Suffix for tooltip values (e.g. "%"). */
  valueSuffix?: string
}

/** FINAL-GATE — honest Y domain for a non-negative %-bounded series.
 *  A FIXED truncated window ([80,100] / [88,100]) silently CLIPS any value
 *  below its floor (a 75% school's line simply vanishes off the bottom)
 *  and amplifies ±1pt wobble into full-height swings. Instead, derive from
 *  the data: floor = greatest multiple of 5 with ≥5pt headroom under the
 *  minimum (never above 0), top = 100 for a % series (niceCeil otherwise).
 *  The floor is never hidden — the Y ticks print it. */
function derivedYDomain(data: any[], yKey: string): [number, number] {
  const values = data
    .map((d) => Number(d[yKey]))
    .filter((v) => Number.isFinite(v))
  if (values.length === 0) return [0, 100]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const bounded = max <= 100 && min >= 0
  const top = bounded ? 100 : Math.ceil(max / 5) * 5
  const floor = bounded
    ? Math.max(0, Math.min(95, Math.floor((min - 5) / 5) * 5))
    : Math.max(0, Math.floor((min - 5) / 5) * 5)
  // Safety: the domain must always contain the data (never clip).
  return [Math.min(floor, min), Math.max(top, max)]
}

export function TrendLine({
  data, xKey, yKey,
  color = ATTENDANCE_PALETTE.trend,
  height = 220,
  yDomain,
  averageValue,
  valueSuffix = '%',
}: TrendLineProps) {
  const uid = useId().replace(/:/g, '')
  const gid = `trend-${uid}`
  const reduce = useReducedMotion()
  const domain = yDomain === undefined ? derivedYDomain(data, yKey) : yDomain
  // A 1–2 point series renders no visible stroke (a line needs two points)
  // — draw real dots so a brand-new dataset is still readable.
  const showDots = data.length > 0 && data.length <= 2

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="60%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Brief §23: very subtle gridlines — 1-2 faint horizontal lines, no vertical */}
        <CartesianGrid strokeDasharray="2 6" stroke="var(--border)" vertical={false} horizontal={true} opacity={0.3} />
        {/* Brief §22: axis labels small, quiet, secondary */}
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)', opacity: 0.7 }}
          axisLine={false}
          tickLine={false}
          dy={6}
        />
        <YAxis
          domain={domain === 'auto' ? ['auto', 'auto'] : domain}
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)', opacity: 0.7 }}
          axisLine={false}
          tickLine={false}
          width={32}
          tickFormatter={(v) => `${v}%`}
          tickCount={3}
        />
        <Tooltip
          content={<AttendanceTooltip valueSuffix={valueSuffix} />}
          cursor={{ stroke: color, strokeOpacity: 0.25, strokeWidth: 1, strokeDasharray: '3 3' }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gid})`}
          isAnimationActive={!reduce}
          animationDuration={650}
          animationEasing="ease-out"
          activeDot={{
            r: 4,
            stroke: color,
            strokeWidth: 2,
            fill: 'var(--popover)',
          }}
          dot={showDots ? { r: 3, fill: color, strokeWidth: 0 } : false}
        />
        {/* Average reference line — rendered AFTER the data series so it
            never hijacks the tooltip's payload[0]; it stays a quiet dashed
            guide above the area fill. */}
        {averageValue != null && (
          <Line
            type="monotone"
            dataKey={() => averageValue}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            dot={false}
            isAnimationActive={false}
            name="__avg"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ──────────────────────────────────────────────────────────
   TodayBreakdownStack — Brief §15-§16 (Phase 3): compact.
   No giant card, no donut. Just: large percentage + thin composition
   bar + 4 status rows. Reads at a glance.

   Structure:
     93.3%  PRESENT
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ (segmented composition bar)
     ● Present   1,719   93.3%
     ● Late         18    1.0%
     ● Absent       96    5.2%
     ● Leave         9    0.5%
   ────────────────────────────────────────────────────────── */
export interface TodayBreakdownItem {
  name: string
  value: number
  color: string
}

export function TodayBreakdownStack({
  data, centerValue, centerLabel = 'PRESENT',
}: {
  data: TodayBreakdownItem[]
  centerValue: string
  centerLabel?: string
}) {
  const reduce = useReducedMotion()
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="space-y-3">
      {/* Compact header row — large focal value + label, inline */}
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums tracking-tight text-foreground leading-none">
          {centerValue}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] font-semibold">
          {centerLabel}
        </span>
      </div>

      {/* Thin segmented composition bar — Brief §16 */}
      <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-muted/40">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0
          if (pct === 0) return null
          return (
            <motion.div
              key={d.name}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
              style={{ background: d.color }}
              title={`${d.name} · ${pct.toFixed(1)}%`}
            />
          )
        })}
      </div>

      {/* Status rows — count + % aligned, never overflows */}
      <div className="space-y-1">
        {data.map((d) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0
          return <RingLegendRow key={d.name} name={d.name} value={d.value} pct={pct} color={d.color} />
        })}
      </div>
    </div>
  )
}

function RingLegendRow({ name, value, pct, color }: {
  name: string
  value: number
  pct: number
  color: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-muted-foreground truncate">{name}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0 tabular-nums">
        <span className="font-display font-semibold text-foreground">{formatNumber(value)}</span>
        <span className="text-[10px] text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
      </span>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────
   InsightBadge — small derived trend insight
   Brief section 7: Stable / Improving / Declining from real data.
   ────────────────────────────────────────────────────────── */
export function deriveTrendInsight(values: number[]): {
  label: 'Improving' | 'Declining' | 'Stable'
  variant: 'success' | 'warning' | 'neutral'
  delta: number
} {
  if (values.length < 2) return { label: 'Stable', variant: 'neutral', delta: 0 }
  const first = values[0]
  const last = values[values.length - 1]
  const delta = +(last - first).toFixed(1)
  if (delta >= 0.5) return { label: 'Improving', variant: 'success', delta }
  if (delta <= -0.5) return { label: 'Declining', variant: 'warning', delta }
  return { label: 'Stable', variant: 'neutral', delta }
}

export function InsightBadge({ insight }: { insight: ReturnType<typeof deriveTrendInsight> }) {
  const cls = insight.variant === 'success'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
    : insight.variant === 'warning'
    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
    : 'bg-muted text-muted-foreground border-border'
  const arrow = insight.delta > 0 ? '↑' : insight.delta < 0 ? '↓' : '—'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      <span className="tabular-nums">{arrow} {Math.abs(insight.delta)}%</span>
      <span className="opacity-80">· {insight.label}</span>
    </span>
  )
}
