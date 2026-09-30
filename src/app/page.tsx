'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/store/auth-store'
import { installApiBearerInterceptor } from '@/lib/auth-session-token'
import { AssetErrorBoundary } from '@/components/shared/asset-guard/asset-error-boundary'

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
  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center">
      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 animate-pulse shadow-lg shadow-emerald-500/30" />
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
      } else if (role === 'student') {
        void import('@/lib/store/students-store').then((m) => m.syncStudentsFromServer())
      }
    }
  }, [isAuthenticated, user?.role])

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
      <div className="min-h-screen mesh-bg flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 animate-pulse shadow-lg shadow-emerald-500/30" />
      </div>
    )
  }

  // If user is logged in, show their dashboard directly. PHASE 6: the
  // school SPA renders SCHOOL roles only — a spoofed client-side role
  // ('superadmin') matches no branch and falls through to the public
  // website; platform identity lives exclusively in the /platform
  // namespace with server-side session validation.
  if (isAuthenticated && user) {
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
