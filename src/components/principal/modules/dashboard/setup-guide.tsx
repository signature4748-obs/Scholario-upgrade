'use client'

/**
 * PHASE 8C-F (mission §12) — the principal's guided-setup experience.
 *
 * A dashboard card that appears ONLY while the school's REQUIRED setup
 * is incomplete (DB-computed via /api/school/setup-readiness — the same
 * contract the platform console's Setup tab sees). Each unfinished
 * section deep-links to the module that completes it (onNavigate), so a
 * brand-new principal never has to hunt through the sidebar. When the
 * required sections are done the guide disappears — no confetti, no
 * self-reported progress, no fabricated data. Optional sections are
 * shown as a quiet count (they never block the school).
 *
 * Honest failure: if the readiness fetch fails, the guide renders a
 * compact retry line — never a fabricated "complete" state.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, CircleDashed, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export interface SetupGuideProps {
  /** Navigate to a module by key (wired from principal-panel's setActive). */
  onNavigate?: (module: string) => void
}

interface SetupSection {
  id: string
  label: string
  required: boolean
  done: boolean
  detail: string
}

interface ReadinessBody {
  school: { status: string }
  sections: SetupSection[]
  summary: { requiredDone: number; requiredTotal: number; requiredComplete: boolean }
}

/** Section id → the module that completes it. */
const SECTION_MODULES: Record<string, string> = {
  identity: 'school-settings',
  principal: 'school-settings',
  branding: 'school-settings',
  academic: 'classes',
  people: 'teachers', // teachers then students (the roster link)
  rooms: 'classes',
  fees: 'fees',
  exams: 'exams',
  timetable: 'timetable',
  website: 'school-settings',
  domain: 'school-settings',
}

const SECTION_ACTIONS: Record<string, string> = {
  identity: 'Complete the school profile',
  principal: 'Review the principal account',
  branding: 'Add school branding',
  academic: 'Create classes & subjects',
  people: 'Add teachers and students',
  rooms: 'Add rooms',
  fees: 'Set up fee structures',
  exams: 'Configure examinations',
  timetable: 'Publish the timetable',
  website: 'Edit the public website',
  domain: 'Connect a custom domain',
}

export function SetupGuide({ onNavigate }: SetupGuideProps) {
  const [readiness, setReadiness] = useState<ReadinessBody | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const reload = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/school/setup-readiness', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const body = (await res.json()) as { ok: boolean; data?: ReadinessBody }
      if (!body.ok || !body.data) throw new Error('bad envelope')
      setReadiness(body.data)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // A configured school: the guide removes itself — nothing to show.
  if (readiness?.summary.requiredComplete) return null
  // Session-only dismissal (never persisted: the guide is data-driven,
  // not a preference; a reload re-checks the real state).
  if (dismissed) return null

  const requiredPending = readiness?.sections.filter((s) => s.required && !s.done) ?? []

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04]"
      aria-label="School setup guide"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="font-display text-sm font-bold text-foreground">
            Finish setting up your school
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {readiness
              ? `${readiness.summary.requiredDone}/${readiness.summary.requiredTotal} required steps done — computed from your live data.`
              : 'Checking your school’s setup progress…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void reload()}
            disabled={busy}
            className="h-8 text-muted-foreground"
            aria-label="Refresh setup progress"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
          {readiness && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
              className="h-8 text-muted-foreground"
              aria-label="Hide the setup guide for this session"
            >
              Hide
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 sm:px-5">
        {/* Progress track */}
        {readiness && (
          <div
            className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round((readiness.summary.requiredDone / Math.max(readiness.summary.requiredTotal, 1)) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Required setup progress"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{
                width: `${Math.round((readiness.summary.requiredDone / Math.max(readiness.summary.requiredTotal, 1)) * 100)}%`,
              }}
            />
          </div>
        )}

        {failed ? (
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Setup progress is unavailable right now.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void reload()}
              disabled={busy}
              className="h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : !readiness ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading setup progress">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {readiness.sections
              .filter((s) => s.required)
              .map((s) => {
                const done = s.done
                const moduleKey = SECTION_MODULES[s.id] ?? 'dashboard'
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate?.(moduleKey)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
                      aria-label={
                        done ? `${s.label} — done` : `${SECTION_ACTIONS[s.id] ?? s.label} — open module`
                      }
                    >
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium ${done ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground'}`}>
                          {SECTION_ACTIONS[s.id] ?? s.label}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                          {s.detail}
                        </span>
                      </span>
                      {!done && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })}
            {requiredPending.length === 0 && readiness && !readiness.summary.requiredComplete && (
              // All required sections done but the school is not ACTIVE:
              // the honest state is the platform lifecycle gate, not more
              // setup steps.
              <li className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                All required setup is complete. Your school becomes usable when the platform
                activates it (current status: {readiness.school.status}).
              </li>
            )}
          </ul>
        )}
      </div>
    </motion.section>
  )
}
