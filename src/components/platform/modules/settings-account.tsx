'use client'

// ============================================================
// SettingsAccountCard — /platform/settings → "Account & sign-in"
// ------------------------------------------------------------
// ACCOUNT-RECOVERY (docs/PLATFORM_ACCOUNT_RECOVERY.md): the signed-in
// admin's own authentication surface:
//   · password self-service — IN-SESSION change (POST
//     /api/platform/auth/change-password: current-password proof,
//     policy-checked new password, other sessions revoked, current
//     session rotated) plus the emailed reset link as the signed-OUT
//     fallback (same pipeline as the login page's Forgot password?);
//   · OPTIONAL Google identity: LINK (top-level OAuth redirect via
//     /api/platform/auth/google/link/start — step-up gated server
//     side) and UNLINK (POST, step-up gated, revokes sessions).
//
// The card is honest: when Google OAuth is not configured the Google
// row explains it instead of rendering dead buttons.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { KeyRound, Link2, Unlink, ShieldCheck, Info, Loader2, Check } from 'lucide-react'
import { platformApi, usePlatformSession, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  // Themed unlink confirmation (replaces the old window.confirm): the
  // destructive sign-in consequence is stated before the same call.
  const [unlinkOpen, setUnlinkOpen] = useState(false)

  // ── In-session password change (P0-A repair) ─────────────────────────
  const [pwOpen, setPwOpen] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)

  const resetPwForm = useCallback(() => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwError(null)
  }, [])

  const submitPasswordChange = useCallback(async () => {
    if (pwBusy) return
    setPwError(null)
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match')
      return
    }
    setPwBusy(true)
    try {
      const res = await platformApi<{ ok: boolean; otherSessionsSignedOut: number }>(
        '/api/platform/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        },
      )
      toast.success(
        res.otherSessionsSignedOut > 0
          ? `Password changed — ${res.otherSessionsSignedOut} other session${res.otherSessionsSignedOut === 1 ? '' : 's'} signed out`
          : 'Password changed',
      )
      setPwOpen(false)
      resetPwForm()
      await refresh()
    } catch (e) {
      const err = e as PlatformApiError
      setPwError(err.error || 'Failed to change password')
    } finally {
      setPwBusy(false)
    }
  }, [pwBusy, currentPassword, newPassword, confirmPassword, resetPwForm, refresh])

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
    // Confirmation lives in the themed AlertDialog below — this runs only
    // after the explicit Unlink click (same server call as before).
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
      setUnlinkOpen(false)
    }
  }, [unlinking, refresh])

  const linked = me?.admin.googleLinked === true

  return (
    <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-900 text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
          Account &amp; security
        </CardTitle>
        <CardDescription className="text-slate-500 text-xs">
          Your platform administrator credentials and optional Google identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Password — in-session self-service change (P0-A). The form
            proves the CURRENT password (a stolen session cannot rotate
            the credential), enforces the new-password policy, revokes
            every other session and rotates this one. */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-medium text-slate-900">Password</p>
              <p className="text-xs text-slate-500 truncate">
                Signed in as {me?.admin.email ?? '—'}
              </p>
              <p className="text-xs text-slate-400">
                Change it here while signed in; other devices are signed out and this
                session is rotated. The emailed reset link remains the signed-out
                fallback (single-use, 30 minutes).
              </p>
            </div>
            {!pwOpen && (
              <Button
                variant="outline"
                onClick={() => {
                  setPwOpen(true)
                  setPwError(null)
                }}
                className="h-11 px-4 shrink-0 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-ring"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Change password
              </Button>
            )}
          </div>

          {pwOpen && (
            <form
              className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
              onSubmit={(e) => {
                e.preventDefault()
                void submitPasswordChange()
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="pw-current" className="text-xs font-semibold text-slate-700">
                  Current password
                </Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="bg-white border-slate-200 h-11 focus-visible:ring-teal-500/40"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="pw-new" className="text-xs font-semibold text-slate-700">
                    New password
                  </Label>
                  <Input
                    id="pw-new"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="bg-white border-slate-200 h-11 focus-visible:ring-teal-500/40"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pw-confirm" className="text-xs font-semibold text-slate-700">
                    Confirm new password
                  </Label>
                  <Input
                    id="pw-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    className="bg-white border-slate-200 h-11 focus-visible:ring-teal-500/40"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                At least 8 characters with a letter and a digit. Every other signed-in
                device is signed out; this session continues on a rotated token.
              </p>
              {pwError && (
                <p className="text-xs text-red-600" role="alert">
                  {pwError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pwBusy}
                  onClick={() => {
                    setPwOpen(false)
                    resetPwForm()
                  }}
                  className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pwBusy || !currentPassword || !newPassword || !confirmPassword}
                  className="h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
                >
                  {pwBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Changing…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Update password
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
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
                onClick={() => setUnlinkOpen(true)}
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

        {/* ── Themed unlink confirmation (replaces window.confirm) — states
            the sign-in consequence before the same server call. */}
        <AlertDialog
          open={unlinkOpen}
          onOpenChange={(v) => {
            // Never dismiss mid-request — the busy state stays honest.
            if (!v && !unlinking) setUnlinkOpen(false)
          }}
        >
          <AlertDialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display flex items-center gap-2 text-red-700">
                <Unlink className="h-4 w-4" aria-hidden="true" />
                Unlink Google sign-in?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-500">
                You will no longer be able to sign in with Google. Password sign-in remains and
                opens this same account. Every active session — including this one — is signed
                out, so you will sign in again with your password.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setUnlinkOpen(false)}
                disabled={unlinking}
                className="h-11 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void unlink()}
                disabled={unlinking}
                className="h-11 bg-red-600 hover:bg-red-500 text-white font-semibold focus-ring"
              >
                {unlinking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {unlinking ? 'Unlinking…' : 'Unlink'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
