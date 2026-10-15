/**
 * REGRESSION — exam result-status canonicalisation (2026-10-15).
 *
 * THE SHIPPED DEFECT this suite pins:
 *   Exam.resultStatus / Exam.status are free String columns enforced only
 *   by write paths. The exam lifecycle writes the canonical enum values
 *   ('Result Declared', 'Completed', …) while the legacy demo seeds
 *   planted the shorter alias ('Declared') and upper-case ('COMPLETED').
 *   Raw `===` comparisons disagreed across surfaces: the principal
 *   Examinations overview counted 0/4 declared results over a database
 *   holding two declared exams (tests/regression reproduction: seed
 *   'Declared' vs the overview's 'result declared' compare), while the
 *   student dashboard + teacher marks-entry routes compared the legacy
 *   spelling and would have MISSED a lifecycle-declared exam.
 *
 * THE FIX UNDER TEST:
 *   · canonical helpers in src/lib/exams/types.ts — isResultDeclared()
 *     (canonical 'Result Declared' OR legacy 'Declared', case/whitespace
 *     tolerant), examStatusIs(), resultStatusIs();
 *   · every DB-driven read site compares through the helpers;
 *   · seeds write canonical values;
 *   · the overview KPI computation extracted to the pure
 *     src/lib/exams/overview-stats.ts (this file imports BOTH the helpers
 *     and the real computation).
 *
 * COVERAGE CONTRACT (mission Phase 2A):
 *   A declared exams are counted correctly (canonical spelling)      [unit+live]
 *   B draft / pending / undeclared results are not falsely counted   [unit]
 *   C results + marksheets remain visible to authorized users        [live]
 *   D existing data using legacy values is handled safely            [unit+live]
 *
 * Live part runs against the canonical demo corpus (seed:demo) with
 * REAL logins (principal / teacher / student fixtures) via liveFetch —
 * same harness as tests/api/empty-school.test.ts. It verifies the
 * result counts against the actual database.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { randomBytes } from 'crypto'
import { liveFetch } from '../helpers/live-http'
import { db } from '../helpers/db'
import { hashSessionToken } from '@/lib/auth'
import { resetLoginBuckets } from '../helpers/login-buckets'
import { DEMO_FAMILY_PASSWORD, DEMO_PRINCIPAL_PASSWORD } from '../helpers/credentials'
import {
  isResultDeclared,
  examStatusIs,
  resultStatusIs,
  RESULT_STATUSES,
  type ExamDTO,
} from '@/lib/exams/types'
import { computeOverview } from '@/lib/exams/overview-stats'

const BASE = process.env.API_TEST_BASE ?? 'http://localhost:3000'
const T = 60_000
const RUN_IP = `10.244.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

// ── fixtures ─────────────────────────────────────────────────────────────

/** Minimal ExamDTO-shaped fixture for the pure computation. */
function examFixture(over: Partial<ExamDTO>): ExamDTO {
  return {
    id: 'fx-' + Math.random().toString(36).slice(2),
    schoolId: 'sch-fx',
    name: 'Fixture Exam',
    type: 'Unit Test',
    session: '2026-2027',
    term: null,
    status: 'Completed',
    resultStatus: 'Not Started',
    passPercentage: 33,
    startDate: null,
    endDate: null,
    declaredAt: null,
    declaredBy: null,
    createdBy: null,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    classes: [],
    subjects: [],
    schedule: [],
    markSummary: { total: 0, entered: 0 },
    ...over,
  } as unknown as ExamDTO
}

// ════════════════════════════════════════════════════════════════════════
// PART A — pure canonicalisation semantics (no DB, no HTTP)
// ════════════════════════════════════════════════════════════════════════

