import { db } from '@/lib/db'
import { withPlatform } from '@/lib/platform/authz'
import { composeDiagnoses } from '@/lib/ops/diagnose'
import { parseErrorClass } from '@/lib/email/provider-errors'
import { vercelConfigured } from '@/lib/ops/providers/vercel'

export const runtime = 'nodejs'

/**
 * GET /api/platform/operations/errors/[fingerprint] — group drill-down:
 * the group, occurrence events (recent), related platform audit rows,
 * related EmailDelivery failures (when email-scoped), and the rule-based
 * diagnosis (confirmed/likely/insufficient-evidence with evidence).
 * A copyable sanitized diagnostic report is assembled server-side so
 * the clipboard never receives anything unsanitized.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ fingerprint: string }> }) {
  return withPlatform({ permission: 'ops.read' }, async () => {
    const { fingerprint } = await params
    const group = await db.operationalError.findUnique({ where: { fingerprint } })
    if (!group) {
      return { error: 'Error group not found', fingerprint }
    }

    const [events, relatedAudit] = await Promise.all([
      db.operationalErrorEvent.findMany({
        where: { fingerprint },
        orderBy: { occurredAt: 'desc' },
        take: 30,
      }),
      db.platformAuditLog.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, action: true, createdAt: true, schoolId: true, adminId: true, targetType: true },
      }),
    ])

    // Related audit rows: same school OR same status-code-ish actions in
    // the group's active window (loose correlation, labeled as such).
    const since = group.firstSeenAt
    const related = relatedAudit.filter(
      (a) =>
        (a.schoolId && a.schoolId === group.schoolId) ||
        (a.createdAt >= since && group.category === 'auth' && a.action.includes('login')),
    )

    // ── Email-scoped evidence for the diagnosis rules ────────────────
    const emailWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [emailStatusRows, emailFailureRows] = await Promise.all([
      db.emailDelivery.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { createdAt: { gte: emailWindow } },
      }),
      db.emailDelivery.findMany({
        where: { status: { in: ['FAILED', 'BOUNCED', 'COMPLAINED'] }, createdAt: { gte: emailWindow } },
        select: { lastError: true },
        take: 500,
      }),
    ])
    const statusCounts: Record<string, number> = {}
    for (const r of emailStatusRows) statusCounts[r.status] = r._count._all
    const failureClasses: Record<string, number> = {}
    for (const r of emailFailureRows) {
      const cls = parseErrorClass(r.lastError) ?? 'unclassified'
      failureClasses[cls] = (failureClasses[cls] ?? 0) + 1
    }

    // Live domain facts were already collected by the last health/sync
    // run — read the STORED snapshot (no provider call on this path).
    const domainSnapshot = await db.providerUsageSnapshot.findFirst({
      where: { provider: 'resend', metric: 'domains_verified' },
      orderBy: { collectedAt: 'desc' },
      select: { value: true, meta: true, collectedAt: true },
    })
    let domainsTotal = 0
    let domainsVerified = 0
    if (domainSnapshot) {
      domainsVerified = domainSnapshot.value
      try {
        const meta = JSON.parse(domainSnapshot.meta ?? '{}') as { total?: number }
        domainsTotal = meta.total ?? 0
      } catch {
        /* meta unparseable → 0 */
      }
    }

    const dbFailures = await db.operationalError.count({
      where: { category: 'http', lastStatusCode: { gte: 500 }, lastSeenAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
    })
    const tenantMismatches = await db.operationalError.count({
      where: { category: 'http', message: { contains: 'TENANT_MISMATCH' }, lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    })
    const connectivityRow = await db.monitoringCheck.findFirst({
      where: { checkKey: 'db_connectivity' },
      orderBy: { checkedAt: 'desc' },
    })

    // Latest deployment state (stored snapshot — real).
    let latestDeployment: { state: string; failed: number } | null = null
    if (vercelConfigured()) {
      const depSnapshot = await db.providerUsageSnapshot.findFirst({
        where: { metric: 'deployments_recent_list', availability: 'ok' },
        orderBy: { collectedAt: 'desc' },
        select: { meta: true },
      })
      const failedSnapshot = await db.providerUsageSnapshot.findFirst({
        where: { metric: 'deployments_failed_total_recent' },
        orderBy: { collectedAt: 'desc' },
        select: { value: true },
      })
      if (depSnapshot) {
        try {
          const meta = JSON.parse(depSnapshot.meta ?? '{}') as { deployments?: Array<{ state: string }> }
          latestDeployment = {
            state: meta.deployments?.[0]?.state ?? 'UNKNOWN',
            failed: failedSnapshot?.value ?? 0,
          }
        } catch {
          /* skip */
        }
      }
    }

    const lastSyncRun = await db.providerSyncRun.findFirst({
      where: { status: { in: ['success', 'partial', 'failed'] } },
      orderBy: { startedAt: 'desc' },
      select: { status: true, error: true, startedAt: true },
    })

    // ── Delivery-evidence facts for EMAIL-3 (webhook gap) ────────────
    // QUEUED rows carrying a provider message id can ONLY be confirmed
    // delivered by the provider webhook; zero Resend WebhookEvent rows
    // in the window + a missing signing secret = confirmed evidence gap.
    const [queuedWithId, resendWebhookEvents] = await Promise.all([
      db.emailDelivery.count({
        where: { status: 'QUEUED', providerMessageId: { not: null }, createdAt: { gte: emailWindow } },
      }),
      db.webhookEvent.count({
        where: { gatewayName: 'resend', receivedAt: { gte: emailWindow } },
      }),
    ])

    const diagnoses = composeDiagnoses({
      email: {
        domainsTotal,
        domainsVerified,
        failureClasses,
        statusCounts,
        webhookSecretConfigured: (process.env.RESEND_WEBHOOK_SECRET ?? '').trim().length > 0,
        resendWebhookEvents,
        queuedWithProviderMessageId: queuedWithId,
      },
      db: {
        databaseFailureErrors: dbFailures,
        connectivity: (connectivityRow?.status as 'healthy' | 'degraded' | 'down' | 'unknown' | 'not_configured') ?? 'unknown',
        connectivityLatencyMs: connectivityRow?.latencyMs ?? null,
      },
      authz: {
        tenantMismatches,
        forbiddenTotal: await db.operationalError.count({
          where: { category: 'http', lastStatusCode: 403, lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        platformLoginFailures: await db.platformAuditLog.count({
          where: { action: 'platform.login.failed', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
      },
      deployment: {
        failedDeployments: latestDeployment?.failed ?? 0,
        latestState: latestDeployment?.state ?? 'UNKNOWN',
      },
      sync: {
        lastRunStatus: lastSyncRun?.status ?? 'unknown',
        lastRunError: lastSyncRun?.error ?? null,
        ageMinutes: lastSyncRun
          ? Math.round((Date.now() - lastSyncRun.startedAt.getTime()) / 60_000)
          : null,
      },
    })

    // Copyable sanitized report (no stack traces, no request payloads).
    const report = [
      `SCHOLARIO OPERATIONS — ERROR DIAGNOSTIC REPORT`,
      `Generated: ${new Date().toISOString()}`,
      `Category: ${group.category} | Severity: ${group.severity} | Status: ${group.status}`,
      `Environment: ${group.env}`,
      `Route: ${group.lastRoute ?? 'n/a'} (${group.lastMethod ?? 'n/a'} → ${group.lastStatusCode ?? 'n/a'})`,
      `Provider: ${group.provider ?? 'n/a'}${group.schoolId ? ` | School id: ${group.schoolId}` : ''}`,
      `First seen: ${group.firstSeenAt.toISOString()} | Last seen: ${group.lastSeenAt.toISOString()}`,
      `Occurrences: ${group.occurrences}`,
      `Message: ${group.message}`,
      ``,
      `Recent occurrences:`,
      ...events.slice(0, 10).map((e) => `- ${e.occurredAt.toISOString()} ${e.route ?? ''} [${e.statusCode ?? '-'}] ${(e.brief ?? '').slice(0, 120)}`),
      ``,
      `Rule-based diagnoses:`,
      ...(diagnoses.length
        ? diagnoses.map((d) => `- [${d.status}] ${d.rule}: ${d.title}\n    Evidence: ${d.evidence.join('; ')}\n    Next step: ${d.nextStep}`)
        : ['- No rule matched with the currently collected evidence.']),
    ].join('\n')

    return {
      group: {
        ...group,
        firstSeenAt: group.firstSeenAt.toISOString(),
        lastSeenAt: group.lastSeenAt.toISOString(),
        acknowledgedAt: group.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: group.resolvedAt?.toISOString() ?? null,
      },
      events: events.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        route: e.route,
        statusCode: e.statusCode,
        requestId: e.requestId,
        brief: e.brief,
      })),
      relatedAudit: related.slice(0, 10).map((a) => ({
        id: a.id,
        action: a.action,
        at: a.createdAt.toISOString(),
        schoolId: a.schoolId,
      })),
      emailEvidence: { statusCounts, failureClasses, domainsTotal, domainsVerified },
      diagnoses,
      report,
    }
  })
}
