'use client'

/**
 * FeesStructuresSection — Versioned Fee Structure admin grid (Phase 8 + UX-REFINE).
 *
 * - No page heading: the "Fee Structures" tab already establishes context,
 *   so the page opens straight into the toolbar — summary badges left
 *   (structures / active classes), Archived toggle + "New Structure" right.
 * - Per-class structure cards (one per canonical class, plus any
 *   user-created drafts) on the Salary-structures card benchmark:
 *   md:grid-cols-2 xl:grid-cols-3 grid of rounded-xl bg-card p-4 cards
 *   with gap-3 rhythm, semibold titles and one emerald-accent metric.
 * - Each card shows: level-toned icon chip, class name (2-line wrap),
 *   StructureStatusBadge + v{n}, 3 mini-stats (Annual — BASE total
 *   excluding opt-in Transport, emerald accent — / active heads /
 *   students), a top-3 non-transport fee-heads preview line (monthly
 *   heads read "₹X/mo"), effective-from meta, and a session-exam-fee
 *   line ('Not configured' only for intentionally unconfigured
 *   schedules, e.g. Class 6/7).
 * - Card actions: Open (primary), History, More (dropdown)
 * - Drawer actions: Edit, Duplicate, Create New Version, View History,
 *   Compare Versions, Archive, Restore, Delete (with safeguards)
 * - All actions wire to real store mutations (no toast-only placeholders)
 *
 * Status pills (per card):
 *   CURRENT (emerald) · SCHEDULED (amber) · DRAFT (slate) · ARCHIVED (muted)
 * Archived-status structures are dimmed and hidden behind the toolbar's
 * "Archived (N)" toggle by default.
 */

import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Layers, History, MoreHorizontal, Plus, ChevronRight, Calendar,
  FileText, Archive, Copy, AlertTriangle, Lock, ShieldCheck,
  GraduationCap, CalendarCheck2, BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useFeeData,
  useFeeStore,
  computeExamFeeTotal,
  FREQUENCY_MULTIPLIER,
  CURRENT_ACADEMIC_YEAR,
  type FeeStructureConfig,
  type FeeStructureStatus,
  type StructureRevision,
} from '@/lib/store/fee-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { ModuleEmptyState } from '../shared/empty-state'
// SaaS-STAGE-2A (Task 7-b) — tenant-aware gating: the Catalogue entry point,
// the New-Structure CTA and the Bulk-Apply action follow the ACTIVE school's
// sub-features / effective capabilities. The store already enforces every
// capability — these UI gates are the convenience layer.
import { useFeatureGate, useEffectiveFeeCapabilities } from '@/lib/tenant/store'
// PHASE 5 — class catalogue (used by Bulk Apply to Level + Coverage Matrix).
import { ACADEMIC_CLASSES } from '@/lib/mock/academic/classes'
import { formatINR, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FeesStructuresDetailDrawer } from './fees-structures-detail'
import { FeesStructuresHistoryDialog } from './fees-structures-history'
import { StructureStatusBadge } from './fees-structures-shared'
// SaaS-STAGE-1 — the Catalogue is a FULL CONTENT-AREA VIEW (never a modal):
// the Fee Structures header carries the only entry point, and opening it
// swaps THIS tab's content area while the app shell stays untouched.
import { FeesCatalogueView } from './fees-catalogue-view'
import { useAcademicSession } from '@/lib/academic-session'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'

// TASK 2-c — flattened to chip tones only (the old `bar`/`dot` fields
// were legacy-seed helpers that no renderer consumed anymore).
// Tones follow the shared card recipe: bg-{tone}-500/15 text-{tone}-600.
// Beyond the five levels we register head-category fallbacks so custom
// drafts keyed by a fee-head category ('Management & Maintenance',
// 'Registration Fee', practical 'Lab') resolve to a sensible hue.
const CATEGORY_COLORS: Record<string, string> = {
  'Pre-Primary': 'bg-cyan-500/15 text-cyan-600',
  'Primary': 'bg-emerald-500/15 text-emerald-600',
  'Middle': 'bg-amber-500/15 text-amber-600',
  'Secondary': 'bg-violet-500/15 text-violet-600',
  // FEE-PER-CLASS — the seed now uses 'Senior Secondary' (was 'Senior').
  // Keep 'Senior' as a legacy alias for any user-created structures
  // that may still use it.
  'Senior Secondary': 'bg-rose-500/15 text-rose-600',
  'Senior': 'bg-rose-500/15 text-rose-600',
  // Head-category fallbacks (user-created drafts whose category is a
  // fee-head category rather than an academic level).
  'Management & Maintenance': 'bg-violet-500/15 text-violet-600',
  'Registration Fee': 'bg-cyan-500/15 text-cyan-600',
  'Lab': 'bg-rose-500/15 text-rose-600',
}

