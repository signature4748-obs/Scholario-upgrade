import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { num } from '@/lib/money'

export const runtime = 'nodejs'

/// Phase 8A — bounded money validation for master fee head amounts
/// (was `Number(body.amount) || 0`, silently 0-ing garbage).
const amountSchema = z.coerce.number().finite().min(0).max(500000)

/// GET /api/fees/catalogue — list all master fee heads.
export async function GET() {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const heads = await db.masterFeeHead.findMany({
      where: { schoolId },
      include: {
        _count: { select: { structures: true } },
      },
      orderBy: { sortOrder: 'asc' },
    })
    // Phase 8A: MasterFeeHead.amount is Prisma.Decimal — emit numbers.
    return heads.map((h) => ({ ...h, amount: num(h.amount) }))
  })
}

/// POST /api/fees/catalogue — create a new master fee head.
/// Body: { name, category, frequency, amount, mandatory, description }
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const name = String(body.name || '').trim()
      if (!name) throw new Error('name is required')
      const dup = await db.masterFeeHead.findUnique({
        where: { schoolId_name: { schoolId, name } },
      }).catch(() => null)
      if (dup) throw new Error('A master fee head with this name already exists')

      const maxOrder = await db.masterFeeHead.aggregate({
        where: { schoolId },
        _max: { sortOrder: true },
      })
      // Phase 8A — bounded zod validation (undefined defaults to 0, the
      // old `|| 0` behaviour for absent fields; garbage now 4xxs).
      const parsedAmount = amountSchema.default(0).safeParse(body.amount)
      if (!parsedAmount.success) {
        throw new Error('amount must be a number between 0 and 500000')
      }
      const head = await db.masterFeeHead.create({
        data: {
          schoolId,
          name,
          category: String(body.category || 'Other'),
          frequency: String(body.frequency || 'Monthly'),
          amount: parsedAmount.data,
          mandatory: body.mandatory !== false,
          description: body.description ? String(body.description) : null,
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
      })
      return { ...head, amount: num(head.amount) }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}

/// PATCH /api/fees/catalogue?id=xxx — update a master fee head.
/// Body: { name?, category?, frequency?, amount?, mandatory?, active?, description? }
export async function PATCH(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { searchParams } = new URL(req.url)
      const id = searchParams.get('id')
      if (!id) throw new Error('id query param is required')
      const existing = await db.masterFeeHead.findFirst({ where: { id, schoolId } })
      if (!existing) throw new Error('NOT_FOUND')
      const body = await req.json().catch(() => ({}))

      // If renaming, refuse if the new name collides with another entry.
      if (body.name && body.name !== existing.name) {
        const newName = String(body.name).trim()
        const collision = await db.masterFeeHead.findUnique({
          where: { schoolId_name: { schoolId, name: newName } },
        }).catch(() => null)
        if (collision) throw new Error('Another master fee head with this name already exists')
      }

      // Phase 8A — bounded zod validation when amount is provided.
      let amountUpdate: { amount: number } | Record<string, never> = {}
      if (body.amount !== undefined) {
        const parsedAmount = amountSchema.safeParse(body.amount)
        if (!parsedAmount.success) {
          throw new Error('amount must be a number between 0 and 500000')
        }
        amountUpdate = { amount: parsedAmount.data }
      }

      const updated = await db.masterFeeHead.update({
        where: { id },
        data: {
          ...(body.name ? { name: String(body.name).trim() } : {}),
          ...(body.category ? { category: String(body.category) } : {}),
          ...(body.frequency ? { frequency: String(body.frequency) } : {}),
          ...amountUpdate,
          ...(body.mandatory !== undefined ? { mandatory: body.mandatory } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
        },
      })
      return { ...updated, amount: num(updated.amount) }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
