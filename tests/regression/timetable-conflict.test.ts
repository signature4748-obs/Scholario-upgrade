/**
 * PHASE 8 §2(A) — REGRESSION: POST /api/timetable/publish conflict hardening.
 *
 * Contract under test (src/app/api/timetable/publish/route.ts +
 * src/lib/security/errors.ts):
 *   · a timetable conflict is refused with HTTP 409 AND a STABLE
 *     machine-readable domain error code — ROOM_CONFLICT /
 *     TEACHER_CONFLICT / CLASS_CONFLICT — instead of the generic
 *     'CONFLICT' (Phase 8 spec §2(A)); the envelope carries the precise
 *     human message (room/teacher/class, day, period);
 *   · the refusal leaves the database byte-identical (the replace-all
 *     transaction never commits — zero residue, zero orphan Subject /
 *     ClassSubjectAssignment rows), mirroring production canary 14;
 *   · a valid publish still succeeds after a conflict;
 *   · the same conflict under parallel requests stays safe (no
 *     double-200, no 500, no duplicate room cells);
 *   · rows outside the conflicting key are untouched.
 *
 * Live-server convention (tests/e2e + tests/regression): the dev server at
 * http://localhost:3000 is ALREADY RUNNING — never started by this suite.
 * ONE principal login (seeded local corpus, hawkings tenant) is reused for
 * every request via the erp_session cookie, exactly like a browser; a
 * private X-Forwarded-For keeps the shared loopback login-IP bucket clear
 * (8/15min), with the journeys-style direct-session fixture as the 429
 * fallback (an auth fixture, never an authorization bypass).
 *
 * PAYLOAD NOTE (verified against the corpus before writing this suite):
 * the naive client round-trip (serverRowsToSlots → publish) is NOT
 * publishable for the seeded corpus — the legacy grid uses 8 DB teaching
 * periods while the canonical ladder has 7, and the ladder NUMBERS its
 * 6th/7th teaching periods 8/9, so DB periods 6 AND 8 both map to ladder
 * slot period 8 (a raw publish would double-book every room/teacher/class
 * at teaching period 6 → 409 — the pre-Phase-8 P2002 path refused it too).
 * The clean payload therefore keeps each row's OWN times (the publish
 * route derives startTime/endTime from the time string) and relabels the
 * seed-only period-8 rows to slot period 10 — the one free non-ladder
 * number that round-trips to a distinct DB teaching period. Everything
 * else about the mapping is the client's.
 *
 * IDEMPOTENT + SELF-CLEANING: the final test re-publishes the ORIGINAL
 * baseline payload and then restores the seeded corpus byte-identically —
 * the legacy period-8 rows are publish-unreachable by ladder construction,
 * so the exact corpus restore (ids + times + NULL roomIds included) uses
 * the direct-DB sweep convention of tests/security/assignment-scope and
 * database-integrity (deleteMany + createMany of the rows captured at
 * start, in one transaction). Final digest == initial digest.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash, randomBytes } from 'crypto'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { PERIODS } from '@/lib/timetable/config'
import type { PublishableSlot, ServerSlot } from '@/lib/timetable/server-mapping'
import { DEMO_PRINCIPAL_EMAIL, DEMO_PRINCIPAL_PASSWORD } from '../helpers/credentials'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const MARKER = randomBytes(4).toString('hex')
// Private egress IP for the ONE login (7-N3 / e2e precedent: keeps the
// shared loopback login-IP bucket (8/15min) clear for parallel suites).
const RUN_IP = `10.8.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 20}`

/** A NEW subject name only the conflicting payloads reference. */
const NEW_SUBJECT = `QA 8A Conflict Subject ${MARKER}`

/** Ladder numbers of the TEACHING periods, in teaching order (from config). */
const TEACHING_LADDER_NUMBERS = PERIODS.filter((p) => !p.isBreak).map((p) => p.number)

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
  code?: string
  requestId?: string
}

/** Full scalar row shape captured for the byte-identical corpus restore. */
interface TimetableRowSnapshot {
  id: string
  schoolId: string
  classId: string
  subjectId: string | null
  day: string
  period: number
  startTime: string | null
  endTime: string | null
  teacherUserId: string | null
  teacherName: string | null
  roomId: string | null
  room: string | null
  createdAt: Date
}

