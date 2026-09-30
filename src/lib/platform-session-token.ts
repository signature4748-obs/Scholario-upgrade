'use client'

// ============================================================
// Platform/support session tokens — cookie-blocked embedding contexts
// ------------------------------------------------------------
// The preview panel renders this app inside a CROSS-SITE iframe; the
// browser refuses the SameSite=Lax platform/support cookies there. The
// platform login (and support-session creation) therefore also returns
// the raw token in dev-preview mode. This module persists it per-origin
// and attaches it to same-origin /api/platform/* requests via the
// X-Platform-Token / X-Support-Token headers.
//
// TRANSPORT ISOLATION (the Phase-6 invariant):
//   · the SCHOOL session rides  `Authorization: Bearer …`
//     (lib/auth-session-token.ts) or the `erp_session` cookie;
//   · the PLATFORM session rides `X-Platform-Token` or the
//     `scholario_platform_session` cookie;
//   · the SUPPORT session rides `X-Support-Token` or the
//     `scholario_support` cookie.
// The three token spaces can never be confused in either direction —
// the server only ever looks for its own transport.
//
// Passive by design (same rules as the school interceptor): no token →
// untouched fetch; requests already carrying the header are never
// modified; only same-origin /api/platform/* URLs are touched.
// ============================================================

const PLATFORM_TOKEN_KEY = 'scholario-platform-token'
const SUPPORT_TOKEN_KEY = 'scholario-support-token'

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, token: string): void {
  try {
    window.localStorage.setItem(key, token)
  } catch {
    // Storage unavailable — cookie path may still work.
  }
}

function storageClear(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // nothing to clear
  }
}

// ── Platform session token ────────────────────────────────────────────────

export function savePlatformToken(token: string): void {
  storageSet(PLATFORM_TOKEN_KEY, token)
}

export function readPlatformToken(): string | null {
  return storageGet(PLATFORM_TOKEN_KEY)
}

export function clearPlatformToken(): void {
  storageClear(PLATFORM_TOKEN_KEY)
}

// ── Support session token ─────────────────────────────────────────────────

export function saveSupportToken(token: string): void {
  storageSet(SUPPORT_TOKEN_KEY, token)
}

export function readSupportToken(): string | null {
  return storageGet(SUPPORT_TOKEN_KEY)
}

export function clearSupportToken(): void {
  storageClear(SUPPORT_TOKEN_KEY)
}

// ── Shared interceptor ────────────────────────────────────────────────────

let installed = false

/** Attach platform + support tokens to /api/platform/* requests. */
export function installPlatformBearerInterceptor(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const nativeFetch = window.fetch.bind(window)

  window.fetch = function scholarioPlatformFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const platformToken = readPlatformToken()
    const supportToken = readSupportToken()
    if (!platformToken && !supportToken) return nativeFetch(input, init)

    let url = ''
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    } catch {
      return nativeFetch(input, init)
    }

    const isPlatformApi =
      url.startsWith('/api/platform/') || url.startsWith(`${window.location.origin}/api/platform/`)
    if (!isPlatformApi) return nativeFetch(input, init)

    // Merge headers from both sources (Request inputs carry their own).
    const headers = new Headers(init?.headers ?? undefined)
    if (typeof input !== 'string' && !(input instanceof URL)) {
      try {
        new Headers(input.headers).forEach((v, k) => {
          if (!headers.has(k)) headers.set(k, v)
        })
      } catch {
        // unreadable headers — proceed with init-only
      }
    }

    if (platformToken && !headers.has('x-platform-token')) {
      headers.set('x-platform-token', platformToken)
    }
    if (supportToken && !headers.has('x-support-token')) {
      headers.set('x-support-token', supportToken)
    }

    return nativeFetch(input, { ...init, headers })
  }
}
