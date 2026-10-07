'use client'

import { toast } from 'sonner'
import { useAuth } from '@/lib/store/auth-store'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import type { TeachersState } from './use-teachers-state'

/**
 * Action handlers for the Teachers module. Takes the populated state
 * object from `useTeachersState` and returns the handler functions
 * used by tabs, sheets, and modals. Keeps handler logic out of the
 * state hook so each file stays under the 300-line budget.
 */
export function useTeachersActions(s: TeachersState) {
  const { switchTo } = useAuth()

  const openTeacherProfile = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setSheetOpen(true)
  }

  const handleLoginAsTeacher = (t?: TeacherRecord) => {
    const targetName = t ? t.name : 'Rohan Mehta'
    toast.success('Switching to Teacher Portal', {
      description: `Logging in as ${targetName} — live permission view.`,
    })
    setTimeout(() => switchTo('teacher'), 600)
  }

  const handleOpenAppointmentLetter = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    if (!t.appointmentLetter) {
      s.issueAppointmentLetter(t.id)
    }
    s.setAppointmentModalOpen(true)
  }

  const handleOpenJoiningLetter = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setJoiningModalOpen(true)
  }

  const handleResetPassword = (t: TeacherRecord) => {
    const creds = s.resetTeacherPassword(t.id)
    s.setCurrentCredentials({
      name: t.name,
      empId: t.employeeId,
      username: creds.username,
      tempPassword: creds.tempPassword,
    })
    s.setCredentialsModalOpen(true)
  }

  const handleOpenPayrollModal = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setProposedSalaryInput(t.salary)
    s.setPayrollModalOpen(true)
  }

  const handleSubmitPayrollRevision = () => {
    if (!s.selectedTeacher || s.proposedSalaryInput <= 0) {
      toast.error('Invalid Proposed Salary Amount')
      return
    }
    const { code } = s.requestPayrollRevision(s.selectedTeacher.id, s.proposedSalaryInput)
    s.setPayrollModalOpen(false)
    toast.success(`Payroll Revision Requested (Code: ${code})`, {
      description: `Confirmation code sent to ${s.selectedTeacher.name}'s panel. Change will apply upon teacher code entry.`,
    })
  }

  const handleOpenTerminationModal = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setConfirmTerminateText('')
    s.setTerminationReason('Resignation / End of Tenure')
    s.setLockLoginOnTerminate(true)
    s.setTerminationModalOpen(true)
  }

  const handleConfirmTermination = async () => {
    const target = s.selectedTeacher
    if (!target) return
    if (s.confirmTerminateText.trim().toUpperCase() !== 'TERMINATE') {
      toast.error('Type "TERMINATE" to confirm action', {
        description: 'Safety check: Enter the exact confirmation string.',
      })
      return
    }
    // TQA-14 — SERVER-FIRST relief: the canonical route releases the
    // class-teacher appointment, deactivates subject assignments and (when
    // chosen) suspends the login — atomically, with a real-actor audit
    // row. The store update below is only the local mirror of the server
    // truth; a failed request leaves the record untouched.
    try {
      const res = await fetch(`/api/teachers/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'terminate',
          reason: s.terminationReason,
          lockLogin: s.lockLoginOnTerminate,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Relief failed (${res.status})`)
      }
      s.terminateTeacher(target.id, s.terminationReason, s.lockLoginOnTerminate)
      s.setTerminationModalOpen(false)
      s.setSheetOpen(false)
      toast.success(`Staff Relieved: ${target.name}`, {
        description: `Record archived with full history preserved. Login locked: ${s.lockLoginOnTerminate}. Viewable under Archived / Relieved filter.`,
      })
    } catch (e) {
      toast.error('Relief could not be recorded', {
        description: e instanceof Error ? e.message : 'The server rejected the relief request. Nothing was changed.',
      })
    }
  }

  const handleConfirmAssignPosition = ({ effectiveDate, assignedBy }: { effectiveDate: string; assignedBy: string }) => {
    if (!s.targetTeacherIdForPos || !s.selectedPosIdToAssign) {
      toast.error('Choose a responsibility to assign')
      return
    }
    // Class Teacher is a canonical appointment (Students & Classes → Classes)
    // — it can never be assigned through the responsibility flow.
    if (s.selectedPosIdToAssign === 'pos-class-teacher') {
      toast.error('Class Teacher is assigned from Students & Classes → Classes')
      return
    }
    s.assignPositionToTeacher(
      s.targetTeacherIdForPos,
      s.selectedPosIdToAssign,
      assignedBy || undefined,
      undefined,
      effectiveDate,
    )
    s.setAssignPosModalOpen(false)
    toast.success('Responsibility assigned', {
      description: 'Pending acceptance by the teacher.',
    })
  }

  const handleConfirmEmergencyOverride = () => {
    if (s.overrideAuthCode !== 'OVERRIDE-2025' && s.overrideAuthCode !== '123456') {
      toast.error('Invalid authorization code', { description: 'Emergency override requires the Principal code.' })
      return
    }
    if (!s.overrideReason.trim()) {
      toast.error('Reason required', { description: 'The override reason is recorded in the audit trail.' })
      return
    }
    if (!s.overrideTeacherId || !s.selectedPosForOverride) {
      toast.error('Choose a responsibility to activate')
      return
    }
    if (s.selectedPosForOverride === 'pos-class-teacher') {
      toast.error('Class Teacher is assigned from Students & Classes → Classes')
      return
    }
    const target = s.teachers.find((t) => t.id === s.overrideTeacherId)
    if (!target) return

    s.emergencyOverridePosition(s.overrideTeacherId, s.selectedPosForOverride, s.overrideReason, s.overrideAuthCode)
    s.setEmergencyOverrideModalOpen(false)
    s.setOverrideAuthCode('')
    s.setOverrideReason('')
    toast.success('Emergency override activated', {
      description: `Permissions activated instantly for ${target.name}. Recorded in the audit trail.`,
    })
  }

  const handleOpenLockModal = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setLockConfirmText('')
    s.setLockModalOpen(true)
  }

  const handleConfirmLockToggle = () => {
    if (!s.selectedTeacher) return
    const requiredStr = s.selectedTeacher.isLocked ? 'UNLOCK' : 'LOCK'
    if (s.lockConfirmText.trim().toUpperCase() !== requiredStr) {
      toast.error(`Type "${requiredStr}" to confirm action`)
      return
    }
    s.toggleLockTeacherAccount(s.selectedTeacher.id, !s.selectedTeacher.isLocked)
    s.setLockModalOpen(false)
    toast.success(`Portal Account ${!s.selectedTeacher.isLocked ? 'Locked' : 'Unlocked'} for ${s.selectedTeacher.name}`)
  }

  const handleSaveWorkload = () => {
    if (!s.selectedTeacher) return
    const { selectedSubjects, selectedClasses } = s
    s.assignSubjectsAndClasses(s.selectedTeacher.id, selectedSubjects, selectedClasses)
    s.setWorkloadModalOpen(false)
    toast.success('Allocation updated', {
      description: `${selectedSubjects.length} ${selectedSubjects.length === 1 ? 'subject' : 'subjects'} · ${selectedClasses.length} ${selectedClasses.length === 1 ? 'class' : 'classes'}`,
    })
  }

  /** From the teacher profile: open the WorkloadAllocationModal
   *  pre-targeted at this teacher with the current allocation prefilled. */
  const handleManageWorkload = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setSelectedSubjects(t.subjects)
    s.setSelectedClasses(t.classes)
    s.setWorkloadModalOpen(true)
  }

  /** From the teacher profile: open the AssignPositionModal pre-targeted
   *  at this teacher (responsibilities hub). */
  const handleManageResponsibilities = (t: TeacherRecord) => {
    s.setTargetTeacherIdForPos(t.id)
    s.setSelectedPosIdToAssign('')
    s.setAssignPosModalOpen(true)
  }

  return {
    openTeacherProfile,
    handleLoginAsTeacher,
    handleOpenAppointmentLetter,
    handleOpenJoiningLetter,
    handleResetPassword,
    handleOpenPayrollModal,
    handleSubmitPayrollRevision,
    handleOpenTerminationModal,
    handleConfirmTermination,
    handleConfirmAssignPosition,
    handleConfirmEmergencyOverride,
    handleOpenLockModal,
    handleConfirmLockToggle,
    handleSaveWorkload,
    handleManageWorkload,
    handleManageResponsibilities,
  }
}

export type TeachersActions = ReturnType<typeof useTeachersActions>
