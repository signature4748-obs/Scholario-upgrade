// ──────────────────────────────────────────────────────────────────────
// Exam settings service — school-scoped, persisted configuration.
// Reads/writes ExamTypeConfig, GradeScale, ExamRule, AdmitCardConfig,
// ReportCardConfig tables.
// ──────────────────────────────────────────────────────────────────────

import 'server-only'
import { db } from '@/lib/db'
import { AppError } from '@/lib/security/errors'
import {
  EXAM_TYPES as DEFAULT_EXAM_TYPES,
  DEFAULT_GRADE_BOUNDARIES as DEFAULT_GRADES,
  type ExamTypeConfigDTO,
  type GradeScaleDTO,
  type AdmitCardConfigDTO,
  type ReportCardConfigDTO,
} from './types'

// DTOs are imported from ./types — no duplicate definitions here.

// ─── Exam Types ──────────────────────────────────────────────────────

export async function listExamTypes(schoolId: string): Promise<ExamTypeConfigDTO[]> {
  // Auto-seed if none exist
  let types = await db.examTypeConfig.findMany({
    where: { schoolId },
    orderBy: { sortOrder: 'asc' },
  })
  if (types.length === 0) {
    await db.examTypeConfig.createMany({
      data: DEFAULT_EXAM_TYPES.map((name, i) => ({
        schoolId,
        name,
        code: name.slice(0, 3).toUpperCase(),
        enabled: true,
        sortOrder: i,
      })),
    })
    types = await db.examTypeConfig.findMany({ where: { schoolId }, orderBy: { sortOrder: 'asc' } })
  }
  return types.map((t) => ({ id: t.id, schoolId: t.schoolId, name: t.name, code: t.code, enabled: t.enabled, sortOrder: t.sortOrder }))
}

export async function createExamType(schoolId: string, data: { name: string; code?: string }): Promise<ExamTypeConfigDTO> {
  const existing = await db.examTypeConfig.findFirst({ where: { schoolId, name: data.name } })
  if (existing) throw new Error('Exam type already exists')
  const count = await db.examTypeConfig.count({ where: { schoolId } })
  const t = await db.examTypeConfig.create({
    data: { schoolId, name: data.name.trim(), code: data.code ?? data.name.slice(0, 3).toUpperCase(), sortOrder: count },
  })
  return { id: t.id, schoolId: t.schoolId, name: t.name, code: t.code, enabled: t.enabled, sortOrder: t.sortOrder }
}

export async function updateExamType(schoolId: string, id: string, data: { name?: string; code?: string; enabled?: boolean }): Promise<ExamTypeConfigDTO> {
  // Tenant guard (audit 3-b CRITICAL): the row must exist in the CALLER's
  // school before any mutation — a foreign-tenant id "does not exist" (404,
  // no existence oracle). schoolId was previously accepted but ignored.
  const existing = await db.examTypeConfig.findFirst({ where: { id, schoolId } })
  if (!existing) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Exam type not found',
      internalDetail: `updateExamType: id ${id} missing or foreign tenant`,
    })
  }
  const t = await db.examTypeConfig.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
  })
  return { id: t.id, schoolId: t.schoolId, name: t.name, code: t.code, enabled: t.enabled, sortOrder: t.sortOrder }
}

export async function deleteExamType(schoolId: string, id: string): Promise<void> {
  // Tenant guard (audit 3-b CRITICAL): delete scoped to the caller's school.
  const existing = await db.examTypeConfig.findFirst({ where: { id, schoolId } })
  if (!existing) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Exam type not found',
      internalDetail: `deleteExamType: id ${id} missing or foreign tenant`,
    })
  }
  await db.examTypeConfig.delete({ where: { id: existing.id } })
}

// ─── Grade Scales ────────────────────────────────────────────────────

