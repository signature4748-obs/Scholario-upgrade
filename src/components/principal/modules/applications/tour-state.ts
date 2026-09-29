'use client'

/**
 * Tour submission state helpers (TOUR-1 §8).
 *
 * The parent-facing states, in the school's language:
 *   Submitted — Unpaid · Submitted — Payment Pending · Submitted — Paid ·
 *   Verified / Received (+ the honest edge states: correction, rejection,
 *   withdrawn). UNPAID NEVER MEANS REJECTED — an unpaid submission stays
 *   visible to staff forever until paid or withdrawn.
 */

import {
  deriveSubmissionPayment,
  type SchoolApplication, type ApplicationSubmission,
} from '@/lib/store/applications-store'

export type TourSubmissionState =
  | 'Submitted — Unpaid' | 'Submitted — Payment Pending' | 'Submitted — Paid'
  | 'Verified / Received' | 'Correction Required' | 'Rejected' | 'Withdrawn'
  | 'Not Applicable'

export function tourSubmissionState(app: SchoolApplication, sub: ApplicationSubmission): TourSubmissionState {
  if (sub.status === 'Withdrawn') return 'Withdrawn'
  if (sub.status === 'Rejected') return 'Rejected'
  if (sub.status === 'Correction Required') return 'Correction Required'
  if (app.payment.mode === 'None') return sub.status === 'Approved' ? 'Verified / Received' : 'Not Applicable'
  const pay = deriveSubmissionPayment(app, sub)
  if (pay.status === 'Paid') return sub.status === 'Approved' ? 'Verified / Received' : 'Submitted — Paid'
  if (pay.status === 'Awaiting Verification') return 'Submitted — Payment Pending'
  return 'Submitted — Unpaid'
}

/** Semantic chip classes for the state (same vocabulary as Finance badges). */
export function tourStateChipClass(state: TourSubmissionState): string {
  switch (state) {
    case 'Verified / Received':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
    case 'Submitted — Paid':
      return 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400'
    case 'Submitted — Payment Pending':
    case 'Submitted — Unpaid':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
    case 'Correction Required':
      return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-400'
    case 'Rejected':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400'
    default:
      return 'border-border bg-muted/60 text-muted-foreground'
  }
}

/** Payment-side chip (for the payments tab + student rows). */
export function paymentChipClass(status: string): string {
  if (status === 'Paid') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
  if (status === 'Awaiting Verification') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
  return 'border-border bg-muted/60 text-muted-foreground'
}

/** Short label + tint for a submission's gender group (attendance lists). */
export function genderLabel(gender?: string): string {
  const g = (gender ?? '').toLowerCase()
  if (g.startsWith('m') || g.startsWith('b')) return 'Male'
  if (g.startsWith('f') || g.startsWith('g')) return 'Female'
  return '—'
}
