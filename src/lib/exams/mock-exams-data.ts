/**
 * Mock examinations data — Spec §2 / §3 / §20.
 *
 * In the current development/mock phase, Examination must render without
 * requiring a real DB session (which the production /api/exams route needs).
 * This module provides a small in-memory list of sample exams + a Zustand
 * store so that exams created via the Create Exam form persist for the
 * session (until page reload).
 *
 * The academic classes + subjects come from the SHARED mock academic
 * source (`@/lib/mock/academic`) — the same source Students & Classes uses.
 * There is NO duplicate subject/class catalogue here.
 *
 * Future phase: replace this with a real API client. The hook contract
 * in `use-exams-mock.ts` mirrors `use-exams.ts` so the swap is trivial.
 */

import { create } from 'zustand'
import type { ExamDTO, CreateExamInput, ExamClassDTO, ExamSubjectConfigDTO, ScheduleItemDTO } from './types'
import { buildSeedClassesAndSubjects, buildSeedSchedule, SEED_CLASS_DEFS } from './seed-helpers'
import { createExaminationFormApplication } from '@/lib/store/applications-store'
// SaaS-STAGE-2A — exam seeds are TENANT-AWARE: each school's namespace
// boots with its own exam list (schoolId + pattern-flavored names). No
// duplicate store — one builder, per-tenant output.
import { getActiveTenantSync } from '@/lib/tenant/active-tenant'

// ─── Sample exams (seed) ────────────────────────────────────────────────
// These give the Examination list a non-empty default state so the UI
// doesn't show an empty list on first load. They reference mock class IDs
// from the shared academic module (e.g. 'C09' = Class 6, 'C14-PCM' = Class 11 PCM).

const NOW = new Date().toISOString()

// Build coherent seed data from the shared academic module.
// seedIndex is POSITIONAL into SEED_CLASS_DEFS (exam ids are tenant-scoped
// so they can't key the defs directly).
function buildSeedExam(seedIndex: number, examId: string, name: string, type: string, session: string, term: string, status: string, resultStatus: string, startDate: string, endDate: string, maxMarks: number = 50, papersPerDay: number = 2, markSummary?: any): ExamDTO {
  const classDefs = SEED_CLASS_DEFS[seedIndex] ?? []
  const { classes, subjects } = buildSeedClassesAndSubjects(classDefs)
  // Update examId on the generated DTOs.
  classes.forEach((c) => { c.examId = examId })
  subjects.forEach((s) => { s.examId = examId; s.maxMarks = maxMarks; s.passMarks = Math.round(maxMarks * 0.33); s.theoryMarks = maxMarks })
  const schedule = buildSeedSchedule(examId, startDate, endDate, classes, subjects, papersPerDay)
  const _totalStudents = classes.reduce((sum, c) => sum + c.studentCount, 0)
  return {
    id: examId,
    schoolId: getActiveTenantSync().id,
    name, type, session, term,
    status, resultStatus,
    passPercentage: 33,
    startDate, endDate,
    declaredAt: resultStatus === 'Result Declared' ? NOW : null,
    declaredBy: resultStatus === 'Result Declared' ? 'principal' : null,
    createdBy: 'principal',
    createdAt: NOW, updatedAt: NOW,
    classes, subjects, schedule,
    markSummary: markSummary ?? { total: 0, entered: 0, locked: 0, submitted: 0, verified: 0, pct: 0 },
  }
}

const SEED_EXAMS: ExamDTO[] = (() => {
  // SaaS-STAGE-2A — the first seed exam follows the ACTIVE school's
  // examination pattern (Pattern A → 'Unit Test 2'; Pattern B →
  // 'Quarterly Examination'); ids + schoolId are tenant-scoped.
  const tenant = getActiveTenantSync()
  const patternB = tenant.feeProfile.examTemplateId === 'quarterly-hy-annual'
  const tc = tenant.code.toLowerCase()
  return [
    buildSeedExam(
      0, `exam-${tc}-1`, patternB ? 'Quarterly Examination' : 'Unit Test 2', patternB ? 'QUARTERLY' : 'UT2', '2025-2026', 'Term 1',
      'Scheduled', 'Not Started', '2025-10-10', '2025-10-15',
      50, 2,
    ),
    buildSeedExam(
      1, `exam-${tc}-2`, 'Final Examination', 'ANNUAL', '2025-2026', 'Term 2',
      'Scheduled', 'Not Started', '2026-02-10', '2026-02-20',
      100, 1,
    ),
    buildSeedExam(
      2, `exam-${tc}-3`, 'Mid-Term Examination', 'HALF_YEARLY', '2025-2026', 'Term 1',
      'Completed', 'Result Declared', '2025-09-15', '2025-09-25',
      100, 1,
      { total: 24, entered: 24, locked: 24, submitted: 24, verified: 24, pct: 100 },
    ),
  ]
})()

