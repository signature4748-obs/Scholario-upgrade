'use client'

/**
 * /auth/callback — SUPABASE AUTH PHASE 1 landing page for provider email
 * links (signup verification, email-change verification, password
 * recovery). The links redirect here with `?code=…` after the PROVIDER
 * verified the action; this page completes the PKCE code exchange with
 * the SAME browser that initiated it (the verifier is in local storage)
 * and then:
 *
 *   · verification / signup → the identity is verified: show the
 *     hand-off state and send the user to their school login door (the
 *     identity links there on first sign-in, with the ownership proof);
 *   · recovery → render the set-a-new-password form; on success the
 *     provider session is live and the exchange is attempted (the
 *     server applies its FULL invariant set — a school account that had
 *     mustChangePassword etc. behaves exactly like a login).
 *
 * Honest failure states throughout: expired/invalid codes, cross-browser
 * code use (PKCE verifier mismatch), provider unavailability, and the
 * NO_SCHOLARIO_ACCOUNT mapping state all render actionable copy —
 * nothing fakes success.
 */

import React, { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { saveSessionToken } from '@/lib/auth-session-token'

type Phase = 'resolving' | 'verified' | 'recovery' | 'error' | 'done'

function CallbackInner() {
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('resolving')
  const [message, setMessage] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const exchanged = useRef(false)

  const client = getSupabaseBrowserClient()
  const code = params.get('code')
  const errorParam = params.get('error')
  const errorDescription = params.get('error_description')
  const isRecovery = params.get('type') === 'recovery' || params.get('next') === '/auth/callback?recovery'

  const attemptExchange = async (accessToken: string) => {
    if (exchanged.current) return
    exchanged.current = true
    try {
      const res = await fetch('/api/auth/supabase/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      })
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; code?: string; data?: { sessionToken?: string; role?: string } }
        | null
      if (res.ok && payload?.ok) {
        if (payload.data?.sessionToken) saveSessionToken(payload.data.sessionToken)
        const role = (payload.data?.role ?? '').toLowerCase()
        const dest = role === 'principal' || role === 'teacher' || role === 'student' ? `/${role}` : '/'
        window.location.href = dest
        return
      }
      // NO_SCHOLARIO_ACCOUNT / LINK_PASSWORD_REQUIRED on the callback
      // hand-off: the user completes linking at the login door.
      setPhase('verified')
      setMessage(
        'Your email is verified. Continue from your school\u2019s login door to sign in — the account connects on first sign-in.',
      )
    } catch {
      setPhase('error')
      setMessage('Could not reach the server. Close this page and sign in from your school\u2019s login door.')
    }
  }

  useEffect(() => {
    if (!client) {
      setPhase('error')
      setMessage('Provider sign-in is not configured. Use your school\u2019s login door.')
      return
    }
    if (errorParam) {
      setPhase('error')
      setMessage(errorDescription || 'The link is invalid or has expired. Request a new one.')
      return
    }
    if (!code) {
      // No code: a plain visit or a link flow handled by detectSessionInUrl.
      void client.auth.getSession().then(({ data }) => {
        if (data.session?.access_token) {
          void attemptExchange(data.session.access_token)
        } else {
          setPhase('error')
          setMessage('This link is no longer valid. Request a new email and open it in the same browser.')
        }
      })
      return
    }
    void client.auth
      .exchangeCodeForSession(code)
      .then(({ data, error }) => {
        if (error) {
          setPhase('error')
          setMessage(
            error.message?.includes('same browser')
              ? 'For security, verification links must be opened in the same browser they were requested from. Request a new link and open it here.'
              : error.message || 'The link is invalid or has expired. Request a new one.',
          )
          return
        }
        if (isRecovery) {
          setPhase('recovery')
          return
        }
        if (data.session?.access_token) {
          void attemptExchange(data.session.access_token)
        } else {
          setPhase('verified')
          setMessage('Your email is verified. Continue from your school\u2019s login door.')
        }
      })
      .catch(() => {
        setPhase('error')
        setMessage('The link could not be processed. Request a new one.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, errorParam])

  const handleNewPassword = async () => {
    if (!client || busy) return
    if (newPassword !== confirm) {
      setMessage('Passwords do not match.')
      return
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setMessage('Use at least 8 characters with a letter and a digit.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { error } = await client.auth.updateUser({ password: newPassword })
      if (error) {
        setMessage(error.message)
        return
      }
      const { data } = await client.auth.getSession()
      if (data.session?.access_token) {
        // The provider password is set; the server exchange now applies
        // every login invariant (including the app-side password sync
        // contract — the exchange does NOT change the app password; the
        // custom login remains authoritative until linked).
        await attemptExchange(data.session.access_token)
        return
      }
      setPhase('done')
      setMessage('Password updated. Sign in from your school\u2019s login door.')
    } catch {
      setMessage('Could not update the password — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">
          {phase === 'recovery' ? 'Choose a new password' : 'Email verification'}
        </h1>

        {phase === 'resolving' && (
          <p className="mt-3 text-sm text-slate-600" role="status">
            Completing verification…
          </p>
        )}

        {phase === 'recovery' && (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void handleNewPassword()
            }}
          >
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-teal-700 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}

        {message && (
          <p
            role="status"
            className={`mt-3 rounded-md px-3 py-2 text-xs leading-relaxed ${
              phase === 'error' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700'
            }`}
          >
            {message}
          </p>
        )}

        {(phase === 'verified' || phase === 'done' || phase === 'error') && (
          <a
            href="/login"
            className="mt-4 inline-block text-sm font-medium text-teal-700 underline underline-offset-2"
          >
            Go to the login door
          </a>
        )}
      </div>
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  )
}
