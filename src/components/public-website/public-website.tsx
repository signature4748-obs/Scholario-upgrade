'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Building2,
  Bus,
  Check,
  Compass,
  Facebook,
  FlaskConical,
  Globe,
  GraduationCap,
  Heart,
  Instagram,
  Laptop,
  Library,
  Link2,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MonitorPlay,
  Music,
  Palette,
  Paperclip,
  PartyPopper,
  Phone,
  Pin,
  Quote,
  Rocket,
  Rss,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Trophy,
  Twitter,
  X,
  Youtube,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/lib/store/auth-store'
import { usePublicSchoolData, useAdmissionForm } from './use-public-website-data'
import { SaasLanding } from '@/components/marketing/saas-landing'
import type {
  PublicSchoolData,
  PublicGalleryAlbum,
  PublicWebsiteNotice,
  PublicAdmissionsStatus,
  PublicSocialLink,
} from './types'
import {
  NEUTRAL_WEBSITE_CONTENT,
  websiteSeo,
  type WebsiteContent,
  type PillarItem,
} from '@/lib/website-content'
import { isValidHexColor } from '@/lib/branding-contrast'

/* ------------------------------------------------------------------ */
/*  Small primitives — kept local to this file so the landing page    */
/*  is fully self-contained (no external section files needed).       */
/* ------------------------------------------------------------------ */

type FadeInProps = {
  children: React.ReactNode
  className?: string
}

function FadeIn({ children, className }: FadeInProps) {
  // ARCHITECTURE RESET — RESTRAINED ANIMATION: scroll-reveal (opacity 0 →
  // 1 on viewport entry) is retired. It blanked below-the-fold content for
  // crawlers' screenshots, print, and slow devices, and decorative reveal
  // adds nothing a school website needs. Content is always visible; the
  // wrapper stays for section spacing semantics. data-fadein is kept for
  // the print stylesheet contract.
  void 0
  return (
    <div className={className} data-fadein>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ARCHITECTURE RESET — per-school branding                           */
/*                                                                     */
/*  The resolved school's themeColor/accentColor (server-validated     */
/*  hex) become CSS custom properties on the site wrapper. The         */
/*  `school-brand-*` token classes (globals.css) consume them, so      */
/*  brand colors own the identity surfaces (solid CTA, links, rules,   */
/*  notice accents) while the structural surfaces stay a neutral       */
/*  light slate design language.                                       */
/* ------------------------------------------------------------------ */

const BRAND_DEFAULT_PRIMARY = '#0f766e' // Scholario brand fallback
const BRAND_DEFAULT_ACCENT = '#f59e0b' // Scholario amber fallback

function resolveBrandColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && isValidHexColor(value) ? value.trim() : fallback
}

function brandVars(themeColor?: string, accentColor?: string): React.CSSProperties {
  return {
    '--school-primary': resolveBrandColor(themeColor, BRAND_DEFAULT_PRIMARY),
    '--school-accent': resolveBrandColor(accentColor, BRAND_DEFAULT_ACCENT),
  } as React.CSSProperties
}

/* CMS icon-key → lucide icon (exactly the WEBSITE_ICON_KEYS registry). */
const CMS_ICON_MAP: Record<string, LucideIcon> = {
  target: Target,
  heart: Heart,
  building: Building2,
  shield: ShieldCheck,
  sprout: Sprout,
  compass: Compass,
  rocket: Rocket,
  library: Library,
  flask: FlaskConical,
  trophy: Trophy,
  monitor: MonitorPlay,
  bus: Bus,
  palette: Palette,
  globe: Globe,
  music: Music,
  laptop: Laptop,
}

function cmsIcon(key: string): LucideIcon {
  return CMS_ICON_MAP[key] ?? Building2
}

/* Solid tenant-primary CTA — white text on a flat school-primary fill. */
function PrimaryCta({
  children,
  onClick,
  href,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  className?: string
}) {
  const cls = `group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:brightness-95 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${className}`
  if (href) {
    return (
      <a href={href} className={cls} style={{ backgroundColor: 'var(--school-primary)' }}>
        {children}
      </a>
    )
  }
  return (
    <button onClick={onClick} className={cls} style={{ backgroundColor: 'var(--school-primary)' }}>
      {children}
    </button>
  )
}

/* Quiet secondary CTA — white card, hairline slate border. */
function GhostCta({
  children,
  onClick,
  href,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  className?: string
}) {
  const cls = `inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-sm font-semibold border border-slate-300 bg-white text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${className}`
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  )
}

/* School logo — uploaded branding image when configured, a solid
 * school-primary monogram (initials) otherwise. Used by the header +
 * footer. */
function BrandLogo({
  logoUrl,
  shortName,
  className = 'h-10 w-10',
}: {
  logoUrl?: string | null
  shortName: string
  className?: string
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`${shortName} logo`}
        width={48}
        height={48}
        className={`${className} rounded-lg object-contain border border-slate-200 bg-white p-0.5 shrink-0`}
      />
    )
  }
  const initials = shortName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div
      aria-hidden="true"
      className={`${className} rounded-lg flex items-center justify-center text-white font-display font-bold text-sm shrink-0`}
      style={{ backgroundColor: 'var(--school-primary)' }}
    >
      {initials || 'S'}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Unified section header — optional eyebrow / display heading /      */
/*  school-primary rule / subtitle (only when the CMS provides one).   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  SectionPlaceholder — PRODUCT-DIRECTION RESET (Part 6): a newly
 *  onboarded school gets a functional website shell; sections it has
 *  not configured render a CLEAN PLACEHOLDER instead of hiding
 *  ("About this school" / "Content will appear here once configured
 *  by the school."). No invented facts — ever.
 * ------------------------------------------------------------------ */
