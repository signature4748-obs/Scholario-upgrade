import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isSandboxHost, normalizeHostname } from './hostname'

/**
 * tenant/resolution — the PUBLIC tenant resolution pipeline.
 *
 * PHASE 8B (§10/§11) canonical order:
 *
 *   Host header → VERIFIED TenantDomain row (hostname unique per tenant)
 *               → legacy School.domain exact match (admin-set)
 *   → explicit ?slug=
 *   → single-school tenant inference (one ACTIVE school in the DB)
 *   → registered demo school (sandbox / marketing default)
 *
 * Security properties:
 *  - The Host header is normalized (lowercase, no protocol/port, no
 *    leading www., no trailing dots) BEFORE any lookup — a hostile Host
 *    value can only fail to resolve, never select another tenant.
 *  - Only VERIFIED TenantDomain rows participate: an unverified mapping
 *    never routes traffic, so a domain cannot be squat-served by pointing
 *    DNS at the deployment before the platform confirms ownership.
 *  - Hostnames are globally unique per tenant (storage constraint), so
 *    there is no cross-tenant ambiguity to resolve.
 *  - Every consumer (public website payload, login branding, RSS, public
 *    media) resolves the tenant HERE — the client never gets to choose a
 *    school id, and School B's content can never resolve for School A's
 *    domain.
 *  - Resolution only selects PUBLIC BRANDING/CONTENT. Authenticated data
 *    paths derive the tenant from the server-side session (withUser), so
 *    domain resolution is never an authorization mechanism.
 */

export interface ResolvedTenant {
  schoolId: string
  slug: string
  via: 'domain' | 'slug' | 'single' | 'demo'
}

/**
 * Resolve the public tenant for an anonymous request.
 *
 * Priority: Host-header domain match (verified mapping or legacy column)
 * → ?slug= → exactly-one-school DB → the registered demo school. Returns
 * null only when nothing can be resolved safely (multi-school DB with no
 * matching slug/domain).
 */
export async function resolvePublicSchool(req: NextRequest): Promise<ResolvedTenant | null> {
  // 1. Domain (Host header) — the production custom-domain path.
  const host = normalizeHostname(req.headers.get('host'))
  if (host && !isSandboxHost(host)) {
    // 1a. VERIFIED TenantDomain mapping (canonical, Phase 8B).
    const byMapping = await db.tenantDomain.findFirst({
      where: { hostname: host, status: 'VERIFIED' },
      select: { school: { select: { id: true, slug: true, status: true } } },
    })
    if (byMapping?.school && byMapping.school.status === 'ACTIVE') {
      return { schoolId: byMapping.school.id, slug: byMapping.school.slug, via: 'domain' }
    }

    // 1b. Legacy admin-set School.domain exact match (pre-8B path,
    //     kept for compatibility — platform-managed value).
    const byDomain = await db.school.findFirst({
      where: { domain: host, status: 'ACTIVE' },
      select: { id: true, slug: true },
    })
    if (byDomain) return { schoolId: byDomain.id, slug: byDomain.slug, via: 'domain' }
  }

  // 2. Explicit slug (tenant-chosen link identity).
  const slug = req.nextUrl.searchParams.get('slug')
  if (slug) {
    const bySlug = await db.school.findFirst({
      where: { slug: slug.trim().toLowerCase(), status: 'ACTIVE' },
      select: { id: true, slug: true },
    })
    if (bySlug) return { schoolId: bySlug.id, slug: bySlug.slug, via: 'slug' }
    // An explicit but unknown slug fails-safe (no demo fallback leak).
    return null
  }

  // 3. Single-school deployment: the one ACTIVE school is the tenant.
  const active = await db.school.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, slug: true, isDemo: true },
  })
  if (active.length === 1) {
    return { schoolId: active[0].id, slug: active[0].slug, via: 'single' }
  }

  // 4. Sandbox / marketing default: the registered demo school.
  const demo = active.find((s) => s.isDemo)
  if (demo) return { schoolId: demo.id, slug: demo.slug, via: 'demo' }
  if (active.length) return { schoolId: active[0].id, slug: active[0].slug, via: 'demo' }

  return null
}
