'use client'

/**
 * src/lib/supabase/browser.ts — the BROWSER-side Supabase Auth client
 * (SUPABASE AUTH PHASE 1).
 *
 * Uses the PUBLIC anon key (publishable by design; RLS deny-by-default
 * keeps the public schema unreadable) — NEVER the service-role key,
 * which exists only in server env.
 *
 * The browser session (localStorage) is the provider session only: it
 * grants NOTHING on Scholario APIs. Every authorization decision still
 * requires the server-side exchange (/api/auth/supabase/exchange) which
 * verifies the token against the provider and resolves the canonical
 * account server-side.
 *
 * The singleton is created lazily so pages that never touch provider
 * auth pay no cost, and `getSupabaseBrowserClient()` returns null when
 * the public env is absent (honest-off, matching the status probe).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) {
    cached = null
    return cached
  }
  cached = createClient(url, key, {
    auth: {
      // The app session (HttpOnly cookie, server-issued via the
      // exchange) is the session of record — persist the provider
      // session so email links / OTP round-trips work across reloads,
      // but never treat it as app authentication.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return cached
}
