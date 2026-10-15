'use client'

/**
 * Overview section for the ExamWorkspace.
 *
 * Contains the ActionItemsWidget (smart next-step suggestions based on
 * exam state) and the OverviewSection itself (KPI grid + readiness
 * checklist + inline exam-details editor).
 */

import { useState } from 'react'
import { ArrowLeft, Award, BookOpen, CalendarDays, CheckCircle2, Lock, Megaphone, Pencil, PieChart, Save, Send, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useUpdateExam } from '@/lib/exams/use-exams'
import { useRoleGate } from '@/lib/exams/use-role-gate'
import type { ExamDTO } from '@/lib/exams/types'
import { isResultDeclared, resultStatusIs, examStatusIs } from '@/lib/exams/types'
import { Kpi, DetailField, type Tab } from './workspace-shared'

// ─── Action Items Widget — smart next-steps based on exam state ──────

export function ActionItemsWidget({ exam, onNavigate }: { exam: ExamDTO; onNavigate: (t: Tab) => void }) {
  // Compute actionable items based on the exam's current state.
  const items: Array<{ label: string; description: string; action: string; tab: Tab; priority: 'high' | 'medium' | 'low'; icon: React.ReactNode }> = []

  const entered = exam.markSummary.entered
  const total = exam.markSummary.total
  const submitted = exam.markSummary.submitted
  const verified = exam.markSummary.verified
  const locked = exam.markSummary.locked

  // Draft state — schedule not published
  if (exam.schedule.length === 0) {
    items.push({
      label: 'Publish exam schedule',
      description: 'No schedule items yet. Build the timetable so students and teachers know exam dates.',
      action: 'Build Schedule',
      tab: 'schedule',
      priority: 'high',
      icon: <CalendarDays className="h-3.5 w-3.5" />,
    })
  }

  // Marks entry not started
  if (total > 0 && entered === 0) {
    items.push({
      label: 'Start marks entry',
      description: `${total} marks pending entry. Teachers can begin entering marks for their subjects.`,
      action: 'Go to Marks',
      tab: 'marks',
      priority: 'high',
      icon: <Pencil className="h-3.5 w-3.5" />,
    })
  }

  // Marks entered but not submitted
  if (entered > 0 && submitted < entered) {
    items.push({
      label: 'Submit pending marks',
      description: `${entered - submitted} marks entered but not yet submitted for verification.`,
      action: 'Review Marks',
      tab: 'marks',
      priority: 'high',
      icon: <Send className="h-3.5 w-3.5" />,
    })
  }

  // Marks submitted but not verified
  if (submitted > verified) {
    items.push({
      label: 'Verify submitted marks',
      description: `${submitted - verified} marks awaiting Principal verification.`,
      action: 'Verify Now',
      tab: 'marks',
      priority: 'high',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    })
  }

  // Marks verified but not locked
  if (verified > locked) {
    items.push({
      label: 'Lock verified papers',
      description: `${verified - locked} papers verified and ready to lock. Locking prevents further edits.`,
      action: 'Lock Papers',
      tab: 'marks',
      priority: 'medium',
      icon: <Lock className="h-3.5 w-3.5" />,
    })
  }

  // All locked but results not declared
  const allLocked = total > 0 && locked === total
  if (allLocked && !isResultDeclared(exam.resultStatus) && !resultStatusIs(exam.resultStatus, 'Result Ready')) {
    items.push({
      label: 'Declare results',
      description: 'All papers are locked. Ready to declare results for individual classes.',
      action: 'Declare Results',
      tab: 'marks',
      priority: 'high',
      icon: <Award className="h-3.5 w-3.5" />,
    })
  }

  // Results declared but not published (check per-class)
  if (isResultDeclared(exam.resultStatus)) {
    items.push({
      label: 'Publish results to students',
      description: 'Results are declared. Publish to notify students and parents.',
      action: 'Publish Results',
      tab: 'marks',
      priority: 'high',
      icon: <Megaphone className="h-3.5 w-3.5" />,
    })
  }

  // Completed exam — suggest analytics
  if (examStatusIs(exam.status, 'Completed') && isResultDeclared(exam.resultStatus)) {
    items.push({
      label: 'Review grade analytics',
      description: 'Results are published. Review grade distribution and student performance.',
      action: 'View Grades',
      tab: 'grade',
      priority: 'low',
      icon: <PieChart className="h-3.5 w-3.5" />,
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">All caught up!</p>
            <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">
              No pending actions for this examination. All tasks are complete.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const priorityStyles = {
    high: 'border-rose-500/30 bg-rose-500/5',
    medium: 'border-amber-500/30 bg-amber-500/5',
    low: 'border-sky-500/30 bg-sky-500/5',
  }
  const priorityIconStyles = {
    high: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    low: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  }
  const priorityLabel = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Action Items</h3>
          <span className="inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[9px] font-bold bg-primary/10 text-primary">
            {items.length}
          </span>
        </div>
        <span className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider">Next Steps</span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={i}
            className={cn('flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors hover:shadow-sm', priorityStyles[item.priority])}
          >
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', priorityIconStyles[item.priority])}>
              {item.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-foreground">{item.label}</p>
                <span className={cn('inline-flex items-center px-1 py-0 rounded text-[7px] font-bold uppercase tracking-wider', priorityIconStyles[item.priority])}>
                  {priorityLabel[item.priority]}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
            </div>
            <button
              onClick={() => onNavigate(item.tab)}
              className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              {item.action}
              <ArrowLeft className="h-2.5 w-2.5 rotate-180" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Overview Section with Exam Readiness ─────────────────────────────

export function OverviewSection({ exam, onReload, onNavigate }: { exam: ExamDTO; onReload: () => void; onNavigate: (t: Tab) => void }) {
  const { update } = useUpdateExam()
  const gate = useRoleGate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(exam.name)
  const [status, setStatus] = useState(exam.status)
  const [startDate, setStartDate] = useState(exam.startDate ?? '')
  const [endDate, setEndDate] = useState(exam.endDate ?? '')

  const handleSave = async () => {
    try {
      await update(exam.id, { name, status, startDate, endDate })
      toast.success('Exam updated')
      setEditing(false)
      onReload()
    } catch (e: any) {
      toast.error('Failed to update exam', { description: e.message })
    }
  }

  // Compute real readiness indicators
  const readiness = [
    { label: 'Classes configured', done: exam.classes.length > 0, navigate: 'overview' as Tab },
    { label: 'Subjects configured', done: exam.subjects.length > 0, navigate: 'overview' as Tab },
    { label: 'Schedule published', done: exam.schedule.length > 0, navigate: 'schedule' as Tab },
    { label: 'Marks entry started', done: exam.markSummary.entered > 0, navigate: 'marks' as Tab },
    { label: 'Marks verified', done: exam.markSummary.verified > 0, navigate: 'marks' as Tab },
    { label: 'Marks locked', done: exam.markSummary.locked > 0, navigate: 'marks' as Tab },
    { label: 'Results declared', done: isResultDeclared(exam.resultStatus), navigate: 'marks' as Tab },
  ]

  const entered = exam.markSummary.entered
  const total = exam.markSummary.total
  const pct = exam.markSummary.pct

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Classes" value={exam.classes.length} sub={`${exam.classes.reduce((s: number, c: any) => s + c.studentCount, 0)} students`} icon={<Users className="h-4 w-4" />} accent="sky" />
        <Kpi label="Subjects" value={exam.subjects.length} sub={`${exam.schedule.length} scheduled`} icon={<BookOpen className="h-4 w-4" />} accent="violet" />
        <Kpi label="Marks Entry" value={`${entered}/${total}`} sub={`${pct}% entered`} progress={pct} icon={<CheckCircle2 className="h-4 w-4" />} accent="emerald" />
        <Kpi label="Schedule" value={exam.schedule.length} sub={`${exam.schedule.length} sessions`} icon={<CalendarDays className="h-4 w-4" />} accent="amber" />
      </div>

      {/* Action Items / Next Steps — smart suggestions based on exam state */}
      <ActionItemsWidget exam={exam} onNavigate={onNavigate} />

      {/* Exam readiness */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Exam Readiness</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {readiness.map((r) => (
            <button
              key={r.label}
              onClick={() => onNavigate(r.navigate)}
              className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-left"
            >
              <span className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                r.done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
              )}>
                {r.done ? '✓' : '—'}
              </span>
              <span className="text-xs flex-1">{r.label}</span>
              {!r.done && <span className="text-[9px] text-muted-foreground">pending</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Edit / details */}
      {gate.canEdit ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Examination Details</h3>
            {!editing ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleSave}>
                  <Save className="h-3 w-3" /> Save
                </Button>
              </div>
            )}
          </div>
          {!editing ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <DetailField label="Name" value={exam.name} />
              <DetailField label="Status" value={exam.status} />
              <DetailField label="Start" value={exam.startDate ?? '—'} />
              <DetailField label="End" value={exam.endDate ?? '—'} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px]">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger size="sm" className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Scheduled">Scheduled</SelectItem>
                    <SelectItem value="Ongoing">Ongoing</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Start Date</Label>
                <DatePicker value={startDate} onChange={setStartDate} />
              </div>
              <div>
                <Label className="text-[10px]">End Date</Label>
                <DatePicker value={endDate} onChange={setEndDate} />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
