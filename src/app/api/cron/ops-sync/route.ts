import { NextResponse } from 'next/server'
import { syncAllProviders } from '@/lib/ops/sync'

export const runtime = 'nodejs'

/**
 * POST|GET /api/cron/ops-sync — Vercel Cron target for scheduled provider
 * synchronization (vercel.json → daily on the Hobby plan; the staleness
 * path in the dashboard covers intra-day freshness).
 *
 * AUTH: either a valid PLATFORM session with ops.read (manual-style
 * invocation through the same envelope) or the deployment's cron secret
 * (`Authorization: Bearer $OPS_CRON_SECRET`) — the same contract Vercel
 * Cron uses when OPS_CRON_SECRET is set. Without a secret configured,
 * the endpoint accepts ONLY the platform session (fail-closed: nobody
 * can trigger provider calls with a plain unauthenticated request).
 *
 * PLANE NOTE: this route exists on BOTH deployments (same repo); the
 * school plane answers 200 {skipped} so the daily cron stays green
 * there without doing platform-plane work.
 */

function json(body: unknown): Response {
  const res = NextResponse.json(body)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handle(req: Request): Promise<Response> {
  // PLANE is read LAZILY at request time: the production build never
  // evaluates it (SCHOLARIO_PLANE is per-deployment env, unset at build
  // time — the fail-closed module refuses to load eagerly in
  // production builds without it).
  const { PLANE } = await import('@/lib/plane')
  if (PLANE === 'school') {
    return json({ skipped: true, reason: 'not applicable on the school plane' })
  }

  // Cron-secret transport (Vercel Cron sends Authorization: Bearer …).
  const secret = (process.env.OPS_CRON_SECRET ?? '').trim()
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth === `Bearer ${secret}`) {
      const statuses = await syncAllProviders('cron')
      return json({ ranAt: new Date().toISOString(), statuses })
    }
  }

  // No cron secret → require a platform session with ops.read (the
  // withPlatform envelope enforces session + permission + rate limits
  // and returns the standard JSON envelope).
  const { withPlatform } = await import('@/lib/platform/authz')
  const { platformAuditEvent } = await import('@/lib/platform/audit')
  return withPlatform({ permission: 'ops.read' }, async (ctx) => {
    await platformAuditEvent({
      adminId: ctx.admin.id,
      action: 'platform.ops.sync.triggered',
      targetType: 'SETTING',
      reason: 'cron endpoint (session-authenticated invocation)',
    })
    const statuses = await syncAllProviders('cron')
    return { ranAt: new Date().toISOString(), statuses }
  }, { method: req.method === 'GET' ? 'GET' : 'POST' })
}

export async function POST(req: Request): Promise<Response> {
  return handle(req)
}

export async function GET(req: Request): Promise<Response> {
  return handle(req)
}

export const dynamic = 'force-dynamic'
