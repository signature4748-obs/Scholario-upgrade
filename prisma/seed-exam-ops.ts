/**
 * seed-exam-ops — the examination/proctoring world for the Hawkings demo
 * tenant, generated from the canonical corpus:
 *
 *   · PA1  (Periodic Assessment 1)   13–17 Jul 2026   COMPLETED — duty
 *     history + historical attendance recorded by the invigilator.
 *   · HY   (Half-Yearly Examination) 21–30 Sep 2026   COMPLETED +
 *     Declared — duty history (the marks live in seed-roster-150).
 *   · PA2  (Periodic Assessment 2)   14–18 Dec 2026   ONGOING — upcoming
 *     duties only (honest "papers not yet written" state).
 *
 * Papers (ExamScheduleItem) are generated for EVERY class 1–12 from the
 * CSA matrix (one class → its homeroom, invigilated by the subject's CSA
 * teacher; invigilator date/slot collisions resolved greedily so no
 * teacher is ever double-booked). Seat assignments + historical exam
 * attendance anchor on the Mathematics specialist's (Shri Ajay Kumar
 * Mishra) completed duties — the proctoring module's demo spine.
 *
 * Run: bun run db:seed-exam-ops
 */
import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG } from './seed-identity'

const db = new PrismaClient()

/** Seating grid per room (rows × cols) → capacity 24. */
const ROOM_GRID = { rows: 4, cols: 6 }

const LONG_SLOT = { start: '09:30', end: '12:00' }
const LONG_SLOT_PM = { start: '13:30', end: '16:00' }

function day(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d))
}

/** Duty date (UTC midnight) + "HH:MM" start time + offset minutes. */
function duringPaper(dutyDate: Date, startTime: string, offsetMinutes: number): Date {
  const [h, m] = startTime.split(':').map((x) => Number.parseInt(x, 10))
  return new Date(dutyDate.getTime() + ((h || 0) * 60 + (m || 0) + offsetMinutes) * 60 * 1000)
}

