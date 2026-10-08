'use client'

/**
 * FeesStructuresSection — the Fee Structures admin grid, wired to the
 * CANONICAL SERVER API (Phase 7-D).
 *
 * DATA — GET /api/fees/structures (status filter chips drive the ?status=
 * query param; every chip change is a real API call). Cards render server
 * rows only: class, level, status + version, effective dates, head count,
 * transaction count (_count.transactions) and a display-only heads
 * preview. No client store, no localStorage, no mock data.
 *
 * REMOVED (client-store structures path — the fake-data generator):
 *   · syncFeeStructuresForSession on mount (auto-created drafts from the
 *     mock ACADEMIC_CLASSES constant),
 *   · createFeeStructure / publishFeeStructureVersion /
 *     scheduleFeeStructureVersion / archiveFeeStructureVersion /
 *     revertFeeStructureVersion / requestStructureEditWindow /
 *     createStructureRevision store actions,
 *   · Duplicate-as-draft + Bulk-Apply-to-Level (no server equivalent — the
 *     server create contract is one real class per structure),
 *   · store-derived student counts / annual totals (display-only server
 *     fields replace them — no client-derived money).
 *
 * The Catalogue content-area swap stays (it is the separate
 * school-settings catalogue surface, not the structures path).
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Layers, History, Plus, Calendar, CalendarCheck2, ChevronRight, BookOpen,
  Loader2, Lock, AlertTriangle, ReceiptText, Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ModuleEmptyState } from '../shared/empty-state'
// SaaS-STAGE-2A (Task 7-b) — tenant-aware gating: the Catalogue entry point
// and the New-Structure CTA follow the ACTIVE school's sub-features /
// effective capabilities (convenience layer only — never authorization).
import { useFeatureGate, useEffectiveFeeCapabilities } from '@/lib/tenant/store'
import { useAcademicSession } from '@/lib/academic-session'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useFeeStructures, type FeeStructureDTO, type FeeStructureStatus } from './fees-structures-hooks'
import { StructureStatusBadge, formatINRAmount } from './fees-structures-shared'
import { FeesStructuresDetailDrawer } from './fees-structures-detail'
import { FeesStructuresHistoryDialog } from './fees-structures-history'
import { FeesStructuresCreateDialog } from './fees-structures-create'
// SaaS-STAGE-1 — the Catalogue is a FULL CONTENT-AREA VIEW (never a modal):
// opening it swaps THIS tab's content while the app shell stays untouched.
// (The catalogue surface manages the master-fee-head catalogue — it is NOT
// the structures path and is out of scope for the 7-D rewiring.)
import { FeesCatalogueView } from './fees-catalogue-view'

// TASK 2-c — level-toned chips (same recipe as before; the values come from
// the server's classLevel field).
const CATEGORY_COLORS: Record<string, string> = {
  'Pre-Primary': 'bg-cyan-500/15 text-cyan-600',
  'Primary': 'bg-emerald-500/15 text-emerald-600',
  'Middle': 'bg-amber-500/15 text-amber-600',
  'Secondary': 'bg-violet-500/15 text-violet-600',
  'Senior Secondary': 'bg-rose-500/15 text-rose-600',
  'Senior': 'bg-rose-500/15 text-rose-600',
}

type StatusFilter = FeeStructureStatus | 'all'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'current', label: 'Current' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
]
// NOTE (7-POLISH): no 'scheduled' chip — no route writes SCHEDULED (POST
// creates DRAFT; PATCH/publish/archive only move draft→current→archived),
// so the filter would always be an empty list. The FeeStructureStatus
// union keeps 'scheduled' for API typing (the server schema allows the
// value), but the UI affordance is gone.

export function FeesStructuresSection() {
  // Status filter chips drive the SERVER query (?status=…). 'all' omits
  // the param — every chip change is a real GET /api/fees/structures call.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { structures, loading, error, reload } = useFeeStructures({ status: statusFilter })
  // Unfiltered fetch — powers the header summary badges only.
  const { structures: allStructures } = useFeeStructures()

  const gate = useFeatureGate()
  const perms = useEffectiveFeeCapabilities()
  const catalogueAvailable = gate.isSubFeatureEnabled('fee_catalogue') && perms.fee_catalogue_manage
  // The active academic session is DERIVED, read-only (lib/academic-session.ts).
  const session = useAcademicSession()

  const [search, setSearch] = useState('')
  const [openStructureId, setOpenStructureId] = useState<string | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ id: string; className: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // SaaS-STAGE-1 — Catalogue content-area swap.
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const openCatalogue = () => {
    setOpenStructureId(null)
    setHistoryTarget(null)
    setCreateOpen(false)
    setCatalogueOpen(true)
  }

  const statusCounts = useMemo(() => {
    // 'scheduled' stays as a key only for Record<StatusFilter, number>
    // type completeness (the DTO union keeps it); no chip renders it.
    const counts: Record<StatusFilter, number> = { all: allStructures.length, current: 0, draft: 0, scheduled: 0, archived: 0 }
    for (const s of allStructures) counts[s.status] += 1
    return counts
  }, [allStructures])

  const visibleStructures = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return structures
    return structures.filter(
      (s) => s.className.toLowerCase().includes(q) || s.classLevel.toLowerCase().includes(q),
    )
  }, [structures, search])

  const handleStructureDeleted = (structureId: string) => {
    if (openStructureId === structureId) setOpenStructureId(null)
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {catalogueOpen ? (
        <FeesCatalogueView onBack={() => setCatalogueOpen(false)} />
      ) : (
        <>
          {/* Toolbar — summary badges left, session chip, search + New Structure right. */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
                <Layers className="h-2.5 w-2.5" /> {allStructures.length} structure{allStructures.length === 1 ? '' : 's'}
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
                {statusCounts.current} current
              </Badge>
              {statusCounts.draft > 0 && (
                <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
                  {statusCounts.draft} draft{statusCounts.draft === 1 ? '' : 's'}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="text-[10px] h-5 gap-1 bg-muted/40"
                title="Active academic session (read-only, from school configuration)"
              >
                <CalendarCheck2 className="h-2.5 w-2.5" /> {session.label ?? 'Session not set'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search class…"
                  aria-label="Search structures by class"
                  className="h-8 w-40 sm:w-52 pl-7 text-xs"
                />
              </div>
              {catalogueAvailable && (
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={openCatalogue}>
                  <BookOpen className="h-3.5 w-3.5" /> Catalogue
                </Button>
              )}
              {perms.fee_structure_edit ? (
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> New Structure
                </Button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] leading-tight text-muted-foreground"
                  title="Enabled by the platform configuration for this school"
                >
                  <Lock className="h-3 w-3 shrink-0" />
                  Fee structure editing is disabled for your school by the platform configuration
                </span>
              )}
            </div>
          </div>

          {/* Status filter chips — each selection is a fresh API call. */}
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter structures by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                aria-pressed={statusFilter === f.value}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 transition-colors',
                  statusFilter === f.value
                    ? 'bg-foreground text-background ring-foreground'
                    : 'bg-card text-muted-foreground ring-border hover:bg-muted/50',
                )}
              >
                {f.label}
                <span className="ml-1 tabular-nums opacity-70">
                  {f.value === 'all' ? statusCounts.all : statusCounts[f.value]}
                </span>
              </button>
            ))}
          </div>

          {/* Error / loading states */}
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 flex items-center justify-between gap-3" role="alert">
              <div className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 min-w-0">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{error}</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={reload}>
                Retry
              </Button>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading fee structures from server…
            </div>
          )}

          {/* Structure grid */}
          {!loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleStructures.length === 0 && (
                <div className="md:col-span-2 xl:col-span-3">
                  <ModuleEmptyState
                    className="m-0 py-8"
                    icon={<Layers className="h-5 w-5" aria-hidden />}
                    title="No structures in this view"
                    description={
                      structures.length === 0 && statusFilter === 'all'
                        ? 'No fee structures exist yet — create the first draft structure.'
                        : 'Try a different filter or search, or create a new fee structure.'
                    }
                  />
                </div>
              )}
              {visibleStructures.map((f, i) => (
                <StructureCard
                  key={f.id}
                  structure={f}
                  index={i}
                  onOpen={() => setOpenStructureId(f.id)}
                  onHistory={() => setHistoryTarget({ id: f.id, className: f.className })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail drawer — server-backed (edit draft heads / publish / archive / delete) */}
      <FeesStructuresDetailDrawer
        open={!!openStructureId}
        structureId={openStructureId}
        onClose={() => setOpenStructureId(null)}
        onChanged={reload}
        onDeleted={handleStructureDeleted}
        onOpenHistory={(id, className) => setHistoryTarget({ id, className })}
      />

      {/* Create dialog — POST /api/fees/structures (draft) */}
      <FeesStructuresCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          setOpenStructureId(id)
          reload()
        }}
      />

      {/* History dialog — immutable FeeStructureVersion snapshots (read-only) */}
      <FeesStructuresHistoryDialog
        open={!!historyTarget}
        structureId={historyTarget?.id ?? null}
        className={historyTarget?.className}
        onClose={() => setHistoryTarget(null)}
      />
    </div>
  )
}

