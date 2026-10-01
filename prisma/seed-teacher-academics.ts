/**
 * seed-teacher-academics — v3: the PRINCIPAL-CONFIGURED academic setup for
 * the Demo School, session 2026-27, feeding the Teacher academics modules
 * (Lesson Planner / Class Attendance / Marks Entry).
 *
 * ═══ WHAT THIS SEED ESTABLISHES (the config → planner chain) ═══
 *
 *  1. CLASSES (principal's academic setup): Grade 6-A → 12-B, i.e. the
 *     middle school (6–8), secondary (9–10) and senior-secondary streams
 *     (11-A/12-A Science, 11-B/12-B Commerce).
 *  2. SUBJECTS OFFERED per class — ACTIVE ClassSubjectAssignments. Grade
 *     9-A/10-A offer the standard CBSE set: Mathematics, Science, Social
 *     Science, English, Hindi + the skill subject Computer Applications
 *     (code 165). The separate Physics/Chemistry/Biology assignments of
 *     the old demo are retired (history — exam marks — remains valid).
 *  3. SUBJECT-TEACHER ASSIGNMENTS — the timetable cells. Only (class,
 *     subject) pairs a teacher actually teaches ever reach her planner.
 *  4. CURRICULUM — instantiated automatically from the GLOBAL 2026-27
 *     NCERT/CBSE library (src/lib/curriculum/2026-27) for every ACTIVE
 *     assignment: the new NCF-SE books for 6–9 (Ganita Prakash/Curiosity/
 *     Exploring Society/Poorvi/Malhar/Ganita Manjari/Exploration/
 *     Understanding Society/Kaveri/गंगा), rationalized books for 10–12.
 *  5. COMPLETION HISTORY — every topic whose timetable-derived window
 *     ended before today is marked completed ON that date (the same
 *     scheduler the API runs). Honest progress, mid-session.
 *  6. Periodic Assessment 1 exam + sample marks (9-A/10-A, new subject
 *     set) and the class-teacher baseline attendance for 9-A.
 *
 * Principles (unchanged): runtime-resolved ids only; idempotent; relative
 * dates so the demo never goes stale; honest data — every number the
 * modules render comes from these rows.
 *
 * Run: bun run db:seed-teacher-academics
 */

import { PrismaClient } from '@prisma/client'
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

const SCHOOL_SLUG = 'demo-school'
const PERIOD_TIMES: { period: number; start: string; end: string }[] = [
  { period: 1, start: '08:30', end: '09:15' },
  { period: 2, start: '09:15', end: '10:00' },
  { period: 3, start: '10:00', end: '10:45' },
  { period: 4, start: '11:00', end: '11:45' },
  { period: 5, start: '11:45', end: '12:30' },
  { period: 6, start: '13:15', end: '14:00' },
  { period: 7, start: '14:00', end: '14:45' },
]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

// ─── The principal's configuration (single source for this seed) ────────
// Order = scheduling priority: secondary + senior-secondary place their
// cells first, middle school fills the teachers' remaining free slots.

/** Teacher emails → the faculty of the demo school. */
const TEACHERS = {
  rohan: 'rohan.mehta@greenwood.edu.in',
  kavita: 'teacher1@demoschool.edu',
  arjun: 'teacher2@demoschool.edu',
  priya: 'teacher3@demoschool.edu',
} as const

interface ClassConfig {
  /** "Grade 6 - A" naming — the section rides inside the name. */
  name: string
  section: string
  stream?: string
  classTeacher: keyof typeof TEACHERS
  /** Subjects the principal has configured for this class. */
  subjects: { name: string; code: string; teacher: keyof typeof TEACHERS; periodsPerWeek: number }[]
}

