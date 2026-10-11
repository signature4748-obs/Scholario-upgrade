import type { Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '@/lib/security/errors'
import { dec, num } from '@/lib/money'
import { isCanonicalAcademicYear } from '@/lib/admissions/academic-year'
import { MAX_QUANTITY, type FeeHeadKind } from '@/lib/fees/head-kind'

/**
 * quote-engine — THE one server-side admission fee quote computation
 * (FEE-ADMISSIONS MVP, H1-R2 contract). Phase B core.
 *
 * CONTRACT (fail-closed on every axis):
 *   · Reads ONLY the applicable PUBLISHED structure: status='current',
 *     the school's normalized academic year and the requested class.
 *     Missing → 409 FEE_CONFIGURATION_REQUIRED. NEVER falls back to
 *     catalogue values, legacy rows or any hardcoded fee.
 *   · Academic year must be canonical (YYYY-YYYY) and match the
 *     structure's own academicYear column.
 *   · FIXED heads are always applied; OPTIONAL heads only on explicit
 *     selection; QUANTITY heads carry a per-unit price and a validated
 *     quantity (1..MAX_QUANTITY). Unknown head ids → 422.
 *   · Discounts: at most ONE active FeeDiscountRule (no stacking),
 *     applicable ONLY to its explicitly eligible head when that head is
 *     actually in the quote; PERCENT (1..100 of the line) or FLAT
 *     (capped at the line amount). An unknown or ineligible code → 422.
 *   · ALL money arithmetic is paise-exact integers (2dp rupee values
 *     round-trip exactly); totals are derived server-side only.
 */

type Tx = Prisma.TransactionClient | Pick<PrismaClient, 'feeStructure' | 'feeDiscountRule'>

export interface QuoteSelections {
  /** Opted-in OPTIONAL head ids (FeeHead.id, in the structure). */
  optionalHeadIds?: string[]
  /** QUANTITY head selections: headId → quantity. */
  quantities?: Record<string, number>
  /** Discount rule code ('' / 'NONE' = none). */
  discountCode?: string
}

export interface QuoteLineItem {
  headId: string
  name: string
  category: string
  kind: FeeHeadKind
  frequency: string
  quantity: number
  /** Per-unit price, rupees (2dp-exact number). */
  unitAmount: number
  /** Line total = unitAmount × quantity, rupees (2dp-exact number). */
  amount: number
  discounted: boolean
  discountCode?: string
}

export interface QuoteResult {
  structureId: string
  structureVersion: number
  academicYear: string
  classId: string
  className: string
  lineItems: QuoteLineItem[]
  discount: { code: string; name: string; amount: number } | null
  totals: { gross: number; discount: number; net: number }
}

const NONE_CODES = new Set(['', 'NONE', 'none', 'null'])

/** rupees (2dp number) → paise (exact integer). */
function toPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** paise (exact integer) → rupees (2dp-exact number). */
function toRupees(paise: number): number {
  return paise / 100
}

/** Round half-up to the nearest paise. */
function roundPaise(paise: number): number {
  return Math.round(paise)
}

/**
 * Compute an admission fee quote. Runs against the live client or a
 * transaction client (the enrolment path passes its tx so the quote and
 * the writes see the same snapshot).
 */
export async function computeAdmissionQuote(
  tx: Tx,
  opts: {
    schoolId: string
    classId: string
    academicYear: string
    selections?: QuoteSelections
  },
): Promise<QuoteResult> {
  const { schoolId, classId } = opts
  const academicYear = opts.academicYear
  if (!isCanonicalAcademicYear(academicYear)) {
    throw new AppError('INVALID_INPUT', {
      publicMessage: 'Academic year must be in YYYY-YYYY form.',
      internalDetail: `computeAdmissionQuote: non-canonical academicYear`,
    })
  }

  // ── 1. The applicable published structure (fail-closed) ────────────
  const structure = await tx.feeStructure.findFirst({
    where: { schoolId, classId, status: 'current', academicYear },
    include: { heads: true },
    orderBy: { publishedAt: 'desc' },
  })
  if (!structure) {
    // Distinguish "no structure at all" from "structure exists but its
    // year does not match" — both fail closed with the same public code.
    throw new AppError('FEE_CONFIGURATION_REQUIRED', {
      internalDetail: `computeAdmissionQuote: no current published structure for class ${classId.slice(0, 8)}… year ${academicYear} (school ${schoolId.slice(0, 8)}…)`,
    })
  }

  const heads = structure.heads
    .filter((h) => h.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (heads.length === 0) {
    throw new AppError('FEE_CONFIGURATION_REQUIRED', {
      publicMessage: 'The published fee structure has no active fee heads. Publish a complete structure first.',
      internalDetail: `computeAdmissionQuote: structure ${structure.id} has no active heads`,
    })
  }

  // ── 2. Validate selections against the structure's heads ──────────
  const selections = opts.selections ?? {}
  const optionalIds = new Set((selections.optionalHeadIds ?? []).map(String))
  const quantities: Record<string, number> = {}
  for (const [headId, q] of Object.entries(selections.quantities ?? {})) {
    quantities[headId] = q
  }

  const headById = new Map(heads.map((h) => [h.id, h]))

  // Unknown optional selections → 422 (no silent drops, no existence
  // oracle concerns — the ids were namespaced by this school's own
  // structure response).
  for (const id of optionalIds) {
    const head = headById.get(id)
    if (!head) throw unknownHeadError(id)
    if (head.kind !== 'OPTIONAL' && head.kind !== 'QUANTITY') {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Fee head "${head.name}" is not selectable (it is applied automatically).`,
        internalDetail: `computeAdmissionQuote: optional selection on ${head.kind} head ${id}`,
      })
    }
  }
  for (const [id, q] of Object.entries(quantities)) {
    const head = headById.get(id)
    if (!head) throw unknownHeadError(id)
    if (head.kind !== 'QUANTITY') {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Fee head "${head.name}" does not take a quantity.`,
        internalDetail: `computeAdmissionQuote: quantity selection on ${head.kind} head ${id}`,
      })
    }
    if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: `Quantity for "${head.name}" must be a whole number between 1 and ${MAX_QUANTITY}.`,
        internalDetail: `computeAdmissionQuote: quantity ${q} for head ${id}`,
      })
    }
  }

  // ── 3. Build line items (paise-exact) ──────────────────────────────
  const lineItems: QuoteLineItem[] = []
  for (const head of heads) {
    const unitPaise = toPaise(num(head.amount))
    let quantity = 0
    let included = false
    if (head.kind === 'FIXED') {
      included = true
      quantity = 1
    } else if (head.kind === 'OPTIONAL') {
      included = optionalIds.has(head.id)
      quantity = included ? 1 : 0
    } else {
      // QUANTITY — mandatory heads must be selected (≥1); optional only
      // when the client selected a quantity.
      const q = quantities[head.id]
      if (q !== undefined) {
        included = true
        quantity = q
      } else if (head.mandatory) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: `A quantity is required for "${head.name}".`,
          internalDetail: `computeAdmissionQuote: mandatory QUANTITY head ${head.id} has no quantity`,
        })
      }
    }
    if (!included) continue
    lineItems.push({
      headId: head.id,
      name: head.name,
      category: head.category,
      kind: head.kind as FeeHeadKind,
      frequency: head.frequency,
      quantity,
      unitAmount: num(head.amount),
      amount: toRupees(unitPaise * quantity),
      discounted: false,
    })
  }

  // ── 4. Discount: ONE rule, eligible head only, no stacking ────────
  const requestedCode = (selections.discountCode ?? '').trim()
  let discount: QuoteResult['discount'] = null
  if (requestedCode && !NONE_CODES.has(requestedCode)) {
    const rule = await tx.feeDiscountRule.findUnique({
      where: { schoolId_code: { schoolId, code: requestedCode } },
    })
    if (!rule || !rule.active) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'This discount code is not valid for your school.',
        internalDetail: `computeAdmissionQuote: discount code not found/inactive`,
      })
    }
    const target = rule.headId ? lineItems.find((l) => l.headId === rule.headId) : undefined
    if (!target) {
      throw new AppError('INVALID_INPUT', {
        publicMessage: 'This discount is not applicable to the selected fee heads.',
        internalDetail: `computeAdmissionQuote: discount rule head ${rule.headId ?? 'null'} not in quote`,
      })
    }
    const linePaise = toPaise(target.amount)
    let discountPaise: number
    if (rule.type === 'PERCENT') {
      const percent = num(rule.value)
      if (percent <= 0 || percent > 100) {
        throw new AppError('INVALID_INPUT', {
          publicMessage: 'The discount rule has an invalid percentage.',
          internalDetail: `computeAdmissionQuote: percent ${percent}`,
        })
      }
      discountPaise = roundPaise((linePaise * percent) / 100)
    } else {
      discountPaise = Math.min(toPaise(num(rule.value)), linePaise)
    }
    discountPaise = Math.min(discountPaise, linePaise)
    target.discounted = true
    target.discountCode = rule.code
    discount = { code: rule.code, name: rule.name, amount: toRupees(discountPaise) }
  }

  // ── 5. Totals (server-side only) ───────────────────────────────────
  const grossPaise = lineItems.reduce((sum, l) => sum + toPaise(l.amount), 0)
  const discountPaise = discount ? toPaise(discount.amount) : 0
  const netPaise = grossPaise - discountPaise

  return {
    structureId: structure.id,
    structureVersion: structure.version,
    academicYear,
    classId,
    className: structure.className,
    lineItems,
    discount,
    totals: {
      gross: toRupees(grossPaise),
      discount: toRupees(discountPaise),
      net: toRupees(netPaise),
    },
  }
}

function unknownHeadError(headId: string): AppError {
  return new AppError('INVALID_INPUT', {
    publicMessage: 'One of the selected fee heads does not exist in the published structure.',
    internalDetail: `computeAdmissionQuote: unknown head ${headId.slice(0, 12)}…`,
  })
}

/** Decimal total for persistence (AdmissionFeeSnapshot.totalAmount). */
export function quoteTotalDecimal(quote: QuoteResult) {
  return dec(quote.totals.net.toFixed(2))
}
