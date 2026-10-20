/**
 * School-wise usage metering — SERVER-DERIVED tenant attribution.
 *
 * SECURITY CONTRACT:
 *   · schoolId is taken ONLY from the authenticated server identity
 *     (withUser's user.schoolId — resolved from the signed session).
 *     A client-supplied school id is NEVER used (metering has no client
 *     parameters at all).
 *   · Writes are ATOMIC (upsert + increment; no read-modify-write) so
 *     concurrent requests cannot corrupt counters, and idempotent at
 *     the row level (the same (school,user,day) upsert is naturally
 *     idempotent for the active-user marker).
 *   · Metering failures NEVER fail the user request (log-only) —
 *     monitoring must not become a new failure mode (same contract as
 *     auditEvent).
 *
 * WHAT IS METERED WHERE:
 *   · apiOperations + active-user marker — one call in withUser AFTER
 *     authorization (only authenticated school identities; platform
 *     identities are out of scope for per-school usage).
 *   · Everything else is aggregated at READ time from its existing
 *     single source of truth (login events → ActivityLog; email
 *     outcomes → EmailDelivery; uploads → UploadedFile; DAU/MAU →
 *     SchoolActiveUserDay) — nothing is double-written.
 */

import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'

/** UTC date bucket for a timestamp. */
export function usageDateBucket(at = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
}

/**
 * Meter one authenticated school API operation. Called from withUser
 * after the identity/entitlement gates (every business-API call counts
 * once; exempt identity surfaces count too — they are real usage).
 * Fire-and-forget semantics: failures log `ops_metering_failed` and
 * never propagate.
 */
