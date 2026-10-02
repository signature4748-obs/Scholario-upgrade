/**
 * lesson-planner — server-side data layer for the Teacher Workspace Lesson
 * Planner. The pure scheduling algorithm lives in lesson-schedule.ts
 * (shared with the demo seed); this module owns DB access, teacher scope
 * resolution and the plan payload.
 *
 * Permissions: a teacher may only plan (class, subject) pairs she actually
 * teaches — the canonical CSA-first scope (ClassSubjectAssignment ∪
 * Timetable teacherUserId, with the legacy name-match only as a fallback
 * where the row carries no id), intersected with ACTIVE
 * ClassSubjectAssignments. Class-teacher status grants attendance
 * authority, not lesson planning for subjects she does not teach.
 */

import { db } from '@/lib/db'
import { schoolScoped } from '@/lib/api'
import type { AuthUser } from '@/lib/auth'
import { classLabelOf } from '@/lib/teacher-hub'
import { getTeacherSubjectAssignments } from '@/lib/teacher-scope'
import {
  dayKey,
  isHolidayKey,
  sessionStartFor,
  computeSchedule,
  WEEKDAY_INDEX,
  type HolidayRange,
  type ScheduledTopic,
} from '@/lib/lesson-schedule'
import {
  findCurriculumForClassSubject,
  normalizeTopicName,
  type SubjectCurriculum,
} from '@/lib/curriculum/2026-27'

export type { ScheduledTopic, TopicStatus, HolidayRange } from '@/lib/lesson-schedule'

// ─── Types (client contract) ────────────────────────────────────────────

export interface TeachingAssignment {
  classId: string
  classLabel: string
  subjectId: string
  subjectName: string
  periodsPerWeek: number
}

export interface UnitProgress {
  unitNo: number
  unitName: string
  total: number
  completed: number
}

/** One template topic the teacher's plan does not contain yet (LP-2). */
export interface SyllabusMissingTopic {
  unitNo: number
  unitName: string
  topicName: string
  description: string
  periodsNeeded: number
}

/** Board-syllabus coverage for the selected class + subject (LP-2). */
export interface SyllabusInfo {
  board: string
  boardLabel: string
  bookLabel: string
  subjectLabel: string
  totalTopics: number
  coveredTopics: number
  units: { unitNo: number; unitName: string; topicCount: number; coveredCount: number }[]
  missingTopics: SyllabusMissingTopic[]
}

export interface LessonPlanPayload {
  classId: string
  classLabel: string
  subjectId: string
  subjectName: string
  sourceBoard: string
  sessionStart: string
  pace: {
    periodsPerWeek: number
    periodsPerDay: number
    periodMinutes: number
    teachingDaysPerWeek: number
  }
  progress: { completed: number; total: number; pct: number }
  units: UnitProgress[]
  topics: ScheduledTopic[]
  today: {
    date: string
    topic: ScheduledTopic | null
    reason: string | null
  }
  nextUp: ScheduledTopic[]
  /** Board-syllabus coverage — null when no template matches this pair. */
  syllabus: SyllabusInfo | null
  /** True when THIS request auto-fed the full session plan from the board
   *  syllabus (first open of a newly adopted subject). */
  autoProvisioned: boolean
}

// ─── Teacher scope resolution ───────────────────────────────────────────

