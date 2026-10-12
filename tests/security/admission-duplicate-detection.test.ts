/**
 * ADMISSION-DUP — admission duplicate detection real-roster regression suite.
 *
 * The bug this pins (audit H1): the admission wizard's submit-time
 * duplicate check cross-checked the applicant against `students` imported
 * from `@/lib/mock/students` — 18 fabricated "Class 2-A" children — so
 *   · fabricated kids triggered duplicate WARNINGS (false positives), and
 *   · real enrolled students were silently NOT cross-checked (false
 *     negatives — the exact class of bug duplicate detection exists to
 *     prevent).
 *
 * The fix: the check runs against the canonical roster
 * (useStudentsStore — DB-hydrated via /api/students/roster; the principal
 * session syncs it at app root). The mock import is gone.
 *
 * Invariants under test:
 *
 *   1. SOURCE CONTRACT (fail-closed on drift):
 *      · use-admission-wizard.ts no longer imports from '@/lib/mock/students'
 *      · it reads the canonical roster via useStudentsStore
 *      · the roster mapping preserves the duplicate-key fields
 *        (name/admissionNo/dob/fatherName/guardian phone→parent phones/
 *        address→currentAddress)
 *   2. ENGINE CONTRACT (pure-function, real shapes): checkDuplicates with
 *      a DuplicateCheckable array shaped EXACTLY like the wizard's new
 *      roster mapping —
 *      · an applicant matching a REAL roster student by admissionNo →
 *        strongest-match surfaces with source 'student'
 *      · a clearly-unrelated applicant → matchType 'none'
 *      · empty roster (sync not landed / empty school) → 'none', never a
 *        fabricated match
 *   3. DEMO-CORPUS INDEPENDENCE: the old mock universe (Aarav Sharma /
 *     STU-xxx corpus) can never again produce a match when it is not in
 *      the passed roster.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'
import {
  checkDuplicates,
  type DuplicateMatch,
} from '@/components/principal/modules/admission/lib/duplicate-detection'
import type { DuplicateDetectionConfig } from '@/lib/store/school-settings-store'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

const CONFIG: DuplicateDetectionConfig = {
  enabled: true,
  blockThreshold: 85,
  // Multi-field accumulation is what the thresholds consume in practice
  // (a single field match is intentionally never enough on its own);
  // 30 lets phone(20)+father(15) reach a warn in this suite.
  warnThreshold: 30,
  checkKeys: {
    aadhaar: true,
    nameDob: true,
    parentPhone: true,
    parents: true,
    previousSchool: true,
    address: true,
  },
}

/** The exact mapping shape the wizard now builds from StudentRecord. */
function rosterEntry(s: {
  id: string
  name: string
  className: string
  admissionNo: string
  dob?: string
  fatherName?: string
  motherName?: string
  guardianPhone?: string
  address?: string
}) {
  return {
    id: s.id,
    name: s.name,
    className: s.className,
    admissionNo: s.admissionNo,
    dob: s.dob || undefined,
    fatherName: s.fatherName || undefined,
    motherName: s.motherName || undefined,
    fatherPhone: s.guardianPhone || undefined,
    motherPhone: s.guardianPhone || undefined,
    currentAddress: s.address || undefined,
  }
}

// ─── 1. source contract ──────────────────────────────────────────────────

describe('ADMISSION-DUP · wizard cross-checks the canonical roster (source contract)', () => {
  const WIZARD = 'src/components/principal/modules/admission/lib/use-admission-wizard.ts'

  test('the mock student corpus import is gone', () => {
    expect(read(WIZARD)).not.toContain("from '@/lib/mock/students'")
  })

  test('the roster comes from the canonical students store', () => {
    const src = read(WIZARD)
    expect(src).toContain('useStudentsStore')
    expect(src).toMatch(/useStudentsStore\s*\n?\s*\.getState\(\)\s*\n?\s*\.students/)
  })

  test('the roster mapping preserves the duplicate-key fields', () => {
    const src = read(WIZARD)
    // identity keys
    expect(src).toMatch(/name: s\.name,/)
    expect(src).toMatch(/admissionNo: s\.admissionNo,/)
    expect(src).toMatch(/dob: s\.dob \|\| undefined,/)
    // guardian contact maps onto the parent-phone duplicate keys
    expect(src).toMatch(/fatherPhone: s\.guardianPhone \|\| undefined,/)
    expect(src).toMatch(/motherPhone: s\.guardianPhone \|\| undefined,/)
    // home address maps onto the address duplicate key
    expect(src).toMatch(/currentAddress: s\.address \|\| undefined,/)
  })
})

