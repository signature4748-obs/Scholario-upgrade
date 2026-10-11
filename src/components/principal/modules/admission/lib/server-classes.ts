'use client'

/**
 * FEE-ADMISSIONS MVP (Phase F) — resolve the wizard's free-text class
 * choice against the school's REAL server classes (GET /api/classes).
 * Shared by the ServerFeeStep (server-mode fee selection) so the fee
 * quote and the eventual enrolment target the same canonical Class row.
 */

export interface ServerClassOption {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
}

const PRE_PRIMARY = ['nursery', 'lkg', 'ukg', 'ikg']

/** The academic "level" of a class name — digits, or a pre-primary key. */
function classLevel(name: string): string {
  const n = name.toLowerCase()
  for (const p of PRE_PRIMARY) {
    if (n.includes(p)) return p
  }
  return n.replace(/[^0-9]/g, '')
}

/** Best-effort unique match of a wizard className+section → server class id. */
export function matchServerClass(
  classes: ServerClassOption[],
  wizardClassName: string,
  wizardSection: string
): string {
  const wanted = classLevel(wizardClassName)
  if (!wanted) return ''
  let candidates = classes.filter((c) => {
    const level = classLevel(c.gradeLevel ?? '') || classLevel(c.name)
    return level === wanted
  })
  if (candidates.length > 1 && wizardSection) {
    const bySection = candidates.filter(
      (c) => c.section === wizardSection || c.name.toUpperCase().endsWith(`-${wizardSection.toUpperCase()}`)
    )
    if (bySection.length >= 1) candidates = bySection
  }
  return candidates.length === 1 ? candidates[0].id : ''
}

/** Fetch the school's classes (principal session; returns [] on failure). */
export async function fetchSchoolClasses(): Promise<ServerClassOption[]> {
  const res = await fetch('/api/classes', { credentials: 'same-origin', cache: 'no-store' })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: ServerClassOption[] }
    | null
  if (!res.ok || !json?.ok || !Array.isArray(json.data)) {
    throw new Error(`Could not load the school's classes (HTTP ${res.status}).`)
  }
  return json.data
}
