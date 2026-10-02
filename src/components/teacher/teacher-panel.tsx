'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { lazyModule } from '@/components/shared/lazy-module'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { useTeacherHubStore } from '@/lib/store/teacher-hub-store'
import { useCurrentUser } from '@/lib/store/current-user-store'
import { useTeacherRole } from './teacher-panel/use-teacher-role'
import {
  buildTeacherNavGroups,
  getPendingAssignments,
} from './teacher-panel/nav-registry'
import { AccountLockedBanner } from './teacher-panel/banners/account-locked-banner'
import { PendingAssignmentsBanner } from './teacher-panel/banners/pending-assignments-banner'
import { SalaryConfirmationsBanner } from './teacher-panel/banners/salary-confirmations-banner'
import { RelievedViews } from './teacher-panel/relieved-views'
import { ModuleRouter } from './teacher-panel/module-router'
import {
  DeclineDialog,
  ClarifyDialog,
} from './teacher-panel/dialogs/position-dialogs'
import { useTeacherHandlers } from './teacher-panel/use-teacher-handlers'

// Lazily-loaded chunk — compiles only when the payroll tab is opened.
// Chunk-resilient: import retry + per-module error boundary (§22).
const MySalaryModule = lazyModule(
  () => import('./modules/my-salary'),
  'MySalaryModule',
)

/** Honest empty state for store-driven staff surfaces when the signed-in
 *  teacher has no published staffing record (no fabricated profile). */
