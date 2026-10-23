// PHASE 2/9 — Level-1 deterministic mapper reproduction (PRE-FIX).
//
// Safe evaluation of the repo's OWN canonical roster mapper
// (src/lib/store/students-store/server-sync.ts · mapRosterToRecords)
// against every payload shape the class-creation paths can produce.
// Pure function: NO database, NO network, NO fixture mutation.
//
// Mission STEP C matrix (mapper level):
//   A  Preset Class 1–12, section A            (wizard preset — the production shape)
//   B  Custom Class 1–12, section A            (same wire shape as A, operator-typed)
//   C  One class, sections A,B,C              (multi-section bootstrap)
//   D  Nursery/LKG/UKG (+IKG) custom rows     (pre-primary, gradeLevel NULL)
//   E  Class 9–10 and 11–12 presets            (subset presets)
//   F  No classes selected                    (empty classes[])
//   G  Empty/whitespace section input         (row with section null)
//   I  gradeLevel = NULL                       (wizard/`/api/classes` ''/publish shapes)
//   J  Valid numeric gradeLevel                (control — demo shape)
//   K  Demo-tenant naming                      (Hawkings shape: gradeLevel set incl. Nursery/LKG/IKG)
//   H (repeated submit) is an API-level property — see repro-live.ts.
//
// Run: bun run audit/phase2-provisioning-class-audit-20261023/repro-mapper.ts

import { mapRosterToRecords } from '../../src/lib/store/students-store/server-sync'

// Structural mirror of the unexported RosterClassDto (server-sync.ts:87).
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

function row(name: string, gradeLevel: string | null, section: string | null): RosterClassDto {
  return {
    id: `${name}-${section ?? 'NULL'}`,
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
  }
}

function payload(classes: RosterClassDto[]) {
  return { classes, subjects: [], teachers: [], students: [] }
}

/** Print one case: the input rows and the grouped output the UI would render. */
function caseReport(id: string, title: string, classes: RosterClassDto[]) {
  const { classes: grouped } = mapRosterToRecords(payload(classes))
  console.log(`\n=== ${id}: ${title} ===`)
  console.log(`input rows: ${classes.length}`)
  for (const c of classes) console.log(`  name=${JSON.stringify(c.name)} gradeLevel=${JSON.stringify(c.gradeLevel)} section=${JSON.stringify(c.section)}`)
  console.log(`grouped ClassRecords: ${grouped.length}`)
  for (const g of grouped)
    console.log(`  → id=${g.id} name=${JSON.stringify(g.name)} grade=${g.grade} level=${JSON.stringify(g.level)} sections=[${g.sections.map((s) => s.name).join(', ')}]`)
}

// ── A / B: wizard "Class 1–12" preset (the exact production shape observed
//    2026-10-22: 12 rows, name "Class 1".."Class 12", gradeLevel NULL, section 'A')
const preset12: RosterClassDto[] = Array.from({ length: 12 }, (_, i) => row(`Class ${i + 1}`, null, 'A'))
caseReport('A', 'Preset Class 1–12 with section A (PRODUCTION SHAPE — gradeLevel NULL)', preset12)
caseReport('B', 'Custom Class 1–12 with section A (operator-typed rows — identical wire shape)', preset12)

// ── C: one class, three sections
caseReport('C', 'One class with sections A, B, C (gradeLevel NULL)', [
  row('Class 5', null, 'A'),
  row('Class 5', null, 'B'),
  row('Class 5', null, 'C'),
])

// ── D: pre-primary custom rows (gradeLevel NULL)
caseReport('D', 'Nursery / LKG / UKG / IKG custom rows (gradeLevel NULL)', [
  row('Nursery', null, 'A'),
  row('LKG', null, 'A'),
  row('UKG', null, 'A'),
  row('IKG', null, 'A'),
])

// ── E: subset presets
caseReport('E1', 'Preset Class 9–10 (gradeLevel NULL)', [row('Class 9', null, 'A'), row('Class 10', null, 'A')])
caseReport('E2', 'Preset Class 11–12 with streams (gradeLevel NULL)', [
  { ...row('Class 11', null, 'A'), stream: 'Science' },
  { ...row('Class 12', null, 'A'), stream: 'Commerce' },
])

// ── F: no classes
caseReport('F', 'No classes selected (empty classes[])', [])

// ── G: empty section list → bootstrap writes ONE row with section NULL
caseReport('G', 'Row with section NULL (empty-section bootstrap path)', [row('Class 3', null, null)])

// ── I: gradeLevel NULL via the other two write paths
//   `/api/classes` writes `String(body.gradeLevel || '')` → '' when omitted
caseReport('I1', 'School-plane Add Class, gradeLevel omitted → persisted ""', [row('Class 6', '', 'A')])
//   `POST /api/timetable/publish` auto-create writes no gradeLevel, keeps the
//   full label as the name with a derived trailing-section letter
caseReport('I2', 'Timetable-publish auto-create (name "Grade 9 - A", gradeLevel NULL)', [row('Grade 9 - A', null, 'A')])

// ── J: control — valid numeric gradeLevel (demo shape, gradeLevel set)
caseReport('J', 'Control: valid numeric gradeLevel "1".."12" (12 rows)', Array.from({ length: 12 }, (_, i) => row(`${i + 1}-A`, String(i + 1), 'A')))

// ── K: demo-tenant naming (Hawkings corpus shape: gradeLevel set, incl. non-numeric)
caseReport('K', 'Demo-tenant corpus (names Nursery-A/LKG-A/IKG-A/1-A..12-A, gradeLevel set)', [
  row('Nursery-A', 'Nursery', 'A'),
  row('LKG-A', 'LKG', 'A'),
  row('IKG-A', 'IKG', 'A'),
  ...Array.from({ length: 12 }, (_, i) => row(`${i + 1}-A`, String(i + 1), 'A')),
])

// ── X: valid gradeLevel that DISAGREES with the name (policy probe)
caseReport('X', 'gradeLevel "7" on name "Class 9" (stored valid grade must win)', [row('Class 9', '7', 'A')])

// ── Y: arbitrary custom name without any number
caseReport('Y', 'Arbitrary custom name without digits (gradeLevel NULL)', [row('Diploma', null, 'A')])
