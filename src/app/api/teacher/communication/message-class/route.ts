import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser } from '@/lib/api'
import { requireTeacher, auditTeacherAction, parseString } from '@/lib/teacher-hub'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

// POST /api/teacher/communication/message-class — CLASS GROUP messaging.
// A class teacher addresses their own class with ONE compose action:
//   audience: 'parents'   → the message lands as a REAL ParentMessage row in
//                           each (teacher ↔ guardian) thread — the same
//                           canonical parent-conversation engine the hub
//                           renders (upserted, never duplicated per send)
//   audience: 'students'  → a REAL Message row to each enrolled student's
//                           ACTIVE user account (the school's account policy
//                           is the gate — no account, no delivery)
//   audience: 'everyone'  → both of the above
// Groups are DERIVED from the class-teacher appointment — a teacher can
// never address a class they are not appointed to, and can never create
// arbitrary school-wide groups (school-wide reach is the announcement
// system, permission-gated separately).
const GROUP_AUDIENCES = new Set(['parents', 'students', 'everyone'])
const CATEGORIES = ['general', 'academic', 'attendance', 'behavior', 'wellbeing', 'urgent']

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      // Bulk fan-out write (one row per recipient) — per-user throttle.
      enforceRateLimit(`rl:msg:${user.id}`, RATE_LIMITS.message)
      const ctx = await requireTeacher(user)
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('Invalid request body')

      // ── Authorization: the class MUST be one this teacher is appointed
      //    class teacher of (server-derived — the client id is never trusted).
      const classId = typeof body.classId === 'string' ? body.classId : ''
      const ownClass = ctx.classTeacherOf.find((c) => c.id === classId)
      if (!ownClass) throw new Error('You can only message classes you are the class teacher of')

      const groupAudience =
        typeof body.audience === 'string' && GROUP_AUDIENCES.has(body.audience) ? body.audience : null
      if (!groupAudience) throw new Error('Audience must be parents, students or everyone')

      const message = parseString(body.message, 'Message', { required: true, max: 2000 })
      if (!message) throw new Error('Message is required')
      const category =
        typeof body.category === 'string' && CATEGORIES.includes(body.category)
          ? body.category
          : 'general'

      // ── Roster of the appointed class (school-scoped). ──────────────
      const students = await db.student.findMany({
        where: { schoolId: ctx.schoolId, classId: ownClass.id },
        include: { user: { select: { id: true, status: true } } },
        orderBy: { rollNo: 'asc' },
        take: 200,
      })

      // Guardians: ACTIVE PARENT users linked to these students. One
      // conversation per (teacher, student, parent) triple — upserted, so
      // existing threads are CONTINUED rather than duplicated.
      const guardianIds = [...new Set(students.map((s) => s.guardianId).filter((g): g is string => !!g))]
      const guardians =
        guardianIds.length > 0
          ? await db.user.findMany({
              where: { id: { in: guardianIds }, schoolId: ctx.schoolId, role: 'PARENT', status: 'ACTIVE' },
              select: { id: true },
            })
          : []
      const guardianSet = new Set(guardians.map((g) => g.id))
      // Students with their own ACTIVE account (the student-audience policy).
      const studentUsers = students.filter((s) => s.user?.status === 'ACTIVE' && s.user.id)

      const now = new Date()
      const parentConversationIds: string[] = []
      let parentsReached = 0

      if (groupAudience === 'parents' || groupAudience === 'everyone') {
        for (const s of students) {
          if (!s.guardianId || !guardianSet.has(s.guardianId)) continue
          const conversation = await db.parentConversation.upsert({
            where: {
              parent_conversation_participants: {
                teacherId: ctx.userId,
                studentId: s.id,
                parentId: s.guardianId,
              },
            },
            create: {
              schoolId: ctx.schoolId,
              teacherId: ctx.userId,
              parentId: s.guardianId,
              studentId: s.id,
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
          parentConversationIds.push(conversation.id)
          parentsReached++
        }
      }

      let studentsReached = 0
      if (groupAudience === 'students' || groupAudience === 'everyone') {
        if (studentUsers.length > 0) {
          await db.message.createMany({
            data: studentUsers.map((s) => ({
              schoolId: ctx.schoolId,
              senderId: ctx.userId,
              recipientId: s.user!.id,
              subject: `Class message · ${ownClass.label}`,
              body: message,
            })),
          })
          studentsReached = studentUsers.length
        }
      }

      await auditTeacherAction(
        user,
        ctx.schoolId,
        'CLASS_GROUP_MESSAGE_SENT',
        `Class group message to ${ownClass.label} (${groupAudience}) — ${parentsReached} parent thread(s), ${studentsReached} student account(s)`,
      )

      return {
        classLabel: ownClass.label,
        audience: groupAudience,
        parentsReached,
        studentsReached,
        parentConversationIds,
        totalStudents: students.length,
      }
    },
    { roles: ['TEACHER'] },
  )
}
