/**
 * seed-demo-admission-fees — PR-3 · GATE 2-E.
 *
 * The DEMO TENANT'S canonical admission fee configuration, written into
 * the canonical storage (School.settings JSON) so the demo tenant can
 * demonstrate the admission fee feature end-to-end through the REAL
 * configuration path (GET /api/school-settings sync → client preview;
 * POST /api/admissions/fee-snapshot → official documents).
 *
 * Hard gates (all of them, every run):
 *   · `assertSeedable` (seed-guard) — never seeds production unless the
 *     deliberate demo-transform consent literal is set;
 *   · the tenant is resolved by CANONICAL STABLE IDENTITY
 *     (slug = 'hawkings-prithvipur' — prisma/seed-identity), never by
 *     name coincidence and never by a client-supplied id;
 *   · the school row MUST have isDemo = true — Green Valley (or any
 *     arbitrary tenant) can never receive these values;
 *   · IDEMPOTENT / SAFE TO RE-RUN: skip-if-exists on every fee key — a
 *     re-run never overwrites a configuration the principal edited
 *     through the product, and never duplicates entries;
 *   · NEVER runs at application startup — this is an explicit, manual
 *     seed (`bun prisma/seed-demo-admission-fees.ts`, or pipeline step
 *     13 of `bun run seed:demo`);
 *   · the write is a MERGE into School.settings preserving every other
 *     slice (timetable, attendance, …).
 *
 * Value discipline: every amount is a realistic small-town CBSE-school
 * figure deliberately DISTINCT from the retired fabricated literals
 * (1500 / 15000 / 60000 / 18000 / 45000 / 850 / 1200 …) so audits can
 * always tell configured demo data from legacy fallbacks. All amounts
 * sit inside the Phase-8A money bound (0..500000).
 */
import { PrismaClient } from '@prisma/client'
import { assertSeedable } from './seed-guard'
import { DEMO_SCHOOL_SLUG, DEMO_SCHOOL_NAME } from './seed-identity'

const db = new PrismaClient()

/** The fee-bearing settings keys this seed owns (skip-if-exists keys). */
const FEE_KEYS = ['feeHeads', 'booksMaster', 'discountRules', 'examFeeConfig', 'admissionFees', 'uniforms'] as const

/** Coherent Hawkings-scale canonical fee configuration (settings JSON fragment). */
export function demoAdmissionFeeSettings(): Record<string, unknown> {
  return {
    feeHeads: [
      { id: 'HH-FH-REG', name: 'Registration Fee', category: 'Registration', defaultAmount: 700, type: 'one-time' },
      { id: 'HH-FH-ADM', name: 'Admission Fee', category: 'Admission', defaultAmount: 9000, type: 'one-time' },
      { id: 'HH-FH-TUI', name: 'Annual Tuition Fee', category: 'Tuition', defaultAmount: 13200, type: 'annual' },
      { id: 'HH-FH-DEV', name: 'Development & Digital Fee', category: 'Development', defaultAmount: 2600, type: 'annual' },
      { id: 'HH-FH-LAB', name: 'Computer & Science Lab Fee', category: 'Lab', defaultAmount: 1600, type: 'annual' },
      { id: 'HH-FH-SPT', name: 'Sports & Wellness Fee', category: 'Sports', defaultAmount: 1250, type: 'annual' },
    ],
    booksMaster: [
      // Class 1
      { id: 'HH-BK-101', title: 'NCERT Marigold English Class 1', publisher: 'NCERT', price: 145, category: 'Textbook', isMandatory: true, className: 'Class 1' },
      { id: 'HH-BK-102', title: 'NCERT Math Magic Class 1', publisher: 'NCERT', price: 165, category: 'Textbook', isMandatory: true, className: 'Class 1' },
      { id: 'HH-BK-103', title: 'NCERT Rimjhim Hindi Class 1', publisher: 'NCERT', price: 135, category: 'Textbook', isMandatory: true, className: 'Class 1' },
      // Class 7 (the featured demo class)
      { id: 'HH-BK-701', title: 'NCERT Honeycomb English Class 7', publisher: 'NCERT', price: 175, category: 'Textbook', isMandatory: true, className: 'Class 7' },
      { id: 'HH-BK-702', title: 'NCERT Mathematics Class 7', publisher: 'NCERT', price: 195, category: 'Textbook', isMandatory: true, className: 'Class 7' },
      { id: 'HH-BK-703', title: 'NCERT Science Class 7', publisher: 'NCERT', price: 205, category: 'Textbook', isMandatory: true, className: 'Class 7' },
      { id: 'HH-BK-704', title: 'NCERT Our Pasts-II History Class 7', publisher: 'NCERT', price: 185, category: 'Textbook', isMandatory: false, className: 'Class 7' },
      // Class 10
      { id: 'HH-BK-001', title: 'NCERT First Flight English Class 10', publisher: 'NCERT', price: 215, category: 'Textbook', isMandatory: true, className: 'Class 10' },
      { id: 'HH-BK-002', title: 'NCERT Mathematics Class 10', publisher: 'NCERT', price: 235, category: 'Textbook', isMandatory: true, className: 'Class 10' },
      { id: 'HH-BK-003', title: 'NCERT Science Class 10', publisher: 'NCERT', price: 255, category: 'Textbook', isMandatory: true, className: 'Class 10' },
    ],
    discountRules: [
      { id: 'HH-DR-01', code: 'SIBLING', name: 'Sibling Concession', type: 'percentage', value: 10, description: '10% concession for a younger sibling of an enrolled student', category: 'Sibling' },
      { id: 'HH-DR-02', code: 'FULL_YEAR', name: 'Full Year Advance Payment', type: 'percentage', value: 5, description: '5% concession when the full academic year fee is paid upfront', category: 'FullYear' },
      { id: 'HH-DR-03', code: 'STAFF_CHILD', name: 'Staff Dependent Concession', type: 'percentage', value: 50, description: '50% concession for children of Hawkings staff', category: 'Staff' },
    ],
    examFeeConfig: {
      unitTestFee: 450,
      termExamFee: 1350,
      customGroupsFee: 800,
    },
    admissionFees: {
      transportFee: 14400,
      hostelFee: 36000,
      activityKit: [
        { id: 'HH-AK-01', name: 'Art & Craft Kit', price: 780 },
        { id: 'HH-AK-02', name: 'Sports Kit', price: 1150 },
        { id: 'HH-AK-03', name: 'Music & Instrument Kit', price: 890 },
        { id: 'HH-AK-04', name: 'Science Lab Kit', price: 540 },
      ],
    },
    uniforms: [
      { id: 'HH-UN-01', name: 'Summer Uniform Set', category: 'Summer', price: 940, sizes: ['4-5Y', '6-7Y', '8-9Y', '10-11Y', '12-13Y'], stock: 120 },
      { id: 'HH-UN-02', name: 'Winter Uniform Set', category: 'Winter', price: 1240, sizes: ['4-5Y', '6-7Y', '8-9Y', '10-11Y', '12-13Y'], stock: 85 },
      { id: 'HH-UN-03', name: 'Sports Uniform', category: 'Sports', price: 690, sizes: ['4-5Y', '6-7Y', '8-9Y', '10-11Y', '12-13Y'], stock: 95 },
      { id: 'HH-UN-04', name: 'School Blazer', category: 'Formal', price: 1490, sizes: ['8-9Y', '10-11Y', '12-13Y', '14-15Y'], stock: 40 },
    ],
  }
}

