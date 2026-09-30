import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/public/notices/rss — RSS 2.0 feed of the PUBLIC notice board.
 *
 * Same source as the public website's notice board section and
 * /api/schools/public: Notification rows whose audience includes the public
 * (ALL / STUDENTS / PUBLIC), newest first. Lets parents and the community
 * subscribe to school notices in any reader instead of polling the site.
 */

/** XML-escape a text node (RSS 2.0 spec § "escaping"). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** ISO/Date → RFC 822 (RSS pubDate format, GMT). */
function rfc822(d: Date): string {
  return d.toUTCString()
}

export async function GET() {
  try {
    // Demo school (same default the public site renders)
    const school = await db.school.findFirst({
      where: { isDemo: true },
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        notifications: {
          where: { audience: { in: ['ALL', 'STUDENTS', 'PUBLIC'] } },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { id: true, title: true, message: true, priority: true, createdAt: true },
        },
      },
    })

    const schoolName = school?.name ?? 'School'
    const siteOrigin = 'http://localhost:3000' // sandbox origin; see layout metadataBase note
    const selfUrl = `${siteOrigin}/api/public/notices/rss`
    const notices = school?.notifications ?? []

    const items = notices
      .map((n) => {
        const date = n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt)
        const priorityTag =
          n.priority === 'URGENT' ? ' [URGENT]' : n.priority === 'HIGH' ? ' [HIGH]' : ''
        return `    <item>
      <title>${esc(`${n.title}${priorityTag}`)}</title>
      <link>${esc(`${siteOrigin}/#notices`)}</link>
      <guid isPermaLink="false">${esc(`scholario-notice-${n.id}`)}</guid>
      <pubDate>${rfc822(date)}</pubDate>
      <description>${esc(n.message)}</description>
    </item>`
      })
      .join('\n')

    const lastBuild = notices.length
      ? rfc822(
          notices[0].createdAt instanceof Date
            ? notices[0].createdAt
            : new Date(notices[0].createdAt),
        )
      : rfc822(new Date())

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${schoolName} — Notice Board`)}</title>
    <link>${esc(`${siteOrigin}/#notices`)}</link>
    <description>${esc(`Official announcements from ${schoolName}${school?.city ? `, ${school.city}` : ''} — the same live notice board published on the school website.`)}</description>
    <language>en-in</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    })
  } catch {
    // DB unavailable — serve a valid, empty feed rather than an error document
    const schoolName = 'School'
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${schoolName} — Notice Board`)}</title>
    <link>http://localhost:3000/#notices</link>
    <description>Official announcements from ${esc(schoolName)}.</description>
    <language>en-in</language>
    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>
  </channel>
</rss>
`
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    })
  }
}
