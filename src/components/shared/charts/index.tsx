/* ============================================================
   charts/index.ts
   Barrel re-export for the SCHOLARIO chart system.

   This is the BACKWARD-COMPATIBILITY entry point. Every named
   export that callers used to import from the monolithic
   `charts.tsx` is re-exported here so existing imports like:
       import { ChartCard, AreaTrend, Donut } from '@/components/shared/charts'
   continue to resolve unchanged.

   VISUAL UPGRADE (visualization layer only — no business logic,
   data sources, or calculations changed):
     - Donut, RadialGauge, AreaTrend, DualArea, BarTrend, GroupedBar,
       ProgressBar now delegate to the unified premium-charts system
       (@/components/shared/premium-charts) so every chart across
       principal / teacher / student / superadmin modules shares the
       same smooth animation, hover behaviour, gradient segments,
       pop-out interaction, and tooltip style.
     - ChartCard (container) and MiniLine (sparkline) keep their
       legacy implementations — they're already visually polished and
       the premium system doesn't have direct equivalents.
     - PERF (5-e): ChartCard lives in ./chart-card (recharts-free) and
       MiniLine is imported DIRECTLY from ./charts/legacy-circular by
       its single consumer (kpi-card), so THIS barrel no longer pulls
       the recharts runtime into premium-only consumers (student
       dashboard RadialGauge, student fees ProgressBar, teacher
       analytics AreaTrend…).
   ============================================================ */

// Shared helpers (kept as legacy)
export { AXIS_TICK, formatAxisTick } from './colors'
export { PremiumTooltip, GlowFilter } from './utils'

// Container — recharts-free split (see header note)
export { ChartCard } from './chart-card'

// ─── Adapters that delegate to the premium-charts system ────────────

import {
  AreaTrendChart as PremiumAreaTrend,
  DonutChart as PremiumDonut,
  RadialProgress as PremiumRadial,
  BarTrend as PremiumBarTrend,
  GroupedBarChart as PremiumGroupedBar,
  HorizontalBarChart as PremiumHorizontalBars,
  ProgressBar as PremiumProgressBar,
} from '@/components/shared/premium-charts'

// Donut — delegates to premium DonutChart
interface DonutProps {
  data: { name: string; value: number; color: string }[]
  height?: number
  innerRadius?: number
  outerRadius?: number
  centerLabel?: string
  centerValue?: string
}

export function Donut({ data, height = 240, centerLabel, centerValue }: DonutProps) {
  // map height → size (roughly height * 0.75, clamped)
  const size = Math.min(260, Math.max(140, Math.round(height * 0.75)))
  const thickness = Math.round(size * 0.12)
  return (
    <div className="flex items-center justify-center" style={{ minHeight: height }}>
      <PremiumDonut
        data={data}
        size={size}
        thickness={thickness}
        centerLabel={centerLabel}
        centerValue={centerValue}
        showLegend={false}
      />
    </div>
  )
}

// RadialGauge — delegates to premium RadialProgress
interface RadialGaugeProps {
  value: number
  max?: number
  color?: string
  label?: string
  size?: number
}

export function RadialGauge({ value, max = 100, color = 'oklch(0.55 0.14 162)', label, size = 160 }: RadialGaugeProps) {
  return (
    <PremiumRadial
      value={value}
      max={max}
      size={size}
      thickness={Math.round(size * 0.085)}
      color={color}
      label={label}
      showTicks
      glow
      // Round the displayed counter to one decimal — animated intermediate
      // frames (ease-out passing through e.g. 95.13771665493368) must never
      // render long float tails on screen.
      formatValue={(n) => `${Math.round(n * 10) / 10}%`}
    />
  )
}

// AreaTrend — single-series area, delegates to premium AreaTrendChart
// `showArea` passthrough lets callers render a pure thin line (no area fill)
// when the chart sits in an OpenChartSection (outside any card).
interface AreaTrendProps {
  data: any[]
  xKey: string
  yKey: string
  color?: string
  height?: number
  gradientId?: string
  showArea?: boolean
  strokeWidth?: number
}

