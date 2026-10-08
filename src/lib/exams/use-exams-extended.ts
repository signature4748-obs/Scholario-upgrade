// ──────────────────────────────────────────────────────────────────────
// use-exams-extended — React hooks for P1 & P2 exam features.
// ──────────────────────────────────────────────────────────────────────

'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from './api-client'
import {
  type ExamDTO,
  type ScheduleItemDTO,
  type SeatAssignmentDTO,
  type ExamAttendanceDTO,
  type ResultOutcomeDTO,
  type CsvImportRow,
  type CsvImportResult,
  type AdmitCardStudent,
  type Outcome,
  type MarkStatus,
} from './types'

// Re-export for backward compatibility with existing callers
export type {
  SeatAssignmentDTO,
  ExamAttendanceDTO,
  ResultOutcomeDTO,
  CsvImportRow,
  CsvImportResult,
  AdmitCardStudent,
}

// ─── Schedule item update ─────────────────────────────────────────────

export function useUpdateScheduleItemV2() {
  const [loading, setLoading] = useState(false)
  const update = useCallback(async (
    examId: string,
    itemId: string,
    updates: { date?: string; startTime?: string; endTime?: string; room?: string; invigilatorId?: string | null; invigilatorName?: string | null }
  ): Promise<void> => {
    setLoading(true)
    try {
      await api(`/api/exams/${examId}/schedule/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(updates) })
    } finally {
      setLoading(false)
    }
  }, [])
  return { update, loading }
}

// ─── Invigilator roster ───────────────────────────────────────────────

export interface TeacherDTO {
  id: string
  name: string
  email: string | null
  department: string | null
  employeeId: string | null
  assignedCount: number
}

export function useTeachers(examId: string | null) {
  const [teachers, setTeachers] = useState<TeacherDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setTeachers([]); return }
    let cancelled = false
    setLoading(true)
    api<TeacherDTO[]>(`/api/exams/${examId}/invigilator`)
      .then((d) => !cancelled && setTeachers(d))
      .catch(() => !cancelled && setTeachers([]))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, reloadKey])

  return { teachers, loading, reload }
}

export function useAssignInvigilator() {
  const [loading, setLoading] = useState(false)
  const assign = useCallback(async (
    examId: string,
    scheduleItemId: string,
    teacherId: string | null
  ): Promise<ScheduleItemDTO> => {
    setLoading(true)
    try {
      return await api<ScheduleItemDTO>(`/api/exams/${examId}/invigilator`, {
        method: 'POST',
        body: JSON.stringify({ scheduleItemId, teacherId }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { assign, loading }
}

// ─── Duty roster (principal's Invigilation tab) ───────────────────────

export interface DutyPaperDTO {
  id: string
  examId: string
  date: string
  startTime: string
  endTime: string
  room: string | null
  className: string
  subjectName: string
  invigilatorId: string | null
  invigilatorName: string | null
}

export interface DutyExamDTO {
  id: string
  name: string
  type: string
  status: string
  startDate: string | null
  endDate: string | null
  papers: DutyPaperDTO[]
}

export interface DutyRosterDTO {
  todayKey: string
  exams: DutyExamDTO[]
  teachers: TeacherDTO[]
}

export function useDutyRoster(enabled = true) {
  const [roster, setRoster] = useState<DutyRosterDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!enabled) { setRoster(null); return }
    let cancelled = false
    setLoading(true)
    api<DutyRosterDTO>('/api/exams/duties')
      .then((d) => { if (!cancelled) { setRoster(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, reloadKey])

  return { roster, loading, error, reload }
}

// ─── Seating plan ─────────────────────────────────────────────────────

export function useSeatingPlan(examId: string | null, classId: string | null) {
  const [seats, setSeats] = useState<SeatAssignmentDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setSeats([]); return }
    let cancelled = false
    setLoading(true)
    const url = `/api/exams/${examId}/seating${classId ? `?classId=${classId}` : ''}`
    api<SeatAssignmentDTO[]>(url)
      .then((d) => !cancelled && setSeats(d))
      .catch(() => !cancelled && setSeats([]))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, classId, reloadKey])

  return { seats, loading, reload }
}

export function useGenerateSeating() {
  const [loading, setLoading] = useState(false)
  const generate = useCallback(async (
    examId: string,
    classId: string,
    rooms: Array<{ name: string; capacity: number }>
  ): Promise<{ generated: number }> => {
    setLoading(true)
    try {
      return await api<{ generated: number }>(`/api/exams/${examId}/seating/generate`, {
        method: 'POST',
        body: JSON.stringify({ classId, rooms }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { generate, loading }
}

// ─── Exam attendance ──────────────────────────────────────────────────

/**
 * Real ExamAttendance rows (GET /api/exams/[id]/attendance). `classId`
 * narrows the server query; pass null for the whole examination (rows are
 * then filtered client-side per paper scope). Errors are surfaced — never
 * silently swallowed into an empty list.
 */
export function useExamAttendance(examId: string | null, classId: string | null) {
  const [attendance, setAttendance] = useState<ExamAttendanceDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setAttendance([]); setError(null); return }
    let cancelled = false
    setLoading(true)
    const url = `/api/exams/${examId}/attendance${classId ? `?classId=${classId}` : ''}`
    api<ExamAttendanceDTO[]>(url)
      .then((d) => { if (!cancelled) { setAttendance(d); setError(null) } })
      .catch((e: { message?: string }) => {
        if (!cancelled) { setAttendance([]); setError(e?.message ?? 'Failed to load exam attendance') }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, classId, reloadKey])

  return { attendance, loading, error, reload }
}

/** Body shape accepted by POST /api/exams/[id]/attendance (one row per call). */
export interface MarkExamAttendanceInput {
  scheduleItemId?: string
  classId: string
  studentId: string
  subjectId: string
  /** YYYY-MM-DD */
  date: string
  status: MarkStatus
  remarks?: string
}

/**
 * Upsert one ExamAttendance row (POST /api/exams/[id]/attendance).
 * Server identity: examId + studentId + subjectId + date — re-posting the
 * same row updates it, so re-saves are idempotent.
 */
export function useMarkAttendance() {
  const [loading, setLoading] = useState(false)
  const mark = useCallback(async (examId: string, input: MarkExamAttendanceInput): Promise<{ upserted: boolean }> => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        classId: input.classId,
        studentId: input.studentId,
        subjectId: input.subjectId,
        date: input.date,
        status: input.status,
      }
      if (input.scheduleItemId) body.scheduleItemId = input.scheduleItemId
      // zod safeText(500) rejects empty strings (min 1) — omit instead of send ''.
      const remarks = input.remarks?.trim()
      if (remarks) body.remarks = remarks.slice(0, 500)
      return await api<{ upserted: boolean }>(`/api/exams/${examId}/attendance`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { mark, loading }
}

export function useAutoMarkAttendance() {
  const [loading, setLoading] = useState(false)
  const autoMark = useCallback(async (examId: string, classId: string): Promise<{ marked: number }> => {
    setLoading(true)
    try {
      return await api<{ marked: number }>(`/api/exams/${examId}/attendance/auto`, {
        method: 'POST',
        body: JSON.stringify({ classId }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { autoMark, loading }
}

// ─── Grace marks ──────────────────────────────────────────────────────

export function useApplyGrace() {
  const [loading, setLoading] = useState(false)
  const apply = useCallback(async (
    examId: string,
    markId: string,
    graceMarks: number,
    reason: string
  ): Promise<void> => {
    setLoading(true)
    try {
      await api(`/api/exams/${examId}/grace`, { method: 'POST', body: JSON.stringify({ markId, graceMarks, reason }) })
    } finally {
      setLoading(false)
    }
  }, [])
  return { apply, loading }
}

// ─── Outcomes (Promotion/Compartment/Retest) ─────────────────────────

export function useOutcomes(examId: string | null, classId: string | null) {
  const [outcomes, setOutcomes] = useState<ResultOutcomeDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setOutcomes([]); return }
    let cancelled = false
    setLoading(true)
    const url = `/api/exams/${examId}/outcomes${classId ? `?classId=${classId}` : ''}`
    api<ResultOutcomeDTO[]>(url)
      .then((d) => !cancelled && setOutcomes(d))
      .catch(() => !cancelled && setOutcomes([]))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, classId, reloadKey])

  return { outcomes, loading, reload }
}

export function useComputeOutcomes() {
  const [loading, setLoading] = useState(false)
  const compute = useCallback(async (examId: string, classId: string): Promise<{ autoCount: number }> => {
    setLoading(true)
    try {
      return await api<{ autoCount: number }>(`/api/exams/${examId}/outcomes/compute`, {
        method: 'POST',
        body: JSON.stringify({ classId }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { compute, loading }
}

export function useOverrideOutcome() {
  const [loading, setLoading] = useState(false)
  const override = useCallback(async (
    examId: string,
    studentId: string,
    outcome: Outcome,
    reason?: string,
    notes?: string
  ): Promise<void> => {
    setLoading(true)
    try {
      await api(`/api/exams/${examId}/outcomes/${studentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ outcome, reason, notes }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { override, loading }
}

// ─── CSV Import ───────────────────────────────────────────────────────

export function useImportMarksCsv() {
  const [loading, setLoading] = useState(false)
  const importCsv = useCallback(async (
    examId: string,
    classId: string,
    subjectId: string,
    rows: CsvImportRow[]
  ): Promise<CsvImportResult> => {
    setLoading(true)
    try {
      return await api<CsvImportResult>(`/api/exams/${examId}/marks/import`, {
        method: 'POST',
        body: JSON.stringify({ classId, subjectId, rows }),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { importCsv, loading }
}

export async function downloadCsvTemplate(examId: string, classId: string, subjectId: string): Promise<void> {
  const res = await fetch(`/api/exams/${examId}/marks/template?classId=${classId}&subjectId=${subjectId}`, {
    credentials: 'include',
  })
  const body = await res.json().catch(() => null)
  if (!body?.ok) throw new Error(body?.error || 'Failed to download template')
  const { csv, filename } = body.data
  // Trigger download
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Result Publication ──────────────────────────────────────────────

export function usePublishResults() {
  const [loading, setLoading] = useState(false)
  const publish = useCallback(async (
    examId: string,
    options: { notifyStudents?: boolean; notifyParents?: boolean } = {}
  ): Promise<{ published: boolean; notificationsSent: number }> => {
    setLoading(true)
    try {
      return await api(`/api/exams/${examId}/publish`, {
        method: 'POST',
        body: JSON.stringify(options),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { publish, loading }
}

// ─── Admit Cards Batch ────────────────────────────────────────────────

export async function fetchAdmitCardsBatch(
  examId: string,
  classId: string,
  studentIds?: string[]
): Promise<{ exam: Partial<ExamDTO>; students: AdmitCardStudent[] }> {
  return api(`/api/exams/${examId}/admit-cards`, {
    method: 'POST',
    body: JSON.stringify({ classId, studentIds }),
  })
}
