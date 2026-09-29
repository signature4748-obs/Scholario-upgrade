import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

// CSV-escape a single field (quotes, commas, newlines)
const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/announcements/[id]/reads/export — downloadable CSV acknowledgement
// report for one broadcast. Follows the payments-export pattern: raw Response
// passthrough (bypasses the { ok, data } envelope) with Content-Disposition
// attachment headers. Principal-only + school-scoped, mirroring the JSON
// reads endpoint.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      if (user.role !== 'PRINCIPAL') throw new Error('FORBIDDEN')
      const { id } = await params

      const notification = await db.notification.findFirst({
        where: { id, schoolId },
        select: { title: true, audience: true, priority: true, createdAt: true },
      })
      if (!notification) throw new Error('NOT_FOUND')

      const reads = await db.notificationRead.findMany({
        where: { notificationId: id },
        orderBy: { readAt: 'asc' },
        include: {
          user: { select: { name: true, role: true, email: true } },
        },
      })

      const roleLabel = (r: string | null | undefined): string => {
        switch (r) {
          case 'PRINCIPAL': return 'Principal'
          case 'TEACHER': return 'Teacher'
          case 'STUDENT': return 'Student'
          case 'PARENT': return 'Parent'
          default: return 'Staff'
        }
      }

      const lines: string[] = [
        `# Broadcast acknowledgement report`,
        `# Title,${csvCell(notification.title)}`,
        `# Audience,${csvCell(notification.audience)}`,
        `# Priority,${csvCell(notification.priority)}`,
        `# Published,${notification.createdAt.toISOString()}`,
        `# Acknowledgements,${reads.length}`,
        '',
      ]
      lines.push(['Name', 'Role', 'Email', 'Acknowledged At'].join(','))
      for (const r of reads) {
        lines.push(
          [
            r.user?.name ?? 'Unknown user',
            roleLabel(r.user?.role),
            r.user?.email ?? '—',
            new Date(r.readAt).toISOString(),
          ]
            .map(csvCell)
            .join(',')
        )
      }

      const stamp = new Date().toISOString().slice(0, 10)
      const slug = notification.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'broadcast'

      // Task 4-d (audit 3-a fix #17): user PII (names, emails, read
      // timestamps) leaving the system as a file is an auditable security
      // event — mirrors the payments-export STUDENT_DATA_EXPORT call.
      await auditEvent({
        schoolId,
        userId: user.id,
        action: 'STUDENT_DATA_EXPORT',
        requestId: newRequestId(),
        detail: `Broadcast acknowledgement CSV export served (${reads.length} rows)`,
      }).catch(() => {})

      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="ack-report-${slug}-${stamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    },
    { roles: ['PRINCIPAL'] }
  )
}
