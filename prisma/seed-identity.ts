/**
 * seed-identity — the single source of truth for the two-tenant
 * ACCEPTANCE corpus identity map.
 *
 * FINAL-ACCEPTANCE rebrand (Phase 1 of the final completion mission):
 * the demo tenant is now HAWKINGS HIGH SCHOOL PRITHVIPUR — a realistic
 * small-town CBSE-pattern school in Prithvipur, Ghazipur, Uttar
 * Pradesh — 233226, India. The tenant keeps the demo role (isDemo:
 * true, full canonical corpus); the clean tenant stays Green Valley
 * Public School (honest-empty, isDemo: false).
 *
 * History: Demo School of Scholario → Greenwood → Sunrise Academy →
 * Hawkings High School Prithvipur (each rebrand preserved the corpus
 * discipline: deterministic seeds, env-driven credentials, zero stale
 * strings — the repository-wide census for this rebrand lives in the
 * final acceptance tests).
 *
 * Canonical identity exports (emails) exist so every seed script and
 * test references ONE constant instead of scattering literals — the
 * Phase-1 mission requirement "no stale <old-name> strings" is
 * enforced structurally: change it here, everything follows.
 */

/** Demo (full-corpus) tenant. */
export const DEMO_SCHOOL_SLUG = 'hawkings-prithvipur'
export const DEMO_SCHOOL_NAME = 'Hawkings High School Prithvipur'
export const DEMO_SCHOOL_CODE = 'HHSP'
/** Legacy admin-set hostname (pre-TenantDomain resolution path, platform-managed). */
export const DEMO_SCHOOL_DOMAIN = 'hawkings-high.scholario.app'
/** Email domain for every demo-tenant account (staff + students). */
export const DEMO_SCHOOL_EMAIL_DOMAIN = 'hawkingshigh.edu'

/** Clean (honest-zero) tenant. */
export const CLEAN_SCHOOL_SLUG = 'green-valley'
export const CLEAN_SCHOOL_NAME = 'Green Valley Public School'
export const CLEAN_SCHOOL_CODE = 'GVPS'

// ─── Canonical demo-tenant account identities (Phase 1/11) ─────────────
// One principal, one office (MANAGEMENT), fifteen teachers. The teacher
// numbering is the stable wire identity used by seeds and tests alike.

export const DEMO_PRINCIPAL_EMAIL = `principal@${DEMO_SCHOOL_EMAIL_DOMAIN}`
export const DEMO_MANAGEMENT_EMAIL = `management@${DEMO_SCHOOL_EMAIL_DOMAIN}`

/** teacherN@ — N = 1..DEMO_TEACHER_COUNT (emails are the stable keys). */
export const DEMO_TEACHER_COUNT = 15
export const demoTeacherEmail = (n: number): string => `teacher${n}@${DEMO_SCHOOL_EMAIL_DOMAIN}`
export const DEMO_TEACHER_1_EMAIL = demoTeacherEmail(1)

/**
 * The FEATURED STUDENT — the canonical demo-student identity the
 * student-facing seeds (dashboard corpus, study materials, learning
 * corpus) anchor to: class 7-A, roll 01 — a middle-school student with
 * the fullest data trail. Resolved at runtime from the deterministic
 * roster (position spec, never a hardcoded address — the roster is the
 * truth); seeds/tests resolve via
 * hawkings-corpus.buildStudentRoster() + this position.
 */
export const DEMO_STUDENT_POSITION = { level: '7', idx: 0 } as const

// ─── Account-level subscription locks (Phase 10) ────────────────────────
// A small, deliberate subset of LOCKED accounts: the login/session/
// identity surfaces keep working (name, guardian, contact, photo) while
// every protected module API rejects them server-side with
// SUBSCRIPTION_REQUIRED.
//
// Students are specified by ROSTER POSITION (level + 0-based index) —
// the corpus generator resolves them to the deterministic identities
// (never hardcode generated emails here; the roster is the truth).
// Documented (emails only, never credentials) in
// docs/HAWKINGS_DEMO_TENANT.md.
export const DEMO_SUBSCRIPTION_LOCKED_STUDENTS: { level: string; idx: number }[] = [
  { level: '9', idx: 3 },
  { level: '11', idx: 4 },
  { level: '5', idx: 2 },
  { level: '12', idx: 1 },
]
/** The LOCKED teacher (faculty N — prisma/hawkings-corpus.ts FACULTY). */
export const DEMO_SUBSCRIPTION_LOCKED_TEACHER_N = 3 // Smt. Meena Kumari (3-A class teacher)

// ─── Tenant-isolation probe identifiers (test infrastructure) ───────────
// Owned by the DEMO tenant; the domain seeds that rebuild school data
// explicitly PRESERVE them.
export const PROBE_SUBJECT_CODE = 'HH-PROBE-MATH'
export const PROBE_MATERIAL_TITLE = 'Hawkings Maths Worksheet 1'

// ─── Academic structure (Phase 2 — the class map) ───────────────────────
// Exactly ONE section (A) per level: Nursery, LKG, IKG, Classes 1–12.
// Canonical labels: Nursery-A, LKG-A, IKG-A, 1-A … 12-A.

export const DEMO_CLASS_LEVELS = [
  { key: 'Nursery', label: 'Nursery-A', level: 'Nursery', room: 'Room N0A', capacity: 25 },
  { key: 'LKG', label: 'LKG-A', level: 'LKG', room: 'Room L0A', capacity: 25 },
  { key: 'IKG', label: 'IKG-A', level: 'IKG', room: 'Room I0A', capacity: 25 },
  { key: '1', label: '1-A', level: '1', room: 'Room 10A', capacity: 30 },
  { key: '2', label: '2-A', level: '2', room: 'Room 20A', capacity: 30 },
  { key: '3', label: '3-A', level: '3', room: 'Room 30A', capacity: 30 },
  { key: '4', label: '4-A', level: '4', room: 'Room 40A', capacity: 30 },
  { key: '5', label: '5-A', level: '5', room: 'Room 50A', capacity: 30 },
  { key: '6', label: '6-A', level: '6', room: 'Room 60A', capacity: 35 },
  { key: '7', label: '7-A', level: '7', room: 'Room 70A', capacity: 35 },
  { key: '8', label: '8-A', level: '8', room: 'Room 80A', capacity: 35 },
  { key: '9', label: '9-A', level: '9', room: 'Room 90A', capacity: 40 },
  { key: '10', label: '10-A', level: '10', room: 'Room 100A', capacity: 40 },
  { key: '11', label: '11-A', level: '11', room: 'Room 110A', capacity: 40 },
  { key: '12', label: '12-A', level: '12', room: 'Room 120A', capacity: 40 },
] as const

/** Numeric class level for a label key ('9' → 9; pre-primary → null). */
export function numericLevel(key: string): number | null {
  const n = Number(key)
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null
}
