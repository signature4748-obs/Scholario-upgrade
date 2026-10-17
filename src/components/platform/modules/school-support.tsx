'use client'

// ============================================================
// SchoolSupportTab — school workspace · Support Sessions tab
// ------------------------------------------------------------
// The school's support-session truth (mission §9): audited, explicit,
// limited, revocable support access into THIS tenant — plus the
// tenant's live school-user sessions with force-sign-out.
//
//   · Support sessions — who opened one, why, scope, duration,
//     expiry, and revocation state. Live ones can be revoked here.
//   · School-user sessions — the tenant's active sign-ins, each
//     individually revocable (audited on BOTH planes).
//
// NO unrestricted "log in as school" bypass exists: entry is only via
// the workspace header's "Open Support Session" (reason + duration +
// step-up + audit) — read-only inside the school plane.
//
// Data (all support.access-gated):
//   GET  /api/platform/support/sessions?schoolId=&includeRevoked=
//   POST /api/platform/support/sessions/[id]/revoke
//   GET  /api/platform/school-sessions?schoolId=
//   POST /api/platform/school-sessions/[id]/revoke
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Headset,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface SupportSessionRow {
  id: string
  school: { id: string; name: string; slug: string } | null
  admin: { id: string; name: string; email: string } | null
  reason: string
  durationMinutes: number
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  live: boolean
}

