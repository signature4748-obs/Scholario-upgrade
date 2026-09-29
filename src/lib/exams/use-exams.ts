// ──────────────────────────────────────────────────────────────────────
// useExams — client-side React hook that talks to the examinations API.
// No localStorage, no mock data. Reads/writes only from the real Prisma
// backend via /api/exams/* routes.
// ──────────────────────────────────────────────────────────────────────

'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from './api-client'
import {
  type ExamDTO,
  type ExamClassDTO,
  type StudentDTO,
  type ExamMarkDTO,
  type CreateExamInput,
  type SetMarkInput,
  type AuditLogDTO,
  type StudentResult,
  type ExamAnalyticsDTO,
  type MarkStatus,
} from '@/lib/exams/types'

// ─── List hook ─────────────────────────────────────────────────────────

interface ClassesDTO {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
  stream: string | null
  studentCount: number
  subjects: Array<{ id: string; name: string; code: string | null; fullMarks: number; passMarks: number }>
}

export function useExamsList() {
  const [exams, setExams] = useState<ExamDTO[]>([])
  const [classes, setClasses] = useState<ClassesDTO[]>([])
  const [academicYear, setAcademicYear] = useState('2025-2026')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<{ exams: ExamDTO[]; classes: ClassesDTO[]; academicYear: string }>('/api/exams')
      .then((data) => {
        if (cancelled) return
        setExams(data.exams)
        setClasses(data.classes)
        setAcademicYear(data.academicYear ?? '2025-2026')
        setError(null)
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  return { exams, classes, academicYear, loading, error, reload }
}

// ─── Single exam hook ──────────────────────────────────────────────────

export function useExam(examId: string | null) {
  const [exam, setExam] = useState<ExamDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setExam(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    api<ExamDTO>(`/api/exams/${examId}`)
      .then((d) => { if (!cancelled) { setExam(d); setError(null) } })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, reloadKey])

  return { exam, loading, error, reload, setExam }
}

// ─── Marks for class+subject ───────────────────────────────────────────

export function useMarks(examId: string | null, classId: string | null, subjectId: string | null) {
  const [students, setStudents] = useState<StudentDTO[]>([])
  const [marks, setMarks] = useState<ExamMarkDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId || !classId || !subjectId) { setStudents([]); setMarks([]); return }
    let cancelled = false
    setLoading(true)
    api<{ students: StudentDTO[]; marks: ExamMarkDTO[] }>(
      `/api/exams/${examId}/marks?classId=${classId}&subjectId=${subjectId}`
    )
      .then((d) => { if (!cancelled) { setStudents(d.students); setMarks(d.marks); setError(null) } })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, classId, subjectId, reloadKey])

  return { students, marks, loading, error, reload, setMarks }
}

// ─── Mutations ─────────────────────────────────────────────────────────

export function useCreateExam() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useCallback(async (input: CreateExamInput): Promise<ExamDTO> => {
    setLoading(true)
    try {
      const result = await api<ExamDTO>('/api/exams', { method: 'POST', body: JSON.stringify(input) })
      setError(null)
      return result
    } catch (e: any) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])
  return { create, loading, error }
}

export function useUpdateExam() {
  const [loading, setLoading] = useState(false)
  const update = useCallback(async (examId: string, updates: Partial<CreateExamInput> & { status?: string }): Promise<ExamDTO> => {
    setLoading(true)
    try {
      const result = await api<ExamDTO>(`/api/exams/${examId}`, { method: 'PATCH', body: JSON.stringify(updates) })
      return result
    } finally {
      setLoading(false)
    }
  }, [])
  return { update, loading }
}

export function useDeleteExam() {
  const [loading, setLoading] = useState(false)
  const remove = useCallback(async (examId: string): Promise<void> => {
    setLoading(true)
    try {
      await api<{ deleted: boolean }>(`/api/exams/${examId}`, { method: 'DELETE' })
    } finally {
      setLoading(false)
    }
  }, [])
  return { remove, loading }
}

