'use client'

import { useState, useMemo } from 'react'
import {
  useTeachersStore,
  type TeacherRecord,
} from '@/lib/store/teachers-store'

export type ActiveTab = 'directory' | 'letters' | 'logs' | 'add'

export interface TeacherCredentials {
  username: string
  tempPassword: string
  name: string
  empId: string
}

/**
 * Pure state holder for the Teachers module — all useState hooks,
 * the filteredTeachers memo, and derived stats live here. Action
 * handlers live in `useTeachersActions`.
 */
export function useTeachersState() {
  const {
    teachers,
    positionsList,
    auditLogs,
    syncStatus,
    addTeacher,
    addCustomPosition,
    assignPositionToTeacher,
    emergencyOverridePosition,
    removePositionFromTeacher,
    assignSubjectsAndClasses,
    regenerateAppointmentLetter,
    issueAppointmentLetter,
    setTeacherMedia,
    resetTeacherPassword,
    toggleLockTeacherAccount,
    requestPayrollRevision,
    terminateTeacher,
  } = useTeachersStore()

  const [activeTab, setActiveTab] = useState<ActiveTab>('directory')
  const [search, setSearch] = useState('')
  const [dept, setDept] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRecord | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [joiningModalOpen, setJoiningModalOpen] = useState(false)
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [currentCredentials, setCurrentCredentials] = useState<TeacherCredentials | null>(null)

  const [lockModalOpen, setLockModalOpen] = useState(false)
  const [lockConfirmText, setLockConfirmText] = useState('')

  const [payrollModalOpen, setPayrollModalOpen] = useState(false)
  const [proposedSalaryInput, setProposedSalaryInput] = useState<number>(65000)

  const [terminationModalOpen, setTerminationModalOpen] = useState(false)
  const [terminationReason, setTerminationReason] = useState('Contract Completion')
  const [confirmTerminateText, setConfirmTerminateText] = useState('')
  const [lockLoginOnTerminate, setLockLoginOnTerminate] = useState(false)

  const [assignPosModalOpen, setAssignPosModalOpen] = useState(false)
  const [customPosModalOpen, setCustomPosModalOpen] = useState(false)
  const [emergencyOverrideModalOpen, setEmergencyOverrideModalOpen] = useState(false)
  const [overrideTeacherId, setOverrideTeacherId] = useState('')
  const [selectedPosForOverride, setSelectedPosForOverride] = useState<string>('')
  const [overrideAuthCode, setOverrideAuthCode] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  const [targetTeacherIdForPos, setTargetTeacherIdForPos] = useState('')
  const [selectedPosIdToAssign, setSelectedPosIdToAssign] = useState('')

  const [workloadModalOpen, setWorkloadModalOpen] = useState(false)
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])

  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.designation.toLowerCase().includes(search.toLowerCase()) ||
        t.employeeId.toLowerCase().includes(search.toLowerCase()) ||
        t.subjects.join(' ').toLowerCase().includes(search.toLowerCase())
      const matchesDept = dept === 'all' || t.department === dept
      // Per spec — Relieved teachers should NOT appear in the normal
      // Faculty Directory. They live in their own Archived/Relieved view.
      // The statusFilter 'archived' surfaces them; otherwise they're hidden.
      const isRelieved = t.status === 'Relieved'
      const matchesStatus = isRelieved
        ? statusFilter === 'archived'   // only show if explicitly filtering for archived
        : statusFilter === 'all' || t.status === statusFilter
      return matchesSearch && matchesDept && matchesStatus
    })
  }, [teachers, search, dept, statusFilter])

  const totalTeachers = teachers.length
  const activeTeachersCount = teachers.filter((t) => t.status === 'Active').length
  const onLeaveCount = teachers.filter((t) => t.status === 'On Leave').length
  const relievedCount = teachers.filter((t) => t.status === 'Relieved').length
  // Active payroll excludes Relieved teachers (they're no longer paid)
  const avgAttendance = Math.round(
    teachers.filter((t) => t.status !== 'Relieved').reduce((a, t) => a + t.attendance, 0) /
    (teachers.filter((t) => t.status !== 'Relieved').length || 1)
  )
  const totalSalary = teachers.filter((t) => t.status !== 'Relieved').reduce((a, t) => a + t.salary, 0)

  return {
    // store data + actions
    teachers, positionsList, auditLogs, syncStatus,
    addTeacher, addCustomPosition,
    assignPositionToTeacher, emergencyOverridePosition,
    removePositionFromTeacher, assignSubjectsAndClasses,
    regenerateAppointmentLetter, issueAppointmentLetter, setTeacherMedia,
    resetTeacherPassword,
    toggleLockTeacherAccount, requestPayrollRevision, terminateTeacher,
    // navigation
    activeTab, setActiveTab,
    // search / filter
    search, setSearch, dept, setDept, statusFilter, setStatusFilter,
    filteredTeachers,
    // derived stats
    totalTeachers, activeTeachersCount, onLeaveCount, avgAttendance, totalSalary,
    relievedCount,
    // selection + sheet
    selectedTeacher, setSelectedTeacher,
    sheetOpen, setSheetOpen,
    // appointment letter
    appointmentModalOpen, setAppointmentModalOpen,
    // joining letter
    joiningModalOpen, setJoiningModalOpen,
    // credentials
    credentialsModalOpen, setCredentialsModalOpen,
    currentCredentials, setCurrentCredentials,
    // lock modal
    lockModalOpen, setLockModalOpen,
    lockConfirmText, setLockConfirmText,
    // payroll modal
    payrollModalOpen, setPayrollModalOpen,
    proposedSalaryInput, setProposedSalaryInput,
    // termination modal
    terminationModalOpen, setTerminationModalOpen,
    terminationReason, setTerminationReason,
    confirmTerminateText, setConfirmTerminateText,
    lockLoginOnTerminate, setLockLoginOnTerminate,
    // assign position modal
    assignPosModalOpen, setAssignPosModalOpen,
    targetTeacherIdForPos, setTargetTeacherIdForPos,
    selectedPosIdToAssign, setSelectedPosIdToAssign,
    // custom position modal
    customPosModalOpen, setCustomPosModalOpen,
    // emergency override modal
    emergencyOverrideModalOpen, setEmergencyOverrideModalOpen,
    overrideTeacherId, setOverrideTeacherId,
    selectedPosForOverride, setSelectedPosForOverride,
    overrideAuthCode, setOverrideAuthCode,
    overrideReason, setOverrideReason,
    // workload modal
    workloadModalOpen, setWorkloadModalOpen,
    selectedSubjects, setSelectedSubjects,
    selectedClasses, setSelectedClasses,
  }
}

export type TeachersState = ReturnType<typeof useTeachersState>
