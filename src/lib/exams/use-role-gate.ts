'use client'

/**
 * useRoleGate — client-side RBAC for the Examinations module.
 * Reads the current user's role from the auth store and provides
 * permission checks for sensitive exam actions.
 *
 * Backend RBAC is the source of truth — this is a UX layer that
 * hides controls the user cannot use, so they don't see rejection toasts.
 */

import { useAuth } from '@/lib/store/auth-store'

export type ExamRole = 'principal' | 'teacher' | 'student'

interface RoleGate {
  role: ExamRole | null
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  canSubmitMarks: boolean
  canVerifyMarks: boolean
  canLockMarks: boolean
  canDeclareResults: boolean
  canPublishResults: boolean
  canApplyGrace: boolean
  canOverrideOutcome: boolean
  canGenerateSeating: boolean
  canAssignInvigilator: boolean
  canImportCsv: boolean
  canManageSchedule: boolean
}

export function useRoleGate(): RoleGate {
  const user = useAuth((s) => s.user)

  if (!user) {
    return {
      role: null,
      canCreate: false, canEdit: false, canDelete: false,
      canSubmitMarks: false, canVerifyMarks: false, canLockMarks: false,
      canDeclareResults: false, canPublishResults: false,
      canApplyGrace: false, canOverrideOutcome: false,
      canGenerateSeating: false, canAssignInvigilator: false,
      canImportCsv: false, canManageSchedule: false,
    }
  }

  const role = user.role as ExamRole
  const isPrincipal = role === 'principal'
  const isTeacher = role === 'teacher'

  return {
    role,
    canCreate: isPrincipal,
    canEdit: isPrincipal,
    canDelete: isPrincipal,
    canSubmitMarks: isPrincipal || isTeacher,
    canVerifyMarks: isPrincipal,
    canLockMarks: isPrincipal,
    canDeclareResults: isPrincipal,
    canPublishResults: isPrincipal,
    canApplyGrace: isPrincipal,
    canOverrideOutcome: isPrincipal,
    canGenerateSeating: isPrincipal,
    canAssignInvigilator: isPrincipal,
    canImportCsv: isPrincipal || isTeacher,
    canManageSchedule: isPrincipal,
  }
}
