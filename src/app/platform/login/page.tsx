'use client'

// ============================================================
// /platform/login — the ONLY platform entry point (PHASE 6)
// ------------------------------------------------------------
// Full MFA sign-in: email + password + TOTP. Distinct from the school
// login by design — no school branding, no Super Admin option, no
// demo chips for school roles. The seeded demo platform admins get a
// DEV-PREVIEW "demo authenticator" widget (computes the current TOTP
// code server-side; production renders nothing here and admins use
// real authenticator apps).
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Cloud, ShieldCheck, KeyRound, Lock, AlertTriangle, ArrowLeft, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { savePlatformToken } from '@/lib/platform-session-token'
import { toast } from 'sonner'

interface LoginError {
  message: string
  code: string
  retryAfter?: number
}

function DemoAuthenticator({ email, onCode }: { email: string; onCode: (code: string) => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCode = useCallback(
    async (quiet: boolean) => {
      const clean = email.trim().toLowerCase()
      if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        if (!quiet) setNote('Enter your email above first')
        return
      }
      try {
        const res = await fetch('/api/platform/auth/demo-code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: clean }),
        })
        const body = (await res.json()) as {
          ok: boolean
          data?: { code: string; secondsRemaining: number }
          error?: string
        }
        if (body.ok && body.data) {
          setCode(body.data.code)
          setSeconds(body.data.secondsRemaining)
          setNote(null)
          onCode(body.data.code)
        } else {
          setCode(null)
          setNote(body.error ?? 'No demo authenticator for this account')
        }
      } catch {
        setNote('Demo authenticator unavailable')
      }
    },
    [email, onCode],
  )

  // Auto-refresh as the 30s step rotates.
  useEffect(() => {
    if (seconds <= 0) return
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          void fetchCode(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [seconds, fetchCode])

  // Initial fetch whenever the (valid) email changes.
  useEffect(() => {
    const clean = email.trim().toLowerCase()
    if (clean && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      const t = setTimeout(() => void fetchCode(true), 350)
      return () => clearTimeout(t)
    }
  }, [email, fetchCode])

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Demo authenticator
        <span className="font-medium normal-case tracking-normal text-emerald-400/60">
          · dev preview only
        </span>
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        {code ? (
          <p className="font-mono text-xl tracking-[0.3em] text-emerald-200 tabular-nums" aria-live="polite">
            {code}
          </p>
        ) : (
          <p className="text-xs text-zinc-500">{note ?? 'No code yet'}</p>
        )}
        {code && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchCode(false)}
            className="h-8 text-[11px] text-emerald-300 hover:bg-emerald-500/10 focus-ring"
          >
            Refresh
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
        Production admins scan an enrollment QR into a real authenticator app — this widget exists only
        because the sandbox has no external authenticator.
      </p>
    </div>
  )
}

export default function PlatformLoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode: totp }),
      })
      const body = (await res.json()) as {
        ok: boolean
        data?: { sessionToken?: string }
        error?: string
        code?: string
      }
      if (!res.ok || !body.ok) {
        setError({ message: body.error ?? 'Sign-in failed', code: body.code ?? 'AUTH_REQUIRED' })
        return
      }
      // Dev-preview bearer persistence (iframe cookie block); in
      // production the HttpOnly cookie is the only transport.
      if (body.data?.sessionToken) savePlatformToken(body.data.sessionToken)
      toast.success('Signed in to the control plane')
      const next = searchParams.get('next')
      router.replace(next && next.startsWith('/platform') ? next : '/platform')
    } catch {
      setError({ message: 'Network error — please try again', code: 'NETWORK' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/20 selection:text-emerald-200 flex flex-col">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-48 -left-48 h-[38rem] w-[38rem] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[30rem] w-[30rem] rounded-full bg-teal-500/8 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-zinc-800/70">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-zinc-950 shadow-lg shadow-emerald-500/25">
              <Cloud className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-display font-extrabold text-lg tracking-tight text-white leading-none">
                SCHOLARIO<span className="text-emerald-400"> · Control Plane</span>
              </p>
              <p className="text-[10px] font-semibold tracking-[0.22em] text-zinc-500 uppercase mt-1">
                Platform Operations
              </p>
            </div>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 transition-all focus-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Back to school website</span>
            <span className="sm:hidden sr-only">Back to school website</span>
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-5xl min-w-0 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: security posture */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="hidden lg:block space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Restricted platform operations
            </div>
            <div className="space-y-4">
              <h1 className="font-display text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-[1.1] text-balance">
                The platform control plane signs in with a second factor — every time.
              </h1>
              <p className="text-zinc-400 text-base leading-relaxed max-w-lg">
                Provision and suspend schools, configure plans and modules, open audited support
                sessions, and review the platform trail. Destructive actions re-verify your
                authenticator before they run.
              </p>
            </div>
            <ul className="space-y-3.5">
              {[
                { icon: KeyRound, text: 'Mandatory TOTP multi-factor authentication' },
                { icon: Lock, text: 'Separate credential space — school accounts can never sign in here' },
                { icon: ShieldCheck, text: 'Step-up re-verification gates every destructive action' },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                  <span className="mt-0.5 h-6 w-6 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                    <item.icon className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
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
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-xl p-6 sm:p-8 space-y-5 shadow-2xl shadow-black/40"
            >
              <div>
                <h2 id="platform-login-heading" className="font-display text-xl font-bold text-white">
                  Platform sign-in
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Platform administrators only — school staff sign in through their school portal.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${
                    error.code === 'RATE_LIMITED' || error.code === 'ACCOUNT_LOCKED'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error.message}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="pf-email" className="text-xs font-semibold text-zinc-300">
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
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40 h-11"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="pf-password" className="text-xs font-semibold text-zinc-300">
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
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40 h-11"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="pf-totp" className="text-xs font-semibold text-zinc-300">
                  Authenticator code
                </label>
                <InputOTP maxLength={6} value={totp} onChange={setTotp} autoFocus={false}>
                  <InputOTPGroup className="gap-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-9 sm:w-11 rounded-xl border-zinc-800 bg-zinc-950 text-lg font-mono text-zinc-100 border-emerald-500/40 data-[active=true]:border-emerald-400 flex-1 min-w-0"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {process.env.NODE_ENV !== 'production' && (
                <DemoAuthenticator email={email} onCode={(c) => setTotp(c)} />
              )}

              <Button
                type="submit"
                disabled={busy || !email || !password || totp.length !== 6}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold focus-ring"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Verifying…' : 'Sign in to control plane'}
              </Button>

              <p className="text-[10px] text-zinc-600 text-center leading-snug">
                Severe rate limits apply: 5 failed attempts per account lock the account for 15 minutes.
                Every attempt is audited.
              </p>
            </form>
          </motion.section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-zinc-900 py-5 text-center text-[11px] text-zinc-600">
        <p>© {new Date().getFullYear()} Scholario Platform · Restricted access · All sign-ins are audited</p>
      </footer>
    </div>
  )
}
