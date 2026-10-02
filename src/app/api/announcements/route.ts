import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { audienceAllows, notificationVisibilityWhere } from '@/lib/notices'
import { publishToSchool } from '@/lib/realtime/publish'

export const runtime = 'nodejs'

// Composer audience → canonical DB audience tag. Class-like selections keep a
// CLASS: prefix so /api/notifications-feed can restrict visibility to the
// students of that class (staff roles always see class notices for oversight).
const AUDIENCE_MAP: Record<string, string> = {
  'All Parents': 'PARENTS',
  'All Students': 'STUDENTS',
  'All Teachers': 'TEACHERS',
  'All Staff': 'STAFF',
  'Whole School': 'ALL',
}

function mapAudience(raw: string): string {
  const trimmed = raw.trim()
  if (AUDIENCE_MAP[trimmed]) return AUDIENCE_MAP[trimmed]
  if (/class|grade|section/i.test(trimmed)) return `CLASS:${trimmed}`
  return trimmed.toUpperCase()
}

function mapPriority(category: string): string {
  if (category === 'Emergency') return 'URGENT'
  if (category === 'Examination' || category === 'Academic') return 'HIGH'
  return 'NORMAL'
}

// Estimated recipient count for the composed audience (real DB counts where
// possible). Returns null when we cannot estimate.
async function estimateRecipients(schoolId: string, audience: string): Promise<number | null> {
  try {
    if (audience === 'ALL' || audience === 'STUDENTS') {
      return await db.student.count({ where: { schoolId, user: { status: 'ACTIVE' } } })
    }
    // Parents are counted as distinct guardian phone numbers (a family with
    // two enrolled children is ONE household), not as students.
    if (audience === 'PARENTS') {
      const households = await db.student.groupBy({
        by: ['guardianPhone'],
        where: { schoolId, user: { status: 'ACTIVE' }, guardianPhone: { not: null } },
      })
      return households.length
    }
    if (audience === 'TEACHERS') {
      return await db.teacher.count({ where: { schoolId, user: { status: 'ACTIVE' } } })
    }
    if (audience === 'STAFF') {
      const t = await db.teacher.count({ where: { schoolId, user: { status: 'ACTIVE' } } })
      return t + 8 // + admin/support staff estimate
    }
    if (audience.startsWith('CLASS:')) {
      const className = audience.slice(6).trim()
      return await db.student.count({
        where: { schoolId, user: { status: 'ACTIVE' }, class: { name: { contains: className, mode: 'insensitive' as const } } },
      })
    }
    return null
  } catch {
    return null
  }
}

