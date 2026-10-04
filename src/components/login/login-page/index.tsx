'use client'

import { useEffect, useState, type ComponentType, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Eye, EyeOff, Info, AlertTriangle } from 'lucide-react'
import { useAuth, type Role } from '@/lib/store/auth-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { saveSessionToken } from '@/lib/auth-session-token'
import {
  AuthFailure,
  authFailureFromEnvelope,
  authFailureRefLine,
  classifyAuthFetchError,
} from '@/lib/auth-failure'
import { isValidHexColor } from '@/lib/branding-contrast'
import { LoadingPhase } from './loading-phase'

/* ------------------------------------------------------------------ */
/*  LoginPage — quiet split-pane school login                          */
/*  • Left pane (md+): solid light brand wash — school logo, name,     */
/*    tagline (only when configured), and the factual school-workspace */
/*    line. No animated color washes, no floating orbs, no dividers.   */
/*  • Right pane: white form card — Sign In + Forgot Password only     */
/*    (NO sign-up, NO terms checkbox, NO demo-access shortcuts —       */
/*    Phase 8A credential-exposure cleanup removed the one-tap demo    */
/*    chips + their hardcoded credential values from this surface      */
/*    entirely).                                                       */
/* ------------------------------------------------------------------ */


/* ── REAL school branding ────────────────────────────────────────────
 * The login surface's school identity (name/logo/tagline) comes from
 * the REAL registered school profile (GET /api/schools/public — same
 * canonical source as the public website), with a NEUTRAL degradation
 * when the profile is unavailable OR when the request is a bare
 * deployment-domain visit (demo fallback, no explicit slug) — the
 * generic portal door is NOT the demo school's door. */
interface LoginBranding {
  name: string
  shortName: string
  tagline: string | null
  affiliation: string | null
  academicYear: string | null
  logoUrl: string | null
  primaryColor: string | null
}

const NEUTRAL_BRANDING: LoginBranding = {
  name: 'Scholario',
  shortName: 'Scholario',
  tagline: null,
  affiliation: null,
  academicYear: null,
  logoUrl: null,
  primaryColor: null,
}

/* The branding fetch carries the school's own identity fields
 * (shortName / tagline / affiliation / logoUrl / themeColor) plus the
 * server's tenant-resolution marker `resolvedVia`. A ?slug= is
 * forwarded when present; otherwise the Host header resolves the
 * tenant exactly as for the public website. */
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
    resolvedVia?: string
  }
}

/** CSS custom properties for this surface: `--school-primary` drives the
 *  sign-in button and input focus accents; `--ring` tints the keyboard
 *  focus ring. Both resolve to the school's color when configured and
 *  to the Scholario neutral (#0f766e) otherwise. */
function loginBrandStyle(primaryColor: string | null): CSSProperties {
  const primary =
    typeof primaryColor === 'string' && isValidHexColor(primaryColor)
      ? primaryColor.trim()
      : '#0f766e'
  return {
    '--school-primary': primary,
    '--ring': primary,
  } as React.CSSProperties
}