const CONFIG: ClassConfig[] = [
  // ── Secondary — CBSE 9/10 subject scheme ──────────────────────────────
  {
    name: 'Grade 9 - A', section: 'A', classTeacher: 'rohan',
    subjects: [
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 7 },
      { name: 'Science', code: 'SCI', teacher: 'kavita', periodsPerWeek: 7 },
      { name: 'Social Science', code: 'SST', teacher: 'arjun', periodsPerWeek: 5 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 5 },
      { name: 'Hindi', code: 'HIN', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Computer Applications', code: 'CA165', teacher: 'rohan', periodsPerWeek: 3 },
    ],
  },
  {
    name: 'Grade 10 - A', section: 'A', classTeacher: 'priya',
    subjects: [
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 6 },
      { name: 'Science', code: 'SCI', teacher: 'kavita', periodsPerWeek: 7 },
      { name: 'Social Science', code: 'SST', teacher: 'arjun', periodsPerWeek: 5 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 5 },
      { name: 'Hindi', code: 'HIN', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Computer Applications', code: 'CA165', teacher: 'rohan', periodsPerWeek: 3 },
    ],
  },
  // ── Senior secondary — Science stream ─────────────────────────────────
  {
    name: 'Grade 11 - A', section: 'A', stream: 'Science', classTeacher: 'kavita',
    subjects: [
      { name: 'Physics', code: 'PHY', teacher: 'kavita', periodsPerWeek: 5 },
      { name: 'Chemistry', code: 'CHE', teacher: 'kavita', periodsPerWeek: 5 },
      { name: 'Biology', code: 'BIO', teacher: 'priya', periodsPerWeek: 4 },
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 4 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 4 },
    ],
  },
  {
    name: 'Grade 12 - A', section: 'A', stream: 'Science', classTeacher: 'priya',
    subjects: [
      { name: 'Physics', code: 'PHY', teacher: 'kavita', periodsPerWeek: 5 },
      { name: 'Chemistry', code: 'CHE', teacher: 'kavita', periodsPerWeek: 5 },
      { name: 'Biology', code: 'BIO', teacher: 'priya', periodsPerWeek: 4 },
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 4 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 4 },
    ],
  },
  // ── Senior secondary — Commerce stream ────────────────────────────────
  {
    name: 'Grade 11 - B', section: 'B', stream: 'Commerce', classTeacher: 'arjun',
    subjects: [
      { name: 'Accountancy', code: 'ACC', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Business Studies', code: 'BST', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Economics', code: 'ECO', teacher: 'arjun', periodsPerWeek: 3 },
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 0 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 3 },
    ],
  },
  {
    name: 'Grade 12 - B', section: 'B', stream: 'Commerce', classTeacher: 'arjun',
    subjects: [
      { name: 'Accountancy', code: 'ACC', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Business Studies', code: 'BST', teacher: 'arjun', periodsPerWeek: 4 },
      { name: 'Economics', code: 'ECO', teacher: 'arjun', periodsPerWeek: 3 },
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 0 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 3 },
    ],
  },
  // ── Middle school — new NCERT books; Mathematics staffed, the rest
  //    configured (CSA) but awaiting teacher assignment (no cells yet) ──
  {
    name: 'Grade 6 - A', section: 'A', classTeacher: 'arjun',
    subjects: [
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 3 },
      { name: 'Science', code: 'SCI', teacher: 'kavita', periodsPerWeek: 0 },
      { name: 'Social Science', code: 'SST', teacher: 'arjun', periodsPerWeek: 0 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 0 },
      { name: 'Hindi', code: 'HIN', teacher: 'arjun', periodsPerWeek: 0 },
    ],
  },
  {
    name: 'Grade 7 - A', section: 'A', classTeacher: 'priya',
    subjects: [
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 3 },
      { name: 'Science', code: 'SCI', teacher: 'kavita', periodsPerWeek: 0 },
      { name: 'Social Science', code: 'SST', teacher: 'arjun', periodsPerWeek: 0 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 0 },
      { name: 'Hindi', code: 'HIN', teacher: 'arjun', periodsPerWeek: 0 },
    ],
  },
  {
    name: 'Grade 8 - A', section: 'A', classTeacher: 'kavita',
    subjects: [
      { name: 'Mathematics', code: 'MAT', teacher: 'rohan', periodsPerWeek: 3 },
      { name: 'Science', code: 'SCI', teacher: 'kavita', periodsPerWeek: 0 },
      { name: 'Social Science', code: 'SST', teacher: 'arjun', periodsPerWeek: 0 },
      { name: 'English', code: 'ENG', teacher: 'priya', periodsPerWeek: 0 },
      { name: 'Hindi', code: 'HIN', teacher: 'arjun', periodsPerWeek: 0 },
    ],
  },
]

