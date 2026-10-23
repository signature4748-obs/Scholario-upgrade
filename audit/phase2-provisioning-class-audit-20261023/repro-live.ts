// PHASE 2/9 — Level-2 live-API reproduction (PRE-FIX), isolated test tenants.
//
// Provisions uniquely-named throwaway schools through the REAL API
// (POST /api/platform/schools — the wizard's wire path) on the LOCAL
// test database, then reads the roster the school plane would receive
// (GET /api/students/roster, principal session minted as an auth
// FIXTURE per the repo's established test convention — the fixture
// bypasses only the login door, not any authorization gate) and runs
// the repo's own mapper over the real payload.
//
// SAFETY:
//   · LOCAL embedded PG only (source scripts/dev-env.sh first).
//   · Every school created here is named `Wizard Academy P2 *` and
//     fully purged in teardown (the wizard-suite purgeSchool pattern).
//   · The demo tenants (Hawkings/Green Valley) are only ever READ.
//   · No production endpoint, credential or secret is touched.
//
// Run: source scripts/dev-env.sh && bun run audit/phase2-provisioning-class-audit-20261023/repro-live.ts

import { randomBytes, createHash } from 'crypto'
import { db } from '../../tests/helpers/db'
import { hashSessionToken } from '../../src/lib/auth'
import { mapRosterToRecords } from '../../src/lib/store/students-store/server-sync'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const MARKER = randomBytes(4).toString('hex')

const mintedSessions: string[] = []
const createdSchools: string[] = []

async function steppedUpRoot(): Promise<string> {
  const admin = await db.platformAdmin.findUnique({ where: { email: 'admin@scholario.cloud' } })
  if (!admin) throw new Error('root platform admin missing — run seed-platform')
  const raw = randomBytes(32).toString('hex')
  await db.platformAdminSession.create({
    data: {
      adminId: admin.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  mintedSessions.push(raw)
  return raw
}

async function platform(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-platform-token': token, ...(init.headers ?? {}) },
  })
}

async function schoolApi(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
}

async function dataOf(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as { ok: boolean; data: Record<string, unknown> }
  if (!json.ok) throw new Error(`envelope not ok (${res.status})`)
  return json.data
}

function wizardPayload(overrides: Record<string, unknown> = {}) {
  const suffix = `P2-${MARKER}-${randomBytes(3).toString('hex')}`
  return {
    name: `Wizard Academy ${suffix}`,
    slug: `wizard-${suffix.toLowerCase()}`,
    principalName: 'P2 Principal',
    principalEmail: `principal-${suffix.toLowerCase()}@wizard.test`,
    ...overrides,
  }
}

const PRESET_1_12 = Array.from({ length: 12 }, (_, i) => ({ name: `Class ${i + 1}`, sections: ['A'] }))

/** Mint a school session for the founding principal (auth fixture only). */
async function principalSession(schoolId: string): Promise<string> {
  const principal = await db.user.findFirst({
    where: { schoolId, role: 'PRINCIPAL' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, mustChangePassword: true },
  })
  if (!principal) throw new Error('no principal found for test school')
  const raw = randomBytes(32).toString('hex')
  await db.session.create({
    data: { userId: principal.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
  })
  mintedSessions.push(raw)
  return raw
}

/** Complete the forced first-password change (the real M2-01 flow), then
 *  LOG IN through the real door with the new password (the change revokes
 *  the bootstrap session — the honest security behavior) and return the
 *  fresh session token from the login response. */
async function principalSessionViaLogin(schoolId: string, tempPassword: string): Promise<string> {
  // Step 1 — forced change on a minted (auth-fixture) session.
  const fixture = await principalSession(schoolId)
  const pw = 'P2Audit-' + randomBytes(6).toString('hex') + '!9'
  const res = await schoolApi(fixture, '/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: tempPassword, newPassword: pw, confirmPassword: pw }),
  })
  console.log(`forced password change → HTTP ${res.status}`)
  if (!res.ok) throw new Error(`change-password failed: ${await res.text()}`)

  // Step 2 — real login with the principal's own new password.
  const principal = await db.user.findFirst({
    where: { schoolId, role: 'PRINCIPAL' },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  })
  if (!principal) throw new Error('no principal found for test school')
  const login = await schoolApi('', '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: principal.email, password: pw }),
  })
  const body = (await login.json()) as { ok: boolean; data?: { sessionToken?: string } }
  console.log(`principal login (own password) → HTTP ${login.status} token=${body.data?.sessionToken ? 'granted' : 'absent'}`)
  if (!login.ok || !body.data?.sessionToken) throw new Error(`principal login failed: ${JSON.stringify(body)}`)
  mintedSessions.push(body.data.sessionToken)
  return body.data.sessionToken
}

