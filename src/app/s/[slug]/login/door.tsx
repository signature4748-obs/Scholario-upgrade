'use client'

import React, { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/store/auth-store'
import { installApiBearerInterceptor } from '@/lib/auth-session-token'
import { LoginPage } from '@/components/login/login-page'

// Install once, before any component can fire an API call — same boot
// contract as /login and the root route (embedded iframe contexts ride
// the Bearer header because the session cookie is blocked there).
installApiBearerInterceptor()

/**
 * The client half of the /s/<slug>/login door — mirrors /login's route
 * behavior with the slug FIXED by the server page (never guessed from
 * the URL by the branding layer). The login POST itself is unchanged:
 * the server binds the session to the user's real schoolId, so a user
 * from another tenant cannot ride this door into this school's data.
 */
export function SchoolLoginDoor({ slug }: { slug: string }) {
  const router = useRouter()

  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const hydrated = useAuth((s) => s.hydrated)

  // Rehydrate the persisted auth cache (it is a CACHE, never the
  // authority — the server session is).
  useEffect(() => {
    useAuth.persist.rehydrate()
    useAuth.setState({ hydrated: true })
  }, [])

  // Already signed in → straight to this school's ERP surface. The
  // tenant link keeps the school context on non-custom-domain origins;
  // on a school custom domain the root IS the school surface.
  const loginTarget = `/?tenant=${encodeURIComponent(slug)}`
  useEffect(() => {
    if (hydrated && isAuthenticated) router.replace(loginTarget)
  }, [hydrated, isAuthenticated, loginTarget, router])

  if (hydrated && isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="h-12 w-12 rounded-2xl bg-slate-200 animate-pulse" />
        </div>
      }
    >
      <LoginPage tenantSlug={slug} onBackToWebsite={() => router.replace(loginTarget)} />
    </Suspense>
  )
}
