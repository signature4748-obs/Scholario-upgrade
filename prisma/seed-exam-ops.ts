/**
 * seed-exam-ops — the examination world for the Teacher Exam Proctoring
 * module, rebuilt around ONE question: "Which exam duty do I have, when is
 * it, where is it, and what do I need to do?"
 *
 * The dataset (all Academic Session 2026–2027, today = 17 Sep 2026):
 *
 *   · Mid-Term Examination   Aug 31 – Sep 3   COMPLETED  — duty HISTORY,
 *     with historical attendance + incidents recorded by the invigilator.
 *   · Periodic Assessment 1  Sep 9 – Sep 12   COMPLETED  — duty HISTORY
 *     (keeps its ExamSubjectConfigs — Marks Entry still uses them).
 *   · Unit Test 2            Sep 17 – Sep 21  ONGOING    — papers TODAY
 *     (morning + afternoon for Rohan Mehta) and upcoming (19 & 21 Sep).
 *   · Final Examination      Mar 1 – Mar 12, 2027  SCHEDULED — no papers
 *     published yet (honest "papers not scheduled" state).
 *
 * Rooms: Grade 9-A writes in Room 201, Grade 10-A in Room 202 (one class
 * per room, one paper per room-slot — no double-booking). Every schedule
 * item carries the invigilator's user id AND name so authorization is
 * enforced server-side on ids, never on display strings alone.
 *
 * Run: bun run db:seed-exam-ops
 */
import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG } from './seed-identity'

const db = new PrismaClient()

/** Seating grid per room (rows × cols) → capacity 24. */
const ROOM_GRID = { rows: 4, cols: 6 }
const CLASS_ROOMS: Record<string, string> = {} // filled after classes load

/** Slot lengths per exam kind. */
const LONG_SLOT = { start: '09:00', end: '11:30' }
const LONG_SLOT_PM = { start: '13:30', end: '16:00' }
const SHORT_SLOT = { start: '09:00', end: '11:00' }
const SHORT_SLOT_PM = { start: '13:30', end: '15:30' }

