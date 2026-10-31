/**
 * PHASE 2 — SUPER ADMIN SCHOOL SETUP WIZARD — API workflow contract.
 *
 * Walks the REAL wizard journey over live HTTP against the seeded
 * corpus database (the same harness the provisioning suites use):
 *
 *   provision → GET setup-wizard (honest fresh state)
 *   → identity save (PATCH + settings fragment)
 *   → STRICT activation blocked (422, exact missing list)
 *   → academic bootstrap (idempotent — replay creates no duplicates)
 *   → principal profile update
 *   → initial staff (tempPassword once; duplicate retry skipped; email
 *     conflict aborts the whole batch)
 *   → fee catalogue seeding (idempotent)
 *   → exam config seeding (idempotent)
 *   → website presence (fragment merge preserves other sections)
 *   → module overrides (invalid module refused)
 *   → review shows wizardChecklistOk
 *   → STRICT activation → ACTIVE + audited; duplicate → CONFLICT
 *
 * Live HTTP against the dev server; fixture platform session (direct
 * platformAdminSession row — the auth-fixture convention, NOT an
 * authorization bypass: every route still enforces its permission).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PLATFORM_PERMISSION_KEYS } from '@/lib/platform/permissions'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 45_000

let rootToken = ''
let schoolId = ''
let principalEmail = ''
const cleanup: Array<() => Promise<unknown>> = []

/**
 * DEDICATED full-permission platform admin fixture.
 *
 * WHY NOT THE ROOT ADMIN: platform mutations are rate-limited PER ADMIN
 * (`rl:platform-mut:<adminId>`, 60/min). This suite performs ~25
 * mutations; drawing them from the SHARED root bucket starves the
 * regression suites that legitimately rely on the same identity later
 * in the CI job (observed as 429s on provisioning/activate).
 * A dedicated admin = a dedicated bucket, plus it exercises the grants
 * table instead of the isRoot bypass.
 */
async function dedicatedFullAdmin(label: string): Promise<string> {
  const marker = randomBytes(4).toString('hex')
  const { hashPassword } = await import('@/lib/auth')
  const admin = await db.platformAdmin.create({
    data: {
      email: `${label}-${marker}@provision.test`,
      passwordHash: hashPassword('Dedicated!8c-pass'),
      name: label,
      isRoot: false,
      totpSecret: 'JBSWY3DPEHPK3PXP',
    },
  })
  for (const key of PLATFORM_PERMISSION_KEYS) {
    await db.platformPermission.create({ data: { adminId: admin.id, key, granted: true } })
  }
  const raw = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: { adminId: admin.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  cleanup.push(async () => {
    await db.platformAdminSession.deleteMany({ where: { adminId: admin.id } }).catch(() => {})
    await db.platformPermission.deleteMany({ where: { adminId: admin.id } }).catch(() => {})
    await db.platformAdmin.delete({ where: { id: admin.id } }).catch(() => {})
  })
  return raw
}

function platform(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-platform-token': rootToken,
      ...(init.headers ?? {}),
    },
  })
}

async function okData<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: T }
  expect(body.ok).toBe(true)
  return body.data
}

async function wizard(): Promise<{
  school: { id: string; name: string; status: string; academicYear: string | null; location: { websiteEnabled: boolean; workingDays: string[] } }
  steps: Array<{ id: string; status: string; optional: boolean }>
  readiness: { summary: { usable: boolean; requiredComplete: boolean; requiredDone: number; requiredTotal: number } }
  activation: { ok: boolean; wizardChecklistOk: boolean; wizardMissing: Array<{ id: string; label: string; fix: string }> }
  principal: { email: string; name: string | null; credentialState: string } | null
  counts: { teachers: number; classes: number; subjects: number; masterFeeHeads: number; examTypes: number; gradeScales: number }
  modules: { school: Record<string, boolean>; effective: Record<string, boolean>; admissionsIssuance: boolean }
  website: { enabled: boolean; hero: { title: string }; about: { title: string } }
  access: { loginUrl: string }
}> {
  return okData(await platform(`/api/platform/schools/${schoolId}/setup-wizard`))
}

