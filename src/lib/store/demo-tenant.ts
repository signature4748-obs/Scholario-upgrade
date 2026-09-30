'use client'

/**
 * demo-tenant — FINAL-GATE demo-gating signal.
 *
 * Several client stores still carry ILLUSTRATIVE seed content (Messages,
 * Library, Transport, Inventory, Certificates, Calendar, Downloads…).
 * That content is the sanctioned DEMO TIER (the showcase tenant,
 * `School.isDemo = true`, DB-provisioned identity) — it must NEVER render
 * for a real production tenant, which must start honest-empty until
 * server data arrives.
 *
 * This module exposes the session-derived signal:
 *   · `useIsDemoTenant()`   — React hook (re-renders when /me hydrates)
 *   · `readIsDemoTenant()`  — synchronous read for store actions
 *
 * The signal flows from the SERVER (School.isDemo via /api/auth/me →
 * current-user-store) — a hostile client cannot flip it to make fabricated
 * content appear on another tenant.
 */

import { useCurrentUser } from './current-user-store'

/** True when the session's school is the sanctioned demo tenant. */
export function useIsDemoTenant(): boolean {
  return useCurrentUser((s) => s.me?.school?.isDemo ?? false)
}

/** Non-hook variant — reads the CURRENT store value (for store actions). */
export function readIsDemoTenant(): boolean {
  return useCurrentUser.getState().me?.school?.isDemo ?? false
}

/**
 * One-shot demo-seed applier for zustand stores whose initial state is
 * now EMPTY (seeds withheld). The module root calls the returned action
 * once the demo signal is confirmed true:
 *
 *   const isDemo = useIsDemoTenant()
 *   const ensureDemoSeed = useStore((s) => s.ensureDemoSeed)
 *   useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])
 *
 * Guard rules baked in:
 *   · applies at most once per store instance (`demoSeeded` flag);
 *   · NEVER applies when the store has left its initial state (server
 *     hydration or user mutations already happened) — seeds must never
 *     overwrite real data.
 */
/**
 * Structural view of a zustand store the applier needs (works for plain
 * `create` stores and `persist`-wrapped ones alike — only data slices are
 * ever read/written here).
 */
interface SeedableStore<T> {
  getState: () => T
  setState: (partial: Partial<T>) => void
}

export function makeDemoSeedApplier<T extends object>(
  useStore: SeedableStore<T>,
  seed: Partial<T> & Record<string, unknown>,
): () => void {
  return () => {
    const s = useStore.getState() as unknown as Record<string, unknown>
    if (s.demoSeeded === true) return
    // Never seed over a non-pristine store: if any seed-carrying slice
    // already holds content (server-synced or user-mutated), skip.
    const pristine = Object.keys(seed).every((k) => {
      const v = s[k]
      if (Array.isArray(v)) return v.length === 0
      if (v && typeof v === 'object') return Object.keys(v as object).length === 0
      return v === undefined || v === null || v === false
    })
    if (!pristine) {
      useStore.setState({ demoSeeded: true } as unknown as Partial<T>)
      return
    }
    useStore.setState({ ...seed, demoSeeded: true } as unknown as Partial<T>)
  }
}
