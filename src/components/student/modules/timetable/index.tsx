'use client'

/**
 * TimetableModule — Student Timetable.
 *
 * One canonical source — the SERVER's Timetable rows (the same truth the
 * Dashboard and the Teacher workspace read), resolved to the signed-in
 * student's enrollment server-side — and two genuinely DIFFERENT reading
 * experiences:
 *   - MY CLASS (default): the student's personal schedule as a vertical,
 *     chronological timeline — enrollment resolves the class, never the
 *     student
 *   - SCHOOL: the read-only MASTER TIMETABLE sheet — full week, every
 *     class, every period
 *
 * The app header already says "Timetable", so the views themselves open
 * with their own context (MY CLASS / Class 9-A · Section A / session or
 * SCHOOL / Master Timetable) — never a repeated big page title.
 *
 * SD-3b lineage: the class label, section and every slot below come from
 * GET /api/student/timetable (server truth) — the localStorage store
 * remains ONLY for the "recently updated" publication chip.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GraduationCap, Building2, AlertTriangle, RefreshCw, Radio } from 'lucide-react'
import { PageTransition, GlassCard } from '@/components/shared/ui'
import { cn } from '@/lib/utils'
import { type DayType } from '@/lib/timetable/config'
import { useTimetableStore } from '@/lib/store/timetable-store'
import { useLiveFeedStore } from '@/lib/store/live-feed-store'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'
import { useAcademicSession, SESSION_NOT_SET_LABEL } from '@/lib/academic-session'
import { nextOccurrenceISO, type IcsEventInput } from '@/lib/ics/builder'
import { ExportIcsButton } from '@/components/shared/export-ics-button'
import { parsePeriodTime } from './time-utils'
import { serverRowsToSlots, type ServerSlot } from './server-slots'
import { ClassView } from './class-view'
import { SchoolView } from './school-view'

/* ── payload contract ──────────────────────────────────────────────── */

interface TimetablePayload {
  classLabel: string | null
  section: string | null
  mySlots: ServerSlot[]
  masterSlots: ServerSlot[]
  schoolDays: string[]
}

/** Timetable day name → JS weekday index (Monday=1 … Saturday=6). */
const WEEKDAY_INDEX: Record<DayType, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

async function fetchTimetable(): Promise<TimetablePayload> {
  const res = await fetch('/api/student/timetable', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON body — generic message below */
  }
  const envelope = json as { ok?: unknown; error?: unknown; data?: TimetablePayload } | null
  if (!res.ok || !envelope || envelope.ok !== true) {
    const message =
      envelope && typeof envelope.error === 'string' && envelope.error
        ? envelope.error
        : `Request failed (${res.status})`
    throw new Error(message)
  }
  return envelope.data as TimetablePayload
}

