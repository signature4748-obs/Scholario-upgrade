import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { classLabelOf } from '@/lib/teacher-hub'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * PATCH /api/classes/[id]/class-teacher — appoint or release the class
 * teacher of a class (PRINCIPAL/MANAGEMENT). This is the OFFICIAL record:
 * Class.classTeacherId is exactly what gates the Class Teacher Hub in the
 * teacher's panel (sidebar group, My Class module, fee records in the
 * Student Directory).
 *
 * Body: { teacherUserId: string | null } — the TEACHER'S USER id (the
 * convention Class.classTeacherId stores); null releases the appointment.
 *
 * Effects:
 *   · validates the class + the target teacher belong to the caller's
 *     school (client ids are never trusted for scope);
 *   · idempotent — re-appointing the sitting teacher is a no-op;
 *   · pushes a direct Message notification to the appointed teacher (and
 *     a quiet release note to the previous one) — best-effort, a failed
 *     notification never fails the appointment itself.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const teacherUserId: string | null =
        typeof body.teacherUserId === 'string' && body.teacherUserId.trim() ? body.teacherUserId.trim() : null

      const cls = await db.class.findFirst({ where: { id, schoolId } })
      if (!cls) throw new Error('Class not found')

      // Validate the target teacher (same school, real Teacher row).
      let target: { userId: string; name: string } | null = null
      if (teacherUserId) {
        const row = await db.teacher.findFirst({
          where: { userId: teacherUserId, schoolId },
          select: { userId: true, user: { select: { name: true } } },
        })
        if (!row) throw new Error('Teacher not found in this school')
        target = { userId: row.userId, name: row.user.name ?? 'Teacher' }
      }

      const previousId = cls.classTeacherId
      if ((previousId ?? null) === (target?.userId ?? null)) {
        // Idempotent — the appointment is already exactly this.
        return { classId: cls.id, label: classLabelOf(cls), classTeacherId: previousId ?? null }
      }

      await db.class.update({ where: { id: cls.id }, data: { classTeacherId: target?.userId ?? null } })

      // Task 4-d (audit 3-a fix #16): the appointment changes the teacher's
      // authorization scope (Class Teacher Hub access) — audit it through
      // the canonical PERMISSION_CHANGE action, mirroring the
      // /api/principal/academic classTeacher.set detail format.
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'PERMISSION_CHANGE',
        detail: teacherUserId
          ? `Class teacher appointed for ${cls.name}${cls.section ? ` (${cls.section})` : ''} (user ${teacherUserId})`
          : `Class teacher removed for ${cls.name}${cls.section ? ` (${cls.section})` : ''}`,
      }).catch(() => {})

      const label = classLabelOf(cls)

      // ── Notifications (best-effort, mirrors the invigilator pattern) ──
      const notify = async (recipientId: string, subject: string, body: string) => {
        try {
          await db.message.create({
            data: { schoolId, senderId: user.id, recipientId, subject, body },
          })
        } catch {
          // notification failures never break the appointment
        }
      }
      if (target) {
        await notify(
          target.userId,
          `Class Teacher appointment · ${label}`,
          `You have been appointed Class Teacher of ${label} by ${user.name ?? 'the Principal'}. The Class Teacher Hub — your class overview, fee records and results submission — is now available in your panel.`,
        )
      }
      if (previousId && previousId !== target?.userId) {
        await notify(
          previousId,
          `Class Teacher release · ${label}`,
          `You have been released from Class Teacher duties of ${label}. Your panel now shows the standard teacher modules.`,
        )
      }

      return { classId: cls.id, label, classTeacherId: target?.userId ?? null }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
