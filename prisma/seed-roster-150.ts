/**
 * seed-roster-150 — reduce the development dataset to ~150 REAL, fully
 * connected students in the canonical database (Seed → DB → API → UI).
 *
 * PART OF: "Production data reduction" (worklog: 2026-10-06). The UI
 * previously showed a FAKE "707 students" (getVirtualOccupied) over a
 * 58-student mock store universe and a 19-student DB. This seed makes
 * the DATABASE the single roster source:
 *
 *   · Class catalog: existing 9 classes (Grade 6-12) + 12 new rows
 *     (Grade 1-5 primary wing + B sections) → 21 sections — mirroring
 *     the school structure the principal UI manages.
 *   · Students: 133 NEW students (7 per previously-empty section)
 *     + the 19 existing (Task D QA data PRESERVED) = 152 total, with
 *     realistic variation in gender, attendance, marks, fee status
 *     (paid / partial / outstanding / overdue), guardians, routes.
 *   · Related records ALL reference the same canonical Student rows:
 *     attendance (30 weekdays), PA1 exam configs + marks, fees +
 *     payments + the FeeTransaction ledger, behavior records, growth
 *     events.
 *
 * RESUMABLE + IDEMPOTENT: every phase tops up only what is missing
 * (per-entity natural keys). Re-running a completed seed is a no-op.
 * It never deletes or modifies existing rows (existing 9-A/10-A
 * students, QA exam marks, fees, growth history all stay untouched).
 *
 * Run: bun run db:seed-roster   (package.json script)
 */

import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth'

// ---------------------------------------------------------------------------
// Deterministic PRNG helpers. Per-student values derive from a per-student
// seed (the admission number) so resumed runs reproduce identical data.
// ---------------------------------------------------------------------------
function sr(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}
const pick = <T,>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
const pickI = (rnd: () => number, min: number, max: number) => min + Math.floor(rnd() * (max - min + 1))

// ---------------------------------------------------------------------------
// Name pools — enough entropy for 133 unique students + guardians
// ---------------------------------------------------------------------------
const MALE_FIRST = ['Aarav','Vivaan','Reyansh','Arjun','Kabir','Vihaan','Dhruv','Sai','Rohan','Karan','Aditya','Ishaan','Advait','Aryan','Ansh','Atharv','Ayaan','Veer','Krish','Rudra','Lakshya','Madhav','Om','Pranav','Raunak','Shaurya','Shivansh','Tanish','Uday','Yash','Zorawar','Nakul','Devansh','Harsh','Kian','Mihir','Nirvaan','Abhay','Rian','Vedant']
const FEMALE_FIRST = ['Diya','Ananya','Myra','Saanvi','Kiara','Anika','Aadhya','Pari','Riya','Nisha','Ishaani','Anvi','Aarohi','Aisha','Amyra','Elina','Gauri','Ira','Jiya','Kavya','Mahira','Naisha','Nyra','Pihu','Ranya','Sara','Tara','Urvi','Vanya','Yamini','Zara','Avni','Nitya','Prisha','Alisha','Bhavna','Charvi','Drishti','Esha','Falguni']
const LAST = ['Sharma','Patel','Reddy','Singh','Kumar','Verma','Nair','Gupta','Mehta','Iyer','Khanna','Rao','Agarwal','Desai','Joshi','Menon','Pillai','Chopra','Bansal','Malhotra','Saxena','Trivedi','Bhatt','Chauhan','Dubey','Gokhale','Jain','Kulkarni','Luthra','Mishra']
const FATHER_FIRST = ['Rahul','Nikhil','Karthik','Arvind','Sandeep','Manish','Vinod','Rajesh','Tarun','Sriram','Amit','Suresh','Pradeep','Mukesh','Harish','Ganesh','Nilesh','Prakash','Vikram','Mohan']
const MOTHER_FIRST = ['Pooja','Sneha','Lakshmi','Meera','Ritu','Kavita','Deepa','Anjali','Shweta','Geeta','Nisha','Rekha','Sunita','Hetal','Priti','Sumathi','Renu','Aarti','Radha','Neha']
const STREETS = ['A-12, Sector 14','B-45, DLF Phase 3','C-23, Sushant Lok','D-67, Palam Vihar','E-89, Sector 56','F-34, Sector 40','G-56, Sector 23','H-78, Sector 15','I-90, DLF Phase 5','J-12, Sector 31','K-34, Sector 42','L-56, Sector 49','M-78, Sector 28','N-90, Sector 12','O-23, Sector 22','P-45, Sector 9','Q-67, Sector 17','R-89, Sector 14']
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'O-', 'A-']

