'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  UserPlus, FileCheck, FileSpreadsheet,
  ChevronLeft, SlidersHorizontal, Users, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { PageTransition } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { departments, school } from '@/lib/mock/school'
import { toast } from 'sonner'
// PHASE 7 (Task 7-a) — canonical faculty hydration (server truth) + the
// honest retry affordance when the sync fails.
import { syncTeachersFromServer, resetTeachersSyncGuard } from '@/lib/store/teachers-store/server-sync'

import { ModuleHeader } from '../shared/module-header'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useFocusStore } from '@/lib/store/focus-store'
import { useTeachersState } from './use-teachers-state'
import { useTeachersActions } from './use-teachers-actions'
import { DirectoryTab } from './directory-tab'
import { AuditLogsTab } from './audit-logs-tab'
import { AppointmentLettersTab } from './appointment-letters-tab'
import { AppointmentLetterDocument } from './appointment-letter-document'
import { JoiningLetterDocument } from './joining-letter-document'
import { AddTeacherWizard } from './add-teacher-wizard'
import { TeacherProfilePage } from './teacher-profile-page'
import { TeacherSettingsPage } from './teacher-settings-page'
import {
  LockAccountModal, CredentialsSlipModal,
  TerminationModal,
} from './account-modals'
import {
  AssignPositionModal, EmergencyOverrideModal, CreateCustomPositionModal,
} from './position-modals'
import { WorkloadAllocationModal } from './workload-modal'

const TABS = [
  { id: 'directory', label: 'Directory', icon: Users } as const,
  { id: 'letters', label: 'Appointment Letters', icon: FileCheck } as const,
  { id: 'logs', label: 'Audit Logs', icon: FileSpreadsheet } as const,
]

