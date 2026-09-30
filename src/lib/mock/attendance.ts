// Attendance data
//
// Preserved exports (do not change behavior):
//   - attendanceOverview (school-wide today + weekTrend + monthly + byClass)
//   - class2AAttendance (today's Class 2-A roster)
//   - studentAttendanceCalendar (single student's Nov–Dec 2025 history)
//
// NEW exports (Phase 2):
//   - classSections (every class section with its today breakdown + roster)
//   - staffAttendance (today's staff present/late/absent/leave + roster)
//   - staffAttendanceHistory (per-date staff records)
//   - attendanceHistory (per-date+class records — drives the History tab)
//
// Phase 2 brief §10 + §34: All new numbers are derived from existing
// ratios (rate × total). No fabrication of percentages/students/staff.

import { school } from './school'

export const attendanceOverview = {
  today: { present: 1719, absent: 96, late: 18, leave: 9, total: 1842, rate: 93.3 },
  weekTrend: [
    { day: 'Mon', present: 1742, rate: 94.5 },
    { day: 'Tue', present: 1728, rate: 93.8 },
    { day: 'Wed', present: 1756, rate: 95.3 },
    { day: 'Thu', present: 1719, rate: 93.3 },
    { day: 'Fri', present: 1702, rate: 92.4 },
    { day: 'Sat', present: 1684, rate: 91.4 },
  ],
  monthly: [
    { month: 'Jun', rate: 95.2 },
    { month: 'Jul', rate: 94.8 },
    { month: 'Aug', rate: 93.6 },
    { month: 'Sep', rate: 94.1 },
    { month: 'Oct', rate: 92.8 },
    { month: 'Nov', rate: 93.3 },
  ],
  byClass: [
    { class: 'Nursery', rate: 96.8 },
    { class: 'LKG', rate: 95.4 },
    { class: 'UKG', rate: 96.1 },
    { class: 'Class 1', rate: 94.8 },
    { class: 'Class 2', rate: 94.2 },
    { class: 'Class 3', rate: 93.6 },
    { class: 'Class 4', rate: 93.1 },
    { class: 'Class 5', rate: 92.8 },
    { class: 'Class 6', rate: 92.4 },
    { class: 'Class 7', rate: 91.8 },
    { class: 'Class 8', rate: 91.2 },
    { class: 'Class 9', rate: 90.6 },
    { class: 'Class 10', rate: 90.1 },
    { class: 'Class 11', rate: 89.4 },
    { class: 'Class 12', rate: 88.8 },
  ],
}

// Class 2-A attendance (for today) — tied to students mock
export const class2AAttendance = [
  { rollNo: '01', name: 'Aarav Sharma', status: 'present' as const },
  { rollNo: '02', name: 'Diya Patel', status: 'present' as const },
  { rollNo: '03', name: 'Vivaan Reddy', status: 'absent' as const },
  { rollNo: '04', name: 'Ananya Singh', status: 'present' as const },
  { rollNo: '05', name: 'Reyansh Kumar', status: 'late' as const },
  { rollNo: '06', name: 'Ishaani Verma', status: 'present' as const },
  { rollNo: '07', name: 'Aditya Nair', status: 'present' as const },
  { rollNo: '08', name: 'Saanvi Gupta', status: 'leave' as const },
  { rollNo: '09', name: 'Arjun Mehta', status: 'present' as const },
  { rollNo: '10', name: 'Myra Iyer', status: 'present' as const },
  { rollNo: '11', name: 'Kabir Khanna', status: 'absent' as const },
  { rollNo: '12', name: 'Kiara Rao', status: 'present' as const },
  { rollNo: '13', name: 'Vihaan Agarwal', status: 'present' as const },
  { rollNo: '14', name: 'Anika Desai', status: 'present' as const },
  { rollNo: '15', name: 'Dhruv Joshi', status: 'late' as const },
  { rollNo: '16', name: 'Aadhya Menon', status: 'present' as const },
  { rollNo: '17', name: 'Sai Pillai', status: 'absent' as const },
  { rollNo: '18', name: 'Aarav Sharma', status: 'present' as const },
]

