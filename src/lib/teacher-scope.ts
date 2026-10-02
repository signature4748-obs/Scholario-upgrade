/**
 * teacher-scope — THE canonical assignment-driven teacher permission model
 * (IQ3000 Phase 4).
 *
 *   Principal configures the school
 *     → ClassSubjectAssignment (subject · class · teacherUserId)  ← NEW
 *       + Class.classTeacherId (class teacher appointment)
 *     → THIS module resolves a teacher's EFFECTIVE scope
 *     → marks entry / attendance / directory / fee-collection guards all
 *       consume the SAME resolution.
 *
 * Resolution rules:
 *   · SUBJECT assignments: ACTIVE CSA rows whose teacherUserId is the
 *     teacher's USER id. FALLBACK: timetable rows whose teacherUserId (or,
 *     pre-migration, case-insensitive teacherName) match — kept so nothing
 *     breaks during the transition, but CSA is the authoritative record.
 *   · CLASS-TEACHER classes: Class.classTeacherId = user id (unchanged).
 *
 * Server guards use `teacherCanEnterMarks` / `teacherClassScope`; read
 * surfaces (pickers) use `getTeacherSubjectAssignments`.
 */

import { db } from '@/lib/db'

/** Minimal user shape both AuthUser and AuthUserLike satisfy. */
export interface ScopedUser {
  id: string
  name: string | null
  /** Optional so narrower identity shapes (id+name only) can call the
   *  resolvers — role is never read here. */
  role?: string
}

export interface SubjectAssignment {
  classId: string
  subjectId: string
  /** Where this row came from — CSA is canonical, TIMETABLE is fallback. */
  source: 'CSA' | 'TIMETABLE'
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Every ACTIVE (class, subject) the teacher is appointed to teach — the
 * canonical CSA appointments UNION the timetable fallback (name-matched).
 */
export async function getTeacherSubjectAssignments(
  user: ScopedUser,
  schoolId: string,
): Promise<SubjectAssignment[]> {
  const out = new Map<string, SubjectAssignment>()

  // 1 — canonical CSA appointments (teacherUserId FK).
  // 2 — timetable fallback: relational id first, legacy name-match second.
  // 8B-7-f — the two scope reads are independent of each other: ONE
  // parallel round (was two sequential pooler round-trips). The `out` map
  // is still keyed CSA-first, so the resolution result is identical.
  const [csaRows, ttRows] = await Promise.all([
    db.classSubjectAssignment.findMany({
      where: { schoolId, isActive: true, teacherUserId: user.id },
      select: { classId: true, subjectId: true },
    }),
    db.timetable.findMany({
      where: { schoolId, subjectId: { not: null } },
      select: { classId: true, subjectId: true, teacherUserId: true, teacherName: true },
    }),
  ])
  for (const r of csaRows) out.set(`${r.classId}|${r.subjectId}`, { ...r, source: 'CSA' })
  const byId = new Set<string>()
  const byName = new Set<string>()
  for (const r of ttRows) {
    if (!r.subjectId) continue
    if (r.teacherUserId === user.id) byId.add(`${r.classId}|${r.subjectId}`)
    else if (!r.teacherUserId && norm(r.teacherName) === norm(user.name)) {
      byName.add(`${r.classId}|${r.subjectId}`)
    }
  }
  for (const k of byId) {
    if (!out.has(k)) {
      const [classId, subjectId] = k.split('|')
      out.set(k, { classId, subjectId, source: 'TIMETABLE' })
    }
  }
  for (const k of byName) {
    if (!out.has(k)) {
      const [classId, subjectId] = k.split('|')
      out.set(k, { classId, subjectId, source: 'TIMETABLE' })
    }
  }

  return [...out.values()]
}

/**
 * GUARD — may this teacher enter/modify marks for (classId, subjectId)?
 * Class-teacher appointment alone does NOT grant subject marks entry
 * (Phase 8): the teacher must hold the subject assignment.
 */
export async function teacherCanEnterMarks(
  user: ScopedUser,
  schoolId: string,
  classId: string,
  subjectId: string,
): Promise<boolean> {
  const assignments = await getTeacherSubjectAssignments(user, schoolId)
  return assignments.some((a) => a.classId === classId && a.subjectId === subjectId)
}

/**
 * The class ids the teacher may operate on as CLASS TEACHER (My Class,
 * fee collection, baseline attendance).
 */
export async function getTeacherClassTeacherClasses(
  user: ScopedUser,
  schoolId: string,
): Promise<{ id: string; name: string; section: string | null }[]> {
  return db.class.findMany({
    where: { schoolId, classTeacherId: user.id },
    select: { id: true, name: true, section: true },
    orderBy: { name: 'asc' },
  })
}
