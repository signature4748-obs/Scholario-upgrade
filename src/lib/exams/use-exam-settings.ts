// ──────────────────────────────────────────────────────────────────────
// use-exam-settings — React hooks for the Examination Settings API.
// All settings are school-scoped and persisted to the DB.
// DTOs are imported from ./types — no duplicate definitions here.
// ──────────────────────────────────────────────────────────────────────

'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from './api-client'
import type {
  ExamTypeConfigDTO,
  GradeScaleDTO,
  AdmitCardConfigDTO,
  ReportCardConfigDTO,
} from './types'
import { DEFAULT_GRADE_BOUNDARIES, EXAM_TYPES } from './types'

// Default exam rules (used as fallback in mock mode).
const DEFAULT_EXAM_RULES: Record<string, string> = {
  passPercentage: '33',
  graceMaxMarks: '5',
  retestWindowDays: '7',
  resultDeclarationLockHours: '24',
  autoPromoteOnPass: 'true',
  compartmentExamEnabled: 'true',
  retestEnabled: 'true',
}

// Re-export DTOs for backward compatibility with existing callers
export type {
  ExamTypeConfigDTO,
  GradeScaleDTO,
  AdmitCardConfigDTO,
  ReportCardConfigDTO,
}

// ─── Exam Types ───────────────────────────────────────────────────────

