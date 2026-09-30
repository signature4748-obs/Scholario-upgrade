'use client'

/**
 * school-profile — the single school identity resolver.
 *
 * SOURCE-OF-TRUTH CASCADE (PHASE 7.5):
 *   1. SERVER identity — the `server` slice of the school-settings store
 *      (GET /api/school-settings → School columns), hydrated once per
 *      session and persisted as a cache.
 *   2. Local settings slice — the school-settings store's `general`
 *      (tenant-scoped seed, realigned to the server on every sync).
 *   3. NEUTRAL fallbacks — 'Our School' etc. Never a fabricated identity
 *      (no Greenwood, no fake affiliation numbers, no invented principals).
 *
 * Every document surface (certificates, receipts, letters, payslips, form
 * previews, exports) reads its branding from here — the static
 * `lib/mock/school` snapshot is NO LONGER consulted.
 *
 * Usage:
 *   - Inside React components:  `const profile = useSchoolProfile()`
 *   - In plain functions / store seeds: `getSchoolProfile()`
 */

import { useMemo } from 'react'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'

export interface SchoolProfile {
  /** Full official school name. */
  name: string
  /** Short name (crest label, footers). */
  shortName: string
  tagline: string
  affiliation: string
  address: string
  city: string
  phone: string
  email: string
  website: string
  /** Principal's full name — document signatory. */
  principal: string
  vicePrincipal: string
  established: number
  /** Current academic session, e.g. "2026-2027". */
  academicYear: string
  /** Branding primary color (hex) when the server carries it. */
  primaryColor: string | null
  /** Uploaded logo URL (school-scope media route) when set. */
  logoUrl: string | null
}

// Neutral, claim-free fallbacks — a school with NO configured identity
// renders these, never another school's particulars.
const NEUTRAL: SchoolProfile = {
  name: 'Our School',
  shortName: 'Our School',
  tagline: '',
  affiliation: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  website: '',
  principal: '',
  vicePrincipal: '',
  established: 0,
  academicYear: '',
  primaryColor: null,
  logoUrl: null,
}

interface ProfileSources {
  identity: {
    name: string | null
    shortName: string | null
    tagline: string | null
    affiliation: string | null
    address: string | null
    city: string | null
    phone: string | null
    email: string | null
    website: string | null
    principalName: string | null
    established: string | null
    academicYear: string | null
  } | null
  branding: {
    primaryColor: string | null
    accentColor: string | null
    logoUrl: string | null
    faviconUrl: string | null
  } | null
  general: {
    schoolName?: string
    shortName?: string
    tagline?: string
    affiliation?: string
    address?: string
    city?: string
    phone?: string
    email?: string
    website?: string
    principalName?: string
    vicePrincipalName?: string
    established?: number
  }
  currentSession?: string
}

function parseYear(v: string | null): number {
  if (!v) return 0
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function resolveProfile({ identity, branding, general, currentSession }: ProfileSources): SchoolProfile {
  // Tier 1 — server identity (every field present wins immediately);
  // Tier 2 — local settings slice; Tier 3 — neutral fallbacks.
  const name = identity?.name?.trim() || general.schoolName?.trim() || NEUTRAL.name

  const pick = (serverVal: string | null, localVal: string | undefined): string => {
    const s = serverVal?.trim()
    if (s) return s
    const l = localVal?.trim()
    if (l) return l
    return ''
  }

  return {
    name,
    shortName: identity?.shortName?.trim() || general.shortName?.trim() || name,
    tagline: pick(identity?.tagline ?? null, general.tagline),
    affiliation: pick(identity?.affiliation ?? null, general.affiliation),
    address: pick(identity?.address ?? null, general.address),
    city: pick(identity?.city ?? null, general.city),
    phone: pick(identity?.phone ?? null, general.phone),
    email: pick(identity?.email ?? null, general.email),
    website: pick(identity?.website ?? null, general.website),
    principal: pick(identity?.principalName ?? null, general.principalName),
    vicePrincipal: general.vicePrincipalName?.trim() || '',
    established: identity ? parseYear(identity.established) || general.established || 0 : general.established || 0,
    academicYear:
      identity?.academicYear?.trim() ||
      currentSession?.trim() ||
      '',
    primaryColor: branding?.primaryColor ?? null,
    logoUrl: branding?.logoUrl ?? null,
  }
}

/** Live snapshot for non-React contexts (store seeds, HTML builders). */
export function getSchoolProfile(): SchoolProfile {
  try {
    const s = useSchoolSettingsStore.getState()
    return resolveProfile({
      identity: s.server.identity,
      branding: s.server.branding,
      general: s.general,
      currentSession: s.academics?.currentSession,
    })
  } catch {
    return { ...NEUTRAL }
  }
}

/** Reactive hook for React document renderers. */
export function useSchoolProfile(): SchoolProfile {
  const identity = useSchoolSettingsStore((s) => s.server.identity)
  const branding = useSchoolSettingsStore((s) => s.server.branding)
  const general = useSchoolSettingsStore((s) => s.general)
  const currentSession = useSchoolSettingsStore((s) => s.academics?.currentSession)
  return useMemo(
    () => resolveProfile({ identity, branding, general, currentSession }),
    [identity, branding, general, currentSession],
  )
}
