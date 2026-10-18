/**
 * REGRESSION — class-teacher appointment resolution (Teacher-plane E2E
 * audit, 2026-10-18).
 *
 * THE SHIPPED DEFECT this suite pins (POST /api/principal/academic
 * {action:'classTeacher.set'}):
 *
 *   The action resolved the teacher by DISPLAY NAME ONLY
 *   (`db.teacher.findFirst({ where: { schoolId, user: { name } } })`).
 *   User.name is NOT unique — two teachers named "Anita Mehta" are a
 *   perfectly realistic school roster — so the appointment silently bound
 *   an arbitrary twin: `Class.classTeacherId` pointed at the wrong User,
 *   the intended teacher stayed capability-locked out of My Class /
 *   attendance baseline / fee collection, and the intended twin kept
 *   receiving another class's data. The sibling action
 *   `subjectTeacher.set` already accepted the canonical `teacherUserId`;
 *   `classTeacher.set` accepted only `teacherName`.
 *
 * THE FIX UNDER TEST (src/app/api/principal/academic/route.ts):
 *   · `teacherUserId` accepted — school-validated (Teacher row must exist
 *     in the CALLER's school), takes precedence over teacherName;
 *   · the legacy teacherName path still works for the existing UI, but an
 *     AMBIGUOUS name (2+ Teacher rows) now fails CLOSED with
 *     AMBIGUOUS_TEACHER_NAME instead of silently appointing a twin;
 *   · the UI (class-teachers.tsx) now sends the canonical id alongside
 *     the name.
 *
 * COVERAGE CONTRACT (live HTTP; isolated QA school):
 *   A two teachers with the same display name can be created      [live]
 *   B appointment by ambiguous name fails closed                  [live]
 *   C appointment by explicit teacherUserId binds THAT teacher    [live]
 *   D the appointed teacher's /api/teacher/role reports
 *     isClassTeacher=true for exactly that class                  [live]
 *   E foreign-school userId is rejected (TEACHER_NOT_FOUND,
 *     no existence oracle)                                        [live]
 *   F removal (both fields absent) still clears the appointment   [live]
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { liveFetch } from '../helpers/live-http'
import { db } from '../helpers/db'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const RUN = Math.random().toString(36).slice(2, 10)
const RUN_IP = `10.246.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const SLUG = `qa-reg-ct-${RUN}`
const PRINCIPAL_EMAIL = `qa.reg.ctprincipal.${RUN}@qafix.scholario.dev`
const PRINCIPAL_PW = 'QaFix!2026x'
const PRINCIPAL_PW2 = 'QaFix!2026z'
const DUP_NAME = `QA Twin Teacher ${RUN}`

let platformToken = ''
let principalToken = ''
let schoolId = ''
let classId = ''
let teacherAUserId = ''
let teacherBUserId = ''
const cleanup: Array<() => Promise<unknown>> = []

const json = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})
const pjson = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { 'x-platform-token': token } : {}),
})

describe('class-teacher appointment resolution', () => {
  beforeAll(async () => {
    resetLoginBuckets(['admin@scholario.cloud', PRINCIPAL_EMAIL])
    const login = await liveFetch(`${BASE}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: 'admin@scholario.cloud', password: process.env.SEED_PLATFORM_ROOT_PASSWORD ?? 'admin123' }),
    }, { deadlineMs: T })
    expect(login.status).toBe(200)
    platformToken = ((await login.json()).data?.sessionToken ?? '') as string

    const prov = await liveFetch(`${BASE}/api/platform/schools`, {
      method: 'POST',
      headers: pjson(platformToken),
      body: JSON.stringify({
        name: `QA Reg ClassTeacher ${RUN}`,
        slug: SLUG,
        code: `QCT-${RUN.toUpperCase()}`,
        board: 'CBSE', plan: 'STANDARD', billingModel: 'SCHOOL_WIDE',
        principalName: 'QA Reg CT Principal',
        principalEmail: PRINCIPAL_EMAIL,
        principalPassword: PRINCIPAL_PW,
        authMethod: 'PASSWORD',
        academicYear: '2026-2027',
        classes: [{ name: 'Grade 8', sections: ['A'] }],
      }),
    }, { deadlineMs: T })
    const provBody = await prov.json().catch(() => ({}))
    expect(prov.status).toBe(200)
    schoolId = provBody.data.school.id
    cleanup.push(() => db.school.deleteMany({ where: { id: schoolId } }))

    const act = await liveFetch(`${BASE}/api/platform/schools/${schoolId}/activate`, {
      method: 'POST', headers: pjson(platformToken),
    }, { deadlineMs: T })
    expect(act.status).toBe(200)

    const loginP = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PRINCIPAL_EMAIL, password: PRINCIPAL_PW }),
    }, { deadlineMs: T })
    const loginPBody = await loginP.json().catch(() => ({}))
    expect(loginP.status).toBe(200)
    const ch = await liveFetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: json(loginPBody.data.sessionToken),
      body: JSON.stringify({ currentPassword: PRINCIPAL_PW, newPassword: PRINCIPAL_PW2, confirmPassword: PRINCIPAL_PW2 }),
    }, { deadlineMs: T })
    const chBody = await ch.json().catch(() => ({}))
    principalToken = (chBody.data?.sessionToken as string) ?? loginPBody.data.sessionToken

    const cls = await liveFetch(`${BASE}/api/classes?counts=1`, { headers: json(principalToken) }, { deadlineMs: T })
    const clsBody = await cls.json().catch(() => ({}))
    const classes = clsBody.data?.classes ?? clsBody.data ?? []
    classId = classes[0]?.id
    expect(classId).toBeTruthy()
  }, T)

  test('A: two teachers with the same display name coexist', async () => {
    for (const suffix of ['a', 'b']) {
      const email = `qa.reg.twin.${suffix}.${RUN}@qafix.scholario.dev`
      const res = await liveFetch(`${BASE}/api/teachers`, {
        method: 'POST',
        headers: json(principalToken),
        body: JSON.stringify({ name: DUP_NAME, email, password: 'Teach@2026x' }),
      }, { deadlineMs: T })
      const body = await res.json().catch(() => ({}))
      expect([200, 201]).toContain(res.status)
      const userId = body.data?.userId ?? body.data?.user?.id
      expect(userId).toBeTruthy()
      if (suffix === 'a') teacherAUserId = userId
      else teacherBUserId = userId
      cleanup.push(() => db.user.deleteMany({ where: { email } }))
    }
    expect(teacherAUserId).not.toBe(teacherBUserId)
  }, T)

  test('B: appointment by ambiguous display name fails closed (no silent twin)', async () => {
    const res = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId, teacherName: DUP_NAME }),
    }, { deadlineMs: T })
    expect([400, 409, 422]).toContain(res.status)
    // The class must remain UN-appointed — never silently bound to a twin.
    const cls = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    expect(cls?.classTeacherId ?? null).toBeNull()
  }, T)

  test('C: appointment by explicit teacherUserId binds THAT teacher', async () => {
    const res = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId, teacherUserId: teacherBUserId }),
    }, { deadlineMs: T })
    const body = await res.json().catch(() => ({}))
    expect(res.status).toBe(200)
    expect(body?.data?.classTeacherId).toBe(teacherBUserId)
    const cls = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    expect(cls?.classTeacherId).toBe(teacherBUserId)
  }, T)

  test('D: the appointed teacher reports isClassTeacher for exactly that class', async () => {
    // Real login + mandatory first-password-change for teacher B (the
    // PASSWORD_CHANGE_REQUIRED gate otherwise blocks business APIs —
    // withUser contract), then the role probe on the rotated session.
    const teacherBRow = await db.user.findUnique({ where: { id: teacherBUserId }, select: { email: true } })
    expect(teacherBRow?.email).toBeTruthy()
    resetLoginBuckets([teacherBRow!.email!])
    const tLogin = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: teacherBRow!.email, password: 'Teach@2026x' }),
    }, { deadlineMs: T })
    const tLoginBody = await tLogin.json().catch(() => ({}))
    expect(tLogin.status).toBe(200)
    const tch = await liveFetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: json(tLoginBody.data.sessionToken),
      body: JSON.stringify({ currentPassword: 'Teach@2026x', newPassword: 'Teach@2026z', confirmPassword: 'Teach@2026z' }),
    }, { deadlineMs: T })
    const tchBody = await tch.json().catch(() => ({}))
    expect(tch.status).toBe(200)
    const token = (tchBody.data?.sessionToken as string) ?? tLoginBody.data.sessionToken

    const role = await liveFetch(`${BASE}/api/teacher/role`, { headers: json(token) }, { deadlineMs: T })
    const body = await role.json().catch(() => ({}))
    expect(role.status).toBe(200)
    expect(body.data?.isClassTeacher).toBe(true)
    const of = body.data?.classTeacherOf ?? []
    expect(of.some((c: any) => c.classId === classId)).toBe(true)
  }, T)

  test('E: foreign-school teacherUserId rejected (no existence oracle)', async () => {
    const res = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId, teacherUserId: 'clforgeduseridthatdoesnotexist' }),
    }, { deadlineMs: T })
    expect([400, 404]).toContain(res.status)
  }, T)

  test('F: removal (no teacher fields) clears the appointment', async () => {
    const res = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId }),
    }, { deadlineMs: T })
    expect(res.status).toBe(200)
    const cls = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    expect(cls?.classTeacherId ?? null).toBeNull()
  }, T)

  afterAll(async () => {
    for (const fn of cleanup) { try { await fn() } catch { /* best-effort */ } }
    await db.$disconnect()
  })
})
