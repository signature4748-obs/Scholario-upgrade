'use client'

/**
 * use-academic-allocation — the school's AUTHORITATIVE class & subject
 * configuration for the Teacher module's allocation picker (Wave 2.3C §12–§13).
 *
 * Source of truth: GET /api/principal/academic — the Principal's academic
 * settings (Class · ClassSubjectAssignment · Subject catalog). The
 * allocation modal NEVER hardcodes classes or subjects: every selectable
 * option is configured by the school. Subject availability follows the
 * class configuration (CSA); with no class selected the school's subject
 * catalog is offered (teacher-level subject assignment is preserved).
 */

import { useEffect, useState } from 'react'

export interface AcademicClassOption {
  id: string
  name: string
  section: string | null
  label: string
  /** Subject names configured (ACTIVE CSA) for this class. */
  subjects: string[]
}

export interface AcademicConfig {
  classes: AcademicClassOption[]
  /** The school's whole subject catalog. */
  catalog: string[]
}

export type AcademicConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: AcademicConfig }
  | { status: 'error'; error: string }

/** Same label rule as the server's classLabelOf — never render the section twice. */
export function academicClassLabel(c: { name: string; section: string | null }): string {
  if (c.section) {
    const esc = c.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`[-–\\s]${esc}\\s*$`, 'i').test(c.name)) return c.name
    return `${c.name} - ${c.section}`
  }
  return c.name
}

/** Parse a grade number out of a class name ("Grade 6 - A" → 6). */
function gradeNumberOf(name: string): number | null {
  const m = name.match(/(\d{1,2})/)
  return m ? parseInt(m[1], 10) : null
}

export const CLASS_GROUP_ORDER = ['Pre-Primary', 'Primary', 'Middle', 'Secondary', 'Senior Secondary', 'Other'] as const
export type ClassGroup = (typeof CLASS_GROUP_ORDER)[number]

export function groupLabelOf(className: string): ClassGroup {
  const n = className.toLowerCase()
  if (/nursery|lkg|ukg|\bkg\b|pre[- ]?primary|pre[- ]?nursery/.test(n)) return 'Pre-Primary'
  const grade = gradeNumberOf(className)
  if (grade == null) return 'Other'
  if (grade <= 5) return 'Primary'
  if (grade <= 8) return 'Middle'
  if (grade <= 10) return 'Secondary'
  if (grade <= 12) return 'Senior Secondary'
  return 'Other'
}

/** Group classes into ordered level buckets for the allocation picker. */
export function groupClasses(classes: AcademicClassOption[]): { group: ClassGroup; classes: AcademicClassOption[] }[] {
  const buckets = new Map<ClassGroup, AcademicClassOption[]>()
  for (const c of classes) {
    const g = groupLabelOf(c.name)
    const arr = buckets.get(g) ?? []
    arr.push(c)
    buckets.set(g, arr)
  }
  return CLASS_GROUP_ORDER
    .filter((g) => (buckets.get(g) ?? []).length > 0)
    .map((group) => ({ group, classes: buckets.get(group)! }))
}

/**
 * Load the school's academic configuration (Principal only). Fetches when
 * `active` becomes true and keeps the previous configuration visible while
 * revalidating, so reopening the picker never flashes an empty skeleton.
 */
export function useAcademicConfig(active: boolean): AcademicConfigState {
  const [state, setState] = useState<AcademicConfigState>({ status: 'loading' })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    fetch('/api/principal/academic')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const json = await res.json()
        if (cancelled) return
        const data = json?.data ?? json
        if (!data || !Array.isArray(data.classes)) {
          throw new Error('Unexpected academic payload')
        }
        const config: AcademicConfig = {
          classes: data.classes.map((c: {
            id: string; name: string; section?: string | null
            subjects?: { name: string }[]
          }) => ({
            id: c.id,
            name: c.name,
            section: c.section ?? null,
            label: academicClassLabel({ name: c.name, section: c.section ?? null }),
            subjects: (c.subjects ?? []).map((s) => s.name),
          })),
          // 7-POLISH — dedupe the catalog by NAME. The Subject table has no
          // unique(schoolId, name) constraint, so a school can hold two rows
          // with the same name (observed live: 'Mathematics' ×2 — the
          // tenant-isolation probe seeded a second 'Mathematics' row
          // alongside the canonical MAT row). The server returns every row;
          // this picker is name-based (teacher.subjects stores subject
          // NAMES), so the same name twice would render two identical chips
          // AND collide React keys ("Encountered two children with the same
          // key"). First occurrence wins (server orders by name, so
          // duplicates are adjacent).
          catalog: [...new Set<string>((data.catalog ?? []).map((s: { name: string }) => s.name))],
        }
        if (!cancelled) setState({ status: 'ready', config })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load academic configuration',
        })
      })
    return () => {
      cancelled = true
    }
  }, [active])

  return state
}