export async function getTeachingAssignments(user: AuthUser): Promise<TeachingAssignment[]> {
  const schoolId = schoolScoped(user)
  const teacher = await db.teacher.findUnique({ where: { userId: user.id } })
  if (!teacher || teacher.schoolId !== schoolId) return []

  // PIH-4a — CSA-first: reuse the canonical resolver (teacher-scope.ts) —
  // ClassSubjectAssignment(teacherUserId) ∪ Timetable(teacherUserId) ∪
  // legacy Timetable(teacherName ONLY when the row carries no teacher
  // user id). The old bare lowercased NAME match let any same-named
  // account inherit (or lose) the planning scope.
  const assignments = await getTeacherSubjectAssignments(user, schoolId)
  if (assignments.length === 0) return []

  // Permission gate: only ACTIVE ClassSubjectAssignments count.
  // periodsPerWeek — the teacher's OWN timetable cells per pair (id-linked
  // first; legacy name-matched cells only where the row has no id).
  // 8B-7-f — these four reads are independent of each other (the class /
  // subject ids derive from `assignments` above), so they run in ONE
  // parallel round (was three sequential rounds). Same rows, same result.
  const teacherName = (user.name || '').trim().toLowerCase()
  const classIds = [...new Set(assignments.map((a) => a.classId))]
  const subjectIds = [...new Set(assignments.map((a) => a.subjectId))]
  const [csas, ttRows, classRows, subjectRows] = await Promise.all([
    db.classSubjectAssignment.findMany({
      where: { schoolId, isActive: true },
      select: { classId: true, subjectId: true },
    }),
    db.timetable.findMany({
      where: { schoolId, subjectId: { not: null } },
      select: { classId: true, subjectId: true, teacherUserId: true, teacherName: true },
    }),
    db.class.findMany({
      where: { schoolId, id: { in: classIds } },
      select: { id: true, name: true, section: true },
    }),
    db.subject.findMany({
      where: { schoolId, id: { in: subjectIds } },
      select: { id: true, name: true },
    }),
  ])
  const activeKeys = new Set(csas.map((c) => `${c.classId}|${c.subjectId}`))

  const cellCount = new Map<string, number>()
  for (const r of ttRows) {
    if (!r.subjectId) continue
    const mine =
      r.teacherUserId === user.id ||
      (!r.teacherUserId && teacherName !== '' && (r.teacherName || '').trim().toLowerCase() === teacherName)
    if (!mine) continue
    const key = `${r.classId}|${r.subjectId}`
    cellCount.set(key, (cellCount.get(key) ?? 0) + 1)
  }
  const classById = new Map(classRows.map((c) => [c.id, c]))
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]))

  const byKey = new Map<string, TeachingAssignment>()
  for (const a of assignments) {
    const key = `${a.classId}|${a.subjectId}`
    if (!activeKeys.has(key)) continue
    const cls = classById.get(a.classId)
    const subject = subjectById.get(a.subjectId)
    if (!cls || !subject) continue
    const cells = cellCount.get(key) ?? 0
    const existing = byKey.get(key)
    if (existing) {
      existing.periodsPerWeek = Math.max(existing.periodsPerWeek, cells)
    } else {
      byKey.set(key, {
        classId: a.classId,
        classLabel: classLabelOf(cls),
        subjectId: a.subjectId,
        subjectName: subject.name,
        periodsPerWeek: cells,
      })
    }
  }
  // Numeric class order (6 → 12) — a lexicographic sort would list
  // "Grade 11" before "Grade 6".
  const levelOf = (label: string) => Number(label.match(/\d{1,2}/)?.[0] ?? 99)
  return [...byKey.values()].sort(
    (a, b) => levelOf(a.classLabel) - levelOf(b.classLabel) || a.classLabel.localeCompare(b.classLabel) || a.subjectName.localeCompare(b.subjectName),
  )
}

// ─── Pace + calendar ────────────────────────────────────────────────────

interface ClassPace {
  periodsPerWeek: number
  teachingDaysPerWeek: number
  periodMinutes: number
  teachingWeekdays: number[]
}

/** The shape `classPaceOf` needs — what the per-class timetable query
 *  (and the 8B-7-f batched variant) selects. */
type PaceRow = { day: string; subjectId: string | null; startTime: string | null; endTime: string | null }

/** PURE pace derivation over ONE class's timetable rows (all subjects of
 *  the class — the historical getClassPace row set). Shared by the async
 *  per-class fetch and the 8B-7-f batched fetch so the two can never
 *  drift. `rows` MUST be every timetable row of that class for the
 *  school, exactly as `getClassPace` selects them. */
function classPaceOf(rows: PaceRow[], subjectId: string | null): ClassPace {
  const days = new Set(rows.map((r) => r.day))
  const subjectCells = subjectId ? rows.filter((r) => r.subjectId === subjectId).length : 0

  let periodMinutes = 45
  for (const r of rows) {
    if (r.startTime && r.endTime) {
      const [sh, sm] = r.startTime.split(':').map(Number)
      const [eh, em] = r.endTime.split(':').map(Number)
      const mins = eh * 60 + em - (sh * 60 + sm)
      if (mins > 20 && mins < 90) {
        periodMinutes = mins
        break
      }
    }
  }

  return {
    periodsPerWeek: subjectCells,
    teachingDaysPerWeek: days.size || 6,
    periodMinutes,
    teachingWeekdays: [...days].map((d) => WEEKDAY_INDEX[d]).filter((n) => n !== undefined),
  }
}

async function getClassPace(schoolId: string, classId: string, subjectId: string | null): Promise<ClassPace> {
  const rows = await db.timetable.findMany({
    where: { schoolId, classId },
    select: { day: true, subjectId: true, startTime: true, endTime: true },
  })
  return classPaceOf(rows, subjectId)
}

export async function getHolidays(schoolId: string): Promise<HolidayRange[]> {
  const events = await db.schoolEvent.findMany({
    where: { schoolId, type: 'HOLIDAY' },
    select: { title: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  })
  return events.map((e) => ({
    title: e.title,
    start: dayKey(e.startDate),
    end: dayKey(e.endDate ?? e.startDate),
  }))
}

// ─── Global curriculum library (2026-27) ────────────────────────────────

/** Boards whose schools attach the NCERT-based library curriculum. */
const LIBRARY_BOARDS = new Set(['CBSE', 'UP_BOARD', 'NCERT', ''])

/** PURE board→curriculum resolution (no DB). `schoolExists` and `board`
 *  are the caller's already-fetched school row — identical logic to the
 *  async `resolveCurriculumFor` fetch path, extracted so the 8B-7-f batch
 *  (one school fetch for the whole request) resolves every pair with the
 *  same semantics. */
function resolveCurriculumForBoard(
  schoolExists: boolean,
  board: string | null,
  classLabel: string,
  subjectName: string,
): SubjectCurriculum | null {
  if (schoolExists && !LIBRARY_BOARDS.has((board || '').trim().toUpperCase())) {
    // ICSE / STATE / CUSTOM boards carry no library curriculum — the planner
    // falls back to its honest "build your own plan" state for them.
    return null
  }
  const found = findCurriculumForClassSubject(classLabel, subjectName)
  return found?.curriculum ?? null
}

async function resolveCurriculumFor(
  schoolId: string,
  classLabel: string,
  subjectName: string,
): Promise<SubjectCurriculum | null> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { board: true },
  })
  return resolveCurriculumForBoard(school != null, school?.board ?? null, classLabel, subjectName)
}

