'use client'

/**
 * FeesStructuresHistoryDialog — Version history + comparison view.
 *
 * Opens as a centered modal (max-w-4xl) showing:
 *   - Timeline list of every version for the structure
 *   - Multi-select for compare (pick exactly 2 versions)
 *   - Comparison table: Fee Head | Old | New | Change (color-coded)
 *   - Old Total, New Total, Total Difference, Percentage Difference
 *
 * Wired to the immutable `versions[]` and `changeLog[]` arrays in the
 * fee-store. Read-only — mutations happen via the detail drawer.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, History, GitCompareArrows, Check, Calendar, User, ArrowRight, RotateCcw, Archive,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  useFeeStore,
  type FeeStructureConfig,
  type FeeStructureVersion,
  type FeeChangeLog,
} from '@/lib/store/fee-store'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VersionStatusPill } from './fees-structures-shared'
// SaaS-STAGE-2A (Task 7-b) — ARCHIVE RETENTION display: for archived
// versions, show when the platform purge job becomes eligible. Pure
// display only — the purge itself is a future server-side job
// (lib/tenant/archive-retention.ts; no client timers).
import { getArchiveRetentionState } from '@/lib/tenant/archive-retention'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

export interface HistoryDialogProps {
  open: boolean
  structure: FeeStructureConfig
  onClose: () => void
  onRevert?: (targetVersionId: string) => void
  onArchive?: (versionId: string) => void
}

export function FeesStructuresHistoryDialog({ open, structure, onClose, onRevert, onArchive }: HistoryDialogProps) {
  const versions = useFeeStore((s) => s.versions)
  const changeLog = useFeeStore((s) => s.changeLog)

  // Escape closes the history dialog (backdrop click already does).
  useDismissOnEscape(onClose, open)

  const [selected, setSelected] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  // Reset state when opening.
  useEffect(() => {
    if (open) {
      setSelected([])
      setShowCompare(false)
    }
  }, [open])

  // Filter versions for this structure, sorted by version desc (newest first).
  const structureVersions = useMemo(() => {
    return versions
      .filter((v) => v.structureId === structure.id)
      .sort((a, b) => b.version - a.version)
  }, [versions, structure.id])

  // Filter changeLog for this structure.
  const structureChangeLog = useMemo(() => {
    return changeLog.filter((l) => l.structureId === structure.id)
  }, [changeLog, structure.id])

  const selectedVersions = structureVersions.filter((v) => selected.includes(v.id))
  const canCompare = selectedVersions.length === 2

  // Pick "older" and "newer" by version number.
  const older = selectedVersions[0]?.version < selectedVersions[1]?.version ? selectedVersions[0] : selectedVersions[1]
  const newer = selectedVersions[0]?.version >= selectedVersions[1]?.version ? selectedVersions[0] : selectedVersions[1]

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length === 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Version history — ${structure.className}`}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="bg-card border border-border rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col"
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
                    <h3 className="text-sm font-bold truncate">Version History — {structure.className}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {structureVersions.length} version{structureVersions.length === 1 ? '' : 's'} ·
                      {' '}{structureChangeLog.length} audit entr{structureChangeLog.length === 1 ? 'y' : 'ies'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={canCompare ? 'default' : 'outline'}
                    className="h-7 text-xs gap-1.5"
                    disabled={!canCompare}
                    onClick={() => setShowCompare((v) => !v)}
                  >
                    <GitCompareArrows className="h-3.5 w-3.5" />
                    {showCompare ? 'Hide Compare' : `Compare (${selected.length}/2)`}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close version history">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {showCompare && canCompare && older && newer ? (
                <CompareView older={older} newer={newer} />
              ) : (
                <>
                  {/* Hint */}
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 bg-muted/30 border border-dashed border-border rounded-md px-2.5 py-1.5">
                    <GitCompareArrows className="h-3 w-3" />
                    Select exactly 2 versions below to compare them side-by-side.
                    {selected.length > 0 && <span className="ml-auto font-mono">{selected.length}/2 selected</span>}
                  </div>

                  {/* Version timeline */}
                  <div className="space-y-2">
                    {structureVersions.length === 0 ? (
                      <div className="text-center text-xs text-muted-foreground py-8">
                        No versions recorded for this structure.
                      </div>
                    ) : (
                      structureVersions.map((v) => (
                        <VersionRow
                          key={v.id}
                          version={v}
                          selected={selected.includes(v.id)}
                          onToggle={() => toggleSelect(v.id)}
                          onRevert={onRevert ? () => onRevert(v.id) : undefined}
                          onArchive={onArchive ? () => onArchive(v.id) : undefined}
                          changeLog={structureChangeLog.filter((l) => l.versionId === v.id)}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Version row (timeline item) ───────────────────────────────────

interface VersionRowProps {
  version: FeeStructureVersion
  selected: boolean
  onToggle: () => void
  onRevert?: () => void
  onArchive?: () => void
  changeLog: FeeChangeLog[]
}

function VersionRow({ version, selected, onToggle, onRevert, onArchive, changeLog }: VersionRowProps) {
  const isCurrent = version.status === 'current'
  const isArchived = version.status === 'archived'
  const isScheduled = version.status === 'scheduled'

  const relatedLog = changeLog[0]

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-lg border bg-card p-3 transition-all',
        selected ? 'border-sky-500/40 bg-sky-500/5 ring-1 ring-sky-500/20' : 'border-border hover:border-border/80',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Selection checkbox */}
        <button
          onClick={onToggle}
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
            selected ? 'bg-sky-600 border-sky-600 text-white' : 'border-border hover:border-sky-500/50',
          )}
          aria-label="Select for compare"
        >
          {selected && <Check className="h-3 w-3" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Top row: version + status + actions */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-xs">Version {version.version}</span>
              <VersionStatusPill status={version.status} />
              <span className="text-[10px] text-muted-foreground font-mono truncate">{version.id}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!isCurrent && !isArchived && onArchive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1 text-muted-foreground"
                  onClick={onArchive}
                  title="Archive version"
                >
                  <Archive className="h-3 w-3" />
                </Button>
              )}
              {!isCurrent && onRevert && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1 text-sky-600 hover:text-sky-700 hover:bg-sky-500/10"
                  onClick={onRevert}
                  title="Roll back to this version"
                >
                  <RotateCcw className="h-3 w-3" /> Roll back
                </Button>
              )}
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
            <MetaItem icon={<Calendar className="h-2.5 w-2.5" />} label="Effective" value={formatDate(version.effectiveFrom)} />
            <MetaItem icon={<User className="h-2.5 w-2.5" />} label="Created by" value={version.createdBy} />
            <MetaItem label="Total" value={formatINR(version.totalAmount, true)} mono />
            <MetaItem label="Heads" value={`${version.heads.length}`} mono />
          </div>

          {/* SaaS-STAGE-2A (Task 7-b) — RETENTION: archived versions show
              when the platform purge becomes eligible (30-day window).
              Versions without archivedAt metadata (old rows) show nothing. */}
          {isArchived && (() => {
            const retention = getArchiveRetentionState(version.archivedAt)
            return retention ? (
              <p className="text-[10px] text-muted-foreground/70 mb-1.5">
                Retention: auto-purge eligible {retention.purgeEligibleOn} · platform job
              </p>
            ) : null
          })()}

          {/* Change reason / notes */}
          {version.changeReason && (
            <div className={cn(
              'rounded-md px-2 py-1 text-[10px] mb-1.5',
              isCurrent ? 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                : isScheduled ? 'bg-amber-500/5 text-amber-700 dark:text-amber-300 border border-amber-500/20'
                  : 'bg-muted/30 text-muted-foreground border border-border/40',
            )}>
              <span className="font-semibold">Reason: </span>
              <span className="italic">{version.changeReason}</span>
            </div>
          )}

          {/* Recent audit entry for this version */}
          {relatedLog && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <span className="font-mono">{relatedLog.action}</span>
              <span>·</span>
              <span>by {relatedLog.changedBy}</span>
              <span>·</span>
              <span>{formatDate(relatedLog.changedAt)}</span>
              {relatedLog.changes.length > 0 && (
                <>
                  <span>·</span>
                  <span>{relatedLog.changes.length} change{relatedLog.changes.length === 1 ? '' : 's'}</span>
                </>
              )}
            </div>
          )}

          {/* Heads preview (current/scheduled) — collapsed for archived/draft */}
          {(isCurrent || isScheduled) && (
            <details className="mt-1.5">
              <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                View {version.heads.length} fee heads
              </summary>
              <div className="mt-1.5 rounded-md border border-border/40 overflow-hidden">
                <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-1 bg-muted/30 text-[9px] uppercase font-semibold text-muted-foreground">
                  <span>Head</span>
                  <span className="text-right">Amount</span>
                </div>
                <div className="divide-y divide-border/40 max-h-32 overflow-y-auto">
                  {version.heads.map((h, i) => (
                    <div key={i} className={cn(
                      'grid grid-cols-[1fr_auto] gap-2 px-2 py-1 text-[10px] items-center',
                      !h.active && 'opacity-50 line-through',
                    )}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium">{h.name}</span>
                        {h.mandatory ? (
                          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3">REQ</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[7px] py-0 px-1 h-3 text-muted-foreground">OPT</Badge>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-right">{formatINR(h.amount, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      </div>
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

// ─── Compare view (side-by-side diff) ──────────────────────────────

interface CompareViewProps {
  older: FeeStructureVersion
  newer: FeeStructureVersion
}

function CompareView({ older, newer }: CompareViewProps) {
  const diff = useMemo(() => {
    const rows: { headName: string; oldAmount: number | null; newAmount: number | null; kind: 'added' | 'removed' | 'modified' | 'unchanged' }[] = []
    const seen = new Set<string>()
    for (const h of newer.heads) {
      seen.add(h.name)
      const old = older.heads.find((o) => o.name === h.name)
      if (!old) {
        rows.push({ headName: h.name, oldAmount: null, newAmount: h.amount, kind: 'added' })
      } else if (old.amount !== h.amount || old.mandatory !== h.mandatory) {
        rows.push({ headName: h.name, oldAmount: old.amount, newAmount: h.amount, kind: 'modified' })
      } else {
        rows.push({ headName: h.name, oldAmount: old.amount, newAmount: h.amount, kind: 'unchanged' })
      }
    }
    for (const h of older.heads) {
      if (!seen.has(h.name)) {
        rows.push({ headName: h.name, oldAmount: h.amount, newAmount: null, kind: 'removed' })
      }
    }
    return rows
  }, [older, newer])

  const oldTotal = older.totalAmount
  const newTotal = newer.totalAmount
  const totalDiff = newTotal - oldTotal
  const pctDiff = oldTotal > 0 ? (totalDiff / oldTotal) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Compare header */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase text-sky-700 dark:text-sky-300 font-semibold tracking-wider">Older</p>
          <p className="text-xs font-semibold mt-0.5">Version {older.version}</p>
          <p className="text-[10px] text-muted-foreground">Effective {formatDate(older.effectiveFrom)} · {formatINR(oldTotal, true)}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-sky-600 shrink-0" />
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] uppercase text-sky-700 dark:text-sky-300 font-semibold tracking-wider">Newer</p>
          <p className="text-xs font-semibold mt-0.5">Version {newer.version}</p>
          <p className="text-[10px] text-muted-foreground">Effective {formatDate(newer.effectiveFrom)} · {formatINR(newTotal, true)}</p>
        </div>
      </div>

      {/* Summary totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CompareStat label="Old Total" value={formatINR(oldTotal, true)} />
        <CompareStat label="New Total" value={formatINR(newTotal, true)} />
        <CompareStat
          label="Difference"
          value={`${totalDiff > 0 ? '+' : ''}${formatINR(totalDiff, true)}`}
          accent={totalDiff > 0 ? 'rose' : totalDiff < 0 ? 'emerald' : 'default'}
        />
        <CompareStat
          label="Change"
          value={`${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(1)}%`}
          accent={pctDiff > 0 ? 'rose' : pctDiff < 0 ? 'emerald' : 'default'}
        />
      </div>

      {/* Comparison table */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1.5 bg-muted/40 text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">
          <span>Fee Head</span>
          <span className="text-right">Old (v{older.version})</span>
          <span className="text-right">New (v{newer.version})</span>
          <span className="text-right">Change</span>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
          {diff.length === 0 ? (
            <div className="text-center text-[11px] text-muted-foreground py-6">No fee heads in either version.</div>
          ) : (
            diff.map((row, i) => {
              const diff2 = (row.newAmount ?? 0) - (row.oldAmount ?? 0)
              const kindLabel = row.kind === 'added' ? 'NEW' : row.kind === 'removed' ? 'DEL' : row.kind === 'modified' ? 'MOD' : ''
              const kindAccent = row.kind === 'added' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : row.kind === 'removed' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : row.kind === 'modified' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : ''
              return (
                <div
                  key={i}
                  className={cn(
                    'grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1.5 text-[11px] items-center hover:bg-muted/20',
                    row.kind === 'unchanged' && 'opacity-60',
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {kindLabel && <Badge variant="outline" className={cn('text-[7px] py-0 px-1 h-3.5 font-mono', kindAccent)}>{kindLabel}</Badge>}
                    <span className="truncate font-medium">{row.headName}</span>
                  </div>
                  <span className="font-mono tabular-nums text-right text-muted-foreground">
                    {row.oldAmount === null ? '—' : formatINR(row.oldAmount, true)}
                  </span>
                  <span className="font-mono tabular-nums text-right font-semibold">
                    {row.newAmount === null ? '—' : formatINR(row.newAmount, true)}
                  </span>
                  <span className={cn(
                    'font-mono tabular-nums text-right font-semibold',
                    diff2 > 0 ? 'text-rose-600' : diff2 < 0 ? 'text-emerald-600' : 'text-muted-foreground',
                  )}>
                    {row.kind === 'unchanged' ? '—' : (diff2 > 0 ? '+' : '') + (diff2 === 0 ? '0' : formatINR(diff2, true))}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function CompareStat({ label, value, accent = 'default' }: { label: string; value: string; accent?: 'default' | 'rose' | 'emerald' }) {
  const accentMap = {
    default: '',
    rose: 'text-rose-700 dark:text-rose-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
  }
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
      <p className="text-[9px] uppercase text-muted-foreground font-semibold tracking-wider">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums mt-0.5', accentMap[accent])}>{value}</p>
    </div>
  )
}
