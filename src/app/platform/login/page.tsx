'use client'

// ============================================================
// /platform/login — the ONLY platform entry point
// ------------------------------------------------------------
// PRODUCT-DIRECTION RESET (Part 1) — platform admin sign-in is
// EMAIL + PASSWORD for now. The mandatory TOTP challenge is
// temporarily stood down through the single MFA policy switch
// (src/lib/platform/mfa-config.ts); the full TOTP architecture is
// preserved behind that flag and proper MFA will be reintroduced
// after the core SaaS workflow is complete. No TOTP UI, no
// enrollment/recovery messaging, no dead-end authenticator
// requirement on this surface.
//
// ACCOUNT-RECOVERY additions (docs/PLATFORM_ACCOUNT_RECOVERY.md):
//   · "Forgot password?" → /platform/forgot-password (self-service
//     email reset — anti-enumeration, generic confirmation).
//   · "Continue with Google" → /api/platform/auth/google/start —
//     rendered ONLY when the deployment has Google OAuth configured
//     (honest capability probe; no dead-end buttons). Resolves to
//     the SAME PlatformAdmin account as password login (explicit
//     googleSub link — never an auto-created account).
//
// Distinct from the school login by design — no school branding, no
// demo chips for school roles, and NO Google button (school-side
// authentication is unchanged by this feature).
//
// DESIGN: Scholario production design system — LIGHT always (white
// page, white cards, subtle slate borders, teal brand accent, dark
// readable typography). No glows/gradients/glassmorphism.
// ============================================================

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Cloud, Lock, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePlatformToken } from '@/lib/platform-session-token'
import { AuthFailure, authFailureRefLine, classifyAuthFetchError } from '@/lib/auth-failure'
import { toast } from 'sonner'

/** Safe messages for Google-flow redirect error codes (callback → login). */
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  GOOGLE_NOT_LINKED:
    'No platform admin account is linked to this Google account. Sign in with your password first, then link it from Settings → Account.',
  GOOGLE_SIGNIN_FAILED: 'Google sign-in failed. Please try again.',
  GOOGLE_STATE_INVALID: 'That sign-in request expired or was invalid. Please try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  GOOGLE_NOT_CONFIGURED: 'Google sign-in is not configured on this deployment.',
}

