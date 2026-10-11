import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { num } from '@/lib/money'
import { computeAdmissionQuote } from '@/lib/fees/quote-engine'
import { requireSchoolAcademicYear } from '@/lib/admissions/academic-year'
import { assertAdmissionsIssuanceEnabled } from '@/lib/admissions/feature-flag'
import { MAX_QUANTITY } from '@/lib/fees/head-kind'

export const runtime = 'nodejs'

/**
 * POST /api/fees/quote — the server-side admission fee quote
 * (FEE-ADMISSIONS MVP, Phase B).
 *
 * Distinct, deterministic failures:
 *   · flag off          → 403 FEATURE_DISABLED
 *   · school year unset → 409 SESSION_NOT_SET
 *   · no published structure for (class, year) → 409
 *     FEE_CONFIGURATION_REQUIRED (fail-closed — never a fallback)
 *   · unknown head / invalid quantity / ineligible discount → 422
 *
 * PRINCIPAL-only (decisions and fee administration are principal-only
 * in v1). Tenant is resolved from the session (never body input).
 */

const quoteBodySchema = z.object({
  classId: z.string().min(1).max(64),
  selections: z
    .object({
      optionalHeadIds: z.array(z.string().min(1).max(64)).max(60).optional(),
      quantities: z.record(z.string().min(1).max(64), z.number().int().min(1).max(MAX_QUANTITY)).optional(),
      discountCode: z.string().max(64).optional(),
    })
    .optional(),
})

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL'] }, async (ctx) => {
    const schoolId = ctx.schoolId

    // 1 — the new workflow is feature-flagged OFF by default.
    await assertAdmissionsIssuanceEnabled(schoolId)

    // 2 — canonical academic year (fail-closed, never invented).
    const academicYear = await requireSchoolAcademicYear(schoolId)

    // 3 — input contract.
    let body: z.infer<typeof quoteBodySchema>
    try {
      body = quoteBodySchema.parse(await req.json().catch(() => ({})))
    } catch {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Invalid quote request. A classId is required; quantities must be whole numbers between 1 and 99.',
        internalDetail: 'fees/quote: body validation failed',
      })
    }

    // 4 — class FK must exist in THIS school (no cross-tenant oracle).
    const cls = await db.class.findFirst({
      where: { id: body.classId, schoolId },
      select: { id: true, name: true, section: true },
    })
    if (!cls) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Class not found',
        internalDetail: 'fees/quote: classId missing or foreign tenant',
      })
    }

    // 5 — the one server-side quote computation.
    const quote = await computeAdmissionQuote(db, {
      schoolId,
      classId: body.classId,
      academicYear,
      selections: body.selections,
    })

    // 6 — the structure's selectable heads (so the UI can render the
    // selection surface without a second round trip).
    const structure = await db.feeStructure.findUnique({
      where: { id: quote.structureId },
      include: { heads: { orderBy: { sortOrder: 'asc' } } },
    })
    const selectableHeads = (structure?.heads ?? [])
      .filter((h) => h.active)
      .map((h) => ({
        id: h.id,
        name: h.name,
        category: h.category,
        kind: h.kind,
        frequency: h.frequency,
        mandatory: h.mandatory,
        unitAmount: num(h.amount),
      }))

    return {
      academicYear,
      classId: quote.classId,
      className: quote.className,
      structureId: quote.structureId,
      structureVersion: quote.structureVersion,
      selectableHeads,
      quote,
    }
  })
}
