import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { isSubscriptionSchemaPendingError } from '@/lib/platform/subscription-schema'

export const runtime = 'nodejs'

/**
 * GET /api/platform/subscriptions/codes — activation-code registry +
 * failed-claim diagnostics (billing.manage). NEVER exposes code plaintext
 * (only sha256 hashes exist) — publicRef + status + scope + linkage.
 *
 * Query: ?status=&scope=&schoolId=&studentId=&page=&pageSize=&q= (publicRef or plan code)
 *
 * SCHEMA-PENDING RESILIENCE — activation codes live in pending-migration
 * tables. On a pre-migration database the honest answer is an empty
 * registry + `schemaPending: true` (the UI explains that the code system
 * is not provisioned on this database yet); issuing/revoke mutations fail
 * through the central classifier with the typed SUBSCRIPTION_SYSTEM_PENDING
 * error. No fabricated codes, ever.
 */
export async function GET(req: NextRequest) {
  return withPlatform({ permission: 'billing.manage' }, async () => {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? ''
    const scope = url.searchParams.get('scope') ?? ''
    const schoolId = url.searchParams.get('schoolId') ?? ''
    const studentId = url.searchParams.get('studentId') ?? ''
    const q = url.searchParams.get('q')?.trim() ?? ''
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') ?? '25') || 25))

    const where: Record<string, unknown> = {}
    if (['ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED', 'REPLACED'].includes(status)) where.status = status
    if (['SCHOOL_SUBSCRIPTION', 'STUDENT_ENTITLEMENT'].includes(scope)) where.scope = scope
    if (schoolId) where.schoolId = schoolId
    if (studentId) where.studentId = studentId
    if (q) {
      where.OR = [
        { publicRef: { contains: q, mode: 'insensitive' } },
        { planCode: { contains: q, mode: 'insensitive' } },
      ]
    }

    const load = () =>
      Promise.all([
        db.activationCode.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: pageSize,
          skip: (page - 1) * pageSize,
          include: {
            school: { select: { id: true, name: true, slug: true } },
            student: { select: { id: true, admissionNo: true, user: { select: { name: true } } } },
            events: { orderBy: { createdAt: 'desc' }, take: 5 },
            replacedByCode: { select: { publicRef: true } },
          },
        }),
        db.activationCode.count({ where }),
        // Failed-claim diagnostics: rejection reason classes over the window.
        db.activationCodeEvent.findMany({
          where: { type: 'CLAIM_REJECTED' },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { code: { select: { publicRef: true, scope: true, status: true } } },
        }),
      ])

    let schemaPending = false
    let loaded: Awaited<ReturnType<typeof load>>
    try {
      loaded = await load()
    } catch (e) {
      if (!isSubscriptionSchemaPendingError(e)) throw e
      schemaPending = true
      loaded = [[], 0, []] as unknown as Awaited<ReturnType<typeof load>>
    }
    const [codes, total, rejectedEvents] = loaded

    return {
      ...(schemaPending ? { subscriptionSchemaPending: true as const } : {}),
      codes: codes.map((c) => ({
        id: c.id,
        publicRef: c.publicRef,
        scope: c.scope,
        status: c.status,
        school: c.school,
        student: c.student,
        planCode: c.planCode,
        interval: c.interval,
        validityMonths: c.validityMonths,
        claimWindowDays: c.claimWindowDays,
        issuedAt: c.issuedAt.toISOString(),
        expiresAt: c.expiresAt.toISOString(),
        claimedAt: c.claimedAt?.toISOString() ?? null,
        revokedAt: c.revokedAt?.toISOString() ?? null,
        revokeReason: c.revokeReason,
        replacedBy: c.replacedByCode ? { publicRef: c.replacedByCode.publicRef } : null,
        paymentRef: c.paymentRef,
        events: c.events.map((e) => ({
          type: e.type,
          detail: e.detail,
          createdAt: e.createdAt.toISOString(),
        })),
      })),
      total,
      page,
      pageSize,
      diagnostics: rejectedEvents.map((e) => ({
        publicRef: e.code?.publicRef ?? '(code row removed)',
        scope: e.code?.scope ?? 'UNKNOWN',
        codeStatus: e.code?.status ?? 'UNKNOWN',
        reason: e.detail,
        at: e.createdAt.toISOString(),
      })),
    }
  })
}