// ─── Mock exams store (in-memory, persists for the browser session) ─────

interface MockExamsState {
  exams: ExamDTO[]
  createExam: (input: CreateExamInput) => ExamDTO
  deleteExam: (id: string) => void
  getExam: (id: string) => ExamDTO | undefined
}

export const useMockExamsStore = create<MockExamsState>()((set, get) => ({
  exams: SEED_EXAMS.map((e) => ({ ...e })),
  createExam: (input) => {
    const id = `exam-mock-${Date.now()}`
    const now = new Date().toISOString()
    const classMeta = input.classMeta ?? {}
    const subjectMeta = input.subjectMeta ?? {}
    const classes: ExamClassDTO[] = input.classIds.map((classId, i) => {
      const meta = classMeta[classId]
      return {
        id: `ec-${id}-${i}`,
        examId: id,
        classId,
        className: meta?.className ?? classId,
        gradeLevel: meta?.gradeLevel ?? null,
        section: null,
        stream: meta?.stream ?? null,
        studentCount: meta?.studentCount ?? 0,
      }
    })
    const subjects: ExamSubjectConfigDTO[] = []
    let sortOrder = 0
    for (const [classId, subs] of Object.entries(input.subjectsByClass)) {
      for (const s of subs) {
        const sMeta = subjectMeta[s.subjectId]
        subjects.push({
          id: `sc-${classId}-${s.subjectId}`,
          examId: id,
          classId,
          subjectId: s.subjectId,
          subjectName: sMeta?.subjectName ?? s.subjectId,
          subjectCode: sMeta?.subjectCode ?? null,
          maxMarks: s.maxMarks ?? 100,
          passMarks: s.passMarks ?? 33,
          theoryMarks: s.theoryMarks ?? 100,
          practicalMarks: s.practicalMarks ?? 0,
          sortOrder: sortOrder++,
        })
      }
    }
    const schedule: ScheduleItemDTO[] = (input.schedule ?? []).map((s, i) => {
      const sMeta = subjectMeta[s.subjectId]
      const cMeta = classMeta[s.classId]
      return {
        id: `sch-${id}-${i}`,
        examId: id,
        classId: s.classId,
        className: cMeta?.className ?? s.classId,
        subjectId: s.subjectId,
        subjectName: sMeta?.subjectName ?? s.subjectId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room ?? null,
        invigilatorId: null,
        invigilatorName: s.invigilatorName ?? null,
      }
    })
    const exam: ExamDTO = {
      id,
      schoolId: getActiveTenantSync().id,
      name: input.name,
      type: input.type,
      session: input.session ?? '2025-2026',
      term: null,
      status: 'Draft',
      resultStatus: 'Not Started',
      passPercentage: input.passPercentage ?? 33,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      declaredAt: null,
      declaredBy: null,
      createdBy: 'principal',
      createdAt: now,
      updatedAt: now,
      classes,
      subjects,
      schedule,
      markSummary: { total: 0, entered: 0, locked: 0, submitted: 0, verified: 0, pct: 0 },
    }
    set((state) => ({ exams: [exam, ...state.exams] }))

    // APPS-FORMS (PART 5): an exam that requires an application form
    // AUTO-GENERATES the connected form in Operations → Applications &
    // Forms. The form stays permanently linked to this exam (sourceRef)
    // and the assigned in-charge teacher becomes its operational owner,
    // subject to the normal Principal approval/publishing workflow.
    if (input.requiresApplicationForm && exam.classes.length > 0) {
      // Best-effort: form generation must never break exam creation.
      try {
        createExaminationFormApplication({
          examId: exam.id,
          examName: exam.name,
          examType: exam.type,
          classIds: exam.classes.map((c) => c.classId),
          endDate: exam.endDate,
          inChargeTeacherId: input.inChargeTeacherId,
          inChargeName: input.inChargeTeacherName,
        })
      } catch {
        /* non-fatal */
      }
    }

    return exam
  },
  deleteExam: (id) => set((state) => ({ exams: state.exams.filter((e) => e.id !== id) })),
  getExam: (id) => get().exams.find((e) => e.id === id),
}))

/** Academic year for the seeded exam dataset. */
export const MOCK_ACADEMIC_YEAR = '2025-2026'
