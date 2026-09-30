'use client'

/**
 * BusTrackingModule — Student Transport (7-b honest rewrite).
 *
 * The fabricated live-GPS simulation (fake ETA countdown, speed jitter,
 * fuel/temperature gauges, driver phone numbers, stop-by-stop arrival
 * times, trip history) is RETIRED — none of it had a data source. What
 * remains is REAL:
 *
 *   · The student's route assignment (route name, vehicle number, pickup
 *     window, stop count) from GET /api/student/dashboard — resolved
 *     server-side from the student's own record (never client ids).
 *   · The T4-E route-change notice (recorded by the office when THIS
 *     student's route changes; renders nothing while null).
 *   · An HONEST "Live bus tracking is not available yet" state — no
 *     fabricated speed, ETA, fuel or contact numbers anywhere.
 *
 * Loading → skeleton, error → retry, unassigned → honest empty state.
 */

import { useEffect, useState } from 'react'
import { Bus, MapPinOff, Route as RouteIcon, RotateCw, Satellite, X, Clock, MapPin, Truck } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { GlassCard, PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTransportStore } from '@/lib/store/transport-store'
import { useMyStudentRecord } from '@/lib/store/students-store'
import { apiFetch } from '@/components/student/modules/learning/api'
import { cn } from '@/lib/utils'

/** The dashboard response's transport section (the only slice we read). */
interface TransportSection {
  assigned: boolean
  routeName: string | null
  pickupWindow: string | null
  stopsCount: number
  vehicleNo: string | null
}

function formatEffectiveDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function BusTrackingModule() {
  // Canonical identity — the session user's own roster record.
  const student = useMyStudentRecord()

  const [transport, setTransport] = useState<TransportSection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // Real route assignment from the server aggregation (school-scoped,
  // resolved from the student's own record — no client-supplied ids).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch<{ transport: TransportSection }>('/api/student/dashboard')
      .then((d) => {
        if (cancelled) return
        setTransport(d?.transport ?? { assigned: false, routeName: null, pickupWindow: null, stopsCount: 0, vehicleNo: null })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Transport details could not load.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const routeChange = useTransportStore((s) => s.routeChange)
  const dismissRouteChange = useTransportStore((s) => s.dismissRouteChange)
  // The store field is global — only the affected student sees their banner.
  const myRouteChange = routeChange?.studentId === (student?.id ?? '') ? routeChange : null

  return (
    <PageTransition className="space-y-5">
      {/* T4-E — real route-change notice (recorded when the office changes
          THIS student's route). Renders nothing while null: no fabricated
          changes. */}
      <AnimatePresence initial={false}>
        {myRouteChange && (
          <motion.div
            key="route-change-notice"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="status"
            className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5"
          >
            <RouteIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-xs text-amber-700 dark:text-amber-400">
              Route updated · now {myRouteChange.newRouteName} · effective{' '}
              {formatEffectiveDate(myRouteChange.effectiveDate)}
              {myRouteChange.stop ? ` · New stop: ${myRouteChange.stop}` : ''}
            </p>
            <button
              onClick={dismissRouteChange}
              aria-label="Dismiss route change notice"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── LOADING — skeleton (no fabricated live data behind it) ── */}
      {loading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading transport details">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-[132px] rounded-2xl" />
          <Skeleton className="h-[180px] rounded-2xl" />
        </div>
      )}

      {/* ── ERROR — honest message + retry ── */}
      {!loading && error && (
        <GlassCard hover={false} className="on-card px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <MapPinOff className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm font-semibold">Transport details could not load</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-4 h-8 gap-1.5" onClick={() => setTick((t) => t + 1)}>
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
          </Button>
        </GlassCard>
      )}

      {/* ── NO ROUTE ASSIGNED — honest empty state ── */}
      {!loading && !error && transport && !transport.assigned && (
        <GlassCard hover={false} className="on-card px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bus className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm font-semibold">No transport route assigned</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Your school record has no bus route linked to it. Contact the school office if you use
            school transport — they can assign your route.
          </p>
        </GlassCard>
      )}

      {/* ── REAL route assignment + the honest live-tracking state ── */}
      {!loading && !error && transport && transport.assigned && (
        <>
          {/* Compact context line (LR-1 — no module title) */}
          <p className="truncate text-xs text-muted-foreground">
            {`Your route · ${transport.routeName ?? 'School route'}${transport.vehicleNo ? ` · Bus ${transport.vehicleNo}` : ''}`}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
            {/* Assigned route details — every value from the real record */}
            <GlassCard className="p-0 overflow-hidden lg:col-span-2">
              <div className="border-b border-border/60 px-5 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <RouteIcon className="h-4 w-4 text-primary" aria-hidden />
                  Route Details
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The route and vehicle the school has assigned to you.
                </p>
              </div>
              <dl className="grid grid-cols-1 gap-px bg-border/40 sm:grid-cols-2">
                <DetailRow icon={<RouteIcon className="h-4 w-4" aria-hidden />} label="Route" value={transport.routeName} />
                <DetailRow icon={<Truck className="h-4 w-4" aria-hidden />} label="Vehicle" value={transport.vehicleNo} />
                <DetailRow icon={<Clock className="h-4 w-4" aria-hidden />} label="Pickup window" value={transport.pickupWindow} />
                <DetailRow
                  icon={<MapPin className="h-4 w-4" aria-hidden />}
                  label="Stops on route"
                  value={transport.stopsCount > 0 ? `${transport.stopsCount} stops` : null}
                />
              </dl>
            </GlassCard>

            {/* Honest live-tracking state — no fabricated GPS */}
            <GlassCard className="p-0 overflow-hidden">
              <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
                  <Satellite className="h-6 w-6" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-semibold">Live bus tracking is not available yet</p>
                  <p className="mx-auto mt-1.5 max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                    Your school has not enabled live GPS tracking for buses. For day-to-day bus
                    timings or changes, please contact the school office.
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </PageTransition>
  )
}

/** One route-detail cell (icon + label + real value, or an honest "—"). */
function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 bg-card px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className={cn('mt-0.5 truncate text-sm', value ? 'font-medium text-foreground' : 'text-muted-foreground/60')}>
          {value ?? 'Not recorded'}
        </dd>
      </div>
    </div>
  )
}
