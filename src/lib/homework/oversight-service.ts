// ──────────────────────────────────────────────────────────────────────
// Homework oversight service — Principal dashboard, policy, audit,
// grievances, surveys. Builds on the existing homework service.
// ──────────────────────────────────────────────────────────────────────

import 'server-only'
import { db } from '@/lib/db'
import type { AuthUser } from '@/lib/auth'
import { AppError } from '@/lib/security/errors'

// ─── DTOs ────────────────────────────────────────────────────────────

export interface ComplianceMetricsDTO {
  todaysSubmissionRate: number
  teacherCompliance: number
  overloadedClasses: number
  pendingGrievances: number
  totalActiveHomework: number
  totalStudents: number
  totalTeachers: number
}

export interface LoadMatrixCell {
  classId: string
  className: string
  gradeLevel: string | null
  section: string | null
  homeworkCount: number
  estimatedMinutes: number
  loadLevel: 'green' | 'amber' | 'red'
}

export interface LoadMatrixDTO {
  cells: LoadMatrixCell[]
  gradeLevels: string[]
}

export interface SubjectDistributionDTO {
  subjectId: string | null
  subjectName: string
  count: number
  pct: number
}

export interface TeacherActivityDTO {
  id: string
  action: string
  teacherName: string
  homeworkTitle: string
  className: string
  subjectName: string | null
  createdAt: string
}

export interface LowSubmissionAlertDTO {
  classId: string
  className: string
  homeworkTitle: string
  submitted: number
  total: number
  submissionRate: number
}

export interface PolicyDTO {
  id: string
  gradeLevel: string
  maxMinutesPerDay: number
  enabled: boolean
}

export interface NoHomeworkDateDTO {
  id: string
  date: string
  reason: string | null
}

export interface GrievanceDTO {
  id: string
  homeworkId: string | null
  homeworkTitle: string | null
  parentName: string | null
  studentName: string | null
  subject: string
  description: string
  category: string
  status: string
  response: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface TeacherComplianceRowDTO {
  teacherId: string | null
  teacherName: string
  totalHomework: number
  publishedOnTime: number
  gradedPromptly: number
  compliancePct: number
  avgGradingHours: number
}

export interface ChronicNonSubmitterDTO {
  studentId: string
  studentName: string
  rollNo: string | null
  className: string
  totalAssigned: number
  missedCount: number
  missRate: number
}

export interface AssignmentRepositoryItemDTO {
  id: string
  title: string
  description: string | null
  subjectName: string | null
  className: string
  teacherName: string | null
  assignedDate: string
  dueDate: string
  status: string
  submissionCount: number
  totalStudents: number
}

// ─── Compliance Metrics ──────────────────────────────────────────────

export async function getComplianceMetrics(schoolId: string): Promise<ComplianceMetricsDTO> {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  const homework = await db.homework.findMany({
    where: { schoolId, status: { notIn: ['ARCHIVED'] } },
    include: { submissions: true },
  })

  const todaysHomework = homework.filter((h) => {
    const ad = new Date(h.assignedDate)
    return ad >= todayStart && ad <= todayEnd
  })

  // Today's submission rate: of homework due today, how many students submitted
  let totalDueToday = 0
  let submittedToday = 0
  for (const h of todaysHomework) {
    totalDueToday += h.submissions.length
    submittedToday += h.submissions.filter((s) =>
      ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)
    ).length
  }
  const todaysSubmissionRate = totalDueToday > 0 ? Math.round((submittedToday / totalDueToday) * 100) : 100

  // Teacher compliance: of homework assigned today, how many were published (not still draft)
  const publishedToday = todaysHomework.filter((h) => h.status !== 'DRAFT').length
  const teacherCompliance = todaysHomework.length > 0 ? Math.round((publishedToday / todaysHomework.length) * 100) : 100

  // Overloaded classes: classes exceeding their policy max
  const policies = await db.homeworkPolicy.findMany({ where: { schoolId, enabled: true } })
  const policyMap = new Map(policies.map((p) => [p.gradeLevel, p.maxMinutesPerDay]))
  const defaultMax = policyMap.get('all') ?? 60

