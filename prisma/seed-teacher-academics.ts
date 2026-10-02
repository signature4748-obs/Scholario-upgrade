import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'
import {
  DEMO_SCHOOL_SLUG,
  DEMO_CLASS_LEVELS,
  PROBE_SUBJECT_CODE,
  DEMO_STUDENT_POSITION,
} from './seed-identity'
import { CSA_MATRIX, FACULTY, SUBJECTS, facultyEmail } from './hawkings-corpus'
import { HOLIDAY_SEED } from './holiday-data'
import {
  computeSchedule,
  sessionStartFor,
  dayKey,
  parseDayKey,
  addDays,
  WEEKDAY_INDEX,
} from '../src/lib/lesson-schedule'
import {
  findCurriculumForClassSubject,
  validateRegistry,
} from '../src/lib/curriculum/2026-27'

const db = new PrismaClient()

/**
 * seed-teacher-academics — v4: the PRINCIPAL-CONFIGURED academic setup for
 * HAWKINGS HIGH SCHOOL PRITHVIPUR (final-acceptance corpus), session
 * 2026-27.
 *
 * WHAT THIS SEED ESTABLISHES:
 *  1. CSA — the full ClassSubjectAssignment matrix from
 *     prisma/hawkings-corpus.ts (86 assignments across the 15 classes:
 *     pre-primary + primary taught by their class teachers; classes 6–12
 *     by the subject specialists; DRW/GPE non-examinable).
 *  2. TIMETABLES — a conflict-free 6-day × 8-period grid (Mon–Sat,
 *     08:00–15:00) placed with the same most-constrained-teacher-first
 *     greedy fill as v3: no teacher is ever in two places at one slot
 *     (the DB-level unique guarantees it), and every class gets its
 *     periodsPerWeek quota.
 *  3. CURRICULUM — instantiated automatically from the GLOBAL 2026-27
 *     NCERT/CBSE library for every 6–12 (class, subject) that matches
 *     (Mathematics/Science/English/Hindi/Social Science + senior
 *     Physics/Chemistry/Biology). Primary and custom subjects (EVS,
 *     Sanskrit, Computer Education, Drawing, Games) keep the honest
 *     "no board curriculum — build your own plan" planner state.
 *  4. COMPLETION HISTORY — every topic whose timetable-derived window
 *     ended before today is marked completed ON that date (the same
 *     scheduler the API runs). 10-A Social Science keeps two overdue
 *     topics uncompleted (the honest "Needs Rescheduling" state).
 *  5. PERIODIC ASSESSMENT 1 (July 2026, COMPLETED, declared) for
 *     classes 1–12 with per-subject max-mark configs (PA = 50), plus a
 *     few draft marks rows for 9-A Mathematics (the marks-entry grid
 *     opens with data).
 *  6. Baseline attendance for the FEATURED student's class (7-A)
 *     yesterday — the class-teacher workflow's canonical write.
 *
 * Principles (unchanged from v3): runtime-resolved ids only; idempotent
 * (wipe-and-replant its own slices); relative dates where history
 * allows; honest data — every number the modules render comes from
 * these rows.
 *
 * Run: bun run db:seed-teacher-academics
 */

