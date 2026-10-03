'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/store/auth-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { installApiBearerInterceptor } from '@/lib/auth-session-token'
import { AssetErrorBoundary } from '@/components/shared/asset-guard/asset-error-boundary'
import { SubscriptionLockScreen } from '@/components/shared/subscription-lock-screen'

// Install once, before any component can fire an API call. In embedded
// (cross-site iframe) contexts the session cookie is blocked, so API auth
// rides on the Bearer header instead — see lib/auth-session-token.ts.
installApiBearerInterceptor()

const PublicWebsite = dynamic(() => import('@/components/public-website/public-website').then((m) => m.PublicWebsite), {
  loading: () => <LoadingSpinner />,
})
const LoginPage = dynamic(() => import('@/components/login/login-page').then((m) => m.LoginPage), {
  loading: () => <LoadingSpinner />,
})
const PrincipalPanel = dynamic(() => import('@/components/principal/principal-panel').then((m) => m.PrincipalPanel), {
  loading: () => <LoadingSpinner />,
})
const TeacherPanel = dynamic(() => import('@/components/teacher/teacher-panel').then((m) => m.TeacherPanel), {
  loading: () => <LoadingSpinner />,
})
const StudentPanel = dynamic(() => import('@/components/student/student-panel').then((m) => m.StudentPanel), {
  loading: () => <LoadingSpinner />,
})

function LoadingSpinner() {
  // ARCHITECTURE RESET — neutral boot skeleton: no mesh background, no
  // emerald gradient glow. A quiet white canvas + slate pulse.
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
    </div>
  )
}