/** Instantiate library chapters as the class+subject's curriculum.
 *  `chaptersToCreate` defaults to the whole curriculum (auto-attach) — the
 *  merge path passes only the missing ones. */
async function instantiateCurriculum(
  schoolId: string,
  classId: string,
  subjectId: string,
  curriculum: SubjectCurriculum,
  existing: { orderIndex: number; topicNo: number }[],
  chaptersToCreate: { unitNo: number; unitName: string; name: string; description: string; periods: number }[],
): Promise<number> {
  if (chaptersToCreate.length === 0) return 0
  const baseOrder = existing.length > 0 ? Math.max(...existing.map((t) => t.orderIndex)) : 0
  let topicNo = existing.length > 0 ? Math.max(...existing.map((t) => t.topicNo)) : 0
  for (let i = 0; i < chaptersToCreate.length; i++) {
    const t = chaptersToCreate[i]
    await db.curriculumTopic.create({
      data: {
        schoolId,
        classId,
        subjectId,
        sourceBoard: curriculum.sourceBoard,
        unitNo: t.unitNo,
        unitName: t.unitName,
        topicNo: ++topicNo,
        topicName: t.name,
        description: t.description,
        periodsNeeded: t.periods,
        orderIndex: baseOrder + (i + 1) * 10,
      },
    })
  }
  return chaptersToCreate.length
}

/** Flatten a curriculum into chapter seeds (unit order preserved). */
function flattenCurriculum(curriculum: SubjectCurriculum) {
  return curriculum.units.flatMap((u) =>
    u.topics.map((t) => ({ unitNo: u.unitNo, unitName: u.unitName, ...t })),
  )
}

/** Attach the official curriculum to a configured (class, subject) pair.
 *  Safe to call repeatedly — it only instantiates when nothing exists yet.
 *  Intended to be called when a principal configures a subject AND on the
 *  teacher's first plan open (spec §11). */
export async function attachCurriculumForAssignment(
  schoolId: string,
  classId: string,
  classLabel: string,
  subjectId: string,
  subjectName: string,
): Promise<number> {
  const existing = await db.curriculumTopic.findMany({
    where: { schoolId, classId, subjectId },
    select: { id: true },
  })
  if (existing.length > 0) return 0
  const curriculum = await resolveCurriculumFor(schoolId, classLabel, subjectName)
  if (!curriculum) return 0
  return instantiateCurriculum(schoolId, classId, subjectId, curriculum, [], flattenCurriculum(curriculum))
}

function buildSyllabusInfo(
  curriculum: SubjectCurriculum,
  planTopicNames: string[],
): SyllabusInfo {
  const missingTopics = missingChaptersOf(curriculum, planTopicNames)
  const missingByUnit = new Map<number, number>()
  for (const m of missingTopics) missingByUnit.set(m.unitNo, (missingByUnit.get(m.unitNo) ?? 0) + 1)
  const units = curriculum.units.map((u) => ({
    unitNo: u.unitNo,
    unitName: u.unitName,
    topicCount: u.topics.length,
    coveredCount: u.topics.length - (missingByUnit.get(u.unitNo) ?? 0),
  }))
  const totalTopics = flattenCurriculum(curriculum).length
  return {
    // Honest board derivation — a UP-Board school's curriculum now badges
    // as UP BOARD (the badge map in syllabus-library falls back to CBSE
    // only for genuinely unknown boards).
    board: curriculum.sourceBoard,
    boardLabel: `${curriculum.sourceBoard.replace('-', ' · ')} syllabus`,
    bookLabel: curriculum.bookLabel,
    subjectLabel: curriculum.subjectLabel,
    totalTopics,
    coveredTopics: totalTopics - missingTopics.length,
    units,
    missingTopics,
  }
}

/** Multiset chapter diff — the Nth same-named library chapter only counts
 *  as present when the plan carries at least N same-named rows. NCERT
 *  legitimately reuses chapter titles across a subject's books (Class 11
 *  Economics has "Introduction" in BOTH Statistics for Economics U1 and
 *  Introductory Microeconomics U2); a plain name-set would mark the second
 *  one "covered" forever, even after the teacher deletes it. */
