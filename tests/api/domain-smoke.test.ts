import { db } from '../helpers/db'
/**
 * PHASE 4 (item 10) — API DOMAIN SMOKE tests (prioritized domains).
 *
 * One or two golden-path checks per domain against the LIVE dev server,
 * all through REAL logins (env-driven demo/fixture credentials from
 * tests/helpers/credentials.ts — same source the seeds plant, so the
 * harness and corpus can never drift).
 *
 * Domains: auth (login → me → logout), admissions (public inquiry form),
 * fees, payments (transactions/catalogue), attendance, exams, timetable,
 * teacher permissions, principal permissions, student permissions,
 * parent access.
 *
 * Self-cleaning: the admissions inquiry writes a Notification +
 * ActivityLog row (title/detail carry the `test-p4-` marker) — both are
 * swept in afterAll. Sessions created by the direct-session fallback are
 * short-lived (1h) and belong to fixture accounts.
 */
import { describe, test, expect, afterAll, beforeAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { DEMO_PRINCIPAL_EMAIL, DEMO_PRINCIPAL_PASSWORD, TENANT_FIXTURE_PASSWORD } from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'

const T = 45000 // generous: first-hit dev compilation

const RUN_IP = `10.231.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const FIXTURE_PW = TENANT_FIXTURE_PASSWORD
const DEMO_PRINCIPAL = { email: DEMO_PRINCIPAL_EMAIL, password: DEMO_PRINCIPAL_PASSWORD }
const tokens: Record<string, string> = {}

// ── auth helpers (login with rate-limit fallback, tenant-isolation pattern) ──

async function login(email: string, password: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 429) {
    console.warn(`[domain-smoke] login rate-limited for ${email}; using direct session fixture`)
    return (tokens[email] = await directSession(email))
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) throw new Error(`login failed for ${email}`)
  return (tokens[email] = body.data.sessionToken)
}

async function directSession(email: string): Promise<string> {
  const u = await db.user.findUnique({ where: { email } })
  if (!u) throw new Error(`no fixture user ${email}`)
  const token = randomBytes(32).toString('hex')
  // PHASE 8A — the row stores the hash; the RAW token keeps riding the
  // Authorization header (identical to a server-minted session).
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(email: string, path: string, init?: RequestInit, password = FIXTURE_PW): Promise<Response> {
  const token = await login(email, password)
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

afterAll(async () => {
  // sweep the admissions-inquiry probe rows (Notification + ActivityLog)
  await db.notification.deleteMany({ where: { title: { startsWith: 'New Admission Inquiry: test-p4-' } } })
  await db.activityLog.deleteMany({ where: { action: 'ADMISSION_INQUIRY', detail: { contains: 'test-p4-' } } })
  await db.$disconnect()
})

beforeAll(async () => {
  await fetch(`${BASE}/api/admissions/public`, { method: 'GET' }).catch(() => undefined) // 405 — route warm
}, 60000)

// ══════════════════════════════════════════════════════════════════════
// 1. AUTH domain — the full session lifecycle via the HTTP cookie
// ══════════════════════════════════════════════════════════════════════

describe('auth domain · session lifecycle (demo principal, real cookie)', () => {
  test('login → 200 + HttpOnly session cookie + user payload', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify(DEMO_PRINCIPAL),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie!).toContain('erp_session=')
    expect(setCookie!.toLowerCase()).toContain('httponly') // never scriptable
    const body = (await res.json()) as { ok: boolean; data: { id: string; email: string; role: string } }
    expect(body.ok).toBe(true)
    expect(body.data.email).toBe(DEMO_PRINCIPAL.email)
    expect(body.data.role).toBe('PRINCIPAL')
  }, T)

  test('me → 200 with the session identity; logout → 200; me again → 401', async () => {
    // login fresh and drive the WHOLE chain on the cookie alone
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify(DEMO_PRINCIPAL),
    })
    expect(loginRes.status).toBe(200)
    const setCookie = loginRes.headers.get('set-cookie')!
    const cookie = `erp_session=${setCookie.split('erp_session=')[1].split(';')[0]}`

    const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { ok: boolean; data: { user: { email: string; role: string } } }
    expect(meBody.ok).toBe(true)
    expect(meBody.data.user.email).toBe(DEMO_PRINCIPAL.email)
    expect(meBody.data.user.role).toBe('PRINCIPAL')

    const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } })
    expect(logout.status).toBe(200)
    expect((await logout.json()) as { ok: boolean }).toMatchObject({ ok: true })

    const meAfter = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })
    expect(meAfter.status).toBe(401) // the session row is destroyed server-side
    const afterBody = (await meAfter.json()) as { ok: boolean; code: string }
    expect(afterBody.ok).toBe(false)
    expect(afterBody.code).toBe('AUTH_REQUIRED')
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 2. ADMISSIONS domain — the public inquiry form (unauthenticated)
// ══════════════════════════════════════════════════════════════════════

describe('admissions domain · public inquiry form', () => {
  test('POST /api/admissions/public (no session) → 200 success:true (probe rows self-cleaned)', async () => {
    const marker = `test-p4-inquiry-${Date.now().toString(36)}`
    const res = await fetch(`${BASE}/api/admissions/public`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
      body: JSON.stringify({
        studentName: marker,
        parentName: 'P4 Smoke Parent',
        phone: '+919000000004',
        email: '',
        grade: 'Grade 5',
        notes: 'phase-4 domain smoke',
        schoolSlug: 'sunrise-academy',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; message: string }
    expect(body.success).toBe(true)
    // the inquiry landed for the RIGHT tenant (sunrise-academy)
    const notif = await db.notification.findFirst({ where: { title: { startsWith: `New Admission Inquiry: ${marker}` } } })
    expect(notif).not.toBeNull()
    expect(notif!.schoolId).not.toBeNull()
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 3. FINANCE domain — fees + payments (principal golden path)
// ══════════════════════════════════════════════════════════════════════

describe('fees domain · principal golden path', () => {
  test('GET /api/fees → 200 {ok:true, data array}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/fees')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  }, T)

  test('GET /api/fees/transactions → 200 {ok:true}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/fees/transactions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)

  test('GET /api/fees/catalogue → 200 {ok:true}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/fees/catalogue')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 4. ACADEMICS domain — attendance, exams, timetable
// ══════════════════════════════════════════════════════════════════════

describe('academics domain · attendance / exams / timetable (principal)', () => {
  test('GET /api/attendance/overview → 200 {ok:true}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/attendance/overview')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)

  test('GET /api/exams → 200 {ok:true, data.exams present}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/exams')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: { exams: unknown[]; classes: unknown[] } }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.exams)).toBe(true)
  }, T)

  test('GET /api/timetable → 200 {ok:true}', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/timetable')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 5. TEACHER permissions
// ══════════════════════════════════════════════════════════════════════

describe('teacher permissions (fixture teacher)', () => {
  test('GET /api/teacher/dashboard → 200 {ok:true} (teacher surface)', async () => {
    const res = await as('tenant.teacher.a@sunrise.test', '/api/teacher/dashboard')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)

  test('GET /api/students as teacher → 200 (teachers read the roster)', async () => {
    const res = await as('tenant.teacher.a@sunrise.test', '/api/students')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  }, T)

  test('GET /api/platform/settings as teacher (school session) → 401 (platform boundary)', async () => {
    // PHASE 6 — the platform control plane has its own credential space;
    // a school session never reaches platform routes.
    const res = await as('tenant.teacher.a@sunrise.test', '/api/platform/settings')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('AUTH_REQUIRED')
  }, T)

  test('GET /api/teacher/dashboard as PRINCIPAL → 403 (role gate is symmetric)', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/teacher/dashboard')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 6. PRINCIPAL permissions + write-path validation
// ══════════════════════════════════════════════════════════════════════

describe('principal permissions + write-path validation', () => {
  test('GET /api/dashboard → 200 {ok:true} (principal home surface)', async () => {
    const res = await as('tenant.principal.a@sunrise.test', '/api/dashboard')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)

  test('POST /api/fees with NO body → 422 VALIDATION_FAILED (no rows written)', async () => {
    const before = await db.fee.count()
    const res = await as('tenant.principal.a@sunrise.test', '/api/fees', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(typeof body.error).toBe('string')
    const after = await db.fee.count()
    expect(after).toBe(before) // validation failed BEFORE any write
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 7. STUDENT permissions
// ══════════════════════════════════════════════════════════════════════

describe('student permissions (fixture student)', () => {
  test('GET /api/student/dashboard → 200 {ok:true} (student surface)', async () => {
    const res = await as('tenant.student.a@sunrise.test', '/api/student/dashboard')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  }, T)

  test('GET /api/teachers as student → 403 FORBIDDEN (staff read is gated)', async () => {
    const res = await as('tenant.student.a@sunrise.test', '/api/teachers')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('FORBIDDEN')
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// 8. PARENT access (school-wide reference data)
// ══════════════════════════════════════════════════════════════════════

describe('parent permissions (fixture parent)', () => {
  test('GET /api/events as parent → 200 {ok:true} (school-wide calendar)', async () => {
    const res = await as('tenant.parent.a@sunrise.test', '/api/events')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  }, T)
})
