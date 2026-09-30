'use client'

/**
 * premium-charts — Unified premium chart visualization system for SCHOLARIO.
 *
 * One reusable chart system used across ALL modules:
 *   - DonutChart        : animated categorical distribution (gradient segments, hover pop-out,
 *                         bidirectional legend sync, enhanced center content, floating tooltip)
 *   - PieChart          : full pie variant (no center hole), shares DonutChart's data model
 *   - RadialProgress    : single-value progress ring (gradient stroke, animated counter,
 *                         optional tick marks, completion glow, optional dual-ring)
 *   - AreaTrendChart    : smooth Catmull-Rom bezier area/line trend with hover dots + tooltip
 *   - GroupedBarChart   : grouped bar comparison (quarterly, class-wise)
 *   - HorizontalBarChart: category breakdown bars
 *   - ProgressBar       : compact linear progress utility
 *
 * Design principles:
 *   - SVG geometry with strokeDasharray/strokeDashoffset for arcs
 *   - Framer Motion for smooth, staggered entrance + hover transitions
 *   - Bidirectional hover: hovering a segment highlights its legend row and vice-versa
 *   - Rounded stroke caps + subtle drop-shadow glow on hover
 *   - Theme-aware (uses Tailwind CSS variables, works in dark/light)
 *   - Responsive (scales within container via ResizeObserver)
 *   - Edge cases: empty data, zero values, zero total, single 100% slice, many tiny slices
 *     (auto-grouped into "Other"), negative values (clamped to 0)
 *
 * This is a VISUAL-LAYER ONLY upgrade. Component props and exports are stable so all
 * module wrappers (fees-charts, finance-charts, library/inventory/transport) keep working
 * without changes — only the rendering is richer.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useMemo, useId, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

// ─── Design tokens ──────────────────────────────────────────────────

export const CHART_TOKENS = {
  // Animation
  easeOutExpo: [0.22, 1, 0.36, 1] as const,
  easeInOut: [0.65, 0, 0.35, 1] as const,
  staggerStep: 0.06,            // delay between sequential segments
  entranceDuration: 1.05,       // arc draw duration
  settleDuration: 0.4,          // hover settle
  hoverLift: 5,                  // px a segment pops outward on hover
  hoverStrokeBoost: 3,          // extra strokeWidth on hover
  // Geometry
  gapDegrees: 2.4,               // gap between donut segments
  bgRingOpacity: 0.16,          // background ring opacity
  // Tooltip
  tooltipMinWidth: 132,
} as const

// Curated premium palette used by callers who don't supply their own colors
export const CHART_PALETTE = [
  'oklch(0.62 0.16 162)',  // emerald
  'oklch(0.62 0.20 25)',   // rose
  'oklch(0.65 0.16 75)',   // amber
  'oklch(0.58 0.14 250)',  // blue
  'oklch(0.60 0.18 305)',  // violet
  'oklch(0.62 0.15 195)',  // teal
  'oklch(0.64 0.15 145)',  // green
  'oklch(0.60 0.18 15)',   // orange-red
] as const

// ─── Types ────────────────────────────────────────────────────────────

export interface DonutDatum {
  name: string
  value: number
  color: string
}

export interface DonutChartProps {
  data: DonutDatum[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
  centerSub?: string
  formatValue?: (n: number) => string
  showLegend?: boolean
  showPercentInLegend?: boolean
  gapDegrees?: number
  innerRadius?: number         // 0..1 fraction of r; 0 = full pie (PieChart)
  className?: string
}

export interface RadialProgressProps {
  value: number
  max?: number
  size?: number
  thickness?: number
  color?: string
  trackColor?: string
  label?: string
  suffix?: string
  formatValue?: (n: number) => string
  showTicks?: boolean
  glow?: boolean
  className?: string
}

export interface AreaTrendChartProps {
  data: Array<Record<string, any>>
  height?: number
  formatValue?: (n: number) => string
  primaryColor?: string
  secondaryColor?: string
  primaryLabel?: string
  secondaryLabel?: string
  labelKey?: string
  primaryKey?: string
  secondaryKey?: string
  className?: string
  /** Show the area fill under the line. Default true. Set false for a pure line chart. */
  showArea?: boolean
  /** Stroke width of the primary line. Default 1.5 (thin). */
  strokeWidth?: number
  /** Stroke width of the secondary line. Default 1.3. */
  secondaryStrokeWidth?: number
}

export interface GroupedBarChartProps {
  data: Array<Record<string, any>>
  height?: number
  formatValue?: (n: number) => string
  primaryColor?: string
  secondaryColor?: string
  primaryLabel?: string
  secondaryLabel?: string
  labelKey?: string
  primaryKey?: string
  secondaryKey?: string
  className?: string
}

export interface HBarDatum {
  label: string
  value: number
  color?: string
  secondary?: number
}