// ---------------------------------------------------------------------------
// Target sections: 12 NEW class rows + the 7 EXISTING-but-empty classes
// ---------------------------------------------------------------------------
const NEW_CLASS_DEFS: { grade: string; section: string; room: string; capacity: number }[] = [
  { grade: '1', section: 'A', room: 'Room 10A', capacity: 30 },
  { grade: '2', section: 'A', room: 'Room 20A', capacity: 30 },
  { grade: '3', section: 'A', room: 'Room 30A', capacity: 32 },
  { grade: '4', section: 'A', room: 'Room 40A', capacity: 32 },
  { grade: '4', section: 'B', room: 'Room 40B', capacity: 32 },
  { grade: '5', section: 'A', room: 'Room 50A', capacity: 35 },
  { grade: '5', section: 'B', room: 'Room 50B', capacity: 35 },
  { grade: '6', section: 'B', room: 'Room 60B', capacity: 40 },
  { grade: '7', section: 'B', room: 'Room 70B', capacity: 40 },
  { grade: '8', section: 'B', room: 'Room 80B', capacity: 40 },
  { grade: '9', section: 'B', room: 'Room 90B', capacity: 40 },
  { grade: '10', section: 'B', room: 'Room 100B', capacity: 40 },
]
/** Existing classes that have ZERO students and therefore join the roster target set. */
const EMPTY_EXISTING = ['Grade 6 - A', 'Grade 7 - A', 'Grade 8 - A', 'Grade 11 - A', 'Grade 11 - B', 'Grade 12 - A', 'Grade 12 - B']

/** Subject codes per grade band for the new classes. */
const SUBJECTS_FOR_GRADE = (grade: number): string[] => {
  if (grade <= 2) return ['ENG', 'HIN', 'MAT']
  if (grade <= 5) return ['ENG', 'HIN', 'MAT', 'SCI']
  return ['ENG', 'HIN', 'MAT', 'SCI', 'SST'] // 6-10 (B sections mirror A)
}

const TUITION_BY_GRADE = (grade: number): number => {
  if (grade <= 5) return 12000
  if (grade <= 8) return 18000
  if (grade <= 10) return 25000
  return 30000
}

/** Last N weekdays ending "today" (inclusive of today's weekday). */
function lastWeekdays(count: number): Date[] {
  const out: Date[] = []
  const d = new Date()
  // PIH-4b integrity: midnight UTC (the canonical attendance day key),
  // never local midnight — time-of-day dates break the day-level unique.
  d.setUTCHours(0, 0, 0, 0)
  while (out.length < count) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) out.push(new Date(d))
    d.setDate(d.getDate() - 1)
  }
  return out.reverse()
}