  const classLoadMap = new Map<string, number>()
  for (const h of todaysHomework) {
    const cls = await db.class.findUnique({ where: { id: h.classId }, select: { gradeLevel: true } })
    const gradeLevel = cls?.gradeLevel ?? 'all'
    const max = policyMap.get(gradeLevel) ?? defaultMax
    const current = classLoadMap.get(h.classId) ?? 0
    // Estimate 30 min per homework (simplified)
    classLoadMap.set(h.classId, current + 30)
    void max
  }
  let overloadedClasses = 0
  for (const [classId, minutes] of classLoadMap) {
    const cls = await db.class.findUnique({ where: { id: classId }, select: { gradeLevel: true } })
    const gradeLevel = cls?.gradeLevel ?? 'all'
    const max = policyMap.get(gradeLevel) ?? defaultMax
    if (minutes > max) overloadedClasses++
  }

  // Pending grievances
  const pendingGrievances = await db.parentGrievance.count({
    where: { schoolId, status: 'open' },
  })

  const totalStudents = await db.student.count({ where: { schoolId } })
  const totalTeachers = await db.teacher.count({ where: { schoolId } })

  return {
    todaysSubmissionRate,
    teacherCompliance,
    overloadedClasses,
    pendingGrievances,
    totalActiveHomework: homework.filter((h) => ['PUBLISHED', 'ACTIVE'].includes(h.status)).length,
    totalStudents,
    totalTeachers,
  }
}

// ─── Load Matrix ──────────────────────────────────────────────────────

