import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'

export const runtime = 'nodejs'

/// GET /api/fees/webhook — list webhook events for the school's audit log.
/// Supports filtering by status, eventType, gatewayName.
///
/// 3-c fixes:
///   · Role gate: 'school.finance.read' (PRINCIPAL / MANAGEMENT /
///     ACCOUNTANT) — before, ANY authenticated role could read the raw
///     webhook stream.
///   · Tenant: schoolId ONLY. The previous `OR { schoolId: null }` clause
///     surfaced OTHER schools' unattributed events to every school.
///     Unattributed events are platform-operator territory, invisible to
///     a school's audit surface.
///   · SAFE column projection — rawPayload (full gateway JSON with payer
///     PII) and signature (HMAC material) are never selected, so they can
///     never reach a client. (Client-grep: no client surface fetches this
///     route — the finance settings webhook panel renders the fee-store's
///     mock event feed.)
export async function GET(req: NextRequest) {
  return withAuthz({ permission: 'school.finance.read' }, async (ctx) => {
    const schoolId = ctx.schoolId
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const eventType = searchParams.get('eventType')
    const gatewayName = searchParams.get('gateway')
    const limit = Math.min(200, Number(searchParams.get('limit') || 100))

    const where: any = { schoolId }
    if (status) where.status = status
    if (eventType) where.eventType = eventType
    if (gatewayName) where.gatewayName = gatewayName

    const events = await db.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        schoolId: true,
        eventId: true,
        eventType: true,
        gatewayName: true,
        status: true,
        matchedTransactionId: true,
        error: true,
        receivedAt: true,
        processedAt: true,
      },
    })
    return events
  })
}

/// GET /api/fees/webhook/stats — quick counts for the audit surface header.
/// (separate endpoint to avoid loading all events just for the counts.)
export async function HEAD() {
  return NextResponse.json({ ok: true })
}
