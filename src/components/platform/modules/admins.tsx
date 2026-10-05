'use client'

// ============================================================
// AdminsModule — /platform/admins (PHASE 6 console)
// ------------------------------------------------------------
// The root plane: platform admin roster, per-key permission grants,
// account creation (with one-time TOTP enrollment) and
// suspend/reactivate. Every mutation is step-up gated (the API
// rejects stale MFA windows — the gate handles the retry).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  Users,
  UserPlus,
  ChevronDown,
  Ban,
  RotateCcw,
  KeyRound,
  Copy,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  Check,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
import { useStepUpGate } from '../step-up-gate'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

interface AdminRow {
  id: string
  email: string
  name: string
  status: 'ACTIVE' | 'SUSPENDED'
  isRoot: boolean
  isDemo: boolean
  /** ACCOUNT-RECOVERY — Google identity link state (recovery actions). */
  googleLinked: boolean
  googleEmail: string | null
  createdAt: string
  grants: string[]
  permissionCatalog: string[]
}

/** ACCOUNT-RECOVERY — pending dual-control tickets (root targets). */
interface RecoveryTicketRow {
  id: string
  action: 'PASSWORD_RESET' | 'GOOGLE_UNLINK'
  createdAt: string
  expiresAt: string
  reason: string | null
  target: { id: string; email: string | null; name: string | null }
  initiatedBy: { id: string; email: string | null; name: string | null }
}

interface EnrollmentPayload {
  totpSecret: string
  otpauthUrl: string
}

const PERMISSION_LABELS: Record<string, string> = {
  'schools.read': 'View schools',
  'schools.manage': 'Manage schools (suspend, delete, flags)',
  'schools.provision': 'Provision new schools',
  'billing.manage': 'Manage billing & plans',
  'announcements.manage': 'Manage announcements',
  'settings.manage': 'Manage platform settings',
  'audit.read': 'Read the audit trail',
  'support.access': 'Support tools & sessions',
  'admins.manage': 'Manage platform admins',
}

/** Sensible default grants for a new non-root admin (ops profile). */
const DEFAULT_GRANTS = [
  'schools.read',
  'schools.manage',
  'announcements.manage',
  'audit.read',
  'support.access',
]

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Copy failed — select the text manually')
  }
}

