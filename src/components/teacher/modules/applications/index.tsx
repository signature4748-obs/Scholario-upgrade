'use client'

/**
 * ApplicationReviewsModule — the TEACHER side of Applications & Forms (§2E).
 *
 * For teachers assigned as Application / Event In-charge. Shows ONLY the
 * applications where `inChargeTeacherId` (or `inChargeName`) matches the
 * signed-in teacher — never the whole school list.
 *
 * PERMISSION BOUNDARY (strict): participation review only. Money is a
 * read-only chip derived from the canonical fee ledger via
 * deriveSubmissionPayment — no collecting, recording, verifying or editing
 * of payments, charges or application definitions ever appears here.
 *
 * Layout follows the Salary & Payroll benchmark: one toolbar, a small
 * metric strip, then a compact divide-y list. Clicking a row opens the
 * application's review detail (internal state, no routes).
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bus, CalendarDays, ChevronRight, ClipboardList, FlaskConical, Landmark,
  ShieldCheck, Sparkles, Tag, Tent, Trophy, Users, Award, HandHeart,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  useApplicationsStore, ensureApplicationSeedData, effectiveAppStatus,
  combinedSubmissionStatus,
} from '@/lib/store/applications-store'
import type { SchoolApplication, ApplicationCategory } from '@/lib/store/applications-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { useStudentsStore } from '@/lib/store/students-store'
import { useAuth } from '@/lib/store/auth-store'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageTransition } from '@/components/shared/ui'
import { SegmentedTabs } from '@/components/principal/modules/shared/segmented-tabs'
import { DemoModuleNotice } from '@/components/principal/modules/shared/demo-module-notice'
import { AppStatusBadge, ApplicationReviewDetail } from './review-detail'
import { MyFormsView } from './my-forms'

export const CATEGORY_ICON: Record<ApplicationCategory, LucideIcon> = {
  Tour: Bus,
  Trip: Bus,
  Workshop: FlaskConical,
  Competition: Trophy,
  Camp: Tent,
  Event: CalendarDays,
  'Exam Application': ClipboardList,
  'Board Form': Landmark,
  Transport: Sparkles,
  Activity: CalendarDays,
  Certificate: Award,
  Donation: HandHeart,
  Custom: Tag,
}

export function ApplicationReviewsModule() {
  const { user } = useAuth()
  const applications = useApplicationsStore((s) => s.applications)
  const submissions = useApplicationsStore((s) => s.submissions)
  const classes = useStudentsStore((s) => s.classes)
  // Payment chips derive from the canonical fee ledger — subscribing keeps
  // them live when the office records a payment from another screen.
  useFeeStore((s) => s.transactions)

  // Top-level workspace switch — reviews (assigned forms) vs my own forms.
  const [workspace, setWorkspace] = useState<'reviews' | 'my-forms'>('reviews')

  // Hydrate the shared demo data (idempotent — only acts while empty) so a
  // teacher who never opened the Principal panel still sees seeded records.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (!seeded) {
      ensureApplicationSeedData()
      setSeeded(true)
    }
  }, [seeded])

  const [openAppId, setOpenAppId] = useState<string | null>(null)

  // Visibility rule — assigned to ME only (by id, or by name as a fallback).
  const assigned = useMemo(() => {
    const id = user?.teacherId
    const name = user?.name
    if (!id && !name) return []
    return applications.filter(
      (a) => (id && a.inChargeTeacherId === id) || (!!name && a.inChargeName === name),
    )
  }, [applications, user])

  const classNameOf = useMemo(() => {
    const m = new Map(classes.map((c) => [c.id, c.name]))
    return (classId: string) => m.get(classId) ?? classId
  }, [classes])

  // Metric strip values, computed honestly from derived statuses.
  const metrics = useMemo(() => {
    const mySubs = assigned.flatMap((a) => submissions.filter((s) => s.applicationId === a.id))
    const pending = mySubs.filter((s) => {
      const app = assigned.find((a) => a.id === s.applicationId)
      return app ? ['Submitted', 'Under Review', 'Awaiting Payment'].includes(combinedSubmissionStatus(app, s)) : false
    }).length
    const approved = mySubs.filter((s) => s.status === 'Approved').length
    return { forms: assigned.length, submissions: mySubs.length, pending, approved }
  }, [assigned, submissions])

  const openApp = openAppId ? assigned.find((a) => a.id === openAppId) : undefined

  return (
    <PageTransition className="space-y-4">
      {/* Honesty label — applications & forms run client-side demo state
          (localStorage); the principal/student twins carry the same banner. */}
      <DemoModuleNotice moduleName="Applications & Forms" variant="preview" />
      {workspace === 'my-forms' ? (
        <>
          <SegmentedTabs<'reviews' | 'my-forms'>
            value={workspace}
            onValueChange={setWorkspace}
            tabs={[
              { value: 'reviews', label: 'Reviews' },
              { value: 'my-forms', label: 'My Forms & Drafts' },
            ]}
          />
          <MyFormsView />
        </>
      ) : (
      <>
      <SegmentedTabs<'reviews' | 'my-forms'>
        value={workspace}
        onValueChange={setWorkspace}
        tabs={[
          { value: 'reviews', label: 'Reviews' },
          { value: 'my-forms', label: 'My Forms & Drafts' },
        ]}
      />
      {openApp ? (
        <ApplicationReviewDetail app={openApp} onBack={() => setOpenAppId(null)} />
      ) : (
        <>
          {/* Context toolbar — top bar already identifies the module */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              As Application / Event In-charge
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shrink-0">
              <ShieldCheck className="h-3 w-3" />
              Reviewing participation only — money is handled by the school office.
            </span>
          </div>

          {assigned.length === 0 ? (
            /* Honest empty state — no fake data */
            <div className="rounded-xl border border-border bg-card py-14 text-center">
              <ClipboardList className="h-7 w-7 mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm font-semibold text-foreground">No applications assigned to you yet</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                When the Principal assigns you as Application / Event In-charge on a form,
                it will appear here for review.
              </p>
            </div>
          ) : (
            <>
              {/* Metric strip */}
              <div className="grid grid-cols-4 gap-3">
                <MetricTile label="Assigned forms" value={metrics.forms} icon={<ClipboardList className="h-3 w-3" />} />
                <MetricTile label="Submissions" value={metrics.submissions} icon={<Users className="h-3 w-3" />} />
                <MetricTile label="Pending your review" value={metrics.pending} tone="amber" hint="submitted · awaiting payment" icon={<CalendarDays className="h-3 w-3" />} />
                <MetricTile label="Approved" value={metrics.approved} tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} />
              </div>

              {/* Application list */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-muted/30 text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="flex-1">Application</span>
                  <span className="w-24 shrink-0">Deadline</span>
                  <span className="w-24 shrink-0 text-right">Status</span>
                  <span className="w-4 shrink-0" />
                </div>
                <div className="divide-y divide-border">
                  {assigned.map((a, i) => (
                    <ApplicationRow
                      key={a.id}
                      app={a}
                      index={i}
                      submissionCount={submissions.filter((s) => s.applicationId === a.id).length}
                      approvedCount={submissions.filter((s) => s.applicationId === a.id && s.status === 'Approved').length}
                      classLabel={a.targetStudentIds?.length
                        ? `${a.targetStudentIds.length} selected student${a.targetStudentIds.length === 1 ? '' : 's'}`
                        : a.targetClassIds.map(classNameOf).join(', ') || '—'}
                      onOpen={() => setOpenAppId(a.id)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
      </>
      )}
    </PageTransition>
  )
}

// ─── Metric tile ───────────────────────────────────────────────────────

function MetricTile({ label, value, hint, tone, icon }: {
  label: string
  value: number
  hint?: string
  tone?: 'emerald' | 'amber'
  icon?: React.ReactNode
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </p>
      <p className={cn(
        'text-lg font-bold tabular-nums leading-tight mt-0.5',
        tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400',
        !tone && 'text-foreground',
      )}>{value}</p>
      {hint && <p className="text-[9px] text-muted-foreground truncate">{hint}</p>}
    </motion.div>
  )
}

// ─── One application row ───────────────────────────────────────────────

function ApplicationRow({ app, index, submissionCount, approvedCount, classLabel, onOpen }: {
  app: SchoolApplication
  index: number
  submissionCount: number
  approvedCount: number
  classLabel: string
  onOpen: () => void
}) {
  const Icon = CATEGORY_ICON[app.category]
  const status = effectiveAppStatus(app)

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.04, 0.16) }}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/25 transition-colors text-left"
        aria-label={`Review ${app.title}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/20">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-xs font-semibold truncate">{app.title}</p>
            {app.participation === 'Mandatory' && (
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[8px] font-semibold text-muted-foreground">Mandatory</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">
            {app.category} · {classLabel} · deadline {formatDate(app.deadline)} · {approvedCount}/{submissionCount || 0} approved
          </p>
        </div>
        <div className="w-24 shrink-0 hidden sm:block">
          <p className="text-[11px] font-medium tabular-nums">{formatDate(app.deadline)}</p>
          <p className="text-[9px] text-muted-foreground">{submissionCount} submission{submissionCount === 1 ? '' : 's'}</p>
        </div>
        <div className="w-24 shrink-0 hidden sm:flex justify-end">
          <AppStatusBadge status={status} />
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </button>
    </motion.div>
  )
}
