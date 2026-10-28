import { db } from '@/lib/db'
import { api } from '@/lib/api'
import { AppError } from '@/lib/security/errors'
import { getSupportSession } from '@/lib/platform/auth'
import { platformAuditEvent } from '@/lib/platform/audit'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/platform/support/overview — the READ-ONLY school oversight
 * view for an active support session.
 *
 * Auth: the SUPPORT token space ONLY (scholario_support cookie /
 * x-support-token dev header). A platform admin session alone cannot
 * read school data through this endpoint — oversight REQUIRES an
 * explicit, reason-bearing, time-boxed support session. And a school
 * session can never satisfy it either (third, disjoint token space).
 *
 * Read-only by construction: this route family exposes GETs only.
 *
 * 2026-10-28 redesign — the payload is organized for TROUBLESHOOTING,
 * not a school overview duplicate:
 *   · context      — identity, stated issue, window (existing fields)
 *   · diagnostics  · fees: failed-payment evidence (count + recent
 *                    failed rows with record references) for "fee
 *                    ledger discrepancy" investigations; collected
 *                    totals for parity context
 *                  · signIns: the tenant's live sessions + most recent
 *                    sign-ins with device/IP for "can't sign in /
 *                    session issues" investigations
 *   · activity     — the tenant's own journal (last 20) — the evidence
 *                    source for "failed operations / missing records"
 *   · counts       — record totals (missing-records checks)
 */
export async function GET() {
  return api(async () => {
    const auth = await getSupportSession()
    if (!auth) {
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'No active support session',
        internalDetail: 'support overview: missing/invalid support token',
      })
    }
    if (auth.support.expiresAt < new Date()) {
      // Lazily retired expired session (getSupportSession already marked
      // it revoked) — audit the natural expiry.
      await platformAuditEvent({
        adminId: auth.support.adminId,
        action: 'platform.support_session.expired',
        targetType: 'SUPPORT_SESSION',
        targetId: auth.support.id,
        schoolId: auth.support.schoolId,
        reason: auth.support.reason,
      }).catch(() => {})
      throw new AppError('AUTH_REQUIRED', {
        publicMessage: 'Support session expired',
        internalDetail: 'support overview: session expired',
      })
    }

    const { support, school } = auth
    const [counts, finance, failedPayments, recentSignIns, recentActivity, activeSessions] =
      await Promise.all([
        db.school.findUnique({
          where: { id: school.id },
          select: {
            _count: { select: { users: true, students: true, teachers: true, classes: true, subjects: true, exams: true } },
          },
        }),
        db.payment.aggregate({
          where: { schoolId: school.id, status: 'SUCCESS' },
          _sum: { amount: true },
          _count: true,
        }),
        db.payment.findMany({
          where: { schoolId: school.id, status: { not: 'SUCCESS' } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            transactionId: true,
            note: true,
            feeId: true,
            createdAt: true,
          },
        }),
        db.session.findMany({
          where: { user: { schoolId: school.id } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        }),
        db.activityLog.findMany({
          where: { schoolId: school.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        db.session.count({
          where: { user: { schoolId: school.id }, expiresAt: { gt: new Date() } },
        }),
      ])

    const now = Date.now()
    return {
      supportSession: {
        id: support.id,
        schoolId: school.id,
        schoolName: school.name,
        schoolSlug: school.slug,
        schoolStatus: school.status,
        reason: support.reason,
        startedAt: support.createdAt.toISOString(),
        expiresAt: support.expiresAt.toISOString(),
      },
      school: {
        id: school.id,
        name: school.name,
        status: school.status,
      },
      counts: counts?._count ?? {},
      diagnostics: {
        fees: {
          successfulPayments: finance._count,
          collectedTotal: num(finance._sum.amount),
          failedRecent: failedPayments.map((p) => ({
            id: p.id,
            amount: num(p.amount),
            method: p.method,
            status: p.status,
            transactionId: p.transactionId,
            note: p.note,
            feeId: p.feeId,
            at: p.createdAt.toISOString(),
          })),
        },
        signIns: {
          activeCount: activeSessions,
          recent: recentSignIns.map((s) => ({
            id: s.id,
            userName: s.user.name,
            userRole: s.user.role,
            createdAt: s.createdAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
            live: s.expiresAt.getTime() > now,
            userAgent: s.userAgent,
            ipAddress: s.ipAddress,
          })),
        },
      },
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        detail: a.detail,
        at: a.createdAt.toISOString(),
      })),
    }
  })
}
