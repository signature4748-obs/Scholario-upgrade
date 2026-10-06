import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * /s/<tenant-slug> — the school's CANONICAL public URL (pre-custom-domain).
 *
 *   https://scholario-app.vercel.app/s/green-valley
 *
 * Server-side slug validation (unknown slug → honest 404), then a
 * redirect to the tenant website renderer with the explicit tenant
 * link — the SAME public-website pipeline the custom-domain path uses
 * (host resolution → verified TenantDomain; this path → explicit slug).
 * Public branding only: authorization is never derived from this URL.
 *
 * When the school later verifies a custom domain, the platform routes
 * traffic through the TenantDomain mapping and this /s/ URL simply
 * remains as the platform-hosted fallback.
 */
export default async function SchoolPublicSite({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const normalized = decodeURIComponent(slug).trim().toLowerCase()

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length < 3 || normalized.length > 60) {
    notFound()
  }
  const school = await db.school.findUnique({
    where: { slug: normalized },
    select: { slug: true },
  })
  if (!school) notFound()

  redirect(`/?tenant=${encodeURIComponent(school.slug)}`)
}
