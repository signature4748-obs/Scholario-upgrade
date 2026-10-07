'use client'

/**
 * Audit section for the ExamWorkspace.
 *
 * PHASE 6 (§8) — REAL server audit trail: GET /api/exams/[id]/audit
 * returns the canonical ExamAuditLog rows (actor, action, entity,
 * old→new values, timestamp) written by every exam mutation — marks
 * workflow, grace, outcomes, seating, invigilators, declarations. The
 * in-memory mock event store (fabricated "Mr. Sharma" seed events) is
 * retired: what renders here is exactly what the server recorded.
 *
 * Filters: action type + user name (the server rows carry no role
 * dimension — the role chip/filter of the mock era is gone).
 */

import { useState, useMemo } from 'react'
import { Award, CheckCircle2, Clock, FileText, Filter, Lock, Megaphone, Pencil, RotateCcw, Send, Unlock, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuditLogs } from '@/lib/exams/use-exams'
import type { AuditLogDTO } from '@/lib/exams/types'
import { CollapsibleSection } from './collapsible-section'

/** Real ExamAuditLog action vocabulary (service.ts + service-extended.ts). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  EXAM_CREATED: 'Exam Created',
  EXAM_UPDATED: 'Exam Updated',
  SCHEDULE_ADDED: 'Schedule Added',
  SCHEDULE_UPDATED: 'Schedule Updated',
  SCHEDULE_DELETED: 'Schedule Deleted',
  MARK_ENTERED: 'Marks Entered',
  MARKS_IMPORTED_CSV: 'Marks Imported (CSV)',
  MARK_SUBMITTED: 'Marks Submitted',
  MARK_VERIFIED: 'Marks Verified',
  MARK_LOCKED: 'Marks Locked',
  MARK_UNLOCKED: 'Marks Unlocked',
  GRACE_APPLIED: 'Grace Applied',
  ATTENDANCE_SUBMITTED: 'Attendance Submitted',
  EXAM_ATTENDANCE_MARKED: 'Exam Attendance Marked',
  EXAM_ATTENDANCE_AUTO_MARKED: 'Exam Attendance Auto-Marked',
  SEATING_GENERATED: 'Seating Generated',
  INVIGILATOR_ASSIGNED: 'Invigilator Assigned',
  INVIGILATOR_CLEARED: 'Invigilator Cleared',
  RESULT_DECLARED: 'Result Declared',
  RESULT_PUBLISHED: 'Result Published',
  OUTCOME_OVERRIDDEN: 'Outcome Overridden',
}

/** Human summary for a server row — entity + old→new when present. */
function summaryOf(e: AuditLogDTO): string {
  const entity = e.entity ?? ''
  if (e.oldValue || e.newValue) {
    const oldV = e.oldValue ? shortValue(e.oldValue) : '—'
    const newV = e.newValue ? shortValue(e.newValue) : '—'
    return `${entity ? `${entity} · ` : ''}${oldV} → ${newV}`
  }
  return entity ? `Entity: ${entity}${e.entityId ? ` (${e.entityId})` : ''}` : 'No detail recorded'
}

function shortValue(v: string): string {
  try {
    const parsed = JSON.parse(v)
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed).slice(0, 3)
      return keys.map((k) => `${k}: ${String(parsed[k]).slice(0, 24)}`).join(', ')
    }
    return String(parsed).slice(0, 48)
  } catch {
    return v.slice(0, 48)
  }
}