export default function Home() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const user = useAuth((s) => s.user)
  const hydrated = useAuth((s) => s.hydrated)
  const [mounted, setMounted] = useState(false)

  // Unauthenticated view states: 'website' | 'portal'
  // (PHASE 6: 'platform' moved to the real /platform route namespace)
  const [viewState, setViewState] = useState<'website' | 'portal'>('website')

  // PERSISTENT LOGIN — server-truth boot probe. 'pending' until the
  // authoritative /api/auth/me answer arrives (probed only when the
  // persisted client state says logged-OUT).
  const [sessionProbe, setSessionProbe] = useState<'pending' | 'done'>('pending')

  useEffect(() => {
    setMounted(true)
    useAuth.persist.rehydrate()
    useAuth.setState({ hydrated: true })
    // Asset Guard (JS-boot probe): the inline watchdog waits for this
    // flag to confirm the React application actually booted. If the
    // scripts fail to load (dev-server restart window) the watchdog
    // replaces the dead skeleton with the branded recovery screen.
    document.documentElement.setAttribute('data-app-hydrated', '1')
  }, [])

  // PERSISTENT LOGIN (server-session restore). The localStorage-persisted
  // auth store is a CACHE, never the authority: browsers (notably Safari/
  // iOS ITP) can evict script-writable storage while the HttpOnly session
  // cookie is still server-side valid. On boot, when the persisted state
  // says logged-OUT, ask the server ONCE before rendering any logged-out
  // surface — a still-valid cookie session restores the dashboard without
  // a re-login, an honest 401 falls through to the public views. The
  // /api/auth/me round trip rides the same transports as every other API
  // call (first-party cookie; dev-iframe Bearer via the interceptor), so
  // embedded previews behave identically. No password/token material is
  // ever stored client-side by this path (production never returns one).
  useEffect(() => {
    if (!mounted || !hydrated) return
    if (sessionProbe !== 'pending') return
    if (isAuthenticated) {
      // Fast path: persisted session present — the AppShell's /api/auth/me
      // fetch (and the 401 dead-session guard) validates it authoritatively.
      setSessionProbe('done')
      return
    }
    let alive = true
    void (async () => {
      await useCurrentUser.getState().refresh()
      if (!alive) return
      const me = useCurrentUser.getState().me
      const serverRole = me?.role?.toLowerCase()
      if (
        me &&
        (serverRole === 'principal' || serverRole === 'teacher' || serverRole === 'student')
      ) {
        // Server-authenticated identity wins over any client guess — the
        // same override contract the login flow uses (id/name/email).
        useAuth.getState().login(serverRole, {
          id: me.id,
          email: me.email,
          name: me.name,
        })
      }
      setSessionProbe('done')
    })()
    return () => {
      alive = false
    }
  }, [mounted, hydrated, isAuthenticated, sessionProbe])

  // Canonical roster sync (Seed → DB → API → UI): replace the mock
  // STU-xxx store universe with the real database roster for the roles
  // that own it. Teacher panels stay on their scoped /api/teacher/*
  // surfaces. Once per session; failures keep the existing store data.
  //
  // PERF (5-e): the students-store family (store + seed-data + server
  // sync, ~86KB source) is imported ON DEMAND here. Logged-out visitors
  // (public website / login) and teachers never download it in the
  // initial page chunk — only a principal/student login pulls it. The
  // sync itself stays once-per-session (module-level promise guard
  // inside server-sync), so re-firing this effect is still free.
  //
  // PHASE 7 (Task 7-a) — the same trigger hydrates the FACULTY store
  // (GET /api/teachers → real Teacher rows incl. User identity) for the
  // principal: the fabricated 20-member seed universe is retired, and
  // every teacher-facing consumer (Teachers module, class cards, salary
  // employees, messaging) follows the canonical server roster.
  useEffect(() => {
    if (isAuthenticated && user) {
      const role = user.role
      if (role === 'principal') {
        void import('@/lib/store/students-store').then((m) => m.syncStudentsFromServer())
        void import('@/lib/store/teachers-store/server-sync').then((m) => m.syncTeachersFromServer())
        // PHASE 7.5 — school configuration (identity/branding/settings JSON)
        // hydrates the settings store's `server` slice; documents, the
        // settings tabs and the app-shell footer follow the DB from then on.
        void import('@/lib/store/school-settings-store/server-sync').then((m) => m.syncSchoolSettingsFromServer())
        // PHASE 8B — canonical payroll (fixed monthly salary + payments)
        // hydrates the salary cache once per session (GET /api/salary).
        void import('@/lib/store/salary-store').then((m) => m.useSalaryStore.getState().hydrate())
      } else if (role === 'student') {
        void import('@/lib/store/students-store').then((m) => m.syncStudentsFromServer())
      } else if (role === 'teacher') {
        // PHASE 8B — the teacher's OWN salary rows (structure + payments)
        // hydrate from the canonical server ledger once per session.
        void import('@/lib/store/salary-store').then((m) => m.useSalaryStore.getState().hydrate())
      }
    }
  }, [isAuthenticated, user?.role])

  // PIH-4c (R8) — the students-store STU-xxx seed universe is DEMO-TIER
  // content. The store now boots honest-empty; the demo corpus is applied
  // ONLY when the server-derived demo signal (/api/auth/me → School.isDemo)
  // confirms the sanctioned demo tenant, and never over a non-pristine
  // store (pristine guard inside makeDemoSeedApplier). Real tenants boot
  // empty, hydrate from the canonical roster sync above — and any legacy
  // STU-xxx universe rehydrated from a pre-gate localStorage (e.g. a
  // teacher-role session, which never runs the roster sync) is evicted
  // so every consumer renders its honest empty state.
  const isDemoTenant = useIsDemoTenant()
  const me = useCurrentUser((s) => s.me)
  const meLoaded = useCurrentUser((s) => s.me !== null)
  useEffect(() => {
    if (!meLoaded) return
    if (isDemoTenant) {
      void import('@/lib/store/students-store').then((m) => m.ensureStudentsDemoSeed())
    } else {
      void import('@/lib/store/students-store').then((m) => m.purgeSeedRosterForRealTenant())
    }
  }, [meLoaded, isDemoTenant])

  // PHASE 6 — the platform control plane moved to the REAL /platform/*
  // route namespace with its own identity boundary. Legacy #platform /
  // #superadmin deep links are redirected there (a full document
  // navigation — the SPA never renders platform UI itself).
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      if (hash === '#platform' || hash === '#superadmin') {
        window.location.replace('/platform')
      } else if (hash === '#portal' || hash === '#login') {
        setViewState('portal')
      }
    }
  }, [])

  // Render a stable skeleton until mounted and hydrated.
  if (!mounted || !hydrated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  // PERSISTENT LOGIN — never render a logged-OUT surface before the
  // authoritative server answer. The classic Safari/iOS failure mode is
  // exactly this race: page loads → session initially appears null →
  // frontend redirects to login → session hydration finishes too late →
  // the user is incorrectly logged out. Keep the skeleton until the
  // /api/auth/me probe completes (it only runs when the persisted client
  // state is logged-out; a healthy persisted session skips straight
  // through, and a dead one is torn down by the existing 401 guard).
  if (!isAuthenticated && sessionProbe !== 'done') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  // If user is logged in, show their dashboard directly. PHASE 6: the
  // school SPA renders SCHOOL roles only — a spoofed client-side role
  // ('superadmin') matches no branch and falls through to the public
  // website; platform identity lives exclusively in the /platform
  // namespace with server-side session validation.
  //
  // FINAL-ACCEPTANCE Phase 10 — ACCOUNT subscription lock: once the
  // server identity (/api/auth/me) is known, a LOCKED account renders
  // the identity + subscription notice INSTEAD of the role panels. The
  // gate is a UI courtesy; withUser enforces it server-side on every
  // module API either way. Until the identity is known (or if /me
  // errors) the normal panel path runs — its API calls will 403/401
  // through the same server-side gate.
  if (isAuthenticated && user) {
    if (me?.subscriptionStatus && me.subscriptionStatus !== 'ACTIVE') {
      return (
        <AssetErrorBoundary>
          <SubscriptionLockScreen user={me} />
        </AssetErrorBoundary>
      )
    }
    if (user.role === 'principal')
      return (
        <AssetErrorBoundary>
          <PrincipalPanel />
        </AssetErrorBoundary>
      )
    if (user.role === 'teacher')
      return (
        <AssetErrorBoundary>
          <TeacherPanel />
        </AssetErrorBoundary>
      )
    if (user.role === 'student')
      return (
        <AssetErrorBoundary>
          <StudentPanel />
        </AssetErrorBoundary>
      )
  }

  // Unauthenticated public views
  if (viewState === 'portal') {
    return (
      <AssetErrorBoundary>
        <LoginPage onBackToWebsite={() => setViewState('website')} />
      </AssetErrorBoundary>
    )
  }

  // Default: Public School Website (the registered school).
  // The platform console is reachable ONLY at /platform (its own route
  // namespace) — never rendered inside the school SPA.
  return (
    <AssetErrorBoundary>
      <PublicWebsite
        onOpenPortal={() => setViewState('portal')}
      />
    </AssetErrorBoundary>
  )
}
