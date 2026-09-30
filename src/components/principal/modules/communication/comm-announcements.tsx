'use client'

/**
 * comm-announcements (PHASE 7.5) — the REAL announcement lifecycle.
 *
 * Data source: GET /api/announcements (staff view — includes drafts,
 * scheduled and archived rows with lifecycle fields).
 *
 *   · status chips: Published / Scheduled (PUBLISHED + publishAt>now) /
 *     Draft / Archived
 *   · publish window (publishAt / expiresAt) + image thumbnails
 *   · per-row actions: Publish now · Unpublish · Archive · Edit · Delete
 *     (PATCH /api/announcements/[id], DELETE /api/announcements/[id])
 *   · filters: all / active / scheduled / draft / archived with counts
 *
 * Honesty: skeleton → rows; error → the server's verbatim message with a
 * retry; empty → honest empty state with a compose CTA.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Megaphone, Eye, MoreHorizontal, Clock, Calendar, AlertCircle, AlertTriangle,
  Send, Archive, RotateCcw, Pencil, Trash2, RefreshCw, Loader2, X, Save,
  ImagePlus, CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { uploadWebsiteImage } from '@/components/principal/modules/school-settings/server-api'
import { audienceLabel } from './comm-platform-broadcasts'
import { CommPanel, CommEmptyState } from './comm-shared'
import type { CommTab } from './comm-shared'

// ── row type (mirrors GET /api/announcements staff view) ────────────

interface AnnouncementRow {
  id: string
  title: string
  message: string
  audience: string
  priority: string
  status: string
  publishAt: string | null
  expiresAt: string | null
  imageId: string | null
  imageUrl: string | null
  sender: string
  createdAt: string
  updatedAt: string
  acknowledgedBy: number
  estimatedRecipients: number | null
}

type Lifecycle = 'Published' | 'Scheduled' | 'Draft' | 'Archived'
type AnnouncementFilter = 'all' | 'active' | 'scheduled' | 'draft' | 'archived'

function lifecycleOf(row: AnnouncementRow): Lifecycle {
  if (row.status === 'ARCHIVED') return 'Archived'
  if (row.status === 'DRAFT') return 'Draft'
  if (row.publishAt && new Date(row.publishAt).getTime() > Date.now()) return 'Scheduled'
  return 'Published'
}

const LIFECYCLE_STYLE: Record<Lifecycle, string> = {
  Published: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  Scheduled: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Draft: 'bg-muted text-muted-foreground',
  Archived: 'bg-muted/60 text-muted-foreground line-through',
}

function LifecycleBadge({ value }: { value: Lifecycle }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap', LIFECYCLE_STYLE[value])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {value}
    </span>
  )
}

const PRIORITY_LABEL: Record<string, string> = { URGENT: 'Emergency', HIGH: 'Priority', NORMAL: 'General' }
const PRIORITY_STYLE: Record<string, string> = {
  URGENT: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  HIGH: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  NORMAL: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

// ── API helpers (error envelopes surfaced verbatim) ─────────────────

async function announcementError(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null
  return j?.error ?? 'The announcement server returned an error. Please retry.'
}

async function patchAnnouncement(id: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error: string | null }> {
  try {
    const r = await fetch(`/api/announcements/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!r.ok) return { ok: false, error: await announcementError(r) }
    return { ok: true, error: null }
  } catch {
    return { ok: false, error: 'Announcement server is unreachable — check your connection and retry.' }
  }
}

async function deleteAnnouncement(id: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const r = await fetch(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) return { ok: false, error: await announcementError(r) }
    return { ok: true, error: null }
  } catch {
    return { ok: false, error: 'Announcement server is unreachable — check your connection and retry.' }
  }
}

// ── section ─────────────────────────────────────────────────────────

interface Props {
  onNavigate: (tab: CommTab) => void
}

const AUDIENCE_OPTIONS = ['Whole School', 'All Parents', 'All Students', 'All Teachers', 'All Staff']

export function AnnouncementsSection({ onNavigate }: Props) {
  const [rows, setRows] = useState<AnnouncementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AnnouncementFilter>('all')
  const [moreMenuOpen, setMoreMenuOpen] = useState<string | null>(null)
  const [viewing, setViewing] = useState<AnnouncementRow | null>(null)
  const [editing, setEditing] = useState<AnnouncementRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/announcements', { cache: 'no-store' })
      if (!r.ok) {
        setError(await announcementError(r))
        return
      }
      const j = (await r.json()) as { ok?: boolean; data?: { announcements?: AnnouncementRow[] } }
      setRows(Array.isArray(j.data?.announcements) ? j.data!.announcements! : [])
    } catch {
      setError('Announcement server is unreachable — check your connection and retry.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, scheduled: 0, draft: 0, archived: 0 }
    for (const row of rows ?? []) {
      c.all++
      const l = lifecycleOf(row)
      if (l === 'Published') c.active++
      else if (l === 'Scheduled') c.scheduled++
      else if (l === 'Draft') c.draft++
      else c.archived++
    }
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return (rows ?? []).filter((a) => {
      if (q && !a.title.toLowerCase().includes(q) && !a.message.toLowerCase().includes(q)) return false
      const l = lifecycleOf(a)
      if (filter === 'active' && l !== 'Published') return false
      if (filter === 'scheduled' && l !== 'Scheduled') return false
      if (filter === 'draft' && l !== 'Draft') return false
      if (filter === 'archived' && l !== 'Archived') return false
      return true
    })
  }, [rows, search, filter])

  // ── lifecycle actions ────────────────────────────────────────────

  const runAction = async (row: AnnouncementRow, fn: () => Promise<{ ok: boolean; error: string | null }>, successMessage: string) => {
    setBusyId(row.id)
    setMoreMenuOpen(null)
    const result = await fn()
    setBusyId(null)
    if (result.ok) {
      toast.success(successMessage)
      void load()
    } else {
      toast.error(result.error)
    }
  }

  const handlePublishNow = (row: AnnouncementRow) =>
    runAction(row, () => patchAnnouncement(row.id, { status: 'PUBLISHED', publishAt: new Date().toISOString() }), 'Published — the notice is live now')

  const handleUnpublish = (row: AnnouncementRow) =>
    runAction(row, () => patchAnnouncement(row.id, { status: 'DRAFT' }), 'Unpublished — moved back to drafts')

  const handleArchive = (row: AnnouncementRow) =>
    runAction(row, () => patchAnnouncement(row.id, { status: 'ARCHIVED' }), 'Announcement archived')

  const handleDelete = async (row: AnnouncementRow) => {
    setBusyId(row.id)
    const result = await deleteAnnouncement(row.id)
    setBusyId(null)
    setDeleteTarget(null)
    if (result.ok) {
      toast.success('Announcement deleted')
      void load()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-3 max-w-7xl mx-auto">
      {/* Control row: search + lifecycle filter chips with counts */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements…"
            aria-label="Search announcements"
            className="w-full h-8 pl-3 pr-3 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 flex-wrap" role="group" aria-label="Filter announcements by lifecycle">
          {([
            { value: 'all', label: 'All', count: counts.all },
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'scheduled', label: 'Scheduled', count: counts.scheduled },
            { value: 'draft', label: 'Drafts', count: counts.draft },
            { value: 'archived', label: 'Archived', count: counts.archived },
          ] as Array<{ value: AnnouncementFilter; label: string; count: number }>).map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                'px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
                filter === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
              <span className={cn('ml-1 tabular-nums', filter === f.value ? 'text-primary-foreground/80' : 'text-muted-foreground/70')}>{f.count}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh announcements">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* List */}
      {rows === null && error === null && (
        <CommPanel>
          <div className="p-4 space-y-2" aria-busy="true" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading announcements…
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted/60 animate-pulse" aria-hidden />
            ))}
          </div>
        </CommPanel>
      )}

      {error !== null && (
        <CommPanel>
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Announcements could not be loaded</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{error}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </CommPanel>
      )}

      {rows !== null && error === null && (
        <div className="space-y-2">
          {filtered.map((a, i) => (
            <AnnouncementCard
              key={a.id}
              row={a}
              index={i}
              busy={busyId === a.id}
              onView={() => setViewing(a)}
              onEdit={() => setEditing(a)}
              onPublishNow={() => void handlePublishNow(a)}
              onUnpublish={() => void handleUnpublish(a)}
              onArchive={() => void handleArchive(a)}
              onDelete={() => setDeleteTarget(a)}
              moreMenuOpen={moreMenuOpen === a.id}
              setMoreMenuOpen={(open) => setMoreMenuOpen(open ? a.id : null)}
            />
          ))}
          {filtered.length === 0 && (
            <CommPanel>
              <CommEmptyState
                icon={<Megaphone className="h-6 w-6" />}
                title="No announcements found"
                description={search ? 'Try a different search.' : rows.length === 0 ? 'Create your first announcement to get started.' : 'No announcements match this filter.'}
                action={
                  <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onNavigate('compose')}>
                    <Megaphone className="h-3.5 w-3.5" /> New Announcement
                  </Button>
                }
              />
            </CommPanel>
          )}
        </div>
      )}

      {/* View modal */}
      <AnimatePresence>
        {viewing && (
          <ViewAnnouncementModal
            row={viewing}
            onClose={() => setViewing(null)}
          />
        )}
      </AnimatePresence>

      {/* Edit dialog */}
      {editing && (
        <EditAnnouncementDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Delete announcement?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            “{deleteTarget?.title}” will be permanently removed, together with its read receipts.
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" className="gap-1.5" onClick={() => deleteTarget && void handleDelete(deleteTarget)} disabled={busyId === deleteTarget?.id}>
              {busyId === deleteTarget?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── announcement card ───────────────────────────────────────────────

function AnnouncementCard({
  row: a,
  index,
  busy,
  onView,
  onEdit,
  onPublishNow,
  onUnpublish,
  onArchive,
  onDelete,
  moreMenuOpen,
  setMoreMenuOpen,
}: {
  row: AnnouncementRow
  index: number
  busy: boolean
  onView: () => void
  onEdit: () => void
  onPublishNow: () => void
  onUnpublish: () => void
  onArchive: () => void
  onDelete: () => void
  moreMenuOpen: boolean
  setMoreMenuOpen: (open: boolean) => void
}) {
  useDismissOnEscape(() => setMoreMenuOpen(false), moreMenuOpen)
  const lifecycle = lifecycleOf(a)
  const isUrgent = a.priority === 'URGENT'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-all',
        lifecycle === 'Archived' ? 'opacity-60 border-border' : 'border-border hover:shadow-md',
      )}
    >
      <div className="flex gap-3">
        {/* Icon / image thumb */}
        {a.imageUrl ? (
          <img src={a.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
        ) : (
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            isUrgent ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600',
          )}>
            {isUrgent ? <AlertCircle className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate">{a.title}</h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold', PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.NORMAL)}>
                  {PRIORITY_LABEL[a.priority] ?? a.priority}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-muted/60 text-muted-foreground">
                  {audienceLabel(a.audience)}
                </span>
              </div>
            </div>
            <LifecycleBadge value={lifecycle} />
          </div>

          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{a.message}</p>

          {/* Publish window */}
          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
            <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" /> {formatRelativeTime(a.createdAt)}</span>
            <span>·</span>
            <span>by {a.sender}</span>
            {a.publishAt && (
              <>
                <span>·</span>
                <span className={cn('flex items-center gap-0.5', lifecycle === 'Scheduled' && 'text-amber-600 font-medium')}>
                  <Calendar className="h-2.5 w-2.5" /> {lifecycle === 'Scheduled' ? 'Publishes' : 'Published'} {formatDate(a.publishAt)}
                </span>
              </>
            )}
            {a.expiresAt && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5">Expires {formatDate(a.expiresAt)}</span>
              </>
            )}
            {lifecycle === 'Published' && a.estimatedRecipients !== null && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-emerald-600">
                  <CheckCircle2 className="h-2.5 w-2.5" /> {a.acknowledgedBy}/{a.estimatedRecipients} acknowledged
                </span>
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[8px] font-semibold">
                  {a.sender.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                </div>
              </span>
              <span className="tabular-nums">{a.estimatedRecipients !== null ? `${a.estimatedRecipients.toLocaleString('en-IN')} recipients` : 'Recipients: unknown'}</span>
            </div>

            <div className="flex items-center gap-0.5">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Working…" />}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={onView}>
                <Eye className="h-3 w-3" /> View
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={onEdit} disabled={busy}>
                <Pencil className="h-3 w-3" /> Edit
              </Button>
              <div className="relative">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMoreMenuOpen(!moreMenuOpen)} title="More" aria-label="More actions" disabled={busy}>
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute right-0 mt-1 w-40 rounded-md border border-border bg-card shadow-md z-20 py-1">
                      {lifecycle !== 'Published' && (
                        <button onClick={() => { onPublishNow() }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted/40 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                          <Send className="h-3 w-3" /> Publish now
                        </button>
                      )}
                      {lifecycle === 'Published' && (
                        <button onClick={() => { onUnpublish() }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted/40 flex items-center gap-1.5 text-amber-600">
                          <RotateCcw className="h-3 w-3" /> Unpublish
                        </button>
                      )}
                      {lifecycle !== 'Archived' && (
                        <button onClick={() => { onArchive() }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted/40 flex items-center gap-1.5 text-amber-600">
                          <Archive className="h-3 w-3" /> Archive
                        </button>
                      )}
                      <button onClick={() => { onDelete(); setMoreMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted/40 flex items-center gap-1.5 text-rose-600">
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── view modal ──────────────────────────────────────────────────────

function ViewAnnouncementModal({ row: a, onClose }: { row: AnnouncementRow; onClose: () => void }) {
  useDismissOnEscape(onClose)
  const lifecycle = lifecycleOf(a)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Announcement — ${a.title}`}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{a.title}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold', PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.NORMAL)}>
                  {PRIORITY_LABEL[a.priority] ?? a.priority}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-muted/60 text-muted-foreground">
                  {audienceLabel(a.audience)}
                </span>
              </div>
            </div>
          </div>
          <LifecycleBadge value={lifecycle} />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {a.imageUrl && (
            <img src={a.imageUrl} alt={a.title} className="w-full rounded-lg border border-border object-cover max-h-64" />
          )}
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.message}</p>

          <div className="rounded-md bg-muted/30 p-2.5 text-[11px] space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Author</span><span className="font-medium">{a.sender}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span className="font-medium">{formatDate(a.createdAt)}</span></div>
            {a.publishAt && <div className="flex justify-between"><span className="text-muted-foreground">{lifecycle === 'Scheduled' ? 'Publishes' : 'Published'}</span><span className="font-medium">{formatDate(a.publishAt)}</span></div>}
            {a.expiresAt && <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span className="font-medium">{formatDate(a.expiresAt)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Last edited</span><span className="font-medium">{formatDate(a.updatedAt)}</span></div>
            {a.estimatedRecipients !== null && (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Recipients</span><span className="font-medium tabular-nums">{a.estimatedRecipients.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Acknowledged</span><span className="font-medium tabular-nums text-emerald-600">{a.acknowledgedBy.toLocaleString('en-IN')}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-1">
          <Button size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── edit dialog ─────────────────────────────────────────────────────

function EditAnnouncementDialog({
  row: a,
  onClose,
  onSaved,
}: {
  row: AnnouncementRow
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(a.title)
  const [message, setMessage] = useState(a.message)
  const [audience, setAudience] = useState(
    AUDIENCE_OPTIONS.includes(audienceLabel(a.audience)) ? audienceLabel(a.audience) : a.audience,
  )
  const [priority, setPriority] = useState(['NORMAL', 'HIGH', 'URGENT'].includes(a.priority) ? a.priority : 'NORMAL')
  const [expiresAt, setExpiresAt] = useState(a.expiresAt ? a.expiresAt.slice(0, 16) : '')
  const [imageId, setImageId] = useState<string | null>(a.imageId)
  const [imageUrl, setImageUrl] = useState<string | null>(a.imageUrl)
  const [imageUploading, setImageUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const handleImageFile = async (file: File) => {
    setImageUploading(true)
    const up = await uploadWebsiteImage(file)
    setImageUploading(false)
    if (!up.ok || !up.fileId) {
      toast.error(up.error ?? 'Image upload failed. Please try again.')
      return
    }
    setImageId(up.fileId)
    setImageUrl(up.url ?? `/api/public/website/media/${up.fileId}`)
  }

  const handleSave = async () => {
    if (title.trim().length < 3) { toast.error('Title must be at least 3 characters'); return }
    if (message.trim().length < 3) { toast.error('Message must be at least 3 characters'); return }
    const patch: Record<string, unknown> = {
      title: title.trim(),
      message: message.trim(),
      audience,
      priority,
    }
    if (expiresAt !== (a.expiresAt ? a.expiresAt.slice(0, 16) : '')) {
      patch.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null
    }
    if (imageId !== a.imageId) {
      patch.imageId = imageId
    }
    setSaving(true)
    const result = await patchAnnouncement(a.id, patch)
    setSaving(false)
    if (result.ok) {
      toast.success('Announcement updated')
      onSaved()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Pencil className="h-4 w-4 text-emerald-600" /> Edit Announcement
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div>
            <Label htmlFor="edit-title" className="text-xs font-semibold mb-1 block">Title</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div>
            <Label htmlFor="edit-message" className="text-xs font-semibold mb-1 block">Message</Label>
            <textarea
              id="edit-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={2000}
              className="w-full text-xs rounded-md border border-border bg-card px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-audience" className="text-xs font-semibold mb-1 block">Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger id="edit-audience" className="w-full h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                  ))}
                  {!AUDIENCE_OPTIONS.includes(audience) && (
                    <SelectItem value={audience} className="text-xs">{audienceLabel(audience)}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-priority" className="text-xs font-semibold mb-1 block">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="edit-priority" className="w-full h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL" className="text-xs">General</SelectItem>
                  <SelectItem value="HIGH" className="text-xs">Priority</SelectItem>
                  <SelectItem value="URGENT" className="text-xs">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="edit-expires" className="text-xs font-semibold mb-1 block">Expires At (optional)</Label>
            <Input
              id="edit-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-8 text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">After this moment the notice stops being visible. Clear to never expire.</p>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1 block">Image</Label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleImageFile(file)
              }}
            />
            {imageUrl && imageId ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2">
                <img src={imageUrl} alt="Attached announcement image" className="h-12 w-12 rounded-md object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium">Attached image</p>
                  <p className="text-[9px] text-muted-foreground">Saved with the announcement</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                  onClick={() => { setImageId(null); setImageUrl(null) }}
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={imageUploading}
                onClick={() => imageInputRef.current?.click()}
                className="h-8 text-xs gap-1.5"
              >
                {imageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                {imageUploading ? 'Uploading…' : 'Attach Image'}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving || imageUploading} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
