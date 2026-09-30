'use client'

/**
 * ExamsListTab — Principal examination list organized by lifecycle.
 *
 * Three sections: Current / Active → Upcoming → Completed.
 * No status filters (Scheduled/Ongoing/Completed/Results) — those
 * are top-level tabs. Only search + optional type filter remain.
 *
 * Each exam card uses a tasteful color accent based on its lifecycle:
 *   LIVE / ONGOING → emerald accent
 *   UPCOMING       → sky accent
 *   COMPLETED      → teal/neutral accent
 *   DRAFT          → soft amber accent
 *
 * Section headers carry an icon + status color + count badge.
 *
 * Status-aware actions per card:
 *   Draft     → Open · Publish · Delete (with confirmation)
 *   Scheduled → Open · Archive
 *   Ongoing   → Open
 *   Completed → Open · Archive
 *   Published exams cannot be deleted — only archived.
 *
 * All data from real /api/exams via useExamsList.
 */

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Plus, Search, ChevronRight, Radio, CheckCircle2, Calendar,
  Users, BookOpen, FileText, Clock, MoreVertical, Send,
  Trash2, Archive as ArchiveIcon, Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EXAM_TYPES, type ExamDTO } from '@/lib/exams/types'
import { InlineLoading } from '../inline-loading'
import { ModuleEmptyState } from '../../shared/empty-state'
import { useUpdateExam, useDeleteExam } from '@/lib/exams/use-exams'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  exams: ExamDTO[]
  loading: boolean
  error: string | null
  onOpenExam: (id: string) => void
  onReload: () => void
  onCreate?: () => void
}

type Variant = 'live' | 'upcoming' | 'completed'

export function ExamsListTab({ exams, loading, error, onOpenExam, onReload, onCreate }: Props) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  // Mutation hooks for status transitions
  const { update: updateExam } = useUpdateExam()
  // REAL data (iq3000-2b): DELETE /api/exams/[id] — drafts are removed from
  // the canonical DB, keeping the server-backed list coherent.
  const { remove: deleteExam } = useDeleteExam()

  // Confirmation dialogs
  const [publishTarget, setPublishTarget] = useState<ExamDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExamDTO | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ExamDTO | null>(null)

  // Classify exams into lifecycle sections
  const sections = useMemo(() => {
    const filtered = exams.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const matches = e.name.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          e.classes.some((c) => c.className.toLowerCase().includes(q))
        if (!matches) return false
      }
      return true
    })

    const current = filtered.filter((e) =>
      e.status.toLowerCase() === 'ongoing'
    ).sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))

    const upcoming = filtered.filter((e) =>
      ['scheduled', 'draft'].includes(e.status.toLowerCase())
    ).sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))

    const completed = filtered.filter((e) =>
      e.status.toLowerCase() === 'completed'
    ).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

    return { current, upcoming, completed }
  }, [exams, search, typeFilter])

  // ─── Actions ────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!publishTarget) return
    try {
      await updateExam(publishTarget.id, { status: 'Scheduled' })
      toast.success('Examination published', {
        description: `${publishTarget.name} is now active for teachers and students.`,
      })
      setPublishTarget(null)
      onReload()
    } catch (e: any) {
      toast.error('Failed to publish', { description: e.message })
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteExam(deleteTarget.id)
      toast.success('Draft examination deleted', { description: deleteTarget.name })
      setDeleteTarget(null)
      onReload()
    } catch (e: any) {
      toast.error('Failed to delete', { description: e.message })
    }
  }

  const handleArchive = async () => {
    if (!archiveTarget) return
    try {
      await updateExam(archiveTarget.id, { status: 'Cancelled' })
      toast.success('Examination archived', {
        description: `${archiveTarget.name} moved to Archive. Historical records preserved.`,
      })
      setArchiveTarget(null)
      onReload()
    } catch (e: any) {
      toast.error('Failed to archive', { description: e.message })
    }
  }

  if (loading) return <InlineLoading label="Loading examinations…" />

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
        <p className="text-sm text-rose-700 dark:text-rose-300 font-medium">Failed to load examinations</p>
        <p className="text-xs text-rose-600/70 mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search examinations…"
            className="h-9 pl-9 pr-3 text-xs"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger size="sm" className="w-[150px] text-xs rounded-lg h-9">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EXAM_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onCreate && (
          <Button
            onClick={onCreate}
            size="sm"
            className="h-9 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Create Examination
          </Button>
        )}
      </div>

      <ExamSection
        title="Current" icon={<Radio className="h-3.5 w-3.5" />} exams={sections.current} variant="live"
        onOpenExam={onOpenExam} onPublish={(e) => setPublishTarget(e)} onDelete={(e) => setDeleteTarget(e)} onArchive={(e) => setArchiveTarget(e)}
        emptyMessage="No examination is currently in progress."
      />
      <ExamSection
        title="Upcoming" icon={<Calendar className="h-3.5 w-3.5" />} exams={sections.upcoming} variant="upcoming"
        onOpenExam={onOpenExam} onPublish={(e) => setPublishTarget(e)} onDelete={(e) => setDeleteTarget(e)} onArchive={(e) => setArchiveTarget(e)}
        emptyMessage="No upcoming examinations scheduled."
      />
      <ExamSection
        title="Completed" icon={<CheckCircle2 className="h-3.5 w-3.5" />} exams={sections.completed} variant="completed"
        onOpenExam={onOpenExam} onPublish={(e) => setPublishTarget(e)} onDelete={(e) => setDeleteTarget(e)} onArchive={(e) => setArchiveTarget(e)}
        emptyMessage="No completed examinations yet."
      />

      {/* ─── Confirmation dialogs ──────────────────────────────────── */}
      <AlertDialog open={!!publishTarget} onOpenChange={(o) => !o && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish Examination?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{publishTarget?.name}</span> will be made available to relevant teachers and students, and will activate the examination for further operations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Publish Examination
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft Examination?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the draft <span className="font-medium text-foreground">{deleteTarget?.name}</span> and its generated schedule. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Examination?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{archiveTarget?.name}</span> will be moved to the Archive. All examination data, schedule, marks, and results will be preserved historically. The examination will no longer appear in the active workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} className="bg-amber-600 hover:bg-amber-700 text-white">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Variant visual config ────────────────────────────────────────────

