/**
 * PHASE 8B — DELETE /api/platform/schools/[id]/domains/[domainId]
 *
 * Remove a domain mapping. Cross-tenant safety: the row must belong to
 * THIS school (404 otherwise — no existence oracle). Platform-plane
 * authz: schools.manage + step-up. Audited.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  const { id, domainId } = await params
  return withPlatform(
    { permission: 'schools.manage', stepUp: true },
    async (ctx) => {
      const ip = clientIpFromHeaders(req.headers)
      // Tenant-scoped delete: domain must belong to THIS school.
      const row = await db.tenantDomain.findFirst({
        where: { id: domainId, schoolId: id },
      })
      if (!row) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Domain not found' })
      }

      await db.tenantDomain.delete({ where: { id: row.id } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.domain_removed',
        targetType: 'SCHOOL',
        targetId: id,
        schoolId: id,
        ip,
        reason: 'domain removal',
        metadata: { hostname: row.hostname, wasStatus: row.status },
      }).catch(() => {})

      return { ok: true, hostname: row.hostname }
    },
    { method: 'DELETE' },
  )
}
