import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { withUser } from '@/lib/api'
import { resolveProvisionedPassword } from '@/lib/account-provisioning'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

// Task 4-d (audit 3-a fix #13): plan/status free strings on school
// create/update are whitelisted to the vocabulary in use — schema default
// 'STANDARD' (prisma), the deployed demo school 'ENTERPRISE', and the
// conventional FREE/PRO tiers (grep: no other plan value exists in the
// codebase; the mock control plane's starter/growth/enterprise vocabulary
// never reaches School.plan). Status: 'ACTIVE' (schema default + the only
// value in the DB), plus the lifecycle states the super-admin surface
// uses (SUSPENDED / TRIAL — matching the mock control-plane vocabulary,
// upper-cased).
const SCHOOL_PLANS = ['FREE', 'STANDARD', 'PRO', 'ENTERPRISE'] as const
const SCHOOL_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED'] as const

// List all schools (super admin) OR the caller's school
export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    if (user.role === 'SUPER_ADMIN') {
      const showDemoParam = req.nextUrl.searchParams.get('includeDemo')

      let showDemo = true
      if (showDemoParam === 'false') {
        showDemo = false
      } else if (showDemoParam === 'true') {
        showDemo = true
      } else {
        const setting = await db.platformSetting.findUnique({ where: { id: 'global' } })
        if (setting) {
          showDemo = setting.showDemoSchool
        }
      }

      const whereClause = showDemo ? {} : { isDemo: false }

      const schools = await db.school.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { users: true, students: true, teachers: true, classes: true },
          },
        },
      })
      return schools.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        code: s.code,
        domain: s.domain,
        city: s.city,
        address: s.address,
        phone: s.phone,
        email: s.email,
        plan: s.plan,
        status: s.status,
        isDemo: Boolean(s.isDemo),
        themeColor: s.themeColor,
        accentColor: s.accentColor,
        academicYear: s.academicYear,
        createdAt: s.createdAt,
        counts: s._count,
      }))
    }
    // Non-admin caller: their own school only. A schoolless identity
    // gets the NO_SCHOOL 403 — never a `user.schoolId!` non-null-assertion
    // 500 (Task 4-d, audit 3-a fix #13).
    if (!user.schoolId) throw new Error('NO_SCHOOL')
    const s = await db.school.findUnique({ where: { id: user.schoolId } })
    return s ? [{
      ...s,
      isDemo: Boolean(s.isDemo),
    }] : []
  })
}

// Deploy a new school (super admin only)
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const body = await req.json().catch(() => ({}))
      const name = String(body.name || '').trim()
      const code = String(body.code || '').trim().toUpperCase()
      if (!name || !code) throw new Error('Name and code are required')

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const exists = await db.school.findFirst({ where: { OR: [{ slug }, { code }] } })
      if (exists) throw new Error('A school with this name/code already exists')

      const principalName = String(body.principalName || '').trim() || 'Principal'
      const principalEmail = String(body.principalEmail || '').trim().toLowerCase() || `principal@${slug}.edu`
      // Task 4-d (audit 3-a fix #13): NO shared 'password123' default —
      // random temp password (returned below so the operator can hand it
      // over) or the SCHOLARIO_DEFAULT_PASSWORD dev override (non-prod).
      const { password: principalPassword, generated } = resolveProvisionedPassword(body.principalPassword)

      // plan/status whitelists (fail-closed on unknown values).
      const plan = body.plan === undefined || body.plan === null || body.plan === ''
        ? 'STANDARD'
        : String(body.plan).trim().toUpperCase()
      if (!SCHOOL_PLANS.includes(plan as (typeof SCHOOL_PLANS)[number])) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid plan' })
      }
      const status = body.status === undefined || body.status === null || body.status === ''
        ? 'ACTIVE'
        : String(body.status).trim().toUpperCase()
      if (!SCHOOL_STATUSES.includes(status as (typeof SCHOOL_STATUSES)[number])) {
        throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid status' })
      }

      const school = await db.$transaction(async (tx) => {
        const s = await tx.school.create({
          data: {
            name,
            slug,
            code,
            domain: body.domain || `${slug}.scholario.app`,
            address: body.address || null,
            city: body.city || null,
            phone: body.phone || null,
            email: body.email || `office@${slug}.edu`,
            themeColor: body.themeColor || '#0f766e',
            accentColor: body.accentColor || '#f59e0b',
            plan,
            status,
            academicYear: body.academicYear || '2025-2026',
            isDemo: false,
          },
        })
        const principal = await tx.user.create({
          data: {
            schoolId: s.id,
            email: principalEmail,
            passwordHash: hashPassword(principalPassword),
            name: principalName,
            role: 'PRINCIPAL',
            phone: body.principalPhone || null,
            status: 'ACTIVE',
          },
        })
        await tx.activityLog.create({
          data: { schoolId: s.id, userId: user.id, action: 'SCHOOL_DEPLOYED', detail: `School "${name}" deployed by ${user.email}` },
        })
        return { school: s, principalEmail, principalPassword, principalId: principal.id }
      })

      return {
        id: school.school.id,
        name: school.school.name,
        slug: school.school.slug,
        code: school.school.code,
        domain: school.school.domain,
        isDemo: false,
        principalEmail: school.principalEmail,
        // The provisioning credential is surfaced ONCE here (the deploy
        // response has always carried it); `generated` mirrors the
        // tempPassword convention of the student/teacher create routes.
        principalPassword: school.principalPassword,
        ...(generated ? { tempPassword: school.principalPassword } : {}),
      }
    },
    { roles: ['SUPER_ADMIN'] }
  )
}
