/**
 * tests/unit/provision-wizard-empty-form.test.ts
 *
 * REGRESSION (P0, 2026-10-17): the Add-school wizard's initial form
 * pre-created a class row `{ name: '', sections: 'A' }`. The step-3
 * validation rejects exactly that shape ("Every class row needs a class
 * name"), so every admin who left the optional academic-bootstrap section
 * untouched was blocked at Continue — the wizard's default state failed
 * its own validation. The submit path drops name-less rows, so an
 * untouched row must be inert: no name ⇒ no sections.
 *
 * This pins the invariant on EMPTY_FORM so it cannot silently regress.
 */
import { describe, test, expect } from 'bun:test'
import { EMPTY_FORM } from '@/components/platform/modules/provision-wizard'

describe('provision wizard — EMPTY_FORM inert-row invariant', () => {
  test('the initial class row is inert (no name ⇒ no sections)', () => {
    // The exact validation the wizard runs on step 3:
    //   if (!row.name.trim() && row.sections.trim()) → BLOCKED
    for (const row of EMPTY_FORM.classRows) {
      if (!row.name.trim()) {
        expect(row.sections.trim()).toBe('')
      }
    }
  })

  test('the default form has exactly one starter row', () => {
    expect(EMPTY_FORM.classRows.length).toBe(1)
  })
})