export function AdminsModule() {
  const { me, can } = usePlatformSession()
  const { gate, node: stepUpNode } = useStepUpGate()

  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create-admin dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    isRoot: false,
    permissions: new Set<string>(DEFAULT_GRANTS),
  })
  const [enrollment, setEnrollment] = useState<EnrollmentPayload | null>(null)

  // Suspend confirm
  const [suspendTarget, setSuspendTarget] = useState<AdminRow | null>(null)
  const [suspending, setSuspending] = useState(false)

  // ACCOUNT-RECOVERY — pending dual-control tickets (root recovery).
  const [recoveryTickets, setRecoveryTickets] = useState<RecoveryTicketRow[]>([])

  const canManage = can('admins.manage')
  const isSelf = (a: AdminRow) => Boolean(me && me.admin.id === a.id)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await platformApi<{ admins: AdminRow[] }>('/api/platform/admins')
      setAdmins(body.admins)
      setForbidden(false)
    } catch (e) {
      const err = e as PlatformApiError
      if (err.code === 'FORBIDDEN') {
        setForbidden(true)
      } else {
        setError(err.error || 'Failed to load the admin roster')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecovery = useCallback(async () => {
    if (!can('admins.manage')) return
    try {
      const body = await platformApi<{ tickets: RecoveryTicketRow[] }>(
        '/api/platform/admins/recovery',
      )
      setRecoveryTickets(body.tickets)
    } catch {
      // Non-fatal — the queue renders empty on error.
    }
  }, [can])

  useEffect(() => {
    void load()
    void loadRecovery()
  }, [load, loadRecovery])

  // ---- permission toggle (step-up gated) ----
  const togglePermission = async (admin: AdminRow, key: string, granted: boolean) => {
    setBusy(true)
    try {
      const result = await gate(() =>
        platformApi(`/api/platform/admins/${admin.id}/permissions`, {
          method: 'PATCH',
          body: JSON.stringify({ key, granted }),
        }),
      )
      if (result === undefined) {
        // Cancelled at the step-up prompt — resync from the server.
        await load()
        return
      }
      toast.success(
        `${granted ? 'Granted' : 'Revoked'} ${PERMISSION_LABELS[key] ?? key} for ${admin.name}`,
      )
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to update permissions')
      await load()
    } finally {
      setBusy(false)
    }
  }

  // ---- create admin (step-up gated) → enrollment ----
  const createAdmin = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error('Name, email and password are required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address')
      return
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setCreating(true)
    try {
      const result = await gate(() =>
        // PART 1 reset: enrollment is only returned while platform MFA
        // is enabled (mfa-config) — otherwise it is absent and no
        // authenticator setup dialog is shown.
        platformApi<{ enrollment?: EnrollmentPayload }>('/api/platform/admins', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            isRoot: form.isRoot,
            permissions: form.isRoot ? [] : [...form.permissions],
          }),
        }),
      )
      if (result === undefined) {
        return // cancelled at the step-up prompt
      }
      toast.success(`Created ${form.email.trim()}`)
      setCreateOpen(false)
      setEnrollment(result.enrollment ?? null)
      setForm({ name: '', email: '', password: '', isRoot: false, permissions: new Set(DEFAULT_GRANTS) })
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to create the admin')
    } finally {
      setCreating(false)
    }
  }

  // ---- suspend / reactivate (step-up gated) ----
  const suspend = async () => {
    if (!suspendTarget) return
    setSuspending(true)
    try {
      const result = await gate(() =>
        platformApi(`/api/platform/admins/${suspendTarget.id}/suspend`, { method: 'POST' }),
      )
      if (result === undefined) return
      toast.success(`${suspendTarget.name} suspended — all their sessions were revoked`)
      setSuspendTarget(null)
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to suspend the admin')
    } finally {
      setSuspending(false)
    }
  }

  const reactivate = async (admin: AdminRow) => {
    setBusy(true)
    try {
      const result = await gate(() =>
        platformApi(`/api/platform/admins/${admin.id}/reactivate`, { method: 'POST' }),
      )
      if (result === undefined) return
      toast.success(`${admin.name} reactivated`)
      await load()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to reactivate the admin')
    } finally {
      setBusy(false)
    }
  }

  // ---- ACCOUNT-RECOVERY: admin-assisted credential recovery ----
  // Email a single-use password reset link to the target admin (the
  // acting admin never sees a password). ROOT targets create a
  // dual-control ticket that a SECOND admins.manage holder must confirm.
  const resetPassword = async (admin: AdminRow) => {
    if (
      !window.confirm(
        admin.isRoot
          ? `Initiate a password reset for ROOT admin ${admin.name}? A second authorized administrator must confirm the ticket before the reset email is sent.`
          : `Send a single-use password reset link to ${admin.email}? Their active sessions will be signed out when they set the new password.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const result = await gate(() =>
        platformApi<{ dualControl: boolean; message?: string; ticketId?: string }>(
          `/api/platform/admins/${admin.id}/reset-password`,
          { method: 'POST' },
        ),
      )
      if (result === undefined) return
      if (result.dualControl) {
        toast.info(
          `Dual-control ticket created — a second authorized administrator must confirm it (15-minute window).`,
        )
      } else {
        toast.success(`Reset link sent to ${admin.email}`)
      }
      await load()
      await loadRecovery()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to send the reset link')
    } finally {
      setBusy(false)
    }
  }

  // Emergency Google-identity removal for a locked-out admin (root
  // targets: dual-control ticket, same as password reset).
  const adminUnlinkGoogle = async (admin: AdminRow) => {
    if (
      !window.confirm(
        admin.isRoot
          ? `Unlink the Google identity from ROOT admin ${admin.name}? A second authorized administrator must confirm the ticket.`
          : `Unlink the Google identity from ${admin.name}? Their sessions will be revoked.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const result = await gate(() =>
        platformApi<{ dualControl: boolean; message?: string; ticketId?: string }>(
          `/api/platform/admins/${admin.id}/google-unlink`,
          { method: 'POST' },
        ),
      )
      if (result === undefined) return
      if (result.dualControl) {
        toast.info('Dual-control ticket created — a second administrator must confirm it.')
      } else {
        toast.success(`Google identity unlinked from ${admin.name}`)
      }
      await load()
      await loadRecovery()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to unlink the Google identity')
    } finally {
      setBusy(false)
    }
  }

  // ---- ACCOUNT-RECOVERY: dual-control ticket confirmation (the second
  // person). The server refuses when the confirmer is the initiator or
  // the target — the button is hidden for those roles here as UX.
  const confirmRecovery = async (ticket: RecoveryTicketRow) => {
    if (
      !window.confirm(
        `Confirm the ${ticket.action === 'PASSWORD_RESET' ? 'password reset' : 'Google unlink'} for ${ticket.target.name ?? ticket.target.id}? This executes the recovery action immediately.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const result = await gate(() =>
        platformApi<{ message?: string }>(
          `/api/platform/admins/recovery/${ticket.id}/confirm`,
          { method: 'POST' },
        ),
      )
      if (result === undefined) return
      toast.success(result.message ?? 'Recovery ticket executed')
      await load()
      await loadRecovery()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to confirm the recovery ticket')
      await loadRecovery()
    } finally {
      setBusy(false)
    }
  }

  // ---- render helpers ----
  const PermissionList = ({ admin }: { admin: AdminRow }) => {
    const self = isSelf(admin)
    const locked = admin.isRoot || self || !canManage
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-700 mb-1">Capabilities</p>
        {admin.isRoot ? (
          <p className="text-xs text-slate-500 mb-3">
            Root admin — holds <span className="text-emerald-700">all capabilities (root)</span>.
            Suspend the account to remove access; individual grants do not apply.
          </p>
        ) : self ? (
          <p className="text-xs text-slate-500 mb-3">
            <span className="text-amber-700">You cannot modify your own permissions</span> —
            ask another root admin for changes.
          </p>
        ) : (
          <p className="text-xs text-slate-500 mb-3">
            {admin.grants.length} of {admin.permissionCatalog.length} capabilities granted.
            Changes require step-up verification and are audited.
          </p>
        )}
        <ul className="space-y-0.5">
          {admin.permissionCatalog.map((key) => {
            const granted = admin.isRoot || admin.grants.includes(key)
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-4 rounded-lg px-3 -mx-3 py-2.5 hover:bg-slate-50 transition-colors"
                title={self ? 'cannot modify own permissions' : undefined}
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">
                    {PERMISSION_LABELS[key] ?? key}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400">{key}</p>
                </div>
                <Switch
                  checked={granted}
                  disabled={locked || busy}
                  aria-label={`${PERMISSION_LABELS[key] ?? key} for ${admin.name}`}
                  title={self ? 'cannot modify own permissions' : undefined}
                  onCheckedChange={(v) => void togglePermission(admin, key, v)}
                  className="data-[state=checked]:bg-teal-600 focus-ring"
                />
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <section aria-labelledby="admins-heading" className="space-y-5">
      {stepUpNode}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1
            id="admins-heading"
            className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5"
          >
            <span className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
              <Users className="h-4.5 w-4.5 text-teal-600" aria-hidden="true" />
            </span>
            Platform admins
          </h1>
          <p className="text-sm text-slate-500 mt-2 max-w-2xl">
            Accounts that can sign in to the control plane. Every change here is step-up gated and
            audited.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={!canManage}
          className="h-11 px-5 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Create admin
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      {/* Forbidden (direct visit without admins.manage) */}
      {forbidden && (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardContent className="p-10 text-center space-y-2">
            <ShieldAlert className="h-8 w-8 text-amber-600 mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-900">Root plane — restricted</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Your account lacks the <code className="font-mono">admins.manage</code> capability.
              The server rejected the roster request (403).
            </p>
          </CardContent>
        </Card>
      )}

      {/* ACCOUNT-RECOVERY — pending dual-control tickets (root recovery).
          The SECOND-person queue: tickets another authorized admin
          initiated against a root account, awaiting a distinct
          confirmation. Hidden entirely when empty. */}
      {!loading && canManage && recoveryTickets.length > 0 && (
        <Card className="rounded-xl border-amber-200 bg-amber-50/60 shadow-sm">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-4.5 w-4.5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Root recovery — awaiting a second administrator
                </p>
                <p className="text-xs text-slate-500">
                  Dual-control tickets expire 15 minutes after initiation. A ticket cannot be
                  confirmed by its initiator or by the account it targets.
                </p>
              </div>
            </div>
            <ul className="space-y-2">
              {recoveryTickets.map((t) => {
                const selfInitiated = Boolean(me && me.admin.id === t.initiatedBy.id)
                const selfTarget = Boolean(me && me.admin.id === t.target.id)
                const locked = selfInitiated || selfTarget
                return (
                  <li
                    key={t.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm text-slate-900">
                        <span className="font-semibold">
                          {t.action === 'PASSWORD_RESET' ? 'Password reset' : 'Google unlink'}
                        </span>{' '}
                        for <span className="font-semibold">{t.target.name ?? t.target.id}</span>
                        <span className="text-slate-400"> · root account</span>
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        Initiated by {t.initiatedBy.name ?? t.initiatedBy.email ?? t.initiatedBy.id} ·
                        expires {new Date(t.expiresAt).toLocaleTimeString()}
                      </p>
                      {locked && (
                        <p className="text-[11px] text-amber-700">
                          {selfInitiated
                            ? 'You initiated this ticket — another administrator must confirm it.'
                            : 'This ticket targets your account — another administrator must confirm it.'}
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => void confirmRecovery(t)}
                      disabled={busy || locked}
                      className="h-10 px-4 bg-amber-600 hover:bg-amber-700 text-white font-semibold focus-ring shrink-0"
                    >
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      Confirm &amp; execute
                    </Button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Skeletons */}
      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl bg-slate-200" />
          ))}
        </div>
      )}

      {/* Roster */}
      {!loading && !forbidden && admins.length > 0 && (
        <>
          {/* Table (≥ sm) */}
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <Table className="text-slate-700">
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-slate-500 font-medium h-11">Admin</TableHead>
                  <TableHead className="text-slate-500 font-medium">Status</TableHead>
                  <TableHead className="text-slate-500 font-medium">Role</TableHead>
                  <TableHead className="text-slate-500 font-medium">Created</TableHead>
                  <TableHead className="text-slate-500 font-medium text-right">Grants</TableHead>
                  <TableHead className="text-slate-500 font-medium sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((a) => {
                  const open = expanded === a.id
                  return (
                    <React.Fragment key={a.id}>
                      <TableRow
                        className="cursor-pointer border-slate-200 hover:bg-slate-50"
                        onClick={() => setExpanded(open ? null : a.id)}
                        aria-expanded={open}
                        aria-label={`Toggle capabilities for ${a.name}`}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setExpanded(open ? null : a.id)
                          }
                        }}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <ChevronDown
                              className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                                open ? 'rotate-180' : ''
                              }`}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-slate-900">
                                {a.name}
                                {isSelf(a) && (
                                  <span className="ml-1.5 text-[10px] text-slate-500">(you)</span>
                                )}
                              </span>
                              <span className="block truncate text-[11px] text-slate-500">
                                {a.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              a.status === 'ACTIVE'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-red-200 bg-red-50 text-red-600'
                            }
                          >
                            {a.status === 'ACTIVE' ? 'active' : 'suspended'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {a.isRoot && (
                              <Badge
                                variant="outline"
                                className="border-emerald-200 bg-emerald-50 text-emerald-700"
                              >
                                ROOT
                              </Badge>
                            )}
                            {a.isDemo && (
                              <Badge
                                variant="outline"
                                className="border-slate-200 bg-slate-100 text-slate-600"
                              >
                                demo
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                          {when(a.createdAt)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-slate-600">
                          {a.isRoot ? 'all' : `${a.grants.length}/${a.permissionCatalog.length}`}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            {/* ACCOUNT-RECOVERY — credential recovery actions */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void resetPassword(a)}
                              disabled={busy || a.status !== 'ACTIVE'}
                              aria-label={`Send password reset link to ${a.name}`}
                              title="Email a single-use password reset link (root targets need a second admin's confirmation)"
                              className="h-9 px-3 border-slate-200 bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-ring"
                            >
                              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                              Reset
                            </Button>
                            {a.googleLinked && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void adminUnlinkGoogle(a)}
                                disabled={busy}
                                aria-label={`Unlink Google identity from ${a.name}`}
                                title="Remove the linked Google identity (root targets need a second admin's confirmation)"
                                className="h-9 px-3 border-slate-200 bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-ring"
                              >
                                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                                Unlink
                              </Button>
                            )}
                            {a.status === 'ACTIVE' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSuspendTarget(a)}
                                disabled={isSelf(a) || busy}
                                aria-label={`Suspend ${a.name}`}
                                title={isSelf(a) ? 'You cannot suspend your own account' : undefined}
                                className="h-9 px-3.5 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                              >
                                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                Suspend
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void reactivate(a)}
                                disabled={busy}
                                aria-label={`Reactivate ${a.name}`}
                                className="h-9 px-3.5 border-emerald-200 bg-transparent text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 focus-ring"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="border-slate-200 hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-slate-50 py-4">
                            <PermissionList admin={a} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Cards (mobile) */}
          <div className="sm:hidden space-y-3">
            {admins.map((a) => {
              const open = expanded === a.id
              return (
                <div
                  key={a.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {a.name}
                        {isSelf(a) && <span className="ml-1.5 text-[10px] text-slate-500">(you)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{a.email}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        a.status === 'ACTIVE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-red-200 bg-red-50 text-red-600'
                      }
                    >
                      {a.status === 'ACTIVE' ? 'active' : 'suspended'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.isRoot && (
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        ROOT
                      </Badge>
                    )}
                    {a.isDemo && (
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-slate-100 text-slate-600"
                      >
                        demo
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-100 text-slate-600 tabular-nums"
                    >
                      {a.isRoot ? 'all grants' : `${a.grants.length} grants`}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    Created {when(a.createdAt)}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(open ? null : a.id)}
                    aria-expanded={open}
                    className="w-full h-11 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                    {open ? 'Hide capabilities' : 'Capabilities'}
                  </Button>
                  {open && <PermissionList admin={a} />}
                  {/* ACCOUNT-RECOVERY — mobile recovery actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void resetPassword(a)}
                      disabled={busy || a.status !== 'ACTIVE'}
                      className="h-11 border-slate-200 bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-ring"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      Reset password
                    </Button>
                    {a.googleLinked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void adminUnlinkGoogle(a)}
                        disabled={busy}
                        className="h-11 border-slate-200 bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-ring"
                      >
                        <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                        Unlink Google
                      </Button>
                    ) : (
                      <div />
                    )}
                  </div>
                  {a.status === 'ACTIVE' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSuspendTarget(a)}
                      disabled={isSelf(a) || busy}
                      title={isSelf(a) ? 'You cannot suspend your own account' : undefined}
                      className="w-full h-11 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void reactivate(a)}
                      disabled={busy}
                      className="w-full h-11 border-emerald-200 bg-transparent text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 focus-ring"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reactivate
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Create-admin dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <UserPlus className="h-4 w-4 text-teal-600" aria-hidden="true" />
              Create platform admin
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              A new control-plane account with its own credentials and permissions.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void createAdmin()
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="adm-name" className="text-xs font-semibold text-slate-700">
                  Name
                </label>
                <Input
                  id="adm-name"
                  value={form.name}
                  required
                  maxLength={80}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Dana Operations"
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11 focus-visible:ring-teal-500/40"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adm-email" className="text-xs font-semibold text-slate-700">
                  Email
                </label>
                <Input
                  id="adm-email"
                  type="email"
                  value={form.email}
                  required
                  autoComplete="off"
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="ops@scholario.io"
                  className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11 focus-visible:ring-teal-500/40"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="adm-password" className="text-xs font-semibold text-slate-700">
                Password
              </label>
              <Input
                id="adm-password"
                type="password"
                value={form.password}
                required
                minLength={8}
                autoComplete="new-password"
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 h-11 focus-visible:ring-teal-500/40"
              />
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <Checkbox
                id="adm-root"
                checked={form.isRoot}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isRoot: v === true }))}
                className="mt-0.5 data-[state=checked]:border-teal-600 data-[state=checked]:bg-teal-600"
              />
              <div>
                <label htmlFor="adm-root" className="text-sm font-medium text-slate-900">
                  Root admin
                </label>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Root admins hold every capability by design and cannot be scoped — grant
                  rarely.
                </p>
              </div>
            </div>
            {!form.isRoot && (
              <fieldset className="space-y-1.5" disabled={form.isRoot}>
                <legend className="text-xs font-semibold text-slate-700 mb-1.5">
                  Capabilities
                </legend>
                {[
                  'schools.read',
                  'schools.manage',
                  'schools.provision',
                  'billing.manage',
                  'announcements.manage',
                  'settings.manage',
                  'audit.read',
                  'support.access',
                  'admins.manage',
                ].map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-lg px-3 -mx-3 py-2 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={form.permissions.has(key)}
                      onCheckedChange={(v) =>
                        setForm((f) => {
                          const next = new Set(f.permissions)
                          if (v === true) next.add(key)
                          else next.delete(key)
                          return { ...f, permissions: next }
                        })
                      }
                      className="data-[state=checked]:border-teal-600 data-[state=checked]:bg-teal-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-700">
                        {PERMISSION_LABELS[key] ?? key}
                      </span>
                      <span className="block text-[10px] font-mono text-slate-400">{key}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 h-11"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="bg-teal-600 hover:bg-teal-700 text-white h-11 font-semibold focus-ring"
              >
                {creating ? 'Creating…' : 'Create admin'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Enrollment — show once */}
      <Dialog
        open={Boolean(enrollment)}
        onOpenChange={(v) => {
          if (!v) setEnrollment(null)
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <KeyRound className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Enrollment — show once
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Store this now — it will not be shown again. The new admin scans it into their
              authenticator app.
            </DialogDescription>
          </DialogHeader>
          {enrollment && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">TOTP secret</p>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 min-w-0 select-all truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-emerald-700"
                    aria-label="TOTP secret"
                  >
                    {enrollment.totpSecret}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void copyText(enrollment.totpSecret)}
                    aria-label="Copy TOTP secret"
                    className="h-11 w-11 shrink-0 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">Authenticator URI</p>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 min-w-0 select-all truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[11px] text-slate-600"
                    aria-label="otpauth URL"
                  >
                    {enrollment.otpauthUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void copyText(enrollment.otpauthUrl)}
                    aria-label="Copy authenticator URI"
                    className="h-11 w-11 shrink-0 border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 focus-ring"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700" role="alert">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                Store this now — it will not be shown again. The new admin scans it into their
                authenticator app.
              </p>
              <Button
                onClick={() => setEnrollment(null)}
                className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-semibold focus-ring"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                I&apos;ve stored it — close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suspend confirm */}
      <AlertDialog
        open={Boolean(suspendTarget)}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
      >
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">
              Suspend {suspendTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              Their account is blocked from signing in and <span className="text-slate-700">all
              live sessions are revoked immediately</span>. The suspension is audited and
              reversible (reactivate).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={suspending}
              className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-11"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void suspend()
              }}
              disabled={suspending}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {suspending ? 'Suspending…' : 'Suspend admin'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
