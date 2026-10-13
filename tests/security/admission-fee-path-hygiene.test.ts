/**
 * PR-3 · GATE 2 — production-path hygiene scan (the 8.4-F mandate's
 * "no fabricated fallback remains" checks, as a repeatable test).
 *
 * Scans the ACTUAL production calculation + document path files for:
 *   · the retired fabricated school-fee literals
 *     (1500 / 15000 / 60000 / 18000 / 45000 / 850 / 1200 / 950 / 600
 *      as MONEY contexts — numeric literals and money-formatted
 *      strings, not arbitrary occurrences like page sizes)
 *   · `|| 0` / `?? 0` financial fallbacks on fee-amount fields (the
 *     missing→zero bug pattern; missingness must travel through
 *     `unconfigured` labels)
 *
 * Path files (the ones that compute or render official fee money):
 *   pure layer      fee-config.ts, fee-snapshot.ts, fee-snapshot-input.ts
 *   adapters        client-fee-adapter.ts, server-fee-adapter.ts
 *   server boundary api/admissions/fee-snapshot/route.ts
 *   document model  fee-rows.ts, letter-html.ts, FeeBreakdownTable.tsx,
 *                   FeeReceiptTab.tsx, letter-data.ts
 *   wizard preview  useFeeCalculations.ts, SelectionPanel.tsx,
 *                   SummaryPanel.tsx, primitives.tsx, constants.ts
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../src')

const PATH_FILES = [
  'lib/admission/fee-config.ts',
  'lib/admission/fee-snapshot.ts',
  'lib/admission/fee-snapshot-input.ts',
  'lib/admission/client-fee-adapter.ts',
  'lib/admission/server-fee-adapter.ts',
  'app/api/admissions/fee-snapshot/route.ts',
  'components/principal/modules/OfficialAdmissionLetter/fee-rows.ts',
  'components/principal/modules/OfficialAdmissionLetter/letter-html.ts',
  'components/principal/modules/OfficialAdmissionLetter/FeeBreakdownTable.tsx',
  'components/principal/modules/admission/components/issuance/FeeReceiptTab.tsx',
  'components/principal/modules/admission/components/issuance/letter-data.ts',
  'components/principal/modules/FeeStructureStep/useFeeCalculations.ts',
  'components/principal/modules/FeeStructureStep/SelectionPanel.tsx',
  'components/principal/modules/FeeStructureStep/SummaryPanel.tsx',
  'components/principal/modules/FeeStructureStep/primitives.tsx',
  'components/principal/modules/FeeStructureStep/constants.ts',
]

const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8')

/** Retired fabricated fee amounts (the 8.4 audit's forbidden set). */
const FORBIDDEN_NUMBERS = [1500, 15000, 60000, 18000, 45000, 850, 1200, 950, 600, 5000, 2400, 3000, 2000, 1000]

/**
 * Strip comments and string contents so only CODE identifiers and bare
 * numeric literals remain (Tailwind classes like text-emerald-600 live
 * inside strings and must not be flagged).
 */
function stripStringsAndComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*\*.*$/gm, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

describe('PR-3 Gate 2 · production fee path hygiene', () => {
  test('every scanned file exists (the path map stays honest)', () => {
    for (const rel of PATH_FILES) {
      expect(() => read(rel)).not.toThrow()
    }
  })

  test('no retired fabricated money literal appears as a bare numeric literal in the path code', () => {
    for (const rel of PATH_FILES) {
      const code = stripStringsAndComments(read(rel))
      for (const n of FORBIDDEN_NUMBERS) {
        // word-boundary match: not part of a longer number (500_000 is
        // the sanctioned money bound, not 500 followed by junk)
        const re = new RegExp(`(?<![\\w_])${n}(?![\\w_])`)
        if (re.test(code)) {
          throw new Error(`Forbidden money literal ${n} in code at ${rel}`)
        }
      }
    }
  })

  test('no INR-formatted forbidden literal appears in the document renderers', () => {
    const RENDERERS = [
      'components/principal/modules/OfficialAdmissionLetter/letter-html.ts',
      'components/principal/modules/OfficialAdmissionLetter/FeeBreakdownTable.tsx',
      'components/principal/modules/admission/components/issuance/FeeReceiptTab.tsx',
    ]
    const forbiddenStrings = ['₹1,500', '₹15,000', '₹60,000', '₹18,000', '₹45,000']
    for (const rel of RENDERERS) {
      const src = read(rel)
      for (const s of forbiddenStrings) expect(src).not.toContain(s)
    }
  })

  test('no `|| 0` / `?? 0` financial fallback on fee-amount fields in the document path', () => {
    const DOC_FILES = [
      'components/principal/modules/OfficialAdmissionLetter/fee-rows.ts',
      'components/principal/modules/OfficialAdmissionLetter/letter-html.ts',
      'components/principal/modules/OfficialAdmissionLetter/FeeBreakdownTable.tsx',
      'components/principal/modules/admission/components/issuance/FeeReceiptTab.tsx',
      'components/principal/modules/admission/components/issuance/letter-data.ts',
    ]
    const FEE_FIELDS = [
      'registrationFee', 'admissionFee', 'tuitionFee', 'otherHeadsTotal', 'examTotal',
      'booksTotal', 'uniformTotal', 'activityKitTotal', 'transportTotal', 'hostelTotal',
      'grossFee', 'discountAmount', 'netTotal', 'examFee', 'transportFee', 'subtotal',
      'totalAnnualFee', 'finalPayable', 'customDiscountValue',
    ]
    // field-or-zero bug pattern: `<field> || 0` / `<field> ?? 0`
    // (presence-checked reads via typeof/Number.isFinite are the
    // sanctioned idiom; missingness travels through `unconfigured`).
    const patterns: RegExp[] = []
    for (const f of FEE_FIELDS) {
      patterns.push(new RegExp(`${f}\\s*\\|\\|\\s*0`))
      patterns.push(new RegExp(`${f}\\s*\\?\\?\\s*0`))
    }
    for (const rel of DOC_FILES) {
      const src = read(rel).replace(/^\s*\/\/.*$/gm, '') // comments may document the pattern
      for (const re of patterns) {
        if (re.test(src)) {
          throw new Error(`Financial || 0 / ?? 0 fallback pattern ${re} found in ${rel}`)
        }
      }
    }
  })

  test('the pure calculation layer is free of ANY hardcoded school money (comments excepted)', () => {
    const PURE = ['lib/admission/fee-config.ts', 'lib/admission/fee-snapshot.ts']
    for (const rel of PURE) {
      const code = read(rel)
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^\s*\*.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      for (const n of FORBIDDEN_NUMBERS) {
        expect(code).not.toMatch(new RegExp(`(?<!\\d)${n}(?!\\d)`))
      }
    }
  })
})
