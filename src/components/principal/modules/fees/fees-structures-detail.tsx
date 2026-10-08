'use client'

/**
 * FeesStructuresDetailDrawer — slide-from-right drawer for a single Fee
 * Structure, wired to the CANONICAL SERVER API (Phase 7-D).
 *
 * DATA — GET /api/fees/structures/[id] (full structure + ALL versions,
 * heads Decimal→num()). No client store, no localStorage, no mock data.
 *
 * ACTIONS — exactly what the server supports, per status:
 *   draft     → Edit heads (PATCH, heads replaced atomically in one
 *               transaction) · Publish (POST .../publish) · Delete draft
 *               (DELETE hard-deletes drafts)
 *   scheduled → Publish (the publish route promotes draft/scheduled→current)
 *   current   → Archive with reason (DELETE soft-archives non-drafts)
 *   archived  → read-only view
 *
 * DROPPED (client-store affordances with NO server equivalent — never
 * faked): Schedule (no route creates a scheduled structure), Roll back /
 * Revert (no server revert), temporary edit window + 60%-approval
 * revisions (no server workflow), Duplicate-as-draft / Bulk-apply (the
 * server create contract is one real class per structure, FK-validated).
 *
 * MONEY — head amounts are STRINGS while editing and travel to PATCH
 * exactly as typed (server zod: z.coerce.number().min(0).max(500000));
 * display uses formatINRAmount (Decimal-safe). No client-derived totals.
 *
 * HISTORY — versions render read-only (immutable FeeStructureVersion
 * snapshots); publishing is the only version-producing action.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Pencil, Trash2, History, Archive, CloudUpload, AlertTriangle,
  Calendar, CalendarRange, Layers, FileClock, Loader2, Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import {
  useFeeStructureDetail,
  useUpdateFeeStructureDraft,
  usePublishFeeStructure,
  useArchiveStructure,
  useDeleteDraft,
  useFeeCatalogue,
  parseVersionSnapshot,
  parseAmountInput,
  MAX_HEADS,
  type FeeStructureDTO,
  type FeeHeadInput,
} from './fees-structures-hooks'
import {
  formatINRAmount,
  VersionStatusPill,
  DraftHeadsEditor,
  newRowKey,
  type DraftHead,
} from './fees-structures-shared'

/** The mandated publish-confirmation copy (historical preservation). */
const PUBLISH_CONFIRM_COPY =
  'Publishing makes this the current structure for the class; the previous current structure is archived and versioned — historical records are never altered.'

export interface DetailDrawerProps {
  open: boolean
  /** Structure id — the drawer fetches the full detail from the server. */
  structureId: string | null
  onClose: () => void
  /** Notified after any successful mutation so the parent list reloads. */
  onChanged?: () => void
  /** Notified when the structure was deleted (draft hard-delete). */
  onDeleted?: (structureId: string) => void
  /** Opens the full (read-only) version-history dialog. */
  onOpenHistory?: (structureId: string, className: string) => void
}

