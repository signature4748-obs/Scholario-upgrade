import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { withUser, schoolScoped } from '@/lib/api'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { AppError, newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const { searchParams } = new URL(req.url)
      const classId = searchParams.get('classId')
      const q = searchParams.get('q')
      const students = await db.student.findMany({
        where: {
          schoolId,
          ...(classId ? { classId } : {}),
          ...(q
            ? { OR: [{ user: { name: { contains: q, mode: 'insensitive' as const } } }, { admissionNo: { contains: q, mode: 'insensitive' as const } }] }
            : {}),
        },
        include: { class: true, user: { select: { name: true, email: true, phone: true } }, route: true },
        orderBy: { rollNo: 'asc' },
        take: 200,
      })
      return students
    },
    // Audit §11 — the roster (guardian contacts, addresses, routes) is
    // staff-only; the student role uses /api/student/* surfaces.
    { roles: ['PRINCIPAL', 'MANAGEMENT', 'TEACHER'] },
  )
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({}))
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      if (!name || !email) throw new Error('Name and email are required')
      const exists = await db.user.findUnique({ where: { email } })
      if (exists) throw new Error('Email already in use')
      // Task 4-d (audit 3-a fix #3): NO shared 'password123' default. A
      // supplied password must pass the Phase-1 policy; an absent one gets
      // a random 12-char temp password (surfaced once below) — or the
      // SCHOLARIO_DEFAULT_PASSWORD dev override (non-production only).
      const { password, generated } = resolveProvisionedPassword(body.password)
      // Phase 2 (audit 3-a fix #4): classId / routeId are client input —
      // a foreign-school id here would attach this school's student to
      // another tenant's Class/Route (cross-tenant FK injection). Both FKs
      // are re-verified against the CALLER's school; unknown/foreign ids
      // fail safe with 404 (no existence oracle).
      const classId = typeof body.classId === 'string' && body.classId.trim() ? body.classId.trim() : null
      const routeId = typeof body.routeId === 'string' && body.routeId.trim() ? body.routeId.trim() : null
      if (classId) {
        const cls = await db.class.findFirst({ where: { id: classId, schoolId }, select: { id: true } })
        if (!cls) {
          throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Class not found', internalDetail: 'students POST: classId foreign tenant' })
        }
      }
      if (routeId) {
        const route = await db.route.findFirst({ where: { id: routeId, schoolId }, select: { id: true } })
        if (!route) {
          throw new AppError('RESOURCE_NOT_FOUND', { publicMessage: 'Route not found', internalDetail: 'students POST: routeId foreign tenant' })
        }
      }
      const admNo = String(body.admissionNo || `ADM-${Date.now()}`)
      // Phase 3 — the user + student rows are created in ONE transaction
      // (copies the schools POST pattern): a failure between the two
      // previously orphaned the User row (a login with no student record).
      const s = await trackedTransaction('student-create-with-user', async (tx) => {
        const u = await tx.user.create({
          data: {
            schoolId,
            email,
            passwordHash: hashPassword(password),
            name,
            role: 'STUDENT',
            phone: body.phone || null,
            status: 'ACTIVE',
          },
        })
        return tx.student.create({
          data: {
            schoolId,
            userId: u.id,
            classId,
            rollNo: body.rollNo || null,
            admissionNo: admNo,
            guardianName: body.guardianName || null,
            guardianPhone: body.guardianPhone || null,
            dob: body.dob || null,
            gender: body.gender || null,
            bloodGroup: body.bloodGroup || null,
            address: body.address || null,
            routeId,
          },
          include: { class: true, user: { select: { name: true, email: true } } },
        })
      })
      // PIH-4a (audit-trail gap) — student creation PROVISIONS LOGIN
      // CREDENTIALS: the account hand-over is an auditable security event
      // (funnel + canonical vocabulary; never the password itself).
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'ACCOUNT_CREATED',
        requestId: newRequestId(),
        detail: `Student account created (${email}, admission no ${admNo})${generated ? ' — server-generated one-time credential' : ''}`,
      }).catch(() => {})
      // Additive field: the ONE-TIME generated credential for the operator
      // to hand over (only present when the server generated it). No client
      // consumes this response today (grep-verified — the create flows are
      // API-only), so the additive field breaks nothing.
      return { ...s, ...(generated ? { tempPassword: password } : {}) }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