export function TimetableModule() {
  const [view, setView] = useState<'my-class' | 'school'>('my-class')
  const [payload, setPayload] = useState<TimetablePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Timestamp of the last LIVE refresh (a publish broadcast arrived and the
  // schedule was quietly re-fetched) — powers the emerald "live" chip.
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null)
  // Broadcast version this view last loaded at (null until the first load
  // completes) — only publishes landing AFTER that trigger a live refresh.
  const loadedVersionRef = useRef<number | null>(null)

  /* ── server truth: enrollment-scoped slots + the master sheet ── */
  useEffect(() => {
    let alive = true
    fetchTimetable()
      .then((data) => {
        if (!alive) return
        setPayload(data)
        setError(null)
        // Baseline the broadcast version AT LOAD TIME — only publishes that
        // land AFTER this view loaded trigger a live refresh.
        loadedVersionRef.current = useLiveFeedStore.getState().timetableVersion
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load the timetable')
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  /* ── LIVE timetable broadcasts (event-stream :3003) ──
   * The AppShell's socket pushes TIMETABLE_PUBLISHED frames into the
   * live-feed store, each bumping timetableVersion. When that happens
   * after our data loaded, quietly re-fetch — the new schedule swaps in
   * place (the skeleton only renders before the FIRST load, so an open
   * tab never flashes) and the emerald chip confirms the update. */
  const timetableVersion = useLiveFeedStore((s) => s.timetableVersion)
  useEffect(() => {
    if (loadedVersionRef.current === null) return // initial load not done yet
    if (timetableVersion === loadedVersionRef.current) return
    loadedVersionRef.current = timetableVersion
    let alive = true
    fetchTimetable()
      .then((data) => {
        if (!alive) return
        setPayload(data)
        setError(null)
        setLiveUpdatedAt(Date.now())
      })
      .catch(() => {
        /* keep showing the loaded schedule — the next retry picks it up */
      })
    return () => {
      alive = false
    }
  }, [timetableVersion])

  // ── mapped onto the canonical period ladder (breaks re-appear) ──
  const mySlots = useMemo(() => serverRowsToSlots(payload?.mySlots ?? []), [payload])
  const masterSlots = useMemo(() => serverRowsToSlots(payload?.masterSlots ?? []), [payload])

  const classLabel = payload?.classLabel ?? 'My Class'
  const section = payload?.section ?? 'A'

  // ── publication chip signal (same-browser live-sync with the
  //    Principal's publishes; display-only) ──
  const publications = useTimetableStore((s) => s.publications)

  // ── session + school context (settings store) ──
  // PHASE 7.5-D — server-first session resolution (no hardcoded year);
  // honest "Session not set" chip when no source knows the school's year.
  const session = useAcademicSession()
  const sessionLabel = session.label ?? SESSION_NOT_SET_LABEL
  const schoolName = useSchoolSettingsStore((s) => s.general?.schoolName) ?? 'Your school'

  /* ── calendar export events (MY CLASS, weekly recurrences) ── */
  const icsEvents = useMemo<IcsEventInput[]>(() => {
    const out: IcsEventInput[] = []
    for (const s of mySlots) {
      const parsed = parsePeriodTime(s.time)
      if (!parsed) continue
      const weekday = WEEKDAY_INDEX[s.day]
      out.push({
        uid: `scholario-student-${s.id}@scholario`,
        title: s.subject,
        description: `${s.teacherName ? `${s.teacherName} · ` : ''}Period ${s.period} · ${classLabel}`,
        location: s.room || undefined,
        startMin: parsed.startMin,
        endMin: parsed.endMin,
        weekday,
        firstDate: nextOccurrenceISO(weekday),
      })
    }
    return out
  }, [mySlots, classLabel])

  /* ── error state — honest, retryable ── */
  if (error && !payload) {
    return (
      <PageTransition>
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500/70" aria-hidden />
          <p className="text-sm font-semibold">Timetable unavailable</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-2xs transition-all hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
          </button>
        </GlassCard>
      </PageTransition>
    )
  }

  /* ── loading state (first fetch, no data yet) ── */
  if (!payload) {
    return (
      <PageTransition>
        <div className="space-y-4" aria-busy="true" aria-label="Loading timetable">
          <div className="h-9 w-64 animate-pulse rounded-lg bg-muted/60" />
          <GlassCard className="p-4 sm:p-5">
            <div className="mb-4 h-5 w-48 animate-pulse rounded bg-muted/60" />
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-xl bg-muted/40"
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          </GlassCard>
        </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition>
      <div className="space-y-4 sm:space-y-5">
        {/* The one prominent control: which timetable am I reading? */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card p-0.5 shadow-2xs" role="tablist" aria-label="Timetable view">
            <button
              role="tab"
              aria-selected={view === 'my-class'}
              onClick={() => setView('my-class')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-all',
                view === 'my-class' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <GraduationCap className="h-3.5 w-3.5" aria-hidden /> My Class
            </button>
            <button
              role="tab"
              aria-selected={view === 'school'}
              onClick={() => setView('school')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-all',
                view === 'school' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Building2 className="h-3.5 w-3.5" aria-hidden /> School
            </button>
          </div>

          <div className="flex items-center gap-3">
            {liveUpdatedAt && (
              <span
                role="status"
                aria-live="polite"
                title="The principal published a new timetable — this view refreshed automatically"
                className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.07] px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 sm:inline-flex"
              >
                <Radio className="h-3 w-3 animate-pulse text-emerald-500" aria-hidden />
                Updated · live
              </span>
            )}
            <p className="hidden text-xs text-muted-foreground/80 sm:block">
              {view === 'my-class' ? 'Your personal class schedule' : 'Your school’s full master timetable'}
            </p>
            <ExportIcsButton
              events={icsEvents}
              calendarName={`${classLabel} Timetable — ${schoolName}`}
              calendarDescription={`Weekly class schedule for ${classLabel} · ${sessionLabel}`}
              filename={`${classLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-timetable`}
              variant="glass"
            />
          </div>
        </div>

        {/* Stale-notice: a refresh failed but earlier data is still shown */}
        {error && payload && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Showing your last loaded timetable.</span>{' '}
              <span className="text-amber-800/80 dark:text-amber-200/80">{error}</span>
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-card px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 transition-colors hover:border-amber-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Retry
            </button>
          </div>
        )}

        {view === 'my-class' ? (
          <ClassView
            classLabel={classLabel}
            section={section}
            sessionLabel={sessionLabel}
            slots={mySlots}
            publications={publications}
          />
        ) : (
          <SchoolView
            slots={masterSlots}
            schoolName={schoolName}
            sessionLabel={sessionLabel}
            myClass={classLabel}
          />
        )}
      </div>
    </PageTransition>
  )
}
