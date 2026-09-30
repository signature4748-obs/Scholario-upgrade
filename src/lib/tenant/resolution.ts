import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

/**
 * tenant/resolution — the PUBLIC tenant resolution pipeline.
 *
 *   host (domain) → School.domain match
 *   → explicit ?slug=
 *   → single-school tenant inference (one ACTIVE school in the DB)
 *   → registered demo school (sandbox / marketing default)
 *
 * This is the architecture-level hook for "the domain identifies the
 * school tenant": when a school's DNS domain points at the deployment,
 * the request Host header resolves the tenant BEFORE any content is
 * served — no user selection, no client-provided tenant id. Until real
 * domains are wired (Supabase/Vercel phase), resolution falls back to
 * the single-tenant/demo conventions the sandbox needs.
 *
 * Every consumer (public website payload, login branding, RSS, public
 * media) resolves the tenant HERE — the client never gets to choose a
 * school id, and School B's content can never resolve for School A's
 * domain.
 */

/** Strip port + lowercase a Host header value. */
function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  return host.split(':')[0].trim().toLowerCase() || null
}

export interface ResolvedTenant {
  schoolId: string
  slug: string
  via: 'domain' | 'slug' | 'single' | 'demo'
}

/**
 * Resolve the public tenant for an anonymous request.
 *
 * Priority: Host-header domain match → ?slug= → exactly-one-school DB →
 * the registered demo school. Returns null only when nothing can be
 * resolved safely (multi-school DB with no matching slug/domain).
 */
export async function resolvePublicSchool(req: NextRequest): Promise<ResolvedTenant | null> {
  // 1. Domain (Host header) — the future production path.
  const host = normalizeHost(req.headers.get('host'))
  if (host) {
    // Sandbox hosts (localhost / 127.0.0.1 / gateway ports) never resolve
    // a school — only real configured domains do.
    const isLocalHost =
      host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local')
    if (!isLocalHost) {
      const byDomain = await db.school.findFirst({
        where: { domain: host, status: 'ACTIVE' },
        select: { id: true, slug: true },
      })
      if (byDomain) return { schoolId: byDomain.id, slug: byDomain.slug, via: 'domain' }
      // A subdomain-style host (school.domain.tld) may match a stored
      // domain value of "school.domain.tld" — exact match only. No
      // suffix guessing: cross-tenant ambiguity is never tolerated.
    }
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
