'use client'

/**
 * Website Management — Gallery section (task 2-a).
 *
 * ADAPTED from the settings Website tab's gallery manager
 * (website-gallery.tsx): same albums + images APIs, same sequential
 * multi-file upload with per-file progress, publish toggles and
 * reorder-by-swap semantics — plus a cover-image field (the first image
 * is the album cover on the public site).
 *
 * APIs:
 *   GET/POST/PATCH/DELETE /api/school/website/gallery        (albums)
 *   POST/PATCH/DELETE       /api/school/website/gallery/images (images)
 *   POST                    /api/school/website/upload         (files)
 *
 * Honest states everywhere: skeleton → content; error → the server's
 * verbatim message + retry; empty → "no albums yet".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Images, Plus, Trash2, Loader2, AlertTriangle, RefreshCw, Upload,
  ChevronUp, ChevronDown, Check, X, Globe, GlobeLock, ImageIcon,
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

// ── API plumbing (from website-gallery.tsx) ──────────────────────────

interface GalleryImage {
  id: string
  fileId: string
  url: string
  caption: string | null
  order: number
}

interface GalleryAlbum {
  id: string
  title: string
  description: string | null
  published: boolean
  order: number
  imageCount: number
  images: GalleryImage[]
}

async function uploadWebsiteImage(file: File): Promise<{ ok: boolean; error: string | null; fileId: string | null }> {
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false, error: 'Image is too large. Maximum size is 4 MB.', fileId: null }
  }
  const form = new FormData()
  form.append('file', file)
  try {
    const r = await fetch('/api/school/website/upload', { method: 'POST', body: form })
    const j = (await r.json().catch(() => null)) as
      | { success?: boolean; error?: string; data?: { fileId?: string } }
      | null
    if (!r.ok || !j?.success || !j.data?.fileId) {
      return { ok: false, error: j?.error ?? 'Upload failed. Please try again.', fileId: null }
    }
    return { ok: true, error: null, fileId: j.data.fileId }
  } catch {
    return { ok: false, error: 'Upload server is unreachable — check your connection and retry.', fileId: null }
  }
}

// ── the manager ─────────────────────────────────────────────────────

interface UploadState {
  name: string
  status: 'uploading' | 'attaching' | 'done' | 'error'
  error: string | null
}

export function GallerySection() {
  const [albums, setAlbums] = useState<GalleryAlbum[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GalleryAlbum | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const result = await apiJson<{ albums: GalleryAlbum[] }>('/api/school/website/gallery')
    if (result.ok) {
      setAlbums(result.data?.albums ?? [])
    } else {
      setLoadError(result.error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (title.length < 3) {
      toast.error('Album title must be 3–80 characters.')
      return
    }
    setCreating(true)
    const result = await apiJson('/api/school/website/gallery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: newDescription.trim() || undefined }),
    })
    setCreating(false)
    if (result.ok) {
      toast.success(`Album “${title}” created`)
      setCreateOpen(false)
      setNewTitle('')
      setNewDescription('')
      void load()
    } else {
      toast.error(result.error)
    }
  }

  const handleDeleteAlbum = async (album: GalleryAlbum) => {
    const result = await apiJson(`/api/school/website/gallery?albumId=${encodeURIComponent(album.id)}`, { method: 'DELETE' })
    if (result.ok) {
      toast.success(`Album “${album.title}” deleted`)
      setDeleteTarget(null)
      void load()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground">Photo Gallery</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              Albums published to the public website&apos;s Campus Life section. Only published albums are visible to visitors.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh gallery">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> New Album
            </Button>
          </div>
        </div>
      </GlassCard>

      {albums === null && loadError === null && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading albums…
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {loadError !== null && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">Gallery could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{loadError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </GlassCard>
      )}

      {albums !== null && albums.length === 0 && (
        <GlassCard className="py-10 text-center space-y-2">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
          <p className="text-xs font-semibold text-muted-foreground">No albums yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            Create an album, upload photos, then publish it to the website gallery.
          </p>
        </GlassCard>
      )}

      {albums !== null && albums.length > 0 && (
        <div className="space-y-3 max-h-[75vh] overflow-y-auto custom-scrollbar pr-0.5">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} onChanged={load} onDelete={() => setDeleteTarget(album)} />
          ))}
        </div>
      )}

      {/* Create-album dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Images className="h-5 w-5 text-emerald-600" /> New Album
            </DialogTitle>
            <DialogDescription>
              Albums group photos into the public website&apos;s Campus Life gallery.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label htmlFor="album-title" className="text-xs font-semibold mb-1 block">Album Title</Label>
              <Input
                id="album-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Sports Day 2026"
                maxLength={80}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">3–80 characters, unique per school.</p>
            </div>
            <div>
              <Label htmlFor="album-desc" className="text-xs font-semibold mb-1 block">Description (optional)</Label>
              <Input
                id="album-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="A line shown under the album title"
                maxLength={400}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              {creating ? 'Creating…' : 'Create Album'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-album confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Delete album?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title}” and its {deleteTarget?.imageCount ?? 0}{' '}
              {deleteTarget?.imageCount === 1 ? 'photo' : 'photos'} will be removed from the gallery.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void handleDeleteAlbum(deleteTarget)}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Album
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── album card ──────────────────────────────────────────────────────

function AlbumCard({
  album,
  onChanged,
  onDelete,
}: {
  album: GalleryAlbum
  onChanged: () => void
  onDelete: () => void
}) {
  const [uploadStates, setUploadStates] = useState<UploadState[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toggleBusy, setToggleBusy] = useState(false)

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    setUploadStates(files.map((f) => ({ name: f.name, status: 'uploading', error: null })))

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploadStates((prev) => prev.map((u, idx) => (idx === i ? { ...u, status: 'uploading', error: null } : u)))
      const up = await uploadWebsiteImage(file)
      if (!up.ok || !up.fileId) {
        setUploadStates((prev) => prev.map((u, idx) => (idx === i ? { ...u, status: 'error', error: up.error } : u)))
        continue
      }
      setUploadStates((prev) => prev.map((u, idx) => (idx === i ? { ...u, status: 'attaching' } : u)))
      const attach = await apiJson('/api/school/website/gallery/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId: album.id, fileId: up.fileId }),
      })
      if (!attach.ok) {
        setUploadStates((prev) => prev.map((u, idx) => (idx === i ? { ...u, status: 'error', error: attach.error } : u)))
        continue
      }
      setUploadStates((prev) => prev.map((u, idx) => (idx === i ? { ...u, status: 'done' } : u)))
    }

    setUploading(false)
    // Keep the per-file report visible briefly, then refresh the album.
    setTimeout(() => {
      setUploadStates([])
      onChanged()
    }, 1400)
  }

  const handleTogglePublished = async () => {
    setToggleBusy(true)
    const result = await apiJson('/api/school/website/gallery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumId: album.id, published: !album.published }),
    })
    setToggleBusy(false)
    if (result.ok) {
      toast.success(album.published ? `“${album.title}” unpublished` : `“${album.title}” published to the website`)
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  /** Swap this image's order with its neighbour (two PATCHes keep the
   *  order field unique; ties get nudged apart so the swap always lands).
   *  Moving an image to position 0 makes it the album COVER. */
  const moveImage = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= album.images.length) return
    const a = album.images[idx]
    const b = album.images[target]
    const aOrder = a.order
    const bOrder = b.order
    const newA = bOrder === aOrder ? bOrder + dir : bOrder
    const first = await apiJson('/api/school/website/gallery/images', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: a.id, order: newA }),
    })
    if (!first.ok) {
      toast.error(first.error)
      return
    }
    const second = await apiJson('/api/school/website/gallery/images', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: b.id, order: aOrder }),
    })
    if (!second.ok) {
      toast.error(second.error)
      return
    }
    onChanged()
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm text-foreground truncate">{album.title}</h4>
            {album.published ? (
              <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/10">
                <Globe className="h-2.5 w-2.5" /> Published
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <GlobeLock className="h-2.5 w-2.5" /> Unpublished
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {album.imageCount} {album.imageCount === 1 ? 'photo' : 'photos'}
            </Badge>
          </div>
          {album.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{album.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
            <Switch
              id={`album-pub-${album.id}`}
              checked={album.published}
              disabled={toggleBusy}
              onCheckedChange={() => void handleTogglePublished()}
              aria-label={`Publish ${album.title} to the website`}
            />
            <Label htmlFor={`album-pub-${album.id}`} className="text-[11px] font-medium cursor-pointer">
              {album.published ? 'Live' : 'Hidden'}
            </Label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
            onClick={onDelete}
            aria-label={`Delete album ${album.title}`}
            title="Delete album"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Upload control */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) void handleFiles(files)
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="h-8 text-xs gap-1.5"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload Photos
        </Button>
        <p className="mt-1 text-[11px] text-muted-foreground">
          JPG / PNG / WebP · max 4 MB each · uploads run one at a time. The first photo is the album cover.
        </p>
      </div>

      {/* Per-file upload report */}
      {uploadStates.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {uploadStates.map((u, idx) => (
            <li
              key={`${u.name}-${idx}`}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
                u.status === 'error'
                  ? 'border-rose-500/30 bg-rose-500/[0.05] text-rose-700 dark:text-rose-300'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              {u.status === 'uploading' || u.status === 'attaching' ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
              ) : u.status === 'done' ? (
                <Check className="h-3 w-3 text-emerald-600 shrink-0" aria-hidden />
              ) : (
                <X className="h-3 w-3 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="shrink-0">
                {u.status === 'uploading' && 'Uploading…'}
                {u.status === 'attaching' && 'Adding to album…'}
                {u.status === 'done' && 'Added'}
                {u.status === 'error' && (u.error ?? 'Failed')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Image grid */}
      {album.images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 py-6 text-center">
          <p className="text-[11px] text-muted-foreground">No photos in this album yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {album.images.map((img, idx) => (
            <GalleryImageTile
              key={img.id}
              image={img}
              isCover={idx === 0}
              isFirst={idx === 0}
              isLast={idx === album.images.length - 1}
              onMove={(dir) => void moveImage(idx, dir)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── image tile ──────────────────────────────────────────────────────

function GalleryImageTile({
  image,
  isCover,
  isFirst,
  isLast,
  onMove,
  onChanged,
}: {
  image: GalleryImage
  isCover: boolean
  isFirst: boolean
  isLast: boolean
  onMove: (dir: -1 | 1) => void
  onChanged: () => void
}) {
  const [caption, setCaption] = useState(image.caption ?? '')
  const [busy, setBusy] = useState(false)
  const captionDirty = caption !== (image.caption ?? '')

  useEffect(() => {
    setCaption(image.caption ?? '')
  }, [image.caption])

  const saveCaption = async () => {
    setBusy(true)
    const result = await apiJson('/api/school/website/gallery/images', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: image.id, caption: caption.trim() || null }),
    })
    setBusy(false)
    if (result.ok) {
      toast.success('Caption saved')
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  const remove = async () => {
    setBusy(true)
    const result = await apiJson(`/api/school/website/gallery/images?imageId=${encodeURIComponent(image.id)}`, { method: 'DELETE' })
    setBusy(false)
    if (result.ok) {
      toast.success('Photo removed')
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <figure className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted/40">
        <img src={image.url} alt={image.caption ?? 'Gallery photo'} className="h-full w-full object-cover" loading="lazy" />
        {isCover && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold text-white" title="Album cover">
            Cover
          </span>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
          </div>
        )}
      </div>
      <figcaption className="p-2 space-y-1.5">
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption…"
          className="h-7 text-[11px]"
          maxLength={200}
          aria-label={`Caption for photo ${image.order}`}
        />
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={isFirst || busy}
              onClick={() => onMove(-1)}
              aria-label="Move photo earlier (first photo is the cover)"
              title="Move earlier"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={isLast || busy}
              onClick={() => onMove(1)}
              aria-label="Move photo later"
              title="Move later"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-0.5">
            {captionDirty && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[10px] gap-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                disabled={busy}
                onClick={() => void saveCaption()}
              >
                <Check className="h-3 w-3" /> Save
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
              disabled={busy}
              onClick={() => void remove()}
              aria-label="Remove photo"
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
