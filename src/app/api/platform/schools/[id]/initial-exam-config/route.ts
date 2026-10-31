import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const examConfigSchema = strictBody({
  examTypes: z
    .array(
      strictBody({
        name: safeText(100),
        code: safeText(20).optional(),
      }),
    )
    .max(20)
    .optional(),
  gradeScales: z
    .array(
      strictBody({
        grade: safeText(10),
        minPct: z.coerce.number().min(0).max(100),
        maxPct: z.coerce.number().min(0).max(100),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }),
    )
    .max(15)
    .optional(),
})

/**
 * POST /api/platform/schools/[id]/initial-exam-config — OPTIONAL initial
 * examination configuration seeding (PHASE 2 Setup wizard, Exams step).
 *
 * Writes ONLY the school's exam VOCABULARY rows:
 *   · ExamTypeConfig (the exam types the school's Exams module offers),
 *   · GradeScale (the percentage→grade bands used by results).
 *
 * It creates NO Exam instance, NO marks, NO results and declares NO
 * class/subject applicability — examination EXECUTION stays entirely
 * the school's routine work through the existing Exams module and its
 * own settings APIs (which keep their exams.settings.write permission).
 *
 * Idempotent: types dedupe on (schoolId, name), grades on (schoolId,
 * grade) — Save-and-Continue never duplicates configuration. minPct ≤
 * maxPct is validated per band.
 *
 * Permission: schools.manage. Audited: platform.school.exam_config_seeded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, examConfigSchema)
    const ip = clientIpFromHeaders(req.headers)

    if (!body.examTypes?.length && !body.gradeScales?.length) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Nothing to save — send exam types or grade scales',
      })
    }

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'initial-exam-config: no such school',
      })
    }

    const [existingTypes, existingGrades] = await Promise.all([
      body.examTypes?.length
        ? db.examTypeConfig.findMany({ where: { schoolId: school.id }, select: { name: true } })
        : Promise.resolve([]),
      body.gradeScales?.length
        ? db.gradeScale.findMany({ where: { schoolId: school.id }, select: { grade: true } })
        : Promise.resolve([]),
    ])
    const typeNames = new Set(existingTypes.map((t) => t.name.trim().toLowerCase()))
    const grades = new Set(existingGrades.map((g) => g.grade.trim().toLowerCase()))

    const createdTypes: Array<{ id: string; name: string }> = []
    const duplicateTypes: string[] = []
    for (const t of body.examTypes ?? []) {
      const key = t.name.trim().toLowerCase()
      if (!key || typeNames.has(key)) {
        duplicateTypes.push(t.name)
        continue
      }
      typeNames.add(key)
      const row = await db.examTypeConfig.create({
        data: {
          schoolId: school.id,
          name: t.name.trim(),
          ...(t.code ? { code: t.code } : {}),
        },
      })
      createdTypes.push({ id: row.id, name: row.name })
    }

    const createdScales: Array<{ id: string; grade: string; minPct: number; maxPct: number }> = []
    const duplicateScales: string[] = []
    for (const g of body.gradeScales ?? []) {
      if (g.minPct > g.maxPct) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `Grade "${g.grade}": minimum percentage cannot exceed the maximum`,
        })
      }
      const key = g.grade.trim().toLowerCase()
      if (!key || grades.has(key)) {
        duplicateScales.push(g.grade)
        continue
      }
      grades.add(key)
      const row = await db.gradeScale.create({
        data: {
          schoolId: school.id,
          grade: g.grade.trim(),
          minPct: g.minPct,
          maxPct: g.maxPct,
          ...(g.color ? { color: g.color } : {}),
        },
      })
      createdScales.push({
        id: row.id,
        grade: row.grade,
        minPct: row.minPct,
        maxPct: row.maxPct,
      })
    }

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.exam_config_seeded',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'initial exam configuration (setup wizard)',
      metadata: {
        examTypesCreated: createdTypes.length,
        examTypesDuplicates: duplicateTypes.length,
        gradeScalesCreated: createdScales.length,
        gradeScalesDuplicates: duplicateScales.length,
      },
    })

    return {
      ok: true,
      createdTypes,
      duplicateTypes,
      createdScales,
      duplicateScales,
    }
  })
}