function stepMap(steps: Array<{ id: string; status: string }>): Map<string, string> {
  return new Map(steps.map((s) => [s.id, s.status]))
}

beforeAll(async () => {
  // Dedicated full-permission admin (own rate-limit bucket — see above).
  rootToken = await dedicatedFullAdmin('wizard-api-admin')

  // Provision the wizard's target school.
  const marker = randomBytes(4).toString('hex')
  principalEmail = `wizard-principal-${marker}@provision.test`
  const res = await platform('/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify({
      name: `Wizard Setup School ${marker}`,
      slug: `wizard-setup-${marker}`,
      plan: 'STANDARD',
      principalName: 'Wizard Principal',
      principalEmail,
      principalPassword: 'WizardPrincipal!8c',
    }),
  })
  expect(res.status).toBe(200)
  const data = (await res.json()) as { data: { school: { id: string } } }
  schoolId = data.data.school.id
  cleanup.push(async () => {
    await db.session.deleteMany({ where: { user: { schoolId } } }).catch(() => {})
    await db.user.deleteMany({ where: { schoolId } }).catch(() => {})
    await db.platformAuditLog.deleteMany({ where: { schoolId } }).catch(() => {})
    await db.school.delete({ where: { id: schoolId } }).catch(() => {})
  })
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
})

