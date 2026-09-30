'use client'

/**
 * MyClassModule — the Class Captain / Monitor workspace (spec §22–§23).
 *
 * Renders ONLY when the student holds an ACTIVE position. Every action card
 * is capability-gated (derived from the persisted assignment — never
 * hardcoded), and every write goes through the authorization-checked
 * class-responsibility store, so the UI can never grant more than the
 * school assigned. If the position is ended, this whole module unmounts.
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Crown, Megaphone, AlertTriangle, CalendarClock, ListTodo, Pin, X, Send,
  CheckCircle2, Clock, ShieldCheck, Inbox,
} from 'lucide-react'
import { GlassCard, GradientAvatar, StatusBadge } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useStudentsStore, useMyStudentRecord, type StudentPosition } from '@/lib/store/students-store'
import { POSITION_DEFS, hasCapability, allCapabilities, filterActivePositions, type StudentCapability } from '@/lib/student-positions'
import { useAcademicSession } from '@/lib/academic-session'
import { useClassResponsibilityStore, type ClassUpdateCategory, type IssueCategory, type IssuePriority, type ResponsibilityTask } from '@/lib/store/class-responsibility-store'
// PHASE 7 (Task 7-a) — teacher identities resolve from the school's real
// roster store (hydrated from /api/teachers for staff sessions; students
// see an honest empty list — never fabricated teacher names).
import { useTeacherRosterStore } from '@/lib/store/teacher-roster-store'
import { useDismissOnEscape } from '@/hooks/use-dismiss-on-escape'
import { formatDate, formatRelativeTime } from '@/lib/format'
import { toast } from 'sonner'
import { useCurrentUser } from '@/lib/store/current-user-store'

const CAPABILITY_META: Record<StudentCapability, { label: string; icon: typeof Crown }> = {
  'post-class-updates': { label: 'Class updates', icon: Megaphone },
  'report-issues': { label: 'Issue reporting', icon: AlertTriangle },
  'view-class-tasks': { label: 'Responsibility tasks', icon: ListTodo },
  'request-teacher': { label: 'Teacher requests', icon: CalendarClock },
  'coordinate-activity': { label: 'Activity coordination', icon: CheckCircle2 },
  'class-noticeboard': { label: 'Class notice board', icon: Pin },
}

/** Teachers the student may request a meeting with (class teacher + subject
 *  teachers of THEIR class — never a school-wide directory, spec §30). */
function allowedTeachers(classId: string, section: string): { id: string; name: string; subject: string }[] {
  const cls = useStudentsStore.getState().classes.find((c) => c.id === classId)
  if (!cls) return []
  const sec = cls.sections.find((s) => s.name === section)
  const roster: { id: string; name: string; subject: string }[] = []
  const seen = new Set<string>()
  const push = (id: string | undefined, subject: string) => {
    if (!id || seen.has(id)) return
    // Dual-id match (Phase 7): class data carries the teacher's USER id
    // (Class.classTeacherId / CSA.teacherUserId); the roster keys Teacher
    // rows — real appointed teachers must resolve.
    const t = useTeacherRosterStore.getState().teachers.find((x) => x.id === id || x.userId === id)
    if (!t) return
    seen.add(id)
    roster.push({ id: t.id, name: t.name, subject })
  }
  push(sec?.classTeacherId ?? cls.classTeacherId, 'Class Teacher')
  for (const [subId, tid] of Object.entries(cls.subjectTeachers)) {
    const name = cls.subjects.find((n) => n === subId) ?? subId.replace('sub-', '')
    push(tid, name.charAt(0).toUpperCase() + name.slice(1))
  }
  return roster
}

