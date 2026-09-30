'use client'

/**
 * ExamsModule — Principal-facing Examinations workspace.
 *
 * Architecture: 4 top-level tabs + full-screen workspaces.
 *   • List view: Overview / Exams / Reports / Settings
 *     - Overview/Exams/Reports show a compact session picker (right side)
 *     - Settings shows an Archive button (right side) — Archive is the
 *       historical records entry, conceptually distinct from the active
 *       session switcher on Overview
 *   • Exam Workspace (full-screen, 7 grouped sections)
 *   • Create Examination (full-screen, single-page form)
 *   • Archive (full-screen historical records viewer)
 *
 * Schedule, Marks, Results are NOT top-level tabs — they live INSIDE the
 * Exam Workspace. This removes the previous duplication where the same data
 * appeared in two places (top-level tab + workspace sub-tab).
 *
 * The active session picker drives the Session Top Performers section in
 * Overview and represents the CURRENT academic context.
 *
 * Archive is for HISTORICAL sessions — past academic years, published
 * results, student historical performance.
 *
 * Reads exclusively from /api/exams/* — no localStorage, no mock data.
 * Archive uses mock historical records (src/lib/exams/archive-data.ts).
 */

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { ChevronDown, Archive as ArchiveIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '../shared/segmented-tabs'
import { useExamsList } from '@/lib/exams/use-exams'
import { AVAILABLE_SESSIONS } from '@/lib/exams/session-toppers-data'
import { ExamsOverviewTab } from './tabs/overview-tab'
import { ExamsListTab } from './tabs/exams-list-tab'
import { InvigilationTab } from './tabs/invigilation-tab'
import { SettingsTab } from './tabs/settings-tab'
import type { ClassDTO } from './create-exam-fullscreen'
import { ExamWorkspace } from './exam-workspace'

// Heavy siblings load on demand — Reports pulls the charting stack and the
// Create/Archive views carry large form/document graphs. Keeping them out
// of the module's first paint makes Examinations open noticeably faster.
const ReportsTab = dynamic(() => import('./tabs/reports-tab').then((m) => m.ReportsTab), {
  loading: () => <TabSkeleton />,
})
const ArchiveView = dynamic(() => import('./tabs/archive-view').then((m) => m.ArchiveView), {
  loading: () => <TabSkeleton />,
})
const CreateExamFullScreen = dynamic(() => import('./create-exam-fullscreen').then((m) => m.CreateExamFullScreen), {
  loading: () => <TabSkeleton />,
})

function TabSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
      </div>
    </div>
  )
}

type SectionTab = 'overview' | 'exams' | 'invigilation' | 'reports' | 'settings'
type View = { kind: 'list' } | { kind: 'exam'; examId: string } | { kind: 'create' } | { kind: 'archive' }

const SECTION_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'exams', label: 'Exams' },
  { value: 'invigilation', label: 'Invigilation' },
  { value: 'reports', label: 'Reports' },
  { value: 'settings', label: 'Settings' },
]

/**
 * Convert the server's class payload (GET /api/exams → classes) to the
 * ClassDTO[] shape that CreateExamFullScreen expects.
 *
 * The server rows are canonical DB classes (real ids, live student counts,
 * ClassSubjectAssignment subjects with isCore/examinable/displayOrder).
 * Each row is already an exam-level entry (sections are separate Class
 * rows), so we emit ONE ClassDTO per entry. `section` is set to null —
 * Examination must NOT show sections (Spec §3 / §15).
 */
function toClassDTOs(classes: Array<{ id: string; name: string; gradeLevel: string | null; section: string | null; stream: string | null; studentCount: number; subjects: Array<{ id: string; name: string; code: string | null; fullMarks: number; passMarks: number; isCore?: boolean; examinable?: boolean; displayOrder?: number }> }>): ClassDTO[] {
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    gradeLevel: c.gradeLevel,
    section: null,
    stream: c.stream,
    studentCount: c.studentCount,
    subjects: c.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      fullMarks: s.fullMarks,
      passMarks: s.passMarks,
      isCore: s.isCore ?? true,
      examinable: s.examinable ?? true,
      displayOrder: s.displayOrder ?? 0,
    })),
  }))
}