// ── shared suite state (tests run sequentially in declaration order) ────
let cookie = ''
let fixtureSessionToken = '' // set only when the 429 fallback created the session directly
let schoolId = ''

/** The seeded corpus exactly as found at suite start (restored at the end). */
let originalRows: TimetableRowSnapshot[] = []
let initialDigest = ''

/** Byte-stable baseline captured after the scenario-1 clean publish. */
let baselineRows: ServerSlot[] = []
let baselinePayload: PublishableSlot[] = []
let baselineDigest = ''

/** The scenario-2..6 conflicting payload + the conflicting (day|period|room) cell. */
let conflictingPayload: PublishableSlot[] = []
let conflictKey = ''

// ── helpers ─────────────────────────────────────────────────────────────

async function publish(payload: PublishableSlot[]): Promise<Response> {
  return fetch(`${BASE}/api/timetable/publish`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slots: payload }),
  })
}

async function getTimetable(): Promise<ServerSlot[]> {
  const res = await fetch(`${BASE}/api/timetable`, { headers: { cookie } })
  expect(res.status).toBe(200)
  const body = (await res.json()) as Envelope<ServerSlot[]>
  expect(body.ok).toBe(true)
  return Array.isArray(body.data) ? body.data : []
}

/**
 * The publishable form of the current timetable (see the payload note in
 * the header): DB teaching periods 1-7 keep their ladder slot numbers and
 * each row keeps its OWN "HH:MM - HH:MM" times (parseRangeMinutes reads
 * the plain 24h form, so stored times round-trip exactly); the seed-only
 * legacy period-8 rows are relabeled to slot period 10.
 */
function buildCleanPayload(rows: ServerSlot[]): PublishableSlot[] {
  return rows.map((r) => ({
    day: r.day,
    period:
      r.period >= 1 && r.period <= TEACHING_LADDER_NUMBERS.length
        ? TEACHING_LADDER_NUMBERS[r.period - 1]
        : r.period === 8
          ? 10 // 8 is a LADDER number (teaching period 6) — relabel the seed-only 8th period
          : r.period,
    time: `${r.startTime ?? ''} - ${r.endTime ?? ''}`,
    className: r.className,
    subject: r.subject,
    teacherName: r.teacherName,
    room: r.room ?? '',
  }))
}

/** The payload-mapped room cell: (day, period, room-display). */
function roomCellKey(r: ServerSlot): string {
  return `${r.day}|${r.period}|${(r.room ?? '').trim().toLowerCase()}`
}

/** Stable content hash of the timetable (ids excluded — they change on every
 *  replace-all; content fields only, deterministically sorted). */
function digestOf(rows: ServerSlot[], excludeCell?: string): string {
  const tuples = rows
    .filter((r) => !excludeCell || roomCellKey(r) !== excludeCell)
    .map((r) => [
      r.day,
      r.period,
      r.startTime ?? '',
      r.endTime ?? '',
      r.subject,
      r.teacherName ?? '',
      r.room ?? '',
      r.className,
    ])
  tuples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(tuples)).digest('hex')
}

/** Duplicate room cells in the payload-mapped sense (empty rooms never
 *  collide — NULL roomId rows are distinct in Postgres). */
function duplicateRoomCells(rows: ServerSlot[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const r of rows) {
    if (!(r.room ?? '').trim()) continue
    const key = roomCellKey(r)
    if (seen.has(key)) dups.add(key)
    seen.add(key)
  }
  return [...dups]
}

/** A value of one payload dimension that is NOT busy at (day, period) —
 *  used to isolate WHICH unique a conflicting clone triggers. */
function freeAt(dim: 'className' | 'teacherName' | 'room', day: string, period: number): string {
  const busy = new Set(
    baselinePayload
      .filter((s) => s.day === day && s.period === period)
      .map((s) => s[dim].trim().toLowerCase()),
  )
  return (
    [...new Set(baselinePayload.map((s) => s[dim]))]
      .filter((v) => v.trim() !== '' && !busy.has(v.trim().toLowerCase()))
      .sort()[0] ?? ''
  )
}

