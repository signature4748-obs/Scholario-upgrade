import { db } from '../helpers/db'
/**
 * PHASE 8A — SEARCH CASE-INSENSITIVITY PIN (SQLite → PostgreSQL parity).
 *
 * THE INVARIANT UNDER TEST:
 *   SQLite LIKE was ASCII-case-insensitive; PostgreSQL LIKE is
 *   case-SENSITIVE. The 8A-C2 wave converted every user-facing `contains:`
 *   filter to `mode: 'insensitive'` (Prisma → ILIKE, pg_trgm-backed) so
 *   the ⌘K global search behaves EXACTLY as it did on SQLite:
 *     · a LOWERCASE query prefix finds a mixed-case student name;
 *     · an UPPERCASE query prefix finds the same student;
 *     · a mixed-case query prefix finds the same student;
 *     · a foreign-tenant principal searching the SAME query sees ZERO
 *       results (search stays tenant-isolated — case-insensitivity must
 *       never widen the school scope).
 *
 * Live suite: dev server (default :3000), REAL logins (Sunrise principal +
 * Green Valley principal) with resetLoginBuckets + a unique X-Forwarded-For
 * RUN_IP per run (DB-backed limiter, Phase 8A). The searched name is
 * resolved from the DB at runtime — a student whose name prefix matches
 * EXACTLY ONE Sunrise student (search returns up to 6 rows per section),
 * so the target provably appears in the result set.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'

import { randomBytes } from 'crypto'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'

const BASE = process.env.TENANT_TEST_BASE ?? 'http://localhost:3000'

const T = 45_000

const RUN_IP = `10.236.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const PW = 'ScholarioTest2026'
const SUNRISE_PRINCIPAL = 'principal@sunriseacademy.edu'
const GV_PRINCIPAL = 'principal.b@greenvalley.test'

const tokens: Record<string, string> = {}

// ── auth helpers (real login; direct-session fixture only on 429) ─────────

async function login(email: string, password: string): Promise<string> {
  if (tokens[email]) return tokens[email]
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 429) {
    console.warn(`[search-case] login rate-limited for ${email}; using direct session fixture`)
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
  // PHASE 8A — the row stores the sha256 hash; the RAW token rides the
  // Authorization header (identical to a server-minted session).
  await db.session.create({
    data: { userId: u.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  })
  return token
}

async function as(email: string, path: string, password = PW): Promise<Response> {
  const token = await login(email, password)
  return fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

// ── fixture resolution ──────────────────────────────────────────────────────

interface SearchItem {
  id: string
  title: string
  category: string
  type: string
}

interface SearchBody {
  ok: boolean
  data?: { results?: SearchItem[] }
  error?: string
}

let studentName = ''
let prefix = '' // lowercase, ≥ 3 chars, UNIQUELY matching that one Sunrise student

beforeAll(async () => {
  const school = await db.school.findUnique({ where: { slug: 'sunrise-academy' } })
  if (!school) throw new Error('sunrise-academy missing — run the canonical corpus seeds')

  // Phase 8A — DB-backed login buckets persist across runs; heal them so
  // this run starts from clean limiter state (fixture accounts only).
  await resetLoginBuckets([SUNRISE_PRINCIPAL, GV_PRINCIPAL])

  // Resolve a student whose name prefix matches EXACTLY ONE active
  // Sunrise student (case-insensitively) — search caps at 6 rows per
  // section, so a unique match is guaranteed to appear in results.
  const students = await db.student.findMany({
    where: { schoolId: school.id, user: { status: 'ACTIVE' } },
    select: { id: true, user: { select: { name: true } } },
    take: 400,
  })
  const names = students.map((s) => s.user?.name ?? '').filter((n) => n.length >= 4)
  const lowerNames = names.map((n) => n.toLowerCase())
  outer: for (const name of names) {
    const firstWord = name.split(/\s+/)[0]
    for (const len of [5, 4, 3]) {
      if (firstWord.length < len) continue
      const p = firstWord.slice(0, len).toLowerCase()
      const matches = lowerNames.filter((n) => n.includes(p)).length
      if (matches === 1) {
        studentName = name
        prefix = p
        break outer
      }
    }
  }
  if (!prefix) throw new Error('no uniquely-prefix-matching student found — corpus state unexpected')

  // Real logins (both tenants) — the searches below ride these sessions.
  await login(SUNRISE_PRINCIPAL, 'password123')
  await login(GV_PRINCIPAL, PW)
}, 60_000)

afterAll(async () => {
  // Remove the session rows this suite minted (raw tokens are in-memory).
  const hashes = Object.values(tokens).map((t) => hashSessionToken(t))
  if (hashes.length) {
    await db.session.deleteMany({ where: { tokenHash: { in: hashes } } }).catch(() => {})
  }
  await db.$disconnect()
})

// ── the pin ─────────────────────────────────────────────────────────────────

describe('Phase 8A · /api/search is case-insensitive (SQLite parity, ILIKE + pg_trgm)', () => {
  test('lowercase q (prefix of a real student name from DB) finds the mixed-case student', async () => {
    const res = await as(SUNRISE_PRINCIPAL, `/api/search?q=${encodeURIComponent(prefix)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchBody
    expect(body.ok).toBe(true)
    const results = body.data?.results ?? []
    expect(results.length).toBeGreaterThan(0)
    const hit = results.find((r) => r.type === 'student' && r.title === studentName)
    expect(hit).toBeDefined()
    expect(hit!.id.startsWith('stu-')).toBe(true)
  }, T)

  test(`UPPERCASE q finds the same student (ILIKE, not LIKE)`, async () => {
    const res = await as(SUNRISE_PRINCIPAL, `/api/search?q=${encodeURIComponent(prefix.toUpperCase())}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchBody
    expect(body.ok).toBe(true)
    const results = body.data?.results ?? []
    const hit = results.find((r) => r.type === 'student' && r.title === studentName)
    expect(hit).toBeDefined()
  }, T)

  test(`mixed-case q finds the same student`, async () => {
    // aAbB-style alternation — neither pure lower nor pure upper.
    const mixed = prefix
      .split('')
      .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
      .join('')
    const res = await as(SUNRISE_PRINCIPAL, `/api/search?q=${encodeURIComponent(mixed)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchBody
    const results = body.data?.results ?? []
    const hit = results.find((r) => r.type === 'student' && r.title === studentName)
    expect(hit).toBeDefined()
  }, T)
})

describe('Phase 8A · search stays tenant-isolated (case-insensitivity never widens scope)', () => {
  test('Green Valley principal searching the same q → ZERO results', async () => {
    for (const q of [prefix, prefix.toUpperCase()]) {
      const res = await as(GV_PRINCIPAL, `/api/search?q=${encodeURIComponent(q)}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as SearchBody
      expect(body.ok).toBe(true)
      expect(body.data?.results).toEqual([]) // honest empty — clean tenant
    }
  }, T)
})
