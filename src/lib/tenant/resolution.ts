import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isSandboxHost, normalizeHostname } from './hostname'

/**
 * tenant/resolution — the PUBLIC tenant resolution pipeline.
 *
 * PRODUCT-DIRECTION RESET (Parts 2/3/11) — canonical order:
 *
 *   Host header → VERIFIED TenantDomain row (hostname unique per tenant)
 *               → legacy School.domain exact match (admin-set)
 *   → explicit ?slug= / ?tenant=   (development / deep-link fallback:
 *     e.g. /?tenant=hawkings-prithvipur — the documented pre-custom-domain
 *     path; NEVER the final customer UX)
 *
 * Everything else resolves to NOTHING: the bare platform domain
 * (scholario.cloud) is the SCHOLARIO SaaS website, not a school
 * directory and not a silently-defaulted school. The single-school and
 * demo-fallback paths are retired — a school is reached only through
 * its own identity (its domain, or an explicit tenant link).
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
  via: 'domain' | 'slug' | 'tenant'
}

/**
 * Resolve the public tenant for an anonymous request.
 *
 * Priority: Host-header domain match (verified mapping or legacy column)
 * → ?slug= / ?tenant= (the dev/deep-link fallback). Returns null when
 * nothing resolves — the caller then renders the SCHOLARIO SaaS website
 * (the platform's own root experience), never a guessed school.
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

  // 2. Explicit tenant link identity — ?slug= (canonical) and ?tenant=
  //    (the documented development fallback before custom domains are
  //    configured, e.g. /?tenant=green-valley). Both are exact-match
  //    only; an explicit but unknown value fails-safe (null — no demo
  //    fallback leak, no guessing).
  const params = req.nextUrl.searchParams
  const slug = params.get('slug') ?? params.get('tenant')
  if (slug) {
    const bySlug = await db.school.findFirst({
      where: { slug: slug.trim().toLowerCase(), status: 'ACTIVE' },
      select: { id: true, slug: true },
    })
    if (bySlug) {
      return {
        schoolId: bySlug.id,
        slug: bySlug.slug,
        via: params.get('tenant') && !params.get('slug') ? 'tenant' : 'slug',
      }
    }
    // An explicit but unknown slug fails-safe (no demo fallback leak).
    return null
  }

  // PRODUCT-DIRECTION RESET (Parts 2/11): no single-school inference, no
  // demo-school fallback. The bare platform domain is the SCHOLARIO SaaS
  // website; each school lives on its own domain (or an explicit
  // ?tenant= link during development). Authorization is never derived
  // from any of this — resolution selects public branding only.
  return null
}