export function useSetMark() {
  const [loading, setLoading] = useState(false)
  const set = useCallback(async (
    examId: string,
    input: SetMarkInput
  ): Promise<ExamMarkDTO> => {
    setLoading(true)
    try {
      const result = await api<ExamMarkDTO>(`/api/exams/${examId}/marks/single`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return result
    } finally {
      setLoading(false)
    }
  }, [])
  return { set, loading }
}

interface WorkflowResult { submitted?: number; verified?: number; locked?: number; declared?: boolean }

export function useSubmitMarks() {
  const [loading, setLoading] = useState(false)
  const submit = useCallback(async (
    examId: string,
    filter: { classId?: string; subjectId?: string }
  ): Promise<WorkflowResult> => {
    setLoading(true)
    try {
      return await api<WorkflowResult>(`/api/exams/${examId}/marks/submit`, {
        method: 'POST',
        body: JSON.stringify(filter),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { submit, loading }
}

export function useVerifyMarks() {
  const [loading, setLoading] = useState(false)
  const verify = useCallback(async (
    examId: string,
    filter: { classId?: string; subjectId?: string }
  ): Promise<WorkflowResult> => {
    setLoading(true)
    try {
      return await api<WorkflowResult>(`/api/exams/${examId}/marks/verify`, {
        method: 'POST',
        body: JSON.stringify(filter),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { verify, loading }
}

export function useLockMarks() {
  const [loading, setLoading] = useState(false)
  const lock = useCallback(async (
    examId: string,
    filter: { classId?: string; subjectId?: string }
  ): Promise<WorkflowResult> => {
    setLoading(true)
    try {
      return await api<WorkflowResult>(`/api/exams/${examId}/marks/lock`, {
        method: 'POST',
        body: JSON.stringify(filter),
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { lock, loading }
}

export function useDeclareResults() {
  const [loading, setLoading] = useState(false)
  const declare = useCallback(async (examId: string): Promise<WorkflowResult> => {
    setLoading(true)
    try {
      return await api<WorkflowResult>(`/api/exams/${examId}/results/declare`, {
        method: 'POST',
        body: '{}',
      })
    } finally {
      setLoading(false)
    }
  }, [])
  return { declare, loading }
}

// ─── Schedule mutations ────────────────────────────────────────────────

export interface ScheduleItemInput {
  classId: string
  subjectId: string
  date: string
  startTime: string
  endTime: string
  room?: string
  invigilatorName?: string
}

export function useAddScheduleItem() {
  const [loading, setLoading] = useState(false)
  const add = useCallback(async (examId: string, input: ScheduleItemInput): Promise<void> => {
    setLoading(true)
    try {
      await api(`/api/exams/${examId}/schedule`, { method: 'POST', body: JSON.stringify(input) })
    } finally {
      setLoading(false)
    }
  }, [])
  return { add, loading }
}

export function useDeleteScheduleItem() {
  const [loading, setLoading] = useState(false)
  const remove = useCallback(async (examId: string, itemId: string): Promise<void> => {
    setLoading(true)
    try {
      await api(`/api/exams/${examId}/schedule/items/${itemId}`, { method: 'DELETE' })
    } finally {
      setLoading(false)
    }
  }, [])
  return { remove, loading }
}

// ─── Results hook ─────────────────────────────────────────────────────

export interface ClassResultsDTO {
  students: StudentDTO[]
  subjects: ExamDTO['subjects']
  marks: ExamMarkDTO[]
  results: StudentResult[]
  analytics: ExamAnalyticsDTO
}

export function useClassResults(examId: string | null, classId: string | null) {
  const [data, setData] = useState<ClassResultsDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId || !classId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    api<ClassResultsDTO>(`/api/exams/${examId}/results/class/${classId}`)
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, classId, reloadKey])

  return { data, loading, error, reload }
}

// ─── Audit logs hook ───────────────────────────────────────────────────

export function useAuditLogs(examId: string | null) {
  const [logs, setLogs] = useState<AuditLogDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!examId) { setLogs([]); return }
    let cancelled = false
    setLoading(true)
    api<AuditLogDTO[]>(`/api/exams/${examId}/audit`)
      .then((d) => !cancelled && setLogs(d))
      .catch(() => !cancelled && setLogs([]))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [examId, reloadKey])

  return { logs, loading, reload }
}

// Re-export types
export type { ExamDTO, ExamClassDTO, StudentDTO, ExamMarkDTO, AuditLogDTO, StudentResult, ExamAnalyticsDTO, MarkStatus, CreateExamInput, SetMarkInput }
