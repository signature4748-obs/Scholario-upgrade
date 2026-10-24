'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
// contract as /login and the root route (embedded iframe contexts ride
// the Bearer header because the session cookie is blocked there).
installApiBearerInterceptor()

/**
 * A hung probe (abandoned socket — documented failure mode on flaky
 * transports) must resolve to the honest form, NEVER an eternal
 * spinner: the "school login page never finishes loading" class of
 * defect is exactly what this door must not reproduce.
 */
const PROBE_DEADLINE_MS = 8_000

function DoorSpinner() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
    </div>
  )
}

/**
 * The client half of the /s/<slug>/login door (2026-10 doors rebuild).
 *
 * SEMANTICS (lib/school-door.ts — the plane-agnostic decision contract):
 *   · unauthenticated → the sign-in form for THIS school;
 *   · cached session, server truth says THIS school → a DELIBERATE
 *     continue to '/' (the session-driven dashboard — the visitor is
 *     already signed into this exact school). NEVER '/?tenant=…':
 *     that link means the PUBLIC website now;
 *   · cached session belonging to a DIFFERENT school → THIS school's
 *     form (no silent cross-tenant bounce; the other-tenant session is
 *     kept — destroying it would sign the visitor out of a school they
 *     never asked to leave);
 *   · stale cache (server 401) → cleared ATOMICALLY in the probe's own
 *     resolution, then the form — a separate cleanup effect is
 *     FORBIDDEN here: it races a fresh in-form sign-in and kills it;
 *   · probe transport failure/timeout → the honest form (the sign-in
 *     POST surfaces any transport problem; the cache is kept — an
 *     unknown truth never justifies destroying client state).
 *
 * Authorization is unchanged: the login POST authenticates against the
 * server-side credential store and binds the session to the user's real
 * schoolId, so a user from another tenant cannot ride this door into
 * this school's data — no session, cookie or middleware behavior was
 * touched by this rebuild.
 */
export function SchoolLoginDoor({ slug }: { slug: string }) {
  const router = useRouter()

  const hydrated = useAuth((s) => s.hydrated)

  // 'boot' until the persisted cache rehydrates, then the school-door
  // decision decides between the form, the server-truth probe and the
  // deliberate continue.
  const [phase, setPhase] = useState<'boot' | 'form' | 'probing' | 'done'>('boot')

  // Rehydrate the persisted auth cache (it is a CACHE, never the
  // authority — the server session is).
  useEffect(() => {
    useAuth.persist.rehydrate()
    useAuth.setState({ hydrated: true })
  }, [])

  // The decision + probe — once, after hydration. The decision reads
  // the store IMPERATIVELY (getState) at effect time so the boot
  // semantics cannot be perturbed by re-renders: the decision is made
  // on the hydrated cache a single time, and a later isAuthenticated
  // flip is the LoginPage's own onAuthenticated continue, never a
  // re-decision. Strict-mode-safe by construction: each effect run
  // owns its probe; the cleanup only discards that run's application.
  useEffect(() => {
    if (!hydrated) return

    const decision = decideSchoolDoor({
      doorSlug: slug,
      cachedAuthenticated: useAuth.getState().isAuthenticated,
    })
    if (decision.phase === 'form') {
      setPhase('form')
      return
    }
    if (decision.phase === 'continue') {
      setPhase('done')
      router.replace(decision.target)
      return
    }

    // decision.phase === 'probe' — cached session on a shared-origin
    // door: only the server can tell whose session this is.
    setPhase('probing')
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
        kind = classifySchoolDoorProbe(slug, { ok: res.ok, status: res.status }, truth)
      } catch {
        // Transport failure or probe deadline — the truth is unknown.
        kind = 'unavailable'
      } finally {
        clearTimeout(deadline)
      }
      if (!alive) return

      // RESOLUTION — atomic, in the probe's own step:
      const resolved = resolveSchoolDoorProbe(kind)
      if (kind === 'unauthenticated') {
        // The cached client session is stale (server 401). Clear it HERE,
        // as part of THIS resolution — never from a separate effect. The
        // form is still not rendered, so no in-form sign-in can be in
        // flight and nothing valid can be destroyed by this write.
        useAuth.setState({ user: null, isAuthenticated: false, isAuthenticating: false })
      }
      if (resolved.phase === 'continue') {
        setPhase('done')
        router.replace(resolved.target)
        return
      }
      // other-school | unauthenticated | unavailable → THIS school's form.
      setPhase('form')
    })()

    return () => {
      alive = false
      clearTimeout(deadline)
    }
  }, [hydrated, slug, router])

  // A fresh sign-in completed on the form below (the session cookie
  // exists — login() flipped only after it did): the DELIBERATE
  // continue to '/' (session-driven dashboard).
  const handleAuthenticated = () => {
    setPhase('done')
    router.replace(SCHOOL_DOOR_CONTINUE_TARGET)
  }

  if (phase === 'boot' || phase === 'probing' || phase === 'done') {
    return <DoorSpinner />
  }

  return (
    <Suspense fallback={<DoorSpinner />}>
      <LoginPage
        tenantSlug={slug}
        onAuthenticated={handleAuthenticated}
        onBackToWebsite={() => router.replace(`/?tenant=${encodeURIComponent(slug)}`)}
      />
    </Suspense>
  )
}
