import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import {
  requireTeacher,
  auditTeacherAction,
  parseString,
  toStudentRef,
} from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import type { ThreadPayload } from '@/lib/teacher-hub-types'

export const runtime = 'nodejs'

const CATEGORIES = ['general', 'academic', 'attendance', 'behavior', 'wellbeing', 'urgent']

async function ownedConversation(ctx: { schoolId: string; userId: string }, id: string) {
  const conversation = await db.parentConversation.findFirst({
    where: { id, schoolId: ctx.schoolId, teacherId: ctx.userId },
    include: {
      parent: { select: { id: true, name: true, phone: true } },
      student: {
        select: {
          id: true,
          rollNo: true,
          classId: true,
          class: { select: { name: true, section: true } },
          user: { select: { name: true } },
        },
      },
    },
  })
  if (!conversation) throw new Error('Conversation not found')
  return conversation
}

// GET /api/teacher/parent-connect/[conversationId] — full thread. Marks the
// parent's messages read (the teacher just opened them) before returning.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { conversationId } = await params
      const conversation = await ownedConversation(ctx, conversationId)

      await db.parentMessage.updateMany({
        where: { conversationId: conversation.id, senderId: { not: ctx.userId }, readAt: null },
        data: { readAt: new Date() },
      })

      const messages = await db.parentMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })

      const payload: ThreadPayload = {
        conversation: {
          id: conversation.id,
          category: (CATEGORIES.includes(conversation.category)
            ? conversation.category
            : 'general') as ThreadPayload['conversation']['category'],
          pinned: conversation.pinned,
          needsReply: conversation.needsReply,
          archived: conversation.archived,
          createdAt: conversation.createdAt.toISOString(),
          parent: {
            id: conversation.parent.id,
            name: conversation.parent.name ?? 'Guardian',
            phone: conversation.parent.phone ?? null,
          },
          student: toStudentRef(conversation.student),
          teacher: { name: ctx.name },
        },
        messages: messages.map((m) => ({
          id: m.id,
          fromTeacher: m.senderId === ctx.userId,
          senderName: m.senderId === ctx.userId ? ctx.name : (conversation.parent.name ?? 'Guardian'),
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          readAt: m.readAt ? m.readAt.toISOString() : null,
        })),
      }
      return payload
    },
    { roles: ['TEACHER'] },
  )
}

// POST /api/teacher/parent-connect/[conversationId] — send a message.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  return withUser(
    async (user) => {
      // Message send — per-user throttle (same profile as the messaging
      // routes; see rate-limit.ts RATE_LIMITS.message).
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)
      const ctx = await requireTeacher(user)
      const { conversationId } = await params
      const conversation = await ownedConversation(ctx, conversationId)

      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')
      const text = parseString(body.body, 'Message', { required: true, max: 2000 })
      if (!text) throw new Error('Message is required')

      const now = new Date()
      const message = await db.parentMessage.create({
        data: {
          schoolId: ctx.schoolId,
          conversationId: conversation.id,
          senderId: ctx.userId,
          body: text,
        },
      })
      await db.parentConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      })

      await auditTeacherAction(
        user,
        ctx.schoolId,
        'PARENT_MESSAGE_SENT',
        `Message to ${conversation.parent.name ?? 'guardian'} regarding ${conversation.student.user?.name ?? 'student'} (conversation ${conversation.id})`,
      )

      return {
        message: {
          id: message.id,
          fromTeacher: true,
          senderName: ctx.name,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          readAt: null,
        },
      }
    },
    { roles: ['TEACHER'] },
  )
}

// PATCH /api/teacher/parent-connect/[conversationId] — conversation state.
// All flags persist on the ParentConversation row (never React state):
//   pinned / category      — as before
//   needsReply / archived  — the Communication Hub action menu
//   markRead               — acknowledge unread parent messages WITHOUT opening
//   markUnread             — flip the latest parent message back to unread
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { conversationId } = await params
      const conversation = await ownedConversation(ctx, conversationId)

      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const data: { pinned?: boolean; category?: string; needsReply?: boolean; archived?: boolean } = {}
      if (typeof body.pinned === 'boolean') data.pinned = body.pinned
      if (typeof body.needsReply === 'boolean') data.needsReply = body.needsReply
      if (typeof body.archived === 'boolean') data.archived = body.archived
      if (typeof body.category === 'string' && CATEGORIES.includes(body.category)) {
        data.category = body.category
      }

      if (body.markRead === true) {
        await db.parentMessage.updateMany({
          where: { conversationId: conversation.id, senderId: { not: ctx.userId }, readAt: null },
          data: { readAt: new Date() },
        })
      }
      if (body.markUnread === true) {
        // Flip only the LATEST parent message back to unread — the honest
        // "badge re-appears" semantics without resurrecting old history.
        const latestFromParent = await db.parentMessage.findFirst({
          where: { conversationId: conversation.id, senderId: { not: ctx.userId } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (latestFromParent) {
          await db.parentMessage.update({
            where: { id: latestFromParent.id },
            data: { readAt: null },
          })
        }
      }

      if (Object.keys(data).length === 0 && body.markRead !== true && body.markUnread !== true) {
        throw new Error('Nothing to update')
      }
      if (Object.keys(data).length > 0) {
        await db.parentConversation.update({ where: { id: conversation.id }, data })
      }
      await auditTeacherAction(
        user,
        ctx.schoolId,
        'PARENT_CONVERSATION_UPDATED',
        `Conversation ${conversation.id} updated (${[...Object.keys(data), ...(body.markRead ? ['markRead'] : []), ...(body.markUnread ? ['markUnread'] : [])].join(', ')})`,
      )
      return { ok: true }
    },
    { roles: ['TEACHER'] },
  )
}
