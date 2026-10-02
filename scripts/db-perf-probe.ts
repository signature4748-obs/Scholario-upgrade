/**
 * scripts/db-perf-probe.ts — Phase 8A PERFORMANCE PROBE (mission §56).
 *
 * Against the LIVE integration DB + the dev server on :3000:
 *   (a) EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) on the 4 hot query shapes:
 *       students roster (Student⋈User, school filter), fee aggregation
 *       (SUM by school+status), attendance range scan (classId + date
 *       range), trigram search (User.name ILIKE '%aarav%').
 *   (b) Synthetic volume probe: a THROWAWAY school + 1,000 students
 *       (users+students createMany in 250-row batches), 2 classes, 30
 *       attendance rows per student (30k rows, createMany batched by
 *       5,000) — then the roster / attendance-range / search queries
 *       re-run filtered to the throwaway school. A second 5,000-student
 *       phase runs UNLESS the 1,000-scale insert exceeded ~2 minutes.
 *   (c) The known N+1 endpoint: GET /api/teacher/dashboard as
 *       teacher1@hawkingshigh.edu (real login with a random
 *       x-forwarded-for IP) — wall time recorded (QA measured 9–13 s).
 *   (d) FULL cleanup of the throwaway school (cascade) + residue sweep
 *       (every table with a schoolId column + baseline counts + money
 *       parity) — the probe leaves zero rows behind.
 *
 * Connection budget: 1 pg session + 1 Prisma pool (connection_limit=2)
 * on top of the dev server's 6 + event-stream's 1 → ~10 of the 15
 * Supavisor session slots while running.
 *
 * RUN: unset DATABASE_URL && bun scripts/db-perf-probe.ts
 * (reads .env itself; never prints the connection string)
 */
import { createHash } from 'node:crypto'
import { assertNotProductionDatabase, connectOpsClient, prismaDatasourceUrl, utcSlug } from './db-conn'
import { SEED_SHOWCASE_TEACHER_PASSWORD } from '../prisma/seed-credentials'

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000'
const TEACHER_EMAIL = 'teacher1@hawkingshigh.edu'
// Env-driven demo credential — the FEATURED TEACHER carries its own password
// family (final-acceptance family split), not the default family.
const TEACHER_PW = SEED_SHOWCASE_TEACHER_PASSWORD

// ── timing helpers ───────────────────────────────────────────────────────

