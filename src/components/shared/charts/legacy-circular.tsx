'use client'

/* ============================================================
   charts/legacy-circular.tsx
   Recharts-based premium radial / sparkline / progress charts.
   - Donut       : premium segmented ring with rounded corners
   - MiniLine    : premium sparkline with gradient + end dot
   - RadialGauge : premium gauge with gradient arc + rounded cap
   - ProgressBar : premium gradient bar with shimmer + glow
   ============================================================ */

import { useId } from 'react'
import { motion } from 'framer-motion'
import {
  Area, AreaChart, Cell, Pie, PieChart, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { cn } from '@/lib/utils'
import { PremiumTooltip } from './utils'

/* ============================================================
   Donut — premium segmented ring with rounded corners
   ============================================================ */
interface DonutProps {
  data: { name: string; value: number; color: string }[]
  height?: number
  innerRadius?: number
  outerRadius?: number
  centerLabel?: string
  centerValue?: string
}

export function Donut({ data, height = 240, innerRadius = 60, outerRadius = 90, centerLabel, centerValue }: DonutProps) {
  const uid = useId().replace(/:/g, '')
  return (
    <div className="relative donut-premium">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <defs>
            <filter id={`donut-shadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation={6} result="blur" />
              <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.12 0" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={4}
            cornerRadius={8}
            stroke="none"
            isAnimationActive
            animationDuration={950}
            animationEasing="ease-out"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<PremiumTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && (
            <span className="font-display text-2xl font-bold tracking-tight bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
              {centerValue}
            </span>
          )}
          {centerLabel && <span className="text-[11px] text-muted-foreground mt-0.5">{centerLabel}</span>}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   MiniLine — premium sparkline with gradient + end dot
   ============================================================ */
interface MiniLineProps {
  data: any[]
  xKey: string
  yKey: string
  color?: string
  height?: number
}

export function MiniLine({ data, xKey: _xKey, yKey, color = 'oklch(0.55 0.14 162)', height = 60 }: MiniLineProps) {
  const uid = useId().replace(/:/g, '')
  const gid = `mini-${uid}`
  const lastIdx = data.length - 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 6, left: 6, bottom: 4 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gid})`}
          isAnimationActive
          animationDuration={700}
          dot={(props: any) => {
            if (props.index !== lastIdx) return <g key={props.index} />
            const { cx, cy } = props
            return (
              <g key={props.index}>
                <circle cx={cx} cy={cy} r={4.5} fill={color} opacity={0.25} />
                <circle cx={cx} cy={cy} r={2.5} fill="var(--popover)" stroke={color} strokeWidth={1.5} />
              </g>
            )
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ============================================================
   RadialGauge — premium gauge with gradient arc + rounded cap
   ============================================================ */
interface RadialGaugeProps {
  value: number
  max?: number
  color?: string
  label?: string
  size?: number
}

export function RadialGauge({ value, max = 100, color = 'oklch(0.55 0.14 162)', label, size = 160 }: RadialGaugeProps) {
  const uid = useId().replace(/:/g, '')
  const gid = `gauge-${uid}`
  const data = [{ name: 'value', value, fill: `url(#${gid})` }]
  const responsiveSize = typeof window !== 'undefined' && window.innerWidth < 640 ? Math.min(size, 130) : size
  return (
    <div className="relative" style={{ width: responsiveSize, height: responsiveSize, maxWidth: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={90 - (value / max) * 360}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.7} />
              <stop offset="100%" stopColor={color} stopOpacity={1} />
            </linearGradient>
          </defs>
          <RadialBar
            background={{ fill: 'var(--muted)', opacity: 0.6 }}
            dataKey="value"
            cornerRadius={20}
            isAnimationActive
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </RadialBarChart>
      </ResponsiveContainer>
      {/* subtle inner ring */}
      <div
        className="absolute inset-[18%] rounded-full pointer-events-none"
        style={{ boxShadow: 'inset 0 0 0 1px var(--border), inset 0 2px 8px rgba(0,0,0,0.04)' }}
        aria-hidden
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-display text-2xl font-bold tracking-tight">{value}%</span>
        {label && <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>}
      </div>
    </div>
  )
}

/* ============================================================
   ProgressBar — premium gradient bar with shimmer + glow
   ============================================================ */
interface ProgressBarProps {
  value: number
  max?: number
  color?: string
  height?: number
  className?: string
}

export function ProgressBar({ value, max = 100, color = 'var(--primary)', height = 8, className }: ProgressBarProps) {
  const pct = Math.min(100, (value / max) * 100)
  const uid = useId().replace(/:/g, '')
  return (
    <div
      className={cn('relative w-full rounded-full overflow-hidden bg-muted/70', className)}
      style={{ height }}
    >
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="relative h-full rounded-full overflow-hidden"
        style={{ background: color }}
      >
        {/* sheen overlay */}
        <span className="progress-sheen" aria-hidden />
        <style jsx>{`
          .progress-sheen {
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
            background-size: 200% 100%;
            animation: progress-sheen-${uid} 2.2s ease-in-out infinite;
          }
          @keyframes progress-sheen-${uid} {
            0% { background-position: -150% 0; }
            60%, 100% { background-position: 250% 0; }
          }
        `}</style>
      </motion.div>
    </div>
  )
}
