'use client'

/**
 * student-results-store — the published result set for the Student role
 * ("My Results"), API-BACKED since 7-b (Mock Data Elimination).
 *
 * The STU-58 demo seed (fabricated UT1/UT2/Mid Term marks) is RETIRED.
 * The store starts EMPTY and is hydrated from the REAL server rows via
 * GET /api/results (role-scoped: a STUDENT only ever receives their own
 * Result rows — identity is resolved server-side, a client-supplied
 * studentId can never widen that scope).
 *
 *   hydrate() → GET /api/results
 *            → rows grouped per Exam → AssessmentDef[]
 *            → the caller's subject marks → AssessmentResult[]
 *            → percentages, grades, trend, insights re-derive from REAL
 *              data (no rows → the honest "No published results yet"
 *              state, never another student's marks).
 *
 * Class standings/rank are NOT derived here any more: the student scope
 * of /api/results has no class-wide rows, so the fabricated
 * roster-offset standings are retired (standings are empty; rank is
 * null). Every displayed number comes from the student's own rows.
 */

import { create } from 'zustand'
import { useEffect, useMemo } from 'react'
import { useStudentsStore, useMyStudentRecord } from '@/lib/store/students-store'
import { useSchoolSettingsStore } from '@/lib/store/school-settings-store'

/* ─── Types ────────────────────────────────────────────────────────── */

export type AssessmentType = 'Unit Test' | 'Mid Term' | 'Final'

/**
 * Student-visible lifecycle: an assessment is PUBLISHED when result rows
 * exist for the student (the staff publish/declare flow writes them).
 */
export interface AssessmentDef {
  id: string
  name: string
  type: AssessmentType
  term: 'Term 1' | 'Term 2'
  /** ISO date — first exam day. */
  conductedFrom: string
  /** ISO date — last exam day. */
  conductedTo: string
  /** ISO date the result was published, or null while upcoming. */
  publishDate: string | null
  /** For upcoming assessments: the student-facing expectation line. */
  expectedBy?: string
}

/** One component of a subject's assessment (only when the school's
 *  structure uses it — the DB Result rows are single-paper, so API-derived
 *  rows never carry components). */
export interface MarkComponent {
  name: string
  max: number
  obtained: number
}

export interface SubjectMark {
  subject: string
  maxMarks: number
  obtained: number
  /** Dynamic component breakdown — absent for single-paper assessments. */
  components?: MarkComponent[]
}

export interface ResultRemark {
  text: string
  by: string
  role: string
}

/** The published result row for one student in one assessment. */
export interface AssessmentResult {
  assessmentId: string
  studentId: string
  subjects: SubjectMark[]
  remark?: ResultRemark
}

export type ResultsFetchStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface StudentResultsState {
  assessments: AssessmentDef[]
  results: AssessmentResult[]
  status: ResultsFetchStatus
  /** First error message while hydrating (null when none). */
  error: string | null
  /**
   * Fetch the caller's OWN published results (server-scoped) and replace
   * the store. In-flight guarded; a 60s freshness window prevents
   * duplicate fetches when several surfaces mount at once.
   */
  hydrate: () => Promise<void>
}

/* ─── API row shape (GET /api/results, STUDENT scope) ───────────────── */

interface ResultRowDTO {
  studentId: string
  examId: string
  marks: number
  totalMarks: number
  remarks: string | null
  createdAt: string
  subject?: { name?: string | null } | null
  exam?: {
    name?: string | null
    type?: string | null
    term?: string | null
    startDate?: string | null
    endDate?: string | null
    declaredAt?: string | null
  } | null
}

/* ─── Mapping: Result rows → module shapes ─────────────────────────── */

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function normalizeType(raw: string | null | undefined): AssessmentType {
  const v = (raw ?? '').toLowerCase()
  if (v.includes('mid')) return 'Mid Term'
  if (v.includes('final') || v.includes('annual') || v.includes('board')) return 'Final'
  return 'Unit Test'
}

function normalizeTerm(raw: string | null | undefined): 'Term 1' | 'Term 2' {
  const v = (raw ?? '').toLowerCase()
  if (v.includes('2') || v.includes('ii')) return 'Term 2'
  return 'Term 1'
}

