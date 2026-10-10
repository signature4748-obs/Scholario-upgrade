'use client'

/**
 * FEE-ADMISSIONS MVP (Phase F) — the shared client hook for the
 * `admissionsServerIssuance` feature flag (GET /api/admissions/config).
 *
 * All consumers of the admission module read THE one cached config so
 * the module renders consistently. The flag is fail-closed OFF server
 * side; a failed/absent config ALSO means serverMode=false → the
 * legacy client-only workflow keeps running byte-for-byte unchanged.
 */
import { useEffect, useState } from 'react'
import { getAdmissionsConfig } from './server-admissions-client'

interface AdmissionsConfigState {
  /** Flag enabled for this school → the server-issued workflow is live. */
  serverMode: boolean
  /** The school's canonical academic year (null when unset). */
  academicYear: string | null
  /** True while the first config fetch is in flight. */
  loading: boolean
  /** Re-fetch (e.g. after an admin toggles the flag). */
  refresh: () => void
}

interface CachedConfig {
  enabled: boolean
  academicYear: string | null
  fetchedAt: number
}

let cache: CachedConfig | null = null
let inflight: Promise<CachedConfig> | null = null
const listeners = new Set<() => void>()

const CACHE_TTL_MS = 60_000

async function loadConfig(force: boolean): Promise<CachedConfig> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const cfg = await getAdmissionsConfig()
      cache = { enabled: cfg.enabled, academicYear: cfg.academicYear, fetchedAt: Date.now() }
      return cache
    } catch {
      // Fail-closed: flag off / network error / non-principal → the
      // legacy workflow must keep working unchanged.
      cache = { enabled: false, academicYear: null, fetchedAt: Date.now() }
      return cache
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function notify() {
  for (const l of listeners) l()
}

export function useAdmissionsConfig(): AdmissionsConfigState {
  const [state, setState] = useState<{ serverMode: boolean; academicYear: string | null; loading: boolean }>(() => ({
    serverMode: cache?.enabled ?? false,
    academicYear: cache?.academicYear ?? null,
    loading: !cache,
  }))

  useEffect(() => {
    let cancelled = false
    const sync = () => {
      if (cancelled || !cache) return
      setState({ serverMode: cache.enabled, academicYear: cache.academicYear, loading: false })
    }
    listeners.add(sync)
    void loadConfig(false).then(() => {
      if (!cancelled && cache) {
        setState({ serverMode: cache.enabled, academicYear: cache.academicYear, loading: false })
      }
    })
    return () => {
      cancelled = true
      listeners.delete(sync)
    }
  }, [])

  const refresh = () => {
    void loadConfig(true).then(() => notify())
  }

  return { ...state, refresh }
}