function parseSettings(raw: string | null): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through — malformed settings degrade to empty (never throw)
  }
  return {}
}

/**
 * Apply the demo admission fee settings to ONE school row (already
 * resolved by the caller). Exported for the focused tests; the guards
 * are identical here and in main().
 *   · isDemo must be true → otherwise throw (never seed a real tenant);
 *   · skip-if-exists on every fee key → never overwrite principal edits.
 * Returns 'seeded' | 'skipped'.
 */
export async function seedDemoAdmissionFees(
  db: PrismaClient,
  school: { id: string; isDemo: boolean; name: string },
): Promise<'seeded' | 'skipped'> {
  if (!school.isDemo) {
    throw new Error(
      `[seed-demo-admission-fees] REFUSING to seed admission fees into “${school.name}” — ` +
        'isDemo=false. Demo fee settings may only ever target the sanctioned demo tenant.',
    )
  }
  const schoolRow = await db.school.findUnique({ where: { id: school.id }, select: { settings: true } })
  if (!schoolRow) throw new Error('[seed-demo-admission-fees] school row disappeared before the write')
  const current = parseSettings(schoolRow.settings)
  const existing = FEE_KEYS.filter((k) => k in current)
  if (existing.length > 0) {
    return 'skipped'
  }
  const next = { ...current, ...demoAdmissionFeeSettings() }
  await db.school.update({ where: { id: school.id }, data: { settings: JSON.stringify(next) } })
  return 'seeded'
}

async function main() {
  assertSeedable('seed-demo-admission-fees')

  // Canonical stable identity — the demo tenant's slug (never a
  // client-supplied id, never a name match on an arbitrary tenant).
  const school = await db.school.findUnique({ where: { slug: DEMO_SCHOOL_SLUG } })
  if (!school) {
    throw new Error(
      `[seed-demo-admission-fees] demo tenant ${DEMO_SCHOOL_SLUG} (${DEMO_SCHOOL_NAME}) not found — run the canonical corpus seeds first`,
    )
  }
  if (!school.isDemo) {
    throw new Error(
      `[seed-demo-admission-fees] REFUSING: ${school.name} (slug ${school.slug}) has isDemo=false — ` +
        'demo fee settings never apply to a real tenant.',
    )
  }

  const result = await seedDemoAdmissionFees(db, school)
  if (result === 'skipped') {
    console.log(`[seed-demo-admission-fees] ${school.name}: fee settings already present — skipped (idempotent; principal edits preserved).`)
  } else {
    console.log(`[seed-demo-admission-fees] ${school.name}: canonical admission fee settings planted into School.settings (merge — existing slices preserved).`)
  }
  await db.$disconnect()
}

// Run only when executed directly (never on import — tests import the exports).
if (import.meta.main) {
  await main()
}
