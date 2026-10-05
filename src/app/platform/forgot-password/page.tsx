'use client'

// ============================================================
// /platform/forgot-password — self-service password recovery
// ------------------------------------------------------------
// ACCOUNT-RECOVERY (docs/PLATFORM_ACCOUNT_RECOVERY.md §1): an
// ANONYMOUS page. It submits an email to
// POST /api/platform/auth/forgot-password, which ALWAYS answers
// with the same generic confirmation (anti-enumeration: whether or
// not the address belongs to a PlatformAdmin is never revealed —
// not by status, body, or timing). This page therefore renders the
// SAME confirmation in every case and links back to the sign-in.
// ============================================================

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Cloud, MailCheck, AlertTriangle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function PlatformForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/auth/forgot-password', {
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
                  If that address belongs to a platform administrator account, a password
                  reset link has been sent. The link expires in 30 minutes and can be used
                  only once.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  For your security, requesting a new link invalidates any previous one, and
                  nothing is revealed about which addresses have accounts.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full h-11 border-slate-200 text-slate-700 hover:bg-slate-50 focus-ring"
                onClick={() => router.push('/platform/login')}
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
                  Enter your platform administrator email address and we will send a
                  single-use reset link.
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
                  placeholder="admin@scholario.cloud"
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
                onClick={() => router.push('/platform/login')}
                className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 focus-ring rounded py-1"
              >
                Back to sign in
              </button>
            </form>
          )}
        </motion.section>
      </main>

      <footer className="relative z-10 border-t border-slate-200 bg-white py-5 text-center text-[11px] text-slate-400">
        <p>© {new Date().getFullYear()} Scholario Platform · Restricted access · All reset requests are audited</p>
      </footer>
    </div>
  )
}
