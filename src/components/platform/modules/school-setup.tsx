'use client'

/**
 * PHASE 8C (mission §12) — platform console · school detail · Setup tab.
 *
 * The guided-setup progress surface. Every section is COMPUTED from the
 * live database via /api/platform/schools/[id]/setup-readiness — never
 * self-reported by the client, never fabricated. A newly provisioned
 * school honestly shows zero-progress sections; a configured school
 * shows what actually exists.
 *
 * Read-only by design: provisioning/configuration/activation happen
 * through their own audited routes (provision dialog, metadata tab,
 * danger zone, principal's school console). This surface only OBSERVES
 * state so the platform admin always knows what remains before a
 * school is usable.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  CircleDashed,
  GraduationCap,
  RefreshCw,
  School,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { platformApi, type PlatformApiError } from '../platform-client'

interface SetupSection {
  id: string
  label: string
  required: boolean
  done: boolean
  detail: string
  counts: Record<string, number>
}

interface SetupReadiness {
  school: { id: string; name: string; status: string }
  sections: SetupSection[]
  summary: {
    requiredTotal: number
    requiredDone: number
    requiredComplete: boolean
    optionalDone: number
    optionalTotal: number
    usable: boolean
  }
}

function errText(e: unknown): string {
  const pae = e as PlatformApiError
  if (pae && typeof pae.error === 'string') return pae.error
  return e instanceof Error ? e.message : 'Something went wrong'
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  identity: <School className="h-4 w-4" aria-hidden="true" />,
  principal: <GraduationCap className="h-4 w-4" aria-hidden="true" />,
}

/** Required/optional progress bar (counts, never fabricated). */
function ProgressTrack({
  done,
  total,
  tone,
}: {
  done: number
  total: number
  tone: 'required' | 'optional'
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const bar =
    tone === 'required'
      ? 'bg-emerald-500'
      : 'bg-zinc-500'
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tone === 'required' ? 'Required setup progress' : 'Optional setup progress'}
      >
        <div className={`h-full rounded-full ${bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-zinc-300">
        {done}/{total}
      </span>
    </div>
  )
}

export function SchoolSetupTab({ schoolId, schoolStatus }: { schoolId: string; schoolStatus: string }) {
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setBusy(true)
    setLoadError(null)
    try {
      const res = await platformApi<SetupReadiness>(
        `/api/platform/schools/${schoolId}/setup-readiness`,
      )
      setReadiness(res)
    } catch (e) {
      setLoadError(errText(e))
    } finally {
      setBusy(false)
    }
  }, [schoolId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Fail-closed display: an unavailable readiness surface must never
  // render a fabricated "all done" state.
  if (loadError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 text-red-400" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-red-300">Setup status unavailable</h2>
        </div>
        <p className="mt-2 text-xs text-zinc-400">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reload()}
          disabled={busy}
          className="mt-4 h-9 border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  if (!readiness) {
    // Skeleton — honest loading state, no fabricated progress.
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading setup readiness">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  const { sections, summary } = readiness
  const pending = schoolStatus === 'PENDING'
  const suspended = schoolStatus === 'SUSPENDED'

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
      aria-label="Guided school setup progress"
    >
      {/* Summary card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="font-display text-sm font-bold text-zinc-100">School setup</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Computed from the live database — a new school honestly shows zero progress.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={busy}
            className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 focus-ring"
            aria-label="Refresh setup progress"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="space-y-4 p-4 sm:px-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Required before usable
              </span>
              {summary.requiredComplete ? (
                <span className="text-[11px] font-bold text-emerald-400">Complete</span>
              ) : (
                <span className="text-[11px] font-bold text-amber-400">Incomplete</span>
              )}
            </div>
            <ProgressTrack done={summary.requiredDone} total={summary.requiredTotal} tone="required" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Optional enhancements
              </span>
              <span className="text-[11px] font-semibold text-zinc-500">
                {summary.optionalDone}/{summary.optionalTotal}
              </span>
            </div>
            <ProgressTrack done={summary.optionalDone} total={summary.optionalTotal} tone="optional" />
          </div>
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs ${
              summary.usable
                ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
                : 'border-amber-500/25 bg-amber-500/5 text-amber-300'
            }`}
            role="status"
          >
            {summary.usable
              ? 'This school is ACTIVE and fully usable.'
              : suspended
                ? 'This school is SUSPENDED — reactivation is required (danger zone) before it is usable again.'
                : pending
                  ? 'This school is PENDING — activation (danger zone) is required before anyone can sign in.'
                  : 'Required setup is incomplete — the school is ACTIVE but core sections are missing.'}
          </div>
        </div>
      </div>

      {/* Section list */}
      <ul className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        {sections.map((s, i) => (
          <li
            key={s.id}
            className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${
              i > 0 ? 'border-t border-zinc-800/60' : ''
            } ${s.done ? '' : 'opacity-90'}`}
          >
            {s.done ? (
              <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <CircleDashed className="h-4.5 w-4.5 shrink-0 text-zinc-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-200">
                  {SECTION_ICONS[s.id] ? (
                    <span className="mr-1.5 inline-flex align-[-2px] text-zinc-500" aria-hidden="true">
                      {SECTION_ICONS[s.id]}
                    </span>
                  ) : null}
                  {s.label}
                </span>
                <span
                  className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${
                    s.required
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-700 bg-zinc-800/60 text-zinc-500'
                  }`}
                >
                  {s.required ? 'Required' : 'Optional'}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500 tabular-nums">{s.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </motion.section>
  )
}
