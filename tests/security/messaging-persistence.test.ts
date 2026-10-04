import { db } from '../helpers/db'
import { Prisma } from '@prisma/client'
/**
 * Task 8B-7-d — Persistent student/principal messaging (LIVE HTTP).
 *
 * Proves the direct-messaging surface is DB-CANONICAL and interoperable
 * with the EXISTING teacher Communication Hub (both read the same
 * Message table):
 *
 *   1. student → teacher (new /api/messaging route) persists; the
 *      student's thread list shows it; the TEACHER sees the very row in
 *      her hub's direct thread listing AND thread endpoint (round-trip).
 *   2. teacher replies through her EXISTING route → lands in the
 *      student's thread; unread badge counts >0 before the student
 *      opens the thread and 0 after (server-side read marking).
 *   3. cross-tenant recipient ids fail-safe 404 (no existence oracle).
 *   4. STUDENT → STUDENT is rejected 403 (recipient policy).
 *   5. self-send, empty body and >4000-char body are rejected 400.
 *   6. principal → teacher via the new API lists in the principal's
 *      /api/messaging/threads.
 *
 * Live-HTTP conventions match tests/security/phase75-product.test.ts:
 * runs against the dev server (TENANT_TEST_BASE, default :3000) with
 * real sessions minted as DIRECT ROWS (auth fixture that bypasses only
 * the login limiter — never an authorization gate).
 *
 * Cleanup discipline: every Message row this suite creates is deleted
 * by id in afterAll (the ids the APIs returned — never a broad sweep
 * that could touch the teacher-hub seed corpus), plus the exact
 * DirectThreadState rows the read-marking side effects wrote.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'
const TEST_TIMEOUT = 45_000

// ─── fixtures ──────────────────────────────────────────────────────────────

const MARKER = `MP-${randomBytes(4).toString('hex')}`

let studentA = { id: '', email: '' }
let teacherA = { id: '', email: '' }
let principalA = { id: '', email: '' }
let probeStudent = { id: '', email: '' }
let principalB = { id: '', email: '' } // green-valley (the OTHER tenant)

let tokenStudent = ''
let tokenTeacher = ''
let tokenPrincipal = ''

/** Message ids this suite created (exact-id cleanup in afterAll). */
const createdMessageIds: string[] = []
const cleanup: Array<() => Promise<unknown>> = []

