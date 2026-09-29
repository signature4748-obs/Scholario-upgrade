import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

// Task 4-d (audit 3-a fix #12): the SAME room-type whitelist the POST
// route applies (duplicated here — route.ts modules must not import from
// each other under Next's route-export validation).
const ROOM_TYPES = [
  'Classroom',
  'Science Lab',
  'Computer Lab',
  'Library',
  'Auditorium',
  'Music Room',
  'Art Room',
  'Sports Facility',
  'Staff Room',
  'Other',
] as const

/**
 * PATCH /api/rooms/[id] — edit or archive a room (PRINCIPAL/MANAGEMENT).
 *
 * Body (partial): { name?, code?, building?, floor?, capacity?, type?, active? }
 *
 *   · RENAME propagates everywhere: the room NAME is the display value every
 *     class card/detail renders (Class.room is the projection of the FK) —
 *     the rename re-projects `Class.room` for every assigned class in the
 *     same transaction flow.
 *   · ARCHIVE (active=false) is BLOCKED while a class still holds the room —
 *     the assignment must move first (no silent breakage). Archived rooms
 *     stay queryable (historical records remain valid) and simply drop out
 *     of new-assignment pickers.
 *
 * DELETE is intentionally NOT exposed — rooms are reference data; archive
 * is the lifecycle. (Hard deletion belongs to platform tooling if ever.)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params
      const body = await req.json().catch(() => ({}))

      const room = await db.room.findFirst({ where: { id, schoolId } })
      if (!room) throw new Error('Room not found')

      const patch: {
        name?: string
        code?: string | null
        building?: string | null
        floor?: string | null
        capacity?: number | null
        type?: string
        active?: boolean
      } = {}

      if (body.name !== undefined) {
        const name = String(body.name).trim()
        if (!name) throw new Error('Room name is required')
        if (name.toLowerCase() !== room.name.toLowerCase()) {
          const clash = await db.room.findFirst({
            where: { schoolId, name: { equals: name } },
            select: { id: true },
          })
          if (clash) throw new Error(`Room "${name}" already exists in this school`)
        }
        patch.name = name
      }
      if (body.code !== undefined) patch.code = String(body.code).trim() || null
      if (body.building !== undefined) patch.building = String(body.building).trim() || null
      if (body.floor !== undefined) patch.floor = String(body.floor).trim() || null
      if (body.capacity !== undefined) {
        const c = Number(body.capacity)
        patch.capacity = Number.isFinite(c) && c > 0 ? Math.round(c) : null
      }
      if (body.type !== undefined && typeof body.type === 'string') {
        // Type must be a whitelisted room kind — free-form strings are
        // rejected (the POST route coerces to 'Classroom'; PATCH is an
        // explicit edit, so a bad value is a 422 the caller can fix).
        const type = body.type.trim()
        if (!ROOM_TYPES.includes(type as (typeof ROOM_TYPES)[number])) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid room type' })
        }
        patch.type = type
      }

      if (body.active !== undefined) {
        const nextActive = Boolean(body.active)
        if (!nextActive && room.active) {
          // ARCHIVE GUARD — a room still held by a class cannot be archived.
          const holder = await db.class.findFirst({
            where: { schoolId, roomId: room.id },
            select: { name: true, section: true },
          })
          if (holder) {
            throw new Error(
              `Assigned to ${classLabelOf(holder)} — reassign or clear the room before archiving it.`,
            )
          }
        }
        patch.active = nextActive
      }

      const updated = await db.room.update({ where: { id: room.id }, data: patch })

      // NAME PROPAGATION — keep the denormalized Class.room display value
      // in sync for every class holding this room (one write, no drift).
      if (patch.name !== undefined && patch.name !== room.name) {
        await db.class.updateMany({
          where: { schoolId, roomId: room.id },
          data: { room: patch.name },
        })
      }

      await db.activityLog.create({
        data: {
          schoolId,
          userId: user.id,
          action: 'ROOM_UPDATED',
          detail: `Room "${updated.name}" updated${patch.active === false ? ' (archived)' : patch.active === true ? ' (reactivated)' : ''}`,
        },
      })

      return {
        id: updated.id,
        name: updated.name,
        code: updated.code,
        building: updated.building,
        floor: updated.floor,
        capacity: updated.capacity,
        type: updated.type,
        active: updated.active,
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
