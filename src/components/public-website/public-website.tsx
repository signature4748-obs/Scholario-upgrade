'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import {
  GraduationCap,
  BookOpen,
  FlaskConical,
  Trophy,
  Target,
  Heart,
  Building2,
  ShieldCheck,
  MonitorPlay,
  Dumbbell,
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
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/lib/store/auth-store'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { usePublicSchoolData, useAdmissionForm } from './use-public-website-data'

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
  const cls = `group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all ${className}`
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
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-sm font-semibold text-emerald-700 dark:text-emerald-300 bg-white/60 dark:bg-white/5 backdrop-blur border border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50 transition-all ${className}`}
    >
      {children}
    </button>
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
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
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
  } = useAdmissionForm()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // school-derived strings
  const schoolName = schoolData?.name || 'Greenwood Public School'
  const city = schoolData?.city || 'Gurugram'
  const phone = schoolData?.phone || '+91 124 4567 800'
  const email = schoolData?.email || 'info@greenwood.edu.in'
  const address = schoolData?.address || '100 Knowledge Parkway, Sector 47, Gurugram'
  const academicYear = schoolData?.academicYear || '2025–26'
  const shortName = schoolName.split(' ')[0] || 'Demo'

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
    <div className="min-h-screen mesh-bg text-foreground selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300 flex flex-col">
      <Header
        schoolName={schoolName}
        scrolled={scrolled}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onOpenPortal={onOpenPortal}
      />

      <main>
        <Hero
          schoolData={schoolData}
          schoolName={schoolName}
          city={city}
          loading={loading}
          onOpenPortal={onOpenPortal}
        />

        <WhyChooseUs shortName={shortName} />

        <Journey />

        <Facilities />

        <CampusLife shortName={shortName} />

        <NoticeBoard
          notices={schoolData?.announcements ?? []}
          loading={loading}
          onOpenPortal={onOpenPortal}
        />

        <Admissions
          schoolName={schoolName}
          academicYear={academicYear}
          phone={phone}
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
        phone={phone}
        email={email}
        address={address}
        city={city}
        onOpenPortal={onOpenPortal}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function Header({
  schoolName,
  scrolled,
  mobileMenuOpen,
  setMobileMenuOpen,
  onOpenPortal,
}: {
  schoolName: string
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

  const shortName = schoolName.split(' ')[0] || 'Demo'

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
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/25 group-hover:scale-105 transition-transform shrink-0">
            <GraduationCap className="w-5 h-5" aria-hidden="true" />
          </div>
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
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/35 hover:-translate-y-0.5 active:translate-y-0 transition-all"
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
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md"
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

const heroStats: Stat[] = [
  { label: 'Students', value: '1,840', icon: GraduationCap },
  { label: 'Faculty', value: '152', icon: BookOpen },
  { label: 'Labs', value: '18', icon: FlaskConical },
  { label: 'Awards', value: '240+', icon: Trophy },
]

function Hero({
  schoolData,
  schoolName,
  city,
  loading,
  onOpenPortal,
}: {
  schoolData: any
  schoolName: string
  city: string
  loading: boolean
  onOpenPortal: () => void
}) {
  const legacyStats = [
    { label: 'Years Legacy', value: '30+' },
    { label: 'Teacher Ratio', value: '1:12' },
    { label: 'Board Pass', value: '98%' },
  ]

  return (
    <section id="top" className="relative pt-12 pb-16 lg:pt-20 lg:pb-20 overflow-hidden">
      {/* ambient orbs */}
      <div aria-hidden className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute top-32 -right-32 w-96 h-96 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy */}
          <FadeIn className="space-y-7 min-w-0">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass border border-emerald-500/30 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              Admissions open for {schoolData?.academicYear || '2025–26'}
            </span>

            <h2 className="font-display text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-balance">
              Empowering Minds, <br />
              <span
                className="bg-clip-text text-transparent bg-gradient-to-br from-emerald-500 via-teal-500 to-amber-500"
                style={{
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Inspiring Excellence
              </span>
            </h2>

            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed text-pretty">
              A future-ready learning community where tradition meets innovation. Discover an education that
              nurtures intellect, character, and curiosity at <span className="font-semibold text-foreground">{schoolName}</span>.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <PrimaryCta href="#admissions">
                Apply for Admission
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
              </PrimaryCta>
              <GhostCta onClick={onOpenPortal}>Login Portal</GhostCta>
            </div>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-5 sm:gap-x-10 pt-6">
              {legacyStats.map((s) => (
                <div key={s.label} className="shrink-0">
                  <div className="font-display text-3xl font-bold text-foreground tabular-nums tracking-tight">{s.value}</div>
                  <div className="text-xs font-semibold text-muted-foreground mt-1.5 uppercase tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>
          </FadeIn>

          {/* Right — campus photograph composition */}
          <FadeIn delay={0.15} className="relative min-w-0">
            <div className="relative">
              {/* offset frame — peeks out behind the photograph */}
              <div
                aria-hidden
                className="absolute inset-0 translate-x-4 translate-y-4 lg:translate-x-6 lg:translate-y-6 rounded-[2.25rem] border border-emerald-500/25 bg-emerald-500/5 pointer-events-none"
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
                      Est. 1995 · {city}
                    </p>
                  </div>
                </div>
              </div>

              {/* floating glass stat — one number, no dashboard feel */}
              <div className="absolute -bottom-5 -left-2 sm:-left-6 lg:-left-8">
                <div className="glass-strong rounded-2xl border border-border/60 shadow-premium-lg px-5 py-4 flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/25 shrink-0">
                    <Trophy className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-2xl font-bold text-foreground tabular-nums leading-none">98%</div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mt-1.5">
                      Board pass rate
                    </div>
                  </div>
                </div>
              </div>

              {/* floating accent */}
              <div
                aria-hidden
                className="hidden lg:block absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 opacity-70 blur-2xl pointer-events-none"
              />
            </div>
          </FadeIn>
        </div>

        {/* Trust bar — the institution at a glance */}
        <TrustBar loading={loading} />
      </div>
    </section>
  )
}

function TrustBar({ loading }: { loading: boolean }) {
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
/*  Why families choose us                                             */
/* ------------------------------------------------------------------ */

const pillars: Array<{
  title: string
  desc: string
  icon: LucideIcon
  bg: string
}> = [
  {
    title: 'Academic Excellence',
    desc: 'A rigorous, NEP-aligned curriculum that consistently produces top-tier board results.',
    icon: Target,
    bg: 'from-emerald-500 to-teal-600',
  },
  {
    title: 'Holistic Growth',
    desc: 'Sports, arts, and life-skills programs that shape confident, well-rounded individuals.',
    icon: Heart,
    bg: 'from-rose-400 to-rose-500',
  },
  {
    title: 'Modern Facilities',
    desc: 'Smart classrooms, advanced labs, and digital libraries built for 21st-century learning.',
    icon: Building2,
    bg: 'from-sky-400 to-sky-500',
  },
  {
    title: 'Safe & Inclusive',
    desc: 'A nurturing, secure campus where every child feels seen, heard, and valued.',
    icon: ShieldCheck,
    bg: 'from-lime-400 to-lime-500',
  },
]

function WhyChooseUs({ shortName }: { shortName: string }) {
  return (
    <section id="about" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow={`Why ${shortName}`}
        title="Why families choose us"
        subtitle={`Four pillars that define the ${shortName} experience.`}
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {pillars.map((p, i) => (
          <FadeIn key={p.title} delay={i * 0.08}>
            <div className="h-full bg-card rounded-3xl p-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg transition-all">
              <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${p.bg} flex items-center justify-center text-white shadow-lg mb-6`}>
                <p.icon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">{p.title}</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">{p.desc}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  A journey for every stage                                          */
