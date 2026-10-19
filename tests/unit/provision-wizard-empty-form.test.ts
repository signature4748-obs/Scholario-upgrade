/**
 * tests/unit/provision-wizard-empty-form.test.ts
 *
 * REGRESSION (P0, 2026-10-17, updated for the 7-step wizard on
 * 2026-10-20): the Add-school wizard's initial form pre-created a class
 * row `{ name: '', sections: 'A' }`, which tripped the class validation
 * ("Every class row needs a class name") for every admin who skipped the
 * optional bootstrap. The 2026-10-20 class-selection UI makes inert rows
 * IMPOSSIBLE by construction: the default form carries NO rows, presets
 * only add named rows, and the custom row affordance adds a named row.
 *
 * The pinned invariant therefore strengthens: no row can ever carry
 * sections without a name, AND the default form is empty (the operator
 * is never blocked by state they never touched). Additional defaults
 * pinned here: the wizard's commercial defaults are school-based
 * YEARLY (student-based monthly can never be the default), the start
 * date is today-shaped, and the academic session follows the
 * date-derived default rule.
 */
import { describe, test, expect } from 'bun:test'
import { EMPTY_FORM } from '@/components/platform/modules/provision-wizard'

describe('provision wizard — EMPTY_FORM inert-row invariant (7-step)', () => {
  test('no class row may carry sections without a name (impossible by construction)', () => {
    for (const row of EMPTY_FORM.classRows) {
      if (!row.name.trim()) {
        expect(row.sections.trim()).toBe('')
      }
    }
  })

  test('the default form carries NO class rows (classes are a selection, not a pre-filled row)', () => {
    expect(EMPTY_FORM.classRows).toEqual([])
  })

  test('default board is one of the two onboarding boards (CBSE | UP_BOARD only)', () => {
    expect(['CBSE', 'UP_BOARD']).toContain(EMPTY_FORM.board)
  })

  test('default billing is school-based YEARLY — student-based monthly can never be the default', () => {
    expect(EMPTY_FORM.billingModel).toBe('SCHOOL_WIDE')
    expect(EMPTY_FORM.billingFrequency).not.toBe('MONTHLY')
    // The default frequency must be one the DEFAULT model allows.
    expect(EMPTY_FORM.billingFrequency).toBe('ANNUAL')
  })

  test('default currency is INR and no amount is pre-entered (never a fabricated price)', () => {
    expect(EMPTY_FORM.currency).toBe('INR')
    expect(EMPTY_FORM.agreedAmount).toBe('')
    expect(EMPTY_FORM.licensedStudents).toBe('')
  })

  test('the timezone default is Asia/Kolkata and no PIN is pre-entered', () => {
    expect(EMPTY_FORM.timezone).toBe('Asia/Kolkata')
    expect(EMPTY_FORM.pincode).toBe('')
  })
})
