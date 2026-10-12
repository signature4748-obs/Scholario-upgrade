'use client'

/**
 * ClassLeadership — Class Captain / Monitor assignment surface (spec §21–§25).
 *
 * Per section of the class, the principal can:
 *   • assign a student to a position (one active holder per
 *     class · section · position — assigning over a holder replaces them),
 *   • end an active position (the student's capabilities disappear).
 *
 * Below the per-section grids sits the responsibility review surface:
 * pending class updates (approve/remove), open issue reports
 * (acknowledge/resolve), teacher meeting requests (acknowledge) and
 * responsibility tasks assigned to the current holders.
 *
 * All writes go through the canonical students-store actions
 * (assignStudentPosition / endStudentPosition) and the class-responsibility
 * store — the same persisted permission state the STUDENT side derives its
 * capabilities from.
 *
 * Visual (production pass §2 — leadership density reduction): flat section
 * header with NO intro card; the scope explanation lives behind the header's
 * info tooltip. Per-section rows drop the per-row icon box for low-density
 * scanning. All handlers, dialogs and the review surface are unchanged.
 */
import { useMemo, useState } from 'react'
import {
  Crown, Info, Plus, X, Search, CheckCircle2, XCircle, Megaphone,
  AlertTriangle, CalendarClock, ListTodo, UserCheck, Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GradientAvatar } from '@/components/shared/ui'
import { useStudentsStore, type ClassRecord, type StudentRecord, type StudentPosition } from '@/lib/store/students-store'
import { useAuth } from '@/lib/store/auth-store'
import { DemoModuleNotice } from '../../shared/demo-module-notice'
import { POSITION_DEFS, POSITION_ORDER, filterActivePositions, type StudentPositionKey } from '@/lib/student-positions'
import { useAcademicSession } from '@/lib/academic-session'
import { useClassResponsibilityStore } from '@/lib/store/class-responsibility-store'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { toast } from 'sonner'

/** Real actor — the signed-in principal from the session store (the
 *  login flow overrides name/id with the SERVER-authenticated identity).
 *  The hardcoded 'Dr. Ananya Iyer' persona is retired: it fabricated a
 *  person on audit records (assignment/task/review trails). */
function usePrincipalActor() {
  const { user } = useAuth()
  return { id: user?.id || 'PRINCIPAL', name: user?.name?.trim() || 'Principal' }
}

/** Row one-liners for the dense per-section grid. The canonical
 * descriptions in POSITION_DEFS (src/lib/student-positions.ts) are the
 * shared vocabulary used for capability derivation elsewhere and stay
 * untouched — this local map only shortens what the rows display,
 * falling back to the canonical description for unknown keys. */
const ROW_DESCRIPTIONS: Partial<Record<StudentPositionKey, string>> = {
  'class-captain': 'Leads the class and coordinates with the class teacher.',
  'class-vice-captain': 'Supports the class captain.',
  'class-monitor': 'Helps maintain day-to-day class coordination.',
  'sports-captain': 'Coordinates sports activities.',
  'eco-monitor': 'Looks after classroom sustainability.',
  'library-monitor': 'Helps with class library periods and book returns.',
}

const rowDescription = (key: StudentPositionKey) =>
  ROW_DESCRIPTIONS[key] ?? POSITION_DEFS[key].description