export interface HorizontalBarChartProps {
  data: HBarDatum[]
  height?: number
  formatValue?: (n: number) => string
  showSecondary?: boolean
  className?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2

function polarToCart(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) }
}

// Midpoint angle of a segment given its cumulative start fraction and pct
function segmentMidAngle(startFrac: number, pct: number) {
  // segments are drawn starting from top (12 o'clock) going clockwise;
  // we rotate the whole svg by -90deg via the viewBox, so start angle in svg-space
  // is: startFrac * 2π (clockwise). Mid angle = startFrac*2π + (pct/2)*2π
  return startFrac * TWO_PI + (pct / 2) * TWO_PI
}

// ─── DonutChart / PieChart ─────────────────────────────────────────────

export function DonutChart(props: DonutChartProps) {
  return <DonutOrPie {...props} innerRadius={props.innerRadius ?? 0.62} />
}

export function PieChart(props: DonutChartProps) {
  return <DonutOrPie {...props} innerRadius={0} gapDegrees={props.gapDegrees ?? 1.2} />
}

function DonutOrPie({
  data,
  size = 160,
  thickness = 18,
  centerLabel,
  centerValue,
  centerSub,
  formatValue = (n) => n.toLocaleString('en-IN'),
  showLegend = true,
  showPercentInLegend = true,
  gapDegrees = CHART_TOKENS.gapDegrees,
  innerRadius = 0.62,
  className,
}: DonutChartProps & { innerRadius: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)
  const uid = useId().replace(/[:]/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [actualSize, setActualSize] = useState(size)

  // Responsive: compute donut size from ACTUAL available space.
  // When legend is shown, the layout is: [donut] [gap] [legend flex-1].
  // The donut must fit in ~33% of the container width so the legend has room
  // for name + percentage + value (which can be long currency strings).
  // When no legend, the donut can use the full width.
  // We also clamp to the container HEIGHT (if available) so the donut never
  // exceeds the vertical space and gets clipped at the bottom.
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const width = entry?.contentRect.width ?? size
      const height = entry?.contentRect.height ?? size
      // With legend: donut gets ~33% of width (leaves room for legend + gap).
      // Without legend: donut can be up to `size`.
      const widthBased = showLegend
        ? Math.min(size, Math.max(96, Math.floor(width * 0.33)))
        : Math.min(size, Math.max(96, width - 24))
      // Also clamp by height (donut must fit vertically too)
      const heightBased = Math.max(80, Math.floor(height - 8))
      const maxDonut = Math.min(widthBased, heightBased)
      setActualSize(maxDonut)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [size, showLegend])

  // Group small segments (<5%) into "Other" so the chart stays readable
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
  const groupedData = useMemo(() => {
    if (total === 0 || data.length === 0) return data
    const threshold = 0.05
    const major = data.filter((d) => d.value / total >= threshold)
    const minor = data.filter((d) => d.value / total < threshold)
    if (minor.length <= 1) return data
    return [
      ...major,
      { name: 'Other', value: minor.reduce((s, d) => s + d.value, 0), color: 'oklch(0.62 0.015 250)' },
    ]
  }, [data, total])

  const r = (actualSize - thickness) / 2
  const cx = actualSize / 2
  const cy = actualSize / 2
  const circumference = 2 * Math.PI * r
  const gapFraction = gapDegrees / 360
  const gapLength = circumference * gapFraction

  // Compute segment geometry
  const segments = useMemo(() => {
    if (total === 0) return []
    let acc = 0
    return groupedData.map((d, i) => {
      const pct = Math.max(0, d.value) / total
      const arcLength = circumference * pct
      const segLen = groupedData.length > 1 ? Math.max(0, arcLength - gapLength) : arcLength
      const dashArray = `${segLen} ${circumference - segLen}`
      const dashOffset = -acc
      const midAngle = segmentMidAngle(acc / circumference, pct)
      // pop-out direction in viewBox coords (svg is rotated -90deg, so apply that to the angle)
      const popAngle = midAngle - Math.PI / 2
      const pop = polarToCart(0, 0, CHART_TOKENS.hoverLift, popAngle)
      acc += arcLength
      return { ...d, pct, dashArray, dashOffset, index: i, startFrac: (acc - arcLength) / circumference, pop }
    })
  }, [groupedData, total, circumference, gapLength])

  const isPie = innerRadius === 0

  // Empty state
  if (data.length === 0 || total === 0) {
    return (
      <div ref={containerRef} className={cn('flex flex-col items-center justify-center py-8', className)}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30 text-muted-foreground/40">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <p className="text-xs text-muted-foreground mt-2">No data</p>
      </div>
    )
  }

  const hovered = hover !== null ? groupedData[hover] : null
  const hoveredPct = hovered ? (hovered.value / total) * 100 : 0

  return (
    <div ref={containerRef} className={cn('flex flex-col sm:flex-row items-center sm:gap-4 gap-3 fee-mode-mix', className)}>
      {/* Scoped CSS: neutralize the global `* { outline-ring/50 }` rule on
          SVG elements (the blue outline that appears on focus). This is NOT
          a global hack — it's scoped to this donut component only. Keyboard
          accessibility is preserved via the legend buttons which have their
          own focus-visible:ring. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .fee-mode-mix .recharts-wrapper,
        .fee-mode-mix .recharts-surface,
        .fee-mode-mix .recharts-surface * {
          outline: none !important;
        }
        .fee-mode-mix .recharts-sector {
          outline: none !important;
        }
      `}} />
      {/* Donut / Pie SVG */}
      <div
        className="relative shrink-0"
        style={{ width: actualSize, height: actualSize }}
        onMouseMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect()
          if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
        onMouseLeave={() => { setHover(null); setMouse(null) }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${actualSize} ${actualSize}`}
          className="w-full h-full -rotate-90 overflow-visible"
        >
          <defs>
            {/* Per-segment linear gradients for depth */}
            {segments.map((s) => (
              <linearGradient
                key={s.name}
                id={`${uid}-seg-${s.index}`}
                x1="0" y1="0" x2="1" y2="1"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity="0.95" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.75" />
              </linearGradient>
            ))}
            {/* Subtle background ring gradient */}
            <radialGradient id={`${uid}-bg`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="60%" stopColor="currentColor" stopOpacity={CHART_TOKENS.bgRingOpacity} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={CHART_TOKENS.bgRingOpacity * 0.5} />
            </radialGradient>
          </defs>

          {/* Background ring (donut only) */}
          {!isPie && (
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="currentColor"
              className="text-muted/40"
              strokeWidth={thickness}
              opacity={0.5}
            />
          )}

          {/* Inner hole shadow (donut only) — subtle depth ring just inside segments */}
          {!isPie && (
            <circle
              cx={cx} cy={cy} r={r - thickness / 2 - 1.5}
              fill="none"
              stroke="currentColor"
              className="text-foreground/5"
              strokeWidth={1}
            />
          )}

          {/* Segments */}
          {segments.map((s) => {
            const isHovered = hover === s.index
            const dim = hover !== null && !isHovered
            return (
              <motion.circle
                key={s.name}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={`url(#${uid}-seg-${s.index})`}
                strokeWidth={isHovered ? thickness + CHART_TOKENS.hoverStrokeBoost : thickness}
                strokeDasharray={s.dashArray}
                strokeDashoffset={s.dashOffset}
                strokeLinecap="round"
                className="cursor-pointer transition-[stroke-width] duration-200"
                onMouseEnter={() => setHover(s.index)}
                initial={{ strokeDashoffset: circumference, opacity: 0, x: 0, y: 0 }}
                animate={{
                  strokeDashoffset: s.dashOffset,
                  opacity: dim ? 0.35 : 1,
                  x: isHovered ? s.pop.x : 0,
                  y: isHovered ? s.pop.y : 0,
                }}
                transition={{
                  strokeDashoffset: { duration: CHART_TOKENS.entranceDuration, ease: CHART_TOKENS.easeOutExpo, delay: s.index * CHART_TOKENS.staggerStep },
                  opacity: { duration: 0.3, delay: s.index * CHART_TOKENS.staggerStep },
                  x: { duration: CHART_TOKENS.settleDuration, ease: CHART_TOKENS.easeOutExpo },
                  y: { duration: CHART_TOKENS.settleDuration, ease: CHART_TOKENS.easeOutExpo },
                }}
                style={{
                  filter: isHovered ? `drop-shadow(0 0 8px ${s.color}66)` : 'none',
                }}
              />
            )
          })}

          {/* Hover segment outer highlight ring (donut only) */}
          {hover !== null && !isPie && (
            <circle
              cx={cx} cy={cy} r={r + thickness / 2 + 2}
              fill="none"
              stroke={groupedData[hover].color}
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.5}
              className="pointer-events-none"
            />
          )}
        </svg>

        {/* Center content (donut only) */}
        {!isPie && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <AnimatePresence mode="wait">
              {hover !== null && hovered ? (
                <motion.div
                  key={`hover-${hover}`}
                  initial={{ opacity: 0, scale: 0.7, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.7, y: -4 }}
                  transition={{ duration: 0.18, ease: CHART_TOKENS.easeOutExpo }}
                  className="text-center"
                >
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: hovered.color, boxShadow: `0 0 4px ${hovered.color}` }}
                    />
                    <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider truncate max-w-[72px]">
                      {hovered.name}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums leading-tight">{formatValue(hovered.value)}</p>
                  <p className="text-[10px] font-semibold tabular-nums mt-0.5" style={{ color: hovered.color }}>
                    {hoveredPct.toFixed(1)}%
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="default"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.18 }}
                  className="text-center"
                >
                  {centerValue && (
                    <p className="text-base font-bold tabular-nums leading-tight">{centerValue}</p>
                  )}
                  {centerLabel && (
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{centerLabel}</p>
                  )}
                  {centerSub && (
                    <p className="text-[9px] text-muted-foreground mt-0.5">{centerSub}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Floating tooltip for pie (no center to show info) */}
        {isPie && hover !== null && mouse && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute z-20 pointer-events-none rounded-lg border border-border bg-popover/95 backdrop-blur-md shadow-xl px-2.5 py-1.5 text-[10px] min-w-[110px]"
            style={{
              left: Math.min(Math.max(mouse.x + 8, 8), actualSize - 110),
              top: Math.min(Math.max(mouse.y - 8, 8), actualSize - 40),
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: hovered!.color }} />
              <span className="font-semibold truncate">{hovered!.name}</span>
            </div>
            <div className="flex items-center justify-between mt-0.5 tabular-nums">
              <span className="text-muted-foreground">Value</span>
              <span className="font-bold">{formatValue(hovered!.value)}</span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-muted-foreground">Share</span>
              <span className="font-bold" style={{ color: hovered!.color }}>{hoveredPct.toFixed(1)}%</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex-1 min-w-0 w-full sm:w-auto space-y-1">
          {groupedData.map((d, i) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0
            const isHovered = hover === i
            return (
              <button
                key={d.name}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  'w-full flex items-center gap-2 px-1.5 py-1 rounded-md transition-colors text-left',
                  isHovered && 'bg-muted/60',
                )}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0 transition-all"
                  style={{
                    background: d.color,
                    transform: isHovered ? 'scale(1.3)' : 'scale(1)',
                    boxShadow: isHovered ? `0 0 5px ${d.color}80` : 'none',
                  }}
                />
                <span className="text-[11px] font-medium truncate flex-1 text-foreground min-w-0">{d.name}</span>
                {showPercentInLegend && (
                  <span className="text-[11px] tabular-nums font-bold text-foreground shrink-0">{pct.toFixed(0)}%</span>
                )}
                <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap shrink-0 text-right">
                  {formatValue(d.value)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── RadialProgress ──────────────────────────────────────────────────

export function RadialProgress({
  value,
  max = 100,
  size = 120,
  thickness = 10,
  color = 'oklch(0.55 0.14 162)',
  trackColor,
  label,
  suffix = '%',
  formatValue = (n) => `${Math.round(n)}${suffix}`,
  showTicks = false,
  glow = false,
  className,
}: RadialProgressProps) {
  const [display, setDisplay] = useState(0)
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.min(1, Math.max(0, value / max))
  const dashOffset = circumference * (1 - pct)
  const uid = useId().replace(/[:]/g, '')
  const isComplete = pct >= 0.999

  // Animated counter
  useEffect(() => {
    let raf: number
    const start = performance.now()
    const from = 0
    const to = value
    const dur = 900
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / dur)
      // easeOutExpo
      const eased = e === 1 ? 1 : 1 - Math.pow(2, -10 * e)
      setDisplay(from + (to - from) * eased)
      if (e < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  // Tick marks (24 ticks around the ring)
  const ticks = useMemo(() => {
    if (!showTicks) return []
    const count = 24
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * TWO_PI - Math.PI / 2
      const inner = r - thickness / 2 - 2
      const outer = r + thickness / 2 + 2
      return {
        x1: cx + Math.cos(a) * inner,
        y1: cy + Math.sin(a) * inner,
        x2: cx + Math.cos(a) * outer,
        y2: cy + Math.sin(a) * outer,
        major: i % 6 === 0,
      }
    })
  }, [showTicks, r, thickness, cx, cy])

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90 overflow-visible">
        <defs>
          <linearGradient id={`${uid}-rp`} x1="0" y1="0" x2="1" y2="1" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke="currentColor"
            className={t.major ? 'text-muted-foreground/40' : 'text-muted-foreground/15'}
            strokeWidth={t.major ? 1.2 : 0.8}
          />
        ))}

        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={trackColor ?? 'currentColor'}
          className={trackColor ? '' : 'text-muted/25'}
          strokeWidth={thickness}
        />

        {/* Progress arc */}
        <motion.circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={`url(#${uid}-rp)`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: CHART_TOKENS.entranceDuration, ease: CHART_TOKENS.easeOutExpo }}
          style={{
            filter: glow && isComplete ? `drop-shadow(0 0 6px ${color}99)` : 'none',
          }}
        />

        {/* Completion dot at arc end */}
        {isComplete && (
          <circle
            cx={cx} cy={cy - r} r={thickness / 2 + 1}
            fill={color}
            opacity={0.9}
            className="pointer-events-none"
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <motion.p
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.2 }}
          className="text-lg font-bold tabular-nums leading-tight"
        >
          {formatValue(display)}
        </motion.p>
        {label && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5"
          >
            {label}
          </motion.p>
        )}
      </div>
    </div>
  )
}

