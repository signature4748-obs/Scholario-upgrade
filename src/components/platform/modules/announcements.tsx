'use client'

// ============================================================
// AnnouncementsModule — /platform/announcements (PHASE 6 console)
// ------------------------------------------------------------
// Platform-wide announcements that surface on the school login page
// (audience ALL/SCHOOLS — the public endpoint filters the same rows).
// Publish = immediate; retract = delete (kept in the audit trail).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { Megaphone, Plus, Trash2, Info, AlertTriangle, OctagonAlert } from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

type AnnouncementLevel = 'INFO' | 'WARNING' | 'CRITICAL'
type AnnouncementAudience = 'ALL' | 'SCHOOLS'

interface Announcement {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  audience: AnnouncementAudience
  createdAt: string
  expiresAt: string | null
  expired: boolean
}

const LEVEL_CONFIG: Record<
  AnnouncementLevel,
  { badge: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  INFO: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: Info,
    label: 'Info',
  },
  WARNING: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: AlertTriangle,
    label: 'Warning',
  },
  CRITICAL: {
    badge: 'border-red-200 bg-red-50 text-red-600',
    icon: OctagonAlert,
    label: 'Critical',
  },
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AnnouncementsModule() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Create form state
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    title: '',
    body: '',
    level: 'INFO' as AnnouncementLevel,
    audience: 'ALL' as AnnouncementAudience,
    expiresInDays: '30',
  })

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await platformApi<{ announcements: Announcement[] }>(
        '/api/platform/announcements',
      )
      setAnnouncements(body.announcements)
    } catch (e) {
      const err = e as PlatformApiError
      setError(err.error || 'Failed to load announcements')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const publish = async () => {
    const days = Number(form.expiresInDays)
    if (!form.title.trim()) {
      toast.error('Title is required')
      return
    }
    if (form.title.length > 120) {
      toast.error('Title must be 120 characters or fewer')
      return
    }
    if (!form.body.trim()) {
      toast.error('Body is required')
      return
    }
    if (form.body.length > 1000) {
      toast.error('Body must be 1,000 characters or fewer')
      return
    }
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      toast.error('Expires in must be between 1 and 90 days')
      return
    }
    setCreating(true)
    try {
      await platformApi('/api/platform/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          level: form.level,
          audience: form.audience,
          expiresInDays: days,
        }),
      })
      toast.success('Announcement published to school login pages')
      setCreateOpen(false)
      setForm({ title: '', body: '', level: 'INFO', audience: 'ALL', expiresInDays: '30' })
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to publish the announcement')
    } finally {
      setCreating(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await platformApi(`/api/platform/announcements/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      toast.success(`Retracted "${deleteTarget.title}"`)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to retract the announcement')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby="announcements-heading" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1
            id="announcements-heading"
            className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5"
          >
            <span className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
              <Megaphone className="h-4.5 w-4.5 text-teal-600" aria-hidden="true" />
            </span>
            Platform announcements
          </h1>
          <p className="text-sm text-slate-500 mt-2 max-w-2xl">
            Notices shown on school login pages. Publishing is immediate; expiry hides them
            automatically.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-11 px-5 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New announcement
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      {/* Skeletons */}
      {loading && (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl bg-slate-200" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && announcements.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <Megaphone className="h-8 w-8 text-slate-400 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-900">No announcements yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Publish the first notice — it appears on every school login page.
          </p>
        </div>
      )}

      {/* List */}
      {!loading && announcements.length > 0 && (
        <div className="grid gap-3">
          {announcements.map((a) => {
            const level = LEVEL_CONFIG[a.level] ?? LEVEL_CONFIG.INFO
            const LevelIcon = level.icon
            const isOpen = expanded === a.id
            return (
              <article
                key={a.id}
                className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm transition-opacity ${
                  a.expired ? 'opacity-60' : ''
                }`}
                aria-label={`${level.label} announcement: ${a.title}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={level.badge}>
                      <LevelIcon className="h-3 w-3" aria-hidden="true" />
                      {level.label}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">
                      {a.audience === 'ALL' ? 'All surfaces' : 'School login'}
                    </Badge>
                    {a.expired && (
                      <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-500">
                        expired
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(a)}
                    aria-label={`Retract announcement "${a.title}"`}
                    className="h-11 w-11 shrink-0 text-slate-500 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <h2 className="font-semibold text-sm text-slate-900 mt-3">{a.title}</h2>
                <p
                  className={`mt-1.5 text-sm leading-relaxed text-slate-600 ${
                    isOpen ? '' : 'line-clamp-3'
                  }`}
                >
                  {a.body}
                </p>
                {a.body.length > 160 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : a.id)}
                    className="mt-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 focus-ring rounded-md px-1 -mx-1"
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
                <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 tabular-nums">
                  <span>Created {when(a.createdAt)}</span>
                  {a.expiresAt && (
                    <span className={a.expired ? 'text-slate-400' : ''}>
                      Expires {when(a.expiresAt)}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Megaphone className="h-4 w-4 text-teal-600" aria-hidden="true" />
              New announcement
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Publishes immediately to school login pages.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void publish()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="ann-title" className="text-xs font-semibold text-slate-700">
                Title <span className="text-slate-500 font-normal">(≤ 120 chars)</span>
              </label>
              <Input
                id="ann-title"
                value={form.title}
                maxLength={120}
                required
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Scheduled maintenance window"
                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11 focus-visible:ring-teal-500/40"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ann-body" className="text-xs font-semibold text-slate-700">
                Body <span className="text-slate-500 font-normal">(≤ 1,000 chars)</span>
              </label>
              <Textarea
                id="ann-body"
                value={form.body}
                maxLength={1000}
                required
                rows={5}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="What schools should know…"
                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40"
              />
              <p className="text-[10px] text-slate-400 tabular-nums">{form.body.length}/1000</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="ann-level" className="text-xs font-semibold text-slate-700">
                  Level
                </label>
                <Select
                  value={form.level}
                  onValueChange={(v) => setForm((f) => ({ ...f, level: v as AnnouncementLevel }))}
                >
                  <SelectTrigger
                    id="ann-level"
                    className="w-full h-11 bg-white border-slate-200 text-slate-900 focus-ring"
                  >
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 text-slate-900">
                    <SelectItem value="INFO">Info</SelectItem>
                    <SelectItem value="WARNING">Warning</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ann-audience" className="text-xs font-semibold text-slate-700">
                  Audience
                </label>
                <Select
                  value={form.audience}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, audience: v as AnnouncementAudience }))
                  }
                >
                  <SelectTrigger
                    id="ann-audience"
                    className="w-full h-11 bg-white border-slate-200 text-slate-900 focus-ring"
                  >
                    <SelectValue placeholder="Audience" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 text-slate-900">
                    <SelectItem value="ALL">All surfaces</SelectItem>
                    <SelectItem value="SCHOOLS">School login only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ann-expiry" className="text-xs font-semibold text-slate-700">
                Expires after (days)
              </label>
              <Input
                id="ann-expiry"
                type="number"
                min={1}
                max={90}
                value={form.expiresInDays}
                required
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value }))}
                className="bg-white border-slate-200 text-slate-900 h-11 w-32 focus-visible:ring-teal-500/40"
              />
              <p className="text-[10px] text-slate-500">1–90 days, then it stops showing.</p>
            </div>
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Publishes immediately to school login pages.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 h-11"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="bg-teal-600 hover:bg-teal-700 text-white h-11 font-semibold focus-ring"
              >
                {creating ? 'Publishing…' : 'Publish'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">Retract announcement?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              “{deleteTarget?.title}” will be removed from school login pages immediately. The
              retraction is recorded in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-11"
            >
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {deleting ? 'Retracting…' : 'Retract'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