export async function listGradeScales(schoolId: string): Promise<GradeScaleDTO[]> {
  let scales = await db.gradeScale.findMany({
    where: { schoolId },
    orderBy: { sortOrder: 'asc' },
  })
  if (scales.length === 0) {
    await db.gradeScale.createMany({
      data: DEFAULT_GRADES.map((g, i) => ({
        schoolId,
        grade: g.grade,
        minPct: g.minPct,
        maxPct: i === 0 ? 100 : DEFAULT_GRADES[i - 1].minPct - 0.01,
        color: g.color,
        sortOrder: i,
      })),
    })
    scales = await db.gradeScale.findMany({ where: { schoolId }, orderBy: { sortOrder: 'asc' } })
  }
  return scales.map((s) => ({ id: s.id, schoolId: s.schoolId, grade: s.grade, minPct: s.minPct, maxPct: s.maxPct, color: s.color, sortOrder: s.sortOrder }))
}

export async function createGradeScale(schoolId: string, data: { grade: string; minPct: number; maxPct: number; color?: string }): Promise<GradeScaleDTO> {
  const existing = await db.gradeScale.findFirst({ where: { schoolId, grade: data.grade } })
  if (existing) throw new Error('Grade already exists')
  const count = await db.gradeScale.count({ where: { schoolId } })
  const s = await db.gradeScale.create({
    data: { schoolId, grade: data.grade.trim(), minPct: data.minPct, maxPct: data.maxPct, color: data.color, sortOrder: count },
  })
  return { id: s.id, schoolId: s.schoolId, grade: s.grade, minPct: s.minPct, maxPct: s.maxPct, color: s.color, sortOrder: s.sortOrder }
}

export async function updateGradeScale(schoolId: string, id: string, data: { grade?: string; minPct?: number; maxPct?: number; color?: string }): Promise<GradeScaleDTO> {
  // Tenant guard (audit 3-b CRITICAL): the row must exist in the CALLER's
  // school before any mutation — foreign ids 404 instead of updating.
  const existing = await db.gradeScale.findFirst({ where: { id, schoolId } })
  if (!existing) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Grade scale not found',
      internalDetail: `updateGradeScale: id ${id} missing or foreign tenant`,
    })
  }
  const s = await db.gradeScale.update({
    where: { id: existing.id },
    data: {
      ...(data.grade !== undefined ? { grade: data.grade } : {}),
      ...(data.minPct !== undefined ? { minPct: data.minPct } : {}),
      ...(data.maxPct !== undefined ? { maxPct: data.maxPct } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    },
  })
  return { id: s.id, schoolId: s.schoolId, grade: s.grade, minPct: s.minPct, maxPct: s.maxPct, color: s.color, sortOrder: s.sortOrder }
}

export async function deleteGradeScale(schoolId: string, id: string): Promise<void> {
  // Tenant guard (audit 3-b CRITICAL): delete scoped to the caller's school.
  const existing = await db.gradeScale.findFirst({ where: { id, schoolId } })
  if (!existing) {
    throw new AppError('NOT_FOUND', {
      publicMessage: 'Grade scale not found',
      internalDetail: `deleteGradeScale: id ${id} missing or foreign tenant`,
    })
  }
  await db.gradeScale.delete({ where: { id: existing.id } })
}

// ─── Exam Rules (key-value) ─────────────────────────────────────────

const DEFAULT_RULES: Record<string, string> = {
  defaultMaxMarks: '100',
  defaultPassMarks: '33',
  passPercentage: '33',
  graceMarksLimit: '5',
  roundingMethod: 'round', // round, floor, ceil
  rankCalculation: 'percentage', // percentage, total
  tieHandling: 'share', // share, skip
  compartmentThreshold: '1', // subjects failed → compartment
  retestThreshold: '2',
  requireVerification: 'true',
  requireLockBeforeDeclare: 'true',
  allowTeacherEdits: 'true',
  principalOnlyOverride: 'true',
  attendanceRequired: 'false',
  attendanceThreshold: '75', // %
  resultPublication: 'manual', // manual, auto
  defaultExamDuration: '180', // minutes
}

