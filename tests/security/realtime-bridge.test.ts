/**
 * Task 8B-7-b — Realtime bridge (Supabase Realtime broadcast) contract +
 * security suite.
 *
 * Proves the three layers of the Phase-8B realtime migration:
 *
 *   1. CAPABILITY DERIVATION (unit) — channelsForUser hands students the
 *      tenant-wide + own-user channels only, staff roles additionally the
 *      staff channel; school channel names are tenant-scoped and
 *      UNGUESSABLE (per-tenant HMAC signature differs); user channels are
 *      unique per recipient; platform admins get nothing.
 *
 *   2. /api/realtime/config (live HTTP, dev server :3000, real sessions
 *      minted as DIRECT rows — the messaging-persistence conventions):
 *      unauthenticated callers get a bare 401 envelope (no channel names,
 *      no keys); a student's config carries exactly 2 channels and NEVER
 *      a staff channel; a teacher gets 3 including staff; the response is
 *      the public anon key only (never the service-role key) and is
 *      served no-store.
 *
 *   3. PUBLISHER WIRING (unit with a stubbed global fetch) —
 *      publishToUser / publishToSchool POST the exact Supabase Realtime
 *      REST broadcast envelope: one message whose topic is the derived
 *      capability channel, whose event is the event kind, and whose
 *      payload is { kind, id, at, …notification hints }; the publisher is
 *      fire-safe when the REST call fails.
 *
 * Run (sandbox DATABASE_URL prefix):
 *   export DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env | head -1)" \
 *     && bun test tests/security/realtime-bridge.test.ts
 *
 * PHASE 8C FIX — environment adaptation (the parked CI was red by design):
 * this suite was authored against a Supabase-env sandbox (.env carried
 * SUPABASE_URL/anon/service key + REALTIME_CHANNEL_SECRET). CI (and any
 * REALTIME_MODE=disabled environment) has NONE of those, so the unit
 * derivation tests threw (channels.ts fails loud without the secret) and
 * the live-HTTP tests asserted a mode the server cannot be in. Now:
 *   · the capability-derivation + publisher tests run EVERYWHERE — the
 *     file provisions synthetic in-process env values (secret/URL/key)
 *     when the real ones are absent, and RESTORES the original env in
 *     afterAll (fetch is stubbed — zero network);
 *   · the live-HTTP /api/realtime/config tests skip unless the SERVER can
 *     be in supabase mode (same decision as src/lib/realtime/mode.ts);
 *   · the unauthenticated 401 boundary test runs in every mode.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { channelsForUser, schoolChannel, userChannel } from '@/lib/realtime/channels'
import { publishToSchool, publishToUser } from '@/lib/realtime/publish'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const TEST_TIMEOUT = 45_000

// ─── PHASE 8C · environment adaptation ────────────────────────────────────────

// Mirrors src/lib/realtime/mode.ts's decision for the SERVER process (the
// dev server shares .env with the test process: bun auto-loads .env).
const REALTIME_MODE_ENV = (process.env.REALTIME_MODE ?? '').trim().toLowerCase()
const serverSupabaseMode =
  REALTIME_MODE_ENV === 'supabase' ||
  (REALTIME_MODE_ENV !== 'disabled' &&
    REALTIME_MODE_ENV !== 'event-stream' &&
    Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY))

// Synthetic values used ONLY when the real ones are absent (CI / local PG
// runs). Never a secret — deterministic, in-process, fetch-stubbed.
const UNIT_SECRET = 'unit-test-realtime-channel-secret-8c'
const UNIT_SUPABASE_URL = 'https://unit-test.supabase.co'
const UNIT_SERVICE_KEY = 'unit-test-service-role-key'

const ENV_KEYS = ['REALTIME_CHANNEL_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REALTIME_MODE'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function ensureUnitEnv(): void {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  if (!process.env.REALTIME_CHANNEL_SECRET || process.env.REALTIME_CHANNEL_SECRET.length < 16) {
    process.env.REALTIME_CHANNEL_SECRET = UNIT_SECRET
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = UNIT_SUPABASE_URL
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = UNIT_SERVICE_KEY
  // The publisher unit tests exercise the SUPABASE publish path in-process
  // (fetch is stubbed — zero network). An explicit REALTIME_MODE=disabled
  // (CI) would make publishToUser/publishToSchool no-op, so the in-process
  // override is required. The SERVER process is unaffected (its own env).
  process.env.REALTIME_MODE = 'supabase'
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

// ─── fixtures ──────────────────────────────────────────────────────────────

let schoolA = { id: '' }
let studentA = { id: '', email: '' }
let teacherA = { id: '', email: '' }

let tokenStudent = ''
let tokenTeacher = ''

const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  // Unit + publisher layers need the synthetic env in EVERY environment;
  // the fixture sessions are only needed by the live-HTTP layer.
  ensureUnitEnv()
  if (!serverSupabaseMode) return

  const school = await db.school.findUnique({ where: { slug: 'sunrise-academy' }, select: { id: true } })
  if (!school) throw new Error('fixture school missing (run bun run seed:demo / seed:clean)')
  const [sa, ta] = await Promise.all([
    db.user.findUnique({
      where: { email: 'tenant.student.a@sunrise.test' },
      select: { id: true, email: true, role: true, schoolId: true },
    }),
    db.user.findUnique({
      where: { email: 'tenant.teacher.a@sunrise.test' },
      select: { id: true, email: true, role: true, schoolId: true },
    }),
  ])
  if (!sa || !ta || sa.schoolId !== school.id || ta.schoolId !== school.id) {
    throw new Error('fixture users missing (run bun run db:seed-tenant-isolation)')
  }
  schoolA = { id: school.id }
  studentA = { id: sa.id, email: sa.email }
  teacherA = { id: ta.id, email: ta.email }

  tokenStudent = randomBytes(32).toString('hex')
  tokenTeacher = randomBytes(32).toString('hex')
  await db.session.createMany({
    data: [
      { userId: sa.id, tokenHash: hashSessionToken(tokenStudent), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: ta.id, tokenHash: hashSessionToken(tokenTeacher), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: { tokenHash: { in: [hashSessionToken(tokenStudent), hashSessionToken(tokenTeacher)] } },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  await db.$disconnect()
  restoreEnv()
})

// ─── helpers ───────────────────────────────────────────────────────────────

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
}

// ─── 1. capability derivation (unit) ───────────────────────────────────────

describe('channelsForUser — capability channel derivation', () => {
  const SCHOOL_A = 'cuid_school_aaaaaaaaaa'
  const SCHOOL_B = 'cuid_school_bbbbbbbbbb'

  test('student → tenant-wide + own user channel, NEVER staff', () => {
    const ch = channelsForUser('STUDENT', SCHOOL_A, 'cuid_user_student1')
    expect(ch.length).toBe(2)
    expect(ch.some((c) => c.includes(':staff:'))).toBe(false)
    expect(ch[0]).toBe(schoolChannel(SCHOOL_A, 'all'))
    expect(ch[1]).toBe(userChannel(SCHOOL_A, 'cuid_user_student1'))
  })

  test('teacher and principal additionally receive the staff channel', () => {
    const teacher = channelsForUser('TEACHER', SCHOOL_A, 'cuid_user_teacher1')
    expect(teacher.length).toBe(3)
    expect(teacher.filter((c) => c.includes(':staff:')).length).toBe(1)

    const principal = channelsForUser('PRINCIPAL', SCHOOL_A, 'cuid_user_principal1')
    expect(principal.length).toBe(3)
    expect(principal.filter((c) => c.includes(':staff:')).length).toBe(1)
  })

  test('school channels are tenant-scoped and unguessable (16-hex HMAC differs per school)', () => {
    const a = schoolChannel(SCHOOL_A, 'staff')
    const b = schoolChannel(SCHOOL_B, 'staff')
    expect(a).toMatch(/^t:[^:]+:staff:[0-9a-f]{16}$/)
    expect(b).toMatch(/^t:[^:]+:staff:[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
    // the signature segment itself must differ — an attacker cannot carry
    // one tenant's signature onto another tenant's channel name
    expect(a.split(':')[3]).not.toBe(b.split(':')[3])
    // audience separation within one school
    expect(schoolChannel(SCHOOL_A, 'all')).toMatch(/^t:[^:]+:all:[0-9a-f]{16}$/)
    expect(schoolChannel(SCHOOL_A, 'all')).not.toBe(a)
  })

  test('user channels are unique per recipient and deterministic', () => {
    const u1 = userChannel(SCHOOL_A, 'cuid_user_aaaaaaaa1')
    const u2 = userChannel(SCHOOL_A, 'cuid_user_bbbbbbbb2')
    expect(u1).toMatch(/^u:[^:]+:[^:]+:[0-9a-f]{16}$/)
    expect(u1).not.toBe(u2)
    expect(userChannel(SCHOOL_A, 'cuid_user_aaaaaaaa1')).toBe(u1)
  })

  test('super admins / school-less identities receive NO channels', () => {
    expect(channelsForUser('SUPER_ADMIN', SCHOOL_A, 'cuid_user_admin1')).toEqual([])
    expect(channelsForUser('PRINCIPAL', '', 'cuid_user_admin1')).toEqual([])
  })
})

// ─── 2. /api/realtime/config (live HTTP) ───────────────────────────────────

// The 401 boundary is mode-INDEPENDENT: no session, no channels, no keys —
// proven in every environment.
describe('/api/realtime/config — unauthenticated boundary (any mode)', () => {
  test(
    'unauthenticated → 401 envelope, no channels, no keys',
    async () => {
      const r = await fetch(`${BASE}/api/realtime/config`)
      expect(r.status).toBe(401)
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
      expect(j?.ok).toBe(false)
      expect(j?.code).toBe('AUTH_REQUIRED')
      const raw = JSON.stringify(j ?? {})
      expect(raw).not.toContain('channels')
      expect(raw).not.toContain('anonKey')
      expect(raw).not.toContain(String(process.env.SUPABASE_ANON_KEY))
    },
    TEST_TIMEOUT,
  )
})

// The authenticated bootstrap tests pin the SERVER's supabase mode — they
// can only run where the server can actually be in that mode.
describe.skipIf(!serverSupabaseMode)('/api/realtime/config — authenticated transport bootstrap (supabase mode)', () => {
  test(
    'student session → supabase mode, exactly 2 channels, no staff channel, no-store',
    async () => {
      const r = await as(tokenStudent, '/api/realtime/config')
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      const j = (await r.json()) as {
        ok: boolean
        data: { mode: string; url?: string; anonKey?: string; channels?: string[] }
      }
      expect(j.ok).toBe(true)
      const data = j.data
      expect(data.mode).toBe('supabase')
      expect(Array.isArray(data.channels)).toBe(true)
      expect(data.channels!.length).toBe(2)
      expect(data.channels!.some((c) => c.includes(':staff:'))).toBe(false)
      // the issued channels are exactly the server-side derivation for
      // THIS identity (student, school A)
      expect(data.channels).toEqual(channelsForUser('STUDENT', schoolA.id, studentA.id))
      // public anon key only — the service-role key must never appear
      expect(typeof data.anonKey).toBe('string')
      expect(data.anonKey!.length).toBeGreaterThan(0)
      expect(data.anonKey).not.toContain(String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''))
      expect(String(data.anonKey)).not.toBe(String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''))
      expect(data.url).toMatch(/^https:\/\//)
    },
    TEST_TIMEOUT,
  )

  test(
    'teacher session → 3 channels including the staff channel',
    async () => {
      const r = await as(tokenTeacher, '/api/realtime/config')
      expect(r.status).toBe(200)
      const j = (await r.json()) as {
        ok: boolean
        data: { mode: string; channels?: string[] }
      }
      expect(j.ok).toBe(true)
      expect(j.data.mode).toBe('supabase')
      expect(j.data.channels!.length).toBe(3)
      expect(j.data.channels!.filter((c) => c.includes(':staff:')).length).toBe(1)
      expect(j.data.channels).toEqual(channelsForUser('TEACHER', schoolA.id, teacherA.id))
      expect(r.headers.get('cache-control')).toBe('no-store')
    },
    TEST_TIMEOUT,
  )
})

// ─── 3. publisher wiring (stubbed REST fetch) ──────────────────────────────

interface CapturedCall {
  url: string
  authorization: string
  body: { messages: Array<{ topic: string; event: string; payload: Record<string, unknown> }> }
}

describe('publishToUser / publishToSchool — REST broadcast envelope', () => {
  const origFetch = globalThis.fetch

  async function withStubbedFetch(
    run: () => Promise<void>,
    responder?: () => Response,
  ): Promise<CapturedCall[]> {
    const captured: CapturedCall[] = []
    globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      captured.push({
        url: String(url),
        authorization: String(init?.headers?.Authorization ?? init?.headers?.authorization ?? ''),
        body: JSON.parse(String(init?.body)) as CapturedCall['body'],
      })
      return (
        responder?.() ??
        new Response(JSON.stringify({ status: 'ok' }), { status: 202, headers: { 'content-type': 'application/json' } })
      )
    }) as typeof fetch
    try {
      await run()
    } finally {
      globalThis.fetch = origFetch
    }
    return captured
  }

  test(
    'publishToUser posts messages[0] on the recipient capability topic',
    async () => {
      const calls = await withStubbedFetch(() =>
        publishToUser('cuid_school_aaaaaaaaaa', 'cuid_user_recipient1', 'message', {
          id: 'msg_cuid_1',
          at: '2026-02-01T00:00:00.000Z',
          recipientId: 'cuid_user_recipient1',
          senderName: 'Ananya Iyer',
          preview: 'Submission window opens Monday',
        }),
      )
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`)
      expect(calls[0].authorization).toMatch(/^Bearer /)
      expect(calls[0].body.messages.length).toBe(1)
      const msg = calls[0].body.messages[0]
      expect(msg.topic).toBe(userChannel('cuid_school_aaaaaaaaaa', 'cuid_user_recipient1'))
      expect(msg.event).toBe('message')
      expect(msg.payload.kind).toBe('message')
      expect(msg.payload.id).toBe('msg_cuid_1')
      expect(msg.payload.at).toBe('2026-02-01T00:00:00.000Z')
      expect(msg.payload.senderName).toBe('Ananya Iyer')
      expect(msg.payload.preview).toBe('Submission window opens Monday')
    },
    TEST_TIMEOUT,
  )

  test(
    'publishToSchool posts on the staff capability topic with the fee-payment frame',
    async () => {
      const calls = await withStubbedFetch(() =>
        publishToSchool('cuid_school_aaaaaaaaaa', 'staff', 'fee-payment', {
          id: 'confirm:order_abc123',
          at: '2026-02-01T04:05:06.000Z',
          schoolId: 'cuid_school_aaaaaaaaaa',
          student: 'Aarav Sharma',
          feeTitle: 'Term 1 Tuition',
          amount: 4500,
          method: 'UPI',
        }),
      )
      expect(calls.length).toBe(1)
      const msg = calls[0].body.messages[0]
      expect(msg.topic).toBe(schoolChannel('cuid_school_aaaaaaaaaa', 'staff'))
      expect(msg.event).toBe('fee-payment')
      expect(msg.payload.kind).toBe('fee-payment')
      expect(msg.payload.id).toBe('confirm:order_abc123')
      expect(msg.payload.amount).toBe(4500)
      expect(msg.payload.method).toBe('UPI')
      expect(msg.payload.schoolId).toBe('cuid_school_aaaaaaaaaa')
    },
    TEST_TIMEOUT,
  )

  test(
    'publisher is fire-safe when the REST call fails (never throws)',
    async () => {
      const captured: CapturedCall[] = []
      globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
        captured.push({
          url: String(url),
          authorization: String(init?.headers?.Authorization ?? ''),
          body: JSON.parse(String(init?.body)) as CapturedCall['body'],
        })
        return new Response('upstream boom', { status: 500 })
      }) as typeof fetch
      try {
        // Neither call may reject — realtime is optional and the DB write
        // already committed on the caller's side.
        await publishToUser('cuid_school_aaaaaaaaaa', 'cuid_user_recipient1', 'message', {
          id: 'msg_cuid_2',
          at: '2026-02-01T00:00:00.000Z',
        })
        await publishToSchool('cuid_school_aaaaaaaaaa', 'all', 'announcement', {
          id: 'notif_cuid_2',
          at: '2026-02-01T00:00:00.000Z',
        })
      } finally {
        globalThis.fetch = origFetch
      }
      expect(captured.length).toBe(2)
      expect(captured[0].body.messages[0].event).toBe('message')
      expect(captured[1].body.messages[0].event).toBe('announcement')
    },
    TEST_TIMEOUT,
  )
})
