'use client'

/**
 * EnterpriseDonut — restrained, precise donut chart for Scholario analytics.
 *
 * ONE reusable presentation shared across modules (Library · Category
 * Distribution, Transport · Route Distribution). Callers pass data only —
 * no colours, no layout, no per-module chart variants:
 *
 *   <EnterpriseDonut
 *     data={items.map((c) => ({ name: c.name, value: c.value }))}
 *     centerValue="213"
 *     centerLabel="Total"
 *   />
 *
 * Design language (deliberately restrained — premium ≠ colourful):
 *   - flat, muted, harmonious segment fills — no gradients, no glow,
 *     no shadows, no 3D, no decorative effects
 *   - annular sector paths: perfectly circular geometry, consistent ring
 *     thickness, exact proportional angles, subtle separators (thin
 *     angular gaps that reveal the card surface), no markers on the ring
 *   - refined centre: total number + small uppercase metric label
 *   - cohesive legend: colour indicator · name · percentage · count with
 *     right-aligned numeric columns, graceful truncation, and two-way
 *     hover/focus sync with the ring
 *   - responsive: ring and legend sit side-by-side ≥ sm, and intelligently
 *     stack (ring centred above full-width legend) below sm
 *   - edge cases: empty data, zero total, zero-value entries, tiny
 *     segments (separator collapses instead of inverting), single
 *     category (clean uninterrupted ring)
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

// Muted, harmonious, professional palette. The chart must never become the
// most colourful element on the page — every hue is desaturated so the ring
// reads as structure, not decoration. Assigned by data index so both
// consuming modules render with the identical, consistent treatment.
const MUTED_PALETTE = [
  'oklch(0.52 0.08 165)', // sage
  'oklch(0.62 0.09 75)',  // muted amber
  'oklch(0.50 0.08 245)', // slate
  'oklch(0.52 0.08 310)', // plum
  'oklch(0.55 0.07 200)', // teal
  'oklch(0.56 0.09 30)',  // clay
  'oklch(0.50 0.07 130)', // moss
  'oklch(0.52 0.02 250)', // neutral
] as const

export interface EnterpriseDonutDatum {
  name: string
  value: number
}

export interface EnterpriseDonutProps {
  data: EnterpriseDonutDatum[]
  /** Total number shown in the ring centre. */
  centerValue?: string
  /** Small uppercase metric label under the centre number (e.g. "Students"). */
  centerLabel?: string
  /** Outer box size of the ring in px. Default 168. */
  size?: number
  /** Ring thickness in px — consistent for every segment. Default 22. */
  thickness?: number
  /** Angular separator between segments, in degrees. Default 3. */
  gap?: number
  formatValue?: (n: number) => string
  className?: string
}

const TWO_PI = Math.PI * 2

function polar(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

/** Annular sector path — flat ends, clockwise sweep, crisp enterprise geometry. */
function annularSector(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const largeArc = end - start > Math.PI ? 1 : 0
  const p1 = polar(cx, cy, rOuter, start)
  const p2 = polar(cx, cy, rOuter, end)
  const p3 = polar(cx, cy, rInner, end)
  const p4 = polar(cx, cy, rInner, start)
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ')
}

export function EnterpriseDonut({
  data,
  centerValue,
  centerLabel,
  size = 168,
  thickness = 22,
  gap = 3,
  formatValue = (n) => n.toLocaleString('en-IN'),
  className,
}: EnterpriseDonutProps) {
  const [hover, setHover] = useState<number | null>(null)

  const total = useMemo(
    () => data.reduce((s, d) => s + Math.max(0, d.value), 0),
    [data],
  )

  // Segment geometry — exact proportional angles from 12 o'clock, clockwise.
  const segments = useMemo(() => {
    if (total <= 0) return []
    let acc = 0
    return data.map((d, i) => {
      const frac = Math.max(0, d.value) / total
      const start = acc * TWO_PI - Math.PI / 2
      acc += frac
      const end = acc * TWO_PI - Math.PI / 2
      const span = end - start
      // Subtle separator: half the gap on each side, clamped so a very
      // small segment never inverts — its separator simply collapses.
      const halfGap = Math.min((gap * Math.PI) / 360, span * 0.4)
      return {
        ...d,
        index: i,
        pct: frac * 100,
        color: MUTED_PALETTE[i % MUTED_PALETTE.length],
        start: start + halfGap,
        end: end - halfGap,
      }
    })
  }, [data, total, gap])

  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2 - 1
  const rInner = rOuter - thickness
  const single = segments.length === 1

  // Empty state — clean, quiet, honest.
  if (segments.length === 0 || total <= 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8', className)}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-muted-foreground/50"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v6" />
          </svg>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">No data to chart</p>
      </div>
    )
  }

  const hovered = hover !== null ? segments[hover] : null

  return (
    <div className={cn('flex flex-col items-center gap-5 sm:flex-row sm:gap-6', className)}>
      {/* Ring */}
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        onMouseLeave={() => setHover(null)}
      >
        {/* The legend buttons carry the full data (name · % · count) for
            assistive technology, so the SVG itself stays decorative. */}
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="block"
          shapeRendering="geometricPrecision"
          aria-hidden="true"
        >
          {single ? (
            // One category — a clean, uninterrupted ring.
            <motion.circle
              cx={cx}
              cy={cy}
              r={(rOuter + rInner) / 2}
              fill="none"
              stroke={segments[0].color}
              strokeWidth={thickness}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            />
          ) : (
            segments.map((s) => {
              const dim = hover !== null && hover !== s.index
              return (
                <motion.path
                  key={`${s.name}-${s.index}`}
                  d={annularSector(cx, cy, rOuter, rInner, s.start, s.end)}
                  fill={s.color}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(s.index)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: dim ? 0.3 : 1 }}
                  transition={{
                    opacity: hover === null
                      ? { duration: 0.45, delay: s.index * 0.04, ease: [0.22, 1, 0.36, 1] }
                      : { duration: 0.18 },
                  }}
                />
              )
            })
          )}
        </svg>

        {/* Centre — refined total, or the hovered category's readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {hovered ? (
              <motion.div
                key={`hover-${hovered.index}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.15 }}
                className="flex max-w-full flex-col items-center px-4"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                    style={{ background: hovered.color }}
                  />
                  <span className="max-w-[96px] truncate text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {hovered.name}
                  </span>
                </span>
                <span className="mt-1 text-lg font-semibold leading-none tabular-nums text-foreground">
                  {formatValue(hovered.value)}
                </span>
                <span className="mt-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {Math.round(hovered.pct)}%
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="total"
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center"
              >
                {centerValue && (
                  <span className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                    {centerValue}
                  </span>
                )}
                {centerLabel && (
                  <span className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {centerLabel}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Legend — colour indicator · name · percentage · count */}
      <div className="w-full min-w-0 space-y-px sm:flex-1">
        {segments.map((s) => {
          const isHovered = hover === s.index
          return (
            <button
              key={`${s.name}-legend-${s.index}`}
              type="button"
              onMouseEnter={() => setHover(s.index)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.index)}
              onBlur={() => setHover(null)}
              title={`${s.name} — ${Math.round(s.pct)}% · ${formatValue(s.value)}`}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                'focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isHovered ? 'bg-muted/60' : 'hover:bg-muted/40',
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-[2px] transition-opacity"
                style={{
                  background: s.color,
                  opacity: hover !== null && !isHovered ? 0.4 : 1,
                }}
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {s.name}
              </span>
              <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground/75">
                {Math.round(s.pct)}%
              </span>
              <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {formatValue(s.value)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
