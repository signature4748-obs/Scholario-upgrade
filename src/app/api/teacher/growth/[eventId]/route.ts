import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireTeacher, assertStudentInScope, auditTeacherAction, parseString } from '@/lib/teacher-hub'
import { growthSettingsFor } from '@/lib/growth/service'
import { toGrowthEventItem } from '@/lib/growth/service'

export const runtime = 'nodejs'

// PATCH /api/teacher/growth/[eventId] — correct a manual point (§29).
//
// Teachers never silently rewrite history: the original event is marked
// SUPERSEDED (with the correction note) and a NEW correction event is
// created carrying the corrected points, linked via correctsId. The full
// chain stays in the ledger — the score counts only ACTIVE events, the
// audit trail shows exactly what changed and why.
//
// AUTHORIZATION: only the event's creator may correct it (the Principal
// can inspect everything; a full principal-side correction UI comes with
// the later configuration surface §18).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { eventId } = await params

      const original = await db.growthEvent.findFirst({
        where: { id: eventId, schoolId: ctx.schoolId },
        include: {
          createdBy: { select: { id: true, name: true } },
          student: {
            select: {
              id: true,
              user: { select: { name: true } },
              class: { select: { name: true, section: true } },
            },
          },
        },
      })
      if (!original) throw new Error('Point event not found')
      if (original.source !== 'MANUAL') {
        throw new Error('Automatic events cannot be edited — they derive from official records')
      }
      if (original.createdById !== ctx.userId) {
        throw new Error('Only the teacher who recorded this point can correct it')
      }

      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const settings = await growthSettingsFor(ctx.schoolId)
      const points =
        body.points == null ? original.points : typeof body.points === 'number' ? Math.round(body.points) : Number.NaN
      if (!Number.isFinite(points) || points === 0) throw new Error('Points must be a non-zero number')
      if (points > settings.maxManualPoints || points < settings.minManualPoints) {
        throw new Error(`Points must be between ${settings.minManualPoints} and ${settings.maxManualPoints}`)
      }
      const note = body.note === undefined ? original.note : parseString(body.note, 'Note', { max: 500 })
      const correctionNote = parseString(body.correctionNote, 'Correction reason', { required: true, max: 200 })

      // re-validate the student is still inside the teacher's scope
      await assertStudentInScope(ctx, original.studentId)

      // Phase 4: array-form $transaction migrated to the interactive form
      // (same two sequential operations, same order) so the correction is
      // label-tracked as a unit.
      const [updated, correction] = await trackedTransaction('growth-point-correction', async (tx) => {
        const updated = await tx.growthEvent.update({
          where: { id: original.id },
          data: { status: 'SUPERSEDED', correctionNote },
        })
        const correction = await tx.growthEvent.create({
          data: {
            schoolId: ctx.schoolId,
            studentId: original.studentId,
            createdById: ctx.userId,
            points,
            category: original.category,
            reason: original.reason,
            note,
            source: 'MANUAL',
            sourceRef: original.sourceRef,
            period: original.period,
            status: 'ACTIVE',
            correctsId: original.id,
            correctionNote,
            effectiveAt: original.effectiveAt,
            dedupeKey: `m:${crypto.randomUUID()}`,
          },
          include: {
            createdBy: { select: { id: true, name: true } },
            student: {
              select: {
                id: true,
                user: { select: { name: true } },
                class: { select: { name: true, section: true } },
              },
            },
          },
        })
        return [updated, correction] as const
      })

      await auditTeacherAction(
        user,
        ctx.schoolId,
        'GROWTH_POINT_CORRECTED',
        `${original.points >= 0 ? '+' : ''}${original.points} → ${points >= 0 ? '+' : ''}${points} (${original.reason}) for ${original.student?.user?.name ?? 'student'}: ${correctionNote}`,
      )

      return { original: toGrowthEventItem({ ...updated, createdBy: original.createdBy, student: original.student }), correction: toGrowthEventItem(correction) }
    },
    { roles: ['TEACHER'] },
  )
}
