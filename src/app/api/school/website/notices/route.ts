import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

/**
 * Website notices & announcements (task 2-a — Website Management module).
 *
 * GET  /api/school/website/notices?kind=NOTICE|ANNOUNCEMENT
 *      — every notice of the SESSION school (principal/management view:
 *      drafts + scheduled included). The effective status is computed
 *      live at read (SCHEDULED rows whose publishAt passed behave as
 *      published; PUBLISHED rows whose expiresAt passed behave as
 *      expired) so the management list is always honest.
 * POST — create a notice (status DRAFT by default; `action: 'schedule'`
 *      sets SCHEDULED + publishAt; `action: 'publish'` sets PUBLISHED +
 *      publishAt=now).
 *
 * PRINCIPAL / MANAGEMENT only. The tenant is session-derived — a client
 * schoolId is never read. Every mutation is rate-limited + audited.
 */

const KINDS = new Set(['NOTICE', 'ANNOUNCEMENT'])

/** Live lifecycle evaluation (lazy promotion + lazy expiry, schema docblock). */
function noticeEffectiveStatus(n: {
  status: string
  publishAt: Date | null
  expiresAt: Date | null
}): 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'EXPIRED' {
  const now = Date.now()
  if (n.expiresAt && n.expiresAt.getTime() <= now) return 'EXPIRED'
  if (n.status === 'PUBLISHED') return 'PUBLISHED'
  if (n.status === 'SCHEDULED') {
    if (!n.publishAt || n.publishAt.getTime() <= now) return 'PUBLISHED'
    return 'SCHEDULED'
  }
  return 'DRAFT'
}

function serializeNotice(n: {
  id: string
  kind: string
  title: string
  body: string
  category: string | null
  status: string
  publishAt: Date | null
  expiresAt: Date | null
  pinned: boolean
  attachmentFileId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    category: n.category,
    status: n.status,
    effectiveStatus: noticeEffectiveStatus(n),
    publishAt: n.publishAt?.toISOString() ?? null,
    expiresAt: n.expiresAt?.toISOString() ?? null,
    pinned: n.pinned,
    attachmentFileId: n.attachmentFileId,
    attachmentUrl: n.attachmentFileId ? `/api/public/website/media/${n.attachmentFileId}` : null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  const requestId = newRequestId()
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const kind = req.nextUrl.searchParams.get('kind') || ''
      const where: { schoolId: string; kind?: string } = { schoolId }
      if (KINDS.has(kind)) where.kind = kind
      const notices = await db.websiteNotice.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { publishAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      })
      return NextResponse.json(
        { success: true, data: { notices: notices.map(serializeNotice) } },
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
          { success: false, error: 'Only the principal or management can manage website notices.' },
          { status: 403, headers: { 'X-Request-Id': requestId } },
        )
      }
      const schoolId = schoolScoped(user)
      try {
        enforceRateLimit(`rl:webnotice:${user.id}`, RATE_LIMITS.message)
      } catch {
        return NextResponse.json(
          { success: false, error: 'Too many changes. Please slow down.' },
          { status: 429, headers: { 'Retry-After': '60', 'X-Request-Id': requestId } },
        )
      }

      const body = (await req.json().catch(() => null)) as Record<string, any> | null
      const kind = body?.kind === 'ANNOUNCEMENT' ? 'ANNOUNCEMENT' : 'NOTICE'
      const title = String(body?.title || '').trim()
      const text = String(body?.body || '').trim()
      const category = body?.category ? String(body.category).trim().slice(0, 40) : null
      if (title.length < 3 || title.length > 120) {
        return NextResponse.json(
          { success: false, error: 'Title must be 3–120 characters.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }
      if (text.length < 3 || text.length > 5000) {
        return NextResponse.json(
          { success: false, error: 'Body must be 3–5000 characters.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      const action = body?.action === 'publish' ? 'publish' : body?.action === 'schedule' ? 'schedule' : 'draft'
      const publishAt = parseDate(body?.publishAt)
      const expiresAt = parseDate(body?.expiresAt)

      // Lifecycle coherence:
      //  · schedule → publishAt REQUIRED and in the future
      //  · publish now → publishAt becomes now (a stale provided value is replaced)
      //  · expiry must be after the (effective) publish moment
      let status: string = 'DRAFT'
      let resolvedPublishAt: Date | null = null
      if (action === 'schedule') {
        if (!publishAt) {
          return NextResponse.json(
            { success: false, error: 'A future publish date is required to schedule a notice.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        if (publishAt.getTime() < Date.now() - 60_000) {
          return NextResponse.json(
            { success: false, error: 'Scheduled publish time must be in the future.' },
            { status: 400, headers: { 'X-Request-Id': requestId } },
          )
        }
        status = 'SCHEDULED'
        resolvedPublishAt = publishAt
      } else if (action === 'publish') {
        status = 'PUBLISHED'
        resolvedPublishAt = new Date()
      } else {
        resolvedPublishAt = publishAt // a draft may carry a planned publishAt
      }
      const effectivePublish = resolvedPublishAt?.getTime() ?? Date.now()
      if (expiresAt && expiresAt.getTime() <= effectivePublish) {
        return NextResponse.json(
          { success: false, error: 'Expiry must be after the publish time.' },
          { status: 400, headers: { 'X-Request-Id': requestId } },
        )
      }

      // Attachment must be a website-scope upload OWNED by this school —
      // a foreign school's file id is indistinguishable from a missing one.
      let attachmentFileId: string | null = null
      if (typeof body?.attachmentFileId === 'string' && body.attachmentFileId.trim()) {
        const file = await db.uploadedFile.findFirst({
          where: { id: body.attachmentFileId.trim(), schoolId, scope: 'website' },
          select: { id: true },
        })
        if (!file) {
          return NextResponse.json(
            { success: false, error: 'Attachment not found. Upload it first.' },
            { status: 404, headers: { 'X-Request-Id': requestId } },
          )
        }
        attachmentFileId = file.id
      }

      const notice = await db.websiteNotice.create({
        data: {
          schoolId,
          kind,
          title,
          body: text,
          category,
          status,
          publishAt: resolvedPublishAt,
          expiresAt,
          pinned: body?.pinned === true,
          attachmentFileId,
          createdById: user.id,
        },
      })

      await auditEvent({
        schoolId,
        userId: user.id,
        action: status === 'PUBLISHED' ? 'WEBSITE_NOTICE_PUBLISHED' : 'WEBSITE_CONTENT_UPDATED',
        requestId,
        detail: `Website ${kind.toLowerCase()} "${title}" created (${status}) by ${user.name}`,
      }).catch(() => {})

      return NextResponse.json(
        { success: true, data: { notice: serializeNotice(notice) } },
        { status: 201, headers: { 'X-Request-Id': requestId } },
      )
    },
  )
}
