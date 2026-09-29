'use client'

/**
 * class-hub/growth-drawer — the CLASS-SCOPED growth detail (spec §20–§22).
 * Opened from My Class's Class Growth section, it NEVER leaves the My
 * Class context (never the global Student Growth module): the class
 * average, the improving / steady / attention bands, the 8-week class
 * trend, top improvers, students needing attention and the full class
 * list with canonical scores — all from the SAME growth engine payload
 * the hub already loaded (detail.directory + detail.growthTrend). No
 * second scoring formula, no second data fetch.
 */

import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react'
import { GradientAvatar } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import type { ClassHubClass, HubDetailPayload } from './types'

/** The engine's band rule, mirrored client-side for display only (the
 *  authoritative counts come from the server payload). */
function bandOf(score: number | null, monthDelta: number): 'IMPROVING' | 'STEADY' | 'NEEDS_ATTENTION' | 'BUILDING' {
  if (score == null) return 'BUILDING'
  if (score < 55 || monthDelta <= -4) return 'NEEDS_ATTENTION'
  if (monthDelta >= 3) return 'IMPROVING'
  return 'STEADY'
}

const BAND_META: Record<ReturnType<typeof bandOf>, { label: string; chip: string }> = {
  IMPROVING: { label: 'Improving', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  STEADY: { label: 'Steady', chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  NEEDS_ATTENTION: { label: 'Needs attention', chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  BUILDING: { label: 'Building', chip: 'bg-muted text-muted-foreground' },
}

export function GrowthDrawer({
  open,
  onOpenChange,
  cls,
  detail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  cls: ClassHubClass
  detail: HubDetailPayload | null
}) {
  const isMobile = useIsMobile()
  const g = cls.growth
  const trend = detail?.growthTrend ?? []

  const rows = useMemo(() => detail?.directory ?? [], [detail])
  const topImproving = useMemo(
    () =>
      rows
        .filter((r) => r.growthMonthDelta > 0)
        .sort((a, b) => b.growthMonthDelta - a.growthMonthDelta)
        .slice(0, 3),
    [rows],
  )
  const needsAttention = useMemo(
    () =>
      rows
        .filter((r) => bandOf(r.growthScore, r.growthMonthDelta) === 'NEEDS_ATTENTION')
        .sort((a, b) => (a.growthScore ?? 0) - (b.growthScore ?? 0))
        .slice(0, 5),
    [rows],
  )

  const body = (
    <div className="space-y-5">
      {/* headline + bands (§22) */}
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-border bg-border/50">
        <BandTile label="Class avg" value={g.average != null ? String(g.average) : '—'} tone="text-emerald-600 dark:text-emerald-400" />
        <BandTile label="Improving" value={g.improving} tone="text-emerald-600 dark:text-emerald-400" />
        <BandTile label="Steady" value={g.steady} tone="text-amber-600 dark:text-amber-400" />
        <BandTile label="Attention" value={g.needsAttention} tone="text-rose-600 dark:text-rose-400" />
      </div>
      <p className="-mt-2.5 text-[11px] text-muted-foreground">
        {g.scoredCount} of {cls.studentCount} students scored
        {g.building > 0 && ` · ${g.building} still building`}
        {g.monthPoints !== 0 && ` · ${g.monthPoints > 0 ? '+' : ''}${g.monthPoints} ledger points this month`}
      </p>

      {/* 8-week class trend (§22) */}
      {trend.length > 1 && (
        <section aria-label="Class growth trend">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            8-week class trend
          </h4>
          <div className="flex items-end gap-1.5">
            {trend.map((p) => (
              <div
                key={p.label}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
                title={`${p.label} — ${p.value != null ? p.value : 'no data'}`}
              >
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {p.value != null ? p.value : '·'}
                </span>
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className={cn(
                      'w-full max-w-7 rounded-t-md',
                      p.value == null ? 'bg-muted' : p.value >= 75 ? 'bg-emerald-500' : p.value >= 55 ? 'bg-amber-500' : 'bg-rose-500',
                    )}
                    style={{ height: `${p.value != null ? Math.max(p.value, 4) : 4}%` }}
                  />
                </div>
                <span className="truncate text-[10px] font-medium text-muted-foreground">{p.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* top improving + needs attention (§22) */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Top improvement
          </h4>
          {topImproving.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">No net gains this month yet.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {topImproving.map((r) => (
                <li key={r.studentId} className="flex items-center gap-2.5 py-2">
                  <GradientAvatar name={r.name} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold">{r.name}</p>
                  <span className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{r.growthMonthDelta}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ArrowDownRight className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" /> Needs attention
          </h4>
          {needsAttention.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">None — every scored student is steady or improving.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {needsAttention.map((r) => (
                <li key={r.studentId} className="flex items-center gap-2.5 py-2">
                  <GradientAvatar name={r.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.growthScore != null ? `score ${r.growthScore}` : 'building'}
                      {r.growthMonthDelta < 0 && ` · ${r.growthMonthDelta} this month`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* the full class list (§22 — "the detailed view can show the full
          class list") */}
      <section aria-label="Class growth list">
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Class list · canonical scores
        </h4>
        <ul className="divide-y divide-border/50">
          {[...rows]
            .sort((a, b) => (b.growthScore ?? -1) - (a.growthScore ?? -1))
            .map((r) => {
              const band = bandOf(r.growthScore, r.growthMonthDelta)
              return (
                <li key={r.studentId} className="flex items-center gap-2.5 py-2">
                  <GradientAvatar name={r.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">Roll {r.rollNo ?? '—'}</p>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', BAND_META[band].chip)}>
                    {BAND_META[band].label}
                  </span>
                  <span className="w-8 text-right text-xs font-bold tabular-nums">
                    {r.growthScore != null ? r.growthScore : '—'}
                  </span>
                </li>
              )
            })}
        </ul>
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Growth is the normalized 0–100 score from the canonical engine (academics, attendance, conduct, participation,
        consistency, improvement) — a different concept from exam rankings, never mixed.
      </p>
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[88dvh] rounded-t-2xl">
          <DrawerTitle className="flex items-center gap-2 px-4 pb-1.5 pt-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {cls.label} · Class Growth
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Class-scoped growth detail — average, bands, 8-week trend and the full class list.
          </DrawerDescription>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {cls.label} · Class Growth
          </SheetTitle>
          <SheetDescription className="text-xs">
            Class-scoped growth detail — average, bands, 8-week trend and the full class list.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

function BandTile({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="bg-card px-2 py-2.5 text-center">
      <p className={cn('font-display text-lg font-bold tabular-nums', tone)}>{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
