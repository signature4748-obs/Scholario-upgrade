import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * POST|GET /api/cron/subscription-reconcile — Vercel Cron target for the
 * SUBSCRIPTION RECONCILIATION SWEEP (2026-10-30).
 *
 * WHY: enforcement never depends on this job — tenant/student/staff
 * entitlements are computed LIVE from their explicit validity windows at
 * evaluation time, and codes/orders expire lazily at claim/settle time.
 * This sweep reconciles the STORED SNAPSHOTS so registries, filters and
 * reports read truth without waiting for a write: expired codes flip
 * ISSUED→EXPIRED, lapsed live entitlement rows flip to EXPIRED, stale
 * PENDING orders past their TTL+grace flip to EXPIRED. Every action is an
 * idempotent conditional UPDATE — safe to retry, safe to run twice, and
 * an accidental miss changes nothing (the live evaluation still enforced
 * the correct access all along).
 *
 * AUTH: the deployment's cron secret (`Authorization: Bearer
 * $OPS_CRON_SECRET` — the same contract the ops-sync cron uses) or a
 * platform session with ops.read. Without a secret configured the
 * endpoint accepts ONLY the platform session (fail-closed).
 *
 * PLANE: exists on both deployments; the school plane answers 200
 * {skipped} so the cron stays green there without doing platform work.
 *
 * OBSERVABILITY: one JobRun row per hour bucket (jobId unique) with a
 * result summary — visible in the platform operations center.
 */

function json(body: unknown): Response {
  const res = NextResponse.json(body)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function runReconcile(): Promise<{
  codesExpired: number
  studentEntitlementsExpired: number
  staffEntitlementsExpired: number
  ordersExpired: number
  ranAt: string
}> {
  const { db } = await import('@/lib/db')
  const now = new Date()

  // 1 — codes past their redemption window: ISSUED → EXPIRED (conditional;
  //     a claim racing the sweep wins the code and the sweep's count just
  //     reports what it managed to close).
  const codesExpired = await db.activationCode.updateMany({
    where: { status: 'ISSUED', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })

  // 2 — lapsed live entitlement snapshots: PENDING/ACTIVE with validityEnd
  //     in the past → EXPIRED (the evaluator already treats them as
  //     expired LIVE; this reconciles the stored status).
  const studentEntitlementsExpired = await db.studentEntitlement.updateMany({
    where: { status: { in: ['PENDING', 'ACTIVE'] }, validityEnd: { lte: now } },
    data: { status: 'EXPIRED' },
  })
  const staffEntitlementsExpired = await db.staffEntitlement.updateMany({
    where: { status: { in: ['PENDING', 'ACTIVE'] }, validityEnd: { lte: now } },
    data: { status: 'EXPIRED' },
  })

  // 3 — stale PENDING orders past TTL + the 24h late-settlement grace →
  //     EXPIRED (mirror of the lazy settlement check in
  //     settleSubscriptionOrder; a straggler webhook past this point is
  //     honestly rejected for operator reconciliation, unchanged).
  const graceCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const ordersExpired = await db.subscriptionOrder.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: graceCutoff } },
    data: { status: 'EXPIRED' },
  })

  return {
    codesExpired: codesExpired.count,
    studentEntitlementsExpired: studentEntitlementsExpired.count,
    staffEntitlementsExpired: staffEntitlementsExpired.count,
    ordersExpired: ordersExpired.count,
    ranAt: now.toISOString(),
  }
}

async function handle(req: Request): Promise<Response> {
  const { PLANE } = await import('@/lib/plane')
  if (PLANE === 'school') {
    return json({ skipped: true, reason: 'not applicable on the school plane' })
  }

  // AUTH BEFORE WORK (same ordering rationale as ops-sync).
  // PAYMENTS & GATEWAYS REDESIGN: the secret path now records the SAME
  // JobRun observability the session path always had — every execution
  // leaves a run trail (idempotent sweeps make the double bookkeeping
  // harmless; a missing trail was the bug).
  const secret = (process.env.OPS_CRON_SECRET ?? '').trim()
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth === `Bearer ${secret}`) {
      const { runJob } = await import('@/lib/observability/jobs')
      const bucket = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
      const outcome = await runJob({
        name: 'subscription-reconcile',
        idempotencyKey: bucket,
        trigger: 'scheduled',
        fn: () => runReconcile(),
      })
      return json(
        outcome.status === 'success' || outcome.status === 'skipped'
          ? (outcome.result ?? { status: outcome.status })
          : { status: 'failed', error: outcome.error },
      )
    }
  }

  const { withPlatform } = await import('@/lib/platform/authz')
  const { platformAuditEvent } = await import('@/lib/platform/audit')
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    // Idempotency + observability: one JobRun per hour bucket (unique
    // jobId) — a concurrent/retry invocation re-runs the (idempotent)
    // sweeps but the run trail stays one-row-per-hour.
    const { runJob } = await import('@/lib/observability/jobs')
    const bucket = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
    const outcome = await runJob({
      name: 'subscription-reconcile',
      idempotencyKey: bucket,
      trigger: 'scheduled',
      fn: () => runReconcile(),
    })
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.subscription_reconcile',
      targetType: 'SETTING',
      reason: 'cron endpoint (session-authenticated invocation)',
      metadata: {
        status: outcome.status,
        jobId: outcome.jobId,
        summary: outcome.result ?? outcome.error ?? null,
      },
    }).catch(() => {})
    return outcome.status === 'success' || outcome.status === 'skipped'
      ? (outcome.result ?? { status: outcome.status })
      : { status: 'failed', error: outcome.error }
  }, { method: req.method === 'GET' ? 'GET' : 'POST' })
}

export async function POST(req: Request): Promise<Response> {
  return handle(req)
}

export async function GET(req: Request): Promise<Response> {
  return handle(req)
}

export const dynamic = 'force-dynamic'
