/**
 * PHASE 8B — POST /api/platform/schools/[id]/domains/[domainId]/verify
 *
 * Run DNS verification for a mapping: ownership TXT
 * (`_scholario-verify.<hostname>` = `scholario-verify=<token>`) and the
 * routing records (CNAME/A to the deployment). On ownership proof the
 * row becomes VERIFIED (+verifiedAt) — the exact moment the hostname
 * starts resolving the tenant in the public pipeline. Audited.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders, enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { verifyDomainDns } from '@/lib/tenant/domain-verification'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  const { id, domainId } = await params
  return withPlatform(
    { permission: 'schools.manage' },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)
      // DNS checks are network-bound: brake repeated probes.
      enforceRateLimit(`rl:pf-domainverify:${ctx.admin.id}`, RATE_LIMITS.platformMutation)

      const row = await db.tenantDomain.findFirst({
        where: { id: domainId, schoolId: id },
      })
      if (!row) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Domain not found' })
      }
      if (row.status === 'VERIFIED') {
        return { domain: { id: row.id, hostname: row.hostname, status: row.status }, alreadyVerified: true }
      }

      const outcome = await verifyDomainDns(row.hostname, row.verificationToken)
      const becameVerified = outcome.ownershipProven

      const updated = await db.tenantDomain.update({
        where: { id: row.id },
        data: {
          status: becameVerified ? 'VERIFIED' : 'PENDING',
          verifiedAt: becameVerified ? new Date() : null,
          lastCheckedAt: new Date(),
          lastCheckResult: outcome.summary.slice(0, 500),
        },
      })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: becameVerified
          ? 'platform.school.domain_verified'
          : 'platform.school.domain_check_failed',
        targetType: 'SCHOOL',
        targetId: id,
        schoolId: id,
        ip,
        reason: 'domain DNS verification',
        metadata: { hostname: row.hostname, summary: outcome.summary.slice(0, 300) },
      }).catch(() => {})

      return {
        domain: {
          id: updated.id,
          hostname: updated.hostname,
          status: updated.status,
          lastCheckResult: updated.lastCheckResult,
          verifiedAt: updated.verifiedAt?.toISOString() ?? null,
        },
        ownershipProven: outcome.ownershipProven,
        routingConfigured: outcome.routingConfigured,
        summary: outcome.summary,
      }
    },
    { method: 'POST' },
  )
}
