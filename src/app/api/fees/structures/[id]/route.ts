import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db, trackedTransaction } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/// Phase 8A — bounded money validation for structure head amounts
/// (was `Number(h.amount) || 0`, silently 0-ing garbage).
const headAmountSchema = z.coerce.number().finite().min(0).max(500000)

/// GET /api/fees/structures/[id] — full structure with heads + versions.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const structure = await db.feeStructure.findFirst({
      where: { id, schoolId },
      include: {
        heads: { orderBy: { sortOrder: 'asc' } },
        versions: { orderBy: { version: 'desc' } },
      },
    })
    if (!structure) throw new AppError('RESOURCE_NOT_FOUND')
    // Phase 8A: FeeHead.amount is Prisma.Decimal — emit numbers.
    return { ...structure, heads: structure.heads.map((h) => ({ ...h, amount: num(h.amount) })) }
  })
}

/// PATCH /api/fees/structures/[id] — amend a DRAFT or ARCHIVED structure
/// (current structures must be archived first; the publish endpoint creates
/// a new version). Body: { className?, classLevel?, heads?: [{id?, catalogueId, name, amount, frequency, mandatory, category, active}] }
///
/// 3-c fixes:
///   · heads[] capped at 60.
///   · every head catalogueId FK-validated in-tenant against MasterFeeHead.
///   · the head replacement (deleteMany + re-create) now runs inside ONE
///     db.$transaction together with the structure update — a failure
///     mid-replacement can no longer leave the structure headless.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const structure = await db.feeStructure.findFirst({ where: { id, schoolId } })
    if (!structure) throw new AppError('RESOURCE_NOT_FOUND')
    if (structure.status === 'current') {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'Cannot edit a published structure. Archive it first or publish a new version.',
      })
    }

    // If heads array provided, replace line items (only valid in draft).
    if (Array.isArray(body.heads)) {
      if (body.heads.length > 60) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'A fee structure may have at most 60 heads' })
      }

      // ── 3-c fix: catalogue FKs must exist in THIS school ────────────
      const catalogueIds = [
        ...new Set(
          (body.heads as any[])
            .map((h) => (h?.catalogueId ? String(h.catalogueId) : ''))
            .filter((cid) => cid.length > 0),
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
            internalDetail: `structures PATCH: ${catalogueIds.length - found.length} catalogue id(s) missing or foreign tenant`,
          })
        }
      }

      // ── Phase 8A — bounded money validation per head BEFORE the ─
      // replacement write (was `Number(h.amount) || 0`).
      const heads = body.heads as any[]
      const parsedHeadAmounts = heads.map((h) => headAmountSchema.default(0).safeParse(h?.amount))
      if (parsedHeadAmounts.some((r) => !r.success)) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'Each fee head amount must be a number between 0 and 500000',
        })
      }

      // ── 3-c fix: atomic head replacement + structure update ─────────
      const updated = await trackedTransaction('fee-structure-update', async (tx) => {
        await tx.feeHead.deleteMany({ where: { structureId: id } })
        for (let i = 0; i < heads.length; i++) {
          const h = heads[i]
          await tx.feeHead.create({
            data: {
              schoolId,
              structureId: id,
              catalogueId: h.catalogueId || null,
              name: String(h.name || ''),
              category: String(h.category || 'Other'),
              amount: parsedHeadAmounts[i].data,
              frequency: String(h.frequency || 'Monthly'),
              mandatory: h.mandatory !== false,
              active: h.active !== false,
              sortOrder: i,
            },
          })
        }
        return tx.feeStructure.update({
          where: { id },
          data: {
            ...(body.className ? { className: String(body.className) } : {}),
            ...(body.classLevel ? { classLevel: String(body.classLevel) } : {}),
          },
          include: { heads: { orderBy: { sortOrder: 'asc' } } },
        })
      })
      return { ...updated, heads: updated.heads.map((h) => ({ ...h, amount: num(h.amount) })) }
    }

    const updated = await db.feeStructure.update({
      where: { id },
      data: {
        ...(body.className ? { className: String(body.className) } : {}),
        ...(body.classLevel ? { classLevel: String(body.classLevel) } : {}),
      },
      include: { heads: { orderBy: { sortOrder: 'asc' } } },
    })
    return { ...updated, heads: updated.heads.map((h) => ({ ...h, amount: num(h.amount) })) }
  })
}

/// DELETE /api/fees/structures/[id] — only DRAFT structures can be deleted.
/// Current/archived/scheduled are soft-deleted (status set to 'archived'
/// with archivedAt + archivedReason) for audit integrity.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const reason = searchParams.get('reason') || 'No reason provided'
    const structure = await db.feeStructure.findFirst({ where: { id, schoolId } })
    if (!structure) throw new AppError('RESOURCE_NOT_FOUND')

    if (structure.status === 'draft') {
      await db.feeStructure.delete({ where: { id } })
      return { ok: true, deleted: true }
    }
    // Otherwise soft-delete (archive).
    await db.feeStructure.update({
      where: { id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
        archivedReason: reason,
      },
    })
    return { ok: true, archived: true }
  })
}