/** Print the grouped classes the school plane would render for a live roster. */
async function renderRoster(label: string, token: string) {
  const res = await schoolApi(token, '/api/students/roster')
  const payload = (await dataOf(res)) as { classes: unknown[] }
  const { classes: grouped } = mapRosterToRecords(payload as never)
  console.log(`\n[${label}] roster rows: ${payload.classes.length} → grouped ClassRecords: ${grouped.length}`)
  for (const g of grouped)
    console.log(
      `  → id=${g.id} name=${JSON.stringify(g.name)} grade=${g.grade} level=${JSON.stringify(g.level)} sections=[${g.sections
        .map((s) => s.name)
        .join(', ')}]`,
    )
  return { roster: payload.classes, grouped }
}

async function dbDump(label: string, schoolId: string) {
  const rows = await db.class.findMany({
    where: { schoolId },
    orderBy: { createdAt: 'asc' },
    select: { name: true, gradeLevel: true, section: true },
  })
  console.log(`\n[${label}] persisted Class rows (${rows.length}):`)
  for (const r of rows) console.log(`  name=${JSON.stringify(r.name)} gradeLevel=${JSON.stringify(r.gradeLevel)} section=${JSON.stringify(r.section)}`)
  return rows
}

async function purgeSchool(schoolId: string) {
  if (!schoolId) return
  await db.session.deleteMany({ where: { user: { schoolId } } })
  await db.user.deleteMany({ where: { schoolId } })
  await db.platformAuditLog.deleteMany({ where: { schoolId } })
  await db.school.delete({ where: { id: schoolId } }).catch(() => {})
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
  const root = await steppedUpRoot()
  console.log(`Phase-2 live repro marker: ${MARKER} (all tenants below are throwaway)`)

  // ══ CASE A — wizard preset Class 1–12 × section A (production shape) ══
  const payloadA = wizardPayload({ classes: PRESET_1_12 })
  const resA = await platform(root, '/api/platform/schools', { method: 'POST', body: JSON.stringify(payloadA) })
  console.log(`\n=== CASE A: provision Class 1–12 × A → HTTP ${resA.status} ===`)
  if (resA.status !== 200) throw new Error(`provision A failed: ${await resA.text()}`)
  const dataA = (await dataOf(resA)) as {
    school: { id: string; name: string; slug: string; status: string }
    bootstrap?: { classes: number; sections: number }
    tempPassword?: string
  }
  createdSchools.push(dataA.school.id)
  console.log(`school=${dataA.school.name} slug=${dataA.school.slug} status=${dataA.school.status}`)
  console.log(`bootstrap=${JSON.stringify(dataA.bootstrap)} (expected {classes:12, sections:12})`)
  const rowsA = await dbDump('CASE A DB', dataA.school.id)
  const nullGrades = rowsA.filter((r) => r.gradeLevel === null).length
  console.log(`gradeLevel NULL on ${nullGrades}/${rowsA.length} rows`)

  // ══ CASE H — idempotent replay: re-submit the SAME payload ══
  const resH = await platform(root, '/api/platform/schools', { method: 'POST', body: JSON.stringify(payloadA) })
  const bodyH = (await resH.json()) as { ok: boolean; data?: { replayed?: boolean; school?: { id: string } } }
  console.log(`\n=== CASE H: repeat submit → HTTP ${resH.status} replayed=${bodyH.data?.replayed} sameId=${bodyH.data?.school?.id === dataA.school.id} ===`)
  const rowsH = await db.class.count({ where: { schoolId: dataA.school.id } })
  console.log(`Class rows after replay: ${rowsH} (must remain 12 — no duplicates)`)

  // Activate the tenant (its own dedicated activation action) so the
  // principal's roster call walks the real active-tenant path.
  const resAct = await platform(root, `/api/platform/schools/${dataA.school.id}/activate`, { method: 'POST' })
  console.log(`\nactivate → HTTP ${resAct.status}`)

  // Roster as the founding principal → the exact school-plane payload.
  const principalA = await principalSessionViaLogin(dataA.school.id, dataA.tempPassword ?? '')
  const renderA = await renderRoster('CASE A roster (principal)', principalA)

  // ══ CASE J / I1 — school-plane POST /api/classes on the same tenant ══
  const resJ = await schoolApi(principalA, '/api/classes', {
    method: 'POST',
    body: JSON.stringify({ name: 'Class 6-J', gradeLevel: '6', section: 'J', capacity: 35 }),
  })
  console.log(`\n=== CASE J: POST /api/classes gradeLevel "6" → HTTP ${resJ.status} ===`)
  const resI1 = await schoolApi(principalA, '/api/classes', {
    method: 'POST',
    body: JSON.stringify({ name: 'Class 7-I', section: 'I', capacity: 35 }), // gradeLevel OMITTED
  })
  console.log(`=== CASE I1: POST /api/classes gradeLevel omitted → HTTP ${resI1.status} ===`)
  const rowI1 = await db.class.findFirst({ where: { schoolId: dataA.school.id, name: 'Class 7-I' }, select: { gradeLevel: true } })
  console.log(`persisted gradeLevel for the omitted row: ${JSON.stringify(rowI1?.gradeLevel)}`)
  const renderAJ = await renderRoster('CASE A+J+I1 roster', principalA)
  const grade6 = renderAJ.grouped.find((g) => g.grade === 6)
  const grade0 = renderAJ.grouped.find((g) => g.grade === 0)
  console.log(`groups: total=${renderAJ.grouped.length} · grade-6 group=${JSON.stringify(grade6?.name)} · grade-0 group=${JSON.stringify(grade0?.name)} sections=${grade0?.sections.length}`)

  // ══ CASE C+D+E — multi-section, pre-primary, subset presets (one tenant) ══
  const payloadCDE = wizardPayload({
    classes: [
      { name: 'Class 5', sections: ['A', 'B', 'C'] },
      { name: 'Nursery', sections: ['A'] },
      { name: 'LKG', sections: ['A'] },
      { name: 'UKG', sections: ['A'] },
      { name: 'Class 9', sections: ['A'] },
      { name: 'Class 10', sections: ['A'] },
    ],
  })
  const resCDE = await platform(root, '/api/platform/schools', { method: 'POST', body: JSON.stringify(payloadCDE) })
  console.log(`\n=== CASE C+D+E: multi-section + pre-primary + 9–10 → HTTP ${resCDE.status} ===`)
  const dataCDE = (await dataOf(resCDE)) as { school: { id: string }; bootstrap?: { classes: number; sections: number }; tempPassword?: string }
  createdSchools.push(dataCDE.school.id)
  console.log(`bootstrap=${JSON.stringify(dataCDE.bootstrap)} (expected {classes:6, sections:8})`)
  await dbDump('CASE C+D+E DB', dataCDE.school.id)
  await platform(root, `/api/platform/schools/${dataCDE.school.id}/activate`, { method: 'POST' })
  const principalCDE = await principalSessionViaLogin(dataCDE.school.id, dataCDE.tempPassword ?? '')
  await renderRoster('CASE C+D+E roster', principalCDE)

  // ══ CASE F+G — no classes / empty section list (one tenant) ══
  const payloadFG = wizardPayload({ classes: [{ name: 'Class 3', sections: [] }] })
  const resFG = await platform(root, '/api/platform/schools', { method: 'POST', body: JSON.stringify(payloadFG) })
  console.log(`\n=== CASE F+G: one class, EMPTY sections list → HTTP ${resFG.status} ===`)
  const dataFG = (await dataOf(resFG)) as { school: { id: string }; bootstrap?: { classes: number; sections: number }; tempPassword?: string }
  createdSchools.push(dataFG.school.id)
  console.log(`bootstrap=${JSON.stringify(dataFG.bootstrap)}`)
  await dbDump('CASE F+G DB', dataFG.school.id)
  await platform(root, `/api/platform/schools/${dataFG.school.id}/activate`, { method: 'POST' })
  const principalFG = await principalSessionViaLogin(dataFG.school.id, dataFG.tempPassword ?? '')
  await renderRoster('CASE F+G roster', principalFG)

  // Whitespace section string: the zod safeText must refuse it server-side.
  const resWS = await platform(root, '/api/platform/schools', {
    method: 'POST',
    body: JSON.stringify(wizardPayload({ classes: [{ name: 'Class 4', sections: ['  '] }] })),
  })
  console.log(`\n=== CASE G2: whitespace-only section string → HTTP ${resWS.status} (expect 422 refusal) ===`)

  // ══ CASE K — demo-tenant naming (READ-ONLY, Hawkings corpus) ══
  const hawkings = await db.school.findUnique({ where: { slug: 'hawkings-prithvipur' }, select: { id: true } })
  if (hawkings) {
    const rowsK = await db.class.findMany({
      where: { schoolId: hawkings.id },
      orderBy: [{ gradeLevel: 'asc' }, { section: 'asc' }],
      select: { id: true, name: true, gradeLevel: true, section: true, stream: true, capacity: true, room: true, classTeacherId: true },
    })
    const counts = await db.class.aggregate({ where: { schoolId: hawkings.id }, _count: true })
    const rosterK = rowsK.map((r) => ({
      ...r,
      studentCount: 0,
      subjectIds: [],
      subjectTeachers: {},
    }))
    const { classes: groupedK } = mapRosterToRecords({ classes: rosterK, subjects: [], teachers: [], students: [] } as never)
    console.log(`\n=== CASE K: Hawkings demo (READ-ONLY) — ${counts._count} rows → ${groupedK.length} groups ===`)
    for (const g of groupedK)
      console.log(`  → id=${g.id} name=${JSON.stringify(g.name)} grade=${g.grade} sections=[${g.sections.map((s) => s.name).join(', ')}]`)
  }

  console.log('\n— repro summary (see evidence filename for pre/post-fix) —')
  console.log(`CASE A grouped count: ${renderA.grouped.length} (expected 12; D1 if 1 "Grade 0")`)
  const aZero = renderA.grouped[0]
  console.log(`CASE A first group: ${JSON.stringify({ id: aZero?.id, name: aZero?.name, sections: aZero?.sections.length })}`)
  console.log(`CASE A+J grouped: grade0=${grade0?.name} (${grade0?.sections.length} sections) — the Add-Class '' path joins the same defect`)
}

main()
  .catch((e) => {
    console.error('REPRO FAILED:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    // Teardown — purge ONLY this run's throwaway tenants + fixtures.
    for (const id of createdSchools) await purgeSchool(id)
    for (const raw of mintedSessions)
      await db.platformAdminSession
        .deleteMany({ where: { tokenHash: createHash('sha256').update(raw).digest('hex') } })
        .catch(() => {})
    const strays = await db.school.findMany({ where: { name: { contains: `Wizard Academy P2-${MARKER}` } }, select: { id: true } })
    for (const s of strays) await purgeSchool(s.id)
    const remaining = await db.school.count()
    console.log(`\nteardown: purged ${createdSchools.length} test tenants (+${strays.length} strays); school count back to ${remaining}`)
    await db.$disconnect()
  })
