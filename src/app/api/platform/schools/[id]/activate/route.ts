import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import { computeSetupReadiness } from '@/lib/school/setup-readiness'
import {
  computeActivationRequirements,
  type WizardSchoolSnapshot,
} from '@/lib/platform/setup-wizard-state'

export const runtime = 'nodejs'

const activateSchema = z
  .object({
    /**
     * PHASE 2 — the Setup wizard's final action sends
     * `{ requireComplete: true }`: the activation is then HARD-BLOCKED
     * until the wizard's required checklist is actually persisted
     * (identity core block + academic structure + principal), with the
     * exact missing items in the typed error.
     *
     * Every pre-existing caller (danger zone, journeys, tests) sends NO
     * body and keeps the EXACT historical behavior — activation remains
     * the sign-in unlock; requirements are always REPORTED (response +
     * audit), enforced only when explicitly requested. The server
     * derives everything from the live database either way — a client
     * can never assert completeness.
     */
    requireComplete: z.boolean().optional(),
  })
  .strict()

/**
 * POST /api/platform/schools/[id]/activate — PENDING → ACTIVE.
 *
 * The provisioning pipeline's explicit second step: until this runs, no
 * user of the school can sign in (school login requires status ACTIVE).
 *
 * PHASE 2 — server-side activation revalidation: the readiness document
 * and the principal's presence are recomputed from the live database on
 * EVERY activation attempt. The result is always returned
 * (`activation.missing` explains exactly what remains) and always
 * audited; with the wizard's opt-in `{ requireComplete: true }` an
 * incomplete checklist is a hard 422 with the same list. Duplicate
 * activation stays a typed CONFLICT ("School is already active") —
 * idempotency by state, not by tracking.
 *
 * Permission: schools.manage. Not destructive (safe direction).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.manage' },
    async (ctx) => {
      // Optional strictness flag — an empty body means the historical
      // non-strict activation (danger zone, journeys, tests).
      const rawBody = (await req.text().catch(() => '')).trim()
      let requireComplete = false
      if (rawBody) {
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(rawBody)
        } catch {
          throw new AppError('VALIDATION_FAILED', {
            publicMessage: 'Request body must be valid JSON',
          })
        }
        const parsed = activateSchema.safeParse(parsedJson)
        if (!parsed.success) {
          throw new AppError('VALIDATION_FAILED', {
            publicMessage: 'Invalid body — the only accepted field is requireComplete (boolean)',
            internalDetail: `activate: ${parsed.error.issues.map((i) => i.message).join('; ').slice(0, 200)}`,
          })
        }
        requireComplete = parsed.data.requireComplete === true
      }

      const ip = clientIpFromHeaders(req.headers)

      const school = await db.school.findUnique({ where: { id } })
      if (!school) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      if (school.status === 'ACTIVE') {
        throw new AppError('CONFLICT', { publicMessage: 'School is already active' })
      }
      if (school.status === 'SUSPENDED') {
        // Suspended schools come back through the explicit reactivate flow.
        throw new AppError('CONFLICT', {
          publicMessage: 'School is suspended — use Reactivate',
        })
      }

      // SERVER-SIDE REVALIDATION (PHASE 2) — recomputed live, never
      // trusted from the client: principal presence + (strict mode) the
      // identity core block and the academic structure.
      const [readiness, principalCount] = await Promise.all([
        computeSetupReadiness(school.id),
        db.user.count({ where: { schoolId: school.id, role: 'PRINCIPAL', status: 'ACTIVE' } }),
      ])
      if (!readiness) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      }
      const snapshotLike = {
        name: school.name,
        status: school.status,
      } as Pick<WizardSchoolSnapshot, 'name' | 'status'>
      const identityCore = identityCoreFromSchool(school)
      const requirements = computeActivationRequirements(
        snapshotLike,
        readiness,
        principalCount,
        requireComplete,
        identityCore,
      )
      if (!requirements.ok) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Cannot activate yet — remaining: ${requirements.missing
            .map((m) => m.label)
            .join('; ')}`,
          internalDetail: `activate: blocked (strict=${requireComplete}) — missing ${requirements.missing
            .map((m) => m.id)
            .join(',')}`,
        })
      }

      await db.school.update({ where: { id }, data: { status: 'ACTIVE' } })
      await platformAuditEvent({
        adminId: ctx.admin.id,
        action: 'platform.school.activated',
        targetType: 'SCHOOL',
        targetId: school.id,
        schoolId: school.id,
        ip,
        reason: `activated ${school.name}`,
        metadata: {
          // PHASE 2 — the activation snapshot: what the server verified
          // and (non-strict) what still remains for the school to finish.
          wizardStrict: requireComplete,
          missingAtActivation: requirements.missing,
          readiness: {
            requiredDone: readiness.summary.requiredDone,
            requiredTotal: readiness.summary.requiredTotal,
            requiredComplete: readiness.summary.requiredComplete,
          },
        },
      })
      return {
        ok: true,
        status: 'ACTIVE',
        // Additive — the wizard's review screen shows the honest state.
        activation: requirements,
      }
    },
    { method: 'POST' },
  )
}

/** Identity-core check straight off the School row (address, city,
 *  phone, email) — no second read needed. */
function identityCoreFromSchool(school: {
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
}): boolean {
  return (
    Boolean(school.address?.trim()) &&
    Boolean(school.city?.trim()) &&
    Boolean(school.phone?.trim()) &&
    Boolean(school.email?.trim())
  )
}
