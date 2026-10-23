/**
 * CLASS GROUPING (Phase 2 audit — D1 regression battery).
 *
 * mapRosterToRecords (src/lib/store/students-store/server-sync.ts) is the
 * ONE canonical mapper that turns GET /api/students/roster rows into the
 * students-store ClassRecord universe consumed by every school-plane
 * surface (~53 files: Classes grid, student pickers, exam class pickers
 * via the academic resolver, certificates, transport, messaging, …).
 *
 * WHY THIS FILE EXISTS (the detection gap that let D1 ship): the wizard
 * provisions Class rows WITHOUT gradeLevel (schema-legal NULL —
 * `@@unique([schoolId, name, section])` is the only constraint that
 * matters), and the mapper collapsed every such row into one synthetic
 * "Grade 0" group whose sections[] swallowed all real classes — the
 * reported "Class 0 with an excessive number of sections". No test
 * covered wizard-created class display; this battery pins the contract
 * for EVERY class-creation path identified in the Phase 2 trace:
 *
 *   · wizard preset/custom rows     gradeLevel NULL, name "Class N"
 *   · school-plane POST /api/classes  gradeLevel '' (omitted → String(body.gradeLevel || ''))
 *   · timetable-publish auto-create   gradeLevel NULL, name "Grade 9 - A"
 *   · empty-section bootstrap        section NULL (row with sections: [])
 *   · demo corpus (gradeLevel SET)   '1'..'12' + 'Nursery'/'LKG'/'IKG'
 *
 * GROUPING POLICY (canonical, see audit/phase2-…/CLASS-GROUPING-POLICY.md):
 *   1. A VALID stored gradeLevel is authoritative (never overridden by the
 *      name) → group G{grade} (+stream), label "Grade N" — unchanged
 *      behavior for every correctly-populated tenant.
 *   2. Missing/empty/non-numeric gradeLevel → derive the grade from the
 *      class NAME's first number ("Class 6" → 6) and label the group with
 *      the REAL name — never a synthetic "Grade 0".
 *   3. Names without any number (Nursery/LKG/UKG/IKG, arbitrary custom
 *      names) → their own named group per name — never numeric 0, never
 *      merged with anything else. Recognized pre-primary names level as
 *      'Pre-Primary' (the store's own ladder).
 */
import { describe, test, expect } from 'bun:test'

import { mapRosterToRecords } from '../../src/lib/store/students-store/server-sync'

// Structural mirror of the (unexported) RosterClassDto / RosterPayload
// shapes the mapper consumes — kept in sync field-for-field.
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

function row(
  name: string,
  gradeLevel: string | null,
  section: string | null,
  extra: Partial<RosterClassDto> = {},
): RosterClassDto {
  return {
    id: extra.id ?? `${name}|${gradeLevel ?? 'null'}|${section ?? 'null'}`,
    name,
    gradeLevel,
    section,
    stream: null,
    capacity: 40,
    room: null,
    classTeacherId: null,
    studentCount: 0,
    subjectIds: [],
    subjectTeachers: {},
    ...extra,
  }
}

function map(classes: RosterClassDto[]) {
  const { classes: grouped } = mapRosterToRecords({
    classes,
    subjects: [],
    teachers: [],
    students: [],
  } as never)
  return grouped
}

/** The exact payload shape the wizard's Class 1–12 preset produces. */
const WIZARD_PRESET_12: RosterClassDto[] = Array.from({ length: 12 }, (_, i) => row(`Class ${i + 1}`, null, 'A'))

