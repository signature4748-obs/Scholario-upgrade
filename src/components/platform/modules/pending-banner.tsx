'use client'

// ============================================================
// SubscriptionPendingBanner — the ONE honest signal for the pending
// subscription-system migration (see src/lib/platform/subscription-schema.ts).
//
// When the deployed database has not yet applied the owner-gated
// migration 20261013183000_subscription_entitlement_system, the hardened
// GET surfaces keep serving REAL data and flag the response with
// `subscriptionSchemaPending: true`. Any surface that receives the flag
// renders this banner exactly once: it states what is unavailable and
// what still works — never a fabricated success, never a dead button
// without explanation.
// ============================================================

import { AlertTriangle } from 'lucide-react'

export function SubscriptionPendingBanner({
  compact = false,
}: {
  /** compact = inline (inside tabs/drawers); default = page-level notice. */
  compact?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-800 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <p className={`flex items-start gap-2.5 ${compact ? 'text-xs' : 'text-sm'} font-medium`}>
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Subscription system migration pending
          <span className={`block font-normal text-amber-700 mt-0.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
            Plan registry, student entitlements and activation codes are not available on this database yet — ask
            the platform owner to apply the pending database migration. School management and core subscription
            status remain fully available.
          </span>
        </span>
      </p>
    </div>
  )
}

/** Uniform check for the wire flag across the hardened GET surfaces. */
export function isSubscriptionSchemaPending(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { subscriptionSchemaPending?: boolean }).subscriptionSchemaPending === true
  )
}