export default function PlatformLoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // AUTH GATE — structured failure model (src/lib/auth-failure.ts):
  // server rejections carry a safe message + stable code + requestId;
  // transport failures classify as AUTH_NETWORK_UNAVAILABLE — never the
  // raw browser string ("Load failed").
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  // ACCOUNT-RECOVERY — Google OAuth availability (honest probe; the
  // button never renders when the deployment is unconfigured) and
  // redirect-carried errors from the Google callback.
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)

  useEffect(() => {
    // Honest capability probe: is Google sign-in configured?
    fetch('/api/platform/auth/google/status')
      .then((r) => r.json() as Promise<{ ok: boolean; data?: { enabled?: boolean } }>)
      .then((b) => setGoogleEnabled(Boolean(b.ok && b.data?.enabled)))
      .catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    const code = searchParams.get('error')
    if (code) setGoogleError(GOOGLE_ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.')
  }, [searchParams])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const res = await fetch('/api/platform/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = (await res.json()) as {
        ok: boolean
        data?: { sessionToken?: string }
        error?: string
        code?: string
        requestId?: string
      }
      if (!res.ok || !body.ok) {
        // Server-rejected: safe envelope message + stable code +
        // correlation ref (opaque — safe to display for support).
        setFailure(
          new AuthFailure(
            body.error ?? 'Sign-in failed',
            body.code ?? 'AUTH_REQUIRED',
            body.requestId,
          ),
        )
        return
      }
      // Dev-preview bearer persistence (iframe cookie block); in
      // production the HttpOnly cookie is the only transport.
      if (body.data?.sessionToken) savePlatformToken(body.data.sessionToken)
      toast.success('Signed in to the control plane')
      const next = searchParams.get('next')
      router.replace(next && next.startsWith('/platform') ? next : '/platform')
    } catch {
      // Transport failure (fetch rejected before any response):
      // classified — never the raw browser string ("Load failed").
      setFailure(classifyAuthFetchError(new Error('transport')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-teal-100 selection:text-teal-900 flex flex-col">
      {/* Header */}
      <header className="relative z-10 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm">
              <Cloud className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display font-extrabold text-lg tracking-tight text-slate-900 leading-none">
                SCHOLARIO<span className="text-teal-600"> · Control Plane</span>
              </p>
              <p className="text-[10px] font-semibold tracking-[0.22em] text-slate-400 uppercase mt-1">
                Platform Operations
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-500 border border-transparent select-none">
            Platform access is restricted
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-5xl min-w-0 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: what the control plane is for */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="hidden lg:block space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Restricted platform operations
            </div>
            <div className="space-y-4">
              <h1 className="font-display text-4xl xl:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1] text-balance">
                Operate every school on the platform from one place.
              </h1>
              <p className="text-slate-600 text-base leading-relaxed max-w-lg">
                Onboard new schools, activate and suspend tenants, manage plans and
                modules, configure domains, open audited support sessions, and review
                the platform trail.
              </p>
            </div>
            <ul className="space-y-3.5">
              {[
                { icon: ShieldCheck, text: 'One platform session per admin — every attempt is audited' },
                { icon: Lock, text: 'Separate credential space — school accounts can never sign in here' },
                { icon: Cloud, text: 'One deployment, one database, many school tenants' },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 h-6 w-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <item.icon className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Right: the form */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            aria-labelledby="platform-login-heading"
          >
            <form
              method="POST"
              onSubmit={submit}
              className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm"
            >
              <div>
                <h2 id="platform-login-heading" className="font-display text-xl font-bold text-slate-900">
                  Platform sign-in
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Platform administrators only — school staff sign in through their school
                  website&rsquo;s login.
                </p>
              </div>

              {failure && (
                <div
                  role="alert"
                  className={`flex flex-col gap-1 rounded-xl border p-3 text-sm ${
                    failure.code === 'RATE_LIMITED' || failure.code === 'ACCOUNT_LOCKED'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-red-200 bg-red-50 text-red-600'
                  }`}
                >
                  <span className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    {failure.message}
                  </span>
                  {authFailureRefLine(failure) && (
                    <span className="font-mono text-[11px] leading-none opacity-70">
                      {authFailureRefLine(failure)}
                    </span>
                  )}
                </div>
              )}

              {googleError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{googleError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="pf-email" className="text-xs font-semibold text-slate-700">
                  Email
                </label>
                <Input
                  id="pf-email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@scholario.cloud"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="pf-password" className="text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  {/* ACCOUNT-RECOVERY — self-service password reset entry */}
                  <a
                    href="/platform/forgot-password"
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 focus-ring rounded"
                  >
                    Forgot password?
                  </a>
                </div>
                <Input
                  id="pf-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={busy || !email || !password}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Verifying…' : 'Sign in to control plane'}
              </Button>

              {/* ACCOUNT-RECOVERY — OPTIONAL Google sign-in. Rendered only
                  when configured (honest probe); resolves to the SAME
                  admin account via the explicit identity link. */}
              {googleEnabled && (
                <>
                  <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-slate-400">
                      or
                    </span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  <a
                    href="/api/platform/auth/google/start"
                    className="flex items-center justify-center gap-2.5 w-full h-11 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors focus-ring"
                  >
                    {/* Google "G" mark — inline SVG, no external asset */}
                    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden="true" style={{ height: 18, width: 18 }}>
                      <path
                        fill="#4285F4"
                        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                      />
                    </svg>
                    Continue with Google
                  </a>
                </>
              )}

              <p className="text-[10px] text-slate-400 text-center leading-snug">
                Severe rate limits apply: 5 failed attempts per account lock the account for 15
                minutes. Every attempt is audited.
              </p>
            </form>
          </motion.section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-slate-200 bg-white py-5 text-center text-[11px] text-slate-400">
        <p>© {new Date().getFullYear()} Scholario Platform · Restricted access · All sign-ins are audited</p>
      </footer>
    </div>
  )
}
