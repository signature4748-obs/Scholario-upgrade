/**
 * PRINCIPAL INVITE — founding-principal credential delivery (Phase 3:
 * school provisioning completion).
 *
 * THE CONTRACT (extends docs/SCHOOL_FACTORY.md §5–6):
 *   · The provision POST (and the credential re-issue route) deliver the
 *     one-time bootstrap credential through BOTH honest channels:
 *       1. the one-time `tempPassword` field in the API response (the
 *          authoritative single display — unchanged), and
 *       2. a best-effort `principal-invite` email to the principal's
 *          address through the shared sendEmail pipeline.
 *   · The email carries the one-time password ONLY when it was
 *     SERVER-GENERATED (same convention as the response field: a
 *     caller-supplied password is never emailed).
 *   · Delivery is BEST-EFFORT and NEVER blocks provisioning: sendEmail
 *     returns its outcome as a value (it never throws), and a failed
 *     delivery surfaces as `state: 'FAILED'` on the school's dossier
 *     (provisioning state REQUIRES_ATTENTION) with the re-issue route
 *     as the recovery path. A school is never silently broken by an
 *     email outage — and never reported READY on the strength of an
 *     email that did not go out.
 *   · Idempotency: the provision invite uses the logical dedupe key
 *     `principal-invite:<principal user id>` (a SENT/QUEUED row is
 *     never re-sent); each credential RE-ISSUE is a new logical email
 *     and carries its own unique key.
 *   · PII: the EmailDelivery row stores recipient + template + status
 *     only. The password never reaches a log line, an audit row, or a
 *     column.
 */

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { schoolLoginUrl } from '@/lib/plane'

/** Logical dedupe key namespace for the provision-time invite. */
export function provisionInviteKey(principalUserId: string): string {
  return `principal-invite:${principalUserId}`
}

/** Unique dedupe key for one credential re-issue (never deduped against the original). */
export function reissueInviteKey(principalUserId: string, at: Date): string {
  return `principal-invite:${principalUserId}:reissue:${at.getTime()}`
}

export interface SendPrincipalInviteInput {
  /** The new tenant's identity (rendered into the email). */
  school: { id: string; name: string; slug: string; status: string }
  principal: { id: string; email: string; name: string | null }
  /**
   * The one-time bootstrap password to include. Pass ONLY when it was
   * generated server-side (the route's `generated` flag) — a
   * caller-supplied password is never emailed.
   */
  tempPassword?: string
  /** Dedupe key (provision vs re-issue — see helpers above). */
  dedupeKey: string
  /** Correlation id (the request id at the call site). */
  requestId?: string
}

export interface InviteDeliveryState {
  state: 'SENT' | 'QUEUED' | 'FAILED' | 'PENDING' | 'NONE'
  transport?: string
  /** Machine-parseable error class tag from lastError (redacted: no credentials). */
  errorClass?: string
  at?: string
}

/**
 * Send (or dedupe-skip) the founding-principal invite email. NEVER
 * throws — the sendEmail contract guarantees a value; this wrapper
 * only maps it to the route-facing state shape.
 */
export async function sendPrincipalInvite(
  input: SendPrincipalInviteInput,
): Promise<InviteDeliveryState> {
  const result = await sendEmail(
    {
      to: input.principal.email,
      template: 'principal-invite',
      props: {
        principalName: input.principal.name ?? input.principal.email,
        schoolName: input.school.name,
        loginUrl: schoolLoginUrl(input.school.slug),
        ...(input.tempPassword ? { tempPassword: input.tempPassword } : {}),
        pendingActivation: input.school.status === 'PENDING',
      },
      schoolId: input.school.id,
      dedupeKey: input.dedupeKey,
      requestId: input.requestId,
    },
    // Bound the worst-case resend retry envelope for the synchronous
    // provision call (same convention as the admissions route).
    { maxAttempts: 2 },
  )
  // Map the pipeline's outcome onto the state surface:
  //   sent    → SENT (dev-log transport or webhook-confirmed)
  //   queued  → QUEUED (provider accepted, delivery unconfirmed)
  //   skipped → SENT (the dedupe short-circuit only fires when a SENT
  //             or QUEUED row already exists for this key — the invite
  //             is already on record)
  //   failed  → FAILED (the recipient definitely did not get it)
  const mapped: InviteDeliveryState['state'] =
    result.status === 'sent' || result.status === 'skipped'
      ? 'SENT'
      : result.status === 'queued'
        ? 'QUEUED'
        : 'FAILED'
  return {
    state: mapped,
    transport: result.transport,
    at: new Date().toISOString(),
  }
}