/** Group the caller's rows per exam and build the display shapes. */
function mapRows(rows: ResultRowDTO[]): { assessments: AssessmentDef[]; results: AssessmentResult[] } {
  const byExam = new Map<string, ResultRowDTO[]>()
  for (const row of rows) {
    const list = byExam.get(row.examId)
    if (list) list.push(row)
    else byExam.set(row.examId, [row])
  }

  const assessments: AssessmentDef[] = []
  const results: AssessmentResult[] = []

  for (const [examId, examRows] of byExam) {
    const exam = examRows[0]?.exam ?? null
    const sorted = [...examRows].sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? ''))
    const firstCreated = sorted.reduce<string | null>(
      (min, r) => (!min || r.createdAt < min ? r.createdAt : min),
      null,
    )

    const conductedFrom =
      isoDate(exam?.startDate) ?? (isoDate(firstCreated) ?? new Date().toISOString().slice(0, 10))
    const conductedTo = isoDate(exam?.endDate) ?? conductedFrom
    const publishDate = isoDate(exam?.declaredAt) ?? isoDate(firstCreated)

    assessments.push({
      id: examId,
      name: exam?.name ?? 'Examination',
      type: normalizeType(exam?.type),
      term: normalizeTerm(exam?.term),
      conductedFrom,
      conductedTo,
      publishDate,
    })

    results.push({
      assessmentId: examId,
      studentId: examRows[0].studentId,
      subjects: sorted.map((r) => ({
        subject: r.subject?.name ?? 'Subject',
        maxMarks: r.totalMarks > 0 ? r.totalMarks : 100,
        obtained: r.marks,
      })),
      // NOTE: the DB has no remark attribution (by/role), so no remark is
      // fabricated — the Remark section simply renders nothing.
    })
  }

  return { assessments, results }
}

/* ─── Store ─────────────────────────────────────────────────────────── */

const FETCH_FRESH_MS = 60_000
let inFlight: Promise<void> | null = null
let lastFetchedAt = 0

