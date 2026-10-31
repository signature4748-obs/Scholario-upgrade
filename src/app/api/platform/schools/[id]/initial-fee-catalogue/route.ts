import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/** Same vocabularies as the school fee module (MasterFeeHead columns). */
const FEE_CATEGORIES = [
  'Tuition',
  'Admission',
  'Annual',
  'Transport',
  'Lab',
  'Library',
  'Exam',
  'Activity',
  'Board',
  'Other',
] as const

const FEE_FREQUENCIES = [
  'Annual',
  'Half-Yearly',
  'Quarterly',
  'Monthly',
  'Per Term',
  'One-Time',
] as const

const catalogueSchema = strictBody({
  heads: z
    .array(
      strictBody({
        name: safeText(80),
        category: z.enum(FEE_CATEGORIES).default('Other'),
        frequency: z.enum(FEE_FREQUENCIES).default('Monthly'),
        amount: z.coerce.number().min(0).max(500_000),
        mandatory: z.boolean().default(true),
        description: safeText(300).optional(),
      }),
    )
    .min(1)
    .max(60),
})

/**
 * POST /api/platform/schools/[id]/initial-fee-catalogue — OPTIONAL
 * initial fee-head catalogue seeding (PHASE 2 Setup wizard, Fees step).
 *
 * Writes ONLY the school's MasterFeeHead CATALOGUE (the master list of
 * fee heads the school's fee module builds structures from). It creates
 * NO FeeStructure, publishes NO version, records NO transaction and NO
 * receipt — structure building and publishing stay the school
 * principal's routine work through the EXISTING fee module (with its
 * versioned publish flow and its academic-year fail-closed gate).
 *
 * Idempotent: a head whose (schoolId, name) already exists is reported
 * as a duplicate and skipped — Save-and-Continue never duplicates the
 * catalogue. Amounts are validated 0..500000 (the same bound the school
 * fee APIs enforce).
 *
 * Permission: schools.manage. Audited: platform.school.fee_catalogue_seeded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, catalogueSchema)
    const ip = clientIpFromHeaders(req.headers)

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'initial-fee-catalogue: no such school',
      })
    }

    const existing = await db.masterFeeHead.findMany({
      where: { schoolId: school.id },
      select: { name: true },
    })
    const existingNames = new Set(existing.map((h) => h.name.trim().toLowerCase()))

    const created: Array<{ id: string; name: string; category: string; amount: number }> = []
    const duplicates: string[] = []
    const seen = new Set<string>()

    for (const head of body.heads) {
      const key = head.name.trim().toLowerCase()
      if (!key || existingNames.has(key) || seen.has(key)) {
        duplicates.push(head.name)
        continue
      }
      seen.add(key)
      const row = await db.masterFeeHead.create({
        data: {
          schoolId: school.id,
          name: head.name.trim(),
          category: head.category,
          frequency: head.frequency,
          amount: head.amount,
          mandatory: head.mandatory,
          ...(head.description ? { description: head.description } : {}),
        },
      })
      created.push({
        id: row.id,
        name: row.name,
        category: row.category,
        amount: row.amount.toNumber(),
      })
    }

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.fee_catalogue_seeded',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'initial fee catalogue (setup wizard)',
      metadata: {
        created: created.length,
        duplicates: duplicates.length,
        // Head NAMES only — amounts stay out of the audit metadata.
        names: created.map((c) => c.name).slice(0, 60),
      },
    })

    return { ok: true, created, duplicates }
  })
}
