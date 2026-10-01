/**
 * money — server-side money helpers for the PostgreSQL/NUMERIC era.
 *
 * Phase 8A (SQLite → Supabase PostgreSQL): every money column
 * (Fee.amount/paid, Payment.amount, FeeTransaction.amount,
 * MasterFeeHead.amount, FeeHead.amount, Settlement.grossAmount/fees/
 * netAmount, Route.fare) is now `Decimal @db.Decimal(12,2|14,2|10,2)`.
 *
 * Consequences this module exists for:
 *   · Prisma returns `Prisma.Decimal` objects (and Decimal for `_sum`
 *     aggregates) — `JSON.stringify(Decimal)` produces a STRING, but
 *     every client formatter/store/DTO expects JSON numbers. Convert at
 *     the route boundary with `num()`.
 *   · Decimal has no `+`/`-`/`Math.min`/`Math.max`/`toLocaleString` —
 *     mixing them with numbers throws or misformats. DB-sourced money
 *     arithmetic must go through `.plus/.minus/.greaterThan…` (see
 *     `dec()`), never float ops.
 *   · `Number(decimal)` / `.toNumber()` are exact for 2-decimal NUMERIC
 *     values (they equal the corresponding JS number literal), so the
 *     num() boundary is lossless for every value this schema can hold.
 *
 * Server-only: imports the Prisma runtime (do NOT value-import this
 * from client components — type-only imports of the DTO types are fine).
 */
import { Prisma } from '@prisma/client'

/** A DB-sourced money value: Prisma.Decimal (NUMERIC) or plain number. */
export type MoneyInput = Prisma.Decimal | number

/**
 * Money value as a JSON-friendly JS number. Null/undefined → 0 (keeps the
 * historical `?? 0` / `|| 0` aggregate semantics). Exact for 2-decimal
 * NUMERIC values — use it at every API-response boundary so clients keep
 * receiving numbers, never Decimal's stringified JSON.
 */
export function num(v: MoneyInput | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  return v.toNumber()
}

/**
 * Coerce to Prisma.Decimal for exact paise arithmetic. Pass-through for
 * Decimal, constructor otherwise (accepts number/string; numbers are
 * 2-decimal-safe by validation at every money input site).
 */
export function dec(v: MoneyInput | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v)
}

/** `Math.max(0, a - b)` for Decimals — outstanding-balance clamp. */
export function outstandingDec(amount: MoneyInput, paid: MoneyInput): Prisma.Decimal {
  const o = dec(amount).minus(paid)
  return o.lessThan(0) ? new Prisma.Decimal(0) : o
}

/** `Math.min(a, b)` for Decimals. */
export function minDec(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  const da = dec(a)
  const db = dec(b)
  return da.lessThanOrEqualTo(db) ? da : db
}

/** `Math.max(a, b)` for Decimals. */
export function maxDec(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  const da = dec(a)
  const db = dec(b)
  return da.greaterThanOrEqualTo(db) ? da : db
}

// One shared en-IN grouper — same output as the old
// `value.toLocaleString('en-IN')` sites (₹ is prepended by callers).
const inrGrouper = new Intl.NumberFormat('en-IN')

/**
 * `v.toLocaleString('en-IN')` for Decimal-capable values — Prisma.Decimal
 * has no toLocaleString (it would throw). Keeps the rupee-message format
 * byte-identical to the pre-migration number output.
 */
export function formatINRServer(v: MoneyInput | null | undefined): string {
  return inrGrouper.format(num(v))
}

/**
 * Exact rupee Decimal from an integer paise amount (gateway payloads).
 * `paise / 100` in float drifts; Decimal division of an integer by 100 is
 * exact, and the 2-decimal clamp guarantees NUMERIC(12,2)/NUMERIC(14,2)
 * columns accept the value unchanged.
 */
export function rupeesFromPaise(paise: number | Prisma.Decimal | string): Prisma.Decimal {
  return dec(paise).div(100).toDecimalPlaces(2)
}
