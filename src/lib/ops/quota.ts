/**
 * Pure quota math for metrics — the single place the "unknown limit"
 * honesty rule is encoded (unit-tested):
 *   · limit null/undefined/<=0  → percentConsumed null, remaining null
 *     (a missing limit is NEVER a zero quota and NEVER a percentage).
 *   · value over limit          → percent > 100 (not clamped here; UI
 *     clamps only for the progress bar width).
 *   · All results are round-to-1-decimal percentages.
 */

export interface QuotaView {
  percentConsumed: number | null
  remaining: number | null
}

export function quotaMath(value: number, limitValue: number | null | undefined): QuotaView {
  if (limitValue === null || limitValue === undefined || !Number.isFinite(limitValue) || limitValue <= 0) {
    return { percentConsumed: null, remaining: null }
  }
  if (!Number.isFinite(value)) {
    return { percentConsumed: null, remaining: null }
  }
  const percent = Math.round(((value / limitValue) * 100) * 10) / 10
  return { percentConsumed: percent, remaining: limitValue - value }
}

/** Staleness label (pure): age beyond threshold → stale. */
export function isStaleMetric(ageMinutes: number | null | undefined, staleMinutes: number): boolean {
  if (ageMinutes === null || ageMinutes === undefined || !Number.isFinite(ageMinutes)) return true
  return ageMinutes > staleMinutes
}
