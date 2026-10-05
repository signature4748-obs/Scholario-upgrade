'use client'

// ============================================================
// SettingsAccountCard — /platform/settings → "Account & sign-in"
// ------------------------------------------------------------
// ACCOUNT-RECOVERY (docs/PLATFORM_ACCOUNT_RECOVERY.md): the signed-in
// admin's own authentication surface:
//   · password self-service (the emailed reset flow — same pipeline
//     as the login page's Forgot password?);
//   · OPTIONAL Google identity: LINK (top-level OAuth redirect via
//     /api/platform/auth/google/link/start — step-up gated server
//     side) and UNLINK (POST, step-up gated, revokes sessions).
//
// The card is honest: when Google OAuth is not configured the Google
// row explains it instead of rendering dead buttons.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { KeyRound, Link2, Unlink, ShieldCheck, Info } from 'lucide-react'
import { platformApi, usePlatformSession, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

const GOOGLE_ERROR_LABELS: Record<string, string> = {
  GOOGLE_ALREADY_LINKED:
    'That Google identity is already linked to a different platform admin account.',
  SESSION_EXPIRED:
    'Your session or verification window expired during linking. Sign in again and retry.',
  GOOGLE_NOT_LINKED: 'No Google identity is linked to this account.',
}

export function SettingsAccountCard() {
  const { me, refresh } = usePlatformSession()
  const searchParams = useSearchParams()
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null)
  const [unlinking, setUnlinking] = useState(false)

  useEffect(() => {
    fetch('/api/platform/auth/google/status')
      .then((r) => r.json() as Promise<{ ok: boolean; data?: { enabled?: boolean } }>)
      .then((b) => setGoogleConfigured(Boolean(b.ok && b.data?.enabled)))
      .catch(() => setGoogleConfigured(false))
  }, [])

  // OAuth round-trip feedback (callback redirects here).
  useEffect(() => {
    if (searchParams.get('google') === 'linked') {
      toast.success('Google sign-in linked to your account')
    }
    const code = searchParams.get('googleError')
    if (code) {
      toast.error(GOOGLE_ERROR_LABELS[code] ?? 'Google linking failed. Please try again.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unlink = useCallback(async () => {
    if (unlinking) return
    if (
      !window.confirm(
        'Unlink Google sign-in from this account? You will keep signing in with your password, and every active session will be signed out.',
      )
    ) {
      return
    }
    setUnlinking(true)
    try {
      await platformApi('/api/platform/auth/google/unlink', { method: 'POST' })
      toast.success('Google identity unlinked — sign in again with your password')
      await refresh()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to unlink Google identity')
    } finally {
      setUnlinking(false)
    }
  }, [unlinking, refresh])

  const linked = me?.admin.googleLinked === true

  return (
    <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-900 text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
          Account &amp; sign-in
        </CardTitle>
        <CardDescription className="text-slate-500 text-xs">
          Your platform administrator credentials and optional Google identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Password */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium text-slate-900">Password</p>
            <p className="text-xs text-slate-500 truncate">
              Signed in as {me?.admin.email ?? '—'}
            </p>
            <p className="text-xs text-slate-400">
              Reset through the verified-email link (single-use, 30 minutes).
            </p>
          </div>
          <a
            href="/platform/forgot-password"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors focus-ring"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Send reset link
          </a>
        </div>

        {/* Google identity */}
        <div className="flex items-start justify-between gap-4 border-t border-slate-100 pt-5">
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium text-slate-900">Google sign-in</p>
            {linked ? (
              <>
                <p className="text-xs text-slate-500 truncate">
                  Linked to <span className="font-medium">{me?.admin.googleEmail ?? 'your Google account'}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Password and Google sign-ins open the same account.
                </p>
              </>
            ) : googleConfigured === false ? (
              <p className="text-xs text-slate-500 max-w-sm">
                Not configured on this deployment
                (<code className="text-[10px]">GOOGLE_OAUTH_CLIENT_ID/SECRET</code>).
                Linking becomes available once configured.
              </p>
            ) : (
              <p className="text-xs text-slate-500 max-w-sm">
                Optional: link a Google identity to sign in without your password. Google
                sign-in resolves to this same account — it never creates a new one.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {linked ? (
              <Button
                variant="outline"
                onClick={() => void unlink()}
                disabled={unlinking}
                className="h-11 px-4 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 focus-ring"
              >
                <Unlink className="h-4 w-4" aria-hidden="true" />
                {unlinking ? 'Unlinking…' : 'Unlink'}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={googleConfigured !== true}
                onClick={() => {
                  // Top-level navigation — the OAuth consent round-trip.
                  window.location.href = '/api/platform/auth/google/link/start'
                }}
                className="h-11 px-4 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-ring"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Link Google
              </Button>
            )}
          </div>
        </div>

        <p
          className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500"
          role="note"
        >
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          Linking and unlinking are destructive sign-in changes — the server requires a
          recent multi-factor step-up while platform MFA is enabled, and every change is
          written to the platform audit trail.
        </p>
      </CardContent>
    </Card>
  )
}
