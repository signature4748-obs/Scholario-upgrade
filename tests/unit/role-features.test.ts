/**
 * PHASE 3 — ROLE-WISE FEATURE CONTROL — catalog & validation contract (unit).
 *
 * Pure-module tests (no DB, no HTTP):
 *   1. CATALOG INTEGRITY — unique keys, real groups, exactly one baseline
 *      kind, permission keys exist in the server matrix, explicit
 *      baselines are canonical roles only. A catalog entry that drifts
 *      from the enforced vocabulary must fail HERE, never at runtime.
 *   2. BASELINE TRUTH TABLE — featureBaselineAllows mirrors can() for
 *      permission-backed entries and the canonical role set for
 *      explicit-baseline entries; unknown roles fail closed.
 *   3. CHANGE VALIDATION — validateRoleFeatureChanges rejects unknown
 *      roles/features, non-boolean denied values, duplicates, junk
 *      shapes, and (critically) a DENIAL where the role baseline refuses
 *      the feature (the layer is remove-only — a stored denial that the
 *      baseline doesn't grant would be dead data).
 */
import { describe, expect, test } from 'bun:test'

import {
  ROLE_FEATURE_CATALOG,
  FEATURE_GROUPS,
  featureDef,
  isKnownFeatureKey,
  featureBaselineAllows,
  validateRoleFeatureChanges,
} from '@/lib/security/role-features'
import { PERMISSIONS, CANONICAL_SCHOOL_ROLES, can } from '@/lib/security/permissions'

describe('role-features catalog integrity', () => {
  test('every key is unique and non-empty', () => {
    const keys = ROLE_FEATURE_CATALOG.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k.length).toBeGreaterThan(3)
  })

  test('every entry has a known group and human label/description', () => {
    for (const f of ROLE_FEATURE_CATALOG) {
      expect(FEATURE_GROUPS).toContain(f.group)
      expect(f.label.length).toBeGreaterThan(2)
      expect(f.description.length).toBeGreaterThan(10)
      // The UI never shows raw keys as the primary label.
      expect(f.label).not.toBe(f.key)
    }
  })

  test('every entry has EXACTLY one baseline kind', () => {
    for (const f of ROLE_FEATURE_CATALOG) {
      expect(Boolean(f.permission) !== Boolean(f.baselineRoles)).toBe(true)
    }
  })

  test('permission-backed entries reference REAL server-matrix capabilities', () => {
    for (const f of ROLE_FEATURE_CATALOG) {
      if (!f.permission) continue
      expect(PERMISSIONS[f.permission]).toBeDefined()
    }
  })

  test('explicit baselines use canonical school roles ONLY', () => {
    for (const f of ROLE_FEATURE_CATALOG) {
      if (!f.baselineRoles) continue
      expect(f.baselineRoles.length).toBeGreaterThan(0)
      for (const r of f.baselineRoles) {
        expect(CANONICAL_SCHOOL_ROLES).toContain(r)
      }
    }
  })

  test('featureDef / isKnownFeatureKey agree with the catalog', () => {
    for (const f of ROLE_FEATURE_CATALOG) {
      expect(featureDef(f.key)?.key).toBe(f.key)
      expect(isKnownFeatureKey(f.key)).toBe(true)
    }
    expect(featureDef('no.such.feature')).toBeNull()
    expect(isKnownFeatureKey('no.such.feature')).toBe(false)
  })

  test('the catalog covers every canonical role with configurable cells', () => {
    // PRINCIPAL and TEACHER have broad configurable surfaces; STUDENT's
    // self-service surfaces are mostly scoped routes without per-feature
    // guards, so v1 wires exactly what enforcement exists (documented
    // known limitation — never a fake toggle).
    for (const role of ['PRINCIPAL', 'TEACHER'] as const) {
      const configurable = ROLE_FEATURE_CATALOG.filter((f) => featureBaselineAllows(f, role))
      expect(configurable.length).toBeGreaterThan(3)
    }
    const studentConfigurable = ROLE_FEATURE_CATALOG.filter((f) => featureBaselineAllows(f, 'STUDENT'))
    expect(studentConfigurable.length).toBeGreaterThanOrEqual(1)
    expect(studentConfigurable.map((f) => f.key)).toContain('attendance.student.view')
  })
})

