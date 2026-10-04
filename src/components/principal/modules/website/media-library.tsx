'use client'

/**
 * Website Management — Media Library section (task 2-a).
 *
 * Grid of the school's website-scope media (WebsiteMedia rows over the
 * UploadedFile registry). Upload = POST /api/school/website/media
 * (multipart, magic-byte image pipeline); curation edits (title/alt/
 * usage/publish) = PATCH /api/school/website/media/[fileId]; removal =
 * DELETE (the file is deleted only when nothing else references it).
 *
 * Privacy: an item is PUBLIC only while its `published` flag is on —
 * the public media gate answers 404 otherwise.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ImageIcon, Loader2, AlertTriangle, RefreshCw, Upload, Trash2, Save,
  Globe, GlobeLock,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface MediaRow {
  id: string
  fileId: string
  mediaType: string
  title: string | null
  altText: string | null
  usage: string
  published: boolean
  url: string
  size: number | null
  createdAt: string
  updatedAt: string
}

function formatBytes(size: number | null): string {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function MediaLibrarySection() {
  const [media, setMedia] = useState<MediaRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MediaRow | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const result = await apiJson<{ media: MediaRow[] }>('/api/school/website/media')
    if (result.ok) {
      setMedia(result.data?.media ?? [])
    } else {
      setLoadError(result.error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    // Sequential uploads (one pipeline at a time — same discipline as the
    // gallery manager; a hostile parallel burst is rate-limited server-side).
    let okCount = 0
    for (const file of files) {
      if (file.size > 4 * 1024 * 1024) {
        toast.error(`“${file.name}” is too large. Maximum size is 4 MB.`)
        continue
      }
      const form = new FormData()
      form.append('file', file)
      try {
        const r = await fetch('/api/school/website/media', { method: 'POST', body: form })
        const j = (await r.json().catch(() => null)) as
          | { success?: boolean; error?: string }
          | null
        if (r.ok && j?.success) {
          okCount++
        } else {
          toast.error(j?.error ?? `“${file.name}” could not be uploaded.`)
        }
      } catch {
        toast.error('Upload server is unreachable — check your connection and retry.')
      }
    }
    setUploading(false)
    if (okCount > 0) {
      toast.success(`${okCount} ${okCount === 1 ? 'image' : 'images'} added to the library`)
      void load()
    }
  }

  const handleDelete = async (item: MediaRow) => {
    const result = await apiJson(`/api/school/website/media/${encodeURIComponent(item.fileId)}`, { method: 'DELETE' })
    if (result.ok) {
      toast.success('Media item removed')
      setDeleteTarget(null)
      void load()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Media Library</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              Every image uploaded through the website module (gallery, media uploads). Items are private until you publish them.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh media library">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) void handleUpload(files)
              }}
            />
            <Button
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? 'Uploading…' : 'Upload Images'}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          JPG / PNG / WebP · max 4 MB each · uploads run one at a time.
        </p>
      </GlassCard>

      {media === null && loadError === null && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the media library…
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5" aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="aspect-[4/3] rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {loadError !== null && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">Media library could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{loadError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </GlassCard>
      )}

      {media !== null && media.length === 0 && (
        <GlassCard className="py-10 text-center space-y-2">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
          <p className="text-xs font-semibold text-muted-foreground">No media yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            Upload the school&apos;s photos — they stay private until you publish them for the website.
          </p>
        </GlassCard>
      )}

      {media !== null && media.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[75vh] overflow-y-auto custom-scrollbar pr-0.5">
          {media.map((item) => (
            <MediaTile key={item.id} item={item} onChanged={load} onDelete={() => setDeleteTarget(item)} />
          ))}
        </div>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Remove media item?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title || 'Untitled image'}” will be removed from the library. If nothing
              else references the file, the stored image is deleted too.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MediaTile({
  item,
  onChanged,
  onDelete,
}: {
  item: MediaRow
  onChanged: () => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(item.title ?? '')
  const [alt, setAlt] = useState(item.altText ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = title !== (item.title ?? '') || alt !== (item.altText ?? '')

  useEffect(() => {
    setTitle(item.title ?? '')
    setAlt(item.altText ?? '')
  }, [item.title, item.altText])

  const saveMeta = async () => {
    setBusy(true)
    const result = await apiJson(`/api/school/website/media/${encodeURIComponent(item.fileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim() || null,
        altText: alt.trim() || null,
      }),
    })
    setBusy(false)
    if (result.ok) {
      toast.success('Media details saved')
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  const togglePublished = async (published: boolean) => {
    setBusy(true)
    const result = await apiJson(`/api/school/website/media/${encodeURIComponent(item.fileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published }),
    })
    setBusy(false)
    if (result.ok) {
      toast.success(published ? 'Image published (publicly viewable)' : 'Image unpublished (private again)')
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <figure className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted/40">
        <img
          src={item.url}
          alt={item.altText ?? item.title ?? 'Media library image'}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <span
          className={cn(
            'absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold border backdrop-blur-sm',
            item.published
              ? 'bg-emerald-500/15 text-emerald-100 border-emerald-400/40'
              : 'bg-slate-900/60 text-slate-200 border-slate-600/40',
          )}
          title={item.published ? 'Published — publicly viewable' : 'Private — not served publicly'}
        >
          {item.published ? 'Public' : 'Private'}
        </span>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
          </div>
        )}
      </div>
      <figcaption className="p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[9px]" title={`Usage: ${item.usage}`}>
            {item.usage}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</span>
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title…"
          className="h-7 text-[11px]"
          maxLength={120}
          aria-label={`Title for image ${item.fileId}`}
        />
        <Input
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Alt text (accessibility)…"
          className="h-7 text-[11px]"
          maxLength={200}
          aria-label={`Alt text for image ${item.fileId}`}
        />
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <Switch
              id={`media-pub-${item.id}`}
              checked={item.published}
              disabled={busy}
              onCheckedChange={(v) => void togglePublished(v)}
              aria-label={`Publish image ${item.title ?? item.fileId}`}
              className="scale-90"
            />
            <Label htmlFor={`media-pub-${item.id}`} className="text-[10px] font-medium cursor-pointer flex items-center gap-1">
              {item.published ? <Globe className="h-2.5 w-2.5" /> : <GlobeLock className="h-2.5 w-2.5" />}
              {item.published ? 'Live' : 'Hidden'}
            </Label>
          </div>
          <div className="flex items-center gap-0.5">
            {dirty && (
              <Button
                size="sm" variant="ghost"
                className="h-7 px-2 text-[10px] gap-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                disabled={busy}
                onClick={() => void saveMeta()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
              </Button>
            )}
            <Button
              size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
              disabled={busy}
              onClick={onDelete}
              aria-label="Remove media item"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </figcaption>
    </figure>
  )
}
