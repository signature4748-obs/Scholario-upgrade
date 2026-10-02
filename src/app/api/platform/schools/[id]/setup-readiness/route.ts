import { NextRequest } from 'next/server'
import { AppError } from '@/lib/security/errors'
import { withPlatform } from '@/lib/platform/authz'
import { computeSetupReadiness } from '@/lib/school/setup-readiness'

export const runtime = 'nodejs'

/**
 * GET /api/platform/schools/[id]/setup-readiness — PHASE 8C (mission §12).
 *
 * The guided-setup progress surface: every section is COMPUTED from the
 * live database (counts + column presence), never self-reported by the
 * client and never fabricated. A newly provisioned school honestly shows
 * zero-progress sections; a configured school shows what actually exists.
 * Intentionally read-only — provisioning/configuration happen through
 * their own audited routes; this endpoint only OBSERVES state so the
 * platform admin always knows what remains before a school is usable.
 *
 * Permission: schools.read (same as the school ledger).
 *
 * PHASE 8C-F: the computation now lives in lib/school/setup-readiness
 * (shared verbatim with the principal's own /api/school/setup-readiness
 * — one source of truth for the progress contract).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform(
    { permission: 'schools.read' },
    async () => {
      const readiness = await computeSetupReadiness(id)
      if (!readiness) throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'School not found' })
      return readiness
    },
    { method: 'GET' },
  )
}
