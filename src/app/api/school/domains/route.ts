import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'

export const runtime = 'nodejs'

/**
 * SaaS-HARDENING (§4) — custom-domain management is PLATFORM-OWNED
 * infrastructure. This school-plane route is now READ-ONLY STATUS:
 *
 *   GET /api/school/domains  → this school's domains + simple status
 *
 * A principal must NOT manage DNS, verification, TXT/CNAME records,
 * tokens or routing — those live exclusively in the platform control
 * plane (Schools → School → Domains; /api/platform/schools/[id]/domains).
 * The principal may only SEE whether their school's website domain is
 * connected (and contact the platform through the request workflow when
 * a change is needed). The previous principal-facing request/verify
 * endpoints (with DNS instructions and verification tokens) were removed
 * deliberately — no infrastructure control is exposed to school users.
 *
 * Tenant scoping is unchanged: the session's school only; cross-tenant
 * ids never reach this route.
 */
export async function GET(_req: NextRequest) {
  return withAuthz({ roles: ['PRINCIPAL', 'MANAGEMENT'] }, async (ctx) => {
    const schoolId = ctx.schoolId

    const domains = await db.tenantDomain.findMany({
      where: { schoolId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      // NOTE: verificationToken is intentionally NOT selected — the
      // principal never sees infrastructure credentials.
      select: {
        id: true,
        hostname: true,
        isPrimary: true,
        status: true,
        lastCheckedAt: true,
        verifiedAt: true,
        createdAt: true,
      },
    })

    return {
      domains: domains.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        isPrimary: d.isPrimary,
        status: d.status,
        lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
        verifiedAt: d.verifiedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      // Honest posture note (no infrastructure instructions).
      note:
        'Domains are configured and verified by the SCHOLARIO platform team. ' +
        'Contact SCHOLARIO support to connect or change your school website domain.',
    }
  })
}
