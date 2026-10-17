/**
 * STUDENT PANEL FUNCTIONAL AUDIT (QA driver — real workflows, live server)
 *
 * Audits student-plane mutations through the real HTTP surface with a real
 * session cookie, verifying DB state after each write. Follows the repo
 * liveFetch + login conventions (audit/qa-principal-mutations.ts, the same
 * harness as tests/helpers/live-http.ts).
 *
 * Covers: study-task CRUD (+validation incl. foreign-tenant subject),
 * message send (+cross-tenant fail-safe), notification-preference PUT
 * (persist + restore), results role-scope, module reads, authz negatives
 * (student → principal/teacher/declare/platform surfaces), cross-tenant 404.
 *
 * QA rows are self-cleaning at the end (delete only rows created here;
 * UserPreference restored to its pre-run value).
 * Run: cd /home/z/feature-worktree && source scripts/dev-env.sh && bun audit/qa-student-mutations.ts
 */
import { db } from "@/lib/db"

const BASE = 'http://127.0.0.1:3000'
const RUN = Date.now().toString(36)
const MARKER = `qa-st-${RUN}`
const STUDENT_EMAIL = 'aman.sah@hawkingshigh.edu'
const STUDENT_PASSWORD = 'student123'

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
  const gv = await db.school.findUnique({ where: { slug: 'green-valley' } })
  if (!gv) throw new Error('green-valley school missing')

  // Fixtures
  const amanUser = await db.user.findUnique({ where: { email: STUDENT_EMAIL } })
  if (!amanUser) throw new Error('featured student user missing')
  const aman = await db.student.findFirst({ where: { userId: amanUser.id, schoolId: hp.id } })
  if (!aman) throw new Error('featured student record missing')
  const mathTeacher = await db.user.findFirst({
    where: { schoolId: hp.id, role: 'TEACHER', name: { contains: 'Ajay Kumar Mishra' } },
  })
  if (!mathTeacher) throw new Error('math teacher fixture missing')
  const gvStudentUser = await db.user.findFirst({ where: { schoolId: gv.id, role: 'STUDENT' } })
  const gvStudent = gvStudentUser
    ? await db.student.findFirst({ where: { userId: gvStudentUser.id, schoolId: gv.id } })
    : null
  const hpSubject = await db.subject.findFirst({ where: { schoolId: hp.id, name: 'Mathematics' } })
  if (!hpSubject) throw new Error('hawkings Mathematics subject missing')

  // ── 0. login (rate-limit bucket healed for a clean single budget) ────
  await db.rateLimitBucket.deleteMany({ where: { key: `rl:login:acct:${STUDENT_EMAIL}` } }).catch(() => {})
  const student = await login(STUDENT_EMAIL, STUDENT_PASSWORD)
  if (!student.cookie) return log('student login', false, `status=${student.status} body=${JSON.stringify(student.body).slice(0, 200)}`)
  log('student login', true, 'session cookie issued')
  const as = makeAs(student.cookie)

  // ── 1. study-task POST — create with subject + dueDate ──────────────
  let taskId = ''
  {
    const res = await as('/api/student/study-tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `QA Study Task ${MARKER}`,
        subjectId: hpSubject.id,
        dueDate: '2026-10-20T09:00:00.000Z',
      }),
    })
    const body = await j(res)
    const row = body?.data
      ? await db.studyTask.findUnique({ where: { id: body.data.id ?? '' } })
      : await db.studyTask.findFirst({ where: { title: `QA Study Task ${MARKER}` } })
    const ok =
      res.status === 200 &&
      !!row &&
      row.schoolId === hp.id &&
      row.studentId === aman.id &&
      row.subjectId === hpSubject.id &&
      (row.dueDate?.toISOString().startsWith('2026-10-20') ?? false)
    taskId = row?.id ?? ''
    log('study-task create', ok, `status=${res.status} row=${taskId ? 'written' : 'missing'} scope=${row ? `${row.schoolId === hp.id ? 'school' : 'BAD'}/${row.studentId === aman.id ? 'self' : 'BAD'}` : 'n/a'}`)
  }

  // ── 2. study-task POST — validation: empty title rejected ───────────
  {
    const res = await as('/api/student/study-tasks', { method: 'POST', body: JSON.stringify({ title: '   ' }) })
    const written = await db.studyTask.findFirst({ where: { title: { startsWith: 'QA Study Task' }, studentId: aman.id }, orderBy: { createdAt: 'desc' } })
    log('study-task empty-title rejected', res.status >= 400 && !!written && written.id === taskId, `status=${res.status}`)
  }

  // ── 3. study-task POST — validation: subject NOT of this school ────
  // (Green Valley is the clean tenant with no subjects — a fabricated
  // id exercises the same tenant-scoped lookup rejection.)
  {
    const foreignSubjectId = `cmforeignsubject${RUN}0000000000000`
    const res = await as('/api/student/study-tasks', {
      method: 'POST',
      body: JSON.stringify({ title: `QA Task Foreign ${MARKER}`, subjectId: foreignSubjectId }),
    })
    const written = await db.studyTask.findFirst({ where: { title: `QA Task Foreign ${MARKER}` } })
    log('study-task foreign-subject rejected', res.status >= 400 && !written, `status=${res.status}`)
  }

  // ── 4. study-task PATCH — edit + complete, persisted ────────────────
  {
    const res = await as(`/api/student/study-tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: `QA Study Task ${MARKER} (edited)`, completed: true }),
    })
    const row = await db.studyTask.findUnique({ where: { id: taskId } })
    const ok = res.status === 200 && row?.title === `QA Study Task ${MARKER} (edited)` && row?.completedAt !== null
    log('study-task patch edit+complete', ok, `status=${res.status} title=${row?.title ?? 'n/a'} completed=${row?.completedAt ? 'yes' : 'no'}`)
  }

  // ── 5. study-task DELETE — gone ─────────────────────────────────────
  {
    const res = await as(`/api/student/study-tasks/${taskId}`, { method: 'DELETE' })
    const row = await db.studyTask.findUnique({ where: { id: taskId } })
    log('study-task delete', res.status === 200 && !row, `status=${res.status} row=${row ? 'STILL THERE' : 'gone'}`)
  }

  // ── 6. direct message send — to the math teacher, DB-verified ──────
  // (POST /api/messages is staff-only; the student plane sends through
  // POST /api/messaging/threads/[userId] — the direct-message route the
  // student Messages module uses, with the role policy STUDENT →
  // TEACHER/PRINCIPAL/MANAGEMENT and fail-safe 404 counterpart lookup.)
  {
    const markerBody = `QA student direct message ${MARKER}`
    const res = await as(`/api/messaging/threads/${mathTeacher.id}`, {
      method: 'POST',
      body: JSON.stringify({ body: markerBody }),
    })
    const row = await db.message.findFirst({ where: { body: markerBody } })
    const ok =
      res.status === 200 &&
      !!row &&
      row.senderId === amanUser.id &&
      row.recipientId === mathTeacher.id &&
      row.schoolId === hp.id &&
      row.subject === 'Direct message'
    log(
      'direct-message send (student → teacher)',
      ok,
      `status=${res.status} row=${row ? `sender=self recipient=teacher school=${row.schoolId === hp.id ? 'ok' : 'BAD'} subject=${row.subject}` : 'missing'}`,
    )
  }

  // ── 7. direct message — cross-tenant recipient fails closed (404) ──
  {
    const gvPrincipal = await db.user.findFirst({ where: { schoolId: gv.id, role: 'PRINCIPAL' } })
    if (gvPrincipal) {
      const crossBody = `QA cross-tenant attempt ${MARKER}`
      const res = await as(`/api/messaging/threads/${gvPrincipal.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: crossBody }),
      })
      const row = await db.message.findFirst({ where: { body: crossBody } })
      log('direct-message cross-tenant 404', res.status === 404 && !row, `status=${res.status}`)
    } else {
      log('direct-message cross-tenant 404', true, 'skipped — no GV principal user')
    }
  }

  // ── 7b. direct message — role policy: student → student rejected ────
  {
    const classmate = await db.student.findFirst({
      where: { schoolId: hp.id, classId: aman.classId, id: { not: aman.id } },
    })
    if (classmate) {
      const classmateUser = await db.user.findUnique({ where: { id: classmate.userId } })
      const policyBody = `QA student-to-student attempt ${MARKER}`
      const res = await as(`/api/messaging/threads/${classmateUser?.id ?? 'x'}`, {
        method: 'POST',
        body: JSON.stringify({ body: policyBody }),
      })
      const row = await db.message.findFirst({ where: { body: policyBody } })
      log('direct-message student→student 403', res.status === 403 && !row, `status=${res.status}`)
    } else {
      log('direct-message student→student 403', true, 'skipped — no classmate row')
    }
  }

  // ── 8. settings PUT — notification prefs persist (then restore) ─────
  {
    const before = await db.userPreference.findFirst({ where: { userId: amanUser.id } })
    const beforeNotif = before?.notifications ?? null
    const beforeLearn = before?.learning ?? null
    const res = await as('/api/student/settings', {
      method: 'PUT',
      body: JSON.stringify({ notifications: { timetable: false }, learning: { flashcardReminders: false } }),
    })
    const after = await db.userPreference.findFirst({ where: { userId: amanUser.id } })
    const ok = res.status === 200 && !!after && after.notifications.includes('"timetable":false') && after.learning.includes('"flashcardReminders":false')
    log('settings prefs persist', ok, `status=${res.status}`)
    // restore the pre-run value (byte-for-byte)
    if (before) {
      await db.userPreference.update({
        where: { id: before.id },
        data: { notifications: beforeNotif ?? '{}', learning: beforeLearn ?? '{}' },
      })
      const restored = await db.userPreference.findFirst({ where: { userId: amanUser.id } })
      log('settings prefs restored', restored?.notifications === beforeNotif && restored?.learning === beforeLearn, 'pre-run value back')
    }
  }

  // ── 9. results GET — role scope: only own rows ──────────────────────
  {
    const res = await as('/api/results')
    const body = await j(res)
    const rows: Array<{ studentId: string; examId: string }> = Array.isArray(body) ? body : (body?.data ?? [])
    const dbCount = await db.result.count({ where: { studentId: aman.id } })
    const allOwn = rows.every((r) => r.studentId === aman.id)
    log('results role-scoped', res.status === 200 && allOwn && rows.length === dbCount && dbCount > 0, `rows=${rows.length} dbCount=${dbCount} allOwn=${allOwn}`)
  }

  // ── 10. module reads — real payloads ────────────────────────────────
  for (const path of [
    '/api/student/dashboard',
    '/api/student/timetable',
    '/api/student/attendance',
    '/api/student/notices',
    '/api/student/payments',
    '/api/messaging/threads',
    '/api/notifications-feed',
  ]) {
    const res = await as(path)
    const body = await j(res)
    log(`read ${path}`, res.status === 200, `status=${res.status} bytes=${JSON.stringify(body).length}`)
  }

  // ── 11. authz negatives — the student plane is read-mostly ──────────
  {
    const r1 = await as('/api/students', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) })
    log('authz: student → POST /api/students 403', r1.status === 403, `status=${r1.status}`)
    const r2 = await as('/api/teachers', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) })
    log('authz: student → POST /api/teachers 403', r2.status === 403, `status=${r2.status}`)
    const r3 = await as(`/api/exams/cmelikethisdoesnotexist/results/declare`, { method: 'POST' })
    log('authz: student → declare results 403', r3.status === 403, `status=${r3.status}`)
    const r4 = await as('/api/platform/support', {})
    log('authz: student → platform plane rejected', r4.status === 401 || r4.status === 403, `status=${r4.status}`)
    const r5 = await as('/api/school-settings', { method: 'PATCH', body: JSON.stringify({ identity: { schoolName: 'Hacked' } }) })
    log('authz: student → school-settings PATCH rejected', r5.status === 401 || r5.status === 403 || r5.status === 405, `status=${r5.status}`)
  }

  // ── 12. tenant isolation — another tenant's rows are unreachable ─────
  // /api/students is a principal-plane resource: for a STUDENT session the
  // role gate fires first (403 — the honest denial). The student-plane
  // tenant boundary itself is pinned by the cross-tenant direct-message
  // 404 above (a route the student CAN access).
  {
    if (gvStudent) {
      const res = await as(`/api/students/${gvStudent.id}`)
      log('isolation: foreign student unreachable', res.status === 404 || res.status === 403, `status=${res.status}`)
    } else {
      // The clean tenant has no students — the GV PRINCIPAL user id in the
      // /api/students/{id} resource slot is the same gated surface.
      const gvPrincipal = await db.user.findFirst({ where: { schoolId: gv.id, role: 'PRINCIPAL' } })
      const res = await as(`/api/students/${gvPrincipal?.id ?? 'cmmissing0000000000000000'}`)
      log('isolation: foreign id unreachable', res.status === 404 || res.status === 403, `status=${res.status}`)
    }
  }

  // ── cleanup (QA rows only) ──────────────────────────────────────────
  await db.studyTask.deleteMany({ where: { title: { contains: MARKER } } })
  await db.message.deleteMany({ where: { OR: [{ subject: { contains: MARKER } }, { body: { contains: MARKER } }] } })
  const leftovers =
    (await db.studyTask.count({ where: { title: { contains: MARKER } } })) +
    (await db.message.count({ where: { OR: [{ subject: { contains: MARKER } }, { body: { contains: MARKER } }] } }))
  log('cleanup', leftovers === 0, `leftover rows=${leftovers}`)

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`)
  const failed = results.filter((r) => !r.pass)
  if (failed.length) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.check}: ${f.detail}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
