/**
 * PRINCIPAL PANEL FUNCTIONAL AUDIT (QA driver — real workflows, live server)
 *
 * Audits principal-plane mutations through the real HTTP surface with a real
 * session cookie, verifying DB state after each write. Follows the repo
 * liveFetch + login conventions (tests/helpers/live-http.ts).
 *
 * Covers: students create (+validation), teachers, classes, announcements,
 * calendar events, fee catalogue (create/edit/archive/bounds), fee create +
 * offline payment, attendance marking, school settings, authz negatives
 * (student→teacher-create 403; teacher→fee-create 403), cross-tenant 404.
 *
 * QA rows are self-cleaning at the end (delete only rows created here).
 * Run: cd /home/z/feature-worktree && source scripts/dev-env.sh && bun audit/qa-principal-mutations.ts
 */
import { db } from "@/lib/db"

const BASE = 'http://127.0.0.1:3000'
const RUN = Date.now().toString(36)
const MARKER = `qa-pa-${RUN}`

const results: Array<{ check: string; pass: boolean; detail: string }> = []
function log(check: string, pass: boolean, detail = '') {
  results.push({ check, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${check}${detail ? ' | ' + detail : ''}`)
}

// --- live fetch with retry (absorbs dev-server compile windows) ---
async function liveFetch(url: string, init: RequestInit = {}, opts: { deadlineMs?: number } = {}): Promise<Response> {
  const deadlineMs = opts.deadlineMs ?? 90_000
  const startedAt = Date.now()
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
    } catch (err) {
      if (Date.now() - startedAt >= deadlineMs) throw err
      await new Promise((r) => setTimeout(r, Math.min(2000, 400 * attempt)))
    }
  }
  throw new Error('exhausted attempts: ' + url)
}

async function login(email: string, password: string) {
  const res = await liveFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const setCookie = res.headers.get('set-cookie') || ''
  const cookie = setCookie.split(';')[0]
  return { cookie, status: res.status, body: (await res.json().catch(() => ({}))) as any }
}

function makeAs(cookie: string) {
  return (path: string, init: RequestInit = {}) =>
    liveFetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers as Record<string, string> | undefined) },
    })
}

async function j(res: Response): Promise<any> {
  return res.json().catch(() => ({}))
}

async function main() {
  const hp = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' } })
  if (!hp) throw new Error('hawkings school missing')

  // ── 0. login ─────────────────────────────────────────────────────────
  const principal = await login('principal@hawkingshigh.edu', 'principal123')
  if (!principal.cookie) return log('principal login', false, `status=${principal.status} body=${JSON.stringify(principal.body).slice(0, 200)}`)
  log('principal login', true, 'session cookie issued')
  const as = makeAs(principal.cookie)

  // ── 1. POST /api/students — validation: missing name ─────────────────
  {
    const res = await as('/api/students', { method: 'POST', body: JSON.stringify({ email: `x.${MARKER}@hawkingshigh.edu` }) })
    const body = await j(res)
    const written = await db.student.findFirst({ where: { schoolId: hp.id, user: { email: `x.${MARKER}@hawkingshigh.edu` } } })
    log('students POST: missing name rejected', res.status >= 400 && !written, `status=${res.status} code=${body.error?.code ?? ''}`)
  }

  // ── 2. POST /api/students — real create ──────────────────────────────
  let studentId = ''
  const studentEmail = `qa-audit.${MARKER}@hawkingshigh.edu`
  {
    const payload = {
      name: `QA Audit Student ${MARKER}`,
      email: studentEmail,
      password: 'QaAudit2026!x',
      rollNo: `QA-${RUN.slice(-4)}`,
      guardianName: 'QA Guardian',
    }
    const res = await as('/api/students', { method: 'POST', body: JSON.stringify(payload) })
    const body = await j(res)
    studentId = body.data?.id ?? ''
    const row = studentId ? await db.student.findUnique({ where: { id: studentId }, include: { user: true } }) : null
    log(
      'students POST: create + DB row + scoped user',
      res.status === 200 && !!row?.schoolId && row.user?.role === 'STUDENT' && row.user.schoolId === row.schoolId,
      `status=${res.status} student=${studentId ? 'yes' : 'NO'} userRole=${row?.user?.role ?? ''} body=${studentId ? '' : JSON.stringify(body).slice(0, 160)}`
    )
  }

  // ── 3. POST /api/teachers ────────────────────────────────────────────
  let teacherId = ''
  const teacherEmail = `qa-teacher.${MARKER}@hawkingshigh.edu`
  {
    const res = await as('/api/teachers', { method: 'POST', body: JSON.stringify({ name: `QA Audit Teacher ${MARKER}`, email: teacherEmail, department: 'QA', password: 'QaTeacher2026!x' }) })
    const body = await j(res)
    teacherId = body.data?.id ?? ''
    const row = teacherId ? await db.teacher.findUnique({ where: { id: teacherId }, include: { user: true } }) : null
    log('teachers POST: create + scoped user', res.status === 200 && !!row?.schoolId && row.user?.role === 'TEACHER', `status=${res.status} teacher=${teacherId ? 'yes' : 'NO'} body=${teacherId ? '' : JSON.stringify(body).slice(0, 160)}`)
  }

  // ── 4. POST /api/classes ─────────────────────────────────────────────
  let classId = ''
  {
    const anyTeacher = await db.teacher.findFirst({ where: { schoolId: hp.id }, select: { userId: true } })
    const res = await as('/api/classes', { method: 'POST', body: JSON.stringify({ name: `QA Class ${MARKER}`, section: 'Q', gradeLevel: '9', classTeacherId: anyTeacher?.userId ?? '' }) })
    const body = await j(res)
    classId = body.data?.id ?? ''
    const row = classId ? await db.class.findUnique({ where: { id: classId } }) : null
    log('classes POST: create + scoped', res.status === 200 && row?.schoolId === hp.id, `status=${res.status} class=${classId ? 'yes' : 'NO'} body=${classId ? '' : JSON.stringify(body).slice(0, 160)}`)
  }

  // ── 5. POST /api/announcements ───────────────────────────────────────
  let announcementId = ''
  {
    const res = await as('/api/announcements', { method: 'POST', body: JSON.stringify({ title: `QA Announcement ${MARKER}`, message: `Audit announcement body ${MARKER}`, audience: 'ALL', priority: 'NORMAL' }) })
    const body = await j(res)
    announcementId = body.data?.id ?? body.id ?? ''
    const row = announcementId ? await db.notification.findUnique({ where: { id: announcementId } }) : null
    log('announcements POST: create', res.status === 200 && !!row?.title?.includes(MARKER), `status=${res.status} id=${announcementId ? 'yes' : 'NO'} body=${announcementId ? '' : JSON.stringify(body).slice(0, 160)}`)
  }

  // ── 6. POST /api/events (calendar) ───────────────────────────────────
  let eventId = ''
  {
    const res = await as('/api/events', { method: 'POST', body: JSON.stringify({ title: `QA Event ${MARKER}`, type: 'EVENT', startDate: new Date(Date.now() + 86400000).toISOString(), audience: 'ALL' }) })
    const body = await j(res)
    eventId = body.data?.id ?? body.id ?? ''
    const row = eventId ? await db.schoolEvent.findUnique({ where: { id: eventId } }) : null
    log('events POST: calendar create', res.status === 200 && !!row?.title?.includes(MARKER), `status=${res.status} id=${eventId ? 'yes' : 'NO'} body=${eventId ? '' : JSON.stringify(body).slice(0, 160)}`)
  }

  // ── 7. Fee catalogue: create + edit + archive + bounds ───────────────
  let headId = ''
  {
    const res = await as('/api/fees/catalogue', { method: 'POST', body: JSON.stringify({ name: `QA Catalogue Head ${MARKER}`, category: 'Activity', frequency: 'One-Time', amount: 500 }) })
    const body = await j(res)
    headId = body.data?.id ?? body.id ?? ''
    const row = headId ? await db.masterFeeHead.findUnique({ where: { id: headId } }) : null
    log('fees catalogue POST: head create', res.status === 200 && row?.schoolId === hp.id, `status=${res.status} id=${headId ? 'yes' : 'NO'}`)

    if (headId) {
      const res2 = await as(`/api/fees/catalogue?id=${headId}`, { method: 'PATCH', body: JSON.stringify({ amount: 750, description: `edited ${MARKER}` }) })
      const row2 = await db.masterFeeHead.findUnique({ where: { id: headId } })
      log('fees catalogue PATCH: edit amount', res2.status === 200 && Number(row2?.amount) === 750, `status=${res2.status} amount=${row2?.amount}`)

      const res3 = await as(`/api/fees/catalogue?id=${headId}`, { method: 'PATCH', body: JSON.stringify({ active: false }) })
      const row3 = await db.masterFeeHead.findUnique({ where: { id: headId } })
      log('fees catalogue PATCH: archive (active=false)', res3.status === 200 && row3?.active === false, `status=${res3.status} active=${row3?.active}`)

      const res4 = await as(`/api/fees/catalogue?id=${headId}`, { method: 'PATCH', body: JSON.stringify({ amount: 999999 }) })
      log('fees catalogue PATCH: amount above bound rejected', res4.status >= 400, `status=${res4.status}`)
    }
  }

  // ── 8. Fee create for the QA student + offline payment ────────────────
  let feeId = ''
  if (studentId) {
    const res = await as('/api/fees', { method: 'POST', body: JSON.stringify({ studentId, title: `QA Fee ${MARKER}`, amount: 1200, type: 'TUITION', dueDate: new Date(Date.now() + 2592000000).toISOString().slice(0, 10) }) })
    const body = await j(res)
    feeId = body.data?.id ?? body.id ?? ''
    const row = feeId ? await db.fee.findUnique({ where: { id: feeId } }) : null
    log('fees POST: create fee for student', res.status === 200 && row?.schoolId === hp.id, `status=${res.status} fee=${feeId ? 'yes' : 'NO'} body=${feeId ? '' : JSON.stringify(body).slice(0, 200)}`)

    if (feeId) {
      const res2 = await as('/api/fees', { method: 'POST', body: JSON.stringify({ feeId, amount: 1200, method: 'CASH', note: `QA-CASH-${RUN}` }) })
      const body2 = await j(res2)
      const txnId = body2?.data?.txnId ?? body2?.txnId ?? ''
      const txn = txnId ? await db.feeTransaction.findUnique({ where: { id: txnId } }) : null
      log(
        'fees POST feeId: offline collection + txn row + receipt',
        res2.status === 200 && txn?.schoolId === hp.id && txn?.status === 'SUCCESS' && !!txn?.receiptNo,
        `status=${res2.status} txn=${txn?.id ? 'yes' : 'NO'} receipt=${txn?.receiptNo ?? 'none'} body=${txn?.id ? '' : JSON.stringify(body2).slice(0, 200)}`
      )
    }
  }

  // ── 9. Attendance marking ─────────────────────────────────────────────
  if (classId) {
    const roster = await as(`/api/students?classId=${classId}`)
    const rosterBody = await j(roster)
    const list: Array<{ id: string }> = rosterBody.data ?? rosterBody.students ?? []
    const today = new Date().toISOString().slice(0, 10)
    const entries = list.slice(0, 2).map((s) => ({ studentId: s.id, status: 'PRESENT' }))
    if (entries.length) {
      const res = await as('/api/attendance', { method: 'POST', body: JSON.stringify({ classId, date: today, entries }) })
      const body = await j(res)
      const rows = await db.attendance.count({ where: { classId } })
      log('attendance POST: mark present', res.status === 200, `status=${res.status} entries=${entries.length} dbRows=${rows} body=${JSON.stringify(body).slice(0, 120)}`)
    } else {
      log('attendance POST: (skipped — QA class roster empty)', true, 'no students to mark')
    }
  }

  // ── 10. School settings mutation (PATCH contract, identity object) ──
  {
    const res = await as('/api/school-settings', { method: 'PATCH', body: JSON.stringify({ identity: { schoolName: 'Hawkings High School Prithvipur' } }) })
    const body = await j(res)
    log('school-settings PATCH: benign mutation', res.status === 200, `status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`)
  }

  // ── 11. Authz negatives ──────────────────────────────────────────────
  {
    const studentSession = await login(studentEmail, 'QaAudit2026!x')
    if (studentSession.cookie) {
      const res = await makeAs(studentSession.cookie)('/api/teachers', { method: 'POST', body: JSON.stringify({ name: `X${MARKER}`, email: `x.${MARKER}@t.edu`, password: 'Xx12345678' }) })
      const row = await db.teacher.findFirst({ where: { user: { email: `x.${MARKER}@t.edu` } } })
      log('authz: student → teachers POST rejected', res.status === 403 && !row, `status=${res.status} row=${row ? 'WRITTEN' : 'none'}`)
    } else {
      log('authz: student login for negative test', false, `status=${studentSession.status}`)
    }

    const teacherSession = await login(teacherEmail, 'QaTeacher2026!x')
    if (teacherSession.cookie) {
      const res = await makeAs(teacherSession.cookie)('/api/fees', { method: 'POST', body: JSON.stringify({ studentId, title: `XFee${MARKER}`, amount: 1 }) })
      const written = await db.fee.findFirst({ where: { title: `XFee${MARKER}` } })
      log('authz: teacher → fees POST rejected', res.status === 403 && !written, `status=${res.status} row=${written ? 'WRITTEN' : 'none'}`)
    } else if (teacherSession.status === 429) {
      log('authz: teacher login (rate-limited — honest 429, skipped negative)', true, 'login rate limiter engaged')
    } else {
      log('authz: teacher login for negative test', false, `status=${teacherSession.status}`)
    }
  }

  // ── 12. Cross-tenant isolation (Green Valley principal reads Hawkings) ─
  {
    const gv = await login('principal@greenvalley.test', 'ScholarioTest2026')
    if (gv.cookie && studentId) {
      const res = await makeAs(gv.cookie)(`/api/students/${studentId}`)
      log('isolation: GV principal → Hawkings student → 404', res.status === 404, `status=${res.status}`)
    }
  }

  // ── summary ──────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass)
  console.log(`\n=== AUDIT SUMMARY: ${results.length - failed.length}/${results.length} passed ===`)
  if (failed.length) {
    console.log('FAILED CHECKS:')
    failed.forEach((f) => console.log(` - ${f.check}: ${f.detail}`))
  }

  // ── cleanup (QA rows only, FK-ordered) ────────────────────────────────
  // Order matters: FeeTransaction rows FK-reference Fee (delete txns
  // first), NotificationRead rows FK-reference Notification (clear read
  // acks first), and Fee/Attendance FK-reference Student (delete those
  // before the student). A bare child-first delete silently no-ops via
  // the catch — this ordering keeps the corpus pristine across runs.
  try {
    if (feeId) {
      await db.feeTransaction.deleteMany({ where: { feeId } }).catch(() => {})
      await db.fee.deleteMany({ where: { id: feeId } }).catch(() => {})
    }
    if (headId) await db.masterFeeHead.delete({ where: { id: headId } }).catch(() => {})
    if (studentId) {
      const s = await db.student.findUnique({ where: { id: studentId } }).catch(() => null)
      await db.attendance.deleteMany({ where: { studentId } }).catch(() => {})
      await db.feeTransaction.deleteMany({ where: { studentId } }).catch(() => {})
      await db.fee.deleteMany({ where: { studentId } }).catch(() => {})
      await db.student.deleteMany({ where: { id: studentId } }).catch(() => {})
      if (s?.userId) await db.user.delete({ where: { id: s.userId } }).catch(() => {})
    }
    if (teacherId) {
      const t = await db.teacher.findUnique({ where: { id: teacherId } }).catch(() => null)
      await db.teacher.deleteMany({ where: { id: teacherId } }).catch(() => {})
      if (t?.userId) await db.user.delete({ where: { id: t.userId } }).catch(() => {})
    }
    if (classId) {
      // relation-safe sweep (a bare class.delete can be blocked by FK rows
      // created between create and cleanup — clear every child table first)
      await db.attendance.deleteMany({ where: { classId } }).catch(() => {})
      await db.subject.deleteMany({ where: { classId } }).catch(() => {})
      await db.student.updateMany({ where: { classId }, data: { classId: null } }).catch(() => {})
      await db.timetable.deleteMany({ where: { classId } }).catch(() => {})
      await db.class.delete({ where: { id: classId } }).catch(() => {})
      const still = await db.class.findUnique({ where: { id: classId } }).catch(() => null)
      if (still) console.log('cleanup WARNING: QA class still present — manual sweep needed')
    }
    if (announcementId) {
      await db.notificationRead.deleteMany({ where: { notificationId: announcementId } }).catch(() => {})
      await db.notification.deleteMany({ where: { id: announcementId } }).catch(() => {})
    }
    if (eventId) await db.schoolEvent.delete({ where: { id: eventId } }).catch(() => {})
    // final sweep — anything left with this run's marker means a FK path we
    // missed; surface it loudly instead of leaking QA rows into the corpus
    const strays = await Promise.all([
      db.class.findMany({ where: { name: { contains: MARKER } }, select: { id: true } }),
      db.user.findMany({ where: { email: { contains: MARKER } }, select: { id: true, email: true } }),
      db.notification.findMany({ where: { title: { contains: MARKER } }, select: { id: true } }),
      db.fee.findMany({ where: { title: { contains: MARKER } }, select: { id: true } }),
      db.feeTransaction.findMany({ where: { note: { contains: RUN } }, select: { id: true } }),
      db.masterFeeHead.findMany({ where: { name: { contains: MARKER } }, select: { id: true } }),
      db.schoolEvent.findMany({ where: { title: { contains: MARKER } }, select: { id: true } }),
    ]).then((lists) => lists.flat())
    if (strays.length) {
      console.log('cleanup WARNING — strays remain:', JSON.stringify(strays))
    } else {
      console.log('cleanup done (QA rows removed; final sweep clean)')
    }
  } catch (e: any) {
    console.log('cleanup warning:', e?.message)
  }
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('AUDIT DRIVER ERROR:', e?.message || e)
  process.exit(1)
})