describe('role-features baseline truth table', () => {
  test('permission-backed entries resolve through can() for canonical roles', () => {
    const marks = featureDef('exams.marks.write')!
    expect(marks.permission).toBe('exams.marks.write')
    for (const role of CANONICAL_SCHOOL_ROLES) {
      expect(featureBaselineAllows(marks, role)).toBe(can(role, 'exams.marks.write'))
    }
    // Non-canonical roles are refused by the FEATURE layer even where the
    // raw matrix would grant them — they can never authenticate to the
    // school plane (withUser canonical invariant), so granting would be
    // meaningless. Deliberately narrower than can().
    for (const role of ['MANAGEMENT', 'ACCOUNTANT', 'PARENT', 'DRIVER', 'SUPER_ADMIN']) {
      expect(featureBaselineAllows(marks, role)).toBe(false)
    }
  })

  test('explicit-baseline entries mirror their canonical role set', () => {
    const att = featureDef('attendance.mark')!
    expect(att.baselineRoles).toEqual(['PRINCIPAL', 'TEACHER'])
    expect(featureBaselineAllows(att, 'PRINCIPAL')).toBe(true)
    expect(featureBaselineAllows(att, 'TEACHER')).toBe(true)
    expect(featureBaselineAllows(att, 'STUDENT')).toBe(false)
  })

  test('unknown / non-canonical roles fail closed', () => {
    const anyDef = ROLE_FEATURE_CATALOG[0]
    expect(featureBaselineAllows(anyDef, 'SUPER_ADMIN')).toBe(false)
    expect(featureBaselineAllows(anyDef, 'DRIVER')).toBe(false)
    expect(featureBaselineAllows(anyDef, '')).toBe(false)
    expect(featureBaselineAllows(anyDef, 'principal')).toBe(false) // case-sensitive canonical set
  })
})

describe('validateRoleFeatureChanges (remove-only enforcement)', () => {
  test('accepts a valid mixed change-set', () => {
    const out = validateRoleFeatureChanges([
      { role: 'TEACHER', featureKey: 'school.homework.read', denied: true },
      { role: 'TEACHER', featureKey: 'attendance.mark', denied: false },
    ])
    expect(out.length).toBe(2)
    expect(out[0]).toEqual({ role: 'TEACHER', featureKey: 'school.homework.read', denied: true })
  })

  test('rejects unknown feature keys (fail closed)', () => {
    expect(() =>
      validateRoleFeatureChanges([{ role: 'TEACHER', featureKey: 'made.up.feature', denied: true }]),
    ).toThrow()
  })

  test('rejects unknown / non-canonical roles', () => {
    expect(() =>
      validateRoleFeatureChanges([{ role: 'PARENT', featureKey: 'attendance.mark', denied: true }]),
    ).toThrow()
    expect(() =>
      validateRoleFeatureChanges([{ role: 'teacher', featureKey: 'attendance.mark', denied: true }]),
    ).toThrow()
  })

  test('rejects non-boolean denied values', () => {
    expect(() =>
      validateRoleFeatureChanges([{ role: 'TEACHER', featureKey: 'attendance.mark', denied: 'yes' }]),
    ).toThrow()
  })

  test('rejects a DENIAL the role baseline refuses (remove-only)', () => {
    // STUDENT baseline refuses attendance.mark → a denial would be dead data.
    expect(() =>
      validateRoleFeatureChanges([{ role: 'STUDENT', featureKey: 'attendance.mark', denied: true }]),
    ).toThrow()
    // Same for a permission-backed key the baseline refuses.
    expect(() =>
      validateRoleFeatureChanges([{ role: 'STUDENT', featureKey: 'exams.marks.write', denied: true }]),
    ).toThrow()
  })

  test('rejects duplicates, empty sets, and junk shapes', () => {
    expect(() =>
      validateRoleFeatureChanges([
        { role: 'TEACHER', featureKey: 'attendance.mark', denied: true },
        { role: 'TEACHER', featureKey: 'attendance.mark', denied: true },
      ]),
    ).toThrow()
    expect(() => validateRoleFeatureChanges([])).toThrow()
    expect(() => validateRoleFeatureChanges('not-an-array')).toThrow()
    expect(() => validateRoleFeatureChanges([{ role: 'TEACHER' }])).toThrow()
  })

  test('allows RE-ENABLING (denied:false) regardless of baseline state', () => {
    // Clearing an override is always safe (it can only widen BACK to the
    // baseline, never beyond it).
    const out = validateRoleFeatureChanges([
      { role: 'STUDENT', featureKey: 'exams.marks.write', denied: false },
    ])
    expect(out.length).toBe(1)
  })
})
