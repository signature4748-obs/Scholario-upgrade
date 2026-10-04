import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * Website social links (task 2-a).
 *
 * GET  /api/school/website/social-links — this school's links (ordered).
 * POST — add a link { platform, url, label? }. Unique per platform per
 *      school (duplicate → 409). URL must be http(s) (the public renderer
 *      only opens http(s) links — never javascript:/data: injection).
 *
 * PRINCIPAL / MANAGEMENT writes. The tenant is session-derived. Mutations
 * are rate-limited + audited (WEBSITE_CONTENT_UPDATED).
 */

const PLATFORMS = new Set([
  'facebook', 'instagram', 'youtube', 'x', 'twitter', 'linkedin',
  'whatsapp', 'website', 'other',
])
const MAX_LINKS = 20

export async function GET(_req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const links = await db.websiteSocialLink.findMany({
        where: { schoolId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      })
      return NextResponse.json(
        {
          success: true,
          data: {
            links: links.map((l) => ({
              id: l.id,
              platform: l.platform,
              url: l.url,
              label: l.label,
              order: l.order,
            })),
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') {
        return NextResponse.json(
          { success: false, error: 'Only the principal or management can manage social links.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:websocial:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const platform = String(body?.platform || '').trim().toLowerCase()
      const url = String(body?.url || '').trim()
      const label = body?.label ? String(body.label).trim().slice(0, 60) || null : null

      if (!PLATFORMS.has(platform)) {
        return NextResponse.json(
          { success: false, error: 'Unsupported platform.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      if (!/^https?:\/\/.+\..+/i.test(url) || url.length > 300) {
        return NextResponse.json(
          { success: false, error: 'Link URL must be a valid http(s) address.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const existing = await db.websiteSocialLink.findUnique({
        where: { schoolId_platform: { schoolId, platform } },
        select: { id: true },
      })
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'A link for this platform already exists.' },
          { status: 409, headers: { 'X-Request-Id': requestId } },
        )
      }
      const count = await db.websiteSocialLink.count({ where: { schoolId } })
      if (count >= MAX_LINKS) {
        return NextResponse.json(
          { success: false, error: `At most ${MAX_LINKS} social links can be added.` },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const maxOrder = await db.websiteSocialLink.aggregate({
        where: { schoolId },
        _max: { order: true },
      })
      const link = await db.websiteSocialLink.create({
        data: { schoolId, platform, url, label, order: (maxOrder._max.order ?? 0) + 1 },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Social link added (${platform}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            link: { id: link.id, platform: link.platform, url: link.url, label: link.label, order: link.order },
          },
        },
        { status: 201, headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
