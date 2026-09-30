import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
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
 * GET /api/schools/public?slug=… — the public website's school profile
 * (anonymous; no session).
 *
 * Task 4-d (audit 3-a fix #8):
 *   · Notifications served publicly are audience ALL/PUBLIC only —
 *     STUDENT-audience rows never reach the anonymous site.
 *   · The silent "any unknown slug falls back to some demo school"
 *     behavior is gone: an EXPLICIT `slug=demo-school` (the public
 *     website's default view — grep-verified: the only client consumer,
 *     use-public-website-data.ts, always sends this exact slug) resolves
 *     to the registered demo school when the slug itself is missing;
 *     any OTHER unknown slug fails-safe 404.
 *   · The 500 handler never returns err.message — a fixed safe string.
 *   · Per-IP rate limit (60/min — RATE_LIMITS.publicSchool).
 */

const DEMO_SLUG = 'demo-school'

// Publicly visible notices: whole-school + public audiences only
// (Task 4-d, fix #8a — 'STUDENTS' dropped: student-audience rows must not
// reach the anonymous site). One typed include shared by both lookups.
const publicInclude = Prisma.validator<Prisma.SchoolInclude>()({
  _count: {
    select: { students: true, teachers: true, classes: true, subjects: true, libraryBooks: true },
  },
  classes: {
    select: { id: true, name: true, gradeLevel: true, section: true, room: true },
    take: 12,
  },
  subjects: {
    select: { id: true, name: true, code: true },
    take: 12,
  },
  notifications: {
    where: { audience: { in: ['ALL', 'PUBLIC'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, message: true, priority: true, createdAt: true },
  },
})

type PublicSchool = Prisma.SchoolGetPayload<{ include: typeof publicInclude }>

function findPublicSchool(slug: string): Promise<PublicSchool | null> {
  return db.school.findUnique({ where: { slug }, include: publicInclude })
}

function findDemoSchool(): Promise<PublicSchool | null> {
  return db.school.findFirst({ where: { isDemo: true }, include: publicInclude })
}

export async function GET(req: NextRequest) {
  const requestId = newRequestId()
  try {
    // ── Anonymous traffic guard (per-IP, login-style key convention) ──
    const ip = clientIpFromHeaders(req.headers)
    const verdict = checkRateLimit(`rl:publicschool:${ip}`, RATE_LIMITS.publicSchool)
    if (!verdict.allowed) {
      auditRateLimit('public-school-profile', ip, requestId)
      return NextResponse.json(
        { success: false, error: `Too many requests. Please try again in ${verdict.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } },
      )
    }

    const slug = req.nextUrl.searchParams.get('slug') || DEMO_SLUG

    let school: PublicSchool | null = null
    try {
      school = await findPublicSchool(slug)
      // Explicit demo slug: serve the registered demo school (the public
      // website default view — grep-verified: the only client consumer,
      // use-public-website-data.ts, always sends this exact slug). The
      // slug itself may legitimately differ from the demo school's
      // canonical slug (e.g. before first-run setup).
      if (!school && slug === DEMO_SLUG) {
        school = await findDemoSchool()
      }
    } catch (_dbError) {
      // DB error or not connected — treated as "not found" below (the demo
      // slug then renders the seeded profile snapshot; other slugs 404).
      school = null
    }

    if (school) {
      return NextResponse.json({
        success: true,
        data: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          code: school.code,
          domain: school.domain,
          address: school.address,
          city: school.city,
          phone: school.phone,
          email: school.email,
          themeColor: school.themeColor,
          accentColor: school.accentColor,
          academicYear: school.academicYear,
          isDemo: Boolean(school.isDemo),
          counts: school._count,
          classes: school.classes,
          subjects: school.subjects,
          announcements: school.notifications,
        },
      })
    }

    // PHASE 7 — REAL DATA CONTRACT: the fabricated fallback payload
    // (mock school profile with invented counts: 1,842 students, 96
    // teachers, 4,500 books) is RETIRED. When the demo slug is not
    // registered the honest answer is 404 — the public site then renders
    // its neutral degraded identity, never a fabricated school.
    return NextResponse.json(
      { success: false, error: 'School profile not found' },
      { status: 404 },
    )
  } catch (_err) {
    // Safe 500 — internals (Prisma messages, filesystem paths) stay in the
    // server log; the client gets a fixed human string.
    console.error(
      JSON.stringify({
        channel: 'api',
        level: 'error',
        requestId,
        detail: 'GET /api/schools/public failed',
      }),
    )
    return NextResponse.json(
      { success: false, error: 'Unable to load school profile' },
      { status: 500 },
    )
  }
}
