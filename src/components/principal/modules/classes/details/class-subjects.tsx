'use client'

/**
 * ClassSubjects — subject allocation management.
 *
 * TWO DATA MODES (single-source-of-truth architecture):
 *
 *   1. SERVER-AUTHORITATIVE — when this class card links to a server
 *      class (Grade 6–12 of the real school), the tab renders
 *      ServerSubjectsPanel: the Principal's mutations go through
 *      /api/principal/academic and become the school's actual
 *      configuration (ClassSubjectAssignment). Teacher modules derive
 *      from exactly this data.
 *
 *   2. LEGACY MOCK — classes with no server record (Pre-Nursery, KG,
 *      Class 2, Class 4 demo classes) keep the classic Zustand-store
 *      behaviour, clearly labelled as demo-only.
 *
 * Available subjects for the legacy "Add Subject" picker come from the
 * `academicSubjects` registry (Spec §28) — NOT a hardcoded
 * `SUBJECTS_BY_LEVEL` constant. The picker also offers a
 * "Create custom subject" affordance (Spec §8).
 */

import { useEffect, useState, useMemo } from 'react'
import { BookOpen, Plus, Archive, Pencil, Search, Sparkles, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useStudentsStore } from '@/lib/store/students-store'
import type { ClassRecord } from '@/lib/store/students-store'
import type { SubjectDef } from '@/lib/mock/academic'
import { useAcademicConfigStore, resolveDbClassFor } from '@/lib/academic-config/client'
import { SubjectCard } from './subject-card'
import { ArchivedSubjectsPanel } from './archived-subjects-panel'
import { ServerSubjectsPanel } from './server-subjects-panel'
import { ConfirmDialog } from '../../shared/confirm-dialog'
import { toast } from 'sonner'

export function ClassSubjects({ cls }: { cls: ClassRecord }) {
  // ── Server link resolution (single fetch, shared store) ────────────
  const config = useAcademicConfigStore((s) => s.config)
  const fetchAcademic = useAcademicConfigStore((s) => s.fetch)
  useEffect(() => { void fetchAcademic() }, [fetchAcademic])
  const dbClass = resolveDbClassFor(cls, config?.classes ?? [])

  // SERVER-AUTHORITATIVE mode — the real configuration surface.
  if (dbClass) {
    return <ServerSubjectsPanel dbClass={dbClass} />
  }

  // LEGACY MOCK mode — no server record for this demo class.
  return <LegacyClassSubjects cls={cls} />
}

