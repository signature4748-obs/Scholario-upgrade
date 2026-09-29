import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import {
  requireTeacher,
  assertStudentInScope,
  auditTeacherAction,
  parseString,
} from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

// POST /api/teacher/communication/message-parent — send a message to the
// guardian of an authorized student. Mirrors the parent-connect POST flow
// (same tables, same authorization model) so threads stay unified: the
// conversation is upserted on the (teacher, student, parent) triple and the
// message lands in the same parent thread the Communication Hub renders.
//   · requireTeacher resolves the session teacher + school scope
//   · assertStudentInScope re-validates the student server-side — the
//     client-supplied studentId is NEVER trusted
//   · the guardian is re-fetched (school + PARENT role + ACTIVE) from the
//     student row, not from the request body
const CATEGORIES = ['general', 'academic', 'attendance', 'behavior', 'wellbeing', 'urgent']

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      // Message send — per-user throttle (same profile as the messaging
      // routes; see rate-limit.ts RATE_LIMITS.message).
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)
      const ctx = await requireTeacher(user)
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      const student = await assertStudentInScope(ctx, body.studentId)
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
      // Upsert keeps the thread unified: an existing conversation continues
      // instead of a duplicate one being created.
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
        update: { lastMessageAt: now },
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
        `Communication Hub message to ${guardian.name ?? 'guardian'} regarding ${student.user?.name ?? 'student'} (conversation ${conversation.id})`,
      )

      return {
        conversationId: conversation.id,
        parentName: guardian.name ?? 'Guardian',
        studentName: student.user?.name ?? 'the student',
      }
    },
    { roles: ['TEACHER'] },
  )
}
