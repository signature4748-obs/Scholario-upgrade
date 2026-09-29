// ──────────────────────────────────────────────────────────────────────
// Exams API request schemas (Phase 2 — audit 3-b fix 8).
//
// STRICT zod schemas for every exam-domain mutation that previously read
// `req.json()` raw: ids are opaque tokens, numbers bounded, arrays capped,
// enums closed. Server-side only — imported exclusively by the API routes
// under src/app/api/exams/** (never bundled into client code).
// ──────────────────────────────────────────────────────────────────────

import { z } from 'zod'
import { idSchema, safeText } from '@/lib/security/validation'
import { MARK_STATUSES, OUTCOMES } from './types'

/** "YYYY-MM-DD" that is also a real calendar date. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'invalid calendar date')

/** "HH:MM" 24h clock. */
const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM')

const markStatusSchema = z.enum(MARK_STATUSES)

// ─── Marks entry ──────────────────────────────────────────────────────

export const setMarkSchema = z
  .object({
    classId: idSchema,
    subjectId: idSchema,
    studentId: idSchema,
    marksObtained: z.union([z.number().min(0).max(10_000), z.null()]).optional(),
    status: markStatusSchema.optional(),
    remarks: safeText(500, 0).optional(),
  })
  .strict()

export const setMarksBatchSchema = z
  .object({
    marks: z.array(setMarkSchema).max(500, 'at most 500 mark rows per batch'),
  })
  .strict()

export const marksWorkflowFilterSchema = z
  .object({
    classId: idSchema.optional(),
    subjectId: idSchema.optional(),
  })
  .strict()

// ─── CSV import ───────────────────────────────────────────────────────

export const importMarksSchema = z
  .object({
    classId: idSchema,
    subjectId: idSchema,
    rows: z
      .array(
        z
          .object({
            rollNo: safeText(32),
            studentName: safeText(200, 0).optional(),
            marksObtained: z.union([z.number().min(0).max(10_000), z.null()]).optional(),
            status: markStatusSchema.optional(),
            remarks: safeText(500, 0).optional(),
          })
          .strict(),
      )
      .max(1000, 'at most 1000 rows per import'),
  })
  .strict()

// ─── Schedule ─────────────────────────────────────────────────────────

export const scheduleItemSchema = z
  .object({
    classId: idSchema,
    subjectId: idSchema,
    date: isoDateSchema,
    startTime: hhmmSchema,
    endTime: hhmmSchema,
    room: safeText(100, 0).optional(),
    invigilatorName: safeText(200, 0).optional(),
  })
  .strict()

export const scheduleItemUpdateSchema = z
  .object({
    date: isoDateSchema.optional(),
    startTime: hhmmSchema.optional(),
    endTime: hhmmSchema.optional(),
    room: safeText(100, 0).optional(),
    invigilatorId: idSchema.nullable().optional(),
    invigilatorName: safeText(200, 0).nullable().optional(),
  })
  .strict()
// ─── Attendance / grace / seating / admit cards / invigilator ─────────

export const examAttendanceSchema = z
  .object({
    scheduleItemId: idSchema.optional(),
    classId: idSchema,
    studentId: idSchema,
    subjectId: idSchema.optional(),
    date: isoDateSchema,
    status: markStatusSchema.optional(),
    remarks: safeText(500).optional(),
  })
  .strict()

export const graceMarksSchema = z
  .object({
    markId: idSchema,
    graceMarks: z.number().min(0).max(100),
    reason: safeText(500),
  })
  .strict()

export const seatingGenerateSchema = z
  .object({
    classId: idSchema,
    rooms: z
      .array(
        z
          .object({
            name: safeText(100),
            capacity: z.number().int().min(1).max(2000),
          })
          .strict(),
      )
      .max(50, 'at most 50 rooms'),
  })
  .strict()

export const admitCardsSchema = z
  .object({
    classId: idSchema,
    studentIds: z.array(idSchema).max(2000).optional(),
  })
  .strict()

export const invigilatorAssignSchema = z
  .object({
    scheduleItemId: idSchema,
    /** A teacher id, or null/'' to release the assignment. */
    teacherId: z.union([idSchema, z.literal(''), z.null()]).optional(),
  })
  .strict()

// ─── Outcomes / publication ───────────────────────────────────────────

export const outcomeOverrideSchema = z
  .object({
    outcome: z.enum(OUTCOMES),
    reason: safeText(500).optional(),
    notes: safeText(2000).optional(),
  })
  .strict()

export const publishResultsSchema = z
  .object({
    notifyStudents: z.boolean().optional(),
    notifyParents: z.boolean().optional(),
  })
  .strict()

// ─── Exam settings mutations ──────────────────────────────────────────

export const examTypeCreateSchema = z
  .object({
    name: safeText(100),
    code: safeText(20, 0).optional(),
  })
  .strict()

export const examTypeUpdateSchema = z
  .object({
    name: safeText(100).optional(),
    code: safeText(20, 0).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const pctSchema = z.number().min(0).max(100)

export const gradeScaleCreateSchema = z
  .object({
    grade: safeText(10),
    minPct: pctSchema,
    maxPct: pctSchema,
    color: safeText(30, 0).optional(),
  })
  .strict()

export const gradeScaleUpdateSchema = z
  .object({
    grade: safeText(10).optional(),
    minPct: pctSchema.optional(),
    maxPct: pctSchema.optional(),
    color: safeText(30, 0).optional(),
  })
  .strict()

export const examRulesPutSchema = z
  .object({
    rules: z
      .record(z.string().max(64), z.string().max(200))
      .refine((r) => Object.keys(r).length <= 60, 'at most 60 rules per update'),
  })
  .strict()

export const admitCardConfigSchema = z
  .object({
    showPhoto: z.boolean().optional(),
    showRollNumber: z.boolean().optional(),
    showRoom: z.boolean().optional(),
    showSeatNumber: z.boolean().optional(),
    showTimetable: z.boolean().optional(),
    showInstructions: z.boolean().optional(),
    showQrCode: z.boolean().optional(),
  })
  .strict()

export const reportCardConfigSchema = z
  .object({
    showAttendance: z.boolean().optional(),
    showRank: z.boolean().optional(),
    showPercentage: z.boolean().optional(),
    showGrade: z.boolean().optional(),
    showCoScholastic: z.boolean().optional(),
    showRemarks: z.boolean().optional(),
    showClassTeacherSign: z.boolean().optional(),
    showPrincipalSign: z.boolean().optional(),
  })
  .strict()
