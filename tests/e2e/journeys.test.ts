import { db } from '../helpers/db'
/**
 * PHASE 4 (item 10) — E2E JOURNEYS: live-HTTP user journeys against the
 * dev server (process.env.E2E_BASE_URL ?? 'http://localhost:3000').
 *
 * The E2E nature: each journey drives its WHOLE chain inside ONE session
 * (the erp_session cookie from POST /api/auth/login is propagated via a
 * manual Cookie header — the same transport a real browser uses). If any
 * step breaks, the journey fails — no per-step session re-establishment.
 *
 *   Journey 1 — principal : login → me → dashboard → students → fees
 *                          defaulters → exams → timetable → logout →
 *                          (me now 401)
 *   Journey 2 — teacher   : login → dashboard → class-hub → logout
 *   Journey 3 — student   : login → student dashboard → student
 *                          timetable → logout
 *   Journey 4 — public    : GET / (HTML) + /health/live
 *
 * Re-runnability: real logins first; when the login rate limiter has
 * consumed the IP budget the helper falls back to a direct session-row
 * fixture (the tenant-isolation pattern — bypasses ONLY the limiter,
 * never an authorization gate). A unique X-Forwarded-For per run keeps
 * the per-IP bucket fresh.
 */
import { describe, test, expect, beforeAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

const T = 45000 // generous: first-hit dev compilation

const RUN_IP = `10.222.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const FIXTURE_PW = 'ScholarioTest2026'

interface Journey {
  cookie: string
}

/** Real login → session cookie (direct-session fallback on rate limit). */
async function loginJourney(email: string, password: string): Promise<Journey> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 429) {
    console.warn(`[e2e] login rate-limited for ${email}; using direct session fixture`)
    const u = await db.user.findUnique({ where: { email } })
    if (!u) throw new Error(`no fixture user ${email}`)
    const token = randomBytes(32).toString('hex')
    // PHASE 8A — the row stores sha256(token); the RAW token rides the
    // cookie below (identical to a server-minted session).
    await db.session.create({
      data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
    })
    return { cookie: `erp_session=${token}` }
  }
  const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
  if (!body.ok || !body.data?.sessionToken) throw new Error(`login failed for ${email}`)
  // The session cookie IS the session token (HttpOnly, set by the server).
  // Extract it from Set-Cookie so the journey runs on the cookie transport
  // exactly like a browser (not the dev bearer shortcut).
  const setCookie = res.headers.get('set-cookie') ?? ''
  const fromHeader = setCookie.includes('erp_session=')
    ? setCookie.split('erp_session=')[1].split(';')[0]
    : null
  const token = fromHeader ?? body.data.sessionToken
  return { cookie: `erp_session=${token}` }
}

async function step(j: Journey, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie: j.cookie, 'content-type': 'application/json' },
  })
}

/** A golden-path step: 200 + {ok:true} + data present (array or object). */
async function expectOkData(res: Response, _label: string): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: unknown }
  expect(body.ok).toBe(true)
  expect(body.data).not.toBeNull()
  expect(body.data).not.toBeUndefined()
  return body as Record<string, unknown>
}

beforeAll(async () => {
  // warm the public page once (first-hit compilation)
  await fetch(`${BASE}/`).catch(() => undefined)
}, 60000)

// ══════════════════════════════════════════════════════════════════════
// Journey 1 — the PRINCIPAL day-one chain (one session, cookie only)
// ══════════════════════════════════════════════════════════════════════

describe('E2E Journey 1 · principal (login → modules → logout, one session)', () => {
  test('demo principal completes the full module chain', async () => {
    const j = await loginJourney('principal@sunriseacademy.edu', 'password123')

    // identity
    const me = await step(j, '/api/auth/me')
    const meBody = await expectOkData(me, 'me')
    const user = (meBody.data as { user: { email: string; role: string } }).user
    expect(user.email).toBe('principal@sunriseacademy.edu')
    expect(user.role).toBe('PRINCIPAL')

    // home dashboard
    await expectOkData(await step(j, '/api/dashboard'), 'dashboard')

    // students directory
    const students = await expectOkData(await step(j, '/api/students'), 'students')
    expect(Array.isArray((students as { data: unknown[] }).data)).toBe(true)

    // fees defaulters (finance module)
    await expectOkData(await step(j, '/api/fees/defaulters'), 'fees defaulters')

    // exams list (academics)
    const exams = await expectOkData(await step(j, '/api/exams'), 'exams')
    expect(Array.isArray(((exams as { data: { exams: unknown[] } }).data).exams)).toBe(true)

    // timetable
    await expectOkData(await step(j, '/api/timetable'), 'timetable')

    // logout ends the session server-side
    const logout = await step(j, '/api/auth/logout', { method: 'POST' })
    expect(logout.status).toBe(200)
    const after = await step(j, '/api/auth/me')
    expect(after.status).toBe(401) // the cookie no longer authorizes anything
    const afterBody = (await after.json()) as { ok: boolean; code: string }
    expect(afterBody.ok).toBe(false)
    expect(afterBody.code).toBe('AUTH_REQUIRED')
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// Journey 2 — the TEACHER chain
// ══════════════════════════════════════════════════════════════════════

describe('E2E Journey 2 · teacher (login → dashboard → class-hub → logout)', () => {
  test('fixture teacher completes the teaching chain', async () => {
    const j = await loginJourney('tenant.teacher.a@sunrise.test', FIXTURE_PW)

    const me = await step(j, '/api/auth/me')
    const meBody = await expectOkData(me, 'me')
    expect((meBody.data as { user: { role: string } }).user.role).toBe('TEACHER')

    await expectOkData(await step(j, '/api/teacher/dashboard'), 'teacher dashboard')

    await expectOkData(await step(j, '/api/teacher/class-hub'), 'class hub')

    const logout = await step(j, '/api/auth/logout', { method: 'POST' })
    expect(logout.status).toBe(200)
    const after = await step(j, '/api/auth/me')
    expect(after.status).toBe(401)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// Journey 3 — the STUDENT chain
// ══════════════════════════════════════════════════════════════════════

describe('E2E Journey 3 · student (login → dashboard → timetable → logout)', () => {
  test('fixture student completes the student chain', async () => {
    const j = await loginJourney('tenant.student.a@sunrise.test', FIXTURE_PW)

    const me = await step(j, '/api/auth/me')
    const meBody = await expectOkData(me, 'me')
    const user = (meBody.data as { user: { role: string; student?: unknown } }).user
    expect(user.role).toBe('STUDENT')
    expect(user.student).not.toBeNull() // server-resolved enrollment context

    await expectOkData(await step(j, '/api/student/dashboard'), 'student dashboard')

    await expectOkData(await step(j, '/api/student/timetable'), 'student timetable')

    const logout = await step(j, '/api/auth/logout', { method: 'POST' })
    expect(logout.status).toBe(200)
    const after = await step(j, '/api/auth/me')
    expect(after.status).toBe(401)
  }, T)
})

// ══════════════════════════════════════════════════════════════════════
// Journey 4 — the PUBLIC visitor (no session)
// ══════════════════════════════════════════════════════════════════════

describe('E2E Journey 4 · public visitor', () => {
  test('GET / serves the public site HTML', async () => {
    const res = await fetch(`${BASE}/`)
    expect(res.status).toBe(200)
    expect((res.headers.get('content-type') ?? '').includes('text/html')).toBe(true)
    const html = await res.text()
    expect(html.toLowerCase()).toContain('scholario')
  }, T)

  test('GET /health/live is 200 for an anonymous visitor', async () => {
    const res = await fetch(`${BASE}/health/live`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  }, T)
})
