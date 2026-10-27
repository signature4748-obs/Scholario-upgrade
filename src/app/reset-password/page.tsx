'use client'

// ============================================================
// /reset-password — SCHOOL-PLANE "Set New Password" (anonymous)
// ------------------------------------------------------------
// SCHOOL-PLANE ACCOUNT RECOVERY (docs/SCHOOL_ACCOUNT_RECOVERY.md):
// the landing page of the emailed single-use reset link. It submits
// { token, newPassword } to POST /api/auth/reset-password, which
// atomically consumes the token (sha256 lookup, single-use, 30-minute
// expiry), sets the new scrypt hash, revokes every live session and
// clears the per-account sign-in lockout.
//
// Every invalid/used/expired/malformed link renders the SAME generic
// helpful state (the API has no oracle — this page must not create
// one) with a direct way to request a fresh link. The `from` param —
// stamped into the emailed link from the user's OWN school slug — is
// re-validated against a strict allow-regex before it is used as the
// post-success sign-in target (no open redirect).
// ============================================================

import React, { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { GraduationCap, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Strict allow-list for the return door: /login or /s/<slug>/login. */
function safeSignInPath(raw: string | null): string {
  if (raw && /^\/s\/[a-zA-Z0-9-]+\/login$/.test(raw)) return raw
  return '/login'
}

function ResetPasswordInner() {
  const params = useSearchParams()
  const token = (params.get('token') ?? '').trim()
  const signInPath = safeSignInPath(params.get('from'))

  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy || !token) return
    if (newPassword !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const body = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'This reset link is invalid or has expired.')
        return
      }
      setDone(true)
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
          aria-labelledby="reset-heading"
          className="w-full max-w-md"
        >
          {done ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 border border-teal-200">
                <CheckCircle2 className="h-6 w-6 text-teal-600" aria-hidden="true" />
              </span>
              <div className="space-y-2">
                <h1 id="reset-heading" className="font-display text-xl font-bold text-slate-900">
                  Password updated
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Your new password is active and every previously active session was signed
                  out for your security.
                </p>
              </div>
              <a
                href={signInPath}
                className="inline-flex items-center justify-center w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors focus-ring"
              >
                Sign in with your new password
              </a>
            </div>
          ) : (
            <form
              method="POST"
              onSubmit={submit}
              className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm"
            >
              <div>
                <h1 id="reset-heading" className="font-display text-xl font-bold text-slate-900">
                  Set a new password
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  This link is single-use and expires 30 minutes after it was requested.
                </p>
              </div>

              {!token && (
                <div
                  role="alert"
                  className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
                >
                  <span className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    This reset link is invalid or has expired. Request a new link.
                  </span>
                  <a href="/forgot-password" className="text-xs font-semibold text-teal-700 hover:text-teal-800 ml-6">
                    Request a new reset link →
                  </a>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
                >
                  <span className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    {error}
                  </span>
                  {/invalid or has expired/i.test(error) && (
                    <a
                      href="/forgot-password"
                      className="text-xs font-semibold text-teal-700 hover:text-teal-800 ml-6"
                    >
                      Request a new reset link →
                    </a>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="rp-new" className="text-xs font-semibold text-slate-700">
                  New password
                </label>
                <Input
                  id="rp-new"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11"
                />
                <p className="text-[10px] text-slate-400">
                  At least 8 characters, including a letter and a number.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rp-confirm" className="text-xs font-semibold text-slate-700">
                  Confirm new password
                </label>
                <Input
                  id="rp-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-teal-500/40 h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={busy || !token}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                {busy ? 'Updating…' : 'Set new password'}
              </Button>
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

export default function SchoolResetPasswordPage() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  )
}
