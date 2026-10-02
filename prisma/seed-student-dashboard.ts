// ============================================================
// seed-student-dashboard — SD-1 demo seed for Student Dashboard V2
// (Hawkings High School — the demo tenant).
//
// Seeds REAL rows through the actual database models so the student
// dashboard's server-side aggregation has a complete, realistic demo —
// the same data architecture a production school would use:
//
//   · 6 examinable subjects for Grade 9-A (3 exist; 3 added)
//   · a full Mon–Sat timetable for the class (Timetable rows with
//     period times, real teacher names, rooms)
//   · ~10 weeks of attendance for the authenticated demo student
//     (≈96%, one late, two absences — marked by the class teacher)
//   · the Mid-Term Examination declared (fixed to coherent 2026 dates)
//     with results for the demo student + 5 classmates → an HONEST
//     class rank; plus an upcoming Unit Test 2 for the Up Next queue
//   · a realistic fee ledger: two paid terms with Payment rows and two
//     upcoming dues with future due dates
//   · teacher→student messages (2 unread, 1 read)
//   · two student-relevant school notices (one HIGH priority)
//
// Idempotent: every section is replaced on each run for THIS school /
// THIS student only (other schools' rows are never touched).
//
// Run: bun run db:seed-dashboard   (or: bun prisma/seed-student-dashboard.ts)
// ============================================================

import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, DEMO_STUDENT_POSITION } from './seed-identity'
import { buildStudentRoster } from './hawkings-corpus'
import { db } from '../src/lib/db'

// ─── Helpers ────────────────────────────────────────────────────────

function gradeFor(marks: number, total: number): string {
  const pct = (marks / total) * 100
  if (pct >= 90) return 'A+'
  if (pct >= 80) return 'A'
  if (pct >= 70) return 'B+'
  if (pct >= 60) return 'B'
  if (pct >= 50) return 'C'
  if (pct >= 33) return 'D'
  return 'F'
}

const DAY_MS = 86_400_000
const _iso = (d: Date) => d.toISOString()
const daysAgo = (n: number, h = 9) => new Date(new Date().getTime() - n * DAY_MS - (new Date().getHours() - h) * 3600_000)
const _daysAhead = (n: number) => new Date(new Date().getTime() + n * DAY_MS)

// ─── Seed ───────────────────────────────────────────────────────────