function QuietNoRecord({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

/** Module keys the ModuleRouter knows — validates ?module= deep-links.
 *  ('analytics' is intentionally ABSENT: the former Performance Analytics
 *  module was merged into Student Growth. Old links are redirected there
 *  as a compatibility route — see normalizeModuleKey.) */
const TEACHER_MODULE_KEYS = [
  'dashboard', 'payroll', 'my-attendance', 'my-timetable', 'attendance',
  'lesson-planner', 'marks', 'students', 'app-reviews', 'growth',
  'class-hub', 'fee-collection', 'settings', 'communication', 'profile',
  'fee-management',
] as const

/** Compatibility redirect: the retired 'analytics' module → Student Growth
 *  (the unified growth + performance experience). No dead route, no
 *  duplicate menu item. */
function normalizeModuleKey(key: string): string {
  return key === 'analytics' ? 'growth' : key
}

/** Per-tab module memory (sessionStorage). The FIRST visit to a lazily-
 *  compiled module (webpack lazyCompilation) triggers a Fast-Refresh FULL
 *  remount of the panel — without a memory, `useState` re-runs its
 *  initializer and the teacher is silently reset to the dashboard ("I
 *  clicked My Class and it bounced me back"). sessionStorage (not
 *  localStorage): each tab remembers only itself and dies with it; an
 *  explicit ?module= deep-link always wins over the memory. */
const MODULE_MEMORY_KEY = 'scholario-teacher-module'

/** Relieved staff see ONLY the restricted set (Profile / Payroll / Fee
 *  collections). The same filter that builds their sidebar also validates
 *  deep-links and the module memory — a relieved teacher can no longer
 *  hand-craft `?module=marks` past the restricted banner. Server APIs
 *  re-check authorization on every call regardless; this is the UI half
 *  of the promise the banner makes. */
const RELIEVED_MODULE_KEYS: readonly string[] = ['profile', 'payroll', 'fee-management']

function allowedModuleKey(key: string, isRelieved: boolean): string | null {
  const normalized = normalizeModuleKey(key)
  if (!(TEACHER_MODULE_KEYS as readonly string[]).includes(normalized)) return null
  if (isRelieved && !RELIEVED_MODULE_KEYS.includes(normalized)) return null
  return normalized
}

function initialActiveModule(isRelieved: boolean): string {
  const fallback = isRelieved ? 'profile' : 'dashboard'
  if (typeof window === 'undefined') return fallback
  // ?module=<key> deep-link — opens a specific module directly (bookmarks,
  // shared links). Unknown keys fall through to the memory/fallback.
  const requested = new URLSearchParams(window.location.search).get('module')
  if (requested) {
    const allowed = allowedModuleKey(requested, isRelieved)
    if (allowed) return allowed
  }
  try {
    const remembered = window.sessionStorage.getItem(MODULE_MEMORY_KEY)
    if (remembered) {
      const allowed = allowedModuleKey(remembered, isRelieved)
      if (allowed) return allowed
    }
  } catch {
    /* storage disabled (Safari private mode) — honest fallback */
  }
  return fallback
}

export function TeacherPanel() {
  const { teachers } = useTeachersStore()
  // Live server-derived Teacher Hub counts (published by the Communication Hub
  // module after each load) — drives the sidebar badge. One store, one truth.
  const hubUnread = useTeacherHubStore((s) => s.parentUnread)

  // The signed-in teacher's OWN record in the staffing store — matched by
  // the SERVER session email (never a hardcoded demo row: every store-
  // driven banner below belongs to this teacher alone; an unmatched
  // session shows none of them instead of another teacher's data).
  const me = useCurrentUser((st) => st.me)
  const currentTeacher = me?.email
    ? teachers.find((t) => (t.email ?? '').toLowerCase() === me.email.toLowerCase()) ?? null
    : null
  const isRelieved = currentTeacher != null && currentTeacher.status === 'Relieved'
  const [active, setActive] = useState(() => initialActiveModule(isRelieved))

  // 'analytics' (retired) can still arrive through a stale effect or an
  // unnormalized setActive call — normalize on every render cycle.
  useEffect(() => {
    if (active === 'analytics') setActive('growth')
  }, [active])

  // The retired 'analytics' deep-link is redirected to Student Growth —
  // strip the stale query param once on mount so a lazy-compile FULL
  // remount (first visit to any lazily-compiled module) doesn't bounce
  // the teacher back to Growth: without this, the ?module= param would
  // keep winning over the per-tab module memory. The param is consumed
  // on first mount for ALL keys — after that the per-tab memory owns
  // restore duty, so later in-app navigation is never shadowed by a
  // stale deep-link on the next recovery reload.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.has('module')) {
      url.searchParams.delete('module')
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

  // Remember the open module for this tab (see initialActiveModule) — a
  // lazy-compile full remount then re-opens exactly where the teacher was.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(MODULE_MEMORY_KEY, active)
    } catch {
      /* storage disabled — nothing to remember */
    }
  }, [active])

  // REAL appointment context (server truth) — gates the Class Teacher Hub.
  const role = useTeacherRole()
  const classTeacherOf = role?.classTeacherOf ?? []

  // §34 automatic role synchronization: if the Principal REMOVES the class
  // teacher appointment while a Hub module is open (or a stale deep-link
  // lands a non-appointee here), the module disappears too — back to the
  // honest dashboard landing instead of stale class data. Server APIs
  // re-check authorization on every call regardless.
  // (the persisted module memory updates too, so the bounce sticks)
  useEffect(() => {
    if (role && !role.isClassTeacher && (active === 'class-hub' || active === 'fee-collection')) {
      setActive('dashboard')
    }
  }, [role, active])

  // Relieved staff: only the restricted set is ever reachable. A stale
  // memory or hand-crafted deep-link outside the set lands on the honest
  // profile landing (their dashboard equivalent), never inside a full
  // module the restricted banner promised they cannot open.
  useEffect(() => {
    if (isRelieved && !RELIEVED_MODULE_KEYS.includes(active)) {
      setActive('profile')
    }
  }, [isRelieved, active])

  // Check pending position assignments for approval workflow
  const pendingAssignments = getPendingAssignments(currentTeacher ?? undefined, isRelieved)

  const navGroups = buildTeacherNavGroups({ isRelieved, classTeacherOf, hubUnread })

  const {
    dialogs,
    handleAcceptAssignment,
    handleOpenDecline,
    handleConfirmDecline,
    handleOpenClarification,
    handleConfirmClarification,
  } = useTeacherHandlers(currentTeacher ?? undefined)

  return (
    <AppShell
      groups={navGroups}
      activeKey={active}
      onNavigate={setActive}
      role="teacher"
      roleLabel={`Teacher · ${currentTeacher?.name || 'Faculty Member'}`}
    >
      <AccountLockedBanner show={!!currentTeacher?.isLocked} />

      <PendingAssignmentsBanner
        assignments={pendingAssignments}
        onAccept={handleAcceptAssignment}
        onDecline={handleOpenDecline}
        onClarify={handleOpenClarification}
      />

      <SalaryConfirmationsBanner
        onReview={() => setActive('payroll')}
      />

      {/* PHASE 8B — My Salary reads the teacher's OWN canonical server rows
          (GET /api/salary resolves the session's Teacher record), so the
          module renders even before the staffing roster syncs and shows its
          honest empty states. */}
      {active === 'payroll' && <MySalaryModule />}

      {/* Relieved staff views (profile / fee-management) */}
      {(active === 'profile' || active === 'fee-management') &&
        (currentTeacher ? (
          <RelievedViews active={active} currentTeacher={currentTeacher} isRelieved={isRelieved} />
        ) : (
          <QuietNoRecord label="Your staff profile has not been published by the office yet." />
        ))}

      {/* Module Content */}
      {active !== 'profile' && active !== 'payroll' && active !== 'fee-management' && (
        <ModuleRouter active={active} onNavigate={setActive} />
      )}

      <DeclineDialog
        open={dialogs.declineDialogOpen}
        onOpenChange={dialogs.setDeclineDialogOpen}
        reason={dialogs.declineReason}
        setReason={dialogs.setDeclineReason}
        onConfirm={handleConfirmDecline}
      />

      <ClarifyDialog
        open={dialogs.clarifyDialogOpen}
        onOpenChange={dialogs.setClarifyDialogOpen}
        query={dialogs.clarifyQuery}
        setQuery={dialogs.setClarifyQuery}
        onConfirm={handleConfirmClarification}
      />
    </AppShell>
  )
}