// ─────────────────────────────────────────────────────────────────────
// 1. The confirmed failing payload (D1) — wizard preset, gradeLevel NULL
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — wizard-created classes (D1 regression)', () => {
  test('Class 1–12 preset with gradeLevel NULL → TWELVE named groups, never one "Grade 0"', () => {
    const grouped = map(WIZARD_PRESET_12)
    expect(grouped.length).toBe(12)
    // Named after the REAL classes, one section each — the M2-02 acceptance.
    for (let i = 1; i <= 12; i += 1) {
      const g = grouped.find((c) => c.grade === i)
      expect(g).toBeTruthy()
      expect(g!.name).toBe(`Class ${i}`)
      expect(g!.sections.map((s) => s.name)).toEqual(['A'])
    }
    // No synthetic Grade 0 may exist anywhere in the universe.
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
    expect(grouped.some((g) => g.grade === 0)).toBe(false)
    expect(grouped.some((g) => g.id === 'G0')).toBe(false)
  })

  test('wizard rows keep the established level ladder from their name-derived grade', () => {
    const grouped = map(WIZARD_PRESET_12)
    const byName = new Map(grouped.map((g) => [g.name, g.level]))
    expect(byName.get('Class 1')).toBe('Primary')
    expect(byName.get('Class 5')).toBe('Primary')
    expect(byName.get('Class 6')).toBe('Middle')
    expect(byName.get('Class 8')).toBe('Middle')
    expect(byName.get('Class 9')).toBe('Secondary')
    expect(byName.get('Class 10')).toBe('Secondary')
    expect(byName.get('Class 11')).toBe('Senior Secondary')
    expect(byName.get('Class 12')).toBe('Senior Secondary')
  })

  test('custom (operator-typed) rows with gradeLevel NULL group identically to presets', () => {
    const grouped = map([row('Class 3', null, 'A'), row('Class 7', null, 'B')])
    expect(grouped.length).toBe(2)
    expect(grouped.find((g) => g.name === 'Class 3')?.sections.map((s) => s.name)).toEqual(['A'])
    expect(grouped.find((g) => g.name === 'Class 7')?.sections.map((s) => s.name)).toEqual(['B'])
  })

  test('subset presets (9–10, 11–12) never merge across grades', () => {
    const grouped = map([row('Class 9', null, 'A'), row('Class 10', null, 'A'), row('Class 11', null, 'A'), row('Class 12', null, 'A')])
    expect(grouped.length).toBe(4)
    expect(grouped.map((g) => g.name).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))).toEqual([
      'Class 9',
      'Class 10',
      'Class 11',
      'Class 12',
    ])
  })

  test('multiple sections of one class stay one group with all their sections', () => {
    const grouped = map([row('Class 5', null, 'A'), row('Class 5', null, 'B'), row('Class 5', null, 'C')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].name).toBe('Class 5')
    expect(grouped[0].grade).toBe(5)
    expect(grouped[0].sections.map((s) => s.name)).toEqual(['A', 'B', 'C'])
  })

  test('empty-section bootstrap row (section NULL) renders the default section, named after the class', () => {
    const grouped = map([row('Class 3', null, null)])
    expect(grouped.length).toBe(1)
    expect(grouped[0].name).toBe('Class 3')
    expect(grouped[0].grade).toBe(3)
    // Documented convention: a row without a section is the class's
    // default section, displayed as "A" (the store-wide fallback).
    expect(grouped[0].sections.map((s) => s.name)).toEqual(['A'])
  })

  test('streams on wizard rows split the groups (11–12 stream metadata)', () => {
    const grouped = map([
      row('Class 11', null, 'A', { stream: 'Science' }),
      row('Class 12', null, 'A', { stream: 'Commerce' }),
    ])
    expect(grouped.length).toBe(2)
    // Labels carry the stream suffix — the same convention valid-grade
    // rows already render ("Grade 11 (Science)").
    const sci = grouped.find((g) => g.id.endsWith('-SCI'))
    const com = grouped.find((g) => g.id.endsWith('-COM'))
    expect(sci?.name).toBe('Class 11 (Science)')
    expect(com?.name).toBe('Class 12 (Commerce)')
    expect(sci?.grade).toBe(11)
    expect(com?.grade).toBe(12)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. Pre-primary + arbitrary names — never numeric 0, never merged
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — pre-primary and arbitrary names', () => {
  test('Nursery / LKG / UKG / IKG rows (gradeLevel NULL) form FOUR separate named groups', () => {
    const grouped = map([row('Nursery', null, 'A'), row('LKG', null, 'A'), row('UKG', null, 'A'), row('IKG', null, 'A')])
    expect(grouped.length).toBe(4)
    const names = grouped.map((g) => g.name).sort()
    expect(names).toEqual(['IKG', 'LKG', 'Nursery', 'UKG'])
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
    for (const g of grouped) {
      expect(g.sections.length).toBe(1)
      expect(g.sections[0].name).toBe('A')
    }
  })

  test('recognized pre-primary names level as Pre-Primary; sections of one name merge', () => {
    const grouped = map([row('Nursery', null, 'A'), row('Nursery', null, 'B'), row('LKG', null, 'A')])
    expect(grouped.length).toBe(2)
    const nursery = grouped.find((g) => g.name === 'Nursery')
    expect(nursery?.level).toBe('Pre-Primary')
    expect(nursery?.sections.map((s) => s.name)).toEqual(['A', 'B'])
    expect(grouped.find((g) => g.name === 'LKG')?.level).toBe('Pre-Primary')
  })

  test('the legacy IKG name is pre-primary too (demo-corpus parity)', () => {
    const grouped = map([row('IKG', null, 'A'), row('UKG', null, 'A'), row('IKG-A', 'IKG', 'A')])
    expect(grouped.find((g) => g.name === 'IKG')?.level).toBe('Pre-Primary')
    expect(grouped.find((g) => g.name === 'UKG')?.level).toBe('Pre-Primary')
    expect(grouped.find((g) => g.name === 'IKG-A')?.level).toBe('Pre-Primary')
  })

  test('an arbitrary custom name without digits gets its own named group (not Grade 0)', () => {
    const grouped = map([row('Diploma', null, 'A'), row('Class 4', null, 'A')])
    expect(grouped.length).toBe(2)
    const diploma = grouped.find((g) => g.name === 'Diploma')
    expect(diploma).toBeTruthy()
    expect(diploma!.sections.map((s) => s.name)).toEqual(['A'])
    expect(grouped.find((g) => g.name === 'Class 4')).toBeTruthy()
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
  })

  test('two different numberless names never merge; case-variants of one name do', () => {
    const grouped = map([row('Nursery', null, 'A'), row('nursery', null, 'B')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].name).toBe('Nursery')
    expect(grouped[0].sections.map((s) => s.name)).toEqual(['A', 'B'])
  })
})

