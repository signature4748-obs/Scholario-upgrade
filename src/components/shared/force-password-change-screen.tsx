'use client'

import { useEffect, useState } from 'react'
import { KeyRound, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCurrentUser, type MeUser } from '@/lib/store/current-user-store'
import { useAuth } from '@/lib/store/auth-store'
import { saveSessionToken } from '@/lib/auth-session-token'

/**
 * ForcePasswordChangeScreen — CREDENTIAL-RESET (CRITICAL audit fix).
 *
 * Rendered INSTEAD of the role panels when the server identity
 * (/api/auth/me) reports mustChangePassword. The sign-in itself
 * succeeded — the account simply has not yet established its own
 * password (provisioned with a one-time bootstrap credential, or
 * migrated from the seeded-credential era). This screen completes the
 * forced first-password-change through the REAL change-password API
 * (session rotation + other-session revocation happen server-side);
 * every business module API rejects the session with
 * PASSWORD_CHANGE_REQUIRED until then, so this screen is a courtesy
 * surface, NEVER the enforcement layer.
 *
 * Visual language mirrors the lock screens (quiet card, identity block,
 * amber notice) — no new design system, no layout changes elsewhere.
 */
const ROLE_LABELS: Record<string, string> = {
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function newPasswordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters'
  if (pw.length > 128) return 'Use at most 128 characters'
  if (!/[A-Za-z]/.test(pw)) return 'Include at least one letter'
  if (!/[0-9]/.test(pw)) return 'Include at least one number'
  return null
}

export function ForcePasswordChangeScreen({ user }: { user: MeUser }) {
  const logout = useAuth((s) => s.logout)
  const clear = useCurrentUser((s) => s.clear)
  const refresh = useCurrentUser((s) => s.refresh)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Set Your Password — Scholario'
  }, [])

  const handleSignOut = () => {
    void fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => {})
    logout()
    clear()
    if (typeof window !== 'undefined') window.location.reload()
  }

  const handleSubmit = async () => {
    if (submitting) return
    setError(null)

    if (!currentPassword) {
      setError('Enter the password you signed in with.')
      return
    }
    const problem = newPasswordProblem(newPassword)
    if (problem) {
      setError(`New password: ${problem}.`)
      return
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current one.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        data?: { sessionToken?: string }
      } | null
      if (!res.ok || !payload?.ok) {
        // Safe server envelope message (wrong current password, policy,
        // throttle) — fall back to the generic line.
        setError(payload?.error ?? 'Could not save the new password. Please try again.')
        return
      }
      // Dev-iframe bearer mode: the rotated token replaces the stored
      // one (production rides the rotated HttpOnly cookie instead).
      if (payload.data?.sessionToken) saveSessionToken(payload.data.sessionToken)
      // Re-read the server identity: mustChangePassword flips to false
      // and the shell mounts the role panels.
      await refresh().catch(() => undefined)
      // Clean re-boot: the role-panel store hydration (roster, faculty,
      // school settings — once-per-session caches) fired while this
      // screen held the session and was 403-gated. A reload re-runs the
      // whole boot on the ESTABLISHED credential (same pattern as the
      // sign-out path below); per-module fetches then hydrate normally.
      if (typeof window !== 'undefined') window.location.reload()
    } catch {
      setError('Network problem — the password was not saved. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const roleLabel = ROLE_LABELS[user.role] ?? user.role

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-md border-border/80 shadow-xl">
          <CardContent className="p-6 space-y-6">
            {/* Identity block — the account is authenticated; it merely
                has not chosen its own password yet */}
            <div className="flex items-center gap-4">
              <div
                aria-hidden
                className="h-14 w-14 rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 flex items-center justify-center shrink-0"
              >
                {initials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-foreground">{user.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {roleLabel}
                  {user.school?.name ? ` · ${user.school.name}` : ''}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* The honest notice */}
            <div
              role="alert"
              className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/60 p-4 space-y-1"
            >
              <p className="text-sm font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Set your own password
              </p>
              <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
                Sign-in succeeded, but this account is still using the password it was issued. Choose
                your own password to unlock the school workspace — classes, marks, fees and every
                other module stay locked until then.
              </p>
            </div>

            {/* The form — the REAL change-password API (audited, rotated) */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void handleSubmit()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={submitting}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters with a letter and a number.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 p-3 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                <KeyRound className="h-4 w-4 mr-2" aria-hidden />
                {submitting ? 'Saving…' : 'Save new password'}
              </Button>
            </form>

            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto py-4 text-center text-xs text-muted-foreground">
        {user.school?.name ?? 'Scholario'} · Session {user.school?.academicYear ?? ''}
      </footer>
    </div>
  )
}
