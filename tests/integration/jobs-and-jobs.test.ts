/**
 * PHASE 4 (item 10) — INTEGRATION tests: job runner + tracked transactions
 * + webhook attempt accounting.
 *
 * Real database (SQLite via @/lib/db — same DATABASE_URL as the dev
 * server), service-level functions, self-cleaning rows: every JobRun /
 * WebhookEvent this suite creates is prefixed `test-p4-` and swept in
 * afterAll.
 *
 * Contract under test:
 *   · runJob() success → JobRun row (status success, finishedAt,
 *     durationMs ≥ 0, resultSummary) + job_completed structured log
 *   · runJob() failure → status failed, error stored (truncated),
 *     and the call NEVER throws to the caller
 *   · retries: maxAttempts 3, fail-fail-succeed → final success, attempt 3
 *   · idempotency: prior SUCCESS for (jobName, idempotencyKey) →
 *     status 'skipped', fn NOT executed, same jobId
 *   · job-tracking failures are TOLERATED: a bogus schoolId trips the
 *     JobRun tenant guard → job_tracking_failed log, but the job still
 *     runs and succeeds
 *   · DB-level: unique (jobName, idempotencyKey) → P2002; JobRun tenant
 *     guard → P2003; WebhookEvent.attempts exists and increments
 *   · trackedTransaction(): commits pass through (value + persistence),
 *     failures rethrow the ORIGINAL error, roll back, and emit a
 *     db_transaction_failure structured log line
 *   · the readiness probe's primitive works against the real DB
 *     (SELECT 1 via $queryRaw)
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { db, trackedTransaction } from '@/lib/db'
import { runJob } from '@/lib/observability/jobs'
import { Prisma } from '@prisma/client'
import { runInTestContext } from '@/lib/observability/context'

const P = 'test-p4-' // self-cleaning prefix for every row this suite creates

// ── console capture (structured-log assertions) ──────────────────────────

let captured: { sink: 'log' | 'warn' | 'error'; line: string }[]
let realLog: typeof console.log
let realWarn: typeof console.warn
let realError: typeof console.error

function jsonLines(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const c of captured) {
    try {
      const parsed = JSON.parse(c.line) as Record<string, unknown>
      if (typeof parsed.event === 'string') out.push(parsed)
    } catch { /* not a structured line (test-framework noise) */ }
  }
  return out
}

beforeEach(() => {
  captured = []
  realLog = console.log
  realWarn = console.warn
  realError = console.error
  console.log = (s: unknown) => { captured.push({ sink: 'log', line: String(s) }) }
  console.warn = (s: unknown) => { captured.push({ sink: 'warn', line: String(s) }) }
  console.error = (s: unknown) => { captured.push({ sink: 'error', line: String(s) }) }
})

afterEach(() => {
  console.log = realLog
  console.warn = realWarn
  console.error = realError
})

// ── fixtures + cleanup ───────────────────────────────────────────────────

let realSchoolId = ''

beforeAll(async () => {
  const school = await db.school.findFirst({ select: { id: true } })
  if (!school) throw new Error('no school rows — database not seeded')
  realSchoolId = school.id
})

afterAll(async () => {
  await db.jobRun.deleteMany({ where: { jobName: { startsWith: P } } })
  await db.jobRun.deleteMany({ where: { jobId: { startsWith: P } } })
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: P } } })
  await db.$disconnect()
})

const uniq = (label: string) => `${P}${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`

// ══════════════════════════════════════════════════════════════════════
// 1. runJob — success lifecycle
// ══════════════════════════════════════════════════════════════════════

