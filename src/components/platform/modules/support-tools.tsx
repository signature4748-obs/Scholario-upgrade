'use client'

// ============================================================
// SupportToolsModule — /platform/support (PHASE 6 console)
// ------------------------------------------------------------
// Two read-first surfaces (support.access):
//   · Support-session registry — every support session ever opened,
//     with live revoke for active ones.
//   · School-session browser — live school-user sessions with
//     force-sign-out (revokes ONE session, audited both planes).
// Support sessions are explicit, reason-required, time-boxed and
// READ-ONLY — no school session is ever minted.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import {
  LifeBuoy,
  Ban,
  MonitorSmartphone,
  Clock,
  ShieldCheck,
  Info,
} from 'lucide-react'
import { platformApi, type PlatformApiError } from '../platform-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  user: { id: string; name: string | null; email: string; role: string }
  schoolName: string | null
  createdAt: string
  expiresAt: string
  userAgent: string | null
}

interface SchoolOption {
  id: string
  name: string
  slug: string
}

/**
 * Tiny user-agent summarizer — CLIENT-ONLY (server UA parsing lives in
 * '@/lib/auth' which imports next/headers and cannot be bundled here).
 */
function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  const parts = [browser, os].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : 'Unknown device'
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "12m left" / "expired 3h ago" style label for a support session. */
function expiresIn(from: string, to: string): { text: string; tone: 'live' | 'muted' } {
  const ms = new Date(to).getTime() - Date.now()
  if (ms <= 0) return { text: 'window closed', tone: 'muted' }
  const mins = Math.round(ms / 60_000)
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    return { text: `${h}h ${mins % 60}m left`, tone: 'live' }
  }
  return { text: `${mins}m left`, tone: 'live' }
}

const ROLE_TONE: Record<string, string> = {
  PRINCIPAL: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  TEACHER: 'border-amber-200 bg-amber-50 text-amber-700',
  STUDENT: 'border-slate-200 bg-slate-100 text-slate-700',
}

function roleBadgeClass(role: string): string {
  return ROLE_TONE[role.toUpperCase()] ?? 'border-slate-200 bg-slate-100 text-slate-600'
}