const FEE_CYCLE = [
  'PAID', 'PAID', 'PAID', 'PARTIAL', 'PAID', 'PAID', 'UNPAID_PAST', 'PAID',
  'PAID', 'PARTIAL', 'PAID', 'UNPAID_FUTURE', 'PAID', 'PAID', 'UNPAID_PAST',
  'PAID', 'PARTIAL', 'PAID', 'PAID', 'PARTIAL',
] as const

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const school = await db.school.findUnique({ where: { slug: 'demo-school' } })
  if (!school) throw new Error('demo-school not found — run `bun run db:seed` first')

  console.log('🌱 seed-roster-150: canonical roster → ~150 connected students…')

  // ---- Runtime-resolved references ---------------------------------------
  const teachers = await db.user.findMany({
    where: { role: 'TEACHER', status: 'ACTIVE', schoolId: school.id },
    orderBy: { createdAt: 'asc' },
  })
  if (teachers.length < 3) throw new Error('Need ≥3 teachers — run base + teacher-academics seeds first')
  const rohan = teachers.find((t) => t.email === 'rohan.mehta@greenwood.edu.in') ?? teachers[0]
  const rotation = teachers.filter((t) => t.id !== rohan.id) // Rohan keeps ONLY 9-A (scope integrity)
  const principal = await db.user.findFirst({
    where: { role: 'PRINCIPAL', schoolId: school.id, email: 'principal@greenwood.edu.in' },
  })
  // PIH-4b: class-teacher display names for the canonical attendance
  // provenance (markedBy) — resolved once, used by Phase 4.
  const teacherNameById = new Map(teachers.map((t) => [t.id, t.name]))

  const subjects = await db.subject.findMany({ where: { schoolId: school.id } })
  const subjectByCode = new Map(subjects.map((s) => [s.code ?? '', s]))
  const routes = await db.route.findMany({ where: { schoolId: school.id }, orderBy: { name: 'asc' } })
  const pa1 = await db.exam.findFirst({ where: { name: 'Periodic Assessment 1' } })
  if (!pa1) throw new Error('Periodic Assessment 1 not found — run db:seed-teacher-academics first')
  const behaviorCats = await db.behaviorCategory.findMany({
    where: { schoolId: school.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  // ---- Phase 1: class catalog (12 new section rows → 21 total) -----------
  console.log('· Phase 1: classes')
  const classIdByName = new Map<string, string>()
  for (const c of await db.class.findMany({ where: { schoolId: school.id } })) {
    classIdByName.set(c.name, c.id)
  }
  let teacherCursor = 0
  for (const def of NEW_CLASS_DEFS) {
    const name = `Grade ${def.grade} - ${def.section}`
    if (classIdByName.has(name)) continue
    const cls = await db.class.create({
      data: {
        schoolId: school.id,
        name,
        gradeLevel: def.grade,
        section: def.section,
        capacity: def.capacity,
        room: def.room,
        classTeacherId: rotation[teacherCursor % rotation.length].id,
      },
    })
    classIdByName.set(name, cls.id)
    teacherCursor++
  }
  const targetSections: { name: string; grade: number; classId: string }[] = [
    ...NEW_CLASS_DEFS.map((d) => ({ name: `Grade ${d.grade} - ${d.section}`, grade: Number(d.grade), classId: '' })),
    ...EMPTY_EXISTING.map((name) => ({ name, grade: Number(name.match(/Grade (\d+)/)?.[1] ?? '6'), classId: '' })),
  ]
  for (const t of targetSections) {
    const id = classIdByName.get(t.name)
    if (!id) throw new Error(`Target class missing: ${t.name}`)
    t.classId = id
  }
  console.log(`  ${classIdByName.size} classes total (21 sections across 14 grade groups)`)

  // ---- Phase 2: ClassSubjectAssignments for the new classes --------------
  console.log('· Phase 2: subject assignments')
  const existingCSA = await db.classSubjectAssignment.findMany({
    where: { schoolId: school.id },
    select: { classId: true, subjectId: true },
  })
  const csaKeys = new Set(existingCSA.map((c) => `${c.classId}|${c.subjectId}`))
  const newCSA: { classId: string; subjectId: string; schoolId: string; isCore: boolean; isActive: boolean; examinable: boolean; displayOrder: number }[] = []
  for (const def of NEW_CLASS_DEFS) {
    const clsId = classIdByName.get(`Grade ${def.grade} - ${def.section}`)!
    SUBJECTS_FOR_GRADE(Number(def.grade)).forEach((code, i) => {
      const subj = subjectByCode.get(code)
      if (!subj) return
      const key = `${clsId}|${subj.id}`
      if (csaKeys.has(key)) return
      csaKeys.add(key)
      newCSA.push({ classId: clsId, subjectId: subj.id, schoolId: school.id, isCore: true, isActive: true, examinable: true, displayOrder: i })
    })
  }
  if (newCSA.length) await db.classSubjectAssignment.createMany({ data: newCSA })
  console.log(`  +${newCSA.length} assignments`)

  // ---- Phase 3: students + users + guardians (RESUMABLE) -----------------
  console.log('· Phase 3: students (target: 133 new → 152 total)')
  const usedEmails = new Set((await db.user.findMany({ select: { email: true } })).map((u) => u.email))
  const usedNames = new Set(
    (await db.student.findMany({ include: { user: { select: { name: true } } } }))
      .map((s) => s.user?.name)
      .filter(Boolean) as string[],
  )

  type RosterStudent = {
    id: string
    grade: number
    sectionClassId: string
    admissionNo: string
    classTeacherId: string
    num: number
  }
  const roster: RosterStudent[] = []

  let seq = 101
  for (const target of targetSections) {
    const cls = await db.class.findUnique({ where: { id: target.classId } })
    const classTeacherId = cls?.classTeacherId ?? rohan.id
    for (let i = 0; i < 7; i++) {
      const admissionNo = `GWS2026${seq}`
      const num = seq
      const rnd = sr(num * 7919) // per-student determinism

      const existing = await db.student.findFirst({
        where: { admissionNo },
        include: { user: { select: { name: true } } },
      })
      if (existing) {
        roster.push({ id: existing.id, grade: target.grade, sectionClassId: target.classId, admissionNo, classTeacherId, num })
        seq++
        continue
      }

      const gender: 'MALE' | 'FEMALE' = rnd() > 0.5 ? 'MALE' : 'FEMALE'
      const first = gender === 'MALE' ? pick(rnd, MALE_FIRST) : pick(rnd, FEMALE_FIRST)
      let last = pick(rnd, LAST)
      while (usedNames.has(`${first} ${last}`)) last = LAST[(LAST.indexOf(last) + 1) % LAST.length]
      const name = `${first} ${last}`
      usedNames.add(name)

      const fatherFirst = pick(rnd, FATHER_FIRST)
      const _motherFirst = pick(rnd, MOTHER_FIRST)
      const father = `${fatherFirst} ${last}`
      const mkUniqueEmail = (base: string, domain: string) => {
        let email = `${base}${num}@${domain}`.toLowerCase()
        while (usedEmails.has(email)) email = `${base}${num}_${Math.floor(rnd() * 900 + 100)}@${domain}`.toLowerCase()
        usedEmails.add(email)
        return email
      }
      const parentEmail = mkUniqueEmail(`${fatherFirst}.${last}`, 'gmail.com')
      const studentEmail = mkUniqueEmail(`${first}.${last}`, 'greenwood.edu.in')

      const parentUser =
        (await db.user.findUnique({ where: { email: parentEmail } })) ??
        (await db.user.create({
          data: {
            schoolId: school.id,
            email: parentEmail,
            passwordHash: hashPassword('password123'),
            name: `Mr. ${father}`,
            role: 'PARENT',
            phone: `+91 9${pickI(rnd, 100000000, 899999999)}`,
            status: 'ACTIVE',
          },
        }))
      const studentUser =
        (await db.user.findUnique({ where: { email: studentEmail } })) ??
        (await db.user.create({
          data: {
            schoolId: school.id,
            email: studentEmail,
            passwordHash: hashPassword('password123'),
            name,
            role: 'STUDENT',
            phone: null,
            status: 'ACTIVE',
          },
        }))

      const dobYear = 2026 - target.grade - pickI(rnd, 5, 6)
      const dob = `${dobYear}-${String(pickI(rnd, 1, 12)).padStart(2, '0')}-${String(pickI(rnd, 1, 28)).padStart(2, '0')}`
      const wantsTransport = rnd() < 0.62
      const student = await db.student.create({
        data: {
          schoolId: school.id,
          userId: studentUser.id,
          classId: target.classId,
          rollNo: String(i + 1).padStart(2, '0'),
          admissionNo,
          guardianId: parentUser.id,
          guardianName: `Mr. ${father}`,
          guardianPhone: parentUser.phone,
          dob,
          gender,
          bloodGroup: pick(rnd, BLOOD),
          address: `${pick(rnd, STREETS)}, Gurugram`,
          routeId: wantsTransport ? routes[num % routes.length]?.id ?? null : null,
        },
      })
      roster.push({ id: student.id, grade: target.grade, sectionClassId: target.classId, admissionNo, classTeacherId, num })
      seq++
    }
  }
  console.log(`  roster set = ${roster.length} students (created-or-existing)`)

  // ---- Phase 4: attendance (30 weekdays, canonical class+date+student) ---
  console.log('· Phase 4: attendance (30 weekdays, top-up only)')
  const dates = lastWeekdays(30)
  const attendedStudentIds = new Set(
    (await db.attendance.groupBy({ by: ['studentId'], where: { studentId: { in: roster.map((s) => s.id) } } })).map((g) => g.studentId),
  )
  const attendanceRows: { schoolId: string; studentId: string; classId: string; date: Date; status: string; markedBy: string }[] = []
  for (const s of roster) {
    if (attendedStudentIds.has(s.id)) continue
    const rnd = sr(s.num * 104729)
    const rate = 0.8 + rnd() * 0.18 // 80–98%
    for (const d of dates) {
      const roll = rnd()
      let status = 'PRESENT'
      if (roll > rate) {
        const t = rnd()
        status = t < 0.3 ? 'LATE' : t < 0.8 ? 'ABSENT' : 'LEAVE'
      }
      attendanceRows.push({
        schoolId: school.id, studentId: s.id, classId: s.sectionClassId, date: d, status,
        // PIH-4b: canonical provenance — the class teacher's DISPLAY NAME
        // (same convention as the baseline route), never a User id.
        markedBy: teacherNameById.get(s.classTeacherId) ?? s.classTeacherId,
      })
    }
  }
  if (attendanceRows.length) await db.attendance.createMany({ data: attendanceRows })
  console.log(`  +${attendanceRows.length} attendance rows`)

  // ---- Phase 5: PA1 exam → every class + marks (top-up only) ------------
  console.log('· Phase 5: PA1 exam classes/subjects/marks')
  const allClasses = await db.class.findMany({ where: { schoolId: school.id } })
  const csaByClass = new Map<string, string[]>()
  for (const csa of await db.classSubjectAssignment.findMany({
    where: { schoolId: school.id, isActive: true },
    orderBy: { displayOrder: 'asc' },
  })) {
    csaByClass.set(csa.classId, [...(csaByClass.get(csa.classId) ?? []), csa.subjectId])
  }
  const existingExamClasses = new Set(
    (await db.examClass.findMany({ where: { examId: pa1.id }, select: { classId: true } })).map((c) => c.classId),
  )
  const missingExamClasses = allClasses.filter((c) => !existingExamClasses.has(c.id)).map((c) => ({ examId: pa1.id, classId: c.id }))
  if (missingExamClasses.length) await db.examClass.createMany({ data: missingExamClasses })
  const existingEsc = new Set(
    (await db.examSubjectConfig.findMany({ where: { examId: pa1.id }, select: { classId: true, subjectId: true } })).map((e) => `${e.classId}|${e.subjectId}`),
  )
  const escRows: { examId: string; classId: string; subjectId: string; maxMarks: number; passMarks: number }[] = []
  for (const c of allClasses) {
    for (const subjId of csaByClass.get(c.id) ?? []) {
      if (existingEsc.has(`${c.id}|${subjId}`)) continue
      escRows.push({ examId: pa1.id, classId: c.id, subjectId: subjId, maxMarks: 50, passMarks: 17 })
    }
  }
  if (escRows.length) await db.examSubjectConfig.createMany({ data: escRows })

  // Marks top-up: EVERY student of a class with PA1 subject configs that
  // has no PA1 marks yet (existing QA marks stay untouched — skipped by
  // the per-student "has marks" check).
  for (const k of escRows.map((e) => `${e.classId}|${e.subjectId}`)) existingEsc.add(k)
  const allClassStudents = await db.student.findMany({
    where: { schoolId: school.id, classId: { in: [...existingEsc].map((k) => k.split('|')[0]) } },
    select: { id: true, classId: true, admissionNo: true },
  })
  const markedStudentIds = new Set(
    (await db.examMark.groupBy({ by: ['studentId'], where: { examId: pa1.id } })).map((g) => g.studentId),
  )
  const hashOfString = (str: string): number => {
    let h = 0
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
    return Math.abs(h) || 1
  }
  const markRows: {
    examId: string
    classId: string
    subjectId: string
    studentId: string
    marksObtained: number
    status: string
    workflowStatus: string
    enteredBy: string
    enteredAt: Date
    verifiedBy: string | null
    verifiedAt: Date | null
  }[] = []
  for (const s of allClassStudents) {
    if (markedStudentIds.has(s.id)) continue
    const rnd = sr(hashOfString(s.admissionNo ?? s.id))
    const bias = (rnd() - 0.5) * 0.2
    const classTeacher = (await db.class.findUnique({ where: { id: s.classId ?? '' }, select: { classTeacherId: true } }))?.classTeacherId ?? rohan.id
    for (const subjId of csaByClass.get(s.classId ?? '') ?? []) {
      const pct = Math.min(0.98, Math.max(0.42, 0.72 + bias + (rnd() - 0.5) * 0.18))
      const final = rnd() < 0.75 // most marks verified; some still submitted
      const enteredAt = new Date(Date.now() - pickI(rnd, 10, 40) * 86400000)
      markRows.push({
        examId: pa1.id,
        classId: s.classId ?? '',
        subjectId: subjId,
        studentId: s.id,
        marksObtained: Math.round(pct * 50),
        status: 'PRESENT',
        workflowStatus: final ? 'VERIFIED' : 'SUBMITTED',
        enteredBy: classTeacher,
        enteredAt,
        verifiedBy: final ? principal?.id ?? null : null,
        verifiedAt: final ? new Date(enteredAt.getTime() + 86400000) : null,
      })
    }
  }
  if (markRows.length) await db.examMark.createMany({ data: markRows })
  console.log(`  exam classes ${allClasses.length}, +${escRows.length} subject configs, +${markRows.length} marks`)

  // ---- Phase 6: fees + payments + ledger (top-up only) -------------------
  console.log('· Phase 6: fees / payments / FeeTransaction ledger')
  const feeStudentIds = new Set(
    (await db.fee.groupBy({ by: ['studentId'], where: { studentId: { in: roster.map((s) => s.id) } } })).map((g) => g.studentId),
  )
  // PIH-4b receipt scheme: canonical SCH-YYYY-NNNNNN, sequential per
  // school-year, continuing after the school's existing max (same
  // invariant mintReceiptNo enforces on live writes). The legacy
  // RCP-2026-NNNN scheme is retired for new seed receipts.
  const receiptPrefix = `SCH-${new Date().getFullYear()}-`
  let receiptSeq = 1
  for (const r of await db.feeTransaction.findMany({
    where: { schoolId: school.id, receiptNo: { startsWith: receiptPrefix } },
    select: { receiptNo: true },
  })) {
    const n = Number(r.receiptNo?.slice(receiptPrefix.length))
    if (Number.isFinite(n) && n >= receiptSeq) receiptSeq = n + 1
  }
  const nextReceiptNo = () => `${receiptPrefix}${String(receiptSeq++).padStart(6, '0')}`
  const methods = ['CASH', 'UPI', 'CARD', 'NET_BANKING'] as const
  let feesCreated = 0
  let ledgerCreated = 0
  for (const s of roster) {
    if (feeStudentIds.has(s.id)) continue
    const rnd = sr(s.num * 2038074743)
    const shape = FEE_CYCLE[s.num % FEE_CYCLE.length]
    const amount = TUITION_BY_GRADE(s.grade)
    // PARTIAL fees carry a FUTURE due date (the remainder is billed for
    // Term 2) so the canonical derivation classifies them PARTIAL, not
    // OVERDUE (outstanding + past due = overdue by definition).
    const duePast = shape === 'UNPAID_PAST'
    const dueDate = new Date(duePast ? '2026-08-15' : '2026-11-15')
    const paidFrac = shape === 'PAID' ? 1 : shape === 'PARTIAL' ? 0.4 + rnd() * 0.25 : 0
    const paid = Math.round(amount * paidFrac)

    const fee = await db.fee.create({
      data: {
        schoolId: school.id,
        studentId: s.id,
        title: 'Tuition Fee — Term 1',
        amount,
        paid,
        type: 'TUITION',
        dueDate,
        status: shape === 'PAID' ? 'PAID' : shape === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
        method: paid > 0 ? 'UPI' : null,
        paidDate: paid > 0 ? new Date(Date.now() - pickI(rnd, 5, 45) * 86400000) : null,
      },
    })
    feesCreated++

    if (paid > 0) {
      const method = pick(rnd, [...methods])
      const txnDate = fee.paidDate ?? new Date()
      await db.payment.create({
        data: {
          // Phase 3: Payment.schoolId is required — derived from the fee.
          schoolId: fee.schoolId,
          feeId: fee.id,
          amount: paid,
          method: method === 'NET_BANKING' ? 'Net Banking' : method === 'CARD' ? 'Card' : method,
          status: 'SUCCESS',
          transactionId: `R150-${s.admissionNo}`,
          createdAt: txnDate,
        },
      })
      await db.feeTransaction.create({
        data: {
          schoolId: school.id,
          studentId: s.id,
          className: `Grade ${s.grade}`,
          feeHeadName: 'Tuition Fee — Term 1',
          amount: paid,
          method,
          status: 'SUCCESS',
          source: 'PRINCIPAL',
          feeId: fee.id,
          collectedById: principal?.id ?? null,
          collectedByName: principal?.name ?? 'Principal',
          collectedAt: txnDate,
          verifiedById: principal?.id ?? null,
          verifiedByName: principal?.name ?? 'Principal',
          verifiedAt: txnDate,
          referenceNumber: `R150-${s.admissionNo}`,
          receiptNo: nextReceiptNo(),
        },
      })
      ledgerCreated++
    }
  }
  console.log(`  +${feesCreated} fees, +${ledgerCreated} ledger transactions`)

  // Class-Teacher collection workflow demo: 2 pending verifications in
  // Rohan's class (9-A) — the CT fee-collection → principal verify flow.
  const nineA = classIdByName.get('Grade 9 - A')
  if (nineA) {
    const existingCT = await db.feeTransaction.count({
      where: { schoolId: school.id, source: 'CLASS_TEACHER', status: 'UNDER_VERIFICATION', referenceNumber: { startsWith: 'R150-CT-' } },
    })
    if (existingCT === 0) {
      const nineAStudents = await db.student.findMany({ where: { classId: nineA }, take: 2 })
      for (const st of nineAStudents) {
        // PIH-4b parity: the pending CT collection is LINKED to the
        // student's oldest open fee (feeId + feeHeadName + amount ≤ its
        // outstanding), so verifying it through /api/fees/verification
        // credits Fee.paid for the FULL amount — an unlinked ₹5,000 row
        // verified to SUCCESS without a ledger credit is exactly the
        // module/dashboard divergence this pass removes.
        const openFee = await db.fee.findFirst({
          where: { studentId: st.id, status: { in: ['UNPAID', 'PARTIAL', 'PENDING'] } },
          orderBy: { createdAt: 'asc' },
        })
        if (!openFee || openFee.amount - openFee.paid <= 0) continue
        const ctAmount = Math.min(5000, openFee.amount - openFee.paid)
        await db.feeTransaction.create({
          data: {
            schoolId: school.id,
            studentId: st.id,
            className: 'Grade 9 - A',
            feeId: openFee.id,
            feeHeadName: openFee.title,
            amount: ctAmount,
            method: 'CASH',
            status: 'UNDER_VERIFICATION',
            source: 'CLASS_TEACHER',
            collectedById: rohan.id,
            collectedByName: rohan.name,
            collectedAt: new Date(Date.now() - 2 * 86400000),
            referenceNumber: `R150-CT-${st.admissionNo}`,
          },
        })
      }
      console.log('  +2 UNDER_VERIFICATION CT collections (9-A workflow demo, fee-linked)')
    }
  }

  // ---- Phase 7: behavior + growth (dedupeKey-gated) ----------------------
  console.log('· Phase 7: behavior records + growth events')
  if (behaviorCats.length) {
    const positives = behaviorCats.filter((c) => c.kind === 'positive')
    const concerns = behaviorCats.filter((c) => c.kind === 'concern')
    const neutrals = behaviorCats.filter((c) => c.kind === 'any')
    const existingGrowth = new Set(
      (await db.growthEvent.findMany({
        where: { schoolId: school.id, dedupeKey: { startsWith: 'r150:' } },
        select: { studentId: true },
      })).map((g) => g.studentId),
    )
    let behaviorCount = 0
    for (let i = 0; i < roster.length; i += 5) {
      const s = roster[i]
      if (existingGrowth.has(s.id)) continue
      const rnd = sr(s.num * 32452843)
      const roll = rnd()
      const type = roll < 0.5 ? 'positive' : roll < 0.8 ? 'observation' : 'concern'
      const cat =
        type === 'positive'
          ? pick(rnd, positives.length ? positives : behaviorCats)
          : type === 'concern'
            ? pick(rnd, concerns.length ? concerns : behaviorCats)
            : pick(rnd, neutrals.length ? neutrals : behaviorCats)
      const date = new Date(Date.now() - pickI(rnd, 3, 50) * 86400000)
      await db.behaviorRecord.create({
        data: {
          schoolId: school.id,
          studentId: s.id,
          recordedById: rohan.id,
          date,
          category: cat.key,
          type,
          description:
            type === 'positive'
              ? pick(rnd, [
                  'Helped organize the class science fair stall.',
                  'Outstanding participation in the inter-house quiz.',
                  'Volunteered for the library reading program.',
                  'Led the group project presentation confidently.',
                ])
              : type === 'concern'
                ? pick(rnd, [
                    'Repeatedly late to first period this week.',
                    'Incomplete homework in Mathematics.',
                    'Distracting classmates during lab session.',
                  ])
                : pick(rnd, [
                    'Quiet in class; encouraging peer interaction.',
                    'Improving steadily in written expression.',
                  ]),
          actionTaken: type === 'concern' ? 'Spoke with the student; parent meeting suggested.' : null,
          followUpRequired: type === 'concern' && rnd() < 0.5,
          followUpDate: type === 'concern' ? new Date(Date.now() + 7 * 86400000) : null,
          status: type === 'concern' ? (rnd() < 0.5 ? 'monitoring' : 'resolved') : 'resolved',
          parentNotified: type === 'concern' && rnd() < 0.6,
        },
      })
      await db.growthEvent.create({
        data: {
          schoolId: school.id,
          studentId: s.id,
          createdById: rohan.id,
          points: type === 'positive' ? pickI(rnd, 2, 5) : type === 'concern' ? -2 : 1,
          category: type === 'positive' ? 'PARTICIPATION' : type === 'concern' ? 'CONDUCT' : 'IMPROVEMENT',
          reason: cat.label,
          source: 'MANUAL',
          dedupeKey: `r150:${s.id}`,
          effectiveAt: date,
          status: 'ACTIVE',
        },
      }).catch(() => {/* dedupeKey conflict — already exists */})
      behaviorCount++
    }
    console.log(`  +${behaviorCount} behavior records + growth events`)
  }

  // ---- Validation summary -------------------------------------------------
  const [students, classes, attendance, marks, fees, txns, behavior, growth] = await Promise.all([
    db.student.count({ where: { schoolId: school.id } }),
    db.class.count({ where: { schoolId: school.id } }),
    db.attendance.count({ where: { schoolId: school.id } }),
    db.examMark.count(),
    db.fee.count({ where: { schoolId: school.id } }),
    db.feeTransaction.count({ where: { schoolId: school.id } }),
    db.behaviorRecord.count({ where: { schoolId: school.id } }),
    db.growthEvent.count({ where: { schoolId: school.id } }),
  ])
  const byClass = await db.student.groupBy({
    by: ['classId'],
    where: { schoolId: school.id },
    _count: { _all: true },
  })
  const classNames = new Map(allClasses.map((c) => [c.id, c.name]))
  console.log('\n✅ Roster ready:')
  console.log(`   students=${students} classes=${classes} attendance=${attendance} marks=${marks}`)
  console.log(`   fees=${fees} ledger=${txns} behavior=${behavior} growth=${growth}`)
  for (const g of [...byClass].sort((a, b) =>
    (classNames.get(a.classId ?? '') ?? '').localeCompare(classNames.get(b.classId ?? '') ?? ''),
  )) {
    console.log(`   · ${classNames.get(g.classId ?? '—')}: ${g._count._all}`)
  }
}

main()
  .catch((e) => {
    console.error('seed-roster-150 FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
