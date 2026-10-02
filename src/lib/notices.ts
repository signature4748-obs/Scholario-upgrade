import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

// ============================================================
// LR-1 — Audience scoping for school announcements (shared lib)
// ------------------------------------------------------------
// One source of truth for "which announcements is THIS viewer allowed
// to see", used by BOTH the bell feed (/api/notifications-feed) and
// the student Notices module (/api/student/notices). Audience tags are
// free-form (`ALL`, `STUDENTS`, `CLASS:<class name>`, …) so matching
// stays defensive and case-insensitive.
//
// Communication-Hub audience vocabulary (v2.17):
//   CLASS:<label>          → students AND parents of that class
//   CLASS_STUDENTS:<label> → only the students of that class
//   CLASS_PARENTS:<label>  → only the parents (guardians) of that class
// Staff roles (principal/teacher/super admin) always see class-targeted
// notices for oversight.
// ============================================================

/** Which announcement audiences each viewer role is allowed to see. */
const AUDIENCE_BY_ROLE: Record<string, string[]> = {
  PRINCIPAL: ['ALL', 'TEACHERS', 'STAFF', 'STUDENTS', 'PRINCIPAL', 'ADMIN'],
  TEACHER: ['ALL', 'TEACHERS', 'STAFF'],
  STUDENT: ['ALL', 'STUDENTS'],
  PARENT: ['ALL', 'PARENTS', 'GUARDIANS'],
}

/** Split an audience tag into { kind, target } for class-family tags. */
function classAudienceOf(audience: string): { kind: 'class' | 'students' | 'parents'; target: string } | null {
  const upper = audience.trim().toUpperCase()
  if (upper.startsWith('CLASS_STUDENTS:')) {
    const target = audience.trim().slice(15).trim()
    return target ? { kind: 'students', target } : null
  }
  if (upper.startsWith('CLASS_PARENTS:')) {
    const target = audience.trim().slice(13).trim()
    return target ? { kind: 'parents', target } : null
  }
  if (upper.startsWith('CLASS:')) {
    const target = audience.trim().slice(6).trim()
    return target ? { kind: 'class', target } : null
  }
  return null
}

/** True when `mine` (a class name) matches the audience target class —
 *  exact, grade-wide ("Grade 10" reaches "Grade 10 - A") or the same
 *  leading grade number ("Class 9" ↔ "Grade 9 - A"). */
function classMatches(target: string, mine: string): boolean {
  const t = target.trim().toUpperCase()
  const m = mine.trim().toUpperCase()
  if (!t || !m) return false
  if (t === m) return true
  const baseOf = (s: string) => s.replace(/[-–]\s*[A-Z]\s*$/, '').trim()
  if (baseOf(m) === baseOf(t) || m.startsWith(t) || t.startsWith(m)) return true
  // Cross-vocabulary grade match: the ERP layer names cohorts "Class 9"
  // while school rosters use "Grade 9 - A". Compare the leading grade
  // number before giving up (a class-wide audience reaches every
  // section of that grade).
  const gradeOf = (s: string) => s.match(/\d+/)?.[0] ?? null
  const tGrade = gradeOf(t)
  const mGrade = gradeOf(m)
  return !!tGrade && !!mGrade && tGrade === mGrade
}

/**
 * Audience tags decide visibility per viewer role. Class-family tags
 * (`CLASS:` / `CLASS_STUDENTS:` / `CLASS_PARENTS:`) target a specific
 * class roster:
 *   · students see them when the class is their own
 *   · parents see them when the class is one of their wards'
 *   · staff (principal/teacher) always see them for oversight
 */