// ─── 2. engine contract with the wizard's mapping shape ──────────────────

describe('ADMISSION-DUP · checkDuplicates against the real-roster mapping shape', () => {
  const roster = [
    rosterEntry({
      id: 'stu-real-1',
      name: 'Meera Nandan',
      className: 'Grade 4 - A',
      admissionNo: 'GVPS-2026-0041',
      dob: '2017-06-12',
      fatherName: 'Nandan Kulkarni',
      guardianPhone: '9876543210',
      address: '12 Lakeview Road, Pune',
    }),
  ]

  const applicant = (over: Record<string, string>): Record<string, string> => ({
    firstName: 'New',
    lastName: 'Applicant',
    dob: '',
    aadhaarNo: '',
    fatherName: '',
    motherName: '',
    fatherPhone: '',
    motherPhone: '',
    currentAddress: '',
    previousSchool: '',
    ...over,
  })

  test('applicant matching the roster guardian phone + father name → warn match (source student)', () => {
    // The roster's single guardian contact maps onto the parent-phone
    // duplicate keys — a sibling applying with the same home phone and
    // father must surface a warning (the same-family re-admission probe).
    const match: DuplicateMatch = checkDuplicates(
      applicant({ firstName: 'Ishita', lastName: 'Nandan', fatherPhone: '9876543210', fatherName: 'Nandan Kulkarni' }) as never,
      CONFIG,
      roster,
      [],
    )
    expect(match.matchType).toBe('warn')
    expect(match.matchedFields).toContain('Father Phone')
    expect(match.matchedFields).toContain('Father Name')
    expect(match.existingRecord.source).toBe('student')
    expect(match.existingRecord.id).toBe('stu-real-1')
  })

  test('applicant matching name + dob + father → match (the classic re-admission case)', () => {
    const match = checkDuplicates(
      applicant({ firstName: 'Meera', lastName: 'Nandan', dob: '2017-06-12', fatherName: 'Nandan Kulkarni' }) as never,
      CONFIG,
      roster,
      [],
    )
    expect(match.matchType).not.toBe('none')
    expect(match.existingRecord.source).toBe('student')
  })

  test('clearly-unrelated applicant → none', () => {
    const match = checkDuplicates(
      applicant({ firstName: 'Kabir', lastName: 'Sethi', dob: '2016-01-04' }) as never,
      CONFIG,
      roster,
      [],
    )
    expect(match.matchType).toBe('none')
  })

  test('empty roster (sync not landed / honest-empty school) → none, never fabricated', () => {
    const match = checkDuplicates(applicant({ firstName: 'Meera', lastName: 'Nandan' }) as never, CONFIG, [], [])
    expect(match.matchType).toBe('none')
  })
})

// ─── 3. demo-corpus independence ──────────────────────────────────────────

describe('ADMISSION-DUP · the retired mock corpus cannot produce matches', () => {
  test('a mock-universe applicant does not match when the corpus is not the passed roster', () => {
    // The fabricated corpus' flagship child (audit H1: this exact record
    // used to trigger false-positive warnings for real applicants).
    const mockUniverseChild = { firstName: 'Aarav', lastName: 'Sharma', dob: '2015-03-14' }
    const match = checkDuplicates(
      mockUniverseChild as never,
      CONFIG,
      [
        rosterEntry({
          id: 'stu-real-2',
          name: 'Anika Rao',
          className: 'Grade 6 - B',
          admissionNo: 'GVPS-2026-0099',
          dob: '2014-11-02',
          fatherName: 'Deepak Rao',
        }),
      ],
      [],
    )
    expect(match.matchType).toBe('none')
  })
})