export const useStudentResultsStore = create<StudentResultsState>()((set, get) => ({
  assessments: [],
  results: [],
  status: 'idle',
  error: null,

  hydrate: async () => {
    const now = Date.now()
    if (inFlight || (get().status === 'ready' && now - lastFetchedAt < FETCH_FRESH_MS)) {
      return inFlight ?? Promise.resolve()
    }
    const job = (async () => {
      set({ status: 'loading', error: null })
      try {
        const r = await fetch('/api/results', {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!r.ok) {
          let message = `Results could not load (${r.status}).`
          try {
            const j = await r.json()
            if (j && typeof j === 'object' && typeof j.error === 'string') {
              message = j.error
            }
          } catch {
            /* non-JSON error body — keep the fallback */
          }
          throw new Error(message)
        }
        const j = await r.json()
        if (!j || typeof j !== 'object' || j.ok !== true || !('data' in j)) {
          throw new Error('Unexpected response from the server.')
        }
        const rows = Array.isArray(j.data) ? (j.data as ResultRowDTO[]) : []
        const mapped = mapRows(rows)
        lastFetchedAt = Date.now()
        set({ ...mapped, status: 'ready', error: null })
      } catch (e) {
        set({
          status: 'error',
          error: e instanceof Error ? e.message : 'Results could not load.',
        })
      } finally {
        inFlight = null
      }
    })()
    inFlight = job
    return job
  },
}))

/* ─── Derived helpers — the ONLY place numbers are computed ────────── */

export interface GradeBand {
  threshold: number
  grade: string
}

/** Fallback scale (defensive) — the live one lives in School Settings. */
export const DEFAULT_GRADE_SCALE: GradeBand[] = [
  { threshold: 90, grade: 'A+' },
  { threshold: 80, grade: 'A' },
  { threshold: 70, grade: 'B' },
  { threshold: 60, grade: 'C' },
  { threshold: 50, grade: 'D' },
  { threshold: 0, grade: 'E' },
]

/** Grade for a percentage, from the SCHOOL's configured scale (§11). */
export function gradeFor(pct: number, scale: GradeBand[]): string {
  const bands = scale.length > 0 ? scale : DEFAULT_GRADE_SCALE
  for (const band of bands) {
    if (pct >= band.threshold) return band.grade
  }
  return bands[bands.length - 1]?.grade ?? '—'
}

/** Raw percentage — every displayed value formats via fmtPct (§36). */
export function pctOf(obtained: number, max: number): number {
  if (max <= 0) return 0
  return (obtained / max) * 100
}

/** Centralized academic rounding — ONE rule everywhere (UI + PDF). */
export function fmtPct(pct: number): string {
  return pct.toFixed(1)
}

export interface AssessmentTotals {
  obtained: number
  max: number
  pct: number
}

/** Totals of one published result row (subject marks sum). */
export function totalsOf(result: AssessmentResult): AssessmentTotals {
  const obtained = result.subjects.reduce((sum, s) => sum + s.obtained, 0)
  const max = result.subjects.reduce((sum, s) => sum + s.maxMarks, 0)
  return { obtained, max, pct: pctOf(obtained, max) }
}

/** The student's result row for one assessment (or null). The caller
 *  supplies the resolved session student's id — there is deliberately NO
 *  demo-id default (an implicit default would leak another student's
 *  marks once the canonical roster replaces the mock universe). */
export function resultFor(results: AssessmentResult[], assessmentId: string, studentId: string): AssessmentResult | null {
  return results.find((r) => r.assessmentId === assessmentId && r.studentId === studentId) ?? null
}

/** Published assessments, oldest → newest (the trend/history order). */
export function publishedAssessments(assessments: AssessmentDef[]): AssessmentDef[] {
  return assessments
    .filter((a) => a.publishDate != null)
    .sort((a, b) => (a.publishDate! < b.publishDate! ? -1 : a.publishDate! > b.publishDate! ? 1 : 0))
}

/** Upcoming assessments, next conducted first. (API-derived set has none —
 *  the student's own rows only exist once results are published.) */
export function upcomingAssessments(assessments: AssessmentDef[]): AssessmentDef[] {
  return assessments
    .filter((a) => a.publishDate == null)
    .sort((a, b) => (a.conductedFrom < b.conductedFrom ? -1 : 1))
}

/* ─── Class standings — type kept for consumers, no fabricated data ── */

export interface ClassStanding {
  studentId: string
  name: string
  rollNo: string
  percentage: number
  rank: number
  isMe: boolean
}

/* ─── Trend, insights & snapshot — real derivations only (§12–§14) ─── */

export interface TrendPoint {
  assessmentId: string
  label: string
  fullLabel: string
  pct: number
  grade: string
}

/** Published-assessment trend for the student (oldest → newest). */
export function trendOf(
  assessments: AssessmentDef[],
  results: AssessmentResult[],
  scale: GradeBand[],
  studentId: string,
): TrendPoint[] {
  return publishedAssessments(assessments).flatMap((a) => {
    const r = resultFor(results, a.id, studentId)
    if (!r) return []
    const t = totalsOf(r)
    return [{
      assessmentId: a.id,
      label: a.type === 'Unit Test' ? a.name.replace('Unit Test', 'UT') : a.type,
      fullLabel: a.name,
      pct: t.pct,
      grade: gradeFor(t.pct, scale),
    }]
  })
}

/**
 * Data-derived insight (§13) — a factual statement about the student's
 * own trajectory, or null when there isn't enough history.
 */
export function insightOf(trend: TrendPoint[]): string | null {
  if (trend.length < 2) return null
  const last = trend[trend.length - 1]
  const prev = trend[trend.length - 2]
  const delta = last.pct - prev.pct
  if (delta >= 0.5) {
    return `Your overall performance improved by ${fmtPct(delta)}% compared with ${prev.fullLabel}.`
  }
  if (delta <= -0.5) {
    return `Your overall performance dipped by ${fmtPct(Math.abs(delta))}% compared with ${prev.fullLabel} — a fresh assessment is a fresh chance.`
  }
  return 'Your overall performance has remained stable across the last two assessments.'
}

export interface SubjectSnapshotEntry {
  subject: string
  pct: number
  delta?: number
}

export interface SubjectSnapshot {
  strongest: SubjectSnapshotEntry | null
  needsAttention: SubjectSnapshotEntry | null
  mostImproved: (SubjectSnapshotEntry & { delta: number }) | null
}

/**
 * Subject snapshot (§14) — computed ONLY when at least one published
 * result exists (strongest / needs attention) and two exist (most
 * improved). Respectful academic language, never judgemental.
 */
export function subjectSnapshotOf(
  assessments: AssessmentDef[],
  results: AssessmentResult[],
  studentId: string,
): SubjectSnapshot {
  const order = new Map(publishedAssessments(assessments).map((a) => [a.id, a.publishDate]))
  const byPublishOrder = (a: AssessmentResult, b: AssessmentResult) => {
    const pa = order.get(a.assessmentId) ?? ''
    const pb = order.get(b.assessmentId) ?? ''
    return pa < pb ? -1 : pa > pb ? 1 : 0
  }
  const published = results.filter((r) => r.studentId === studentId).sort(byPublishOrder)
  if (published.length === 0) return { strongest: null, needsAttention: null, mostImproved: null }

  const latest = published[published.length - 1]
  const rows = latest.subjects.map((s) => ({ subject: s.subject, pct: pctOf(s.obtained, s.maxMarks) }))
  const sorted = [...rows].sort((a, b) => b.pct - a.pct)
  const strongest = sorted[0] ? { ...sorted[0] } : null
  const needsAttention = sorted.length > 1 ? { ...sorted[sorted.length - 1] } : null

  // Most improved: latest vs previous, per subject (same subject set).
  let mostImproved: (SubjectSnapshotEntry & { delta: number }) | null = null
  if (published.length >= 2) {
    const previous = published[published.length - 2]
    const prevBy = new Map(previous.subjects.map((s) => [s.subject, s]))
    let best: { subject: string; pct: number; delta: number } | null = null
    for (const row of rows) {
      const p = prevBy.get(row.subject)
      if (!p) continue
      const delta = row.pct - pctOf(p.obtained, p.maxMarks)
      if (!best || delta > best.delta) best = { subject: row.subject, pct: row.pct, delta }
    }
    mostImproved = best && best.delta > 0 ? best : null
  }

  return { strongest, needsAttention, mostImproved }
}

/* ─── Composite reader — everything a Results surface needs ─────────── */

export interface LatestResultSnapshot {
  assessment: AssessmentDef
  result: AssessmentResult
  totals: AssessmentTotals
  grade: string
  /**
   * Class rank from REAL class-wide results — or null when the school has
   * not published a ranking the student can see (7-b: the fabricated
   * roster-offset standings are retired; the student scope of
   * /api/results carries only their own rows).
   */
  rank: number | null
  classSize: number
}

/**
 * useMyResults — the ONE composite reader for Student Results surfaces
 * (module, Dashboard academic tiles, Profile academic line). Resolves:
 * canonical session identity (useMyStudentRecord — session user →
 * roster record) → API-hydrated own results → school-configured grading
 * + privacy policy. External consumers get the latest published result
 * snapshot WITHOUT duplicating any derivation logic (§34: one source).
 */
export function useMyResults(studentId?: string) {
  const assessments = useStudentResultsStore((s) => s.assessments)
  const results = useStudentResultsStore((s) => s.results)
  const status = useStudentResultsStore((s) => s.status)
  const error = useStudentResultsStore((s) => s.error)
  const hydrate = useStudentResultsStore((s) => s.hydrate)

  // Canonical identity — when the caller doesn't pin a student, resolve
  // the session user's OWN record (userId → email → the legacy demo
  // record while the first roster sync is still in flight).
  const me = useMyStudentRecord()
  const resolvedId = studentId ?? me?.id ?? ''
  const student = useStudentsStore((s) => s.students.find((x) => x.id === resolvedId))
  const className = student?.className ?? 'Class 2'
  const section = student?.section ?? 'A'

  // 7-b — hydrate the REAL own rows from /api/results once per mount.
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const resultsConfig = useSchoolSettingsStore((s) => s.results)
  const gradeScale: GradeBand[] = resultsConfig?.gradeScale?.length ? resultsConfig.gradeScale : DEFAULT_GRADE_SCALE
  const showRank = resultsConfig?.showRank ?? true
  const showClassTop = resultsConfig?.showClassTop ?? true
  const showComparison = resultsConfig?.showComparison ?? true
  const reportCard = resultsConfig?.reportCard ?? { includeAttendance: true, includePrincipalRemark: true, includeSealNote: true }

  const published = useMemo(() => publishedAssessments(assessments), [assessments])
  const upcoming = useMemo(() => upcomingAssessments(assessments), [assessments])
  const trend = useMemo(() => trendOf(assessments, results, gradeScale, resolvedId), [assessments, results, gradeScale, resolvedId])
  const insight = useMemo(() => insightOf(trend), [trend])
  const snapshot = useMemo(() => subjectSnapshotOf(assessments, results, resolvedId), [assessments, results, resolvedId])

  /**
   * Standings per published assessment — HONESTLY EMPTY (7-b): the
   * student scope of /api/results carries no class-wide rows, and the
   * fabricated roster-offset standings are retired. Surfaces that read
   * this map render nothing / rank null, which is the truthful state.
   */
  const standings = useMemo(() => new Map<string, ClassStanding[]>(), [])

  const latest: LatestResultSnapshot | null = useMemo(() => {
    if (published.length === 0) return null
    const assessment = published[published.length - 1]
    const result = resultFor(results, assessment.id, resolvedId)
    if (!result) return null
    const totals = totalsOf(result)
    const list = standings.get(assessment.id) ?? []
    const mine = list.find((s) => s.isMe)
    return {
      assessment,
      result,
      totals,
      grade: gradeFor(totals.pct, gradeScale),
      rank: showRank ? (mine?.rank ?? null) : null,
      classSize: list.length,
    }
  }, [published, results, resolvedId, standings, gradeScale, showRank])

  return {
    student: student ?? null,
    /** The resolved session student's id (seed demo record pre-sync,
     *  canonical DB id after) — consumers thread it into the exported
     *  derivation helpers instead of relying on any default identity. */
    studentId: resolvedId,
    className,
    section,
    published,
    upcoming,
    trend,
    insight,
    snapshot,
    latest,
    standings,
    gradeScale,
    gradeFor: (pct: number) => gradeFor(pct, gradeScale),
    showRank,
    showClassTop,
    showComparison,
    reportCard,
    /** 7-b — hydration states for honest loading/error surfaces. */
    loading: status === 'idle' || status === 'loading',
    error: status === 'error' ? error : null,
    reload: hydrate,
  }
}
