'use client'

// ============================================================
// /forgot-password — SCHOOL-PLANE self-service password recovery
// ------------------------------------------------------------
// SCHOOL-PLANE ACCOUNT RECOVERY (docs/SCHOOL_ACCOUNT_RECOVERY.md):
// an ANONYMOUS page in the same visual language as the Student &
// Staff login door. It submits an email to
// POST /api/auth/forgot-password, which ALWAYS answers with the
// same generic confirmation (anti-enumeration: whether or not the
// address belongs to a school account is never revealed — not by
// status, body, or timing). This page therefore renders the SAME
// confirmation in every case and links back to the sign-in door.
//
// The Student & Staff login page links here with the address the
// user already typed (?email=…) and the door it came from
// (?from=/s/<slug>/login or /login) — both are convenience
// prefill only; the email stays editable and `from` is re-validated
// against a strict allow-regex before it is used as a link target.
// ============================================================

import React, { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { GraduationCap, MailCheck, AlertTriangle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Strict allow-list for the return door: /login, /login?tenant=<slug> or /s/<slug>/login. */
function safeSignInPath(raw: string | null): string {
  if (raw && /^\/s\/[a-zA-Z0-9-]+\/login$/.test(raw)) return raw
  if (raw && /^\/login\?tenant=[a-zA-Z0-9-]+$/.test(raw)) return raw
  return '/login'
}

function ForgotPasswordInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState(() => (params.get('email') ?? '').slice(0, 254))
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backPath = safeSignInPath(params.get('from'))

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await res.json()) as { ok: boolean; error?: string; code?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Request failed. Please try again.')
        return
      }
      // Generic confirmation — identical for known and unknown addresses.
      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-teal-100 selection:text-teal-900 flex flex-col">
      <header className="relative z-10 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm">
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="font-display font-extrabold text-lg tracking-tight text-slate-900 leading-none">
              SCHOLARIO<span className="text-teal-600"> · School Workspace</span>
            </p>
            <p className="text-[10px] font-semibold tracking-[0.22em] text-slate-400 uppercase mt-1">
              Student &amp; Staff Access
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          aria-labelledby="forgot-heading"
          className="w-full max-w-md"
        >
          {sent ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 border border-teal-200">
                <MailCheck className="h-6 w-6 text-teal-600" aria-hidden="true" />
              </span>
              <div className="space-y-2">
                <h1 id="forgot-heading" className="font-display text-xl font-bold text-slate-900">
                  Check your email
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  If that address belongs to a school account, a password reset link has been
                  sent. The link expires in 30 minutes and can be used only once.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  For your security, requesting a new link invalidates any previous one, and
                  nothing is revealed about which addresses have accounts.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full h-11 border-slate-200 text-slate-700 hover:bg-slate-50 focus-ring"
                onClick={() => router.push(backPath)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to sign in
              </Button>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm"
            >
              <div>
                <h1 id="forgot-heading" className="font-display text-xl font-bold text-slate-900">
                  Reset your password
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your school account email address and we will send a single-use reset
                  link.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="fp-email" className="text-xs font-semibold text-slate-700">
                  Email
                </label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@school.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={busy || !email}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>

              <button
                type="button"
                onClick={() => router.push(backPath)}
                className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 focus-ring rounded py-1"
              >
                Back to sign in
              </button>
            </form>
          )}
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-slate-200 bg-white py-5 text-center text-[11px] text-slate-400">
        <p>© {new Date().getFullYear()} Scholario · All reset requests are audited</p>
      </footer>
    </div>
  )
}

export default function SchoolForgotPasswordPage() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  )
}
