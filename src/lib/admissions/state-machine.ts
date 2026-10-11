import { AppError } from '@/lib/security/errors'

/**
 * state-machine — THE single authoritative admission application
 * lifecycle (FEE-ADMISSIONS MVP, H1-R2 contract).
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → ENROLLED
 *                                        ↘ REJECTED (terminal)
 *
 *   · UNDER_REVIEW → SUBMITTED is allowed ONLY through the documented
 *     request-correction transition (with mandatory review notes).
 *   · After a correction, the office amends and RESUBMITS
 *     (SUBMITTED → UNDER_REVIEW — review restarts).
 *   · REJECTED is terminal: no transition leaves it.
 *   · Decisions (start-review / request-correction / resubmit gating /
 *     approve / reject) and issuance are PRINCIPAL-only.
 *   · ENROLLED requires APPROVED; enrolment is atomic and idempotent.
 *
 * Server records are created at SUBMITTED (the DRAFT stage is the
 * principal's local wizard state — the server never saw a draft it must
 * represent). DRAFT appears in the vocabulary so client states map
 * cleanly onto the server machine.
 */

export type AdmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'ENROLLED'
  | 'REJECTED'

export const ADMISSION_STATUSES: readonly AdmissionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'ENROLLED',
  'REJECTED',
] as const

/** Decision actions (the PRINCIPAL-only endpoint verbs). */
export type AdmissionAction =
  | 'start-review'
  | 'request-correction'
  | 'resubmit'
  | 'approve'
  | 'reject'

/**
 * Legal transitions by action. Anything not listed throws INVALID_STATE
 * (409). REJECTED has no outgoing edges — terminal by construction.
 */
const TRANSITIONS: Record<AdmissionAction, Partial<Record<AdmissionStatus, AdmissionStatus>>> = {
  'start-review': { SUBMITTED: 'UNDER_REVIEW' },
  'request-correction': { UNDER_REVIEW: 'SUBMITTED' },
  resubmit: { SUBMITTED: 'UNDER_REVIEW' },
  approve: { UNDER_REVIEW: 'APPROVED' },
  reject: { SUBMITTED: 'REJECTED', UNDER_REVIEW: 'REJECTED' },
}

/** Map a decision action to its target status; 409 INVALID_STATE when
 * the current status does not admit it (including terminal REJECTED and
 * already-ENROLLED applications). */
export function transition(
  action: AdmissionAction,
  current: AdmissionStatus,
  opts: { label?: string } = {},
): AdmissionStatus {
  const table = TRANSITIONS[action]
  const target = table[current]
  if (!target) {
    throw new AppError('INVALID_STATE', {
      publicMessage:
        current === 'REJECTED'
          ? 'This application was rejected — no further actions are possible.'
          : current === 'ENROLLED'
            ? 'This application is already enrolled.'
            : `The "${action}" action is not allowed while the application is ${current.replace('_', ' ').toLowerCase()}.`,
      internalDetail: `admission transition rejected: action=${action} current=${current}${opts.label ? ` (${opts.label})` : ''}`,
    })
  }
  return target
}

/** Enrolment precondition: only APPROVED may enrol (elsewhere enforced
 * in-transaction; this helper keeps the vocabulary in one place). */
export function assertEnrollable(current: AdmissionStatus): void {
  if (current === 'ENROLLED') return // replay path — handled by caller
  if (current !== 'APPROVED') {
    throw new AppError('INVALID_STATE', {
      publicMessage:
        current === 'REJECTED'
          ? 'A rejected application cannot be enrolled.'
          : 'The application must be approved before enrolment.',
      internalDetail: `assertEnrollable: current=${current}`,
    })
  }
}

/** Is the status value a known server status? (DB CHECK also enforces.) */
export function isAdmissionStatus(value: string): value is AdmissionStatus {
  return (ADMISSION_STATUSES as readonly string[]).includes(value)
}
