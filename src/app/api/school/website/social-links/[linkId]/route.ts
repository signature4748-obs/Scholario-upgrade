import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * PATCH   /api/school/website/social-links/[linkId] — update url/label, or
 *         move up/down (`direction: 'up' | 'down'` — a SWAP of adjacent
 *         orders within the tenant; the pair is renumbered when orders
 *         collide). The row must belong to the SESSION school (cross-tenant
 *         id = fail-safe 404).
 * DELETE  — remove the link (tenant-scoped).
 *
 * PRINCIPAL / MANAGEMENT only; rate-limited + audited.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ linkId: string }> },
) {
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

      const { linkId } = await params
      const body = (await req.json().catch(() => null)) as Record<string, any> | null

      const link = await db.websiteSocialLink.findFirst({ where: { id: linkId, schoolId } })
      if (!link) {
        return NextResponse.json(
          { success: false, error: 'Social link not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Reorder verb: swap with the adjacent link (within THIS tenant).
      if (body?.direction === 'up' || body?.direction === 'down') {
        const dir = body.direction === 'up' ? -1 : 1
        const all = await db.websiteSocialLink.findMany({
          where: { schoolId },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        })
        const idx = all.findIndex((l) => l.id === link.id)
        const target = idx + dir
        if (idx < 0 || target < 0 || target >= all.length) {
          // Already at the boundary — an honest no-op.
          return NextResponse.json(
            { success: true, data: { moved: false } },
            { headers: { 'X-Request-Id': requestId } },
          )
        }
        const neighbour = all[target]
        const aOrder = link.order
        const bOrder = neighbour.order
        await db.$transaction([
          db.websiteSocialLink.update({ where: { id: link.id }, data: { order: bOrder === aOrder ? bOrder + dir : bOrder } }),
          db.websiteSocialLink.update({ where: { id: neighbour.id }, data: { order: aOrder } }),
        ])
        await auditEvent({
          schoolId,
          userId: user.id,
          action: 'WEBSITE_CONTENT_UPDATED',
          requestId,
          detail: `Social link ${link.platform} moved ${body.direction} by ${user.name}`,
        }).catch(() => {})
        return NextResponse.json(
          { success: true, data: { moved: true } },
          { headers: { 'X-Request-Id': requestId } },
        )
      }

      const patch: Record<string, unknown> = {}
      if (typeof body?.url === 'string') {
        const url = body.url.trim()
        if (!/^https?:\/\/.+\..+/i.test(url) || url.length > 300) {
          return NextResponse.json(
            { success: false, error: 'Link URL must be a valid http(s) address.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        patch.url = url
      }
      if ('label' in (body ?? {})) {
        patch.label = body?.label ? String(body.label).trim().slice(0, 60) || null : null
      }
      if (!Object.keys(patch).length) {
        return NextResponse.json(
          { success: false, error: 'Nothing to update.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const updated = await db.websiteSocialLink.update({ where: { id: link.id }, data: patch })
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Social link ${updated.platform} updated (${Object.keys(patch).join(', ')}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        {
          success: true,
          data: {
            link: { id: updated.id, platform: updated.platform, url: updated.url, label: updated.label, order: updated.order },
          },
        },
        { headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ linkId: string }> },
) {
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

      const { linkId } = await params
      const link = await db.websiteSocialLink.findFirst({ where: { id: linkId, schoolId } })
      if (!link) {
        return NextResponse.json(
          { success: false, error: 'Social link not found.' },
          { status: 404, headers: { 'X-Request-Id': requestId } },
        )
      }
      await db.websiteSocialLink.delete({ where: { id: link.id } })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Social link removed (${link.platform}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json({ success: true }, { headers: { 'X-Request-Id': requestId } })
    },
  )
}
