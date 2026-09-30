'use client'

/**
 * ArchiveView — historical examination records viewer (full-screen).
 *
 * Conceptually distinct from the active session switcher on Overview:
 *   • Overview session picker = "what's happening NOW in this session"
 *   • Archive = "what HAPPENED in past sessions"
 *
 * Structure:
 *   1. Header: back button + "Examination Archive" title + search/filter bar
 *   2. Left rail: list of archived sessions (clickable)
 *   3. Right content: exams from selected session OR search results
 *
 * Search supports: student name, class, session, examination name/type.
 * Filters: session dropdown + class dropdown.
 *
 * Uses mock data from src/lib/exams/archive-data.ts.
 */

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Archive as ArchiveIcon, Search, Calendar, Trophy,
  Users, FileText, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  getArchivedSessions,
  searchArchive,
  getArchivedClassNames,
  type ArchivedSession,
  type ArchiveSearchResult,
} from '@/lib/exams/archive-data'
import { ModuleEmptyState } from '../../shared/empty-state'

interface Props {
  onBack: () => void
}

export function ArchiveView({ onBack }: Props) {
  const sessions = useMemo(() => getArchivedSessions(), [])
  const classNames = useMemo(() => getArchivedClassNames(), [])

  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState<string>('all')
  const [classFilter, setClassFilter] = useState<string>('all')
  const [selectedSession, setSelectedSession] = useState<string>(sessions[0]?.session ?? '')

  // Search is "active" when there's a query OR a non-default filter
  const searchActive = query.trim().length > 0 || sessionFilter !== 'all' || classFilter !== 'all'

  const searchResults = useMemo(() => {
    if (!searchActive) return []
    return searchArchive({
      query,
      session: sessionFilter,
      className: classFilter,
    })
  }, [query, sessionFilter, classFilter, searchActive])

  const currentSession = sessions.find((s) => s.session === selectedSession) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-border bg-card px-4 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            aria-label="Back to Examinations"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ArchiveIcon className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Examination Archive</h1>
          <span className="text-[10px] text-muted-foreground">
            {sessions.length} archived sessions
          </span>
        </div>
      </div>

      {/* ─── Search + Filter bar ─────────────────────────────────── */}
      <div className="border-b border-border bg-card/50 px-4 sm:px-6 py-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search student / ID / examination…"
              className="h-8 pl-8 pr-8 text-xs"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={sessionFilter} onValueChange={setSessionFilter}>
            <SelectTrigger size="sm" className="w-[140px] text-xs rounded-lg">
              <SelectValue placeholder="All Sessions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sessions</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.session} value={s.session}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger size="sm" className="w-[140px] text-xs rounded-lg">
              <SelectValue placeholder="All Classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {classNames.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {searchActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setQuery('')
                setSessionFilter('all')
                setClassFilter('all')
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* ─── Main: left rail + right content ─────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <AnimatePresence mode="wait">
          {searchActive ? (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <SearchResults results={searchResults} />
            </motion.div>
          ) : (
            <motion.div
              key="browse"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4"
            >
              {/* Left rail: archived sessions */}
              <div className="rounded-xl border border-border bg-card p-2 lg:sticky lg:top-0 lg:self-start">
                <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground px-2 py-1.5">
                  Archived Sessions
                </p>
                <div className="space-y-0.5">
                  {sessions.map((s) => (
                    <button
                      key={s.session}
                      onClick={() => setSelectedSession(s.session)}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left',
                        selectedSession === s.session
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                      )}
                    >
                      <span>{s.label}</span>
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {s.examCount}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: selected session detail */}
              <div>
                {currentSession ? (
                  <SessionDetail session={currentSession} />
                ) : (
                  <ModuleEmptyState
                    className="m-0 py-12"
                    icon={<ArchiveIcon className="h-5 w-5" aria-hidden />}
                    title="No session selected"
                    description="Select an archived session to view its examinations."
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Session Detail (right pane when no search) ──────────────────────

function SessionDetail({ session }: { session: ArchivedSession }) {
  return (
    <div className="space-y-4">
      {/* Session summary card */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-border bg-card p-4"
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              Academic Session
            </p>
            <h2 className="font-display text-lg font-bold tracking-tight">{session.label}</h2>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase font-semibold text-muted-foreground">Exams</p>
            <p className="font-display text-xl font-bold tabular-nums">{session.examCount}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/40">
          <SummaryStat icon={<Users className="h-3.5 w-3.5" />} label="Students" value={session.totalStudents} />
          <SummaryStat
            icon={<TrendingUp />}
            label="Avg %"
            value={session.averagePercentage.toFixed(1)}
          />
          <SummaryStat
            icon={<Trophy className="h-3.5 w-3.5 text-amber-500" />}
            label="Topper"
            value={session.topperName}
            isText
          />
          <SummaryStat
            icon={<Trophy className="h-3.5 w-3.5 text-amber-500" />}
            label="Top %"
            value={session.topperPercentage.toFixed(1)}
          />
        </div>
      </motion.div>

      {/* Examinations list */}
      <div>
        <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-2">
          Examinations Conducted
        </p>
        <div className="space-y-2">
          {session.exams.map((exam, i) => (
            <ArchivedExamRow key={exam.id} exam={exam} delay={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TrendingUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}

function SummaryStat({
  icon,
  label,
  value,
  isText,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  isText?: boolean
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground font-semibold">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </div>
      <p className={cn('mt-0.5 font-display font-bold tabular-nums text-xs', isText && 'text-[11px] truncate')}>
        {value}
      </p>
    </div>
  )
}

// ─── Archived Exam Row (in session detail) ───────────────────────────

function ArchivedExamRow({
  exam,
  delay,
}: {
  exam: ArchivedSession['exams'][number]
  delay: number
}) {
  const dateRange =
    exam.startDate && exam.endDate
      ? `${formatDate(exam.startDate)} — ${formatDate(exam.endDate)}`
      : exam.startDate
        ? formatDate(exam.startDate)
        : '—'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.04, duration: 0.25 }}
      className="rounded-lg border border-border bg-card p-3 hover:border-border/80 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{exam.name}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {exam.type} · {[...new Set(exam.classes.map((c) => c.className))].join(', ')}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
          Published
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>{dateRange}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>{exam.totalStudents} students</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>{exam.totalPapers} papers</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Trophy className="h-3 w-3 text-amber-500" />
          <span className="font-medium text-foreground">{exam.topperName}</span>
          <span className="font-semibold tabular-nums">({exam.topperPercentage}%)</span>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/40 text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Avg:</span>
          <span className="font-bold tabular-nums">{exam.averagePercentage.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Pass Rate:</span>
          <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {exam.passRate}%
          </span>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Search Results ──────────────────────────────────────────────────

function SearchResults({ results }: { results: ArchiveSearchResult[] }) {
  if (results.length === 0) {
    return (
      <ModuleEmptyState
        className="m-0 py-12"
        icon={<Search className="h-5 w-5" aria-hidden />}
        title="No results found"
        description="Try a different student name, class, or session."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {results.length} record{results.length === 1 ? '' : 's'} found
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Table header (desktop) */}
        <div className="hidden sm:grid grid-cols-[1fr_120px_140px_100px_100px] gap-3 px-4 py-2 border-b border-border bg-muted/30 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">
          <span>Examination</span>
          <span>Session</span>
          <span>Top Student</span>
          <span className="text-right">Percentage</span>
          <span className="text-right">Pass Rate</span>
        </div>
        {results.map((r, i) => (
          <motion.div
            key={`${r.session}-${r.exam.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.2 }}
            className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_100px_100px] gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 text-xs hover:bg-muted/30 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{r.exam.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {r.exam.type} · {[...new Set(r.exam.classes.map((c) => c.className))].join(', ')}
              </p>
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{r.sessionLabel}</div>
            <div className="flex items-center gap-1 min-w-0">
              <Trophy className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="truncate text-[11px]">{r.topperName}</span>
            </div>
            <div className="text-right font-bold tabular-nums">{r.topperPercentage.toFixed(1)}%</div>
            <div className="text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
              {r.exam.passRate}%
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
