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
import { resolvePublicSchool } from '@/lib/tenant/resolution'
import { mergeWebsiteContent } from '@/lib/website-content'
import { notificationVisibilityWhere } from '@/lib/notices'

export const runtime = 'nodejs'

/**
 * GET /api/schools/public — the public website's school profile
 * (anonymous; no session).
 *
 * PHASE 7.5 — TENANT-AWARE PUBLIC RESOLUTION + FULL CMS PAYLOAD:
 *   · Tenant resolution: Host domain → ?slug= → single-school → demo
 *     (lib/tenant/resolution.ts). An explicit UNKNOWN slug fails-safe
 *     404 — School B's content can never resolve for School A's domain.
 *   · Payload now carries the complete per-school public surface:
 *     identity (name/shortName/tagline/affiliation/contact/…),
 *     branding (primaryColor/accentColor/logoUrl), the website CMS
 *     document (hero/sections/admissions/footer/SEO), published gallery
 *     albums, and ONLY published+visible announcements (audience
 *     ALL/PUBLIC + status PUBLISHED + publishAt/expiresAt window).
 *   · The demo school's isDemo flag keeps the sandbox default view;
 *     a real multi-domain deployment resolves by Host header.
 */
const publicInclude = (now: Date) =>
  Prisma.validator<Prisma.SchoolInclude>()({
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
      where: {
        audience: { in: ['ALL', 'PUBLIC'] },
        status: 'PUBLISHED',
        ...notificationVisibilityWhere(now),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, title: true, message: true, priority: true, createdAt: true, imageId: true,
      },
    },
    galleryAlbums: {
      where: { published: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, title: true, description: true,
        images: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, fileId: true, caption: true },
        },
      },
    },
  })


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
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec), 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', Vary: 'Host' } },
      )
    }

    // ── Tenant resolution (domain → slug → single → demo) ──
    const resolved = await resolvePublicSchool(req)
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: 'School not found.' },
        { status: 404, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', Vary: 'Host' } },
      )
    }
    const school = await db.school.findUnique({
      where: { id: resolved.schoolId },
      include: publicInclude(new Date()),
    })
    if (!school || school.status === 'SUSPENDED') {
      // Suspended tenants have no public website presence.
      return NextResponse.json(
        { success: false, error: 'School not found.' },
        { status: 404, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', Vary: 'Host' } },
      )
    }

    const content = mergeWebsiteContent(school.websiteContent)

    return NextResponse.json(
      {
        success: true,
        data: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          code: school.code,
          address: school.address,
          city: school.city,
          phone: school.phone,
          email: school.email,
          website: school.website,
          academicYear: school.academicYear,
          isDemo: school.isDemo,
          board: school.board,
          established: school.established,
          // Identity (PHASE 7.5)
          shortName: school.shortName,
          tagline: school.tagline,
          affiliation: school.affiliation,
          principalName: school.principalName,
          // Branding (PHASE 7.5)
          themeColor: school.themeColor,
          accentColor: school.accentColor,
          logoUrl: school.logoUrl ? `/api/public/website/media/${school.logoUrl}` : null,
          // Counts (real since Phase 7)
          counts: {
            students: school._count.students,
            teachers: school._count.teachers,
            classes: school._count.classes,
            subjects: school._count.subjects,
            libraryBooks: school._count.libraryBooks,
          },
          classes: school.classes,
          subjects: school.subjects,
          // Website CMS document (PHASE 7.5)
          websiteContent: content,
          // Published gallery (PHASE 7.5)
          gallery: school.galleryAlbums.map((a) => ({
            id: a.id,
            title: a.title,
            description: a.description,
            images: a.images.map((i) => ({
              id: i.id,
              url: `/api/public/website/media/${i.fileId}`,
              caption: i.caption,
            })),
          })),
          // Announcements (published + visible only)
          announcements: school.notifications.map((n) => ({
            id: n.id,
            title: n.title,
            message: n.message,
            createdAt: n.createdAt,
            priority: n.priority,
            imageId: n.imageId,
            imageUrl: n.imageId ? `/api/public/website/media/${n.imageId}` : null,
          })),
        },
      },
      { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', Vary: 'Host' } },
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'Unable to load school profile.' },
      { status: 500, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store', Vary: 'Host' } },
    )
  }
}
