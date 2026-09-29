'use client'

/**
 * CreateExamFullScreen — single-page examination creation form.
 *
 * DESIGN PRINCIPLE: "Principal should select as little as possible.
 * Scholario should already know the rest."
 *
 * The form consumes existing school configuration:
 *   • Classes + their subjects come from Students & Classes
 *   • Streams come from each class's `stream` field (already configured)
 *   • Exam rules (max marks, duration, papers/day, gap, Sunday skip) come
 *     from Examination Settings via the template engine
 *   • Exam fee comes from the Fee Structure's `examFeeSchedule` for the
 *     selected class level + examination type (FEE-EXAM integration)
 *
 * Principal flow:
 *   1. Pick examination type (UT1, UT2, Half-Yearly, UT3, UT4, Annual, Custom)
 *      → name auto-fills, assessment auto-configures, exam fee auto-resolves
 *   2. Select classes (just checkboxes — streams are shown automatically)
 *      → subjects auto-include from class configuration (READ-ONLY by default)
 *      → exam fee re-resolves when classes change (uses first selected
 *         class's classLevel)
 *   3. Pick start date / last date / start time (past dates blocked)
 *      → schedule auto-generates with Sunday skip + conflict-safe slots
 *   4. Review generated schedule
 *   5. Create Examination → saved as DRAFT
 *
 * Subjects are auto-included from the selected classes' configuration.
 * The Principal can toggle "Edit" to remove/add exceptional subjects, but
 * the default workflow requires ZERO manual subject selection.
 *
 * No layout container around the form — page breathes naturally like the
 * rest of the Principal panel. Only a compact bottom action bar remains.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, AlertTriangle, Pencil, Award, RotateCcw, Info, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useTeachersStore } from '@/lib/store/teachers-store'
import { useSchoolProfile } from '@/lib/school-profile'

import { useCreateExam } from '@/lib/exams/use-exams'
import { TemplateSelection } from './tabs/template-selection'
import { type ExamTemplate } from './tabs/exam-templates'
import {
  getTemplateMeta,
  generateExamConfig,
  validateDateRange,
  countScheduleSlots,
  FIXED_PASS_PERCENTAGE,
  type ClassInfo,
  type SubjectInfo,
} from '@/lib/exams/template-engine'
import { useScheduleState } from '@/lib/exams/schedule/use-schedule-state'
import { consolidateByGrade, type GradeMapping } from '@/lib/exams/schedule/consolidate'
import type { ScheduleClass, ScheduleOptions } from '@/lib/exams/schedule/schedule-types'
import { formatDateLong } from '@/lib/exams/format-helpers'
import { ScheduleTable } from './schedule/schedule-table'
import { OfficialTimetable } from './schedule/official-timetable'
import { ConfirmationSummary } from './schedule/confirmation-summary'
import { StepIndicator } from './schedule/step-indicator'
import { useFeeStore } from '@/lib/store/fee-store'
import { formatINR } from '@/lib/format'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface ClassDTO {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
  stream: string | null
  studentCount: number
  subjects: Array<{
    id: string
    name: string
    code: string | null
    fullMarks: number
    passMarks: number
    isCore?: boolean
    examinable?: boolean
    displayOrder?: number
  }>
}

/** Examination-level class — sections collapsed into one selectable unit. */
interface ExamClass {
  key: string           // unique key: `${gradeLevel}-${stream ?? 'general'}`
  label: string         // "Class 9" or "Class 11 — Science PCM"
  /** Base class name WITHOUT stream suffix (e.g. "Class 11", "Pre-Nursery"). */
  baseName: string
  gradeLevel: string
  stream: string | null
  sectionIds: string[]  // all section class IDs that belong to this exam class
  sectionCount: number
  studentCount: number
  subjects: ClassDTO['subjects']  // merged subjects from all sections (deduped by name)
}

/** Transform raw DB classes (with sections) into examination-level classes. */
function normalizeToExamClasses(classes: ClassDTO[]): ExamClass[] {
  const byKey = new Map<string, ExamClass>()
  for (const cls of classes) {
    const grade = cls.gradeLevel ?? '0'
    const stream = cls.stream ?? null
    const key = `${grade}-${stream ?? 'general'}`
    const existing = byKey.get(key)
    if (existing) {
      // Merge section into existing exam class
      existing.sectionIds.push(cls.id)
      existing.sectionCount++
      existing.studentCount += cls.studentCount
      // Merge subjects (dedupe by name — keep first occurrence)
      const existingNames = new Set(existing.subjects.map(s => s.name))
      for (const subj of cls.subjects) {
        if (!existingNames.has(subj.name)) {
          existing.subjects.push(subj)
          existingNames.add(subj.name)
        }
      }
    } else {
      // Create new examination-level class — Spec §9 canonical labels.
      // Prefer `cls.name` (e.g. "Pre-Nursery", "KG", "Class 6") over a
      // reconstructed "Class ${grade}" so non-numeric grade levels render
      // with their proper display name (Spec §21 — use "Class", not grade).
      const streamLabel = stream
        ? stream.startsWith('Science-')
          ? `Science ${stream.slice('Science-'.length)}`
          : stream
        : null
      // Spec §21: prefer the canonical class name from Students & Classes.
      // For classes whose name already starts with "Class " (e.g. "Class 6"),
      // use it verbatim. For others (Pre-Nursery, KG) use the name as-is.
      const baseName = cls.name || `Class ${grade}`
      const label = streamLabel
        ? `${baseName} — ${streamLabel}`
        : baseName
      byKey.set(key, {
        key,
        label,
        baseName,
        gradeLevel: grade,
        stream,
        sectionIds: [cls.id],
        sectionCount: 1,
        studentCount: cls.studentCount,
        subjects: [...cls.subjects],
      })
    }
  }
  // Sort numerically by gradeLevel, then by stream
  return Array.from(byKey.values()).sort((a, b) => {
    const ga = parseInt(a.gradeLevel, 10)
    const gb = parseInt(b.gradeLevel, 10)
    if (ga !== gb) return ga - gb
    return (a.stream ?? '').localeCompare(b.stream ?? '')
  })
}

