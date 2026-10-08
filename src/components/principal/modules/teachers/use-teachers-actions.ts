'use client'

import { toast } from 'sonner'
import { useAuth } from '@/lib/store/auth-store'
import { useSalaryStore } from '@/lib/store/salary-store'
import type { TeacherRecord } from '@/lib/store/teachers-store'
import { resetTeachersSyncGuard, syncTeachersFromServer } from '@/lib/store/teachers-store/server-sync'
import type { TeachersState } from './use-teachers-state'

/**
 * Action handlers for the Teachers module. Takes the populated state
 * object from `useTeachersState` and returns the handler functions
 * used by tabs, sheets, and modals. Keeps handler logic out of the
 * state hook so each file stays under the 300-line budget.
 *
 * 7-B — the credential reset and portal lock handlers are SERVER-FIRST
 * (PATCH /api/teachers/[id] reset-credential / set-status): the client
 * never fabricates a credential or a lock state; local store writes are
 * only mirrors of confirmed server truth.
 */
export function useTeachersActions(s: TeachersState) {
  const { switchTo } = useAuth()
  const setSalaryStructure = useSalaryStore((st) => st.setStructure)

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

  /** 7-B — server-first credential reset. The route mints a REAL one-time
   *  temp password (the same generator the platform reset-credentials
   *  route uses), re-arms the forced-change state and revokes every live
   *  session; the slip below is the ONLY place the password ever appears
   *  (component state, never persisted, never logged). */
  const handleResetPassword = async (t: TeacherRecord) => {
    try {
      const res = await fetch(`/api/teachers/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'reset-credential' }),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { tempPassword?: string; revokedSessions?: number } }
        | null
      if (!res.ok || !json?.ok || !json.data?.tempPassword) {
        throw new Error(json?.error || `Credential reset failed (${res.status})`)
      }
      s.setCurrentCredentials({
        name: t.name,
        empId: t.employeeId,
        username: t.loginCredentials?.username || t.email,
        // The REAL server-issued credential — displayed once.
        tempPassword: json.data.tempPassword,
      })
      s.setCredentialsModalOpen(true)
      // Local mirror of the server truth (no secret material stored).
      s.updateTeacher(t.id, {
        loginCredentials: { ...t.loginCredentials, passwordResetRequired: true },
      })
      // Re-pull the roster so the record follows server truth.
      resetTeachersSyncGuard()
      void syncTeachersFromServer()
      toast.success(`Password reset for ${t.name}`, {
        description: `${json.data.revokedSessions ?? 0} active session(s) signed out. The one-time passcode must be changed at the next sign-in.`,
      })
    } catch (e) {
      toast.error('Password reset could not be completed', {
        description: e instanceof Error ? e.message : 'The server rejected the request. No credential was changed.',
      })
    }
  }

  /** 7-B — open the salary-structure dialog pre-targeted at this teacher,
   *  prefilled from the canonical salary cache (server truth). */
  const handleOpenSalaryModal = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    const structure = useSalaryStore.getState().structures.find((x) => x.teacherId === t.id)
    s.setSalaryAmountInput(structure ? String(structure.monthlyAmount) : '')
    s.setSalaryEffectiveFromInput(new Date().toISOString().split('T')[0])
    s.setSalaryError(null)
    s.setSalaryModalOpen(true)
  }

  /** 7-C — REAL salary write: PUT /api/salary/structure through the salary
   *  module's canonical store action (zod strict body, per-teacher upsert,
   *  SALARY_STRUCTURE_SET audit, 30/h rate limit). Fixed monthly amount
   *  only — no HRA/PF/tax/gross arithmetic exists. */
  const handleSubmitSalaryStructure = async () => {
    const target = s.selectedTeacher
    if (!target) return
    const amount = Math.floor(Number(s.salaryAmountInput))
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5_000_000) {
      s.setSalaryError('Enter a monthly amount between ₹1 and ₹50,00,000.')
      return
    }
    const effectiveFrom = /^\d{4}-\d{2}-\d{2}$/.test(s.salaryEffectiveFromInput)
      ? s.salaryEffectiveFromInput
      : undefined
    s.setSalarySubmitting(true)
    s.setSalaryError(null)
    try {
      await setSalaryStructure({
        teacherId: target.id,
        monthlyAmount: amount,
        effectiveFrom,
      })
      s.setSalaryModalOpen(false)
      // Local mirror so the directory payroll aggregate follows the server.
      s.updateTeacher(target.id, { salary: amount })
      toast.success('Monthly salary saved', {
        description: `${target.name} · ₹${amount.toLocaleString('en-IN')}/month${
          effectiveFrom ? ` · effective ${effectiveFrom}` : ''
        }. Payments, receipts and history live in the Salary & Payroll module.`,
      })
    } catch (e) {
      s.setSalaryError(
        e instanceof Error ? e.message : 'The server rejected the change. Nothing was saved.',
      )
    } finally {
      s.setSalarySubmitting(false)
    }
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

  const handleOpenLockModal = (t: TeacherRecord) => {
    s.setSelectedTeacher(t)
    s.setLockConfirmText('')
    s.setLockError(null)
    s.setLockModalOpen(true)
  }

  /** 7-B — server-first portal lock/unlock (PATCH set-status): SUSPENDED
   *  users cannot authenticate (login and withUser both refuse non-ACTIVE
   *  status) and their live sessions are revoked server-side. The store
   *  write below is only the local mirror of confirmed server truth. */
  const handleConfirmLockToggle = async () => {
    const target = s.selectedTeacher
    if (!target) return
    const requiredStr = target.isLocked ? 'UNLOCK' : 'LOCK'
    if (s.lockConfirmText.trim().toUpperCase() !== requiredStr) {
      toast.error(`Type "${requiredStr}" to confirm action`)
      return
    }
    const locked = !target.isLocked
    s.setLockSubmitting(true)
    s.setLockError(null)
    try {
      const res = await fetch(`/api/teachers/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'set-status',
          status: locked ? 'SUSPENDED' : 'ACTIVE',
          reason: `Portal account ${locked ? 'locked' : 'unlocked'} from the faculty module`,
        }),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { status?: string; revokedSessions?: number } }
        | null
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Account update failed (${res.status})`)
      }
      // Local mirror: a Relieved record keeps its archived status (lock is
      // orthogonal to relief); everything else reflects the server state.
      const mirrorStatus =
        target.status === 'Relieved' ? undefined : locked ? ('Suspended' as const) : ('Active' as const)
      s.updateTeacher(target.id, {
        isLocked: locked,
        ...(mirrorStatus ? { status: mirrorStatus } : {}),
      })
      s.setLockModalOpen(false)
      resetTeachersSyncGuard()
      void syncTeachersFromServer()
      toast.success(`Portal Account ${locked ? 'Locked' : 'Unlocked'} for ${target.name}`, {
        description: locked
          ? 'Sign-in is refused server-side until the account is unlocked. All history is preserved.'
          : 'The teacher can sign in again with their existing password.',
      })
    } catch (e) {
      s.setLockError(
        e instanceof Error ? e.message : 'The server rejected the request. The account was not changed.',
      )
    } finally {
      s.setLockSubmitting(false)
    }
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
    handleOpenSalaryModal,
    handleSubmitSalaryStructure,
    handleOpenTerminationModal,
    handleConfirmTermination,
    handleConfirmAssignPosition,
    handleOpenLockModal,
    handleConfirmLockToggle,
    handleSaveWorkload,
    handleManageWorkload,
    handleManageResponsibilities,
  }
}

export type TeachersActions = ReturnType<typeof useTeachersActions>
