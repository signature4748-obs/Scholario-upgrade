import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { SchoolLoginDoor } from './door'

export const dynamic = 'force-dynamic'

/**
 * /s/<tenant-slug>/login — the CANONICAL per-school login door.
 *
 * This is the URL the platform console hands to every provisioned
 * school (Phase 4/5 — School Factory + tenant routing):
 *
 *   https://scholario-app.vercel.app/s/green-valley/login
 *
 * The slug is resolved SERVER-SIDE against the real School table —
 * an unknown slug is an honest 404, never a guessed or defaulted
 * tenant. Branding afterwards flows through the same authoritative
 * /api/schools/public resolution as the custom-domain path; the
 * authenticated tenant identity NEVER comes from this URL — the login
 * POST binds the session to the user's real schoolId (server-side).
 *
 * Plane note: this route only exists where the school plane is served
 * (SCHOLARIO_PLANE=school or unified) — the middleware edge gate 404s
 * it on the platform deployment.
 */
export default async function SchoolLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const normalized = decodeURIComponent(slug).trim().toLowerCase()

  // Honest 404: only well-formed slugs that map to a real School row
  // have a login door. The DB unique on slug makes this exact-match.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length < 3 || normalized.length > 60) {
    notFound()
  }
  const school = await db.school.findUnique({
    where: { slug: normalized },
    select: { slug: true },
  })
  if (!school) notFound()

  return <SchoolLoginDoor slug={school.slug} />
}
