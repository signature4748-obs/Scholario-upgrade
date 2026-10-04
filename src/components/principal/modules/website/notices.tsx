'use client'

/**
 * Website Management — Notices & Announcements manager (task 2-a).
 *
 * One manager, two sections: `kind="NOTICE"` (dated circulars) and
 * `kind="ANNOUNCEMENT"` (celebrations / achievements — rendered by
 * announcements.tsx through this same component).
 *
 * APIs:
 *   GET    /api/school/website/notices?kind=…        (list, drafts incl.)
 *   POST   /api/school/website/notices               (create)
 *   PATCH  /api/school/website/notices/[noticeId]    (edit / publish /
 *          unpublish / expire / pin)
 *   DELETE /api/school/website/notices/[noticeId]
 *   POST   /api/school/website/notices/attachment    (document upload)
 *
 * Honest states everywhere: skeleton → content; error → the server's
 * verbatim message + retry; empty → the honest first-use copy. Status
 * badges reflect the LIVE lifecycle (DRAFT / SCHEDULED / PUBLISHED /
 * EXPIRED — lazy promotion + lazy expiry evaluated server-side).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Megaphone, Plus, Loader2, AlertTriangle, RefreshCw, Pin, PinOff, Trash2,
  Pencil, Paperclip, X, CalendarClock, Globe, EyeOff, Archive, FileText,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiJson } from './shared'

// ── types ───────────────────────────────────────────────────────────

export interface WebsiteNoticeRow {
  id: string
  kind: string
  title: string
  body: string
  category: string | null
  status: string
  effectiveStatus: string
  publishAt: string | null
  expiresAt: string | null
  pinned: boolean
  attachmentFileId: string | null
  attachmentUrl: string | null
  createdAt: string
  updatedAt: string
}

interface AttachmentState {
  fileId: string
  filename: string
}

// ── helpers ─────────────────────────────────────────────────────────

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusBadgeProps(status: string): { className: string; label: string; icon: React.ComponentType<{ className?: string }> } {
  switch (status) {
    case 'PUBLISHED':
      return { className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25', label: 'Published', icon: Globe }
    case 'SCHEDULED':
      return { className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25', label: 'Scheduled', icon: CalendarClock }
    case 'EXPIRED':
      return { className: 'bg-muted text-muted-foreground border-border', label: 'Expired', icon: Archive }
    default:
      return { className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25', label: 'Draft', icon: FileText }
  }
}

async function uploadAttachment(file: File): Promise<{ ok: boolean; error: string | null; fileId: string | null; filename: string | null }> {
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: 'Attachment is too large. Maximum size is 5 MB.', fileId: null, filename: null }
  }
  const form = new FormData()
  form.append('file', file)
  try {
    const r = await fetch('/api/school/website/notices/attachment', { method: 'POST', body: form })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { fileId?: string; filename?: string } }
      | null
    if (!r.ok || !j?.success || !j.data?.fileId) {
      return { ok: false, error: j?.error ?? 'Upload failed. Please try again.', fileId: null, filename: null }
    }
    return { ok: true, error: null, fileId: j.data.fileId, filename: j.data.filename ?? file.name }
  } catch {
    return { ok: false, error: 'Upload server is unreachable — check your connection and retry.', fileId: null, filename: null }
  }
}

// ── the manager ─────────────────────────────────────────────────────

export function NoticesManager({ kind }: { kind: 'NOTICE' | 'ANNOUNCEMENT' }) {
  const [rows, setRows] = useState<WebsiteNoticeRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WebsiteNoticeRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebsiteNoticeRow | null>(null)

  const isAnnouncement = kind === 'ANNOUNCEMENT'
  const noun = isAnnouncement ? 'announcement' : 'notice'
  const Noun = isAnnouncement ? 'Announcement' : 'Notice'

  const load = useCallback(async () => {
    setLoadError(null)
    const result = await apiJson<{ notices: WebsiteNoticeRow[] }>(
      `/api/school/website/notices?kind=${kind}`,
    )
    if (result.ok) {
      setRows(result.data?.notices ?? [])
    } else {
      setLoadError(result.error)
    }
  }, [kind])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (row: WebsiteNoticeRow) => {
    setEditing(row)
    setDialogOpen(true)
  }

  const handleRowAction = async (
    row: WebsiteNoticeRow,
    action: 'publish' | 'unpublish' | 'expire' | 'pin' | 'unpin',
  ) => {
    const body =
      action === 'pin' || action === 'unpin'
        ? { pinned: action === 'pin' }
        : { action }
    const result = await apiJson(`/api/school/website/notices/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (result.ok) {
      const verb =
        action === 'publish' ? 'published to the website'
        : action === 'unpublish' ? 'unpublished (back to draft)'
        : action === 'expire' ? 'expired'
        : action === 'pin' ? 'pinned'
        : 'unpinned'
      toast.success(`“${row.title}” ${verb}`)
      void load()
    } else {
      toast.error(result.error ?? 'The action could not be completed.')
    }
  }

  const handleDelete = async (row: WebsiteNoticeRow) => {
    const result = await apiJson(`/api/school/website/notices/${row.id}`, { method: 'DELETE' })
    if (result.ok) {
      toast.success(`“${row.title}” deleted`)
      setDeleteTarget(null)
      void load()
    } else {
      toast.error(result.error ?? 'The notice could not be deleted.')
    }
  }

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">
              {isAnnouncement ? 'Announcements' : 'Notices'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              {isAnnouncement
                ? 'Celebrations and achievements shown as the highlights strip on the public website. Only published items are visible to visitors.'
                : 'Dated circulars shown in the public website’s notice board. Drafts stay private until you publish them.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label={`Refresh ${noun}s`}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={openCreate}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> New {Noun}
            </Button>
          </div>
        </div>
      </GlassCard>

      {rows === null && loadError === null && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading {noun}s…
          </div>
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {loadError !== null && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{Noun}s could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{loadError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </GlassCard>
      )}

      {rows !== null && rows.length === 0 && (
        <GlassCard className="py-10 text-center space-y-2">
          <Megaphone className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
          <p className="text-xs font-semibold text-muted-foreground">No {noun}s yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            {isAnnouncement
              ? 'Share a celebration or achievement — it appears on the public website once published.'
              : 'Create a notice, schedule or publish it, and it appears on the public website’s notice board.'}
          </p>
        </GlassCard>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar pr-0.5" role="list" aria-label={`${Noun} list`}>
          {rows.map((row) => (
            <NoticeRow
              key={row.id}
              row={row}
              onEdit={() => openEdit(row)}
              onAction={(a) => void handleRowAction(row, a)}
              onDelete={() => setDeleteTarget(row)}
            />
          ))}
        </div>
      )}

      <NoticeDialog
        open={dialogOpen}
        kind={kind}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load()}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Delete {noun}?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title}” will be removed from the website CMS. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── row ─────────────────────────────────────────────────────────────

function NoticeRow({
  row,
  onEdit,
  onAction,
  onDelete,
}: {
  row: WebsiteNoticeRow
  onEdit: () => void
  onAction: (action: 'publish' | 'unpublish' | 'expire' | 'pin' | 'unpin') => void
  onDelete: () => void
}) {
  const badge = statusBadgeProps(row.effectiveStatus)
  const BadgeIcon = badge.icon
  const live = row.effectiveStatus === 'PUBLISHED'
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3" role="listitem">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-foreground">{row.title}</h4>
            {row.pinned && (
              <Badge className="gap-1 bg-primary/10 text-primary border-primary/25 hover:bg-primary/10" title="Pinned">
                <Pin className="h-2.5 w-2.5" /> Pinned
              </Badge>
            )}
            {row.category && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">{row.category}</Badge>
            )}
            <Badge className={cn('gap-1 border', badge.className)} title={badge.label}>
              <BadgeIcon className="h-2.5 w-2.5" /> {badge.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{row.body}</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1.5">
            {row.publishAt ? `Publishes ${formatDateTime(row.publishAt)}` : `Created ${formatDateTime(row.createdAt)}`}
            {row.expiresAt ? ` · expires ${formatDateTime(row.expiresAt)}` : ''}
            {row.attachmentFileId ? ' · has attachment' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {live ? (
            <Button
              size="sm" variant="ghost" className="h-8 px-2.5 text-xs gap-1.5"
              onClick={() => onAction('unpublish')}
              title="Unpublish (back to draft)"
            >
              <EyeOff className="h-3.5 w-3.5" /> Unpublish
            </Button>
          ) : (
            <Button
              size="sm" variant="ghost"
              className="h-8 px-2.5 text-xs gap-1.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => onAction('publish')}
              title="Publish now"
            >
              <Globe className="h-3.5 w-3.5" /> Publish
            </Button>
          )}
          {row.effectiveStatus !== 'EXPIRED' && (
            <Button
              size="sm" variant="ghost" className="h-8 px-2.5 text-xs gap-1.5"
              onClick={() => onAction('expire')}
              title="Expire now"
            >
              <Archive className="h-3.5 w-3.5" /> Expire
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-8 w-8 p-0"
            onClick={() => onAction(row.pinned ? 'unpin' : 'pin')}
            aria-label={row.pinned ? `Unpin ${row.title}` : `Pin ${row.title}`}
            title={row.pinned ? 'Unpin' : 'Pin'}
          >
            {row.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 w-8 p-0"
            onClick={onEdit}
            aria-label={`Edit ${row.title}`}
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
            onClick={onDelete}
            aria-label={`Delete ${row.title}`}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── create / edit dialog ────────────────────────────────────────────

function NoticeDialog({
  open,
  kind,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean
  kind: 'NOTICE' | 'ANNOUNCEMENT'
  editing: WebsiteNoticeRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const isAnnouncement = kind === 'ANNOUNCEMENT'
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('')
  const [publishAt, setPublishAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [pinned, setPinned] = useState(false)
  const [attachment, setAttachment] = useState<AttachmentState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState<'draft' | 'schedule' | 'publish' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? '')
      setBody(editing?.body ?? '')
      setCategory(editing?.category ?? '')
      setPublishAt(isoToLocalInput(editing?.publishAt ?? null))
      setExpiresAt(isoToLocalInput(editing?.expiresAt ?? null))
      setPinned(editing?.pinned ?? false)
      setAttachment(
        editing?.attachmentFileId
          ? { fileId: editing.attachmentFileId, filename: 'Attached document' }
          : null,
      )
      setError(null)
    }
  }, [open, editing])

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    const up = await uploadAttachment(file)
    setUploading(false)
    if (up.ok && up.fileId) {
      setAttachment({ fileId: up.fileId, filename: up.filename ?? file.name })
    } else {
      setError(up.error)
      toast.error(up.error ?? 'The attachment could not be uploaded.')
    }
  }

  const validate = (): string | null => {
    if (title.trim().length < 3) return 'Title must be at least 3 characters.'
    if (body.trim().length < 3) return 'Body must be at least 3 characters.'
    const pub = publishAt ? new Date(publishAt) : null
    const exp = expiresAt ? new Date(expiresAt) : null
    if (publishAt && (!pub || Number.isNaN(pub.getTime()))) return 'Invalid publish date.'
    if (expiresAt && (!exp || Number.isNaN(exp.getTime()))) return 'Invalid expiry date.'
    if (pub && exp && exp.getTime() <= pub.getTime()) return 'Expiry must be after the publish time.'
    return null
  }

  const buildPayload = (mode: 'draft' | 'schedule' | 'publish' | 'save') => {
    const payload: Record<string, unknown> = {
      kind,
      title: title.trim(),
      body: body.trim(),
      category: category.trim() || null,
      pinned,
      attachmentFileId: attachment?.fileId ?? null,
      publishAt: publishAt ? new Date(publishAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    }
    if (mode === 'publish') payload.action = 'publish'
    if (mode === 'schedule') payload.action = 'schedule'
    return payload
  }

  const submit = async (mode: 'draft' | 'schedule' | 'publish' | 'save') => {
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    if (mode === 'schedule' && !publishAt) {
      setError('A future publish date is required to schedule.')
      return
    }
    if (mode === 'schedule' && new Date(publishAt).getTime() < Date.now() - 60_000) {
      setError('Scheduled publish time must be in the future.')
      return
    }
    setSaving(mode)
    setError(null)
    const result = editing
      ? mode === 'publish'
        ? await apiJson(`/api/school/website/notices/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...buildPayload('save'), action: 'publish' }),
          })
        : await apiJson(`/api/school/website/notices/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload('save')),
          })
      : await apiJson('/api/school/website/notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload(mode)),
        })
    setSaving(null)
    if (result.ok) {
      const verb =
        mode === 'publish' ? 'published to the website'
        : mode === 'schedule' ? 'scheduled'
        : mode === 'draft' ? 'saved as a draft'
        : 'saved'
      toast.success(`“${title.trim()}” ${verb}`)
      onClose()
      onSaved()
    } else {
      setError(result.error)
      toast.error(result.error ?? 'The notice could not be saved.')
    }
  }

  const inputCls = 'h-8 text-xs'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Megaphone className="h-5 w-5 text-emerald-600" />
            {editing
              ? `Edit ${isAnnouncement ? 'Announcement' : 'Notice'}`
              : `New ${isAnnouncement ? 'Announcement' : 'Notice'}`}
          </DialogTitle>
          <DialogDescription>
            {isAnnouncement
              ? 'Celebrations and achievements appear as the highlights strip on the public website.'
              : 'Notices appear on the public website’s notice board once published.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1 text-xs">
          <div>
            <Label htmlFor="notice-title" className="text-xs font-semibold mb-1 block">Title</Label>
            <Input
              id="notice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isAnnouncement ? 'State Science Fair — First Place' : 'Half Yearly Examination Schedule Released'}
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="notice-body" className="text-xs font-semibold mb-1 block">Body</Label>
            <Textarea
              id="notice-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="The full text shown when a visitor opens the notice."
              maxLength={5000}
            />
          </div>
          <div>
            <Label htmlFor="notice-category" className="text-xs font-semibold mb-1 block">Category (optional)</Label>
            <Input
              id="notice-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={isAnnouncement ? 'Achievement' : 'Examination'}
              maxLength={40}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">A short badge label, e.g. Examination, Holiday, Event, Achievement.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="notice-publish-at" className="text-xs font-semibold mb-1 block">Publish at (optional)</Label>
              <Input
                id="notice-publish-at"
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Leave empty to keep it a draft; set a future time to schedule.</p>
            </div>
            <div>
              <Label htmlFor="notice-expires-at" className="text-xs font-semibold mb-1 block">Expires at (optional)</Label>
              <Input
                id="notice-expires-at"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Auto-hidden from the website after this time.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
            <Switch
              id="notice-pinned"
              checked={pinned}
              onCheckedChange={setPinned}
              className="mt-0.5"
              aria-label="Pin to the top of the notice board"
            />
            <div className="min-w-0">
              <Label htmlFor="notice-pinned" className="text-xs font-semibold cursor-pointer">Pin to top</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Pinned items always render before other notices.
              </p>
            </div>
          </div>

          {/* Attachment (document upload → UploadedFile scope 'website') */}
          <div>
            <Label className="text-xs font-semibold mb-1 block">Attachment (optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void handleFile(file)
              }}
            />
            {attachment ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{attachment.filename}</span>
                <Button
                  size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                  title="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm" variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="h-8 text-xs gap-1.5"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {uploading ? 'Uploading…' : 'Attach Document'}
              </Button>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              PDF / JPG / PNG / WebP · max 5 MB · public only while this notice is published.
            </p>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose} disabled={saving !== null}>Cancel</Button>
          {editing ? (
            <>
              <Button
                variant="outline"
                disabled={saving !== null}
                onClick={() => void submit('save')}
                className="gap-1.5"
              >
                {saving === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save Changes
              </Button>
              <Button
                disabled={saving !== null}
                onClick={() => void submit('publish')}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                {saving === 'publish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                Publish Now
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={saving !== null}
                onClick={() => void submit('draft')}
                className="gap-1.5"
              >
                {saving === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save Draft
              </Button>
              <Button
                variant="outline"
                disabled={saving !== null}
                onClick={() => void submit('schedule')}
                className="gap-1.5"
              >
                {saving === 'schedule' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                Schedule
              </Button>
              <Button
                disabled={saving !== null}
                onClick={() => void submit('publish')}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                {saving === 'publish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                Publish Now
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
