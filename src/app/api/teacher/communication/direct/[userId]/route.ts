import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireTeacher, parseString, auditTeacherAction } from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import { publishToUser } from '@/lib/realtime/publish'
import type { DirectThreadPayload } from '@/components/teacher/modules/communication/types'

export const runtime = 'nodejs'

const THREAD_TAKE = 200

// GET /api/teacher/communication/direct/[userId] — the full direct thread
// between the session teacher and one counterpart (a staff member, or any
// user the Message engine has connected them with). Marks the received,
// unread messages read server-side before returning — the caller clears its
// local unread badge from the payload.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { userId } = await params

      const counterpart = await db.user.findFirst({
        where: { id: userId, schoolId: ctx.schoolId },
        select: { id: true, name: true, role: true, status: true },
      })
      if (!counterpart || counterpart.status !== 'ACTIVE') {
        throw new Error('Conversation participant not found in your school')
      }

      const [rows] = await Promise.all([
        db.message.findMany({
          where: {
            schoolId: ctx.schoolId,
            OR: [
              { senderId: ctx.userId, recipientId: counterpart.id },
              { senderId: counterpart.id, recipientId: ctx.userId },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: THREAD_TAKE,
        }),
        // Reading the thread marks the counterpart's messages read.
        db.message.updateMany({
          where: {
            schoolId: ctx.schoolId,
            senderId: counterpart.id,
            recipientId: ctx.userId,
            read: false,
          },
          data: { read: true },
        }),
      ])

      const payload: DirectThreadPayload = {
        counterpart: {
          id: counterpart.id,
          name: counterpart.name ?? 'User',
          role: counterpart.role,
        },
        messages: rows.map((m) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          fromMe: m.senderId === ctx.userId,
          senderName:
            m.senderId === ctx.userId ? ctx.name : (counterpart.name ?? 'User'),
          read: m.read,
          createdAt: m.createdAt.toISOString(),
        })),
      }
      return payload
    },
    { roles: ['TEACHER'] },
  )
}

// PATCH /api/teacher/communication/direct/[userId] — persist the viewer's
// conversation state for this direct thread. Pin / archive / needs-reply
// live in DirectThreadState (one row per user↔counterpart — per-user, in
// the DATABASE, never React state or localStorage). markUnread flips the
// latest received message back to read=false so the badge re-appears.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)
      const { userId } = await params
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const counterpart = await db.user.findFirst({
        where: { id: userId, schoolId: ctx.schoolId },
        select: { id: true },
      })
      if (!counterpart) throw new Error('Conversation participant not found in your school')

      const data: { pinned?: boolean; archived?: boolean; needsReply?: boolean } = {}
      if (typeof body.pinned === 'boolean') data.pinned = body.pinned
      if (typeof body.archived === 'boolean') data.archived = body.archived
      if (typeof body.needsReply === 'boolean') data.needsReply = body.needsReply

      if (body.markUnread === true) {
        // Flip only the LATEST received message back to unread — the
        // badge re-appears without resurrecting the whole history.
        const latestReceived = await db.message.findFirst({
          where: { schoolId: ctx.schoolId, senderId: counterpart.id, recipientId: ctx.userId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (latestReceived) {
          await db.message.update({ where: { id: latestReceived.id }, data: { read: false } })
        }
      }
      if (body.markRead === true) {
        await db.message.updateMany({
          where: { schoolId: ctx.schoolId, senderId: counterpart.id, recipientId: ctx.userId, read: false },
          data: { read: true },
        })
      }

      const touched =
        Object.keys(data).length > 0 || body.markRead === true || body.markUnread === true
      if (!touched) throw new Error('Nothing to update')

      if (Object.keys(data).length > 0) {
        await db.directThreadState.upsert({
          where: { userId_counterpartId: { userId: ctx.userId, counterpartId: counterpart.id } },
          create: { schoolId: ctx.schoolId, userId: ctx.userId, counterpartId: counterpart.id, ...data },
          update: data,
        })
      }
      await auditTeacherAction(
        user,
        ctx.schoolId,
        'DIRECT_THREAD_UPDATED',
        `Direct thread with ${counterpart.id} updated (${[...Object.keys(data), ...(body.markRead ? ['markRead'] : []), ...(body.markUnread ? ['markUnread'] : [])].join(', ')})`,
      )
      return { ok: true }
    },
    { roles: ['TEACHER'] },
  )
}

// POST /api/teacher/communication/direct/[userId] — send a direct message to
// a same-school counterpart (Message row; the shared /api/messages engine's
// persistence, scoped through the teacher session).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return withUser(
    async (user) => {
      // Message send — per-user throttle (same profile as the messaging
      // routes; see rate-limit.ts RATE_LIMITS.message).
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)
      const ctx = await requireTeacher(user)
      const { userId } = await params
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const subject = parseString(body.subject, 'Subject', { required: true, max: 200 })
      const messageBody = parseString(body.body, 'Message', { required: true, max: 4000 })
      if (!subject || !messageBody) throw new Error('Subject and message are required')

      const counterpart = await db.user.findFirst({
        where: { id: userId, schoolId: ctx.schoolId, status: 'ACTIVE' },
        select: { id: true, name: true, role: true },
      })
      if (!counterpart) throw new Error('Recipient not found in your school')
      if (counterpart.id === ctx.userId) throw new Error('You cannot message yourself')

      const created = await db.message.create({
        data: {
          schoolId: ctx.schoolId,
          senderId: ctx.userId,
          recipientId: counterpart.id,
          subject,
          body: messageBody,
        },
      })

      // PHASE 8B — realtime 'message' hint to the recipient (fire-and-forget,
      // ids + 80-char preview only — the same discipline as the
      // /api/messaging/threads publish). The recipient's user channel is the
      // addressee's alone: message content never rides a school channel.
      // AWAITED (Phase 8C-N fix — Vercel freezes the function after the
      // response; un-awaited publish fetches never complete).
      await publishToUser(ctx.schoolId, counterpart.id, 'message', {
        id: created.id,
        at: created.createdAt.toISOString(),
        schoolId: ctx.schoolId,
        recipientId: counterpart.id,
        senderName: ctx.name,
        subject,
        preview: messageBody.slice(0, 80),
      })

      return {
        message: {
          id: created.id,
          subject: created.subject,
          body: created.body,
          fromMe: true,
          senderName: ctx.name,
          read: false,
          createdAt: created.createdAt.toISOString(),
        },
      }
    },
    { roles: ['TEACHER'] },
  )
}