function missingChaptersOf(
  curriculum: SubjectCurriculum,
  planTopicNames: string[],
): SyllabusMissingTopic[] {
  const counts = new Map<string, number>()
  for (const n of planTopicNames) counts.set(n, (counts.get(n) ?? 0) + 1)
  const missing: SyllabusMissingTopic[] = []
  for (const chapter of flattenCurriculum(curriculum)) {
    const key = normalizeTopicName(chapter.name)
    const seen = counts.get(key) ?? 0
    if (seen > 0) {
      counts.set(key, seen - 1)
    } else {
      missing.push({
        unitNo: chapter.unitNo,
        unitName: chapter.unitName,
        topicName: chapter.name,
        description: chapter.description,
        periodsNeeded: chapter.periods,
      })
    }
  }
  return missing
}

// ─── Custom topic authoring (LP-2: “very easy to add”) ───────────────────

export interface AddTopicInput {
  classId: string
  subjectId: string
  /** Existing unit number, or null to append a brand-new unit. */
  unitNo: number | null
  /** Required when creating a new unit. */
  unitName: string | null
  topicName: string
  description: string | null
  periodsNeeded: number
}

async function assertOwnsAssignment(
  user: AuthUser,
  classId: string,
  subjectId: string,
): Promise<{ schoolId: string; classLabel: string; subjectName: string }> {
  const schoolId = schoolScoped(user)
  const assignments = await getTeachingAssignments(user)
  const owns = assignments.find((a) => a.classId === classId && a.subjectId === subjectId)
  if (!owns) throw new Error('FORBIDDEN')
  return { schoolId, classLabel: owns.classLabel, subjectName: owns.subjectName }
}

/** Rewrite orderIndex positions after a splice (keeps the schedule order). */
async function rewriteOrderIndexes(
  rows: { id: string; orderIndex: number }[],
  orderedIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const desired = (i + 1) * 10
    const row = rows.find((r) => r.id === orderedIds[i])
    if (row && row.orderIndex !== desired) {
      await db.curriculumTopic.update({ where: { id: orderedIds[i] }, data: { orderIndex: desired } })
    }
  }
}

/** Add a custom topic at the end of its unit — position-aware. */
export async function addCustomTopic(user: AuthUser, input: AddTopicInput): Promise<string> {
  const { schoolId } = await assertOwnsAssignment(user, input.classId, input.subjectId)

  const name = input.topicName.trim()
  if (!name || name.length > 160) throw new Error('A topic name (1–160 characters) is required')
  const periods = Math.min(60, Math.max(1, Math.round(input.periodsNeeded || 4)))

  const existing = await db.curriculumTopic.findMany({
    where: { schoolId, classId: input.classId, subjectId: input.subjectId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, unitNo: true, unitName: true, topicNo: true, orderIndex: true },
  })

  // Resolve the target unit.
  const unitNumbers = [...new Set(existing.map((t) => t.unitNo))]
  let unitNo: number
  let unitName: string
  if (input.unitNo != null && unitNumbers.includes(input.unitNo)) {
    unitNo = input.unitNo
    unitName = existing.find((t) => t.unitNo === input.unitNo)?.unitName ?? 'Topics'
  } else {
    unitNo = unitNumbers.length > 0 ? Math.max(...unitNumbers) + 1 : 1
    unitName = (input.unitName ?? '').trim() || 'My Topics'
  }

  const topicNo = existing.reduce((m, t) => Math.max(m, t.topicNo), 0) + 1

  const created = await db.curriculumTopic.create({
    data: {
      schoolId,
      classId: input.classId,
      subjectId: input.subjectId,
      sourceBoard: 'CUSTOM',
      unitNo,
      unitName,
      topicNo,
      topicName: name,
      description: input.description?.trim() ? input.description.trim().slice(0, 400) : null,
      periodsNeeded: periods,
      orderIndex: 0, // rewritten below
    },
    select: { id: true },
  })

  // Position: after the last topic of the target unit (new units go last).
  let insertAt = existing.length
  if (existing.some((t) => t.unitNo === unitNo)) {
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].unitNo === unitNo) insertAt = i + 1
    }
  }
  const orderedIds = existing.map((t) => t.id)
  orderedIds.splice(insertAt, 0, created.id)
  const rowsForOrder = [...existing.map((t) => ({ id: t.id, orderIndex: t.orderIndex })), { id: created.id, orderIndex: 0 }]
  await rewriteOrderIndexes(rowsForOrder, orderedIds)
  return created.id
}

export interface UpdateTopicInput {
  topicId: string
  topicName?: string
  description?: string | null
  periodsNeeded?: number
  /** Move to another EXISTING unit. */
  unitNo?: number
}

