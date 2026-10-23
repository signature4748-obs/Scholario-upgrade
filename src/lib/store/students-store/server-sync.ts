'use client'

/**
 * students-store/server-sync — hydrates the students store from the
 * canonical database (Seed → DB → API → UI; production data reduction
 * 2026-10).
 *
 * ONE universe of student ids: after a successful sync every store
 * consumer (principal Students & Classes / Directory / Exams / Fees /
 * Certificates / Transport / Messaging, the student panel) renders the
 * SAME canonical Student rows the teacher APIs and the canonical
 * Student Profile serve. The old mock STU-xxx universe is replaced
 * wholesale — no parallel rosters.
 *
 * Data source: GET /api/students/roster (role-scoped: principal /
 * management receive the full school roster; a student receives their
 * own full record + public-only classmates).
 *
 * Honest mapping rules:
 *   · attendance % — canonical Attendance derivation (null → 0 shown
 *     as "No records" contexts);
 *   · academics — latest exam WITH entered marks (none ⇒ empty subject
 *     list, 0% — never fabricated);
 *   · feeStatus / feePaid / feeTotal — canonical Fee + FeeTransaction
 *     standing (OVERDUE maps to the store's 'Pending' + outstanding);
 *   · documents — no DB model ⇒ empty (profile shows honest empty
 *     states instead of fabricated Aadhaar rows);
 *   · disciplinePoints — canonical GrowthEvent ledger sum;
 *   · houses/positions — store-local config; positions referencing
 *     students that no longer exist are pruned (no invisible authority).
 */

import type { ClassRecord, StudentRecord, StudentStatus, Gender, FeeStatus } from './types'
import type { SubjectDef } from '@/lib/mock/academic'
import { streamKeyFromDbValue } from '@/lib/mock/academic'
import { useStudentsStore } from './store'
import { useAuth as useAuthStore } from '@/lib/store/auth-store'
import { readIsDemoTenant } from '@/lib/store/demo-tenant'

// ── payload types (mirror /api/students/roster) ─────────────────────

interface RosterStudentDto {
  id: string
  userId: string
  name: string
  email: string
  /** User.status — ACTIVE or INACTIVE (archived). */
  status: string
  rollNo: string | null
  admissionNo: string | null
  classId: string | null
  guardianName: string | null
  guardianPhone: string | null
  guardianEmail: string | null
  dob: string | null
  gender: string | null
  bloodGroup: string | null
  address: string | null
  routeName: string | null
  createdAt: string
  attendance: {
    pct: number | null
    records: number
    present: number
    absent: number
    late: number
    leave: number
    monthly: { month: string; pct: number }[]
  }
  latestExam: {
    examId: string
    examName: string
    subjects: { subjectId: string; subjectName: string; marks: number; maxMarks: number; pct: number }[]
    averagePct: number
  } | null
  fees: {
    totalBilled: number
    totalPaid: number
    outstanding: number
    status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'NONE'
    awaitingVerification: number
  }
  growthPoints: number
  behaviorCount: number
}

interface RosterClassDto {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
  stream: string | null
  capacity: number
  room: string | null
  classTeacherId: string | null
  studentCount: number
  subjectIds: string[]
  subjectTeachers: Record<string, string>
}

interface RosterPayload {
  classes: RosterClassDto[]
  subjects: { id: string; name: string; code: string | null }[]
  teachers: { id: string; name: string }[]
  students: RosterStudentDto[]
}

// ── mapping helpers ──────────────────────────────────────────────────

/** Numeric grade from the STORED gradeLevel when it is a valid positive
 *  number — the authoritative value (never overridden by the name). */
