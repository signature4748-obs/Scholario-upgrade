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
 * COVERAGE CONTRACT (live HTTP; isolated QA schools):
 *   A two teachers with the same display name can be created      [live]
 *   B appointment by ambiguous name fails closed                  [live]
 *   C appointment by explicit teacherUserId binds THAT teacher    [live]
 *   D the appointed teacher's /api/teacher/role reports
 *     isClassTeacher=true for exactly that class                  [live]
 *   E foreign-school userId is rejected (TEACHER_NOT_FOUND,
 *     no existence oracle)                                        [live]
 *   F removal (both fields absent) still clears the appointment   [live]
 *   G a REAL wrong-school teacherUserId (a genuine Teacher row of
 *     a second QA school) is rejected and mutates nothing — the
 *     school scoping must hold for real ids, not just forged ones [live]
 *   H reassignment transfers the capability BOTH ways: the new
 *     teacher gains isClassTeacher, the previous one loses it
 *     (role + attendance board scope)                             [live]
 *   I the appointed teacher's DASHBOARD and ATTENDANCE surfaces
 *     follow the appointment: dashboard.classTeacherOf, the
 *     attendance board isClassTeacher flag, and a real baseline
 *     WRITE persisted to the canonical Attendance table           [live]
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
const SLUG2 = `qa-reg-ct2-${RUN}`
const PRINCIPAL_EMAIL = `qa.reg.ctprincipal.${RUN}@qafix.scholario.dev`
const PRINCIPAL2_EMAIL = `qa.reg.ctprincipal2.${RUN}@qafix.scholario.dev`
const PRINCIPAL_PW = 'QaFix!2026x'
const PRINCIPAL_PW2 = 'QaFix!2026z'
const DUP_NAME = `QA Twin Teacher ${RUN}`

let platformToken = ''
let principalToken = ''
let principal2Token = ''
let schoolId = ''
let school2Id = ''
let classId = ''
let teacherAUserId = ''
let teacherBUserId = ''
let teacherBToken = ''
let teacherAToken = ''
let foreignTeacherUserId = ''
let foreignTeacherEmail = ''
const studentIds: string[] = []
const cleanup: Array<() => Promise<unknown>> = []

const json = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})
const pjson = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { 'x-platform-token': token } : {}),
})