export async function audienceAllows(
  audience: string | null | undefined,
  user: { id: string; role: string; schoolId: string | null },
): Promise<boolean> {
  if (!audience) return true
  const aud = audience.trim()
  const cls = classAudienceOf(aud)
  if (!cls) return baseAudienceAllows(aud, user.role)

  // Students: CLASS + CLASS_STUDENTS reach them when the class is theirs.
  if (user.role === 'STUDENT') {
    if (cls.kind === 'parents') return false
    const student = await db.student.findUnique({
      where: { userId: user.id },
      include: { class: { select: { name: true } } },
    })
    if (!student?.class?.name) return false
    return classMatches(cls.target, student.class.name)
  }

  // Parents: CLASS + CLASS_PARENTS reach them when the class is a ward's.
  if (user.role === 'PARENT') {
    if (cls.kind === 'students') return false
    const wards = await db.student.findMany({
      where: { guardianId: user.id },
      include: { class: { select: { name: true } } },
      take: 12,
    })
    return wards.some((w) => w.class?.name != null && classMatches(cls.target, w.class.name))
  }

  // Staff oversight — principals & teachers see every class notice.
  if (user.role === 'PRINCIPAL' || user.role === 'TEACHER' || user.role === 'SUPER_ADMIN') return true
  return false
}

function baseAudienceAllows(audience: string, role: string): boolean {
  const allowed = AUDIENCE_BY_ROLE[role] ?? ['ALL']
  return allowed.includes(audience.trim().toUpperCase())
}

/**
 * Synchronous audience verdict for STAFF viewers (teacher / principal /
 * super admin) — Phase 8B-7-f fix.
 *
 * WHY: the teacher dashboard previously called the async `audienceAllows`
 * inside `.filter((n) => audienceAllows(n.audience, user))` WITHOUT
 * awaiting — every call returned a truthy Promise, so the filter was a
 * no-op that passed EVERY row. Staff roles never reach the DB-backed
 * branches of `audienceAllows` (student/parent class matching), so their
 * verdict is expressible synchronously — this helper is that branch
 * without the await.
 *
 * CONTRACT (deliberate deviation, documented): staff rows pass through
 * UNCONDITIONALLY — audience does not change the staff verdict. A strict
 * base-tag filter (TEACHER → ALL/TEACHERS/STAFF + class-family tags)
 * would now EXCLUDE rows the broken no-op filter shipped as visible
 * (e.g. STUDENTS/PARENTS-tagged announcements inside a staff feed
 * window), changing teacher-visible notice semantics. To keep the
 * dashboard's visible rows identical to what teachers see today, the
 * historical staff pass-through is preserved; staff oversight of
 * class-targeted notices (the `audienceAllows` staff rule) is unchanged.
 * Applying real base-tag scoping for staff is a product decision, not a
 * perf fix. NON-staff roles return false here by design — students and
 * parents MUST use the async `audienceAllows` (their class matching hits
 * the DB); a misuse of this helper can never silently widen their access.
 */
export function audienceAllowsStaff(audience: string | null | undefined, role: string): boolean {
  // The staff verdict is audience-independent (documented pass-through);
  // the parameter is kept for signature parity with `audienceAllows` so
  // call sites read identically.
  void audience
  return role === 'PRINCIPAL' || role === 'TEACHER' || role === 'SUPER_ADMIN'
}

/**
 * Prisma `where` fragment for Notification reads: only rows that are
 * published (publishAt null or in the past) and not expired (expiresAt
 * null or in the future). Every feed/list reader spreads this into its
 * school-scoped query so scheduled and expired announcements behave
 * identically everywhere.
 */
export function notificationVisibilityWhere(now = new Date()): Prisma.NotificationWhereInput {
  return {
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  }
}

/** Human label for an audience tag — powers the small context chip. */
export function audienceLabel(audience: string | null | undefined): string {
  if (!audience) return 'School'
  const aud = audience.trim()
  const cls = classAudienceOf(aud)
  if (cls) {
    if (cls.kind === 'parents') return `Parents of ${cls.target}`
    if (cls.kind === 'students') return `Students of ${cls.target}`
    return cls.target
  }
  const upper = aud.toUpperCase()
  if (upper === 'ALL') return 'Whole school'
  if (upper === 'STUDENTS') return 'Students'
  if (upper === 'TEACHERS') return 'Teachers'
  if (upper === 'STAFF') return 'Staff'
  if (upper === 'PARENTS' || upper === 'GUARDIANS') return 'Parents'
  return aud
}
