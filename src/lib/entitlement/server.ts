/**
 * entitlement/server — resolve the tenant entitlement for an
 * authenticated school user (server-side only).
 *
 * Input is ALWAYS the session-resolved AuthUser (the school row loaded
 * with its subscription snapshot in getCurrentUser). No client value
 * participates. PURE composition — no I/O, so it is safe in any
 * server context (route handlers, tests).
 */
import type { AuthUser } from '@/lib/auth'
import {
  evaluateTenantEntitlement,
  publicEntitlement,
  type TenantEntitlement,
  type EntitlementPublic,
} from './entitlement'

export function entitlementForUser(user: AuthUser): TenantEntitlement {
  return evaluateTenantEntitlement({
    schoolStatus: user.school?.status ?? null,
    accountSubscriptionStatus: user.subscriptionStatus,
    subscription: user.school?.subscription
      ? {
          status: user.school.subscription.status,
          plan: user.school.subscription.plan,
          periodEnd: user.school.subscription.periodEnd
            ? new Date(user.school.subscription.periodEnd)
            : null,
          graceDays: user.school.subscription.graceDays,
          overrideStatus: user.school.subscription.overrideStatus,
        }
      : null,
  })
}

/** Serializable projection for login/me/subscription responses. */
export function publicEntitlementForUser(user: AuthUser): EntitlementPublic {
  return publicEntitlement(entitlementForUser(user))
}
