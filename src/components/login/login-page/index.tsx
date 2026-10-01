'use client'

import { useEffect, useState, type ComponentType, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Eye, EyeOff, Info, AlertTriangle } from 'lucide-react'
import { useAuth, type Role } from '@/lib/store/auth-store'
import { saveSessionToken } from '@/lib/auth-session-token'
import { isValidHexColor } from '@/lib/branding-contrast'
import { LoadingPhase } from './loading-phase'

/* ------------------------------------------------------------------ */
/*  LoginPage — split-pane design adapted from the "Spacer" reference  */
/*  • Left pane: animated emerald→teal gradient with school logo,     */
/*    name, tagline, cloud SVG divider on the right edge              */
/*  • Right pane: clean white form panel with underline inputs,        */
/*    Sign In + Forgot Password only (NO sign-up, NO terms checkbox,  */
/*    NO demo-access shortcuts — Phase 8A credential-exposure         */
/*    cleanup removed the one-tap demo chips + their hardcoded        */
/*    credential values from this surface entirely)                   */
/* ------------------------------------------------------------------ */


/* ── PHASE 7 — REAL school branding ────────────────────────────────────
 * The login surface's school identity (name/logo alt/tagline) comes from
 * the REAL registered school profile (GET /api/schools/public — same
 * canonical source as the public website), with a NEUTRAL degradation
 * when the profile is unavailable. The retired `lib/mock/school`
 * snapshot (Greenwood branding + fabricated "CBSE · Estd. 2020") is no
 * longer consulted here. */
interface LoginBranding {
  name: string
  shortName: string
  tagline: string
  affiliation: string | null
  academicYear: string | null
  logoUrl: string | null
  primaryColor: string | null
}

const NEUTRAL_BRANDING: LoginBranding = {
  name: 'Scholario School',
  shortName: 'SCHOLARIO',
  tagline: 'Your school workspace, secured by Scholario',
  affiliation: null,
  academicYear: null,
  logoUrl: null,
  primaryColor: null,
}

/* PHASE 7.5 — the branding fetch carries the school's own identity
 * fields (shortName / tagline / affiliation / logoUrl / themeColor).
 * NO slug is sent: the server resolves the tenant (Host domain →
 * ?slug → single-school → demo) exactly as for the public website. */
interface PublicSchoolBrandingBody {
  success?: boolean
  data?: {
    name?: string
    shortName?: string
    tagline?: string
    affiliation?: string
    academicYear?: string
    logoUrl?: string | null
    themeColor?: string
  }
}

/** CSS custom properties for the brand-token classes (globals.css):
 *  `--school-primary` drives the sign-in button, chip selected state and
 *  input underline accents; `--ring` tints the keyboard focus ring.
 *  Both are set ONLY when the school configured a valid color, so the
 *  un-branded fallback stays the Scholario emerald identity. */
function loginBrandStyle(primaryColor: string | null): CSSProperties {
  if (typeof primaryColor !== 'string' || !isValidHexColor(primaryColor)) {
    return {}
  }
  return {
    '--school-primary': primaryColor,
    '--ring': primaryColor,
  } as React.CSSProperties
}

