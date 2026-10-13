import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { evaluateStudentEntitlement } from '@/lib/entitlement/student'
import { entitlementForUser } from '@/lib/entitlement/server'

export const runtime = 'nodejs'

/**
 * GET /api/subscription/students — the principal/management view of
 * student entitlement statuses for THEIR school (authorized school
 * operators: view-only — issuing paid entitlements or marking payments is
 * platform-only by construction; no such school-plane route exists).
 *
 * Server-side tenant scoping; NEVER another school's students. Query:
 *   ?q= (name/admissionNo) &filter= (all|subscribed|unsubscribed|expiring)
 */
export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const url = new URL(req.url)
      const q = url.searchParams.get('q')?.trim() ?? ''
      const filter = url.searchParams.get('filter') ?? 'all'

      const where: Record<string, unknown> = { schoolId }
      if (q) {
        where.OR = [
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { admissionNo: { contains: q, mode: 'insensitive' } },
          { rollNo: { contains: q, mode: 'insensitive' } },
        ]
      }

      const [students, tenant] = await Promise.all([
        db.student.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            user: { select: { name: true, email: true, subscriptionStatus: true } },
            class: { select: { name: true } },
            entitlements: {
              where: { status: { in: ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'] } },
              orderBy: { validityEnd: 'desc' },
              take: 1,
            },
          },
        }),
        db.school.findUnique({
          where: { id: schoolId },
          select: { subscription: { select: { billingModel: true } }, status: true, plan: true },
        }),
      ])

      const tenantEntitlement = entitlementForUser(user)
      const billingModel = tenant?.subscription?.billingModel ?? 'SCHOOL_WIDE'
      const now = new Date()

      const rows = students
        .map((s) => {
          const live = s.entitlements[0] ?? null
          const decision = evaluateStudentEntitlement({
            accountSubscriptionStatus: s.user.subscriptionStatus,
            tenant: tenantEntitlement,
            billingModel,
            entitlement: live ? { status: live.status, validityStart: live.validityStart, validityEnd: live.validityEnd, source: live.source } : null,
            now,
          })
          return {
            studentId: s.id,
            name: s.user.name,
            email: s.user.email,
            admissionNo: s.admissionNo,
            class: s.class?.name ?? null,
            state: decision.state,
            businessAllowed: decision.businessAllowed,
            accountLocked: s.user.subscriptionStatus === 'LOCKED',
            validityStart: live?.validityStart?.toISOString() ?? null,
            validityEnd: live?.validityEnd?.toISOString() ?? null,
            source: live?.source ?? null,
            revokeReason: live?.revokeReason ?? null,
          }
        })
        .filter((r) => {
          if (filter === 'subscribed') return r.state === 'ACTIVE' || r.state === 'PENDING' || r.state === 'COVERED_BY_SCHOOL'
          if (filter === 'unsubscribed') return r.state === 'NOT_SUBSCRIBED' || r.state === 'EXPIRED' || r.state === 'REVOKED'
          if (filter === 'expiring') {
            return !!r.validityEnd && new Date(r.validityEnd).getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000
          }
          return true
        })

      const summary = rows.reduce(
        (acc, r) => {
          acc[r.state] = (acc[r.state] ?? 0) + 1
          return acc
        },
        {} as Record<string, number>,
      )

      return {
        billingModel,
        tenantState: tenantEntitlement.state,
        students: rows,
        summary,
        note:
          billingModel === 'SCHOOL_WIDE'
            ? 'This school is on a school-wide plan — students are covered by the school subscription.'
            : 'This school uses per-student subscriptions. Students activate with codes issued by SCHOLARIO after payment; the school office collects payments and requests codes from SCHOLARIO support.',
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
