'use client'

// ============================================================
// /platform/reset-password — the emailed reset link's landing page
// ------------------------------------------------------------
// ACCOUNT-RECOVERY (docs/PLATFORM_ACCOUNT_RECOVERY.md §1): an
// ANONYMOUS page driven by ?token=<64-hex> from the reset email.
// It posts { token, newPassword } to
// POST /api/platform/auth/reset-password, which:
//   · consumes the token single-use (hash lookup — failures are
//     uniformly "invalid or expired", no oracle which),
//   · sets the new scrypt password,
//   · revokes EVERY live platform session for the account
//     (a stolen pre-reset session dies immediately),
//   · audits platform.password_reset.completed.
// Success → the user signs in fresh with the new password.
// ============================================================

import React, { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Cloud, AlertTriangle, CheckCircle2, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validShape = /^[A-Za-z0-9!@#$%^&*()_\-+=.]{8,128}$/.test(newPassword) &&
    /[A-Za-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword)

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
      const res = await fetch('/api/platform/auth/reset-password', {
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

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 border border-teal-200">
          <CheckCircle2 className="h-6 w-6 text-teal-600" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h1 className="font-display text-xl font-bold text-slate-900">Password updated</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your new password is active and every previously active platform session was
            signed out for your security.
          </p>
        </div>
        <a
          href="/platform/login"
          className="inline-flex items-center justify-center w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors focus-ring"
        >
          Sign in with your new password
        </a>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-sm"
    >
      <div>
        <h1 className="font-display text-xl font-bold text-slate-900">Choose a new password</h1>
        <p className="text-xs text-slate-500 mt-1">
          This link is single-use and expires 30 minutes after it was requested.
        </p>
      </div>

      {!token && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>This reset link is invalid or has expired. Request a new link.</span>
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
          {/invalid or has expired/.test(error) && (
            <a
              href="/platform/forgot-password"
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
        disabled={busy || !token || !newPassword || !confirm || !validShape}
        className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Saving…' : 'Set new password'}
      </Button>

      <p className="text-[10px] text-slate-400 text-center leading-snug">
        Setting a new password signs out every active session for this account.
      </p>
    </form>
  )
}

export default function PlatformResetPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-teal-100 selection:text-teal-900 flex flex-col">
      <header className="relative z-10 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center gap-3">
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
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          aria-labelledby="reset-heading"
          className="w-full max-w-md"
        >
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center text-sm text-slate-400">
                Loading…
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-slate-200 bg-white py-5 text-center text-[11px] text-slate-400">
        <p>© {new Date().getFullYear()} Scholario Platform · Restricted access · Password resets are audited</p>
      </footer>
    </div>
  )
}
