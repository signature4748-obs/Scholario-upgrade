/**
 * entitlement — THE centralized tenant-subscription entitlement service.
 *
 * SaaS-HARDENING core rule: AUTHENTICATION NEVER DEPENDS ON SUBSCRIPTION
 * STATUS. A school user always signs in; the entitlement then decides
 * which business surface their session may reach. Login failures must
 * never masquerade as "invalid credentials" merely because a
 * subscription lapsed.
 *
 * States (§2 of the hardening directive):
 *   ACTIVE     full ERP access
 *   GRACE      full ERP access + persistent renewal warning
 *   RESTRICTED login works · ERP shell locks · business APIs reject with
 *              SUBSCRIPTION_REQUIRED · exempt surface only (auth/session,
 *              profile, subscription status, renewal, support, logout)
 *   SUSPENDED  login works · locked shell + subscription/support info
 *
 * NOT_ACTIVATED is a PROVISIONING state (School.status PENDING — the
 * school exists but has never been activated): login is refused there
 * with an honest message, because there is no product to lock INTO yet.
 *
 * The single evaluation point for: login, withUser's API gate, and
 * /api/auth/me. Frontend lock screens are a UX convenience ONLY — this
 * module (server-side) is the authority; restricted tenants cannot
 * bypass the UI lock by calling APIs directly.
 *
 * Security properties:
 *  · PURE function over server-loaded rows — nothing from the client
 *    (no query/body schoolId/slug ever participates).
 *  · Fail-closed: unknown statuses map to the most restrictive honest
 *    state, never open.
 *  · The account-level lock (User.subscriptionStatus LOCKED) is
 *    preserved as a distinct trigger (a locked ACCOUNT renders the same
 *    restricted posture with an account-scoped message).
 */

export type TenantEntitlementState =
  | 'ACTIVE'
  | 'GRACE'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'NOT_ACTIVATED'

export interface SubscriptionSnapshot {
  status: string | null
  plan: string | null
  periodEnd: Date | null
  graceDays: number | null
  overrideStatus: string | null
}

export interface EntitlementInput {
  /** School lifecycle status (server row). PENDING = never activated. */
  schoolStatus: string | null | undefined
  /** Account-level lock (User.subscriptionStatus; 'ACTIVE' default). */
  accountSubscriptionStatus: string | null | undefined
  /** Tenant subscription row (may be null for legacy tenants). */
  subscription: SubscriptionSnapshot | null | undefined
}

export interface TenantEntitlement {
  state: TenantEntitlementState
  /** May the session reach business (ERP) APIs? Server-enforced. */
  businessAllowed: boolean
  /** May the user authenticate at all? (False only pre-activation.) */
  loginAllowed: boolean
  plan: string
  periodEnd: Date | null
  graceUntil: Date | null
  /** True when GRACE/RESTRICTED/SUSPENDED → persistent renewal UX. */
  renewalRequired: boolean
  /** Safe, user-facing message (never internals). */
  message: string | null
}

const RENEWAL_MESSAGE =
  'Your SCHOLARIO subscription needs renewal. Business modules are locked ' +
  'until the subscription is renewed. You can still sign in, review your ' +
  'subscription status and contact SCHOLARIO support.'

const GRACE_MESSAGE =
  'Your SCHOLARIO subscription has expired. Renew soon to avoid losing ' +
  'access to business modules.'

const SUSPENDED_MESSAGE =
  'Your school’s SCHOLARIO subscription is suspended. Sign-in still works, ' +
  'but business modules are locked. Please contact SCHOLARIO support to ' +
  'restore access.'

const ACCOUNT_LOCKED_MESSAGE =
  'This account is locked. You can still sign in and review your account ' +
  'status, but business modules are unavailable. Contact your school ' +
  'administrator or SCHOLARIO support.'

const NOT_ACTIVATED_MESSAGE =
  'Your school’s SCHOLARIO access is not active yet. Please contact your ' +
  'school administrator.'

const VALID_OVERRIDE = new Set(['ACTIVE', 'GRACE', 'RESTRICTED', 'SUSPENDED'])
/** Lifecycle states under which a school tenant exists operationally. */
const LIVE_SCHOOL_STATUS = new Set(['ACTIVE', 'TRIAL', 'SUSPENDED'])