function LegacyClassSubjects({ cls }: { cls: ClassRecord }) {
  // Subscribe to canonical class so external mutations reflect here immediately.
  const liveClass = useStudentsStore((s) => s.getClassById(cls.id)) ?? cls
  const addClassSubject = useStudentsStore((s) => s.addClassSubject)
  const archiveClassSubject = useStudentsStore((s) => s.archiveClassSubject)
  const restoreClassSubject = useStudentsStore((s) => s.restoreClassSubject)
  const deleteArchivedSubject = useStudentsStore((s) => s.deleteArchivedSubject)
  const createCustomSubject = useStudentsStore((s) => s.createCustomSubject)

  const [editMode, setEditMode] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const handleAdd = (subjectId: string, subjectName: string) => {
    if (liveClass.subjectIds.includes(subjectId)) {
      toast.error(`${subjectName} is already allocated`)
      return
    }
    addClassSubject(liveClass.id, subjectId)
    toast.success(`${subjectName} added to ${liveClass.name}`)
    setAddOpen(false)
  }

  const handleCreateCustom = (name: string) => {
    const id = createCustomSubject(liveClass.id, name)
    if (id) {
      toast.success(`${name} created and added to ${liveClass.name}`)
      setAddOpen(false)
    }
  }

  const handleArchive = () => {
    if (!archiveTarget) return
    // Resolve subject id from name (archiveTarget is the subject name shown on the card).
    const subj = liveClass.subjectIds
      .map((id) => useStudentsStore.getState().getSubjectById(id))
      .find((s) => s?.name === archiveTarget)
    if (!subj) return
    archiveClassSubject(liveClass.id, subj.id)
    toast.success(`${archiveTarget} archived — recoverable from Archive`)
    setArchiveTarget(null)
  }

  const handleRestore = (subjectId: string) => {
    restoreClassSubject(liveClass.id, subjectId)
  }

  const handleDelete = (subjectId: string) => {
    deleteArchivedSubject(liveClass.id, subjectId)
  }

  const archivedCount = liveClass.archivedSubjects?.length ?? 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-xs font-bold text-primary uppercase tracking-wider">Subjects</p>
          <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 shrink-0">
            <Server className="h-2.5 w-2.5 mr-1" aria-hidden="true" />
            Demo class — no server record
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setArchivedOpen(true)}
            title="View archived subjects"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archived</span>
            {archivedCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">{archivedCount}</Badge>
            )}
          </Button>
          {editMode ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600" onClick={() => setEditMode(false)}>Done</Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={() => setEditMode(true)}>
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="h-3 w-3" /> Add Subject
          </Button>
        </div>
      </div>

      {liveClass.subjects.length === 0 ? (
        <div className="py-6 text-center">
          <BookOpen className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">No subjects allocated for this class.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {liveClass.subjects.map((subj) => (
            <SubjectCard
              key={subj}
              subject={subj}
              cls={liveClass}
              manageable={editMode}
              onArchive={(s) => setArchiveTarget(s)}
            />
          ))}
        </div>
      )}

      <AddSubjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        cls={liveClass}
        onAdd={handleAdd}
        onCreateCustom={handleCreateCustom}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={`Archive ${archiveTarget}?`}
        description={`${archiveTarget} will leave the active subject list for ${liveClass.name}. Historical academic records will be preserved. The subject can be restored from the Archive.`}
        tone="amber"
        icon={Archive}
        confirmLabel="Archive Subject"
        onConfirm={handleArchive}
      />

      <ArchivedSubjectsPanel
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        cls={liveClass}
        onRestore={handleRestore}
        onDelete={handleDelete}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* AddSubjectDialog — pick from registry OR create a custom subject    */
/* ------------------------------------------------------------------ */
function AddSubjectDialog({ open, onOpenChange, cls, onAdd, onCreateCustom }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  cls: ClassRecord
  onAdd: (subjectId: string, subjectName: string) => void
  onCreateCustom: (name: string) => void
}) {
  const academicSubjects = useStudentsStore((s) => s.academicSubjects)
  const [search, setSearch] = useState('')
  const [customName, setCustomName] = useState('')

  // Available = active subjects in registry that the class doesn't already have.
  const available = useMemo<SubjectDef[]>(() => {
    return academicSubjects
      .filter((s) => s.status === 'Active' && !cls.subjectIds.includes(s.id))
      .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
  }, [academicSubjects, cls.subjectIds, search])

  const trimmed = customName.trim()
  const customMatchesExisting = academicSubjects.some(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
  )
  const canCreate = trimmed.length > 0 && !customMatchesExisting && !cls.subjects.includes(trimmed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add Subject</DialogTitle>
          <DialogDescription className="text-xs">
            Select a subject to allocate to {cls.name}, or create a new custom subject.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject…"
              className="pl-8 h-8 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/30">
            {available.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                {search ? 'No matching subjects.' : 'No subjects available to add.'}
              </p>
            ) : available.map((s) => (
              <button
                key={s.id}
                onClick={() => onAdd(s.id, s.name)}
                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/40 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground">{s.code} · {s.category}</p>
                </div>
                <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
          {/* Custom subject creation (Spec §8) */}
          <div className="rounded-lg border border-dashed border-border/60 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Create a new subject
            </div>
            <div className="flex gap-1.5">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Computer Science"
                className="h-8 text-xs flex-1"
              />
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!canCreate}
                onClick={() => {
                  onCreateCustom(trimmed)
                  setCustomName('')
                }}
              >
                Create
              </Button>
            </div>
            {customMatchesExisting && (
              <p className="text-[10px] text-amber-600">A subject with this name already exists in the registry.</p>
            )}
          </div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
