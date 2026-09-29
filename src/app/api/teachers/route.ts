import { NextRequest } from 'next/server'
import { db, trackedTransaction } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { withUser, schoolScoped } from '@/lib/api'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'

export const runtime = 'nodejs'

export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const teachers = await db.teacher.findMany({
        where: { schoolId },
        include: { user: { select: { name: true, email: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return teachers
    },
    // Audit §11 — staff contact details are admin-only (the student role
    // has no surface that reads this route).
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
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
      // Task 4-d (audit 3-a fix #3): NO shared 'password123' default — see
      // students POST and src/lib/account-provisioning.ts.
      const { password, generated } = resolveProvisionedPassword(body.password)
      const empId = String(body.employeeId || `EMP-${Date.now()}`)
      // Phase 3 — the user + teacher rows are created in ONE transaction
      // (copies the schools POST pattern): a failure between the two
      // previously orphaned the User row (a login with no teacher record).
      const t = await trackedTransaction('teacher-create-with-user', async (tx) => {
        const u = await tx.user.create({
          data: {
            schoolId,
            email,
            passwordHash: hashPassword(password),
            name,
            role: 'TEACHER',
            phone: body.phone || null,
            status: 'ACTIVE',
          },
        })
        return tx.teacher.create({
          data: {
            schoolId,
            userId: u.id,
            employeeId: empId,
            department: body.department || null,
            qualification: body.qualification || null,
            subjects: body.subjects || null,
          },
          include: { user: { select: { name: true, email: true } } },
        })
      })
      // Additive one-time credential field (only when server-generated).
      return { ...t, ...(generated ? { tempPassword: password } : {}) }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}
