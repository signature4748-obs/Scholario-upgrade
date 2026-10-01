'use client'

/**
 * Student-side helpers for the Applications & Forms module.
 *
 * IDENTITY MODEL (canonical server identity — since the roster sync):
 *   The signed-in student is resolved through useMyStudentRecord() /
 *   resolveMyStudentRecord() (session user id → email; NO fabricated
 *   fallback since PIH-4c — a student without a server roster record
 *   resolves to undefined and the surfaces render honest-empty).
 *   Submissions and payments carry the resolved record's id —
 *   the fee store validates canonical ids, and payment derivation joins
 *   on `studentId`.
 */

import { useMemo } from 'react'
import {
  useMyStudentRecord,
  resolveMyStudentRecord,
  type StudentRecord,
} from '@/lib/store/students-store'
import { useAuth } from '@/lib/store/auth-store'
import {
  useApplicationsStore,
  type ApplicationAuditEvent,
  type CombinedSubmissionStatus,
  type StudentSubmissionIdentity,
} from '@/lib/store/applications-store'

/**
 * LEGACY demo student id (pre-sync seed record). Kept ONLY for
 * out-of-scope legacy consumers (the principal ID-card preview picks a
 * preview student by this id) — student-side code resolves the session
 * identity through useMyStudentRecord() instead.
 */
export const DEMO_STUDENT_ID = 'STU-58'

/** Canonical identity for the signed-in student. */
export interface StudentIdentityPair {
  /** Canonical record — display, submissions, payments and eligibility. */
  canonical: StudentRecord
}

/** Reactive hook resolving the canonical identity (session user → roster). */
export function useDemoStudent(): StudentIdentityPair | null {
  const canonical = useMyStudentRecord()
  return useMemo(
    () => (canonical && canonical.status === 'Active' ? { canonical } : null),
    [canonical],
  )
}

/** Resolve the canonical identity for the signed-in student (non-reactive). */
export function resolveCanonicalStudent(students: StudentRecord[]): StudentRecord | undefined {
  const session = useAuth.getState().user
  const canonical = resolveMyStudentRecord(students, session?.id, session?.email)
  return canonical && canonical.status === 'Active' ? canonical : undefined
}

/**
 * Snapshot bundle the store expects on every submission. Carries the school
 * record particulars the official tour application prints — there is
 * deliberately NO house field (Scholario does not use a house system).
 */
export function buildSubmissionIdentity(canonical: StudentRecord): StudentSubmissionIdentity {
  return {
    id: canonical.id,
    name: canonical.name,
    admissionNo: canonical.admissionNo,
    className: canonical.className,
    classId: canonical.classId,
    section: canonical.section,
    rollNo: canonical.rollNo,
    dob: canonical.dob,
    gender: canonical.gender,
    bloodGroup: canonical.bloodGroup,
    address: canonical.address,
    guardianName: canonical.guardianName,
    guardianPhone: canonical.guardianPhone,
  }
}

/**
 * Append an audit event to the applications store.
 *
 * NOTE: the store contract documents an `addAuditEvent` action, but the
 * current applications-store build does not export one. This helper writes
 * the exact same `ApplicationAuditEvent` shape through the store's public
 * `setState` — same prepend order as the store's internal `pushAudit` —
 * without touching the store file. If the action lands upstream, swap the
 * body to `useApplicationsStore.getState().addAuditEvent(ev)`.
 */
export function addAuditEvent(ev: Omit<ApplicationAuditEvent, 'id'>): void {
  useApplicationsStore.setState((state) => ({
    audit: [
      {
        ...ev,
        id: `AEV-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      },
      ...state.audit,
    ],
  }))
}

/** Whole days until a yyyy-mm-dd deadline (negative once passed). */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const target = new Date(`${dateStr}T23:59:59`)
  if (Number.isNaN(target.getTime())) return Number.NaN
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000)
}

/** Quiet chip tint per combined submission status. */
export function submissionStatusChipClass(status: CombinedSubmissionStatus): string {
  switch (status) {
    case 'Approved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
    case 'Paid · Under Review':
    case 'Under Review':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400'
    case 'Awaiting Payment':
    case 'Awaiting Verification':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
    case 'Correction Required':
    case 'Rejected':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400'
    case 'Physical Doc Pending':
    case 'Physical Doc Verification':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400'
    case 'Withdrawn':
      return 'border-border bg-muted/50 text-muted-foreground'
    default:
      return 'border-border bg-muted/40 text-foreground'
  }
}