export function ExamsModule() {
  const [section, setSection] = useState<SectionTab>('overview')
  const [view, setView] = useState<View>({ kind: 'list' })
  // REAL data (iq3000-2b): the examination list comes from the server
  // (GET /api/exams → { exams, classes, academicYear }). The Principal
  // picks REAL examinations here, so the workspace (and its marks
  // workflow) receives canonical DB exam ids. The old useExamsListMock
  // read the in-memory seed store whose ids never existed in the DB.
  const { exams, classes: serverClasses, academicYear, loading, error, reload } = useExamsList()
  // 7-b — the session context follows the SERVER's live academic year
  // (exam rows carry the real session value). The explicit pick wins;
  // until the Principal picks, the current academic year is the default.
  const [sessionPick, setSessionPick] = useState<string | null>(null)
  const session = sessionPick ?? academicYear ?? '2025-2026'

  // Classes + subjects for Create Exam come from the SAME server payload
  // (canonical DB classes with their ClassSubjectAssignment subjects) —
  // shaped into the ClassDTO[] the Create Exam form expects. Real ids flow
  // through, so the created examination references real DB classes.
  const classes = useMemo(() => toClassDTOs(serverClasses), [serverClasses])

  // Full-screen views take over the entire content area
  if (view.kind === 'exam') {
    return (
      <ExamWorkspace
        examId={view.examId}
        onBack={() => setView({ kind: 'list' })}
        onMutated={reload}
      />
    )
  }
  if (view.kind === 'create') {
    return (
      <CreateExamFullScreen
        classes={classes}
        academicYear={academicYear}
        onBack={() => setView({ kind: 'list' })}
        onCreated={(exam) => {
          reload()
          setView({ kind: 'exam', examId: exam.id })
        }}
      />
    )
  }
  if (view.kind === 'archive') {
    return <ArchiveView onBack={() => setView({ kind: 'list' })} />
  }

  // List view — the standard Examinations landing
  // Session picker is shown ONLY on Overview (it drives the session context
  // for the Overview dashboard). Settings shows the Archive button instead.
  // Exams and Reports inherit the session context without showing a picker.
  const showSessionPicker = section === 'overview'
  const showArchiveButton = false // Removed — Archive is in the Settings sidebar only

  return (
    <PageTransition className="space-y-4">
      {/* Tab row + right-side control (session picker on Overview, archive button on Settings) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SegmentedTabs
          tabs={SECTION_TABS}
          value={section}
          onValueChange={(v) => setSection(v as SectionTab)}
        />
        {showSessionPicker && <SessionPicker value={session} onChange={setSessionPick} />}
        {showArchiveButton && <ArchiveButton onClick={() => setView({ kind: 'archive' })} />}
      </div>

      <AnimatePresence mode="wait">
        {section === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <ExamsOverviewTab
              exams={exams}
              classes={classes}
              loading={loading}
              error={error}
              session={session}
              onSelectExam={(id) => setView({ kind: 'exam', examId: id })}
              onGoToExams={() => setSection('exams')}
              onNavigate={(s) => setSection(s as SectionTab)}
            />
          </motion.div>
        )}
        {section === 'exams' && (
          <motion.div
            key="exams"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <ExamsListTab
              exams={exams}
              loading={loading}
              error={error}
              onOpenExam={(id) => setView({ kind: 'exam', examId: id })}
              onReload={reload}
              onCreate={() => setView({ kind: 'create' })}
            />
          </motion.div>
        )}
        {section === 'invigilation' && (
          <motion.div
            key="invigilation"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <InvigilationTab />
          </motion.div>
        )}
        {section === 'reports' && (
          <motion.div
            key="reports"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <ReportsTab exams={exams} />
          </motion.div>
        )}
        {section === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <SettingsTab onOpenArchive={() => setView({ kind: 'archive' })} />
          </motion.div>
        )}
      </AnimatePresence>
    </PageTransition>
  )
}

// ─── Compact Session Picker ──────────────────────────────────────────
//
// Sits on the same row as the Overview/Exams/Reports/Settings tabs,
// on the right side. Small, subtle, professional — feels like a small
// control rather than a form field.
// NOT shown on Settings — Settings has the Archive button instead.

function SessionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 7-b — options: the live academic year (server) + the historical
  // sessions, deduped and newest-first. Every option is a REAL session
  // value the exams' rows can carry.
  const options = useMemo(() => {
    const seen = new Set<string>()
    const rows: Array<{ value: string; label: string }> = []
    const push = (v: string | null | undefined) => {
      if (!v || seen.has(v)) return
      seen.add(v)
      // "2026-2027" → "2026–27"
      const label = v.includes('-') ? `${v.slice(0, 4)}–${v.slice(-2)}` : v
      rows.push({ value: v, label })
    }
    push(value)
    for (const s of AVAILABLE_SESSIONS) push(s.value)
    return rows
  }, [value])
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Academic session"
        className="appearance-none h-9 pl-3 pr-8 text-xs font-medium rounded-full bg-muted/60 hover:bg-muted text-foreground border border-transparent hover:border-border/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground"
        aria-hidden
      />
    </div>
  )
}

// ─── Archive Button (shown on Settings tab right side) ───────────────
//
// Archive is the historical records entry — past academic sessions,
// published examination results, student historical performance.
// Conceptually distinct from the active session picker.

function ArchiveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-full bg-muted/60 hover:bg-muted text-foreground border border-transparent hover:border-border/60 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      <ArchiveIcon className="h-3.5 w-3.5" />
      <span>Archive</span>
    </button>
  )
}


