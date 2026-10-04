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
// Distinct from the school login by design — no school branding, no
// demo chips for school roles.
//
// DESIGN: Scholario production design system — LIGHT always (white
// page, white cards, subtle slate borders, teal brand accent, dark
// readable typography). No glows/gradients/glassmorphism.
// ============================================================

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Cloud, Lock, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePlatformToken } from '@/lib/platform-session-token'
import { AuthFailure, authFailureRefLine, classifyAuthFetchError } from '@/lib/auth-failure'
import { toast } from 'sonner'

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
                <label htmlFor="pf-password" className="text-xs font-semibold text-slate-700">
                  Password
                </label>
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