// ── setup: ONE login + corpus snapshot for the final restore ────────────

beforeAll(async () => {
  const principal = await db.user.findUnique({
    where: { email: DEMO_PRINCIPAL_EMAIL },
    select: { id: true, schoolId: true },
  })
  expect(principal?.schoolId).toBeTruthy()
  schoolId = principal!.schoolId!

  // Corpus snapshot (full scalar rows, ids + createdAt included) — the
  // byte-identical restore source for the final cleanup test.
  originalRows = await db.timetable.findMany({ where: { schoolId } })
  expect(originalRows.length).toBeGreaterThan(0)

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email: DEMO_PRINCIPAL_EMAIL, password: DEMO_PRINCIPAL_PASSWORD }),
  })
  if (res.status === 429) {
    // Journeys convention: rate-limit fallback = direct session fixture —
    // swept in afterAll. Real login otherwise (cookie transport, like the browser).
    const token = randomBytes(32).toString('hex')
    await db.session.create({
      data: {
        userId: principal!.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    fixtureSessionToken = token
    cookie = `erp_session=${token}`
  } else {
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<{ sessionToken?: string }>
    expect(body.ok).toBe(true)
    const setCookie = res.headers.get('set-cookie') ?? ''
    const fromHeader = setCookie.includes('erp_session=')
      ? setCookie.split('erp_session=')[1].split(';')[0]
      : null
    cookie = `erp_session=${fromHeader ?? body.data?.sessionToken ?? ''}`
    expect(cookie.length).toBeGreaterThan('erp_session='.length)
  }

  // With the session live, pin the initial content digest (cookie auth).
  initialDigest = digestOf(await getTimetable())
}, T)

// ── the six mandated scenarios (plus the two extra domain-code pins) ─────

describe('regression · Phase 8 §2(A) timetable publish conflict hardening', () => {
  test(
    'scenario 1 — clean publish of the CURRENT timetable content succeeds (200, rowsWritten == row count, round-trip stable)',
    async () => {
      const rows0 = await getTimetable()
      expect(rows0.length).toBe(originalRows.length)
      expect(rows0.every((r) => r.startTime && r.endTime)).toBe(true)
      const payload0 = buildCleanPayload(rows0)

      const res = await publish(payload0)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number; rowsReplaced: number }>
      expect(body.ok).toBe(true)
      expect(body.data?.rowsWritten).toBe(rows0.length)
      expect(body.data?.rowsReplaced).toBe(rows0.length)

      // The publish maps the legacy period-8 rows onto slot period 10 (see
      // the header note) — everything else round-trips with its own times.
      // Capture the byte-stable baseline from this state.
      baselineRows = await getTimetable()
      expect(baselineRows.length).toBe(rows0.length)
      baselinePayload = buildCleanPayload(baselineRows)
      baselineDigest = digestOf(baselineRows)

      // Round-trip stability: re-publishing the same payload is
      // byte-identical (what the final cleanup restore relies on).
      const again = await publish(baselinePayload)
      expect(again.status).toBe(200)
      expect(digestOf(await getTimetable())).toBe(baselineDigest)
    },
    T,
  )

  test(
    'scenario 2 — duplicate room/day/period in payload → 409 with code ROOM_CONFLICT (canary-14 method: same room+slot, different class+teacher)',
    async () => {
      // Source: a Monday period-1 slot with a room (prefers the prod-canary
      // Room 90A cell when the corpus has one).
      const monday1 = baselinePayload.filter(
        (s) => s.day === 'Monday' && s.period === 1 && s.room.trim() !== '',
      )
      expect(monday1.length).toBeGreaterThan(0)
      const src = monday1.find((s) => s.room.trim().toLowerCase() === 'room 90a') ?? monday1[0]

      // The clone: different class AND teacher (both free at that day/period),
      // SAME room/day/period → ONLY the room unique can fire. Its subject is a
      // NEW subject name (scenario 3's orphan probe).
      const clone: PublishableSlot = {
        day: src.day,
        period: src.period,
        time: src.time,
        room: src.room,
        className: freeAt('className', src.day, src.period),
        subject: NEW_SUBJECT,
        teacherName: freeAt('teacherName', src.day, src.period),
      }
      expect(clone.className).not.toBe('')
      expect(clone.teacherName).not.toBe('')
      conflictingPayload = [...baselinePayload, clone]
      conflictKey = `${src.day}|${src.period}|${src.room.trim().toLowerCase()}`

      const res = await publish(conflictingPayload)
      expect(res.status).toBe(409)
      const body = (await res.json()) as Envelope<never>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('ROOM_CONFLICT') // the STABLE machine-readable domain code
      expect(body.requestId).toBeTruthy() // envelope correlation contract
      expect(body.error).toContain(src.room) // precise human message …
      expect(body.error).toContain(src.day)
      expect(body.error).toContain('Resolve the overlap')
    },
    T,
  )

  test('scenario 2b — duplicate teacher/day/period in payload → 409 with code TEACHER_CONFLICT', async () => {
    const src = baselinePayload.find((s) => s.teacherName.trim() !== '')!
    // Same teacher/day/period; free class + free room isolate the teacher key.
    const clone: PublishableSlot = {
      day: src.day,
      period: src.period,
      time: src.time,
      teacherName: src.teacherName,
      className: freeAt('className', src.day, src.period),
      room: freeAt('room', src.day, src.period),
      subject: NEW_SUBJECT,
    }
    expect(clone.className).not.toBe('')

    const res = await publish([...baselinePayload, clone])
    expect(res.status).toBe(409)
    const body = (await res.json()) as Envelope<never>
    expect(body.code).toBe('TEACHER_CONFLICT')
    expect(body.error).toContain(src.teacherName)
  }, T)

  test('scenario 2c — duplicate class/day/period in payload → 409 with code CLASS_CONFLICT', async () => {
    const src = baselinePayload[0]
    // Same class/day/period; free teacher + free room isolate the class key.
    const clone: PublishableSlot = {
      day: src.day,
      period: src.period,
      time: src.time,
      className: src.className,
      teacherName: freeAt('teacherName', src.day, src.period),
      room: freeAt('room', src.day, src.period),
      subject: NEW_SUBJECT,
    }
    expect(clone.teacherName).not.toBe('')

    const res = await publish([...baselinePayload, clone])
    expect(res.status).toBe(409)
    const body = (await res.json()) as Envelope<never>
    expect(body.code).toBe('CLASS_CONFLICT')
    expect(body.error).toContain(src.className)
  }, T)

  test(
    'scenario 3 — database unchanged after the conflict (row count + content digest + zero orphan Subject/CSA from the failed tx)',
    async () => {
      const preRows = await getTimetable()
      const preSubjects = await db.subject.count({ where: { schoolId } })
      const preCsa = await db.classSubjectAssignment.count({ where: { schoolId } })

      const res = await publish(conflictingPayload)
      expect(res.status).toBe(409)

      const postRows = await getTimetable()
      expect(postRows.length).toBe(preRows.length) // nothing deleted, nothing written
      expect(digestOf(postRows)).toBe(digestOf(preRows)) // byte-identical content
      expect(digestOf(postRows)).toBe(baselineDigest)

      // The transaction never committed its in-tx writes: the conflicting
      // payload references a NEW subject (and its CSA pair) — neither may
      // survive a rejected publish.
      expect(await db.subject.count({ where: { schoolId } })).toBe(preSubjects)
      expect(await db.classSubjectAssignment.count({ where: { schoolId } })).toBe(preCsa)
      expect(await db.subject.findFirst({ where: { schoolId, name: NEW_SUBJECT } })).toBeNull()
    },
    T,
  )

  test('scenario 4 — a valid publish AFTER the conflict still succeeds (200, digest restored)', async () => {
    const res = await publish(baselinePayload)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Envelope<{ rowsWritten: number }>
    expect(body.data?.rowsWritten).toBe(baselineRows.length)
    const rows = await getTimetable()
    expect(rows.length).toBe(baselineRows.length)
    expect(digestOf(rows)).toBe(baselineDigest)
  }, T)

  test(
    'scenario 5 — the same conflict under 2 PARALLEL requests stays safe (no double-200, no 500, no duplicate cells, no orphans)',
    async () => {
      const preRows = await getTimetable()
      const preSubjects = await db.subject.count({ where: { schoolId } })
      const preCsa = await db.classSubjectAssignment.count({ where: { schoolId } })

      // Exactly 2 parallel POSTs (one session cookie — one login, no hammering),
      // both containing the same duplicate-room pair.
      const [a, b] = await Promise.all([publish(conflictingPayload), publish(conflictingPayload)])
      const statuses = [a.status, b.status].sort()
      for (const s of statuses) expect([200, 409]).toContain(s) // never 500 (or anything else)
      expect(statuses).toContain(409) // the conflict IS refused …
      expect(statuses).not.toEqual([200, 200]) // … and never both succeed
      for (const res of [a, b]) {
        if (res.status === 409) {
          const body = (await res.json()) as Envelope<never>
          expect(body.code).toBe('ROOM_CONFLICT')
        }
      }

      const postRows = await getTimetable()
      expect(postRows.length).toBe(preRows.length) // row-set integrity (both refused)
      expect(digestOf(postRows)).toBe(digestOf(preRows))
      expect(duplicateRoomCells(postRows)).toEqual([]) // no duplicate (room, day, period) anywhere
      expect(await db.subject.count({ where: { schoolId } })).toBe(preSubjects)
      expect(await db.classSubjectAssignment.count({ where: { schoolId } })).toBe(preCsa)
      expect(await db.subject.findFirst({ where: { schoolId, name: NEW_SUBJECT } })).toBeNull()
    },
    T,
  )

  test(
    'scenario 6 — rows OUTSIDE the conflicting key are byte-identical after a fresh 409 (targeted exclusion digest)',
    async () => {
      const res = await publish(conflictingPayload)
      expect(res.status).toBe(409)
      const postRows = await getTimetable()

      // Full identity (scenario 3's strong form) …
      expect(digestOf(postRows)).toBe(baselineDigest)
      // … plus the targeted form: every row EXCEPT the conflicting
      // (room, day, period) cell is byte-identical to the baseline.
      expect(digestOf(postRows, conflictKey)).toBe(digestOf(baselineRows, conflictKey))
      // The conflicting cell itself holds exactly the baseline's single
      // booking for that room — no duplicate was ever written.
      expect(postRows.filter((r) => roomCellKey(r) === conflictKey).length).toBe(
        baselineRows.filter((r) => roomCellKey(r) === conflictKey).length,
      )
    },
    T,
  )

  test(
    'cleanup — re-publish the ORIGINAL baseline payload, then restore the seeded corpus byte-identically (final digest == initial digest)',
    async () => {
      // The spec-mandated final action: re-publish the baseline payload
      // captured at start (the publishable form of the current timetable).
      const res = await publish(baselinePayload)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Envelope<{ rowsWritten: number }>
      expect(body.data?.rowsWritten).toBe(baselineRows.length)
      expect(digestOf(await getTimetable())).toBe(baselineDigest)

      // Then return the corpus to its exact seeded state (ids, legacy 08:00
      // grid, NULL roomIds, and the publish-unreachable period-8 rows) via
      // the direct-DB sweep convention (assignment-scope / database-
      // integrity): delete + re-create the captured rows in ONE transaction.
      await db.$transaction([
        db.timetable.deleteMany({ where: { schoolId } }),
        db.timetable.createMany({ data: originalRows }),
      ])
      const finalRows = await getTimetable()
      expect(finalRows.length).toBe(originalRows.length)
      expect(digestOf(finalRows)).toBe(initialDigest) // byte-identical restore
      // No QA subject ever materialized from any rejected publish.
      expect(await db.subject.findFirst({ where: { schoolId, name: NEW_SUBJECT } })).toBeNull()
    },
    T,
  )
})

// ── teardown: destroy the ONE login session ─────────────────────────────

afterAll(async () => {
  if (cookie) {
    await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    }).catch(() => {})
  }
  if (fixtureSessionToken) {
    await db.session
      .deleteMany({ where: { tokenHash: hashSessionToken(fixtureSessionToken) } })
      .catch(() => {})
  }
})
