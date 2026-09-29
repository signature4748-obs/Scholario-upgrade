import { AppError } from '@/lib/security/errors'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import {
  requireTeacher,
  authorizedStudentWhere,
  auditTeacherAction,
  parseString,
  toStudentRef,
  toFollowUpItem,
} from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
import type {
  ConversationSummary,
  ParentConnectPayload,
  ParentLinkableStudent,
} from '@/lib/teacher-hub-types'

export const runtime = 'nodejs'

const CATEGORIES = ['general', 'academic', 'attendance', 'behavior', 'wellbeing', 'urgent']
const ACTIVE_WINDOW_DAYS = 21
const REPLY_WINDOW_DAYS = 90
const MESSAGE_HISTORY_TAKE = 400

// GET /api/teacher/parent-connect — the parent-conversation engine payload in one
// server-resolved call: conversations (with unread + last message), open
// follow-ups, school-approved templates, linkable students and honest stats.
export async function GET() {
  return withUser(
    async (user) => {
      const ctx = await requireTeacher(user)

      const [conversations, followUpRows, templates, scopeStudents] = await Promise.all([
        db.parentConversation.findMany({
          where: { schoolId: ctx.schoolId, teacherId: ctx.userId },
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
          take: 200,
        }),
        db.teacherFollowUp.findMany({
          where: {
            schoolId: ctx.schoolId,
            teacherId: ctx.userId,
            kind: 'parent-connect',
            status: 'open',
          },
          include: {
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
          orderBy: { dueDate: 'asc' },
          take: 50,
        }),
        db.messageTemplate.findMany({
          where: { schoolId: ctx.schoolId, kind: 'parent-connect', isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
        db.student.findMany({
          where: { ...authorizedStudentWhere(ctx) },
          include: {
            class: { select: { name: true, section: true } },
            user: { select: { id: true, name: true, status: true } },
          },
          orderBy: { rollNo: 'asc' },
          take: 300,
        }),
      ])

      // Unread counts (parent messages the teacher hasn't read) — exact via groupBy.
      const conversationIds = conversations.map((c) => c.id)
      const unreadGroups = conversationIds.length
        ? await db.parentMessage.groupBy({
            by: ['conversationId'],
            where: {
              conversationId: { in: conversationIds },
              senderId: { not: ctx.userId },
              readAt: null,
            },
            _count: { _all: true },
          })
        : []
      const unreadByConversation = new Map(
        unreadGroups.map((g) => [g.conversationId, g._count._all]),
      )

      // Recent message window — powers last-message previews AND the honest
      // reply-rate stat (bounded take; conversations older than the window
      // fall back to their lastMessageAt timestamp with no preview).
      const recentMessages = conversationIds.length
        ? await db.parentMessage.findMany({
            where: { conversationId: { in: conversationIds } },
            orderBy: { createdAt: 'desc' },
            take: MESSAGE_HISTORY_TAKE,
            select: {
              id: true,
              conversationId: true,
              senderId: true,
              body: true,
              createdAt: true,
            },
          })
        : []
      const lastMessageByConversation = new Map<string, (typeof recentMessages)[number]>()
      for (const m of recentMessages) {
        if (!lastMessageByConversation.has(m.conversationId)) {
          lastMessageByConversation.set(m.conversationId, m)
        }
      }

      // Open follow-up per conversation (nearest due).
      const followUpByConversation = new Map<string, (typeof followUpRows)[number]>()
      for (const f of followUpRows) {
        if (f.conversationId && !followUpByConversation.has(f.conversationId)) {
          followUpByConversation.set(f.conversationId, f)
        }
      }

      const summaries: ConversationSummary[] = conversations.map((c) => {
        const last = lastMessageByConversation.get(c.id)
        const openFollowUp = followUpByConversation.get(c.id)
        return {
          id: c.id,
          category: (CATEGORIES.includes(c.category) ? c.category : 'general') as ConversationSummary['category'],
          pinned: c.pinned,
          needsReply: c.needsReply,
          archived: c.archived,
          createdAt: c.createdAt.toISOString(),
          lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
          unread: unreadByConversation.get(c.id) ?? 0,
          parent: {
            id: c.parent.id,
            name: c.parent.name ?? 'Guardian',
            phone: c.parent.phone ?? null,
          },
          student: toStudentRef(c.student),
          lastMessage: last
            ? {
                body: last.body,
                fromTeacher: last.senderId === ctx.userId,
                createdAt: last.createdAt.toISOString(),
              }
            : null,
          openFollowUp: openFollowUp
            ? {
                id: openFollowUp.id,
                dueDate: openFollowUp.dueDate.toISOString(),
                priority: openFollowUp.priority as 'low' | 'normal' | 'high',
              }
            : null,
        }
      })
      summaries.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0
        const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0
        return bt - at
      })

      // Reply rate: of parent-initiated conversations (last 90 days), the
      // share where the teacher has responded — derived from real messages,
      // never fabricated. null when there are no parent-initiated threads yet.
      const windowStart = Date.now() - REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const messagesByConversation = new Map<string, typeof recentMessages>()
      for (const m of recentMessages) {
        const list = messagesByConversation.get(m.conversationId) ?? []
        list.push(m)
        messagesByConversation.set(m.conversationId, list)
      }
      let parentInitiated = 0
      let teacherReplied = 0
      for (const [conversationId, msgs] of messagesByConversation) {
        const sorted = [...msgs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        const first = sorted[0]
        if (!first || first.senderId === ctx.userId) continue // teacher-initiated
        if (first.createdAt.getTime() < windowStart) continue
        parentInitiated++
        if (sorted.some((m) => m.senderId === ctx.userId)) teacherReplied++
      }
      const replyRate = parentInitiated > 0 ? Math.round((teacherReplied / parentInitiated) * 100) : null

      const activeWindowStart = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const now = new Date()
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      const followUpItems = followUpRows.map(toFollowUpItem)

      const stats = {
        total: summaries.length,
        active: summaries.filter(
          (c) => c.lastMessageAt && Date.parse(c.lastMessageAt) >= activeWindowStart,
        ).length,
        unread: summaries.reduce((sum, c) => sum + c.unread, 0),
        followUpsOpen: followUpItems.length,
        followUpsDue: followUpRows.filter((f) => f.dueDate.getTime() <= endOfToday.getTime()).length,
        replyRate,
      }

      // Linkable students: in-scope students with a guardian user; annotate an
      // existing conversation when one already exists for that student+parent.
      const conversationByStudentParent = new Map<string, string>()
      for (const c of conversations) {
        const key = `${c.studentId}\u0000${c.parentId}`
        if (!conversationByStudentParent.has(key)) conversationByStudentParent.set(key, c.id)
      }
      const students: ParentLinkableStudent[] = scopeStudents.map((s) => {
        const existing = s.guardianId
          ? conversationByStudentParent.get(`${s.id}\u0000${s.guardianId}`) ?? null
          : null
        return {
          student: toStudentRef(s),
          guardianName: s.guardianName ?? null,
          guardianPhone: s.guardianPhone ?? null,
          parentUserId: s.guardianId ?? null,
          existingConversationId: existing,
          // the school's policy gate for the student audience: an ACTIVE
          // student account (issued by the school) is what makes a student
          // directly reachable — no account, no direct messages
          studentUserId: s.user?.status === 'ACTIVE' ? s.user.id : null,
        }
      })

      const payload: ParentConnectPayload = {
        teacher: {
          name: ctx.name,
          classLabel: ctx.classTeacherOf.map((c) => c.label).join(' · ') || 'Teacher',
        },
        conversations: summaries,
        followUps: followUpItems,
        templates: templates.map((t) => ({
          id: t.id,
          label: t.label,
          body: t.body,
          category: t.category,
        })),
        students,
        stats,
      }
      return payload
    },
    { roles: ['TEACHER'] },
  )
}

// POST /api/teacher/parent-connect — start (or reuse) a conversation with the
// guardian of an authorized student and send the first message.
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      // Message send — per-user throttle (same profile as the messaging
      // routes; see rate-limit.ts RATE_LIMITS.message).
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)
      const ctx = await requireTeacher(user)
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const student = await db.student.findFirst({
        where: {
          id: typeof body.studentId === 'string' ? body.studentId : '',
          ...authorizedStudentWhere(ctx),
        },
        include: {
          class: { select: { name: true, section: true } },
          user: { select: { name: true } },
        },
      })
      if (!student) throw new AppError('NOT_FOUND', { publicMessage: 'Student not found in your scope', internalDetail: 'parent-connect: student missing or outside teacher scope' })
      if (!student.guardianId) throw new Error('This student has no linked guardian account')

      const guardian = await db.user.findFirst({
        where: {
          id: student.guardianId,
          schoolId: ctx.schoolId,
          role: 'PARENT',
          status: 'ACTIVE',
        },
        select: { id: true, name: true },
      })
      if (!guardian) throw new Error('Guardian account not found for this school')

      const category =
        typeof body.category === 'string' && CATEGORIES.includes(body.category)
          ? body.category
          : 'general'
      const message = parseString(body.message, 'Message', { required: true, max: 2000 })
      if (!message) throw new Error('Message is required')

      const now = new Date()
      const conversation = await db.parentConversation.upsert({
        where: {
          parent_conversation_participants: {
            teacherId: ctx.userId,
            studentId: student.id,
            parentId: guardian.id,
          },
        },
        create: {
          schoolId: ctx.schoolId,
          teacherId: ctx.userId,
          parentId: guardian.id,
          studentId: student.id,
          category,
          lastMessageAt: now,
        },
        update: { category, lastMessageAt: now },
      })

      await db.parentMessage.create({
        data: {
          schoolId: ctx.schoolId,
          conversationId: conversation.id,
          senderId: ctx.userId,
          body: message,
        },
      })

      await auditTeacherAction(
        user,
        ctx.schoolId,
        'PARENT_MESSAGE_SENT',
        `First message to ${guardian.name ?? 'guardian'} regarding ${student.user?.name ?? 'student'} (conversation ${conversation.id})`,
      )

      return { conversationId: conversation.id }
    },
    { roles: ['TEACHER'] },
  )
}