export function TeachersModule() {
  const s = useTeachersState()
  const actions = useTeachersActions(s)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Canonical roster hydration (Phase 7): the faculty list follows the
  // school's REAL Teacher records. The once-per-session promise guard in
  // server-sync makes this free when the panel-mount sync already ran.
  useEffect(() => {
    void syncTeachersFromServer()
  }, [])

  // Honest retry — a failed sync keeps the existing data and flags
  // syncStatus 'error'; the principal can retry here. Seed data is never
  // re-injected.
  const handleRetrySync = () => {
    resetTeachersSyncGuard()
    void syncTeachersFromServer().then((ok) => {
      if (ok) toast.success('Faculty roster loaded from the school records')
      else toast.error('Still unable to load the faculty roster')
    })
  }

  // The responsibility-hub / override modals are pre-targeted at a specific
  // teacher — resolve that teacher for the modal's context header.
  const assignTargetTeacher = s.teachers.find((t) => t.id === s.targetTeacherIdForPos) ?? null
  const overrideTargetTeacher =
    s.teachers.find((t) => t.id === s.overrideTeacherId) ?? assignTargetTeacher

  // Live record: the selected teacher is re-resolved from the store on
  // every render so profile edits (positions, workload, media, letters)
  // made anywhere in the ERP reflect here immediately (Wave 2.3 §13).
  const liveSelectedTeacher = s.selectedTeacher
    ? s.teachers.find((t) => t.id === s.selectedTeacher!.id) ?? s.selectedTeacher
    : null

  // Class Teacher is a CANONICAL appointment managed in Students & Classes
  // → Classes — never a generic responsibility. It is filtered out of the
  // responsibility-assignment dropdowns here; the definition itself stays in
  // the positions list because it still powers the canonical class-teacher
  // permission set shown on the profile.
  const assignablePositions = useMemo(
    () => s.positionsList.filter(
      (p) => p.id !== 'pos-class-teacher' && !/class\s*teacher/i.test(p.title),
    ),
    [s.positionsList],
  )

  // Deep-link: command palette teacher results open the faculty profile
  // directly. The DB id doesn't exist in the demo roster, so match by
  // name (exact → prefix); fall back to the directory with an honest toast.
  const focus = useFocusStore((st) => st.focus)
  const clearFocus = useFocusStore((st) => st.clearFocus)
  const handledFocusTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'teacher' || handledFocusTs.current === focus.ts) return
    handledFocusTs.current = focus.ts
    clearFocus()
    const title = focus.title.toLowerCase().trim()
    const match =
      s.teachers.find((t) => t.name.toLowerCase() === title) ??
      s.teachers.find((t) => title.startsWith(t.name.toLowerCase())) ??
      s.teachers.find((t) => t.name.toLowerCase().includes(title))
    if (match) {
      s.setSelectedTeacher(match)
      s.setSheetOpen(true)
      toast.success(`Opened ${match.name}'s faculty profile`, { description: 'Deep-linked from global search' })
    } else {
      s.setActiveTab('directory')
      toast.info(`${focus.title} — faculty directory`, {
        description: 'Record synced from the school database. The interactive demo roster may not include every faculty member.',
      })
    }
  }, [focus?.ts])

  // Settings full-page sub-route — takes over the entire module area
  if (isSettingsOpen) {
    return (
      <PageTransition>
        <TeacherSettingsPage onBack={() => setIsSettingsOpen(false)} />
      </PageTransition>
    )
  }

  // Teacher Profile full-page sub-route — replaces the right-side drawer
  // with a proper Admissions-style workspace when a teacher is selected.
  // The modals below ALWAYS mount so documents open from the profile too.
  const showProfilePage = !!(s.sheetOpen && liveSelectedTeacher)

  return (
    <PageTransition className="space-y-4">
      {showProfilePage ? (
        <TeacherProfilePage
          teacher={liveSelectedTeacher!}
          positionsList={s.positionsList}
          onBack={() => { s.setSheetOpen(false); s.setSelectedTeacher(null) }}
          onOpenAppointment={() => actions.handleOpenAppointmentLetter(liveSelectedTeacher!)}
          onOpenJoiningLetter={() => actions.handleOpenJoiningLetter(liveSelectedTeacher!)}
          onResetPassword={() => actions.handleResetPassword(liveSelectedTeacher!)}
          onToggleLock={() => actions.handleOpenLockModal(liveSelectedTeacher!)}
          onOpenTermination={() => actions.handleOpenTerminationModal(liveSelectedTeacher!)}
          onManageWorkload={actions.handleManageWorkload}
          onManageResponsibilities={actions.handleManageResponsibilities}
        />
      ) : (
        <>
          <ModuleHeader
        meta={[`${s.totalTeachers} faculty`, `${departments.length} depts`, `AY ${school.academicYear}`]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsSettingsOpen(true)} className="text-xs gap-1.5 h-8">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Settings
            </Button>
            <Button size="sm" onClick={() => s.setActiveTab('add')} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 h-8">
              <UserPlus className="h-3.5 w-3.5" /> Add Teacher
            </Button>
          </>
        }
      />

      {/* PHASE 7 — honest sync failure affordance: the roster could not be
          loaded from the school records; the store keeps its last saved
          data and the principal can retry. */}
      {s.syncStatus === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-2.5"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
            Faculty roster couldn&apos;t be loaded from the school records — showing the last saved data.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetrySync}
            className="h-7 shrink-0 gap-1.5 border-amber-500/40 text-[11px] text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* Segmented tabs — shared component */}
      <SegmentedTabs
        tabs={TABS.map((tab) => {
          const Icon = tab.icon
          return {
            value: tab.id,
            label: tab.label,
            icon: <Icon className="h-3.5 w-3.5" />,
            badge: tab.id === 'directory' ? s.totalTeachers : tab.id === 'logs' ? s.auditLogs.length : undefined,
          }
        })}
        value={s.activeTab}
        onValueChange={(v) => s.setActiveTab(v as typeof s.activeTab)}
      />

      {/* TAB 1: FACULTY DIRECTORY */}
      {s.activeTab === 'directory' && (
        <DirectoryTab
          teachers={s.teachers}
          filteredTeachers={s.filteredTeachers}
          search={s.search} setSearch={s.setSearch}
          dept={s.dept} setDept={s.setDept}
          statusFilter={s.statusFilter} setStatusFilter={s.setStatusFilter}
          totalTeachers={s.totalTeachers}
          activeTeachersCount={s.activeTeachersCount}
          onLeaveCount={s.onLeaveCount}
          avgAttendance={s.avgAttendance}
          totalSalary={s.totalSalary}
          relievedCount={s.relievedCount}
          onOpenProfile={actions.openTeacherProfile}
        />
      )}

      {/* ADD TEACHER WIZARD — clean single container, no GlassCard wrapper */}
      {s.activeTab === 'add' && (
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={() => s.setActiveTab('directory')} className="gap-1 text-xs w-fit h-8">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to Directory
          </Button>

          <AddTeacherWizard
            onSuccess={(newTeacher) => {
              s.addTeacher(newTeacher)
              s.setActiveTab('directory')
              toast.success(`Teacher ${newTeacher.name} Registered!`, {
                description: `Employee ID: ${newTeacher.employeeId} · Credentials & Appointment Letter ready.`,
              })
            }}
            onCancel={() => s.setActiveTab('directory')}
          />
        </div>
      )}

      {/* TAB 2: APPOINTMENT LETTERS REPOSITORY */}
      {s.activeTab === 'letters' && (
        <AppointmentLettersTab
          teachers={s.teachers}
          onViewLetter={actions.handleOpenAppointmentLetter}
          onIssueNew={(id) => {
            s.issueAppointmentLetter(id)
            toast.success('New appointment letter issued', {
              description: 'The previously issued letter was archived unchanged — issued documents are immutable historical records.',
            })
          }}
        />
      )}

      {/* TAB 3: ACTIVITY AUDIT LOGS */}
      {s.activeTab === 'logs' && <AuditLogsTab auditLogs={s.auditLogs} />}
        </>
      )}

      {/* ============ MODALS — always mounted so they open from the
          profile page sub-route too ============ */}

      {/* APPOINTMENT LETTER PREVIEW & PRINT MODAL */}
      <Dialog open={s.appointmentModalOpen} onOpenChange={s.setAppointmentModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Appointment Letter Preview</DialogTitle>
            <DialogDescription>Preview, print and download the appointment letter</DialogDescription>
          </DialogHeader>
          {liveSelectedTeacher?.appointmentLetter && (
            <AppointmentLetterDocument
              letter={liveSelectedTeacher.appointmentLetter}
              teacher={liveSelectedTeacher}
              onClose={() => s.setAppointmentModalOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* JOINING LETTER MODAL */}
      <Dialog open={s.joiningModalOpen} onOpenChange={s.setJoiningModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Joining Letter Preview</DialogTitle>
            <DialogDescription>Preview, print and download the joining letter</DialogDescription>
          </DialogHeader>
          {liveSelectedTeacher && (
            <JoiningLetterDocument
              teacher={liveSelectedTeacher}
              onClose={() => s.setJoiningModalOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* LOCK / UNLOCK ACCOUNT MODAL */}
      <LockAccountModal
        open={s.lockModalOpen}
        onClose={() => s.setLockModalOpen(false)}
        teacher={s.selectedTeacher}
        lockConfirmText={s.lockConfirmText}
        setLockConfirmText={s.setLockConfirmText}
        onConfirm={actions.handleConfirmLockToggle}
      />

      {/* CREDENTIALS SLIP MODAL */}
      <CredentialsSlipModal
        open={s.credentialsModalOpen}
        onClose={() => s.setCredentialsModalOpen(false)}
        credentials={s.currentCredentials}
      />

      {/* ASSIGN RESPONSIBILITY MODAL — opened from a teacher's profile,
          pre-targeted at that teacher (context, not a form field) */}
      <AssignPositionModal
        open={s.assignPosModalOpen}
        onClose={() => s.setAssignPosModalOpen(false)}
        teacher={assignTargetTeacher}
        positionsList={assignablePositions}
        selectedPosIdToAssign={s.selectedPosIdToAssign}
        setSelectedPosIdToAssign={s.setSelectedPosIdToAssign}
        onConfirm={actions.handleConfirmAssignPosition}
        onCreateCustomPosition={() => s.setCustomPosModalOpen(true)}
        onEmergencyOverride={() => {
          // Carry the hub's current selection into the override modal.
          s.setOverrideTeacherId(s.targetTeacherIdForPos)
          s.setSelectedPosForOverride(s.selectedPosIdToAssign)
          s.setAssignPosModalOpen(false)
          s.setEmergencyOverrideModalOpen(true)
        }}
      />

      {/* CREATE CUSTOM RESPONSIBILITY MODAL — the definition joins the
          canonical positions list and is preselected for assignment */}
      <CreateCustomPositionModal
        open={s.customPosModalOpen}
        onClose={() => s.setCustomPosModalOpen(false)}
        onCreate={(pos) => {
          const created = s.addCustomPosition(pos)
          s.setSelectedPosIdToAssign(created.id)
          s.setCustomPosModalOpen(false)
          toast.success(`Custom responsibility "${pos.title}" created`, {
            description: 'Selected in the assign dialog — set the effective date and assign.',
          })
        }}
      />

      {/* EMERGENCY OVERRIDE MODAL — reached only through "More options";
          keeps auth code + mandatory reason + audit trail */}
      <EmergencyOverrideModal
        open={s.emergencyOverrideModalOpen}
        onClose={() => s.setEmergencyOverrideModalOpen(false)}
        teacher={overrideTargetTeacher}
        positionsList={assignablePositions}
        selectedPosForOverride={s.selectedPosForOverride}
        setSelectedPosForOverride={s.setSelectedPosForOverride}
        overrideAuthCode={s.overrideAuthCode}
        setOverrideAuthCode={s.setOverrideAuthCode}
        overrideReason={s.overrideReason}
        setOverrideReason={s.setOverrideReason}
        onConfirm={actions.handleConfirmEmergencyOverride}
      />

      {/* CLASS & SUBJECT ALLOCATION MODAL — school-config-driven picker */}
      <WorkloadAllocationModal
        open={s.workloadModalOpen}
        onClose={() => s.setWorkloadModalOpen(false)}
        selectedTeacher={s.selectedTeacher}
        teachers={s.teachers}
        selectedClasses={s.selectedClasses}
        setSelectedClasses={s.setSelectedClasses}
        selectedSubjects={s.selectedSubjects}
        setSelectedSubjects={s.setSelectedSubjects}
        onReplaceConflictTeacher={(conflictTeacherId, newSubjects, newClasses) => {
          s.assignSubjectsAndClasses(conflictTeacherId, newSubjects, newClasses)
        }}
        onSave={actions.handleSaveWorkload}
      />

      {/* STAFF RELIEVE / TERMINATION MODAL */}
      <TerminationModal
        open={s.terminationModalOpen}
        onClose={() => s.setTerminationModalOpen(false)}
        teacher={s.selectedTeacher}
        terminationReason={s.terminationReason}
        setTerminationReason={s.setTerminationReason}
        confirmTerminateText={s.confirmTerminateText}
        setConfirmTerminateText={s.setConfirmTerminateText}
        lockLoginOnTerminate={s.lockLoginOnTerminate}
        setLockLoginOnTerminate={s.setLockLoginOnTerminate}
        onConfirm={actions.handleConfirmTermination}
      />
    </PageTransition>
  )
}

export default TeachersModule
