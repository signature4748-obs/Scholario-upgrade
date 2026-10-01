import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import type { Prisma } from '@prisma/client'
import { num, dec } from '@/lib/money'

export const runtime = 'nodejs'

/**
 * GET /api/fees/defaulters — the fee-defaulter outreach list.
 *
 * Server-truth aggregation over Fee rows where paid < amount, grouped by
 * student: outstanding balance, per-line breakdown, the earliest outstanding
 * due date, an honest days-overdue figure, guardian contact and the last
 * reminder message the student received (matched by the stable
 * "Fee Reminder" subject prefix — same prefix the remind endpoint writes).
 *
 * Roles: PRINCIPAL / MANAGEMENT (the fee operations roles — same policy as
 * POST /api/fees).
 *
 * `?summary=1` returns ONLY the aggregate block (plus the class spread and
 * the largest defaulter) — the lightweight shape the dashboard KPI, fees
 * overview KPI and the Principal Attention live alert consume. The full
 * per-student ledger (feeLines, guardian contact, reminder stamps) is the
 * Outreach tab's business and is skipped in summary mode.
 */
export async function GET(req: NextRequest) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const now = new Date()
      const summaryOnly = new URL(req.url).searchParams.get('summary') === '1'

      // Outstanding fee lines (paid < amount is not expressible as a Prisma
      // where-clause comparing two columns — filter in JS over the school's
      // non-PAID rows; statuses are maintained by the fee APIs).
      const feeRows = await db.fee.findMany({
        where: { schoolId, status: { not: 'PAID' } },
        select: {
          id: true, studentId: true, title: true, amount: true, paid: true,
          dueDate: true, status: true,
          student: {
            select: {
              id: true, userId: true, rollNo: true, guardianName: true, guardianPhone: true,
              user: { select: { name: true } },
              class: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 2000,
      })

      interface Bucket {
        studentId: string
        userId: string
        name: string
        className: string | null
        rollNo: string | null
        guardianName: string | null
        guardianPhone: string | null
        outstanding: Prisma.Decimal
        feeLines: Array<{ id: string; title: string; amount: number; paid: number; dueDate: string | null; status: string }>
        oldestDueAt: string | null
      }
      const byStudent = new Map<string, Bucket>()

      for (const f of feeRows) {
        const outstanding = dec(f.amount).minus(f.paid)
        if (outstanding.lessThanOrEqualTo(0)) continue
        let b = byStudent.get(f.studentId)
        if (!b) {
          b = {
            studentId: f.studentId,
            userId: f.student.userId,
            name: f.student.user.name ?? 'Unknown student',
            className: f.student.class?.name ?? null,
            rollNo: f.student.rollNo ?? null,
            guardianName: f.student.guardianName ?? null,
            guardianPhone: f.student.guardianPhone ?? null,
            outstanding: dec(0),
            feeLines: [],
            oldestDueAt: null,
          }
          byStudent.set(f.studentId, b)
        }
        b.outstanding = b.outstanding.plus(outstanding)
        b.feeLines.push({
          id: f.id,
          title: f.title,
          amount: num(f.amount),
          paid: num(f.paid),
          dueDate: f.dueDate ? f.dueDate.toISOString() : null,
          status: f.status,
        })
        if (f.dueDate) {
          const iso = f.dueDate.toISOString()
          if (!b.oldestDueAt || iso < b.oldestDueAt) b.oldestDueAt = iso
        }
      }

      const defaulters = [...byStudent.values()].map((b) => {
        let daysOverdue: number | null = null
        if (b.oldestDueAt) {
          const ms = now.getTime() - new Date(b.oldestDueAt).getTime()
          daysOverdue = ms > 0 ? Math.floor(ms / 86_400_000) : null
        }
        return { ...b, outstanding: num(b.outstanding), daysOverdue }
      }).sort((a, b) => b.outstanding - a.outstanding)

      // Last reminder per student — Message rows with the stable subject
      // prefix written by POST /api/fees/defaulters/remind.
      const userIds = defaulters.map((d) => d.userId)
      const reminderMessages = userIds.length
        ? await db.message.findMany({
            where: {
              recipientId: { in: userIds },
              subject: { startsWith: 'Fee Reminder' },
            },
            select: { recipientId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 400,
          })
        : []
      const lastRemindedByUser = new Map<string, Date>()
      for (const m of reminderMessages) {
        if (m.recipientId && !lastRemindedByUser.has(m.recipientId)) {
          lastRemindedByUser.set(m.recipientId, m.createdAt)
        }
      }

      const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
      let remindedThisWeek = 0
      const withReminders = defaulters.map((d) => {
        const at = lastRemindedByUser.get(d.userId) ?? null
        if (at && at > weekAgo) remindedThisWeek++
        return { ...d, lastRemindedAt: at ? at.toISOString() : null }
      })

      const totalOutstanding = num(withReminders.reduce((s, d) => s.plus(d.outstanding), dec(0)))
      const overdueCount = withReminders.filter((d) => d.daysOverdue !== null).length

      // Class spread + largest defaulter — the summary-mode extras the KPI
      // surfaces quote ("across N classes", "largest: <name> ₹X").
      const classesWithDues = new Set(
        withReminders.map((d) => d.className).filter((c): c is string => !!c),
      ).size
      const top = withReminders[0]
        ? { name: withReminders[0].name, outstanding: withReminders[0].outstanding, className: withReminders[0].className }
        : null

      if (summaryOnly) {
        return {
          summary: {
            totalOutstanding,
            defaulterCount: withReminders.length,
            overdueCount,
            remindedThisWeek,
            classesWithDues,
            top,
            asOf: now.toISOString(),
          },
        }
      }

      return {
        defaulters: withReminders,
        summary: {
          totalOutstanding,
          defaulterCount: withReminders.length,
          overdueCount,
          remindedThisWeek,
          classesWithDues,
        },
      }
    },
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