export async function getLoadMatrix(schoolId: string, date?: string): Promise<LoadMatrixDTO> {
  const targetDate = date ? new Date(date) : new Date()
  const dayStart = new Date(targetDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(targetDate)
  dayEnd.setHours(23, 59, 59, 999)

  const classes = await db.class.findMany({
    where: { schoolId },
    orderBy: { gradeLevel: 'asc' },
  })

  const homework = await db.homework.findMany({
    where: {
      schoolId,
      status: { notIn: ['ARCHIVED', 'DRAFT'] },
      assignedDate: { gte: dayStart, lte: dayEnd },
    },
  })

  const policies = await db.homeworkPolicy.findMany({ where: { schoolId, enabled: true } })
  const policyMap = new Map(policies.map((p) => [p.gradeLevel, p.maxMinutesPerDay]))
  const defaultMax = policyMap.get('all') ?? 60

  const cells: LoadMatrixCell[] = classes.map((c) => {
    const classHw = homework.filter((h) => h.classId === c.id)
    // Estimate minutes: 30 min per homework (simplified)
    const estimatedMinutes = classHw.length * 30
    const max = policyMap.get(c.gradeLevel ?? 'all') ?? defaultMax
    const loadLevel: 'green' | 'amber' | 'red' =
      estimatedMinutes > max ? 'red' :
      estimatedMinutes > max * 0.7 ? 'amber' : 'green'
    return {
      classId: c.id,
      className: c.name,
      gradeLevel: c.gradeLevel,
      section: c.section,
      homeworkCount: classHw.length,
      estimatedMinutes,
      loadLevel,
    }
  })

  const gradeLevels = Array.from(new Set(classes.map((c) => c.gradeLevel).filter(Boolean))) as string[]

  return { cells, gradeLevels }
}

// ─── Subject Distribution ─────────────────────────────────────────────

export async function getSubjectDistribution(schoolId: string): Promise<SubjectDistributionDTO[]> {
  const homework = await db.homework.findMany({
    where: { schoolId, status: { notIn: ['ARCHIVED', 'DRAFT'] } },
    include: { subject: true },
  })
  const total = homework.length
  const subjectMap = new Map<string, { subjectId: string | null; subjectName: string; count: number }>()
  for (const h of homework) {
    const key = h.subjectId ?? 'no_subject'
    const name = h.subject?.name ?? 'General'
    if (!subjectMap.has(key)) subjectMap.set(key, { subjectId: h.subjectId, subjectName: name, count: 0 })
    subjectMap.get(key)!.count++
  }
  return Array.from(subjectMap.values()).map((s) => ({
    ...s,
    pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
  })).sort((a, b) => b.count - a.count)
}

// ─── Teacher Activity Feed ────────────────────────────────────────────

export async function getTeacherActivity(schoolId: string, limit = 20): Promise<TeacherActivityDTO[]> {
  const logs = await db.homeworkAuditLog.findMany({
    where: {
      schoolId,
      action: { in: ['HOMEWORK_CREATED', 'HOMEWORK_PUBLISHED', 'SUBMISSION_RECEIVED', 'SUBMISSION_REVIEWED'] },
    },
    include: { homework: { include: { class: true, subject: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    teacherName: l.userName ?? 'Unknown',
    homeworkTitle: l.homework?.title ?? '—',
    className: l.homework?.class?.name ?? '—',
    subjectName: l.homework?.subject?.name ?? null,
    createdAt: l.createdAt.toISOString(),
  }))
}

// ─── Low Submission Alerts ───────────────────────────────────────────

export async function getLowSubmissionAlerts(schoolId: string): Promise<LowSubmissionAlertDTO[]> {
  const homework = await db.homework.findMany({
    where: { schoolId, status: { in: ['PUBLISHED', 'ACTIVE'] } },
    include: { class: true, submissions: true },
  })
  const alerts: LowSubmissionAlertDTO[] = []
  for (const h of homework) {
    const submitted = h.submissions.filter((s) =>
      ['SUBMITTED', 'LATE', 'REVIEWED', 'RETURNED', 'RESUBMISSION_REQUIRED'].includes(s.status)
    ).length
    const total = h.submissions.length
    const submissionRate = total > 0 ? Math.round((submitted / total) * 100) : 0
    if (submissionRate < 50) {
      alerts.push({
        classId: h.classId,
        className: h.class?.name ?? '—',
        homeworkTitle: h.title,
        submitted,
        total,
        submissionRate,
      })
    }
  }
  return alerts.sort((a, b) => a.submissionRate - b.submissionRate)
}

// ─── Policy ──────────────────────────────────────────────────────────

const DEFAULT_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

export async function listPolicies(schoolId: string): Promise<PolicyDTO[]> {
  let policies = await db.homeworkPolicy.findMany({ where: { schoolId }, orderBy: { gradeLevel: 'asc' } })
  if (policies.length === 0) {
    // Auto-seed defaults
    const defaults = DEFAULT_GRADES.map((g) => {
      const max = parseInt(g) <= 3 ? 20 : parseInt(g) <= 5 ? 30 : parseInt(g) <= 8 ? 45 : 90
      return { schoolId, gradeLevel: g, maxMinutesPerDay: max, enabled: true }
    })
    defaults.push({ schoolId, gradeLevel: 'all', maxMinutesPerDay: 60, enabled: true })
    await db.homeworkPolicy.createMany({ data: defaults })
    policies = await db.homeworkPolicy.findMany({ where: { schoolId }, orderBy: { gradeLevel: 'asc' } })
  }
  return policies.map((p) => ({ id: p.id, gradeLevel: p.gradeLevel, maxMinutesPerDay: p.maxMinutesPerDay, enabled: p.enabled }))
}

export async function updatePolicy(schoolId: string, id: string, data: { maxMinutesPerDay?: number; enabled?: boolean }): Promise<PolicyDTO> {
  // 3-d audit (CRITICAL tenant IDOR): the row is re-verified against the
  // caller's school BEFORE any write — a foreign-tenant policy id must
  // "not exist" (404), never be updated in place.
  const existing = await db.homeworkPolicy.findFirst({ where: { id, schoolId }, select: { id: true } })
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Policy not found',
      internalDetail: `updatePolicy: policy ${id} missing or foreign tenant`,
    })
  }
  const p = await db.homeworkPolicy.update({
    where: { id: existing.id },
    data: {
      ...(data.maxMinutesPerDay !== undefined ? { maxMinutesPerDay: data.maxMinutesPerDay } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
  })
  return { id: p.id, gradeLevel: p.gradeLevel, maxMinutesPerDay: p.maxMinutesPerDay, enabled: p.enabled }
}

// ─── No-Homework Dates ───────────────────────────────────────────────

export async function listNoHomeworkDates(schoolId: string): Promise<NoHomeworkDateDTO[]> {
  const dates = await db.noHomeworkDate.findMany({
    where: { schoolId },
    orderBy: { date: 'asc' },
  })
  return dates.map((d) => ({ id: d.id, date: d.date.toISOString().split('T')[0], reason: d.reason }))
}

export async function addNoHomeworkDate(schoolId: string, date: string, reason?: string): Promise<NoHomeworkDateDTO> {
  const existing = await db.noHomeworkDate.findFirst({ where: { schoolId, date: new Date(date) } })
  if (existing) throw new Error('Date already blocked')
  const d = await db.noHomeworkDate.create({
    data: { schoolId, date: new Date(date), reason: reason || null },
  })
  return { id: d.id, date: d.date.toISOString().split('T')[0], reason: d.reason }
}

export async function removeNoHomeworkDate(schoolId: string, id: string): Promise<void> {
  // 3-d audit (CRITICAL tenant IDOR): deleteMany scoped to the tenant — a
  // foreign-tenant id deletes nothing and surfaces as 404.
  const result = await db.noHomeworkDate.deleteMany({ where: { id, schoolId } })
  if (result.count === 0) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Blocked date not found',
      internalDetail: `removeNoHomeworkDate: date ${id} missing or foreign tenant`,
    })
  }
}