/** The school's TODAY on the IST calendar (the baseline route rejects
 *  future dates on the IST day key — the probe must mark today, IST). */
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

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

    // ── SECOND QA SCHOOL (the real wrong-school fixture for G) ────────
    resetLoginBuckets([PRINCIPAL2_EMAIL])
    const prov2 = await liveFetch(`${BASE}/api/platform/schools`, {
      method: 'POST',
      headers: pjson(platformToken),
      body: JSON.stringify({
        name: `QA Reg ClassTeacher B-School ${RUN}`,
        slug: SLUG2,
        code: `QCT2-${RUN.toUpperCase()}`,
        board: 'CBSE', plan: 'STANDARD', billingModel: 'SCHOOL_WIDE',
        principalName: 'QA Reg CT Principal Two',
        principalEmail: PRINCIPAL2_EMAIL,
        principalPassword: PRINCIPAL_PW,
        authMethod: 'PASSWORD',
        academicYear: '2026-2027',
        classes: [{ name: 'Grade 8', sections: ['A'] }],
      }),
    }, { deadlineMs: T })
    const prov2Body = await prov2.json().catch(() => ({}))
    expect(prov2.status).toBe(200)
    school2Id = prov2Body.data.school.id
    cleanup.push(() => db.school.deleteMany({ where: { id: school2Id } }))
    const act2 = await liveFetch(`${BASE}/api/platform/schools/${school2Id}/activate`, {
      method: 'POST', headers: pjson(platformToken),
    }, { deadlineMs: T })
    expect(act2.status).toBe(200)

    const loginP2 = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: PRINCIPAL2_EMAIL, password: PRINCIPAL_PW }),
    }, { deadlineMs: T })
    const loginP2Body = await loginP2.json().catch(() => ({}))
    expect(loginP2.status).toBe(200)
    const ch2 = await liveFetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: json(loginP2Body.data.sessionToken),
      body: JSON.stringify({ currentPassword: PRINCIPAL_PW, newPassword: PRINCIPAL_PW2, confirmPassword: PRINCIPAL_PW2 }),
    }, { deadlineMs: T })
    const ch2Body = await ch2.json().catch(() => ({}))
    principal2Token = (ch2Body.data?.sessionToken as string) ?? loginP2Body.data.sessionToken

    // A REAL teacher of school 2 — a live Teacher+User pair whose userId
    // school 1's appointment must refuse (unique display name: the probe
    // targets the id, never an ambiguous name).
    foreignTeacherEmail = `qa.reg.foreign.${RUN}@qafix.scholario.dev`
    const tx = await liveFetch(`${BASE}/api/teachers`, {
      method: 'POST',
      headers: json(principal2Token),
      body: JSON.stringify({ name: `QA Foreign Teacher ${RUN}`, email: foreignTeacherEmail, password: 'Teach@2026x' }),
    }, { deadlineMs: T })
    const txBody = await tx.json().catch(() => ({}))
    expect([200, 201]).toContain(tx.status)
    foreignTeacherUserId = (txBody.data?.userId ?? txBody.data?.user?.id) as string
    expect(foreignTeacherUserId).toBeTruthy()
    cleanup.push(() => db.user.deleteMany({ where: { email: foreignTeacherEmail } }))

    // ── STUDENTS in the class (the canonical baseline WRITE needs a real
    // roster to persist Attendance rows for test I) ─────────────────────
    for (let i = 1; i <= 2; i++) {
      const email = `qa.reg.ctstudent.${i}.${RUN}@qafix.scholario.dev`
      const res = await liveFetch(`${BASE}/api/students`, {
        method: 'POST',
        headers: json(principalToken),
        body: JSON.stringify({
          name: `QA CT Student ${i} ${RUN}`,
          email,
          password: 'Stu@2026xyz',
          classId,
          rollNo: `${i}`,
        }),
      }, { deadlineMs: T })
      const body = await res.json().catch(() => ({}))
      expect([200, 201]).toContain(res.status)
      const sid = body.data?.id ?? body.data?.student?.id
      expect(sid).toBeTruthy()
      studentIds.push(sid as string)
      cleanup.push(() => db.user.deleteMany({ where: { email } }))
    }
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
    teacherBToken = token

    const role = await liveFetch(`${BASE}/api/teacher/role`, { headers: json(token) }, { deadlineMs: T })
    const body = await role.json().catch(() => ({}))
    expect(role.status).toBe(200)
    expect(body.data?.isClassTeacher).toBe(true)
    const of = body.data?.classTeacherOf ?? []
    expect(of.some((c: any) => c.id === classId)).toBe(true)
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

  test('G: a REAL wrong-school teacherUserId is rejected and mutates nothing', async () => {
    // E covers a FORGED id; THIS is the actual cross-tenant oracle probe:
    // a genuine Teacher row (with a live User row) of a DIFFERENT school.
    // The school-scoped validation must reject it exactly the same — and
    // the persisted appointment must not move.
    expect(foreignTeacherUserId).toBeTruthy()
    const pre = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    const res = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId, teacherUserId: foreignTeacherUserId }),
    }, { deadlineMs: T })
    expect([400, 404]).toContain(res.status)
    const post = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    expect(post?.classTeacherId ?? null).toBe(pre?.classTeacherId ?? null)
  }, T)

  test('H: reassignment transfers the capability BOTH ways (new gains, previous loses)', async () => {
    // Twin A takes over from twin B: A must gain isClassTeacher, B must
    // lose it — including the attendance board scope derived from the
    // SAME canonical column (no stale grant may survive the swap).
    const teacherARow = await db.user.findUnique({ where: { id: teacherAUserId }, select: { email: true } })
    expect(teacherARow?.email).toBeTruthy()
    resetLoginBuckets([teacherARow!.email!])
    const aLogin = await liveFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({ email: teacherARow!.email, password: 'Teach@2026x' }),
    }, { deadlineMs: T })
    const aLoginBody = await aLogin.json().catch(() => ({}))
    expect(aLogin.status).toBe(200)
    const ach = await liveFetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: json(aLoginBody.data.sessionToken),
      body: JSON.stringify({ currentPassword: 'Teach@2026x', newPassword: 'Teach@2026z', confirmPassword: 'Teach@2026z' }),
    }, { deadlineMs: T })
    expect(ach.status).toBe(200)
    const achBody = await ach.json().catch(() => ({}))
    teacherAToken = (achBody.data?.sessionToken as string) ?? aLoginBody.data.sessionToken

    const set = await liveFetch(`${BASE}/api/principal/academic`, {
      method: 'POST',
      headers: json(principalToken),
      body: JSON.stringify({ action: 'classTeacher.set', classId, teacherUserId: teacherAUserId }),
    }, { deadlineMs: T })
    const setBody = await set.json().catch(() => ({}))
    expect(set.status).toBe(200)
    expect(setBody?.data?.classTeacherId).toBe(teacherAUserId)
    const cls = await db.class.findUnique({ where: { id: classId }, select: { classTeacherId: true } })
    expect(cls?.classTeacherId).toBe(teacherAUserId)

    const roleA = await liveFetch(`${BASE}/api/teacher/role`, { headers: json(teacherAToken) }, { deadlineMs: T })
    const roleABody = await roleA.json().catch(() => ({}))
    expect(roleA.status).toBe(200)
    expect(roleABody.data?.isClassTeacher).toBe(true)

    const roleB = await liveFetch(`${BASE}/api/teacher/role`, { headers: json(teacherBToken) }, { deadlineMs: T })
    const roleBBody = await roleB.json().catch(() => ({}))
    expect(roleB.status).toBe(200)
    expect(roleBBody.data?.isClassTeacher).toBe(false)

    // B's attendance board scope is revoked with the appointment (B holds
    // no subject assignments in this school — the class-scope guard
    // refuses outright).
    const boardB = await liveFetch(`${BASE}/api/teacher/class-attendance/board?classId=${classId}&date=${istToday()}`, { headers: json(teacherBToken) }, { deadlineMs: T })
    expect(boardB.status).toBe(403)
  }, T)

  test('I: the appointed teacher sees the class on the dashboard and holds attendance authorization', async () => {
    // Twin A is the sitting class teacher (appointed in H).
    const dash = await liveFetch(`${BASE}/api/teacher/dashboard`, { headers: json(teacherAToken) }, { deadlineMs: T })
    const dashBody = await dash.json().catch(() => ({}))
    expect(dash.status).toBe(200)
    expect(Array.isArray(dashBody.data?.classTeacherOf)).toBe(true)
    expect(dashBody.data.classTeacherOf.some((c: { classId?: string }) => c.classId === classId)).toBe(true)

    const board = await liveFetch(`${BASE}/api/teacher/class-attendance/board?classId=${classId}&date=${istToday()}`, { headers: json(teacherAToken) }, { deadlineMs: T })
    const boardBody = await board.json().catch(() => ({}))
    expect(board.status).toBe(200)
    expect(boardBody.data?.isClassTeacher).toBe(true)

    // The authorization that MATTERS — the canonical baseline WRITE. The
    // roster is re-derived server-side; every entry must be accepted and
    // the rows must land in the Attendance table (students were seeded in
    // beforeAll for exactly this assertion).
    expect(studentIds.length).toBeGreaterThan(0)
    const save = await liveFetch(`${BASE}/api/teacher/class-attendance/baseline`, {
      method: 'POST',
      headers: json(teacherAToken),
      body: JSON.stringify({
        classId,
        date: istToday(),
        entries: studentIds.map((studentId) => ({ studentId, status: 'PRESENT' })),
      }),
    }, { deadlineMs: T })
    expect(save.status).toBe(200)
    const saved = await db.attendance.count({
      where: { classId, date: new Date(`${istToday()}T00:00:00.000Z`) },
    })
    expect(saved).toBe(studentIds.length)
  }, T)

  afterAll(async () => {
    for (const fn of cleanup) { try { await fn() } catch { /* best-effort */ } }
    await db.$disconnect()
  })
})
