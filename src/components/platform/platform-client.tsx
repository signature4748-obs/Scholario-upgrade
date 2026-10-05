'use client'

// ============================================================
// Platform console client — session context + API helpers
// ------------------------------------------------------------
// PHASE 6. The console pages consume this module:
//   · PlatformSessionProvider — bootstraps /api/platform/auth/me,
//     redirects to /platform/login on 401 (the dev-preview client
//     gate; in production the middleware redirects at the edge), and
//     exposes refresh/stepUp/logout actions;
//   · usePlatformSession() — admin, permissions, step-up state;
//   · platformApi() — envelope-aware fetch (all requests carry the
//     platform token via the shared interceptor).
// ============================================================

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  installPlatformBearerInterceptor,
  clearPlatformToken,
  clearSupportToken,
} from '@/lib/platform-session-token'

// Install once — attaches x-platform-token / x-support-token to
// /api/platform/* requests (dev iframe cookie fallback).
installPlatformBearerInterceptor()

export interface PlatformMe {
  admin: {
    id: string
    email: string
    name: string
    isRoot: boolean
    /** ACCOUNT-RECOVERY — Google sign-in link state (null/absent = not linked). */
    googleLinked?: boolean
    googleEmail?: string | null
  }
  permissions: string[]
  /** Current platform MFA posture (Part 1 reset: false while TOTP is stood down). */
  mfaEnabled?: boolean
  session: {
    id: string
    createdAt: string
    expiresAt: string
    stepUpActive: boolean
    stepUpUntil: string | null
    device: { browser: string; os: string; device: string }
  }
  devices: Array<{
    id: string
    current: boolean
    createdAt: string
    expiresAt: string
    device: { browser: string; os: string; device: string }
    ipAddress: string | null
  }>
}

export interface PlatformApiError {
  ok: false
  error: string
  code: string
  requestId?: string
}

interface PlatformSessionContextValue {
  me: PlatformMe | null
  loading: boolean
  /** Permission check (root implies all server-side; list already resolved). */
  can: (permission: string) => boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
}

const PlatformSessionContext = createContext<PlatformSessionContextValue>({
  me: null,
  loading: true,
  can: () => false,
  refresh: async () => {},
  logout: async () => {},
  logoutAll: async () => {},
})

export function PlatformSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<PlatformMe | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/auth/me', { cache: 'no-store' })
      if (res.status === 401) {
        setMe(null)
        router.replace('/platform/login')
        return
      }
      const body = (await res.json()) as { ok: boolean; data?: PlatformMe }
      if (body.ok && body.data) setMe(body.data)
    } catch {
      // Network hiccup — keep whatever we have.
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void refresh()
    // Keep the step-up pill honest (window expiry) without refetch storms.
    const interval = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(interval)
  }, [refresh])

  const logout = useCallback(async () => {
    await fetch('/api/platform/auth/logout', { method: 'POST' }).catch(() => {})
    clearPlatformToken()
    setMe(null)
    router.replace('/platform/login')
  }, [router])

  const logoutAll = useCallback(async () => {
    await fetch('/api/platform/auth/logout-all', { method: 'POST' }).catch(() => {})
    clearPlatformToken()
    setMe(null)
    router.replace('/platform/login')
  }, [router])

  const can = useCallback(
    (permission: string) => (me ? me.permissions.includes(permission) : false),
    [me],
  )

  return (
    <PlatformSessionContext.Provider value={{ me, loading, can, refresh, logout, logoutAll }}>
      {children}
    </PlatformSessionContext.Provider>
  )
}

export function usePlatformSession(): PlatformSessionContextValue {
  return useContext(PlatformSessionContext)
}

/** Typed fetch for platform APIs (throws PlatformApiError on failure). */
export async function platformApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | PlatformApiError
    | null
  if (!body || !body.ok) {
    const err = (body ?? { ok: false, error: 'Network error', code: 'NETWORK_ERROR' }) as PlatformApiError
    throw err
  }
  return body.data
}

/** Exit a support session (used by the oversight banner). */
export async function exitSupportSession(): Promise<void> {
  await fetch('/api/platform/support/exit', { method: 'POST' }).catch(() => {})
  clearSupportToken()
}
