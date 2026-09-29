import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/// GET /api/fees/structures?status=current&classId=C12
/// Returns all fee structures for the school, optionally filtered.
/// Includes heads + catalogue entries.
export async function GET(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const classId = searchParams.get('classId')
    const structures = await db.feeStructure.findMany({
      where: {
        schoolId,
        ...(status ? { status } : {}),
        ...(classId ? { classId } : {}),
      },
      include: {
        heads: { orderBy: { sortOrder: 'asc' } },
        versions: { orderBy: { version: 'desc' }, take: 5 },
        _count: { select: { transactions: true } },
      },
      orderBy: [{ classLevel: 'asc' }, { className: 'asc' }],
    })
    return structures
  })
}

/// POST /api/fees/structures
/// Create a new draft fee structure for a class. Requires PRINCIPAL/MANAGEMENT.
/// Body: { classId, className, classLevel, heads: [{catalogueId, name, amount, frequency, mandatory, category}] }
///
/// 3-c fixes:
///   · classId is FK-validated in-tenant (db.class.findFirst({ id, schoolId })
///     → 404) — was a cross-tenant FK write.
///   · every head catalogueId is FK-validated in-tenant against
///     MasterFeeHead (batch findMany → 404 on any foreign/missing id).
///   · heads[] capped at 60 (unbounded array write).
export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const body = await req.json().catch(() => ({}))
    const classId = String(body.classId || '')
    const className = String(body.className || '')
    const classLevel = String(body.classLevel || 'Primary')
    const heads = Array.isArray(body.heads) ? body.heads : []
    if (!classId || !className) throw new AppError('INVALID_INPUT', { publicMessage: 'classId and className are required' })
    if (heads.length > 60) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'A fee structure may have at most 60 heads' })
    }

    // ── 3-c fix: class FK must exist in THIS school ───────────────────
    const cls = await db.class.findFirst({
      where: { id: classId, schoolId },
      select: { id: true },
    })
    if (!cls) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'Class not found',
        internalDetail: `structures POST: class ${classId} missing or foreign tenant`,
      })
    }

    // ── 3-c fix: catalogue FKs must exist in THIS school ──────────────
    const catalogueIds: string[] = [
      ...new Set(
        (heads as any[])
          .map((h) => (h?.catalogueId ? String(h.catalogueId) : ''))
          .filter((id: string) => id.length > 0),
      ),
    ]
    if (catalogueIds.length > 0) {
      const found = await db.masterFeeHead.findMany({
        where: { id: { in: catalogueIds }, schoolId },
        select: { id: true },
      })
      if (found.length !== catalogueIds.length) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Fee head catalogue entry not found',
          internalDetail: `structures POST: ${catalogueIds.length - found.length} catalogue id(s) missing or foreign tenant`,
        })
      }
    }

    // If a current structure already exists for this class, refuse — the
    // principal must archive or amend instead. Drafts/scheduled are allowed
    // (the @@unique constraint allows one per status per class).
    const existing = await db.feeStructure.findUnique({
      where: { schoolId_classId_status: { schoolId, classId, status: 'current' } },
    }).catch(() => null)
    if (existing) throw new AppError('CONFLICT', { publicMessage: 'A current structure already exists for this class. Archive it first.' })

    const structure = await db.feeStructure.create({
      data: {
        schoolId,
        classId,
        className,
        classLevel,
        status: 'draft',
        version: 1,
        heads: {
          create: heads.map((h: any, i: number) => ({
            schoolId,
            catalogueId: h.catalogueId || null,
            name: String(h.name || ''),
            category: String(h.category || 'Other'),
            amount: Number(h.amount) || 0,
            frequency: String(h.frequency || 'Monthly'),
            mandatory: h.mandatory !== false,
            active: true,
            sortOrder: i,
          })),
        },
      },
      include: { heads: { orderBy: { sortOrder: 'asc' } } },
    })
    return structure
  })
}
