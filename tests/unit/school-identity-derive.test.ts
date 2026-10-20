/**
 * ADD-SCHOOL WIZARD (2026-10-20) — unit regression tests for the shared
 * identity derivations (mission §8 acceptance #1–#5, #9).
 *
 * These functions are the ONE implementation used by BOTH the wizard's
 * live previews and the server's provision/precheck routes; the prefix
 * abbreviation rule additionally mirrors the deterministic SQL backfill
 * in prisma/migrations/…__school_record_prefix_billing_terms (the
 * migration's per-abbrev sequence space must stay identical).
 *
 * Acceptance mapping:
 *   #3  short name, slug and abbreviation generation
 *   #5  the abbreviation is a stable function of the ORIGINAL name only
 *        (never re-derived; the number comes from the allocator)
 *   #9  student-based billing NEVER offers a monthly frequency (the
 *        shared options rule the wizard's selector AND mirrors the
 *        server-side cross-field rejection)
 */
import { describe, test, expect } from 'bun:test'

import {
  BILLING_MODEL_OPTIONS,
  defaultAcademicSession,
  deriveShortName,
  frequencyOptionsFor,
  schoolPrefixAbbreviation,
  slugifyName,
  suggestSlugAlternatives,
} from '../../src/lib/school/identity-derive'

describe('school-identity-derive — record-prefix abbreviation', () => {
  test('initials of up to five words: "Green Valley Public School" → GVPS', () => {
    expect(schoolPrefixAbbreviation('Green Valley Public School')).toBe('GVPS')
  })

  test('all significant words contribute: "Hawkings High School Prithvipur" → HHSP', () => {
    expect(schoolPrefixAbbreviation('Hawkings High School Prithvipur')).toBe('HHSP')
  })

  test('capped at five words: "A B C D E F" → ABCDE', () => {
    expect(schoolPrefixAbbreviation('A B C D E F')).toBe('ABCDE')
  })

  test('short result falls back to the first word: "Hawkings" → HAWK', () => {
    expect(schoolPrefixAbbreviation('Hawkings')).toBe('HAWK')
  })

  test('single-letter name gets X-padded to two chars: "A" → AX', () => {
    expect(schoolPrefixAbbreviation('A')).toBe('AX')
  })

  test('a name without alphanumeric words falls back to SCH', () => {
    expect(schoolPrefixAbbreviation('学校')).toBe('SCH')
    expect(schoolPrefixAbbreviation('')).toBe('SCH')
  })

  test('punctuation splits words like the SQL backfill: "St. Xavier\'s Boys Academy" → SXSBA', () => {
    expect(schoolPrefixAbbreviation("St. Xavier's Boys Academy")).toBe('SXSBA')
  })

  test('abbreviation is case-insensitive and separator-tolerant (the migration uppercases first)', () => {
    expect(schoolPrefixAbbreviation('green-valley public_school')).toBe('GVPS')
  })
})

describe('school-identity-derive — short display name', () => {
  test('first two significant words: "Green Valley Public School" → "Green Valley"', () => {
    expect(deriveShortName('Green Valley Public School')).toBe('Green Valley')
  })

  test('a single-word name stays whole', () => {
    expect(deriveShortName('Hawkings')).toBe('Hawkings')
  })

  test('capped at the 40-char column bound', () => {
    expect(deriveShortName('A '.repeat(60) + 'Z').length).toBeLessThanOrEqual(40)
  })
})

describe('school-identity-derive — URL slug', () => {
  test('slugifies the full official name', () => {
    expect(slugifyName('Green Valley Public School!')).toBe('green-valley-public-school')
  })

  test('collapses separators and trims hyphens', () => {
    expect(slugifyName('  St.   Xavier\'s -- Boys   Academy  ')).toBe('st-xavier-s-boys-academy')
  })

  test('empty / slugless names produce an empty slug (never a fake)', () => {
    expect(slugifyName('!!!')).toBe('')
  })

  test('capped at the 60-char API bound', () => {
    expect(slugifyName('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('school-identity-derive — slug collision suggestions', () => {
  test('deterministic -2, -3, -4 alternatives (availability is decided server-side)', () => {
    expect(suggestSlugAlternatives('green-valley')).toEqual([
      'green-valley-2',
      'green-valley-3',
      'green-valley-4',
    ])
  })
})

describe('school-identity-derive — billing model / frequency rules', () => {
  test('exactly two billing models are offered: school-based and student-based', () => {
    expect(BILLING_MODEL_OPTIONS.map((o) => o.value).sort()).toEqual(['PER_STUDENT', 'SCHOOL_WIDE'])
  })

  test('student-based offers YEARLY ONLY (monthly is never offered)', () => {
    const options = frequencyOptionsFor('PER_STUDENT')
    expect(options).toHaveLength(1)
    expect(options[0]?.value).toBe('ANNUAL')
  })

  test('school-based offers monthly and yearly', () => {
    expect(frequencyOptionsFor('SCHOOL_WIDE').map((o) => o.value)).toEqual(['MONTHLY', 'ANNUAL'])
  })
})

describe('school-identity-derive — academic session default', () => {
  test('October 2026 (Asia/Kolkata) → 2026-2027 (April–March year)', () => {
    expect(defaultAcademicSession(new Date('2026-10-19T22:00:00Z'), 'Asia/Kolkata')).toBe('2026-2027')
  })

  test('January 2027 (Asia/Kolkata) → 2026-2027 (still the prior April-started year)', () => {
    expect(defaultAcademicSession(new Date('2027-01-15T10:00:00Z'), 'Asia/Kolkata')).toBe('2026-2027')
  })

  test('April 2027 (Asia/Kolkata) → 2027-2028 (new session starts)', () => {
    expect(defaultAcademicSession(new Date('2027-04-01T05:00:00Z'), 'Asia/Kolkata')).toBe('2027-2028')
  })
})