export function FeesStructuresSection({ data, onNavigate }: { data: ReturnType<typeof useFeeData>; onNavigate?: (moduleKey: string) => void }) {
  const { feeStructures, versions, structureRevisions } = data
  const students = useStudentsStore((s) => s.students)
  const archiveFeeStructureVersion = useFeeStore((s) => s.archiveFeeStructureVersion)
  const createFeeStructure = useFeeStore((s) => s.createFeeStructure)
  const syncFeeStructuresForSession = useFeeStore((s) => s.syncFeeStructuresForSession)
  // SaaS-STAGE-2A (Task 7-b) — tenant gates. Note: `fee_structure_delete`
  // is ALWAYS false for principals (platform-reserved) — the card More
  // menu no longer offers permanent delete at all.
  const gate = useFeatureGate()
  const perms = useEffectiveFeeCapabilities()
  const catalogueAvailable = gate.isSubFeatureEnabled('fee_catalogue') && perms.fee_catalogue_manage

  const [openStructureId, setOpenStructureId] = useState<string | null>(null)
  const [historyStructure, setHistoryStructure] = useState<FeeStructureConfig | null>(null)
  // UX-REFINE — archived structures (latest version archived, no current)
  // move behind an "Archived (N)" toolbar toggle so the default grid
  // stays scannable. Same pattern as Salary Structure's toggle.
  const [showArchived, setShowArchived] = useState(false)

  // FEE-CREATE-DRAWER — "New Structure" (toolbar) opens the same
  // right-side detail drawer used by existing structures, but in
  // `mode='create'`. The button's onClick toggles `createMode`
  // (no record is written); the drawer handles its own Save Draft /
  // Publish New Version / Cancel flow. On Save Draft (or Publish) the
  // drawer calls `onCreated(id)` which closes create-mode and re-opens
  // the drawer in view mode with the new structure id.
  const [createMode, setCreateMode] = useState(false)

  const openCreateDrawer = () => {
    setCreateMode(true)
  }

  const closeCreateDrawer = () => {
    setCreateMode(false)
  }

  // SaaS-STAGE-1 — Catalogue Management content-area swap. While open, the
  // structures toolbar + grid are replaced by the full-size Catalogue view;
  // the app shell (sidebar / header / Fee Management tabs) never changes.
  // List state (open drawer / history / filters) is preserved on Back.
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const openCatalogue = () => {
    setOpenStructureId(null)
    setHistoryStructure(null)
    setCreateMode(false)
    setCatalogueOpen(true)
  }
  // Active academic session — DERIVED, read-only (lib/academic-session.ts).
  const session = useAcademicSession()


  // PHASE 5 — Bulk Apply to Level dialog state. Lets the principal pick
  // a source structure (e.g. Class 2 Primary) and apply it to all OTHER
  // classes in the same level (Class 4 Primary in the seed catalogue)
  // in one click. Each target gets its own draft structure with the
  // target classId/applicableClassIds so it's a true per-class binding.
  const [bulkApplyOpen, setBulkApplyOpen] = useState<FeeStructureConfig | null>(null)
  const [bulkApplySubmitting, setBulkApplySubmitting] = useState(false)

  // Escape closes the bulk-apply confirmation (backdrop click already does,
  // guarded while submitting).
  useDismissOnEscape(
    () => { if (!bulkApplySubmitting) setBulkApplyOpen(null) },
    !!bulkApplyOpen,
  )

  // PHASE 5 — listen for `fee-open-structure` events from the Coverage
  // Matrix (which uses CustomEvent to ask this parent to open a
  // structure's detail drawer by id). Registering in useEffect keeps the
  // listener stable across renders.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string') setOpenStructureId(id)
    }
    window.addEventListener('fee-open-structure', handler)
    return () => window.removeEventListener('fee-open-structure', handler)
  }, [])

  // SaaS-STAGE-1 — the Add-Head picker's "+ Add new to catalogue" footer
  // used to dispatch this event with NO listener (dead shortcut). It now
  // opens the Catalogue content-area view, exactly like the header button.
  useEffect(() => {
    const handler = () => openCatalogue()
    window.addEventListener('fee-open-catalogue', handler)
    return () => window.removeEventListener('fee-open-catalogue', handler)
  }, [])

  // FEE-CREATE-DRAWER — when the drawer's own Delete action succeeds,
  // close the drawer if it was showing the deleted structure.
  const handleStructureDeleted = (structureId: string) => {
    if (openStructureId === structureId) setOpenStructureId(null)
  }

  // Compute current status for each structure by looking up its CURRENT
  // version. If no current version exists (e.g. all archived), fall back
  // to the most recent version's status.
  const structureStatus = useMemo(() => {
    const map = new Map<string, FeeStructureStatus>()
    for (const s of feeStructures) {
      const current = versions.find((v) => v.structureId === s.id && v.status === 'current')
      if (current) {
        map.set(s.id, 'current')
        continue
      }
      // If no current, find the most recent version (newest createdAt)
      const recent = versions
        .filter((v) => v.structureId === s.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
      map.set(s.id, recent?.status ?? 'current')
    }
    return map
  }, [feeStructures, versions])

  // UX-REFINE — derived archived count + the visible list (all vs
  // non-archived) for the toolbar toggle.
  const archivedCount = useMemo(
    () => feeStructures.filter((f) => structureStatus.get(f.id) === 'archived').length,
    [feeStructures, structureStatus],
  )
  const visibleStructures = useMemo(
    () => feeStructures.filter((f) => showArchived || structureStatus.get(f.id) !== 'archived'),
    [feeStructures, showArchived, structureStatus],
  )

  // FEE-PER-CLASS — count students by their EXACT className so each
  // per-class card reports only the students in that specific class
  // (e.g. Class 9 card → 4 students, not 8 Secondary students).
  // `studentsByLevel` is kept as a fallback for structures with a
  // className that no real student has (e.g. custom structures,
  // duplicated drafts whose className is "Class 9 — Draft Copy").
  const studentsByClassName = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of students) {
      if (s.status !== 'Active') continue
      counts[s.className] = (counts[s.className] ?? 0) + 1
    }
    return counts
  }, [students])

  const studentsByLevel = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of students) {
      if (s.status !== 'Active') continue
      const level =
        s.className.includes('11') || s.className.includes('12') ? 'Senior Secondary' :
        s.className.includes('9') || s.className.includes('10') ? 'Secondary' :
        s.className.match(/Class [6-8]/) ? 'Middle' :
        s.className.match(/Class [1-5]/) ? 'Primary' : 'Pre-Primary'
      counts[level] = (counts[level] ?? 0) + 1
    }
    return counts
  }, [students])

  // STRUCT-SESSION — header chip: how many of the school's active
  // academic classes have a fee structure bound for the CURRENT session.
  const activeClassCount = useMemo(() => {
    const sessionStructs = feeStructures.filter(
      (s) => (s.academicYear ?? CURRENT_ACADEMIC_YEAR) === CURRENT_ACADEMIC_YEAR,
    )
    const ids = new Set<string>()
    for (const s of sessionStructs) {
      if (s.classId) ids.add(s.classId)
      if (s.applicableClassIds) for (const id of s.applicableClassIds) ids.add(id)
    }
    return ids.size
  }, [feeStructures])

  // STRUCT-REV — the live revision for each structure (Pending Approval or
  // Threshold Reached) so cards can carry a progress pill.
  const activeRevisionByStructure = useMemo(() => {
    const m = new Map<string, StructureRevision>()
    for (const r of structureRevisions) {
      if (r.status === 'Pending Approval' || r.status === 'Threshold Reached') {
        m.set(r.structureId, r)
      }
    }
    return m
  }, [structureRevisions])

  // STRUCT-SESSION — auto-sync: ensure every active class of the CURRENT
  // session has a fee structure (Draft / Not Configured). Idempotent —
  // runs on mount and only fills gaps (new classes included, PART 23).
  useEffect(() => {
    const r = syncFeeStructuresForSession('System')
    if (r.created > 0) {
      toast.info(`${r.created} class structure${r.created === 1 ? '' : 's'} auto-created for ${CURRENT_ACADEMIC_YEAR}`, {
        description: 'Open each Not configured card to set amounts, then publish.',
      })
    }
    // Run once on mount — the sync is idempotent and only fills gaps.
  }, [syncFeeStructuresForSession])

  const openStructure = feeStructures.find((s) => s.id === openStructureId) ?? null

  // Per-card actions
  const handleDuplicate = (s: FeeStructureConfig) => {
    const newId = createFeeStructure({
      category: `${s.category} (Copy)`,
      className: `${s.className} — Draft Copy`,
      classLevel: s.classLevel,
      heads: s.components.map((h) => ({ ...h, id: `FH-${Date.now().toString(36)}-${h.id}` })),
      effectiveFrom: new Date().toISOString().split('T')[0],
      notes: `Duplicated from ${s.id} v${s.version}`,
      actor: 'Principal',
    })
    if (newId) toast.success('Structure duplicated as draft', { description: `New structure ${newId} created.` })
  }

  // PHASE 5 — Bulk Apply to Level. Computes the list of OTHER classes in
  // the same level as the source structure (excluding classes already
  // covered by their own per-class structure). Returns the list so the
  // confirmation dialog can show the user exactly which classes will get
  // a new draft structure. The actual mutation runs in `confirmBulkApply`.
  const computeBulkApplyTargets = (source: FeeStructureConfig) => {
    const existingClassIds = new Set<string>()
    for (const fs of feeStructures) {
      if (fs.classId) existingClassIds.add(fs.classId)
      if (fs.applicableClassIds) for (const id of fs.applicableClassIds) existingClassIds.add(id)
    }
    return ACADEMIC_CLASSES
      .filter((c) => c.level === source.classLevel && !existingClassIds.has(c.id))
      .filter((c) => !(source.applicableClassIds ?? []).includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, level: c.level, stream: c.stream }))
  }

  const confirmBulkApply = (source: FeeStructureConfig) => {
    const targets = computeBulkApplyTargets(source)
    if (targets.length === 0) {
      toast.info('No uncovered classes', {
        description: `All classes in the ${source.classLevel} level already have a per-class structure.`,
      })
      setBulkApplyOpen(null)
      return
    }
    setBulkApplySubmitting(true)
    // Slight delay so the user sees the "Working…" state on the dialog.
    setTimeout(() => {
      const created: string[] = []
      for (const t of targets) {
        const newId = createFeeStructure({
          category: source.classLevel,
          className: t.name,
          classLevel: source.classLevel,
          heads: source.components.map((h) => ({ ...h, id: `FH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${h.id}` })),
          effectiveFrom: new Date().toISOString().split('T')[0],
          notes: `Bulk-applied from ${source.id} (${source.className}) via Bulk Apply to Level.`,
          actor: 'Principal',
          classId: t.id,
          applicableClassIds: [t.id],
          ...(source.examFeeSchedule ? { examFeeSchedule: source.examFeeSchedule } : {}),
        })
        if (newId) created.push(newId)
      }
      setBulkApplySubmitting(false)
      setBulkApplyOpen(null)
      toast.success(`Applied to ${created.length} classes`, {
        description: `${source.className}'s structure copied to ${targets.map((t) => t.name).join(', ')} as drafts. Review + publish each to make them live.`,
      })
    }, 350)
  }

  const handleArchive = (s: FeeStructureConfig) => {
    // Find the current version
    const current = versions.find((v) => v.structureId === s.id && v.status === 'current')
    if (!current) {
      toast.error('No current version to archive')
      return
    }
    if (!confirm(`Archive the CURRENT version (v${current.version}) of ${s.className}?\n\nThis will leave the structure with NO current version — only do this if you have published a replacement.`)) return
    archiveFeeStructureVersion(current.id, 'Principal')
    toast.info('Version archived', { description: `v${current.version} of ${s.className} archived.` })
  }

  // SaaS-STAGE-2A (Task 7-b) — the permanent-delete action is REMOVED from
  // the principal UI entirely (fee_structure_delete is platform-reserved:
  // ALWAYS false for school roles). Principals archive structures; the
  // platform purges after the 30-day retention window.

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* SaaS-STAGE-1 — Catalogue Management content-area swap: while the
          catalogue is open it REPLACES this tab's content (toolbar + grid).
          The app shell — sidebar, application header, Fee Management tabs —
          is untouched. "Back to Fee Structures" returns with list state
          preserved. */}
      {catalogueOpen ? (
        <FeesCatalogueView onBack={() => setCatalogueOpen(false)} />
      ) : (
      <>
      {/* UX-REFINE — the "Fee Structures" tab already establishes context,
          so the page opens straight into useful controls: summary badges
          left, Archived filter + New Structure right. No repeated page
          heading, no explanatory copy. Mirrors Salary Structure. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
            <Layers className="h-2.5 w-2.5" /> {feeStructures.length} structure{feeStructures.length === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40">
            <GraduationCap className="h-2.5 w-2.5" /> {activeClassCount} active class{activeClassCount === 1 ? '' : 'es'}
          </Badge>
          {/* SaaS-STAGE-1 — the active academic session is DERIVED (read-only,
              lib/academic-session.ts): the Principal selects the class; the
              system supplies the session. Never hand-typed. */}
          <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-muted/40" title="Active academic session (read-only, from school configuration)">
            <CalendarCheck2 className="h-2.5 w-2.5" /> {session.label ?? 'Session not set'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* SaaS-STAGE-1 — the ONLY catalogue entry point. Opens the full
              content-area Catalogue Management view (no modal).
              SaaS-STAGE-2A (Task 7-b) — hidden (not disabled) unless the
              school's config enables the fee_catalogue sub-feature AND the
              principal holds fee_catalogue_manage. */}
          {catalogueAvailable && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={openCatalogue}>
              <BookOpen className="h-3.5 w-3.5" /> Catalogue
            </Button>
          )}
          {archivedCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide Archived' : `Archived (${archivedCount})`}
            </Button>
          )}
          {/* SaaS-STAGE-2A (Task 7-b) — the primary CTA renders only when
              the principal holds fee_structure_edit; when absent a muted
              inline notice chip explains why (no disabled fake button). */}
          {perms.fee_structure_edit ? (
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openCreateDrawer}>
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


      {/* Structure grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {visibleStructures.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3">
            <ModuleEmptyState
              className="m-0 py-8"
              icon={<Layers className="h-5 w-5" aria-hidden />}
              title="No structures in this view"
              description="Try a different filter or create a new fee structure."
            />
          </div>
        )}
        {visibleStructures.map((f, i) => {
          // FEE-PER-CLASS — `category` and `classLevel` are now the same
          // value (the spec says "category can be removed or set to the
          // same value as classLevel"); fall back to `classLevel` when
          // `category` is empty (e.g. a draft created before the
          // FEE-PER-CLASS migration may have an empty category). Strip
          // the ' (Copy)' suffix that Duplicate-as-draft appends so
          // copies keep the parent's tone.
          const accentKey = (f.category || f.classLevel).replace(' (Copy)', '')
          const accent = CATEGORY_COLORS[accentKey] ?? CATEGORY_COLORS['Primary']
          // FEE-PER-CLASS — count students by EXACT className first
          // (e.g. Class 9 card → 4 Class 9 students). Falls back to
          // classLevel substring matching when no student has the
          // exact className (e.g. a duplicated draft with className
          // "Class 9 — Draft Copy").
          const studentsCount =
            studentsByClassName[f.className] ?? studentsByLevel[f.classLevel] ?? 0
          const status = structureStatus.get(f.id) ?? 'current'
          const activeHeads = f.components.filter((c) => c.active)
          // The Annual figure excludes opt-in Transport — the tiny caveat
          // under the metric only renders when a transport head exists.
          const hasTransportHead = activeHeads.some((h) => h.category === 'Transport')
          // TASK 2-c — main fee-heads preview: top 3 ACTIVE non-transport
          // heads ranked by annual contribution (amount × frequency
          // multiplier). Monthly heads read "{amount}/mo" so frequency
          // semantics stay visible on the card; everything else shows the
          // annualised figure. Opt-in Transport is excluded — it never
          // contributes to the base annual total.
          const rankedPreviewHeads = activeHeads
            .filter((h) => h.category !== 'Transport')
            .sort((a, b) =>
              (b.amount * (FREQUENCY_MULTIPLIER[b.frequency] ?? 1)) -
              (a.amount * (FREQUENCY_MULTIPLIER[a.frequency] ?? 1)))
          const headsPreview = rankedPreviewHeads
            .slice(0, 3)
            .map((h) => h.frequency === 'Monthly'
              ? `${h.name} ${formatINR(h.amount)}/mo`
              : `${h.name} ${formatINR(h.amount * (FREQUENCY_MULTIPLIER[h.frequency] ?? 1))}`)
            .join(' · ')
          // SaaS-STAGE-2A (Task 7-b) — the same top-3 preview, rendered as
          // inline items so OPTIONAL heads (mandatory === false, e.g. Books
          // & Material / Uniform & Sports Kit) can carry a tiny muted
          // "Optional" chip next to the head name. Never auto-billed.
          const previewHeadItems = rankedPreviewHeads
            .slice(0, 3)
            .map((h) => ({
              id: h.id,
              label: h.frequency === 'Monthly'
                ? `${h.name} ${formatINR(h.amount)}/mo`
                : `${h.name} ${formatINR(h.amount * (FREQUENCY_MULTIPLIER[h.frequency] ?? 1))}`,
              optional: h.mandatory === false,
            }))
          // TASK 2-c — session exam fees summed across planned
          // examinations. An EMPTY examFeeSchedule (seeded on Class 6/7)
          // means intentionally unconfigured → muted "Not configured".
          const examTotal = computeExamFeeTotal(f.examFeeSchedule)
          const examItems = (f.examFeeSchedule ?? []).length
          return (
        <motion.div
          key={f.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.03 }}
          className={cn(
            'rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-emerald-500/30 hover:shadow-md transition-all cursor-pointer group',
            status === 'archived' && 'opacity-75',
          )}
          onClick={() => setOpenStructureId(f.id)}
        >
          {/* Header — level-toned chip + class name + status/version pill.
              Title hierarchy matches the Salary Structure card: semibold
              name, muted 10px subtitle, quiet outline badge right. */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent)}>
                <Layers className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                {/* FEE-PER-CLASS — the card title IS the class name;
                    stream labels wrap onto two lines instead of
                    clipping. Subtitle is the academic level. */}
                <p className="text-sm font-semibold leading-snug line-clamp-2">{f.className}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{f.classLevel}</p>
              </div>
            </div>
            <StructureStatusBadge status={status} version={f.version} />
          </div>

          {/* STRUCT-REV — live mid-session revision progress pill. */}
          {activeRevisionByStructure.get(f.id) && (
            <RevisionPill revision={activeRevisionByStructure.get(f.id)!} />
          )}
          {f.notConfigured && f.components.length === 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 -mt-1">
              <AlertTriangle className="h-3 w-3" /> Not configured — set amounts, then publish.
            </p>
          )}

          {/* Metrics — Annual is the card's key figure (emerald accent,
              matching Salary's Net box; BASE total, excludes opt-in
              Transport — the caveat only shows when a transport head
              actually exists). Heads/Students stay neutral. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-500/[0.07] px-2.5 py-1.5" title="Excludes opt-in Transport">
              <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Annual</p>
              <p className="text-sm font-bold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">{formatINR(f.annual)}</p>
              {hasTransportHead && <p className="text-[8px] text-muted-foreground/80 mt-0.5">excl. transport</p>}
            </div>
            <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
              <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Heads</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{activeHeads.length}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
              <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground">Students</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{studentsCount}</p>
            </div>
          </div>

          {/* Breakdown — compact scan block (Salary's component-summary
              recipe): top heads by annual contribution, effective date,
              session exam fees. Every card renders all three lines so
              heights stay consistent. */}
          <div className="space-y-1 text-[10px] leading-relaxed min-h-[2rem]">
            <div
              className="flex items-center gap-x-1 gap-y-0.5 flex-wrap text-muted-foreground"
              title={headsPreview || 'No active heads yet'}
            >
              {previewHeadItems.length === 0 ? (
                <span>No active heads yet</span>
              ) : (
                previewHeadItems.map((item, idx) => (
                  <span key={item.id} className="inline-flex items-center gap-1 min-w-0">
                    {idx > 0 && <span className="text-muted-foreground/50">·</span>}
                    <span className="truncate">{item.label}</span>
                    {item.optional && (
                      <span className="shrink-0 rounded bg-slate-500/10 px-1 py-px text-[10px] leading-4 font-medium text-slate-600 dark:text-slate-300">
                        Optional
                      </span>
                    )}
                  </span>
                ))
              )}
            </div>
            <p className="flex items-center gap-1 text-muted-foreground truncate">
              <Calendar className="h-3 w-3 shrink-0" /> Effective from {formatDate(f.effectiveFrom)}
            </p>
            <p className={cn('truncate', examTotal > 0 ? 'text-muted-foreground' : 'text-muted-foreground/70 italic')}>
              Session exams: {examTotal > 0 ? `${formatINR(examTotal)} · ${examItems} planned` : 'Not configured'}
            </p>
          </div>

          {/* Actions — clear primary (Open →) + overflow right. The
              redundant per-card History button is REMOVED (SaaS-STAGE-1):
              version history already lives inside the structure detail
              (History button) and stays reachable from the More menu. */}
          <div className="flex items-center gap-1.5 pt-2 mt-auto border-t border-border/40" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setOpenStructureId(f.id)}
            >
              Open <ChevronRight className="h-3 w-3" />
            </Button>
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="More">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setOpenStructureId(f.id)}>
                  <FileText className="h-3 w-3 mr-2" /> Open detail
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryStructure(f)}>
                  <History className="h-3 w-3 mr-2" /> View history
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate(f)}>
                  <Copy className="h-3 w-3 mr-2" /> Duplicate as draft
                </DropdownMenuItem>
                {/* PHASE 5 — Bulk Apply to Level. Creates draft
                    structures for every uncovered class in the
                    same level. Confirmation dialog shows the exact
                    list of target classes before any mutation.
                    SaaS-STAGE-2A (Task 7-b) — hidden when the school's
                    configuration disables fee_structure_edit (it creates
                    drafts); the store enforces the same rule. */}
                {perms.fee_structure_edit && (
                  <DropdownMenuItem
                    onClick={() => setBulkApplyOpen(f)}
                    className="text-emerald-700 dark:text-emerald-300 focus:text-emerald-800"
                  >
                    <GraduationCap className="h-3 w-3 mr-2" /> Bulk apply to {f.classLevel} level…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleArchive(f)}
                  className="text-amber-600 focus:text-amber-700"
                >
                  <Archive className="h-3 w-3 mr-2" /> Archive current version
                </DropdownMenuItem>
                {/* SaaS-STAGE-2A (Task 7-b) — the "Delete structure…" menu
                    item is REMOVED for principals: permanent delete is
                    platform-reserved (fee_structure_delete is ALWAYS false
                    for school roles). Schools archive; the platform purges
                    after the 30-day retention window. */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>
          )
        })}

        {/* UX-REFINE — the standalone dashed "Create New Structure" tile
            was removed: creation now lives in the toolbar's primary
            "New Structure" button (same drawer, mode='create'). */}
      </div>
      </>
      )}

      {/* Detail drawer — existing structure */}
      <AnimatePresence>
        {openStructure && (
          <FeesStructuresDetailDrawer
            open={true}
            structure={openStructure}
            onClose={() => setOpenStructureId(null)}
            onStructureDeleted={handleStructureDeleted}
            onNavigate={onNavigate}
          />
        )}
      </AnimatePresence>

      {/* Detail drawer — create mode. The drawer builds a blank
          template internally; on Save Draft / Publish it calls
          `onCreated(id)` which closes create-mode and opens the same
          drawer in view mode with the new structure id (transitioning
          seamlessly from creation to editing/publishing). */}
      <AnimatePresence>
        {createMode && (
          <FeesStructuresDetailDrawer
            open={true}
            mode="create"
            onClose={closeCreateDrawer}
            onCreated={(id) => {
              setCreateMode(false)
              setOpenStructureId(id)
            }}
            onNavigate={onNavigate}
          />
        )}
      </AnimatePresence>

      {/* History dialog (opened from card). Render-guard: the dialog's body
          reads structure.id even while closed, so a school with ZERO
          structures (historyStructure null + feeStructures empty) must not
          mount it — that crashed the whole tab on the empty-data demo. */}
      {(historyStructure ?? feeStructures[0]) && (
        <FeesStructuresHistoryDialog
          open={!!historyStructure}
          structure={historyStructure ?? feeStructures[0]}
          onClose={() => setHistoryStructure(null)}
          onRevert={(targetVersionId) => {
            if (!historyStructure) return
            const target = versions.find((v) => v.id === targetVersionId)
            if (!target) return
            const reason = prompt(`Roll back ${historyStructure.className} to Version ${target.version}?\n\nThis creates a NEW version with the heads from v${target.version}.\n\nReason (required):`)
            if (!reason || reason.trim().length < 5) {
              toast.error('Reason is required (min 5 chars)')
              return
            }
            const newId = useFeeStore.getState().revertFeeStructureVersion(historyStructure.id, targetVersionId, reason.trim(), 'Principal')
            if (newId) {
              toast.success('Rolled back successfully', {
                description: `${historyStructure.className} rolled back to v${target.version}. New version is now current.`,
              })
              setHistoryStructure(null)
            }
          }}
          onArchive={(versionId) => {
            archiveFeeStructureVersion(versionId, 'Principal')
            toast.info('Version archived', { description: `Version archived from ${historyStructure?.className}.` })
          }}
        />
      )}

      {/* SaaS-STAGE-2A (Task 7-b) — the permanent-delete confirmation
          dialog was removed with the "Delete structure…" menu item: the
          capability is platform-reserved and the UI never offers it. */}

      {/* PHASE 5 — Bulk Apply to Level confirmation dialog. Shows the
          exact list of target classes (uncovered classes in the same
          level as the source structure) before any mutation. */}
      <AnimatePresence>
        {bulkApplyOpen && (() => {
          const targets = computeBulkApplyTargets(bulkApplyOpen)
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label={`Bulk apply to ${bulkApplyOpen.classLevel} level`}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => !bulkApplySubmitting && setBulkApplyOpen(null)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 8 }}
                transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-border bg-emerald-500/5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                      <GraduationCap className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold truncate">Bulk Apply to {bulkApplyOpen.classLevel} Level</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Copy <span className="font-semibold text-foreground">{bulkApplyOpen.className}</span>'s fee structure to all uncovered classes in the same level
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  {targets.length === 0 ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 flex items-start gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                      <p className="text-[12px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                        All classes in the <span className="font-semibold">{bulkApplyOpen.classLevel}</span> level
                        already have their own per-class structure. Nothing to apply.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        This will create a <span className="font-semibold text-foreground">draft</span> fee structure
                        for each of the following <span className="font-semibold text-foreground">{targets.length}</span> classes,
                        copying heads + amounts + exam-fee schedule from <span className="font-semibold text-foreground">{bulkApplyOpen.className}</span>:
                      </p>
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1 max-h-44 overflow-y-auto">
                        {targets.map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-[11px]">
                            <span className="font-medium">{t.name}</span>
                            <span className="text-muted-foreground tabular-nums">{t.id}{t.stream ? ` · ${t.stream}` : ''}</span>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1.5 mb-1">
                          <AlertTriangle className="h-3.5 w-3.5" /> What this does NOT do
                        </p>
                        <ul className="text-[10px] text-muted-foreground space-y-0.5 ml-5 list-disc">
                          <li>Does NOT publish — each draft must be reviewed + published separately</li>
                          <li>Does NOT delete or modify existing structures</li>
                          <li>Does NOT touch existing student fee accounts until each draft is published</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
                <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setBulkApplyOpen(null)}
                    disabled={bulkApplySubmitting}
                  >
                    {targets.length === 0 ? 'Close' : 'Cancel'}
                  </Button>
                  {targets.length > 0 && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => confirmBulkApply(bulkApplyOpen)}
                      disabled={bulkApplySubmitting}
                    >
                      {bulkApplySubmitting ? (
                        <>
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                          Applying…
                        </>
                      ) : (
                        <>
                          <GraduationCap className="h-3.5 w-3.5" /> Apply to {targets.length} classes
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      
    </div>
  )
}

// ─── STRUCT-REV — revision progress pill (PART 12) ─────────────────────

export function RevisionPill({ revision }: { revision: StructureRevision }) {
  const approved = Object.values(revision.responses).filter((v) => v === 'Approved').length
  const declined = Object.values(revision.responses).filter((v) => v === 'Declined').length
  const pct = revision.affectedStudentIds.length > 0
    ? Math.round((approved / revision.affectedStudentIds.length) * 1000) / 10
    : 0
  const reached = revision.status === 'Threshold Reached'
  return (
    <div
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-[10px] flex items-center justify-between gap-2',
        reached
          ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
          : 'border-amber-500/30 bg-amber-500/[0.06]',
      )}
      title={`Revision v${revision.toVersion} — ${approved}/${revision.affectedStudentIds.length} approved · ${declined} declined · 60% threshold required`}
    >
      <span className={cn('font-semibold', reached ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>
        Revision v{revision.toVersion} · {revision.status}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {approved}/{revision.affectedStudentIds.length} · {pct}%
      </span>
    </div>
  )
}