beforeAll(async () => {
  const a = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!a) throw new Error('fixture school missing (run bun run seed:demo / seed:clean)')

  const [sa, ta, pa, probe, pb] = await Promise.all([
    db.user.findUnique({ where: { email: 'tenant.student.a@hawkings.test' } }),
    db.user.findUnique({ where: { email: 'tenant.teacher.a@hawkings.test' } }),
    db.user.findUnique({ where: { email: 'tenant.principal.a@hawkings.test' } }),
    db.user.findUnique({ where: { email: 'tenant.student.probe@hawkings.test' } }),
    db.user.findUnique({ where: { email: 'principal.b@greenvalley.test' } }),
  ])
  if (!sa || !ta || !pa || !probe || !pb) {
    throw new Error('fixture users missing (run bun run db:seed-tenant-isolation)')
  }

  studentA = { id: sa.id, email: sa.email }
  teacherA = { id: ta.id, email: ta.email }
  principalA = { id: pa.id, email: pa.email }
  probeStudent = { id: probe.id, email: probe.email }
  principalB = { id: pb.id, email: pb.email }

  tokenStudent = randomBytes(32).toString('hex')
  tokenTeacher = randomBytes(32).toString('hex')
  tokenPrincipal = randomBytes(32).toString('hex')

  // Re-run hygiene (same class as tests/helpers/login-buckets): the message
  // budget is DATABASE-backed (rl:msg:<userId>, 10/window) with production
  // semantics, so a rapid re-run of this suite can start inside a leftover
  // blocked window and every send-fetch 429-shadows. Deleting the fixture
  // users' rows heals the app within one request — dev/test DB only.
  try {
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${Prisma.join([
      `rl:msg:${sa.id}`,
      `rl:msg:${ta.id}`,
      `rl:msg:${pa.id}`,
      `rl:msg:${probe.id}`,
      `rl:msg:${pb.id}`,
    ])})`
  } catch {
    /* non-fatal — the suite will surface a 429 if the limiter disagrees */
  }

  await db.session.createMany({
    data: [
      { userId: sa.id, tokenHash: hashSessionToken(tokenStudent), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: ta.id, tokenHash: hashSessionToken(tokenTeacher), expiresAt: new Date(Date.now() + 3600_000) },
      { userId: pa.id, tokenHash: hashSessionToken(tokenPrincipal), expiresAt: new Date(Date.now() + 3600_000) },
    ],
  })
  cleanup.push(() =>
    db.session.deleteMany({
      where: {
        tokenHash: {
          in: [hashSessionToken(tokenStudent), hashSessionToken(tokenTeacher), hashSessionToken(tokenPrincipal)],
        },
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => {})
  // Exact rows this suite wrote — never a sweep over the corpus.
  if (createdMessageIds.length) {
    await db.message.deleteMany({ where: { id: { in: createdMessageIds } } }).catch(() => {})
  }
  // Read-marking side effects: the student's viewer-owed thread state.
  await db.directThreadState
    .deleteMany({ where: { userId: studentA.id, counterpartId: teacherA.id } })
    .catch(() => {})
  await db.directThreadState
    .deleteMany({ where: { userId: principalA.id, counterpartId: teacherA.id } })
    .catch(() => {})
  await db.$disconnect()
})

// ─── helpers ───────────────────────────────────────────────────────────────

function as(token: string, apiPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${apiPath}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

async function json(res: Response): Promise<any> {
  return res.json().catch(() => null)
}

/** POST a direct message through the NEW /api/messaging surface. */
function sendDirect(
  token: string,
  counterpartId: string,
  body: unknown,
): Promise<Response> {
  return as(token, `/api/messaging/threads/${counterpartId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 1 — student → teacher: persists, lists for the student, round-trips in
//     the EXISTING teacher Communication Hub
// ─────────────────────────────────────────────────────────────────────────
describe('messaging persistence · student ↔ teacher (shared Message table)', () => {
  const SENT = `Student question about homework ${MARKER}`

  test(
    'student send → 200 and the row lists in the student thread list',
    async () => {
      const res = await sendDirect(tokenStudent, teacherA.id, { body: SENT })
      expect(res.status).toBe(200)
      const body = await json(res)
      const message = body?.data?.message
      expect(message?.id).toBeTruthy()
      expect(message?.body).toBe(SENT)
      createdMessageIds.push(message.id)

      const list = await as(tokenStudent, '/api/messaging/threads')
      expect(list.status).toBe(200)
      const threads = (await json(list))?.data?.threads ?? []
      const thread = threads.find((t: any) => t.counterpartId === teacherA.id)
      expect(thread).toBeTruthy()
      expect(thread.lastMessage?.fromMe).toBe(true)
      expect(String(thread.lastMessage?.body)).toContain(MARKER)
      // Sender's own message is never unread for the sender.
      expect(thread.unreadCount).toBe(0)
    },
    TEST_TIMEOUT,
  )

  test(
    'the EXISTING teacher hub sees the same thread and the body round-trips',
    async () => {
      // Hub listing — one direct-conversation summary per counterpart.
      const hub = await as(tokenTeacher, '/api/teacher/communication')
      expect(hub.status).toBe(200)
      const data = (await json(hub))?.data
      const direct = (data?.directConversations ?? []).find((c: any) => c.counterpartId === studentA.id)
      expect(direct).toBeTruthy()
      expect(String(direct?.lastMessage?.body)).toContain(MARKER)

      // Full thread through the teacher's own direct endpoint.
      const thread = await as(tokenTeacher, `/api/teacher/communication/direct/${studentA.id}`)
      expect(thread.status).toBe(200)
      const messages = (await json(thread))?.data?.messages ?? []
      const hit = messages.find((m: any) => String(m.body).includes(MARKER))
      expect(hit).toBeTruthy()
      expect(hit.fromMe).toBe(false) // the teacher did not send it
    },
    TEST_TIMEOUT,
  )

  test(
    'teacher reply (existing route) → student thread shows it; unread before, 0 after open',
    async () => {
      const REPLY = `Teacher reply ${MARKER}`
      const res = await as(tokenTeacher, `/api/teacher/communication/direct/${studentA.id}`, {
        method: 'POST',
        body: JSON.stringify({ subject: `IT-${MARKER}`, body: REPLY }),
      })
      expect(res.status).toBe(200)
      const reply = (await json(res))?.data?.message
      expect(reply?.id).toBeTruthy()
      createdMessageIds.push(reply.id)

      // Unread BEFORE the student opens the thread (server-side badge).
      const before = await as(tokenStudent, '/api/messaging/threads')
      const threadsBefore = (await json(before))?.data?.threads ?? []
      const threadBefore = threadsBefore.find((t: any) => t.counterpartId === teacherA.id)
      expect(Number(threadBefore?.unreadCount)).toBeGreaterThan(0)

      // Opening the thread returns the full history including the reply.
      const opened = await as(tokenStudent, `/api/messaging/threads/${teacherA.id}`)
      expect(opened.status).toBe(200)
      const detail = (await json(opened))?.data
      const replyRow = (detail?.messages ?? []).find((m: any) => String(m.body).includes(REPLY))
      expect(replyRow).toBeTruthy()
      expect(replyRow.senderId).toBe(teacherA.id)

      // AFTER the open (GET marks read server-side) the badge is 0.
      const after = await as(tokenStudent, '/api/messaging/threads')
      const threadsAfter = (await json(after))?.data?.threads ?? []
      const threadAfter = threadsAfter.find((t: any) => t.counterpartId === teacherA.id)
      expect(Number(threadAfter?.unreadCount)).toBe(0)
    },
    TEST_TIMEOUT,
  )
})

// ─────────────────────────────────────────────────────────────────────────
// 2 — authorization boundaries (fail-safe, no existence oracle)
// ─────────────────────────────────────────────────────────────────────────
describe('messaging persistence · authorization boundaries', () => {
  test(
    'cross-tenant recipient id → fail-safe 404 (no existence oracle)',
    async () => {
      const res = await sendDirect(tokenStudent, principalB.id, { body: `cross ${MARKER}` })
      expect(res.status).toBe(404)
      const body = await json(res)
      expect(body?.ok).toBe(false)
    },
    TEST_TIMEOUT,
  )

  test(
    'STUDENT → STUDENT is rejected 403 (recipient policy)',
    async () => {
      const res = await sendDirect(tokenStudent, probeStudent.id, { body: `s2s ${MARKER}` })
      expect(res.status).toBe(403)
    },
    TEST_TIMEOUT,
  )

  test(
    'self-send is rejected 400',
    async () => {
      const res = await sendDirect(tokenStudent, studentA.id, { body: `self ${MARKER}` })
      expect(res.status).toBe(400)
    },
    TEST_TIMEOUT,
  )

  test(
    'empty body is rejected 400',
    async () => {
      const res = await sendDirect(tokenStudent, teacherA.id, { body: '' })
      expect(res.status).toBe(400)
    },
    TEST_TIMEOUT,
  )

  test(
    'oversized body (>4000 chars) is rejected 400',
    async () => {
      const res = await sendDirect(tokenStudent, teacherA.id, { body: 'x'.repeat(4001) })
      expect(res.status).toBe(400)
    },
    TEST_TIMEOUT,
  )

  test(
    'unknown recipient id → 404 (never 500)',
    async () => {
      const res = await sendDirect(tokenStudent, 'clerk-nonexistent-0000', { body: `miss ${MARKER}` })
      expect(res.status).toBe(404)
    },
    TEST_TIMEOUT,
  )

  test(
    'unauthenticated calls are rejected 401',
    async () => {
      const res = await fetch(`${BASE}/api/messaging/threads`)
      expect(res.status).toBe(401)
    },
    TEST_TIMEOUT,
  )
})

// ─────────────────────────────────────────────────────────────────────────
// 3 — principal plane: threads with teachers list after messaging one
// ─────────────────────────────────────────────────────────────────────────
describe('messaging persistence · principal plane', () => {
  test(
    'principal → teacher via the new API lists in /api/messaging/threads',
    async () => {
      // Honest starting point: the list call works (may be empty or hold
      // real rows — never fabricated ones).
      const before = await as(tokenPrincipal, '/api/messaging/threads')
      expect(before.status).toBe(200)
      expect(Array.isArray((await json(before))?.data?.threads)).toBe(true)

      const SENT = `Principal note to faculty ${MARKER}`
      const res = await sendDirect(tokenPrincipal, teacherA.id, { body: SENT })
      expect(res.status).toBe(200)
      const message = (await json(res))?.data?.message
      expect(message?.id).toBeTruthy()
      createdMessageIds.push(message.id)

      const after = await as(tokenPrincipal, '/api/messaging/threads')
      expect(after.status).toBe(200)
      const threads = (await json(after))?.data?.threads ?? []
      const thread = threads.find((t: any) => t.counterpartId === teacherA.id)
      expect(thread).toBeTruthy()
      expect(thread.counterpart?.role).toBe('TEACHER')
      expect(thread.lastMessage?.fromMe).toBe(true)
      expect(String(thread.lastMessage?.body)).toContain(MARKER)
    },
    TEST_TIMEOUT,
  )

  test(
    'the teacher hub sees the principal message too (same Message table)',
    async () => {
      const hub = await as(tokenTeacher, '/api/teacher/communication')
      expect(hub.status).toBe(200)
      const direct = ((await json(hub))?.data?.directConversations ?? []).find(
        (c: any) => c.counterpartId === principalA.id,
      )
      expect(direct).toBeTruthy()
      expect(String(direct?.lastMessage?.body)).toContain(MARKER)
    },
    TEST_TIMEOUT,
  )
})
