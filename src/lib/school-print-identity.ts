'use client'

/**
 * school-print-identity — the ACTIVE TENANT's school identity for
 * teacher-side print/PDF surfaces (timetable exports, payslip PDFs).
 *
 * PHASE 7.5: reads the SAME identity cascade as every other document
 * surface — server identity (school-settings `server` slice) → local
 * settings slice → neutral 'Our School'. The hardcoded tenant-registry
 * snapshot is no longer consulted, so a second tenant's payslips can
 * never print the demo school's letterhead.
 *
 * Read via getState() so plain (non-hook) export functions can use it.
 */

import { getSchoolProfile } from '@/lib/school-profile'

export interface SchoolPrintIdentity {
  /** School display name (tenant identity). */
  name: string
  /** Secondary line under the name: city · academic session. */
  line2: string
}

export function schoolPrintIdentity(): SchoolPrintIdentity {
  const p = getSchoolProfile()
  const session = p.academicYear.replace('-', '–')
  return {
    name: p.name,
    line2: [p.city, session ? `Session ${session}` : ''].filter(Boolean).join(' · '),
  }
}
