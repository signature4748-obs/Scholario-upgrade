/**
 * PHASE 8B (Task 8B-7-d) — Direct-messaging server helpers.
 *
 * Shared logic for the /api/messaging/* routes: the recipient-policy
 * matrix (defense in depth ON TOP of the tenant scoping every route
 * already enforces) and the fail-safe counterpart lookup.
 *
 * Everything here writes/reads the SAME Message + DirectThreadState rows
 * the teacher Communication Hub uses (src/app/api/teacher/communication/**)
 * — a thread created by a student through /api/messaging is a Message row
 * the teacher hub's direct-conversation pane sees, and vice versa.
 */
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { assertTenantRow, type Authz } from '@/lib/security/authz'

/**
 * Message.subject is required in the schema. The /api/messaging surface
 * has no client-supplied subject (the conversation IS the subject), so a
 * constant derived subject is stored — the same convention a direct
 * thread carries on the teacher side.
 */
export const DIRECT_MESSAGE_SUBJECT = 'Direct message'

/** Body length bounds for a direct message (mirrors the teacher route). */
export const DIRECT_MESSAGE_MIN = 1
export const DIRECT_MESSAGE_MAX = 4000

/**
 * Recipient policy — WHO may message WHOM (server-side, role-from-DB).
 * This is defense in depth: the primary authorization (same school,
 * ACTIVE account) is already enforced by the counterpart lookup below.
 *
 *   STUDENT  → staff only (TEACHER / PRINCIPAL / MANAGEMENT)
 *   PARENT   → staff only (TEACHER / PRINCIPAL / MANAGEMENT)
 *   staff    (TEACHER / PRINCIPAL / MANAGEMENT) → students + staff + parents
 *
 * Roles NOT in the matrix (COORDINATOR, ACCOUNTANT, DRIVER, …) fail
 * CLOSED — a future role must be explicitly granted here to send.
 */
const RECIPIENT_ROLES_BY_SENDER: Record<string, readonly string[]> = {
  STUDENT: ['TEACHER', 'PRINCIPAL', 'MANAGEMENT'],
  PARENT: ['TEACHER', 'PRINCIPAL', 'MANAGEMENT'],
  TEACHER: ['STUDENT', 'TEACHER', 'PRINCIPAL', 'MANAGEMENT', 'PARENT'],
  PRINCIPAL: ['STUDENT', 'TEACHER', 'PRINCIPAL', 'MANAGEMENT', 'PARENT'],
  MANAGEMENT: ['STUDENT', 'TEACHER', 'PRINCIPAL', 'MANAGEMENT', 'PARENT'],
}

/** Throws FORBIDDEN unless senderRole may message recipientRole. */
export function assertCanSendTo(senderRole: string, recipientRole: string): void {
  const allowed = RECIPIENT_ROLES_BY_SENDER[senderRole]
  if (!allowed) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'Your account cannot send direct messages',
      internalDetail: `messaging: sender role ${senderRole} not in the direct-messaging policy`,
    })
  }
  if (!allowed.includes(recipientRole)) {
    throw new AppError('FORBIDDEN', {
      publicMessage: 'You cannot message this recipient',
      internalDetail: `messaging: policy rejects ${senderRole} → ${recipientRole}`,
    })
  }
}

export interface DirectCounterpart {
  id: string
  name: string
  role: string
  avatarUrl: string | null
  status: string
}

/**
 * Fetch a thread counterpart by id under the fail-safe rules:
 * unknown id, cross-tenant id or a non-ACTIVE account all "do not
 * exist" (404, no existence oracle). A row in a FOREIGN tenant is also
 * signalled internally (TENANT_MISMATCH audit) by assertTenantRow.
 */
export async function fetchDirectCounterpart(
  ctx: Authz,
  userId: string,
): Promise<DirectCounterpart> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, avatarUrl: true, status: true, schoolId: true },
  })
  if (!row) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Recipient not found',
      internalDetail: `messaging: counterpart ${userId} missing`,
    })
  }
  // Cross-school ids resolve as "not found" — never 403-with-distinction.
  assertTenantRow(row, ctx, 'Recipient')
  if (row.status !== 'ACTIVE') {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Recipient not found',
      internalDetail: `messaging: counterpart ${userId} status ${row.status}`,
    })
  }
  return {
    id: row.id,
    name: row.name ?? 'User',
    role: row.role,
    avatarUrl: row.avatarUrl,
    status: row.status,
  }
}
