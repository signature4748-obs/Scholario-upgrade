import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { log } from '@/lib/observability/logger'

/**
 * Readiness probe (Phase 4 — item 6).
 *
 * `/health/ready` answers: "can this instance serve REAL traffic?" It
 * verifies ONLY the critical dependency — the database. Deliberately NOT
 * probed (per the Phase-4 brief): mock data sources, not-yet-connected
 * Supabase/Vercel/Resend, the realtime mini-service, the AI gateway —
 * degradation of any of those must not evict the instance from the load
 * balancer; their failures surface through EXTERNAL_SERVICE_FAILURE
 * envelopes + logs instead.
 *
 * Timeout: the probe fails fast (2s) — a slow dependency is an unhealthy
 * dependency for traffic-routing purposes.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROBE_TIMEOUT_MS = 2_000

export async function GET() {
  const startedAt = Date.now()
  let database: 'ok' | 'failed' = 'failed'
  let dbDurationMs: number | undefined

  try {
    const dbStart = Date.now()
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS),
      ),
    ])
    dbDurationMs = Date.now() - dbStart
    database = 'ok'
  } catch (e) {
    log('error', 'health_ready_failed', {
      channel: 'health',
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  const durationMs = Date.now() - startedAt
  const ready = database === 'ok'

  return NextResponse.json(
    {
      status: ready ? 'ready' : 'unavailable',
      probe: 'ready',
      checks: { database, dbDurationMs },
      durationMs,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