export async function meterSchoolApiOperation(
  schoolId: string,
  userId: string,
  role?: string | null,
): Promise<void> {
  try {
    const date = usageDateBucket()
    // Two single-row upserts; both atomic. Promise.all is safe: the two
    // writes are independent.
    await Promise.all([
      db.schoolUsageDaily.upsert({
        where: { schoolId_date: { schoolId, date } },
        create: { schoolId, date, apiOperations: 1 },
        update: { apiOperations: { increment: 1 } },
      }),
      db.schoolActiveUserDay.upsert({
        where: { schoolId_userId_date: { schoolId, userId, date } },
        create: { schoolId, userId, date, role: role ?? null },
        update: {}, // row existing = the user already counted today
      }),
    ])
  } catch (e) {
    log('warn', 'ops_metering_failed', {
      channel: 'ops',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

export interface SchoolUsageWindowInput {
  from: Date
  to: Date
  /** Restrict to one school (drill-down). Null = all schools (root
   *  cross-tenant aggregate — ops.read only). */
  schoolId?: string | null
}

export interface SchoolUsageRow {
  schoolId: string
  schoolName: string | null
  schoolStatus: string | null
  /** Metered rollup (apiOperations) summed over the window. */
  apiOperations: number
  /** Distinct active users in the window (from the activity marker). */
  activeUsers: number
  /** Daily active users on the LAST day that has data (DAU snapshot). */
  dau: number
  /** Monthly active users — distinct users seen in the last 30 days. */
  mau: number
  logins: number
  failedLogins: number
  loginLockouts: number
  emailsAttempted: number
  emailsAccepted: number
  emailsFailed: number
  emailsDelivered: number
  uploads: number
  uploadBytes: number
}

/** LOGIN action names recorded by the school audit funnel (ActivityLog). */
const LOGIN_SUCCESS_ACTIONS = ['LOGIN_SUCCESS']
const LOGIN_FAILED_ACTIONS = ['LOGIN_FAILED', 'LOGIN_CREDENTIAL_EXPIRED']
const LOGIN_LOCKED_ACTIONS = ['LOGIN_LOCKED', 'LOGIN_RATE_BLOCKED']

/**
 * Aggregate per-school usage over a date window. Cross-tenant rows are
 * only reachable through ops.read-authorized API routes — this module
 * never enforces authorization itself (callers do).
 */
export async function aggregateSchoolUsage(input: SchoolUsageWindowInput): Promise<SchoolUsageRow[]> {
  const { from, to } = input

  const schools = await db.school.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { name: 'asc' },
  })
  const scoped = input.schoolId ? schools.filter((s) => s.id === input.schoolId) : schools

  const ids = scoped.map((s) => s.id)
  if (ids.length === 0) return []

  const [
    usageRows,
    activeUserRows,
    mauRows,
    loginRows,
    emailRows,
    uploadRows,
  ] = await Promise.all([
    db.schoolUsageDaily.groupBy({
      by: ['schoolId'],
      _sum: { apiOperations: true },
      where: { schoolId: { in: ids }, date: { gte: from, lte: to } },
    }),
    db.schoolActiveUserDay.findMany({
      where: { schoolId: { in: ids }, date: { gte: from, lte: to } },
      select: { schoolId: true, userId: true, date: true },
    }),
    db.schoolActiveUserDay.findMany({
      where: {
        schoolId: { in: ids },
        date: { gte: usageDateBucket(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) },
      },
      select: { schoolId: true, userId: true },
    }),
    db.activityLog.groupBy({
      by: ['schoolId', 'action'],
      _count: { _all: true },
      where: { schoolId: { in: ids }, createdAt: { gte: from, lte: to } },
    }),
    db.emailDelivery.groupBy({
      by: ['schoolId', 'status'],
      _count: { _all: true },
      where: { schoolId: { in: ids }, createdAt: { gte: from, lte: to } },
    }),
    db.uploadedFile.groupBy({
      by: ['schoolId'],
      _count: { _all: true },
      _sum: { size: true },
      where: { schoolId: { in: ids }, createdAt: { gte: from, lte: to } },
    }),
  ])

  // ── build rows ────────────────────────────────────────────────────────
  const rows = new Map<string, SchoolUsageRow>()
  for (const s of scoped) {
    rows.set(s.id, {
      schoolId: s.id,
      schoolName: s.name,
      schoolStatus: s.status,
      apiOperations: 0,
      activeUsers: 0,
      dau: 0,
      mau: 0,
      logins: 0,
      failedLogins: 0,
      loginLockouts: 0,
      emailsAttempted: 0,
      emailsAccepted: 0,
      emailsFailed: 0,
      emailsDelivered: 0,
      uploads: 0,
      uploadBytes: 0,
    })
  }

  for (const r of usageRows) {
    const row = rows.get(r.schoolId)
    if (row) row.apiOperations += r._sum.apiOperations ?? 0
  }

  // Distinct users per school within the window + DAU on the newest day
  // that has any marker (DAU = "as of the last active day" — honest for
  // quiet tenants instead of showing yesterday's zero).
  const usersInWindow = new Map<string, Set<string>>()
  const usersByDay = new Map<string, Map<string, Set<string>>>()
  for (const r of activeUserRows) {
    if (!usersInWindow.has(r.schoolId)) usersInWindow.set(r.schoolId, new Set())
    usersInWindow.get(r.schoolId)!.add(r.userId)
    const dayKey = r.date.toISOString().slice(0, 10)
    const key = `${r.schoolId}|${dayKey}`
    if (!usersByDay.has(key)) usersByDay.set(key, new Map())
    if (!usersByDay.get(key)!.has(r.schoolId)) usersByDay.get(key)!.set(r.schoolId, new Set())
    usersByDay.get(key)!.get(r.schoolId)!.add(r.userId)
  }
  const mauMap = new Map<string, Set<string>>()
  for (const r of mauRows) {
    if (!mauMap.has(r.schoolId)) mauMap.set(r.schoolId, new Set())
    mauMap.get(r.schoolId)!.add(r.userId)
  }
  const sortedDayKeys = [...usersByDay.keys()].sort()
  const lastDayKey = sortedDayKeys[sortedDayKeys.length - 1]
  for (const [schoolId, row] of rows) {
    row.activeUsers = usersInWindow.get(schoolId)?.size ?? 0
    row.mau = mauMap.get(schoolId)?.size ?? 0
    if (lastDayKey) {
      row.dau = usersByDay.get(lastDayKey)?.get(schoolId)?.size ?? 0
    }
  }

  for (const r of loginRows) {
    const row = rows.get(r.schoolId ?? '')
    if (!row) continue
    if (LOGIN_SUCCESS_ACTIONS.includes(r.action)) row.logins += r._count._all
    else if (LOGIN_FAILED_ACTIONS.includes(r.action)) row.failedLogins += r._count._all
    else if (LOGIN_LOCKED_ACTIONS.includes(r.action)) row.loginLockouts += r._count._all
  }

  for (const r of emailRows) {
    const row = rows.get(r.schoolId ?? '')
    if (!row) continue
    row.emailsAttempted += r._count._all
    switch (r.status) {
      case 'SENT':
        row.emailsDelivered += r._count._all
        break
      case 'QUEUED':
        row.emailsAccepted += r._count._all
        break
      case 'FAILED':
      case 'BOUNCED':
      case 'COMPLAINED':
        row.emailsFailed += r._count._all
        break
      default:
        break // PENDING rows are in-flight, not counted as outcomes
    }
  }

  for (const r of uploadRows) {
    const row = rows.get(r.schoolId ?? '')
    if (!row) continue
    row.uploads += r._count._all
    row.uploadBytes += r._sum.size ?? 0
  }

  return [...rows.values()]
}

/** A school's apiOperations per day for a window (drill-down chart). */
export async function schoolApiOperationSeries(
  schoolId: string,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; apiOperations: number }>> {
  const rows = await db.schoolUsageDaily.findMany({
    where: { schoolId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    select: { date: true, apiOperations: true },
  })
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), apiOperations: r.apiOperations }))
}
