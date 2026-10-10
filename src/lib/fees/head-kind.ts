import { z } from 'zod'
import { AppError } from '@/lib/security/errors'

/**
 * head-kind — FEE-ADMISSIONS MVP fee-head behavior kinds (H1-R2 §1).
 *
 * ONE truth table, mirrored in four layers (zod here, Prisma defaults,
 * the migration backfill SQL and the DB CHECK constraints):
 *
 *   kind        | mandatory | selection semantics
 *   ------------+-----------+-------------------------------------------
 *   FIXED       | true      | always applied, fixed amount
 *   OPTIONAL    | false     | applied only when explicitly selected
 *   QUANTITY    | any       | per-unit price; quantity 1..MAX_QUANTITY
 *               |           | supplied at selection time; reachable ONLY
 *               |           | via explicit configuration (backfill never
 *               |           | assigns it)
 *
 * amount bounds: 0..500000 (rupees, 2dp) — per unit for QUANTITY.
 */

export const FEE_HEAD_KINDS = ['FIXED', 'OPTIONAL', 'QUANTITY'] as const
export type FeeHeadKind = (typeof FEE_HEAD_KINDS)[number]

/** Maximum selectable quantity for a QUANTITY head (bounded writes). */
export const MAX_QUANTITY = 99

/** Bound money (rupees) — same bound the DB CHECK enforces. */
export const amountSchema = z.coerce.number().finite().min(0).max(500000)

/**
 * Head input for structure create/patch. `kind` is optional for
 * backward compatibility: absent → derived from `mandatory` (the exact
 * legacy backfill truth table: true→FIXED, false→OPTIONAL). QUANTITY
 * must ALWAYS be explicit.
 */
export const feeHeadInputSchema = z.object({
  id: z.string().optional(),
  catalogueId: z.union([z.string(), z.null()]).optional(),
  name: z.string().min(1).max(120),
  category: z.string().max(60).optional(),
  amount: amountSchema,
  frequency: z.string().max(40).optional(),
  mandatory: z.boolean().optional(),
  kind: z.enum(FEE_HEAD_KINDS).optional(),
  active: z.boolean().optional(),
})

export type FeeHeadInput = z.infer<typeof feeHeadInputSchema>

/**
 * Resolve the (kind, mandatory) pair from one head input, enforcing the
 * invariant. Throws INVALID_INPUT (422) on a contradictory combination
 * — the API layer twin of the DB CHECK.
 */
export function resolveHeadKind(
  input: Pick<FeeHeadInput, 'kind' | 'mandatory'>,
  _label = 'fee head',
): { kind: FeeHeadKind; mandatory: boolean } {
  const mandatory = input.mandatory ?? true
  if (input.kind === 'FIXED' && !mandatory) {
    throw kindInvariantError('A FIXED fee head must be mandatory.')
  }
  if (input.kind === 'OPTIONAL' && mandatory) {
    throw kindInvariantError('An OPTIONAL fee head cannot be mandatory.')
  }
  const kind: FeeHeadKind = input.kind ?? (mandatory ? 'FIXED' : 'OPTIONAL')
  return { kind, mandatory }
}

function kindInvariantError(publicMessage: string): AppError {
  return new AppError('INVALID_INPUT', {
    publicMessage,
    internalDetail: `resolveHeadKind: kind/mandatory invariant violated`,
  })
}