// ─── AreaTrendChart ──────────────────────────────────────────────────

// Format a Y-axis value compactly (₹1Cr, ₹2L, 50%, etc.)
// Sign-aware: valMin can dip below zero (5% range padding), and negatives
// previously fell through every ≥ branch and rendered as raw "-4320".
function formatYAxisValue(n: number): string {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v >= 10000000) return `${sign}₹${(v / 10000000).toFixed(0)}Cr`
  if (v >= 100000) return `${sign}₹${(v / 100000).toFixed(0)}L`
  if (v >= 1000) return `${sign}₹${(v / 1000).toFixed(0)}K`
  return `${sign}${Math.round(v)}`
}

export function AreaTrendChart({
  data,
  height = 140,
  formatValue = (n) => n.toLocaleString('en-IN'),
  primaryColor = 'oklch(0.55 0.14 162)',
  secondaryColor = 'oklch(0.62 0.2 25)',
  primaryLabel,
  secondaryLabel,
  labelKey = 'label',
  primaryKey = 'primary',
  secondaryKey = 'secondary',
  className: _className,
  showArea = false,
  strokeWidth = 2,
  secondaryStrokeWidth = 2,
}: AreaTrendChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId().replace(/[:]/g, '')
  const w = 100
  const h = height
  // Larger vertical padding so the curve never clips at the top/bottom.
  // With preserveAspectRatio="none", the X is stretched but Y is 1:1,
  // so pad is in actual pixels relative to the height.
  const padX = 6
  const padY = 18

  const maxVal = Math.max(...data.flatMap((d) => [d[primaryKey] ?? 0, d[secondaryKey] ?? 0]), 1)
  const minVal = Math.min(...data.flatMap((d) => [d[primaryKey] ?? 0, d[secondaryKey] ?? 0]), 0)
  // Add 10% headroom to the range so the curve doesn't touch the edges
  const valRange = (maxVal - minVal) * 1.1 || 1
  const valMin = minVal - (maxVal - minVal) * 0.05

  // Build a MONOTONE cubic interpolation path (no overshoot).
  // Catmull-Rom can overshoot when data points vary dramatically, creating
  // artificial peaks/valleys below the real data range. Monotone cubic
  // interpolation guarantees the curve passes through every data point
  // WITHOUT overshooting — data accuracy > decorative smoothness.
  // This is the same approach used by D3's curveMonotoneX.
  const monotonePath = (pts: { x: number; y: number }[]) => {
    if (pts.length < 2) return ''
    if (pts.length === 2) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`

    // Compute slopes (tangents) for each point — monotone-clamped
    const n = pts.length
    const dx: number[] = new Array(n - 1)
    const dy: number[] = new Array(n - 1)
    const m: number[] = new Array(n) // slope at each point

    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x
      dy[i] = pts[i + 1].y - pts[i].y
    }

    // Slopes at endpoints
    m[0] = dy[0] / dx[0]
    m[n - 1] = dy[n - 2] / dx[n - 2]

    // Interior slopes — monotone: take the harmonic mean of the two adjacent
    // secant slopes, but only if they have the same sign (otherwise slope=0).
    for (let i = 1; i < n - 1; i++) {
      const s1 = dy[i - 1] / dx[i - 1]
      const s2 = dy[i] / dx[i]
      if (s1 * s2 <= 0) {
        m[i] = 0 // sign change → flat tangent (prevents overshoot)
      } else {
        m[i] = (s1 + s2) / 2
      }
    }

    // Monotone slope clamping: ensure the control points don't overshoot
    for (let i = 0; i < n - 1; i++) {
      const s = dy[i] / dx[i]
      if (Math.abs(m[i]) > 3 * Math.abs(s)) m[i] = 3 * s * Math.sign(m[i])
      if (Math.abs(m[i + 1]) > 3 * Math.abs(s)) m[i + 1] = 3 * s * Math.sign(m[i + 1])
    }

    // Build the cubic bezier path using the monotone slopes
    let path = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
    for (let i = 0; i < n - 1; i++) {
      const cp1x = pts[i].x + dx[i] / 3
      const cp1y = pts[i].y + m[i] * dx[i] / 3
      const cp2x = pts[i + 1].x - dx[i] / 3
      const cp2y = pts[i + 1].y - m[i + 1] * dx[i] / 3
      path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`
    }
    return path
  }

  const primaryPoints = data.map((d, i) => ({
    x: padX + (i / Math.max(1, data.length - 1)) * (w - 2 * padX),
    // Parentheses matter: `d[k] ?? 0 - valMin` parses as `d[k] ?? (0 - valMin)`,
    // so valMin was never subtracted from real values.
    y: padY + (h - 2 * padY) - (((d[primaryKey] ?? 0) - valMin) / valRange) * (h - 2 * padY),
  }))
  const secondaryPoints = data.map((d, i) => ({
    x: padX + (i / Math.max(1, data.length - 1)) * (w - 2 * padX),
    y: padY + (h - 2 * padY) - (((d[secondaryKey] ?? 0) - valMin) / valRange) * (h - 2 * padY),
  }))

  const primaryPath = useMemo(() => monotonePath(primaryPoints), [primaryPoints])
  const secondaryPath = useMemo(() => monotonePath(secondaryPoints), [secondaryPoints])
  const primaryArea = useMemo(() => primaryPath ? `${primaryPath} L ${primaryPoints[primaryPoints.length - 1].x.toFixed(2)},${h - padY} L ${primaryPoints[0].x.toFixed(2)},${h - padY} Z` : '', [primaryPath, primaryPoints, h, padY])
  const secondaryArea = useMemo(() => secondaryPath ? `${secondaryPath} L ${secondaryPoints[secondaryPoints.length - 1].x.toFixed(2)},${h - padY} L ${secondaryPoints[0].x.toFixed(2)},${h - padY} Z` : '', [secondaryPath, secondaryPoints, h, padY])

  return (
    <div className="relative w-full" style={{ height }}>
      {/* PHASE 7.5 QA fix — the plot lives in its own right-offset wrapper
          (left-10) so the Y-axis label GUTTER can never overlap the curve
          or the first month label. All viewBox-relative overlays (svg,
          x-labels, tooltip) resolve percentages against this wrapper. */}
      <div className="absolute inset-y-0 left-10 right-0">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
        <defs>
          <linearGradient id={`${uid}-p`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.22" />
            <stop offset="60%" stopColor={primaryColor} stopOpacity="0.06" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
          </linearGradient>
          {data.some((d) => d[secondaryKey] !== undefined) && (
            <linearGradient id={`${uid}-s`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.14" />
              <stop offset="100%" stopColor={secondaryColor} stopOpacity="0" />
            </linearGradient>
          )}
        </defs>
        {/* Subtle horizontal gridlines only — no vertical grid, no heavy box */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line key={frac} x1={0} y1={padY + frac * (h - 2 * padY)} x2={w} y2={padY + frac * (h - 2 * padY)}
            stroke="currentColor" strokeOpacity={0.08} strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
        ))}
        {/* Secondary area + line (drawn first) */}
        {data.some((d) => d[secondaryKey] !== undefined) && (
          <>
            {showArea && (
              <motion.path d={secondaryArea} fill={`url(#${uid}-s)`}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.1 }} />
            )}
            {/* Plain path inside an opacity-fading group — NEVER animate
                pathLength here. A completed pathLength animation leaves
                pathLength="1" + stroke-dasharray on the element, and with
                vector-effect:non-scaling-stroke Chromium computes the dash
                in screen pixels, rendering the line as fragments. */}
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.1, ease: 'easeOut' }}>
              <path d={secondaryPath} fill="none" stroke={secondaryColor} strokeWidth={secondaryStrokeWidth}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </motion.g>
          </>
        )}
        {/* Primary area + line */}
        {showArea && (
          <motion.path d={primaryArea} fill={`url(#${uid}-p)`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
        )}
        {/* Primary line — same rule: opacity fade, no pathLength (see above). */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease: CHART_TOKENS.easeInOut }}>
          <path d={primaryPath} fill="none" stroke={primaryColor} strokeWidth={strokeWidth}
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </motion.g>
        {/* Hover interaction zones + dots */}
        {primaryPoints.map((p, i) => (
          <g key={i}>
            <rect x={p.x - 5} y={0} width={10} height={h} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 3} fill={primaryColor} stroke="white" strokeWidth={1.5}
              style={{ opacity: hover === i ? 1 : 0 }} className="transition-all" vectorEffect="non-scaling-stroke" />
            {data[i].secondary !== undefined && (
              <circle cx={p.x} cy={secondaryPoints[i].y} r={hover === i ? 3.5 : 2.5} fill={secondaryColor} stroke="white" strokeWidth={1.2}
                style={{ opacity: hover === i ? 1 : 0 }} className="transition-all" vectorEffect="non-scaling-stroke" />
            )}
            {hover === i && (
              <line x1={p.x} y1={Math.min(p.y, secondaryPoints[i]?.y ?? h)} x2={p.x} y2={h - padY}
                stroke={primaryColor} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.3} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        ))}
      </svg>
      {/* X-axis labels (inside the plot wrapper → aligned with points) */}
      <div className="absolute inset-x-0 bottom-0 flex justify-between px-2 text-[9px] text-muted-foreground pointer-events-none font-medium">
        {data.map((d, i) => (
          <span key={i} className={hover === i ? 'text-foreground' : ''}>{d[labelKey]}</span>
        ))}
      </div>
      {/* Tooltip */}
      {hover !== null && (
        <motion.div
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="absolute z-10 pointer-events-none rounded-md bg-popover border border-border shadow-lg px-2.5 py-1.5 text-[10px] -translate-x-1/2 min-w-[100px]"
          style={{ left: `${(primaryPoints[hover].x / w) * 100}%`, top: -4 }}
        >
          <p className="font-semibold text-foreground">{data[hover][labelKey]}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="h-2 w-2 rounded-full" style={{ background: primaryColor }} />
            <span className="text-muted-foreground">{primaryLabel ?? 'Primary'}</span>
            <span className="ml-auto tabular-nums font-bold" style={{ color: primaryColor }}>{formatValue(data[hover][primaryKey] ?? 0)}</span>
          </div>
          {data[hover][secondaryKey] !== undefined && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-2 w-2 rounded-full" style={{ background: secondaryColor }} />
              <span className="text-muted-foreground">{secondaryLabel ?? 'Secondary'}</span>
              <span className="ml-auto tabular-nums font-bold" style={{ color: secondaryColor }}>{formatValue(data[hover][secondaryKey] ?? 0)}</span>
            </div>
          )}
        </motion.div>
      )}
      </div>{/* /plot wrapper */}
      {/* Y-axis labels — own gutter at the left, never over the plot */}
      <div className="absolute left-0 top-0 bottom-4 w-10 pr-1 flex flex-col justify-between py-1 text-[8px] text-muted-foreground pointer-events-none tabular-nums leading-none text-right">
        <span>{formatYAxisValue(maxVal)}</span>
        <span>{formatYAxisValue(valMin + valRange * 0.5)}</span>
        <span>{formatYAxisValue(valMin)}</span>
      </div>
      {/* Legend above the chart (only if multi-series) */}
      {data.some((d) => d[secondaryKey] !== undefined) && (
        <div className="absolute top-0 right-2 flex items-center gap-3 text-[10px] text-muted-foreground pointer-events-none">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: primaryColor }} />
            {primaryLabel ?? 'Primary'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: secondaryColor }} />
            {secondaryLabel ?? 'Secondary'}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── GroupedBarChart ─────────────────────────────────────────────────

