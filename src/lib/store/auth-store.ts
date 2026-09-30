'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * PHASE 6 — SCHOOL roles only.
 *
 * 'superadmin' was removed from the school SPA's client auth vocabulary:
 * the platform identity lives exclusively in the /platform/* route
 * namespace with its own server-side session boundary
 * (PlatformAdminSession). A client-side role change can therefore never
 * produce a platform administrator — there is no such school role to
 * spoof into (persisted v1 states carrying it are discarded on
 * rehydrate; the school login API additionally rejects SUPER_ADMIN
 * users server-side).
 */
export type Role = 'principal' | 'teacher' | 'student'

export interface SessionUser {
  role: Role
  name: string
  avatar: string
  id: string
  email: string
  teacherId?: string
  studentId?: string
}

interface AuthState {
  user: SessionUser | null
  isAuthenticated: boolean
  isAuthenticating: boolean
  hydrated: boolean
  setHydrated: () => void
  startAuth: () => void
  login: (role: Role, overrides?: Partial<SessionUser>) => void
  endAuth: () => void
  logout: () => void
  switchTo: (role: Role) => void
}

const roleProfiles: Record<Role, SessionUser> = {
  principal: {
    role: 'principal',
    name: 'Dr. Ananya Iyer',
    avatar: 'AI',
    id: 'EMP-001',
    email: 'principal@scholario.in',
    teacherId: 'T-014',
  },
  teacher: {
    role: 'teacher',
    name: 'Rohan Mehta',
    avatar: 'RM',
    id: 'EMP-014',
    email: 'rohan.mehta@scholario.in',
    teacherId: 'T-014',
  },
  student: {
    role: 'student',
    name: 'Aarav Sharma',
    avatar: 'AS',
    id: 'STU-58',
    email: 'aarav.sharma@greenwood.edu.in',
    studentId: 'STU-58',
  },
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isAuthenticating: false,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      startAuth: () => set({ isAuthenticating: true }),
      endAuth: () => set({ isAuthenticating: false }),
      // `overrides` lets the login flow sync the SERVER-authenticated
      // identity (name/email) into the store so the shell never shows a
      // stale mock profile next to a real session.
      login: (role, overrides) =>
        set({
          user: { ...roleProfiles[role], ...overrides, role },
          isAuthenticated: true,
          isAuthenticating: false,
        }),
      switchTo: (role) =>
        set({
          user: roleProfiles[role],
          isAuthenticated: true,
        }),
      logout: () =>
        set({ user: null, isAuthenticated: false, isAuthenticating: false }),
    }),
    {
      name: 'scholario-auth',
      // v1 — re-key student identity to the canonical STU-58 (fresh sessions
      // after the roster unification; stale persisted users are discarded).
      // v2 (PHASE 6) — 'superadmin' removed from the school role set: any
      // persisted superadmin state (the retired client-only platform
      // console) is discarded — those users simply land logged-out.
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          const state = persisted as { user?: { role?: string } } | undefined
          if (state?.user?.role && !['principal', 'teacher', 'student'].includes(state.user.role)) {
            return { user: null, isAuthenticated: false, isAuthenticating: false, hydrated: false }
          }
        }
        return persisted as AuthState
      },
      onRehydrateStorage: () => (state) => {
        useAuth.setState({ hydrated: true })
        if (state) state.setHydrated()
      },
    }
  )
)
