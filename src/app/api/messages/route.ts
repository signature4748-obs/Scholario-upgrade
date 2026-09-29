import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'
import { idSchema } from '@/lib/security/validation'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

// GET messages for the current user (inbox + sent)
export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const { searchParams } = new URL(req.url)
    const box = searchParams.get('box') || 'inbox' // inbox | sent

    const where = box === 'sent'
      ? { schoolId, senderId: user.id }
      : { schoolId, recipientId: user.id }

    const messages = await db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
    })
    return messages
  })
}

// POST send a new message
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)

      // Phase 1 — message sending is rate-limited (40/hour per account):
      // bulk role sends count once, but a hostile/hijacked account cannot
      // spray the school with notifications.
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)

      const body = await req.json().catch(() => ({}))
      const subject = String(body.subject || '').trim().slice(0, 200)
      const messageBody = String(body.body || '').trim().slice(0, 4000)
      const recipientRaw = String(body.recipientId || '').trim()
      // Malformed ids (path/traversal junk, wrong shape) are rejected
      // before any DB lookup.
      if (recipientRaw && !idSchema.safeParse(recipientRaw).success) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid recipient' })
      }

      if (!subject || !messageBody) {
        throw new Error('Subject and message are required')
      }

      // Bulk mode: send to all users with a specific role in the school
      if (body.bulk && body.role) {
        const ROLE_ENUM: readonly string[] = ['PRINCIPAL', 'MANAGEMENT', 'TEACHER', 'STUDENT', 'PARENT', 'DRIVER']
        if (!ROLE_ENUM.includes(String(body.role))) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid role for bulk message' })
        }
        const recipients = await db.user.findMany({
          where: { schoolId, role: body.role, status: 'ACTIVE', id: { not: user.id } },
          select: { id: true },
        })

        if (recipients.length === 0) {
          throw new Error(`No ${body.role.toLowerCase()}s found to message`)
        }

        await db.message.createMany({
          data: recipients.map((r) => ({
            schoolId,
            senderId: user.id,
            recipientId: r.id,
            subject,
            body: messageBody,
          })),
        })

        return { bulk: true, sentCount: recipients.length, role: body.role }
      }

      // Single recipient mode
      const recipientId = String(body.recipientId || '').trim()
      if (!recipientId) {
        throw new Error('Recipient is required (or use bulk mode with role)')
      }

      // Verify recipient is in the same school AND ACTIVE — a suspended
      // or deactivated account must not receive new mail (fail-safe
      // NOT_FOUND, same message shape the compose flows expect).
      // (Task 4-d, audit 3-a fix #18; recipient schoolId was already
      // enforced in Phase 1.)
      const recipient = await db.user.findFirst({
        where: { id: recipientId, schoolId, status: 'ACTIVE' },
        select: { id: true, name: true },
      })
      if (!recipient) {
        throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Recipient not found' })
      }

      const msg = await db.message.create({
        data: {
          schoolId,
          senderId: user.id,
          recipientId,
          subject,
          body: messageBody,
        },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          recipient: { select: { id: true, name: true, role: true } },
        },
      })
      return msg
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] }
  )
}

// PATCH mark as read
export async function PATCH(req: NextRequest) {
  return withUser(async (user) => {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '')
    if (!id) throw new Error('Message id required')

    const msg = await db.message.findUnique({ where: { id } })
    if (!msg || msg.recipientId !== user.id) throw new Error('NOT_FOUND')

    const updated = await db.message.update({
      where: { id },
      data: { read: true },
    })
    return { id: updated.id, read: updated.read }
  })
}