/**
 * Map an EmailDelivery row status onto the invite state surface
 * (bounces/complaints are delivery failures; unknown → NONE).
 */
export function inviteStateFromRowStatus(status: string): InviteDeliveryState['state'] {
  if (status === 'SENT' || status === 'QUEUED' || status === 'PENDING') {
    return status as InviteDeliveryState['state']
  }
  if (status === 'FAILED' || status === 'BOUNCED' || status === 'COMPLAINED') return 'FAILED'
  return 'NONE'
}

/**
 * Read the invite delivery state for a founding principal (read-only,
 * for the dossier/ledger surfaces). A missing row (school provisioned
 * before this feature, or the send pipeline never ran) is reported as
 * NONE — honestly "no invitation on record", never a fabricated OK.
 * The row lookup is by dedupeKey prefix; re-issue keys are newer, so
 * the LATEST row wins (updatedAt desc).
 */
export async function principalInviteDeliveryState(
  principalUserId: string,
): Promise<InviteDeliveryState> {
  const rows = await db.emailDelivery.findMany({
    where: { dedupeKey: { startsWith: `principal-invite:${principalUserId}` } },
    orderBy: { updatedAt: 'desc' },
    take: 1,
    select: { status: true, lastError: true, updatedAt: true },
  })
  const row = rows[0]
  if (!row) return { state: 'NONE' }
  const state = inviteStateFromRowStatus(row.status)
  // The [error-class] tag prefix (provider-errors.ts) — redacted by
  // construction: the pipeline never writes credentials into lastError.
  const errorClass = row.lastError?.match(/^\[([a-z-]+)\]/)?.[1]
  return { state, errorClass, at: row.updatedAt.toISOString() }
}

/**
 * Provisioning state for a school — the honest lifecycle vocabulary
 * (adapts the School.status + setup-readiness + invite-delivery facts
 * into the operator-facing state the mission's PENDING / READY /
 * REQUIRES_ATTENTION model asks for; no new schema statuses):
 *
 *   PENDING_ACTIVATION — provisioned (status PENDING); sign-in blocked
 *                        until the audited activate action.
 *   REQUIRES_ATTENTION — ACTIVE but the principal's invite delivery
 *                        FAILED while the bootstrap credential is still
 *                        pending (the principal may be locked out of
 *                        their delivery channel) — recover via re-issue.
 *   READY               — ACTIVE and every required setup section done.
 *   NEEDS_SETUP         — ACTIVE but required onboarding incomplete
 *                        (honest: usable, still being configured).
 *   SUSPENDED           — locked out (locked-shell entitlement).
 */
export type ProvisioningState =
  | 'PENDING_ACTIVATION'
  | 'REQUIRES_ATTENTION'
  | 'READY'
  | 'NEEDS_SETUP'
  | 'SUSPENDED'

export interface ProvisioningStateInput {
  status: string
  setupUsable: boolean
  inviteState: InviteDeliveryState['state']
  credentialBootstrapPending: boolean
}

export function deriveProvisioningState(input: ProvisioningStateInput): ProvisioningState {
  if (input.status === 'SUSPENDED') return 'SUSPENDED'
  if (input.status === 'PENDING') return 'PENDING_ACTIVATION'
  // ACTIVE / TRIAL:
  if (
    (input.inviteState === 'FAILED' || input.inviteState === 'NONE') &&
    input.credentialBootstrapPending
  ) {
    // Invite never went out / failed while the bootstrap credential has
    // not been replaced: the principal may not know their credential.
    // ('NONE' counts: before this feature existed every school was in
    // this shape — honest, not alarming; the operator confirms delivery
    // or re-issues.)
    return 'REQUIRES_ATTENTION'
  }
  return input.setupUsable ? 'READY' : 'NEEDS_SETUP'
}
