/**
 * Background-job runner with run tracking (Phase 4 — item 8).
 *
 * EVERY deferred/scheduled/background unit of work in this application
 * runs through `runJob()`. One call guarantees:
 *
 *   · a stable jobId (human-readable: name + key/timestamp)
 *   · a JobRun DB row: startedAt, finishedAt, durationMs, status
 *     (running → success | failed), attempt / maxAttempts, error (truncated)
 *   · structured log lines at every transition (job_started / job_retry /
 *     job_completed / job_failed / job_skipped)
 *   · retry state: fn re-runs up to maxAttempts with backoff-free
 *     sequential attempts; the row records the final attempt number
 *   · idempotency: when an idempotencyKey is supplied and a prior run
 *     with (jobName, key) SUCCEEDED, the call short-circuits to `skipped`
 *     without executing fn — safe for cron re-fires and queue redeliveries
 *   · requestId correlation: the ambient request context (if the job was
 *     triggered by a request) is stamped on the row and log lines
 *
 * Jobs WITHOUT a natural idempotency key (re-check style jobs, e.g.
 * "ensure attendance finalized for class-day") pass no key — their fn is
 * state-idempotent by construction (re-running produces no duplicate
 * effects) and each execution still gets full run tracking.
 */
import { db } from '@/lib/db'
import { log } from './logger'
import { getRequestContext } from './context'

export interface RunJobOptions<T> {
  /** Stable job name — the grouping key in dashboards. */
  name: string
  /** Tenant scope when the job operates on one school's data. */
  schoolId?: string | null
  /** What kicked this run off. */
  trigger?: 'request' | 'scheduled' | 'manual' | 'system'
  /**
   * Idempotency key — when a previous run with (name, key) succeeded,
   * this call is skipped. Omit for re-check jobs whose fn is
   * state-idempotent.
   */
  idempotencyKey?: string | null
  /** Total attempts (default 1 — no retry). */
  maxAttempts?: number
  /** The work. Receives the 1-based attempt number. */
  fn: (attempt: number) => Promise<T>
}

export interface JobOutcome<T> {
  status: 'success' | 'failed' | 'skipped'
  jobId: string
  runId: string | null
  attempt: number
  durationMs?: number
  result?: T
  error?: string
}

function mintJobId(name: string, key: string | null | undefined): string {
  if (key) return `${name}:${key}`
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `${name}:${suffix}`
}

function summarize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    return s.slice(0, 300)
  } catch {
    return '[unserializable-result]'
  }
}

/**
 * Run a tracked job. NEVER throws: a failed job returns
 * `{ status: 'failed', error }` — callers decide whether a job failure
 * fails their request (usually it should not; observability must never
 * become a new failure mode).
 */
export async function runJob<T>(opts: RunJobOptions<T>): Promise<JobOutcome<T>> {
  const requestId = getRequestContext()?.requestId
  const maxAttempts = Math.max(1, Math.min(10, opts.maxAttempts ?? 1))
  const idempotencyKey = opts.idempotencyKey ?? null

  // Idempotency short-circuit — a prior SUCCESS for this exact key means
  // the work is already durably done. A prior FAILED/RUNNING row must NOT
  // short-circuit: redelivery after a failure (or after a crashed run)
  // re-executes the work — that is what retries are for.
  if (idempotencyKey) {
    try {
      const prior = await db.jobRun.findUnique({
        where: { jobName_idempotencyKey: { jobName: opts.name, idempotencyKey } },
        select: { id: true, jobId: true, attempt: true, durationMs: true, resultSummary: true, status: true },
      })
      if (prior && prior.jobId && prior.status === 'success') {
        log('info', 'job_skipped', {
          channel: 'jobs',
          jobName: opts.name,
          jobId: prior.jobId,
          idempotencyKey,
        })
        return {
          status: 'skipped',
          jobId: prior.jobId,
          runId: prior.id,
          attempt: prior.attempt,
          durationMs: prior.durationMs ?? undefined,
        }
      }
    } catch (e) {
      // The tracking store must never block the job itself.
      log('warn', 'job_idempotency_check_failed', {
        channel: 'jobs',
        jobName: opts.name,
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const jobId = mintJobId(opts.name, idempotencyKey)
  const startedAt = Date.now()

  let runId: string | null = null
  try {
    const row = await db.jobRun.create({
      data: {
        jobId,
        jobName: opts.name,
        schoolId: opts.schoolId ?? null,
        trigger: opts.trigger ?? 'request',
        idempotencyKey,
        status: 'running',
        attempt: 1,
        maxAttempts,
        requestId,
      },
      select: { id: true },
    })
    runId = row.id
  } catch (e) {
    // JobRun create failing (bad schoolId guard, DB down) must not stop
    // the actual work — log and proceed untracked.
    log('error', 'job_tracking_failed', {
      channel: 'jobs',
      jobName: opts.name,
      jobId,
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  log('info', 'job_started', {
    channel: 'jobs',
    jobName: opts.name,
    jobId,
    attempt: 1,
    maxAttempts,
    trigger: opts.trigger ?? 'request',
  })

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await opts.fn(attempt)
      const durationMs = Date.now() - startedAt
      const summary = summarize(result)
      if (runId) {
        await db.jobRun
          .updateMany({
            where: { id: runId },
            data: {
              status: 'success',
              attempt,
              finishedAt: new Date(),
              durationMs,
              resultSummary: summary,
              error: null,
            },
          })
          .catch(() => undefined)
      }
      log('info', 'job_completed', {
        channel: 'jobs',
        jobName: opts.name,
        jobId,
        attempt,
        durationMs,
      })
      return { status: 'success', jobId, runId, attempt, durationMs, result }
    } catch (e) {
      const message = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 400)
      const willRetry = attempt < maxAttempts
      log(willRetry ? 'warn' : 'error', willRetry ? 'job_retry' : 'job_failed', {
        channel: 'jobs',
        jobName: opts.name,
        jobId,
        attempt,
        maxAttempts,
        detail: message,
      })
      if (willRetry) continue
      if (runId) {
        await db.jobRun
          .updateMany({
            where: { id: runId },
            data: {
              status: 'failed',
              attempt,
              finishedAt: new Date(),
              durationMs: Date.now() - startedAt,
              error: message,
            },
          })
          .catch(() => undefined)
      }
      return {
        status: 'failed',
        jobId,
        runId,
        attempt,
        durationMs: Date.now() - startedAt,
        error: message,
      }
    }
  }

  // Unreachable (loop always returns); kept for total-function typing.
  return { status: 'failed', jobId, runId, attempt: maxAttempts, error: 'exhausted retries' }
}
