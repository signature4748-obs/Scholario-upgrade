import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'

export const runtime = 'nodejs'

// GET /api/admissions/inquiries — the school's REAL admission inquiries.
//
// Phase 7-H (admissions honesty): public inquiries are captured by
// POST /api/admissions/public (zod + rate-limit), which records each one
// as an ActivityLog row with action 'ADMISSION_INQUIRY' (exact string —
// see that route). This read-only surface lists those rows for the
// principal's office, tenant-scoped, most-recent-first, limit 50. The
// ActivityLog `detail` field is a formatted string written by the public
// route ("New Admission Inquiry: Student: …, Parent: …, Grade: …,
// Phone: …, Email: …, Notes: …") — it is parsed back into a safe DTO
// (studentName / class / parentName / phone / email / createdAt) so the
// client never depends on the raw log format.
//
// Full application processing (Application model, documents, review
// pipeline) is FUTURE SCOPE — this route deliberately exposes only the
// inquiry capture that exists today.

/** Labeled segment order used by POST /api/admissions/public's detail line. */
const INQUIRY_LABELS = ['Student', 'Parent', 'Grade', 'Phone', 'Email', 'Notes'] as const

/** The public route writes 'N/A' for absent email/grade — normalize to ''. */
const notApplicable = (v: string): string => (v === 'N/A' ? '' : v)

/** Extract the value of one labeled segment from the detail string. */
function inquirySegment(detail: string, label: (typeof INQUIRY_LABELS)[number]): string {
  const start = detail.indexOf(`${label}: `)
  if (start === -1) return ''
  let end = detail.length
  for (const other of INQUIRY_LABELS) {
    if (other === label) continue
    const idx = detail.indexOf(`, ${other}: `, start)
    if (idx !== -1 && idx < end) end = idx
  }
  return notApplicable(detail.slice(start + label.length + 2, end).trim())
}

export async function GET() {
  return withUser(
    async (user) => {
      const schoolId = schoolScoped(user)
      const rows = await db.activityLog.findMany({
        where: { schoolId, action: 'ADMISSION_INQUIRY' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, detail: true, createdAt: true },
      })
      return rows.map((r) => ({
        id: r.id,
        studentName: inquirySegment(r.detail ?? '', 'Student'),
        class: inquirySegment(r.detail ?? '', 'Grade'),
        parentName: inquirySegment(r.detail ?? '', 'Parent'),
        phone: inquirySegment(r.detail ?? '', 'Phone'),
        email: inquirySegment(r.detail ?? '', 'Email'),
        createdAt: r.createdAt.toISOString(),
      }))
    },
    // Inquiry PII (parent names, phones, emails) is school staff only —
    // same tier as the roster the principal plane already reads.
    { roles: ['PRINCIPAL', 'MANAGEMENT'] },
  )
}