// ─── Grievances ──────────────────────────────────────────────────────

export async function listGrievances(schoolId: string, status?: string): Promise<GrievanceDTO[]> {
  const where: any = { schoolId }
  if (status && status !== 'all') where.status = status
  const grievances = await db.parentGrievance.findMany({
    where,
    include: { homework: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return grievances.map((g) => ({
    id: g.id,
    homeworkId: g.homeworkId,
    homeworkTitle: g.homework?.title ?? null,
    parentName: g.parentName,
    studentName: g.studentName,
    subject: g.subject,
    description: g.description,
    category: g.category,
    status: g.status,
    response: g.response,
    resolvedBy: g.resolvedBy,
    resolvedAt: g.resolvedAt ? g.resolvedAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
  }))
}

export async function resolveGrievance(schoolId: string, id: string, user: AuthUser | null, response: string, status: 'resolved' | 'dismissed'): Promise<void> {
  // 3-d audit (CRITICAL tenant IDOR): re-verify the grievance belongs to the
  // caller's school before resolving — a foreign id is a 404, never a write.
  const existing = await db.parentGrievance.findFirst({ where: { id, schoolId }, select: { id: true } })
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', {
      publicMessage: 'Grievance not found',
      internalDetail: `resolveGrievance: grievance ${id} missing or foreign tenant`,
    })
  }
  await db.parentGrievance.update({
    where: { id: existing.id },
    data: {
      response,
      status,
      resolvedBy: user?.id ?? null,
      resolvedAt: new Date(),
    },
  })
}

// ─── Assignment Repository (Quality Control) ─────────────────────────