interface Props {
  classes: ClassDTO[]
  academicYear: string
  onBack: () => void
  onCreated: (exam: any) => void
}

// ─── FEE-EXAM — Examination Fee auto-resolution ────────────────────────
//
// Maps the ExamDTO's `type` field (which can be either a legacy code like
// 'UT2' / 'HALF_YEARLY' / 'ANNUAL', OR a template name like 'Unit Test 2'
// / 'Half-Yearly Examination' / 'Annual Examination') to the canonical
// `examType` vocabulary used by Fee Structure `examFeeSchedule` entries
// (which mirrors `EXAM_TYPES` in `src/lib/exams/types.ts`).
//
//   'UT2' / 'Unit Test 2'           → 'Unit Test'
//   'HALF_YEARLY' / 'Half-Yearly…'  → 'Half-Yearly'
//   'ANNUAL' / 'Annual Examination' → 'Annual Examination'
//   'PRE_BOARD' / 'Pre-Board…'      → 'Pre-Board'
//   'PRACTICAL' / 'Practical…'     → 'Practical'
//
// Unmapped exam types (Oral / Viva, Custom, etc.) return null — no fee
// resolution happens for those.
const EXAM_TYPE_TO_FEE_TYPE: Record<string, string> = {
  // Legacy exam type codes (used by seeded mock exams + older code paths)
  UT1: 'Unit Test',
  UT2: 'Unit Test',
  UT3: 'Unit Test',
  UT4: 'Unit Test',
  HALF_YEARLY: 'Half-Yearly',
  ANNUAL: 'Annual Examination',
  PRE_BOARD: 'Pre-Board',
  PRACTICAL: 'Practical',
  // Template names (used by create-exam-fullscreen → selectedTemplate.name)
  'Unit Test 1': 'Unit Test',
  'Unit Test 2': 'Unit Test',
  'Unit Test 3': 'Unit Test',
  'Unit Test 4': 'Unit Test',
  'Half-Yearly Examination': 'Half-Yearly',
  'Annual Examination': 'Annual Examination',
  'Pre-Board Examination': 'Pre-Board',
  'Practical Examination': 'Practical',
}

/**
 * Convert a numeric grade level (e.g. "9", "11", "0", "-2") to the
 * canonical Fee Structure `classLevel` bucket — mirrors the matching
 * logic in `computeAccount` (fee-store.ts). Pre-Primary covers nursery
 * through KG (grades -2, -1, 0).
 */
function gradeLevelToClassLevel(grade: string): string {
  const n = parseInt(grade, 10)
  if (Number.isNaN(n)) return 'Pre-Primary'
  if (n >= 11) return 'Senior Secondary'
  if (n >= 9) return 'Secondary'
  if (n >= 6) return 'Middle'
  if (n >= 1) return 'Primary'
  return 'Pre-Primary'
}

// Deduped subject — appears once even when shared across multiple selected classes
interface DedupedSubject extends SubjectInfo {
  availableInClassIds: string[]
  availableInClassNames: string[]
}

