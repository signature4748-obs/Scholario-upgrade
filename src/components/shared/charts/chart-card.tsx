'use client'

/* ============================================================
   charts/chart-card.tsx
   ChartCard — premium chart container wrapper.

   PERF (5-e): split out of legacy.tsx verbatim. ChartCard uses NO
   recharts primitives, but living in legacy.tsx meant every module
   importing the charts barrel pulled the whole recharts runtime into
   its chunk even when it only used premium SVG charts (RadialGauge,
   ProgressBar, AreaTrend…). The barrel now re-exports from HERE, so
   barrel consumers stay recharts-free; modules that genuinely render
   recharts (fees/attendance area charts, KpiCard sparklines) import
   their recharts-based components directly.
   ============================================================ */

import { GlassCard } from '../ui'
import { cn } from '@/lib/utils'

/* ============================================================
   ChartCard — premium container
   ============================================================ */
interface ChartCardProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  height?: number
}

export function ChartCard({ title, subtitle, action, children, className, height = 280 }: ChartCardProps) {
  return (
    <GlassCard className={cn('chart-card-premium p-3 sm:p-4 lg:p-5', className)}>
      {/* top accent hairline */}
      <span className="chart-card-accent" aria-hidden />
      <div className="flex items-start justify-between mb-3 sm:mb-4 gap-2">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-xs sm:text-sm tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-1">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ height }} className="w-full">{children}</div>
      <style jsx>{`
        .chart-card-premium {
          position: relative;
          overflow: hidden;
        }
        .chart-card-premium::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background: radial-gradient(120% 80% at 100% 0%, var(--primary) 0%, transparent 60%);
          opacity: 0.035;
        }
        .dark .chart-card-premium::after { opacity: 0.06; }
        .chart-card-accent {
          position: absolute;
          top: 0;
          left: 14%;
          right: 14%;
          height: 1.5px;
          background: linear-gradient(90deg, transparent, var(--primary), transparent);
          opacity: 0.5;
          border-radius: 999px;
        }
      `}</style>
    </GlassCard>
  )
}
