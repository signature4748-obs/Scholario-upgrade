'use client'

// ============================================================
// SessionsModule — /platform/sessions (PHASE 6 console)
// ------------------------------------------------------------
// YOUR platform sessions, served from the session provider (no extra
// fetch — /api/platform/auth/me is already the source). Revoking a
// non-current session refreshes the list; revoking the current one
// ends the sign-in (the provider redirects on the next 401).
// ============================================================

import React, { useState } from 'react'
import {
  MonitorSmartphone,
  Ban,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  Info,
} from 'lucide-react'
import { usePlatformSession, platformApi, type PlatformApiError } from '../platform-client'
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
import { toast } from 'sonner'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deviceLabel(d: { browser: string; os: string; device: string }): string {
  return [d.browser, d.os, d.device].filter(Boolean).join(' · ') || 'Unknown device'
}

export function SessionsModule() {
  const { me, loading, refresh, logoutAll } = usePlatformSession()
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [logoutAllOpen, setLogoutAllOpen] = useState(false)
  const [loggingOutAll, setLoggingOutAll] = useState(false)

  const devices = me?.devices ?? []
  const revokeTarget = devices.find((d) => d.id === revokeId)

  const revoke = async () => {
    if (!revokeId) return
    setRevoking(true)
    try {
      await platformApi(`/api/platform/sessions/${revokeId}/revoke`, { method: 'POST' })
      toast.success('Session revoked')
      setRevokeId(null)
      // If the CURRENT session was revoked the provider's next refresh
      // gets a 401 and redirects to /platform/login automatically.
      await refresh()
    } catch (e) {
      const err = e as PlatformApiError
      if (err.code === 'RESOURCE_NOT_FOUND') {
        toast.info('That session is already gone')
        setRevokeId(null)
        await refresh()
      } else {
        toast.error(err.error || 'Failed to revoke the session')
      }
    } finally {
      setRevoking(false)
    }
  }

  const signOutAll = async () => {
    setLoggingOutAll(true)
    try {
      // logoutAll() revokes every platform session, clears the local
      // token and redirects to /platform/login.
      await logoutAll()
      toast.success('Signed out of all devices')
    } catch {
      toast.error('Sign-out failed — try again')
    } finally {
      setLoggingOutAll(false)
      setLogoutAllOpen(false)
    }
  }

  return (
    <section aria-labelledby="sessions-heading" className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1
          id="sessions-heading"
          className="font-display text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2.5"
        >
          <span className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
            <MonitorSmartphone className="h-4.5 w-4.5 text-teal-600" aria-hidden="true" />
          </span>
          My sessions
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          Control-plane sessions issued to your admin account. Revoking the current session signs
          you out here.
        </p>
      </div>

      {/* Current session summary */}
      {loading && <Skeleton className="h-28 w-full rounded-xl bg-slate-200" aria-hidden="true" />}
      {me && (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base font-semibold">
              Current session
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              {deviceLabel(me.session.device)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-600 tabular-nums">
              <p>
                <span className="text-slate-500">Expires </span>
                {when(me.session.expiresAt)}
              </p>
              {me.session.stepUpActive ? (
                <p className="flex items-center gap-1.5 text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Step-up verified
                  {me.session.stepUpUntil && (
                    <span className="text-slate-500">until {when(me.session.stepUpUntil)}</span>
                  )}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-amber-700">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Step-up window closed — destructive actions will re-prompt
                </p>
              )}
            </div>
            <p className="flex items-start gap-2 text-[11px] text-slate-500">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              Revoking your current session redirects you to the platform sign-in page.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Device list */}
      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl bg-slate-200" />
          ))}
        </div>
      )}

      {!loading && me && devices.length === 0 && (
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
          <CardContent className="p-10 text-center">
            <MonitorSmartphone className="h-8 w-8 text-slate-400 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-700">No sessions found</p>
            <p className="text-xs text-slate-500 mt-1">
              Your account has no active control-plane sessions.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && devices.length > 0 && (
        <>
          {/* Table (≥ sm) */}
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <Table className="text-slate-700">
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="text-slate-500 font-medium h-11">Device</TableHead>
                  <TableHead className="text-slate-500 font-medium">IP</TableHead>
                  <TableHead className="text-slate-500 font-medium">Signed in</TableHead>
                  <TableHead className="text-slate-500 font-medium">Expires</TableHead>
                  <TableHead className="text-slate-500 font-medium sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id} className="border-slate-200">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="font-medium text-slate-900">
                          {deviceLabel(d.device)}
                        </span>
                        {d.current && (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            This session
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {d.ipAddress ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                      {when(d.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                      {when(d.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!d.current && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRevokeId(d.id)}
                          disabled={revoking}
                          aria-label={`Revoke session on ${deviceLabel(d.device)}`}
                          className="h-9 px-3.5 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Cards (mobile) */}
          <div className="sm:hidden space-y-3">
            {devices.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {deviceLabel(d.device)}
                  </p>
                  {d.current && (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0"
                    >
                      This session
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-xs tabular-nums">
                  <span className="text-slate-500">IP</span>
                  <span className="text-slate-600 font-mono">{d.ipAddress ?? '—'}</span>
                  <span className="text-slate-500">Signed in</span>
                  <span className="text-slate-600">{when(d.createdAt)}</span>
                  <span className="text-slate-500">Expires</span>
                  <span className="text-slate-600">{when(d.expiresAt)}</span>
                </div>
                {!d.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevokeId(d.id)}
                    disabled={revoking}
                    aria-label={`Revoke session on ${deviceLabel(d.device)}`}
                    className="w-full h-11 border-red-200 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-ring"
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Danger zone */}
      <Card className="rounded-xl border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-700 text-base font-semibold">Danger zone</CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            Sign out of every device — all your platform sessions are revoked immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => setLogoutAllOpen(true)}
            disabled={loggingOutAll}
            className="h-11 px-5 border-red-200 bg-transparent text-red-600 hover:bg-red-100 hover:text-red-700 focus-ring font-semibold"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out of ALL devices
          </Button>
        </CardContent>
      </Card>

      {/* Revoke one session */}
      <AlertDialog open={Boolean(revokeId)} onOpenChange={(v) => !v && setRevokeId(null)}>
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">
              Revoke this session?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              {revokeTarget
                ? `The session on ${deviceLabel(revokeTarget.device)} ends immediately.`
                : 'The session ends immediately.'}{' '}
              Anyone using it is returned to the platform sign-in page.
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
                void revoke()
              }}
              disabled={revoking}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {revoking ? 'Revoking…' : 'Revoke session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sign out everywhere */}
      <AlertDialog open={logoutAllOpen} onOpenChange={setLogoutAllOpen}>
        <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">
              Sign out of ALL devices?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              Every platform session for your account is revoked — including the one you are using
              now. You will be returned to the platform sign-in page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={loggingOutAll}
              className="border-slate-300 bg-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900 h-11"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void signOutAll()
              }}
              disabled={loggingOutAll}
              className="bg-red-600 hover:bg-red-500 text-white h-11 font-semibold"
            >
              {loggingOutAll ? 'Signing out…' : 'Sign out everywhere'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
