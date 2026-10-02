/**
 * PHASE 8B (§25) — school-plane domain onboarding API (principal-facing).
 *
 *   GET  /api/school/domains          the school's mappings + DNS instructions
 *   POST /api/school/domains          REQUEST a new domain (PENDING row)
 *
 * The principal requests a domain for THEIR OWN school only (tenant comes
 * from the session — never a body value). The row starts PENDING with a
 * verification token the principal uses to configure DNS; verification
 * (self-check allowed via [domainId]/verify) proves ownership through
 * DNS. Platform admins can also add/verify/delete through the control
 * plane. School users never see another tenant's domains or tokens.
 */
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { strictBody, parseJsonBody } from '@/lib/security/validation'
import { auditEvent } from '@/lib/security/audit'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { hostnameRejectionReason, normalizeHostname } from '@/lib/tenant/hostname'
import { ROUTING_TARGETS, verificationTxtName, verificationTxtValue } from '@/lib/tenant/domain-verification'

export const runtime = 'nodejs'

const MAX_DOMAINS_PER_SCHOOL = 10

const requestSchema = strictBody({
  hostname: z.string().min(4).max(253),
})

function dnsInstructions(hostname: string, token: string) {
  const isApex = hostname.split('.').length <= 2
  return {
    verificationTxt: {
      name: verificationTxtName(hostname),
      value: verificationTxtValue(token),
    },
    routing: isApex
      ? { type: 'A', name: hostname, value: ROUTING_TARGETS.a }
      : { type: 'CNAME', name: hostname, value: ROUTING_TARGETS.cname },
    note:
      'Create the TXT record to prove ownership, and the routing record so the domain serves your school. ' +
      'Then run Verify. The platform team must also attach the domain to the deployment (Vercel project) ' +
      'before traffic routes — contact support with your verified hostname.',
  }
}

export async function GET(_req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId

    const domains = await db.tenantDomain.findMany({
      where: { schoolId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })

    return {
      domains: domains.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        isPrimary: d.isPrimary,
        status: d.status,
        lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
        lastCheckResult: d.lastCheckResult,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        // The school's OWN instructions (the token is the school's secret
        // to place in DNS — safe to show to its principal).
        instructions: dnsInstructions(d.hostname, d.verificationToken),
      })),
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId

    const body = await parseJsonBody(req, requestSchema)
    enforceRateLimit(`rl:domain-request:${schoolId}`, RATE_LIMITS.platformMutation)

    const hostname = normalizeHostname(body.hostname)
    if (!hostname) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'hostname could not be normalized' })
    }
    const rejection = hostnameRejectionReason(hostname)
    if (rejection) {
      throw new AppError('INVALID_INPUT', { publicMessage: `Invalid hostname: ${rejection}` })
    }

    const existingCount = await db.tenantDomain.count({ where: { schoolId } })
    if (existingCount >= MAX_DOMAINS_PER_SCHOOL) {
      throw new AppError('CONFLICT', {
        publicMessage: `Your school already has ${MAX_DOMAINS_PER_SCHOOL} domains (the maximum)`,
      })
    }

    try {
      const row = await db.tenantDomain.create({
        data: {
          schoolId,
          hostname,
          isPrimary: existingCount === 0,
          status: 'PENDING',
          verificationToken: randomBytes(16).toString('hex'),
        },
      })

      await auditEvent({
        schoolId,
        userId: ctx.user.id,
        action: 'DOMAIN_REQUESTED',
        detail: `Custom domain requested — ${hostname}`,
      }).catch(() => {})

      return {
        domain: {
          id: row.id,
          hostname: row.hostname,
          status: row.status,
          isPrimary: row.isPrimary,
        },
        instructions: dnsInstructions(row.hostname, row.verificationToken),
      }
    } catch (e: unknown) {
      const code = (e as { code?: string }).code
      if (code === 'P2002') {
        throw new AppError('CONFLICT', {
          publicMessage: `The hostname ${hostname} is already mapped to a school`,
        })
      }
      throw e
    }
  })
}