async function main() {
  const registryIssues = validateRegistry()
  if (registryIssues.length > 0) {
    throw new Error(`Curriculum registry invalid — refusing to seed: ${JSON.stringify(registryIssues.slice(0, 5))}`)
  }

  const school = await db.school.findUnique({ where: { slug: SCHOOL_SLUG } })
  if (!school) throw new Error('Demo school not found — run the base seed first.')
  console.log(`School: ${school.name} (${school.board})`)

  const teacherRows = await db.teacher.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { name: true, email: true } } },
  })
  const teacherByEmail = new Map(teacherRows.map((t) => [t.user.email, t]))
  const teacherOf = (k: keyof typeof TEACHERS) => {
    const t = teacherByEmail.get(TEACHERS[k])
    if (!t) throw new Error(`Teacher row missing for ${k} (${TEACHERS[k]})`)
    return t
  }
  const rohan = teacherOf('rohan')

  // ── 0. Session anchor ─────────────────────────────────────────────────
  await db.school.update({
    where: { id: school.id },
    data: { academicYear: '2026-2027', board: 'CBSE' },
  })

  // ── 1. Classes (create any the principal has added; keep existing) ────
  // room is the class HOMEROOM (canonical scheme `Room {grade}0{section}`)
  // — timetable rows always meet the class in its homeroom, so rooms can
  // never collide across classes (one class → one room, by construction).
  const classByName = new Map<string, { id: string; name: string; section: string; room: string }>()
  for (const cfg of CONFIG) {
    const gradeNo = cfg.name.match(/\d+/)?.[0] ?? ''
    const homeroom = `Room ${gradeNo}0${cfg.section}`
    const existing = await db.class.findFirst({
      where: { schoolId: school.id, name: cfg.name },
    })
    const row =
      existing ??
      (await db.class.create({
        data: {
          schoolId: school.id,
          name: cfg.name,
          section: cfg.section,
          gradeLevel: gradeNo,
          stream: cfg.stream,
          capacity: 40,
          room: homeroom,
          classTeacherId: teacherOf(cfg.classTeacher).userId,
        },
      }))
    if (existing) {
      await db.class.update({
        where: { id: existing.id },
        data: {
          classTeacherId: teacherOf(cfg.classTeacher).userId,
          stream: cfg.stream ?? existing.stream,
          // Homeroom normalisation — heals legacy labels ("101", "201")
          // so every class follows the one scheme.
          room: homeroom,
        },
      })
    }
    classByName.set(cfg.name, {
      id: row.id,
      name: row.name,
      section: row.section ?? cfg.section,
      room: homeroom,
    })
  }

  // ── 2. Subjects + ClassSubjectAssignments (the permission layer) ──────
  const subjectByKey = new Map<string, { id: string; name: string }>()
  for (const cfg of CONFIG) {
    for (const subj of cfg.subjects) {
      if (subjectByKey.has(subj.code)) continue
      const existing = await db.subject.findFirst({
        where: { schoolId: school.id, code: subj.code },
      })
      const row =
        existing ??
        (await db.subject.create({
          data: { schoolId: school.id, name: subj.name, code: subj.code, status: 'Active' },
        }))
      if (existing && (existing.name !== subj.name || existing.status === 'Archived')) {
        await db.subject.update({
          where: { id: existing.id },
          data: { name: subj.name, status: 'Active' },
        })
      }
      subjectByKey.set(subj.code, { id: row.id, name: subj.name })
    }
  }

  await db.classSubjectAssignment.deleteMany({ where: { schoolId: school.id } })
  let csaOrder = 0
  for (const cfg of CONFIG) {
    const cls = classByName.get(cfg.name)!
    for (const subj of cfg.subjects) {
      csaOrder += 1
      await db.classSubjectAssignment.create({
        data: {
          schoolId: school.id,
          classId: cls.id,
          subjectId: subjectByKey.get(subj.code)!.id,
          isCore: true,
          isActive: true,
          examinable: true,
          displayOrder: csaOrder,
        },
      })
    }
  }
  console.log(`  CSA: ${csaOrder} ACTIVE assignments across ${CONFIG.length} classes`)

  // ── 3. Timetables (subject-teacher assignments, conflict-free) ────────
  // BUSINESS RULE: one teacher + one day + one period = at most one class.
  // Greedy fill with a most-constrained-teacher-first rule: at every grid
  // slot the class claims the queued item whose teacher is the BUSIEST
  // (tightest faculty pack first), which prevents a light teacher from
  // monopolising consecutive slots and starving the tight ones later.
  await db.timetable.deleteMany({ where: { schoolId: school.id } })
  const busy = new Set<string>() // `${teacherEmail}|${day}|${period}`
  const busyCount = new Map<string, number>() // teacherEmail → placed cells
  const cellsByClassSubject = new Map<string, number>() // `${classId}|${subjectId}` → periods/wk
  const teacherNameByEmail = new Map(teacherRows.map((t) => [t.user.email, t.user.name ?? 'Faculty']))

  const grid: { day: string; period: number }[] = []
  for (const day of DAYS) for (const period of [1, 2, 3, 4, 5, 6, 7]) grid.push({ day, period })

  let classIdx = 0
  for (const cfg of CONFIG) {
    const cls = classByName.get(cfg.name)!
    classIdx += 1
    // The queue of (subject, teacher) cells this class needs, expanded.
    const queue: { code: string; teacherEmail: string }[] = []
    for (const subj of cfg.subjects) {
      const teacher = teacherOf(subj.teacher)
      for (let i = 0; i < subj.periodsPerWeek; i += 1) {
        queue.push({ code: subj.code, teacherEmail: teacher.user.email })
      }
    }
    if (queue.length === 0) continue

    const cells: { day: string; period: number; code: string; teacherEmail: string }[] = []
    const rotation = (classIdx * 5) % grid.length
    for (let i = 0; i < grid.length && queue.length > 0; i += 1) {
      const slot = grid[(i + rotation) % grid.length]
      // Most-constrained-first: among items whose teacher is free at this
      // slot, pick the one whose teacher has the MOST cells already placed.
      let best = -1
      let bestLoad = -1
      for (let qi = 0; qi < queue.length; qi += 1) {
        const q = queue[qi]
        if (busy.has(`${q.teacherEmail}|${slot.day}|${slot.period}`)) continue
        const load = busyCount.get(q.teacherEmail) ?? 0
        if (load > bestLoad) {
          bestLoad = load
          best = qi
        }
      }
      if (best === -1) continue
      const q = queue.splice(best, 1)[0]
      busy.add(`${q.teacherEmail}|${slot.day}|${slot.period}`)
      busyCount.set(q.teacherEmail, (busyCount.get(q.teacherEmail) ?? 0) + 1)
      cells.push({ ...slot, code: q.code, teacherEmail: q.teacherEmail })
    }
    if (queue.length > 0) {
      const left = queue.reduce((acc, q) => `${acc}${q.code}(${q.teacherEmail}) `, '')
      throw new Error(
        `Timetable overflow for ${cfg.name}: could not place ${queue.length} cells [${left.trim()}].`,
      )
    }

    await db.timetable.createMany({
      data: cells.map((c) => ({
        schoolId: school.id,
        classId: cls.id,
        subjectId: subjectByKey.get(c.code)!.id,
        day: c.day,
        period: c.period,
        startTime: PERIOD_TIMES.find((p) => p.period === c.period)!.start,
        endTime: PERIOD_TIMES.find((p) => p.period === c.period)!.end,
        teacherName: teacherNameByEmail.get(c.teacherEmail) ?? 'Faculty',
        // Homeroom rule — the class stays put, teachers move. Period-indexed
        // rooms (Room 201/202/…) double-booked every room across classes;
        // the homeroom is the only structurally conflict-free choice.
        room: classByName.get(cfg.name)?.room ?? null,
      })),
    })
    for (const c of cells) {
      const k = `${cls.id}|${subjectByKey.get(c.code)!.id}`
      cellsByClassSubject.set(k, (cellsByClassSubject.get(k) ?? 0) + 1)
    }
    console.log(
      `  Timetable ${cfg.name}: ${cells.length} cells — ${[...new Set(cells.map((c) => c.code))].join(', ')}`,
    )
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

  for (const cfg of CONFIG) {
    const cls = classByName.get(cfg.name)!
    for (const subj of cfg.subjects) {
      const subject = subjectByKey.get(subj.code)!
      const found = findCurriculumForClassSubject(cfg.name, subj.name)
      if (!found) {
        // Not an error: schools may configure subjects the library does not
        // carry — the planner shows its honest build-your-own empty state.
        libraryMisses += 1
        console.log(`  Curriculum: NO library match for ${cfg.name} · ${subj.name} (custom plan)`)
        continue
      }
      const curriculum = found.curriculum
      const teacher = teacherOf(subj.teacher)
      const created: PlanAccum['topics'] = []
      let topicNo = 0
      for (const unit of curriculum.units) {
        for (const chapter of unit.topics) {
          topicNo += 1
          const row = await db.curriculumTopic.create({
            data: {
              schoolId: school.id,
              classId: cls.id,
              subjectId: subject.id,
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
        subjectId: subject.id,
        teacherId: teacher.id,
        classLabel: cfg.name,
        subjectName: subj.name,
        topics: created,
      })
    }
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
    if (periodsPerWeek === 0) {
      // Configured but not yet timetabled — brand new course, no history.
      continue
    }
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
    // Grade 10-A Social Science keeps its last two overdue topics
    // uncompleted — the honest "Needs Rescheduling" demo state.
    const isSst10 = plan.classLabel === 'Grade 10 - A' && plan.subjectName === 'Social Science'
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
    const todayTopic = scheduled.find((s) => s.status === 'today' || s.status === 'in-progress')
    console.log(
      `    ${plan.classLabel} · ${plan.subjectName}: ${toComplete.length}/${scheduled.length} completed, today → ${todayTopic ? todayTopic.topicName : '—'}`,
    )
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
  const secondaryCfg = CONFIG.filter((c) => c.name === 'Grade 9 - A' || c.name === 'Grade 10 - A')
  const pa1 = await db.exam.create({
    data: {
      schoolId: school.id,
      name: 'Periodic Assessment 1',
      term: 'Term 1',
      type: 'Class Test',
      session: '2026-2027',
      startDate: addDays(today, -7),
      endDate: addDays(today, -5),
      status: 'COMPLETED',
      resultStatus: 'In Progress',
      passPercentage: 33,
    },
  })
  for (const cfg of secondaryCfg) {
    const cls = classByName.get(cfg.name)!
    await db.examClass.create({ data: { examId: pa1.id, classId: cls.id } })
    for (const subj of cfg.subjects) {
      await db.examSubjectConfig.create({
        data: {
          examId: pa1.id,
          classId: cls.id,
          subjectId: subjectByKey.get(subj.code)!.id,
          maxMarks: 50,
          passMarks: 17,
          theoryMarks: 50,
          practicalMarks: 0,
        },
      })
    }
  }
  console.log(`  Exam: Periodic Assessment 1 seeded for 9-A/10-A (6 subjects × 2 classes, max 50)`)

  // A few real marks for Grade 9-A Mathematics so the grid opens with data.
  const grade9 = classByName.get('Grade 9 - A')!
  const mathSubject = subjectByKey.get('MAT')!
  const students9 = await db.student.findMany({
    where: { classId: grade9.id },
    orderBy: { rollNo: 'asc' },
  })
  const preset: Record<string, number> = {}
  students9.slice(0, 3).forEach((s, i) => {
    preset[s.id] = [42, 38, 45][i] ?? 40
  })
  for (const [studentId, marks] of Object.entries(preset)) {
    await db.examMark.create({
      data: {
        examId: pa1.id,
        classId: grade9.id,
        subjectId: mathSubject.id,
        studentId,
        marksObtained: marks,
        status: 'PRESENT',
        workflowStatus: 'DRAFT',
        enteredBy: rohan.user.name ?? 'Teacher',
        enteredAt: addDays(today, -1),
      },
    })
  }
  console.log(`  ExamMarks: 3 draft rows seeded for 9-A Mathematics`)

  // ── 8. Baseline attendance for Grade 9-A yesterday ────────────────────
  // PIH-4b integrity: the day is anchored to midnight UTC (the canonical
  // day key every writer agrees on — a time-of-day date would break the
  // (studentId, date) day-level uniqueness). markedBy keeps the canonical
  // display-name provenance (same as the baseline route's write).
  const yesterday = parseDayKey(dayKey(addDays(today, -1)))
  if (yesterday.getUTCDay() !== 0) {
    await db.attendance.deleteMany({
      where: { classId: grade9.id, date: { gte: yesterday, lt: new Date(yesterday.getTime() + 86_400_000) } },
    })
    const statuses = ['PRESENT', 'PRESENT', 'PRESENT', 'ABSENT', 'PRESENT', 'PRESENT', 'LATE', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT']
    for (let i = 0; i < students9.length; i += 1) {
      await db.attendance.create({
        data: {
          schoolId: school.id,
          studentId: students9[i].id,
          classId: grade9.id,
          date: yesterday,
          status: statuses[i % statuses.length],
          markedBy: rohan.user.name ?? 'Class Teacher',
        },
      })
    }
    console.log(`  Baseline attendance: ${students9.length} rows for 9-A on ${dayKey(yesterday)}`)
  }

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