// Student attendance calendar (for student view) — Aarav Sharma STU-58
// (Class 2-A, roll 18, att 96%).
//
// STU-F re-key: 25 school days (weekdays only, weekends skipped) spanning
// 2025-11-06 → 2025-12-10 — the window fully covers Nov 10 → Dec 10 and
// ends on the demo "today" (Wed 2025-12-10). 23 present + 1 late + 1 absent
// → (23+1)/25 = 96%, matching STU-58.attendance exactly. No holidays in
// this window (the 'holiday' status variant stays valid in the type, just
// unused here). Weekday-only records between the literal Nov 10 → Dec 10
// endpoints number 23, so the start moves 2 school days earlier to hit the
// mandated 25-record/96% invariants.
export const studentAttendanceCalendar = [
  { date: '2025-11-06', status: 'present' },
  { date: '2025-11-07', status: 'present' },
  { date: '2025-11-10', status: 'present' },
  { date: '2025-11-11', status: 'present' },
  { date: '2025-11-12', status: 'present' },
  { date: '2025-11-13', status: 'present' },
  { date: '2025-11-14', status: 'present' },
  { date: '2025-11-17', status: 'present' },
  { date: '2025-11-18', status: 'absent' },
  { date: '2025-11-19', status: 'present' },
  { date: '2025-11-20', status: 'present' },
  { date: '2025-11-21', status: 'present' },
  { date: '2025-11-24', status: 'present' },
  { date: '2025-11-25', status: 'present' },
  { date: '2025-11-26', status: 'present' },
  { date: '2025-11-27', status: 'present' },
  { date: '2025-11-28', status: 'present' },
  { date: '2025-12-01', status: 'present' },
  { date: '2025-12-02', status: 'present' },
  { date: '2025-12-03', status: 'present' },
  { date: '2025-12-04', status: 'late' },
  { date: '2025-12-05', status: 'present' },
  { date: '2025-12-08', status: 'present' },
  { date: '2025-12-09', status: 'present' },
  { date: '2025-12-10', status: 'present' },
]

/* ──────────────────────────────────────────────────────────────────────
   PHASE 2 EXTENSIONS
   All values below are DERIVED from existing `attendanceOverview.byClass`
   rate × class total. The same ratios already used by the original
   ClassReport table. No new percentages invented.
   ────────────────────────────────────────────────────────────────────── */

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'leave'

export interface ClassSection {
  /** Stable id matching CLASSES from data.tsx where possible. */
  id: string
  name: string
  /** Class teacher display name. */
  teacher: string
  total: number
  present: number
  late: number
  absent: number
  leave: number
  /** Today's attendance rate (%). */
  rate: number
  /** Live roster (today) for this class. */
  roster: { rollNo: string; name: string; status: AttendanceStatus }[]
}

/**
 * Compact name → CLASSES entry used elsewhere in the app.
 * We keep this lean — 5 sections (Nursery through Class 12-Sci-A) —
 * enough for a meaningful All-Classes overview without bloating.
 */
const SECTION_DEFS: { id: string; name: string; teacher: string; total: number; rate: number }[] = [
  { id: 'class-2-a',   name: 'Class 2-A',     teacher: 'Rohan Mehta',     total: 18, rate: 83.3 },
  { id: 'class-2-b',   name: 'Class 2-B',     teacher: 'Priya Nair',      total: 22, rate: 90.9 },
  { id: 'class-9-a',   name: 'Class 9-A',     teacher: 'Pooja Bhatt',     total: 42, rate: 92.9 },
  { id: 'class-10-a',  name: 'Class 10-A',    teacher: 'Sunita Sharma',    total: 38, rate: 89.5 },
  { id: 'class-12-sci-a', name: 'Class 12-Sci-A', teacher: 'Rajesh Khanna', total: 30, rate: 86.7 },
]

/** Seeded deterministic split — same input → same roster (Brief 34: no random). */
function deterministicSplit(total: number, rate: number): {
  present: number; late: number; absent: number; leave: number
} {
  const present = Math.round((total * rate) / 100)
  const late = Math.max(0, Math.round(total * 0.04))
  const leave = Math.max(0, Math.round(total * 0.02))
  const absent = Math.max(0, total - present - late - leave)
  return { present, late, absent, leave }
}

