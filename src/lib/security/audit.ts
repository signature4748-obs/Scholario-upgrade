/**
 * Central security audit trail (Phase 1 — item 8).
 *
 * Phase-0 baseline H-2/B-12: ActivityLog existed as a school-scoped domain
 * journal, but security-relevant events (login, logout, platform actions,
 * exports, rate-limit blocks) were either unlogged or logged ad hoc.
 *
 * Every sensitive action funnels through `auditEvent()`:
 *   - one structured JSON line to the server log (grep-able, timestamped,
 *     with request correlation id),
 *   - one ActivityLog row (survives restarts; surfaces in the Super Admin
 *     activity feed), best-effort — audit logging must never fail a user
 *     operation after the fact.
 *
 * Canonical action vocabulary (do not invent ad-hoc names):
 *   LOGIN_SUCCESS, LOGIN_FAILED, LOGIN_RATE_BLOCKED, LOGOUT,
 *   PASSWORD_CHANGED, SESSIONS_REVOKED, SESSION_ROTATED,
 *   ACCOUNT_STATUS_CHANGE, ACCOUNT_CREATED, PERMISSION_CHANGE,
 *   STUDENT_DATA_EXPORT, FEE_OPERATION, MARKS_CHANGE, ADMISSION_APPROVED,
 *   ACCOUNT_ACTIVATED, PLATFORM_SETTING_CHANGE, PAYMENT_VERIFIED,
 *   FILE_UPLOADED, FILE_DELETED, FILE_ACCESS_GRANTED, CSRF_REJECTED,
 *   RATE_LIMIT_BLOCKED, EVENT_DELETED
 */
import { db } from '@/lib/db'

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_RATE_BLOCKED',
  'LOGIN_LOCKED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_CHANGE_FAILED',
  'SESSIONS_REVOKED',
  'SESSION_ROTATED',
  'ACCOUNT_STATUS_CHANGE',
  'PERMISSION_CHANGE',
  // PIH-4a (audit-trail gap) — operator-created accounts that provision
  // login credentials (teacher/student creation by P/M): the credentials
  // hand-over is a security event, so the funnel needs a canonical name.
  'ACCOUNT_CREATED',
  // TQA c345de6 — teacher profile mutations persisted server-side need a
  // canonical update action (PATCH /api/teachers/[id]).
  'ACCOUNT_UPDATED',
  'STUDENT_DATA_EXPORT',
  'FEE_OPERATION',
  'MARKS_CHANGE',
  'ADMISSION_APPROVED',
  'ACCOUNT_ACTIVATED',
  'PLATFORM_SETTING_CHANGE',
  'PAYMENT_VERIFIED',
  'FILE_UPLOADED',
  'FILE_DELETED',
  'FILE_ACCESS_GRANTED',
  'CSRF_REJECTED',
  'RATE_LIMIT_BLOCKED',
  // Task 4-d (fix #1) — school calendar event deletion is a destructive
  // school-scoped mutation; join the canonical vocabulary so the events
  // DELETE route can audit through auditEvent() instead of a bespoke row.
  'EVENT_DELETED',
  // Phase 4 (item 3) — cross-tenant attempt detected at an authorization
  // boundary (row exists in a foreign school). Fired by authz guards;
  // the client envelope stays a fail-safe 404.
  'TENANT_MISMATCH',
  // PHASE 6 — school-visible platform events (written into the SCHOOL's
  // ActivityLog so principals see platform oversight of their tenant).
  'PLATFORM_SUPPORT_SESSION',
  'PLATFORM_LOGIN_BLOCKED',
  // PHASE 1 (role-architecture audit) — a school-door login attempt by a
  // role outside the canonical model (PRINCIPAL|TEACHER|STUDENT): legacy
  // PARENT/MANAGEMENT/ACCOUNTANT/DRIVER rows exist as contact data and
  // must never authenticate; the refusal is an audited attack signal.
  'SCHOOL_LOGIN_ROLE_BLOCKED',
  // CREDENTIAL-RESET — school-visible marker for a platform credential
  // reset (single-account or whole-roster) on this tenant.
  'PLATFORM_CREDENTIAL_RESET',
  // PHASE 7.5 — school configuration / website CMS / announcement
  // lifecycle mutations (all school-scoped, principal-authored).
  'SCHOOL_SETTINGS_UPDATED',
  'ANNOUNCEMENT_UPDATED',
  'ANNOUNCEMENT_DELETED',
  'WEBSITE_CONTENT_UPDATED',
  'GALLERY_UPDATED',
  // PHASE 8B — canonical payroll mutations (salary persistence): every
  // structure write, payment recording and void is a school financial
  // event and joins the canonical vocabulary.
  'SALARY_STRUCTURE_SET',
  'SALARY_PAYMENT_RECORDED',
  'SALARY_PAYMENT_VOIDED',
  // PHASE 8B — multi-tenant custom-domain onboarding (school plane).
  'DOMAIN_REQUESTED',
  'DOMAIN_VERIFIED',
  'DOMAIN_CHECK_FAILED',
  // SaaS-HARDENING — subscription entitlement / identity-request /
  // support surfaces on the school plane (all school-scoped).
  'SUBSCRIPTION_RENEWAL_REQUESTED',
  'IDENTITY_CHANGE_REQUESTED',
  'IDENTITY_CHANGE_APPLIED',
  'SUPPORT_REQUESTED',
  // SaaS-HARDENING — school website CMS notices/admissions lifecycle.
  'WEBSITE_NOTICE_PUBLISHED',
  'WEBSITE_NOTICE_UNPUBLISHED',
  'WEBSITE_ADMISSIONS_UPDATED',
  // FEE-ADMISSIONS MVP — server-issued admissions lifecycle + credential
  // events (school-scoped; the application event trail is the domain
  // record, these are the security-plane mirrors).
  'ADMISSION_SUBMITTED',
  'ADMISSION_DRAFT',
  'ADMISSION_UNDER_REVIEW',
  'ADMISSION_ENROLLED',
  'ADMISSION_REJECTED',
  'CREDENTIAL_RESET',
  // FEE-ADMISSIONS MVP — bootstrap credential expired at school-door
  // login (48h one-time credential lifecycle).
  'LOGIN_CREDENTIAL_EXPIRED',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEventInput {
  schoolId?: string | null
  userId?: string | null
  action: AuditAction
  /** Human context. NEVER include tokens, passwords, or file contents. */
  detail?: string
  /** Request correlation id (from the api() envelope). */
  requestId?: string
  /** Client IP (login/security events only). */
  ip?: string
  /** Bearer-free actor label for unauthenticated contexts. */
  actorLabel?: string
}

