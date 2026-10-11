import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'

/**
 * academic-year — SERVER-side canonical academic-year normalization
 * (FEE-ADMISSIONS MVP, H1-R2 contract).
 *
 * Storage id: exactly "YYYY-YYYY" (consecutive years, hyphen). This is
 * the ONE normalizer applied identically across School.academicYear
 * reads, FeeStructure(+Version) writes, AdmissionApplication writes and
 * every admissions/fees API input. Unparseable input → 422; a school
 * with no configured academic year → fail-closed SESSION_NOT_SET (409).
 * A year is NEVER invented and historical snapshots are NEVER rewritten.
 *
 * (The client-side twin lives in src/lib/academic-session.ts — this
 * module is the server authority.)
 */

/** Normalize any academic-year string to "YYYY-YYYY", or null when
 * unparseable. Accepts '2026-2027', '2026–2027', '2026-27'; consecutive
 * years only. */
export function normalizeAcademicYear(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{4})\s*[–—-]\s*(\d{4})$/) || raw.trim().match(/^(\d{4})\s*[–—-]\s*(\d{2})$/)
  if (!m) return null
  const start = Number(m[1])
  const end = m[2].length === 4 ? Number(m[2]) : Number(`${String(start).slice(0, 2)}${m[2]}`)
  if (end !== start + 1) return null
  return `${start}-${end}`
}

/** Is this exactly the canonical storage form? */
export function isCanonicalAcademicYear(raw: string | null | undefined): raw is string {
  return !!raw && /^\d{4}-\d{4}$/.test(raw)
}

/**
 * The school's canonical academic year, resolved from School.academicYear.
 * Throws SESSION_NOT_SET (409) when the school has no parseable year —
 * callers never fall back to a default (fail-closed, no invention).
 */
export async function requireSchoolAcademicYear(schoolId: string): Promise<string> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { academicYear: true },
  })
  const normalized = normalizeAcademicYear(school?.academicYear ?? null)
  if (!normalized) {
    throw new AppError('SESSION_NOT_SET', {
      internalDetail: `requireSchoolAcademicYear: school ${schoolId.slice(0, 8)}… has no canonical academic year`,
    })
  }
  return normalized
}

/** Non-throwing variant (null when unset/unparseable). */
export async function schoolAcademicYearOrNull(schoolId: string): Promise<string | null> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { academicYear: true },
  })
  return normalizeAcademicYear(school?.academicYear ?? null)
}