interface SchoolSessionRow {
  id: string
  user: { id: string; name: string; email: string; role: string }
  schoolId: string | null
  schoolName: string | null
  createdAt: string
  expiresAt: string
  userAgent: string | null
  ipAddress: string | null
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

function RevokeConfirmDialog({
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="border-slate-300 bg-white text-slate-700">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SchoolSupportTab({ schoolId }: { schoolId: string }) {
  const [supportSessions, setSupportSessions] = useState<SupportSessionRow[] | null>(null)
  const [schoolSessions, setSchoolSessions] = useState<SchoolSessionRow[] | null>(null)
  const [includeRevoked, setIncludeRevoked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revokeSupport, setRevokeSupport] = useState<SupportSessionRow | null>(null)
  const [revokeUser, setRevokeUser] = useState<SchoolSessionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sup, sch] = await Promise.all([
        platformApi<{ sessions: SupportSessionRow[] }>(
          `/api/platform/support/sessions?schoolId=${schoolId}${includeRevoked ? '&includeRevoked=true' : ''}`,
        ),
        platformApi<{ sessions: SchoolSessionRow[] }>(`/api/platform/school-sessions?schoolId=${schoolId}&limit=50`),
      ])
      setSupportSessions(sup.sessions)
      setSchoolSessions(sch.sessions)
    } catch (e) {
      const pae = e as PlatformApiError
      setError(pae.error || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [schoolId, includeRevoked])

  useEffect(() => {
    void load()
  }, [load])

  const confirmRevokeSupport = async () => {
    if (!revokeSupport) return
    setBusy(true)
    try {
      await platformApi(`/api/platform/support/sessions/${revokeSupport.id}/revoke`, { method: 'POST' })
      toast.success('Support session revoked — audited.')
      setRevokeSupport(null)
      void load()
    } catch (e) {
      toast.error('Revoke failed', { description: (e as PlatformApiError).error || 'unknown error' })
    } finally {
      setBusy(false)
    }
  }

  const confirmRevokeUser = async () => {
    if (!revokeUser) return
    setBusy(true)
    try {
      await platformApi(`/api/platform/school-sessions/${revokeUser.id}/revoke`, { method: 'POST' })
      toast.success(`Session for ${revokeUser.user.name ?? revokeUser.user.email} revoked — audited on both planes.`)
      setRevokeUser(null)
      void load()
    } catch (e) {
      toast.error('Revoke failed', { description: (e as PlatformApiError).error || 'unknown error' })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !supportSessions) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading support sessions">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
          <h2 className="font-display text-sm font-bold text-red-700">Session state unavailable</h2>
        </div>
        <p className="mt-2 text-xs text-slate-500">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()} className="mt-4 h-9 border-slate-300 bg-white text-slate-700">
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  const liveSupport = (supportSessions ?? []).filter((s) => s.live)
  const pastSupport = (supportSessions ?? []).filter((s) => !s.live)

  return (
    <div className="space-y-4" aria-label="Support sessions">
      {/* Support access sessions */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Headset className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Support access sessions
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Explicit, reason-stated, time-limited, audited entry into this tenant (read-only inside the school
              plane). {liveSupport.length} live · {pastSupport.length} ended.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="include-revoked" checked={includeRevoked} onCheckedChange={setIncludeRevoked} />
              <Label htmlFor="include-revoked" className="text-xs text-slate-600">
                Show ended
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              aria-label="Refresh support sessions"
              className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {(includeRevoked ? [...liveSupport, ...pastSupport] : liveSupport).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{s.admin?.name ?? 'unknown admin'}</span>
                  <span className="font-mono text-[11px] text-slate-400">{s.admin?.email}</span>
                  {s.live ? (
                    <Badge variant="outline" className="normal-case border-emerald-200 bg-emerald-50 text-emerald-700">
                      live · {fmtRemaining(s.expiresAt)}
                    </Badge>
                  ) : s.revokedAt ? (
                    <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-500">
                      revoked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="normal-case border-slate-200 bg-slate-50 text-slate-400">
                      expired
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">
                  <span className="text-slate-400">reason:</span> {s.reason}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                  <Clock className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                  opened {fmtDateTime(s.createdAt)} · {s.durationMinutes}min window · expires {fmtDateTime(s.expiresAt)}
                </p>
              </div>
              {s.live && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRevokeSupport(s)}
                  className="h-8 border-red-200 bg-white text-red-600 hover:bg-red-50"
                >
                  Revoke now
                </Button>
              )}
            </li>
          ))}
          {(includeRevoked ? [...liveSupport, ...pastSupport] : liveSupport).length === 0 && (
            <li className="px-4 py-10 text-center text-xs text-slate-400">
              No support sessions {includeRevoked ? 'on record' : 'currently live'} for this school.
            </li>
          )}
        </ul>
      </section>

      {/* School-user sessions */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
          <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Live school-user sessions
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The tenant&apos;s active sign-ins — force-sign-out is audited on both the platform trail and the school&apos;s
            activity log.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {(schoolSessions ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{s.user.name ?? '—'}</span>
                  <Badge variant="outline" className="normal-case border-slate-200 bg-slate-100 text-slate-600">
                    {s.user.role.toLowerCase()}
                  </Badge>
                  <span className="font-mono text-[11px] text-slate-400">{s.user.email}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                  since {fmtDateTime(s.createdAt)} · expires {fmtDateTime(s.expiresAt)}
                  {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRevokeUser(s)}
                className="h-8 border-red-200 bg-white text-red-600 hover:bg-red-50"
              >
                Force sign-out
              </Button>
            </li>
          ))}
          {(schoolSessions ?? []).length === 0 && (
            <li className="px-4 py-10 text-center text-xs text-slate-400">
              No live sessions for this school&apos;s users.
            </li>
          )}
        </ul>
      </section>

      {revokeSupport && (
        <RevokeConfirmDialog
          title="Revoke support session"
          description={`End the live support session ${revokeSupport.admin?.name ?? ''} opened into this school (reason: "${revokeSupport.reason}")? The action is audited; the school plane loses the support view immediately.`}
          confirmLabel="Revoke session"
          busy={busy}
          onCancel={() => setRevokeSupport(null)}
          onConfirm={() => void confirmRevokeSupport()}
        />
      )}
      {revokeUser && (
        <RevokeConfirmDialog
          title="Force sign-out"
          description={`Revoke the live session for ${revokeUser.user.name ?? revokeUser.user.email}? They will need to sign in again. Audited on both planes.`}
          confirmLabel="Force sign-out"
          busy={busy}
          onCancel={() => setRevokeUser(null)}
          onConfirm={() => void confirmRevokeUser()}
        />
      )}
    </div>
  )
}
