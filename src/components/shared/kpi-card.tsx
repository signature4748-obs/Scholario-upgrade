'use client'

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedCounter } from './animated-counter'
// PERF (5-e): direct module import (not the charts barrel) — MiniLine
// is the only recharts-based chart KpiCard needs; importing it directly
// keeps modules that use KpiCard scoped to recharts while the barrel
// itself stays recharts-free for premium-chart-only consumers.
import { MiniLine } from './charts/legacy-circular'

export interface KpiProps {
  label: string
  /** Number (animated counter) or a pre-formatted display string ("7 · 4", "—"). */
  value: number | string
  prefix?: string
  suffix?: string
  decimals?: number
  format?: (n: number) => string
  icon: React.ReactNode
  trend?: number
  trendLabel?: string
  sparkline?: any[]
  sparkKey?: string
  sparkColor?: string
  /** Accepted for API compatibility — the icon chip is token-driven
   *  (bg-primary/10 text-primary) since the neutral-premium restyle. */
  accent?: 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan' | 'sky'
  delay?: number
}

export function KpiCard({
  label, value, prefix, suffix, decimals, format, icon, trend, trendLabel,
  sparkline, sparkKey, sparkColor, delay = 0,
}: KpiProps) {
  const trendUp = (trend ?? 0) >= 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="group relative bg-white dark:bg-card rounded-xl p-3 sm:p-3.5 border border-border/80 shadow-2xs hover:shadow-xs transition-all overflow-hidden"
    >
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs shrink-0">
          {icon}
        </div>
        {trend != null && (
          <div className={cn('flex items-center gap-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-semibold shrink-0', trendUp ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400')}>
            {trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>

      <div className="relative mt-2">
        <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">{label}</p>
        <p className="font-display text-lg sm:text-xl lg:text-2xl font-bold tracking-tight text-foreground leading-tight mt-0.5">
          {typeof value === 'number' ? (
            <AnimatedCounter value={value} prefix={prefix} suffix={suffix} decimals={decimals} format={format} />
          ) : (
            value
          )}
        </p>
        {trendLabel && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{trendLabel}</p>}
      </div>

      {sparkline && sparkKey && (
        <div className="relative mt-1.5 -mx-1 -mb-1 h-8 opacity-70">
          <MiniLine data={sparkline} xKey="name" yKey={sparkKey} color={sparkColor ?? 'var(--primary)'} height={32} />
        </div>
      )}
    </motion.div>
  )
}
