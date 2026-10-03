import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  RATE_LIMITS,
  checkRateLimit,
  clientIpFromHeaders,
} from '@/lib/security/rate-limit'
import { auditRateLimit } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

/**
 * GET /api/public/directory — the anonymous school directory.
 *
 * ARCHITECTURE RESET — when NO tenant resolves for a bare deployment-domain
 * visit (multi-tenant DB, no demo school), the client renders the SCHOLARIO
 * landing which lists every ACTIVE school's public website as an explicit
 * link (`/?slug=…`). This endpoint is that directory: public identity only
 * (name, city, board, logo, brand color, real student count) — the exact
 * fields /api/schools/public already exposes per school, so nothing new
 * becomes public.
 *
 * Security properties:
 *  - Anonymous + per-IP rate limited (login-style budget).
 *  - SUSPENDED / PENDING schools never appear (public presence == ACTIVE).
 *  - No ids beyond the public slug identity, no session material, no
 *    authorization signal — a slug is a link identity, never a grant.
 */
export async function GET(req: NextRequest) {
  const requestId = newRequestId()
  try {
    const ip = clientIpFromHeaders(req.headers)
    const verdict = checkRateLimit(`rl:publicdirectory:${ip}`, RATE_LIMITS.publicSchool)
    if (!verdict.allowed) {
      auditRateLimit('public-school-directory', ip, requestId)
      return NextResponse.json(
        { success: false, error: `Too many requests. Please try again in ${verdict.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec), 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } },
      )
    }

    const schools = await db.school.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        slug: true,
        name: true,
        shortName: true,
        city: true,
        board: true,
        themeColor: true,
        logoUrl: true,
        established: true,
        _count: { select: { students: true } },
      },
      take: 100,
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          schools: schools.map((s) => ({
            slug: s.slug,
            name: s.name,
            shortName: s.shortName,
            city: s.city,
            board: s.board,
            themeColor: s.themeColor,
            logoUrl: s.logoUrl ? `/api/public/website/media/${s.logoUrl}` : null,
            established: s.established,
            students: s._count.students,
          })),
        },
      },
      { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } },
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'Unable to load the school directory.' },
      { status: 500, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } },
    )
  }
}
