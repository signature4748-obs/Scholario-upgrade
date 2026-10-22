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