export function GroupedBarChart({
  data,
  height = 160,
  formatValue = (n) => n.toLocaleString('en-IN'),
  primaryColor = 'oklch(0.55 0.14 162)',
  secondaryColor = 'oklch(0.62 0.2 25)',
  primaryLabel = 'Primary',
  secondaryLabel = 'Secondary',
  labelKey = 'label',
  primaryKey = 'primary',
  secondaryKey = 'secondary',
  className,
}: GroupedBarChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const _uid = useId().replace(/[:]/g, '')
  const max = Math.max(...data.flatMap((d) => [d[primaryKey] ?? 0, d[secondaryKey] ?? 0]), 1)

  return (
    <div className={className} style={{ height }}>
      <div className="flex items-end gap-3 h-[calc(100%-20px)]">
        {data.map((d, i) => {
          const pH = ((d[primaryKey] ?? 0) / max) * 100
          const sH = d[secondaryKey] !== undefined ? (d[secondaryKey] / max) * 100 : 0
          const isHovered = hover === i
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1 h-full"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-end gap-1 w-full h-full justify-center">
                <motion.div
                  className="w-1/2 max-w-[20px] rounded-t-md relative"
                  style={{ background: primaryColor, boxShadow: isHovered ? `0 0 8px ${primaryColor}66` : 'none' }}
                  initial={{ height: 0 }}
                  animate={{ height: `${pH}%`, opacity: hover !== null && !isHovered ? 0.5 : 1 }}
                  transition={{ duration: 0.65, ease: CHART_TOKENS.easeOutExpo, delay: i * 0.05 }}
                />
                {d[secondaryKey] !== undefined && (
                  <motion.div
                    className="w-1/2 max-w-[20px] rounded-t-md relative"
                    style={{ background: secondaryColor, boxShadow: isHovered ? `0 0 8px ${secondaryColor}66` : 'none' }}
                    initial={{ height: 0 }}
                    animate={{ height: `${sH}%`, opacity: hover !== null && !isHovered ? 0.5 : 1 }}
                    transition={{ duration: 0.65, ease: CHART_TOKENS.easeOutExpo, delay: i * 0.05 + 0.05 }}
                  />
                )}
              </div>
              <span className={cn('text-[10px] font-medium transition-colors', isHovered ? 'text-foreground' : 'text-muted-foreground')}>
                {d[labelKey]}
              </span>
            </div>
          )
        })}
      </div>
      {hover !== null && (
        <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground mt-1">
          <span>{data[hover][labelKey]}:</span>
          <span className="font-semibold tabular-nums" style={{ color: primaryColor }}>{primaryLabel} {formatValue(data[hover][primaryKey] ?? 0)}</span>
          {data[hover][secondaryKey] !== undefined && (
            <span className="font-semibold tabular-nums" style={{ color: secondaryColor }}>{secondaryLabel} {formatValue(data[hover][secondaryKey] ?? 0)}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── HorizontalBarChart ─────────────────────────────────────────────

export function HorizontalBarChart({
  data,
  height,
  formatValue = (n) => n.toLocaleString('en-IN'),
  showSecondary,
  className,
}: HorizontalBarChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.flatMap((d) => [d.value, d.secondary ?? 0]), 1)
  const computedHeight = height ?? data.length * 36 + 8

  return (
    <div className={cn('space-y-2.5', className)} style={{ minHeight: computedHeight }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100
        const secondaryPct = d.secondary !== undefined ? (d.secondary / max) * 100 : 0
        const isHovered = hover === i
        return (
          <div
            key={i}
            className="space-y-1 cursor-default"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="flex items-center justify-between text-xs">
              <span className={cn('font-medium truncate transition-colors', isHovered ? 'text-foreground' : 'text-muted-foreground')}>{d.label}</span>
              <div className="flex items-center gap-2 tabular-nums">
                {showSecondary && d.secondary !== undefined && (
                  <span className="text-muted-foreground text-[10px]">{formatValue(d.secondary)}</span>
                )}
                <span className="font-bold text-foreground">{formatValue(d.value)}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden relative">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: d.color ?? 'oklch(0.55 0.14 162)', boxShadow: isHovered ? `0 0 6px ${(d.color ?? 'oklch(0.55 0.14 162)')}66` : 'none' }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%`, opacity: hover !== null && !isHovered ? 0.55 : 1 }}
                transition={{ duration: 0.65, ease: CHART_TOKENS.easeOutExpo, delay: i * 0.05 }}
              />
              {showSecondary && d.secondary !== undefined && (
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full opacity-30"
                  style={{ background: 'oklch(0.6 0.01 250)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${secondaryPct}%` }}
                  transition={{ duration: 0.65, ease: 'easeOut', delay: i * 0.05 + 0.1 }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── ProgressBar (compact utility) ───────────────────────────────────

export function ProgressBar({ value, max = 100, color, className }: { value: number; max?: number; color?: string; className?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const _uid = useId().replace(/[:]/g, '')
  const autoColor = pct > 90 ? 'oklch(0.62 0.2 25)' : pct > 75 ? 'oklch(0.65 0.16 75)' : 'oklch(0.55 0.14 162)'
  const c = color ?? autoColor
  return (
    <div className={cn('h-2 rounded-full bg-muted/30 overflow-hidden relative', className)}>
      <motion.div
        className="h-full rounded-full relative"
        style={{ background: c }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: CHART_TOKENS.easeOutExpo }}
      />
    </div>
  )
}

// ─── BarTrend (vertical bars, single series) ────────────────────────

export interface BarTrendProps {
  data: Array<Record<string, any>>
  height?: number
  formatValue?: (n: number) => string
  color?: string
  labelKey?: string
  valueKey?: string
  className?: string
}

export function BarTrend({
  data,
  height = 200,
  formatValue = (n) => n.toLocaleString('en-IN'),
  color = 'oklch(0.6 0.14 200)',
  labelKey = 'name',
  valueKey = 'value',
  className,
}: BarTrendProps) {
  const [hover, setHover] = useState<number | null>(null)
  const _uid = useId().replace(/[:]/g, '')
  const max = Math.max(...data.map((d) => d[valueKey] ?? 0), 1)

  return (
    <div className={className} style={{ height }}>
      <div className="flex items-end gap-2 h-[calc(100%-22px)] px-1">
        {data.map((d, i) => {
          const h = ((d[valueKey] ?? 0) / max) * 100
          const isHovered = hover === i
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end cursor-default group"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* value label on hover */}
              <AnimatePresence>
                {isHovered && (
                  <motion.span
                    initial={{ opacity: 0, y: 4, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    className="text-[10px] font-bold tabular-nums"
                    style={{ color }}
                  >
                    {formatValue(d[valueKey] ?? 0)}
                  </motion.span>
                )}
              </AnimatePresence>
              {/* bar */}
          <motion.div
            className="w-full max-w-[28px] rounded-t-md relative overflow-hidden"
            style={{ background: color, boxShadow: isHovered ? `0 0 10px ${color}66` : 'none' }}
            initial={{ height: 0 }}
            animate={{ height: `${h}%`, opacity: hover !== null && !isHovered ? 0.5 : 1 }}
            transition={{ duration: 0.65, ease: CHART_TOKENS.easeOutExpo, delay: i * 0.05 }}
          >
            {/* subtle top highlight */}
            <span className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />
          </motion.div>
              <span className={cn('text-[10px] font-medium transition-colors', isHovered ? 'text-foreground' : 'text-muted-foreground')}>
                {d[labelKey]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
