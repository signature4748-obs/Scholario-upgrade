'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Eye, EyeOff, Info, AlertTriangle } from 'lucide-react'
import { useAuth, type Role } from '@/lib/store/auth-store'
import { saveSessionToken } from '@/lib/auth-session-token'
import { school } from '@/lib/mock/school'
import { LoadingPhase } from './loading-phase'
import { credentials, type CredentialCard } from './data'

/* ------------------------------------------------------------------ */
/*  LoginPage — split-pane design adapted from the "Spacer" reference  */
/*  • Left pane: animated emerald→teal gradient with school logo,     */
/*    name, tagline, cloud SVG divider on the right edge              */
/*  • Right pane: clean white form panel with underline inputs,        */
/*    one-tap demo account chips, Sign In + Forgot Password only       */
/*    (NO sign-up, NO terms checkbox)                                  */
/* ------------------------------------------------------------------ */

export function LoginPage({ onBackToWebsite }: { onBackToWebsite?: () => void }) {
  const { startAuth, endAuth, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [phase, setPhase] = useState<'form' | 'loading'>('form')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fillCredential = (cred: CredentialCard) => {
    setSelectedRole(cred.role)
    setEmail(cred.email)
    setPassword(cred.password)
    setError('')
  }

  const handleLogin = async (roleOverride?: Role) => {
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
          : roleOverride ?? selectedRole ?? 'principal'

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
    <div className="relative h-[100dvh] w-full overflow-hidden bg-white font-sans">
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
            <LeftPane onBackToWebsite={onBackToWebsite} />

            {/* RIGHT PANE: form */}
            <RightPane
              email={email}
              password={password}
              selectedRole={selectedRole}
              submitting={submitting}
              error={error}
              onEmailChange={(v) => { setEmail(v); setError('') }}
              onPasswordChange={(v) => { setPassword(v); setError('') }}
              onSelectCredential={fillCredential}
              onLogin={() => handleLogin()}
              onForgotPassword={() => setForgotOpen(true)}
            />
          </motion.main>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <LoadingPhase selectedRole={selectedRole} />
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

function LeftPane({ onBackToWebsite }: { onBackToWebsite?: () => void }) {
  return (
    <section
      className="left-pane relative hidden md:flex md:w-[45%] p-8 md:p-12 flex-col items-center justify-center text-center text-white overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, #064e3b 0%, #0d9488 50%, #065f46 100%)',
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
          <Image
            src="/logo.svg"
            alt={`${school.name} logo`}
            width={72}
            height={72}
            className="w-16 h-16"
            priority
          />
        </div>
        <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-white">
          {school.shortName}
        </h1>
        <p className="text-[11px] font-semibold text-emerald-100 tracking-[0.25em] uppercase mt-2">
          Powered by Scholario
        </p>
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
        <span>CBSE · Estd. {school.established}</span>
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
  email: string
  password: string
  selectedRole: Role | null
  submitting: boolean
  error: string
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onSelectCredential: (cred: CredentialCard) => void
  onLogin: () => void
  onForgotPassword: () => void
}

function RightPane({
  email,
  password,
  selectedRole,
  submitting,
  error,
  onEmailChange,
  onPasswordChange,
  onSelectCredential,
  onLogin,
  onForgotPassword,
}: RightPaneProps) {
  const [passwordVisible, setPasswordVisible] = useState(false)
  return (
    <section className="relative z-20 flex w-full flex-1 flex-col justify-center overflow-y-auto bg-white p-6 sm:p-8 md:w-[55%] md:p-12 lg:p-16">
      <div className="w-full max-w-md mx-auto">
        {/* Mobile-only logo */}
        <div className="md:hidden flex flex-col items-center mb-8">
          <div className="bg-white rounded-2xl p-3 mb-3 w-16 h-16 flex items-center justify-center shadow-lg shadow-emerald-500/20 border border-emerald-500/20">
            <Image
              src="/logo.svg"
              alt="School logo"
              width={40}
              height={40}
              className="w-10 h-10"
            />
          </div>
          <h1 className="font-display text-xl font-bold text-foreground">{school.shortName}</h1>
          <p className="text-[11px] font-semibold text-emerald-600 tracking-[0.25em] uppercase mt-1">
            Powered by Scholario
          </p>
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
              <span className="absolute right-0 input-check-icon peer-focus:scale-110 text-emerald-600">
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
              className="rounded-md px-1 -mx-1 py-0.5 text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline transition-colors focus-ring"
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
              className="group w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-base font-semibold rounded-full shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-ring"
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

        {/* One-tap demo accounts — BELOW the primary form so the
            institutional sign-in flow leads and the keyboard tab order
            runs email → password → forgot → Sign In → demo chips.
            (dev/preview only — gated out of production builds via
            login-page/data.tsx; school roles only, never super-admin) */}
        {credentials.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8"
          >
            <p className="text-xs font-medium text-muted-foreground mb-2.5 uppercase tracking-wide">
              Quick demo access — one tap to fill
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {credentials.map((cred) => {
                const active = selectedRole === cred.role
                return (
                  <motion.button
                    key={cred.role}
                    type="button"
                    onClick={() => onSelectCredential(cred)}
                    aria-pressed={active}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className={`group relative flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-all focus-ring ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 shadow-md shadow-emerald-500/10'
                        : 'border-border bg-card hover:border-emerald-500/40 hover:bg-emerald-50/30'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${cred.gradient} text-white shadow-md`}
                    >
                      {cred.icon}
                    </div>
                    <p className="text-[11px] font-semibold text-foreground">{cred.title}</p>
                  </motion.button>
                )
              })}
            </div>
            <p className="text-center text-[11px] text-muted-foreground mt-3">
              Demo accounts · development preview only
            </p>
          </motion.div>
        )}
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
          background: linear-gradient(90deg, #10b981, #0d9488);
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
           keyboard focus additionally draws the high-contrast ring. */
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
            <h3 className="font-display text-xl font-bold text-foreground">Check your inbox</h3>
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="font-semibold text-foreground">{email}</span>, you&apos;ll receive a password reset link shortly.
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
                Enter your registered email and we&apos;ll send you a reset link.
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
                placeholder="you@greenwood.edu.in"
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
                  Send reset link
                </button>
              </div>
            </form>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
