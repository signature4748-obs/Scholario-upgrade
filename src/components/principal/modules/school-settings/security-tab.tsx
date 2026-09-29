'use client'

/**
 * PR-SEC — Settings → My Account (Login & Security).
 *
 * The Teacher and Student workspaces already expose a Login & Security
 * section; this tab brings the Principal to parity. Real data only:
 * sign-in identity from the server session (/api/auth/me → current-user
 * store), this session's start/device context, and the account's last
 * sign-in (User.lastLoginAt — updated by every login). Change-password
 * hits the same role-agnostic /api/auth/change-password the other roles
 * use and revokes other sessions server-side (the API reports how many).
 */

import { useState } from 'react'
import { ShieldCheck, LogOut, MonitorSmartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { PasswordField } from '@/components/shared/password-field'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { signOut } from '@/lib/signout'
import { saveSessionToken } from '@/lib/auth-session-token'
import { formatDate } from '@/lib/format'
import { SettingsTab, FieldGroup, SettingsInfoRow } from './shared'

export function SecurityTab() {
  const me = useCurrentUser((s) => s.me)
  const session = useCurrentUser((s) => s.session)
  const lastLoginAt = useCurrentUser((s) => s.lastLoginAt)

  const deviceLabel = session?.device
    ? `${session.device.browser} · ${session.device.os}${session.device.device !== 'Desktop' ? ` · ${session.device.device}` : ''}`
    : '—'

  return (
    <SettingsTab
      icon={ShieldCheck}
      title="My Account"
      description="Your sign-in identity, password and active session"
    >
      <FieldGroup label="Sign-in identity">
        <div className="divide-y divide-border/60 rounded-xl border border-border bg-background/50 px-4">
          <SettingsInfoRow label="Sign-in email" value={me?.email ?? '—'} />
          <SettingsInfoRow label="Account type" value="Principal" />
          <SettingsInfoRow
            label="Last sign-in"
            value={lastLoginAt ? formatDate(lastLoginAt) : 'This session'}
          />
        </div>
      </FieldGroup>

      <FieldGroup label="This session">
        <div className="divide-y divide-border/60 rounded-xl border border-border bg-background/50 px-4">
          <SettingsInfoRow label="Started" value={session ? formatDate(session.createdAt) : '—'} />
          <SettingsInfoRow label="Device" value={deviceLabel} />
          <SettingsInfoRow
            label="IP address"
            value={session?.ipAddress ?? '—'}
            mono
          />
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
          <MonitorSmartphone className="h-3 w-3 shrink-0" aria-hidden />
          Signing in on a new device does not end this session.
        </p>
      </FieldGroup>

      <FieldGroup label="Change password">
        <ChangePasswordForm />
      </FieldGroup>

      <div className="pt-2 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
    </SettingsTab>
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
    <div className="space-y-3 max-w-md">
      <PasswordField
        id="p_pw-current"
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
      />
      <PasswordField
        id="p_pw-new"
        label="New password"
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        hint
      />
      <PasswordField
        id="p_pw-confirm"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
      />
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? 'Updating…' : 'Change password'}
        </Button>
      </div>
    </div>
  )
}