export function FeesStructuresDetailDrawer({
  open,
  structureId,
  onClose,
  onChanged,
  onDeleted,
  onOpenHistory,
}: DetailDrawerProps) {
  const { structure, loading, error, reload } = useFeeStructureDetail(open ? structureId : null)
  const { catalogue } = useFeeCatalogue()

  const updateDraft = useUpdateFeeStructureDraft()
  const publishStructure = usePublishFeeStructure()
  const archiveStructure = useArchiveStructure()
  const deleteDraft = useDeleteDraft()

  // ─── local state ───────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [workingHeads, setWorkingHeads] = useState<DraftHead[]>([])
  const [headErrors, setHeadErrors] = useState<Record<string, string>>({})
  const [publishOpen, setPublishOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Escape closes the drawer (backdrop click already does), never while a
  // nested confirm dialog is open.
  useDismissOnEscape(() => {
    if (publishOpen || archiveOpen || deleteOpen) return
    onClose()
  }, open)

  // Reset local state when the drawer closes / the structure changes.
  useEffect(() => {
    if (!open) return
    setEditing(false)
    setHeadErrors({})
    setPublishOpen(false)
    setArchiveOpen(false)
    setArchiveReason('')
    setDeleteOpen(false)
  }, [open, structureId])

  // Seed the working copy from the LIVE server heads whenever we are not
  // editing (so post-mutation reloads refresh the table immediately).
  useEffect(() => {
    if (!structure) return
    if (editing) return
    setWorkingHeads(
      structure.heads.map((h) => ({
        key: h.id,
        catalogueId: h.catalogueId,
        name: h.name,
        category: h.category,
        amount: String(h.amount),
        frequency: h.frequency,
        mandatory: h.mandatory,
        active: h.active,
      })),
    )
  }, [structure, editing])

  const canEditHeads = structure?.status === 'draft'
  const canPublish = structure?.status === 'draft' || structure?.status === 'scheduled'
  const canArchive = structure?.status === 'current' || structure?.status === 'scheduled'
  const canDelete = structure?.status === 'draft'

  // ─── draft editing helpers ─────────────────────────────────────────
  const startEditing = () => {
    if (!structure) return
    setWorkingHeads(
      structure.heads.map((h) => ({
        key: h.id,
        catalogueId: h.catalogueId,
        name: h.name,
        category: h.category,
        amount: String(h.amount),
        frequency: h.frequency,
        mandatory: h.mandatory,
        active: h.active,
      })),
    )
    setHeadErrors({})
    setEditing(true)
  }

  const discardEditing = () => {
    if (!structure) return
    setWorkingHeads(
      structure.heads.map((h) => ({
        key: h.id,
        catalogueId: h.catalogueId,
        name: h.name,
        category: h.category,
        amount: String(h.amount),
        frequency: h.frequency,
        mandatory: h.mandatory,
        active: h.active,
      })),
    )
    setHeadErrors({})
    setEditing(false)
  }

  const patchHead = (key: string, patch: Partial<DraftHead>) => {
    setWorkingHeads((prev) => prev.map((h) => (h.key === key ? { ...h, ...patch } : h)))
  }

  const removeHead = (key: string) => {
    setWorkingHeads((prev) => prev.filter((h) => h.key !== key))
    setHeadErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const addHead = (head: Omit<DraftHead, 'key'>) => {
    setWorkingHeads((prev) => [...prev, { ...head, key: newRowKey() }])
  }

  /** Validate every working head against the server contract. Returns the
   *  POST/PATCH-ready heads array, or null (errors recorded in headErrors). */
  const validateHeads = (): FeeHeadInput[] | null => {
    if (!structure) return null
    const errors: Record<string, string> = {}
    const seen = new Set<string>()
    const out: FeeHeadInput[] = []
    for (const h of workingHeads) {
      const name = h.name.trim()
      if (!name) {
        errors[h.key] = 'Name is required'
        continue
      }
      const lower = name.toLowerCase()
      if (seen.has(lower)) {
        errors[h.key] = 'Duplicate head name'
        continue
      }
      seen.add(lower)
      const amount = parseAmountInput(h.amount)
      if (!amount.ok) {
        errors[h.key] = amount.error
        continue
      }
      out.push({
        catalogueId: h.catalogueId,
        name,
        category: h.category || 'Other',
        amount: amount.value,
        frequency: h.frequency || 'Monthly',
        mandatory: h.mandatory,
        active: h.active,
      })
    }
    setHeadErrors(errors)
    if (Object.keys(errors).length > 0) {
      toast.error('Some fee heads need attention', {
        description: 'Fix the highlighted rows before saving.',
      })
      return null
    }
    return out
  }

  const hasEdits = useMemo(() => {
    if (!structure) return false
    if (workingHeads.length !== structure.heads.length) return true
    for (const h of workingHeads) {
      const src = structure.heads.find((x) => x.id === h.key)
      if (!src) return true
      if (
        h.name !== src.name ||
        h.amount !== String(src.amount) ||
        h.frequency !== src.frequency ||
        h.mandatory !== src.mandatory ||
        h.active !== src.active ||
        (h.catalogueId ?? null) !== (src.catalogueId ?? null)
      ) return true
    }
    return false
  }, [workingHeads, structure])

  // ─── mutations ─────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (!structure) return
    if (workingHeads.length > MAX_HEADS) {
      toast.error(`A fee structure may have at most ${MAX_HEADS} heads`)
      return
    }
    const heads = validateHeads()
    if (!heads) return
    try {
      await updateDraft.update(structure.id, { heads })
      toast.success('Draft saved', { description: `${structure.className} — heads updated on the server.` })
      setEditing(false)
      reload()
      onChanged?.()
    } catch (e) {
      // Surface the server's publicMessage verbatim (AppError envelope).
      toast.error('Could not save draft', { description: (e as { message?: string })?.message ?? undefined })
    }
  }

  const handlePublish = async () => {
    if (!structure) return
    try {
      const promoted = await publishStructure.publish(structure.id)
      toast.success(`Published — v${promoted.version} is now current`, {
        description: `${structure.className}: the previous current structure (if any) was archived and versioned.`,
      })
      setPublishOpen(false)
      reload()
      onChanged?.()
    } catch (e) {
      toast.error('Could not publish', { description: (e as { message?: string })?.message ?? undefined })
    }
  }

  const handleArchive = async () => {
    if (!structure) return
    const reason = archiveReason.trim()
    if (reason.length < 3) {
      toast.error('An archive reason is required', { description: 'Provide a short reason for the audit trail.' })
      return
    }
    try {
      await archiveStructure.archive(structure.id, reason)
      toast.info('Structure archived', { description: `${structure.className} archived — the record is kept for audit.` })
      setArchiveOpen(false)
      setArchiveReason('')
      reload()
      onChanged?.()
    } catch (e) {
      toast.error('Could not archive', { description: (e as { message?: string })?.message ?? undefined })
    }
  }

  const handleDeleteDraft = async () => {
    if (!structure) return
    try {
      await deleteDraft.remove(structure.id)
      toast.success('Draft deleted', { description: `${structure.className} draft removed permanently.` })
      setDeleteOpen(false)
      onDeleted?.(structure.id)
      onChanged?.()
    } catch (e) {
      toast.error('Could not delete draft', { description: (e as { message?: string })?.message ?? undefined })
    }
  }

  // ─── render ────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={structure ? `Fee structure — ${structure.className}` : 'Fee structure'}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => {
            if (publishOpen || archiveOpen || deleteOpen) return
            onClose()
          }}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="absolute right-0 top-0 h-full w-full max-w-xl bg-card border-l border-border shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                    <Layers className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold truncate">{structure?.className ?? 'Fee structure'}</h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {structure ? `${structure.classLevel} · v${structure.version}` : 'Loading…'}
                    </p>
                    {structure && <div className="mt-1.5"><VersionStatusPill status={structure.status} /></div>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close detail drawer">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading structure from server…
                </div>
              )}
              {error && !loading && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-700 dark:text-rose-300" role="alert">
                  {error}
                </div>
              )}
              {structure && !loading && (
                <>
                  {/* Lifecycle meta — server fields only */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <MetaTile icon={<Calendar className="h-2.5 w-2.5" />} label="Effective from" value={formatDate(structure.effectiveFrom ?? '')} />
                    <MetaTile icon={<CalendarRange className="h-2.5 w-2.5" />} label="Effective to" value={formatDate(structure.effectiveTo ?? '')} />
                    <MetaTile label="Published" value={formatDate(structure.publishedAt ?? '')} />
                    <MetaTile label="Heads" value={`${structure.heads.length}`} mono />
                    <MetaTile label="Transactions" value={`${structure._count?.transactions ?? 0}`} mono />
                    <MetaTile label="Created" value={formatDate(structure.createdAt)} />
                  </div>

                  {structure.archivedReason && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300" role="note">
                      <span className="font-semibold">Archived: </span>
                      {structure.archivedReason}
                    </div>
                  )}

                  {structure.status === 'archived' && (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                      <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                      This structure is archived and read-only. Historical records are never altered — create a new
                      draft for this class to publish a replacement.
                    </div>
                  )}

                  {/* Fee heads */}
                  <section aria-label="Fee heads">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fee heads</h4>
                      {canEditHeads && !editing && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={startEditing}>
                          <Pencil className="h-3 w-3" /> Edit heads
                        </Button>
                      )}
                      {editing && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Editing draft — not yet saved
                        </span>
                      )}
                    </div>

                    {editing ? (
                      <DraftHeadsEditor
                        heads={workingHeads}
                        errors={headErrors}
                        catalogue={catalogue}
                        onPatch={patchHead}
                        onRemove={removeHead}
                        onAdd={addHead}
                      />
                    ) : (
                      <HeadsTable structure={structure} />
                    )}
                  </section>

                  {/* Version history (immutable snapshots, read-only) */}
                  <section aria-label="Version history">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Version history
                      </h4>
                      {structure.versions.length > 0 && onOpenHistory && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => onOpenHistory(structure.id, structure.className)}
                        >
                          <History className="h-3 w-3" /> Full history
                        </Button>
                      )}
                    </div>
                    {structure.versions.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        No published versions yet — a version snapshot is recorded when this structure is published.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {structure.versions.slice(0, 5).map((v) => {
                          const snap = parseVersionSnapshot(v.snapshot)
                          return (
                            <div key={v.id} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold">v{v.version} · {snap?.heads?.length ?? 0} heads</p>
                                  <p className="text-[10px] text-muted-foreground truncate">
                                    {formatDate(v.publishedAt)}{v.notes ? ` · ${v.notes}` : ''}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline" className="text-[9px] h-4 shrink-0 bg-muted/40 font-normal">Snapshot</Badge>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>

            {/* Footer — actions per status (server contract only) */}
            {structure && !loading && (
              <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center gap-2 flex-wrap">
                {editing ? (
                  <>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => void handleSaveDraft()}
                      disabled={updateDraft.loading || !hasEdits}
                    >
                      {updateDraft.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Save draft
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={discardEditing} disabled={updateDraft.loading}>
                      Discard
                    </Button>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Heads are replaced atomically on the server.
                    </span>
                  </>
                ) : (
                  <>
                    {canPublish && (
                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => setPublishOpen(true)}
                        disabled={publishStructure.loading}
                      >
                        <CloudUpload className="h-3.5 w-3.5" /> Publish
                      </Button>
                    )}
                    {canArchive && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setArchiveOpen(true)} disabled={archiveStructure.loading}>
                        <Archive className="h-3.5 w-3.5" /> Archive…
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={() => setDeleteOpen(true)} disabled={deleteDraft.loading}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete draft…
                      </Button>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {structure.status === 'draft' && 'Draft — edit heads, publish, or delete.'}
                      {structure.status === 'current' && 'Current — archive to replace it with a new published version.'}
                      {structure.status === 'scheduled' && 'Scheduled — publish to promote it to current.'}
                    </span>
                  </>
                )}
              </div>
            )}
          </motion.div>

          {/* ── Publish confirmation ── */}
          {(publishOpen || archiveOpen || deleteOpen) && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm action"
              className="absolute inset-0 z-10 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
              onClick={() => {
                if (publishStructure.loading || archiveStructure.loading || deleteDraft.loading) return
                setPublishOpen(false)
                setArchiveOpen(false)
                setDeleteOpen(false)
              }}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {publishOpen && (
                  <>
                    <div className="px-5 py-4 border-b border-border bg-emerald-500/5">
                      <h3 className="text-sm font-bold">Publish {structure?.className} — v{(structure?.version ?? 0) + 1}?</h3>
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                        {PUBLISH_CONFIRM_COPY}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        The published heads are snapshotted immutably as version {(structure?.version ?? 0) + 1}.
                      </p>
                    </div>
                    <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPublishOpen(false)} disabled={publishStructure.loading}>
                        Cancel
                      </Button>
                      <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => void handlePublish()} disabled={publishStructure.loading}>
                        {publishStructure.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
                        Publish
                      </Button>
                    </div>
                  </>
                )}
                {archiveOpen && (
                  <>
                    <div className="px-5 py-4 border-b border-border bg-amber-500/5">
                      <h3 className="text-sm font-bold">Archive {structure?.className}?</h3>
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                        Archiving leaves the class with no current fee structure until a new draft is published. The
                        archived record is kept for audit — historical records are never altered.
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="archive-reason" className="text-xs">Reason (required)</Label>
                        <Textarea
                          id="archive-reason"
                          value={archiveReason}
                          onChange={(e) => setArchiveReason(e.target.value)}
                          placeholder="e.g. Superseded by the 2027-28 revision"
                          className="text-xs min-h-[70px]"
                          aria-required="true"
                        />
                      </div>
                    </div>
                    <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setArchiveOpen(false)} disabled={archiveStructure.loading}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void handleArchive()} disabled={archiveStructure.loading}>
                        {archiveStructure.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                        Archive structure
                      </Button>
                    </div>
                  </>
                )}
                {deleteOpen && (
                  <>
                    <div className="px-5 py-4 border-b border-border bg-rose-500/5">
                      <h3 className="text-sm font-bold">Delete draft “{structure?.className}”?</h3>
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-[12px] leading-relaxed text-rose-700 dark:text-rose-300">
                        Drafts are permanently deleted (the server only soft-archives published structures). This
                        cannot be undone.
                      </div>
                    </div>
                    <div className="border-t border-border bg-muted/30 px-5 py-3 flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDeleteOpen(false)} disabled={deleteDraft.loading}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-rose-600 hover:text-rose-700" onClick={() => void handleDeleteDraft()} disabled={deleteDraft.loading}>
                        {deleteDraft.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete draft
                      </Button>
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Read-only heads table ─────────────────────────────────────────────

function HeadsTable({ structure }: { structure: FeeStructureDTO }) {
  if (structure.heads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
        No fee heads — {structure.status === 'draft' ? 'edit this draft to add them.' : 'this structure has no heads.'}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 text-[9px] uppercase font-semibold text-muted-foreground tracking-wider">
        <span className="flex-1">Head</span>
        <span className="hidden sm:block w-24">Frequency</span>
        <span className="hidden sm:block w-16">Type</span>
        <span className="text-right w-24 shrink-0">Amount</span>
      </div>
      <div className="divide-y divide-border/40">
        {structure.heads.map((h) => (
          <div key={h.id} className={cn('flex items-center gap-2 px-3 py-1.5 text-[11px] flex-wrap', !h.active && 'opacity-50 line-through')}>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="truncate font-medium">{h.name}</span>
              {!h.catalogueId && (
                <Badge variant="outline" className="text-[7px] py-0 px-1 h-3 text-muted-foreground shrink-0" title="Not bound to the master catalogue">
                  CUSTOM
                </Badge>
              )}
            </div>
            <span className="hidden sm:block w-24 text-muted-foreground">{h.frequency}</span>
            <span className="hidden sm:block w-16 text-[10px] text-muted-foreground">{h.mandatory ? 'Required' : 'Optional'}</span>
            <span className="font-mono tabular-nums text-right font-semibold w-24 shrink-0">{formatINRAmount(h.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Meta tile ─────────────────────────────────────────────────────────

function MetaTile({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={cn('text-xs font-semibold mt-0.5 truncate', mono && 'font-mono tabular-nums')}>{value}</p>
    </div>
  )
}