export function ClassLeadership({ cls }: { cls: ClassRecord }) {
  const students = useStudentsStore((s) => s.students)
  const positions = useStudentsStore((s) => s.studentPositions)
  const assignPosition = useStudentsStore((s) => s.assignStudentPosition)
  const endPosition = useStudentsStore((s) => s.endStudentPosition)
  const actor = usePrincipalActor()

  const [assigning, setAssigning] = useState<{ section: string; key: StudentPositionKey } | null>(null)
  const [ending, setEnding] = useState<StudentPosition | null>(null)
  const [taskFor, setTaskFor] = useState<StudentPosition | null>(null)
  // RB-1 — occupancy/activity resolves through the canonical session-scoped
  // resolver: a position held in an EARLIER session is history, not
  // authority, and does not block a new appointment.
  const sessionId = useAcademicSession().id

  const sectionStudents = (section: string) =>
    students.filter((s) => s.classId === cls.id && s.section === section && s.status === 'Active')

  const activeFor = (section: string, key: StudentPositionKey) =>
    positions.find(
      (p) =>
        p.classId === cls.id &&
        p.section === section &&
        p.key === key &&
        filterActivePositions(positions, p.studentId, sessionId).some((ap) => ap.id === p.id),
    )

  const holder = (p?: StudentPosition) => (p ? students.find((s) => s.id === p.studentId) : undefined)

  const handleAssign = (studentId: string, key: StudentPositionKey, section: string, notes?: string) => {
    const result = assignPosition({ studentId, key, assignedById: actor.id, assignedByName: actor.name, notes })
    if (result.ok) {
      toast.success(`${POSITION_DEFS[key].title} appointed`, {
        description: `${result.record.studentName} is now ${POSITION_DEFS[key].title} of ${cls.name}-${section}.`,
      })
      setAssigning(null)
    } else {
      toast.error('Could not appoint', { description: result.error })
    }
  }

  const handleEnd = (p: StudentPosition) => {
    const result = endPosition(p.id, actor.name)
    if (result.ok) {
      toast.success('Responsibility ended', {
        description: `${p.studentName} no longer holds ${POSITION_DEFS[p.key].title} of ${p.className}-${p.section}.`,
      })
      setEnding(null)
    } else {
      toast.error('Could not end responsibility', { description: result.error })
    }
  }

  return (
    <div className="space-y-4">
      {/* Honesty label — positions/responsibilities are client-side demo
          state (students-store localStorage slice; no server persistence,
          no cross-device sync). The student side honestly shows nothing
          until this browser assigns something. */}
      <DemoModuleNotice moduleName="Class Leadership" variant="demo" />

      {/* Minimal section header (§2) — flat on the page background, no card
          wrapper; the philosophy paragraph moved behind the info tooltip. */}
      <div className="pt-1">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Crown className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Class Leadership</h3>
          <button
            type="button"
            title="Class Captains and Monitors are scoped positions — the student keeps only tightly-scoped capabilities in their own section. Ending a position removes them immediately."
            aria-label="How class leadership works"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">Assign student responsibilities for each section.</p>
      </div>

      {cls.sections.map((sec) => {
        const roster = sectionStudents(sec.name)
        return (
          <div key={sec.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60 bg-muted/30">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{cls.name} · Section {sec.name}</h3>
                <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">{roster.length} students</Badge>
              </div>
            </div>
            <div className="divide-y divide-border/40">
              {POSITION_ORDER.map((key) => {
                const def = POSITION_DEFS[key]
                const pos = activeFor(sec.name, key)
                const h = holder(pos)
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-semibold">{def.title}</p>
                        {pos ? (
                          <Badge className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">Vacant</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{rowDescription(key)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {pos && h ? (
                        <>
                          <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 min-w-0">
                            <GradientAvatar name={h.name} initials={h.avatar} size="sm" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{h.name}</p>
                              <p className="text-[10px] text-muted-foreground">Roll {h.rollNo} · since {formatDate(pos.assignedOn)}</p>
                            </div>
                          </div>
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAssigning({ section: sec.name, key })}>
                            Replace
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10" onClick={() => setEnding(pos)}>
                            End
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setTaskFor(pos)} title="Assign a responsibility task">
                            <ListTodo className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" className="h-8 text-xs" onClick={() => setAssigning({ section: sec.name, key })}>
                          <Plus className="h-3.5 w-3.5" /> Appoint {def.short}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <ResponsibilityReview cls={cls} />

      {/* Assign / Replace dialog */}
      {assigning && (
        <AssignDialog
          cls={cls}
          section={assigning.section}
          positionKey={assigning.key}
          roster={sectionStudents(assigning.section)}
          onClose={() => setAssigning(null)}
          onAssign={handleAssign}
        />
      )}

      {/* End confirmation dialog */}
      {ending && (
        <ConfirmEndDialog position={ending} onClose={() => setEnding(null)} onConfirm={() => handleEnd(ending)} />
      )}

      {/* Assign responsibility task dialog */}
      {taskFor && <AssignTaskDialog position={taskFor} onClose={() => setTaskFor(null)} />}
    </div>
  )
}

// ─── Assign / Replace student dialog ─────────────────────────────────

function AssignDialog({ cls, section, positionKey, roster, onClose, onAssign }: {
  cls: ClassRecord
  section: string
  positionKey: StudentPositionKey
  roster: StudentRecord[]
  onClose: () => void
  onAssign: (studentId: string, key: StudentPositionKey, section: string, notes?: string) => void
}) {
  useDismissOnEscape(onClose)
  const def = POSITION_DEFS[positionKey]
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const filtered = useMemo(
    () => roster.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.rollNo.includes(search) || s.admissionNo.toLowerCase().includes(search.toLowerCase())),
    [roster, search],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Appoint ${def.title} — ${cls.name} ${section}`}>
      <div className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[80vh] rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-premium-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-border/60">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Appoint {def.title}</h3>
            <p className="text-xs text-muted-foreground">{cls.name} · Section {section}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close appoint dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 max-h-[46vh]">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No students match “{search}”.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                    selected === s.id ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40',
                  )}
                >
                  <GradientAvatar name={s.name} initials={s.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">Roll {s.rollNo} · {s.admissionNo} · {s.attendance}% attendance</p>
                  </div>
                  {selected === s.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 pb-3">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note (optional) — e.g. appointed at the Investiture Ceremony"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!selected} onClick={() => selected && onAssign(selected, positionKey, section, notes || undefined)}>
            <Crown className="h-3.5 w-3.5" /> Appoint {def.title}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── End confirmation dialog ─────────────────────────────────────────

function ConfirmEndDialog({ position, onClose, onConfirm }: {
  position: StudentPosition
  onClose: () => void
  onConfirm: () => void
}) {
  useDismissOnEscape(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`End ${position.studentName}'s responsibility`}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-premium-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold">End responsibility</h3>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close end dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-foreground">
            End <span className="font-semibold">{position.studentName}&apos;s</span> role as{' '}
            <span className="font-semibold">{POSITION_DEFS[position.key]?.title}</span> of{' '}
            {position.className}-{position.section}?
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            Their class-responsibility capabilities (updates, issue reporting, tasks) disappear immediately. The
            assignment history is preserved on the student&apos;s timeline.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose}>Keep role</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm}>End responsibility</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign responsibility task dialog ───────────────────────────────

function AssignTaskDialog({ position, onClose }: { position: StudentPosition; onClose: () => void }) {
  useDismissOnEscape(onClose)
  const addTask = useClassResponsibilityStore((s) => s.addResponsibilityTask)
  const actor = usePrincipalActor()
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [dueOn, setDueOn] = useState('')

  const submit = () => {
    if (!title.trim()) return
    const result = addTask({
      studentId: position.studentId,
      studentName: position.studentName,
      classId: position.classId,
      section: position.section,
      title: title.trim(),
      detail: detail.trim() || '—',
      assignedByName: actor.name,
      dueOn: dueOn || undefined,
    })
    if (result.ok) {
      toast.success('Task assigned', { description: `${position.studentName} will see it under Responsibility Tasks.` })
      onClose()
    } else {
      toast.error('Could not assign task', { description: result.error })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Assign a responsibility task">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-premium-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/60">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Assign a responsibility task</h3>
            <p className="text-xs text-muted-foreground truncate">{position.studentName} · {POSITION_DEFS[position.key]?.title} · {position.className}-{position.section}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close task dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div>
            <label htmlFor="task-title" className="text-xs font-medium text-foreground">Task</label>
            <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coordinate the class library period"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label htmlFor="task-detail" className="text-xs font-medium text-foreground">Detail (optional)</label>
            <textarea id="task-detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder="Anything the student should know…"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <div>
            <label htmlFor="task-due" className="text-xs font-medium text-foreground">Due (optional)</label>
            <input id="task-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!title.trim()} onClick={submit}>
            <ListTodo className="h-3.5 w-3.5" /> Assign task
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Review surface (updates / issues / requests / tasks) ────────────

function ResponsibilityReview({ cls }: { cls: ClassRecord }) {
  const updates = useClassResponsibilityStore((s) => s.classUpdates)
  const issues = useClassResponsibilityStore((s) => s.issueReports)
  const requests = useClassResponsibilityStore((s) => s.teacherRequests)
  const tasks = useClassResponsibilityStore((s) => s.responsibilityTasks)
  const reviewUpdate = useClassResponsibilityStore((s) => s.reviewClassUpdate)
  const resolveIssue = useClassResponsibilityStore((s) => s.resolveIssue)
  const acknowledgeRequest = useClassResponsibilityStore((s) => s.acknowledgeTeacherRequest)
  const actor = usePrincipalActor()

  const classUpdates = updates.filter((u) => u.classId === cls.id && u.status === 'pending-review')
  const classIssues = issues.filter((i) => i.classId === cls.id && i.status !== 'resolved')
  const classRequests = requests.filter((r) => r.classId === cls.id && r.status === 'requested')
  const classTasks = tasks.filter((t) => t.classId === cls.id)
  const empty = classUpdates.length + classIssues.length + classRequests.length + classTasks.length === 0

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Responsibility Review</h3>
          <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
            {classUpdates.length + classIssues.length + classRequests.length} pending
          </Badge>
        </div>
      </div>
      {empty ? (
        <div className="py-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">Nothing to review — no pending class updates, issues or requests.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">These appear when captains and monitors use their responsibilities.</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {classUpdates.map((u) => (
            <div key={u.id} className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 mt-0.5">
                <Megaphone className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold">{u.title}</p>
                  <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400">Pending review</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{u.body}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                  {u.authorName} · {u.positionTitle} · {formatRelativeTime(u.postedOn)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" className="h-8 text-xs" onClick={() => { reviewUpdate(u.id, 'approved', actor.name); toast.success('Class update approved', { description: `“${u.title}” is now visible on the class notice board.` }) }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10" onClick={() => { reviewUpdate(u.id, 'removed', actor.name); toast.info('Class update removed') }}>
                  <XCircle className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>
          ))}
          {classIssues.map((i) => (
            <div key={i.id} className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3">
              <div className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border mt-0.5',
                i.priority === 'high' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
              )}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold">{i.title}</p>
                  <Badge variant="secondary" className={cn('text-[10px]', i.status === 'open' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400')}>
                    {i.status === 'open' ? 'Open' : 'Acknowledged'}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground capitalize">{i.priority} · {i.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{i.description}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">{i.reporterName} · {formatRelativeTime(i.reportedOn)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {i.status === 'open' && (
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { resolveIssue(i.id, 'acknowledged', actor.name); toast.success('Issue acknowledged') }}>
                    <UserCheck className="h-3.5 w-3.5" /> Acknowledge
                  </Button>
                )}
                <Button size="sm" className="h-8 text-xs" onClick={() => { resolveIssue(i.id, 'resolved', actor.name, 'Resolved by the school office.'); toast.success('Issue resolved') }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                </Button>
              </div>
            </div>
          ))}
          {classRequests.map((r) => (
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 mt-0.5">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold">Meeting request — {r.teacherName}</p>
                  <Badge variant="secondary" className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-400">Requested</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{r.topic} · {r.preferredSlot}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">{r.studentName} · {formatRelativeTime(r.requestedOn)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { acknowledgeRequest(r.id, actor.name); toast.success('Request acknowledged', { description: `${r.teacherName} has been informed.` }) }}>
                  <UserCheck className="h-3.5 w-3.5" /> Acknowledge
                </Button>
              </div>
            </div>
          ))}
          {classTasks.map((t) => (
            <div key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mt-0.5">
                {t.done ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={cn('text-sm font-semibold', t.done && 'line-through text-muted-foreground')}>{t.title}</p>
                  <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">{t.done ? 'Completed' : 'In progress'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{t.detail}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                  {t.studentName} · assigned by {t.assignedByName}{t.dueOn ? ` · due ${formatDate(t.dueOn)}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