export async function listExamRules(schoolId: string): Promise<Record<string, string>> {
  let rules = await db.examRule.findMany({ where: { schoolId } })
  if (rules.length === 0) {
    await db.examRule.createMany({
      data: Object.entries(DEFAULT_RULES).map(([key, value]) => ({ schoolId, key, value })),
    })
    rules = await db.examRule.findMany({ where: { schoolId } })
  }
  const result: Record<string, string> = {}
  for (const r of rules) result[r.key] = r.value
  // Fill defaults for any missing keys
  for (const [k, v] of Object.entries(DEFAULT_RULES)) {
    if (!(k in result)) result[k] = v
  }
  return result
}

export async function updateExamRule(schoolId: string, key: string, value: string): Promise<void> {
  await db.examRule.upsert({
    where: { schoolId_key: { schoolId, key } },
    create: { schoolId, key, value },
    update: { value },
  })
}

export async function updateManyExamRules(schoolId: string, rules: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(rules)) {
    await db.examRule.upsert({
      where: { schoolId_key: { schoolId, key } },
      create: { schoolId, key, value },
      update: { value },
    })
  }
}

// ─── Admit Card Config ───────────────────────────────────────────────

export async function getAdmitCardConfig(schoolId: string): Promise<AdmitCardConfigDTO> {
  let config = await db.admitCardConfig.findUnique({ where: { schoolId } })
  if (!config) {
    config = await db.admitCardConfig.create({ data: { schoolId } })
  }
  return {
    showPhoto: config.showPhoto,
    showRollNumber: config.showRollNumber,
    showRoom: config.showRoom,
    showSeatNumber: config.showSeatNumber,
    showTimetable: config.showTimetable,
    showInstructions: config.showInstructions,
    showQrCode: config.showQrCode,
  }
}

export async function updateAdmitCardConfig(schoolId: string, data: Partial<AdmitCardConfigDTO>): Promise<AdmitCardConfigDTO> {
  const config = await db.admitCardConfig.upsert({
    where: { schoolId },
    create: { schoolId, ...data },
    update: data,
  })
  return {
    showPhoto: config.showPhoto,
    showRollNumber: config.showRollNumber,
    showRoom: config.showRoom,
    showSeatNumber: config.showSeatNumber,
    showTimetable: config.showTimetable,
    showInstructions: config.showInstructions,
    showQrCode: config.showQrCode,
  }
}

// ─── Report Card Config ─────────────────────────────────────────────

export async function getReportCardConfig(schoolId: string): Promise<ReportCardConfigDTO> {
  let config = await db.reportCardConfig.findUnique({ where: { schoolId } })
  if (!config) {
    config = await db.reportCardConfig.create({ data: { schoolId } })
  }
  return {
    showAttendance: config.showAttendance,
    showRank: config.showRank,
    showPercentage: config.showPercentage,
    showGrade: config.showGrade,
    showCoScholastic: config.showCoScholastic,
    showRemarks: config.showRemarks,
    showClassTeacherSign: config.showClassTeacherSign,
    showPrincipalSign: config.showPrincipalSign,
  }
}

export async function updateReportCardConfig(schoolId: string, data: Partial<ReportCardConfigDTO>): Promise<ReportCardConfigDTO> {
  const config = await db.reportCardConfig.upsert({
    where: { schoolId },
    create: { schoolId, ...data },
    update: data,
  })
  return {
    showAttendance: config.showAttendance,
    showRank: config.showRank,
    showPercentage: config.showPercentage,
    showGrade: config.showGrade,
    showCoScholastic: config.showCoScholastic,
    showRemarks: config.showRemarks,
    showClassTeacherSign: config.showClassTeacherSign,
    showPrincipalSign: config.showPrincipalSign,
  }
}
