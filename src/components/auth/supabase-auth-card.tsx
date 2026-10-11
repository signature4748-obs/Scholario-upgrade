'use client'

/**
 * src/components/auth/supabase-auth-card.tsx — SUPABASE AUTH PHASE 1.
 *
 * The provider-identity card for the login doors (school + platform
 * planes). Self-contained and MOUNTS NOTHING when the feature flag is
 * down or the provider env is absent (the status probe decides — honest
 * off, like the Google button).
 *
 * The card NEVER makes authorization decisions: after a provider
 * success (password / OTP / recovery) it POSTs the access token to the
 * server-side EXCHANGE endpoint and follows the server's verdict —
 *   · ok                       → hand the login payload to the host page
 *                                (the SAME post-login state machine as
 *                                the custom form: role panel, forced
 *                                password-change, locked shells);
 *   · LINK_PASSWORD_REQUIRED   → the first-link ownership proof (the
 *                                current Scholario password — the
 *                                anti-takeover gate);
 *   · NO_SCHOLARIO_ACCOUNT /
 *     IDENTITY_UNVERIFIED /
 *     PHONE_AMBIGUOUS          → honest states with actionable copy;
 *   · anything else            → visible, retryable failure.
 *
 * Provider capabilities (email/password, signup+verification, phone
 * OTP, Google) render from the SAME status probe — nothing is faked,
 * and delivery-blocked capabilities say so.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { saveSessionToken } from '@/lib/auth-session-token'

type Plane = 'school' | 'platform'

type Mode = 'signin' | 'signup' | 'phone' | 'forgot'

interface StatusPayload {
  ok?: boolean
  data?: {
    enabled?: boolean
    capabilities?: {
      emailPassword?: boolean
      emailSignup?: boolean
      phoneOtp?: string
      google?: boolean
    }
  }
}

type StatusCapabilities = NonNullable<StatusPayload['data']>['capabilities']

interface ExchangePayload {
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
    mustChangePassword?: boolean
    subscriptionStatus?: string
    entitlement?: { businessAllowed?: boolean; state?: string }
  }
}

interface Props {
  plane: Plane
  /** Applied on exchange ok — the host page's own post-login machine. */
  onAuthed: (payload: NonNullable<ExchangePayload['data']>) => void
  /** Accent color (school theme / platform brand). */
  accent?: string
}

