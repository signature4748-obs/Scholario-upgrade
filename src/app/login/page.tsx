'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/store/auth-store'
import { installApiBearerInterceptor } from '@/lib/auth-session-token'
import { LoginPage } from '@/components/login/login-page'
import {
  decideSchoolDoor,
  classifySchoolDoorProbe,
  resolveSchoolDoorProbe,
  SCHOOL_DOOR_CONTINUE_TARGET,
  type SchoolDoorProbeKind,
  type SchoolDoorProbeTruth,
} from '@/lib/school-door'

// Install once, before any component can fire an API call — same boot
// contract as the root route (embedded iframe contexts ride the Bearer
// header because the session cookie is blocked there).
installApiBearerInterceptor()

/**
 * /login — the tenant-scoped SCHOOL login (PRODUCT-DIRECTION RESET, Part 7).
 *
 * hawkingshighschool.com/login → Hawkings tenant login.
 * greenvalleyschool.com/login  → Green Valley tenant login.
 * <app-origin>/login?tenant=x  → tenant x's login (same door as /s/x/login).
 *
 * The tenant is resolved the SAME way as the public website: the Host
 * header (custom domain) or the explicit ?tenant= / ?slug= development
 * fallback link. There is no platform-wide school picker here — a
 * visitor who reaches /login without a resolvable tenant is sent back
 * to the SCHOLARIO SaaS website (that is the platform root, not a
 * school door).
 *
 * DOORS SEMANTICS (2026-10 rebuild — lib/school-door.ts): this route no
 * longer blanket-redirects every cached session to a dashboard (the
 * old `if (hydrated && isAuthenticated) replace('/?tenant=…')` was the
 * auto-bounce defect — and '/?tenant=…' now means the PUBLIC website,
 * so it must never be a post-login target). Instead:
 *   · unauthenticated → the sign-in form for the resolved tenant;
 *   · cached session, server truth = THIS tenant → deliberate continue
 *     to '/' (the session-driven dashboard);
 *   · cached session of ANOTHER tenant → THIS tenant's form (no silent
 *     cross-tenant bounce; the other session is kept);
 *   · domain-resolved door (custom domain, cookies are per-origin) →
 *     any cached session already belongs to this school: continue;
 *   · fresh sign-in below → deliberate continue to '/'.
 *
 * Authorization is unchanged: the login POST authenticates against the
 * server-side credential store and the session cookie is HttpOnly; the
 * tenant context for every ERP API comes from that server-side session,
 * never from this page's URL.
 */

// A hung probe must resolve to the honest form, never an eternal
// spinner (same deadline rationale as the /s/<slug>/login door).
const PROBE_DEADLINE_MS = 8_000

function LoginSkeleton() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
    </div>
  )
}

function LoginRouteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantParam = searchParams.get('tenant') ?? searchParams.get('slug')

  const hydrated = useAuth((s) => s.hydrated)

  // 'probing' until we know a tenant actually owns this request; a
  // domain-resolved visit (no param) needs one anonymous probe against
  // /api/schools/public to learn whether any tenant resolves.
  const [tenantState, setTenantState] = useState<'probing' | 'resolved' | 'unresolved'>(
    tenantParam ? 'resolved' : 'probing',
  )
  // The door decision: 'deciding' until the hydrated cache + (for the
  // domain-resolved door) the tenant probe allow the school-door
  // decision; then 'form' | 'probing' | 'done'.
  const [doorPhase, setDoorPhase] = useState<'deciding' | 'form' | 'probing' | 'done'>('deciding')

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

  // The school-door decision — once the cache has hydrated AND (for a
  // domain-resolved visit) the tenant is known to exist. doorSlug is
  // the explicit ?tenant= link when present; null on a custom domain,
  // where the per-origin session cookie already scopes any session to
  // this exact school.
  useEffect(() => {
    if (!hydrated || tenantState !== 'resolved' || doorPhase !== 'deciding') return

    const decision = decideSchoolDoor({
      doorSlug: tenantParam,
      cachedAuthenticated: useAuth.getState().isAuthenticated,
    })
    if (decision.phase === 'form') {
      setDoorPhase('form')
      return
    }
    if (decision.phase === 'continue') {
      setDoorPhase('done')
      router.replace(decision.target)
      return
    }

    // 'probe' — cached session, explicit tenant link on the shared
    // app origin: only the server can tell whose session this is.
    setDoorPhase('probing')
    let alive = true
    const ctrl = new AbortController()
    const deadline = setTimeout(() => ctrl.abort(), PROBE_DEADLINE_MS)

    void (async () => {
      let kind: SchoolDoorProbeKind = 'unavailable'
      let truth: SchoolDoorProbeTruth | null = null
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store', signal: ctrl.signal })
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { data?: { user?: SchoolDoorProbeTruth } }
            | null
          truth = body?.data?.user ?? null
        }
        kind = classifySchoolDoorProbe(
          tenantParam ?? '',
          { ok: res.ok, status: res.status },
          truth,
        )
      } catch {
        kind = 'unavailable'
      } finally {
        clearTimeout(deadline)
      }
      if (!alive) return

      // RESOLUTION — atomic, in the probe's own step (same contract as
      // the /s/<slug>/login door; see the race rationale there).
      const resolved = resolveSchoolDoorProbe(kind)
      if (kind === 'unauthenticated') {
        useAuth.setState({ user: null, isAuthenticated: false, isAuthenticating: false })
      }
      if (resolved.phase === 'continue') {
        setDoorPhase('done')
        router.replace(resolved.target)
        return
      }
      setDoorPhase('form')
    })()

    return () => {
      alive = false
      clearTimeout(deadline)
    }
    // Boot-once semantics: the decision is made on the hydrated cache a
    // single time; later auth flips are the LoginPage's own continue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tenantState, tenantParam, router])

  // A fresh sign-in completed on the form below (session cookie exists,
  // store flipped): the DELIBERATE continue to '/' — the
  // session-driven dashboard. NEVER '/?tenant=…' (that link means the
  // public website now).
  const handleAuthenticated = () => {
    setDoorPhase('done')
    router.replace(SCHOOL_DOOR_CONTINUE_TARGET)
  }

  if (tenantState !== 'resolved' || doorPhase !== 'form') {
    return <LoginSkeleton />
  }

  return (
    <LoginPage
      tenantSlug={tenantParam ?? undefined}
      onAuthenticated={handleAuthenticated}
      onBackToWebsite={() =>
        router.replace(
          tenantParam ? `/?tenant=${encodeURIComponent(tenantParam)}` : SCHOOL_DOOR_CONTINUE_TARGET,
        )
      }
    />
  )
}

export default function LoginRoute() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginRouteInner />
    </Suspense>
  )
}
