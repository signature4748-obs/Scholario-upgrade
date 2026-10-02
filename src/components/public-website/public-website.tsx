'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import {
  GraduationCap,
  BookOpen,
  FlaskConical,
  School,
  Target,
  Heart,
  Building2,
  ShieldCheck,
  MonitorPlay,
  Library,
  Phone,
  Mail,
  MapPin,
  ArrowRight,
  Sparkles,
  Menu,
  X,
  Lock,
  Rss,
  Megaphone,
  Check,
  Sprout,
  Compass,
  Rocket,
  Trophy,
  Bus,
  Palette,
  Globe,
  Music,
  Laptop,
  Quote,
  Facebook,
  Instagram,
  Youtube,
  Twitter,
  Linkedin,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/lib/store/auth-store'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { usePublicSchoolData, useAdmissionForm } from './use-public-website-data'
import type { PublicSchoolData, PublicGalleryAlbum } from './types'
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
  delay?: number
  y?: number
  className?: string
}

function FadeIn({ children, delay = 0, y = 24, className }: FadeInProps) {
  const reduce = useReducedMotion()
  // data-fadein lets the print stylesheet force these sections visible
  // (framer-motion's whileInView starts at opacity 0, which would blank
  // full-page printouts / screenshots that never trigger the observer).
  if (reduce) return <div className={className} data-fadein>{children}</div>
  return (
    <motion.div
      data-fadein
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  PHASE 7.5 — per-school branding                                    */
/*                                                                     */
/*  The resolved school's themeColor/accentColor (server-validated     */
/*  hex) become CSS custom properties on the site wrapper. The         */
/*  `school-brand-*` token classes (globals.css) consume them with     */
/*  inert emerald/amber fallbacks, so brand colors own the "identity"  */
/*  surfaces (hero gradient, CTAs, badges, notice accents) while the   */
/*  structural surfaces keep the Scholario design language.            */
/* ------------------------------------------------------------------ */

const BRAND_DEFAULT_PRIMARY = '#059669' // Scholario emerald-600
const BRAND_DEFAULT_ACCENT = '#f59e0b' // Scholario amber-500

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
  const cls = `group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold school-brand-cta hover:-translate-y-0.5 active:translate-y-0 transition-all ${className}`
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
  const cls = `inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-sm font-semibold school-brand-ghost bg-white/60 dark:bg-white/5 backdrop-blur border transition-all ${className}`
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

/* School logo — uploaded branding image when configured, the brand
 * gradient crest otherwise. Used by the header + footer. */
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
        className={`${className} rounded-full object-cover border border-border/60 bg-card shrink-0`}
      />
    )
  }
  return (
    <div className={`${className} rounded-full school-brand-grad flex items-center justify-center text-white shadow-lg shrink-0`}>
      <GraduationCap className="w-5 h-5" aria-hidden="true" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Unified section header — eyebrow / display heading / subtitle.    */
/*  Every content section uses this exact rhythm.                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: React.ReactNode
  title: string
  subtitle: string
  children?: React.ReactNode
}) {
  return (
    <FadeIn className="text-center mb-12 lg:mb-16">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] school-brand-text">
        {eyebrow}
      </span>
      <h2 className="mt-3 font-display text-3xl lg:text-4xl font-bold tracking-tight text-foreground text-balance">
        {title}
      </h2>
      <p className="mt-4 text-base lg:text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
        {subtitle}
      </p>
      {children}
    </FadeIn>
  )
}

/* Card-grid skeleton for CMS sections while the school profile loads. */
function SectionSkeleton({
  count = 4,
  grid = 'md:grid-cols-2 lg:grid-cols-4',
  label = 'Loading section',
}: {
  count?: number
  grid?: string
  label?: string
}) {
  return (
    <div className={`grid gap-6 ${grid}`} aria-busy="true" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-64 rounded-3xl border border-border/60 bg-card p-8">
          <div className="skeleton h-12 w-12 rounded-full mb-6" aria-hidden="true" />
          <div className="skeleton h-5 w-2/3 rounded mb-3" aria-hidden="true" />
          <div className="skeleton h-3.5 w-full rounded" aria-hidden="true" />
          <div className="skeleton h-3.5 w-4/5 rounded mt-2.5" aria-hidden="true" />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PublicWebsite({ onOpenPortal }: {
  onOpenPortal: () => void
}) {
  const { isAuthenticated, user, logout } = useAuth()
  void isAuthenticated
  void user
  void logout

  const { schoolData, loading } = usePublicSchoolData()

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

  // school-derived strings — server identity first, neutral fallbacks
  // only for a payload that never arrived (never fabricated values).
  const schoolName = schoolData?.name || 'Our School'
  const shortName = schoolData?.shortName || schoolName.split(' ')[0] || 'Our School'
  const city = schoolData?.city || ''
  const phone = schoolData?.phone || ''
  const email = schoolData?.email || ''
  const address = schoolData?.address || ''
  const website = schoolData?.website || ''
  const established = schoolData?.established || ''
  const principalName = schoolData?.principalName || ''

  // PHASE 7.5 — the CMS document (server merges neutral fallbacks for
  // unconfigured schools, so copy is always claim-free).
  const content: WebsiteContent = schoolData?.websiteContent ?? NEUTRAL_WEBSITE_CONTENT
  const albums = schoolData?.gallery ?? []

  // SEO — client-rendered <title>/<meta description> from the CMS doc.
  // The SPA is a single client route, so the public view updates the
  // live document head while active and restores it on unmount.
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

  return (
    <div
      style={brandVars(schoolData?.themeColor, schoolData?.accentColor)}
      className="min-h-screen mesh-bg text-foreground selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300 flex flex-col"
    >
      <Header
        shortName={shortName}
        logoUrl={schoolData?.logoUrl}
        scrolled={scrolled}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onOpenPortal={onOpenPortal}
      />

      <main>
        <Hero
          schoolData={schoolData}
          hero={content.hero}
          loading={loading}
          onOpenPortal={onOpenPortal}
        />

        <WhyChooseUs shortName={shortName} about={content.about} pillars={content.pillars} loading={loading} />

        <Journey journey={content.journey} loading={loading} />

        <Facilities facilities={content.facilities} loading={loading} />

        <PrincipalMessage
          message={content.principalMessage}
          principalName={principalName}
          schoolName={schoolName}
          shortName={shortName}
          logoUrl={schoolData?.logoUrl}
        />

        <CampusLife
          shortName={shortName}
          albums={albums}
          isDemo={schoolData?.isDemo === true}
          loading={loading}
        />

        <NoticeBoard
          notices={schoolData?.announcements ?? []}
          loading={loading}
          onOpenPortal={onOpenPortal}
        />

        <Admissions
          admissions={content.admissions}
          phone={phone}
          loading={loading}
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
        logoUrl={schoolData?.logoUrl}
        phone={phone}
        email={email}
        address={address}
        city={city}
        website={website}
        established={established}
        footer={content.footer}
        contact={content.contact}
        onOpenPortal={onOpenPortal}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({
  shortName,
  logoUrl,
  scrolled,
  mobileMenuOpen,
  setMobileMenuOpen,
  onOpenPortal,
}: {
  shortName: string
  logoUrl?: string | null
  scrolled: boolean
  mobileMenuOpen: boolean
  setMobileMenuOpen: (v: boolean) => void
  onOpenPortal: () => void
}) {
  const navLinks = [
    { label: 'About', href: '#about' },
    { label: 'Campus Life', href: '#campus-life' },
    { label: 'Academics', href: '#journey' },
    { label: 'Facilities', href: '#facilities' },
    { label: 'Notices', href: '#notices' },
    { label: 'Admissions', href: '#admissions' },
    { label: 'Contact', href: '#footer' },
  ]

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'glass-strong shadow-premium border-b border-border/60'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
        {/* Logo */}
        <a href="#top" className="flex items-center gap-3 group min-w-0">
          <BrandLogo logoUrl={logoUrl} shortName={shortName} className="h-10 w-10 group-hover:scale-105 transition-transform" />
          <div className="leading-tight min-w-0">
            <h1 className="font-display font-bold text-foreground text-base truncate">{shortName}</h1>
            <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 tracking-widest uppercase">
              Powered by Scholario
            </p>
          </div>
        </a>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-muted-foreground" aria-label="Primary">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hover:text-foreground transition-colors relative after:content-[''] after:absolute after:-bottom-1.5 after:left-0 after:right-0 after:h-px after:bg-emerald-500 after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-300 after:origin-left"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-3">
          <ThemeToggle className="border border-border bg-card/40 rounded-full" />
          <button
            onClick={onOpenPortal}
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold school-brand-cta hover:-translate-y-0.5 active:translate-y-0 transition-all"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            Login Portal
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          className="lg:hidden h-11 w-11 flex items-center justify-center rounded-lg text-foreground hover:bg-accent transition-colors"
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
          className="lg:hidden glass-strong border-t border-border/60 overflow-hidden"
        >
          <nav className="px-6 py-4 flex flex-col gap-1" aria-label="Mobile">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileMenuOpen(false)}
                className="py-3 px-3 -mx-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                {l.label}
              </a>
            ))}

            <div className="mt-3 pt-4 border-t border-border/60 flex items-center gap-3">
              <ThemeToggle className="h-11 w-11 shrink-0 border border-border bg-card/60 rounded-full" />
              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  onOpenPortal()
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold school-brand-cta"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                Login Portal
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
/*  Hero — left copy + right campus photograph, trust strip below      */
/* ------------------------------------------------------------------ */

type Stat = { label: string; value: string; icon: LucideIcon }

/** PHASE 7 — REAL DATA CONTRACT: the trust bar shows the school's REAL
 * DB counts (students / faculty / classes / subjects from
 * /api/schools/public). No source exists for the retired fabricated
 * "Labs 18 / Awards 240+" — those slots now carry real classes /
 * subjects counts, and a missing payload renders honest "—"s. */
function realHeroStats(counts?: PublicSchoolData['counts']): Stat[] {
  const fmt = (n?: number) => (typeof n === 'number' ? n.toLocaleString('en-IN') : '—')
  return [
    { label: 'Students', value: fmt(counts?.students), icon: GraduationCap },
    { label: 'Faculty', value: fmt(counts?.teachers), icon: BookOpen },
    { label: 'Classes', value: fmt(counts?.classes), icon: School },
    { label: 'Subjects', value: fmt(counts?.subjects), icon: FlaskConical },
  ]
}

function Hero({
  schoolData,
  hero,
  loading,
  onOpenPortal,
}: {
  schoolData: PublicSchoolData | null
  hero: WebsiteContent['hero']
  loading: boolean
  onOpenPortal: () => void
}) {
  const counts = schoolData?.counts
  const schoolName = schoolData?.name || 'Our School'
  const city = schoolData?.city || ''
  // PHASE 7 — REAL derivations replace the fabricated marketing numbers
  // ("30+ Years Legacy / 1:12 Ratio / 98% Board Pass"): the ratio is
  // computed from real faculty/student counts (hidden when not
  // derivable); classes and the academic year are canonical fields.
  const teacherRatio =
    counts && counts.teachers > 0 && typeof counts.students === 'number'
      ? `1:${Math.max(1, Math.round(counts.students / counts.teachers))}`
      : null
  const legacyStats = [
    ...(teacherRatio ? [{ label: 'Teacher Ratio', value: teacherRatio }] : []),
    { label: 'Classes', value: counts ? String(counts.classes) : '—' },
    { label: 'Academic Year', value: schoolData?.academicYear || '—' },
  ]

  // PHASE 7.5 — the badge needs the canonical academic year; there is
  // no honest fallback, so it hides entirely when the year is unknown.
  const academicYear = schoolData?.academicYear || ''
  const badgeText = [hero.badgePrefix, academicYear].filter(Boolean).join(' ')
  const showBadge = academicYear.trim().length > 0 && badgeText.trim().length > 0

  const ctaPrimaryLabel = hero.ctaPrimary.label || 'Apply for Admission'
  const ctaPrimaryHref = hero.ctaPrimary.href || '#admissions'

  return (
    <section id="top" className="relative pt-12 pb-16 lg:pt-20 lg:pb-20 overflow-hidden">
      {/* ambient orbs */}
      <div aria-hidden className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute top-32 -right-32 w-96 h-96 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy (CMS hero document; skeletons while loading) */}
          <FadeIn className="space-y-7 min-w-0">
            {loading ? (
              <div className="space-y-7" aria-busy="true">
                <span className="sr-only">Loading school information</span>
                <div className="skeleton h-7 w-56 rounded-full" aria-hidden="true" />
                <div className="space-y-3">
                  <div className="skeleton h-14 w-4/5 rounded-2xl" aria-hidden="true" />
                  <div className="skeleton h-14 w-3/5 rounded-2xl" aria-hidden="true" />
                </div>
                <div className="space-y-2.5 max-w-xl">
                  <div className="skeleton h-4 w-full rounded" aria-hidden="true" />
                  <div className="skeleton h-4 w-11/12 rounded" aria-hidden="true" />
                  <div className="skeleton h-4 w-2/3 rounded" aria-hidden="true" />
                </div>
                <div className="flex flex-wrap gap-4 pt-2">
                  <div className="skeleton h-12 w-44 rounded-full" aria-hidden="true" />
                  <div className="skeleton h-12 w-36 rounded-full" aria-hidden="true" />
                </div>
              </div>
            ) : (
              <>
                {showBadge && (
                  <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass border school-brand-badge text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--school-accent)' }} aria-hidden="true" />
                    {badgeText}
                  </span>
                )}

                <h2 className="font-display text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-balance">
                  {hero.title}
                  {hero.titleAccent ? (
                    <>
                      <br />
                      <span
                        className="bg-clip-text text-transparent"
                        style={{
                          backgroundImage:
                            'linear-gradient(to bottom right, var(--school-primary), var(--school-accent))',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                        }}
                      >
                        {hero.titleAccent}
                      </span>
                    </>
                  ) : null}
                </h2>

                {hero.description ? (
                  <p className="text-lg text-muted-foreground max-w-xl leading-relaxed text-pretty">
                    {hero.description}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-4">
                  <PrimaryCta href={ctaPrimaryHref}>
                    {ctaPrimaryLabel}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                  </PrimaryCta>
                  {hero.ctaSecondary.label ? (
                    <GhostCta href={hero.ctaSecondary.href || '#campus-life'}>
                      {hero.ctaSecondary.label}
                    </GhostCta>
                  ) : (
                    <GhostCta onClick={onOpenPortal}>Login Portal</GhostCta>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-8 gap-y-5 sm:gap-x-10 pt-6">
                  {legacyStats.map((s) => (
                    <div key={s.label} className="shrink-0">
                      <div className="font-display text-3xl font-bold text-foreground tabular-nums tracking-tight">{s.value}</div>
                      <div className="text-xs font-semibold text-muted-foreground mt-1.5 uppercase tracking-widest">{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </FadeIn>

          {/* Right — campus photograph composition.
              The photograph is a PLATFORM-DEFAULT asset (documented):
              per-school imagery is never fabricated — a school that
              wants its own photos publishes gallery albums. */}
          <FadeIn delay={0.15} className="relative min-w-0">
            <div className="relative">
              {/* offset frame — peeks out behind the photograph */}
              <div
                aria-hidden
                className="absolute inset-0 translate-x-4 translate-y-4 lg:translate-x-6 lg:translate-y-6 rounded-[2.25rem] border bg-transparent pointer-events-none"
                style={{
                  borderColor: 'color-mix(in srgb, var(--school-primary) 25%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--school-primary) 5%, transparent)',
                }}
              />

              {/* dominant photograph */}
              <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-border/60 bg-muted shadow-premium-lg">
                <Image
                  src="/images/campus/hero-campus.jpg"
                  alt={`The ${schoolName} campus building in warm morning light`}
                  fill
                  priority
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
                {/* gradient scrim */}
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 via-black/15 to-transparent pointer-events-none" />
                <div className="absolute bottom-0 inset-x-0 flex items-end justify-between gap-3 p-5 sm:p-6">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-white text-base sm:text-lg drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
                      {schoolName}
                    </p>
                    <p className="text-white/85 text-xs sm:text-sm mt-0.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                      {city}
                    </p>
                  </div>
                </div>
              </div>

              {/* floating glass stat — ONE REAL number (the school's live
                  student count; hidden entirely when the count is not
                  available or zero — never a fabricated "98% board pass",
                  and never an awkward "0 Students enrolled"). */}
              {typeof counts?.students === 'number' && counts.students > 0 && (
                <div className="absolute -bottom-5 -left-2 sm:-left-6 lg:-left-8">
                  <div className="glass-strong rounded-2xl border border-border/60 shadow-premium-lg px-5 py-4 flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl school-brand-grad flex items-center justify-center text-white shadow-lg shrink-0">
                      <GraduationCap className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-display text-2xl font-bold text-foreground tabular-nums leading-none">
                        {counts.students.toLocaleString('en-IN')}
                      </div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mt-1.5">
                        {counts.students === 1 ? 'Student enrolled' : 'Students enrolled'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* floating accent */}
              <div
                aria-hidden
                className="hidden lg:block absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-70 blur-2xl pointer-events-none"
                style={{ backgroundColor: 'var(--school-accent)' }}
              />
            </div>
          </FadeIn>
        </div>

        {/* Trust bar — the institution at a glance (REAL counts) */}
        <TrustBar loading={loading} counts={counts} />
      </div>
    </section>
  )
}

function TrustBar({ loading, counts }: { loading: boolean; counts?: PublicSchoolData['counts'] }) {
  const heroStats = realHeroStats(counts)
  return (
    <FadeIn delay={0.25} className="mt-14 lg:mt-20">
      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-border/60 sm:divide-x sm:divide-border/60">
        {heroStats.map((stat) => (
          <div key={stat.label} className="flex flex-col items-center text-center gap-2 py-6 sm:py-8 px-3 min-w-0">
            {loading ? (
              <>
                {stat.label === 'Students' && <span className="sr-only">Loading school statistics</span>}
                <div className="skeleton h-8 w-24 rounded-lg" aria-hidden="true" />
                <div className="skeleton h-3 w-16 rounded" aria-hidden="true" />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 font-display text-2xl sm:text-3xl font-bold tabular-nums tracking-tight text-foreground">
                  <stat.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} aria-hidden="true" />
                  {stat.value}
                </div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {stat.label}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </FadeIn>
  )
}

/* ------------------------------------------------------------------ */
/*  Why families choose us — CMS pillars                               */
/* ------------------------------------------------------------------ */

/** Per-index gradient chips (Scholario design language — positional,
 *  not per-school content). */
const PILLAR_CHIPS = [
  'from-emerald-500 to-teal-600',
  'from-rose-400 to-rose-500',
  'from-sky-400 to-sky-500',
  'from-lime-400 to-lime-500',
  'from-violet-400 to-violet-500',
  'from-amber-400 to-orange-500',
]

function WhyChooseUs({
  shortName,
  about,
  pillars,
  loading,
}: {
  shortName: string
  about: WebsiteContent['about']
  pillars: PillarItem[]
  loading: boolean
}) {
  const items = Array.isArray(pillars) ? pillars : []
  if (!loading && items.length === 0) return null

  return (
    <section id="about" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow={`Why ${shortName}`}
        title={about.title}
        subtitle={about.subtitle}
      />

      {loading ? (
        <SectionSkeleton label="Loading pillars" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((p, i) => {
            const Icon = cmsIcon(p.icon)
            return (
              <FadeIn key={`${p.title}-${i}`} delay={i * 0.08}>
                <div className="h-full bg-card rounded-3xl p-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg transition-all">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${PILLAR_CHIPS[i % PILLAR_CHIPS.length]} flex items-center justify-center text-white shadow-lg mb-6`}>
                    <Icon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-3">{p.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm">{p.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  A journey for every stage — CMS stages                             */
/* ------------------------------------------------------------------ */

const JOURNEY_ACCENTS = [
  { bar: 'from-emerald-400 to-teal-500', badge: 'text-emerald-600 dark:text-emerald-400' },
  { bar: 'from-sky-400 to-blue-500', badge: 'text-sky-600 dark:text-sky-400' },
  { bar: 'from-orange-400 to-pink-500', badge: 'text-orange-600 dark:text-orange-400' },
]

function Journey({
  journey,
  loading,
}: {
  journey: WebsiteContent['journey']
  loading: boolean
}) {
  const stages = Array.isArray(journey?.stages) ? journey.stages : []
  if (!loading && stages.length === 0) return null

  return (
    <section id="journey" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Academics"
        title={journey.title}
        subtitle={journey.subtitle}
      />

      {loading ? (
        <SectionSkeleton count={3} grid="md:grid-cols-3" label="Loading academic stages" />
      ) : (
        // PIH-6 — [&>*]:min-w-0: grid items default to min-width:auto, so a
        // long non-wrapping meta line blew the card 10px past the 320px
        // viewport; min-w-0 lets the track hold and the badge truncate.
        <div className="grid md:grid-cols-3 gap-8 [&>*]:min-w-0">
          {stages.map((s, i) => {
            const accent = JOURNEY_ACCENTS[i % JOURNEY_ACCENTS.length]
            const Icon = cmsIcon(s.icon)
            return (
              <FadeIn key={`${s.title}-${i}`} delay={i * 0.1}>
                <div className="relative h-full bg-card rounded-3xl pt-2 pb-8 px-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg transition-all overflow-hidden">
                  <div className={`absolute top-0 left-0 right-0 h-2 bg-gradient-to-r ${accent.bar}`} aria-hidden="true" />
                  <div className="flex items-center gap-4 mt-6 mb-2 min-w-0">
                    <div className="h-9 w-9 shrink-0 rounded-lg school-brand-soft flex items-center justify-center">
                      <Icon className="w-4.5 h-4.5 school-brand-text" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className={`text-xs font-bold ${accent.badge} uppercase tracking-wider truncate`}>
                      {[s.grades, s.years].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <h3 className="font-display text-2xl font-bold text-foreground mb-4">{s.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{s.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Facilities — CMS items                                             */
/* ------------------------------------------------------------------ */

function Facilities({
  facilities,
  loading,
}: {
  facilities: WebsiteContent['facilities']
  loading: boolean
}) {
  const items = Array.isArray(facilities?.items) ? facilities.items : []
  if (!loading && items.length === 0) return null

  return (
    <section id="facilities" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Our Campus"
        title={facilities.title}
        subtitle={facilities.subtitle}
      />

      {loading ? (
        <SectionSkeleton label="Loading facilities" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((f, i) => {
            const Icon = cmsIcon(f.icon)
            return (
              <FadeIn key={`${f.title}-${i}`} delay={i * 0.08}>
                <div className="h-full bg-card rounded-3xl p-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg hover:border-emerald-500/40 transition-all">
                  <Icon className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mb-6" strokeWidth={1.5} aria-hidden="true" />
                  <h3 className="text-xl font-bold text-foreground mb-3">{f.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm">{f.description}</p>
                </div>
              </FadeIn>
            )
          })}
        </div>
      )}
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
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <section id="principal-message" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Leadership"
        title={message.title}
        subtitle="A word from the head of the school."
      />

      <FadeIn>
        <figure className="relative mx-auto max-w-3xl bg-card rounded-3xl p-8 sm:p-10 shadow-premium border border-border/60 overflow-hidden">
          <div aria-hidden className="absolute top-0 left-0 right-0 h-1.5 school-brand-bar" />
          <Quote className="w-10 h-10 school-brand-text mb-6" strokeWidth={1.5} aria-hidden="true" />
          <blockquote className="text-lg sm:text-xl leading-relaxed text-foreground/90 text-pretty whitespace-pre-line">
            {message.message}
          </blockquote>
          <figcaption className="mt-8 flex items-center gap-4 min-w-0">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={`${shortName} logo`}
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full object-cover border border-border/60"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-full school-brand-soft school-brand-text flex items-center justify-center font-display font-bold text-sm">
                {initials || 'P'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-foreground truncate">{name}</p>
              <p className="text-sm text-muted-foreground truncate">Principal, {schoolName}</p>
            </div>
          </figcaption>
        </figure>
      </FadeIn>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Campus life — CMS gallery albums / platform-default demo mosaic   */
/* ------------------------------------------------------------------ */

/** Max images rendered per album (honest "...and N more" note beyond). */
const MAX_ALBUM_IMAGES = 12

const GALLERY_SIZES = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'

function CampusLife({
  shortName,
  albums,
  isDemo,
  loading,
}: {
  shortName: string
  albums: PublicGalleryAlbum[]
  isDemo: boolean
  loading: boolean
}) {
  if (loading) {
    return (
      <section id="campus-life" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
        <SectionHeader
          eyebrow="Campus Life"
          title={`Life at ${shortName}`}
          subtitle="Learning happens everywhere — in labs, on fields, and between the shelves."
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" aria-busy="true" aria-label="Loading campus gallery">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[4/3] rounded-xl" aria-hidden="true" />
          ))}
        </div>
      </section>
    )
  }

  if (albums.length === 0) {
    // No published albums: the static platform-default mosaic is a DEMO
    // aesthetic — a real, unconfigured school gets an honest skip (the
    // section hides; per-school imagery is never fabricated).
    if (!isDemo) return null
    return <DemoCampusMosaic shortName={shortName} />
  }

  return (
    <section id="campus-life" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Campus Life"
        title={`Life at ${shortName}`}
        subtitle="Learning happens everywhere — in labs, on fields, and between the shelves."
      />

      {albums.map((album) => {
        const images = album.images.slice(0, MAX_ALBUM_IMAGES)
        const hiddenCount = album.images.length - images.length
        return (
          <FadeIn key={album.id} className="mt-10 first:mt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-5">
              <h3 className="font-display text-xl font-bold text-foreground">{album.title}</h3>
              {album.description ? (
                <p className="text-sm text-muted-foreground">{album.description}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {images.map((img) => {
                const alt = img.caption || album.title
                return (
                  <figure key={img.id} className="relative m-0 aspect-[4/3] overflow-hidden rounded-xl border border-border/60 bg-muted shadow-premium group">
                    <Image
                      src={img.url}
                      alt={alt}
                      fill
                      sizes={GALLERY_SIZES}
                      loading="lazy"
                      className="object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-105"
                    />
                    {img.caption ? (
                      <>
                        <div
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        />
                        <figcaption className="absolute bottom-0 inset-x-0 p-3 text-xs font-medium text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                          {img.caption}
                        </figcaption>
                      </>
                    ) : null}
                  </figure>
                )
              })}
            </div>
            {hiddenCount > 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                …and {hiddenCount} more {hiddenCount === 1 ? 'photo' : 'photos'} in this album.
              </p>
            ) : null}
          </FadeIn>
        )
      })}
    </section>
  )
}

/** Platform-default campus mosaic — rendered ONLY for the demo school
 *  when it has no published albums (documented demo aesthetic; the
 *  tiles are curated platform assets, not school data). */
const DEMO_GALLERY_TILES: Array<{
  src: string
  alt: string
  caption: string
  sub: string
  tile: string
  sizes: string
}> = [
  {
    src: '/images/campus/library.jpg',
    alt: 'Students reading and studying among the shelves of the school library',
    caption: 'The Library',
    sub: '30,000+ titles & a digital research hub',
    tile: 'sm:row-span-2',
    sizes: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  },
  {
    src: '/images/campus/science-lab.jpg',
    alt: 'Students in white lab coats conducting an experiment in the school science laboratory',
    caption: 'Science Labs',
    sub: 'Physics · Chemistry · Biology',
    tile: '',
    sizes: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  },
  {
    src: '/images/campus/sports.jpg',
    alt: 'Students competing on the field during school sports day',
    caption: 'Sports & Athletics',
    sub: 'Courts, pool & a 400m track',
    tile: '',
    sizes: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  },
  {
    src: '/images/campus/classroom.jpg',
    alt: 'A teacher engaging with students in a bright smart classroom',
    caption: 'Smart Classrooms',
    sub: 'Interactive boards in every room',
    tile: 'sm:col-span-2 lg:col-span-2',
    sizes: '(min-width: 1024px) 66vw, 100vw',
  },
]

function DemoCampusMosaic({ shortName }: { shortName: string }) {
  return (
    <section id="campus-life" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Campus Life"
        title={`Life at ${shortName}`}
        subtitle="Learning happens everywhere — in labs, on fields, and between the shelves."
      />

      <div className="grid grid-cols-1 auto-rows-[240px] sm:grid-cols-2 sm:auto-rows-[230px] lg:grid-cols-3 lg:auto-rows-[250px] gap-4 sm:gap-5">
        {DEMO_GALLERY_TILES.map((g, i) => (
          <FadeIn key={g.caption} delay={i * 0.08} className={`min-w-0 ${g.tile}`}>
            <figure className="relative m-0 h-full overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-premium group">
              <Image
                src={g.src}
                alt={g.alt}
                fill
                sizes={g.sizes}
                className="object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-105"
              />
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/65 via-black/25 to-transparent pointer-events-none" />
              <figcaption className="absolute bottom-0 inset-x-0 p-4 sm:p-5">
                <p className="font-display text-base sm:text-lg font-bold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
                  {g.caption}
                </p>
                <p className="text-xs text-white/85 mt-0.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                  {g.sub}
                </p>
              </figcaption>
            </figure>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Notice board — live school announcements                           */
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
}

const PRIORITY_TONES: Record<string, { label: string; chip: string; bar: string; dot: string }> = {
  URGENT: {
    label: 'Urgent',
    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
  },
  HIGH: {
    label: 'Important',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
  },
  // PHASE 7.5 — the NORMAL priority accent follows the school brand
  // (token classes with inert emerald fallback; see globals.css).
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

function NoticeDateTile({ iso, tone }: { iso: string; tone: string }) {
  const { day, month } = noticeDateParts(iso)
  return (
    <div
      aria-hidden
      className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border border-border/60 bg-gradient-to-b ${tone} to-transparent`}
    >
      <span className="text-lg font-bold leading-none text-foreground">{day}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{month}</span>
    </div>
  )
}

function NoticeBoardHeader() {
  return (
    <SectionHeader
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Live notice board
        </span>
      }
      title="Latest from the school"
      subtitle="Official announcements, published straight from the principal&apos;s office."
    >
      <a
        href="/api/public/notices/rss"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View all school notices — opens the full notice archive feed"
        title="Full notice archive — RSS feed"
        className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground shadow-premium transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 hover:shadow-premium-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        View all notices
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </SectionHeader>
  )
}

function NoticeBoardSkeletons() {
  return (
    <div className="grid md:grid-cols-3 gap-6" aria-busy="true" aria-label="Loading school notices">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-3xl border border-border/60 bg-card p-7 space-y-5">
          <div className="flex items-start gap-4">
            <div className="skeleton h-14 w-14 shrink-0 rounded-2xl" aria-hidden="true" />
            <div className="flex-1 space-y-2.5 pt-1 min-w-0">
              <div className="skeleton h-3 w-24 rounded" aria-hidden="true" />
              <div className="skeleton h-5 w-4/5 rounded" aria-hidden="true" />
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="skeleton h-3.5 w-full rounded" aria-hidden="true" />
            <div className="skeleton h-3.5 w-11/12 rounded" aria-hidden="true" />
            <div className="skeleton h-3.5 w-3/4 rounded" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  )
}

function NoticeBoardEmpty() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-2xl rounded-3xl border border-dashed border-border bg-card/50 p-10 sm:p-14 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
          <Megaphone className="w-6 h-6 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h3 className="font-display text-xl font-bold text-foreground mb-2">No notices right now</h3>
        <p className="text-muted-foreground leading-relaxed">
          School announcements will appear here as soon as the office publishes them —
          until then, the campus is quietly getting on with the business of learning.
        </p>
      </div>
    </FadeIn>
  )
}

function NoticeBoard({
  notices,
  loading,
  onOpenPortal,
}: {
  notices: PublicNotice[]
  loading: boolean
  onOpenPortal: () => void
}) {
  return (
    <section id="notices" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <NoticeBoardHeader />

      {loading ? (
        <NoticeBoardSkeletons />
      ) : !notices || notices.length === 0 ? (
        <NoticeBoardEmpty />
      ) : (
        <NoticeBoardList notices={notices} onOpenPortal={onOpenPortal} />
      )}
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
            className="group relative h-full overflow-hidden rounded-3xl border border-border/60 bg-card shadow-premium transition-all hover:-translate-y-1.5 hover:shadow-premium-lg"
          >
            <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1.5 z-10 ${featuredTone.bar}`} />
            {featured.imageUrl ? (
              <div className="relative h-44 sm:h-52 overflow-hidden bg-muted">
                <Image
                  src={featured.imageUrl}
                  alt={featured.title}
                  fill
                  sizes="(min-width: 1024px) 60vw, 100vw"
                  className="object-cover"
                />
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card via-card/30 to-transparent" />
              </div>
            ) : null}
            <div className="p-8">
              <div className="flex flex-wrap items-start gap-5">
                <NoticeDateTile iso={featured.createdAt} tone="from-emerald-500/10" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${featuredTone.chip}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${featuredTone.dot}`} />
                      {featuredTone.label}
                    </span>
                    <time
                      dateTime={featured.createdAt}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {noticeRelativeTime(featured.createdAt)}
                    </time>
                  </div>
                  <h3 className="mt-3 font-display text-2xl font-bold leading-snug text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {featured.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-muted-foreground line-clamp-5">
                    {featured.message}
                  </p>
                  <p className="mt-5 flex items-center gap-2 text-xs font-medium text-muted-foreground/80">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    Issued by the school office · verified broadcast
                  </p>
                </div>
              </div>
            </div>
          </article>
        </FadeIn>

        {/* Earlier notices — compact stack (optional image thumbs) */}
        {hasRest && (
          <div className="lg:col-span-2 flex flex-col gap-4">
            {rest.map((n, i) => {
              const tone = noticeTone(n.priority)
              return (
                <FadeIn key={n.id} delay={0.08 * (i + 1)}>
                  <article
                    aria-label={`Notice: ${n.title}`}
                    className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-premium transition-all hover:-translate-y-1 hover:shadow-premium-lg"
                  >
                    <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1 ${tone.bar}`} />
                    <div className="flex items-start gap-4 pl-2">
                      <NoticeDateTile iso={n.createdAt} tone="from-emerald-500/10" />
                      {n.imageUrl ? (
                        <Image
                          src={n.imageUrl}
                          alt=""
                          width={56}
                          height={56}
                          loading="lazy"
                          className="h-14 w-14 shrink-0 rounded-xl border border-border/60 object-cover"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                            <span aria-hidden className={`h-1 w-1 rounded-full ${tone.dot}`} />
                            {tone.label}
                          </span>
                          <time dateTime={n.createdAt} className="text-[11px] text-muted-foreground">
                            {noticeRelativeTime(n.createdAt)}
                          </time>
                        </div>
                        <h4 className="mt-2 truncate text-sm font-bold text-foreground">{n.title}</h4>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                          {n.message}
                        </p>
                      </div>
                    </div>
                  </article>
                </FadeIn>
              )
            })}
          </div>
        )}
      </div>

      <FadeIn delay={0.15} className="mt-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/60 backdrop-blur px-6 py-5">
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            Students, parents and staff see every notice first inside the portal —{' '}
            <span className="font-semibold text-foreground">with live delivery to their dashboard.</span>
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
/*  Admissions — CMS copy + premium form card (two-column on lg)      */
/* ------------------------------------------------------------------ */

function Admissions({
  admissions,
  phone,
  loading,
  admForm,
  setAdmForm,
  admSubmitting,
  admSuccess,
  setAdmSuccess,
  admError,
  handleAdmissionSubmit,
}: {
  admissions: WebsiteContent['admissions']
  phone: string
  loading: boolean
  admForm: any
  setAdmForm: (f: any) => void
  admSubmitting: boolean
  admSuccess: boolean
  setAdmSuccess: (v: boolean) => void
  admError: string
  handleAdmissionSubmit: (e: React.FormEvent) => Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)

  const update = (k: keyof typeof admForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setAdmForm({ ...admForm, [k]: e.target.value })
  }

  const highlights = Array.isArray(admissions?.highlights) ? admissions.highlights : []
  const officeHours = admissions?.officeHours?.trim() || ''

  return (
    <section id="admissions" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow={admissions.title}
        title={admissions.heading}
        subtitle={admissions.subtitle}
      />

      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        {/* Left — admission copy + highlights + office hours (CMS) */}
        <FadeIn className="min-w-0">
          {loading ? (
            <div className="space-y-4" aria-busy="true">
              <span className="sr-only">Loading admissions information</span>
              <div className="skeleton h-4 w-full rounded" aria-hidden="true" />
              <div className="skeleton h-4 w-11/12 rounded" aria-hidden="true" />
              <div className="skeleton h-4 w-3/4 rounded" aria-hidden="true" />
              <div className="skeleton h-24 w-full rounded-2xl mt-6" aria-hidden="true" />
            </div>
          ) : (
            <>
              {admissions.description ? (
                <p className="text-muted-foreground leading-relaxed">
                  {admissions.description}
                </p>
              ) : null}

              {highlights.length > 0 ? (
                <ul className="mt-8 space-y-4">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full school-brand-soft school-brand-text">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                      <span className="text-sm leading-relaxed text-foreground/90">{h}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {(officeHours || phone) ? (
                <div
                  className="mt-8 rounded-2xl border px-5 py-4 flex items-start gap-3"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--school-primary) 20%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--school-primary) 5%, transparent)',
                  }}
                >
                  <Phone className="h-4.5 w-4.5 school-brand-text shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {officeHours ? <>{officeHours}{phone ? ' — ' : null}</> : null}
                    {phone ? (
                      <a href={`tel:${phone}`} className="font-semibold text-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                        {phone}
                      </a>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </FadeIn>

        {/* Right — the form, untouched logic in a premium card */}
        <FadeIn delay={0.1} className="min-w-0">
          <div className="relative overflow-hidden bg-card/70 backdrop-blur-md rounded-3xl p-6 sm:p-8 lg:p-10 shadow-premium-lg border border-emerald-500/15">
            {/* subtle gradient halo */}
            <div aria-hidden className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

            {admSuccess ? (
              <div role="status" aria-live="polite" className="text-center py-8 space-y-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <ShieldCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                </div>
                <h3 className="font-display text-2xl font-bold text-foreground">Inquiry received!</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Thank you. Our admissions team will reach out within 24 hours to schedule a campus visit and
                  answer any questions.
                </p>
                <button
                  onClick={() => setAdmSuccess(false)}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold school-brand-ghost border transition-colors"
                >
                  Submit another inquiry
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleAdmissionSubmit} className="space-y-6 text-left relative">
                <div className="grid md:grid-cols-2 gap-6">
                  <Field label="Parent / Guardian Name">
                    <input
                      type="text"
                      required
                      value={admForm.parentName}
                      onChange={update('parentName')}
                      placeholder="Your full name"
                      className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      required
                      value={admForm.email}
                      onChange={update('email')}
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none"
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
                      className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none"
                    />
                  </Field>
                  <Field label="Grade applying for">
                    <select
                      required
                      value={admForm.grade}
                      onChange={update('grade')}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none appearance-none"
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
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none"
                  />
                </Field>

                <Field label="Notes (optional)">
                  <textarea
                    value={admForm.notes}
                    onChange={update('notes')}
                    placeholder="Anything else you'd like us to know?"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background/60 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all outline-none resize-none"
                  />
                </Field>

                {admError && (
                  <div role="alert" className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-sm">
                    {admError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={admSubmitting}
                  className="group w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl text-base font-semibold school-brand-cta hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">{label}</label>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
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

function Footer({
  schoolName,
  shortName,
  logoUrl,
  phone,
  email,
  address,
  city,
  website,
  established,
  footer,
  contact,
  onOpenPortal,
}: {
  schoolName: string
  shortName: string
  logoUrl?: string | null
  phone: string
  email: string
  address: string
  city: string
  website: string
  established: string
  footer: WebsiteContent['footer']
  contact: WebsiteContent['contact']
  onOpenPortal: () => void
}) {
  const quickLinks = [
    { label: 'About Us', href: '#about' },
    { label: 'Campus Life', href: '#campus-life' },
    { label: 'Academics', href: '#journey' },
    { label: 'Facilities', href: '#facilities' },
    { label: 'Admissions', href: '#admissions' },
  ]

  const aboutLine = footer.about?.trim() || ''
  // Only ever display an establishment year the school actually
  // recorded — never an invented "since YYYY".
  const establishedYear = established?.trim() || ''

  const socialLinks = SOCIAL_LINKS.flatMap(({ key, label, icon }) => {
    const href = footer.social?.[key]
    if (typeof href !== 'string') return []
    const url = href.trim()
    if (!/^https?:\/\//i.test(url)) return []
    return [{ key, label, icon, url }]
  })

  const contactTitle = contact.title?.trim() || 'Contact'
  const contactSubtitle = contact.subtitle?.trim() || ''
  const websiteUrl = /^https?:\/\//i.test(website) ? website : ''

  return (
    <footer id="footer" className="mt-auto bg-card border-t border-border/60 pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-12 mb-10">
        {/* Brand */}
        <div>
          <div className="flex items-center gap-3 mb-5">
            <BrandLogo logoUrl={logoUrl} shortName={shortName} />
            <div className="min-w-0">
              <h2 className="font-display font-bold text-foreground leading-tight">{shortName}</h2>
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 tracking-widest uppercase">
                Powered by Scholario
              </p>
            </div>
          </div>
          {aboutLine ? (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {aboutLine}
            </p>
          ) : null}
          {establishedYear ? (
            <span className="mt-3 inline-flex items-center rounded-full school-brand-soft school-brand-text px-2.5 py-0.5 text-[11px] font-semibold">
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
                  className="h-9 w-9 flex items-center justify-center rounded-full border border-border bg-card/60 school-brand-text hover:border-emerald-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <s.icon className="w-4 h-4" aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {/* Contact */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/80 mb-5">{contactTitle}</h3>
          {contactSubtitle ? (
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{contactSubtitle}</p>
          ) : null}
          <ul className="space-y-4 text-sm text-muted-foreground">
            {address || city ? (
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                <span>{[address, city].filter(Boolean).join(', ')}</span>
              </li>
            ) : null}
            {phone ? (
              <li className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <a href={`tel:${phone}`} className="hover:text-foreground transition-colors">{phone}</a>
              </li>
            ) : null}
            {email ? (
              <li className="flex items-center gap-3 min-w-0">
                <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <a href={`mailto:${email}`} className="hover:text-foreground transition-colors truncate">{email}</a>
              </li>
            ) : null}
            {websiteUrl ? (
              <li className="flex items-center gap-3 min-w-0">
                <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors truncate">
                  {websiteUrl.replace(/^https?:\/\//i, '')}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        {/* Quick links */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/80 mb-5">Quick Links</h3>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {quickLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Portal */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/80 mb-5">Portal Access</h3>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            Students, teachers, and staff — access your dashboard.
          </p>
          <button
            onClick={onOpenPortal}
            className="group inline-flex items-center gap-2 px-5 py-3 border school-brand-ghost rounded-full text-sm font-semibold transition-colors"
          >
            Open Login Portal
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="max-w-7xl mx-auto pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} {schoolName}. All rights reserved.</span>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a
            href="/api/public/notices/rss"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Subscribe to school notices via RSS"
            title="Subscribe in your favourite reader — RSS feed of the notice board"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Rss className="h-3.5 w-3.5" aria-hidden="true" />
            Notices RSS
          </a>
          <span aria-hidden className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/40" />
          <span>
            Powered by <span className="text-emerald-600 dark:text-emerald-400 font-semibold">SCHOLARIO-OS</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