const gradeFromStored = (g: string | null): number | null => {
  const n = Number(g)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** EXPLICIT academic-name patterns (final behaviour refinement, PR #57):
 *  a name declares its number an ACADEMIC GRADE only through a format the
 *  repository's own write paths produce or its conventions spell —
 *    · keyword-anchored — "Class 6" (wizard presets), "Grade 9 - A"
 *      (timetable-publish auto-create), "Std 8"/"Standard 8" (common
 *      operator spellings); the keyword must be a WHOLE WORD ("Classroom 5"
 *      is not "Class 5");
 *    · section-first — "6-A" (the demo corpus's numeric row shape
 *      "1-A".."12-A"), a 1–2-digit grade + dash family + section marker;
 *    · pure number — "6" (a bare grade token; the WHOLE name is the
 *      number, so years like "2026" can never parse).
 *  Incidental numbers are NEVER grades: years ("Batch 2026", "2026"),
 *  rooms ("Room 12") and custom group numbers ("Group 3") keep their own
 *  NAMED group (rule 3) instead of landing in G2026/G12/G3 where they
 *  would swallow or merge with a real academic grade. Deliberately NO
 *  hard 1–12 parse cap: a non-matching name falls to its own named
 *  group, so no unrelated name can ever collide into another's group. */
const ACADEMIC_KEYWORD_RE = /\b(?:class|grade|std|standard)\b[\s._#:–-]*(\d+)/i
const SECTION_FIRST_RE = /^(\d{1,2})\s*[–-]\s*\S+/
const PURE_NUMBER_RE = /^(\d{1,2})$/

/** Numeric grade from the class NAME ("Class 6" → 6, "6-A" → 6,
 *  "Grade 9 - A" → 9) — pattern-anchored, never an arbitrary first
 *  number (see ACADEMIC_* above). */
const gradeFromClassName = (name: string): number | null => {
  const n = name.trim()
  const m = n.match(ACADEMIC_KEYWORD_RE) ?? n.match(SECTION_FIRST_RE) ?? n.match(PURE_NUMBER_RE)
  if (!m) return null
  const g = parseInt(m[1], 10)
  return Number.isFinite(g) && g >= 1 ? g : null
}

/** Pre-primary names — the teacher allocation picker's regex
 *  (use-academic-allocation.ts groupLabelOf) extended with `ikg`, the
 *  demo corpus's legacy pre-primary name (the picker's own regex misses
 *  it — \bkg\b does not match inside "IKG" — but the seed corpus and the
 *  store ladder both treat IKG as pre-primary). */
const PRE_PRIMARY_NAME_RE = /nursery|lkg|ukg|ikg|\bkg\b|pre[- ]?primary|pre[- ]?nursery/i

/** Resolved grade-group for one roster row (Phase 2 D1 fix).
 *
 *  The old gradeFor/groupKeyOf/groupLabelOf collapsed EVERY row whose
 *  gradeLevel was null/''/non-numeric into one synthetic "Grade 0"
 *  group — swallowing all wizard-created classes (gradeLevel NULL by
 *  schema design; see /api/platform/schools academic bootstrap) as
 *  "sections". Canonical policy (audit/phase2-…/CLASS-GROUPING-POLICY.md):
 *    1. a valid stored gradeLevel is authoritative → G{grade}, label
 *       "Grade N" (existing behavior for correctly-populated tenants
 *       preserved exactly);
 *    2. missing/empty/non-numeric gradeLevel → grade derived from the
 *       class NAME via EXPLICIT academic patterns only (keyword-anchored
 *       "Class 6"/"Grade 9 - A"/"Std 8", section-first "6-A", pure
 *       number "6" — see gradeFromClassName), group labeled with the
 *       REAL name (never "Grade 0"); recognized pre-primary names are
 *       checked BEFORE the number parse (final-review follow-up
 *       2026-10-23: "Nursery 2" is a pre-primary stage, not grade 2 —
 *       picker ordering parity — so it can never land in G2 and merge
 *       with the real "Class 2");
 *    3. everything else — numberless names (Nursery/LKG/UKG/IKG) AND
 *       names whose numbers are incidental (years "Batch 2026", rooms
 *       "Room 12", custom groups "Group 3", …) → their own NAMED group
 *       per name — never numeric 0, never merged with anything else. */
interface ResolvedGroup {
  /** Stable group id (ClassRecord.id / StudentRecord.classId). */
  key: string
  /** Display label (ClassRecord.name / StudentRecord.className). */
  label: string
  /** Numeric grade for ordering/buckets (0 for named groups). */
  grade: number
}

const resolveGroupOf = (c: RosterClassDto): ResolvedGroup => {
  const suffix = c.stream === 'Science' ? '-SCI' : c.stream === 'Commerce' ? '-COM' : ''
  const labelSuffix = c.stream === 'Science' ? ' (Science)' : c.stream === 'Commerce' ? ' (Commerce)' : ''
  const stored = gradeFromStored(c.gradeLevel)
  if (stored != null) {
    return { key: `G${stored}${suffix}`, label: `Grade ${stored}${labelSuffix}`, grade: stored }
  }
  // Pre-primary FIRST (final-review follow-up 2026-10-23): a recognized
  // pre-primary name is pre-primary even when it carries a number
  // ("Nursery 2", "LKG 2", "KG 2", "Pre-Primary 1") — the same
  // regex-before-number ordering the allocation picker's groupLabelOf
  // uses. Without this, "Nursery 2" parsed as grade 2 and MERGED with
  // the real "Class 2" — unrelated classes in one group, the exact
  // invariant this fix forbids. A valid stored grade (rule 1 above)
  // still wins and is never overridden by the name.
  if (PRE_PRIMARY_NAME_RE.test(c.name)) {
    return { key: `N:${c.name.trim().toLowerCase()}${suffix}`, label: `${c.name.trim()}${labelSuffix}`, grade: 0 }
  }
  const fromName = gradeFromClassName(c.name)
  if (fromName != null) {
    return { key: `G${fromName}${suffix}`, label: `${c.name.trim()}${labelSuffix}`, grade: fromName }
  }
  return { key: `N:${c.name.trim().toLowerCase()}${suffix}`, label: `${c.name.trim()}${labelSuffix}`, grade: 0 }
}

const levelFor = (grade: number): ClassRecord['level'] => {
  if (grade <= 2) return 'Primary'
  if (grade <= 5) return 'Primary'
  if (grade <= 8) return 'Middle'
  if (grade <= 10) return 'Secondary'
  return 'Senior Secondary'
}

const gradeForPct = (p: number) => (p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B+' : p >= 60 ? 'B' : p >= 50 ? 'C' : 'D')

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '?'
}

const monthLabel = (key: string): string => {
  const [_y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[Number(m) - 1] ?? key
}

/** Group key for one grade-group (grade + stream) — stable synthetic id.
 *  (Kept as the thin alias the rest of this module already calls.) */
const groupKeyOf = (c: RosterClassDto): string => resolveGroupOf(c).key

/** Map the roster payload onto store shapes. */
export function mapRosterToRecords(payload: RosterPayload): {
  students: StudentRecord[]
  classes: ClassRecord[]
  subjects: SubjectDef[]
  teachers: { id: string; name: string }[]
} {
  // Classes: group section-level rows into grade-group ClassRecords.
  const groups = new Map<
    string,
    { label: string; grade: number; level: ClassRecord['level']; sections: RosterClassDto[] }
  >()
  for (const c of payload.classes) {
    const grp = resolveGroupOf(c)
    if (!groups.has(grp.key)) {
      groups.set(grp.key, {
        label: grp.label,
        grade: grp.grade,
        level:
          grp.grade > 0
            ? levelFor(grp.grade)
            : // Named group: recognized pre-primary names get the store's
              // own 'Pre-Primary' bucket (same ladder as store createClass
              // and the allocation picker); arbitrary numberless names fall
              // to the established unknown-grade bucket (documented).
              PRE_PRIMARY_NAME_RE.test(c.name)
              ? 'Pre-Primary'
              : levelFor(0),
        sections: [],
      })
    }
    groups.get(grp.key)!.sections.push(c)
  }

  const classById = new Map(payload.classes.map((c) => [c.id, c]))

  const classes: ClassRecord[] = [...groups.entries()].map(([key, g]) => {
    // union of subject ids across member sections (order preserved)
    const subjectIds: string[] = []
    for (const sec of g.sections) {
      for (const sid of sec.subjectIds) if (!subjectIds.includes(sid)) subjectIds.push(sid)
    }
    const subjectTeachers: Record<string, string> = {}
    for (const sec of g.sections) Object.assign(subjectTeachers, sec.subjectTeachers)
    return {
      id: key,
      name: g.label,
      grade: g.grade,
      level: g.level,
      sections: g.sections.map((sec) => ({
        id: sec.id, // canonical DB Class id (section-level)
        name: sec.section ?? 'A',
        classId: key,
        capacity: sec.capacity,
        classTeacherId: sec.classTeacherId ?? undefined,
        room: sec.room ?? '',
      })),
      capacity: Math.max(...g.sections.map((s) => s.capacity), 0),
      classTeacherId: g.sections[0]?.classTeacherId ?? '',
      subjectIds,
      subjects: subjectIds.map((id) => payload.subjects.find((s) => s.id === id)?.name).filter(Boolean) as string[],
      archivedSubjects: [],
      subjectTeachers,
      stream: streamKeyFromDbValue(g.sections[0]?.stream),
      room: g.sections[0]?.room ?? '',
      status: 'Active' as const,
    }
  })

  const groupOfClass = new Map(payload.classes.map((c) => [c.id, groupKeyOf(c)]))

  const students: StudentRecord[] = payload.students.map((s) => {
    const sectionClass = s.classId ? classById.get(s.classId) : undefined
    const groupKey = s.classId ? groupOfClass.get(s.classId) : undefined
    const group = groupKey ? groups.get(groupKey) : undefined

    const feeStatus: FeeStatus =
      s.fees.status === 'PAID' ? 'Paid' : s.fees.status === 'PARTIAL' ? 'Partial' : 'Pending'
    const subjects = (s.latestExam?.subjects ?? []).map((x) => ({
      name: x.subjectName,
      grade: gradeForPct(x.pct),
      percent: x.pct,
      teacher: '',
    }))

    return {
      id: s.id, // canonical DB Student id — ONE student universe
      admissionNo: s.admissionNo ?? '',
      rollNo: s.rollNo ?? '',
      name: s.name,
      avatar: initials(s.name),
      // case-insensitive: the canonical DB enum is 'MALE'/'FEMALE' but
      // legacy rows carry lowercase variants.
      gender: (`${s.gender ?? ''}`.toUpperCase() === 'MALE' ? 'Male' : 'Female') as Gender,
      classId: groupKey ?? '',
      className: group?.label ?? sectionClass?.name ?? '',
      section: sectionClass?.section ?? 'A',
      dob: s.dob ?? '',
      bloodGroup: s.bloodGroup ?? '—',
      category: '—',
      fatherName: s.guardianName ?? '',
      motherName: '',
      guardianName: s.guardianName ?? '',
      guardianPhone: s.guardianPhone ?? '',
      guardianEmail: s.guardianEmail ?? '',
      // HONESTY: the DB carries a single address string — no city/state
      // columns. Fabricated 'Gurugram'/'Haryana' rendered on every
      // student's Parents tab; empty + renderer '—' is the honest state.
      city: '',
      state: '',
      hostel: false,
      disciplinePoints: s.growthPoints,
      address: s.address ?? '',
      admissionDate: s.createdAt.slice(0, 10),
      previousSchool: '—',
      // REAL lifecycle status from the canonical User row (the PATCH
      // /api/students/[id] archive/restore mutations) — never a constant.
      status: (s.status === 'INACTIVE' ? 'Archived' : 'Active') as StudentStatus,
      attendance: s.attendance.pct ?? 0,
      feeStatus,
      feePaid: s.fees.totalPaid,
      feeTotal: s.fees.totalBilled,
      transport: !!s.routeName,
      scholarship: 0,
      medical: 'Not recorded',
      academics: {
        overallGrade: s.latestExam ? gradeForPct(s.latestExam.averagePct) : '—',
        overallPercent: s.latestExam?.averagePct ?? 0,
        rankInClass: 0, // recomputed below per section
        subjects,
      },
      attendanceTrend: s.attendance.monthly.map((m) => ({ month: monthLabel(m.month), percent: m.pct })),
      achievements: [],
      disciplineRecords: [],
      documents: [],
      transportRoute: s.routeName ?? undefined,
      timeline: [
        {
          id: `tl-${s.id}-adm`,
          type: 'admission' as const,
          title: 'Admission Confirmed',
          description: `Enrolled in ${group?.label ?? 'school'}${sectionClass?.section ? ` — Sec ${sectionClass.section}` : ''}`,
          date: s.createdAt.slice(0, 10),
          by: 'School Office',
        },
      ],
      email: s.email || undefined,
      userId: s.userId,
    }
  })

  // Recompute rankInClass per (class · section) from real academics.
  const rankGroups = new Map<string, StudentRecord[]>()
  for (const s of students) {
    const k = `${s.classId}|${s.section}`
    rankGroups.set(k, [...(rankGroups.get(k) ?? []), s])
  }
  const rankById = new Map<string, number>()
  for (const list of rankGroups.values()) {
    ;[...list]
      .filter((s) => s.academics.overallPercent > 0)
      .sort((a, b) => b.academics.overallPercent - a.academics.overallPercent)
      .forEach((s, i) => rankById.set(s.id, i + 1))
  }
  for (const s of students) {
    if (s.academics.overallPercent > 0) s.academics.rankInClass = rankById.get(s.id) ?? 0
  }

  const subjects: SubjectDef[] = payload.subjects.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code ?? s.name.slice(0, 3).toUpperCase(),
    category: 'Core' as const,
    status: 'Active' as const,
  }))

  return { students, classes, subjects, teachers: payload.teachers }
}

// ── sync ─────────────────────────────────────────────────────────────

let syncPromise: Promise<boolean> | null = null

/**
 * Fetch the canonical roster and replace the store's students / classes /
 * subject registry. Runs at most once per browser session (module-level
 * promise, guard reset on failure so a later mount can retry); failures
 * keep the existing store content ONLY for the demo tenant (stale demo
 * roster until a successful sync) — a real production tenant never keeps
 * the fabricated seed universe as a fallback: it is purged so every
 * consumer renders its honest empty state (EG-9F/R8).
 */
export function syncStudentsFromServer(): Promise<boolean> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    try {
      const res = await fetch('/api/students/roster', { cache: 'no-store' })
      if (!res.ok) throw new Error(`roster sync HTTP ${res.status}`)
      const envelope = (await res.json()) as { ok?: boolean; data?: RosterPayload } | RosterPayload
      // The API wraps responses as { ok, data } — unwrap before mapping.
      const payload = ('data' in envelope && envelope.data ? envelope.data : envelope) as RosterPayload
      if (!payload || !Array.isArray(payload.students) || !Array.isArray(payload.classes)) {
        throw new Error('roster sync: malformed payload')
      }
      const { students, classes, subjects, teachers } = mapRosterToRecords(payload)
      useStudentsStore.setState((state) => {
        // Prune student positions referencing students that no longer
        // exist in the canonical universe (history slices are kept —
        // only LIVE positions of missing students end).
        const ids = new Set(students.map((s) => s.id))
        const studentPositions = state.studentPositions.map((p) =>
          p.active && !ids.has(p.studentId) ? { ...p, active: false, endedOn: new Date().toISOString(), endedByName: 'Canonical roster sync' } : p,
        )
        // STUDENT-CONTACTS — the school's active teachers (USER-id space)
        // ride along with the roster sync: student sessions cannot call
        // /api/teachers (role-scoped), so this is the only sanctioned
        // teacher-directory source for student-side contact resolution.
        return { students, classes, academicSubjects: subjects, studentPositions, rosterTeachers: teachers, rosterSyncedAt: new Date().toISOString() }
      })
      // Prune fee-store seed transactions referencing retired mock
      // students (STU-xxx) so the principal fee ledger only shows
      // canonical-roster entries. In-session payments recorded against
      // DB student ids are preserved.
      try {
        const { useFeeStore } = await import('@/lib/store/fee-store')
        const ids = new Set(students.map((s) => s.id))
        useFeeStore.setState((state) => ({
          transactions: state.transactions.filter((t) => !t.studentId || ids.has(t.studentId)),
        }))
      } catch {
        // fee-store not loaded in this bundle chunk — nothing to prune
      }
      return true
    } catch (e) {
      console.warn('[students-store] roster sync failed:', e)
      // FINAL-GATE (EG-9F/R8) — demo tenants may keep the visible stale
      // roster (stale-while-revalidate is fine for the demo tier).
      if (readIsDemoTenant()) return false
      // Real production tenant: NEVER keep the fabricated seed universe
      // as a failure fallback. Purge it so the honest empty states render
      // (canonical roster data that was already synced/persisted stays —
      // only the STU-xxx seed universe is evicted), and clear the
      // once-per-session guard so a later mount can retry the sync.
      purgeSeedRosterForRealTenant()
      syncPromise = null
      return false
    }
  })()
  return syncPromise
}

