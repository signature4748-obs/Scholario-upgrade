'use client'

/**
 * Website Management — Social Links section (task 2-a).
 *
 * CRUD over /api/school/website/social-links (+ [linkId] PATCH/DELETE):
 * platform-unique per school (the API answers 409 on duplicates), URLs
 * restricted to http(s), order via up/down swaps. The links render as
 * the icon row in the public website's footer.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Link2, Plus, Loader2, AlertTriangle, RefreshCw, ChevronUp, ChevronDown,
  Trash2, Save, X, Facebook, Instagram, Youtube, Twitter, Linkedin,
  MessageCircle, Globe, ExternalLink,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { apiJson } from './shared'

interface SocialLinkRow {
  id: string
  platform: string
  url: string
  label: string | null
  order: number
}

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook', icon: Facebook, placeholder: 'https://facebook.com/yourschool' },
  { value: 'instagram', label: 'Instagram', icon: Instagram, placeholder: 'https://instagram.com/yourschool' },
  { value: 'youtube', label: 'YouTube', icon: Youtube, placeholder: 'https://youtube.com/@yourschool' },
  { value: 'x', label: 'X', icon: Twitter, placeholder: 'https://x.com/yourschool' },
  { value: 'linkedin', label: 'LinkedIn', icon: Linkedin, placeholder: 'https://linkedin.com/school/yourschool' },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, placeholder: 'https://wa.me/919876543210' },
  { value: 'website', label: 'Website', icon: Globe, placeholder: 'https://yourschool.com' },
  { value: 'other', label: 'Other', icon: Link2, placeholder: 'https://…' },
] as const

function platformMeta(platform: string) {
  return PLATFORMS.find((p) => p.value === platform) ?? PLATFORMS[PLATFORMS.length - 1]
}

export function SocialLinksSection() {
  const [links, setLinks] = useState<SocialLinkRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newPlatform, setNewPlatform] = useState('facebook')
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SocialLinkRow | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const result = await apiJson<{ links: SocialLinkRow[] }>('/api/school/website/social-links')
    if (result.ok) {
      setLinks(result.data?.links ?? [])
    } else {
      setLoadError(result.error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    const url = newUrl.trim()
    if (!/^https?:\/\/.+\..+/i.test(url)) {
      toast.error('Link URL must be a valid http(s) address.')
      return
    }
    setCreating(true)
    const result = await apiJson('/api/school/website/social-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: newPlatform,
        url,
        label: newLabel.trim() || null,
      }),
    })
    setCreating(false)
    if (result.ok) {
      toast.success(`${platformMeta(newPlatform).label} link added`)
      setCreateOpen(false)
      setNewUrl('')
      setNewLabel('')
      void load()
    } else {
      toast.error(result.error)
    }
  }

  const handleMove = async (link: SocialLinkRow, direction: 'up' | 'down') => {
    const result = await apiJson(`/api/school/website/social-links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    })
    if (result.ok) {
      void load()
    } else {
      toast.error(result.error)
    }
  }

  const handleDelete = async (link: SocialLinkRow) => {
    const result = await apiJson(`/api/school/website/social-links/${link.id}`, { method: 'DELETE' })
    if (result.ok) {
      toast.success(`${platformMeta(link.platform).label} link removed`)
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
            <h3 className="font-bold text-sm text-foreground">Social Links</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              The social-profile icon row in the public website&apos;s footer. One link per platform, ordered.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh social links">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> Add Link
            </Button>
          </div>
        </div>
      </GlassCard>

      {links === null && loadError === null && (
        <GlassCard className="p-6 space-y-4" aria-busy="true" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading social links…
          </div>
          <div className="space-y-2" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-muted/60 animate-pulse" />
            ))}
          </div>
        </GlassCard>
      )}

      {loadError !== null && (
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">Social links could not be loaded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{loadError}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </GlassCard>
      )}

      {links !== null && links.length === 0 && (
        <GlassCard className="py-10 text-center space-y-2">
          <Link2 className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
          <p className="text-xs font-semibold text-muted-foreground">No social links yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            Add your school&apos;s social profiles — they render as icons in the public footer.
          </p>
        </GlassCard>
      )}

      {links !== null && links.length > 0 && (
        <div className="space-y-2">
          {links.map((link, idx) => (
            <SocialLinkRowCard
              key={link.id}
              link={link}
              isFirst={idx === 0}
              isLast={idx === links.length - 1}
              onMove={(dir) => void handleMove(link, dir)}
              onDelete={() => setDeleteTarget(link)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {/* Add-link dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Link2 className="h-5 w-5 text-emerald-600" /> Add Social Link
            </DialogTitle>
            <DialogDescription>
              One link per platform — the row shows in the public website footer, in this order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label htmlFor="social-platform" className="text-xs font-semibold mb-1 block">Platform</Label>
              <Select value={newPlatform} onValueChange={setNewPlatform}>
                <SelectTrigger id="social-platform" className="w-full" aria-label="Platform">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="social-url" className="text-xs font-semibold mb-1 block">URL</Label>
              <Input
                id="social-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder={platformMeta(newPlatform).placeholder}
                maxLength={300}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Must start with http:// or https://.</p>
            </div>
            <div>
              <Label htmlFor="social-label" className="text-xs font-semibold mb-1 block">Label (optional)</Label>
              <Input
                id="social-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Follow our school"
                maxLength={60}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {creating ? 'Adding…' : 'Add Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Remove link?</DialogTitle>
            <DialogDescription>
              The {deleteTarget ? platformMeta(deleteTarget.platform).label : ''} link will be removed from the public website footer.
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

function SocialLinkRowCard({
  link,
  isFirst,
  isLast,
  onMove,
  onDelete,
  onChanged,
}: {
  link: SocialLinkRow
  isFirst: boolean
  isLast: boolean
  onMove: (dir: 'up' | 'down') => void
  onDelete: () => void
  onChanged: () => void
}) {
  const meta = platformMeta(link.platform)
  const Icon = meta.icon
  const [url, setUrl] = useState(link.url)
  const [label, setLabel] = useState(link.label ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = url !== link.url || label !== (link.label ?? '')

  useEffect(() => {
    setUrl(link.url)
    setLabel(link.label ?? '')
  }, [link.url, link.label])

  const save = async () => {
    if (!/^https?:\/\/.+\..+/i.test(url.trim())) {
      toast.error('Link URL must be a valid http(s) address.')
      return
    }
    setBusy(true)
    const result = await apiJson(`/api/school/website/social-links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), label: label.trim() || null }),
    })
    setBusy(false)
    if (result.ok) {
      toast.success('Link saved')
      onChanged()
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/40 p-3.5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0" aria-hidden>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label={`${meta.label} URL`}
            className="h-8 text-xs"
            maxLength={300}
            placeholder={meta.placeholder}
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={`${meta.label} label`}
            className="h-8 text-xs"
            maxLength={60}
            placeholder="Label (optional)"
          />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            disabled={isFirst || busy}
            onClick={() => onMove('up')}
            aria-label={`Move ${meta.label} link up`}
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            disabled={isLast || busy}
            onClick={() => onMove('down')}
            aria-label={`Move ${meta.label} link down`}
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          {dirty ? (
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-[10px] gap-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
            </Button>
          ) : (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label={`Open ${meta.label} link`}
              title="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
            onClick={onDelete}
            aria-label={`Remove ${meta.label} link`}
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