interface Timings {
  label: string
  runs: number[]
  note?: string
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(1)} ms`
}

function reportT(t: Timings): string {
  const sorted = [...t.runs].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  const all = t.runs.map((r) => ms(r)).join(' / ')
  return `${t.label}: ${all} (median ${ms(med)})${t.note ? ` — ${t.note}` : ''}`
}

/** Parse "Execution Time: 12.345 ms" out of an EXPLAIN ANALYZE plan. */
function execTimeMs(plan: string): number | null {
  const m = plan.match(/Execution Time:\s*([\d.]+)\s*ms/)
  return m ? Number(m[1]) : null
}

async function main(): Promise<void> {
  assertNotProductionDatabase()
  const { client, query } = await connectOpsClient()
  const startedAt = Date.now()

  // ══ Phase 0: fixtures ═══════════════════════════════════════════════
  const { rows: schoolRows } = await query(
    `SELECT id, name FROM "School" WHERE slug = 'hawkings-prithvipur' LIMIT 1`,
  )
  const schoolId = String(schoolRows[0]?.id ?? '')
  if (!schoolId) throw new Error('hawkings-prithvipur school not found')
  const { rows: classRows } = await query(
    `SELECT a."classId" AS id, count(*)::int AS n
       FROM "Attendance" a JOIN "Class" c ON c."id" = a."classId"
      WHERE c."schoolId" = $1 GROUP BY a."classId" ORDER BY n DESC LIMIT 1`,
    [schoolId],
  )
  const hotClassId = String(classRows[0]?.id ?? '')
  const attDateFrom = '2026-07-20'
  const attDateTo = '2026-10-01'

  console.log('═'.repeat(78))
  console.log(`PERF PROBE  ${new Date().toISOString()}   school=${schoolId} class=${hotClassId}`)
  console.log(`RTT note: this sandbox → Supavisor (ap-south-1) ≈ 137 ms per round trip`)
  console.log('═'.repeat(78))

  // baseline snapshot (for the final residue proof)
  const baselineTables = ['School', 'Class', 'User', 'Student', 'Attendance', 'Session', 'RateLimitBucket', 'ActivityLog']
  const baseline = new Map<string, number>()
  for (const t of baselineTables) {
    const { rows } = await query(`SELECT count(*)::int AS c FROM "public"."${t}"`)
    baseline.set(t, Number(rows[0]['c']))
  }

  // ══ Phase A: EXPLAIN (ANALYZE, BUFFERS) on the 4 hot shapes ════════
  console.log('\n── (a) EXPLAIN ANALYZE, BUFFERS — hot query shapes (live corpus) ──')

  const explain = async (label: string, sql: string, params?: unknown[]): Promise<void> => {
    // 2 runs: first may pay cold-cache costs; report BOTH, print warm plan.
    const plans: string[] = []
    for (let i = 0; i < 2; i++) {
      const { rows } = await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params)
      plans.push(rows.map((r) => String(Object.values(r)[0])).join('\n'))
    }
    const t1 = execTimeMs(plans[0])
    const t2 = execTimeMs(plans[1])
    console.log(`\n● ${label}   [execution time: run1 ${t1?.toFixed(2) ?? '?'} ms / run2 (warm) ${t2?.toFixed(2) ?? '?'} ms]`)
    console.log(plans[1])
  }

  await explain(
    'A1 · students roster — Student ⋈ User, school filter, ORDER BY rollNo',
    `SELECT s."id", s."rollNo", s."admissionNo", u."name", u."email", u."createdAt"::text
       FROM "Student" s JOIN "User" u ON u."id" = s."userId"
      WHERE s."schoolId" = $1 AND u."status" = 'ACTIVE'
      ORDER BY s."rollNo" ASC`,
    [schoolId],
  )
  await explain(
    'A2 · fee aggregation — SUM(amount)/SUM(paid) by school + status',
    `SELECT f."status", SUM(f."amount")::text AS billed, SUM(f."paid")::text AS paid
       FROM "Fee" f WHERE f."schoolId" = $1 GROUP BY f."status"`,
    [schoolId],
  )
  await explain(
    'A3 · attendance range scan — classId + date range',
    `SELECT "studentId", "date", "status" FROM "Attendance"
      WHERE "classId" = $1 AND "date" >= $2::date AND "date" <= $3::date
      ORDER BY "date", "studentId"`,
    [hotClassId, attDateFrom, attDateTo],
  )
  await explain(
    'A4 · trigram search — User.name ILIKE %aarav% (trgm GIN)',
    `SELECT "id", "name", "email" FROM "User" WHERE "name" ILIKE '%aarav%'`,
  )

  // ══ Phase B: synthetic volume probe ═════════════════════════════════
  console.log('\n── (b) synthetic volume probe — throwaway school + N students ──')

  // Prisma client AFTER the env override (stale shell DATABASE_URL is
  // never trusted; the .env FILE value wins).
  process.env.DATABASE_URL = prismaDatasourceUrl(2)
  const mod = (await import('@prisma/client')) as typeof import('@prisma/client')
  const prisma = new mod.PrismaClient()

  const slug = utcSlug()
  const marker = `PP${slug}`
  const school = await prisma.school.create({
    data: {
      name: `Perf Probe School ${slug}`,
      slug: `perf-probe-${slug}`,
      code: marker,
      plan: 'STANDARD',
      status: 'ACTIVE',
    },
  })
  const probeSchoolId = school.id
  const classes = await prisma.class.createMany({
    data: [
      { schoolId: probeSchoolId, name: 'Probe Grade A', section: 'A', gradeLevel: '10', capacity: 3000 },
      { schoolId: probeSchoolId, name: 'Probe Grade B', section: 'B', gradeLevel: '10', capacity: 3000 },
    ],
  })
  console.log(`throwaway school ${probeSchoolId} (${marker}) + ${classes.count} classes created`)

  const probeClasses = await prisma.class.findMany({
    where: { schoolId: probeSchoolId },
    select: { id: true },
    orderBy: { name: 'asc' },
  })
  const classIdA = probeClasses[0]?.id ?? ''
  const classIdB = probeClasses[1]?.id ?? ''

  // ── 1,000-student scale (users+students: 4 iterations × two createMany
  //    batches of 250 each; attendance: 30 rows/student, createMany × 5000) ──
  let tUsersStudents = 0
  {
    const t0 = Date.now()
    for (let i = 0; i < 1000; i += 250) {
      const users = Array.from({ length: 250 }, (_, j) => ({
        email: `pp${slug}s${i + j}@perfprobe.test`,
        name: `Aarav Probe ${i + j}`,
        schoolId: probeSchoolId,
        role: 'STUDENT' as const,
        status: 'ACTIVE' as const,
      }))
      await prisma.user.createMany({ data: users })
      const rows = await prisma.user.findMany({
        where: { email: { in: users.map((u) => u.email) } },
        select: { id: true },
        orderBy: { email: 'asc' },
      })
      const students = rows.map((r, j) => ({
        schoolId: probeSchoolId,
        userId: r.id,
        classId: (i + j) % 2 === 0 ? classIdA : classIdB,
        rollNo: String(i + j + 1).padStart(5, '0'),
        admissionNo: `${marker}-${String(i + j).padStart(5, '0')}`,
        guardianName: 'Probe Guardian',
      }))
      await prisma.student.createMany({ data: students })
    }
    tUsersStudents = Date.now() - t0
  }

  const insertAttendance = async (studentIds: string[]): Promise<number> => {
    const t0 = Date.now()
    const dates = Array.from({ length: 30 }, (_, d) => new Date(Date.UTC(2026, 8, d + 1)))
    const rows: {
      schoolId: string
      studentId: string
      classId: string
      date: Date
      status: string
      markedBy: string
    }[] = []
    for (const sid of studentIds) {
      for (let d = 0; d < 30; d++) {
        rows.push({
          schoolId: probeSchoolId,
          studentId: sid,
          classId: d % 2 === 0 ? classIdA : classIdB,
          date: dates[d],
          status: d % 10 === 7 ? 'ABSENT' : 'PRESENT',
          markedBy: 'perf-probe',
        })
      }
    }
    for (let i = 0; i < rows.length; i += 5000) {
      await prisma.attendance.createMany({ data: rows.slice(i, i + 5000) })
    }
    return Date.now() - t0
  }

  const probeStudentIds = await prisma.student.findMany({
    where: { schoolId: probeSchoolId },
    select: { id: true },
  })
  const tAtt1k = await insertAttendance(probeStudentIds.map((s) => s.id))
  const insert1kTotal = tUsersStudents + tAtt1k
  console.log(
    `inserts @1,000 students: users+students (8 × createMany 250) ${ms(tUsersStudents)}   attendance 30,000 rows (6 × createMany 5000) ${ms(tAtt1k)}   total ${ms(insert1kTotal)}`,
  )

  // ── queries at 1,000-student scale (throwaway school) ──
  const runRoster = async (): Promise<number> => {
    const t0 = Date.now()
    await query(
      `SELECT s."id", s."rollNo", s."admissionNo", u."name", u."email"
         FROM "Student" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."schoolId" = $1 AND u."status" = 'ACTIVE'
        ORDER BY s."rollNo" ASC`,
      [probeSchoolId],
    )
    return Date.now() - t0
  }
  const runAttendanceRange = async (): Promise<number> => {
    const t0 = Date.now()
    await query(
      `SELECT "studentId", "date"::text, "status" FROM "Attendance"
        WHERE "classId" = $1 AND "date" >= $2::date AND "date" <= $3::date
        ORDER BY "date", "studentId"`,
      [classIdA, '2026-09-01', '2026-09-30'],
    )
    return Date.now() - t0
  }
  const runSearch = async (): Promise<number> => {
    const t0 = Date.now()
    await query(
      `SELECT "id", "name", "email" FROM "User" WHERE "schoolId" = $1 AND "name" ILIKE '%aarav%'`,
      [probeSchoolId],
    )
    return Date.now() - t0
  }

  const probeAtScale = async (label: string, studentCount: number): Promise<void> => {
    const rowCounts = await query(
      `SELECT (SELECT count(*)::int FROM "Student" WHERE "schoolId" = $1) students,
              (SELECT count(*)::int FROM "Attendance" WHERE "schoolId" = $1) attendance,
              (SELECT count(*)::int FROM "User" WHERE "schoolId" = $1 AND "name" ILIKE '%aarav%') matches`,
      [probeSchoolId],
    )
    console.log(`\n● queries @ ${label} (${studentCount} students / ${rowCounts.rows[0]['attendance']} attendance rows / ${rowCounts.rows[0]['matches']} ILIKE matches):`)
    for (const [name, fn] of [
      ['roster join', runRoster],
      ['attendance range', runAttendanceRange],
      ['trigram search', runSearch],
    ] as [string, () => Promise<number>][]) {
      const runs: number[] = []
      for (let i = 0; i < 3; i++) runs.push(await fn())
      console.log(`  ${reportT({ label: name, runs })}`)
    }
    // warm server-side plan for each
    const plan = async (label: string, sql: string, params?: unknown[]) => {
      const { rows } = await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, params)
      const text = rows.map((r) => String(Object.values(r)[0])).join('\n')
      const node = text.split('\n').find((l) => l.includes('->') && /Scan|Index|Sort/.test(l))
      console.log(`  plan ${label}: Execution Time ${execTimeMs(text)?.toFixed(2)} ms · ${node?.trim() ?? ''}`)
    }
    await plan(
      'roster',
      `SELECT s."id", s."rollNo", u."name", u."email" FROM "Student" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."schoolId" = $1 AND u."status" = 'ACTIVE' ORDER BY s."rollNo" ASC`,
      [probeSchoolId],
    )
    await plan(
      'attendance-range',
      `SELECT "studentId", "date", "status" FROM "Attendance"
        WHERE "classId" = $1 AND "date" >= $2::date AND "date" <= $3::date ORDER BY "date", "studentId"`,
      [classIdA, '2026-09-01', '2026-09-30'],
    )
    await plan(
      'search',
      `SELECT "id", "name", "email" FROM "User" WHERE "schoolId" = $1 AND "name" ILIKE '%aarav%'`,
      [probeSchoolId],
    )
  }

  await probeAtScale('1,000-student scale', 1000)

  // ── 5,000-student scale (skipped if the 1,000-scale insert was slow) ──
  if (insert1kTotal > 120_000) {
    console.log(`\n5,000-student phase SKIPPED — 1,000-scale inserts took ${ms(insert1kTotal)} (> ~2 min rule)`)
  } else {
    console.log('\n── 5,000-student phase (+4,000 students, +120,000 attendance rows) ──')
    const t0 = Date.now()
    let firstNew = 1000
    for (let i = 0; i < 4000; i += 250) {
      const users = Array.from({ length: 250 }, (_, j) => ({
        email: `pp${slug}s${firstNew + i + j}@perfprobe.test`,
        name: `Aarav Probe ${firstNew + i + j}`,
        schoolId: probeSchoolId,
        role: 'STUDENT' as const,
        status: 'ACTIVE' as const,
      }))
      await prisma.user.createMany({ data: users })
      const rows = await prisma.user.findMany({
        where: { email: { in: users.map((u) => u.email) } },
        select: { id: true },
        orderBy: { email: 'asc' },
      })
      const students = rows.map((r, j) => ({
        schoolId: probeSchoolId,
        userId: r.id,
        classId: (firstNew + i + j) % 2 === 0 ? classIdA : classIdB,
        rollNo: String(firstNew + i + j + 1).padStart(5, '0'),
        admissionNo: `${marker}-${String(firstNew + i + j).padStart(5, '0')}`,
        guardianName: 'Probe Guardian',
      }))
      await prisma.student.createMany({ data: students })
    }
    const tUsers5k = Date.now() - t0
    const newStudents = await prisma.student.findMany({
      where: { schoolId: probeSchoolId, admissionNo: { gte: `${marker}-01000` } },
      select: { id: true },
    })
    const tAtt5k = await insertAttendance(newStudents.map((s) => s.id))
    console.log(
      `inserts @5,000 scale: users+students (32 × createMany 250) ${ms(tUsers5k)}   attendance +120,000 rows (24 × createMany 5000) ${ms(tAtt5k)}`,
    )
    await probeAtScale('5,000-student scale', 5000)
  }

  // ══ Phase C: N+1 endpoint wall time ═════════════════════════════════
  console.log('\n── (c) N+1 endpoint: GET /api/teacher/dashboard (teacher1, real login) ──')
  const probeIp = `10.239.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  // login-bucket hygiene (integration DB only): clear the fixture account
  // bucket so an earlier QA login window cannot 429 the probe.
  await query(`DELETE FROM "RateLimitBucket" WHERE "key" = $1`, [`rl:login:acct:${TEACHER_EMAIL.toLowerCase()}`])
  const tLogin0 = Date.now()
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': probeIp },
    body: JSON.stringify({ email: TEACHER_EMAIL, password: TEACHER_PW }),
  })
  const loginMs = Date.now() - tLogin0
  const loginBody = (await loginRes.json()) as { ok: boolean; data?: { sessionToken?: string } }
  const token = loginBody.data?.sessionToken ?? ''
  console.log(`login: HTTP ${loginRes.status} in ${ms(loginMs)} (x-forwarded-for ${probeIp})`)
  if (!token) throw new Error('login did not return a sessionToken')

  const dash = async (): Promise<{ status: number; ms: number; bytes: number }> => {
    const t0 = Date.now()
    const res = await fetch(`${BASE}/api/teacher/dashboard`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await res.text()
    return { status: res.status, ms: Date.now() - t0, bytes: Buffer.byteLength(body) }
  }
  const warm = await dash() // dev-server lazy compile absorbed here
  console.log(`warmup: HTTP ${warm.status} in ${ms(warm.ms)} (${(warm.bytes / 1024).toFixed(0)} KiB)`)
  const runs: number[] = []
  let last: { status: number; ms: number; bytes: number } = warm
  for (let i = 0; i < 2; i++) {
    last = await dash()
    runs.push(last.ms)
  }
  console.log(`GET /api/teacher/dashboard: ${reportT({ label: 'measured', runs })} · HTTP ${last.status} · ${(last.bytes / 1024).toFixed(0)} KiB payload`)

  // logout via the API (deletes the session row), then sweep buckets + the
  // probe's own login audit rows (ActivityLog) so counts return to baseline.
  const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  console.log(`logout: HTTP ${logoutRes.status}`)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await query(`DELETE FROM "Session" WHERE "tokenHash" = $1`, [tokenHash])
  await query(`DELETE FROM "RateLimitBucket" WHERE "key" IN ($1, $2)`, [
    `rl:login:acct:${TEACHER_EMAIL.toLowerCase()}`,
    `rl:login:ip:${probeIp}`,
  ])
  const { rows: teacherRows } = await query(`SELECT id FROM "User" WHERE email = $1`, [TEACHER_EMAIL])
  const teacherId = String(teacherRows[0]?.id ?? '')
  const { rows: sweptAudit } = await query(
    `DELETE FROM "ActivityLog" WHERE "userId" = $1 AND "createdAt" >= $2::timestamp RETURNING id`,
    [teacherId, new Date(startedAt).toISOString()],
  )
  console.log(`probe session + rate-limit buckets + ${sweptAudit.length} login audit row(s) swept`)
  // NOTE: teacher1's User.lastLoginAt is updated by the real login — a
  // legitimate operational side effect (same as any user login), not residue;
  // row counts are unaffected.

  // ══ Phase D: cleanup + residue proof ════════════════════════════════
  console.log('\n── (d) cleanup: cascade-delete the throwaway school, verify zero residue ──')
  const tDel0 = Date.now()
  await prisma.school.delete({ where: { id: probeSchoolId } })
  const deleteMs = Date.now() - tDel0
  console.log(`cascade delete (school + users + students + attendance + classes): ${ms(deleteMs)}`)
  await prisma.$disconnect()

  const failures: string[] = []
  const { rows: cols } = await query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'schoolId' GROUP BY 1 ORDER BY 1`,
  )
  for (const c of cols) {
    const t = String(c.table_name)
    const { rows } = await query(`SELECT count(*)::int AS c FROM "public"."${t}" WHERE "schoolId" = $1`, [probeSchoolId])
    const n = Number(rows[0]['c'])
    if (n !== 0) failures.push(`${t}: ${n} rows still reference the throwaway school`)
  }
  const { rows: schoolLeft } = await query(`SELECT count(*)::int AS c FROM "public"."School" WHERE "id" = $1`, [probeSchoolId])
  if (Number(schoolLeft[0]['c']) !== 0) failures.push('throwaway School row still exists')

  console.log(`residue sweep: ${cols.length} schoolId-carrying tables checked + School/User cascade + probe session/rate-limit keys swept`)
  for (const t of baselineTables) {
    const { rows } = await query(`SELECT count(*)::int AS c FROM "public"."${t}"`)
    const now = Number(rows[0]['c'])
    const before = baseline.get(t) ?? 0
    const delta = now - before
    // RateLimitBucket is TRANSIENT limiter state: its count legitimately
    // drifts (probe login-bucket hygiene by design + the event-stream
    // sweeper pruning expired rows mid-run). The strict probe-key check
    // below is the real residue assertion for that table.
    const soft = t === 'RateLimitBucket'
    console.log(
      `  ${t.padEnd(18)} baseline ${String(before).padStart(7)} → ${String(now).padStart(7)}  (Δ ${delta >= 0 ? '+' : ''}${delta})${soft && delta !== 0 ? '  [transient state — see probe-key check]' : ''}`,
    )
    if (delta !== 0 && !soft) failures.push(`${t}: count drifted by ${delta} (baseline ${before} → ${now})`)
  }
  const { rows: bucketResidue } = await query(
    `SELECT count(*)::int AS c FROM "public"."RateLimitBucket"
      WHERE "key" = $1 OR "key" = $2`,
    [`rl:login:acct:${TEACHER_EMAIL.toLowerCase()}`, `rl:login:ip:${probeIp}`],
  )
  if (Number(bucketResidue[0]['c']) !== 0) failures.push('probe rate-limit bucket rows still present')
  const { rows: parity } = await query(
    `SELECT (SELECT COALESCE(SUM("amount"), 0) FROM "public"."Payment" WHERE "status" = 'SUCCESS')::text AS pay,
            (SELECT COALESCE(SUM("amount"), 0) FROM "public"."FeeTransaction" WHERE "status" = 'SUCCESS')::text AS txn,
            (SELECT COALESCE(SUM("paid"), 0) FROM "public"."Fee")::text AS fee`,
  )
  const pOk = parity[0]['pay'] === parity[0]['txn'] && parity[0]['txn'] === parity[0]['fee']
  console.log(
    `  money parity after probe: pay=${parity[0]['pay']} txn=${parity[0]['txn']} fee=${parity[0]['fee']} ${pOk ? 'OK' : 'FAIL'}`,
  )
  if (!pOk) failures.push('money parity drifted')

  await client.end()

  console.log('═'.repeat(78))
  console.log(`PERF PROBE DONE in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
  if (failures.length) {
    console.error(`CLEANUP FAILURES (${failures.length}):`)
    for (const f of failures) console.error(`  · ${f}`)
    process.exit(1)
  }
  console.log('CLEANUP VERIFIED — zero residue, baseline counts restored, money parity untouched.')
}

main().catch((e: unknown) => {
  console.error('[db-perf-probe] FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