export function SupportToolsModule() {
  // Support-session registry
  const [supportSessions, setSupportSessions] = useState<SupportSessionRow[]>([])
  const [supportLoading, setSupportLoading] = useState(true)
  const [supportError, setSupportError] = useState<string | null>(null)
  const [revokeSupportId, setRevokeSupportId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  // School-session browser
  const [schoolSessions, setSchoolSessions] = useState<SchoolSessionRow[]>([])
  const [schoolLoading, setSchoolLoading] = useState(true)
  const [schoolError, setSchoolError] = useState<string | null>(null)
  const [schoolFilter, setSchoolFilter] = useState<string>('all')
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([])
  const [schoolOptionsError, setSchoolOptionsError] = useState<string | null>(null)
  const [revokeSchoolTarget, setRevokeSchoolTarget] = useState<SchoolSessionRow | null>(null)
  const [revokingSchool, setRevokingSchool] = useState(false)

  const loadSupport = useCallback(async () => {
    setSupportLoading(true)
    setSupportError(null)
    try {
      const body = await platformApi<{ sessions: SupportSessionRow[] }>(
        '/api/platform/support/sessions',
      )
      setSupportSessions(body.sessions)
    } catch (e) {
      const err = e as PlatformApiError
      setSupportError(err.error || 'Failed to load the support-session registry')
    } finally {
      setSupportLoading(false)
    }
  }, [])

  const loadSchoolSessions = useCallback(async (schoolId: string) => {
    setSchoolLoading(true)
    setSchoolError(null)
    try {
      const url = schoolId === 'all' ? '/api/platform/school-sessions' : `/api/platform/school-sessions?schoolId=${encodeURIComponent(schoolId)}`
      const body = await platformApi<{ sessions: SchoolSessionRow[] }>(url)
      setSchoolSessions(body.sessions)
    } catch (e) {
      const err = e as PlatformApiError
      setSchoolError(err.error || 'Failed to load school sessions')
    } finally {
      setSchoolLoading(false)
    }
  }, [])

  // School options for the filter (schools.read is implied by
  // support.access in practice; still tolerate a 403 gracefully).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const body = await platformApi<{ schools: SchoolOption[] }>('/api/platform/schools')
        if (!cancelled) {
          setSchoolOptions(body.schools)
          setSchoolOptionsError(null)
        }
      } catch {
        if (!cancelled) setSchoolOptionsError('School filter unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadSupport()
  }, [loadSupport])

  useEffect(() => {
    void loadSchoolSessions(schoolFilter)
  }, [schoolFilter, loadSchoolSessions])

  const revokeSupportSession = async () => {
    if (!revokeSupportId) return
    setRevoking(true)
    try {
      await platformApi(`/api/platform/support/sessions/${revokeSupportId}/revoke`, {
        method: 'POST',
      })
      toast.success('Support session revoked')
      setRevokeSupportId(null)
      await loadSupport()
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to revoke the support session')
    } finally {
      setRevoking(false)
    }
  }

  const revokeSchoolSession = async () => {
    if (!revokeSchoolTarget) return
    setRevokingSchool(true)
    try {
      await platformApi(`/api/platform/school-sessions/${revokeSchoolTarget.id}/revoke`, {
        method: 'POST',
      })
      toast.success(`Force-signed out ${revokeSchoolTarget.user.name ?? revokeSchoolTarget.user.email}`)
      setRevokeSchoolTarget(null)
      await loadSchoolSessions(schoolFilter)
    } catch (e) {
      const err = e as PlatformApiError
      toast.error(err.error || 'Failed to revoke the school session')
    } finally {
      setRevokingSchool(false)
    }
  }

  const supportRevokeTarget = supportSessions.find((s) => s.id === revokeSupportId)

  return (
    <section aria-labelledby="support-heading" className="space-y-6">
      {/* Header + model explainer */}
      <div>
        <h1
          id="support-heading"
          className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5"
        >
          <span className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <LifeBuoy className="h-4.5 w-4.5 text-amber-600" aria-hidden="true" />
          </span>
          Support tools
        </h1>
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          Support sessions are explicit, reason-required, time-boxed and READ-ONLY. No school
          session is minted — oversight views never impersonate a school user.
        </p>
      </div>

      {/* ============ Support-session registry ============ */}
      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900 text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Support-session registry
          </CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            Every oversight session opened from a school record — live, expired or revoked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {supportError && (
            <p role="alert" className="text-sm text-red-600">
              {supportError}
            </p>
          )}
          {supportLoading && (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg bg-slate-200" />
              ))}
            </div>
          )}
          {!supportLoading && !supportError && supportSessions.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              No support sessions have been opened yet.
            </p>
          )}
          {!supportLoading &&
            supportSessions.map((s) => {
              const window = expiresIn(s.createdAt, s.expiresAt)
              const expiredNoRevoke = s.revokedAt || !s.live
              return (
                <div
                  key={s.id}
                  className={`rounded-lg border p-4 space-y-2 ${
                    s.live
                      ? 'border-slate-300 bg-slate-50'
                      : 'border-slate-200 bg-slate-50 opacity-60'
                  }`}
                  aria-label={`Support session for ${s.school?.name ?? 'unknown school'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {s.live ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <span className="relative flex h-2 w-2" aria-hidden="true">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                        </span>
                        live
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-slate-100 text-slate-600"
                      >
                        {s.revokedAt ? 'revoked' : 'expired'}
                      </Badge>
                    )}
                    <span className="text-sm font-semibold text-slate-900">
                      {s.school?.name ?? 'Unknown school'}
                    </span>
                    <span className="text-xs text-slate-500">
                      by {s.admin?.name ?? 'unknown admin'}
                    </span>
                    {s.live && window.tone === 'live' && (
                      <span className="ml-auto text-xs tabular-nums text-emerald-700">
                        {window.text}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 leading-snug">
                    <span className="text-slate-500">Reason: </span>
                    {s.reason}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 tabular-nums">
                    <span>{s.durationMinutes} min granted</span>
                    <span>opened {when(s.createdAt)}</span>
                    <span>expires {when(s.expiresAt)}</span>
                    {s.revokedAt && <span>revoked {when(s.revokedAt)}</span>}
                  </div>
                  {s.live && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevokeSupportId(s.id)}
                      disabled={revoking}
                      className="h-9 px-3.5 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      Revoke
                    </Button>
                  )}
                  {expiredNoRevoke && !s.revokedAt && (
                    <p className="text-[11px] text-slate-400">Read-only window has ended.</p>
                  )}
                </div>
              )
            })}
        </CardContent>
      </Card>

      {/* ============ School-session browser ============ */}
      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="gap-3">
          <CardTitle className="text-slate-900 text-base font-semibold flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-teal-600" aria-hidden="true" />
            School sessions
          </CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            Live school-user sessions. Revoking force-signs the user out on their next request.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label htmlFor="school-filter" className="text-xs text-slate-600 font-medium">
              School
            </label>
            <Select value={schoolFilter} onValueChange={setSchoolFilter}>
              <SelectTrigger
                id="school-filter"
                className="w-56 h-11 bg-white border-slate-200 text-slate-900 focus-ring"
              >
                <SelectValue placeholder="All schools" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-900">
                <SelectItem value="all">All schools</SelectItem>
                {schoolOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {schoolOptionsError && (
              <p className="text-xs text-slate-500" role="note">
                <Info className="inline h-3 w-3 mr-1" aria-hidden="true" />
                {schoolOptionsError} — showing the platform-wide list.
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {schoolError && (
            <p role="alert" className="text-sm text-red-600 mb-3">
              {schoolError}
            </p>
          )}
          {schoolLoading && (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg bg-slate-200" />
              ))}
            </div>
          )}

          {!schoolLoading && !schoolError && schoolSessions.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              No live school sessions {schoolFilter === 'all' ? '' : 'for this school'}.
            </p>
          )}

          {!schoolLoading && schoolSessions.length > 0 && (
            <>
              {/* Table (≥ sm) */}
              <div className="hidden sm:block rounded-lg border border-slate-200 overflow-hidden">
                <Table className="text-slate-700">
                  <TableHeader>
                    <TableRow className="border-slate-200 hover:bg-transparent">
                      <TableHead className="text-slate-500 font-medium h-11">User</TableHead>
                      <TableHead className="text-slate-500 font-medium">Role</TableHead>
                      <TableHead className="text-slate-500 font-medium">School</TableHead>
                      <TableHead className="text-slate-500 font-medium">Device</TableHead>
                      <TableHead className="text-slate-500 font-medium">Signed in</TableHead>
                      <TableHead className="text-slate-500 font-medium">Expires</TableHead>
                      <TableHead className="text-slate-500 font-medium sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schoolSessions.map((s) => (
                      <TableRow key={s.id} className="border-slate-200">
                        <TableCell className="max-w-[14rem]">
                          <span className="block truncate font-medium text-slate-900">
                            {s.user.name ?? s.user.email}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {s.user.email}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={roleBadgeClass(s.user.role)}>
                            {s.user.role.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[9rem] truncate text-slate-600">
                          {s.schoolName ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {describeUserAgent(s.userAgent)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                          {when(s.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                          {when(s.expiresAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRevokeSchoolTarget(s)}
                            disabled={revokingSchool}
                            aria-label={`Force-sign-out ${s.user.name ?? s.user.email}`}
                            className="h-9 px-3.5 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                          >
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Cards (mobile) */}
              <div className="sm:hidden space-y-3">
                {schoolSessions.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {s.user.name ?? s.user.email}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">{s.user.email}</p>
                      </div>
                      <Badge variant="outline" className={roleBadgeClass(s.user.role)}>
                        {s.user.role.toLowerCase()}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-slate-500">School</dt>
                      <dd className="text-slate-600 truncate">{s.schoolName ?? '—'}</dd>
                      <dt className="text-slate-500">Device</dt>
                      <dd className="text-slate-600">{describeUserAgent(s.userAgent)}</dd>
                      <dt className="text-slate-500">Signed in</dt>
                      <dd className="text-slate-500 tabular-nums">{when(s.createdAt)}</dd>
                      <dt className="text-slate-500">Expires</dt>
                      <dd className="text-slate-500 tabular-nums">{when(s.expiresAt)}</dd>
                    </dl>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevokeSchoolTarget(s)}
                      disabled={revokingSchool}
                      aria-label={`Force-sign-out ${s.user.name ?? s.user.email}`}
                      className="w-full h-11 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      Revoke session
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Revoke support-session confirm */}
      <AlertDialog
        open={Boolean(revokeSupportId)}
        onOpenChange={(v) => !v && setRevokeSupportId(null)}
      >
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">Revoke support session?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              The oversight window for{' '}
              <span className="text-slate-700">
                {supportRevokeTarget?.school?.name ?? 'this school'}
              </span>{' '}
              closes immediately and is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={revoking}
              className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-11"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void revokeSupportSession()
              }}
              disabled={revoking}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {revoking ? 'Revoking…' : 'Revoke session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke school-session confirm */}
      <AlertDialog
        open={Boolean(revokeSchoolTarget)}
        onOpenChange={(v) => !v && setRevokeSchoolTarget(null)}
      >
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">
              Force-sign-out {revokeSchoolTarget?.user.name ?? revokeSchoolTarget?.user.email}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              Their session is destroyed and they return to the school login page on their next
              request. The action is recorded on both the platform and school audit trails.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={revokingSchool}
              className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-11"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void revokeSchoolSession()
              }}
              disabled={revokingSchool}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {revokingSchool ? 'Revoking…' : 'Force sign-out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
