import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { hashPassword } from '@/lib/auth'
import { generateTempPassword } from '@/lib/account-provisioning'
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rate-limit'
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
 *   · reset-credential — { action } — the school-plane credential reset
 *                    (mirrors the platform reset-credentials semantics):
 *                    fresh server-generated temp password, forced
 *                    first-change state, every live session revoked, one
 *                    audit row. The temp password rides the response
 *                    EXACTLY ONCE (never logged, never audited).
 *   · set-status   — { action, status: 'ACTIVE' | 'SUSPENDED', reason? } —
 *                    the portal lock/unlock: SUSPENDED accounts cannot
 *                    authenticate (login + withUser both refuse non-ACTIVE
 *                    status) and their live sessions are revoked. No
 *                    history is touched (unlike terminate — no capability
 *                    release, no data deletes).
 *
 * Every mutation writes a canonical audit row (real actor from the
 * session — never a hardcoded name).
 */
interface UpdateBody {
  action?: string
  reason?: string
  lockLogin?: boolean
  status?: string
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
        include: {
          user: { select: { id: true, name: true, email: true, status: true, role: true } },
        },
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

      // ── reset-credential — one-time temp credential + forced change ───
      if (action === 'reset-credential') {
        // Guard: this action only ever targets TEACHER accounts (the
        // caller is PRINCIPAL/MANAGEMENT — they can never reset here).
        if (teacher.user.role !== 'TEACHER') {
          throw new AppError('FORBIDDEN', {
            publicMessage: 'Credential reset is only available for teacher accounts',
            internalDetail: `teachers/[id] reset-credential: target role ${teacher.user.role}`,
          })
        }
        // Abuse brake — the principal's account-control budget (20/h).
        enforceRateLimit(`rl:tcred:${user.id}`, RATE_LIMITS.teacherCredentialReset)

        // The SAME generator the platform reset-credentials route uses
        // (src/lib/account-provisioning.ts) — one policy, one library; a
        // route-local password mint would be a policy fork.
        const tempPassword = generateTempPassword(16)
        let revokedSessions = 0
        await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: teacher.userId },
            data: {
              passwordHash: hashPassword(tempPassword),
              // The temp credential is a single-purpose bootstrap: the
              // forced first-password-change state is re-armed so the
              // account cannot run the tenant on it (withUser rejects
              // business APIs until a real password is set).
              mustChangePassword: true,
            },
          })
          // Mirror the platform reset semantics EXACTLY: every live
          // session of the reset account dies immediately.
          const revoked = await tx.session.deleteMany({
            where: { userId: teacher.userId },
          })
          revokedSessions = revoked.count
          await tx.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: 'TEACHER_CREDENTIAL_RESET',
              // NEVER the password — ids and counts only.
              detail: `Portal credential reset for ${teacher.user.name ?? 'teacher'} (${teacher.user.email}) by ${user.name ?? 'the principal'} — ${revoked.count} session(s) revoked; one-time temporary password issued (forced change at first sign-in).`,
            },
          })
        })
        // Surfaced ONCE — never logged, never stored in plaintext.
        return { ok: true, id: teacher.id, action, tempPassword, revokedSessions }
      }

      // ── set-status — portal lock / unlock (record NEVER deleted) ────
      if (action === 'set-status') {
        const status = body?.status
        if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
          throw new AppError('INVALID_INPUT', {
            publicMessage: "status must be 'ACTIVE' or 'SUSPENDED'",
          })
        }
        if (teacher.user.role !== 'TEACHER') {
          throw new AppError('FORBIDDEN', {
            publicMessage: 'Account lock is only available for teacher accounts',
            internalDetail: `teachers/[id] set-status: target role ${teacher.user.role}`,
          })
        }
        const reason =
          typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
        const locked = status === 'SUSPENDED'

        // Login (auth/login) and withUser BOTH refuse non-ACTIVE status,
        // so SUSPENDED is the server-side lock. Unlike terminate, NOTHING
        // is released or deleted — the Teacher row, CSA assignments,
        // class-teacher appointments and all history stay untouched; only
        // the login capability flips (and live sessions die on lock).
        let revokedSessions = 0
        await db.$transaction(async (tx) => {
          if (teacher.user.status !== status) {
            await tx.user.update({
              where: { id: teacher.userId },
              data: { status },
            })
          }
          if (locked) {
            const revoked = await tx.session.deleteMany({
              where: { userId: teacher.userId },
            })
            revokedSessions = revoked.count
          }
          await tx.activityLog.create({
            data: {
              schoolId,
              userId: user.id,
              action: locked ? 'TEACHER_ACCOUNT_LOCKED' : 'TEACHER_ACCOUNT_UNLOCKED',
              detail: `${teacher.user.name ?? 'Teacher'} (${teacher.user.email}) portal account ${locked ? 'LOCKED' : 'UNLOCKED'} by ${user.name ?? 'the principal'}${reason ? ` — reason: ${reason}` : ''}${locked ? `. ${revokedSessions} live session(s) revoked` : ''}. Full record and history preserved.`,
            },
          })
        })
        return { ok: true, id: teacher.id, action, status, revokedSessions }
      }

      throw new AppError('INVALID_INPUT', {
        publicMessage: 'action must be update, terminate, reactivate, reset-credential or set-status',
      })
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
