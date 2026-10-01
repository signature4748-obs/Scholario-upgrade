import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withUser, schoolScoped } from '@/lib/api'
import { AppError, newRequestId } from '@/lib/security/errors'
import { auditEvent } from '@/lib/security/audit'
import { RATE_LIMITS, enforceRateLimit } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const EXPORT_TYPES = ['students', 'fees', 'attendance', 'teachers'] as const
type ExportType = (typeof EXPORT_TYPES)[number]

/**
 * PIH-4a — matrix-aligned role gate (src/lib/security/permissions.ts).
 * Bulk CSV extraction of the student body (guardian phone, DOB, blood
 * group) is 'school.students.export' → PRINCIPAL/MANAGEMENT; the fee
 * ledger is 'school.finance.export' → + ACCOUNTANT; staff PII export has
 * no TEACHER-tier capability in the matrix (staff.read is directory
 * access, not bulk PII) → PRINCIPAL/MANAGEMENT. Previously TEACHER could
 * bulk-extract student/staff PII the matrix withholds.
 */
const EXPORT_ROLES: Record<ExportType, readonly string[]> = {
  students: ['PRINCIPAL', 'MANAGEMENT'],
  attendance: ['PRINCIPAL', 'MANAGEMENT'],
  teachers: ['PRINCIPAL', 'MANAGEMENT'],
  fees: ['PRINCIPAL', 'MANAGEMENT', 'ACCOUNTANT'],
}

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  // PIH-2b MEDIUM — CSV formula/DDE injection (OWASP): student names,
  // fee titles and guardian names are user-controlled; a cell whose
  // trimmed value starts with =, +, -, @, tab or CR is neutralized with
  // a leading apostrophe so Excel/Sheets cannot execute it.
  const guarded = /^[=+\-@\t\r]/.test(s.trim()) ? `'${s}` : s
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n')) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

function toCSV(rows: Record<string, unknown>[], headers: { key: string; label: string }[]): string {
  const headerLine = headers.map((h) => csvEscape(h.label)).join(',')
  const dataLines = rows.map((row) =>
    headers.map((h) => csvEscape(row[h.key])).join(',')
  )
  return [headerLine, ...dataLines].join('\n')
}

export async function GET(req: NextRequest) {
  // PIH-4a — withUser() (was raw getCurrentUser()) applies the standard
  // boundary: ACTIVE account + suspended-tenant fail-closed policy
  // (evaluateSchoolAccess) + the Phase-1 error envelope. The raw Response
  // passthrough keeps the CSV stream + headers intact.
  return withUser(async (user) => {
    // PIH-4a — bulk PII extraction is abuse-braked like every other
    // privileged surface (central limiter, per-user bucket).
    enforceRateLimit(`rl:export:${user.id}`, RATE_LIMITS.export)

    const schoolId = schoolScoped(user)

    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') || 'students') as ExportType
    if (!EXPORT_TYPES.includes(type)) {
      throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid export type' })
    }

    // Matrix-aligned role gate (see EXPORT_ROLES above).
    if (!EXPORT_ROLES[type].includes(user.role)) {
      throw new AppError('FORBIDDEN', {
        internalDetail: `export: role ${user.role} lacks the ${type} export capability`,
      })
    }

    let csv = ''
    let filename = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`

    if (type === 'students') {
      const rows = await db.student.findMany({
        where: { schoolId },
        include: { class: true, user: { select: { name: true, email: true, phone: true } } },
        orderBy: { rollNo: 'asc' },
      })
      csv = toCSV(
        rows.map((s) => ({
          name: s.user.name,
          email: s.user.email,
          phone: s.user.phone || '',
          admissionNo: s.admissionNo,
          rollNo: s.rollNo || '',
          class: s.class?.name || '',
          guardian: s.guardianName || '',
          guardianPhone: s.guardianPhone || '',
          gender: s.gender || '',
          bloodGroup: s.bloodGroup || '',
          dob: s.dob || '',
        })),
        [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'admissionNo', label: 'Admission No' },
          { key: 'rollNo', label: 'Roll No' },
          { key: 'class', label: 'Class' },
          { key: 'guardian', label: 'Guardian' },
          { key: 'guardianPhone', label: 'Guardian Phone' },
          { key: 'gender', label: 'Gender' },
          { key: 'bloodGroup', label: 'Blood Group' },
          { key: 'dob', label: 'Date of Birth' },
        ]
      )
    } else if (type === 'fees') {
      const rows = await db.fee.findMany({
        where: { schoolId },
        include: { student: { include: { user: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      })
      csv = toCSV(
        rows.map((f) => ({
          student: f.student.user.name,
          title: f.title,
          type: f.type,
          amount: f.amount,
          paid: f.paid,
          balance: f.amount - f.paid,
          status: f.status,
          dueDate: f.dueDate ? new Date(f.dueDate).toLocaleDateString() : '',
          paidDate: f.paidDate ? new Date(f.paidDate).toLocaleDateString() : '',
          method: f.method || '',
        })),
        [
          { key: 'student', label: 'Student' },
          { key: 'title', label: 'Title' },
          { key: 'type', label: 'Type' },
          { key: 'amount', label: 'Amount' },
          { key: 'paid', label: 'Paid' },
          { key: 'balance', label: 'Balance' },
          { key: 'status', label: 'Status' },
          { key: 'dueDate', label: 'Due Date' },
          { key: 'paidDate', label: 'Paid Date' },
          { key: 'method', label: 'Method' },
        ]
      )
    } else if (type === 'attendance') {
      const rows = await db.attendance.findMany({
        where: { schoolId },
        include: { student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } } },
        orderBy: { date: 'desc' },
        take: 1000,
      })
      csv = toCSV(
        rows.map((a) => ({
          student: a.student.user.name,
          class: a.student.class?.name || '',
          date: new Date(a.date).toLocaleDateString(),
          status: a.status,
        })),
        [
          { key: 'student', label: 'Student' },
          { key: 'class', label: 'Class' },
          { key: 'date', label: 'Date' },
          { key: 'status', label: 'Status' },
        ]
      )
    } else if (type === 'teachers') {
      const rows = await db.teacher.findMany({
        where: { schoolId },
        include: { user: { select: { name: true, email: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
      })
      csv = toCSV(
        rows.map((t) => ({
          name: t.user.name,
          email: t.user.email,
          phone: t.user.phone || '',
          employeeId: t.employeeId,
          department: t.department || '',
          qualification: t.qualification || '',
          subjects: t.subjects || '',
        })),
        [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'employeeId', label: 'Employee ID' },
          { key: 'department', label: 'Department' },
          { key: 'qualification', label: 'Qualification' },
          { key: 'subjects', label: 'Subjects' },
        ]
      )
    } else {
      // Exhaustiveness guard — unreachable (validated against EXPORT_TYPES).
      throw new AppError('INVALID_INPUT', { publicMessage: 'Invalid export type' })
    }

    // Phase 1 — student/teacher PII leaving the system as a file is an
    // auditable security event (login-adjacent sensitivity).
    await auditEvent({
      schoolId,
      userId: user.id,
      action: type === 'teachers' ? 'STUDENT_DATA_EXPORT' : 'STUDENT_DATA_EXPORT',
      requestId: newRequestId(),
      detail: `CSV export (${type}) served`,
    }).catch(() => {})

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
