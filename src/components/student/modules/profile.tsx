'use client'

/**
 * ProfileModule — the STUDENT's own profile, SIMPLIFIED.
 *
 * Product principle (final simplification pass): a student needs
 * "Who am I? · How am I doing? · Where are my important records?" —
 * NOT a mirrored copy of the Principal's administrative record.
 *
 * Structure:
 *   1. Identity card (avatar, name, Active, Class · Roll · House,
 *      View School ID) — flat institutional card, no decorative banner
 *   2. ONE academic snapshot — every figure from the canonical stores
 *      (attendance / results / fee ledger — never hardcoded roster
 *      academics fields)
 *   3. Three tabs: Personal · Parents · Records
 *   4. A compact "My Responsibility" strip (only while a Captain/Monitor
 *      position is ACTIVE — permission-driven, never hardcoded)
 *
 * The module renders NO big "My Profile" title — the shell header +
 * sidebar already say where you are (one WHERE-AM-I, never two).
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  User, Phone, Mail, Calendar, Droplet, Crown, GraduationCap,
  Activity, TrendingUp, IndianRupee, IdCard, Award, Bus,
  ChevronRight, ClipboardList, ShieldCheck,
} from 'lucide-react'
import { GlassCard, StatusBadge, GradientAvatar } from '@/components/shared/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStudentsStore, useMyStudentRecord } from '@/lib/store/students-store'
import type { StudentRecord } from '@/lib/store/students-store'
import { useStudentAttendanceStore, computeStats, studentRecords } from '@/lib/store/student-attendance-store'
import { useFeeStore } from '@/lib/store/fee-store'
import { useCertificatesStore } from '@/lib/store/certificates-store'
import { useIsDemoTenant } from '@/lib/store/demo-tenant'
import { POSITION_DEFS, filterActivePositions } from '@/lib/student-positions'
import { useAcademicSession, SESSION_NOT_SET_LABEL } from '@/lib/academic-session'
import { useMyResults, fmtPct } from '@/lib/store/student-results-store'
import { useEnrollmentIdentity, type EnrollmentIdentity } from './shared/enrollment'
import { formatDate } from '@/lib/format'
import { StudentIdCardDialog } from '@/components/student/shell/student-id-card'

const TABS = [
  { key: 'personal', label: 'Personal' },
  { key: 'parents', label: 'Parents' },
  { key: 'records', label: 'Records' },
] as const
type TabKey = (typeof TABS)[number]['key']

export function ProfileModule({ onNavigate }: { onNavigate?: (key: string) => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>('personal')
  const [idOpen, setIdOpen] = useState(false)

  // FINAL-GATE (EG-9F/R4) — apply the demo tenant's sanctioned certificates
  // seed once (module root reads the documents slice); a real tenant keeps
  // the honest "no documents yet" records tab.
  const isDemo = useIsDemoTenant()
  const ensureDemoSeed = useCertificatesStore((s) => s.ensureDemoSeed)
  useEffect(() => { if (isDemo) ensureDemoSeed() }, [isDemo, ensureDemoSeed])

  // ── Canonical identity (session user → roster record — one universe) ──
  const student = useMyStudentRecord()
  const studentId = student?.id
  const allPositions = useStudentsStore((st) => st.studentPositions)

  // STU-RES — the ONE canonical results store (same source as the Results
  // module + dashboard). Overall + rank derive from the LATEST PUBLISHED
  // assessment — never from stale roster academics fields. Rank hides
  // automatically when the school's privacy policy disables it.
  const results = useMyResults()
  const latestResult = results.latest

  // Live fee figures — the ONE fee ledger (same derivation as the Fees
  // module: Success transactions for this student).
  const allTxns = useFeeStore((s) => s.transactions)
  const feePaid = useMemo(
    () => allTxns.filter((t) => t.studentId === studentId && t.status === 'Success')
      .reduce((sum, t) => sum + t.amount, 0),
    [allTxns, studentId],
  )

  // STU-ATT — attendance derives LIVE from the canonical attendance records
  // (the same rows Teacher/Principal write), so a correction anywhere updates
  // the profile snapshot — it can never disagree with the Attendance module.
  // Canonical fallback: when the legacy store has no rows for THIS student
  // (e.g. the DB-synced roster), the roster record's server-derived pct
  // (canonical Attendance derivation) is the honest number — never a fake 0%.
  const allAttendance = useStudentAttendanceStore((s) => s.records)
  const attendancePct = useMemo(() => {
    const mine = studentRecords(allAttendance, studentId ?? '')
    if (mine.length > 0) return computeStats(mine).percent
    return student?.attendance ?? 0
  }, [allAttendance, studentId, student?.attendance])

  // Certificates — the same store My Certificates reads (raw array +
  // useMemo — zustand v5 selectors must return stable refs).
  const allDocs = useCertificatesStore((s) => s.documents)
  const myDocs = useMemo(
    () => allDocs.filter((d) => d.studentId === studentId || d.admissionNo === student?.admissionNo),
    [allDocs, studentId, student?.admissionNo],
  )

  // Positions held by THIS student — only ACTIVE ones in the live session
  // surface (RB-1 canonical resolver; raw array + useMemo keeps zustand v5
  // selectors on stable refs). PHASE 7.5-D — the session id is server-first
  // and nullable; a null session resolves to no positions (honest).
  const { id: sessionId, label: sessionLabel } = useAcademicSession()
  const positions = useMemo(
    () => filterActivePositions(allPositions, studentId ?? '', sessionId),
    [allPositions, studentId, sessionId],
  )

  // SD-3b — server-first identity (session truth): class, roll, admission
  // number and personal particulars come from /api/auth/me; the resolved
  // roster record only fills the gaps, so this profile can never disagree
  // with the sidebar / dashboard / ID card.
  const identity = useEnrollmentIdentity({
    className: student?.className ?? '—',
    section: student?.section ?? '—',
    rollNo: student?.rollNo ?? '—',
    admissionNo: student?.admissionNo ?? '—',
    dob: student?.dob,
    gender: student?.gender,
    bloodGroup: student?.bloodGroup,
    guardianName: student?.guardianName,
    guardianPhone: student?.guardianPhone,
  })

  if (!student) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading profile" />
      </div>
    )
  }

  const s = student
  // Honest fee status: a student with NO billed fees shows “—”, not a
  // fabricated “Paid” (₹0/₹0 ≠ paid).
  const feePending = s.feeTotal > 0 ? Math.max(0, s.feeTotal - feePaid) : 0
  const feeStatus =
    s.feeTotal === 0 ? '—' : feePending === 0 ? 'Paid' : feePaid > 0 ? 'Partial' : 'Pending'

  return (
    <div className="space-y-5 sm:space-y-6 max-w-4xl">
      {/* ── Identity card — flat institutional surface, no banner ────── */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="relative shrink-0 mx-auto sm:mx-0"
          >
            <div className="flex h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xl sm:text-2xl font-extrabold shadow-premium-lg ring-1 ring-emerald-500/25">
              {s.avatar}
            </div>
            <span
              className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white border-[3px] border-background"
              title="Active student"
              aria-label="Active student"
            >
              <ShieldCheck className="h-2.5 w-2.5" />
            </span>
          </motion.div>

          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
              <h2 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight truncate">{s.name}</h2>
              <StatusBadge status="Active" variant="success" dot />
              {positions.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  <Crown className="h-3 w-3" />
                  {POSITION_DEFS[p.key]?.short ?? 'Monitor'}
                </span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              {identity.classLabel} · Roll #{identity.rollNo} · {s.houseName} House
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              Admission No {identity.admissionNo} · {sessionLabel ?? SESSION_NOT_SET_LABEL}
            </p>
          </div>

          <div className="shrink-0 mx-auto sm:mx-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setIdOpen(true)}
            >
              <IdCard className="h-4 w-4" /> View School ID
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* ── Academic snapshot (ONE compact card, canonical data) ───── */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-violet-500" /> Academic Snapshot
          </h3>
          <span className="text-[11px] text-muted-foreground">{sessionLabel ?? SESSION_NOT_SET_LABEL}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-0 sm:divide-x sm:divide-border">
          <SnapshotStat
            label="Attendance"
            value={`${attendancePct}%`}
            icon={<Activity className="h-4 w-4" />}
            color="text-emerald-600 dark:text-emerald-400"
            bg="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
          {latestResult ? (
            <SnapshotStat
              label="Last Exam"
              value={`${fmtPct(latestResult.totals.pct)}% · ${latestResult.grade}`}
              icon={<GraduationCap className="h-4 w-4" />}
              color="text-violet-600 dark:text-violet-400"
              bg="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            />
          ) : s.academics.overallPercent > 0 ? (
            <SnapshotStat
              label="Last Exam"
              value={`${s.academics.overallPercent}% · ${s.academics.overallGrade}`}
              icon={<GraduationCap className="h-4 w-4" />}
              color="text-violet-600 dark:text-violet-400"
              bg="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            />
          ) : (
            <SnapshotStat
              label="Last Exam"
              value="Awaited"
              icon={<GraduationCap className="h-4 w-4" />}
              color="text-muted-foreground"
              bg="bg-muted text-muted-foreground"
            />
          )}
          {latestResult?.rank != null ? (
            <SnapshotStat
              label="Class Rank"
              value={`#${latestResult.rank}`}
              icon={<TrendingUp className="h-4 w-4" />}
              color="text-amber-600 dark:text-amber-400"
              bg="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
          ) : s.academics.rankInClass > 0 ? (
            <SnapshotStat
              label="Class Rank"
              value={`#${s.academics.rankInClass}`}
              icon={<TrendingUp className="h-4 w-4" />}
              color="text-amber-600 dark:text-amber-400"
              bg="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
          ) : (
            <SnapshotStat
              label="Class Rank"
              value="—"
              icon={<TrendingUp className="h-4 w-4" />}
              color="text-muted-foreground"
              bg="bg-muted text-muted-foreground"
            />
          )}
          <SnapshotStat
            label="Fees"
            value={feeStatus}
            icon={<IndianRupee className="h-4 w-4" />}
            color={feeStatus === 'Paid' ? 'text-emerald-600 dark:text-emerald-400' : feeStatus === '—' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}
            bg={feeStatus === 'Paid' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : feeStatus === '—' ? 'bg-muted text-muted-foreground' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}
          />
        </div>
      </GlassCard>

      {/* ── Tabs: Personal · Parents · Records ─────────────────────────── */}
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto pb-2" role="tablist" aria-label="Profile sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                activeTab === tab.key
                  ? 'bg-white dark:bg-white/10 shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {activeTab === 'personal' && <PersonalTab student={s} identity={identity} />}
        {activeTab === 'parents' && <ParentsTab student={s} identity={identity} />}
        {activeTab === 'records' && (
          <RecordsTab
            student={s}
            certCount={myDocs.length}
            onNavigate={onNavigate}
          />
        )}
      </motion.div>

      {/* ── My Responsibility (compact — only while position is ACTIVE) ── */}
      {positions.length > 0 && onNavigate && (
        <GlassCard className="p-4 border-primary/20">
          <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <Crown className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">
                {POSITION_DEFS[positions[0].key]?.title ?? 'Class Monitor'} · {identity.classLabel}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Since {formatDate(positions[0].assignedOn)} · appointed by {positions[0].assignedByName}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => onNavigate('my-class')}
            >
              Open My Class <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </GlassCard>
      )}

      {/* ── School ID — school-configured institutional card (§27–28) ── */}
      <StudentIdCardDialog open={idOpen} onOpenChange={setIdOpen} student={s} enrollment={identity} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Building blocks
