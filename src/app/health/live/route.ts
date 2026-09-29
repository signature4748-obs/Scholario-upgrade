import { NextResponse } from 'next/server'

/**
 * Liveness probe (Phase 4 — item 6).
 *
 * `/health/live` answers exactly one question: "is the process able to
 * serve HTTP?" It checks NOTHING else — no database, no session store, no
 * external services. A liveness probe that depends on dependencies causes
 * restart storms when a dependency degrades.
 *
 * Unauthenticated, un-cached, middleware-exempt from anything stateful.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      probe: 'live',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