const VARIANT_STYLES: Record<Variant, {
  accentText: string; accentBg: string; cardBorder: string; cardHoverBorder: string; barColor: string; pillClass: string
}> = {
  live: {
    accentText: 'text-emerald-600 dark:text-emerald-400', accentBg: 'bg-emerald-500/10',
    cardBorder: 'border-emerald-500/20', cardHoverBorder: 'hover:border-emerald-500/40',
    barColor: 'bg-emerald-500', pillClass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  upcoming: {
    accentText: 'text-sky-600 dark:text-sky-400', accentBg: 'bg-sky-500/10',
    cardBorder: 'border-border', cardHoverBorder: 'hover:border-sky-500/30',
    barColor: 'bg-sky-500', pillClass: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  completed: {
    accentText: 'text-teal-600 dark:text-teal-400', accentBg: 'bg-teal-500/10',
    cardBorder: 'border-border/70', cardHoverBorder: 'hover:border-teal-500/30',
    barColor: 'bg-teal-500', pillClass: 'border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  },
}

// ─── Exam Section ────────────────────────────────────────────────────

function ExamSection({
  title, icon, exams, variant, onOpenExam, onPublish, onDelete, onArchive, emptyMessage,
}: {
  title: string; icon: React.ReactNode; exams: ExamDTO[]; variant: Variant
  onOpenExam: (id: string) => void; onPublish: (e: ExamDTO) => void
  onDelete: (e: ExamDTO) => void; onArchive: (e: ExamDTO) => void; emptyMessage: string
}) {
  const v = VARIANT_STYLES[variant]
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', v.accentBg, v.accentText)}>
          {icon}
        </span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className={cn('inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums', v.accentBg, v.accentText)}>
          {exams.length}
        </span>
      </div>
      {exams.length === 0 ? (
        <ModuleEmptyState
          className="m-0 rounded-lg py-5"
          icon={icon}
          title={emptyMessage}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {exams.map((exam, i) => (
            <ExamCard key={exam.id} exam={exam} variant={variant} delay={i}
              onOpen={() => onOpenExam(exam.id)} onPublish={() => onPublish(exam)}
              onDelete={() => onDelete(exam)} onArchive={() => onArchive(exam)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Exam Card ───────────────────────────────────────────────────────

function ExamCard({
  exam, variant, delay, onOpen, onPublish, onDelete, onArchive,
}: {
  exam: ExamDTO; variant: Variant; delay: number
  onOpen: () => void; onPublish: () => void; onDelete: () => void; onArchive: () => void
}) {
  const v = VARIANT_STYLES[variant]
  const isLive = variant === 'live'
  const isCompleted = variant === 'completed'
  const isDraft = exam.status.toLowerCase() === 'draft'
  const isArchived = exam.status.toLowerCase() === 'cancelled'

  const totalStudents = exam.classes.reduce((s, c) => s + c.studentCount, 0)
  const markPct = exam.markSummary.pct
  const dateRange = exam.startDate && exam.endDate
    ? `${formatDate(exam.startDate)} — ${formatDate(exam.endDate)}`
    : exam.startDate ? formatDate(exam.startDate) : 'Date TBD'

  const statusPill = isArchived ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
      <ArchiveIcon className="h-2.5 w-2.5" /> ARCHIVED
    </span>
  ) : isLive ? (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold shrink-0', v.pillClass)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      LIVE
    </span>
  ) : isDraft ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
      DRAFT
    </span>
  ) : isCompleted ? (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold shrink-0', v.pillClass)}>
      <CheckCircle2 className="h-2.5 w-2.5" /> DONE
    </span>
  ) : (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold shrink-0', v.pillClass)}>
      <Clock className="h-2.5 w-2.5" /> SCHEDULED
    </span>
  )

  const canPublish = isDraft
  const canDelete = isDraft
  const canArchive = !isDraft && !isArchived

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(delay * 0.04, 0.3), duration: 0.25 }}
      whileHover={{ y: -2 }}
      className={cn('group relative rounded-xl border bg-card p-4 transition-all overflow-hidden', v.cardBorder, v.cardHoverBorder, 'hover:shadow-sm')}
    >
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', v.barColor)} />

      <div className="flex items-start justify-between gap-2 mb-2 pl-1">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors">{exam.name}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{exam.type} · {exam.session}</p>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {statusPill}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Exam actions"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={onOpen} className="gap-2 cursor-pointer">
                <Eye className="h-3.5 w-3.5" /> Open
              </DropdownMenuItem>
              {canPublish && (
                <DropdownMenuItem onClick={onPublish} className="gap-2 cursor-pointer">
                  <Send className="h-3.5 w-3.5" /> Publish
                </DropdownMenuItem>
              )}
              {canArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onArchive} className="gap-2 cursor-pointer text-amber-700 dark:text-amber-300 focus:text-amber-700">
                    <ArchiveIcon className="h-3.5 w-3.5" /> Archive
                  </DropdownMenuItem>
                </>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} className="gap-2 cursor-pointer text-rose-700 dark:text-rose-300 focus:text-rose-700">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <button onClick={onOpen} className="block w-full text-left pl-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3">
          <Calendar className="h-3 w-3 shrink-0" />
          <span>{dateRange}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <CardStat icon={<BookOpen className="h-3 w-3" />} label="Classes" value={exam.classes.length} />
          <CardStat icon={<FileText className="h-3 w-3" />} label="Subjects" value={exam.subjects.length} />
          <CardStat icon={<Users className="h-3 w-3" />} label="Students" value={totalStudents} />
        </div>
        {exam.markSummary.total > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-0.5">
              <span>Marks Entry</span>
              <span className="font-semibold tabular-nums">{exam.markSummary.entered}/{exam.markSummary.total}</span>
            </div>
            <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${markPct}%` }}
                transition={{ duration: 0.5, delay: delay * 0.04, ease: [0.22, 1, 0.36, 1] }}
                className={cn('h-full rounded-full', markPct === 100 ? 'bg-emerald-500' : 'bg-amber-500')}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 mt-1 border-t border-border/40 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-2.5 w-2.5" />
            {exam.schedule.length} papers
          </span>
          <span className="text-muted-foreground/40">·</span>
          {isCompleted ? (
            <span className={cn('font-medium', exam.resultStatus === 'Result Declared' && 'text-emerald-600 dark:text-emerald-400')}>
              {exam.resultStatus}
            </span>
          ) : (
            <span>{exam.resultStatus}</span>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </button>
    </motion.div>
  )
}

function CardStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[8px] uppercase text-muted-foreground font-semibold">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </div>
      <p className="text-xs font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
