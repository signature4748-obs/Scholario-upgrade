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
//     platform token via the shared interceptor). Every call is bounded
//     by an AbortController-based timeout (default 30s, per-call
//     override) so a hung request surfaces a typed TIMEOUT error
//     instead of leaving busy states stuck forever.
// ============================================================

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  installPlatformBearerInterceptor,
  clearPlatformToken,
  clearSupportToken,
} from '@/lib/platform-session-token'
import { classifyAuthMe } from '@/lib/platform/session-gate'

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
  /** auth/me could not be served (5xx/network) while no session is loaded — the shell renders a retryable unavailable state instead of a skeleton. */
  unavailable: boolean
  /** Permission check (root implies all server-side; list already resolved). */
  can: (permission: string) => boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
}

const PlatformSessionContext = createContext<PlatformSessionContextValue>({
  me: null,
  loading: true,
  unavailable: false,
  can: () => false,
  refresh: async () => {},
  logout: async () => {},
  logoutAll: async () => {},
})

export function PlatformSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<PlatformMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/auth/me', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: PlatformMe } | null
      const outcome = classifyAuthMe(res.status, Boolean(body?.ok))
      if (outcome === 'unauthenticated') {
        setMe(null)
        setUnavailable(false)
        router.replace('/platform/login')
        return
      }
      if (outcome === 'authenticated' && body?.data) {
        setMe(body.data)
        setUnavailable(false)
        return
      }
      // unavailable (5xx / broken envelope): keep whatever session we
      // already have — it may still be valid server-side; the flag only
      // drives the shell's error state while nothing is loaded.
      setUnavailable(true)
    } catch {
      // Network exception — same treatment: keep data, surface the state.
      setUnavailable(true)
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
    <PlatformSessionContext.Provider value={{ me, loading, unavailable, can, refresh, logout, logoutAll }}>
      {children}
    </PlatformSessionContext.Provider>
  )
}

export function usePlatformSession(): PlatformSessionContextValue {
  return useContext(PlatformSessionContext)
}

/** Default request timeout — hung fetches must settle as typed errors. */
const PLATFORM_API_TIMEOUT_MS = 30_000

/**
 * Typed fetch for platform APIs (throws PlatformApiError on failure).
 *
 * Every request is bounded by `timeoutMs` (default 30 000 ms) via an
 * AbortController: a hung request (server stall, dropped connection)
 * otherwise never settles and every busy state in the caller stays
 * stuck forever. On timeout the fetch is aborted and a PlatformApiError
 * with code `TIMEOUT` is thrown — the server may still be processing, so
 * callers should check the current state before blindly retrying.
 * Slow mutations (e.g. school provisioning) pass a larger timeout as the
 * third argument. A caller-supplied `init.signal` is chained — whichever
 * abort fires first wins.
 */
export async function platformApi<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = PLATFORM_API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  // Chain the caller's signal (if any) onto the same controller.
  const callerSignal = init?.signal
  const onCallerAbort = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
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
  } catch (e) {
    if (timedOut) {
      // The timer fired — without this the promise would never settle.
      // Deliberately shaped like every other API error so callers' UI
      // states resolve honestly.
      const err: PlatformApiError = {
        ok: false,
        error: 'The request timed out — the server may still be processing. Check the current state before retrying.',
        code: 'TIMEOUT',
      }
      throw err
    }
    // Caller-aborted or network failure — rethrow untouched.
    throw e
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

/** Exit a support session (used by the oversight banner). */
export async function exitSupportSession(): Promise<void> {
  await fetch('/api/platform/support/exit', { method: 'POST' }).catch(() => {})
  clearSupportToken()
}