describe('PHASE 2 · setup wizard — honest fresh state', () => {
  test(
    'GET setup-wizard on a fresh school: principal done, everything else honest zero, strict checklist NOT ok',
    async () => {
      const w = await wizard()
      expect(w.school.id).toBe(schoolId)
      expect(w.school.status).toBe('PENDING')
      const byId = stepMap(w.steps)
      expect(w.steps).toHaveLength(9)
      expect(byId.get('principal')).toBe('completed')
      expect(byId.get('identity')).toBe('not_started')
      expect(byId.get('academic')).toBe('not_started')
      expect(byId.get('people')).toBe('not_started')
      expect(w.activation.wizardChecklistOk).toBe(false)
      expect(w.activation.wizardMissing.map((m) => m.id).sort()).toEqual(['academic', 'identity'])
      expect(w.access.loginUrl.length).toBeGreaterThan(0)
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — identity step', () => {
  test(
    'PATCH saves the core contact block + settings location fragment; identity step completes',
    async () => {
      const res = await platform(`/api/platform/schools/${schoolId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          shortName: 'Wizard Prep',
          address: '12 Guidance Road',
          city: 'Lucknow',
          phone: '+91 98765 43210',
          email: 'office@wizardsetup.test',
          settings: { state: 'Uttar Pradesh', district: 'Lucknow', pincode: '226001', country: 'India' },
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { updatedFields: string[] } }
      expect(body.data.updatedFields).toContain('address')
      expect(body.data.updatedFields.some((f) => f.startsWith('settings.'))).toBe(true)

      const w = await wizard()
      expect(stepMap(w.steps).get('identity')).toBe('completed')
      expect(w.school.location.state).toBe('Uttar Pradesh')
    },
    T,
  )

  test(
    'STRICT activation is blocked until the academic structure exists — exact missing item',
    async () => {
      const res = await platform(`/api/platform/schools/${schoolId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ requireComplete: true }),
      })
      expect(res.status).toBe(422)
      const body = (await res.json()) as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toContain('Academic configuration')
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — academic bootstrap (idempotent)', () => {
  const payload = {
    academicYear: '2026-2027',
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    classes: [
      { name: 'Class 1', sections: ['A', 'B'] },
      { name: 'Class 2', sections: ['A'] },
    ],
    subjects: ['English', 'Mathematics'],
  }

  test(
    'first save creates the structure; the DB holds exactly what was saved',
    async () => {
      const data = await okData<{ classesCreated: number; sectionsCreated: number; subjectsCreated: number }>(
        await platform(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      expect(data.classesCreated).toBe(2)
      expect(data.sectionsCreated).toBe(3)
      expect(data.subjectsCreated).toBe(2)
      expect(await db.class.count({ where: { schoolId } })).toBe(3)
      expect(await db.subject.count({ where: { schoolId } })).toBe(2)
    },
    T,
  )

  test(
    'REPLAY creates zero duplicates (Save-and-Continue safety)',
    async () => {
      const data = await okData<{ classesCreated: number; sectionsCreated: number; subjectsCreated: number; sectionsSkipped: number; subjectsSkipped: number }>(
        await platform(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      expect(data.classesCreated).toBe(0)
      expect(data.sectionsCreated).toBe(0)
      expect(data.subjectsCreated).toBe(0)
      expect(data.sectionsSkipped).toBe(3)
      expect(data.subjectsSkipped).toBe(2)
      expect(await db.class.count({ where: { schoolId } })).toBe(3)
      expect(await db.subject.count({ where: { schoolId } })).toBe(2)
    },
    T,
  )

  test(
    'invalid academic year is a typed 422; empty body is refused',
    async () => {
      const bad = await platform(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
        method: 'POST',
        body: JSON.stringify({ academicYear: '2627' }),
      })
      expect(bad.status).toBe(422)
      const empty = await platform(`/api/platform/schools/${schoolId}/academic-bootstrap`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      expect(empty.status).toBe(422)
    },
    T,
  )

  test(
    'wizard state: academic step completes and the strict checklist unblocks',
    async () => {
      const w = await wizard()
      expect(stepMap(w.steps).get('academic')).toBe('completed')
      expect(w.activation.wizardChecklistOk).toBe(true)
      expect(w.activation.wizardMissing).toEqual([])
      expect(w.school.academicYear).toBe('2026-2027')
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — principal step', () => {
  test(
    'PATCH updates name/phone (never the email); unknown fields refused',
    async () => {
      const data = await okData<{ updatedFields: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/principal`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Wizard Principal Updated', phone: '+91 90000 00001' }),
        }),
      )
      expect(data.updatedFields.sort()).toEqual(['name', 'phone'])
      const principal = await db.user.findFirst({ where: { schoolId, role: 'PRINCIPAL' } })
      expect(principal?.name).toBe('Wizard Principal Updated')
      expect(principal?.email).toBe(principalEmail)

      const emailAttempt = await platform(`/api/platform/schools/${schoolId}/principal`, {
        method: 'PATCH',
        body: JSON.stringify({ email: 'new@wizardsetup.test' }),
      })
      expect(emailAttempt.status).toBe(422)
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — initial staff (optional, credential contract)', () => {
  const marker = randomBytes(3).toString('hex')

  test(
    'onboards teachers with FORCED first-change credentials; tempPassword surfaced once',
    async () => {
      const data = await okData<{ created: Array<{ email: string; tempPassword?: string }>; duplicates: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-staff`, {
          method: 'POST',
          body: JSON.stringify({
            members: [
              { name: 'Wizard Teacher One', email: `wizard-teacher-1-${marker}@provision.test`, department: 'Science' },
              { name: 'Wizard Teacher Two', email: `wizard-teacher-2-${marker}@provision.test` },
            ],
          }),
        }),
      )
      expect(data.created).toHaveLength(2)
      for (const c of data.created) {
        expect(c.tempPassword).toBeTruthy()
        const user = await db.user.findUnique({ where: { email: c.email } })
        expect(user?.schoolId).toBe(schoolId)
        expect(user?.role).toBe('TEACHER')
        expect(user?.mustChangePassword).toBe(true)
        expect(user?.credentialExpiresAt).toBeTruthy()
      }
      const teacher = await db.teacher.findFirst({
        where: { schoolId, user: { email: `wizard-teacher-1-${marker}@provision.test` } },
      })
      expect(teacher?.department).toBe('Science')
    },
    T,
  )

  test(
    'retry reports duplicates and creates nothing new (idempotent roster)',
    async () => {
      const data = await okData<{ created: Array<unknown>; duplicates: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-staff`, {
          method: 'POST',
          body: JSON.stringify({
            members: [{ name: 'Wizard Teacher One', email: `wizard-teacher-1-${marker}@provision.test` }],
          }),
        }),
      )
      expect(data.created).toHaveLength(0)
      expect(data.duplicates).toHaveLength(1)
      expect(await db.user.count({ where: { schoolId, role: 'TEACHER' } })).toBe(2)
    },
    T,
  )

  test(
    'an email owned elsewhere (the school principal here) aborts the WHOLE batch with 409',
    async () => {
      const res = await platform(`/api/platform/schools/${schoolId}/initial-staff`, {
        method: 'POST',
        body: JSON.stringify({
          members: [
            { name: 'Never Created', email: `never-${marker}@provision.test` },
            { name: 'Conflicting', email: principalEmail },
          ],
        }),
      })
      expect(res.status).toBe(409)
      expect(await db.user.findUnique({ where: { email: `never-${marker}@provision.test` } })).toBeNull()
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — optional sections', () => {
  test(
    'fee catalogue seeding is idempotent (duplicates skipped, no structures)',
    async () => {
      const heads = [
        { name: 'Wizard Tuition', category: 'Tuition', frequency: 'Monthly', amount: 2500, mandatory: true },
        { name: 'Wizard Admission', category: 'Admission', frequency: 'One-Time', amount: 5000, mandatory: true },
      ]
      const first = await okData<{ created: unknown[]; duplicates: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-fee-catalogue`, {
          method: 'POST',
          body: JSON.stringify({ heads }),
        }),
      )
      expect(first.created).toHaveLength(2)
      const replay = await okData<{ duplicates: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-fee-catalogue`, {
          method: 'POST',
          body: JSON.stringify({ heads }),
        }),
      )
      expect(replay.duplicates).toHaveLength(2)
      expect(await db.masterFeeHead.count({ where: { schoolId } })).toBe(2)
      expect(await db.feeStructure.count({ where: { schoolId } })).toBe(0)
    },
    T,
  )

  test(
    'exam config seeding is idempotent (types + grade scales)',
    async () => {
      const payload = {
        examTypes: [{ name: 'Unit Test' }, { name: 'Term Exam' }],
        gradeScales: [{ grade: 'A', minPct: 91, maxPct: 100 }, { grade: 'B', minPct: 76, maxPct: 90 }],
      }
      const first = await okData<{ createdTypes: unknown[]; createdScales: unknown[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-exam-config`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      expect(first.createdTypes).toHaveLength(2)
      expect(first.createdScales).toHaveLength(2)
      const replay = await okData<{ duplicateTypes: string[]; duplicateScales: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/initial-exam-config`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      )
      expect(replay.duplicateTypes).toHaveLength(2)
      expect(replay.duplicateScales).toHaveLength(2)
      expect(await db.examTypeConfig.count({ where: { schoolId } })).toBe(2)

      const invalid = await platform(`/api/platform/schools/${schoolId}/initial-exam-config`, {
        method: 'POST',
        body: JSON.stringify({ gradeScales: [{ grade: 'X', minPct: 80, maxPct: 50 }] }),
      })
      expect(invalid.status).toBe(422)
    },
    T,
  )

  test(
    'website presence merges the fragment and PRESERVES other CMS sections',
    async () => {
      // Seed a non-wizard section directly (simulating school-owned CMS work).
      const school = await db.school.findUnique({ where: { id: schoolId } })
      const stored = JSON.parse(school?.websiteContent || '{}') as Record<string, unknown>
      stored.pillars = [{ icon: 'target', title: 'Keep', description: 'Preserved' }]
      await db.school.update({ where: { id: schoolId }, data: { websiteContent: JSON.stringify(stored) } })

      await okData<{ updatedSections: string[] }>(
        await platform(`/api/platform/schools/${schoolId}/website-presence`, {
          method: 'PATCH',
          body: JSON.stringify({
            websiteEnabled: true,
            hero: { title: 'Wizard Setup School', titleAccent: 'excellence', description: 'A demo seed.' },
            about: { title: 'About us', subtitle: 'Serving since 1998' },
            contact: { title: 'Contact', subtitle: '+91 98765 43210' },
          }),
        }),
      )
      const w = await wizard()
      expect(w.website.enabled).toBe(true)
      expect(w.website.hero.title).toBe('Wizard Setup School')
      // The school-owned section survived the platform fragment merge.
      const after = await db.school.findUnique({ where: { id: schoolId }, select: { websiteContent: true } })
      const merged = JSON.parse(after?.websiteContent || '{}') as { pillars?: unknown[] }
      expect(merged.pillars).toHaveLength(1)
    },
    T,
  )

  test(
    'module overrides: invalid module refused; valid override persists; readiness reflects fees',
    async () => {
      const bad = await platform(`/api/platform/schools/${schoolId}/feature-flags`, {
        method: 'PATCH',
        body: JSON.stringify({ nonexistent: true }),
      })
      expect(bad.status).toBe(422)

      await okData<{ featureFlags: Record<string, boolean> }>(
        await platform(`/api/platform/schools/${schoolId}/feature-flags`, {
          method: 'PATCH',
          body: JSON.stringify({ library: false }),
        }),
      )
      const w = await wizard()
      expect(w.modules.school.library).toBe(false)
      expect(w.modules.effective.library).toBe(false)
      // Optional steps now complete from persisted data
      const byId = stepMap(w.steps)
      expect(byId.get('fees')).toBe('completed')
      expect(byId.get('exams')).toBe('completed')
      expect(byId.get('website')).toBe('completed')
      expect(byId.get('modules')).toBe('completed')
      expect(byId.get('people')).toBe('completed')
    },
    T,
  )
})

describe('PHASE 2 · setup wizard — activation', () => {
  test(
    'STRICT activation succeeds when the checklist is truly persisted; audited; duplicate → CONFLICT',
    async () => {
      const res = await platform(`/api/platform/schools/${schoolId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ requireComplete: true }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { status: string; activation: { ok: boolean; strict: boolean; missing: Array<{ id: string }> } } }
      expect(body.data.status).toBe('ACTIVE')
      expect(body.data.activation.strict).toBe(true)
      expect(body.data.activation.ok).toBe(true)
      expect(body.data.activation.missing).toEqual([])
      expect((await db.school.findUnique({ where: { id: schoolId } }))?.status).toBe('ACTIVE')
      const audit = await db.platformAuditLog.findFirst({
        where: { schoolId, action: 'platform.school.activated' },
      })
      expect(audit).not.toBeNull()
      expect(audit?.metadata).toContain('"wizardStrict":true')

      // Duplicate activation (strict or not) is a typed CONFLICT.
      const dup = await platform(`/api/platform/schools/${schoolId}/activate`, {
        method: 'POST',
        body: JSON.stringify({ requireComplete: true }),
      })
      expect(dup.status).toBe(409)
      const dupNonStrict = await platform(`/api/platform/schools/${schoolId}/activate`, { method: 'POST' })
      expect(dupNonStrict.status).toBe(409)
    },
    T,
  )

  test(
    'post-activation: usable verdict still false until school-owned sections complete (honest handover)',
    async () => {
      const w = await wizard()
      // teachers exist, students do not; fee structures unpublished →
      // requiredComplete false → usable false (the readiness engine's
      // full-operational gate, untouched by the wizard).
      expect(w.readiness.summary.usable).toBe(false)
      expect(w.readiness.summary.requiredComplete).toBe(false)
    },
    T,
  )
})
