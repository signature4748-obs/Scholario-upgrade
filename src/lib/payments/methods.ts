/**
 * Scholario — payment method label conventions (server-only).
 *
 * The codebase stores methods in two different conventions:
 *   · FeeTransaction.method — 'UPI' | 'CARD' | 'NET_BANKING' | 'CASH'
 *     (upper-cased, spaces → underscores — see /api/fees/orders).
 *   · Payment.method — 'UPI' | 'CARD' | 'NETBANKING' | 'CASH'
 *     (upper-cased, no separators — see existing Payment rows/seed).
 *
 * The checkout UI speaks human labels ('UPI' | 'Card' | 'Net Banking').
 * These helpers keep the three vocabularies consistent.
 */

export type CheckoutMethodInput = 'UPI' | 'Card' | 'Net Banking'

/** 'UPI' → 'UPI', 'Card' → 'CARD', 'Net Banking' → 'NET_BANKING' (FeeTransaction.method). */
export function normalizeMethod(raw: unknown): string {
  return String(raw ?? 'UPI')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
}

/** 'NET_BANKING' → 'NETBANKING' etc. (Payment.method row convention). */
export function paymentMethodFor(normalized: string): string {
  return normalized.replace(/_/g, '')
}

/** 'UPI' → 'UPI', 'NET_BANKING' → 'Net Banking' etc. (human-facing text). */
export function prettyMethod(normalized: string): string {
  if (normalized === 'UPI') return 'UPI' // acronym — never "Upi"
  return normalized
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}