export async function updateCustomTopic(user: AuthUser, input: UpdateTopicInput): Promise<void> {
  const topic = await db.curriculumTopic.findUnique({
    where: { id: input.topicId },
    select: { id: true, schoolId: true, classId: true, subjectId: true, unitNo: true, orderIndex: true, topicNo: true },
  })
  if (!topic) throw new Error('Topic not found')
  await assertOwnsAssignment(user, topic.classId, topic.subjectId)
  if (topic.schoolId !== schoolScoped(user)) throw new Error('FORBIDDEN')

  const data: { topicName?: string; description?: string | null; periodsNeeded?: number; unitNo?: number; unitName?: string } = {}
  if (input.topicName != null) {
    const name = input.topicName.trim()
    if (!name || name.length > 160) throw new Error('A topic name (1–160 characters) is required')
    data.topicName = name
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() ? input.description.trim().slice(0, 400) : null
  }
  if (input.periodsNeeded != null) {
    data.periodsNeeded = Math.min(60, Math.max(1, Math.round(input.periodsNeeded)))
  }

  const siblings = await db.curriculumTopic.findMany({
    where: { schoolId: topic.schoolId, classId: topic.classId, subjectId: topic.subjectId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, unitNo: true, unitName: true, orderIndex: true },
  })

  if (input.unitNo != null && input.unitNo !== topic.unitNo) {
    const target = siblings.find((t) => t.unitNo === input.unitNo)
    if (!target) throw new Error('That unit does not exist in this plan')
    data.unitNo = target.unitNo
    data.unitName = target.unitName
  }

  await db.curriculumTopic.update({ where: { id: topic.id }, data })

  // If the unit changed, move the topic to the end of its new unit.
  if (data.unitNo != null) {
    const others = siblings.filter((t) => t.id !== topic.id)
    const orderedIds = others.map((t) => t.id)
    let insertAt = orderedIds.length
    for (let i = 0; i < others.length; i++) {
      if (others[i].unitNo === data.unitNo) insertAt = i + 1
    }
    orderedIds.splice(insertAt, 0, topic.id)
    const rowsForOrder = [...others.map((t) => ({ id: t.id, orderIndex: t.orderIndex })), { id: topic.id, orderIndex: topic.orderIndex }]
    await rewriteOrderIndexes(rowsForOrder, orderedIds)
  }
}

export async function deleteCustomTopic(user: AuthUser, topicId: string): Promise<void> {
  const topic = await db.curriculumTopic.findUnique({
    where: { id: topicId },
    select: { id: true, schoolId: true, classId: true, subjectId: true },
  })
  if (!topic) throw new Error('Topic not found')
  await assertOwnsAssignment(user, topic.classId, topic.subjectId)
  if (topic.schoolId !== schoolScoped(user)) throw new Error('FORBIDDEN')

  const completion = await db.lessonTopicCompletion.findUnique({
    where: { curriculumTopicId: topic.id },
    select: { id: true },
  })
  if (completion) {
    throw new Error('This topic is already completed — undo the completion before deleting it')
  }

  const siblings = await db.curriculumTopic.findMany({
    where: { schoolId: topic.schoolId, classId: topic.classId, subjectId: topic.subjectId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, orderIndex: true },
  })
  await db.curriculumTopic.delete({ where: { id: topic.id } })
  const orderedIds = siblings.filter((t) => t.id !== topic.id).map((t) => t.id)
  await rewriteOrderIndexes(siblings, orderedIds)
}

/** Add every library chapter the plan is missing (LP-2 syllabus merge).
 *  Multiset-aware: same-named chapters are matched by count (see
 *  missingChaptersOf). */
export async function mergeSyllabusTemplate(
  user: AuthUser,
  classId: string,
  subjectId: string,
): Promise<{ added: number }> {
  const { schoolId, classLabel, subjectName } = await assertOwnsAssignment(user, classId, subjectId)
  const curriculum = await resolveCurriculumFor(schoolId, classLabel, subjectName)
  if (!curriculum) throw new Error('No board curriculum exists for this subject')

  const existing = await db.curriculumTopic.findMany({
    where: { schoolId, classId, subjectId },
    orderBy: { orderIndex: 'asc' },
    select: { orderIndex: true, topicNo: true, topicName: true },
  })
  const missing = missingChaptersOf(
    curriculum,
    existing.map((t) => normalizeTopicName(t.topicName)),
  )
  if (missing.length === 0) return { added: 0 }

  const added = await instantiateCurriculum(
    schoolId,
    classId,
    subjectId,
    curriculum,
    existing.map((t) => ({ orderIndex: t.orderIndex, topicNo: t.topicNo })),
    missing.map((m) => ({
      unitNo: m.unitNo,
      unitName: m.unitName,
      name: m.topicName,
      description: m.description,
      periods: m.periodsNeeded,
    })),
  )
  return { added }
}