const PERIOD_TIMES: { period: number; start: string; end: string }[] = [
  { period: 1, start: '08:00', end: '08:45' },
  { period: 2, start: '08:45', end: '09:30' },
  { period: 3, start: '09:30', end: '10:15' },
  { period: 4, start: '10:45', end: '11:30' },
  { period: 5, start: '11:30', end: '12:15' },
  { period: 6, start: '12:15', end: '13:00' },
  { period: 7, start: '13:30', end: '14:15' },
  { period: 8, start: '14:15', end: '15:00' },
]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Placement priority: senior classes place their cells first. */
const LEVEL_ORDER = ['12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'IKG', 'LKG', 'Nursery']

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-teacher-academics')

  const registryIssues = validateRegistry()
  if (registryIssues.length > 0) {
    throw new Error(`Curriculum registry invalid — refusing to seed: ${JSON.stringify(registryIssues.slice(0, 5))}`)
  }

  const school = await db.school.findUnique({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) throw new Error('Demo school not found — run the base seed first.')
  console.log(`School: ${school.name} (${school.board})`)

  const teacherRows = await db.teacher.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  const teacherByUserId = new Map(teacherRows.map((t) => [t.user.id, t]))
  const teacherByEmail = new Map(teacherRows.map((t) => [t.user.email, t]))
  const teacherOfN = (n: number) => {
    const t = teacherByEmail.get(facultyEmail(n))
    if (!t) throw new Error(`Teacher row missing for faculty #${n} (${facultyEmail(n)})`)
    return t
  }

  // ── 0. Session anchor ─────────────────────────────────────────────────
  await db.school.update({
    where: { id: school.id },
    data: { academicYear: '2026-2027', board: 'CBSE' },
  })

  // ── 1. Classes (ensure the 15-level skeleton; base seed owns identity) ─
  const classByLevel = new Map<string, { id: string; label: string; room: string; classTeacherUserId: string }>()
  for (const lv of DEMO_CLASS_LEVELS) {
    const facultyN = FACULTY.find((f) => f.classTeacherOf === lv.key)?.n ?? 1
    const classTeacher = teacherOfN(facultyN)
    let existing = await db.class.findFirst({ where: { schoolId: school.id, name: lv.label } })
    if (!existing) {
      existing = await db.class.create({
        data: {
          schoolId: school.id,
          name: lv.label,
          section: 'A',
          gradeLevel: lv.level,
          stream: lv.key === '11' || lv.key === '12' ? 'Science' : null,
          capacity: lv.capacity,
          room: lv.room,
          classTeacherId: classTeacher.userId,
        },
      })
    } else {
      await db.class.update({
        where: { id: existing.id },
        data: {
          gradeLevel: lv.level,
          section: 'A',
          stream: lv.key === '11' || lv.key === '12' ? 'Science' : null,
          capacity: lv.capacity,
          room: lv.room,
          classTeacherId: classTeacher.userId,
        },
      })
    }
    classByLevel.set(lv.key, {
      id: existing.id,
      label: lv.label,
      room: lv.room,
      classTeacherUserId: classTeacher.userId,
    })
  }
  console.log(`  Classes: ${classByLevel.size} (Nursery → 12, one section each)`)

  // ── 2. Subjects + ClassSubjectAssignments (the permission layer) ──────
  // The tenant-isolation probe appointment (subject HH-PROBE-MATH, planted
  // by seed-tenant-isolation) is TEST INFRASTRUCTURE — preserved by the
  // matrix rebuild so the pipeline stays deterministic across re-runs.
  await db.classSubjectAssignment.deleteMany({
    where: { schoolId: school.id, subject: { OR: [{ code: { not: PROBE_SUBJECT_CODE } }, { code: null }] } },
  })
  const subjectIdByCode = new Map<string, string>()
  for (const s of SUBJECTS) {
    let row = await db.subject.findFirst({ where: { schoolId: school.id, code: s.code } })
    if (!row) {
      row = await db.subject.create({ data: { schoolId: school.id, name: s.name, code: s.code, status: 'Active' } })
    } else {
      row = await db.subject.update({ where: { id: row.id }, data: { name: s.name, status: 'Active' } })
    }
    subjectIdByCode.set(s.code, row.id)
  }
  const subjectNameByCode = new Map(SUBJECTS.map((s) => [s.code, s.name]))

  let csaOrder = 0
  for (const csa of CSA_MATRIX) {
    csaOrder += 1
    await db.classSubjectAssignment.create({
      data: {
        schoolId: school.id,
        classId: classByLevel.get(csa.level)!.id,
        subjectId: subjectIdByCode.get(csa.code)!,
        teacherUserId: teacherOfN(csa.teacherN).userId,
        isCore: true,
        isActive: true,
        examinable: SUBJECTS.find((s) => s.code === csa.code)?.examinable ?? true,
        displayOrder: csaOrder,
      },
    })
  }
  console.log(`  CSA: ${csaOrder} ACTIVE assignments (teachers appointed per subject-class)`)

  // ── 3. Timetables (subject-teacher cells, conflict-free) ─────────────
  // BUSINESS RULE (DB-enforced): one teacher + one day + one period = at
  // most one class. Greedy fill, most-constrained-teacher-first, senior
  // classes placing first.
  await db.timetable.deleteMany({ where: { schoolId: school.id } })
  const busy = new Set<string>() // `${teacherUserId}|${day}|${period}`
  const busyCount = new Map<string, number>()
  const cellsByClassSubject = new Map<string, number>()

  const grid: { day: string; period: number }[] = []
  for (const day of DAYS) for (const period of [1, 2, 3, 4, 5, 6, 7, 8]) grid.push({ day, period })

  for (const level of LEVEL_ORDER) {
    const cls = classByLevel.get(level)
    if (!cls) continue
    const queue: { code: string; teacherUserId: string; teacherName: string }[] = []
    for (const csa of CSA_MATRIX.filter((c) => c.level === level)) {
      const teacher = teacherOfN(csa.teacherN)
      for (let i = 0; i < csa.periodsPerWeek; i += 1) {
        queue.push({
          code: csa.code,
          teacherUserId: teacher.userId,
          teacherName: teacher.user.name ?? 'Faculty',
        })
      }
    }
    if (queue.length === 0) continue

    const cells: { day: string; period: number; code: string; teacherUserId: string; teacherName: string }[] = []
    const rotation = (LEVEL_ORDER.indexOf(level) * 7) % grid.length
    for (let i = 0; i < grid.length && queue.length > 0; i += 1) {
      const slot = grid[(i + rotation) % grid.length]
      let best = -1
      let bestLoad = -1
      for (let qi = 0; qi < queue.length; qi += 1) {
        const q = queue[qi]
        if (busy.has(`${q.teacherUserId}|${slot.day}|${slot.period}`)) continue
        const load = busyCount.get(q.teacherUserId) ?? 0
        if (load > bestLoad) {
          bestLoad = load
          best = qi
        }
      }
      if (best === -1) continue
      const q = queue.splice(best, 1)[0]
      busy.add(`${q.teacherUserId}|${slot.day}|${slot.period}`)
      busyCount.set(q.teacherUserId, (busyCount.get(q.teacherUserId) ?? 0) + 1)
      cells.push({ ...slot, code: q.code, teacherUserId: q.teacherUserId, teacherName: q.teacherName })
    }
    if (queue.length > 0) {
      const left = queue.reduce((acc, q) => `${acc}${q.code} `, '')
      throw new Error(`Timetable overflow for ${cls.label}: could not place ${queue.length} cells [${left.trim()}].`)
    }

    await db.timetable.createMany({
      data: cells.map((c) => ({
        schoolId: school.id,
        classId: cls.id,
        subjectId: subjectIdByCode.get(c.code)!,
        day: c.day,
        period: c.period,
        startTime: PERIOD_TIMES.find((p) => p.period === c.period)!.start,
        endTime: PERIOD_TIMES.find((p) => p.period === c.period)!.end,
        teacherUserId: c.teacherUserId,
        teacherName: c.teacherName,
        // Homeroom rule — the class stays put, teachers move.
        room: cls.room,
      })),
    })
    for (const c of cells) {
      const k = `${cls.id}|${subjectIdByCode.get(c.code)!}`
      cellsByClassSubject.set(k, (cellsByClassSubject.get(k) ?? 0) + 1)
    }
    console.log(`  Timetable ${cls.label}: ${cells.length} cells — ${[...new Set(cells.map((c) => c.code))].join(', ')}`)
  }

  // ── 4. School calendar holidays ───────────────────────────────────────
  await db.schoolEvent.deleteMany({ where: { schoolId: school.id, type: 'HOLIDAY' } })
  await db.schoolEvent.createMany({
    data: HOLIDAY_SEED.map((h) => ({
      schoolId: school.id,
      title: h.title,
      type: 'HOLIDAY',
      startDate: parseDayKey(h.start),
      endDate: parseDayKey(h.end),
      audience: 'ALL',
    })),
  })
  console.log(`  Holidays: ${HOLIDAY_SEED.length} seeded (incl. summer + Diwali breaks)`)

  // ── 5. Curriculum instances from the GLOBAL 2026-27 library ───────────
  await db.curriculumTopic.deleteMany({ where: { schoolId: school.id } })
  await db.lessonTopicCompletion.deleteMany({ where: { schoolId: school.id } })

  const today = new Date()
  const sessionStart = sessionStartFor('2026-2027', today)
  const holidays = HOLIDAY_SEED.map((h) => ({ title: h.title, start: h.start, end: h.end }))

  interface PlanAccum {
    classId: string
    subjectId: string
    teacherId: string
    classLabel: string
    subjectName: string
    topics: { id: string; periodsNeeded: number; topicName: string; unitNo: number; unitName: string }[]
  }
  const plans: PlanAccum[] = []
  let topicCount = 0
  let libraryMisses = 0

  for (const csa of CSA_MATRIX) {
    // Only classes 6–12 carry board-library curricula; primary and
    // custom subjects keep the honest build-your-own state.
    const numeric = Number(csa.level)
    if (!Number.isFinite(numeric) || numeric < 6) continue
    const cls = classByLevel.get(csa.level)!
    const subjectName = subjectNameByCode.get(csa.code)!
    const found = findCurriculumForClassSubject(cls.label, subjectName)
    if (!found) {
      libraryMisses += 1
      continue
    }
    const curriculum = found.curriculum
    const teacher = teacherOfN(csa.teacherN)
    const created: PlanAccum['topics'] = []
    let topicNo = 0
    for (const unit of curriculum.units) {
      for (const chapter of unit.topics) {
        topicNo += 1
        const row = await db.curriculumTopic.create({
          data: {
            schoolId: school.id,
            classId: cls.id,
            subjectId: subjectIdByCode.get(csa.code)!,
            sourceBoard: curriculum.sourceBoard,
            unitNo: unit.unitNo,
            unitName: unit.unitName,
            topicNo,
            topicName: chapter.name,
            description: chapter.description,
            periodsNeeded: chapter.periods,
            orderIndex: topicNo,
          },
        })
        created.push({
          id: row.id,
          periodsNeeded: chapter.periods,
          topicName: chapter.name,
          unitNo: unit.unitNo,
          unitName: unit.unitName,
        })
      }
    }
    topicCount += created.length
    plans.push({
      classId: cls.id,
      subjectId: subjectIdByCode.get(csa.code)!,
      teacherId: teacher.id,
      classLabel: cls.label,
      subjectName,
      topics: created,
    })
  }
  console.log(
    `  Curriculum: ${topicCount} chapters instantiated across ${plans.length} assignments` +
      (libraryMisses ? ` (${libraryMisses} custom — no library curriculum)` : ''),
  )

  // ── 6. Completion history via the SAME scheduler the API runs ────────
  const todayKey = dayKey(today)
  let completionCount = 0
  for (const plan of plans) {
    const periodsPerWeek = cellsByClassSubject.get(`${plan.classId}|${plan.subjectId}`) ?? 0
    if (periodsPerWeek === 0) continue
    const scheduled = computeSchedule({
      topics: plan.topics.map((t, i) => ({
        id: t.id,
        unitNo: t.unitNo,
        unitName: t.unitName,
        topicNo: i + 1,
        topicName: t.topicName,
        description: null,
        periodsNeeded: t.periodsNeeded,
        orderIndex: i + 1,
      })),
      completions: new Map(),
      sessionStart,
      today,
      pace: {
        periodsPerWeek,
        teachingDaysPerWeek: 6,
        teachingWeekdays: DAYS.map((d) => WEEKDAY_INDEX[d]),
      },
      holidays,
    })

    const overdue = scheduled.filter((s) => s.endDate < todayKey)
    // 10-A Social Science keeps its last two overdue topics uncompleted —
    // the honest "Needs Rescheduling" demo state.
    const isSst10 = plan.classLabel === '10-A' && plan.subjectName === 'Social Science'
    const skipLast = isSst10 ? 2 : 0
    const toComplete = overdue.slice(0, Math.max(0, overdue.length - skipLast))

    for (const s of toComplete) {
      await db.lessonTopicCompletion.create({
        data: {
          schoolId: school.id,
          curriculumTopicId: s.id,
          classId: plan.classId,
          subjectId: plan.subjectId,
          teacherId: plan.teacherId,
          completedOn: parseDayKey(s.endDate),
        },
      })
      completionCount += 1
    }
  }
  console.log(`  Completions: ${completionCount} seeded (history preserved)`)

  // ── 7. Periodic Assessment 1 (Marks Entry surface) ────────────────────
  const existingPa = await db.exam.findFirst({
    where: { schoolId: school.id, name: 'Periodic Assessment 1' },
  })
  if (existingPa) {
    await db.examMark.deleteMany({ where: { examId: existingPa.id } })
    await db.examSubjectConfig.deleteMany({ where: { examId: existingPa.id } })
    await db.examClass.deleteMany({ where: { examId: existingPa.id } })
    await db.examScheduleItem.deleteMany({ where: { examId: existingPa.id } })
    await db.exam.delete({ where: { id: existingPa.id } }).catch(() => undefined)
  }
  const pa1 = await db.exam.create({
    data: {
      schoolId: school.id,
      name: 'Periodic Assessment 1',
      term: 'Term 1',
      type: 'Class Test',
      session: '2026-2027',
      startDate: new Date('2026-07-13'),
      endDate: new Date('2026-07-17'),
      status: 'COMPLETED',
      resultStatus: 'Declared',
      passPercentage: 33,
      declaredAt: new Date('2026-07-25'),
      declaredBy: teacherByUserId.get(classByLevel.get('9')!.classTeacherUserId)?.userId ?? null,
      createdBy: classByLevel.get('9')!.classTeacherUserId,
    },
  })
  let escCount = 0
  const pa1Classes = new Set<string>()
  for (const csa of CSA_MATRIX) {
    const numeric = Number(csa.level)
    if (!Number.isFinite(numeric)) continue // no formal exams for pre-primary
    const examinable = SUBJECTS.find((s) => s.code === csa.code)?.examinable ?? true
    if (!examinable) continue
    const cls = classByLevel.get(csa.level)!
    if (!pa1Classes.has(cls.id)) {
      pa1Classes.add(cls.id)
      await db.examClass.create({ data: { examId: pa1.id, classId: cls.id } })
    }
    await db.examSubjectConfig.create({
      data: {
        examId: pa1.id,
        classId: cls.id,
        subjectId: subjectIdByCode.get(csa.code)!,
        maxMarks: 50,
        passMarks: 17,
        theoryMarks: 50,
        practicalMarks: 0,
      },
    })
    escCount++
  }
  console.log(`  Exam: Periodic Assessment 1 (July, COMPLETED + Declared) — ${escCount} subject configs across classes 1–12`)

  // A few DRAFT marks rows for 9-A Mathematics so the grid opens with
  // data (the marks-entry workflow's in-progress state).
  const grade9 = classByLevel.get('9')!
  const mathSubject = subjectIdByCode.get('MAT')!
  const students9 = await db.student.findMany({
    where: { classId: grade9.id },
    orderBy: { rollNo: 'asc' },
  })
  const nineATeacher = CSA_MATRIX.find((c) => c.level === '9' && c.code === 'MAT')!
  const marksTeacher = teacherOfN(nineATeacher.teacherN)
  const preset: Record<string, number> = {}
  students9.slice(0, 3).forEach((s, i) => {
    preset[s.id] = [42, 38, 45][i] ?? 40
  })
  for (const [studentId, marks] of Object.entries(preset)) {
    await db.examMark.create({
      data: {
        examId: pa1.id,
        classId: grade9.id,
        subjectId: mathSubject,
        studentId,
        marksObtained: marks,
        status: 'PRESENT',
        workflowStatus: 'DRAFT',
        enteredBy: marksTeacher.user.name ?? 'Teacher',
        enteredAt: addDays(today, -1),
      },
    })
  }
  console.log(`  ExamMarks: 3 draft rows seeded for 9-A Mathematics`)

  // ── 8. Baseline attendance for the FEATURED student's class (7-A) ────
  // PIH-4b integrity: midnight-UTC day anchor; markedBy carries the class
  // teacher's DISPLAY NAME (the canonical provenance convention).
  const featuredClass = classByLevel.get(DEMO_STUDENT_POSITION.level)!
  const yesterday = parseDayKey(dayKey(addDays(today, -1)))
  if (yesterday.getUTCDay() !== 0) {
    await db.attendance.deleteMany({
      where: { classId: featuredClass.id, date: { gte: yesterday, lt: new Date(yesterday.getTime() + 86_400_000) } },
    })
    const students7 = await db.student.findMany({ where: { classId: featuredClass.id }, orderBy: { rollNo: 'asc' } })
    const classTeacherName = teacherByUserId.get(featuredClass.classTeacherUserId)?.user.name ?? 'Class Teacher'
    const statuses = ['PRESENT', 'PRESENT', 'ABSENT', 'PRESENT', 'LATE', 'PRESENT']
    for (let i = 0; i < students7.length; i += 1) {
      await db.attendance.create({
        data: {
          schoolId: school.id,
          studentId: students7[i].id,
          classId: featuredClass.id,
          date: yesterday,
          status: statuses[i % statuses.length],
          markedBy: classTeacherName,
        },
      })
    }
    console.log(`  Baseline attendance: ${students7.length} rows for 7-A on ${dayKey(yesterday)}`)
  }

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