async function main() {
  // Phase 8A — shared seed lock (fail-safe, first statement).
  assertSeedable('seed-student-dashboard')

  const school = await db.school.findFirst({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) throw new Error('Demo school not found — run the base seed first.')
  // The FEATURED STUDENT (DEMO_STUDENT_POSITION — 7-A, roll 01) is resolved
  // from the deterministic roster, never a hardcoded address.
  const roster = buildStudentRoster()
  const featuredDef = roster.find((s) => s.level === DEMO_STUDENT_POSITION.level && s.idx === DEMO_STUDENT_POSITION.idx)
  if (!featuredDef) throw new Error('Featured student definition missing (hawkings-corpus).')
  const user = await db.user.findFirst({ where: { email: featuredDef.studentEmail } })
  if (!user) throw new Error(`Demo student user not found (${featuredDef.studentEmail}).`)
  const student = await db.student.findUnique({ where: { userId: user.id }, include: { class: true } })
  if (!student || !student.class) throw new Error('Demo student has no class — run the base seed first.')
  const cls = student.class
  console.log(`Seeding dashboard demo for ${user.name} · ${cls.name} · roll ${student.rollNo}`)

  // Teacher users (real Teacher rows → their login users)
  const teacherRows = await db.teacher.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { id: true, name: true } } },
  })
  const teacherUsers = teacherRows.filter((t) => t.user)
  const classTeacherUser =
    (cls.classTeacherId ? await db.user.findUnique({ where: { id: cls.classTeacherId } }) : null) ??
    teacherUsers[0]?.user ?? null
  console.log(`Teachers available: ${teacherUsers.map((t) => t.user!.name).join(', ')}`)

  // ── 1. Subjects for the class — CANONICAL (via the class's CSA; the
  //       legacy Subject.classId linkage is retired — ids shared with the
  //       marks/curriculum corpus) ─────────────────────────────────────
  const csa = await db.classSubjectAssignment.findMany({
    where: { schoolId: school.id, classId: cls.id, isActive: true, examinable: true },
    include: { subject: true },
    orderBy: { displayOrder: 'asc' },
  })
  const subjects = csa.map((c) => c.subject)
  const subjectId = (name: string) => subjects.find((s) => s.name === name)?.id ?? null
  console.log(`  class subjects (canonical CSA): ${subjects.map((s) => s.name).join(', ')}`)

  // NOTE: the class timetable (Mon–Sat), attendance history, and the exam
  // corpus are owned by seed-teacher-academics + seed-roster-150 — this
  // seed no longer rebuilds them (the previous versions planted a parallel
  // timetable/attendance universe for this one student; the corpus owns
  // one truth now).

  // ── 2. Legacy Result rows (the student/parent dashboard cards read the
  //       legacy Result model; the marks modules read canonical ExamMark —
  //       both now derive from the same Half-Yearly exam + CSA subjects).
  const halfYearly = await db.exam.findFirst({ where: { schoolId: school.id, name: 'Half-Yearly Examination' } })
  if (!halfYearly) throw new Error('Half-Yearly Examination not found — run seed-roster-150 first.')
  // Classmates (same class roster) — their results make the class rank
  // an HONEST derivation instead of a display constant.
  const classmates = await db.student.findMany({
    where: { schoolId: school.id, classId: cls.id, id: { not: student.id } },
    include: { user: { select: { name: true } } },
    orderBy: { rollNo: 'asc' },
    take: 5,
  })
  // Deterministic per-student marks (same generator family as the corpus).
  const { sr } = await import('./hawkings-corpus')
  const subjectNames = subjects.map((s) => s.name)
  const MARKS: Record<string, number[]> = {}
  const allStudents = [student, ...classmates]
  for (const [i, st] of allStudents.entries()) {
    const rnd = sr(570000 + i * 131)
    const bias = (rnd() - 0.5) * 0.12
    MARKS[st.id] = subjectNames.map(() => Math.round(Math.min(0.97, Math.max(0.55, 0.82 + bias + (rnd() - 0.5) * 0.1)) * 100))
  }
  await db.result.deleteMany({ where: { examId: halfYearly.id } })
  for (const [sid, marks] of Object.entries(MARKS)) {
    for (let i = 0; i < subjectNames.length; i++) {
      const subject = subjectId(subjectNames[i])
      if (!subject) continue
      await db.result.create({
        data: {
          studentId: sid,
          examId: halfYearly.id,
          subjectId: subject,
          marks: marks[i],
          totalMarks: 100,
          grade: gradeFor(marks[i], 100),
        },
      })
    }
  }
  console.log(`  + results: ${Object.keys(MARKS).length} students × ${subjectNames.length} subjects (Half-Yearly)`)

  // NOTE: the student's fees/payments/ledger rows are owned by
  // seed-roster-150 (Term 1/Term 2 tuition + annual + exam fee with the
  // realistic state mix). This seed no longer rebuilds them.

  // ── 6. Messages — teacher → student (2 unread, 1 read) ────────────
  // Teacher→student messages for the featured student (the parent↔teacher
  // and teacher↔principal threads are owned by seed-roster-150).
  await db.message.deleteMany({ where: { OR: [{ recipientId: user.id }, { senderId: user.id }] } })
  const fn = featuredDef.name.split(' ')[0]
  const mathTeacher = csa.find((c) => c.subject.name === 'Mathematics')
    ? await db.user.findUnique({ where: { id: csa.find((c) => c.subject.name === 'Mathematics')!.teacherUserId ?? '' } })
    : null
  if (mathTeacher) {
    await db.message.create({
      data: {
        schoolId: school.id, senderId: mathTeacher.id, recipientId: user.id,
        subject: 'Mathematics — Half-Yearly revision plan',
        body: `Namaste ${fn}, your Half-Yearly revision plan is ready. Focus on the fractions and integers chapters first — your strongest area is geometry, so lock those marks in early. Bring your doubts to Thursday's doubt-clearing period.`,
        read: false, createdAt: daysAgo(2, 10),
      },
    })
  }
  if (classTeacherUser) {
    await db.message.create({
      data: {
        schoolId: school.id, senderId: classTeacherUser.id, recipientId: user.id,
        subject: 'Science exhibition — team confirmation',
        body: `Your team's science exhibition registration is confirmed for the last Friday of this month. Please collect the project guidelines from the science lab and confirm your table requirements with me by Wednesday.`,
        read: false, createdAt: daysAgo(1, 14),
      },
    })
    await db.message.create({
      data: {
        schoolId: school.id, senderId: classTeacherUser.id, recipientId: user.id,
        subject: 'Parent-teacher meeting — schedule',
        body: 'The Term 1 parent-teacher meeting is scheduled for this Saturday, 10:00 AM – 1:00 PM. Your slot with me is 10:30 AM. Please inform your parents and bring your Term 1 notebook set.',
        read: true, createdAt: daysAgo(6, 9),
      },
    })
  }
  console.log('  + messages: 2 unread + 1 read')

  // ── 7. School notices (student-relevant, one HIGH priority) ───────
  // Idempotency: exact titles (no visible markers — these rows also feed
  // the existing /api/student/notices route), plus a one-time cleanup of
  // the earlier marker-prefixed versions of this seed.
  const NOTICE_TITLES = [
    'Periodic Assessment 2 — timetable released',
    'Science exhibition — registration closes Friday',
  ]
  const legacy = await db.notification.findMany({ where: { schoolId: school.id, title: { startsWith: 'SD-SEED:' } }, select: { id: true } })
  const toDelete = [
    ...legacy.map((r) => r.id),
    ...(await db.notification.findMany({ where: { schoolId: school.id, title: { in: NOTICE_TITLES } }, select: { id: true } })).map((r) => r.id),
  ]
  if (toDelete.length) {
    await db.notificationRead.deleteMany({ where: { notificationId: { in: toDelete } } })
    await db.notification.deleteMany({ where: { id: { in: toDelete } } })
  }
  await db.notification.create({
    data: {
      schoolId: school.id,
      title: 'Periodic Assessment 2 — timetable released',
      message: 'Periodic Assessment 2 begins on 14 December. The detailed day-wise timetable is available with your class teacher. Syllabus: everything covered until the last week. Students must reach their examination rooms by 7:45 AM.',
      audience: 'STUDENTS',
      priority: 'HIGH',
      senderId: classTeacherUser?.id ?? null,
      createdAt: daysAgo(2, 8),
    },
  })
  await db.notification.create({
    data: {
      schoolId: school.id,
      title: 'Science exhibition — registration closes Friday',
      message: 'Class 6–8 teams: science exhibition registrations close this Friday. Confirm your team and project title with your class teacher. Project guidelines are available in the science lab.',
      audience: `CLASS:${cls.name}`,
      priority: 'NORMAL',
      senderId: classTeacherUser?.id ?? null,
      createdAt: daysAgo(1, 11),
    },
  })
  console.log('  + notices: 2 (1 HIGH, audience-scoped)')

  console.log('\nDashboard demo seed complete.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