/* ------------------------------------------------------------------ */

const stages: Array<{
  grade: string
  title: string
  desc: string
  accent: string
  badge: string
}> = [
  {
    grade: 'Grade 1 – 5',
    title: 'Primary School',
    desc: 'Activity-led learning that builds strong foundations in literacy, numeracy, and curiosity.',
    accent: 'from-emerald-400 to-teal-500',
    badge: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    grade: 'Grade 6 – 8',
    title: 'Middle School',
    desc: 'Inquiry-based classrooms that develop critical thinking, collaboration, and creativity.',
    accent: 'from-sky-400 to-blue-500',
    badge: 'text-sky-600 dark:text-sky-400',
  },
  {
    grade: 'Grade 9 – 12',
    title: 'Senior School',
    desc: 'Specialised streams in Science, Commerce, and Humanities with expert mentorship.',
    accent: 'from-orange-400 to-pink-500',
    badge: 'text-orange-600 dark:text-orange-400',
  },
]

function Journey() {
  return (
    <section id="journey" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Academics"
        title="A journey for every stage"
        subtitle="From first steps to graduation, we grow with your child."
      />

      <div className="grid md:grid-cols-3 gap-8">
        {stages.map((s, i) => (
          <FadeIn key={s.title} delay={i * 0.1}>
            <div className="relative h-full bg-card rounded-3xl pt-2 pb-8 px-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg transition-all overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-2 bg-gradient-to-r ${s.accent}`} aria-hidden="true" />
              <div className={`text-xs font-bold ${s.badge} uppercase tracking-wider mt-6 mb-2`}>
                {s.grade}
              </div>
              <h3 className="font-display text-2xl font-bold text-foreground mb-4">{s.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  World-class facilities                                             */
/* ------------------------------------------------------------------ */

const facilities: Array<{ title: string; desc: string; icon: LucideIcon }> = [
  { title: 'Smart Classrooms', desc: 'AI-enabled interactive boards in every room.', icon: MonitorPlay },
  { title: 'Science Labs', desc: 'Physics, chemistry & biology labs of university grade.', icon: FlaskConical },
  { title: 'Sports Complex', desc: 'Olympic-sized pool, courts, and a 400m track.', icon: Dumbbell },
  { title: 'Library', desc: '30,000+ titles and a fully digital research hub.', icon: Library },
]

function Facilities() {
  return (
    <section id="facilities" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Our Campus"
        title="World-class facilities"
        subtitle="Spaces designed to inspire discovery."
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {facilities.map((f, i) => (
          <FadeIn key={f.title} delay={i * 0.08}>
            <div className="h-full bg-card rounded-3xl p-8 shadow-premium border border-border/60 hover:-translate-y-1.5 hover:shadow-premium-lg hover:border-emerald-500/40 transition-all">
              <f.icon className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mb-6" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="text-xl font-bold text-foreground mb-3">{f.title}</h3>
              <p className="text-muted-foreground leading-relaxed text-sm">{f.desc}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Campus life — gallery mosaic                                       */
/* ------------------------------------------------------------------ */

const gallery: Array<{
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

function CampusLife({ shortName }: { shortName: string }) {
  return (
    <section id="campus-life" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Campus Life"
        title={`Life at ${shortName}`}
        subtitle="Learning happens everywhere — in labs, on fields, and between the shelves."
      />

      <div className="grid grid-cols-1 auto-rows-[240px] sm:grid-cols-2 sm:auto-rows-[230px] lg:grid-cols-3 lg:auto-rows-[250px] gap-4 sm:gap-5">
        {gallery.map((g, i) => (
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
  NORMAL: {
    label: 'Notice',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
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
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        {/* Featured notice — the newest broadcast gets the big canvas */}
        <FadeIn className={hasRest ? 'lg:col-span-3' : 'lg:col-span-5'}>
          <article
            aria-label={`Featured notice: ${featured.title}`}
            className="group relative h-full overflow-hidden rounded-3xl border border-border/60 bg-card p-8 shadow-premium transition-all hover:-translate-y-1.5 hover:shadow-premium-lg"
          >
            <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1.5 ${featuredTone.bar}`} />
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
          </article>
        </FadeIn>

        {/* Earlier notices — compact stack */}
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
/*  Admissions — copy + premium form card (two-column on lg)          */
/* ------------------------------------------------------------------ */

const admissionHighlights = (academicYear: string): string[] => [
  `Applications for the ${academicYear} academic year are open now`,
  'Campus tours run every Saturday, 10 am – 1 pm',
  'Entrance assessments take place in the last week of February',
  'Merit and sibling scholarships available from Grade 6 onwards',
  'Small classes capped at 30 students — a genuine 1:12 teacher ratio',
]

function Admissions({
  schoolName,
  academicYear,
  phone,
  admForm,
  setAdmForm,
  admSubmitting,
  admSuccess,
  setAdmSuccess,
  admError,
  handleAdmissionSubmit,
}: {
  schoolName: string
  academicYear: string
  phone: string
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

  return (
    <section id="admissions" className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
      <SectionHeader
        eyebrow="Admissions"
        title="Begin your admissions journey"
        subtitle="Tell us a little about your child and we&apos;ll be in touch."
      />

      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        {/* Left — admission copy + key dates & highlights */}
        <FadeIn className="min-w-0">
          <h3 className="font-display text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            A place for every ambition
          </h3>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Every year a limited number of seats open at <span className="font-semibold text-foreground">{schoolName}</span> —
            and every application is read by a person, not a filter. Here is what applying families can expect:
          </p>

          <ul className="mt-8 space-y-4">
            {admissionHighlights(academicYear).map((h) => (
              <li key={h} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="text-sm leading-relaxed text-foreground/90">{h}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-start gap-3">
            <Phone className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              Prefer to talk it through? The admissions office answers between 9 am and 4 pm, Monday to
              Saturday —{' '}
              <a href={`tel:${phone}`} className="font-semibold text-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                {phone}
              </a>
            </p>
          </div>
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
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors"
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
                      <option value="">Select grade</option>
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
                  className="group w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl text-base font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/35 disabled:opacity-60 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0 transition-all"
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

function Footer({
  schoolName,
  phone,
  email,
  address,
  city,
  onOpenPortal,
}: {
  schoolName: string
  phone: string
  email: string
  address: string
  city: string
  onOpenPortal: () => void
}) {
  const shortName = schoolName.split(' ')[0] || 'Demo'

  const quickLinks = [
    { label: 'About Us', href: '#about' },
    { label: 'Campus Life', href: '#campus-life' },
    { label: 'Academics', href: '#journey' },
    { label: 'Facilities', href: '#facilities' },
    { label: 'Admissions', href: '#admissions' },
  ]

  return (
    <footer id="footer" className="mt-auto bg-card border-t border-border/60 pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-12 mb-10">
        {/* Brand */}
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shrink-0">
              <GraduationCap className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-foreground leading-tight">{shortName}</h2>
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 tracking-widest uppercase">
                Powered by Scholario
              </p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Nurturing minds, shaping character, and inspiring excellence since 1995.
          </p>
        </div>

        {/* Contact */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/80 mb-5">Contact</h3>
          <ul className="space-y-4 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
              <span>{address}, {city}</span>
            </li>
            <li className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <a href={`tel:${phone}`} className="hover:text-foreground transition-colors">{phone}</a>
            </li>
            <li className="flex items-center gap-3 min-w-0">
              <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <a href={`mailto:${email}`} className="hover:text-foreground transition-colors truncate">{email}</a>
            </li>
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
            className="group inline-flex items-center gap-2 px-5 py-3 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/5 rounded-full text-sm font-semibold transition-colors"
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
