'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/store/auth-store'
import { installApiBearerInterceptor } from '@/lib/auth-session-token'
import { LoginPage } from '@/components/login/login-page'

// Install once, before any component can fire an API call — same boot
// contract as the root route (embedded iframe contexts ride the Bearer
// header because the session cookie is blocked there).
installApiBearerInterceptor()

/**
 * /login — the tenant-scoped SCHOOL login (PRODUCT-DIRECTION RESET, Part 7).
 *
 * hawkingshighschool.com/login → Hawkings tenant login.
 * greenvalleyschool.com/login  → Green Valley tenant login.
 *
 * The tenant is resolved the SAME way as the public website: the Host
 * header (custom domain) or the explicit ?tenant= / ?slug= development
 * fallback link. There is no platform-wide school picker here — a
 * visitor who reaches /login without a resolvable tenant is sent back
 * to the SCHOLARIO SaaS website (that is the platform root, not a
 * school door).
 *
 * Authorization is unchanged: the login POST authenticates against the
 * server-side credential store and the session cookie is HttpOnly; the
 * tenant context for every ERP API comes from that server-side session,
 * never from this page's URL.
 */

function LoginRouteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantParam = searchParams.get('tenant') ?? searchParams.get('slug')

  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const hydrated = useAuth((s) => s.hydrated)

  // 'probing' until we know a tenant actually owns this request; a
  // domain-resolved visit (no param) needs one anonymous probe against
  // /api/schools/public to learn whether any tenant resolves.
  const [tenantState, setTenantState] = useState<'probing' | 'resolved' | 'unresolved'>(
    tenantParam ? 'resolved' : 'probing',
  )

  // Same boot contract as the root route: rehydrate the persisted auth
  // cache (it is a CACHE, never the authority — the server session is).
  useEffect(() => {
    useAuth.persist.rehydrate()
    useAuth.setState({ hydrated: true })
  }, [])

  // Domain-resolved probe (only when the URL carries no explicit
  // tenant link): 200 → this hostname is a school domain; 404 → no
  // tenant owns it → this is not a school login door.
  useEffect(() => {
    if (tenantParam) return
    let alive = true
    void fetch('/api/schools/public', { cache: 'no-store' })
      .then((r) => {
        if (alive) setTenantState(r.ok ? 'resolved' : 'unresolved')
      })
      .catch(() => {
        if (alive) setTenantState('unresolved')
      })
    return () => {
      alive = false
    }
  }, [tenantParam])

  // No tenant owns this request → the school login door does not exist
  // here; return to the platform root (the SCHOLARIO SaaS website).
  useEffect(() => {
    if (tenantState === 'unresolved') router.replace('/')
  }, [tenantState, router])

  // Post-login navigation: the server has set the session; hand the
  // user to the school surface (root route boots the ERP panel for the
  // authenticated role). On a custom domain the root IS the school's
  // surface; elsewhere the tenant link keeps the school's context.
  const loginTarget = tenantParam
    ? `/?tenant=${encodeURIComponent(tenantParam)}`
    : '/'
  useEffect(() => {
    if (hydrated && isAuthenticated) router.replace(loginTarget)
  }, [hydrated, isAuthenticated, loginTarget, router])

  if (tenantState !== 'resolved' || (hydrated && isAuthenticated)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  return (
    <LoginPage
      onBackToWebsite={() => router.replace(loginTarget)}
    />
  )
}

export default function LoginRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
        </div>
      }
    >
      <LoginRouteInner />
    </Suspense>
  )
}