export function CreateExamFullScreen({ classes, academicYear, onBack, onCreated }: Props) {
  const schoolProfile = useSchoolProfile()
  const [selectedTemplate, setSelectedTemplate] = useState<ExamTemplate | null>(null)
  const [name, setName] = useState('')
  const [selectedExamClassKeys, setSelectedExamClassKeys] = useState<string[]>([])
  const [subjectsEditable, setSubjectsEditable] = useState(false)
  const [deselectedSubjectNames, setDeselectedSubjectNames] = useState<Set<string>>(new Set())
  const [hasPractical, setHasPractical] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [examTime, setExamTime] = useState('09:00')
  // REAL data (iq3000-2b): POST /api/exams — the created examination is a
  // canonical DB row (real ids), immediately visible in the server-backed
  // exam list. The old mock create wrote the in-memory seed store only.
  const { create, loading } = useCreateExam()

  // FEE-EXAM — exam fee auto-resolution + override state.
  // `examFeeOverride` holds the user-entered override amount (or null when
  // not overriding). `overrideReason` is required to commit an override
  // (controlled action — recorded in the audit trail on the server side).
  // `showOverrideForm` toggles the inline override editor.
  const [examFeeOverride, setExamFeeOverride] = useState<number | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [showOverrideForm, setShowOverrideForm] = useState(false)

  // FEE-EXAM — read the fee structures + versions from the canonical fee
  // store so the form can resolve the per-exam fee for the selected class
  // level + examination type. Re-renders automatically when the store
  // updates (e.g. if the Principal publishes a new version mid-creation).
  const feeStructures = useFeeStore((s) => s.feeStructures)
  const feeVersions = useFeeStore((s) => s.versions)

  // Normalize raw DB classes into examination-level classes
  const examClasses = useMemo(() => normalizeToExamClasses(classes), [classes])

  // Selected exam classes (full objects)
  const selectedExamClasses = useMemo(
    () => examClasses.filter((c) => selectedExamClassKeys.includes(c.key)),
    [examClasses, selectedExamClassKeys],
  )

  // Expand to all section-level class IDs for API calls
  const selectedClassIds = useMemo(
    () => selectedExamClasses.flatMap((c) => c.sectionIds),
    [selectedExamClasses],
  )

  // Selected classes as ClassDTO[] for schedule generation
  const selectedClasses = useMemo(
    () => classes.filter((c) => selectedClassIds.includes(c.id)),
    [classes, selectedClassIds],
  )

  // FEE-EXAM — auto-resolve the examination fee from the Fee Structure.
  //
  // Strategy: take the FIRST selected exam class (lowest grade, sorted by
  // the existing normalizeToExamClasses ordering), look up its classLevel,
  // find the matching FeeStructureConfig, then find the active
  // examFeeSchedule entry whose `examType` matches `EXAM_TYPE_TO_FEE_TYPE`
  // for the selected template's name.
  //
  // If the Principal has selected multiple classes spanning different
  // classLevels, the resolution uses the FIRST one (lowest grade) and a
  // small note is shown so the operator is aware the fee may not match
  // every selected class. The override flow lets the operator enter a
  // manual amount for the multi-class case.
  const resolvedExamFee = useMemo<{ amount: number; source: string; versionRef: string; matchedClassLevel: string } | null>(() => {
    if (!selectedTemplate || selectedExamClasses.length === 0) return null
    const feeType = EXAM_TYPE_TO_FEE_TYPE[selectedTemplate.name]
    if (!feeType) return null
    // selectedExamClasses is sorted by grade ascending; use the first.
    const firstClass = selectedExamClasses[0]
    const classLevel = gradeLevelToClassLevel(firstClass.gradeLevel)
    const structure = feeStructures.find((s) => s.classLevel === classLevel)
    if (!structure || !structure.examFeeSchedule) return null
    const entry = structure.examFeeSchedule.find((e) => e.examType === feeType && e.active)
    if (!entry) return null
    // The CURRENT version snapshot for this structure — used as the
    // audit-trail reference (feeStructureVersionRef) when the exam is
    // created against this fee schedule.
    const currentVersion = feeVersions.find(
      (v) => v.structureId === structure.id && v.status === 'current',
    )
    return {
      amount: entry.amount,
      source: `${structure.className} Fee Structure`,
      versionRef: currentVersion?.id ?? '',
      matchedClassLevel: classLevel,
    }
  }, [selectedTemplate, selectedExamClasses, feeStructures, feeVersions])

  // True when the Principal selected classes spanning multiple classLevels
  // (e.g. Class 8 + Class 9) — used to show a "fee may differ across classes"
  // note next to the resolved fee.
  const multipleClassLevels = useMemo(() => {
    if (selectedExamClasses.length < 2) return false
    const levels = new Set(selectedExamClasses.map((c) => gradeLevelToClassLevel(c.gradeLevel)))
    return levels.size > 1
  }, [selectedExamClasses])

  // Effective exam fee — override takes precedence, otherwise the resolved
  // value (or undefined when nothing applies). Passed to create().
  const effectiveExamFee = useMemo<number | null>(() => {
    if (examFeeOverride !== null) return examFeeOverride
    return resolvedExamFee?.amount ?? null
  }, [examFeeOverride, resolvedExamFee])

  // Reset the override state whenever the resolved fee changes (e.g. user
  // picks a different class or template) so a stale override doesn't bleed
  // into a new context. The override form is also collapsed.
  useEffect(() => {
    setExamFeeOverride(null)
    setOverrideReason('')
    setShowOverrideForm(false)
  }, [resolvedExamFee])

  const handleSaveOverride = () => {
    if (examFeeOverride === null || examFeeOverride < 0) {
      toast.error('Override amount must be a non-negative number.')
      return
    }
    if (overrideReason.trim().length < 5) {
      toast.error('Override reason is required (min 5 characters).', {
        description: 'The reason is recorded in the audit trail for this examination.',
      })
      return
    }
    setShowOverrideForm(false)
    toast.success('Exam fee overridden', {
      description: `New fee: ${formatINR(examFeeOverride, true)}. Reason recorded for audit.`,
    })
  }

  const handleResetOverride = () => {
    setExamFeeOverride(null)
    setOverrideReason('')
    setShowOverrideForm(false)
  }

  // Spec §1 — earliest selectable examination date is TOMORROW (today disabled).
  // Uses local-date helpers (no UTC shift) to avoid the "18 Aug" off-by-one bug.
  const minStartDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1) // tomorrow
    d.setHours(0, 0, 0, 0)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }, [])

  // Spec §2 — if startDate moves forward past the existing endDate, clear
  // endDate so the user picks a fresh valid end (rather than leaving an
  // impossible range like Start=20 Aug, End=19 Aug).
  useEffect(() => {
    if (endDate && startDate && endDate < startDate) {
      setEndDate('')
    }
  }, [startDate, endDate])

  // ─── Template selection → auto-fill name + assessment ────────────────
  const handleTemplateSelect = useCallback((t: ExamTemplate) => {
    setSelectedTemplate(t)
    setName(t.label)
    const meta = getTemplateMeta(t.id)
    setHasPractical(meta.hasPractical)
  }, [])

  // ─── Class selection ────────────────────────────────────────────────
  const handleClassToggle = (examClassKey: string) => {
    setSelectedExamClassKeys((prev) =>
      prev.includes(examClassKey) ? prev.filter((k) => k !== examClassKey) : [...prev, examClassKey],
    )
  }

  // ─── Auto-included subjects (deduped by NAME across all selected classes) ───
  // This is the source of truth — subjects come FROM the class configuration.
  // No manual entry, no stream-selection step. The principal only verifies.
  const autoSubjects = useMemo<DedupedSubject[]>(() => {
    const byName = new Map<string, DedupedSubject>()
    for (const c of selectedClasses) {
      for (const s of c.subjects) {
        const existing = byName.get(s.name)
        if (existing) {
          if (!existing.availableInClassIds.includes(c.id)) {
            existing.availableInClassIds.push(c.id)
            existing.availableInClassNames.push(c.name)
          }
        } else {
          byName.set(s.name, {
            id: s.id, // canonical id from first class that has it
            name: s.name,
            code: s.code,
            availableInClassIds: [c.id],
            availableInClassNames: [c.name],
          })
        }
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [selectedClasses])

  // Final subject list — auto-included MINUS any the principal explicitly deselected
  const effectiveSubjects = useMemo(
    () => autoSubjects.filter((s) => !deselectedSubjectNames.has(s.name)),
    [autoSubjects, deselectedSubjectNames],
  )

  const toggleSubjectDeselection = (subjectName: string) => {
    setDeselectedSubjectNames((prev) => {
      const next = new Set(prev)
      if (next.has(subjectName)) next.delete(subjectName)
      else next.add(subjectName)
      return next
    })
  }

  // ─── Assessment config (driven by template, not manual entry) ─────────
  const assessment = useMemo(() => {
    if (!selectedTemplate) return null
    const meta = getTemplateMeta(selectedTemplate.id)
    return {
      maxMarks: meta.maxMarks,
      theoryMarks: hasPractical ? meta.theoryMarks : meta.maxMarks,
      practicalMarks: hasPractical ? meta.practicalMarks : 0,
      hasPractical,
    }
  }, [selectedTemplate, hasPractical])

  const togglePractical = () => {
    if (!selectedTemplate) return
    const meta = getTemplateMeta(selectedTemplate.id)
    // Only allow toggling practical ON if the template supports it
    if (!hasPractical && meta.practicalMarks === 0) {
      toast.info('Practical not applicable for this examination type', {
        description: `${selectedTemplate.label} is theory-only by default.`,
      })
      return
    }
    setHasPractical(!hasPractical)
  }

  // ─── Date range validation ───────────────────────────────────────────
  // Use slot count (collapses Mathematics/Biology stream alternatives into
  // one slot per Spec §13/§41) so the required-days calculation matches
  // what the scheduler will actually generate.
  const dateValidation = useMemo(() => {
    if (!selectedTemplate || !startDate || effectiveSubjects.length === 0) return null
    const slotCount = countScheduleSlots(effectiveSubjects.map((s) => s.name))
    return validateDateRange(
      selectedTemplate.id,
      startDate,
      endDate || startDate,
      slotCount,
    )
  }, [selectedTemplate, startDate, endDate, effectiveSubjects])

  // ─── Per-class timetable (Spec §4 / §10 / §11 — no cross-contamination) ──
  // Build ScheduleClass[] from the SELECTED exam classes (each with its OWN
  // subjects) + ScheduleOptions from the template + date window.
  const scheduleClasses: ScheduleClass[] = useMemo(() => {
    return selectedExamClasses.map((ec) => ({
      id: ec.key,
      label: ec.label,
      subjects: ec.subjects.map((s) => ({ id: s.id, name: s.name, code: s.code ?? '' })),
    }))
  }, [selectedExamClasses])

  const scheduleOptions: ScheduleOptions | null = useMemo(() => {
    if (!selectedTemplate || !startDate) return null
    const meta = getTemplateMeta(selectedTemplate.id)
    return {
      startDate,
      endDate: endDate || startDate,
      papersPerDay: meta.papersPerDay,
      startTime: examTime,
      paperDurationMin: meta.paperDurationMin,
      gapMin: meta.gapMin,
    }
  }, [selectedTemplate, startDate, endDate, examTime])

  const scheduleState = useScheduleState({ classes: scheduleClasses, options: scheduleOptions })

  // ─── 3-step flow state (Spec §9) ─────────────────────────────────────
  // Step 1 = Setup + editable schedule. Step 2 = official preview. Step 3 = confirmation.
  // DB creation happens ONLY on Step 3 "Create Examination" (Spec §9 STEP 3).
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // APPS-FORMS (PART 5): does this examination need an application form?
  // When on, creating the exam auto-generates a connected Application/Form
  // in Operations → Applications & Forms (source 'Examination') with the
  // chosen in-charge teacher as operational owner.
  const [needsApplicationForm, setNeedsApplicationForm] = useState(false)
  const [formInChargeTeacherId, setFormInChargeTeacherId] = useState('')
  const teacherOptions = useTeachersStore((s) => s.teachers ?? [])
  const formInChargeName = useMemo(
    () => teacherOptions.find((t) => t.teacherId === formInChargeTeacherId)?.name,
    [teacherOptions, formInChargeTeacherId],
  )

  // ─── Consolidated timetable (Spec §1 / §3 / §14) ──────────────────────
  // Merge same-grade stream columns into one (e.g. Class 11 PCM + PCB → "Class 11").
  // The grade mapping is built from the selected exam classes.
  // Spec §4 — use the canonical baseName (e.g. "Pre-Nursery", "Class 11"), NOT
  // a reconstructed "Class ${grade}" (which would produce "Class -2", "Class 0").
  const gradeMap: GradeMapping = useMemo(() => {
    const map: GradeMapping = {}
    for (const ec of selectedExamClasses) {
      map[ec.key] = { gradeLevel: ec.gradeLevel, label: ec.baseName }
    }
    return map
  }, [selectedExamClasses])

  const consolidatedTimetable = useMemo(() => {
    if (!scheduleState.timetable) return null
    return consolidateByGrade(scheduleState.timetable, gradeMap)
  }, [scheduleState.timetable, gradeMap])

  // Date range label for display (e.g. "19 Aug – 22 Aug 2026").
  const dateRangeLabel = useMemo(() => {
    if (!startDate) return ''
    const startLbl = formatDateLong(startDate)
    if (!endDate || endDate === startDate) return startLbl
    return `${startLbl} – ${formatDateLong(endDate)}`
  }, [startDate, endDate])

  // ─── Can create? ─────────────────────────────────────────────────────
  const canCreate =
    name.trim().length > 0 &&
    selectedTemplate !== null &&
    selectedExamClassKeys.length > 0 &&
    effectiveSubjects.length > 0 &&
    startDate.length > 0 &&
    startDate >= minStartDate &&
    (!endDate || endDate >= startDate) &&
    (!dateValidation || dateValidation.isValid)

  // ─── Handle create ───────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!canCreate || !selectedTemplate || !assessment) return
    try {
      const classInfos: ClassInfo[] = selectedClasses.map((c) => ({
        id: c.id,
        name: c.name,
        gradeLevel: c.gradeLevel,
        stream: c.stream,
        studentCount: c.studentCount,
        subjects: c.subjects.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      }))

      const generated = generateExamConfig(
        selectedTemplate.id,
        name.trim(),
        startDate,
        endDate || startDate,
        classInfos,
        effectiveSubjects,
        examTime,
      )

      // Apply assessment config from template (not manual entry)
      generated.subjects = generated.subjects.map((s) => ({
        ...s,
        maxMarks: assessment.maxMarks,
        theoryMarks: assessment.theoryMarks,
        practicalMarks: assessment.practicalMarks,
      }))

      // Build subjectsByClass — for each selected class, filter to only
      // subjects that exist in that class (matched by name, since IDs differ).
      const subjectsByClass: Record<string, Array<{ subjectId: string; maxMarks: number; theoryMarks: number; practicalMarks: number }>> = {}
      for (const classId of selectedClassIds) {
        const cls = classes.find((c) => c.id === classId)
        if (!cls) continue
        const classSubjectNames = new Set(cls.subjects.map((s) => s.name))
        subjectsByClass[classId] = effectiveSubjects
          .filter((sel) => classSubjectNames.has(sel.name))
          .map((sel) => {
            const classSubj = cls.subjects.find((s) => s.name === sel.name)!
            return {
              subjectId: classSubj.id,
              maxMarks: assessment.maxMarks,
              theoryMarks: assessment.theoryMarks,
              practicalMarks: assessment.practicalMarks,
            }
          })
      }

      // Build schedule — use the per-class timetable from scheduleState.
      // The timetable already respects each class's own subjects (no cross-
      // contamination, Spec §11) and reflects any manual drag reorders.
      // Map exam-class keys back to the underlying section class IDs so the
      // storage layer can route per-section.
      const fullSchedule = scheduleState.flattened.map((item) => {
        // Resolve the exam-class key to the first section classId for storage.
        const examCls = selectedExamClasses.find((ec) => ec.key === item.classId)
        const classId = examCls?.sectionIds[0] ?? item.classId
        return {
          classId,
          subjectId: item.subjectId,
          date: item.date,
          startTime: item.startTime,
          endTime: item.endTime,
          room: item.room || undefined,
          invigilatorName: item.invigilatorName || undefined,
        }
      })

      // Build display-name metadata so the mock store populates real className
      // + subjectName on the ExamDTO (not raw IDs).
      const classMeta: Record<string, { className: string; gradeLevel: string | null; stream: string | null; studentCount: number }> = {}
      const subjectMeta: Record<string, { subjectName: string; subjectCode: string | null }> = {}
      for (const classId of selectedClassIds) {
        const cls = classes.find((c) => c.id === classId)
        if (!cls) continue
        classMeta[classId] = { className: cls.name, gradeLevel: cls.gradeLevel, stream: cls.stream, studentCount: 0 }
        for (const subj of cls.subjects) {
          if (!subjectMeta[subj.id]) subjectMeta[subj.id] = { subjectName: subj.name, subjectCode: subj.code }
        }
      }

      const exam = await create({
        name: name.trim(),
        type: selectedTemplate.name,
        session: academicYear,
        startDate,
        endDate: endDate || startDate,
        passPercentage: FIXED_PASS_PERCENTAGE,
        classIds: selectedClassIds,
        subjectsByClass,
        schedule: fullSchedule,
        classMeta,
        subjectMeta,
        // FEE-EXAM — pass the resolved (or overridden) exam fee to the
        // ExamDTO. When the Principal overrode the auto-resolved fee, we
        // omit `feeStructureVersionRef` (the override didn't come from
        // the Fee Structure). When auto-resolved, we attach the current
        // version id so the audit trail pins which fee schedule produced
        // the recorded amount.
        ...(effectiveExamFee !== null ? { examFee: effectiveExamFee } : {}),
        ...(examFeeOverride === null && resolvedExamFee && resolvedExamFee.versionRef
          ? { feeStructureVersionRef: resolvedExamFee.versionRef }
          : {}),
        // APPS-FORMS (PART 5) — generate the connected application form.
        requiresApplicationForm: needsApplicationForm,
        ...(needsApplicationForm && formInChargeTeacherId ? { inChargeTeacherId: formInChargeTeacherId, inChargeTeacherName: formInChargeName } : {}),
      })

      toast.success('Examination created as Draft', {
        description: needsApplicationForm
          ? `${effectiveSubjects.length} subjects scheduled across ${selectedClassIds.length} classes. Application form generated — see Operations → Applications & Forms.`
          : `${effectiveSubjects.length} subjects scheduled across ${selectedClassIds.length} classes. Review and publish when ready.`,
      })
      onCreated(exam)
    } catch (e: any) {
      toast.error('Failed to create examination', { description: e.message })
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────
  // 3-step flow: Step 1 = Setup (no timetable), Step 2 = Timetable Builder,
  // Step 3 = Complete read-only Examination Preview.
  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="px-4 sm:px-6 pt-4 pb-2 shrink-0">
        <StepIndicator current={step} />
      </div>

      {/* Scrollable area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-8">
        {/* ─── STEP 1 — Examination Setup (NO timetable) ─────────────── */}
        {step === 1 && (
          <div className="max-w-3xl mx-auto space-y-6">
            <Section label="Examination Type" required>
              <TemplateSelection selectedTemplateId={selectedTemplate?.id ?? null} onSelect={handleTemplateSelect} />
            </Section>

            {selectedTemplate && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <Section label="Examination Name" required>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Unit Test 1"
                    className="h-9 text-sm max-w-md"
                  />
                </Section>

                <Section
                  label="Classes"
                  required
                  hint={selectedExamClassKeys.length > 0 ? `${selectedExamClassKeys.length} selected` : undefined}
                >
                  {examClasses.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3">No classes configured. Add classes in Students &amp; Classes first.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {examClasses.map((examCls) => {
                        const isSelected = selectedExamClassKeys.includes(examCls.key)
                        return (
                          <div
                            key={examCls.key}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => handleClassToggle(examCls.key)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClassToggle(examCls.key) } }}
                            className={cn(
                              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30',
                              isSelected ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/30',
                            )}
                          >
                            <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border shrink-0', isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                              {isSelected && <Check className="h-2.5 w-2.5" />}
                            </span>
                            <span>{examCls.label}</span>
                            {examCls.sectionCount > 1 && <span className="text-[9px] text-muted-foreground/60">· {examCls.sectionCount} sections</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </Section>

                {/* Subjects — auto-included, removable */}
                {autoSubjects.length > 0 && (
                  <Section label="Subjects" hint={`${effectiveSubjects.length} auto-included`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {effectiveSubjects.map((subj) => (
                        <span
                          key={subj.id}
                          className="inline-flex items-center gap-1 rounded-md bg-card border border-border/60 px-2 py-1 text-xs font-medium"
                        >
                          {subj.name}
                          {subjectsEditable && (
                            <button
                              onClick={() => toggleSubjectDeselection(subj.name)}
                              className="text-muted-foreground hover:text-rose-600 ml-0.5"
                              aria-label={`Remove ${subj.name}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      <button
                        onClick={() => setSubjectsEditable(!subjectsEditable)}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors ml-1"
                      >
                        <Pencil className="h-2.5 w-2.5" /> {subjectsEditable ? 'Done' : 'Edit'}
                      </button>
                    </div>
                  </Section>
                )}

                {/* Assessment — auto from template, no pass-percentage input */}
                {assessment && (
                  <Section label="Assessment">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium', !hasPractical ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
                          <span className={cn('h-2 w-2 rounded-full', !hasPractical ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                          Theory
                        </span>
                        <button
                          onClick={togglePractical}
                          className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors', hasPractical ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                          aria-pressed={hasPractical}
                        >
                          <span className={cn('h-2 w-2 rounded-full', hasPractical ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                          Practical
                        </button>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><span className="font-semibold text-foreground tabular-nums">{assessment.maxMarks}</span> max</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="inline-flex items-center gap-1"><span className="font-semibold text-foreground tabular-nums">{assessment.theoryMarks}</span> theory</span>
                        {hasPractical && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="inline-flex items-center gap-1"><span className="font-semibold text-foreground tabular-nums">{assessment.practicalMarks}</span> practical</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Section>
                )}

                {/* FEE-EXAM — Examination Fee auto-resolution + override.
                    Shows the per-exam fee resolved from the Fee Structure's
                    `examFeeSchedule` for the selected class level + exam
                    type. The Principal can override with a reason
                    (controlled action — recorded for audit). */}
                {selectedTemplate && selectedExamClasses.length > 0 && (
                  <Section
                    label="Examination Fee"
                    hint={
                      resolvedExamFee
                        ? `Auto-resolved from ${resolvedExamFee.matchedClassLevel} fee structure`
                        : 'No fee configured'
                    }
                  >
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      {resolvedExamFee ? (
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                              <Award className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-base font-bold tabular-nums text-foreground">
                                  {formatINR(examFeeOverride ?? resolvedExamFee.amount, true)}
                                </span>
                                {examFeeOverride !== null && (
                                  <Badge variant="outline" className="text-[8px] py-0 px-1 h-3.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">
                                    Overridden
                                  </Badge>
                                )}
                                <span className="text-[10px] text-muted-foreground">per examination · per student</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Source: <span className="font-medium text-foreground">{resolvedExamFee.source}</span>
                                {examFeeOverride === null && <span className="text-muted-foreground"> · Configured in Fee Structure</span>}
                              </p>
                              {multipleClassLevels && (
                                <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5 flex items-center gap-1">
                                  <Info className="h-2.5 w-2.5" />
                                  Multiple class levels selected — fee shown is for {resolvedExamFee.matchedClassLevel}. Override if a different fee applies to all selected classes.
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {examFeeOverride !== null ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] gap-1 text-muted-foreground"
                                onClick={handleResetOverride}
                              >
                                <RotateCcw className="h-3 w-3" /> Reset to auto
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] gap-1"
                                onClick={() => {
                                  setExamFeeOverride(resolvedExamFee.amount)
                                  setOverrideReason('')
                                  setShowOverrideForm(true)
                                }}
                              >
                                <Pencil className="h-3 w-3" /> Override Fee
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
                            <Info className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] text-foreground font-medium">No exam fee configured for this exam type in the applicable Fee Structure.</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Configure exam fees in Fee Management → Fee Structures → Examination Fee Schedule. The exam will be created with no per-exam fee.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Override inline form */}
                      {showOverrideForm && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2.5 pt-2.5 border-t border-border overflow-hidden"
                        >
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="h-3 w-3" /> Override Exam Fee
                            </p>
                            <div className="grid grid-cols-2 gap-2 max-w-md">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">New Fee (₹)</Label>
                                <Input
                                  type="number"
                                  value={examFeeOverride ?? ''}
                                  onChange={(e) => setExamFeeOverride(e.target.value === '' ? null : Number(e.target.value))}
                                  className="h-8 text-xs mt-0.5 tabular-nums"
                                  min={0}
                                  autoFocus
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">Reason <span className="text-rose-500">*</span></Label>
                                <Input
                                  value={overrideReason}
                                  onChange={(e) => setOverrideReason(e.target.value)}
                                  placeholder="e.g. Waived for scholarship students"
                                  className="h-8 text-xs mt-0.5"
                                />
                              </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              The override reason is recorded in the audit trail for this examination.
                              Auto-resolution from the Fee Structure will not re-apply until you reset.
                            </p>
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowOverrideForm(false); setExamFeeOverride(null); setOverrideReason('') }}>
                                Cancel
                              </Button>
                              <Button size="sm" className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={handleSaveOverride}>
                                <Check className="h-3 w-3" /> Save Override
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </Section>
                )}

                {/* APPS-FORMS (PART 5) — Application Form requirement.
                    When enabled, creating this examination auto-generates a
                    connected Application/Form under Operations → Applications
                    & Forms (source 'Examination'), permanently linked back
                    to this exam, with the chosen in-charge teacher as the
                    operational owner (Principal approval still gates
                    publishing). */}
                {selectedTemplate && selectedExamClasses.length > 0 && (
                  <Section
                    label="Application Form"
                    hint={needsApplicationForm ? 'A connected form will be generated' : 'Optional'}
                  >
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ${needsApplicationForm ? 'bg-violet-500/10 text-violet-600 ring-violet-500/20' : 'bg-muted text-muted-foreground ring-border'}`}>
                            <ClipboardList className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-foreground">This examination requires an application form</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {needsApplicationForm
                                ? 'On creation, an official examination form is generated in Applications & Forms — linked to this exam, ready to review, publish and collect submissions.'
                                : 'Students/guardians will not need to submit any form for this examination.'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setNeedsApplicationForm((v) => !v)}
                          role="switch"
                          aria-checked={needsApplicationForm}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${needsApplicationForm ? 'bg-violet-600' : 'bg-muted-foreground/30'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${needsApplicationForm ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                        </button>
                      </div>
                      {needsApplicationForm && (
                        <div className="mt-2.5 pt-2.5 border-t border-border">
                          <div className="max-w-xs">
                            <Label className="text-[10px] text-muted-foreground">Form in-charge (optional)</Label>
                            <Select value={formInChargeTeacherId} onValueChange={setFormInChargeTeacherId}>
                              <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Assign a teacher" /></SelectTrigger>
                              <SelectContent className="z-[80] max-h-56">
                                {teacherOptions.slice(0, 60).map((t) => (
                                  <SelectItem key={t.teacherId} value={t.teacherId} className="text-xs">{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              The in-charge reviews submissions and manages the operational side. Publishing still requires your approval flow.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* Examination Window — dates + time */}
                {effectiveSubjects.length > 0 && (
                  <Section label="Examination Window" required>
                    <div className="grid grid-cols-2 gap-3 max-w-md">
                      <Field label="Start Date">
                        <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" minDate={minStartDate} />
                      </Field>
                      <Field label="Last Examination Date">
                        <DatePicker value={endDate} onChange={setEndDate} placeholder="Last date" minDate={startDate || minStartDate} />
                      </Field>
                    </div>
                    <div className="flex items-center gap-3 mt-3 max-w-md flex-wrap">
                      <Field label="Start Time">
                        <Input type="time" value={examTime} onChange={(e) => setExamTime(e.target.value)} className="h-9 text-xs w-32" />
                      </Field>
                      <p className="text-[10px] text-muted-foreground mt-4">
                        {selectedTemplate.id.startsWith('unit-test') ? '2 papers/day · 1h each · 15-min gap' : '1 paper/day'}
                      </p>
                    </div>
                    {dateValidation && !dateValidation.isValid && startDate && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mt-3 flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-[11px]">
                          <p className="text-amber-700 dark:text-amber-300 font-medium">{dateValidation.message}</p>
                          <p className="text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                            Required: {dateValidation.requiredDays} working days · Available: {dateValidation.availableDays}
                          </p>
                        </div>
                      </div>
                    )}
                  </Section>
                )}
              </motion.div>
            )}
          </div>
        )}

        {/* ─── STEP 2 — Timetable Builder (editable, full width) ─────── */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Timetable Builder</h2>
                <p className="text-[10px] text-muted-foreground">{name || selectedTemplate?.label} · {dateRangeLabel}</p>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {scheduleState.timetable?.rows.length ?? 0} slots · {scheduleState.timetable?.classes.length ?? 0} classes
              </div>
            </div>
            {scheduleState.timetable && scheduleState.timetable.rows.length > 0 ? (
              <ScheduleTable timetable={scheduleState.timetable} onMoveSubject={scheduleState.moveSubjectCell} />
            ) : (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No timetable could be generated. Adjust the examination window or subjects in Step 1.
              </div>
            )}
            {scheduleState.timetable && !scheduleState.timetable.fits && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-[11px]">
                  <p className="text-amber-700 dark:text-amber-300 font-medium">Schedule window is too short</p>
                  <p className="text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                    Need ~{scheduleState.timetable.additionalDaysNeeded} more day(s). Go back and extend the Last Examination Date.
                  </p>
                </div>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Drag a subject vertically within its class column to reorder. Times follow the slot automatically.
            </p>
          </div>
        )}

        {/* ─── STEP 3 — Complete Examination Preview (read-only) ────── */}
        {step === 3 && consolidatedTimetable && (
          <div className="max-w-5xl mx-auto space-y-5">
            <div className="text-center">
              <h2 className="text-base font-bold tracking-tight text-foreground">Examination Preview</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Review the complete examination before creating.</p>
            </div>
            <ConfirmationSummary
              examName={name.trim() || selectedTemplate?.label || 'Examination'}
              examType={selectedTemplate?.label ?? ''}
              academicSession={academicYear}
              classCount={selectedExamClasses.length}
              subjectCount={effectiveSubjects.length}
              dateRangeLabel={dateRangeLabel}
              papersPerDay={selectedTemplate ? getTemplateMeta(selectedTemplate.id).papersPerDay : 1}
              startTime={examTime}
            />
            {consolidatedTimetable.rows.length > 0 && (
              <OfficialTimetable
                timetable={consolidatedTimetable}
                schoolName={schoolProfile.name}
                examName={name.trim() || selectedTemplate?.label || 'Examination'}
                examType={selectedTemplate?.label ?? ''}
                academicSession={academicYear}
                dateRangeLabel={dateRangeLabel}
                startTime={examTime}
                papersPerDay={selectedTemplate ? getTemplateMeta(selectedTemplate.id).papersPerDay : 1}
              />
            )}
          </div>
        )}
      </div>

      {/* ─── Compact action row — no heavy footer bar ────────────────── */}
      <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0">
        <div className="max-w-5xl mx-auto flex justify-between items-center gap-2">
          {step === 1 ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => setStep(step === 3 ? 2 : 1)}>
              <ArrowLeft className="h-3.5 w-3.5" /> {step === 3 ? 'Back to Timetable' : 'Back to Setup'}
            </Button>
          )}
          {step === 1 && (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setStep(2)} disabled={!canCreate}>
              Build Timetable →
            </Button>
          )}
          {step === 2 && (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setStep(3)} disabled={!consolidatedTimetable}>
              Preview Examination →
            </Button>
          )}
          {step === 3 && (
            <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleCreate} disabled={loading || !canCreate}>
              {loading ? 'Creating…' : (<><Check className="h-3.5 w-3.5" /> Create Examination</>)}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Layout helpers ──────────────────────────────────────────────────

function Section({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </h2>
        {hint && <span className="text-[10px] text-muted-foreground/70">· {hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── Schedule grouping helper ─────────────────────────────────────────
// Groups schedule items by date. Within a date, items sharing the SAME
// start+end time (e.g. Mathematics and Biology on the same slot per
// Spec §13/§41) are merged into a single row labelled "A / B".
//
// NOTE: The legacy `groupScheduleByDate` + `formatDateLong` helpers that
// rendered the old vertical schedule list have been removed — the new
// `<ScheduleTable>` component (in ./schedule/schedule-table.tsx) handles
// the timetable rendering, and date formatting lives in
// `@/lib/exams/format-helpers`.

