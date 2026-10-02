/**
 * PHASE 8B (§10/§25) — platform control-plane API for tenant custom
 * domains.
 *
 *   GET    /api/platform/schools/[id]/domains          list + statuses
 *   POST   /api/platform/schools/[id]/domains          add a mapping (PENDING)
 *
 * Platform-plane authz (withPlatform + schools.manage + step-up for the
 * add). Hostnames are normalized + validated before storage; the global
 * UNIQUE constraint on TenantDomain.hostname makes cross-tenant
 * collisions structurally impossible (a P2002 surfaces as a clean 409).
 */
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { hostnameRejectionReason, normalizeHostname } from '@/lib/tenant/hostname'

export const runtime = 'nodejs'

const addSchema = strictBody({
  hostname: z.string().min(4).max(253),
  isPrimary: z.boolean().optional(),
  reason: z.string().min(4).max(400).optional(),
})

const MAX_DOMAINS_PER_SCHOOL = 10

function serialize(d: {
  id: string
  hostname: string
  isPrimary: boolean
  status: string
  lastCheckedAt: Date | null
  lastCheckResult: string | null
  createdAt: Date
  verifiedAt: Date | null
}) {
  return {
    id: d.id,
    hostname: d.hostname,
    isPrimary: d.isPrimary,
    status: d.status,
    lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
    lastCheckResult: d.lastCheckResult,
    createdAt: d.createdAt.toISOString(),
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    const school = await db.school.findUnique({ where: { id }, select: { id: true } })
    if (!school) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
    const domains = await db.tenantDomain.findMany({
      where: { schoolId: id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    })
    return { domains: domains.map(serialize) }
  }, { method: 'GET' })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const body = await parseJsonBody(req, addSchema)
      const ip = clientIpFromHeaders(req.headers)

      const hostname = normalizeHostname(body.hostname)
      if (!hostname) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'hostname could not be normalized' })
      }
      const rejection = hostnameRejectionReason(hostname)
      if (rejection) {
        throw new AppError('INVALID_INPUT', { publicMessage: `Invalid hostname: ${rejection}` })
      }

      const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!school) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })

      const existingCount = await db.tenantDomain.count({ where: { schoolId: id } })
      if (existingCount >= MAX_DOMAINS_PER_SCHOOL) {
        throw new AppError('CONFLICT', {
          publicMessage: `School already has ${MAX_DOMAINS_PER_SCHOOL} domains (the maximum)`,
        })
      }

      // Uniqueness is a cross-tenant storage guarantee — surface P2002 as 409.
      try {
        const row = await db.tenantDomain.create({
          data: {
            schoolId: id,
            hostname,
            isPrimary: body.isPrimary ?? existingCount === 0,
            status: 'PENDING',
            verificationToken: randomBytes(16).toString('hex'),
          },
        })

        await platformAuditEvent({
          adminId: ctx.admin.id,
          action: 'platform.school.domain_added',
          targetType: 'SCHOOL',
          targetId: school.id,
          schoolId: school.id,
          ip,
          reason: body.reason ?? 'domain onboarding',
          metadata: { hostname },
        }).catch(() => {})

        return { domain: serialize(row) }
      } catch (e: unknown) {
        const code = (e as { code?: string }).code
        if (code === 'P2002') {
          throw new AppError('CONFLICT', {
            publicMessage: `The hostname ${hostname} is already mapped to a school`,
          })
        }
        throw e
      }
    },
    { method: 'POST' },
  )
}