export function SupabaseAuthCard({ plane, onAuthed, accent = '#0f766e' }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [capabilities, setCapabilities] = useState<StatusCapabilities>({})
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [showOwnershipProof, setShowOwnershipProof] = useState(false)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null)
  const pendingAccessToken = useRef<string | null>(null)

  const exchangeUrl = plane === 'school' ? '/api/auth/supabase/exchange' : '/api/platform/auth/supabase/exchange'
  const statusUrl = plane === 'school' ? '/api/auth/supabase/status' : '/api/platform/auth/supabase/status'

  useEffect(() => {
    let alive = true
    void fetch(statusUrl, { cache: 'no-store' })
      .then((r) => r.json() as Promise<StatusPayload>)
      .then((p) => {
        if (!alive) return
        setEnabled(Boolean(p?.data?.enabled))
        setCapabilities(p?.data?.capabilities ?? {})
      })
      .catch(() => alive && setEnabled(false))
    return () => {
      alive = false
    }
  }, [statusUrl])

  const client = getSupabaseBrowserClient()

  const e164 = (raw: string): string => raw.replace(/[\s()-]/g, '')

  /** POST the provider token to the server exchange and follow its verdict. */
  const exchange = useCallback(
    async (accessToken: string, withCurrentPassword?: string) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(exchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken,
            ...(withCurrentPassword ? { currentPassword: withCurrentPassword } : {}),
          }),
        })
        const payload = (await res.json().catch(() => null)) as ExchangePayload | null
        if (res.ok && payload?.ok && payload.data) {
          // Embedded preview: persist the app session token exactly like
          // the custom login (production uses the HttpOnly cookie only).
          if (payload.data.sessionToken) saveSessionToken(payload.data.sessionToken)
          onAuthed(payload.data)
          return
        }
        const code = payload?.code ?? ''
        if (code === 'LINK_PASSWORD_REQUIRED') {
          setShowOwnershipProof(true)
          setNotice({
            kind: 'info',
            text: 'Almost there — confirm your current Scholario password once to connect this sign-in method.',
          })
          return
        }
        const text =
          payload?.error ??
          (res.ok ? 'Sign-in could not be completed.' : 'The server rejected the sign-in. Please try again.')
        setNotice({ kind: 'error', text })
      } catch {
        setNotice({ kind: 'error', text: 'Network error — check your connection and try again.' })
      } finally {
        setBusy(false)
      }
    },
    [exchangeUrl, onAuthed],
  )

  /** Provider email+password sign-in → exchange. */
  const handleSignIn = async () => {
    if (!client || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error || !data.session?.access_token) {
        setNotice({ kind: 'error', text: error?.message ?? 'Provider sign-in failed. Please try again.' })
        return
      }
      pendingAccessToken.current = data.session.access_token
      await exchange(data.session.access_token, showOwnershipProof ? currentPassword : undefined)
    } catch {
      setNotice({ kind: 'error', text: 'Sign-in failed — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  /** Provider signup — email verification is REQUIRED before the
   *  identity can link (the server rejects unverified identities). */
  const handleSignUp = async () => {
    if (!client || busy) return
    if (password !== confirm) {
      setNotice({ kind: 'error', text: 'Passwords do not match.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo:
            typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
        },
      })
      if (error) {
        setNotice({ kind: 'error', text: error.message })
        return
      }
      if (data.session?.access_token) {
        // Provider auto-confirmed (non-default config) — go straight to
        // the exchange; the server still decides account mapping.
        await exchange(data.session.access_token)
        return
      }
      setNotice({
        kind: 'success',
        text: 'Check your email — we sent a verification link. Verify, then sign in here. Your school account connects on first sign-in.',
      })
      setMode('signin')
    } catch {
      setNotice({ kind: 'error', text: 'Sign-up failed — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  /** Phone OTP — request, then verify, then exchange. */
  const handleSendOtp = async () => {
    if (!client || busy) return
    const normalized = e164(phone)
    if (!/^\+[1-9]\d{5,14}$/.test(normalized)) {
      setNotice({ kind: 'error', text: 'Enter the phone in international format, e.g. +919876543210.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const { error } = await client.auth.signInWithOtp({ phone: normalized })
      if (error) {
        setNotice({
          kind: 'error',
          text: error.message.includes('send')
            ? 'Could not send the SMS — the SMS provider may not be configured yet. Use email sign-in meanwhile.'
            : error.message,
        })
        return
      }
      setOtpSent(true)
      setNotice({ kind: 'info', text: 'Code sent — enter the 6-digit code from the SMS.' })
    } catch {
      setNotice({ kind: 'error', text: 'Could not send the code — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (!client || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const { data, error } = await client.auth.verifyOtp({
        phone: e164(phone),
        token: otp.trim(),
        type: 'sms',
      })
      if (error || !data.session?.access_token) {
        setNotice({ kind: 'error', text: error?.message ?? 'Invalid or expired code.' })
        return
      }
      await exchange(data.session.access_token, showOwnershipProof ? currentPassword : undefined)
    } catch {
      setNotice({ kind: 'error', text: 'Verification failed — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  /** Provider-initiated password recovery email. */
  const handleForgot = async () => {
    if (!client || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
      })
      if (error) {
        setNotice({ kind: 'error', text: error.message })
        return
      }
      setNotice({
        kind: 'success',
        text: 'If that address is registered, a reset link is on its way. Open it, choose a new password, then sign in.',
      })
    } catch {
      setNotice({ kind: 'error', text: 'Could not request the reset — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (enabled === null || enabled === false || !client) return null

  const modes: { key: Mode; label: string; show: boolean }[] = [
    { key: 'signin', label: 'Sign in', show: true },
    { key: 'signup', label: 'Create account', show: plane === 'school' && capabilities?.emailSignup !== false && capabilities?.emailSignup != null ? capabilities.emailSignup : plane === 'school' },
    { key: 'phone', label: 'Phone OTP', show: plane === 'school' },
    { key: 'forgot', label: 'Reset', show: plane === 'school' },
  ]

  return (
    <section
      aria-label="Provider sign-in"
      className="mt-4 w-full rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} />
        <h2 className="text-sm font-semibold text-slate-700">
          {plane === 'school' ? 'Sign in with an email identity' : 'Provider identity sign-in'}
        </h2>
      </div>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Provider sign-in mode">
        {modes
          .filter((m) => m.show)
          .map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              disabled={busy}
              onClick={() => {
                setMode(m.key)
                setNotice(null)
                setShowOwnershipProof(false)
                setOtpSent(false)
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m.key ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={mode === m.key ? { background: accent } : undefined}
            >
              {m.label}
            </button>
          ))}
      </div>

      <form
        className="mt-3 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === 'signin') void handleSignIn()
          else if (mode === 'signup') void handleSignUp()
          else if (mode === 'phone') void (otpSent ? handleVerifyOtp() : handleSendOtp())
          else void handleForgot()
        }}
      >
        {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
          <label className="block">
            <span className="sr-only">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <label className="block">
            <span className="sr-only">Password</span>
            <input
              type="password"
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        )}

        {mode === 'signup' && (
          <label className="block">
            <span className="sr-only">Confirm password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
        )}

        {mode === 'phone' && (
          <>
            <label className="block">
              <span className="sr-only">Phone number</span>
              <input
                type="tel"
                required
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
                disabled={busy || otpSent}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            </label>
            {otpSent && (
              <label className="block">
                <span className="sr-only">SMS code</span>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={8}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                  disabled={busy}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tracking-widest outline-none focus:border-slate-400"
                />
              </label>
            )}
          </>
        )}

        {showOwnershipProof && (mode === 'signin' || mode === 'phone') && (
          <label className="block">
            <span className="sr-only">Current Scholario password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current Scholario password"
              disabled={busy}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: accent }}
        >
          {busy
            ? 'Working…'
            : mode === 'signin'
              ? 'Continue'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'phone'
                  ? otpSent
                    ? 'Verify code'
                    : 'Send code'
                  : 'Send reset link'}
        </button>
      </form>

      {notice && (
        <p
          role="status"
          className={`mt-2 rounded-md px-3 py-2 text-xs leading-relaxed ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700'
              : notice.kind === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-sky-50 text-sky-700'
          }`}
        >
          {notice.text}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {mode === 'signup'
          ? 'Creating an identity does not create a school account — your school administrator provisions access. '
          : ''}
        {capabilities?.google
          ? 'Google sign-in is available. '
          : ''}
        {capabilities?.phoneOtp === 'blocked-no-provider' && mode === 'phone'
          ? 'SMS delivery may not be configured yet — email sign-in always works. '
          : ''}
        Your school account connects securely on first sign-in.
      </p>
    </section>
  )
}