export function useExamTypes() {
  const [types, setTypes] = useState<ExamTypeConfigDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<ExamTypeConfigDTO[]>('/api/exams/settings/types')
      .then((d) => {
        if (cancelled) return
        if (d && d.length > 0) {
          setTypes(d)
        } else {
          // Fallback to EXAM_TYPES defaults.
          setTypes(EXAM_TYPES.map((name, i) => ({
            id: `default-type-${i}`,
            schoolId: 'demo-school',
            name,
            code: name.substring(0, 3).toUpperCase(),
            enabled: true,
            sortOrder: i,
          })))
        }
      })
      .catch(() => {
        // PHASE 6 (§8) — fail HONESTLY: a failed load shows the real
        // "no exam types configured" state (the Add flow persists through
        // the server). The previous silent mock-mode fallback fabricated
        // rows the server never had.
        if (cancelled) return
        setTypes([])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  // PHASE 6 (§8) — mutations go through the REAL API and surface the
  // server's error to the caller (the settings tab shows the toast). The
  // previous "mock mode" catch blocks mutated local state, making failed
  // saves look successful (silent data loss).
  const create = useCallback(async (data: { name: string; code?: string }) => {
    await api('/api/exams/settings/types', { method: 'POST', json: data })
    reload()
  }, [reload])

  const update = useCallback(async (id: string, data: { name?: string; code?: string; enabled?: boolean }) => {
    await api(`/api/exams/settings/types/${id}`, { method: 'PATCH', json: data })
    reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await api(`/api/exams/settings/types/${id}`, { method: 'DELETE' })
    reload()
  }, [reload])

  return { types, loading, reload, create, update, remove }
}

// ─── Grade Scales ─────────────────────────────────────────────────────

export function useGradeScales() {
  const [scales, setScales] = useState<GradeScaleDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<GradeScaleDTO[]>('/api/exams/settings/grades')
      .then((d) => {
        if (cancelled) return
        // If API returns empty or fails, fall back to DEFAULT_GRADE_BOUNDARIES.
        if (d && d.length > 0) {
          setScales(d)
        } else {
          setScales(DEFAULT_GRADE_BOUNDARIES.map((g, i) => ({
            id: `default-grade-${i}`,
            schoolId: 'demo-school',
            grade: g.grade,
            minPct: g.minPct,
            maxPct: g.minPct === 0 ? 33 : g.minPct === 33 ? 49 : g.minPct === 90 ? 100 : g.minPct + 9,
            color: g.color,
            sortOrder: i,
          })))
        }
      })
      .catch(() => {
        if (cancelled) return
        // PHASE 6 (§8) — fail honestly (no fabricated "mock mode" rows).
        setScales([])
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  // PHASE 6 (§8) — mutations surface the server error to the caller
  // (silent local fallback = silent data loss).
  const create = useCallback(async (data: { grade: string; minPct: number; maxPct: number; color?: string }) => {
    await api('/api/exams/settings/grades', { method: 'POST', json: data })
    reload()
  }, [reload])

  const update = useCallback(async (id: string, data: { grade?: string; minPct?: number; maxPct?: number; color?: string }) => {
    await api(`/api/exams/settings/grades/${id}`, { method: 'PATCH', json: data })
    reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await api(`/api/exams/settings/grades/${id}`, { method: 'DELETE' })
    reload()
  }, [reload])

  return { scales, loading, reload, create, update, remove }
}

// ─── Exam Rules ───────────────────────────────────────────────────────

export function useExamRules() {
  const [rules, setRules] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<Record<string, string>>('/api/exams/settings/rules')
      .then((d) => {
        if (cancelled) return
        if (d && Object.keys(d).length > 0) {
          setRules(d)
        } else {
          setRules(DEFAULT_EXAM_RULES)
        }
      })
      .catch(() => {
        if (cancelled) return
        // PHASE 6 (§8) — fail honestly (no "mock mode" rule fabrication).
        setRules({})
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  const save = useCallback(async (updatedRules: Record<string, string>) => {
    // PHASE 6 (§8) — the server save must succeed; a failure surfaces to
    // the caller instead of silently pretending the rules were saved.
    await api('/api/exams/settings/rules', { method: 'PUT', json: { rules: updatedRules } })
    reload()
  }, [reload])

  return { rules, loading, reload, save }
}

// ─── Admit Card Config ────────────────────────────────────────────────

const DEFAULT_ADMIT_CARD_CONFIG: AdmitCardConfigDTO = {
  showPhoto: false,
  showRollNumber: true,
  showRoom: true,
  showSeatNumber: true,
  showTimetable: true,
  showInstructions: true,
  showQrCode: false,
}

export function useAdmitCardConfig() {
  const [config, setConfig] = useState<AdmitCardConfigDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<AdmitCardConfigDTO>('/api/exams/settings/admit-card')
      .then((d) => !cancelled && setConfig(d ?? DEFAULT_ADMIT_CARD_CONFIG))
      .catch(() => !cancelled && setConfig(DEFAULT_ADMIT_CARD_CONFIG))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  const save = useCallback(async (updated: Partial<AdmitCardConfigDTO>) => {
    // PHASE 6 (§8) — the server save must succeed; failures surface to
    // the settings tab's own error handling (no silent local fallback).
    await api('/api/exams/settings/admit-card', { method: 'PUT', json: updated })
    reload()
  }, [reload])

  return { config, loading, reload, save }
}

// ─── Report Card Config ───────────────────────────────────────────────

const DEFAULT_REPORT_CARD_CONFIG: ReportCardConfigDTO = {
  showAttendance: true,
  showRank: true,
  showPercentage: true,
  showGrade: true,
  showCoScholastic: false,
  showRemarks: true,
  showClassTeacherSign: true,
  showPrincipalSign: true,
}

export function useReportCardConfig() {
  const [config, setConfig] = useState<ReportCardConfigDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<ReportCardConfigDTO>('/api/exams/settings/report-card')
      .then((d) => !cancelled && setConfig(d ?? DEFAULT_REPORT_CARD_CONFIG))
      .catch(() => !cancelled && setConfig(DEFAULT_REPORT_CARD_CONFIG))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  const save = useCallback(async (updated: Partial<ReportCardConfigDTO>) => {
    // PHASE 6 (§8) — the server save must succeed; failures surface to
    // the settings tab's own error handling (no silent local fallback).
    await api('/api/exams/settings/report-card', { method: 'PUT', json: updated })
    reload()
  }, [reload])

  return { config, loading, reload, save }
}