export async function getLessonPlan(
  user: AuthUser,
  classId: string,
  subjectId: string
): Promise<LessonPlanPayload | null> {
  const assignments = await getTeachingAssignments(user)
  const assignment = assignments.find((a) => a.classId === classId && a.subjectId === subjectId)
  if (!assignment) return null

  const schoolId = schoolScoped(user)
  let [school, topicRows, completionRows, pace, holidays] = await Promise.all([
    db.school.findUnique({ where: { id: schoolId }, select: { academicYear: true, board: true } }),
    db.curriculumTopic.findMany({
      where: { schoolId, classId, subjectId },
      orderBy: { orderIndex: 'asc' },
    }),
    db.lessonTopicCompletion.findMany({
      where: { schoolId, classId, subjectId },
      select: { curriculumTopicId: true, completedOn: true, note: true },
    }),
    getClassPace(schoolId, classId, subjectId),
    getHolidays(schoolId),
  ])

  // ── AUTO-ATTACH (spec §11): a newly configured subject has no curriculum
  // yet — instantiate the COMPLETE official 2026-27 plan from the global
  // curriculum library the moment the teacher opens it. Failures are quiet:
  // the plan simply renders its honest empty state.
  let autoProvisioned = false
  if (topicRows.length === 0) {
    const curriculum = await resolveCurriculumFor(schoolId, assignment.classLabel, assignment.subjectName)
    if (curriculum) {
      try {
        const fed = await instantiateCurriculum(schoolId, classId, subjectId, curriculum, [], flattenCurriculum(curriculum))
        if (fed > 0) {
          autoProvisioned = true
          topicRows = await db.curriculumTopic.findMany({
            where: { schoolId, classId, subjectId },
            orderBy: { orderIndex: 'asc' },
          })
        }
      } catch {
        // Auto-attach is best-effort; never block the plan read.
      }
    }
  }

  const today = new Date()
  const sessionStart = sessionStartFor(school?.academicYear, today)
  const completions = new Map(
    completionRows.map((c) => [c.curriculumTopicId, { completedOn: dayKey(c.completedOn), note: c.note }])
  )
  const topics = computeSchedule({
    topics: topicRows.map((t) => ({
      id: t.id,
      unitNo: t.unitNo,
      unitName: t.unitName,
      topicNo: t.topicNo,
      topicName: t.topicName,
      description: t.description,
      periodsNeeded: t.periodsNeeded,
      orderIndex: t.orderIndex,
    })),
    completions,
    sessionStart,
    today,
    pace,
    holidays,
  })
  // Display numbering follows the SCHEDULE order (custom inserts keep the
  // on-screen sequence tidy even though stored topicNo stays insert-stable).
  topics.forEach((t, i) => {
    t.topicNo = i + 1
  })

  const completed = topics.filter((t) => t.status === 'completed').length
  const total = topics.length
  const unitMap = new Map<string, UnitProgress>()
  for (const t of topics) {
    const key = `${t.unitNo}|${t.unitName}`
    let u = unitMap.get(key)
    if (!u) {
      u = { unitNo: t.unitNo, unitName: t.unitName, total: 0, completed: 0 }
      unitMap.set(key, u)
    }
    u.total += 1
    if (t.status === 'completed') u.completed += 1
  }

  const todayKeyStr = dayKey(today)
  const todayTopic =
    topics.find((t) => t.status === 'today') ?? topics.find((t) => t.status === 'in-progress')
    // A topic completed TODAY still owns the hero — it renders in its quiet
    // "Completed · <date>" state with an Undo link, instead of the teacher's
    // just-finished lesson vanishing into "No lesson scheduled for today".
    ?? topics.find((t) => t.status === 'completed' && t.completedOn === todayKeyStr)
    ?? null
  let reason: string | null = null
  if (!todayTopic) {
    const holiday = isHolidayKey(todayKeyStr, holidays)
    if (holiday) {
      reason = `School holiday — ${holiday.title}`
    } else if (pace.teachingWeekdays.length > 0 && !pace.teachingWeekdays.includes(today.getUTCDay())) {
      reason = 'No classes scheduled today'
    } else if (topics.length > 0 && topics[topics.length - 1].status === 'completed') {
      reason = 'Curriculum completed for this session'
    } else {
      reason = 'No lesson scheduled for today'
    }
  }

  const periodsPerDay = pace.periodsPerWeek > 0
    ? pace.periodsPerWeek / Math.max(1, pace.teachingDaysPerWeek)
    : 1

  // Board-curriculum coverage (LP-2) — null when the library carries no
  // curriculum for this class+subject (honest empty state, custom plans).
  let syllabus: SyllabusInfo | null = null
  {
    const curriculum = await resolveCurriculumFor(schoolId, assignment.classLabel, assignment.subjectName)
    if (curriculum) {
      syllabus = buildSyllabusInfo(curriculum, topicRows.map((t) => normalizeTopicName(t.topicName)))
    }
  }

  return {
    classId,
    classLabel: assignment.classLabel,
    subjectId,
    subjectName: assignment.subjectName,
    sourceBoard: topicRows[0]?.sourceBoard ?? school?.board ?? 'CBSE',
    sessionStart: dayKey(sessionStart),
    pace: {
      periodsPerWeek: pace.periodsPerWeek,
      periodsPerDay: Math.round(periodsPerDay * 10) / 10,
      periodMinutes: pace.periodMinutes,
      teachingDaysPerWeek: pace.teachingDaysPerWeek,
    },
    progress: { completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 },
    units: [...unitMap.values()].sort((a, b) => a.unitNo - b.unitNo),
    topics,
    today: { date: todayKeyStr, topic: todayTopic, reason },
    nextUp: topics.filter((t) => t.status === 'upcoming' || t.status === 'today').slice(0, 5),
    syllabus,
    autoProvisioned,
  }
}

// ─── Batched plan reads (8B-7-f — teacher-dashboard N+1 fix) ────────────

