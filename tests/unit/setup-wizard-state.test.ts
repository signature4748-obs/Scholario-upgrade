/**
 * PHASE 2 — SUPER ADMIN SCHOOL SETUP WIZARD — unit tests for the shared
 * state model (src/lib/platform/setup-wizard-state.ts).
 *
 * The module is PURE (no DB, no React): these tests pin the wizard's
 * step derivation and the activation-requirements derivation that BOTH
 * the wizard UI (guidance) and the activate route (enforcement) consume.
 * One derivation, three consumers — a client can never assert completion.
 */
import { describe, test, expect } from 'bun:test'

import {
  WIZARD_STEP_IDS,
  WIZARD_REQUIRED_STEP_IDS,
  deriveWizardSteps,
  computeActivationRequirements,
  identityCoreComplete,
  type WizardSchoolSnapshot,
  type WizardExtraCounts,
} from '../../src/lib/platform/setup-wizard-state'
import type { SetupReadiness } from '../../src/lib/school/setup-readiness'

// ── Fixtures ────────────────────────────────────────────────────────────

function snapshot(overrides: Partial<WizardSchoolSnapshot> = {}): WizardSchoolSnapshot {
  return {
    name: 'Test School',
    shortName: null,
    tagline: null,
    address: null,
    city: null,
    phone: null,
    email: null,
    website: null,
    established: null,
    academicYear: null,
    board: 'CBSE',
    status: 'PENDING',
    themeColor: '#0f766e',
    accentColor: '#f59e0b',
    logoUrl: null,
    faviconUrl: null,
    location: {
      state: null,
      district: null,
      pincode: null,
      country: null,
      timezone: null,
      workingDays: [],
    },
    ...overrides,
  }
}

function readiness(overrides: {
  sections?: Partial<Record<string, { done: boolean; counts?: Record<string, number> }>>
  requiredDone?: number
} = {}): SetupReadiness {
  const defaults: Record<string, { required: boolean; done: boolean; counts: Record<string, number> }> = {
    identity: { required: true, done: true, counts: { contactFields: 0, contactTotal: 6 } },
    principal: { required: true, done: true, counts: { principals: 1 } },
    branding: { required: false, done: false, counts: { brandAssets: 0, brandTotal: 4 } },
    academic: { required: true, done: false, counts: { classes: 0, subjects: 0 } },
    people: { required: true, done: false, counts: { teachers: 0, students: 0 } },
    rooms: { required: false, done: false, counts: { rooms: 0 } },
    fees: { required: true, done: false, counts: { feeStructures: 0, fees: 0 } },
    exams: { required: false, done: false, counts: { exams: 0 } },
    timetable: { required: false, done: false, counts: { timetableSlots: 0 } },
    website: { required: false, done: false, counts: { contentSections: 0, announcements: 0 } },
    domain: { required: false, done: false, counts: { verifiedDomains: 0 } },
  }
  for (const [id, patch] of Object.entries(overrides.sections ?? {})) {
    if (defaults[id]) {
      if (patch.done !== undefined) defaults[id].done = patch.done
      if (patch.counts) defaults[id].counts = { ...defaults[id].counts, ...patch.counts }
    }
  }
  const sections = Object.entries(defaults).map(([id, s]) => ({
    id,
    label: id,
    required: s.required,
    done: s.done,
    detail: '',
    counts: s.counts,
  }))
  const requiredSections = sections.filter((s) => s.required)
  const completedRequired = requiredSections.filter((s) => s.done).length
  return {
    school: { id: 'school-1', name: 'Test School', status: 'PENDING' },
    sections,
    summary: {
      requiredTotal: requiredSections.length,
      requiredDone: overrides.requiredDone ?? completedRequired,
      requiredComplete: completedRequired === requiredSections.length,
      optionalDone: sections.filter((s) => !s.required && s.done).length,
      optionalTotal: sections.filter((s) => !s.required).length,
      usable: false,
    },
  }
}

