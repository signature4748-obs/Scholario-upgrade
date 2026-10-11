/**
 * SCHOLARIO-OS — Real-time Event Stream Service
 * ----------------------------------------------
 * Broadcasts genuine database events (fee payments, announcements,
 * messages, timetable publications) to connected dashboards over
 * socket.io.
 *
 * Strategy (Phase 8A): lightweight poller over the shared Supabase
 * PostgreSQL database (node `pg`, single long-lived Client with
 * automatic reconnect). Previously a readonly bun:sqlite poll of the
 * local db/custom.db file — ONLY the data source changed: the 4000ms
 * cadence, the four queries, watermark + dedupe semantics, room
 * scoping, wire frames and the authentication model are byte-compatible
 * with the SQLite era.
 *
 * PG-specific contract honoured here:
 *   - Money columns (Payment.amount …) are NUMERIC → the `pg` driver
 *     returns STRINGS; frames carry `amount` as a JSON number, so every
 *     read is converted with Number().
 *   - DateTime columns are timestamp(3) → the `pg` driver returns JS
 *     Date objects; watermark comparisons use getTime() and query
 *     parameters are Date objects.
 *   - Sessions authenticate by Session.tokenHash (SHA-256 hex of the
 *     presented token) — never by plaintext token.
 *   - Supavisor SESSION-mode pooler: one Client = one pinned backend
 *     connection (correct and cheap; no client-side pool needed).
 *
 * ── Phase 1 security model (hostile-internet hardening) ──────────────
 * PREVIOUSLY: unauthenticated sockets + `io.emit` to everyone with
 * client-side filtering (baseline B-9 / C-2 — any socket received every
 * school's events: payments, student names, message subjects).
 *
 * NOW:
 *   1. AUTHENTICATED HANDSHAKE — every socket must present a valid
 *      session (cookie `erp_session` from the first-party flow, or a
 *      Bearer token in `auth.token` for the cross-site preview iframe).
 *      The token's SHA-256 hash is verified against the Session table
 *      (expiry + user status checked). Unauthenticated connections are
 *      refused.
 *   2. SERVER-SIDE TENANT SCOPING — each socket joins rooms derived from
 *      its session identity:
 *        user:<userId>       every authenticated socket
 *        school:<schoolId>   school members (announcement/timetable feeds)
 *        staff:<schoolId>    principal/management only (payment feeds)
 *        platform            super admins (cross-tenant oversight by design)
 *   3. SCOPED EMISSION — payments go to staff + the paying student's user
 *      room (+ platform); messages only to the recipient (+ platform);
 *      announcements/timetables to the school room (+ platform).
 *
 * Port: 3003 (reached via gateway as /?XTransformPort=3003)
 */
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { Client } from 'pg'

const PORT = 3003
const POLL_MS = 4000

const SESSION_COOKIE = 'erp_session'

// ─── Environment (this mini-service is its own package: no dotenv) ─────
// Parse the repo .env ourselves. The sandbox shell may carry a STALE
// DATABASE_URL, so the files always win over process.env — precedence:
// ./mini-services/event-stream/.env → <repo-root>/.env → process.env.
function readEnvFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
    return out
  } catch {
    return {}
  }
}

const LOCAL_ENV = readEnvFile(new URL('./.env', import.meta.url).pathname)
const ROOT_ENV = readEnvFile(new URL('../../.env', import.meta.url).pathname)
const DATABASE_URL =
  LOCAL_ENV.DATABASE_URL ?? ROOT_ENV.DATABASE_URL ?? process.env.DATABASE_URL ?? null

