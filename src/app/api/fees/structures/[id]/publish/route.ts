import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/// POST /api/fees/structures/[id]/publish
///
/// Publish a draft structure → current. Workflow:
///   1. Load the structure (must be a draft or scheduled).
///   2. If a 'current' structure already exists for the same classId:
///      - The OLD current is archived (effectiveTo = now, status='archived').
///   3. The draft is promoted to 'current' (status='current', version++,
///      publishedAt = now, effectiveFrom = now if not already set).
///   4. A FeeStructureVersion snapshot is created (immutable, full JSON).
///   5. Returns the promoted structure.
///
/// Phase 3: steps 2–4 are ONE prisma.$transaction (the 3-write versioning
/// flow was non-atomic — a crash between them left a class with NO current
/// structure or an unversioned promote). A P2002 from the
/// (schoolId, classId, status) unique (two publishes racing for the same
/// class) is translated to a clean 409 CONFLICT.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params
      const structure = await db.feeStructure.findFirst({
        where: { id, schoolId },
        include: { heads: true },
      })
      if (!structure) throw new Error('NOT_FOUND')
      if (structure.status !== 'draft' && structure.status !== 'scheduled') {
        throw new Error(`Only draft or scheduled structures can be published (got ${structure.status})`)
      }

      const now = new Date()

      try {
        const promoted = await db.$transaction(async (tx) => {
          // Archive any existing 'current' for the same classId.
          const existing = await tx.feeStructure
            .findUnique({
              where: { schoolId_classId_status: { schoolId, classId: structure.classId, status: 'current' } },
            })
            .catch(() => null)
          if (existing && existing.id !== structure.id) {
            await tx.feeStructure.update({
              where: { id: existing.id },
              data: {
                status: 'archived',
                effectiveTo: now,
                archivedAt: now,
                archivedReason: `Superseded by v${structure.version + 1}`,
              },
            })
          }

          // Promote the draft.
          const newVersion = structure.version + 1
          const promoted = await tx.feeStructure.update({
            where: { id: structure.id },
            data: {
              status: 'current',
              version: newVersion,
              publishedAt: now,
              effectiveFrom: structure.effectiveFrom ?? now,
            },
            include: { heads: { orderBy: { sortOrder: 'asc' } } },
          })

          // Snapshot the published structure into the versions table
          // (immutable) — inside the SAME transaction as the promotion so
          // the version trail can never miss a published structure.
          const snapshot = JSON.stringify({
            structureId: promoted.id,
            classId: promoted.classId,
            className: promoted.className,
            classLevel: promoted.classLevel,
            version: newVersion,
            heads: promoted.heads.map((h) => ({
              id: h.id,
              catalogueId: h.catalogueId,
              name: h.name,
              category: h.category,
              amount: h.amount,
              frequency: h.frequency,
              mandatory: h.mandatory,
              active: h.active,
              sortOrder: h.sortOrder,
            })),
            publishedAt: now.toISOString(),
            publishedBy: user.id,
          })
          await tx.feeStructureVersion.create({
            data: {
              schoolId,
              structureId: promoted.id,
              version: newVersion,
              snapshot,
              publishedBy: user.id,
              notes: `Published by ${user.email}`,
            },
          })

          return promoted
        })
        return promoted
      } catch (e) {
        const err = e as { code?: string; message?: string }
        if (err?.code === 'P2002') {
          // (schoolId, classId, status) unique — another publish raced us
          // for this class's current/archived slot.
          throw new AppError('CONFLICT', {
            publicMessage:
              'An archived or current structure already exists for this class — resolve the conflict before publishing.',
            internalDetail: `P2002 on structures publish: ${(err.message ?? '').slice(0, 300)}`,
          })
        }
        throw e
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
