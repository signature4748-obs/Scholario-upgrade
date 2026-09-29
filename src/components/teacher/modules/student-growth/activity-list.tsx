'use client'

/**
 * activity-list — the transparent point ledger (§12 POINT ACTIVITY / §28).
 *
 * Every row shows exactly what happened and where it came from:
 *   points · reason · student · when · who (a teacher or "Automatic") ·
 *   the optional note · the source period for automatic events.
 *
 * The creator can correct their own manual points inline (§29): the
 * correction opens a compact inline editor — never a silent rewrite; the
 * original is superseded with an audit note and a new event takes its
 * place. Filters stay compact: All / Positive / Negative / Automatic /
 * Manual (+ student on request from the module header).
 */

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Loader2, PencilLine, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { GrowthEventItem } from '@/lib/teacher-hub-types'
import {
  GROWTH_CATEGORY_CONFIG,
  SOURCE_LABELS,
  isAutomaticSource,
  periodLabelOf,
  pointsChipClass,
  pointsTextClass,
  relativeDay,
  signedPoints,
} from './shared'
import { correctGrowthPoint } from './hooks'

export type ActivityFilter = 'all' | 'positive' | 'negative' | 'automatic' | 'manual'

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'positive', label: 'Positive' },
  { key: 'negative', label: 'Needs attention' },
  { key: 'automatic', label: 'Automatic' },
  { key: 'manual', label: 'Manual' },
]

export function filterEvents(
  events: GrowthEventItem[],
  filter: ActivityFilter,
  studentId: string | null,
): GrowthEventItem[] {
  return events.filter((e) => {
    if (studentId && e.studentId !== studentId) return false
    switch (filter) {
      case 'positive':
        return e.points > 0
      case 'negative':
        return e.points < 0
      case 'automatic':
        return isAutomaticSource(e.source)
      case 'manual':
        return e.source === 'MANUAL'
      default:
        return true
    }
  })
}

export function ActivityList({
  events,
  currentUserId,
  onOpenStudent,
  onCorrected,
  emptyHint = 'Points teachers record and the system derives will appear here.',
}: {
  events: GrowthEventItem[]
  /** User.id of the signed-in teacher — gates the inline correction */
  currentUserId: string | null
  onOpenStudent?: (studentId: string) => void
  onCorrected: () => void
  emptyHint?: string
}) {
  const [correctingId, setCorrectingId] = useState<string | null>(null)

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-8 text-center">
        <Sparkles className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">No point events for this view yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground/70">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false} mode="popLayout">
        {events.map((e, i) => (
          <motion.div
            key={e.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{
              duration: 0.25,
              delay: Math.min(i * 0.02, 0.2),
            }}
            className={cn(
              'rounded-xl border border-border bg-card/60 p-3 transition-colors hover:border-primary/25',
              e.points < 0 && 'border-l-2 border-l-amber-500/60',
              e.points > 0 && 'border-l-2 border-l-emerald-500/60',
            )}
          >
            {correctingId === e.id ? (
              <CorrectionEditor
                event={e}
                onCancel={() => setCorrectingId(null)}
                onDone={() => {
                  setCorrectingId(null)
                  onCorrected()
                }}
              />
            ) : (
              <div className="flex items-start gap-3">
                {/* the point — always the anchor */}
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border text-sm font-bold tabular-nums',
                    pointsChipClass(e.points),
                  )}
                  aria-label={`${signedPoints(e.points)} points`}
                >
                  {signedPoints(e.points)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {onOpenStudent ? (
                      <button
                        type="button"
                        onClick={() => onOpenStudent(e.studentId)}
                        className="truncate text-sm font-semibold leading-snug transition-colors hover:text-primary"
                      >
                        {e.studentName}
                      </button>
                    ) : (
                      <span className="truncate text-sm font-semibold leading-snug">{e.studentName}</span>
                    )}
                    <span className="truncate text-[11px] text-muted-foreground">{e.classLabel}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-foreground/90">{e.reason}</p>
                  {e.note && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.note}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{relativeDay(e.effectiveAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {e.createdBy ? `By ${e.createdBy.name}` : SOURCE_LABELS[e.source]}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-semibold',
                        GROWTH_CATEGORY_CONFIG[e.category].chip,
                        GROWTH_CATEGORY_CONFIG[e.category].text,
                      )}
                    >
                      {GROWTH_CATEGORY_CONFIG[e.category].label}
                    </span>
                    {isAutomaticSource(e.source) && e.period && periodLabelOf(e) && (
                      <span className="rounded-full bg-muted px-1.5 py-px font-medium">
                        {periodLabelOf(e)}
                      </span>
                    )}
                    {e.correctsId && (
                      <span className="rounded-full border border-border bg-muted/50 px-1.5 py-px font-medium text-muted-foreground">
                        corrected
                      </span>
                    )}
                  </div>
                </div>

                {/* correction affordance — creator only (§29) */}
                {e.source === 'MANUAL' && e.createdBy?.id && e.createdBy.id === currentUserId && (
                  <button
                    type="button"
                    onClick={() => setCorrectingId(e.id)}
                    className="mt-0.5 shrink-0 rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={`Correct this point for ${e.studentName}`}
                    title="Correct this point"
                  >
                    <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── correction editor (§29 — audited, never silent) ──────────────────────

function CorrectionEditor({
  event,
  onCancel,
  onDone,
}: {
  event: GrowthEventItem
  onCancel: () => void
  onDone: () => void
}) {
  const reduce = useReducedMotion()
  const [points, setPoints] = useState(event.points)
  const [note, setNote] = useState(event.note ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!reason.trim()) {
      setError('Add a one-line correction reason (it stays in the audit trail).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await correctGrowthPoint(event.id, {
        points,
        note: note.trim() || null,
        correctionNote: reason.trim(),
      })
      toast.success('Point corrected', {
        description: `The original stays in the ledger with the correction note.`,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The correction could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2.5"
      role="group"
      aria-label="Correct this point"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 items-center overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setPoints((v) => Math.max(-5, v - 1))}
            className="h-full w-8 text-muted-foreground transition-colors hover:bg-accent"
            aria-label="Fewer points"
          >
            −
          </button>
          <span className={cn('w-10 text-center text-sm font-bold tabular-nums', pointsTextClass(points))}>
            {signedPoints(points)}
          </span>
          <button
            type="button"
            onClick={() => setPoints((v) => Math.min(5, v + 1))}
            className="h-full w-8 text-muted-foreground transition-colors hover:bg-accent"
            aria-label="More points"
          >
            +
          </button>
        </div>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {event.studentName} · {event.reason}
        </p>
      </div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Correction reason (required, audited)"
        maxLength={200}
        className="h-9 text-xs"
        aria-label="Correction reason"
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={event.note ?? 'Note (optional)'}
        maxLength={500}
        className="h-9 text-xs"
        aria-label="Note"
      />
      {error && (
        <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-8 px-3 text-xs">
          <X className="mr-1 h-3 w-3" aria-hidden="true" /> Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={saving}
          className="h-8 gap-1 px-3 text-xs"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3 w-3" aria-hidden="true" />
          )}
          Save correction
        </Button>
      </div>
    </motion.div>
  )
}