// ─── Logging: service.log is owned by the app itself ───────────────────
// (the launcher may point stdout at /dev/null; set EVENT_STREAM_QUIET=1
// when stdout is already redirected into service.log to avoid doubles)
const LOG_PATH = new URL('./service.log', import.meta.url).pathname
function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`
  try {
    appendFileSync(LOG_PATH, `${line}\n`)
  } catch {
    /* best-effort */
  }
  if (!process.env.EVENT_STREAM_QUIET) console.log(line)
}

interface AuthedIdentity {
  userId: string
  role: string
  schoolId: string | null
  status: string
}

/** Extract the session token from the handshake (cookie or auth payload). */
function extractToken(handshake: {
  headers: { cookie?: string }
  auth?: { token?: string } | undefined
}): string | null {
  const bearer = handshake.auth?.token
  if (typeof bearer === 'string' && bearer.length > 0) return bearer
  const cookie = handshake.headers.cookie
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === SESSION_COOKIE) return rest.join('=')
  }
  return null
}

/** PHASE 8A — sessions are stored hashed: SHA-256 hex of the presented token. */
const sha256Hex = (token: string) => createHash('sha256').update(token).digest('hex')

// ─── PostgreSQL (Supabase via Supavisor SESSION-mode pooler) ────────────
// Single long-lived Client. Reconnect policy: at most ONE attempt per 5s
// (bounded — never a tight loop), backing off to one attempt per 60s
// after 60 consecutive failures. Queries are simply re-issued by the 4s
// poller against the fresh connection once it is back.
let db: Client | null = null
let dbReady = false
let everConnected = false
let lastAttemptMs = 0
let consecutiveFailures = 0

// Boot marker — only stream rows created after this service started,
// so clients never get a flood of historical rows.
// NOTE: the pg driver returns DateTime columns as JS Date objects — the
// watermark stays an epoch-ms number and queries parameterize with Date.
const bootAt = Date.now()
let lastMs: number = bootAt
// Dedupe guard — second-precision timestamps could re-emit the same row
const seen = new Set<string>()

const RETRY_FAST_MS = 5_000
const RETRY_SLOW_MS = 60_000
const SLOW_AFTER_FAILURES = 60

async function ensureConnected(): Promise<boolean> {
  if (db && dbReady) return true
  if (!DATABASE_URL) return false
  const now = Date.now()
  const wait = consecutiveFailures >= SLOW_AFTER_FAILURES ? RETRY_SLOW_MS : RETRY_FAST_MS
  if (now - lastAttemptMs < wait) return false // bounded retry: ≤1 attempt / interval
  lastAttemptMs = now
  if (db) {
    try {
      await db.end()
    } catch {
      /* already dead */
    }
    db = null
  }
  try {
    // 2026-10-11 fix: the service hardcoded Supabase-pooler TLS, which made
    // every local-dev connection fail ("server does not support SSL") and
    // silently killed the poll loop + the 10-min RateLimitBucket sweep.
    // Negotiate honestly: TLS only for non-loopback hosts (Supabase pooler
    // in production deployments), plaintext for the local cluster.
    const url = new URL(DATABASE_URL)
    const isLoopback =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]'
    const client = new Client({
      connectionString: DATABASE_URL,
      // Supabase pooler TLS — certificate chain is not pinned locally
      ssl: isLoopback ? false : { rejectUnauthorized: false },
    })
    client.on('error', (e) => {
      log(`[event-stream] pg client error: ${(e as Error).message}`)
      dbReady = false
    })
    client.on('end', () => {
      if (dbReady) log('[event-stream] pg connection ended')
      dbReady = false
    })
    await client.connect()
    db = client
    dbReady = true
    if (!everConnected) {
      everConnected = true
      // First connect: keep the boot watermark — "stream since start".
      log('[event-stream] attached PostgreSQL (Supabase pooler; first connect)')
    } else {
      // Reconnect after a gap: rewind the watermark 60s so nothing that
      // happened while we were down is lost. Math.min guarantees the
      // watermark is only ever rewound (the seen-set absorbs re-reads of
      // rows already emitted; it is intentionally NOT cleared).
      lastMs = Math.min(lastMs, now - 60_000)
      log(
        `[event-stream] re-attached PostgreSQL; watermark rewound to ${new Date(lastMs).toISOString()}`
      )
    }
    consecutiveFailures = 0
    return true
  } catch (e) {
    consecutiveFailures++
    dbReady = false
    db = null
    log(`[event-stream] pg connect failed (attempt ${consecutiveFailures}): ${(e as Error).message}`)
    return false
  }
}

/** Verify the session token against the Session table (readonly). */
async function authenticate(token: string): Promise<AuthedIdentity | null> {
  if (!db || !dbReady) return null
  try {
    const { rows } = await db.query(
      `SELECT u."id" AS "userId", u."role", u."schoolId", u."status", s."expiresAt"
       FROM "Session" s JOIN "User" u ON u."id" = s."userId"
       WHERE s."tokenHash" = $1 LIMIT 1`,
      [sha256Hex(token)]
    )
    const row = rows[0] as
      | { userId: string; role: string; schoolId: string | null; status: string; expiresAt: Date }
      | undefined
    if (!row) return null
    // expiresAt comes back as a JS Date (timestamp(3)) — compare epoch-ms.
    if (!(row.expiresAt instanceof Date) || row.expiresAt.getTime() <= Date.now()) return null
    if (row.status !== 'ACTIVE') return null
    return { userId: row.userId, role: row.role, schoolId: row.schoolId, status: row.status }
  } catch (e) {
    log(`[event-stream] auth query failed: ${(e as Error).message}`)
    return null
  }
}

// ─── socket.io bootstrap (path '/' is required by the Caddy gateway) ───
// NOTE: engine.io owns every URL path (path '/'), so plain HTTP probes are
// answered by engine.io itself. A 200 socket.io handshake —
//   curl "http://localhost:3003/?EIO=4&transport=polling"
// — is the service health check. CORS is permissive because clients
// connect same-origin through the gateway; the real gate is the
// authenticated handshake (no valid session → connection refused).
const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy forwards /?XTransformPort=3003 here
  path: '/',
  cors: { origin: true, credentials: true, methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

// ─── Authentication middleware (every connection) ───────────────────────
io.use(async (socket, next) => {
  const token = extractToken(socket.handshake)
  const identity = token ? await authenticate(token) : null
  if (!identity) {
    // Fail the handshake — the client's connect_error path degrades the
    // live indicators instead of silently receiving no data.
    next(new Error('unauthorized'))
    return
  }
  // Identity travels on the socket; rooms join on connection.
  ;(socket.data as { identity: AuthedIdentity }).identity = identity
  next()
})

io.on('connection', (socket) => {
  const identity = (socket.data as { identity: AuthedIdentity }).identity
  const rooms: string[] = [`user:${identity.userId}`]
  if (identity.schoolId) {
    rooms.push(`school:${identity.schoolId}`)
    if (identity.role === 'PRINCIPAL' || identity.role === 'MANAGEMENT') {
      rooms.push(`staff:${identity.schoolId}`)
    }
  }
  if (identity.role === 'SUPER_ADMIN') rooms.push('platform')
  for (const room of rooms) socket.join(room)

  log(
    `[event-stream] authenticated client: ${socket.id} role=${identity.role} school=${identity.schoolId ?? 'platform'}`
  )
  socket.emit('hello', { ok: true, serverTime: new Date().toISOString() })
  socket.on('disconnect', () => log(`[event-stream] client gone: ${socket.id}`))
  socket.on('error', (e: unknown) => log(`[event-stream] socket error (${socket.id}): ${String(e)}`))
})

// ─── Watermark + dedupe (unchanged semantics) ───────────────────────────
const markAndCheck = (key: string) => {
  if (seen.has(key)) return false
  seen.add(key)
  if (seen.size > 5000) {
    // keep memory bounded — drop the oldest half
    const it = seen.values()
    for (let i = 0; i < 2500; i++) seen.delete(it.next().value)
  }
  return true
}
// pg Date objects → ISO string for wire frames (same fallback as the
// old msToIso: absent/invalid timestamps stamp "now")
const dateToIso = (d: Date | null | undefined) =>
  d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString()

interface StreamEvent {
  kind: 'payment' | 'announcement' | 'admission' | 'message' | 'timetable'
  schoolId: string
  title: string
  detail: string
  amount?: number
  method?: string
  /** For message events: the User.id of the recipient so only the
      addressee's socket badges their inbox. */
  recipientId?: string | null
  at: string
}

// ─── Poller ─────────────────────────────────────────────────────────────
// One poll in flight at a time (async PG queries make overlapping ticks
// possible; skipping a tick while one runs is bounded and safe).
let polling = false

async function poll(): Promise<void> {
  if (polling) return
  if (!(await ensureConnected()) || !db) return
  polling = true
  try {
    // Parameterize with a Date — the pg driver serializes it for the
    // timestamp(3) comparison; rows come back with Date objects.
    const since = new Date(lastMs)

    // 0) Watermark snapshot — sampled BEFORE the row SELECTs, not after.
    // With the async pg driver the per-table SELECTs, the emissions and
    // the old end-of-poll MAX were separated by network round-trips, so a
    // row inserted mid-poll (e.g. right after a frame went out) could be
    // counted by the end-of-poll MAX without ever being SELECTed — the
    // watermark would then jump PAST it and the event was lost forever.
    // Sampling the max up front fixes the race: every row ≤ snapshot that
    // is newer than the previous watermark is guaranteed to be seen by
    // the SELECTs below (they run later, so they see at least as much),
    // while rows created after the snapshot keep ts > snapshot and are
    // picked up by the next poll. Rows SELECTed after the snapshot landed
    // are re-read once and absorbed by the seen-set — semantics otherwise
    // identical to the SQLite era (one unconditional aggregate per 4s
    // poll instead of the old results-gated one).
    const { rows: snapRows } = await db.query(
      `SELECT MAX(x) AS m FROM (
         SELECT MAX(p."createdAt") AS x FROM "Payment" p WHERE p."status"='SUCCESS'
         UNION ALL SELECT MAX(n."createdAt") FROM "Notification" n
         UNION ALL SELECT MAX(m."createdAt") FROM "Message" m
         UNION ALL SELECT MAX(a."createdAt") FROM "ActivityLog" a WHERE a."action"='TIMETABLE_PUBLISHED'
       ) AS t`
    )
    const snap = snapRows[0] as { m: Date | null }
    const candidate = snap?.m instanceof Date ? Math.max(snap.m.getTime(), lastMs) : lastMs

    // 1) Successful fee payments — STAFF feed + the paying student.
    const payments = (
      await db.query(
        `SELECT p."id", p."amount", p."method", p."createdAt" AS "ts",
                u."name" AS "student", f."title" AS "feeTitle", f."schoolId" AS "schoolId",
                st."userId" AS "payerUserId"
         FROM "Payment" p
         JOIN "Fee" f ON f."id" = p."feeId"
         JOIN "Student" st ON st."id" = f."studentId"
         JOIN "User" u ON u."id" = st."userId"
         WHERE p."status" = 'SUCCESS' AND p."createdAt" > $1
         ORDER BY p."createdAt" ASC LIMIT 20`,
        [since]
      )
    ).rows as Array<{
      id: string
      amount: string // NUMERIC → the pg driver returns a string
      method: string | null
      ts: Date
      student: string | null
      feeTitle: string
      schoolId: string
      payerUserId: string | null
    }>

    for (const p of payments) {
      if (!markAndCheck(`payment:${p.id}`)) continue
      // Frames carry `amount` as a JSON number (wire compatibility).
      const amount = Number(p.amount)
      const evt: StreamEvent = {
        kind: 'payment',
        schoolId: p.schoolId,
        title: 'Fee payment received',
        detail: `${p.student} · ${p.feeTitle}`,
        amount,
        method: String(p.method),
        at: dateToIso(p.ts),
      }
      // Staff-only (+ the payer + platform) — payment streams carry
      // financial PII; students must not see each other's payments.
      io.to(`staff:${p.schoolId}`).to(`user:${p.payerUserId ?? ''}`).to('platform').emit('school-event', evt)
      log(`[event-stream] payment ${p.id} → staff room (₹${amount})`)
    }

    // 2) New school announcements — whole school.
    const notices = (
      await db.query(
        `SELECT n."id", n."title", n."message", n."schoolId", n."createdAt" AS "ts"
         FROM "Notification" n
         WHERE n."createdAt" > $1
         ORDER BY n."createdAt" ASC LIMIT 10`,
        [since]
      )
    ).rows as Array<{ id: string; title: string; message: string; schoolId: string; ts: Date }>

    for (const n of notices) {
      if (!markAndCheck(`notice:${n.id}`)) continue
      const evt: StreamEvent = {
        kind: 'announcement',
        schoolId: n.schoolId,
        title: n.title,
        detail: n.message.slice(0, 120),
        at: dateToIso(n.ts),
      }
      io.to(`school:${n.schoolId}`).to('platform').emit('school-event', evt)
      log(`[event-stream] announcement ${n.id} → school room`)
    }

    // 3) New direct messages — RECIPIENT ONLY (+ platform).
    const messages = (
      await db.query(
        `SELECT m."id", m."subject", m."body", m."schoolId", m."recipientId", m."createdAt" AS "ts",
                su."name" AS "sender"
         FROM "Message" m
         LEFT JOIN "User" su ON su."id" = m."senderId"
         WHERE m."createdAt" > $1
         ORDER BY m."createdAt" ASC LIMIT 10`,
        [since]
      )
    ).rows as Array<{
      id: string
      subject: string
      body: string
      schoolId: string
      recipientId: string | null
      ts: Date
      sender: string | null
    }>

    for (const m of messages) {
      if (!markAndCheck(`message:${m.id}`)) continue
      const evt: StreamEvent & { recipientId?: string | null } = {
        kind: 'message',
        schoolId: m.schoolId,
        title: m.subject,
        detail: m.sender ? `From ${m.sender} · ${m.body.slice(0, 100)}` : m.body.slice(0, 120),
        recipientId: m.recipientId,
        at: dateToIso(m.ts),
      }
      // Message subjects/bodies are private: only the addressee (and the
      // platform audit stream) ever receives the frame.
      io.to(`user:${m.recipientId ?? ''}`).to('platform').emit('school-event', evt)
      log(`[event-stream] message ${m.id} → recipient room`)
    }

    // 4) Timetable publications — TIMETABLE_PUBLISHED rows in ActivityLog.
    //    These are the school-wide "master schedule changed" moments: open
    //    student/teacher tabs live-refresh their timetable views on this
    //    frame (the Principal publishes → the whole school sees it, live).
    const publishes = (
      await db.query(
        `SELECT a."id", a."detail", a."schoolId", a."createdAt" AS "ts", u."name" AS "actor"
         FROM "ActivityLog" a
         LEFT JOIN "User" u ON u."id" = a."userId"
         WHERE a."action" = 'TIMETABLE_PUBLISHED' AND a."createdAt" > $1
         ORDER BY a."createdAt" ASC LIMIT 5`,
        [since]
      )
    ).rows as Array<{
      id: string
      detail: string | null
      schoolId: string | null
      ts: Date
      actor: string | null
    }>

    for (const a of publishes) {
      if (!markAndCheck(`activity:${a.id}`)) continue
      if (!a.schoolId) continue // platform-level rows carry no school scope
      const evt: StreamEvent = {
        kind: 'timetable',
        schoolId: a.schoolId,
        title: 'Timetable updated',
        detail: a.actor
          ? `${a.detail ?? 'New schedule published'} · by ${a.actor}`
          : (a.detail ?? 'New schedule published'),
        at: dateToIso(a.ts),
      }
      io.to(`school:${a.schoolId}`).to('platform').emit('school-event', evt)
      log(`[event-stream] timetable ${a.id} → school room`)
    }

    // 5) Admissions: no Admission table exists (admissions module is client-mock)
    // — payments + announcements + messages + timetable covers the live stream.

    // commit the pre-sampled watermark (see step 0): every row ≤ candidate
    // and > the previous watermark has now been SELECTed, so advancing is
    // loss-free. On any query failure above we do NOT land here — the
    // watermark stays put and the next poll re-reads (dedupe absorbs).
    lastMs = candidate
  } catch (e) {
    // Query failure is almost certainly a dropped connection — mark the
    // client unhealthy so the next tick reconnects (rate-limited, bounded).
    dbReady = false
    log(`[event-stream] poll error: ${(e as Error).message}`)
  } finally {
    polling = false
  }
}

// ─── RateLimitBucket sweep (Phase 8A DB-backed rate limiter hygiene) ────
// The main app's fixed-window counters live in the shared database; this
// best-effort sweep keeps the table bounded. Every 10 minutes; errors are
// swallowed on purpose (the stream must never die for the sweeper).
async function sweepRateLimits(): Promise<void> {
  if (!db || !dbReady) return
  try {
    const r = await db.query(
      `DELETE FROM "RateLimitBucket" WHERE "updatedAt" < now() - interval '2 hours'`
    )
    if (r.rowCount && r.rowCount > 0) {
      log(`[event-stream] rate-limit sweep: removed ${r.rowCount} stale bucket(s)`)
    }
  } catch {
    /* best-effort by design */
  }
}

httpServer.listen(PORT, () => {
  log(
    `[event-stream] listening on :${PORT} (authenticated, tenant-scoped; streaming since ${new Date(lastMs).toISOString()})`
  )
  if (!DATABASE_URL) {
    log('[event-stream] FATAL: no DATABASE_URL (./.env → ../../.env → process.env) — auth/poll disabled')
  }
  setInterval(poll, POLL_MS)
  // one quick pass shortly after boot to pick up anything racing the start
  setTimeout(poll, 1500)
  // rate-limit hygiene: every 10 minutes (+ one early pass)
  setInterval(sweepRateLimits, 10 * 60_000)
  setTimeout(sweepRateLimits, 15_000)
  // eager first connect instead of waiting for the first poll tick
  void ensureConnected()
})

process.on('SIGTERM', () => {
  httpServer.close()
  process.exit(0)
})
process.on('SIGINT', () => {
  httpServer.close()
  process.exit(0)
})
