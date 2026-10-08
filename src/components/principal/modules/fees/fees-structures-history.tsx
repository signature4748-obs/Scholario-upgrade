'use client'

/**
 * FeesStructuresHistoryDialog — immutable version history (Phase 7-D).
 *
 * SERVER DATA — GET /api/fees/structures/[id] (detail route) includes ALL
 * FeeStructureVersion rows for the structure. Each version row is an
 * IMMUTABLE JSON snapshot taken at publish time by the publish route
 * (atomic promote: prior current archived + version++ + snapshot, all in
 * one transaction). This dialog renders those snapshots READ-ONLY:
 *
 *   - NO revert / rollback  (the server has no revert action)
 *   - NO per-version archive (archiving is a structure-level action)
 *   - NO compare view       (its totals were client-derived money)
 *
 * Published versions are never edited or deleted — the UI states this
 * explicitly so the historical-preservation contract stays visible.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { X, History, Calendar, Lock, FileClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import {
  useFeeStructureDetail,
  parseVersionSnapshot,
  type FeeStructureVersionDTO,
  type VersionSnapshot,
} from './fees-structures-hooks'
import { formatINRAmount } from './fees-structures-shared'

export interface HistoryDialogProps {
  open: boolean
  /** Structure id — the dialog fetches the full detail (all versions). */
  structureId: string | null
  /** Class name for the title (fetched when structureId is provided). */
  className?: string
  onClose: () => void
}

export function FeesStructuresHistoryDialog({ open, structureId, className, onClose }: HistoryDialogProps) {
  // Escape closes the history dialog (backdrop click already does).
  useDismissOnEscape(onClose, open)

  const { structure, loading, error } = useFeeStructureDetail(open ? structureId : null)

  const title = structure?.className ?? className ?? 'Structure'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Version history — ${title}`}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="bg-card border border-border rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border bg-gradient-to-br from-sky-500/5 via-transparent to-transparent">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 bg-sky-500/10 text-sky-600 ring-sky-500/20">
                    <History className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold truncate">Version History — {title}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {loading
                        ? 'Loading…'
                        : `${structure?.versions.length ?? 0} published version${(structure?.versions.length ?? 0) === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close version history">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Immutability banner — the historical-preservation contract */}
            <div className="px-5 pt-4">
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Published versions are <span className="font-semibold text-foreground">immutable</span> — they are never
                  edited or deleted. Each publish archives the previous current structure and records this snapshot;
                  historical records are never altered.
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {error && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300" role="alert">
                  {error}
                </div>
              )}
              {loading && (
                <div className="text-center text-xs text-muted-foreground py-8">Loading version history…</div>
              )}
              {!loading && !error && (structure?.versions.length ?? 0) === 0 && (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No published versions yet — versions are recorded when a structure is published.
                </div>
              )}
              {!loading &&
                !error &&
                (structure?.versions ?? []).map((v) => (
                  <VersionRow key={v.id} version={v} />
                ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Version row (immutable snapshot, read-only) ────────────────────────

function VersionRow({ version }: { version: FeeStructureVersionDTO }) {
  const snapshot: VersionSnapshot | null = parseVersionSnapshot(version.snapshot)
  const heads = snapshot?.heads ?? []
  // The live structure row's status reflects the CURRENT lifecycle; the
  // version row itself is a frozen publish record (no per-version status).
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border bg-card p-3"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-xs">Version {version.version}</span>
          <Badge variant="outline" className="text-[9px] h-4 gap-1 bg-muted/40 font-normal">
            <FileClock className="h-2.5 w-2.5" /> Snapshot
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono truncate">{version.id}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
        <MetaItem icon={<Calendar className="h-2.5 w-2.5" />} label="Published" value={formatDate(version.publishedAt)} />
        <MetaItem label="Heads" value={`${heads.length}`} mono />
        <MetaItem label="Class" value={snapshot?.className ?? '—'} />
        <MetaItem label="Level" value={snapshot?.classLevel ?? '—'} />
      </div>

      {version.notes && (
        <div className="rounded-md bg-muted/30 text-muted-foreground border border-border/40 px-2 py-1 text-[10px] mb-1.5">
          <span className="font-semibold">Notes: </span>
          <span className="italic">{version.notes}</span>
        </div>
      )}

      {/* Snapshot heads — read-only, amounts as published */}
      <details className="mt-1.5">
        <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
          View {heads.length} fee head{heads.length === 1 ? '' : 's'} as published
        </summary>
        <div className="mt-1.5 rounded-md border border-border/40 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 bg-muted/30 text-[9px] uppercase font-semibold text-muted-foreground">
            <span>Head</span>
            <span className="text-right">Frequency</span>
            <span className="text-right">Amount</span>
          </div>
          <div className="divide-y divide-border/40 max-h-32 overflow-y-auto">
            {heads.length === 0 && (
              <div className="px-2 py-1 text-[10px] text-muted-foreground">No heads recorded in this snapshot.</div>
            )}
            {heads.map((h, i) => (
              <div key={h.id ?? i} className={cn('grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 text-[10px] items-center', !h.active && 'opacity-50 line-through')}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-medium">{h.name}</span>
                  {h.mandatory ? (
                    <Badge variant="outline" className="text-[7px] py-0 px-1 h-3">REQ</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[7px] py-0 px-1 h-3 text-muted-foreground">OPT</Badge>
                  )}
                </div>
                <span className="text-muted-foreground">{h.frequency ?? '—'}</span>
                <span className="font-mono tabular-nums text-right">{formatINRAmount(h.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </motion.div>
  )
}

function MetaItem({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md bg-muted/30 px-1.5 py-1">
      <p className="text-[8px] text-muted-foreground uppercase font-semibold tracking-wider flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={cn('text-[10px] font-medium truncate mt-0.5', mono && 'font-mono tabular-nums')}>{value}</p>
    </div>
  )
}
