'use client'

import { useState, useEffect, useRef } from 'react'
import { PageTransition } from '@/components/shared/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { StudentRecord, ClassRecord } from '@/lib/store/students-store'
import { useFocusStore } from '@/lib/store/focus-store'
import { ModuleHeader } from './shared/module-header'
import { SegmentedTabs } from './shared/segmented-tabs'
import { OverviewTab } from './students/overview-tab'
import { DirectoryTab } from './students/directory-tab'
import { StudentProfilePage } from './students/student-profile-page'
import { useStudentProfileDetail } from './students/use-student-profile-detail'
import { ClassesView } from './classes'
import { ClassDetailsPage } from './classes/class-details'
import { AddClassPage } from './classes/add-class-page'
import { ArchivedView } from './classes/archived-view'

export type UnifiedTab = 'overview' | 'directory' | 'classes' | 'archived'

export function StudentsClassesModule({ initialTab = 'overview' }: { initialTab?: UnifiedTab }) {
  const [activeTab, setActiveTab] = useState<UnifiedTab>(initialTab)
  const store = useStudentsStore()
  const schoolProfile = useSchoolProfile()
  const [selectedClass, setSelectedClass] = useState<ClassRecord | null>(null)
  const [showAddClass, setShowAddClass] = useState(false)
  const [profileStudent, setProfileStudent] = useState<StudentRecord | null>(null)
  const [profileBackLabel, setProfileBackLabel] = useState('Students & Classes')
  const [archiveTarget, setArchiveTarget] = useState<StudentRecord | null>(null)
  const [archiveReason, setArchiveReason] = useState('Graduation')
  const [transferTarget, setTransferTarget] = useState<StudentRecord | null>(null)
  const [transferToClass, setTransferToClass] = useState('')

  useEffect(() => { if (initialTab) setActiveTab(initialTab) }, [initialTab])

  const openProfile = (student: StudentRecord, backLabel?: string) => {
    const fresh = store.students.find((st) => st.id === student.id) ?? student
    setProfileStudent(fresh)
    setProfileBackLabel(backLabel || 'Students & Classes')
  }
  const closeProfile = () => setProfileStudent(null)

  // Principal-authorized real profile data (GET /api/students/[id]) —
  // undefined while the fetch is in flight or after a silent failure, in
  // which case the canonical profile renders the store record exactly as
  // before. One wiring covers every principal entry point (directory /
  // overview / classes / archived / global-search deep-link): they all
  // open the profile through openProfile above.
  const { detail: profileDetail } = useStudentProfileDetail(profileStudent?.id ?? null)

  // Deep-link: command palette student results open the profile directly.
  // Store ids ARE canonical DB ids (roster sync), so match by id first;
  // admission no → name remain as fallbacks for pre-sync records. Fall
  // back to the directory with an explanatory toast when nothing matches.
  const focus = useFocusStore((s) => s.focus)
  const clearFocus = useFocusStore((s) => s.clearFocus)
  const handledFocusTs = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || focus.type !== 'student' || handledFocusTs.current === focus.ts) return
    handledFocusTs.current = focus.ts
    clearFocus()
    const dbId = focus.id.startsWith('stu-') ? focus.id.slice(4) : focus.id
    const match =
      store.students.find((st) => st.id === dbId) ??
      store.students.find((st) => (st as StudentRecord & { dbId?: string }).dbId === dbId) ??
      store.students.find((st) => focus.title.includes(st.admissionNo ?? '\u0000')) ??
      store.students.find((st) => st.name.toLowerCase() === focus.title.toLowerCase()) ??
      store.students.find((st) => focus.title.toLowerCase().startsWith(st.name.toLowerCase()))
    if (match) {
      openProfile(match, 'Global Search')
      toast.success(`Opened ${match.name}'s profile`, { description: 'Deep-linked from global search' })
    } else {
      setActiveTab('directory')
      toast.info(`${focus.title} — school directory`, {
        description: 'Record synced from the school database. The interactive demo roster may not include every enrolled student.',
      })
    }
  }, [focus?.ts])

  const confirmArchive = () => {
    if (!archiveTarget) return
    store.archiveStudent(archiveTarget.id, archiveReason, 'Dr. Ananya Iyer')
    toast.success(`${archiveTarget.name} archived`)
    setProfileStudent(null); setArchiveTarget(null)
  }
  const handleRestore = (st: StudentRecord) => {
    store.restoreStudent(st.id, 'Dr. Ananya Iyer')
    toast.success(`${st.name} restored`)
    // Read the post-action record through getState() — the render-scope
    // `store` snapshot is stale inside this closure, so re-setting it
    // would keep the profile header on the pre-action class/status.
    const fresh = useStudentsStore.getState().students.find((x) => x.id === st.id)
    if (fresh && profileStudent?.id === st.id) setProfileStudent(fresh)
  }
  const confirmTransfer = () => {
    if (!transferTarget || !transferToClass) { toast.error('Select target class'); return }
    store.transferStudent(transferTarget.id, 'Class Change', transferToClass, 'Class Change requested', 'Dr. Ananya Iyer')
    toast.success(`${transferTarget.name} transferred`); setTransferTarget(null)
    // Same stale-snapshot guard as handleRestore — the open profile must
    // reflect the new class the moment the transfer confirms (TEST D).
    const fresh = useStudentsStore.getState().students.find((x) => x.id === transferTarget.id)
    if (fresh && profileStudent?.id === transferTarget.id) setProfileStudent(fresh)
  }

  // Real roster count — ACTIVE students in the store (DB-hydrated), not a
  // virtual seat-occupancy estimate.
  const totalStudents = store.students.filter((st) => st.status === 'Active').length

  // Archive / Transfer dialogs — mounted in EVERY branch. The profile
  // view's Archive/Transfer buttons set the same state; mounting only in
  // the main return left the dialogs unrendered whenever a profile was
  // open, silently dead-clicking the buttons (production pass §20 fix).
  const workflowDialogs = (
    <>
      {/* Archive Dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Archive Student</DialogTitle>
            <DialogDescription className="text-xs">{archiveTarget?.name} will be moved to Archived. All records preserved.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs font-medium mb-1.5 block">Reason</Label>
            <Select value={archiveReason} onValueChange={setArchiveReason}>
              <SelectTrigger className="w-full text-xs h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Graduation">Graduation</SelectItem>
                <SelectItem value="School Transfer">School Transfer</SelectItem>
                <SelectItem value="Relocation">Family Relocation</SelectItem>
                <SelectItem value="Withdrawal">Withdrawal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={confirmArchive}>Archive Student</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={!!transferTarget} onOpenChange={(o) => !o && setTransferTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Transfer Student</DialogTitle>
            <DialogDescription className="text-xs">Move {transferTarget?.name} to a different class.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs font-medium mb-1.5 block">Target Class</Label>
            <Select value={transferToClass} onValueChange={setTransferToClass}>
              <SelectTrigger className="w-full text-xs h-9"><SelectValue placeholder="Select class…" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {store.classes.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTransferTarget(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmTransfer}>Confirm Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  // Full-screen Student Profile
  if (profileStudent) {
    return (
      <>
        <StudentProfilePage
          student={profileStudent}
          detail={profileDetail}
          onBack={closeProfile}
          onArchive={(st) => { setArchiveTarget(st); setArchiveReason('Graduation') }}
          onRestore={handleRestore}
          onTransfer={(st) => { setTransferTarget(st); setTransferToClass('') }}
          backLabel={profileBackLabel}
        />
        {workflowDialogs}
      </>
    )
  }

  // Class Details
  if (selectedClass) {
    return (
      <ClassDetailsPage
        cls={selectedClass}
        onBack={() => setSelectedClass(null)}
        store={store}
        onStudentClick={(student) => openProfile(student, `${selectedClass.name} · Students`)}
      />
    )
  }

  // Add Class
  if (showAddClass) {
    return <AddClassPage onBack={() => setShowAddClass(false)} onCreated={() => { setShowAddClass(false); setActiveTab('classes') }} />
  }

  return (
    <PageTransition className="space-y-4">
      <ModuleHeader
        meta={[`${formatNumber(totalStudents)} students`, `${store.classes.length} classes`, `AY ${schoolProfile.academicYear || '—'}`]}
        actions={
          <SegmentedTabs
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'directory', label: 'Directory' },
              { value: 'classes', label: 'Classes' },
              { value: 'archived', label: 'Archived' },
            ]}
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as UnifiedTab)}
          />
        }
      />

      {activeTab === 'overview' && (
        <OverviewTab store={store} onStudentClick={(st) => openProfile(st, 'Students Directory')} onNavigateToClasses={() => setActiveTab('classes')} />
      )}
      {activeTab === 'directory' && (
        <DirectoryTab
          students={store.students.filter((st) => st.status === 'Active')}
          classes={store.classes}
          onStudentClick={(st) => openProfile(st, 'Students Directory')}
        />
      )}
      {activeTab === 'classes' && (
        <ClassesView onOpenClass={setSelectedClass} onAddClass={() => setShowAddClass(true)} />
      )}
      {activeTab === 'archived' && (
        <ArchivedView
          archivedStudents={store.students.filter((st) => st.status === 'Archived')}
          onRestoreStudent={handleRestore}
          onViewStudent={(st) => openProfile(st, 'Archived Students')}
        />
      )}

      {workflowDialogs}
    </PageTransition>
  )
}

// Late imports to avoid circular deps
import { useStudentsStore } from '@/lib/store/students-store'
import { useSchoolProfile } from '@/lib/school-profile'
import { formatNumber } from '@/lib/format'