/**
 * FINAL-GATE (EG-9F/R8) + PIH-4c — evict the legacy STU-xxx seed universe
 * from a REAL (non-demo) tenant's store. No-op for the demo tenant and
 * for any store whose roster is NOT the pure seed universe (a canonical
 * server roster uses DB ids, so already-synced/persisted real data is
 * never touched). Called on sync failure and from the app root for
 * teacher-role sessions (which never run the roster sync).
 */
export function purgeSeedRosterForRealTenant(): void {
  if (readIsDemoTenant()) return
  const st = useStudentsStore.getState()
  const isSeedRoster =
    st.students.length > 0 && st.students.every((s) => s.id.startsWith('STU-'))
  if (isSeedRoster) {
    useStudentsStore.setState({
      students: [],
      classes: [],
      academicSubjects: [],
      studentPositions: [],
      rosterTeachers: [],
    })
  }
}

/** Reset the once-per-session guard (used by tests / explicit re-sync). */
export function resetRosterSyncGuard(): void {
  syncPromise = null
}

// ── identity resolution (student panel) ──────────────────────────────

/**
 * Resolve the CURRENT student's canonical StudentRecord from the store,
 * matching the session user (userId first, then email). No fabricated
 * fallback (PIH-4c): a real student without a server roster record
 * resolves to `undefined` — consumers render their honest empty state
 * until the canonical roster sync lands.
 */
export function resolveMyStudentRecord(
  students: StudentRecord[],
  sessionUserId?: string | null,
  sessionEmail?: string | null,
): StudentRecord | undefined {
  if (sessionUserId) {
    const byId = students.find((s) => s.userId === sessionUserId)
    if (byId) return byId
  }
  if (sessionEmail) {
    const byEmail = students.find((s) => (s.email ?? '').toLowerCase() === sessionEmail.toLowerCase())
    if (byEmail) return byEmail
  }
  return undefined
}

/** React hook wrapper for the student panel. */
export function useMyStudentRecord(): StudentRecord | undefined {
  const students = useStudentsStore((s) => s.students)
  const userId = useAuthStore((s) => s.user?.id)
  const email = useAuthStore((s) => s.user?.email)
  return resolveMyStudentRecord(students, userId, email)
}