/** Redact accidental secrets from detail strings before persisting. */
export function sanitizeAuditDetail(detail: string): string {
  return detail
    .replace(/\b([A-Fa-f0-9]{64,})\b/g, '[redacted-token]') // session tokens
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted-key]')
    .replace(/\b(password|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 400)
}

/**
 * The single audit funnel. Fire-and-forget: DB failure is logged server-
 * side but never propagated — the audited operation already happened.
 */
export async function auditEvent(evt: AuditEventInput): Promise<void> {
  const detail = evt.detail ? sanitizeAuditDetail(evt.detail) : undefined

  // Structured log line — one JSON object per event.
  const line = {
    ts: new Date().toISOString(),
    channel: 'audit',
    action: evt.action,
    schoolId: evt.schoolId ?? null,
    userId: evt.userId ?? null,
    actor: evt.actorLabel ?? null,
    ip: evt.ip ?? null,
    requestId: evt.requestId ?? null,
    detail: detail ?? null,
  }
  console.log(JSON.stringify(line))

  try {
    await db.activityLog.create({
      data: {
        schoolId: evt.schoolId ?? null,
        userId: evt.userId ?? null,
        action: evt.action,
        detail,
      },
    })
  } catch (e) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        channel: 'audit',
        level: 'error',
        action: evt.action,
        error: e instanceof Error ? e.message.slice(0, 200) : 'activitylog write failed',
      }),
    )
  }
}

/**
 * Audit a rate-limit block (log-only by default — high-frequency, and the
 * blocked caller gets no DB-write amplification).
 */
export function auditRateLimit(
  profile: string,
  key: string,
  requestId?: string,
): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      channel: 'audit',
      action: 'RATE_LIMIT_BLOCKED',
      profile,
      key: key.slice(0, 120),
      requestId: requestId ?? null,
    }),
  )
}