// POST /api/announcements — create a real school announcement with the
// FULL lifecycle (PHASE 7.5): status DRAFT|PUBLISHED (default PUBLISHED),
// scheduled publishAt, optional expiry expiresAt, optional image (a
// website-scope uploaded file owned by the school).
// Creates a Notification row; published rows are picked up by the
// event-stream mini-service within ~4s and pushed as live toasts.
function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      if (user.role !== 'PRINCIPAL' && user.role !== 'MANAGEMENT') throw new Error('FORBIDDEN')

      const body = await req.json().catch(() => null)
      const title = String(body?.title || '').trim()
      const message = String(body?.message || '').trim()
      const category = String(body?.category || 'General')
      const audienceRaw = String(body?.audience || 'ALL')
      if (!title || title.length < 3) throw new Error('Title must be at least 3 characters')
      if (!message || message.length < 3) throw new Error('Message must be at least 3 characters')
      if (title.length > 120) throw new Error('Title too long (max 120 characters)')
      if (message.length > 2000) throw new Error('Message too long (max 2000 characters)')

      // Lifecycle (PHASE 7.5)
      const status = body?.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED'
      const publishAt = parseDate(body?.publishAt)
      const expiresAt = parseDate(body?.expiresAt)
      if (status === 'PUBLISHED' && publishAt && publishAt.getTime() < Date.now() - 60_000) {
        throw new Error('Scheduled publish time must be in the future')
      }
      if (expiresAt && publishAt && expiresAt.getTime() <= publishAt.getTime()) {
        throw new Error('Expiry must be after the publish time')
      }
      // Image must be a website-scope upload owned by THIS school.
      let imageId: string | null = null
      if (typeof body?.imageId === 'string' && body.imageId.trim()) {
        const imageFile = await db.uploadedFile.findFirst({
          where: { id: body.imageId.trim(), schoolId, scope: 'website' },
          select: { id: true },
        })
        if (!imageFile) throw new Error('Image not found. Upload it first.')
        imageId = imageFile.id
      }

      const audience = mapAudience(audienceRaw)
      const priority = mapPriority(category)
      const recipients = await estimateRecipients(schoolId, audience)

      const notification = await db.notification.create({
        data: {
          schoolId,
          title,
          message,
          audience,
          priority,
          senderId: user.id,
          status,
          publishAt,
          expiresAt,
          imageId,
          updatedById: user.id,
        },
        include: { sender: { select: { name: true, role: true } } },
      })

      // PHASE 8B — realtime announcement frame (school-wide, fire-and-forget,
      // never blocks the response). Live broadcasts only: a DRAFT row emits
      // nothing (its future publish transition is the emit moment) and a
      // scheduled row stays silent until due (readers already filter by
      // publishAt). Payload = the same ids/title/120-char detail the legacy
      // event-stream carried.
      if (status === 'PUBLISHED' && (!publishAt || publishAt.getTime() <= Date.now())) {
        // AWAITED (Phase 8C-N fix — Vercel freezes the function after the
        // response; un-awaited publish fetches never complete).
        await publishToSchool(schoolId, 'all', 'announcement', {
          id: notification.id,
          at: notification.createdAt.toISOString(),
          schoolId,
          title,
          detail: message.slice(0, 120),
        })
      }

      return {
        id: notification.id,
        title: notification.title,
        audience: notification.audience,
        priority: notification.priority,
        status: notification.status,
        publishAt: notification.publishAt,
        expiresAt: notification.expiresAt,
        imageId: notification.imageId,
        imageUrl: notification.imageId ? `/api/public/website/media/${notification.imageId}` : null,
        createdAt: notification.createdAt,
        sender: notification.sender?.name ?? user.name,
        estimatedRecipients: recipients,
        live: status === 'PUBLISHED',
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] }
  )
}

// GET /api/announcements — recent published announcements (newest first).
// Lets the Communication Center History tab show which broadcasts actually
// reached the platform (vs draft/mock-only records).
//
// Task 4-d (audit 3-a fix #14): non-staff callers (STUDENT/PARENT/DRIVER)
// only receive rows their role is allowed to see (audienceAllows from
// @/lib/notices — the SAME helper the bell feed and student notices use);
// staff roles keep the full oversight view. Grep-verified: the only client
// consumer of this GET is the PRINCIPAL Communication Center
// (comm-platform-broadcasts.tsx) — staff behavior is unchanged.
export async function GET() {
  return withUser(async (user) => {
    const schoolId = schoolScoped(user)
    const isStaff =
      user.role === 'PRINCIPAL' ||
      user.role === 'MANAGEMENT' ||
      user.role === 'TEACHER' ||
      user.role === 'ACCOUNTANT' ||
      user.role === 'SUPER_ADMIN'
    // Staff see the full lifecycle (drafts/scheduled/archived included);
    // non-staff roles see only PUBLISHED + currently-visible rows.
    let rows = await db.notification.findMany({
      where: isStaff
        ? { schoolId }
        : { schoolId, status: 'PUBLISHED', ...notificationVisibilityWhere() },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        sender: { select: { name: true, role: true } },
        _count: { select: { reads: true } },
      },
    })
    if (!isStaff) {
      const visibility = await Promise.all(
        rows.map(async (n) => ((await audienceAllows(n.audience, user)) ? n : null)),
      )
      rows = visibility.filter((n) => n !== null)
    }
    // Estimated audience size per broadcast powers the delivery-rate bar in
    // the History tab (acks ÷ estimated recipients). Distinct audiences are
    // resolved once each and reused across rows sharing the same audience.
    const audiences = [...new Set(rows.map((n) => n.audience))]
    const resolved = new Map<string, number | null>()
    for (const a of audiences) {
      resolved.set(a, await estimateRecipients(schoolId, a))
    }
    return {
      announcements: rows.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        audience: n.audience,
        priority: n.priority,
        status: n.status,
        publishAt: n.publishAt,
        expiresAt: n.expiresAt,
        imageId: n.imageId,
        imageUrl: n.imageId ? `/api/public/website/media/${n.imageId}` : null,
        sender: n.sender?.name ?? 'Unknown',
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        acknowledgedBy: n._count.reads,
        estimatedRecipients: resolved.get(n.audience) ?? null,
      })),
    }
  })
}