function day(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

/** Duty date (UTC midnight) + "HH:MM" start time + offset minutes. */
function duringPaper(dutyDate: Date, startTime: string, offsetMinutes: number): Date {
  const [h, m] = startTime.split(':').map((x) => Number.parseInt(x, 10))
  return new Date(dutyDate.getTime() + ((h || 0) * 60 + (m || 0) + offsetMinutes) * 60 * 1000)
}

/** A paper slot in the hand-authored plans below. */
interface PaperPlan {
  exam: 'MID_TERM' | 'PA1' | 'UT2'
  className: 'G9' | 'G10'
  subject: string
  date: Date
  slot: { start: string; end: string }
  invigilator: string
}

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-exam-ops')

  // Phase 8A: target the DEMO tenant explicitly. The legacy "first school
  // in the DB" heuristic broke once the corpus grew a second tenant
  // (green-valley) — this dataset (Grade 9/10, Rohan/Kavita/Priya/Arjun,
  // Mid-Term/PA1/UT2/Final) is demo-corpus-specific by construction.
  const school = await db.school.findUnique({
    where: { slug: DEMO_SCHOOL_SLUG },
    select: { id: true, name: true },
  })
  if (!school) throw new Error(`Demo school (${DEMO_SCHOOL_SLUG}) not found`)
  console.log(`School: ${school.name}`)

  // ── Ground truth: classes, subjects, teachers, students ────────────────
  const classes = await db.class.findMany({
    where: { schoolId: school.id },
    select: { id: true, name: true, section: true },
  })
  const g9 = classes.find((c) => c.name.includes('9'))
  const g10 = classes.find((c) => c.name.includes('10'))
  if (!g9 || !g10) throw new Error('Expected Grade 9 and Grade 10 classes')
  const classIdOf: Record<'G9' | 'G10', string> = { G9: g9.id, G10: g10.id }
  CLASS_ROOMS[g9.id] = 'Room 201'
  CLASS_ROOMS[g10.id] = 'Room 202'

  const subjects = await db.subject.findMany({
    where: { schoolId: school.id },
    select: { id: true, name: true },
  })
  const subjectId = (name: string): string => {
    const s = subjects.find(
      (x) => x.name.toLowerCase() === name.toLowerCase(),
    )
    if (!s) throw new Error(`Subject not found: ${name}`)
    return s.id
  }

  const teachers = await db.user.findMany({
    where: { schoolId: school.id, role: 'TEACHER', status: 'ACTIVE' },
    select: { id: true, name: true },
  })
  const teacher = (name: string): { id: string; name: string } => {
    const t = teachers.find((x) => (x.name || '').includes(name))
    if (!t) throw new Error(`Teacher not found: ${name}`)
    return { id: t.id, name: t.name || name }
  }
  const ROHAN = teacher('Rohan')
  const KAVITA = teacher('Kavita')
  const PRIYA = teacher('Priya')
  const ARJUN = teacher('Arjun')

  const studentsByClass: Record<'G9' | 'G10', { id: string; name: string }[]> = {
    G9: [],
    G10: [],
  }
  for (const key of ['G9', 'G10'] as const) {
    const rows = await db.student.findMany({
      where: { classId: classIdOf[key], user: { status: 'ACTIVE' } },
      orderBy: [{ rollNo: 'asc' }],
      select: { id: true, user: { select: { name: true } } },
    })
    studentsByClass[key] = rows.map((r) => ({ id: r.id, name: r.user.name ?? 'Unknown' }))
  }
  console.log(
    `  Students: Grade 9-A ${studentsByClass.G9.length} · Grade 10-A ${studentsByClass.G10.length}`,
  )

  // ── Exams: align every row to the 2026–27 session ─────────────────────
  const exams = await db.exam.findMany({ where: { schoolId: school.id } })
  const byName = (frag: string) => {
    const e = exams.find((x) => x.name.includes(frag))
    if (!e) throw new Error(`Exam not found: ${frag}`)
    return e
  }
  const MID_TERM = byName('Mid-Term')
  const PA1 = byName('Periodic Assessment 1')
  const UT2 = byName('Unit Test 2')
  const FINAL = byName('Final')

  await db.exam.update({
    where: { id: MID_TERM.id },
    data: { session: '2026-2027', startDate: day(2026, 8, 31), endDate: day(2026, 9, 3) },
  })
  await db.exam.update({
    where: { id: PA1.id },
    data: { session: '2026-2027', startDate: day(2026, 9, 9), endDate: day(2026, 9, 12) },
  })
  await db.exam.update({
    where: { id: UT2.id },
    data: {
      session: '2026-2027',
      status: 'ONGOING',
      startDate: day(2026, 9, 17),
      endDate: day(2026, 9, 21),
    },
  })
  await db.exam.update({
    where: { id: FINAL.id },
    data: {
      session: '2026-2027',
      type: 'Final Exam',
      status: 'SCHEDULED',
      startDate: day(2027, 3, 1),
      endDate: day(2027, 3, 12),
    },
  })

  // Every exam involves both classes (ExamClass upsert).
  for (const exam of [MID_TERM, PA1, UT2, FINAL]) {
    for (const key of ['G9', 'G10'] as const) {
      await db.examClass.upsert({
        where: { examId_classId: { examId: exam.id, classId: classIdOf[key] } },
        update: {},
        create: { examId: exam.id, classId: classIdOf[key] },
      })
    }
  }

  // ── Clean previous exam-ops rows (configs + marks are owned elsewhere) ─
  // Phase 3: the deletes are scoped to THIS school's exams (tenancy is
  // transitive via examId — a global deleteMany previously wiped every
  // other tenant's schedule/seats/attendance).
  const delA = await db.examAttendance.deleteMany({ where: { exam: { schoolId: school.id } } })
  const delS = await db.examScheduleItem.deleteMany({ where: { exam: { schoolId: school.id } } })
  const delSeats = await db.examSeatAssignment.deleteMany({ where: { exam: { schoolId: school.id } } })
  console.log(
    `  Cleared ${delS.count} schedule items, ${delSeats.count} seats, ${delA.count} attendance`,
  )

  // ── Hand-authored paper plans ──────────────────────────────────────────
  // One class per room, one paper per room-slot, invigilation spread across
  // the four teachers. Rohan Mehta's duties are the demo spine:
  //   history  ×4 (Mid-Term + PA1 maths), today ×2 (UT2 maths), future ×2.
  const plans: PaperPlan[] = [
    // Mid-Term Examination — Aug 31 (Mon) → Sep 3 (Thu), 2.5h papers
    { exam: 'MID_TERM', className: 'G9', subject: 'Mathematics', date: day(2026, 8, 31), slot: LONG_SLOT, invigilator: ROHAN.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'English', date: day(2026, 8, 31), slot: LONG_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'Physics', date: day(2026, 9, 1), slot: LONG_SLOT, invigilator: KAVITA.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'Social Science', date: day(2026, 9, 1), slot: LONG_SLOT_PM, invigilator: ARJUN.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'Chemistry', date: day(2026, 9, 2), slot: LONG_SLOT, invigilator: KAVITA.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'Biology', date: day(2026, 9, 2), slot: LONG_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'MID_TERM', className: 'G9', subject: 'Hindi', date: day(2026, 9, 3), slot: LONG_SLOT, invigilator: ARJUN.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'English', date: day(2026, 8, 31), slot: LONG_SLOT, invigilator: PRIYA.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Physics', date: day(2026, 8, 31), slot: LONG_SLOT_PM, invigilator: KAVITA.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Mathematics', date: day(2026, 9, 1), slot: LONG_SLOT, invigilator: ROHAN.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Chemistry', date: day(2026, 9, 1), slot: LONG_SLOT_PM, invigilator: KAVITA.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Social Science', date: day(2026, 9, 2), slot: LONG_SLOT, invigilator: ARJUN.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Biology', date: day(2026, 9, 2), slot: LONG_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'MID_TERM', className: 'G10', subject: 'Hindi', date: day(2026, 9, 3), slot: LONG_SLOT, invigilator: ARJUN.name },

    // Periodic Assessment 1 — Sep 9 (Wed) → Sep 12 (Sat), 2.5h papers
    { exam: 'PA1', className: 'G9', subject: 'Mathematics', date: day(2026, 9, 9), slot: LONG_SLOT, invigilator: ROHAN.name },
    { exam: 'PA1', className: 'G9', subject: 'Physics', date: day(2026, 9, 9), slot: LONG_SLOT_PM, invigilator: KAVITA.name },
    { exam: 'PA1', className: 'G9', subject: 'Chemistry', date: day(2026, 9, 10), slot: LONG_SLOT, invigilator: KAVITA.name },
    { exam: 'PA1', className: 'G9', subject: 'English', date: day(2026, 9, 10), slot: LONG_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'PA1', className: 'G9', subject: 'Biology', date: day(2026, 9, 11), slot: LONG_SLOT, invigilator: PRIYA.name },
    { exam: 'PA1', className: 'G9', subject: 'Social Science', date: day(2026, 9, 11), slot: LONG_SLOT_PM, invigilator: ARJUN.name },
    { exam: 'PA1', className: 'G9', subject: 'Hindi', date: day(2026, 9, 12), slot: LONG_SLOT, invigilator: ARJUN.name },
    { exam: 'PA1', className: 'G10', subject: 'Physics', date: day(2026, 9, 9), slot: LONG_SLOT, invigilator: KAVITA.name },
    { exam: 'PA1', className: 'G10', subject: 'English', date: day(2026, 9, 9), slot: LONG_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'PA1', className: 'G10', subject: 'Hindi', date: day(2026, 9, 10), slot: LONG_SLOT, invigilator: ARJUN.name },
    { exam: 'PA1', className: 'G10', subject: 'Mathematics', date: day(2026, 9, 10), slot: LONG_SLOT_PM, invigilator: ROHAN.name },
    { exam: 'PA1', className: 'G10', subject: 'Chemistry', date: day(2026, 9, 11), slot: LONG_SLOT, invigilator: KAVITA.name },
    { exam: 'PA1', className: 'G10', subject: 'Social Science', date: day(2026, 9, 11), slot: LONG_SLOT_PM, invigilator: ARJUN.name },
    { exam: 'PA1', className: 'G10', subject: 'Biology', date: day(2026, 9, 12), slot: LONG_SLOT, invigilator: PRIYA.name },

    // Unit Test 2 — Sep 17 (Thu, TODAY) → Sep 21 (Mon, skipping Sunday),
    // 2h papers. Rohan: both maths papers TODAY + English (Sat) + Hindi (Mon).
    { exam: 'UT2', className: 'G9', subject: 'Mathematics', date: day(2026, 9, 17), slot: SHORT_SLOT, invigilator: ROHAN.name },
    { exam: 'UT2', className: 'G9', subject: 'Physics', date: day(2026, 9, 17), slot: SHORT_SLOT_PM, invigilator: KAVITA.name },
    { exam: 'UT2', className: 'G9', subject: 'Chemistry', date: day(2026, 9, 18), slot: SHORT_SLOT, invigilator: KAVITA.name },
    { exam: 'UT2', className: 'G9', subject: 'Biology', date: day(2026, 9, 18), slot: SHORT_SLOT_PM, invigilator: PRIYA.name },
    { exam: 'UT2', className: 'G9', subject: 'English', date: day(2026, 9, 19), slot: SHORT_SLOT, invigilator: ROHAN.name },
    { exam: 'UT2', className: 'G9', subject: 'Social Science', date: day(2026, 9, 19), slot: SHORT_SLOT_PM, invigilator: ARJUN.name },
    { exam: 'UT2', className: 'G9', subject: 'Hindi', date: day(2026, 9, 21), slot: SHORT_SLOT, invigilator: ARJUN.name },
    { exam: 'UT2', className: 'G10', subject: 'English', date: day(2026, 9, 17), slot: SHORT_SLOT, invigilator: PRIYA.name },
    { exam: 'UT2', className: 'G10', subject: 'Mathematics', date: day(2026, 9, 17), slot: SHORT_SLOT_PM, invigilator: ROHAN.name },
    { exam: 'UT2', className: 'G10', subject: 'Physics', date: day(2026, 9, 18), slot: SHORT_SLOT, invigilator: KAVITA.name },
    { exam: 'UT2', className: 'G10', subject: 'Chemistry', date: day(2026, 9, 18), slot: SHORT_SLOT_PM, invigilator: KAVITA.name },
    { exam: 'UT2', className: 'G10', subject: 'Biology', date: day(2026, 9, 19), slot: SHORT_SLOT, invigilator: PRIYA.name },
    { exam: 'UT2', className: 'G10', subject: 'Social Science', date: day(2026, 9, 19), slot: SHORT_SLOT_PM, invigilator: ARJUN.name },
    { exam: 'UT2', className: 'G10', subject: 'Hindi', date: day(2026, 9, 21), slot: SHORT_SLOT, invigilator: ROHAN.name },
  ]

  const examIdOf: Record<PaperPlan['exam'], string> = {
    MID_TERM: MID_TERM.id,
    PA1: PA1.id,
    UT2: UT2.id,
  }

  const createdItems: {
    id: string
    exam: PaperPlan['exam']
    className: 'G9' | 'G10'
    subject: string
    date: Date
    startTime: string
    invigilator: string
  }[] = []

  for (const p of plans) {
    const inv = teacher(p.invigilator)
    const item = await db.examScheduleItem.create({
      data: {
        examId: examIdOf[p.exam],
        classId: classIdOf[p.className],
        subjectId: subjectId(p.subject),
        date: p.date,
        startTime: p.slot.start,
        endTime: p.slot.end,
        room: CLASS_ROOMS[classIdOf[p.className]],
        invigilatorId: inv.id,
        invigilatorName: inv.name,
      },
    })
    createdItems.push({
      id: item.id,
      exam: p.exam,
      className: p.className,
      subject: p.subject,
      date: p.date,
      startTime: p.slot.start,
      invigilator: inv.name,
    })
  }
  console.log(`  Created ${createdItems.length} papers (schedule items)`)

  // ── Seat assignments: one class per room, roll order → seat order ─────
  let seatCount = 0
  for (const exam of [MID_TERM, PA1, UT2]) {
    for (const key of ['G9', 'G10'] as const) {
      const room = CLASS_ROOMS[classIdOf[key]]
      const roster = studentsByClass[key]
      for (let i = 0; i < roster.length; i++) {
        const seatNumber = i + 1
        await db.examSeatAssignment.create({
          data: {
            examId: exam.id,
            classId: classIdOf[key],
            studentId: roster[i].id,
            room,
            seatNumber,
            row: Math.floor(i / ROOM_GRID.cols) + 1,
            column: (i % ROOM_GRID.cols) + 1,
          },
        })
        seatCount++
      }
    }
  }
  console.log(`  Created ${seatCount} seat assignments`)

  // ── Historical exam attendance (Rohan's four completed duties) ─────────
  const historyDuties = createdItems.filter(
    (c) => c.invigilator === ROHAN.name && c.exam !== 'UT2',
  )
  let attCount = 0
  for (const duty of historyDuties) {
    const roster = studentsByClass[duty.className]
    for (let i = 0; i < roster.length; i++) {
      // Quiet, believable variety — a couple of absences and one late.
      let status = 'PRESENT'
      if (duty.exam === 'MID_TERM' && duty.subject === 'Mathematics' && duty.className === 'G9' && i === 6) status = 'ABSENT'
      if (duty.exam === 'MID_TERM' && duty.subject === 'Mathematics' && duty.className === 'G10' && i === 4) status = 'LATE'
      if (duty.exam === 'PA1' && duty.subject === 'Mathematics' && duty.className === 'G9' && i === 2) status = 'ABSENT'
      await db.examAttendance.create({
        data: {
          examId: examIdOf[duty.exam],
          scheduleItemId: duty.id,
          classId: classIdOf[duty.className],
          studentId: roster[i].id,
          subjectId: subjectId(duty.subject),
          date: duty.date,
          status,
          markedBy: ROHAN.name,
          // Plausible historical marking time (20 minutes into the paper) —
          // otherwise @updatedAt stamps "now" and history reads like it was
          // marked today.
          updatedAt: duringPaper(duty.date, duty.startTime, 20),
        },
      })
      attCount++
    }
  }
  console.log(`  Created ${attCount} historical attendance records`)

  // ── Verify ─────────────────────────────────────────────────────────────
  const verify = await db.examScheduleItem.findMany({
    where: { invigilatorId: ROHAN.id },
    include: { exam: { select: { name: true } }, subject: { select: { name: true } }, class: { select: { name: true, section: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })
  console.log(`\n  Rohan Mehta's duties (${verify.length}):`)
  for (const v of verify) {
    console.log(
      `    ${v.date.toISOString().slice(0, 10)} ${v.startTime}–${v.endTime} ${v.room} · ${v.exam.name} · ${v.class.name} ${v.subject.name}`,
    )
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