export async function getAssignmentRepository(schoolId: string, filters: { teacherId?: string; subjectId?: string; classId?: string; search?: string } = {}): Promise<AssignmentRepositoryItemDTO[]> {
  const where: any = { schoolId }
  if (filters.teacherId && filters.teacherId !== 'all') where.teacherId = filters.teacherId
  if (filters.subjectId && filters.subjectId !== 'all') where.subjectId = filters.subjectId
  if (filters.classId && filters.classId !== 'all') where.classId = filters.classId
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' as const } },
      { description: { contains: filters.search, mode: 'insensitive' as const } },
    ]
  }
  const homework = await db.homework.findMany({
    where,
    include: {
      class: true,
      subject: true,
      creator: { select: { name: true } },
      _count: { select: { submissions: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return homework.map((h) => ({
    id: h.id,
    title: h.title,
    description: h.description,
    subjectName: h.subject?.name ?? null,
    className: h.class?.name ?? '—',
    teacherName: h.teacherName ?? h.creator?.name ?? null,
    assignedDate: h.assignedDate ? new Date(h.assignedDate).toISOString().split('T')[0] : '',
    dueDate: h.dueDate ? new Date(h.dueDate).toISOString().split('T')[0] : '',
    status: h.status,
    submissionCount: h._count.submissions,
    totalStudents: h._count.submissions,
  }))
}

// ─── Grading & Feedback Audit ─────────────────────────────────────────

export async function getGradingAudit(schoolId: string, homeworkId?: string): Promise<any[]> {
  const where: any = { homework: { schoolId } }
  if (homeworkId) where.homeworkId = homeworkId
  const submissions = await db.homeworkSubmission.findMany({
    where,
    include: {
      homework: { include: { class: true, subject: true } },
      student: { include: { user: { select: { name: true } } } },
    },
    orderBy: { reviewedAt: 'desc' },
    take: 50,
  })
  return submissions.filter((s) => s.status === 'REVIEWED' || s.status === 'RETURNED').map((s) => ({
    id: s.id,
    homeworkTitle: s.homework?.title ?? '—',
    className: s.homework?.class?.name ?? '—',
    subjectName: s.homework?.subject?.name ?? null,
    studentName: s.student?.user?.name ?? '—',
    studentRollNo: s.student?.rollNo ?? null,
    marks: s.marks,
    maxMarks: s.homework?.maxMarks ?? null,
    grade: s.grade,
    feedback: s.feedback,
    feedbackLength: s.feedback?.length ?? 0,
    hasMeaningfulFeedback: (s.feedback?.length ?? 0) > 20,
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    status: s.status,
  }))
}

// ─── Teacher Compliance Report ────────────────────────────────────────

export async function getTeacherCompliance(schoolId: string): Promise<TeacherComplianceRowDTO[]> {
  const homework = await db.homework.findMany({
    where: { schoolId },
    include: { submissions: true },
  })
  const teacherMap = new Map<string, { teacherName: string; totalHomework: number; publishedOnTime: number; gradedPromptly: number; totalGradingTimeMs: number; gradedCount: number }>()
  for (const h of homework) {
    const key = h.teacherId ?? h.createdBy ?? 'unknown'
    const name = h.teacherName ?? 'Unknown'
    if (!teacherMap.has(key)) teacherMap.set(key, { teacherName: name, totalHomework: 0, publishedOnTime: 0, gradedPromptly: 0, totalGradingTimeMs: 0, gradedCount: 0 })
    const entry = teacherMap.get(key)!
    entry.totalHomework++
    if (h.status !== 'DRAFT') entry.publishedOnTime++
    for (const s of h.submissions) {
      if (s.reviewedAt && s.submittedAt) {
        const gradingTime = s.reviewedAt.getTime() - s.submittedAt.getTime()
        entry.totalGradingTimeMs += gradingTime
        entry.gradedCount++
        if (gradingTime < 48 * 60 * 60 * 1000) entry.gradedPromptly++ // < 48h
      }
    }
  }
  return Array.from(teacherMap.entries()).map(([teacherId, v]) => ({
    teacherId,
    teacherName: v.teacherName,
    totalHomework: v.totalHomework,
    publishedOnTime: v.publishedOnTime,
    gradedPromptly: v.gradedPromptly,
    compliancePct: v.totalHomework > 0 ? Math.round((v.publishedOnTime / v.totalHomework) * 100) : 100,
    avgGradingHours: v.gradedCount > 0 ? Math.round((v.totalGradingTimeMs / v.gradedCount) / (60 * 60 * 1000) * 10) / 10 : 0,
  })).sort((a, b) => b.compliancePct - a.compliancePct)
}

// ─── Chronic Non-Submitters ──────────────────────────────────────────

export async function getChronicNonSubmitters(schoolId: string, threshold = 0.25): Promise<ChronicNonSubmitterDTO[]> {
  const submissions = await db.homeworkSubmission.findMany({
    where: { school: { id: schoolId } },
    include: {
      student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } },
    },
  })
  const studentMap = new Map<string, { studentName: string; rollNo: string | null; className: string; totalAssigned: number; missedCount: number }>()
  for (const s of submissions) {
    const key = s.studentId
    if (!studentMap.has(key)) {
      studentMap.set(key, {
        studentName: s.student?.user?.name ?? 'Unknown',
        rollNo: s.student?.rollNo ?? null,
        className: s.student?.class?.name ?? '—',
        totalAssigned: 0,
        missedCount: 0,
      })
    }
    const entry = studentMap.get(key)!
    entry.totalAssigned++
    if (s.status === 'NOT_STARTED' || s.status === 'LATE') entry.missedCount++
  }
  return Array.from(studentMap.values())
    .filter((s) => s.totalAssigned > 0 && (s.missedCount / s.totalAssigned) >= threshold)
    .map((s) => ({
      ...s,
      studentId: '',
      missRate: Math.round((s.missedCount / s.totalAssigned) * 100),
    }))
    .sort((a, b) => b.missRate - a.missRate)
}
