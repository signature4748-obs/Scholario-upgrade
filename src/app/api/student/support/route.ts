import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuthz } from '@/lib/security/authz'
import { AppError } from '@/lib/security/errors'

export const runtime = 'nodejs'

/**
 * SS-1 — student Help & Support.
 *
 * GET  — the school office's REAL contact details (from the School row)
 *        so the student knows who they're reaching.
 *
 * POST — send a support request to the school office. Delivered through
 *        the EXISTING Message infrastructure (no parallel ticket system):
 *        the recipient is resolved server-side to the school's principal
 *        (fallback: first MANAGEMENT user) — a student can never pick an
 *        arbitrary recipient, and cross-school sends are impossible because
 *        schoolId is derived from the session.
 *
 * 3-c fix: the raw getCurrentUser checks are replaced with the central
 * withAuthz pipeline (STUDENT role, school tenant, ACTIVE status
 * enforced — a SUSPENDED account can no longer read the office contact
 * card or spam the office mailbox).
 */

const SUPPORT_CATEGORIES = ['account', 'technical', 'general', 'feedback'] as const
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: 'Account issue',
  technical: 'Technical issue',
  general: 'General question',
  feedback: 'Feedback',
}

export async function GET() {
  return withAuthz({ roles: ['STUDENT'] }, async (ctx) => {
    const school = await db.school.findUnique({
      where: { id: ctx.schoolId },
      select: { name: true, phone: true, email: true, address: true, city: true },
    })
    return {
      office: school
        ? {
            schoolName: school.name,
            phone: school.phone,
            email: school.email,
            address: [school.address, school.city].filter(Boolean).join(', ') || null,
          }
        : null,
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuthz({ roles: ['STUDENT'] }, async (ctx) => {
    const user = ctx.user

    const body = await req.json().catch(() => ({}))
    const category = String(body?.category || 'general') as SupportCategory
    if (!SUPPORT_CATEGORIES.includes(category)) throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid support category' })

    const subject = String(body?.subject || '').trim()
    const messageBody = String(body?.body || '').trim()
    if (!subject || !messageBody) throw new AppError('INVALID_INPUT', { publicMessage: 'Subject and message are required' })
    if (subject.length > 120) throw new AppError('INVALID_INPUT', { publicMessage: 'Subject must be under 120 characters' })
    if (messageBody.length > 4000) throw new AppError('INVALID_INPUT', { publicMessage: 'Message must be under 4000 characters' })

    // Resolve the office recipient server-side (principal, then management).
    const office = await db.user.findFirst({
      where: { schoolId: ctx.schoolId, role: 'PRINCIPAL', status: 'ACTIVE' },
      select: { id: true, name: true },
    })
    const fallbackOffice = office
      ? null
      : await db.user.findFirst({
          where: { schoolId: ctx.schoolId, role: 'MANAGEMENT', status: 'ACTIVE' },
          select: { id: true, name: true },
        })
    const recipient = office ?? fallbackOffice
    if (!recipient) throw new AppError('INVALID_INPUT', { publicMessage: 'No school office account is available to receive messages' })

    const label = CATEGORY_LABELS[category]
    const student = await db.student.findUnique({
      where: { userId: user.id },
      select: { classId: true, rollNo: true },
    })

    await db.message.create({
      data: {
        schoolId: ctx.schoolId,
        senderId: user.id,
        recipientId: recipient.id,
        subject: `[Student support · ${label}] ${subject}`,
        body:
          `${messageBody}\n\n— Sent from Settings → Help & Support by ${user.name ?? user.email}` +
          (student?.rollNo ? ` (Roll ${student.rollNo})` : ''),
      },
    })

    await db.activityLog.create({
      data: {
        schoolId: ctx.schoolId,
        userId: user.id,
        action: 'support_request_sent',
        detail: `Support request (${category}) delivered to the school office.`,
      },
    }).catch(() => {})

    return { ok: true, deliveredTo: recipient.name ?? 'School office' }
  })
}