function useLoginSchoolBranding(): LoginBranding {
  const [branding, setBranding] = useState<LoginBranding>(NEUTRAL_BRANDING)
  useEffect(() => {
    let alive = true
    // Forward the URL's ?slug= / ?tenant= when present (sandbox
    // per-tenant links / explicit school deep-links): the login must
    // brand itself as the school whose site the visitor came from.
    // Production domains carry no slug; the Host header resolves there.
    const params = new URLSearchParams(window.location.search)
    const slug = params.get('slug') ?? params.get('tenant')
    const url = slug
      ? `/api/schools/public?slug=${encodeURIComponent(slug)}`
      : '/api/schools/public'
    void fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: PublicSchoolBrandingBody | null) => {
        const d = body?.success ? body.data : undefined
        if (!alive || !d?.name) return
        // PRODUCT-DIRECTION RESET — with the demo fallback retired,
        // resolution succeeds ONLY for the school that actually owns
        // this domain/link; a bare platform-domain visit never reaches
        // this code path with a school payload.
        const name = d.name
        setBranding({
          name,
          // Server identity.shortName with a neutral name-split fallback.
          shortName:
            (typeof d.shortName === 'string' && d.shortName.trim()) ||
            name.split(' ').slice(0, 2).join(' '),
          // Tagline ONLY when the school actually configured one — the
          // pane never invents one.
          tagline:
            typeof d.tagline === 'string' && d.tagline.trim()
              ? d.tagline.trim()
              : null,
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
  // AUTH GATE — structured failure model (src/lib/auth-failure.ts):
  // server rejections carry a safe message + stable code + requestId;
  // transport failures classify as AUTH_NETWORK_UNAVAILABLE. Raw
  // browser fetch errors ("Load failed") are never displayed.
  const [failure, setFailure] = useState<AuthFailure | null>(null)

  const handleLogin = async () => {
    // 1) Validate BEFORE any network work — a doomed request must never
    //    fire before the user sees the empty-fields error.
    if (!email.trim() || !password) {
      setFailure(new AuthFailure('Please enter your email and password.', 'AUTH_INPUT_MISSING'))
      return
    }
    // Duplicate-submission guard: the button is disabled while submitting,
    // but a second entry point (Enter key on mobile keyboards) must not
    // fire a parallel request.
    if (submitting) return

    setSubmitting(true)
    setFailure(null)
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
        code?: string
        requestId?: string
        data?: {
          id?: string
          email?: string
          name?: string
          role?: string
          sessionToken?: string
          subscriptionStatus?: string
        }
      } | null

      if (!res.ok || !payload?.ok) {
        // Server-rejected: surface the safe envelope message + its
        // stable code + correlation id (opaque — safe to display).
        throw authFailureFromEnvelope(
          res.status,
          payload,
          'Unable to complete sign in. Please try again.',
        )
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

      // FINAL-ACCEPTANCE Phase 10 — subscription-locked account: hydrate
      // the server identity BEFORE the panel mounts so the lock screen
      // renders with the full profile (guardian, contact, enrollment
      // context) and no module surface ever fires — their APIs reject
      // LOCKED accounts server-side (403 SUBSCRIPTION_REQUIRED) anyway.
      if (payload.data?.subscriptionStatus && payload.data.subscriptionStatus !== 'ACTIVE') {
        await useCurrentUser.getState().refresh().catch(() => undefined)
      }

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
      //    never a silent bounce back to the same screen. A non-AuthFailure
      //    throwable here is a TRANSPORT failure (fetch rejected before any
      //    response existed: offline, DNS, proxy drop, browser-blocked
      //    request) — classified, never shown as the raw browser string
      //    ("Load failed" / "Failed to fetch").
      endAuth()
      setPhase('form')
      setSubmitting(false)
      setFailure(classifyAuthFetchError(e))
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
                RightPane carries its own compact mobile brand row. */}
            <LeftPane school={school} onBackToWebsite={onBackToWebsite} />

            {/* RIGHT PANE: form */}
            <RightPane
              school={school}
              email={email}
              password={password}
              submitting={submitting}
              failure={failure}
              onEmailChange={(v) => {
                setEmail(v)
                setFailure(null)
              }}
              onPasswordChange={(v) => {
                setPassword(v)
                setFailure(null)
              }}
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
  INFO: { border: 'border-l-teal-600', icon: Info, iconClass: 'text-teal-600' },
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
            className={`rounded-lg border border-slate-200 border-l-4 bg-white px-3.5 py-3 ${style.border}`}
          >
            <div className="flex items-start gap-2.5">
              <LevelIcon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{a.body}</p>
              </div>
            </div>
          </div>
        )
      })}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Left pane — quiet solid brand wash (logo, name, tagline)           */
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
      className="relative hidden md:flex md:w-[45%] flex-col p-10 lg:p-14"
      style={{
        // Solid quiet brand treatment — the school's primary color at a
        // low tint over white (never an animated color wash).
        backgroundColor: 'color-mix(in srgb, var(--school-primary, #0f766e) 7%, white)',
      }}
    >
      {/* Top — back to the website */}
      <button
        type="button"
        onClick={onBackToWebsite}
        className="rounded-md px-1.5 -mx-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-colors focus-ring self-start"
      >
        ← Back to Website
      </button>

      {/* Center — logo, school name, tagline, factual line */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="my-auto py-10 flex flex-col items-start"
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {school.logoUrl ? (
            <Image
              src={school.logoUrl}
              alt={`${school.name} logo`}
              width={72}
              height={72}
              className="h-12 w-12 object-contain"
              priority
            />
          ) : (
            <Image
              src="/logo.svg"
              alt="Scholario logo"
              width={72}
              height={72}
              className="h-12 w-12"
              priority
            />
          )}
        </div>
        <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-slate-900">
          {school.shortName}
        </h1>
        {school.affiliation ? (
          <p className="mt-2 text-sm text-slate-600">{school.affiliation}</p>
        ) : null}
        <span
          aria-hidden="true"
          className="mt-6 block h-1 w-12 rounded-full"
          style={{ backgroundColor: 'var(--school-primary, #0f766e)' }}
        />
        {school.tagline ? (
          <p className="mt-6 text-base text-slate-700 max-w-sm leading-relaxed">
            {school.tagline}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-slate-500 max-w-sm leading-relaxed">
          Your school workspace, secured by Scholario.
        </p>
      </motion.div>

      {/* Bottom — session year */}
      <div className="text-xs text-slate-400 tracking-wider uppercase font-medium">
        {school.academicYear ? <span>Session {school.academicYear}</span> : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Right pane — login form                                            */
/* ------------------------------------------------------------------ */

interface RightPaneProps {
  school: LoginBranding
  email: string
  password: string
  submitting: boolean
  failure: AuthFailure | null
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
  failure,
  onEmailChange,
  onPasswordChange,
  onLogin,
  onForgotPassword,
}: RightPaneProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  return (
    <section className="relative z-20 flex w-full flex-1 flex-col justify-center overflow-y-auto bg-slate-50 p-4 sm:p-6 md:w-[55%] md:p-10 lg:p-14">
      <div className="w-full max-w-md mx-auto">
        {/* Mobile-only brand row (school logo when configured) */}
        <div className="md:hidden flex items-center justify-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {school.logoUrl ? (
              <Image
                src={school.logoUrl}
                alt={`${school.name} logo`}
                width={40}
                height={40}
                className="h-9 w-9 rounded-lg object-contain"
              />
            ) : (
              <Image
                src="/logo.svg"
                alt="Scholario logo"
                width={40}
                height={40}
                className="w-9 h-9"
              />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-slate-900 truncate">{school.shortName}</h1>
            {school.affiliation ? (
              <p className="text-[11px] text-slate-500 truncate">{school.affiliation}</p>
            ) : null}
          </div>
        </div>

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm"
        >
          <h2 className="font-display text-2xl lg:text-3xl font-semibold mb-1.5 text-slate-900">
            Student &amp; Staff Login
          </h2>
          <p className="text-sm text-slate-500 mb-7">
            Sign in to access your dashboard.
          </p>

          {/* PHASE 6 — platform announcements (additive, read-only; see
              PlatformAnnouncementBanner above). Renders nothing when the
              platform has no active notices. */}
          <PlatformAnnouncementBanner />

          {/* Error message — rendered ABOVE the fields so it is always
              visible without scrolling, on every viewport. Structured model:
              safe message + machine code + correlation ref (support can
              quote the ref to find the exact server log/audit rows). */}
          {failure && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5"
            >
              <p className="text-sm font-medium text-red-700">{failure.message}</p>
              {authFailureRefLine(failure) && (
                <p className="mt-1 font-mono text-[11px] leading-none text-red-600/70">
                  {authFailureRefLine(failure)}
                </p>
              )}
            </div>
          )}

          {/* Form */}
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              onLogin()
            }}
          >
            {/* Institutional Email or ID */}
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-semibold text-slate-700 mb-2 transition-colors focus-within:text-slate-900"
              >
                Institutional Email or ID
              </label>
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
                className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[var(--school-primary)] focus:ring-1 focus:ring-[var(--school-primary)]"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-slate-700 mb-2 transition-colors focus-within:text-slate-900"
              >
                Password
              </label>
              <div className="relative flex items-center">
                <input
                  id="password"
                  name="password"
                  type={passwordVisible ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  placeholder="Enter your password"
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[var(--school-primary)] focus:ring-1 focus:ring-[var(--school-primary)]"
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((v) => !v)}
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={passwordVisible}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700 transition-colors focus-ring"
                >
                  {passwordVisible ? (
                    <EyeOff className="h-5 w-5" aria-hidden />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot password */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onForgotPassword}
                className="rounded-md px-1 -mx-1 py-0.5 text-sm font-medium school-brand-text hover:underline transition-colors focus-ring"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit — solid school primary */}
            <button
              type="submit"
              disabled={submitting}
              style={{ backgroundColor: 'var(--school-primary, #0f766e)' }}
              className="group w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-base font-semibold text-white transition-all hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed focus-ring"
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
            </button>
          </form>
        </motion.div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Forgot password modal                                              */
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
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
        className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xl"
      >
        {sent ? (
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full school-brand-soft flex items-center justify-center">
              <svg className="w-6 h-6 school-brand-text" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-display text-xl font-bold text-slate-900">Contact your administrator</h3>
            <p className="text-sm text-slate-600">
              {/* PIH-4c — no reset-email backend exists; the modal tells the
                  user the truth instead of promising a link that never comes. */}
              Password resets are handled by your school administrator — please contact them to reset the password for <span className="font-semibold text-slate-900">{email}</span>.
            </p>
            <button
              onClick={onClose}
              style={{ backgroundColor: 'var(--school-primary, #0f766e)' }}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 focus-ring"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900">Forgot your password?</h3>
              <p className="text-sm text-slate-600 mt-1">
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
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[var(--school-primary)] focus:ring-1 focus:ring-[var(--school-primary)]"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors focus-ring"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: 'var(--school-primary, #0f766e)' }}
                  className="flex-1 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 focus-ring"
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
