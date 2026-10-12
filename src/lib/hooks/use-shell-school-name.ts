'use client'

/**
 * School identity (PHASE 7.5): the signed-in school's REAL name — server
 * session school first, then the school-settings identity cascade
 * (server slice → local slice → neutral). No mock/tenant-registry
 * fallback: the static tenant registry (Greenwood demo tenant) must
 * never leak onto an authenticated surface.
 *
 * ARCH-RESET-2c — one hook, every shell consumer: the sidebar header,
 * the quiet footer line and the account-menu school line all read the
 * same truth.
 */

import { useCurrentUser } from '@/lib/store/current-user-store'
import { useSchoolProfile } from '@/lib/school-profile'

export function useShellSchoolName(): string {
  const sessionSchool = useCurrentUser((s) => s.me?.school?.name)
  const profile = useSchoolProfile()
  return sessionSchool?.trim() || profile.name
}