function computeState(input: EntitlementInput): TenantEntitlementState {
  // 1 — account-level lock (legacy Phase-10 semantics preserved).
  if ((input.accountSubscriptionStatus ?? 'ACTIVE') === 'LOCKED') {
    return 'RESTRICTED'
  }
  // 2 — provisioning: a school that was never activated has no product
  //     to lock into. Refuse login honestly (this is NOT a subscription
  //     state — the tenant does not exist operationally yet).
  if (!LIVE_SCHOOL_STATUS.has(String(input.schoolStatus ?? ''))) {
    return 'NOT_ACTIVATED'
  }
  // 3 — platform suspension maps to the SUSPENDED subscription state:
  //     login still works; the shell locks with support information.
  if (input.schoolStatus === 'SUSPENDED') {
    return 'SUSPENDED'
  }
  // 4 — subscription row (ACTIVE | TRIAL school lifecycle from here on).
  const sub = input.subscription
  if (!sub) {
    // Legacy tenant with no row (backfill normally prevents this):
    // honest default is full access — no billing history exists to
    // restrict on. Fail-open here is deliberate and safe: the platform
    // suspends or sets an override to restrict.
    return 'ACTIVE'
  }
  const override = sub.overrideStatus ?? null
  if (override && VALID_OVERRIDE.has(override)) {
    return override as TenantEntitlementState
  }
  const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null
  if (!periodEnd || periodEnd.getTime() > Date.now()) {
    return 'ACTIVE'
  }
  const graceDays = Math.max(0, Number(sub.graceDays ?? 14))
  const graceUntil = new Date(periodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000)
  return Date.now() <= graceUntil.getTime() ? 'GRACE' : 'RESTRICTED'
}

export function evaluateTenantEntitlement(input: EntitlementInput): TenantEntitlement {
  const state = computeState(input)
  const sub = input.subscription ?? null
  const periodEnd = sub?.periodEnd ? new Date(sub.periodEnd) : null
  const graceDays = Math.max(0, Number(sub?.graceDays ?? 14))
  const graceUntil = periodEnd
    ? new Date(periodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000)
    : null
  const accountLocked = (input.accountSubscriptionStatus ?? 'ACTIVE') === 'LOCKED'

  const businessAllowed = state === 'ACTIVE' || state === 'GRACE'
  const loginAllowed = state !== 'NOT_ACTIVATED'

  let message: string | null = null
  if (state === 'GRACE') message = GRACE_MESSAGE
  else if (state === 'RESTRICTED') message = accountLocked ? ACCOUNT_LOCKED_MESSAGE : RENEWAL_MESSAGE
  else if (state === 'SUSPENDED') message = SUSPENDED_MESSAGE
  else if (state === 'NOT_ACTIVATED') message = NOT_ACTIVATED_MESSAGE

  return {
    state,
    businessAllowed,
    loginAllowed,
    plan: sub?.plan ?? 'STANDARD',
    periodEnd,
    graceUntil,
    renewalRequired: state === 'GRACE' || state === 'RESTRICTED' || state === 'SUSPENDED',
    message,
  }
}

/* ─────────── API-route exemption (restricted-state surface) ──────────── */

/**
 * Non-business endpoints a restricted/suspended tenant may still reach
 * (§2: Authentication/session, Profile, Subscription status, Renewal,
 * Support, Logout — plus client-boot surfaces that carry no tenant
 * data). EXACT prefixes; everything else is business → blocked.
 * Fail-closed: an unknown route ('unknown' in direct-invocation tests)
 * is business.
 */
const EXEMPT_ROUTE_PREFIXES = [
  '/api/auth/',
  '/api/profile',
  '/api/subscription',
  '/api/support',
  '/api/health',
  '/api/app-version',
  '/api/public/',
  '/api/notifications-feed', // login-surface announcement strip (no tenant business data)
]

export function isEntitlementExemptRoute(route: string | null | undefined): boolean {
  if (!route) return false
  const r = String(route).split('?')[0]
  return EXEMPT_ROUTE_PREFIXES.some((p) => r === p || r.startsWith(p))
}

/** Serializable projection for API responses (login, me, subscription). */
export interface EntitlementPublic {
  state: TenantEntitlementState
  businessAllowed: boolean
  plan: string
  periodEnd: string | null
  graceUntil: string | null
  renewalRequired: boolean
  message: string | null
}

export function publicEntitlement(e: TenantEntitlement): EntitlementPublic {
  return {
    state: e.state,
    businessAllowed: e.businessAllowed,
    plan: e.plan,
    periodEnd: e.periodEnd ? e.periodEnd.toISOString() : null,
    graceUntil: e.graceUntil ? e.graceUntil.toISOString() : null,
    renewalRequired: e.renewalRequired,
    message: e.message,
  }
}
