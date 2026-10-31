import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db, trackedTransaction } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { withPlatform } from '@/lib/platform/authz'
import { platformAuditEvent } from '@/lib/platform/audit'
import { AppError } from '@/lib/security/errors'
import { parseJsonBody, strictBody, safeText, emailSchema, phoneSchema } from '@/lib/security/validation'
import { clientIpFromHeaders } from '@/lib/security/rate-limit'
import {
  resolveProvisionedPassword,
  bootstrapCredentialExpiresAt,
} from '@/lib/account-provisioning'

export const runtime = 'nodejs'

const memberSchema = strictBody({
  name: safeText(80),
  email: emailSchema,
  phone: phoneSchema.optional(),
  employeeId: safeText(40).optional(),
  department: safeText(80).optional(),
  qualification: safeText(120).optional(),
  /** Free-text subjects/assignment note (Teacher.subjects column). */
  subjects: safeText(200).optional(),
})

const staffSchema = strictBody({
  members: z.array(memberSchema).min(1).max(40),
})

/**
 * POST /api/platform/schools/[id]/initial-staff — OPTIONAL initial
 * teacher/staff onboarding (PHASE 2 Setup wizard, People step).
 *
 * The platform has no other platform-side write path into a school's
 * roster (the school-plane POST /api/teachers is principal-session
 * scoped). This route covers the OPTIONAL first-teacher seeding only —
 * the school owns routine roster management after handover.
 *
 * Credential contract — IDENTICAL to the established provisioning
 * convention (resolveProvisionedPassword / bootstrapCredentialExpiresAt):
 *   · passwords are ALWAYS server-generated (crypto-random 12-char,
 *     no password field is accepted — no insecure shared default);
 *   · every account starts in forced first-password-change
 *     (mustChangePassword) with a 48h bootstrap window;
 *   · `tempPassword` is surfaced ONCE in the response, never stored in
 *     plaintext, never emailed, never audited.
 *
 * All-or-nothing: a member whose email is already taken by ANY user
 * (global-unique) aborts the whole batch with a typed CONFLICT listing
 * every conflicting email — no partial roster. Members already in THIS
 * school as TEACHER are reported as duplicates (idempotent retry), not
 * errors.
 *
 * Permission: schools.manage. Audited: platform.school.staff_onboarded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withPlatform({ permission: 'schools.manage' }, async (ctx) => {
    const body = await parseJsonBody(req, staffSchema)
    const ip = clientIpFromHeaders(req.headers)

    const school = await db.school.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!school) {
      throw new AppError('RESOURCE_NOT_FOUND', {
        publicMessage: 'School not found',
        internalDetail: 'initial-staff: no such school',
      })
    }

    // Fast-path identity checks (the global-unique email index is the
    // authority; these pre-checks only produce honest, complete errors).
    const emails = body.members.map((m) => m.email.toLowerCase())
    const existingUsers = await db.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, schoolId: true, role: true },
    })
    const existingByEmail = new Map(existingUsers.map((u) => [u.email, u]))

    const duplicates: string[] = []
    const conflicts: string[] = []
    const fresh: typeof body.members = []
    for (const member of body.members) {
      const existing = existingByEmail.get(member.email)
      if (!existing) {
        fresh.push(member)
        continue
      }
      if (existing.schoolId === school.id && existing.role === 'TEACHER') {
        duplicates.push(member.email)
        continue
      }
      conflicts.push(member.email)
    }

    if (conflicts.length > 0) {
      throw new AppError('CONFLICT', {
        publicMessage: `Email already in use — remove or change: ${conflicts.join(', ')}`,
        internalDetail: `initial-staff: ${conflicts.length} conflicting email(s)`,
      })
    }

    const created: Array<{
      id: string
      email: string
      name: string
      tempPassword?: string
    }> = []

    await trackedTransaction('initial-staff', async (tx) => {
      for (const member of fresh) {
        const { password, generated } = resolveProvisionedPassword(undefined)
        const user = await tx.user.create({
          data: {
            schoolId: school.id,
            email: member.email,
            passwordHash: hashPassword(password),
            name: member.name,
            role: 'TEACHER',
            status: 'ACTIVE',
            mustChangePassword: true,
            credentialExpiresAt: bootstrapCredentialExpiresAt(),
            ...(member.phone ? { phone: member.phone } : {}),
          },
        })
        await tx.teacher.create({
          data: {
            schoolId: school.id,
            userId: user.id,
            ...(member.employeeId ? { employeeId: member.employeeId } : {}),
            ...(member.department ? { department: member.department } : {}),
            ...(member.qualification ? { qualification: member.qualification } : {}),
            ...(member.subjects ? { subjects: member.subjects } : {}),
          },
        })
        created.push({
          id: user.id,
          email: user.email,
          name: user.name ?? member.name,
          // One-time bootstrap credential — surfaced ONCE (same
          // convention as teacher provisioning / credential reset).
          ...(generated ? { tempPassword: password } : {}),
        })
      }
    })

    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.school.staff_onboarded',
      targetType: 'SCHOOL',
      targetId: school.id,
      schoolId: school.id,
      ip,
      reason: 'initial staff onboarding (setup wizard)',
      metadata: {
        created: created.length,
        duplicates: duplicates.length,
      },
    })

    return { ok: true, created, duplicates, conflicts: [] }
  })
}