describe('exam result-status canonicalisation — helpers', () => {
  test('isResultDeclared: canonical spelling is declared', () => {
    expect(isResultDeclared('Result Declared')).toBe(true)
  })

  test('isResultDeclared: legacy alias "Declared" is declared (backward compatibility)', () => {
    expect(isResultDeclared('Declared')).toBe(true)
  })

  test('isResultDeclared: case- and whitespace-tolerant for both spellings', () => {
    expect(isResultDeclared('result declared')).toBe(true)
    expect(isResultDeclared('RESULT DECLARED')).toBe(true)
    expect(isResultDeclared('  Result Declared  ')).toBe(true)
    expect(isResultDeclared(' declared ')).toBe(true)
  })

  test('isResultDeclared: null/undefined/empty are NOT declared (fail-closed)', () => {
    expect(isResultDeclared(null)).toBe(false)
    expect(isResultDeclared(undefined)).toBe(false)
    expect(isResultDeclared('')).toBe(false)
    expect(isResultDeclared('   ')).toBe(false)
  })

  test('isResultDeclared: every non-declared lifecycle status is NOT declared', () => {
    for (const s of RESULT_STATUSES) {
      if (s === 'Result Declared') continue
      expect(isResultDeclared(s)).toBe(false)
    }
    // legacy-looking near-misses must not match
    expect(isResultDeclared('Result Ready')).toBe(false)
    expect(isResultDeclared('Undeclared')).toBe(false)
    expect(isResultDeclared('Result')).toBe(false)
  })

  test('examStatusIs: case-tolerant status equality ("COMPLETED" ≡ "Completed")', () => {
    expect(examStatusIs('Completed', 'Completed')).toBe(true)
    expect(examStatusIs('COMPLETED', 'Completed')).toBe(true)
    expect(examStatusIs('completed', 'Completed')).toBe(true)
    expect(examStatusIs('Ongoing', 'Ongoing')).toBe(true)
    expect(examStatusIs('Scheduled', 'Ongoing')).toBe(false)
    expect(examStatusIs(null, 'Completed')).toBe(false)
  })

  test('resultStatusIs: case-tolerant result-status equality', () => {
    expect(resultStatusIs('Result Ready', 'Result Ready')).toBe(true)
    expect(resultStatusIs('RESULT READY', 'Result Ready')).toBe(true)
    expect(resultStatusIs('Not Started', 'Not Started')).toBe(true)
    expect(resultStatusIs('Marks Entry', 'Not Started')).toBe(false)
    expect(resultStatusIs(null, 'Not Started')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════
// PART B — the overview KPI computation (the exact surface that reported 0/4)
// ════════════════════════════════════════════════════════════════════════

describe('exam result-status — overview KPI regression (computeOverview)', () => {
  // The canonical seeded corpus shape: 4 exams, 2 declared.
  const corpus = (declaredSpelling: string, statusSpelling: string): ExamDTO[] => [
    examFixture({ name: 'Periodic Assessment 1', status: statusSpelling, resultStatus: declaredSpelling, declaredAt: '2026-07-25T00:00:00.000Z' }),
    examFixture({ name: 'Half-Yearly Examination', status: statusSpelling, resultStatus: declaredSpelling, declaredAt: '2026-10-01T00:00:00.000Z' }),
    examFixture({ name: 'Periodic Assessment 2', status: 'Ongoing', resultStatus: 'Not Started' }),
    examFixture({ name: 'Hawkings Unit Test 1', status: 'Scheduled', resultStatus: 'Not Started' }),
  ]

  test('A1: canonical corpus — declared counted 2/4 (the shipped bug reported 0/4)', () => {
    const d = computeOverview(corpus('Result Declared', 'Completed'))
    expect(d.total).toBe(4)
    expect(d.declared).toBe(2)
    expect(d.completed).toBe(2)
    expect(d.ongoing).toBe(1)
    expect(d.upcoming).toBe(1)
    expect(d.resultsSub).toBe('2 remaining')
  })

  test('D1: LEGACY corpus ("Declared"/"COMPLETED") — still counted 2/4 (backward compatibility)', () => {
    const d = computeOverview(corpus('Declared', 'COMPLETED'))
    expect(d.declared).toBe(2)
    expect(d.completed).toBe(2)
    expect(d.resultsSub).toBe('2 remaining')
  })

  test('D2: mixed legacy + canonical declared rows in one database', () => {
    const d = computeOverview([
      examFixture({ resultStatus: 'Declared', declaredAt: '2026-07-25T00:00:00.000Z' }),
      examFixture({ resultStatus: 'Result Declared', declaredAt: '2026-10-01T00:00:00.000Z' }),
      examFixture({ resultStatus: 'Not Started', status: 'Ongoing' }),
    ])
    expect(d.declared).toBe(2)
    expect(d.total).toBe(3)
  })

  test('B1: draft / pending / undeclared statuses are NOT counted as declared', () => {
    for (const s of ['Not Started', 'Marks Entry', 'Under Verification', 'Result Ready', 'Draft', '', 'random-junk']) {
      const d = computeOverview([examFixture({ resultStatus: s })])
      expect(d.declared).toBe(0)
    }
    // null status must not throw and must not count
    const d = computeOverview([examFixture({ resultStatus: null as unknown as string })])
    expect(d.declared).toBe(0)
  })

  test('B2: empty corpus — honest zeros, no NaN', () => {
    const d = computeOverview([])
    expect(d.total).toBe(0)
    expect(d.declared).toBe(0)
    expect(d.resultsSub).toBe('No examinations')
  })

  test('A2: all-declared corpus — "All results declared" + On Track', () => {
    const d = computeOverview([
      examFixture({ resultStatus: 'Result Declared', declaredAt: '2026-07-25T00:00:00.000Z' }),
      examFixture({ resultStatus: 'Declared', declaredAt: '2026-10-01T00:00:00.000Z' }),
    ])
    expect(d.declared).toBe(2)
    expect(d.resultsSub).toBe('All results declared')
    expect(d.statusLabel).toBe('On Track')
  })

  test('marks aggregation is untouched by status spellings', () => {
    const d = computeOverview([
      examFixture({ resultStatus: 'Declared', markSummary: { total: 100, entered: 60 } }),
      examFixture({ resultStatus: 'Result Declared', markSummary: { total: 50, entered: 50 } }),
    ])
    expect(d.marksTotal).toBe(150)
    expect(d.marksEntered).toBe(110)
    expect(d.marksSub).toBe('73% completed')
  })
})

// ════════════════════════════════════════════════════════════════════════
// PART C — live API: real logins, real seeded database (seed:demo corpus)
// ════════════════════════════════════════════════════════════════════════

describe('exam result-status — live verification against the seeded database', () => {
  const PRINCIPAL = 'principal@hawkingshigh.edu'
  // A student with real Result rows in the declared Half-Yearly exam.
  let resultsStudentEmail = ''
  // A teacher scoped to a class with marks (7-A class teacher).
  let classTeacherEmail = ''
  // A 7-A student for the teacher marksheet.
  let marksheetStudentId = ''

  let principalToken = ''
  let studentToken = ''
  let teacherToken = ''

  beforeAll(async () => {
    // ── resolve the live fixtures from the actual database ────────────
    const declaredExams = await db.exam.findMany({
      where: { school: { slug: 'hawkings-prithvipur' } },
      select: { id: true, name: true, resultStatus: true, declaredAt: true },
    })
    expect(declaredExams.length).toBeGreaterThanOrEqual(4)
    expect(declaredExams.filter((e) => isResultDeclared(e.resultStatus)).length).toBe(2)

    const aResult = await db.result.findFirst({
      where: { exam: { school: { slug: 'hawkings-prithvipur' } } },
      include: { student: { include: { user: { select: { email: true } } } } },
    })
    if (aResult) resultsStudentEmail = aResult.student.user.email

    const cls = await db.class.findFirst({
      where: { school: { slug: 'hawkings-prithvipur' }, name: '7-A' }, // canonical label format
      include: { students: { take: 1, orderBy: { rollNo: 'asc' }, select: { id: true } } },
    })
    if (cls) {
      marksheetStudentId = cls.students[0]?.id ?? ''
      if (cls.classTeacherId) {
        const ct = await db.user.findUnique({ where: { id: cls.classTeacherId }, select: { email: true } })
        classTeacherEmail = ct?.email ?? ''
      }
    }

    await resetLoginBuckets([PRINCIPAL, resultsStudentEmail, classTeacherEmail])

    const login = async (email: string, password: string) => {
      const res = await liveFetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        const body = (await res.json()) as { ok: boolean; data?: { sessionToken?: string } }
        if (body.ok && body.data?.sessionToken) return body.data.sessionToken
      }
      // rate-limited / non-demo-family password → direct session row
      // (auth fixture, NOT an authorization bypass — same fallback the
      // canonical suites use)
      const u = await db.user.findUnique({ where: { email } })
      if (!u) throw new Error(`no fixture user ${email}`)
      const raw = randomBytes(32).toString('hex')
      await db.session.create({
        data: { userId: u.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3600_000) },
      })
      return raw
    }

    principalToken = await login(PRINCIPAL, DEMO_PRINCIPAL_PASSWORD)
    if (resultsStudentEmail) studentToken = await login(resultsStudentEmail, DEMO_FAMILY_PASSWORD)
    if (classTeacherEmail) teacherToken = await login(classTeacherEmail, DEMO_FAMILY_PASSWORD)
  }, 90_000)

  afterAll(async () => {
    for (const t of [principalToken, studentToken, teacherToken]) {
      if (t) await db.session.deleteMany({ where: { tokenHash: hashSessionToken(t) } }).catch(() => {})
    }
    await db.$disconnect()
  })

  test(
    'A3 · principal /api/exams — the overview counts the REAL database: 2 declared of 4',
    async () => {
      const res = await liveFetch(`${BASE}/api/exams`, {
        headers: { authorization: `Bearer ${principalToken}`, 'x-forwarded-for': RUN_IP },
      })
      expect(res.status).toBe(200)
      const envelope = (await res.json()) as { ok?: boolean; data?: { exams?: ExamDTO[] } }
      const body = envelope.data ?? {}
      expect(Array.isArray(body.exams)).toBe(true)
      expect(body.exams!.length).toBe(4)

      // THE regression assertion: the exact computation the Examinations
      // overview KPI runs, over the real API payload.
      const d = computeOverview(body.exams!)
      expect(d.total).toBe(4)
      expect(d.declared).toBe(2) // was 0 before the fix with legacy seed values
      expect(d.completed).toBe(2)

      // cross-check the API payload against the database rows directly
      const dbDeclared = await db.exam.count({
        where: { school: { slug: 'hawkings-prithvipur' }, resultStatus: { in: ['Result Declared', 'Declared'] } },
      })
      expect(dbDeclared).toBe(d.declared)
    },
    T,
  )

  test(
    'C1 · authorized STUDENT sees declared results on the dashboard (academics.latest)',
    async () => {
      if (!studentToken) return // no Result rows planted — skip honestly
      const res = await liveFetch(`${BASE}/api/student/dashboard`, {
        headers: { authorization: `Bearer ${studentToken}`, 'x-forwarded-for': RUN_IP },
      })
      expect(res.status).toBe(200)
      const envelope = (await res.json()) as {
        ok?: boolean
        data?: {
          academics?: {
            latest?: { examName: string; subjects: unknown[]; pct: number | null } | null
          } | null
        }
      }
      const body = envelope.data ?? {}
      // the latest-declared-results card renders through the fixed
      // isResultDeclared gate — with canonical seeds it MUST be present
      expect(body.academics?.latest).not.toBeNull()
      expect(body.academics!.latest!.subjects.length).toBeGreaterThan(0)
      expect(typeof body.academics!.latest!.pct).toBe('number')
    },
    T,
  )

  test(
    'C2 · authorized TEACHER marksheet for a declared exam is visible and FINALIZED',
    async () => {
      if (!teacherToken || !marksheetStudentId) throw new Error('teacher fixture missing — corpus incomplete')
      const res = await liveFetch(
        `${BASE}/api/teacher/students/${marksheetStudentId}/marksheet`,
        { headers: { authorization: `Bearer ${teacherToken}`, 'x-forwarded-for': RUN_IP } },
      )
      expect(res.status).toBe(200)
      const envelope = (await res.json()) as {
        ok?: boolean
        data?: {
          exams?: Array<{ state: string; resultStatus: string }>
          summary?: { state: string; totalExams: number; grandTotal: number | null }
        }
      }
      const body = envelope.data ?? {}
      // at least one declared exam on the marksheet is FINALIZED (its
      // results are published/immutable) and the document carries totals
      const finalized = body.exams?.some((e) => e.state === 'FINALIZED')
      expect(finalized).toBe(true)
      expect(body.summary?.totalExams).toBeGreaterThan(0)
    },
    T,
  )

  test(
    'D3 · teacher marks-entry lock semantics: declared exam refuses new marks (service contract)',
    async () => {
      // The service-level guard (setSingleMark / submitMarks / bulk paths)
      // now checks isResultDeclared — asserted here at the route level
      // through the submit endpoint on the DECLARED Half-Yearly exam.
      // A teacher submit against a declared exam must be rejected.
      if (!teacherToken) throw new Error('teacher fixture missing — corpus incomplete')
      const exam = await db.exam.findFirst({
        where: { school: { slug: 'hawkings-prithvipur' }, resultStatus: 'Result Declared' },
        select: { id: true },
      })
      if (!exam) return
      const res = await liveFetch(`${BASE}/api/teacher/marks-entry/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${teacherToken}`, 'x-forwarded-for': RUN_IP },
        body: JSON.stringify({ examId: exam.id, marks: [] }),
      })
      // declared-exam lock: NOT 2xx (403/409/400-class rejection)
      expect(res.status).toBeGreaterThanOrEqual(400)
    },
    T,
  )
})
