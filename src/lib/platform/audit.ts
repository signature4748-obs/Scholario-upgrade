/**
 * Platform audit trail — PHASE 6.
 *
 * Every control-plane action (sign-in, step-up, school lifecycle,
 * billing, permissions, support sessions, announcements, settings)
 * writes one PlatformAuditLog row + one structured JSON log line.
 *
 * Mirror of the school-side auditEvent() contract:
 *   · fire-and-forget — audit failure never fails the audited operation;
 *   · reason strings pass through sanitizeAuditDetail (no tokens/PII);
 *   · metadata is JSON (counts/diffs), never payloads.
 *
 * Action vocabulary (dot-namespaced, `platform.*`):
 *   platform.login.success | platform.login.failed | platform.login.locked
 *   platform.logout | platform.logout_all | platform.session.revoked
 *   platform.step_up.granted | platform.step_up.failed
 *   platform.school.provisioned | activated | suspended | reactivated |
 *     updated | plan_changed | feature_flags_updated | deleted
 *   platform.support_session.created | revoked | expired
 *   platform.school_session.revoked
 *   platform.announcement.published | deleted
 *   platform.settings.updated
 *   platform.admin.created | permission_changed | suspended | reactivated
 *   ACCOUNT-RECOVERY:
 *   platform.password_reset.requested | .failed | .completed
 *   platform.admin.password_reset_initiated
 *   platform.admin.google_linked | .google_unlinked | .google_link_failed
 *   platform.recovery.initiated | .refused | .executed
 */

import { db } from '@/lib/db'
import { sanitizeAuditDetail } from '@/lib/security/audit'

export interface PlatformAuditInput {
  adminId?: string | null
  action: string
  targetType?: 'SCHOOL' | 'ADMIN' | 'PLATFORM_SESSION' | 'SUPPORT_SESSION' | 'SETTING' | 'ANNOUNCEMENT' | 'AUTH' | null
  targetId?: string | null
  schoolId?: string | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
  requestId?: string | null
}

/** The single platform audit funnel. Best-effort persistence. */
export async function platformAuditEvent(evt: PlatformAuditInput): Promise<void> {
  const reason = evt.reason ? sanitizeAuditDetail(evt.reason) : null
  const metadata = evt.metadata ? JSON.stringify(evt.metadata).slice(0, 2000) : null

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      channel: 'platform-audit',
      action: evt.action,
      adminId: evt.adminId ?? null,
      schoolId: evt.schoolId ?? null,
      targetType: evt.targetType ?? null,
      targetId: evt.targetId ?? null,
      ip: evt.ip ?? null,
      requestId: evt.requestId ?? null,
    }),
  )

  try {
    await db.platformAuditLog.create({
      data: {
        adminId: evt.adminId ?? null,
        action: evt.action,
        targetType: evt.targetType ?? null,
        targetId: evt.targetId ?? null,
        schoolId: evt.schoolId ?? null,
        reason,
        metadata,
        ip: evt.ip ?? null,
        requestId: evt.requestId ?? null,
      },
    })
  } catch (e) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        channel: 'platform-audit',
        level: 'error',
        action: evt.action,
        error: e instanceof Error ? e.message.slice(0, 200) : 'platformauditlog write failed',
      }),
    )
  }
}
