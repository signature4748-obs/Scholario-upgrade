'use client'

// ============================================================
// SS-1 — CURRENT USER (server identity) store
// ------------------------------------------------------------
// The client auth-store carries the demo profile (which PANEL renders);
// the SERVER identity (erp_session → /api/auth/me) is the truth for
// account-level surfaces: avatar, email, session context, last login.
// AppShell populates this once on mount; Settings, the student sidebar
// identity block and the profile dropdown read from it.
// ============================================================

import { create } from 'zustand'

export interface MeSessionInfo {
  createdAt: string
  expiresAt: string
  userAgent: string | null
  ipAddress: string | null
  device: { browser: string; os: string; device: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown' }
}

export interface MeUser {
  id: string
  email: string
  name: string
  role: string
  schoolId: string | null
  avatarUrl: string | null
  phone: string | null
  status: string
  /** Phase 10 — account-level subscription lock ('ACTIVE' | 'LOCKED').
   *  LOCKED accounts see their identity + a subscription notice instead
   *  of module surfaces; module APIs reject them server-side. */
  subscriptionStatus?: string
  /** SD-3 — server-resolved enrollment context (STUDENT role only).
   *  Extended identity: every particular the student-facing surfaces
   *  display (profile, ID card, module headers) — the DB is the single
   *  truth; the client seed roster is only a fallback. */
  student?: {
    classLabel: string | null
    rollNo: string | null
    admissionNo?: string | null
    dob?: string | null
    /** Raw DB enum ("MALE"/"FEMALE"/…) — surfaces title-case it. */
    gender?: string | null
    bloodGroup?: string | null
    guardianName?: string | null
    guardianPhone?: string | null
    address?: string | null
  } | null
  school?: {
    id: string
    name: string
    slug: string
    code: string
    themeColor: string
    accentColor: string
    logoUrl: string | null
    academicYear: string
    plan: string
    /** FINAL-GATE — demo-tenant flag (gates illustrative client seeds). */
    isDemo: boolean
  } | null
}

interface CurrentUserState {
  me: MeUser | null
  session: MeSessionInfo | null
  lastLoginAt: string | null
  loading: boolean
  error: boolean
  /** Fetch (or re-fetch) /api/auth/me. Safe to call repeatedly. */
  refresh: () => Promise<void>
  /** Drop the cached identity (after sign-out). */
  clear: () => void
}

export const useCurrentUser = create<CurrentUserState>((set) => ({
  me: null,
  session: null,
  lastLoginAt: null,
  loading: false,
  error: false,
  refresh: async () => {
    if (useCurrentUser.getState().loading) return
    set({ loading: true, error: false })
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!r.ok) throw new Error('unauthenticated')
      const j = await r.json()
      const data = j?.data ?? j
      set({
        me: data?.user ?? null,
        session: data?.session ?? null,
        lastLoginAt: data?.lastLoginAt ?? null,
        loading: false,
      })
    } catch {
      set({ me: null, session: null, lastLoginAt: null, loading: false, error: true })
    }
  },
  clear: () => set({ me: null, session: null, lastLoginAt: null, error: false }),
}))