// ══════════════════════════════════════════════════════════════════════

function SnapshotStat({ label, value, icon, color, bg }: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <div className="flex items-center gap-2.5 sm:flex-col sm:items-center sm:text-center sm:gap-1 sm:px-2">
      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', bg)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={cn('text-sm font-bold truncate', color)}>{value}</p>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', accent)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold truncate" title={value}>{value}</p>
      </div>
    </div>
  )
}

/** ── Personal: only the genuinely useful personal information ────────── */
function PersonalTab({ student: _s, identity }: { student: StudentRecord; identity: EnrollmentIdentity }) {
  const rows = [
    { label: 'Date of Birth', value: identity.dob ? formatDate(identity.dob) : '—', icon: <Calendar className="h-4 w-4" />, accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    { label: 'Gender', value: identity.gender ?? '—', icon: <User className="h-4 w-4" />, accent: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
    { label: 'Blood Group', value: identity.bloodGroup ?? '—', icon: <Droplet className="h-4 w-4" />, accent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  ]
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {rows.map((r) => (
          <InfoRow key={r.label} icon={r.icon} label={r.label} value={r.value} accent={r.accent} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3.5 flex items-center gap-1.5">
        <ShieldCheck className="h-3 w-3 shrink-0 text-primary" />
        These details are school-managed — ask the school office for corrections.
      </p>
    </GlassCard>
  )
}

/** ── Parents & Guardian: polished, privacy-respecting ────────────────── */
function ParentsTab({ student: s, identity }: { student: StudentRecord; identity: EnrollmentIdentity }) {
  // Server guardian first (session truth); the seed parents fill the rest.
  const guardianName = identity.guardianName ?? s.fatherName
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
          <GradientAvatar name={guardianName} size="lg" gradient="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" />
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Father</p>
            <p className="text-sm font-semibold truncate">{guardianName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
          <GradientAvatar name={s.motherName} size="lg" gradient="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" />
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Mother</p>
            <p className="text-sm font-semibold truncate">{s.motherName}</p>
          </div>
        </div>
        <InfoRow icon={<Phone className="h-4 w-4" />} label="Guardian Phone" value={identity.guardianPhone ?? s.guardianPhone} accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
        <InfoRow icon={<Mail className="h-4 w-4" />} label="Guardian Email" value={s.guardianEmail} accent="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" />
      </div>
      <p className="text-[11px] text-muted-foreground mt-3.5 flex items-center gap-1.5">
        <ShieldCheck className="h-3 w-3 shrink-0 text-primary" />
        Contact details are shared with you as permitted by the school.
      </p>
    </GlassCard>
  )
}

/** ── Records: only rows whose data actually exists; each deep-links ──── */
function RecordsTab({ student: s, certCount, onNavigate }: {
  student: StudentRecord
  certCount: number
  onNavigate?: (key: string) => void
}) {
  const rows: {
    key: string
    icon: React.ReactNode
    iconClass: string
    title: string
    value: string
  }[] = []

  // Latest published result (canonical results store — same source as
  // the Results module; rank only when the school's policy allows it)
  const results = useMyResults()
  const latest = results.latest
  if (latest) {
    rows.push({
      key: 'results',
      icon: <ClipboardList className="h-4 w-4" />,
      iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      title: 'Academic Records',
      value: `${latest.grade} · ${fmtPct(latest.totals.pct)}%${latest.rank != null ? ` · Rank #${latest.rank}` : ''} · ${latest.assessment.name}`,
    })
  }

  // Certificates — only if issued
  if (certCount > 0) {
    rows.push({
      key: 'my-certificates',
      icon: <Award className="h-4 w-4" />,
      iconClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      title: 'Certificates',
      value: `${certCount} issued`,
    })
  }

  // Transport — only if the student actually opted in
  if (s.transportRoute) {
    rows.push({
      key: 'bus',
      icon: <Bus className="h-4 w-4" />,
      iconClass: 'bg-lime-500/10 text-lime-700 dark:text-lime-400',
      title: 'Transport',
      value: s.transportRoute,
    })
  }

  return (
    <GlassCard className="p-2 sm:p-3">
      <div className="divide-y divide-border">
        {rows.map((r, i) => (
          <motion.button
            key={r.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            disabled={!onNavigate}
            onClick={() => onNavigate?.(r.key)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors',
              onNavigate && 'hover:bg-accent/50 cursor-pointer',
            )}
          >
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', r.iconClass)}>
              {r.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-xs text-muted-foreground truncate">{r.value}</p>
            </div>
            {onNavigate && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </motion.button>
        ))}
      </div>
    </GlassCard>
  )
}