/** Teaching weekdays of a window (Mon–Sat, skipping Sundays). */
function windowDays(start: Date, count: number): Date[] {
  const out: Date[] = []
  const d = new Date(start)
  while (out.length < count) {
    if (d.getUTCDay() !== 0) out.push(new Date(d))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

interface ExamSpec {
  key: 'PA1' | 'HY' | 'PA2'
  nameFragment: string
  window: { start: Date; days: number }
  completed: boolean
}

const EXAMS: ExamSpec[] = [
  { key: 'PA1', nameFragment: 'Periodic Assessment 1', window: { start: day(2026, 7, 13), days: 5 }, completed: true },
  { key: 'HY', nameFragment: 'Half-Yearly', window: { start: day(2026, 9, 21), days: 8 }, completed: true },
  { key: 'PA2', nameFragment: 'Periodic Assessment 2', window: { start: day(2026, 12, 14), days: 5 }, completed: false },
]

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-exam-ops')

  const school = await db.school.findUnique({
    where: { slug: DEMO_SCHOOL_SLUG },
    select: { id: true, name: true },
  })
  if (!school) throw new Error(`Demo school (${DEMO_SCHOOL_SLUG}) not found`)
  console.log(`School: ${school.name}`)

  // ── Ground truth: classes, subjects, teachers, students ────────────────
  const classes = await db.class.findMany({
    where: { schoolId: school.id },
    select: { id: true, name: true, room: true },
  })
  // Senior-first placement order (9–12 place their papers first).
  const orderedClasses = [...classes].sort((a, b) => {
    const num = (n: string) => { const m = n.match(/^(\d+)/); return m ? Number(m[1]) : 0 }
    return num(b.name) - num(a.name) || a.name.localeCompare(b.name)
  })

  const subjects = await db.subject.findMany({
    where: { schoolId: school.id },
    select: { id: true, name: true, code: true },
  })
  const subjectByCode = new Map(subjects.map((s) => [s.code ?? '', s]))

  const csa = await db.classSubjectAssignment.findMany({
    where: { schoolId: school.id, isActive: true, examinable: true },
    include: { subject: true },
    orderBy: { displayOrder: 'asc' },
  })
  const csaByClass = new Map<string, typeof csa>()
  for (const c of csa) {
    if (!c.subject.code || !subjectByCode.has(c.subject.code)) continue
    csaByClass.set(c.classId, [...(csaByClass.get(c.classId) ?? []), c])
  }

  const teachers = await db.user.findMany({
    where: { schoolId: school.id, role: 'TEACHER', status: 'ACTIVE' },
    select: { id: true, name: true },
  })
  const teacherById = new Map(teachers.map((t) => [t.id, t]))
  // The demo spine: the Mathematics specialist (Ajay — CSA of 9-A MAT).
  const mathCsa9 = (csaByClass.get(classes.find((c) => c.name === '9-A')?.id ?? '') ?? []).find((c) => c.subject.code === 'MAT')
  const SPINE = mathCsa9?.teacherUserId ? teacherById.get(mathCsa9.teacherUserId) : undefined
  if (!SPINE) throw new Error('Mathematics specialist (9-A MAT CSA) not found')

  // ── Exams ──────────────────────────────────────────────────────────────
  const examRows = await db.exam.findMany({ where: { schoolId: school.id } })
  const examByKey = new Map<string, typeof examRows[number]>()
  for (const spec of EXAMS) {
    const row = examRows.find((x) => x.name.includes(spec.nameFragment))
    if (!row) throw new Error(`Exam not found: ${spec.nameFragment} — run seed-teacher-academics/seed-roster-150 first`)
    examByKey.set(spec.key, row)
  }

  // Scoped wipe (tenancy via examId — never a global deleteMany).
  const delA = await db.examAttendance.deleteMany({ where: { exam: { schoolId: school.id } } })
  const delS = await db.examScheduleItem.deleteMany({ where: { exam: { schoolId: school.id } } })
  const delSeats = await db.examSeatAssignment.deleteMany({ where: { exam: { schoolId: school.id } } })
  console.log(`  Cleared ${delS.count} schedule items, ${delSeats.count} seats, ${delA.count} attendance`)

  // ── Papers generated from the CSA matrix (greedy, conflict-free) ───────
  // busy: `${examKey}|${invigilatorId}|${isoDate}|${slotStart}` — a teacher
  // can never invigilate two papers at the same date+slot.
  const busy = new Set<string>()
  const createdItems: { id: string; exam: string; classId: string; className: string; subjectCode: string; date: Date; startTime: string; invigilatorId: string }[] = []
  for (const spec of EXAMS) {
    const exam = examByKey.get(spec.key)!
    const days = windowDays(spec.window.start, spec.window.days)
    const slots = [LONG_SLOT, LONG_SLOT_PM]
    // Ensure every class of this exam is enrolled (ExamClass).
    for (const c of classes) {
      const numeric = Number(c.name.match(/^(\d+)/)?.[1] ?? '')
      if (!Number.isFinite(numeric)) continue // pre-primary: no formal exams
      await db.examClass
        .upsert({ where: { examId_classId: { examId: exam.id, classId: c.id } }, update: {}, create: { examId: exam.id, classId: c.id } })
        .catch(() => {/* already enrolled */})
    }
    for (const c of orderedClasses) {
      const classCsas = csaByClass.get(c.id) ?? []
      if (classCsas.length === 0) continue
      const classOrdinal = orderedClasses.indexOf(c)
      for (const [si, subjCsa] of classCsas.entries()) {
        const invigilatorId = subjCsa.teacherUserId
        if (!invigilatorId) continue
        // Deterministic first-choice slot, then greedy conflict search.
        let placed = false
        const startIdx = (classOrdinal * 2 + si) % days.length
        const slotIdx0 = (classOrdinal + si) % slots.length
        for (let di = 0; di < days.length && !placed; di++) {
          const date = days[(startIdx + di) % days.length]
          for (let ti = 0; ti < slots.length && !placed; ti++) {
            const slot = slots[(slotIdx0 + ti) % slots.length]
            const key = `${spec.key}|${invigilatorId}|${date.toISOString().slice(0, 10)}|${slot.start}`
            if (busy.has(key)) continue
            busy.add(key)
            const item = await db.examScheduleItem.create({
              data: {
                examId: exam.id,
                classId: c.id,
                subjectId: subjCsa.subjectId,
                date,
                startTime: slot.start,
                endTime: slot.end,
                room: c.room,
                invigilatorId,
                invigilatorName: teacherById.get(invigilatorId)?.name ?? 'Faculty',
              },
            })
            createdItems.push({
              id: item.id,
              exam: spec.key,
              classId: c.id,
              className: c.name,
              subjectCode: subjCsa.subject.code ?? '',
              date,
              startTime: slot.start,
              invigilatorId,
            })
            placed = true
          }
        }
        if (!placed) console.warn(`  ⚠ could not place ${spec.key} ${c.name} ${subjCsa.subject.code}`)
      }
    }
  }
  console.log(`  Created ${createdItems.length} papers across classes 1–12 (3 exams)`)

  // ── Seat assignments (every completed/ongoing exam × every class) ──────
  let seatCount = 0
  for (const spec of EXAMS) {
    const exam = examByKey.get(spec.key)!
    for (const c of classes) {
      const roster = await db.student.findMany({
        where: { classId: c.id, user: { status: 'ACTIVE' } },
        orderBy: [{ rollNo: 'asc' }],
        select: { id: true },
      })
      for (let i = 0; i < roster.length; i++) {
        await db.examSeatAssignment.create({
          data: {
            examId: exam.id,
            classId: c.id,
            studentId: roster[i].id,
            room: c.room ?? 'Room',
            seatNumber: i + 1,
            row: Math.floor(i / ROOM_GRID.cols) + 1,
            column: (i % ROOM_GRID.cols) + 1,
          },
        })
        seatCount++
      }
    }
  }
  console.log(`  Created ${seatCount} seat assignments`)

  // ── Historical exam attendance — the SPINE teacher's completed duties ──
  let attCount = 0
  for (const item of createdItems.filter((i) => i.invigilatorId === SPINE.id)) {
    const spec = EXAMS.find((e) => e.key === item.exam)!
    if (!spec.completed) continue
    const exam = examByKey.get(item.exam)!
    const roster = await db.student.findMany({
      where: { classId: item.classId },
      orderBy: [{ rollNo: 'asc' }],
      select: { id: true },
    })
    for (let i = 0; i < roster.length; i++) {
      // Quiet, believable variety — one absence per class-paper at most.
      const status = i === roster.length - 1 && item.exam === 'HY' ? 'ABSENT' : 'PRESENT'
      await db.examAttendance.create({
        data: {
          examId: exam.id,
          scheduleItemId: item.id,
          classId: item.classId,
          studentId: roster[i].id,
          subjectId: subjectByCode.get(item.subjectCode)?.id ?? subjects[0].id,
          date: item.date,
          status,
          markedBy: SPINE.name,
          // Plausible historical marking time (20 minutes into the paper).
          updatedAt: duringPaper(item.date, item.startTime, 20),
        },
      })
      attCount++
    }
  }
  console.log(`  Created ${attCount} historical attendance records (${SPINE.name}'s completed duties)`)

  // ── Verify ─────────────────────────────────────────────────────────────
  const verify = await db.examScheduleItem.findMany({
    where: { invigilatorId: SPINE.id },
    include: { exam: { select: { name: true } }, subject: { select: { name: true } }, class: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })
  console.log(`\n  ${SPINE.name}'s duties (${verify.length}):`)
  for (const v of verify.slice(0, 8)) {
    console.log(`    ${v.date.toISOString().slice(0, 10)} ${v.startTime}–${v.endTime} ${v.room} · ${v.exam.name} · ${v.class.name} ${v.subject.name}`)
  }
  if (verify.length > 8) console.log(`    … +${verify.length - 8} more`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
