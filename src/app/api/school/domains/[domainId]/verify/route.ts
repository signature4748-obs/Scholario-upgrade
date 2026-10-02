/**
 * PHASE 8B (§25) — POST /api/school/domains/[domainId]/verify
 *
 * Principal-triggered DNS re-check for THEIR OWN school's domain. The
 * tenant comes from the session (cross-tenant ids 404 — no existence
 * oracle). DNS TXT proof-of-ownership is the verification act itself
 * (the token is already the school's own secret), so self-service
 * verification is safe; the row flips to VERIFIED only on a real DNS
 * match. Rate-limited (DNS probes are network-bound).
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { auditEvent } from '@/lib/security/audit'
import { verifyDomainDns } from '@/lib/tenant/domain-verification'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
) {
  const { domainId } = await params
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    enforceRateLimit(`rl:domain-verify:${ctx.schoolId}`, RATE_LIMITS.platformMutation)

    // Tenant-scoped: the domain must belong to the session's school.
    const row = await db.tenantDomain.findFirst({
      where: { id: domainId, schoolId: ctx.schoolId },
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

    await auditEvent({
      schoolId: ctx.schoolId,
      userId: ctx.user.id,
      action: becameVerified ? 'DOMAIN_VERIFIED' : 'DOMAIN_CHECK_FAILED',
      detail: `Custom domain DNS check — ${row.hostname}: ${outcome.summary.slice(0, 200)}`,
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
  })
}