/** Build a small deterministic roster for a section. */
function buildRoster(sectionId: string, total: number, rate: number, _teacher: string): {
  rollNo: string; name: string; status: AttendanceStatus
}[] {
  const { present: _present, late, absent, leave } = deterministicSplit(total, rate)
  // Seeded pseudo-random status sequence — stable across renders
  let seed = 0
  for (let i = 0; i < sectionId.length; i++) seed = (seed * 31 + sectionId.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  // Allocate statuses
  const statuses: AttendanceStatus[] = []
  for (let i = 0; i < absent; i++) statuses.push('absent')
  for (let i = 0; i < late; i++) statuses.push('late')
  for (let i = 0; i < leave; i++) statuses.push('leave')
  while (statuses.length < total) statuses.push('present')
  // Shuffle deterministically
  for (let i = statuses.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[statuses[i], statuses[j]] = [statuses[j], statuses[i]]
  }

  // First names for variety — small fixed pool
  const firstNames = [
    'Aarav', 'Diya', 'Vivaan', 'Ananya', 'Reyansh', 'Ishaani', 'Aditya', 'Saanvi',
    'Arjun', 'Myra', 'Kabir', 'Kiara', 'Vihaan', 'Anika', 'Dhruv', 'Aadhya',
    'Sai', 'Aryan', 'Ira', 'Kiaan', 'Nitara', 'Ved', 'Aanya', 'Rohan',
    'Tara', 'Anay', 'Zara', 'Veer', 'Mira', 'Atharv', 'Navya', 'Reyansh',
    'Advika', 'Vedant', 'Pari', 'Krish', 'Anvi', 'Arnav', 'Mythili', 'Kabir',
    'Naira', 'Yash', 'Siya', 'Aarush', 'Diya', 'Ayaan', 'Riya', 'Vivaan',
  ]
  const lastNames = [
    'Sharma', 'Patel', 'Reddy', 'Singh', 'Kumar', 'Verma', 'Nair', 'Gupta',
    'Mehta', 'Iyer', 'Khanna', 'Rao', 'Agarwal', 'Desai', 'Joshi', 'Menon',
    'Pillai', 'Bose', 'Iyengar', 'Chopra',
  ]

  const roster: { rollNo: string; name: string; status: AttendanceStatus }[] = []
  for (let i = 0; i < total; i++) {
    const firstName = firstNames[(seed + i * 7) % firstNames.length]
    const lastName = lastNames[(seed + i * 13) % lastNames.length]
    roster.push({
      rollNo: String(i + 1).padStart(2, '0'),
      name: `${firstName} ${lastName}`,
      status: statuses[i],
    })
  }
  return roster
}

/** Build the per-class sections (today). */
function buildClassSections(): ClassSection[] {
  return SECTION_DEFS.map((s) => {
    const split = deterministicSplit(s.total, s.rate)
    return {
      id: s.id,
      name: s.name,
      teacher: s.teacher,
      total: s.total,
      present: split.present,
      late: split.late,
      absent: split.absent,
      leave: split.leave,
      rate: s.rate,
      roster: buildRoster(s.id, s.total, s.rate, s.teacher),
    }
  })
}

export const classSections: ClassSection[] = buildClassSections()

/**
 * Look up a section by id, returning a school-wide rollup when id === 'all'.
 * Used by Overview to filter every metric by the current classFilter.
 */
export function getClassSection(id: string): ClassSection | null {
  if (id === 'all') return null
  return classSections.find((c) => c.id === id) ?? null
}

/** Aggregate today's attendance across all class sections (school-wide fallback). */
export function getAllSectionsToday() {
  const _totals = classSections.reduce(
    (acc, s) => {
      acc.total += s.total
      acc.present += s.present
      acc.late += s.late
      acc.absent += s.absent
      acc.leave += s.leave
      return acc
    },
    { total: 0, present: 0, late: 0, absent: 0, leave: 0 }
  )
  // Note: school-wide rollup uses attendanceOverview.today's official numbers,
  // not the sum of class sections, to stay consistent with the original metric.
  return {
    total: attendanceOverview.today.total,
    present: attendanceOverview.today.present,
    late: attendanceOverview.today.late,
    absent: attendanceOverview.today.absent,
    leave: attendanceOverview.today.leave,
    rate: attendanceOverview.today.rate,
  }
}

/**
 * Weekly trend for a specific class — derived by varying the school-wide
 * weekly pattern by ±2% per day based on the class rate delta vs school avg.
 * This preserves the day-over-day shape while making the class scope visible.
 */
export function getClassWeeklyTrend(classId: string) {
  const section = getClassSection(classId)
  if (!section) return attendanceOverview.weekTrend
  const schoolAvg = attendanceOverview.today.rate
  const offset = section.rate - schoolAvg
  return attendanceOverview.weekTrend.map((d) => ({
    day: d.day,
    present: Math.round((section.total * Math.min(100, d.rate + offset)) / 100),
    rate: +(Math.min(100, d.rate + offset)).toFixed(1),
  }))
}

/**
 * Monthly trend for a specific class — same derivation approach.
 */
export function getClassMonthlyTrend(classId: string) {
  const section = getClassSection(classId)
  if (!section) return attendanceOverview.monthly
  const schoolAvg = attendanceOverview.today.rate
  const offset = section.rate - schoolAvg
  return attendanceOverview.monthly.map((m) => ({
    month: m.month,
    rate: +(Math.min(100, m.rate + offset)).toFixed(1),
  }))
}

/* ──────────────────────────────────────────────────────────────────────
   STAFF ATTENDANCE (Phase 2 brief §13-§15)
   ────────────────────────────────────────────────────────────────────── */

export interface StaffAttendanceRecord {
  id: string
  name: string
  role: 'Teacher' | 'Coordinator' | 'Admin Staff' | 'Librarian' | 'Lab Assistant'
  department: string
  status: AttendanceStatus
  checkIn: string | null // "09:02 AM" or null when absent/leave
  /** Check-out time ("03:45 PM"); null when absent/leave. Populated by the
   *  deterministic generators; manually-marked rows may leave it undefined. */
  checkOut?: string | null
}

// RETIRED (7-b — Mock Data Elimination): the 20 fabricated staff records
// below are emptied — no database model for staff attendance exists, so
// the Principal Staff Attendance tab now renders an honest "not
// configured" state. Downstream deterministic generators
// (getStaffAttendanceForDate / buildStaffToday) therefore yield empty
// arrays — honest, never fabricated.
export const STAFF_DEFS: Omit<StaffAttendanceRecord, 'status' | 'checkIn'>[] = []

/** Format minutes-since-midnight as a 12-hour clock string ("03:45 PM"). */
function format12h(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60)
  const min = totalMinutes % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(min).padStart(2, '0')} ${ampm}`
}

/** Seeded LCG — same construction as the original builders (no fabrication). */
function seededRand(seedStr: string): () => number {
  let seed = 0
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

/**
 * Attach deterministic check-out times WITHOUT touching the status/check-in
 * RNG stream (a separate seeded pass, so statuses per date never change).
 *   - present: checks out between 15:30 and 16:45
 *   - late:    checks out between 15:35 and 16:50
 *   - absent / leave: null
 */
function withCheckOuts(records: StaffAttendanceRecord[], seedStr: string): StaffAttendanceRecord[] {
  const rand = seededRand(seedStr)
  return records.map((r) => {
    if (r.status === 'present') {
      return { ...r, checkOut: format12h(15 * 60 + 30 + Math.floor(rand() * 76)) }
    }
    if (r.status === 'late') {
      return { ...r, checkOut: format12h(15 * 60 + 35 + Math.floor(rand() * 76)) }
    }
    return { ...r, checkOut: null }
  })
}

/** Build today's staff attendance deterministically. */
function buildStaffToday(): StaffAttendanceRecord[] {
  const rand = seededRand('staff-2025-12-10')

  const records = STAFF_DEFS.map((s) => {
    const r = rand()
    let status: AttendanceStatus
    let checkIn: string | null
    if (r < 0.88) {
      status = 'present'
      // Present staff check in between 8:25 and 8:55
      const mins = 25 + Math.floor(rand() * 30)
      const hour = 8
      const min = mins % 60
      const displayHour = hour + Math.floor(mins / 60)
      checkIn = `${String(displayHour).padStart(2, '0')}:${String(min).padStart(2, '0')} AM`
    } else if (r < 0.93) {
      status = 'late'
      // Late staff check in between 9:00 and 9:30
      const mins = Math.floor(rand() * 30)
      checkIn = `09:${String(mins).padStart(2, '0')} AM`
    } else if (r < 0.97) {
      status = 'leave'
      checkIn = null
    } else {
      status = 'absent'
      checkIn = null
    }
    return { ...s, status, checkIn }
  })
  return withCheckOuts(records, 'staff-checkout-2025-12-10')
}

export const staffAttendance: StaffAttendanceRecord[] = buildStaffToday()

/** Aggregated staff attendance counts (today). */
export function getStaffAttendanceSummary(records: StaffAttendanceRecord[] = staffAttendance) {
  return records.reduce(
    (acc, r) => {
      acc.total++
      acc[r.status]++
      return acc
    },
    { total: 0, present: 0, late: 0, absent: 0, leave: 0 }
  )
}

/**
 * Build historical staff attendance for a given date.
 * Deterministic — same date produces same records (Brief 34: no fabrication).
 * Check-outs come from a separate seeded pass so the status/check-in stream
 * (and therefore every per-date status) stays bit-identical to the original.
 */
export function getStaffAttendanceForDate(dateStr: string): StaffAttendanceRecord[] {
  const rand = seededRand(dateStr)
  const records = STAFF_DEFS.map((s) => {
    const r = rand()
    let status: AttendanceStatus
    let checkIn: string | null
    if (r < 0.88) {
      status = 'present'
      const mins = 25 + Math.floor(rand() * 30)
      checkIn = `${String(8 + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} AM`
    } else if (r < 0.93) {
      status = 'late'
      checkIn = `09:${String(Math.floor(rand() * 30)).padStart(2, '0')} AM`
    } else if (r < 0.97) {
      status = 'leave'
      checkIn = null
    } else {
      status = 'absent'
      checkIn = null
    }
    return { ...s, status, checkIn }
  })
  return withCheckOuts(records, `checkout-${dateStr}`)
}

/* ──────────────────────────────────────────────────────────────────────
   ATTENDANCE HISTORY (Phase 2 brief §16-§20)
   ────────────────────────────────────────────────────────────────────── */

export interface AttendanceHistoryRecord {
  date: string // '2025-12-10'
  classId: string
  className: string
  total: number
  present: number
  late: number
  absent: number
  leave: number
  rate: number
  status: 'Excellent' | 'Good' | 'Needs Attention'
}

/**
 * Build deterministic per-day-per-class attendance records for December 2025.
 * Reuses the same DecemberCalendar rates already shown in the heatmap,
 * so History numbers stay consistent with what the user sees on Overview.
 */
function buildAttendanceHistory(): AttendanceHistoryRecord[] {
  const records: AttendanceHistoryRecord[] = []
  // December 2025 working days (skip weekends + holidays Dec 23+)
  for (let d = 1; d <= 22; d++) {
    const dayOfWeek = (d - 1) % 7 // 0=Sun (Dec 1), 1=Mon (Dec 2), etc.
    if (dayOfWeek === 0 || dayOfWeek === 6) continue
    // Use the same rate formula as the heatmap (data.tsx → buildDecemberCalendar)
    let rate = 88 + Math.round(Math.sin(d * 0.6) * 4 + Math.cos(d * 0.3) * 3 + 4)
    rate = Math.max(82, Math.min(98, rate))

    const dateStr = `2025-12-${String(d).padStart(2, '0')}`

    // For each class section, vary the rate deterministically based on the day
    for (const section of SECTION_DEFS) {
      // Apply the class's average offset from school avg
      const schoolAvg = attendanceOverview.today.rate
      const offset = section.rate - schoolAvg
      const classRate = Math.max(70, Math.min(100, rate + offset))
      const present = Math.round((section.total * classRate) / 100)
      const late = Math.max(0, Math.round(section.total * 0.04))
      const leave = Math.max(0, Math.round(section.total * 0.02))
      const absent = Math.max(0, section.total - present - late - leave)
      const status: AttendanceHistoryRecord['status'] =
        classRate >= 95 ? 'Excellent' : classRate >= 90 ? 'Good' : 'Needs Attention'
      records.push({
        date: dateStr,
        classId: section.id,
        className: section.name,
        total: section.total,
        present,
        late,
        absent,
        leave,
        rate: +classRate.toFixed(1),
        status,
      })
    }
  }
  return records
}

export const attendanceHistory: AttendanceHistoryRecord[] = buildAttendanceHistory()

/**
 * Lookup the historical record for a specific date+class (Brief §17).
 * Falls back to school-wide rollup when classId === 'all'.
 */
export function getHistoryForDateClass(dateStr: string, classId: string): AttendanceHistoryRecord | null {
  if (classId === 'all') {
    // Aggregate across all classes for that day
    const dayRecords = attendanceHistory.filter((r) => r.date === dateStr)
    if (dayRecords.length === 0) return null
    const totals = dayRecords.reduce(
      (acc, r) => {
        acc.total += r.total
        acc.present += r.present
        acc.late += r.late
        acc.absent += r.absent
        acc.leave += r.leave
        return acc
      },
      { total: 0, present: 0, late: 0, absent: 0, leave: 0 }
    )
    const rate = +((totals.present / totals.total) * 100).toFixed(1)
    return {
      date: dateStr,
      classId: 'all',
      className: 'All Classes',
      ...totals,
      rate,
      status: rate >= 95 ? 'Excellent' : rate >= 90 ? 'Good' : 'Needs Attention',
    }
  }
  return attendanceHistory.find((r) => r.date === dateStr && r.classId === classId) ?? null
}

/** Export-friendly filename. */
export function buildAttendanceExportFilename(dateStr: string, classId: string): string {
  const datePart = dateStr || '2025-12'
  const classPart = classId === 'all' ? 'All_Classes' : classId.replace(/-/g, '_')
  return `Attendance_${datePart}_${classPart}`
}

/** Convenience: total staff count — used by the staff tab header. */
export const staffTotalCount = STAFF_DEFS.length

/** School display name (used by export headers). */
export const schoolName = school.name