export function AuditSection({ examId }: { examId: string }) {
  // REAL audit log (GET /api/exams/[id]/audit) — newest first.
  const { logs, loading } = useAuditLogs(examId)
  const [filterAction, setFilterAction] = useState('all')
  const [filterUser, setFilterUser] = useState('all')

  const users = useMemo(() => {
    const set = new Map<string, string>()
    for (const e of logs) {
      if (e.userName) set.set(e.userName, e.userName)
    }
    return Array.from(set.values())
  }, [logs])

  const filtered = useMemo(
    () =>
      logs
        .filter((e) => filterAction === 'all' || e.action === filterAction)
        .filter((e) => filterUser === 'all' || e.userName === filterUser)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [logs, filterAction, filterUser],
  )

  const hasFilters = filterAction !== 'all' || filterUser !== 'all'

  const actionIcon: Record<string, React.ReactNode> = {
    EXAM_CREATED: <FileText className="h-3 w-3" />,
    EXAM_UPDATED: <FileText className="h-3 w-3" />,
    SCHEDULE_ADDED: <Clock className="h-3 w-3" />,
    SCHEDULE_UPDATED: <Clock className="h-3 w-3" />,
    SCHEDULE_DELETED: <Clock className="h-3 w-3" />,
    SEATING_GENERATED: <FileText className="h-3 w-3" />,
    INVIGILATOR_ASSIGNED: <User className="h-3 w-3" />,
    INVIGILATOR_CLEARED: <User className="h-3 w-3" />,
    MARK_ENTERED: <Pencil className="h-3 w-3" />,
    MARKS_IMPORTED_CSV: <FileText className="h-3 w-3" />,
    MARK_SUBMITTED: <Send className="h-3 w-3" />,
    MARK_VERIFIED: <CheckCircle2 className="h-3 w-3" />,
    MARK_LOCKED: <Lock className="h-3 w-3" />,
    MARK_UNLOCKED: <Unlock className="h-3 w-3" />,
    ATTENDANCE_SUBMITTED: <CheckCircle2 className="h-3 w-3" />,
    EXAM_ATTENDANCE_MARKED: <CheckCircle2 className="h-3 w-3" />,
    EXAM_ATTENDANCE_AUTO_MARKED: <CheckCircle2 className="h-3 w-3" />,
    GRACE_APPLIED: <Award className="h-3 w-3" />,
    RESULT_DECLARED: <Award className="h-3 w-3" />,
    RESULT_PUBLISHED: <Megaphone className="h-3 w-3" />,
    OUTCOME_OVERRIDDEN: <FileText className="h-3 w-3" />,
  }

  const actionColor: Record<string, string> = {
    MARK_LOCKED: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    MARK_UNLOCKED: 'text-rose-700 dark:text-rose-300 bg-rose-500/15 border-rose-500/30',
    MARK_VERIFIED: 'text-sky-700 dark:text-sky-300 bg-sky-500/15 border-sky-500/30',
    MARK_SUBMITTED: 'text-amber-700 dark:text-amber-300 bg-amber-500/15 border-amber-500/30',
    GRACE_APPLIED: 'text-violet-700 dark:text-violet-300 bg-violet-500/15 border-violet-500/30',
    RESULT_DECLARED: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    RESULT_PUBLISHED: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    OUTCOME_OVERRIDDEN: 'text-sky-700 dark:text-sky-300 bg-sky-500/15 border-sky-500/30',
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
        Loading audit log…
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
        {hasFilters
          ? 'No audit events match your filters.'
          : 'No audit entries yet. Actions on marks, attendance, grace, and results will appear here as the server records them.'}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] uppercase font-semibold text-muted-foreground flex items-center gap-1"><Filter className="h-2.5 w-2.5" /> Filters:</span>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1">
          <option value="all">All Actions</option>
          {Object.keys(AUDIT_ACTION_LABELS).map((a) => (
            <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>
          ))}
        </select>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="h-6 text-[10px] rounded bg-transparent border border-border/40 px-1">
          <option value="all">All Users</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={() => { setFilterAction('all'); setFilterUser('all') }}
            className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Clear
          </button>
        )}
        <span className="text-[9px] text-muted-foreground ml-auto">{filtered.length} events</span>
      </div>

      {/* Timeline */}
      <CollapsibleSection title="Audit Trail" subtitle={`${filtered.length} events`} accent="emerald">
        <div className="relative pl-8 py-3 space-y-3 max-h-[500px] overflow-y-auto">
          {/* Vertical line — stronger */}
          <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-border via-border/60 to-transparent" />
          {filtered.map((e) => {
            const label = AUDIT_ACTION_LABELS[e.action] ?? e.action
            const icon = actionIcon[e.action] ?? <Clock className="h-3 w-3" />
            const color = actionColor[e.action] ?? 'text-muted-foreground bg-muted border-border'
            return (
              <div key={e.id} className="relative group">
                <span className={cn('absolute -left-[20px] top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-card shadow-sm transition-transform group-hover:scale-110', color)}>
                  {icon}
                </span>
                <div className="rounded-lg border border-border/50 bg-card px-3 py-2 hover:bg-muted/30 hover:border-border transition-colors shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-foreground">{label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{summaryOf(e)}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium bg-muted/60 text-muted-foreground">
                          <User className="h-2 w-2" /> {e.userName ?? 'System'}
                        </span>
                        {e.entityId && (
                          <span className="text-[9px] text-muted-foreground/70 font-mono truncate max-w-[220px]">
                            {e.entity}#{e.entityId.slice(-8)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[9px] text-muted-foreground/70 shrink-0 tabular-nums whitespace-nowrap font-mono">
                      {new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CollapsibleSection>
    </div>
  )
}
