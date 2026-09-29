import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, schoolScoped } from '@/lib/api'
import { auditEvent } from '@/lib/security/audit'
import { newRequestId } from '@/lib/security/errors'

export const runtime = 'nodejs'

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCSV(rows: Record<string, unknown>[], headers: { key: string; label: string }[]): string {
  const headerLine = headers.map((h) => csvEscape(h.label)).join(',')
  const dataLines = rows.map((row) =>
    headers.map((h) => csvEscape(row[h.key])).join(',')
  )
  return [headerLine, ...dataLines].join('\n')
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.status !== 'ACTIVE') {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'students'
  const EXPORT_TYPES = ['students', 'fees', 'attendance', 'teachers'] as const
  if (!EXPORT_TYPES.includes(type as (typeof EXPORT_TYPES)[number])) {
    return new Response(JSON.stringify({ error: 'Invalid export type' }), { status: 400 })
  }

  let schoolId: string
  try {
    schoolId = schoolScoped(user)
  } catch {
    return new Response(JSON.stringify({ error: 'NO_SCHOOL' }), { status: 400 })
  }

  // Only allow roles that can export
  if (!['PRINCIPAL', 'MANAGEMENT', 'TEACHER'].includes(user.role)) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 })
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
    return new Response(JSON.stringify({ error: 'Invalid export type' }), { status: 400 })
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
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