// ─────────────────────────────────────────────────────────────────────
// 3. Alternate class-creation paths (Phase 2 Step B trace)
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — alternate class-creation paths', () => {
  test('POST /api/classes with gradeLevel omitted persists "" — the row groups by NAME, not into Grade 0', () => {
    // route.ts:57 writes String(body.gradeLevel || '') → '' when omitted.
    const grouped = map([row('Class 6', '', 'A'), row('Class 7', '', 'B')])
    expect(grouped.length).toBe(2)
    expect(grouped.find((g) => g.name === 'Class 6')?.grade).toBe(6)
    expect(grouped.find((g) => g.name === 'Class 7')?.sections.map((s) => s.name)).toEqual(['B'])
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
  })

  test('timetable-publish auto-create ("Grade 9 - A", gradeLevel NULL) groups as grade 9, named after the row', () => {
    // publish route keeps the full label as the name and derives the
    // trailing section letter.
    const grouped = map([row('Grade 9 - A', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].grade).toBe(9)
    expect(grouped[0].name).toBe('Grade 9 - A')
    expect(grouped[0].sections.map((s) => s.name)).toEqual(['A'])
  })

  test('explicit gradeLevel "0" is not a valid grade — falls back to the NAME', () => {
    const grouped = map([row('Class 6', '0', 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].grade).toBe(6)
    expect(grouped[0].name).toBe('Class 6')
    expect(grouped[0].id).not.toBe('G0')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 4. Valid stored gradeLevel — existing behavior preserved (compat)
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — valid stored gradeLevel (backward compatibility)', () => {
  test('demo corpus shape: numeric rows keep "Grade N" groups; the pre-primary trio un-merges', () => {
    const grouped = map([
      row('Nursery-A', 'Nursery', 'A'),
      row('LKG-A', 'LKG', 'A'),
      row('IKG-A', 'IKG', 'A'),
      ...Array.from({ length: 12 }, (_, i) => row(`${i + 1}-A`, String(i + 1), 'A')),
    ])
    // 12 numeric groups (unchanged labels) + 3 named pre-primary groups
    // (previously one broken "Grade 0 · 3 sections" merge).
    expect(grouped.length).toBe(15)
    for (let i = 1; i <= 12; i += 1) {
      const g = grouped.find((c) => c.grade === i)
      expect(g?.name).toBe(`Grade ${i}`) // synthesized label preserved for valid grades
      expect(g?.sections.map((s) => s.name)).toEqual(['A'])
    }
    const pre = grouped.filter((g) => g.grade === 0)
    expect(pre.length).toBe(3)
    expect(pre.map((g) => g.name).sort()).toEqual(['IKG-A', 'LKG-A', 'Nursery-A'])
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
  })

  test('a valid stored grade WINS over a disagreeing name (stored value is authoritative)', () => {
    const grouped = map([row('Class 9', '7', 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].grade).toBe(7)
    expect(grouped[0].name).toBe('Grade 7')
    expect(grouped[0].id).toBe('G7')
  })

  test('valid-grade rows with streams keep their suffixed keys and labels', () => {
    const grouped = map([row('11-A', '11', 'A', { stream: 'Science' })])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G11-SCI')
    expect(grouped[0].name).toBe('Grade 11 (Science)')
  })

  test('mixed corpus: stored-grade rows and name-derived rows of the same grade share ONE group', () => {
    // A tenant that has both legacy rows (gradeLevel set) and wizard rows
    // (NULL) for the same grade: both are grade 6 — one group, sections
    // from both rows (the legacy row wins the label because the roster
    // orders stored grades first — documented policy edge case).
    const grouped = map([row('6-A', '6', 'A'), row('Class 6', null, 'B')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].grade).toBe(6)
    expect(grouped[0].sections.map((s) => s.name)).toEqual(['A', 'B'])
  })

  test('no classes at all → empty universe (F: wizard allows no classes)', () => {
    const grouped = map([])
    expect(grouped.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 5. Student records follow the fixed groups (consumer contract)
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — students inherit the fixed grouping', () => {
  test('a student on a wizard-created row gets the named group as className', () => {
    const { students } = mapRosterToRecords({
      classes: WIZARD_PRESET_12,
      subjects: [],
      teachers: [],
      students: [
        {
          id: 'stu-1',
          userId: 'u1',
          name: 'Test Student',
          email: 'test@wizard.test',
          status: 'ACTIVE',
          rollNo: '01',
          admissionNo: 'ADM-1',
          classId: WIZARD_PRESET_12[5].id, // "Class 6" row
          guardianName: null,
          guardianPhone: null,
          guardianEmail: null,
          dob: null,
          gender: null,
          bloodGroup: null,
          address: null,
          routeName: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          attendance: { pct: null, records: 0, present: 0, absent: 0, late: 0, leave: 0, monthly: [] },
          latestExam: null,
          fees: { totalBilled: 0, totalPaid: 0, outstanding: 0, status: 'NONE', awaitingVerification: 0 },
          growthPoints: 0,
          behaviorCount: 0,
        },
      ],
    } as never)
    expect(students.length).toBe(1)
    expect(students[0].className).toBe('Class 6')
    expect(students[0].section).toBe('A')
    expect(students[0].classId).toBe('G6')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 6. Unusual / custom class names (final-review follow-up, 2026-10-23)
//
// Expected-behavior table agreed BEFORE pinning (ambiguities documented,
// never guessed):
//
//  · "Batch 2026"   rule 2  grade 2026  key G2026  label "Batch 2026"
//    level Senior Secondary (the ladder's else-bucket). AMBIGUITY (accepted,
//    documented): a YEAR in a custom name parses as a grade — the same
//    first-number parse the store createClass and the picker use. The group
//    stays isolated (nothing else parses to 2026) and shows the real name,
//    so no D1-family symptom can occur. Capping the parse was rejected:
//    any cap (e.g. →12) would MERGE "Batch 2026" into a real grade group.
//    Divergence noted: the picker's /(\d{1,2})/ parses "20" → 'Other' bucket;
//    harmless (its buckets are display-only).
//  · "Nursery 2"    MUST resolve pre-primary-first (the allocation picker's
//    own ordering: regex BEFORE number parse). Expected: grade 0, key
//    N:nursery 2, label "Nursery 2", level Pre-Primary. The prior behavior
//    (rule 2 → G2) collided with "Class 2" — merging a pre-primary stage
//    with an academic grade into ONE card, exactly the "merging unrelated
//    classes" the policy forbids. A VALID stored grade still wins (rule 1).
//  · "Grade 9 - A"  rule 2  grade 9  key G9  label "Grade 9 - A"
//    level Secondary. Merging with "Class 9" is CORRECT (same academic
//    grade — the grouping's purpose).
//  · "Class 0"      rule 3 ("0" is not a valid grade)  grade 0  key
//    N:class 0  label "Class 0"  level Primary (the established
//    unknown-grade bucket). AMBIGUITY (documented, not guessed): some
//    curricula treat "Class 0" as pre-primary — the pre-primary regex does
//    NOT recognize it and we do not extend the regex on a guess. The
//    invariants that matter hold: own group, real name, never "Grade 0".
//  · "Class 01"     rule 2  grade 1 (parseInt("01"))  key G1  label
//    "Class 01"  level Primary. Zero-padding must NOT split grade 1.
//  · empty/whitespace name  — API-FORBIDDEN shape (wizard zod safeText(40)
//    min 1 after trim → 422; POST /api/classes throws 'Class name is
//    required'; timetable-publish filters falsy names). Defensive pin only:
//    the shared mapper must not crash if a future write path ever emits one.
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — unusual / custom class names (final-review follow-up)', () => {
  test('"Batch 2026" → isolated G2026 group labeled with the real name (year-parsed-as-grade edge, documented)', () => {
    const grouped = map([row('Batch 2026', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G2026')
    expect(grouped[0].name).toBe('Batch 2026')
    expect(grouped[0].grade).toBe(2026)
    // ladder else-bucket — cosmetic, isolated; never merges with real grades
    expect(grouped[0].level).toBe('Senior Secondary')
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
  })

  test('two year-named batches never merge ("Batch 2025" vs "Batch 2026")', () => {
    const grouped = map([row('Batch 2025', null, 'A'), row('Batch 2026', null, 'A')])
    expect(grouped.length).toBe(2)
    expect(grouped.map((g) => g.id).sort()).toEqual(['G2025', 'G2026'])
  })

  test('"Nursery 2" resolves PRE-PRIMARY (picker parity): own named group, never G2', () => {
    // The allocation picker checks its pre-primary regex BEFORE parsing a
    // number (use-academic-allocation.ts groupLabelOf) — "Nursery 2" is a
    // pre-primary stage there. The canonical mapper must agree.
    const grouped = map([row('Nursery 2', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('N:nursery 2')
    expect(grouped[0].name).toBe('Nursery 2')
    expect(grouped[0].grade).toBe(0)
    expect(grouped[0].level).toBe('Pre-Primary')
    expect(grouped[0].id).not.toBe('G2')
  })

  test('"Nursery 2" never merges with "Class 2" (the unrelated-classes invariant)', () => {
    // The regression this follow-up exists for: under rule-2-first ordering
    // "Nursery 2" parsed as grade 2 and JOINED the real Class 2 group —
    // one card swallowing a pre-primary stage and an academic grade.
    const grouped = map([row('Nursery 2', null, 'A'), row('Class 2', null, 'B')])
    expect(grouped.length).toBe(2)
    const nursery = grouped.find((g) => g.id === 'N:nursery 2')
    const class2 = grouped.find((g) => g.id === 'G2')
    expect(nursery?.name).toBe('Nursery 2')
    expect(nursery?.level).toBe('Pre-Primary')
    expect(nursery?.sections.map((s) => s.name)).toEqual(['A'])
    expect(class2?.name).toBe('Class 2')
    expect(class2?.grade).toBe(2)
    expect(class2?.level).toBe('Primary')
    expect(class2?.sections.map((s) => s.name)).toEqual(['B'])
  })

  test('other number-bearing pre-primary names ("LKG 2", "UKG 2", "KG 2", "Pre-Primary 1") follow the same rule', () => {
    const grouped = map([
      row('LKG 2', null, 'A'),
      row('UKG 2', null, 'A'),
      row('KG 2', null, 'A'),
      row('Pre-Primary 1', null, 'A'),
    ])
    expect(grouped.length).toBe(4)
    for (const g of grouped) {
      expect(g.grade).toBe(0)
      expect(g.level).toBe('Pre-Primary')
      expect(g.id.startsWith('N:')).toBe(true)
    }
    expect(grouped.some((g) => g.id === 'G1' || g.id === 'G2')).toBe(false)
  })

  test('a VALID stored grade still wins over a pre-primary name ("Nursery 2" with gradeLevel "2" → Grade 2)', () => {
    // Rule 1 is untouched: explicitly stored valid grades are authoritative;
    // the pre-primary name check only fills in for absent/invalid metadata.
    const grouped = map([row('Nursery 2', '2', 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G2')
    expect(grouped[0].name).toBe('Grade 2')
    expect(grouped[0].grade).toBe(2)
  })

  test('"Grade 9 - A" (timetable-publish shape) alone → G9 labeled with the real name, level Secondary', () => {
    const grouped = map([row('Grade 9 - A', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G9')
    expect(grouped[0].name).toBe('Grade 9 - A')
    expect(grouped[0].grade).toBe(9)
    expect(grouped[0].level).toBe('Secondary')
  })

  test('"Grade 9 - A" MERGES with "Class 9" — same academic grade (the grouping purpose, pinned)', () => {
    const grouped = map([row('Class 9', null, 'A'), row('Grade 9 - A', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G9')
    expect(grouped[0].grade).toBe(9)
    // both rows keep their own section chips inside the one grade group
    expect(grouped[0].sections.length).toBe(2)
  })

  test('"Class 0" → own named group (never the synthetic Grade 0), level = the unknown-grade bucket', () => {
    const grouped = map([row('Class 0', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('N:class 0')
    expect(grouped[0].name).toBe('Class 0')
    expect(grouped[0].grade).toBe(0)
    // documented ambiguity: "Class 0" is not in the pre-primary vocabulary
    // (some curricula would call it pre-primary — not guessed); the
    // established unknown-grade bucket applies.
    expect(grouped[0].level).toBe('Primary')
    expect(grouped[0].id).not.toBe('G0')
    expect(grouped.some((g) => g.name === 'Grade 0')).toBe(false)
  })

  test('"Class 0" never merges with "Nursery" or a real "Class 10"', () => {
    const grouped = map([row('Class 0', null, 'A'), row('Nursery', null, 'A'), row('Class 10', null, 'A')])
    expect(grouped.length).toBe(3)
    expect(grouped.map((g) => g.id).sort()).toEqual(['G10', 'N:class 0', 'N:nursery'])
  })

  test('"Class 01" → grade 1 (zero-padding does not split the grade), merges with "Class 1"/stored-"1" rows', () => {
    const grouped = map([row('1-A', '1', 'A'), row('Class 1', null, 'B'), row('Class 01', null, 'C')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G1')
    expect(grouped[0].grade).toBe(1)
    expect(grouped[0].level).toBe('Primary')
    // label follows the first row the API returns (stored-grade row here);
    // sections from all three rows are preserved
    expect(grouped[0].name).toBe('Grade 1')
    expect(grouped[0].sections.map((s) => s.name).sort()).toEqual(['A', 'B', 'C'])
  })

  test('"Class 01" standalone → labeled with its real name', () => {
    const grouped = map([row('Class 01', null, 'A')])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G1')
    expect(grouped[0].name).toBe('Class 01')
    expect(grouped[0].grade).toBe(1)
  })

  test('API-FORBIDDEN empty/whitespace names: mapper never crashes (defensive pin)', () => {
    // No write path can emit these rows today (wizard safeText(40).min(1),
    // POST /api/classes 'Class name is required', publish .filter(Boolean))
    // — this pin only documents the shared mapper's defensive behavior for
    // any future write path: no throw, isolated group, no numeric 0.
    const grouped = map([row('', null, 'A'), row('   ', null, 'B')])
    expect(grouped.length).toBe(1) // both trim to the same normalized name
    expect(grouped[0].id).toBe('N:')
    expect(grouped[0].grade).toBe(0)
    expect(grouped[0].sections.map((s) => s.name).sort()).toEqual(['A', 'B'])
    expect(grouped.some((g) => g.id.startsWith('G'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 7. Mixed stored-grade + NULL rows — same academic grade, different
//    names (final-review follow-up: the exact mixed-data mission case)
// ─────────────────────────────────────────────────────────────────────

/** Minimal RosterStudentDto factory (field-mirrors the roster contract). */
function stu(id: string, classId: string) {
  return {
    id,
    userId: `u-${id}`,
    name: `Student ${id}`,
    email: `${id}@wizard.test`,
    status: 'ACTIVE',
    rollNo: '01',
    admissionNo: `ADM-${id}`,
    classId,
    guardianName: null,
    guardianPhone: null,
    guardianEmail: null,
    dob: null,
    gender: null,
    bloodGroup: null,
    address: null,
    routeName: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    attendance: { pct: null, records: 0, present: 0, absent: 0, late: 0, leave: 0, monthly: [] },
    latestExam: null,
    fees: { totalBilled: 0, totalPaid: 0, outstanding: 0, status: 'NONE', awaitingVerification: 0 },
    growthPoints: 0,
    behaviorCount: 0,
  }
}

describe('mapRosterToRecords — mixed stored-grade + NULL rows, same academic grade (final-review follow-up)', () => {
  const legacyRow = row('6-A', '6', 'A') // valid stored grade, legacy name
  const wizardRow = row('Class 6', null, 'B') // NULL grade, wizard name

  test('stored-grade-first order: ONE G6 group, both sections, label "Grade 6"', () => {
    const grouped = map([legacyRow, wizardRow])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G6')
    expect(grouped[0].grade).toBe(6)
    expect(grouped[0].name).toBe('Grade 6')
    expect(grouped[0].sections.map((s) => s.name).sort()).toEqual(['A', 'B'])
  })

  test('wizard-row-first order: still ONE G6 group; the label follows the first row (documented)', () => {
    // Both labels are truthful for the merged grade group; which one shows
    // depends on roster order (stored grades sort before NULLs on the API)
    // — deterministic per order, documented in CLASS-GROUPING-POLICY §4.
    const grouped = map([wizardRow, legacyRow])
    expect(grouped.length).toBe(1)
    expect(grouped[0].id).toBe('G6')
    expect(grouped[0].name).toBe('Class 6')
    expect(grouped[0].sections.map((s) => s.name).sort()).toEqual(['A', 'B'])
  })

  test('students on BOTH rows resolve to the SAME group id and label with their own sections', () => {
    const { students } = mapRosterToRecords({
      classes: [legacyRow, wizardRow],
      subjects: [],
      teachers: [],
      students: [stu('legacy', legacyRow.id), stu('wizard', wizardRow.id)],
    } as never)
    expect(students.length).toBe(2)
    for (const s of students) {
      expect(s.classId).toBe('G6')
      expect(s.className).toBe('Grade 6') // label of the one shared group
    }
    expect(students.find((s) => s.id === 'legacy')?.section).toBe('A')
    expect(students.find((s) => s.id === 'wizard')?.section).toBe('B')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 8. Student resolution invariants across the unusual-name universe
//    (final-review follow-up: classId/className must resolve to a real
//    grouped ClassRecord for EVERY student, on every rule path)
// ─────────────────────────────────────────────────────────────────────

describe('mapRosterToRecords — student classId/className resolve to the correct ClassRecord (final-review follow-up)', () => {
  const corpus = [
    row('Nursery', null, 'A'), // rule 3, pre-primary
    row('Nursery 2', null, 'A'), // rule 3 (pre-primary-first), number-bearing
    row('Class 0', null, 'A'), // rule 3, "0" invalid as grade
    row('Class 01', null, 'A'), // rule 2, zero-padded
    row('Batch 2026', null, 'A'), // rule 2, year edge
    row('Grade 9 - A', null, 'A'), // rule 2, publish shape
    row('6-A', '6', 'A'), // rule 1, valid stored grade
    row('Class 6', null, 'B'), // rule 2 → SAME G6 group as 6-A (mixed data)
  ]

  test('every student lands on exactly one ClassRecord whose id and name match their fields', () => {
    const { students, classes } = mapRosterToRecords({
      classes: corpus,
      subjects: [],
      teachers: [],
      students: corpus.map((c, i) => stu(`s${i}`, c.id)),
    } as never)
    expect(students.length).toBe(corpus.length)
    for (const s of students) {
      const record = classes.find((c) => c.id === s.classId)
      expect(record).toBeTruthy() // classId resolves to a REAL grouped record
      expect(record!.name).toBe(s.className) // className is that record's label
      expect(record!.sections.some((sec) => sec.name === s.section)).toBe(true)
    }
  })

  test('named-group students get the named keys; mixed-grade students share the G6 group', () => {
    const { students } = mapRosterToRecords({
      classes: corpus,
      subjects: [],
      teachers: [],
      students: corpus.map((c, i) => stu(`s${i}`, c.id)),
    } as never)
    const byId = new Map(students.map((s) => [s.id, s]))
    expect(byId.get('s0')?.classId).toBe('N:nursery')
    expect(byId.get('s0')?.className).toBe('Nursery')
    expect(byId.get('s1')?.classId).toBe('N:nursery 2')
    expect(byId.get('s1')?.className).toBe('Nursery 2')
    expect(byId.get('s2')?.classId).toBe('N:class 0')
    expect(byId.get('s2')?.className).toBe('Class 0')
    expect(byId.get('s3')?.classId).toBe('G1')
    expect(byId.get('s4')?.classId).toBe('G2026')
    expect(byId.get('s4')?.className).toBe('Batch 2026')
    // the mixed-data pair: both on G6, one shared label, own sections
    expect(byId.get('s6')?.classId).toBe('G6')
    expect(byId.get('s7')?.classId).toBe('G6')
    expect(byId.get('s6')?.className).toBe(byId.get('s7')?.className)
    expect(byId.get('s6')?.section).toBe('A')
    expect(byId.get('s7')?.section).toBe('B')
  })
})