// ─── Structure card ────────────────────────────────────────────────────

function StructureCard({
  structure,
  index,
  onOpen,
  onHistory,
}: {
  structure: FeeStructureDTO
  index: number
  onOpen: () => void
  onHistory: () => void
}) {
  const accentKey = structure.classLevel
  const accent = CATEGORY_COLORS[accentKey] ?? CATEGORY_COLORS['Primary']
  const status = structure.status
  // Display-only head preview: first three heads by sortOrder (server
  // ordering). No derived totals — amounts render as stored.
  const previewHeads = structure.heads.filter((h) => h.active).slice(0, 3)
  const isArchived = status === 'archived'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className={cn(
        'rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-emerald-500/30 hover:shadow-md transition-all cursor-pointer group',
        isArchived && 'opacity-75',
      )}
      onClick={onOpen}
    >
      {/* Header — level-toned chip + class name + status/version */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent)}>
            <Layers className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug line-clamp-2">{structure.className}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{structure.classLevel}</p>
          </div>
        </div>
        <StructureStatusBadge status={status} version={structure.version} />
      </div>

      {isArchived && structure.archivedReason && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 -mt-1 truncate" title={structure.archivedReason}>
          <AlertTriangle className="h-3 w-3 shrink-0" /> Archived: {structure.archivedReason}
        </p>
      )}

      {/* Metrics — server counts only (heads / transactions / versions). */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Heads</p>
          <p className="text-sm font-bold tabular-nums mt-0.5">{structure.heads.length}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Txns</p>
          <p className="text-sm font-bold tabular-nums mt-0.5">{structure._count?.transactions ?? 0}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Versions</p>
          <p className="text-sm font-bold tabular-nums mt-0.5">{structure.versions.length}</p>
        </div>
      </div>

      {/* Heads preview (display only) + effective dates */}
      <div className="space-y-1 text-[10px] leading-relaxed min-h-[2rem]">
        <div className="flex items-center gap-x-1 gap-y-0.5 flex-wrap text-muted-foreground" title={previewHeads.map((h) => `${h.name}: ${formatINRAmount(h.amount)}`).join(' · ') || 'No active heads'}>
          {previewHeads.length === 0 ? (
            <span>No active heads</span>
          ) : (
            previewHeads.map((h) => (
              <span key={h.id} className="inline-flex items-center gap-1 min-w-0">
                <span className="truncate">{h.name} <span className="font-mono tabular-nums">{formatINRAmount(h.amount)}</span>{h.frequency === 'Monthly' ? '/mo' : ''}</span>
                <span className="text-muted-foreground/50">·</span>
              </span>
            ))
          )}
        </div>
        <p className="flex items-center gap-1 text-muted-foreground truncate">
          <Calendar className="h-3 w-3 shrink-0" />
          Effective {formatDate(structure.effectiveFrom ?? '')}
          {structure.effectiveTo ? ` → ${formatDate(structure.effectiveTo)}` : ''}
        </p>
        <p className="flex items-center gap-1 text-muted-foreground truncate">
          <ReceiptText className="h-3 w-3 shrink-0" />
          {status === 'draft' && 'Draft — edit heads, publish, or delete'}
          {status === 'current' && (structure.publishedAt ? `Published ${formatDate(structure.publishedAt)}` : 'Current')}
          {status === 'archived' && (structure.archivedAt ? `Archived ${formatDate(structure.archivedAt)}` : 'Archived')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-2 mt-auto border-t border-border/40" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="default"
          className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={onOpen}
        >
          Open <ChevronRight className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          onClick={onHistory}
          disabled={structure.versions.length === 0}
          title={structure.versions.length === 0 ? 'No published versions yet' : 'View immutable version history'}
        >
          <History className="h-3 w-3" /> History
        </Button>
      </div>
    </motion.div>
  )
}
