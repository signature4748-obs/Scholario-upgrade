import type { PositionDefinition, TeacherRecord } from './types'
import { useCurrentUser } from '@/lib/store/current-user-store'

/**
 * Session actor (7-POLISH) — the REAL signed-in user's name for
 * workspace-side audit entries, resolved from the server identity store
 * (/api/auth/me → AppShell hydration), NEVER a fabricated person. Falls
 * back to the honest generic 'Principal' while the identity is not yet
 * hydrated (or a degraded fetch) so no fake name can ever render.
 */
export function sessionActorName(): string {
  const name = useCurrentUser.getState().me?.name
  return name?.trim() || 'Principal'
}

/**
 * Permission derivation — the single model shared by the Teacher Profile
 * UI, the teacher portal client and server authorization (e.g. the
 * announcement route). Permissions are DERIVED, never manually edited:
 *
 *   TEACHING ACCESS     ⟺ the teacher has an actual teaching allocation
 *                        (subjects or classes) → Subject Teacher set.
 *                        Removing the allocation removes the permissions.
 *   CLASS TEACHER       canonical Class/Section appointment only
 *                        (Students & Classes → Classes). A teacher-side
 *                        Class Teacher position assignment NEVER
 *                        contributes — there is no duplicate state.
 *   RESPONSIBILITIES    every ACTIVE responsibility assignment grants
 *                        its definition's permission set. Removed or
 *                        pending responsibilities grant nothing.
 */

function isSubjectTeacherDef(def: PositionDefinition): boolean {
  return def.id === 'pos-subject-teacher' || /subject\s*teacher/i.test(def.title)
}

function isClassTeacherDef(def: PositionDefinition): boolean {
  return def.id === 'pos-class-teacher' || /class\s*teacher/i.test(def.title)
}

export function getTeacherActivePermissions(teacher: TeacherRecord, positionsList: PositionDefinition[]): string[] {
  const permissionsSet = new Set<string>()

  // 1) Teaching access derives from the ACTUAL teaching allocation — an
  //    assigned subject or class is what grants subject-teacher access.
  const hasTeachingAllocation = teacher.subjects.length > 0 || teacher.classes.length > 0
  const subjectTeacherDef = positionsList.find(isSubjectTeacherDef)
  if (hasTeachingAllocation && subjectTeacherDef) {
    subjectTeacherDef.permissions.forEach((perm) => permissionsSet.add(perm))
  }

  // 2) Active responsibilities contribute their definitions' permissions.
  //    Subject Teacher assignments are covered by rule 1 (allocation),
  //    and Class Teacher is a canonical appointment (never granted from
  //    the teacher side) — both are excluded here.
  teacher.positions
    .filter((p) => p.status === 'Active')
    .forEach((assignment) => {
      const def = positionsList.find((p) => p.id === assignment.positionId)
      if (!def) return
      if (isSubjectTeacherDef(def) || isClassTeacherDef(def)) return
      def.permissions.forEach((perm) => permissionsSet.add(perm))
    })

  return Array.from(permissionsSet)
}
