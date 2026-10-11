'use client'

/**
 * SD-3b — server-first enrollment identity for student-facing surfaces.
 *
 * The DB session (/api/auth/me → me.student) is the single truth for WHO
 * the logged-in student is: class, roll, admission number and the personal
 * particulars. The canonical students-store seed (STU-58) remains as the
 * fallback so surfaces still render while the session resolves — but any
 * identity-bearing display prefers the server values, so the sidebar,
 * dashboard, profile, timetable/attendance headers and the school ID card
 * can never disagree with each other.
 */

import { useMemo } from 'react'
import { useCurrentUser } from '@/lib/store/current-user-store'

/** Everything a surface needs to say "who I am". */
export interface EnrollmentIdentity {
  /** Canonical server name (me.name — User → Student DB row). Null
   *  while /api/auth/me is still resolving; callers fall back to the
   *  roster record's name (B-fix: server-first, same priority as the
   *  sidebar). */
  name: string | null
  /** Section-merged label, e.g. "Grade 9 - A" (server format). */
  classLabel: string
  rollNo: string
  admissionNo: string
  /** ISO date or null when the server has none. */
  dob: string | null
  /** Display-cased gender ("Male"), or null. */
  gender: string | null
  bloodGroup: string | null
  guardianName: string | null
  guardianPhone: string | null
  address: string | null
  /** True while /api/auth/me hasn't answered yet (seed values in use). */
  resolving: boolean
}

/** Fallback shape every caller already has from the students store. */
export interface EnrollmentSeed {
  className: string
  section: string
  rollNo: string
  admissionNo: string
  dob?: string
  gender?: string
  bloodGroup?: string
  guardianName?: string
  guardianPhone?: string
}

/** "MALE" → "Male" (DB enum → display). Pass-through for anything else. */
function displayGender(raw: string | null | undefined): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Server-first identity. Falls back to the seed values (blanked to null
 * when genuinely absent) until the session resolves.
 */
export function useEnrollmentIdentity(seed: EnrollmentSeed): EnrollmentIdentity {
  const srv = useCurrentUser((s) => s.me?.student)
  const srvName = useCurrentUser((s) => s.me?.name)
  const resolving = useCurrentUser((s) => s.loading || s.me == null)

  return useMemo(() => ({
    name: srvName ?? null,
    classLabel: srv?.classLabel ?? `${seed.className}-${seed.section}`,
    rollNo: srv?.rollNo ?? seed.rollNo,
    admissionNo: srv?.admissionNo ?? seed.admissionNo,
    dob: srv?.dob ?? seed.dob ?? null,
    gender: srv ? displayGender(srv.gender) : displayGender(seed.gender),
    bloodGroup: srv?.bloodGroup ?? seed.bloodGroup ?? null,
    guardianName: srv?.guardianName ?? seed.guardianName ?? null,
    guardianPhone: srv?.guardianPhone ?? seed.guardianPhone ?? null,
    address: srv?.address ?? null,
    resolving,
  }), [srv, srvName, seed, resolving])
}