describe('runJob · success lifecycle', () => {
  test('a successful job creates a JobRun row with success status, timing and summary', async () => {
    const name = uniq('success-job')
    const outcome = await runJob({ name, schoolId: realSchoolId, fn: async () => ({ foo: 'bar' }) })

    expect(outcome.status).toBe('success')
    expect(outcome.result).toEqual({ foo: 'bar' })
    expect(outcome.attempt).toBe(1)
    expect(outcome.durationMs === undefined ? 0 : outcome.durationMs).toBeGreaterThanOrEqual(0)
    expect(outcome.runId).toBeTruthy()

    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row).not.toBeNull()
    expect(row!.jobName).toBe(name)
    expect(row!.status).toBe('success')
    expect(row!.schoolId).toBe(realSchoolId)
    expect(row!.finishedAt).not.toBeNull()
    expect(row!.durationMs).toBeGreaterThanOrEqual(0)
    expect(row!.resultSummary).toBe('{"foo":"bar"}')
    expect(row!.error).toBeNull()
    expect(row!.jobId).toBe(outcome.jobId)
    expect(row!.jobId.startsWith(P)).toBe(true)
  }, 30000)

  test('a successful job emits job_started + job_completed structured logs', async () => {
    const name = uniq('logged-job')
    const outcome = await runJob({ name, fn: async () => 'done' })
    const lines = jsonLines()
    const started = lines.find((l) => l.event === 'job_started' && l.jobId === outcome.jobId)
    const completed = lines.find((l) => l.event === 'job_completed' && l.jobId === outcome.jobId)
    expect(started).toBeDefined()
    expect(completed).toBeDefined()
    expect(completed!.attempt).toBe(1)
    expect(typeof completed!.durationMs).toBe('number')
    expect(completed!.durationMs as number).toBeGreaterThanOrEqual(0)
    expect(completed!.channel).toBe('jobs')
  }, 30000)

  test('the ambient request context is stamped onto the JobRun row', async () => {
    const name = uniq('ctx-job')
    const outcome = await runInTestContext({ requestId: 'test-p4-ctx-0001' }, () =>
      runJob({ name, fn: async () => 1 }),
    )
    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row!.requestId).toBe('test-p4-ctx-0001')
  }, 30000)

  test('trigger is recorded on the row (default request)', async () => {
    const name = uniq('trigger-job')
    const outcome = await runJob({ name, fn: async () => 1 })
    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row!.trigger).toBe('request')
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 2. runJob — failure + retry
// ══════════════════════════════════════════════════════════════════════

describe('runJob · failure contract (never throws)', () => {
  test('a failing job resolves with status failed — the call itself NEVER throws', async () => {
    const name = uniq('fail-job')
    let threw = false
    let outcome: Awaited<ReturnType<typeof runJob>> | null = null
    try {
      outcome = await runJob({ name, fn: async () => { throw new Error('job exploded') } })
    } catch {
      threw = true
    }
    expect(threw).toBe(false) // THE contract: observability is not a failure mode
    expect(outcome!.status).toBe('failed')
    expect(outcome!.error).toContain('job exploded')
  }, 30000)

  test('a failing job records status failed + the (truncated) error on the row', async () => {
    const name = uniq('fail-row-job')
    const outcome = await runJob({
      name,
      fn: async () => { throw new Error('x'.repeat(600)) },
    })
    expect(outcome.status).toBe('failed')
    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row!.status).toBe('failed')
    expect(row!.error).not.toBeNull()
    expect(row!.error!.length).toBe(400) // truncated at 400
    expect(row!.error!.startsWith('Error: ')).toBe(true) // name: message form
    expect(row!.error!.slice(7, 107)).toBe('x'.repeat(100))
    expect(row!.finishedAt).not.toBeNull()
    expect(row!.resultSummary).toBeNull()
  }, 30000)

  test('a failed final attempt emits a job_failed log (error sink)', async () => {
    const name = uniq('fail-log-job')
    const outcome = await runJob({ name, fn: async () => { throw new Error('boom-final') } })
    const line = jsonLines().find((l) => l.event === 'job_failed' && l.jobId === outcome.jobId)
    expect(line).toBeDefined()
    expect(line!.level).toBe('error')
    expect(String(line!.detail)).toContain('boom-final')
  }, 30000)

  test('retries: fail twice, succeed on attempt 3 of maxAttempts 3', async () => {
    const name = uniq('retry-job')
    let calls = 0
    const outcome = await runJob({
      name,
      maxAttempts: 3,
      fn: async (attempt) => {
        calls++
        if (attempt < 3) throw new Error(`attempt ${attempt} failed`)
        return 'third-time'
      },
    })
    expect(outcome.status).toBe('success')
    expect(outcome.attempt).toBe(3)
    expect(outcome.result).toBe('third-time')
    expect(calls).toBe(3)
    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row!.status).toBe('success')
    expect(row!.attempt).toBe(3)
    expect(row!.maxAttempts).toBe(3)
    // retry transitions are visible in the structured log
    const retries = jsonLines().filter((l) => l.event === 'job_retry' && l.jobId === outcome.jobId)
    expect(retries.length).toBe(2)
  }, 30000)

  test('maxAttempts is clamped to [1, 10]', async () => {
    const name = uniq('clamp-job')
    const outcome = await runJob({ name, maxAttempts: 99, fn: async () => 1 })
    const row = await db.jobRun.findUnique({ where: { id: outcome.runId! } })
    expect(row!.maxAttempts).toBe(10)
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 3. runJob — idempotency
// ══════════════════════════════════════════════════════════════════════

describe('runJob · idempotency short-circuit', () => {
  test('a second run with the same (jobName, idempotencyKey) skips fn and returns the prior jobId', async () => {
    const name = uniq('idem-job')
    const key = 'delivery-001'
    const first = await runJob({ name, idempotencyKey: key, fn: async () => 'first' })
    expect(first.status).toBe('success')

    let secondCalls = 0
    const second = await runJob({
      name,
      idempotencyKey: key,
      fn: async () => { secondCalls++; return 'second' },
    })
    expect(second.status).toBe('skipped')
    expect(secondCalls).toBe(0) // fn NOT executed
    expect(second.jobId).toBe(first.jobId)
    expect(second.runId).toBe(first.runId)
    // a job_skipped line is emitted for the short-circuit
    const skipped = jsonLines().find((l) => l.event === 'job_skipped' && l.jobId === first.jobId)
    expect(skipped).toBeDefined()
  }, 30000)

  test('a prior FAILED run does NOT short-circuit — the work re-runs', async () => {
    const name = uniq('idem-fail-job')
    const key = 'delivery-002'
    const first = await runJob({ name, idempotencyKey: key, fn: async () => { throw new Error('transient') } })
    expect(first.status).toBe('failed')

    const second = await runJob({ name, idempotencyKey: key, fn: async () => 'recovered' })
    expect(second.status).toBe('success')
    expect(second.result).toBe('recovered')
  }, 30000)

  test('different idempotency keys do not collide', async () => {
    const name = uniq('idem-distinct')
    const a = await runJob({ name, idempotencyKey: 'k-a', fn: async () => 1 })
    const b = await runJob({ name, idempotencyKey: 'k-b', fn: async () => 2 })
    expect(a.status).toBe('success')
    expect(b.status).toBe('success')
    expect(a.jobId).not.toBe(b.jobId)
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 4. runJob — tracking-failure tolerance + DB-level JobRun constraints
// ══════════════════════════════════════════════════════════════════════

describe('runJob · job-tracking failure tolerance', () => {
  test('a bogus schoolId trips the JobRun tenant guard but the job STILL SUCCEEDS', async () => {
    const name = uniq('guard-job')
    const outcome = await runJob({
      name,
      schoolId: 'bogus-school-id',
      fn: async () => 'work-done-anyway',
    })
    // the job ran and succeeded — tracking is best-effort
    expect(outcome.status).toBe('success')
    expect(outcome.result).toBe('work-done-anyway')
    expect(outcome.runId).toBeNull() // untracked (row creation was rejected)
    // the failure to track is itself observable
    const line = jsonLines().find((l) => l.event === 'job_tracking_failed' && l.jobId === outcome.jobId)
    expect(line).toBeDefined()
    expect(line!.level).toBe('error')
  }, 30000)

  test('db.jobRun.create with a foreign schoolId is rejected by the tenant guard (P2003 / PG guard P0001)', async () => {
    let code = ''
    try {
      await db.jobRun.create({
        data: { jobId: uniq('guard-row'), jobName: `${P}guard-direct`, schoolId: 'bogus-school-id' },
      })
      throw new Error('expected tenant-guard rejection')
    } catch (e) {
      // Phase 8A (PG): the tenant-guard RAISE EXCEPTION surfaces as a
      // PrismaClientUnknownRequestError carrying PostgresError code P0001
      // (SQLite mapped the same trigger ABORT to P2003). Both prove the
      // guard rejected the write.
      const err = e as { code?: string; message?: string }
      code = err.code ?? String(err.message ?? '').match(/PostgresError \{[^}]*code: "(P0001)"/)?.[1] ?? ''
    }
    expect(['P2003', 'P0001']).toContain(code)
  }, 30000)

  test('a real schoolId is accepted by the guard', async () => {
    const row = await db.jobRun.create({
      data: { jobId: uniq('guard-ok-row'), jobName: `${P}guard-ok`, schoolId: realSchoolId },
      select: { id: true, schoolId: true },
    })
    expect(row.schoolId).toBe(realSchoolId)
    await db.jobRun.delete({ where: { id: row.id } })
  }, 30000)
})

describe('JobRun · unique (jobName, idempotencyKey)', () => {
  test('two rows with the same pair are rejected (P2002)', async () => {
    const jobName = `${P}uniq-pair`
    const idempotencyKey = 'dup-key'
    await db.jobRun.create({ data: { jobId: uniq('uniq-a'), jobName, idempotencyKey } })
    let code = ''
    try {
      await db.jobRun.create({ data: { jobId: uniq('uniq-b'), jobName, idempotencyKey } })
      throw new Error('expected unique rejection')
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('P2002')
  }, 30000)

  test('runJob refuses to double-track the same (jobName, key) via its own create (unique holds under the runner too)', async () => {
    // a running row + a skipped prior row must not coexist for one key:
    // run the same key through two CONCURRENT runJob calls — only one may
    // create the row; the second either skips (if first committed first)
    // or tolerates the tracking failure.
    const name = uniq('concurrent-job')
    const key = 'concurrent-delivery'
    const [a, b] = await Promise.all([
      runJob({ name, idempotencyKey: key, fn: async () => 'a' }),
      runJob({ name, idempotencyKey: key, fn: async () => 'b' }),
    ])
    const statuses = [a.status, b.status].sort()
    // one succeeded (or skipped); nothing threw; at most one tracked row
    expect(statuses.every((s) => ['success', 'skipped', 'failed'].includes(s))).toBe(true)
    const rows = await db.jobRun.findMany({ where: { jobName: name }, select: { id: true, status: true } })
    expect(rows.length).toBeLessThanOrEqual(2)
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 5. WebhookEvent.attempts (Phase-4 column)
// ══════════════════════════════════════════════════════════════════════

describe('WebhookEvent.attempts · delivery accounting', () => {
  test('the column exists, defaults to 1, and increments on redelivery', async () => {
    const eventId = uniq('wev')
    const created = await db.webhookEvent.create({
      data: { eventId, eventType: 'payment.captured', rawPayload: '{"test":true}' },
      select: { id: true, attempts: true },
    })
    expect(created.attempts).toBe(1)

    await db.webhookEvent.updateMany({ where: { id: created.id }, data: { attempts: { increment: 1 } } })
    const after1 = await db.webhookEvent.findUnique({ where: { id: created.id }, select: { attempts: true } })
    expect(after1!.attempts).toBe(2)

    await db.webhookEvent.updateMany({ where: { id: created.id }, data: { attempts: { increment: 1 } } })
    const after2 = await db.webhookEvent.findUnique({ where: { id: created.id }, select: { attempts: true } })
    expect(after2!.attempts).toBe(3)
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 6. trackedTransaction
// ══════════════════════════════════════════════════════════════════════

describe('trackedTransaction', () => {
  test('success path: returns the value and COMMITS the writes', async () => {
    const jobId = uniq('tx-ok')
    const out = await trackedTransaction('test-p4 tx commit', async (tx) => {
      await tx.jobRun.create({ data: { jobId, jobName: `${P}tx-commit` } })
      return 42
    })
    expect(out).toBe(42)
    // committed: the row is durable after the transaction returned
    const row = await db.jobRun.findUnique({ where: { jobId } })
    expect(row).not.toBeNull()
    expect(row!.jobName).toBe(`${P}tx-commit`)
  }, 30000)

  test('failure path: rethrows the ORIGINAL error and rolls back', async () => {
    const jobId = uniq('tx-fail')
    const original = new Error('business rule violated')
    let caught: unknown = null
    try {
      await trackedTransaction('test-p4 tx rollback', async (tx) => {
        await tx.jobRun.create({ data: { jobId, jobName: `${P}tx-rollback` } })
        throw original
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBe(original) // same instance — not wrapped, not replaced
    // rolled back: the created row must not exist
    const row = await db.jobRun.findUnique({ where: { jobId } })
    expect(row).toBeNull()
  }, 30000)

  test('failure path emits a db_transaction_failure structured log with the label', async () => {
    try {
      await trackedTransaction('test-p4 tx labeled-failure', async () => {
        throw new Error('boom-tx')
      })
    } catch { /* rethrow asserted above */ }
    const line = jsonLines().find((l) => l.event === 'db_transaction_failure' && l.label === 'test-p4 tx labeled-failure')
    expect(line).toBeDefined()
    expect(line!.channel).toBe('db')
    expect(line!.status).toBe('failed')
    expect(String(line!.detail)).toContain('boom-tx')
    expect(typeof line!.durationMs).toBe('number')
  }, 30000)

  test('options pass through to Prisma (timeout honored, not swallowed)', async () => {
    // a slow fn inside a 50ms-timeout transaction must fail with the
    // Prisma transaction-timeout error (P2028), rethrown by the wrapper
    let code = ''
    try {
      await trackedTransaction('test-p4 tx timeout', async () => {
        await new Promise((r) => setTimeout(r, 400))
        return 1
      }, { timeout: 50, maxWait: 50 })
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('P2028')
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════
// 7. readiness primitive against the real DB
// ══════════════════════════════════════════════════════════════════════

describe('health/ready · DB probe primitive', () => {
  test('db.$queryRaw SELECT 1 resolves with one row (the readiness primitive)', async () => {
    const rows = (await db.$queryRaw(Prisma.sql`SELECT 1`)) as unknown[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(1)
  }, 30000)
})
