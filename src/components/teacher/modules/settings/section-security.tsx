'use client'

/**
 * TS-SETTINGS → Login & Security.
 *
 * Real data only: login identity from the server session, session
 * start/expiry, last sign-in. Change-password revokes other sessions
 * server-side. No invented security metadata.
 */
import { useState } from 'react'
import { LockKeyhole, LogOut, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PasswordField } from '@/components/shared/password-field'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { signOut } from '@/lib/signout'
import { saveSessionToken } from '@/lib/auth-session-token'
import { formatDate } from '@/lib/format'
import { SectionCard, InfoRow } from './primitives'

export function SecuritySection() {
  const me = useCurrentUser((s) => s.me)
  const session = useCurrentUser((s) => s.session)
  const lastLoginAt = useCurrentUser((s) => s.lastLoginAt)

  return (
    <SectionCard icon={LockKeyhole} title="Login & Security" caption="Your sign-in identity and password">
      <div className="divide-y divide-border/60">
        <InfoRow label="Sign-in email" value={me?.email ?? '—'} />
        <InfoRow label="Account type" value="Teacher" />
        <InfoRow
          label="This session started"
          value={session ? formatDate(session.createdAt) : '—'}
        />
        <InfoRow
          label="Last sign-in"
          value={lastLoginAt ? formatDate(lastLoginAt) : 'This session'}
        />
      </div>

      <div className="mt-5 pt-5 border-t border-border/70">
        <ChangePasswordForm />
      </div>

      <div className="mt-5 pt-5 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Sign out of this device</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Ends this session on this browser.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
          onClick={() => { void signOut() }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </SectionCard>
  )
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Fill in all three password fields.')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters (letter + number).')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.ok) {
        // Phase 1 — the server ROTATED this session's token; persist the
        // replacement so the dev-preview bearer transport stays valid.
        if (j?.data?.sessionToken) saveSessionToken(j.data.sessionToken)
        const others = j?.data?.otherSessionsSignedOut ?? 0
        toast.success('Password updated', {
          description:
            others > 0
              ? `${others} other signed-in device${others > 1 ? 's were' : ' was'} signed out.`
              : 'Use your new password next time you sign in.',
        })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setError(j?.error || 'Could not change password — please try again.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Change password
        </h4>
      </div>
      <div className="space-y-3 max-w-md">
        <PasswordField id="t_pw-current" label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField id="t_pw-new" label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint />
        <PasswordField id="t_pw-confirm" label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Updating…' : 'Change password'}
          </Button>
        </div>
      </div>
    </div>
  )
}

