/**
 * PHASE 3 — Role-wise Feature Control — platform-plane configuration API.
 *
 *   GET   /api/platform/schools/[id]/role-features   (schools.read)
 *   PATCH /api/platform/schools/[id]/role-features   (schools.manage)
 *
 * The surface configures PER-SCHOOL role-feature denials for the three
 * canonical school roles (PRINCIPAL | TEACHER | STUDENT). Semantics:
 *
 *   · Remove-only: a change can only DENY a feature the role's RBAC
 *     baseline already grants (validated in validateRoleFeatureChanges —
 *     a denial where the baseline refuses is rejected 422, never stored).
 *   · Optimistic concurrency: PATCH carries baseUpdatedAt (the GET's
 *     max(row.updatedAt) token); a mismatch → typed CONFLICT so
 *     concurrent editors never silently overwrite each other.
 *   · Atomic: the whole change-set applies in ONE transaction (the
 *     Phase-2 P3 lesson applied to our own code — no partial seeding).
 *   · Audited: ONE `platform.school.role_feature_updated` record PER CELL
 *     (previous/new values, actor, timestamp, batch id — booleans and
 *     stable keys only, no secrets by construction).
 *   · Tenant-safe: unknown school id → fail-safe 404 (no existence
 *     oracle), matching the /platform/schools/[id]/* family.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { parseJsonBody, strictBody } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import {
  applyRoleFeatureChanges,
  featureBaselineAllows,
  featureDef,
  roleFeaturesConfig,
  validateRoleFeatureChanges,
  type RoleFeatureChange,
} from '@/lib/security/role-features'

export const runtime = 'nodejs'

async function loadSchoolOr404(id: string) {
  const school = await db.school.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!school) {
    throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
  }
  return school
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.read' }, async () => {
    await loadSchoolOr404(id)
    // api() wraps this as { ok: true, data: config }.
    return roleFeaturesConfig(id)
  })
}

const patchSchema = strictBody({
  baseUpdatedAt: z.string().datetime().nullable(),
  reason: z.string().min(4).max(400).optional(),
  changes: z.array(
    z.object({
      role: z.string(),
      featureKey: z.string(),
      denied: z.boolean(),
    }),
  ),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, patchSchema)
    const ip = clientIpFromHeaders(req.headers)
    const school = await loadSchoolOr404(id)

    // Validate against the catalog + canonical roles (typed 422 on junk,
    // including a denial where the RBAC baseline refuses the role —
    // the layer is remove-only, always).
    const changes: RoleFeatureChange[] = validateRoleFeatureChanges(body.changes)

    // Per-cell previous values (read BEFORE the transaction; booleans +
    // stable keys only).
    const keys = changes.map((c) => `${c.role}|${c.featureKey}`)
    const existing = await db.roleFeatureOverride.findMany({
      where: {
        schoolId: id,
        OR: keys.map((k) => {
          const [role, featureKey] = k.split('|')
          return { role, featureKey }
        }),
      },
      select: { role: true, featureKey: true },
    })
    const deniedNow = new Set(existing.map((r) => `${r.role}|${r.featureKey}`))

    const result = await applyRoleFeatureChanges(id, ctx.admin.id, changes, body.baseUpdatedAt ?? null)

    // AUDIT — one record PER CELL (spec §4G: role, feature, previous
    // value, new value, actor, timestamp). A single aggregate event would
    // have its metadata clipped at 2,000 chars by the audit funnel for
    // realistic bulk saves, silently losing part of the trail — per-cell
    // records cannot truncate. Booleans + stable keys only, no secrets.
    const batch = `rf-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    for (const c of changes) {
      const from =
        featureBaselineAllows(featureDef(c.featureKey)!, c.role) &&
        !deniedNow.has(`${c.role}|${c.featureKey}`)
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.role_feature_updated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: body.reason ?? 'role-wise feature configuration update',
        metadata: { batch, role: c.role, feature: c.featureKey, from, to: !c.denied },
      })
    }

    return {
      applied: result.applied,
      updatedAt: result.updatedAt,
    }
  }, { method: 'PATCH' })
}
