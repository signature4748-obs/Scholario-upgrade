/**
 * ADMISSION-FEE-HONESTY — three-state fee semantics regression suite.
 *
 * The bugs this pins (prior audit PRIORITIZED_REPAIR_BACKLOG §B, findings
 * F1/F2/F3/F5/F7/F8 + the id-minting residue):
 *
 *   · FABRICATED FALLBACK AMOUNTS: `|| 1500`, `|| 15000`, `|| 60000`
 *     fed the admission wizard + official documents whenever fee heads
 *     were missing — a real tenant's letter carried invented amounts as
 *     if configured.
 *   · F5 DEMO DEFAULTS AS AUTHORITY: defaultSchoolSettings shipped 8 fee
 *     heads, 19 fabricated book entries (NCERT/Oxford/Camlin…), 6
 *     discount rules and exam fees for EVERY tenant.
 *   · AUTO-GENERATED BOOKS: an unconfigured class got 6 invented
 *     NCERT/Oxford titles at made-up prices.
 *   · F7/F8 ₹0-ON-DOCUMENTS: FeeBreakdownTable/letter-html turned
 *     missing amounts into ₹0 rows on the official letter.
 *   · ID MINTING: the letter minted random SCH-ADM-…/SCH-STU-…/REG-…
 *     ids for non-enrolled applications — fake official identifiers.
 *
 * Invariants under test (PR-3 spec):
 *   1. THREE-STATE: configured amount / explicit ₹0 / MISSING →
 *      undefined ("Not configured") — never a fallback literal.
 *   2. Totals that omit an unconfigured component are undefined too.
 *   3. The fabricated fee corpus is DEMO-TIER only (getSchoolSettings
 *      composes it exclusively for School.isDemo; real tenants see empty
 *      blocks — and the composition re-evaluates when the async demo
 *      signal arrives).
 *   4. Official documents render "Not configured" for missing heads and
 *      never print a fabricated ₹0; ids render pending placeholders.
 *   5. The dead mock/finance import is gone from the wizard pipeline.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/repo-root'

import {
  defaultSchoolSettings,
  demoFeeSettings,
  getSchoolSettings,
  resetSchoolSettingsCache,
} from '@/lib/school-settings'
import { computeFeeSnapshot } from '@/components/principal/modules/FeeStructureStep/fee-snapshot'
import { defaultFeeDataState } from '@/components/principal/modules/FeeStructureStep/types'
import { useCurrentUser } from '@/lib/store/current-user-store'

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8')

// The bun-test environment has no session — readIsDemoTenant() is false,
// so these unit tests exercise the REAL-TENANT path by construction.

describe('ADMISSION-FEE-HONESTY · three-state derivation (real tenant)', () => {
  test('unconfigured fee heads yield undefined — NO fabricated fallback amounts', () => {
    resetSchoolSettingsCache()
    expect(useCurrentUser.getState().me).toBeNull() // real-tenant path
    const snap = computeFeeSnapshot('Class 3', defaultFeeDataState)
    expect(snap.registrationFee).toBeUndefined()
    expect(snap.admissionFee).toBeUndefined()
    expect(snap.tuitionFee).toBeUndefined()
    // totals that would omit required components stay undefined
    expect(snap.grossFee).toBeUndefined()
    expect(snap.netTotal).toBeUndefined()
    expect(snap.initialInstallment).toBeUndefined()
  })

  test('unconfigured exam fees are undefined even when groups are selected', () => {
    resetSchoolSettingsCache()
    const feeState = {
      ...defaultFeeDataState,
      examGroups: { unitTest: true, termExam: true, customGroups: false },
    }
    const snap = computeFeeSnapshot('Class 3', feeState)
    expect(snap.examTotal).toBeUndefined()
  })

  test('explicitly configured heads compute real amounts and totals', () => {
    resetSchoolSettingsCache()
    const s = getSchoolSettings()
    // configure heads explicitly (the honest path: Fee Management config)
    s.feeHeads = [
      { id: 'X1', name: 'Registration', defaultAmount: 2000, type: 'one-time', category: 'Registration' },
      { id: 'X2', name: 'Admission', defaultAmount: 20000, type: 'one-time', category: 'Admission' },
      { id: 'X3', name: 'Tuition', defaultAmount: 48000, type: 'annual', category: 'Tuition' },
    ]
    s.examFeeConfig = { unitTestFee: 800, termExamFee: 1200, customGroupsFee: 0 }
    const feeState = {
      ...defaultFeeDataState,
      examGroups: { unitTest: true, termExam: false, customGroups: false },
    }
    const snap = computeFeeSnapshot('Class 3', feeState)
    expect(snap.registrationFee).toBe(2000)
    expect(snap.admissionFee).toBe(20000)
    expect(snap.tuitionFee).toBe(48000)
    expect(snap.examTotal).toBe(800)
    expect(snap.grossFee).toBe(2000 + 20000 + 48000 + 800)
    expect(snap.netTotal).toBe(70800)
    resetSchoolSettingsCache()
  })

  test('percentage discounts compute from a defined gross; undefined otherwise', () => {
    resetSchoolSettingsCache()
    const s = getSchoolSettings()
    s.discountRules = [
      { id: 'D1', code: 'SIB10', name: 'Sibling', type: 'percentage', value: 10, description: '', category: 'Sibling' },
    ]
    // heads unconfigured → gross undefined → percentage discount undefined
    const snap = computeFeeSnapshot('Class 3', { ...defaultFeeDataState, discountCode: 'SIB10' })
    expect(snap.grossFee).toBeUndefined()
    expect(snap.discountAmount).toBeUndefined()
    resetSchoolSettingsCache()
  })
})

describe('ADMISSION-FEE-HONESTY · fabricated corpus is demo-tier only', () => {
  test('defaultSchoolSettings ships EMPTY fee blocks for real tenants', () => {
    expect(defaultSchoolSettings.feeHeads).toEqual([])
    expect(defaultSchoolSettings.booksMaster).toEqual([])
    expect(defaultSchoolSettings.discountRules).toEqual([])
    expect(defaultSchoolSettings.examFeeConfig).toBeUndefined()
  })

  test('the fabricated corpus lives in demoFeeSettings (demo-gated composition)', () => {
    expect(demoFeeSettings.feeHeads.length).toBeGreaterThan(0)
    expect(demoFeeSettings.booksMaster.length).toBeGreaterThan(0)
    expect(demoFeeSettings.discountRules.length).toBeGreaterThan(0)
    expect(demoFeeSettings.examFeeConfig).toBeDefined()
    // and the composition is demo-aware (re-evaluates when the flag flips)
    const src = read('src/lib/school-settings.ts')
    expect(src).toContain('readIsDemoTenant()')
    expect(src).toMatch(/cachedDemoFlag !== demo/)
  })

  test('the auto-generated 6-book fallback is retired (Books Master only)', () => {
    const snapSrc = read('src/components/principal/modules/FeeStructureStep/fee-snapshot.ts')
    const calcSrc = read('src/components/principal/modules/FeeStructureStep/useFeeCalculations.ts')
    for (const src of [snapSrc, calcSrc]) {
      expect(src).not.toMatch(/BK-ENG-/)
      expect(src).not.toMatch(/BK-MATH-/)
    }
  })

  test('the wizard pipeline no longer imports mock/finance (F2 dead computation removed)', () => {
    const src = read('src/components/principal/modules/FeeStructureStep/useFeeCalculations.ts')
    expect(src).not.toContain("@/lib/mock/finance")
    expect(src).not.toMatch(/resolveFeeStructure/)
  })

  test('NO fabricated fallback literals anywhere in the fee pipelines (F1/F3)', () => {
    for (const p of [
      'src/components/principal/modules/FeeStructureStep/fee-snapshot.ts',
      'src/components/principal/modules/FeeStructureStep/useFeeCalculations.ts',
    ]) {
      const src = read(p)
      // match CODE, not prose: defaultAmount-fallback expressions
      expect(src).not.toMatch(/defaultAmount\s*\|\|\s*\d/)
      expect(src).not.toMatch(/\?\s*\d+\s*\|\|/g)
    }
  })
})

describe('ADMISSION-FEE-HONESTY · official documents render three-state (F7/F8)', () => {
  test('FeeBreakdownTable renders "Not configured" — never fabricated ₹0', () => {
    const src = read('src/components/principal/modules/OfficialAdmissionLetter/FeeBreakdownTable.tsx')
    expect(src).toContain('Not configured')
    expect(src).toMatch(/amountOr\(data\.fees\.admissionFee\)/)
    expect(src).toMatch(/amountOr\(data\.fees\.finalPayable\)/)
  })

  test('letter-html renders "Not configured" for unconfigured rows (download path)', () => {
    const src = read('src/components/principal/modules/OfficialAdmissionLetter/letter-html.ts')
    expect(src).toContain('Not configured')
    expect(src).toMatch(/amount === undefined \? 'Not configured'/)
  })

  test('the letter fees type allows undefined (no required money fields)', () => {
    const src = read('src/components/principal/modules/OfficialAdmissionLetter/types.ts')
    expect(src).toMatch(/admissionFee\?: number/)
    expect(src).toMatch(/tuitionFee\?: number/)
    expect(src).toMatch(/finalPayable\?: number/)
  })

  test('non-enrolled applications get pending placeholders, not minted ids', () => {
    const src = read('src/components/principal/modules/admission/components/issuance/letter-data.ts')
    expect(src).toContain("'PENDING-ENROLMENT'")
    expect(src).toContain("'Pending registration'")
    // the random id generator is retired from the letter builder
    expect(src).not.toMatch(/const randId/)
    expect(src).not.toMatch(/SCH-ADM-\$\{year\}/)
  })

  test('the fee receipt renders three-state + an incomplete-configuration notice', () => {
    const src = read('src/components/principal/modules/admission/components/issuance/FeeReceiptTab.tsx')
    expect(src).toContain('Not configured')
    expect(src).toContain('Fee configuration incomplete')
  })

  test('the wizard summary warns when required heads are missing', () => {
    const src = read('src/components/principal/modules/FeeStructureStep/SummaryPanel.tsx')
    expect(src).toContain('Fee configuration incomplete')
    expect(src).toMatch(/netTotal === undefined \? 'Not configured'/)
  })
})
