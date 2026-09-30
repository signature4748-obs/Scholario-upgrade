import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { validateFlagPatch, FLAGGABLE_MODULES, parseFlags } from '@/lib/platform/module-flags'

export const runtime = 'nodejs'

/**
 * PATCH /api/platform/schools/[id]/feature-flags — per-school module
 * overrides. Partial PATCH semantics: only provided keys change; the
 * effective availability is school flag ?? platform master ?? true.
 *
 * Permission: schools.manage. (Product availability toggles — not a
 * security boundary; tenant isolation is unaffected either way.)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage' },
    async (ctx) => {
      const raw = await req.json().catch(() => ({}))
      const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      // Validate + normalize the patch (unknown keys / non-boolean values rejected).
      const patch = validateFlagPatch(body)
      if (Object.keys(patch).length === 0) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Provide at least one module flag (${FLAGGABLE_MODULES.join(', ')})`,
        })
      }

      const ip = clientIpFromHeaders(req.headers)
      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }

      // Merge into the existing override map.
      const merged = { ...parseFlags(school.featureFlags), ...patch }
      await db.school.update({ where: { id }, data: { featureFlags: JSON.stringify(merged) } })

      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.feature_flags_updated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: 'feature flags updated',
        metadata: { changes: patch },
      })

      return { ok: true, featureFlags: merged }
    },
    { method: 'PATCH' },
  )
}