export function AreaTrend({ data, xKey, yKey, color = 'oklch(0.55 0.14 162)', height = 240, showArea, strokeWidth }: AreaTrendProps) {
  return (
    <PremiumAreaTrend
      data={data}
      height={height}
      labelKey={xKey}
      primaryKey={yKey}
      primaryColor={color}
      primaryLabel={yKey}
      showArea={showArea}
      strokeWidth={strokeWidth}
    />
  )
}

// DualArea — multi-series area, delegates to premium AreaTrendChart
// `showArea` passthrough lets callers render pure thin lines (no area fill)
// when the chart sits in an OpenChartSection (outside any card).
interface DualAreaProps {
  data: any[]
  xKey: string
  keys: { key: string; color: string; name: string }[]
  height?: number
  showArea?: boolean
  strokeWidth?: number
  secondaryStrokeWidth?: number
}

export function DualArea({ data, xKey, keys, height = 240, showArea, strokeWidth, secondaryStrokeWidth }: DualAreaProps) {
  const primary = keys[0]
  const secondary = keys[1]
  return (
    <PremiumAreaTrend
      data={data}
      height={height}
      labelKey={xKey}
      primaryKey={primary.key}
      secondaryKey={secondary?.key}
      primaryColor={primary.color}
      secondaryColor={secondary?.color ?? 'oklch(0.62 0.2 25)'}
      primaryLabel={primary.name}
      secondaryLabel={secondary?.name}
      showArea={showArea}
      strokeWidth={strokeWidth}
      secondaryStrokeWidth={secondaryStrokeWidth}
    />
  )
}

// BarTrend — single-series bar, delegates to premium BarTrend (vertical) or HorizontalBarChart
interface BarTrendProps {
  data: any[]
  xKey: string
  yKey: string
  color?: string
  height?: number
  horizontal?: boolean
  showLabels?: boolean
  labelFormat?: (v: number) => string
}

export function BarTrend({ data, xKey, yKey, color = 'oklch(0.55 0.14 162)', height = 240, horizontal, labelFormat }: BarTrendProps) {
  if (horizontal) {
    // horizontal bars — use HorizontalBarChart shape
    const hData = data.map((d) => ({ label: d[xKey], value: d[yKey], color }))
    return <PremiumHorizontalBars data={hData} height={height} formatValue={labelFormat} />
  }
  return (
    <PremiumBarTrend
      data={data}
      height={height}
      labelKey={xKey}
      valueKey={yKey}
      color={color}
      formatValue={labelFormat ?? ((n) => n.toLocaleString('en-IN'))}
    />
  )
}

// GroupedBar — multi-series grouped bars, delegates to premium GroupedBarChart
interface GroupedBarProps {
  data: any[]
  xKey: string
  series: { key: string; name: string; color: string }[]
  height?: number
  showLabels?: boolean
  labelFormat?: (v: number) => string
}

export function GroupedBar({ data, xKey, series, height = 260, labelFormat }: GroupedBarProps) {
  const primary = series[0]
  const secondary = series[1]
  return (
    <PremiumGroupedBar
      data={data}
      height={height}
      labelKey={xKey}
      primaryKey={primary.key}
      secondaryKey={secondary?.key}
      primaryColor={primary.color}
      secondaryColor={secondary?.color ?? 'oklch(0.62 0.2 25)'}
      primaryLabel={primary.name}
      secondaryLabel={secondary?.name}
      formatValue={labelFormat ?? ((n) => n.toLocaleString('en-IN'))}
    />
  )
}

// ProgressBar — delegates to premium ProgressBar
interface ProgressBarProps {
  value: number
  max?: number
  color?: string
  height?: number
  className?: string
}

export function ProgressBar({ value, max = 100, color, className }: ProgressBarProps) {
  return <PremiumProgressBar value={value} max={max} color={color} className={className} />
}