function SectionPlaceholder({
  eyebrow,
  title,
  sectionId,
  alternate,
  note,
}: {
  eyebrow: string
  title: string
  sectionId: string
  alternate?: boolean
  note?: string
}) {
  return (
    <section id={sectionId} className={alternate ? 'bg-slate-50' : ''}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow={eyebrow} title={title} />
        <FadeIn>
          <div className="mx-auto max-w-2xl rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <Sparkles className="mx-auto mb-3 h-5 w-5 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-slate-500">
              {note ?? 'Content will appear here once configured by the school.'}
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title?: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <FadeIn className="text-center mb-12 lg:mb-16">
      {eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-[0.2em] school-brand-text">
          {eyebrow}
        </span>
      ) : null}
      {title ? (
        <h2 className="mt-3 font-display text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 text-balance">
          {title}
        </h2>
      ) : null}
      <span aria-hidden="true" className="mx-auto mt-5 block h-0.5 w-10 rounded-full school-brand-bar" />
      {subtitle ? (
        <p className="mt-4 text-base lg:text-lg text-slate-600 max-w-2xl mx-auto text-balance">
          {subtitle}
        </p>
      ) : null}
      {children}
    </FadeIn>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PublicWebsite() {
  const { isAuthenticated, user, logout } = useAuth()
  void isAuthenticated
  void user
  void logout

  const { schoolData, via, requestedSlug, loading } = usePublicSchoolData()

  const {
    admForm,
    setAdmForm,
    admSubmitting,
    admSuccess,
    setAdmSuccess,
    admError,
    handleAdmissionSubmit,
  } = useAdmissionForm(schoolData?.slug)

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // The CMS document (server merges neutral fallbacks for unconfigured
  // schools; the hero title falls back to the school name server-side).
  const content: WebsiteContent = schoolData?.websiteContent ?? NEUTRAL_WEBSITE_CONTENT

  // Content gating — the CMS is the source of truth; sections render their
  // real content when the school configured it and a clean placeholder
  // when it has not (Part 6) — never invented copy.
  const pillars = Array.isArray(content.pillars) ? content.pillars : []
  const albums = (schoolData?.gallery ?? []).filter(
    (a) => Array.isArray(a?.images) && a.images.length > 0,
  )

  // Task 2-a — the notice board merges the ERP broadcast announcements
  // with the CMS website notices (kind NOTICE): PINNED CMS notices first,
  // then newest-first across both sources. Nothing here renders a draft —
  // the public payload only ever carries live-published rows.
  const cmsNotices = schoolData?.notices ?? []
  const celebrationItems = schoolData?.websiteAnnouncements ?? []
  const notices: PublicNotice[] = [
    ...cmsNotices.map((n) => ({
      id: `cms-${n.id}`,
      title: n.title,
      message: n.body,
      createdAt: n.publishedAt,
      priority: 'NORMAL',
      imageUrl: null as string | null,
      category: n.category,
      pinned: n.pinned,
      attachmentUrl: n.attachmentUrl,
    })),
    ...(schoolData?.announcements ?? []).map((n) => ({
      id: `bc-${n.id}`,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt,
      priority: n.priority,
      imageUrl: n.imageUrl ?? null,
      category: null as string | null,
      pinned: false,
      attachmentUrl: null as string | null,
    })),
  ].sort((a, b) => {
    if ((b.pinned ?? false) !== (a.pinned ?? false)) return (b.pinned ?? false) ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  // Nav links (Part 6): Home/About/Academics/Campus/Notices/Admissions/
  // Contact all exist as sections — with real content OR the clean
  // placeholder state — so the shell is a complete school website from
  // the moment of onboarding.
  const navLinks = [
    { label: 'About', href: '#about' },
    { label: 'Academics', href: '#journey' },
    { label: 'Campus Life', href: '#campus-life' },
    { label: 'Notices', href: '#notices' },
    { label: 'Admissions', href: '#admissions' },
    { label: 'Contact', href: '#footer' },
  ]

  // SEO — client-rendered <title>/<meta description> from the CMS doc.
  // Runs ONLY on the school-website branch (the SaaS landing manages its
  // own head).
  useEffect(() => {
    if (!schoolData) return
    const prevTitle = document.title
    const seo = websiteSeo(content, schoolData.name)
    document.title = seo.title
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const prevDesc = meta?.getAttribute('content') ?? null
    if (meta && seo.description) meta.setAttribute('content', seo.description)
    return () => {
      document.title = prevTitle
      if (meta && prevDesc !== null) meta.setAttribute('content', prevDesc)
    }
  }, [schoolData, content])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // close mobile menu on resize to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Full-page loading state (before any surface is known) ──
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading school website"
        className="min-h-screen bg-white flex items-center justify-center"
      >
        <span className="sr-only">Loading school website</span>
        <div className="h-10 w-10 rounded-full bg-slate-200 animate-pulse" aria-hidden="true" />
      </div>
    )
  }

  // ── SCHOLARIO SaaS website (no tenant owns this domain visit) ────
  // (inline condition — guarantees `schoolData` narrowing below)
  if (!schoolData) {
    return <SaasLanding notFoundForSlug={requestedSlug} />
  }
  void via

  // ── The school website (tenant-branded, content-gated) ──
  const schoolName = schoolData.name || 'Our School'
  const shortName = schoolData.shortName || schoolName.split(' ')[0] || 'Our School'

  /* PRODUCT-DIRECTION RESET (Part 7) — the School Login door is the
   * tenant-scoped /login route. On the school's own domain (via ===
   * 'domain') the hostname carries the tenant; everywhere else the
   * tenant link parameter is forwarded so the login is THAT school's
   * door — never a platform-wide school picker. */
  const openSchoolLogin = () => {
    const href =
      via === 'domain'
        ? '/login'
        : `/login?tenant=${encodeURIComponent(schoolData.slug)}`
    window.location.assign(href)
  }

  return (
    <div
      style={brandVars(schoolData.themeColor, schoolData.accentColor)}
      className="min-h-screen bg-white text-slate-900 selection:bg-slate-200 selection:text-slate-900 flex flex-col"
    >
      <Header
        shortName={shortName}
        logoUrl={schoolData.logoUrl}
        scrolled={scrolled}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onOpenPortal={openSchoolLogin}
        navLinks={navLinks}
      />

      <main>
        <Hero
          schoolData={schoolData}
          hero={content.hero}
          onOpenPortal={openSchoolLogin}
        />

        <WhyChooseUs shortName={shortName} about={content.about} pillars={pillars} />

        <Journey journey={content.journey} />

        <Facilities facilities={content.facilities} />

        <PrincipalMessage
          message={content.principalMessage}
          principalName={schoolData.principalName || ''}
          schoolName={schoolName}
          shortName={shortName}
          logoUrl={schoolData.logoUrl}
        />

        <CampusLife shortName={shortName} albums={albums} />

        {/* Task 2-a — celebrations & achievements highlights strip
            (CMS announcements, kind ANNOUNCEMENT). Renders nothing when
            the school has none — honest-empty discipline. */}
        <AnnouncementsStrip items={celebrationItems} />

        <NoticeBoard notices={notices} onOpenPortal={openSchoolLogin} />

        <Admissions
          admissions={content.admissions}
          status={schoolData.admissions ?? null}
          phone={schoolData.phone || ''}
          admForm={admForm}
          setAdmForm={setAdmForm}
          admSubmitting={admSubmitting}
          admSuccess={admSuccess}
          setAdmSuccess={setAdmSuccess}
          admError={admError}
          handleAdmissionSubmit={handleAdmissionSubmit}
        />
      </main>

      <Footer
        schoolName={schoolName}
        shortName={shortName}
        tagline={schoolData.tagline || ''}
        logoUrl={schoolData.logoUrl}
        phone={schoolData.phone || ''}
        email={schoolData.email || ''}
        address={schoolData.address || ''}
        city={schoolData.city || ''}
        website={schoolData.website || ''}
        established={schoolData.established || ''}
        footer={content.footer}
        contact={content.contact}
        socialLinks={schoolData.socialLinks ?? []}
        quickLinks={navLinks.filter((l) => l.href !== '#footer')}
        onOpenPortal={openSchoolLogin}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Header — solid white, hairline border, shadow only after scroll    */
/* ------------------------------------------------------------------ */

function Header({
  shortName,
  logoUrl,
  scrolled,
  mobileMenuOpen,
  setMobileMenuOpen,
  onOpenPortal,
  navLinks,
}: {
  shortName: string
  logoUrl?: string | null
  scrolled: boolean
  mobileMenuOpen: boolean
  setMobileMenuOpen: (v: boolean) => void
  onOpenPortal: () => void
  navLinks: Array<{ label: string; href: string }>
}) {
  return (
    <header
      className={`sticky top-0 z-50 bg-white border-b border-slate-200 transition-shadow duration-300 ${
        scrolled ? 'shadow-sm' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Logo + school name */}
        <a href="#top" className="flex items-center gap-3 group min-w-0">
          <BrandLogo logoUrl={logoUrl} shortName={shortName} className="h-10 w-10" />
          <div className="leading-tight min-w-0">
            <h1 className="font-display font-bold text-slate-900 text-base truncate">{shortName}</h1>
          </div>
        </a>

        {/* Desktop nav — only sections that actually render */}
        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Primary">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="relative hover:text-slate-900 transition-colors after:content-[''] after:absolute after:-bottom-1.5 after:left-0 after:right-0 after:h-0.5 after:bg-[var(--school-primary)] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300 after:origin-left"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-3">
          <button
            onClick={onOpenPortal}
            className="group inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            style={{ backgroundColor: 'var(--school-primary)' }}
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            School Login
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          className="lg:hidden h-11 w-11 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="lg:hidden bg-white border-t border-slate-200 overflow-hidden"
        >
          <nav className="px-4 sm:px-6 py-4 flex flex-col gap-1" aria-label="Mobile">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileMenuOpen(false)}
                className="py-3 px-3 -mx-3 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
              >
                {l.label}
              </a>
            ))}

            <div className="mt-3 pt-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  onOpenPortal()
                }}
                className="w-full inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 active:brightness-95"
                style={{ backgroundColor: 'var(--school-primary)' }}
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                School Login
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </nav>
        </motion.div>
      )}
    </header>
  )
}

/* ------------------------------------------------------------------ */
/*  Hero — CMS copy (typographic) + optional CMS photograph            */
/* ------------------------------------------------------------------ */

type Stat = { label: string; value: string }

/** REAL DATA CONTRACT: the stat row shows the school's real DB counts
 * (students / faculty / classes) and the establishment year ONLY when
 * the school actually recorded one. Zero / missing stats are hidden —
 * never a fabricated number and never an awkward "0 Students". */
function realHeroStats(counts?: PublicSchoolData['counts'], established?: string): Stat[] {
  const stats: Stat[] = []
  if (typeof counts?.students === 'number' && counts.students > 0) {
    stats.push({ label: 'Students', value: counts.students.toLocaleString('en-IN') })
  }
  if (typeof counts?.teachers === 'number' && counts.teachers > 0) {
    stats.push({ label: 'Faculty', value: counts.teachers.toLocaleString('en-IN') })
  }
  if (typeof counts?.classes === 'number' && counts.classes > 0) {
    stats.push({ label: 'Classes', value: String(counts.classes) })
  }
  const est = established?.trim()
  if (est) stats.push({ label: 'Established', value: est })
  return stats
}

function Hero({
  schoolData,
  hero,
  onOpenPortal,
}: {
  schoolData: PublicSchoolData
  hero: WebsiteContent['hero']
  onOpenPortal: () => void
}) {
  const counts = schoolData.counts
  const schoolName = schoolData.name || 'Our School'
  const city = schoolData.city || ''
  const established = schoolData.established || ''
  const academicYear = schoolData.academicYear || ''

  // The badge needs the canonical academic year; the school controls the
  // prefix, so the badge hides entirely until the prefix is configured.
  const badgePrefix = hero.badgePrefix?.trim() || ''
  const badgeText = [badgePrefix, academicYear].filter(Boolean).join(' ')
  const showBadge = badgePrefix.length > 0

  // Factual hero line — only real recorded fields, never invented copy.
  const factualLine = [
    city,
    established ? `Estd. ${established}` : '',
  ].filter(Boolean).join(' · ')

  const ctaPrimaryLabel = hero.ctaPrimary?.label || 'Apply for Admission'
  const ctaPrimaryHref = hero.ctaPrimary?.href || '#admissions'
  const secondaryLabel = hero.ctaSecondary?.label?.trim() || 'School Login'
  const secondaryHref = hero.ctaSecondary?.href?.trim() || ''

  // Hero photograph — ONLY when the school configured one via the CMS.
  const heroImageId = typeof hero.imageId === 'string' ? hero.imageId.trim() : ''

  const heroCopy = (
    <FadeIn className="space-y-6 min-w-0">
      {showBadge && badgeText ? (
        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full school-brand-badge border bg-white text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5 school-brand-text" aria-hidden="true" />
          {badgeText}
        </span>
      ) : null}

      <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] text-slate-900 text-balance">
        {hero.title}
        {hero.titleAccent ? (
          <>
            <br />
            <span className="school-brand-text">{hero.titleAccent}</span>
          </>
        ) : null}
      </h2>

      {hero.description ? (
        <p className="text-lg text-slate-600 max-w-xl leading-relaxed text-pretty">
          {hero.description}
        </p>
      ) : factualLine ? (
        <p className="text-base text-slate-500 max-w-xl">{factualLine}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <PrimaryCta href={ctaPrimaryHref}>
          {ctaPrimaryLabel}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
        </PrimaryCta>
        {secondaryHref ? (
          <GhostCta href={secondaryHref}>{secondaryLabel}</GhostCta>
        ) : (
          <GhostCta onClick={onOpenPortal}>{secondaryLabel}</GhostCta>
        )}
      </div>
    </FadeIn>
  )

  return (
    <section id="top" className="relative overflow-hidden">
      {/* Photo heroes keep gallery-scale breathing room; the clean
          typographic hero (no configured photo) uses a tighter rhythm so
          sparse pages never read as a broken, gap-heavy layout. */}
      <div
        className={`max-w-7xl mx-auto px-4 sm:px-6 ${
          heroImageId ? 'pt-14 pb-14 lg:pt-24 lg:pb-20' : 'pt-14 pb-10 lg:pt-20 lg:pb-12'
        }`}
      >
        {heroImageId ? (
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {heroCopy}

            {/* Right — the school's own CMS photograph (never a stock
                default). Rounded frame with the school-accent border. */}
            <FadeIn className="relative min-w-0">
              <div className="relative">
                {/* offset frame — peeks out behind the photograph */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 translate-x-4 translate-y-4 lg:translate-x-6 lg:translate-y-6 rounded-[1.75rem] border pointer-events-none"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--school-accent) 35%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--school-accent) 6%, transparent)',
                  }}
                />

                <div className="relative aspect-[4/3] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-100 shadow-sm">
                  <Image
                    src={`/api/public/website/media/${heroImageId}`}
                    alt={`${schoolName} — campus`}
                    fill
                    priority
                    sizes="(min-width: 1024px) 45vw, 100vw"
                    className="object-cover"
                  />
                  {/* solid caption chip (school name + city) */}
                  <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-baseline gap-2 rounded-lg bg-slate-950/70 px-3 py-2">
                    <p className="font-display font-semibold text-white text-sm truncate">{schoolName}</p>
                    {city ? <p className="text-xs text-white/80 shrink-0">{city}</p> : null}
                  </div>
                </div>

                {/* Floating stat — ONE REAL number (the school's live
                    student count; hidden entirely when the count is not
                    available or zero — never a fabricated figure). */}
                {typeof counts?.students === 'number' && counts.students > 0 && (
                  <div className="absolute -bottom-5 -left-2 sm:-left-6 lg:-left-8">
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4 flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-lg school-brand-soft flex items-center justify-center shrink-0">
                        <GraduationCap className="w-5 h-5 school-brand-text" strokeWidth={1.75} aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-display text-2xl font-bold text-slate-900 tabular-nums leading-none">
                          {counts.students.toLocaleString('en-IN')}
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 mt-1.5">
                          {counts.students === 1 ? 'Student enrolled' : 'Students enrolled'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </FadeIn>
          </div>
        ) : (
          // Clean typographic hero — school name + factual line, no photo.
          <div className="max-w-3xl">{heroCopy}</div>
        )}

        {/* Stat row — the institution at a glance (REAL counts, quiet
            hairline dividers; hidden entirely when nothing is recorded). */}
        <TrustBar counts={counts} established={established} />
      </div>
    </section>
  )
}

function TrustBar({
  counts,
  established,
}: {
  counts?: PublicSchoolData['counts']
  established?: string
}) {
  const stats = realHeroStats(counts, established)
  // A single lonely stat reads as a broken row — show the stat strip only
  // when at least two real values exist.
  if (stats.length < 2) return null
  return (
    <FadeIn className="mt-14 lg:mt-16">
      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-slate-200 sm:divide-x sm:divide-slate-200">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center text-center gap-1.5 py-6 sm:py-7 px-3 min-w-0">
            <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-slate-900">
              {stat.value}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </FadeIn>
  )
}

/* ------------------------------------------------------------------ */
/*  Why families choose us — CMS pillars (render only when configured) */
/* ------------------------------------------------------------------ */

function WhyChooseUs({
  shortName,
  about,
  pillars,
}: {
  shortName: string
  about: WebsiteContent['about']
  pillars: PillarItem[]
}) {
  if (pillars.length === 0) {
    // Part 6 — clean placeholder until the school writes its own content.
    return (
      <SectionPlaceholder
        eyebrow="About"
        title={about.title?.trim() || `About ${shortName}`}
        sectionId="about"
        alternate
      />
    )
  }

  const title = about.title?.trim() || `Why families choose ${shortName}`
  const subtitle = about.subtitle?.trim() || ''

  return (
    <section id="about" className="bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="About" title={title} subtitle={subtitle} />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {pillars.map((p, i) => {
            const Icon = cmsIcon(p.icon)
            return (
              <FadeIn key={`${p.title}-${i}`}>
                <div className="h-full rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
                  <div className="w-11 h-11 rounded-lg school-brand-soft flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 school-brand-text" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2.5">{p.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{p.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  A journey for every stage — CMS stages (render only when set)      */
/* ------------------------------------------------------------------ */

function Journey({
  journey,
}: {
  journey: WebsiteContent['journey']
}) {
  const stages = Array.isArray(journey?.stages) ? journey.stages : []
  if (stages.length === 0) {
    // Part 6 — clean placeholder until the school configures academics.
    return (
      <SectionPlaceholder
        eyebrow="Academics"
        title={journey.title?.trim() || 'Academics'}
        sectionId="journey"
      />
    )
  }

  const title = journey.title?.trim() || 'Academic stages'
  const subtitle = journey.subtitle?.trim() || ''

  return (
    <section id="journey">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="Academics" title={title} subtitle={subtitle} />

        {/* PIH-6 — [&>*]:min-w-0: grid items default to min-width:auto, so a
            long non-wrapping meta line blew the card 10px past the 320px
            viewport; min-w-0 lets the track hold and the badge truncate. */}
        <div className="grid md:grid-cols-3 gap-8 [&>*]:min-w-0">
          {stages.map((s, i) => {
            const Icon = cmsIcon(s.icon)
            return (
              <FadeIn key={`${s.title}-${i}`}>
                <div className="relative h-full rounded-xl border border-slate-200 bg-white pt-2 pb-7 px-7 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 overflow-hidden">
                  <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 school-brand-bar" />
                  <div className="flex items-center gap-4 mt-5 mb-2 min-w-0">
                    <div className="h-9 w-9 shrink-0 rounded-lg school-brand-soft flex items-center justify-center">
                      <Icon className="w-4 h-4 school-brand-text" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className="text-xs font-bold school-brand-text uppercase tracking-wider truncate">
                      {[s.grades, s.years].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <h3 className="font-display text-2xl font-bold text-slate-900 mb-3">{s.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{s.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Facilities — CMS items (render only when configured)               */
/* ------------------------------------------------------------------ */

function Facilities({
  facilities,
}: {
  facilities: WebsiteContent['facilities']
}) {
  const items = Array.isArray(facilities?.items) ? facilities.items : []
  if (items.length === 0) {
    // Part 6 — clean placeholder; facilities are never invented.
    return (
      <SectionPlaceholder
        eyebrow="Campus"
        title={facilities.title?.trim() || 'Our facilities'}
        sectionId="facilities"
        alternate
        note="Facility information will appear here once configured by the school."
      />
    )
  }

  const title = facilities.title?.trim() || 'Our facilities'
  const subtitle = facilities.subtitle?.trim() || ''

  return (
    <section id="facilities" className="bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="Campus" title={title} subtitle={subtitle} />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((f, i) => {
            const Icon = cmsIcon(f.icon)
            return (
              <FadeIn key={`${f.title}-${i}`}>
                <div className="h-full rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
                  <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 text-slate-600" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2.5">{f.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{f.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Principal's message — CMS-gated section (hidden unless enabled)   */
/* ------------------------------------------------------------------ */

function PrincipalMessage({
  message,
  principalName,
  schoolName,
  shortName,
  logoUrl,
}: {
  message: WebsiteContent['principalMessage']
  principalName: string
  schoolName: string
  shortName: string
  logoUrl?: string | null
}) {
  // Render ONLY when the school has enabled the section AND written a
  // message — an empty quote card would be a hollow promise.
  if (!message.enabled || !message.message.trim()) return null

  const name = principalName.trim() || 'The Principal'
  const title = message.title?.trim() || "Principal's message"
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <section id="principal-message">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="Leadership" title={title} />

        <FadeIn>
          <figure className="relative mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 sm:p-10 shadow-sm overflow-hidden">
            <div aria-hidden="true" className="absolute top-0 left-0 right-0 h-1 school-brand-bar" />
            <Quote className="w-9 h-9 school-brand-text mb-6" strokeWidth={1.5} aria-hidden="true" />
            <blockquote className="text-lg sm:text-xl leading-relaxed text-slate-700 text-pretty whitespace-pre-line">
              {message.message}
            </blockquote>
            <figcaption className="mt-8 flex items-center gap-4 min-w-0">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={`${shortName} logo`}
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 rounded-lg object-contain border border-slate-200 bg-white p-0.5"
                />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-lg school-brand-soft school-brand-text flex items-center justify-center font-display font-bold text-sm">
                  {initials || 'P'}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{name}</p>
                <p className="text-sm text-slate-500 truncate">Principal, {schoolName}</p>
              </div>
            </figcaption>
          </figure>
        </FadeIn>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Campus life — CMS gallery albums (only albums WITH images)         */
/* ------------------------------------------------------------------ */

/** Max images rendered per album (honest "...and N more" note beyond). */
const MAX_ALBUM_IMAGES = 12

const GALLERY_SIZES = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'

function CampusLife({
  shortName,
  albums,
}: {
  shortName: string
  albums: PublicGalleryAlbum[]
}) {
  // Per-school imagery is never fabricated: no published albums with
  // images → a clean placeholder (Part 6), never stock or invented media.
  if (albums.length === 0) {
    return (
      <SectionPlaceholder
        eyebrow="Gallery"
        title={`Life at ${shortName}`}
        sectionId="campus-life"
        alternate
        note="Photos and campus albums will appear here once the school publishes them."
      />
    )
  }

  return (
    <section id="campus-life" className="bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="Campus Life" title={`Life at ${shortName}`} />

        {albums.map((album) => {
          const images = album.images.slice(0, MAX_ALBUM_IMAGES)
          const hiddenCount = album.images.length - images.length
          return (
            <FadeIn key={album.id} className="mt-10 first:mt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-5">
                <h3 className="font-display text-xl font-bold text-slate-900">{album.title}</h3>
                {album.description ? (
                  <p className="text-sm text-slate-500">{album.description}</p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {images.map((img) => {
                  const alt = img.caption || album.title
                  return (
                    <figure key={img.id} className="relative m-0 aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm group">
                      <Image
                        src={img.url}
                        alt={alt}
                        fill
                        sizes={GALLERY_SIZES}
                        loading="lazy"
                        className="object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-105"
                      />
                      {img.caption ? (
                        <figcaption className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-slate-950/75 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none truncate">
                          {img.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  )
                })}
              </div>
              {hiddenCount > 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  …and {hiddenCount} more {hiddenCount === 1 ? 'photo' : 'photos'} in this album.
                </p>
              ) : null}
            </FadeIn>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Notice board — live school announcements (render only when any)    */
/*  Task 2-a — also carries the CMS website notices (category badges,  */
/*  pinned-first ordering, document attachment links).                 */
/* ------------------------------------------------------------------ */

const NOTICE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface PublicNotice {
  id: string
  title: string
  message: string
  createdAt: string
  priority: string
  imageId?: string | null
  imageUrl?: string | null
  /** Task 2-a — CMS notice badge label ("Examination", "Holiday"…). */
  category?: string | null
  /** Task 2-a — pinned CMS notices render before everything else. */
  pinned?: boolean
  /** Task 2-a — same-origin document link (served while published). */
  attachmentUrl?: string | null
}

/** Task 2-a — a dated document/link chip for notice attachments. */
function NoticeAttachmentLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      aria-label="Open the notice attachment (opens in a new tab)"
      title="Open attachment"
    >
      <Paperclip className="h-3 w-3" aria-hidden="true" />
      Attachment
    </a>
  )
}

/** Task 2-a — celebrations & achievements highlights strip (CMS
 *  announcements, kind ANNOUNCEMENT). Renders NOTHING when the school
 *  has none (honest-empty discipline — no placeholder strip). */
function AnnouncementsStrip({ items }: { items: PublicWebsiteNotice[] }) {
  if (!items || items.length === 0) return null
  return (
    <section aria-label="Announcements and achievements" className="bg-white border-y border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="flex items-center gap-2.5 mb-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg school-brand-soft school-brand-text">
            <PartyPopper className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Announcements</p>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">Celebrations &amp; achievements</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((n) => (
            <FadeIn key={n.id} className="min-w-0">
              <article
                aria-label={`Announcement: ${n.title}`}
                className="h-full rounded-xl border border-slate-200 bg-white shadow-sm p-5 transition-all hover:shadow-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {n.pinned ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      <Pin className="h-2.5 w-2.5" aria-hidden="true" /> Pinned
                    </span>
                  ) : null}
                  {n.category ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full school-brand-chip px-2.5 py-0.5 text-[11px] font-bold">
                      {n.category}
                    </span>
                  ) : null}
                  <time dateTime={n.publishedAt} className="text-[11px] text-slate-500">
                    {noticeRelativeTime(n.publishedAt)}
                  </time>
                </div>
                <h3 className="mt-2.5 text-sm font-bold leading-snug text-slate-900">{n.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 line-clamp-3">{n.body}</p>
                {n.attachmentUrl ? (
                  <div className="mt-3">
                    <NoticeAttachmentLink url={n.attachmentUrl} />
                  </div>
                ) : null}
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

const PRIORITY_TONES: Record<string, { label: string; chip: string; bar: string; dot: string }> = {
  URGENT: {
    label: 'Urgent',
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
  },
  HIGH: {
    label: 'Important',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
  },
  // The NORMAL priority accent follows the school brand (token classes;
  // see globals.css).
  NORMAL: {
    label: 'Notice',
    chip: 'school-brand-chip',
    bar: 'school-brand-bar',
    dot: 'school-brand-dot',
  },
}

function noticeTone(priority: string) {
  return PRIORITY_TONES[priority] ?? PRIORITY_TONES.NORMAL
}

function noticeDateParts(iso: string): { day: string; month: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { day: '—', month: '' }
  return { day: String(d.getDate()).padStart(2, '0'), month: NOTICE_MONTHS[d.getMonth()] }
}

function noticeRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr${diffHr > 1 ? 's' : ''} ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`
  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function NoticeDateTile({ iso }: { iso: string }) {
  const { day, month } = noticeDateParts(iso)
  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50"
    >
      <span className="text-lg font-bold leading-none text-slate-900">{day}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{month}</span>
    </div>
  )
}

function NoticeBoard({ notices, onOpenPortal }: { notices: PublicNotice[]; onOpenPortal: () => void }) {
  // No published announcements → a clean placeholder (Part 6); the
  // portal remains the authoritative notice channel.
  if (!notices || notices.length === 0) {
    return (
      <SectionPlaceholder
        eyebrow="Notice Board"
        title="Events & notices"
        sectionId="notices"
        note="School notices and event announcements will appear here once published."
      />
    )
  }

  return (
    <section id="notices">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader eyebrow="Notice Board" title="Latest notices">
          <a
            href="/api/public/notices/rss"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View all school notices — opens the full notice archive feed"
            title="Full notice archive — RSS feed"
            className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 shadow-sm transition-all hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            View all notices
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </SectionHeader>

        <NoticeBoardList notices={notices} onOpenPortal={onOpenPortal} />
      </div>
    </section>
  )
}

function NoticeBoardList({ notices, onOpenPortal }: { notices: PublicNotice[]; onOpenPortal: () => void }) {
  const [featured, ...rest] = notices.slice(0, 5)
  const featuredTone = noticeTone(featured.priority)
  const hasRest = rest.length > 0

  return (
    <>
      <div className="grid lg:grid-cols-5 gap-6 items-start [&>*]:min-w-0">
        {/* Featured notice — the newest broadcast gets the big canvas
            (with its optional image as a full-width banner). */}
        <FadeIn className={hasRest ? 'lg:col-span-3' : 'lg:col-span-5'}>
          <article
            aria-label={`Featured notice: ${featured.title}`}
            className="relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md"
          >
            <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-1.5 z-10 ${featuredTone.bar}`} />
            {featured.imageUrl ? (
              <div className="relative h-44 sm:h-52 overflow-hidden bg-slate-100">
                <Image
                  src={featured.imageUrl}
                  alt={featured.title}
                  fill
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start gap-5">
                <NoticeDateTile iso={featured.createdAt} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {featured.pinned ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        <Pin className="h-2.5 w-2.5" aria-hidden="true" /> Pinned
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${featuredTone.chip}`}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${featuredTone.dot}`} />
                      {featuredTone.label}
                    </span>
                    {featured.category ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full school-brand-chip px-2.5 py-0.5 text-[11px] font-bold">
                        {featured.category}
                      </span>
                    ) : null}
                    <time
                      dateTime={featured.createdAt}
                      className="text-xs font-medium text-slate-500"
                    >
                      {noticeRelativeTime(featured.createdAt)}
                    </time>
                  </div>
                  <h3 className="mt-3 font-display text-2xl font-bold leading-snug text-slate-900">
                    {featured.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-slate-600 line-clamp-5">
                    {featured.message}
                  </p>
                  {featured.attachmentUrl ? (
                    <div className="mt-4">
                      <NoticeAttachmentLink url={featured.attachmentUrl} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        </FadeIn>

        {/* Earlier notices — compact stack (optional image thumbs) */}
        {hasRest && (
          <div className="lg:col-span-2 flex flex-col gap-4">
            {rest.map((n) => {
              const tone = noticeTone(n.priority)
              return (
                <FadeIn key={n.id}>
                  <article
                    aria-label={`Notice: ${n.title}`}
                    className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
                  >
                    <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} />
                    <div className="flex items-start gap-4 pl-2">
                      <NoticeDateTile iso={n.createdAt} />
                      {n.imageUrl ? (
                        <Image
                          src={n.imageUrl}
                          alt=""
                          width={56}
                          height={56}
                          loading="lazy"
                          className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {n.pinned ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              <Pin className="h-2.5 w-2.5" aria-hidden="true" /> Pinned
                            </span>
                          ) : null}
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                            <span aria-hidden="true" className={`h-1 w-1 rounded-full ${tone.dot}`} />
                            {tone.label}
                          </span>
                          {n.category ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full school-brand-chip px-2 py-0.5 text-[10px] font-bold">
                              {n.category}
                            </span>
                          ) : null}
                          <time dateTime={n.createdAt} className="text-[11px] text-slate-500">
                            {noticeRelativeTime(n.createdAt)}
                          </time>
                        </div>
                        <h4 className="mt-2 truncate text-sm font-bold text-slate-900">{n.title}</h4>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600 line-clamp-2">
                          {n.message}
                        </p>
                        {n.attachmentUrl ? (
                          <div className="mt-2">
                            <NoticeAttachmentLink url={n.attachmentUrl} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </FadeIn>
              )
            })}
          </div>
        )}
      </div>

      <FadeIn className="mt-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white shadow-sm px-6 py-5">
          <p className="text-sm text-slate-600 text-center sm:text-left">
            Students, parents and staff see every notice first inside the portal —{' '}
            <span className="font-semibold text-slate-900">with live delivery to their dashboard.</span>
          </p>
          <GhostCta onClick={onOpenPortal} className="shrink-0">
            Open the portal <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </GhostCta>
        </div>
      </FadeIn>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Task 2-a — admissions status block (the published singleton).      */
/*  OPEN → the full status banner (classes, dates, notice, contacts,   */
/*  application CTA); CLOSED → a calm note; unpublished → nothing.     */
/* ------------------------------------------------------------------ */

function admissionsDateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function AdmissionsStatusBlock({ status }: { status: PublicAdmissionsStatus }) {
  if (status.status === 'CLOSED') {
    // Calm, factual closed note — no marketing pressure.
    return (
      <FadeIn className="min-w-0">
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white px-6 py-5 flex items-start gap-3.5 shadow-sm"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Lock className="h-4 w-4 text-slate-500" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-bold text-slate-900">
              Admissions are currently closed{status.session ? ` for session ${status.session}` : ''}
            </p>
            {status.noticeBody?.trim() ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{status.noticeBody}</p>
            ) : null}
            {(status.contactEmail || status.contactPhone) && (
              <p className="mt-2 text-xs text-slate-500">
                Questions?{' '}
                {status.contactEmail ? (
                  <a href={`mailto:${status.contactEmail}`} className="font-semibold text-slate-700 hover:underline">
                    {status.contactEmail}
                  </a>
                ) : null}
                {status.contactEmail && status.contactPhone ? ' · ' : null}
                {status.contactPhone ? (
                  <a href={`tel:${status.contactPhone}`} className="font-semibold text-slate-700 hover:underline">
                    {status.contactPhone}
                  </a>
                ) : null}
              </p>
            )}
          </div>
        </div>
      </FadeIn>
    )
  }

  const classes = Array.isArray(status.classesAccepting) ? status.classesAccepting.filter(Boolean) : []
  const dateLine = [
    status.openingDate ? `from ${admissionsDateLabel(status.openingDate)}` : '',
    status.closingDate ? `until ${admissionsDateLabel(status.closingDate)}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <FadeIn className="min-w-0">
      <div
        className="rounded-xl border px-6 sm:px-8 py-6 sm:py-7 shadow-sm"
        style={{
          borderColor: 'color-mix(in srgb, var(--school-primary) 25%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--school-primary) 4%, white)',
        }}
        role="region"
        aria-label="Admissions status"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg school-brand-soft school-brand-text">
            <Check className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
              Admissions Open{status.session ? ` for Session ${status.session}` : ''}
            </h3>
            {dateLine ? (
              <p className="mt-0.5 text-sm text-slate-600">Applications {dateLine}.</p>
            ) : null}
          </div>
        </div>

        {classes.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Classes accepting applications</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {classes.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--school-primary) 30%, transparent)',
                    color: 'var(--school-primary)',
                    backgroundColor: 'color-mix(in srgb, var(--school-primary) 8%, white)',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {(status.noticeTitle?.trim() || status.noticeBody?.trim()) ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white/70 px-4 py-3.5">
            {status.noticeTitle?.trim() ? (
              <p className="text-sm font-bold text-slate-900">{status.noticeTitle}</p>
            ) : null}
            {status.noticeBody?.trim() ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{status.noticeBody}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {status.applicationUrl ? (
            <a
              href={status.applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              style={{ backgroundColor: 'var(--school-primary)' }}
              aria-label="Apply online (opens the application form in a new tab)"
            >
              Apply Online
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </a>
          ) : null}
          {(status.contactEmail || status.contactPhone) ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              {status.contactPhone ? (
                <a href={`tel:${status.contactPhone}`} className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:underline">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {status.contactPhone}
                </a>
              ) : null}
              {status.contactEmail ? (
                <a href={`mailto:${status.contactEmail}`} className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:underline">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {status.contactEmail}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </FadeIn>
  )
}

/* ------------------------------------------------------------------ */
/*  Admissions — ALWAYS renders (the enquiry form is a product         */
/*  channel, not marketing copy). CMS copy when set, neutral factual   */
/*  copy otherwise.                                                    */
/* ------------------------------------------------------------------ */

function Admissions({
  admissions,
  status,
  phone,
  admForm,
  setAdmForm,
  admSubmitting,
  admSuccess,
  setAdmSuccess,
  admError,
  handleAdmissionSubmit,
}: {
  admissions: WebsiteContent['admissions']
  /** Task 2-a — the published admissions singleton (null when the block
   *  is unpublished or not configured: nothing renders). */
  status: PublicAdmissionsStatus | null
  phone: string
  admForm: any
  setAdmForm: (f: any) => void
  admSubmitting: boolean
  admSuccess: boolean
  setAdmSuccess: (v: boolean) => void
  admError: string
  handleAdmissionSubmit: (e: React.FormEvent) => Promise<void>
}) {
  const update = (k: keyof typeof admForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setAdmForm({ ...admForm, [k]: e.target.value })
  }

  const highlights = Array.isArray(admissions?.highlights) ? admissions.highlights : []
  const officeHours = admissions?.officeHours?.trim() || ''
  const title = admissions?.heading?.trim() || admissions?.title?.trim() || 'Admissions'
  const description =
    admissions?.description?.trim() || 'Submit an enquiry and the school office will follow up.'

  const inputCls =
    'w-full px-4 py-3 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[var(--school-primary)] focus:ring-1 focus:ring-[var(--school-primary)]'

  return (
    <section id="admissions" className="bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-16 lg:py-20">
        <SectionHeader title={title} />

        {/* Task 2-a — the admissions STATUS block (published singleton
            only): "Admissions Open for Session 2027–28" with classes,
            dates, notice, contacts and the application CTA when OPEN; a
            calm closed note when CLOSED; NOTHING when unpublished. */}
        {status ? <AdmissionsStatusBlock status={status} /> : null}

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          {/* Left — admission copy + highlights + office hours (CMS) */}
          <FadeIn className="min-w-0">
            <p className="text-slate-600 leading-relaxed">{description}</p>

            {highlights.length > 0 ? (
              <ul className="mt-8 space-y-4">
                {highlights.map((h) => (
                  <li key={h} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full school-brand-soft school-brand-text">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-relaxed text-slate-700">{h}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {officeHours ? (
              <div
                className="mt-8 rounded-xl border px-5 py-4 flex items-start gap-3"
                style={{
                  borderColor: 'color-mix(in srgb, var(--school-primary) 20%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--school-primary) 5%, transparent)',
                }}
              >
                <Phone className="h-4.5 w-4.5 school-brand-text shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-sm text-slate-600 leading-relaxed">
                  {officeHours}
                  {phone ? ' — ' : null}
                  {phone ? (
                    <a href={`tel:${phone}`} className="font-semibold text-slate-900 hover:underline">
                      {phone}
                    </a>
                  ) : null}
                </p>
              </div>
            ) : null}
          </FadeIn>

          {/* Right — the form, untouched logic in a quiet white card */}
          <FadeIn className="min-w-0">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 sm:p-8">
              {admSuccess ? (
                <div role="status" aria-live="polite" className="text-center py-10 space-y-4">
                  <div className="mx-auto w-14 h-14 rounded-full school-brand-soft flex items-center justify-center">
                    <Check className="w-7 h-7 school-brand-text" aria-hidden="true" />
                  </div>
                  <h3 className="font-display text-2xl font-bold text-slate-900">Enquiry received</h3>
                  <p className="text-slate-600 max-w-md mx-auto">
                    Thank you. Your enquiry has been received by the school office.
                  </p>
                  <button
                    onClick={() => setAdmSuccess(false)}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold border border-slate-300 bg-white text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    Submit another enquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleAdmissionSubmit} className="space-y-6 text-left relative">
                  <div className="grid md:grid-cols-2 gap-6">
                    <Field label="Parent / Guardian Name">
                      <input
                        type="text"
                        required
                        value={admForm.parentName}
                        onChange={update('parentName')}
                        placeholder="Your full name"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        type="email"
                        required
                        value={admForm.email}
                        onChange={update('email')}
                        placeholder="you@example.com"
                        className={inputCls}
                      />
                    </Field>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <Field label="Phone">
                      <input
                        type="tel"
                        required
                        value={admForm.phone}
                        onChange={update('phone')}
                        placeholder="+91 98765 43210"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Grade applying for">
                      <select
                        required
                        value={admForm.grade}
                        onChange={update('grade')}
                        className={`${inputCls} appearance-none`}
                      >
                        <option value="">Select stage</option>
                        <option value="primary">Primary (1–5)</option>
                        <option value="middle">Middle (6–8)</option>
                        <option value="senior">Senior (9–12)</option>
                      </select>
                    </Field>
                  </div>

                  <Field label="Student&apos;s Name">
                    <input
                      type="text"
                      value={admForm.studentName}
                      onChange={update('studentName')}
                      placeholder="Your child's full name"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Notes (optional)">
                    <textarea
                      value={admForm.notes}
                      onChange={update('notes')}
                      placeholder="Anything else you'd like us to know?"
                      rows={3}
                      className={`${inputCls} resize-none`}
                    />
                  </Field>

                  {admError && (
                    <div role="alert" className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                      {admError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={admSubmitting}
                    style={{ backgroundColor: 'var(--school-primary)' }}
                    className="group w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-base font-semibold text-white transition-all hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    {admSubmitting ? 'Submitting…' : 'Submit Inquiry'}
                    {!admSubmitting && (
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
                    )}
                  </button>
                </form>
              )}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Footer — dark slate, real school contact fields only               */
/* ------------------------------------------------------------------ */

const SOCIAL_LINKS: Array<{
  key: keyof WebsiteContent['footer']['social']
  label: string
  icon: LucideIcon
}> = [
  { key: 'facebook', label: 'Facebook', icon: Facebook },
  { key: 'instagram', label: 'Instagram', icon: Instagram },
  { key: 'youtube', label: 'YouTube', icon: Youtube },
  { key: 'twitter', label: 'X (Twitter)', icon: Twitter },
  { key: 'linkedin', label: 'LinkedIn', icon: Linkedin },
]

/** Task 2-a — managed social links: platform → icon (the managed set
 *  supports facebook/instagram/youtube/x/linkedin/whatsapp/website/other). */
const SOCIAL_PLATFORM_ICONS: Record<string, LucideIcon> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  x: Twitter,
  twitter: Twitter,
  linkedin: Linkedin,
  whatsapp: MessageCircle,
  website: Globe,
  other: Link2,
}

const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  website: 'Website',
  other: 'Link',
}

function Footer({
  schoolName,
  shortName,
  tagline,
  logoUrl,
  phone,
  email,
  address,
  city,
  website,
  established,
  footer,
  contact,
  socialLinks: managedSocialLinks,
  quickLinks,
  onOpenPortal,
}: {
  schoolName: string
  shortName: string
  tagline: string
  logoUrl?: string | null
  phone: string
  email: string
  address: string
  city: string
  website: string
  established: string
  footer: WebsiteContent['footer']
  contact: WebsiteContent['contact']
  socialLinks?: PublicSocialLink[]
  quickLinks: Array<{ label: string; href: string }>
  onOpenPortal: () => void
}) {
  // Only ever display an establishment year the school actually
  // recorded — never an invented "since YYYY".
  const establishedYear = established?.trim() || ''
  const aboutLine = footer.about?.trim() || ''
  const taglineLine = tagline?.trim() || ''

  // Task 2-a — the MANAGED social links (WebsiteSocialLink rows, ordered)
  // render first; legacy CMS footer.social entries follow for platforms
  // the managed set does not already cover (http(s) only — a non-http(s)
  // value never becomes a clickable link).
  const managedLinks = (managedSocialLinks ?? []).flatMap((l) => {
    const icon = SOCIAL_PLATFORM_ICONS[l.platform]
    if (!icon) return []
    if (!/^https?:\/\//i.test(l.url)) return []
    return [{
      key: `m-${l.id}`,
      platform: l.platform,
      label: l.label?.trim() || SOCIAL_PLATFORM_LABELS[l.platform] || l.platform,
      icon,
      url: l.url,
    }]
  })
  const managedPlatforms = new Set(managedLinks.map((m) => m.platform))
  const legacyLinks = SOCIAL_LINKS.flatMap(({ key, label, icon }) => {
    // Dedupe: a managed link for this platform (or an 'x' link covering
    // the legacy 'twitter' key) wins over the CMS footer entry.
    if (managedPlatforms.has(key) || (key === 'twitter' && managedPlatforms.has('x'))) return []
    const href = footer.social?.[key]
    if (typeof href !== 'string') return []
    const url = href.trim()
    if (!/^https?:\/\//i.test(url)) return []
    return [{ key: `c-${key}`, platform: key, label, icon, url }]
  })
  const socialLinks = [...managedLinks, ...legacyLinks]

  const contactTitle = contact.title?.trim() || 'Contact'
  const contactSubtitle = contact.subtitle?.trim() || ''
  const websiteUrl = /^https?:\/\//i.test(website) ? website : ''
  // The contact column renders only when the school actually has
  // contact details (or a CMS subtitle) to show.
  const hasContact = Boolean(contactSubtitle || address || city || phone || email || websiteUrl)

  return (
    <footer id="footer" className="mt-auto bg-slate-950 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-12 mb-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-5">
              <BrandLogo logoUrl={logoUrl} shortName={shortName} />
              <div className="min-w-0">
                <h2 className="font-display font-bold text-white leading-tight">{schoolName}</h2>
                {taglineLine ? (
                  <p className="text-xs text-slate-400 mt-1">{taglineLine}</p>
                ) : null}
              </div>
            </div>
            {aboutLine ? (
              <p className="text-sm text-slate-400 leading-relaxed">
                {aboutLine}
              </p>
            ) : null}
            {establishedYear ? (
              <span className="mt-3 inline-flex items-center rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                Estd. {establishedYear}
              </span>
            ) : null}
            {socialLinks.length > 0 ? (
              <div className="flex items-center gap-3 mt-5">
                {socialLinks.map((s) => (
                  <a
                    key={s.key}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${shortName} on ${s.label}`}
                    title={`${shortName} on ${s.label}`}
                    className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    <s.icon className="w-4 h-4" aria-hidden="true" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {/* Contact — real school fields only, omissions for empty ones */}
          {hasContact ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-5">{contactTitle}</h3>
              {contactSubtitle ? (
                <p className="text-sm text-slate-400 mb-4 leading-relaxed">{contactSubtitle}</p>
              ) : null}
              <ul className="space-y-3.5 text-sm">
                {address || city ? (
                  <li className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                    <span>{[address, city].filter(Boolean).join(', ')}</span>
                  </li>
                ) : null}
                {phone ? (
                  <li className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <a href={`tel:${phone}`} className="hover:text-white transition-colors">{phone}</a>
                  </li>
                ) : null}
                {email ? (
                  <li className="flex items-center gap-3 min-w-0">
                    <Mail className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <a href={`mailto:${email}`} className="hover:text-white transition-colors truncate">{email}</a>
                  </li>
                ) : null}
                {websiteUrl ? (
                  <li className="flex items-center gap-3 min-w-0">
                    <Globe className="w-4 h-4 text-slate-500 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors truncate">
                      {websiteUrl.replace(/^https?:\/\//i, '')}
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* Quick links — only sections that render */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-5">Quick Links</h3>
            <ul className="space-y-3 text-sm">
              {quickLinks.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="hover:text-white transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Portal */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-5">School Login</h3>
            <p className="text-sm text-slate-400 mb-5 leading-relaxed">
              Students, teachers, and staff — access your dashboard.
            </p>
            <button
              onClick={onOpenPortal}
              className="group inline-flex items-center gap-2 px-5 py-2.5 h-10 border border-slate-700 text-slate-200 rounded-lg text-sm font-semibold transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              School Login
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {schoolName}. All rights reserved.</span>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a
              href="/api/public/notices/rss"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Subscribe to school notices via RSS"
              title="Subscribe in your favourite reader — RSS feed of the notice board"
              className="inline-flex items-center gap-1.5 hover:text-slate-300 transition-colors"
            >
              <Rss className="h-3.5 w-3.5" aria-hidden="true" />
              Notices RSS
            </a>
            <span aria-hidden="true" className="hidden sm:block w-1 h-1 rounded-full bg-slate-700" />
            <span>Powered by <span className="font-semibold">SCHOLARIO</span></span>
          </div>
        </div>
      </div>
    </footer>
  )
}
