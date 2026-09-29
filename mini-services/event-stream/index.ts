/**
 * SCHOLARIO-OS — Real-time Event Stream Service
 * ----------------------------------------------
 * Broadcasts genuine database events (fee payments, announcements,
 * messages, timetable publications) to connected dashboards over
 * socket.io.
 *
 * Strategy: lightweight poller over the shared SQLite file (bun:sqlite).
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
 *      The token is verified against the Session table (expiry + user
 *      status checked). Unauthenticated connections are refused.
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
import { createServer } from 'http'
import { Server } from 'socket.io'
import { Database } from 'bun:sqlite'

const PORT = 3003
const POLL_MS = 4000
const DB_PATH = new URL('../../db/custom.db', import.meta.url).pathname

const SESSION_COOKIE = 'erp_session'

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

/** Verify the session token against the Session table (readonly). */
function authenticate(token: string): AuthedIdentity | null {
  if (!sqlite) return null
  try {
    // Prisma stores DateTime as epoch-millis INTEGER.
    const row = sqlite
      .query(
        `SELECT u.id AS userId, u.role, u.schoolId, u.status, s.expiresAt
         FROM Session s JOIN User u ON u.id = s.userId
         WHERE s.token = ? LIMIT 1`
      )
      .get(token) as
      | { userId: string; role: string; schoolId: string | null; status: string; expiresAt: number }
      | null
    if (!row) return null
    if (typeof row.expiresAt === 'number' && row.expiresAt <= Date.now()) return null
    if (row.status !== 'ACTIVE') return null
    return { userId: row.userId, role: row.role, schoolId: row.schoolId, status: row.status }
  } catch {
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
io.use((socket, next) => {
  const token = extractToken(socket.handshake)
  const identity = token ? authenticate(token) : null
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

  console.log(
    `[event-stream] authenticated client: ${socket.id} role=${identity.role} school=${identity.schoolId ?? 'platform'}`
  )
  socket.emit('hello', { ok: true, serverTime: new Date().toISOString() })
  socket.on('disconnect', () => console.log(`[event-stream] client gone: ${socket.id}`))
  socket.on('error', (e: unknown) => console.error(`[event-stream] socket error (${socket.id})`, e))
})

// ─── SQLite (read-only) ───
let sqlite: Database | null = null
try {
  sqlite = new Database(DB_PATH, { readonly: true })
  console.log(`[event-stream] attached SQLite at ${DB_PATH}`)
} catch (e) {
  console.error('[event-stream] FATAL: cannot open SQLite', e)
}

// Boot marker — only stream rows created after this service started,
// so clients never get a flood of historical rows.
// NOTE: Prisma stores DateTime as epoch-millis INTEGER in SQLite.
const bootAt = Date.now()
let lastMs: number = bootAt
// Dedupe guard — second-precision timestamps could re-emit the same row
const seen = new Set<string>()
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
// Prisma epoch-millis → ISO string for wire frames
const msToIso = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? new Date(n).toISOString() : new Date().toISOString()

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
async function poll() {
  if (!sqlite) return
  try {
    // 1) Successful fee payments — STAFF feed + the paying student.
    const payments = sqlite
      .query(
        `SELECT p.id, p.amount, p.method, p.createdAt AS ts,
                u.name AS student, f.title AS feeTitle, f.schoolId AS schoolId,
                st.userId AS payerUserId
         FROM Payment p
         JOIN Fee f ON f.id = p.feeId
         JOIN Student st ON st.id = f.studentId
         JOIN User u ON u.id = st.userId
         WHERE p.status = 'SUCCESS' AND p.createdAt > ?
         ORDER BY p.createdAt ASC LIMIT 20`
      )
      .all(lastMs) as Array<{
        id: string; amount: number; method: number | string; ts: number
        student: string; feeTitle: string; schoolId: string; payerUserId: string | null
      }>

    for (const p of payments) {
      if (!markAndCheck(`payment:${p.id}`)) continue
      const evt: StreamEvent = {
        kind: 'payment',
        schoolId: p.schoolId,
        title: 'Fee payment received',
        detail: `${p.student} · ${p.feeTitle}`,
        amount: p.amount,
        method: String(p.method),
        at: msToIso(p.ts),
      }
      // Staff-only (+ the payer + platform) — payment streams carry
      // financial PII; students must not see each other's payments.
      io.to(`staff:${p.schoolId}`).to(`user:${p.payerUserId ?? ''}`).to('platform').emit('school-event', evt)
      console.log(`[event-stream] payment ${p.id} → staff room (₹${p.amount})`)
    }

    // 2) New school announcements — whole school.
    const notices = sqlite
      .query(
        `SELECT n.id, n.title, n.message, n.schoolId, n.createdAt AS ts
         FROM Notification n
         WHERE n.createdAt > ?
         ORDER BY n.createdAt ASC LIMIT 10`
      )
      .all(lastMs) as Array<{ id: string; title: string; message: string; schoolId: string; ts: number }>

    for (const n of notices) {
      if (!markAndCheck(`notice:${n.id}`)) continue
      const evt: StreamEvent = {
        kind: 'announcement',
        schoolId: n.schoolId,
        title: n.title,
        detail: n.message.slice(0, 120),
        at: msToIso(n.ts),
      }
      io.to(`school:${n.schoolId}`).to('platform').emit('school-event', evt)
      console.log(`[event-stream] announcement ${n.id} → school room`)
    }

    // 3) New direct messages — RECIPIENT ONLY (+ platform).
    const messages = sqlite
      .query(
        `SELECT m.id, m.subject, m.body, m.schoolId, m.recipientId, m.createdAt AS ts,
                su.name AS sender
         FROM Message m
         LEFT JOIN User su ON su.id = m.senderId
         WHERE m.createdAt > ?
         ORDER BY m.createdAt ASC LIMIT 10`
      )
      .all(lastMs) as Array<{ id: string; subject: string; body: string; schoolId: string; recipientId: string | null; ts: number; sender: string | null }>

    for (const m of messages) {
      if (!markAndCheck(`message:${m.id}`)) continue
      const evt: StreamEvent & { recipientId?: string | null } = {
        kind: 'message',
        schoolId: m.schoolId,
        title: m.subject,
        detail: m.sender ? `From ${m.sender} · ${m.body.slice(0, 100)}` : m.body.slice(0, 120),
        recipientId: m.recipientId,
        at: msToIso(m.ts),
      }
      // Message subjects/bodies are private: only the addressee (and the
      // platform audit stream) ever receives the frame.
      io.to(`user:${m.recipientId ?? ''}`).to('platform').emit('school-event', evt)
      console.log(`[event-stream] message ${m.id} → recipient room`)
    }

    // 4) Timetable publications — TIMETABLE_PUBLISHED rows in ActivityLog.
    //    These are the school-wide "master schedule changed" moments: open
    //    student/teacher tabs live-refresh their timetable views on this
    //    frame (the Principal publishes → the whole school sees it, live).
    const publishes = sqlite
      .query(
        `SELECT a.id, a.detail, a.schoolId, a.createdAt AS ts, u.name AS actor
         FROM ActivityLog a
         LEFT JOIN User u ON u.id = a.userId
         WHERE a.action = 'TIMETABLE_PUBLISHED' AND a.createdAt > ?
         ORDER BY a.createdAt ASC LIMIT 5`
      )
      .all(lastMs) as Array<{ id: string; detail: string | null; schoolId: string | null; ts: number; actor: string | null }>

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
        at: msToIso(a.ts),
      }
      io.to(`school:${a.schoolId}`).to('platform').emit('school-event', evt)
      console.log(`[event-stream] timetable ${a.id} → school room`)
    }

    // 5) Admissions: no Admission table exists (admissions module is client-mock)
    // — payments + announcements + messages + timetable covers the live stream.

    // advance the watermark so the next poll only sees strictly newer rows
    if (payments.length || notices.length || messages.length || publishes.length) {
      const newest = sqlite.query(
        `SELECT MAX(x) AS m FROM (
           SELECT MAX(p.createdAt) AS x FROM Payment p WHERE p.status='SUCCESS'
           UNION ALL SELECT MAX(n.createdAt) FROM Notification n
           UNION ALL SELECT MAX(m.createdAt) FROM Message m
           UNION ALL SELECT MAX(a.createdAt) FROM ActivityLog a WHERE a.action='TIMETABLE_PUBLISHED'
         )`
      ).get() as { m: number | null }
      if (typeof newest?.m === 'number') lastMs = newest.m
    }
  } catch (e) {
    console.error('[event-stream] poll error', e)
  }
}

httpServer.listen(PORT, () => {
  console.log(`[event-stream] listening on :${PORT} (authenticated, tenant-scoped; streaming since ${new Date(lastMs).toISOString()})`)
  setInterval(poll, POLL_MS)
  // one quick pass shortly after boot to pick up anything racing the start
  setTimeout(poll, 1500)
})

process.on('SIGTERM', () => { httpServer.close(); process.exit(0) })
process.on('SIGINT', () => { httpServer.close(); process.exit(0) })