const EMPTY_EXTRAS: WizardExtraCounts = {
  masterFeeHeads: 0,
  feeStructures: 0,
  examTypes: 0,
  gradeScales: 0,
  teachers: 0,
  schoolFlagOverrides: 0,
}

// ── Step catalogue ──────────────────────────────────────────────────────

describe('PHASE 2 wizard · step catalogue', () => {
  test('nine steps in the documented order, three required', () => {
    expect(WIZARD_STEP_IDS).toEqual([
      'identity',
      'branding',
      'academic',
      'principal',
      'people',
      'fees',
      'exams',
      'website',
      'modules',
    ])
    expect(WIZARD_REQUIRED_STEP_IDS).toEqual(['identity', 'academic', 'principal'])
  })

  test('deriveWizardSteps returns exactly the nine steps with labels', () => {
    const steps = deriveWizardSteps(snapshot(), readiness(), EMPTY_EXTRAS)
    expect(steps.map((s) => s.id)).toEqual([...WIZARD_STEP_IDS])
    for (const s of steps) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(['not_started', 'in_progress', 'completed']).toContain(s.status)
    }
  })

  test('optional/required classification matches the product rule', () => {
    const steps = deriveWizardSteps(snapshot(), readiness(), EMPTY_EXTRAS)
    const byId = new Map(steps.map((s) => [s.id, s]))
    // Required (block wizard-driven activation)
    for (const id of ['identity', 'academic', 'principal']) {
      expect(byId.get(id)!.optional).toBe(false)
    }
    // School-owned routine work stays optional
    for (const id of ['branding', 'people', 'fees', 'exams', 'website', 'modules']) {
      expect(byId.get(id)!.optional, `${id} must be optional`).toBe(true)
    }
  })
})

// ── Step derivation ─────────────────────────────────────────────────────

describe('PHASE 2 wizard · step derivation from persisted state', () => {
  test('freshly provisioned school: honest zero-progress except the guaranteed principal', () => {
    const steps = deriveWizardSteps(snapshot(), readiness(), EMPTY_EXTRAS)
    const byId = new Map(steps.map((s) => [s.id, s]))
    expect(byId.get('identity')!.status).toBe('not_started') // zero contact fields persisted
    expect(byId.get('principal')!.status).toBe('completed') // provisioning guarantees one
    expect(byId.get('academic')!.status).toBe('not_started')
    expect(byId.get('people')!.status).toBe('not_started')
    expect(byId.get('modules')!.status).toBe('not_started')
  })

  test('a partial contact block is honestly in_progress', () => {
    const steps = deriveWizardSteps(
      snapshot({ address: 'A', city: 'C' }),
      readiness(),
      EMPTY_EXTRAS,
    )
    expect(steps.find((s) => s.id === 'identity')!.status).toBe('in_progress')
  })

  test('identity completes only with the FULL core contact block', () => {
    const base = { name: 'S' }
    const partial = snapshot({ ...base, address: 'A', city: 'C', phone: 'P' })
    expect(identityCoreComplete(partial)).toBe(false)
    const steps = deriveWizardSteps(partial, readiness(), EMPTY_EXTRAS)
    expect(steps.find((s) => s.id === 'identity')!.status).toBe('in_progress')

    const full = snapshot({ ...base, address: 'A', city: 'C', phone: 'P', email: 'e@s.test' })
    expect(identityCoreComplete(full)).toBe(true)
    const done = deriveWizardSteps(full, readiness(), EMPTY_EXTRAS)
    expect(done.find((s) => s.id === 'identity')!.status).toBe('completed')
  })

  test('academic mirrors the readiness rule: year AND classes', () => {
    const yearOnly = deriveWizardSteps(
      snapshot({ academicYear: '2026-2027' }),
      readiness({ sections: { academic: { done: false, counts: { classes: 0 } } } }),
      EMPTY_EXTRAS,
    )
    expect(yearOnly.find((s) => s.id === 'academic')!.status).toBe('in_progress')

    const both = deriveWizardSteps(
      snapshot({ academicYear: '2026-2027' }),
      readiness({ sections: { academic: { done: true, counts: { classes: 3 } } } }),
      EMPTY_EXTRAS,
    )
    expect(both.find((s) => s.id === 'academic')!.status).toBe('completed')
  })

  test('fees step completes on wizard catalogue heads OR readiness structures', () => {
    const viaCatalogue = deriveWizardSteps(
      snapshot(),
      readiness(),
      { ...EMPTY_EXTRAS, masterFeeHeads: 4 },
    )
    expect(viaCatalogue.find((s) => s.id === 'fees')!.status).toBe('completed')

    const viaStructures = deriveWizardSteps(
      snapshot(),
      readiness({ sections: { fees: { done: true } } }),
      EMPTY_EXTRAS,
    )
    expect(viaStructures.find((s) => s.id === 'fees')!.status).toBe('completed')
  })

  test('exams step completes on wizard exam types OR readiness exam instances', () => {
    const viaTypes = deriveWizardSteps(snapshot(), readiness(), { ...EMPTY_EXTRAS, examTypes: 3 })
    expect(viaTypes.find((s) => s.id === 'exams')!.status).toBe('completed')
  })

  test('modules step completes only on EXPLICIT school overrides', () => {
    const withOverride = deriveWizardSteps(snapshot(), readiness(), { ...EMPTY_EXTRAS, schoolFlagOverrides: 1 })
    expect(withOverride.find((s) => s.id === 'modules')!.status).toBe('completed')
    const without = deriveWizardSteps(snapshot(), readiness(), EMPTY_EXTRAS)
    expect(without.find((s) => s.id === 'modules')!.status).toBe('not_started')
  })
})