/**
 * getLessonPlan for MANY assignments in ONE round of queries — the 8B-7-f
 * fix for the teacher dashboard N+1 (one getLessonPlan call ≈ 13 queries
 * per assignment, dominated by a full getTeachingAssignments re-resolution
 * every time). Resolves the exact same underlying rows, batched:
 *
 *   · School row (academicYear + board)      — ONE fetch, shared (was 2
 *     per pair: the plan fetch + the syllabus board lookup)
 *   · CurriculumTopic rows                   — ONE findMany over OR'd
 *     (classId, subjectId) pairs, grouped in memory (was 1 per pair)
 *   · LessonTopicCompletion rows             — ONE findMany over the same
 *     OR pairs (was 1 per pair)
 *   · Timetable pace rows                    — ONE findMany for every
 *     involved class (the per-pair pace query filters on
 *     { schoolId, classId } only, so one fetch per DISTINCT class covers
 *     every pair; grouped in memory) (was 1 per pair)
 *   · SchoolEvent holidays                   — ONE fetch (was 1 per pair)
 *
 * Authorization contract: identical to getLessonPlan — callers pass the
 * pairs resolved by `getTeachingAssignments(user)` (the same list
 * getLessonPlan re-resolves internally and matches each (classId,
 * subjectId) against). Payload semantics are identical too, including the
 * rare spec-§11 auto-attach for pairs with no topics yet (first open) —
 * the per-chapter instantiation writes are kept, and the fed pairs
 * re-fetch in one query.
 *
 * Returns a Map keyed `${classId}|${subjectId}` → LessonPlanPayload. A
 * pair whose payload computation throws is skipped (the same containment
 * the dashboard's per-assignment try/catch had); a pair not present in
 * the map simply has no plan.
 */