function useLoginSchoolBranding(): LoginBranding {
  const [branding, setBranding] = useState<LoginBranding>(NEUTRAL_BRANDING)
  useEffect(() => {
    let alive = true
    // Forward the URL's ?slug= when present (sandbox per-tenant links /
    // explicit school deep-links): the login must brand itself as the
    // school whose site the visitor came from — NOT the demo fallback.
    // Production domains carry no slug; the Host header resolves there.
    const slug = new URLSearchParams(window.location.search).get('slug')
    const url = slug
      ? `/api/schools/public?slug=${encodeURIComponent(slug)}`
      : '/api/schools/public'
    void fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: PublicSchoolBrandingBody | null) => {
        const d = body?.success ? body.data : undefined
        if (!alive || !d?.name) return
        const name = d.name
        setBranding({
          name,
          // Server identity.shortName with a neutral name-split fallback.
          shortName:
            (typeof d.shortName === 'string' && d.shortName.trim()) ||
            name.split(' ').slice(0, 2).join(' '),
          tagline:
            typeof d.tagline === 'string' && d.tagline.trim()
              ? d.tagline.trim()
              : NEUTRAL_BRANDING.tagline,
          affiliation:
            typeof d.affiliation === 'string' && d.affiliation.trim()
              ? d.affiliation.trim()
              : null,
          academicYear: d.academicYear ?? null,
          logoUrl: d.logoUrl ?? null,
          // Hex-validated client-side; the server also enforces WCAG
          // contrast before storing a color, but never trust the wire.
          primaryColor:
            typeof d.themeColor === 'string' && isValidHexColor(d.themeColor)
              ? d.themeColor.trim()
              : null,
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return branding
}

export function LoginPage({ onBackToWebsite }: { onBackToWebsite?: () => void }) {
  const school = useLoginSchoolBranding()
  const { startAuth, endAuth, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'form' | 'loading'>('form')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    // 1) Validate BEFORE any network work — a doomed request must never
    //    fire before the user sees the empty-fields error.
    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }
    // Duplicate-submission guard: the button is disabled while submitting,
    // but a second entry point (Enter key on mobile keyboards) must not
    // fire a parallel request.
    if (submitting) return

    setSubmitting(true)
    setError('')
    startAuth()
    setPhase('loading')

    try {
      // 2) ONE server round trip. The server is the single source of
      //    truth for the role — the resolved role decides which panel
      //    mounts, so it can never come from a client-side guess.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        data?: { id?: string; email?: string; name?: string; role?: string; sessionToken?: string }
      } | null

      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Unable to complete sign in. Please try again.')
      }

      const serverRole = payload.data?.role?.toLowerCase()
      // PHASE 6 — school roles only: the login API rejects SUPER_ADMIN
      // identities server-side, so the client accepts exactly the three
      // school roles (a 'superadmin' literal here would be dead code and
      // a misleading hint that such a school login exists).
      const role: Role =
        serverRole === 'principal' || serverRole === 'teacher' || serverRole === 'student'
          ? serverRole
          : 'principal'

      // Persist the session token BEFORE the panel mounts. In embedded
      // contexts (the cross-site preview iframe) the browser drops the
      // SameSite=Lax cookie, so every panel API call must instead carry
      // `Authorization: Bearer <token>` (installed in app boot). Without
      // this, the freshly mounted panel's first 401 would trigger the
      // dead-session policy and bounce straight back to this screen.
      if (payload.data?.sessionToken) saveSessionToken(payload.data.sessionToken)

      // 3) Navigate ONLY after the session cookie exists. `login()` flips
      //    isAuthenticated → Home swaps the login screen for the role's
      //    panel. Real identity (id/name/email) is synced into the store so
      //    the shell shows the authenticated user, not a stale mock.
      login(role, {
        ...(payload.data?.id ? { id: payload.data.id } : {}),
        ...(payload.data?.name ? { name: payload.data.name } : {}),
        ...(payload.data?.email ? { email: payload.data.email } : {}),
      })
    } catch (e) {
      // 4) Failure returns to the form WITH a visible, actionable error —
      //    never a silent bounce back to the same screen.
      endAuth()
      setPhase('form')
      setSubmitting(false)
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Network error — please check your connection and try again.'
      )
    }
  }

  return (
    <div
      style={loginBrandStyle(school.primaryColor)}
      className="relative h-[100dvh] w-full overflow-hidden bg-white font-sans"
    >
      <AnimatePresence mode="wait">
        {phase === 'form' ? (
          <motion.main
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="flex flex-col md:flex-row w-full h-full"
          >
            {/* LEFT PANE: brand + welcome — DESKTOP ONLY. On mobile it
                consumed ~36% of the viewport and pushed the Sign In button
                below the fold, which read as "login does nothing". The
                RightPane carries its own compact mobile logo. */}
            <LeftPane school={school} onBackToWebsite={onBackToWebsite} />

            {/* RIGHT PANE: form */}
            <RightPane
              school={school}
              email={email}
              password={password}
              submitting={submitting}
              error={error}
              onEmailChange={(v) => { setEmail(v); setError('') }}
              onPasswordChange={(v) => { setPassword(v); setError('') }}
              onLogin={() => handleLogin()}
              onForgotPassword={() => setForgotOpen(true)}
            />
          </motion.main>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <LoadingPhase selectedRole={null} />
          </div>
        )}
      </AnimatePresence>

      {forgotOpen && (
        <ForgotPasswordModal onClose={() => setForgotOpen(false)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  PlatformAnnouncementBanner — PHASE 6 (additive, read-only).        */
/*  Active platform notices for the school login door, fetched from    */
/*  the anonymous public announcements endpoint. Purely a display      */
/*  block: no auth logic, no form coupling; any fetch failure or       */
/*  empty list renders nothing.                                       */
/* ------------------------------------------------------------------ */

interface PlatformAnnouncement {
  id: string
  title: string
  body: string
  level: 'INFO' | 'WARNING' | 'CRITICAL'
}

const PLATFORM_ANNOUNCEMENT_STYLES: Record<
  PlatformAnnouncement['level'],
  { border: string; icon: ComponentType<{ className?: string }>; iconClass: string }
> = {
  INFO: { border: 'border-l-emerald-600', icon: Info, iconClass: 'text-emerald-600' },
  WARNING: { border: 'border-l-amber-500', icon: AlertTriangle, iconClass: 'text-amber-600' },
  CRITICAL: { border: 'border-l-red-500', icon: AlertTriangle, iconClass: 'text-red-600' },
}

function PlatformAnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/platform/announcements/public')
        const body = (await res.json()) as {
          ok?: boolean
          data?: { announcements?: PlatformAnnouncement[] }
        }
        if (!cancelled && body.ok && Array.isArray(body.data?.announcements)) {
          setAnnouncements(body.data.announcements.slice(0, 3))
        }
      } catch {
        // Silent by design — the sign-in form must never depend on this.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (announcements.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="mb-6 space-y-2.5"
      aria-live="polite"
      aria-label="Platform announcements"
    >
      {announcements.map((a) => {
        const style = PLATFORM_ANNOUNCEMENT_STYLES[a.level] ?? PLATFORM_ANNOUNCEMENT_STYLES.INFO
        const LevelIcon = style.icon
        return (
          <div
            key={a.id}
            className={`rounded-lg border border-border/70 border-l-4 bg-card px-3.5 py-3 ${style.border}`}
          >
            <div className="flex items-start gap-2.5">
              <LevelIcon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.body}</p>
              </div>
            </div>
          </div>
        )
      })}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Left pane — animated gradient + logo + cloud divider               */
/* ------------------------------------------------------------------ */

function LeftPane({
  school,
  onBackToWebsite,
}: {
  school: LoginBranding
  onBackToWebsite?: () => void
}) {
  return (
    <section
      className="left-pane relative hidden md:flex md:w-[45%] p-8 md:p-12 flex-col items-center justify-center text-center text-white overflow-hidden"
      style={{
        // PHASE 7.5 — the brand pane gradient derives from the school's
        // primary color (server contrast-validated). Un-branded fallback
        // = the classic emerald→teal Scholario login look.
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--school-primary, #0d9488) 55%, #041f1c) 0%, var(--school-primary, #0d9488) 50%, color-mix(in srgb, var(--school-primary, #0d9488) 72%, #041f1c) 100%)',
        backgroundSize: '200% 200%',
        animation: 'bgShift 15s ease infinite',
      }}
    >
      {/* Floating ambient orbs */}
      <div
        aria-hidden
        className="absolute top-10 left-10 w-40 h-40 rounded-full bg-emerald-300/20 blur-3xl"
        style={{ animation: 'float 6s ease-in-out infinite' }}
      />
      <div
        aria-hidden
        className="absolute bottom-20 left-1/3 w-32 h-32 rounded-full bg-teal-200/20 blur-3xl"
        style={{ animation: 'float 8s ease-in-out infinite reverse' }}
      />

      {/* Welcome header */}
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 text-xl lg:text-2xl font-medium mb-8 text-emerald-50"
      >
        Welcome to
      </motion.h2>

      {/* Logo + school name */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center mb-8"
      >
        <div
          className="bg-white rounded-3xl p-5 mb-5 w-28 h-28 flex items-center justify-center shadow-2xl shadow-emerald-900/30"
          style={{ animation: 'float 6s ease-in-out infinite' }}
        >
          {school.logoUrl ? (
            <Image
              src={school.logoUrl}
              alt={`${school.name} logo`}
              width={72}
              height={72}
              className="w-16 h-16 object-contain"
              priority
            />
          ) : (
            <Image
              src="/logo.svg"
              alt="Scholario logo"
              width={72}
              height={72}
              className="w-16 h-16"
              priority
            />
          )}
        </div>
        <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-white">
          {school.shortName}
        </h1>
        <p className="text-[11px] font-semibold text-emerald-100 tracking-[0.25em] uppercase mt-2">
          Powered by Scholario
        </p>
        {school.affiliation ? (
          <p className="text-xs text-emerald-100/85 mt-2 tracking-wide">
            {school.affiliation}
          </p>
        ) : null}
      </motion.div>

      {/* Description */}
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 text-sm lg:text-base text-emerald-50/90 max-w-[320px] leading-relaxed mb-auto"
      >
        {school.tagline}. Sign in to access your dashboard, resources, and school community.
      </motion.p>

      {/* Footer links */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mt-12 mb-8 text-xs text-emerald-100/70 tracking-wider flex gap-4 uppercase font-medium"
      >
        <button
          type="button"
          onClick={onBackToWebsite}
          className="rounded-md px-1.5 -mx-1.5 py-0.5 hover:text-white transition-colors focus-ring"
        >
          ← Back to Website
        </button>
        <span className="w-px bg-emerald-300/40" />
        {school.academicYear ? <span>Session {school.academicYear}</span> : null}
      </motion.div>

      {/* Cloud SVG divider (right edge) */}
      <svg
        aria-hidden
        className="absolute top-0 right-0 bottom-0 w-[120px] h-full pointer-events-none hidden md:block"
        preserveAspectRatio="none"
        viewBox="0 0 100 500"
      >
        <path
          d="M100,0 C80,30 90,80 70,120 C50,160 80,220 60,260 C40,300 70,360 50,420 C30,480 80,500 100,500 Z"
          fill="rgba(255,255,255,0.1)"
        />
        <path
          d="M100,0 C90,40 100,90 80,130 C60,170 95,210 75,270 C55,330 90,370 65,430 C40,490 90,500 100,500 Z"
          fill="rgba(255,255,255,0.35)"
        />
        <path
          d="M100,0 C100,50 110,100 95,150 C80,200 105,250 85,300 C65,350 100,400 80,450 C60,500 100,500 100,500 Z"
          fill="#ffffff"
        />
      </svg>

      <style jsx global>{`
        @keyframes bgShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Right pane — login form                                             */
/* ------------------------------------------------------------------ */

interface RightPaneProps {
  school: LoginBranding
  email: string
  password: string
  submitting: boolean
  error: string
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onLogin: () => void
  onForgotPassword: () => void
}

function RightPane({
  school,
  email,
  password,
  submitting,
  error,
  onEmailChange,
  onPasswordChange,
  onLogin,
  onForgotPassword,
}: RightPaneProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  return (
    <section className="relative z-20 flex w-full flex-1 flex-col justify-center overflow-y-auto bg-white p-6 sm:p-8 md:w-[55%] md:p-12 lg:p-16">
      <div className="w-full max-w-md mx-auto">
        {/* Mobile-only logo (school logo when configured) */}
        <div className="md:hidden flex flex-col items-center mb-8">
          <div className="bg-white rounded-2xl p-3 mb-3 w-16 h-16 flex items-center justify-center shadow-lg shadow-emerald-500/20 border border-emerald-500/20">
            {school.logoUrl ? (
              <Image
                src={school.logoUrl}
                alt={`${school.name} logo`}
                width={40}
                height={40}
                className="h-10 w-10 rounded-lg object-contain"
              />
            ) : (
              <Image
                src="/logo.svg"
                alt="Scholario logo"
                width={40}
                height={40}
                className="w-10 h-10"
              />
            )}
          </div>
          <h1 className="font-display text-xl font-bold text-foreground">{school.shortName}</h1>
          <p className="text-[11px] font-semibold text-emerald-600 tracking-[0.25em] uppercase mt-1">
            Powered by Scholario
          </p>
          {school.affiliation ? (
            <p className="text-xs text-muted-foreground mt-1.5">{school.affiliation}</p>
          ) : null}
        </div>

        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-3xl lg:text-4xl font-semibold mb-2 text-foreground"
        >
          Student & Staff Login
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="text-sm text-muted-foreground mb-8"
        >
          Sign in to access your dashboard.
        </motion.p>

        {/* PHASE 6 — platform announcements (additive, read-only; see
            PlatformAnnouncementBanner above). Renders nothing when the
            platform has no active notices. */}
        <PlatformAnnouncementBanner />

        {/* Error message — rendered ABOVE the fields so it is always
            visible without scrolling, on every viewport. */}
        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive"
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            onLogin()
          }}
        >
          {/* Institutional Email or ID */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <label
              htmlFor="identifier"
              className="block text-sm font-semibold text-foreground mb-2 transition-colors focus-within:text-emerald-600"
            >
              Institutional Email or ID
            </label>
            <div className="custom-input-wrapper relative flex items-center">
              <input
                id="identifier"
                name="identifier"
                type="text"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="Enter your email or ID"
                className="custom-input block w-full text-foreground placeholder:text-gray-400 py-2.5 focus:ring-0 peer"
              />
              <span className="absolute right-0 input-check-icon peer-focus:scale-110 school-brand-text">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </div>
          </motion.div>

          {/* Password */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <label
              htmlFor="password"
              className="block text-sm font-semibold text-foreground mb-2 transition-colors focus-within:text-emerald-600"
            >
              Password
            </label>
            <div className="custom-input-wrapper relative flex items-center">
              <input
                id="password"
                name="password"
                type={passwordVisible ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="Enter your password"
                className="custom-input custom-input-action-end block w-full text-foreground placeholder:text-gray-400 py-2.5 focus:ring-0"
              />
              <button
                type="button"
                onClick={() => setPasswordVisible((v) => !v)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={passwordVisible}
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:text-foreground transition-colors focus-ring"
              >
                {passwordVisible ? (
                  <EyeOff className="h-5 w-5" aria-hidden />
                ) : (
                  <Eye className="h-5 w-5" aria-hidden />
                )}
              </button>
            </div>
          </motion.div>

          {/* Forgot password */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-end"
          >
            <button
              type="button"
              onClick={onForgotPassword}
              className="rounded-md px-1 -mx-1 py-0.5 text-sm font-medium school-brand-text hover:underline transition-colors focus-ring"
            >
              Forgot password?
            </button>
          </motion.div>

          {/* Submit */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.button
              type="submit"
              disabled={submitting}
              whileHover={{ scale: 1.01, y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="group w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 school-brand-cta text-base font-semibold rounded-full transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-ring"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
              {!submitting && (
                <svg
                  className="w-4 h-4 group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
                </svg>
              )}
            </motion.button>
          </motion.div>
        </form>
      </div>

      <style jsx>{`
        .custom-input-wrapper {
          position: relative;
        }
        .custom-input-wrapper::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 0%;
          height: 2px;
          /* PHASE 7.5 — school primary (inert fallback = the classic
             emerald→teal underline) */
          background: linear-gradient(
            90deg,
            var(--school-primary, #10b981),
            color-mix(in srgb, var(--school-primary, #10b981) 72%, #000)
          );
          transition: width 0.3s ease;
        }
        .custom-input-wrapper:focus-within::after {
          width: 100%;
        }
        .custom-input {
          border: none;
          border-bottom: 1px solid var(--border, #d1d5db);
          border-radius: 0;
          padding-left: 0;
          padding-right: 0;
          background-color: transparent;
          font-size: 1rem;
          padding-top: 0.625rem;
          padding-bottom: 0.625rem;
          transition: border-color 0.3s ease;
        }
        .custom-input:focus {
          outline: none;
          box-shadow: none;
          border-bottom-color: transparent;
        }
        /* Keyboard-only focus indicator matching the app-wide .focus-ring
           pattern: mouse/touch focus keeps just the animated underline;
           keyboard focus additionally draws the high-contrast ring
           (--ring is the school primary when branded). */
        .custom-input:focus-visible {
          box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring);
        }
        /* Right padding so text never runs under a trailing inline action
           (the password show/hide toggle). */
        .custom-input-action-end {
          padding-right: 2.5rem;
        }
        .input-check-icon {
          transition: transform 0.3s ease, opacity 0.3s ease;
          opacity: 0.4;
        }
        .peer:focus ~ .input-check-icon {
          opacity: 1;
        }
      `}</style>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Forgot password modal                                               */
/* ------------------------------------------------------------------ */

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  // PIH-6 — Escape closes the dialog (keyboard-escape parity with the app's
  // other dialogs; the QA sweep found this was the only one missing it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Reset your password"
        className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
      >
        {sent ? (
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-display text-xl font-bold text-foreground">Contact your administrator</h3>
            <p className="text-sm text-muted-foreground">
              {/* PIH-4c — no reset-email backend exists; the modal tells the
                  user the truth instead of promising a link that never comes. */}
              Password resets are handled by your school administrator — please contact them to reset the password for <span className="font-semibold text-foreground">{email}</span>.
            </p>
            <button
              onClick={onClose}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 transition-all focus-ring"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="font-display text-xl font-bold text-foreground">Forgot your password?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {/* PIH-4c — honest copy: no reset link can be emailed yet
                    (no email backend). The email identifies the account when
                    the user contacts their school administrator. */}
                Enter your registered email, then contact your school administrator to complete the password reset.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (email) setSent(true)
              }}
              className="space-y-4"
            >
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                aria-label="Registered email address"
                className="w-full px-4 py-3 rounded-xl border border-border bg-card/60 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none transition-all"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold text-foreground border border-border hover:bg-accent transition-colors focus-ring"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 transition-all focus-ring"
                >
                  Continue
                </button>
              </div>
            </form>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
