'use client'

/**
 * Website Management — Overview section (task 2-a).
 *
 * Summary cards composed from the module's own APIs (notices lifecycle
 * counts, gallery counts, admissions state) plus the read-only domain
 * status card (GET /api/school/domains — the platform-owned custom-
 * domain projection). Quick links deep-link into each section.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Globe, Megaphone, CalendarClock, FileText, Images, DoorOpen, ArrowRight,
  AlertTriangle, RefreshCw, ShieldCheck, Info, Link2, ImageIcon, PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { GlassCard } from '@/components/shared/ui'
import { toast } from 'sonner'
import { apiJson } from './shared'
import type { WebsiteNoticeRow } from './notices'

interface DomainRow {
  id: string
  hostname: string
  isPrimary: boolean
  status: string
  lastCheckedAt: string | null
  verifiedAt: string | null
  createdAt: string
}

interface GalleryAlbumSummary {
  id: string
  title: string
  published: boolean
  imageCount: number
}

interface AdmissionSummary {
  status: string
  session: string | null
  published: boolean
}

export type WebsiteSectionKey =
  | 'overview' | 'homepage' | 'notices' | 'announcements' | 'gallery'
  | 'admissions' | 'about' | 'academics' | 'facilities' | 'contact'
  | 'social-links' | 'media-library'

export function OverviewSection({ onNavigate }: { onNavigate: (key: WebsiteSectionKey) => void }) {
  const [notices, setNotices] = useState<WebsiteNoticeRow[] | null>(null)
  const [albums, setAlbums] = useState<GalleryAlbumSummary[] | null>(null)
  const [admission, setAdmission] = useState<AdmissionSummary | null>(null)
  const [domains, setDomains] = useState<DomainRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Four independent reads — one failure degrades to the error card
    // with whatever loaded kept visible.
    const [noticesRes, galleryRes, admissionRes, domainsRes] = await Promise.all([
      apiJson<{ notices: WebsiteNoticeRow[] }>('/api/school/website/notices'),
      apiJson<{ albums: GalleryAlbumSummary[] }>('/api/school/website/gallery'),
      apiJson<{ admission: AdmissionSummary | null }>('/api/school/website/admissions'),
      fetch('/api/school/domains', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
    let failed = false
    if (noticesRes.ok) setNotices(noticesRes.data?.notices ?? [])
    else failed = true
    if (galleryRes.ok) setAlbums(galleryRes.data?.albums ?? [])
    else failed = true
    if (admissionRes.ok) setAdmission(admissionRes.data?.admission ?? null)
    else failed = true
    if (domainsRes && typeof domainsRes === 'object' && domainsRes.ok && Array.isArray(domainsRes.data?.domains)) {
      setDomains(domainsRes.data.domains as DomainRow[])
    } else {
      setDomains([]) // domain status is best-effort on the overview
    }
    if (failed) {
      setError('Some website data could not be loaded. Retry or open the affected section below.')
      toast.error('Some website data could not be loaded.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const noticeKinds = (kind: string) => (notices ?? []).filter((n) => n.kind === kind)
  const publishedCount = (notices ?? []).filter((n) => n.effectiveStatus === 'PUBLISHED').length
  const scheduledCount = (notices ?? []).filter((n) => n.effectiveStatus === 'SCHEDULED').length
  const draftCount = (notices ?? []).filter((n) => n.effectiveStatus === 'DRAFT').length
  const expiredCount = (notices ?? []).filter((n) => n.effectiveStatus === 'EXPIRED').length
  const publishedAlbums = (albums ?? []).filter((a) => a.published).length
  const imageCount = (albums ?? []).reduce((sum, a) => sum + (a.imageCount ?? 0), 0)

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 sm:p-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-600" /> Website Overview
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              Everything on this screen is live on your public website. Drafts stay private until you publish them.
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => void load()} aria-label="Refresh overview">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-700 dark:text-amber-300" role="alert">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}
      </GlassCard>

      {loading && notices === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <GlassCard key={i} className="p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </GlassCard>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Notices lifecycle */}
          <SummaryCard
            icon={<Megaphone className="h-4 w-4" />}
            title="Notices"
            value={String(publishedCount)}
            unit="published"
            meta={[
              `${scheduledCount} scheduled`,
              `${draftCount} draft${draftCount === 1 ? '' : 's'}`,
              ...(expiredCount ? [`${expiredCount} expired`] : []),
            ]}
            onClick={() => onNavigate('notices')}
          />
          {/* Announcements */}
          <SummaryCard
            icon={<PartyPopper className="h-4 w-4" />}
            title="Announcements"
            value={String(noticeKinds('ANNOUNCEMENT').filter((n) => n.effectiveStatus === 'PUBLISHED').length)}
            unit="live highlights"
            meta={[
              `${noticeKinds('ANNOUNCEMENT').length} total`,
            ]}
            onClick={() => onNavigate('announcements')}
          />
          {/* Gallery */}
          <SummaryCard
            icon={<Images className="h-4 w-4" />}
            title="Gallery"
            value={`${publishedAlbums}/${albums?.length ?? 0}`}
            unit="albums live"
            meta={[`${imageCount} photo${imageCount === 1 ? '' : 's'}`]}
            onClick={() => onNavigate('gallery')}
          />
          {/* Admissions */}
          <SummaryCard
            icon={<DoorOpen className="h-4 w-4" />}
            title="Admissions"
            value={
              admission
                ? admission.status === 'OPEN' ? 'OPEN' : 'CLOSED'
                : 'Not set'
            }
            unit={admission?.session ? `session ${admission.session}` : 'no session set'}
            meta={[
              admission ? (admission.published ? 'published on the website' : 'saved, not published') : 'no block configured',
            ]}
            onClick={() => onNavigate('admissions')}
          />
          {/* Social links */}
          <SummaryCard
            icon={<Link2 className="h-4 w-4" />}
            title="Social Links"
            value="—"
            unit="manage below"
            meta={['Icon row in the public footer']}
            onClick={() => onNavigate('social-links')}
          />
          {/* Media library */}
          <SummaryCard
            icon={<ImageIcon className="h-4 w-4" />}
            title="Media Library"
            value="—"
            unit="manage below"
            meta={['Every website image, private until published']}
            onClick={() => onNavigate('media-library')}
          />
        </div>
      )}

      {/* Domain status (read-only — platform-owned infrastructure) */}
      <GlassCard className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold">School website domain</h3>
            <p className="text-xs text-muted-foreground">Connection status of your school website address</p>
          </div>
        </div>
        {domains === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : domains.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 text-muted-foreground text-xs p-3">
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              No custom domain connected yet. Your school website is served on its SCHOLARIO address
              (or its tenant link). Contact SCHOLARIO support to connect your own domain — the platform
              team configures and verifies it.
            </span>
          </div>
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.hostname}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.status === 'VERIFIED'
                      ? `Connected${d.verifiedAt ? ` since ${new Date(d.verifiedAt).toLocaleDateString()}` : ''}`
                      : 'Connection in progress — the platform team is verifying it'}
                    {d.isPrimary ? ' · primary' : ''}
                  </p>
                </div>
                <Badge variant={d.status === 'VERIFIED' ? 'default' : 'secondary'} className="gap-1 shrink-0">
                  {d.status === 'VERIFIED' ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {d.status === 'VERIFIED' ? 'Connected' : d.status.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Quick links */}
      <GlassCard className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold mb-3">Edit sections</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {(
            [
              { key: 'homepage', label: 'Homepage', icon: Globe },
              { key: 'notices', label: 'Notices', icon: Megaphone },
              { key: 'announcements', label: 'Announcements', icon: PartyPopper },
              { key: 'gallery', label: 'Gallery', icon: Images },
              { key: 'admissions', label: 'Admissions', icon: DoorOpen },
              { key: 'about', label: 'About', icon: FileText },
              { key: 'academics', label: 'Academics', icon: CalendarClock },
              { key: 'facilities', label: 'Facilities', icon: Images },
              { key: 'contact', label: 'Contact', icon: Megaphone },
              { key: 'social-links', label: 'Social Links', icon: Link2 },
              { key: 'media-library', label: 'Media Library', icon: ImageIcon },
            ] as Array<{ key: WebsiteSectionKey; label: string; icon: React.ComponentType<{ className?: string }> }>
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 h-10 text-xs font-medium text-foreground hover:border-foreground/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <item.icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden />
              <span className="truncate">{item.label}</span>
              <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" aria-hidden />
            </button>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

function SummaryCard({
  icon,
  title,
  value,
  unit,
  meta,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  value: string
  unit: string
  meta: string[]
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card/40 p-4 space-y-2 hover:border-foreground/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${title}`}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground/40">·</span>}
            <span>{m}</span>
          </span>
        ))}
      </div>
    </button>
  )
}
