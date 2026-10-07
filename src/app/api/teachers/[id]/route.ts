import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

/**
 * PATCH /api/teachers/[id] — the canonical TEACHER record mutations
 * (TQA-14: teacher edit/relieve previously lived ONLY in client store
 * state — a refresh lost them; this route makes them server-persisted,
 * mirroring the students/[id] PATCH pattern).
 *
 * Actions (PRINCIPAL / MANAGEMENT, school-scoped):
 *   · update      — { action, name?, phone?, employeeId?, department?,
 *                    qualification?, subjects? } — the profile fields the
 *                    Principal's edit dialogs write. Empty-string values
 *                    clear optional fields; unknown fields are ignored
 *                    (never a client-driven schema).
 *   · terminate   — { action, reason, lockLogin } — relieved-staff
 *                    semantics: the Teacher row and ALL history are
 *                    RETAINED (never deleted — salary records, positions,
 *                    documents stay for audit); the appointment capability
 *                    is removed server-side by RELEASING the class-teacher
 *                    appointment and deactivating the subject assignments;
 *                    lockLogin=true suspends the User account (login
 *                    refused server-side); false keeps the account for
 *                    read-only/portal access per business choice.
 *   · reactivate  — { action } — restores an ACTIVE account + re-links
 *                    the CSA assignments the terminate deactivated.
 *
 * Every mutation writes a canonical audit row (real actor from the
 * session — never a hardcoded name).
 */
interface UpdateBody {
  action?: string
  reason?: string
  lockLogin?: boolean
  name?: string
  phone?: string
  employeeId?: string
  department?: string
  qualification?: string
  subjects?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { id } = await params
      const body = (await req.json().catch(() => null)) as UpdateBody | null
      const action = body?.action?.trim()

      // The Teacher row MUST belong to the caller's school (foreign-tenant
      // ids resolve to NOT_FOUND — never a cross-tenant write).
      const teacher = await db.teacher.findFirst({
        where: { id, schoolId },
        include: { user: { select: { id: true, name: true, email: true, status: true } } },
      })
      if (!teacher) {
        throw new AppError('RESOURCE_NOT_FOUND', {
          publicMessage: 'Teacher not found',
          internalDetail: 'teachers/[id] PATCH: teacher missing or foreign tenant',
        })
      }

      // ── update — profile fields ───────────────────────────────────────
      if (action === 'update') {
        const clean = (v: string | undefined, max: number) =>
          typeof v === 'string' ? v.trim().slice(0, max) : undefined

        const name = clean(body?.name, 120)
        const phone = clean(body?.phone, 20)
        const employeeId = clean(body?.employeeId, 40)
        const department = clean(body?.department, 120)
        const qualification = clean(body?.qualification, 200)
        const subjects = clean(body?.subjects, 400)

        if (name !== undefined && name === '') {
          throw new AppError('INVALID_INPUT', { publicMessage: 'Name cannot be empty' })
        }
        if (employeeId !== undefined && employeeId !== '') {
          const clash = await db.teacher.findFirst({
            where: { schoolId, employeeId, NOT: { id: teacher.id } },
            select: { id: true },
          })
          if (clash) {
            throw new AppError('CONFLICT', {
              publicMessage: `Employee ID ${employeeId} is already used by another teacher in this school`,
            })
          }
        }

        const updated = await db.teacher.update({
          where: { id: teacher.id },
          data: {
            ...(employeeId !== undefined ? { employeeId: employeeId || null } : {}),
            ...(department !== undefined ? { department: department || null } : {}),
            ...(qualification !== undefined ? { qualification: qualification || null } : {}),
            ...(subjects !== undefined ? { subjects: subjects || null } : {}),
          },
          include: { user: { select: { name: true, email: true, phone: true } } },
        })
        // Name/phone live on the User row (the account identity).
        if (name !== undefined || phone !== undefined) {
          await db.user.update({
            where: { id: teacher.userId },
            data: {
              ...(name !== undefined && name !== '' ? { name } : {}),
              ...(phone !== undefined ? { phone: phone || null } : {}),
            },
          })
          // Re-read AFTER the User write so the response carries the
          // post-update snapshot (the include above captured pre-write).
          updated.user = await db.user.findUnique({
            where: { id: teacher.userId },
            select: { name: true, email: true, phone: true },
          }) ?? updated.user
        }

        await auditEvent({
          schoolId,
          userId: user.id,
          action: 'ACCOUNT_UPDATED',
          requestId: newRequestId(),
          detail: `Teacher profile updated (${teacher.user.email})${
            name !== undefined && name !== teacher.user.name ? ` · name → ${name}` : ''
          }`,
        }).catch(() => {})

        return { ok: true, id: teacher.id, teacher: updated, action }
      }

      // ── terminate — relieved-staff semantics (record NEVER deleted) ──
      if (action === 'terminate') {
        const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
        if (!reason) {
          throw new AppError('INVALID_INPUT', { publicMessage: 'A relief reason is required' })
        }
        const lockLogin = body?.lockLogin === true

        // Server-side capability release, INSIDE one transaction:
        //  1. class-teacher appointments released (Class Teacher Hub,
        //     attendance baseline, fee collection die with the class link);
        //  2. subject assignments deactivated (marks/lesson-planner scope
        //     derives from ACTIVE CSA rows);
        //  3. the login account suspended when lockLogin.
        // History (salary payments, exam marks, attendance authored,
        // documents) is untouched — the record is retained for audit.
        await db.$transaction(async (tx) => {
          const released = await tx.class.updateMany({
            where: { schoolId, classTeacherId: teacher.userId },
            data: { classTeacherId: null },
          })
          const deactivated = await tx.classSubjectAssignment.updateMany({
            where: { schoolId, teacherUserId: teacher.userId },
            data: { isActive: false },
          })
          if (lockLogin) {
            await tx.user.update({ where: { id: teacher.userId }, data: { status: 'SUSPENDED' } })
          }
          await tx.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'TEACHER_RELIEVED',
              detail: `${teacher.user.name ?? 'Teacher'} relieved — reason: ${reason}. Login locked: ${lockLogin}. ${released.count} class-teacher appointment(s) released, ${deactivated.count} subject assignment(s) deactivated; record and full history preserved.`,
            },
          })
        })

        const after = await db.teacher.findFirst({
          where: { id: teacher.id },
          include: { user: { select: { name: true, email: true, phone: true, status: true } } },
        })
        return { ok: true, id: teacher.id, teacher: after, action, lockLogin }
      }

      // ── reactivate ────────────────────────────────────────────────────
      if (action === 'reactivate') {
        await db.$transaction(async (tx) => {
          if (teacher.user.status !== 'ACTIVE') {
            await tx.user.update({ where: { id: teacher.userId }, data: { status: 'ACTIVE' } })
          }
          await tx.classSubjectAssignment.updateMany({
            where: { schoolId, teacherUserId: teacher.userId, isActive: false },
            data: { isActive: true },
          })
          await tx.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'TEACHER_REACTIVATED',
              detail: `${teacher.user.name ?? 'Teacher'} restored to active staff; subject assignments re-activated (class-teacher appointments are set from Students & Classes).`,
            },
          })
        })
        const after = await db.teacher.findFirst({
          where: { id: teacher.id },
          include: { user: { select: { name: true, email: true, phone: true, status: true } } },
        })
        return { ok: true, id: teacher.id, teacher: after, action }
      }

      throw new AppError('INVALID_INPUT', {
        publicMessage: 'action must be update, terminate or reactivate',
      })
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
