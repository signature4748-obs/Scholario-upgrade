import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import type { Prisma } from '@prisma/client'
import { num, dec } from '@/lib/money'

export const runtime = 'nodejs'

/** INR formatting shared by subject + body (₹1,23,456 — Indian grouping).
 * Accepts Prisma.Decimal (Phase 8A) — Decimal has no toLocaleString. */
function formatINR(n: Prisma.Decimal | number): string {
  return `₹${num(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * POST /api/fees/defaulters/remind — the Principal's defaulter outreach.
 *
 * Body: { studentIds: string[] }
 *
 * For every selected student with a real outstanding balance:
 *   1. anti-spam guard — students already reminded in the last 24h are
 *      SKIPPED (reported honestly, never silently),
 *   2. a Message row is created (sender = the acting principal), rendered
 *      as the student would read it in their Messages module,
 *   3. the message flows through the live event-stream automatically (the
 *      service broadcasts new Message rows — open student tabs get the
 *      toast + bell entry within seconds, no reload),
 *   4. one ActivityLog audit entry (FEE_REMINDER_SENT) enriches the Super
 *      Admin activity feed.
 *
 * Roles: PRINCIPAL / MANAGEMENT.
 */
export async function POST(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const body = await req.json().catch(() => ({})) as { studentIds?: unknown }
      const studentIds = Array.isArray(body.studentIds)
        ? body.studentIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : []
      if (studentIds.length === 0) throw new Error('Select at least one student')
      if (studentIds.length > 200) throw new Error('Too many students in one batch (max 200)')

      // Outstanding fee lines for the selected students, school-scoped.
      const feeRows = await db.fee.findMany({
        where: { schoolId, studentId: { in: studentIds }, status: { not: 'PAID' } },
        select: {
          studentId: true, title: true, amount: true, paid: true, dueDate: true,
          student: {
            select: {
              id: true, userId: true,
              user: { select: { name: true } },
              class: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      interface Target {
        studentId: string
        userId: string
        name: string
        className: string | null
        outstanding: Prisma.Decimal
        lines: Array<{ title: string; amount: Prisma.Decimal; dueDate: Date | null }>
      }
      const targets = new Map<string, Target>()
      for (const f of feeRows) {
        const outstanding = dec(f.amount).minus(f.paid)
        if (outstanding.lessThanOrEqualTo(0)) continue
        let t = targets.get(f.studentId)
        if (!t) {
          t = {
            studentId: f.studentId,
            userId: f.student.userId,
            name: f.student.user.name ?? 'Unknown student',
            className: f.student.class?.name ?? null,
            outstanding: dec(0),
            lines: [],
          }
          targets.set(f.studentId, t)
        }
        t.outstanding = t.outstanding.plus(outstanding)
        t.lines.push({ title: f.title, amount: outstanding, dueDate: f.dueDate })
      }

      if (targets.size === 0) {
        return { sent: [], skipped: [], totalOutstandingCovered: 0, note: 'No outstanding dues among the selected students.' }
      }

      // Anti-spam: skip students reminded within the last 24h.
      const dayAgo = new Date(Date.now() - 24 * 3_600_000)
      const recent = await db.message.findMany({
        where: {
          recipientId: { in: [...targets.values()].map((t) => t.userId) },
          subject: { startsWith: 'Fee Reminder' },
          createdAt: { gt: dayAgo },
        },
        select: { recipientId: true },
      })
      const recentlyReminded = new Set(recent.map((m) => m.recipientId))

      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      })

      const sent: Array<{ studentId: string; name: string; outstanding: number }> = []
      const skipped: Array<{ studentId: string; name: string; reason: string }> = []

      // Phase 3 — one createMany instead of N sequential message.creates
      // (same data, same rows; the fan-out to 200 defaulters was 200
      // sequential writes). The `sent` report is computed from the SAME
      // payloads that are written.
      const sendable: Array<{
        t: Target
        subject: string
        messageBody: string
      }> = []
      for (const t of targets.values()) {
        if (recentlyReminded.has(t.userId)) {
          skipped.push({ studentId: t.studentId, name: t.name, reason: 'Reminded in the last 24h' })
          continue
        }

        const lineText = t.lines
          .map((l) => `• ${l.title} — ${formatINR(l.amount)}${l.dueDate ? ` (due ${formatDay(l.dueDate.toISOString())})` : ''}`)
          .join('\n')

        const subject = `Fee Reminder — ${formatINR(t.outstanding)} outstanding`
        const messageBody = [
          `Dear ${t.name}${t.className ? ` (${t.className})` : ''},`,
          '',
          `This is a gentle reminder from ${school?.name ?? 'the school office'} that your fee account has an outstanding balance of ${formatINR(t.outstanding)}:`,
          '',
          lineText,
          '',
          `Total outstanding: ${formatINR(t.outstanding)}`,
          '',
          'You can complete the payment at the school office or through the Fees section of your portal. If you have already paid, please share the receipt with the office so we can update your account.',
          '',
          `— ${user.name}, ${user.role === 'MANAGEMENT' ? 'School Management' : 'Principal'}, ${school?.name ?? ''}`.trim(),
        ].join('\n')

        sendable.push({ t, subject, messageBody })
        sent.push({ studentId: t.studentId, name: t.name, outstanding: num(t.outstanding) })
      }

      if (sendable.length > 0) {
        await db.message.createMany({
          data: sendable.map(({ t, subject, messageBody }) => ({
            schoolId,
            senderId: user.id,
            recipientId: t.userId,
            subject,
            body: messageBody,
            read: false,
          })),
        })
      }

      const totalOutstandingCovered = num(sent.reduce((s, x) => s.plus(x.outstanding), dec(0)))

      if (sent.length > 0) {
        // Audit trail — the Super Admin activity feed reads ActivityLog rows.
        await db.activityLog.create({
          data: {
            schoolId,
            userId: user.id,
            action: 'FEE_REMINDER_SENT',
            detail: `${sent.length} fee reminder${sent.length === 1 ? '' : 's'} · ${formatINR(totalOutstandingCovered)} outstanding total`,
          },
        })
      }

      return {
        sent,
        skipped,
        totalOutstandingCovered,
        note: sent.length === 0 ? 'All selected students were reminded recently — nothing sent.' : undefined,
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