export function MyClassModule() {
  // Canonical identity — the session user's own roster record (server
  // sync stamps the userId/email link fields; the legacy demo record
  // covers the pre-sync paint).
  const student = useMyStudentRecord()
  const studentId = student?.id ?? ''
  // Raw array + useMemo — zustand v5 selectors must return stable refs.
  // RB-1 — activity resolves ONLY through the canonical session-scoped
  // resolver; a position from an earlier session is history, not authority.
  const allPositions = useStudentsStore((s) => s.studentPositions)
  const sessionId = useAcademicSession().id
  const positions = useMemo(
    () => filterActivePositions(allPositions, studentId, sessionId),
    [allPositions, studentId, sessionId],
  )

  const updates = useClassResponsibilityStore((s2) => s2.classUpdates)
  const issues = useClassResponsibilityStore((s2) => s2.issueReports)
  const tasks = useClassResponsibilityStore((s2) => s2.responsibilityTasks)
  const requests = useClassResponsibilityStore((s2) => s2.teacherRequests)

  const [dialog, setDialog] = useState<'update' | 'issue' | 'meeting' | null>(null)

  const caps = allCapabilities(positions)
  const myUpdates = useMemo(() => updates.filter((u) => u.studentId === studentId), [updates, studentId])
  const noticeBoard = useMemo(
    () =>
      student
        ? updates.filter((u) => u.classId === student.classId && u.section === student.section && u.status === 'approved')
        : [],
    [updates, student],
  )
  const myIssues = useMemo(() => issues.filter((i) => i.studentId === studentId), [issues, studentId])
  const myTasks = useMemo(() => tasks.filter((t) => t.studentId === studentId), [tasks, studentId])
  const myRequests = useMemo(() => requests.filter((r) => r.studentId === studentId), [requests, studentId])

  // SD-3b — the SERVER session label wins (never disagrees with the sidebar).
  // (Declared before the early return — hooks must run unconditionally.)
  const srvClassLabel = useCurrentUser((s) => s.me?.student?.classLabel)

  if (!student || positions.length === 0) {
    // No active responsibility — the panel hides the nav entry entirely; this
    // is a defensive empty state.
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <p className="text-sm text-muted-foreground">No active class responsibility.</p>
      </div>
    )
  }

  const primary = positions[0]
  const positionTitles = positions.map((p) => POSITION_DEFS[p.key]?.title ?? p.key).join(' · ')

  return (
    <div className="space-y-5">
      {/* LR-1 — compact context line, no giant module title. The position
          hero below carries the real identity of this surface. */}
      <p className="truncate text-xs text-muted-foreground">
        {srvClassLabel ?? `${student.className}-${student.section}`} · Class responsibility
      </p>

      {/* Position hero */}
      <GlassCard className="p-4 sm:p-5 overflow-hidden relative">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" aria-hidden />
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <motion.div
            initial={{ scale: 0.8, rotate: -8 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg"
          >
            <Crown className="h-7 w-7" />
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl font-extrabold tracking-tight">{positionTitles}</h2>
              <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 text-[10px]">
                Active
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span>{srvClassLabel ?? `${student.className}-${student.section}`}</span>
              <span className="text-border">·</span>
              <span>Since {formatDate(primary.assignedOn)}</span>
              <span className="text-border">·</span>
              <span>Appointed by {primary.assignedByName}</span>
            </p>
            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              {caps.map((c) => {
                const Meta = CAPABILITY_META[c]
                return (
                  <Badge key={c} variant="secondary" className="text-[10px] bg-primary/5 text-primary border border-primary/20 gap-1">
                    <Meta.icon className="h-3 w-3" /> {Meta.label}
                  </Badge>
                )
              })}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Action cards — capability-gated */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {hasCapability(positions, 'post-class-updates') && (
          <ActionCard
            icon={<Megaphone className="h-5 w-5" />}
            title="Post a Class Update"
            desc="Share a notice, reminder or activity plan with your class (teacher-reviewed)."
            stat={`${myUpdates.filter((u) => u.status === 'pending-review').length} pending review`}
            onClick={() => setDialog('update')}
            accent="violet"
          />
        )}
        {hasCapability(positions, 'report-issues') && (
          <ActionCard
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Report an Issue"
            desc="Report a class problem — facilities, safety or anything the teacher should know."
            stat={`${myIssues.filter((i) => i.status !== 'resolved').length} open`}
            onClick={() => setDialog('issue')}
            accent="amber"
          />
        )}
        {hasCapability(positions, 'request-teacher') && (
          <ActionCard
            icon={<CalendarClock className="h-5 w-5" />}
            title="Request Teacher Meeting"
            desc="Ask your class or subject teacher for a short meeting."
            stat={`${myRequests.filter((r) => r.status === 'requested').length} awaiting`}
            onClick={() => setDialog('meeting')}
            accent="sky"
          />
        )}
      </div>

      {/* Tasks + submissions two-column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {hasCapability(positions, 'view-class-tasks') && (
          <GlassCard className="p-3 sm:p-4 lg:p-5">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-emerald-500" /> Responsibility Tasks
              <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground ml-auto">
                {myTasks.filter((t) => !t.done).length} open
              </Badge>
            </h3>
            {myTasks.length === 0 ? (
              <EmptyMini text="No tasks assigned yet — your teacher or principal can assign responsibilities here." />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {myTasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
          </GlassCard>
        )}

        <GlassCard className="p-3 sm:p-4 lg:p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Inbox className="h-4 w-4 text-violet-500" /> My Submissions
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground ml-auto">
              {myUpdates.length + myIssues.length + myRequests.length} total
            </Badge>
          </h3>
          {myUpdates.length + myIssues.length + myRequests.length === 0 ? (
            <EmptyMini text="Nothing submitted yet — updates, issues and meeting requests you send appear here with their review status." />
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {myUpdates.map((u) => (
                <div key={u.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
                  <Megaphone className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{u.title}</p>
                    <p className="text-[11px] text-muted-foreground">{u.category} · {formatRelativeTime(u.postedOn)}</p>
                  </div>
                  <SubmissionStatus status={u.status === 'pending-review' ? 'Pending review' : u.status === 'approved' ? 'Approved' : 'Removed'} tone={u.status === 'approved' ? 'success' : u.status === 'pending-review' ? 'info' : 'muted'} />
                </div>
              ))}
              {myIssues.map((i) => (
                <div key={i.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{i.title}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{i.category} · {i.priority} · {formatRelativeTime(i.reportedOn)}</p>
                  </div>
                  <SubmissionStatus status={i.status === 'open' ? 'Open' : i.status === 'acknowledged' ? 'Acknowledged' : 'Resolved'} tone={i.status === 'resolved' ? 'success' : 'info'} />
                </div>
              ))}
              {myRequests.map((r) => (
                <div key={r.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-3">
                  <CalendarClock className="h-4 w-4 text-sky-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.teacherName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{r.topic} · {formatRelativeTime(r.requestedOn)}</p>
                  </div>
                  <SubmissionStatus status={r.status === 'requested' ? 'Requested' : r.status === 'acknowledged' ? 'Acknowledged' : 'Completed'} tone={r.status === 'requested' ? 'info' : 'success'} />
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Class notice board — approved updates (captain + classmates) */}
      {hasCapability(positions, 'class-noticeboard') && (
        <GlassCard className="p-3 sm:p-4 lg:p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Pin className="h-4 w-4 text-primary" /> Class Notice Board
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground ml-auto">approved by teacher</Badge>
          </h3>
          {noticeBoard.length === 0 ? (
            <EmptyMini text="No approved notices yet — updates appear here once your class teacher approves them." />
          ) : (
            <div className="space-y-2">
              {noticeBoard.map((u) => (
                <div key={u.id} className="rounded-xl border border-border bg-card/40 p-3.5">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="secondary" className="text-[10px] bg-primary/5 text-primary border border-primary/20 capitalize">{u.category}</Badge>
                    <p className="text-sm font-semibold">{u.title}</p>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">{formatRelativeTime(u.postedOn)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{u.body}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1.5 font-mono">
                    {u.authorName} · {u.positionTitle} · approved by {u.reviewedByName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Dialogs */}
      {dialog === 'update' && <PostUpdateDialog positions={positions} onClose={() => setDialog(null)} />}
      {dialog === 'issue' && <ReportIssueDialog onClose={() => setDialog(null)} />}
      {dialog === 'meeting' && <MeetingDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

// ─── Small building blocks ───────────────────────────────────────────

function ActionCard({ icon, title, desc, stat, onClick, accent }: {
  icon: React.ReactNode
  title: string
  desc: string
  stat: string
  onClick: () => void
  accent: 'violet' | 'amber' | 'sky'
}) {
  const accentCls = {
    violet: 'from-violet-500 to-purple-600',
    amber: 'from-amber-500 to-orange-600',
    sky: 'from-sky-500 to-indigo-600',
  }[accent]
  return (
    <motion.button
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="text-left rounded-2xl border border-border bg-card/60 p-4 hover:border-primary/30 hover:shadow-premium transition-all"
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accentCls} text-white shadow-md mb-3`}>
        {icon}
      </div>
      <p className="font-semibold text-sm">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
      <p className="text-[10px] text-muted-foreground/70 mt-2.5 font-mono">{stat}</p>
    </motion.button>
  )
}

function TaskRow({ task }: { task: ResponsibilityTask }) {
  const completeTask = useClassResponsibilityStore((s) => s.completeTask)
  // Canonical actor — the session's own student record.
  const me = useMyStudentRecord()
  const toggle = () => {
    const result = completeTask(task.id, me?.id ?? '')
    if (!result.ok) toast.error('Could not update task', { description: result.error })
  }
  return (
    <button onClick={toggle} className={cn(
      'w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
      task.done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-border bg-card/40 hover:bg-muted/30',
    )}>
      <span className={cn(
        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        task.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border bg-background',
      )}>
        {task.done && <CheckCircle2 className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold', task.done && 'line-through text-muted-foreground')}>{task.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{task.detail}</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
          by {task.assignedByName}{task.dueOn ? ` · due ${formatDate(task.dueOn)}` : ''}{task.done && task.doneOn ? ` · completed ${formatDate(task.doneOn)}` : ''}
        </p>
      </div>
    </button>
  )
}

function SubmissionStatus({ status, tone }: { status: string; tone: 'success' | 'info' | 'muted' }) {
  void tone
  return <StatusBadge status={status} variant="info" dot />
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
        <Clock className="h-4 w-4" />
      </div>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  )
}

// ─── Dialogs ─────────────────────────────────────────────────────────

function DialogShell({ title, subtitle, onClose, children, footer }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}) {
  useDismissOnEscape(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-premium-lg overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-border/60">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label={`Close ${title.toLowerCase()} dialog`}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-y-auto">{children}</div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">{footer}</div>
      </div>
    </div>
  )
}

function PostUpdateDialog({ positions, onClose }: { positions: StudentPosition[]; onClose: () => void }) {
  const postClassUpdate = useClassResponsibilityStore((s) => s.postClassUpdate)
  // Canonical actor — the session's own student record.
  const me = useMyStudentRecord()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<ClassUpdateCategory>('notice')

  const submit = () => {
    if (!title.trim() || !body.trim()) return
    const result = postClassUpdate({ actorStudentId: me?.id ?? '', title: title.trim(), body: body.trim(), category })
    if (result.ok) {
      toast.success('Update submitted for review', { description: 'Your class teacher will review it before it appears on the class notice board.' })
      onClose()
    } else {
      toast.error('Could not post update', { description: result.error })
    }
  }

  return (
    <DialogShell
      title="Post a class update"
      subtitle={`${POSITION_DEFS[positions[0]?.key]?.title} · reviewed by your teacher`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!title.trim() || !body.trim()} onClick={submit}>
            <Send className="h-3.5 w-3.5" /> Submit for review
          </Button>
        </>
      }
    >
      <div>
        <label className="text-xs font-medium">Type</label>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {(['notice', 'reminder', 'event', 'activity'] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium capitalize border transition-colors',
              category === c ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="cu-title" className="text-xs font-medium">Title</label>
        <input id="cu-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Science project submissions due Friday"
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
      </div>
      <div>
        <label htmlFor="cu-body" className="text-xs font-medium">Message</label>
        <textarea id="cu-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What should your class know?"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
      </div>
    </DialogShell>
  )
}

function ReportIssueDialog({ onClose }: { onClose: () => void }) {
  const reportIssue = useClassResponsibilityStore((s) => s.reportIssue)
  // Canonical actor — the session's own student record.
  const me = useMyStudentRecord()
  const [category, setCategory] = useState<IssueCategory>('facility')
  const [priority, setPriority] = useState<IssuePriority>('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const submit = () => {
    if (!title.trim() || !description.trim()) return
    const result = reportIssue({ actorStudentId: me?.id ?? '', category, priority, title: title.trim(), description: description.trim() })
    if (result.ok) {
      toast.success('Issue reported', { description: 'Your class teacher and the principal have been notified.' })
      onClose()
    } else {
      toast.error('Could not report issue', { description: result.error })
    }
  }

  return (
    <DialogShell
      title="Report an issue"
      subtitle="Goes to your class teacher and the principal"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!title.trim() || !description.trim()} onClick={submit}>
            <Send className="h-3.5 w-3.5" /> Report
          </Button>
        </>
      }
    >
      <div>
        <label className="text-xs font-medium">Category</label>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {(['facility', 'safety', 'bullying', 'academics', 'other'] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium capitalize border transition-colors',
              category === c ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">Priority</label>
        <div className="flex items-center gap-1.5 mt-1.5">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <button key={p} onClick={() => setPriority(p)} className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium capitalize border transition-colors',
              priority === p
                ? p === 'high' ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : p === 'medium' ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="ir-title" className="text-xs font-medium">Title</label>
        <input id="ir-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Classroom fan not working"
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
      </div>
      <div>
        <label htmlFor="ir-desc" className="text-xs font-medium">What happened?</label>
        <textarea id="ir-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe the issue…"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
      </div>
    </DialogShell>
  )
}

function MeetingDialog({ onClose }: { onClose: () => void }) {
  const requestTeacherMeeting = useClassResponsibilityStore((s) => s.requestTeacherMeeting)
  const student = useMyStudentRecord()
  const teacherList = useMemo(
    () => (student ? allowedTeachers(student.classId, student.section) : []),
    [student],
  )
  const [teacherId, setTeacherId] = useState<string>(teacherList[0]?.id ?? '')
  const [topic, setTopic] = useState('')
  const [slot, setSlot] = useState('')

  const submit = () => {
    if (!teacherId || !topic.trim()) return
    const teacher = teacherList.find((t) => t.id === teacherId)
    const result = requestTeacherMeeting({
      actorStudentId: student?.id ?? '',
      teacherId,
      teacherName: teacher?.name ?? teacherId,
      topic: topic.trim(),
      preferredSlot: slot.trim() || 'Any convenient time',
    })
    if (result.ok) {
      toast.success('Meeting requested', { description: `${teacher?.name} has been notified — you will see the status under My Submissions.` })
      onClose()
    } else {
      toast.error('Could not request meeting', { description: result.error })
    }
  }

  return (
    <DialogShell
      title="Request a teacher meeting"
      subtitle="Your class and subject teachers"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!teacherId || !topic.trim()} onClick={submit}>
            <Send className="h-3.5 w-3.5" /> Request
          </Button>
        </>
      }
    >
      <div>
        <label className="text-xs font-medium">Teacher</label>
        <div className="space-y-1.5 mt-1.5">
          {teacherList.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground" role="note">
              No class or subject teachers assigned yet — your class teacher and subject teachers will appear here once the school assigns them.
            </p>
          )}
          {teacherList.map((t) => (
            <button key={t.id} onClick={() => setTeacherId(t.id)} className={cn(
              'w-full flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
              teacherId === t.id ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40',
            )}>
              <GradientAvatar name={t.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-[11px] text-muted-foreground">{t.subject}</p>
              </div>
              {teacherId === t.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="mt-topic" className="text-xs font-medium">Topic</label>
        <input id="mt-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Discuss the class science project plan"
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
      </div>
      <div>
        <label htmlFor="mt-slot" className="text-xs font-medium">Preferred time (optional)</label>
        <input id="mt-slot" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="e.g. Tuesday lunch break"
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
      </div>
    </DialogShell>
  )
}