export async function getLessonPlansBatch(
  user: AuthUser,
  assignments: TeachingAssignment[],
): Promise<Map<string, LessonPlanPayload>> {
  const out = new Map<string, LessonPlanPayload>()
  // Same key/dedup discipline as getTeachingAssignments's byKey map.
  const byKey = new Map<string, TeachingAssignment>()
  for (const a of assignments) byKey.set(`${a.classId}|${a.subjectId}`, a)
  const pairs = [...byKey.values()]
  if (pairs.length === 0) return out
  const schoolId = schoolScoped(user)

  const pairFilter = {
    schoolId,
    OR: pairs.map((a) => ({ classId: a.classId, subjectId: a.subjectId })),
  }
  const classIds = [...new Set(pairs.map((a) => a.classId))]

  const [school, topicRows, completionRows, paceRows, holidays] = await Promise.all([
    db.school.findUnique({ where: { id: schoolId }, select: { academicYear: true, board: true } }),
    db.curriculumTopic.findMany({ where: pairFilter, orderBy: { orderIndex: 'asc' } }),
    db.lessonTopicCompletion.findMany({
      where: pairFilter,
      select: { classId: true, subjectId: true, curriculumTopicId: true, completedOn: true, note: true },
    }),
    db.timetable.findMany({
      where: { schoolId, classId: { in: classIds } },
      select: { classId: true, day: true, subjectId: true, startTime: true, endTime: true },
    }),
    getHolidays(schoolId),
  ])

  // Group the batched rows per (classId, subjectId) / per class. The global
  // orderIndex ordering preserves each pair's per-pair order (the same
  // `orderBy: { orderIndex: 'asc' }` the per-pair query used).
  const topicsByPair = new Map<string, typeof topicRows>()
  for (const t of topicRows) {
    const k = `${t.classId}|${t.subjectId}`
    const list = topicsByPair.get(k) ?? []
    list.push(t)
    topicsByPair.set(k, list)
  }
  const completionsByPair = new Map<string, typeof completionRows>()
  for (const c of completionRows) {
    const k = `${c.classId}|${c.subjectId}`
    const list = completionsByPair.get(k) ?? []
    list.push(c)
    completionsByPair.set(k, list)
  }
  const paceRowsByClass = new Map<string, PaceRow[]>()
  for (const r of paceRows) {
    const list = paceRowsByClass.get(r.classId) ?? []
    list.push(r)
    paceRowsByClass.set(r.classId, list)
  }

  // AUTO-ATTACH (spec §11) — same semantics as getLessonPlan: a pair with
  // no topics yet instantiates the COMPLETE official 2026-27 plan on its
  // first read. Rare path (first open per pair); failures stay quiet.
  const schoolExists = school != null
  const fedKeys = new Set<string>()
  for (const a of pairs) {
    if ((topicsByPair.get(`${a.classId}|${a.subjectId}`) ?? []).length > 0) continue
    const curriculum = resolveCurriculumForBoard(schoolExists, school?.board ?? null, a.classLabel, a.subjectName)
    if (!curriculum) continue
    try {
      const fed = await instantiateCurriculum(schoolId, a.classId, a.subjectId, curriculum, [], flattenCurriculum(curriculum))
      if (fed > 0) fedKeys.add(`${a.classId}|${a.subjectId}`)
    } catch {
      // Auto-attach is best-effort; never block the plan read.
    }
  }
  if (fedKeys.size > 0) {
    // One re-fetch for every auto-attached pair (the per-pair re-read of
    // getLessonPlan, batched).
    const refed = await db.curriculumTopic.findMany({
      where: {
        schoolId,
        OR: [...fedKeys].map((k) => {
          const [classId, subjectId] = k.split('|')
          return { classId, subjectId }
        }),
      },
      orderBy: { orderIndex: 'asc' },
    })
    for (const t of refed) {
      const k = `${t.classId}|${t.subjectId}`
      const list = topicsByPair.get(k) ?? []
      list.push(t)
      topicsByPair.set(k, list)
    }
  }

  const today = new Date()
  const sessionStart = sessionStartFor(school?.academicYear, today)
  const todayKeyStr = dayKey(today)

  for (const a of pairs) {
    const key = `${a.classId}|${a.subjectId}`
    try {
      const pairTopicRows = topicsByPair.get(key) ?? []
      const completions = new Map(
        (completionsByPair.get(key) ?? []).map((c) => [c.curriculumTopicId, { completedOn: dayKey(c.completedOn), note: c.note }]),
      )
      const pace = classPaceOf(paceRowsByClass.get(a.classId) ?? [], a.subjectId)

      const topics = computeSchedule({
        topics: pairTopicRows.map((t) => ({
          id: t.id,
          unitNo: t.unitNo,
          unitName: t.unitName,
          topicNo: t.topicNo,
          topicName: t.topicName,
          description: t.description,
          periodsNeeded: t.periodsNeeded,
          orderIndex: t.orderIndex,
        })),
        completions,
        sessionStart,
        today,
        pace,
        holidays,
      })
      // Display numbering follows the SCHEDULE order (mirrors getLessonPlan:
      // custom inserts keep the on-screen sequence tidy even though stored
      // topicNo stays insert-stable).
      topics.forEach((t, i) => {
        t.topicNo = i + 1
      })

      const completed = topics.filter((t) => t.status === 'completed').length
      const total = topics.length
      const unitMap = new Map<string, UnitProgress>()
      for (const t of topics) {
        const uKey = `${t.unitNo}|${t.unitName}`
        let u = unitMap.get(uKey)
        if (!u) {
          u = { unitNo: t.unitNo, unitName: t.unitName, total: 0, completed: 0 }
          unitMap.set(uKey, u)
        }
        u.total += 1
        if (t.status === 'completed') u.completed += 1
      }

      const todayTopic =
        topics.find((t) => t.status === 'today') ?? topics.find((t) => t.status === 'in-progress')
        // A topic completed TODAY still owns the hero (see getLessonPlan).
        ?? topics.find((t) => t.status === 'completed' && t.completedOn === todayKeyStr)
        ?? null
      let reason: string | null = null
      if (!todayTopic) {
        const holiday = isHolidayKey(todayKeyStr, holidays)
        if (holiday) {
          reason = `School holiday — ${holiday.title}`
        } else if (pace.teachingWeekdays.length > 0 && !pace.teachingWeekdays.includes(today.getUTCDay())) {
          reason = 'No classes scheduled today'
        } else if (topics.length > 0 && topics[topics.length - 1].status === 'completed') {
          reason = 'Curriculum completed for this session'
        } else {
          reason = 'No lesson scheduled for today'
        }
      }

      const periodsPerDay = pace.periodsPerWeek > 0
        ? pace.periodsPerWeek / Math.max(1, pace.teachingDaysPerWeek)
        : 1

      // Board-curriculum coverage (LP-2) — the school board is already in
      // hand, so the per-pair board lookup is resolved synchronously (same
      // resolveCurriculumFor semantics via the shared pure core).
      let syllabus: SyllabusInfo | null = null
      {
        const curriculum = resolveCurriculumForBoard(schoolExists, school?.board ?? null, a.classLabel, a.subjectName)
        if (curriculum) {
          syllabus = buildSyllabusInfo(curriculum, pairTopicRows.map((t) => normalizeTopicName(t.topicName)))
        }
      }

      out.set(key, {
        classId: a.classId,
        classLabel: a.classLabel,
        subjectId: a.subjectId,
        subjectName: a.subjectName,
        sourceBoard: pairTopicRows[0]?.sourceBoard ?? school?.board ?? 'CBSE',
        sessionStart: dayKey(sessionStart),
        pace: {
          periodsPerWeek: pace.periodsPerWeek,
          periodsPerDay: Math.round(periodsPerDay * 10) / 10,
          periodMinutes: pace.periodMinutes,
          teachingDaysPerWeek: pace.teachingDaysPerWeek,
        },
        progress: { completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 },
        units: [...unitMap.values()].sort((a, b) => a.unitNo - b.unitNo),
        topics,
        today: { date: todayKeyStr, topic: todayTopic, reason },
        nextUp: topics.filter((t) => t.status === 'upcoming' || t.status === 'today').slice(0, 5),
        syllabus,
        autoProvisioned: fedKeys.has(key),
      })
    } catch {
      // Per-pair containment — a failing pair drops only itself (the same
      // contract the dashboard's per-assignment try/catch had).
    }
  }
  return out
}