// ── Activation requirements ─────────────────────────────────────────────

describe('PHASE 2 wizard · activation requirements (server-validated)', () => {
  test('non-strict: blocks ONLY on a missing principal; reports missing items', () => {
    const req = computeActivationRequirements(snapshot(), readiness(), 0, false, false)
    expect(req.ok).toBe(false)
    expect(req.missing.map((m) => m.id)).toEqual(['principal'])
    expect(req.strict).toBe(false)
  })

  test('non-strict: incomplete academic/identity never blocks (lifecycle invariant)', () => {
    const req = computeActivationRequirements(snapshot(), readiness(), 1, false, false)
    expect(req.ok).toBe(true)
    expect(req.missing).toEqual([])
  })

  test('strict: identity core + academic + principal all enforced', () => {
    // Nothing configured
    const none = computeActivationRequirements(snapshot(), readiness(), 1, true, false)
    expect(none.ok).toBe(false)
    expect(new Set(none.missing.map((m) => m.id))).toEqual(new Set(['identity', 'academic']))

    // Identity + academic done → ok
    const full = computeActivationRequirements(
      snapshot({ address: 'A', city: 'C', phone: 'P', email: 'e@s.test' }),
      readiness({ sections: { academic: { done: true, counts: { classes: 2 } } } }),
      1,
      true,
      true,
    )
    expect(full.ok).toBe(true)
    expect(full.missing).toEqual([])
  })

  test('strict: missing principal still blocks first', () => {
    const req = computeActivationRequirements(snapshot(), readiness(), 0, true, true)
    expect(req.ok).toBe(false)
    expect(req.missing.map((m) => m.id)).toContain('principal')
  })

  test('people/fees never appear in the activation checklist (optional by product rule)', () => {
    const req = computeActivationRequirements(snapshot(), readiness(), 0, true, false)
    expect(req.missing.map((m) => m.id)).not.toContain('people')
    expect(req.missing.map((m) => m.id)).not.toContain('fees')
  })
})
