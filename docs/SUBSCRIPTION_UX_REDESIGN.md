# Subscription Management UX & Architecture Redesign

Design record for the subscription-management IA redesign (2026-10-30).
Reads together with `docs/SUBSCRIPTION_ENTITLEMENT_SYSTEM.md` (the backend
design contract, which this redesign does not change).

## 1. Architecture map (before → after)

### Before (audit at f325941)

```
Platform console nav (FLAT, 10 items)
├─ Overview            /platform
├─ Schools             /platform/schools            └─ school detail tabs:
│                                                        Overview · Configuration ·
│                                                        Access & users · Subscription ·
│                                                        Support & audit · Advanced
├─ Subscriptions       /platform/subscriptions      ← 1815-line module holding FOUR
│     internal views (state-only, not URL-addressable):
│       overview | renewals | students | plans
├─ Users & Access      /platform/admins
├─ Support             /platform/support
├─ Announcements       /platform/announcements
├─ Audit Log           /platform/audit
├─ Settings            /platform/settings
├─ My Sessions         /platform/sessions
└─ Operations          /platform/operations

School detail → Subscription group = [SchoolSubscriptionTab (5 sub-tabs:
snapshot · plan · codes · students · ledger)] + [SchoolPaymentGatewayTab
(full fee-gateway configuration form embedded in EVERY school's page)]

Backend (unchanged by this redesign — see SUBSCRIPTION_ENTITLEMENT_SYSTEM.md):
  SchoolSubscription · PlatformPayment · SubscriptionPlan · SubscriptionOrder
  · StudentEntitlement · StaffEntitlement · Student/StaffSubscriptionPayment
  · ActivationCode(+Event) · JobRun · WebhookEvent
  evaluators: entitlement/entitlement.ts (tenant) · student.ts · staff.ts
  gating: withUser (src/lib/api.ts) — live per-request enforcement
  payments: billing.ts (offline) · orders.ts (online) · codes.ts (handshake)

Payment gateways:
  platform/deployment provider = ENV ONLY (getPaymentProvider) — no DB config,
    no UI; subscription online lane hard-wired to it
  school fee gateway = SchoolPaymentGateway row per school (AES-256-GCM
    secrets) with per-school config form (fee lane only)
  resolution: getTenantPaymentProvider — tenant ACTIVE row → deployment
    provider, with a SILENT fallback when the tenant secret is undecryptable
```

### After (this redesign)

```
Platform console nav (GROUPED)
├─ Overview · Schools
├─ REVENUE
│   ├─ Subscriptions      /platform/subscriptions   control centre (states,
│   │                                                filters, next actions)
│   ├─ Plans & Pricing    /platform/plans           catalogue + commercial rules
│   ├─ Payments & Gateways /platform/payments       platform gateway config,
│   │                                                resolution order, school
│   │                                                overrides, webhook health
│   └─ Access Codes       /platform/codes           global code registry
├─ Users & Access · Support · Announcements
├─ OVERSIGHT
│   └─ Reports & Audit    /platform/reports         renewals & expiry,
│                                                    reconciliation, audit log
│                                                    (/platform/audit kept as a
│                                                    working alias → audit tab)
└─ Settings · My Sessions · Operations

School detail → Subscription group =
  [SchoolSubscriptionTab (same 5 sub-tabs)] +
  [SchoolFeeGatewayStatusCard — inherited/override status + link to
   Payments & Gateways (config form lives ONLY in the central section)]

Gateway resolution (explicit, server-only):
  fee lane   resolveSchoolFeeProvider(schoolId):
               school ACTIVE override (decryptable) → platform default
               (DB config → env) → null
               ACTIVE-but-undecryptable override = FAIL CLOSED (audited),
               never silently charges the platform's own account
  subscription lane  resolveSubscriptionPaymentProvider():
               platform DB config (ACTIVE) → env provider → null
```

## 2. Gap analysis (audit findings → fixes in this change)

| # | Audit finding | Fix |
|---|---|---|
| 1 | Global subscription views were state-only (not URL-addressable); "Manage plans" from school detail landed on the wrong view | Views are URL parameters; plan management moved to `/platform/plans` |
| 2 | Global KPI "Active subscriptions" counted legacy fail-open tenants (access allowed, no verified payment) | Status planes separated server-side: payment state / access state / subscription state; legacy rows classified `openAccess` and labelled "Access allowed — no verified payment recorded." |
| 3 | Four different badge implementations of the same state set | Single shared `StateBadge` (subscription-shared) reused |
| 4 | No platform-level gateway configuration (env-only); no central UI | `PlatformGatewayConfig` model + `/platform/payments` config surface (billing.manage + step-up; secrets write-only, AES-256-GCM) |
| 5 | Fee checkout silently fell back to the PLATFORM's own gateway when a school's stored secret was undecryptable (misattributed money) | `resolveSchoolFeeProvider` fails closed with an explicit error + audit event |
| 6 | Gateway test coverage was zero | `tests/security/platform-gateway.test.ts` (config, secrets, resolution, fail-closed, webhook candidates) |
| 7 | Unauthenticated GET on `/api/webhooks/razorpay` disclosed configuration posture | GET removed (405) |
| 8 | Reconcile cron skipped JobRun tracking on the secret-auth path | JobRun row recorded for every execution path |
| 9 | Registry summary carried student/order counts that no UI rendered | Rendered in the control centre (pending verification, entitlements) |
| 10 | Full fee-gateway configuration form embedded in every school's Subscription group | Read-only status card + link; the form lives only in Payments & Gateways |
| 11 | Dead payload + confusing "attention" vocabularies between Overview and Subscriptions | Control-centre KPIs use explicit labels (payment/access/subscription planes) |
| 12 | No global Access Codes surface (batch generation reachable only per-school) | `/platform/codes` registry with school/scope/status filters + batch issuance + one-time display |

## 3. Status planes (the canonical vocabulary)

Everywhere in the subscription surfaces, four planes are distinct:

- **Account access** — `allowed / blocked` (can the tenant sign in at all).
- **Payment state** — `unpaid / pending verification / paid / failed / refunded` (money).
- **Subscription state** — `not activated / active-paid / legacy open access / grace period / expired / suspended / manual override` (the commercial contract).
- **Entitlement state** — `active / scheduled / covered-by-school(-tenant) / expired / suspended / revoked / not subscribed` (what a student/staff member actually has).

A row showing `Subscription: Legacy open access` is never rendered as an
active-paid subscription; the paid-through date is empty and the next action
is "Link plan & record first payment".

## 4. Deliberate non-changes (preserved behaviour)

- The entitlement evaluator, `withUser` gating, batch-code engine, keyed
  verifier, redemption transactions, webhook verification and the
  A-domain/B-domain money separation are untouched — the redesign is IA +
  gateway infrastructure + honest state surfacing.
- Existing migrations, seeds, audit history and API contracts remain
  backward-compatible; the new registry fields are additive.
- `/platform/audit` remains a working route for existing deep links.

## 5. Role-coverage completion (same-day follow-up, f45952a)

- Plans & Pricing: a STAFF plan declares its covered roles (selector in
  the plan form; the plan card shows the set). School/student plans
  cannot declare one.
- School → Plan & Billing: the staff-coverage control shows WHO the
  per-seat policy applies to (the linked plan's declaration) and now
  seeds the CURRENT policy — a price edit can never silently revert
  PER_SEAT to TENANT (the audit finding in §2 #13 below).
- Access Codes: staff batches bind only to roles the plan covers; the
  roster and the terms surface report the effective set.
- Subscriptions control centre: the six KPI cards are click-to-filter —
  "Active — paid", "Unpaid — access allowed", "Pending verification",
  "Expiring soon", "Expired", "Suspended" each drill the registry into
  that cohort (a KPI is a group, not just a number).

| # | Audit finding (post-implementation pass) | Fix |
|---|---|---|
| 13 | Terms editor re-seeded `staffCoverage: 'TENANT'` on open — saving unrelated price terms silently reverted a PER_SEAT tenant's access policy | Registry carries the current policy; the editor seeds from it (see SUBSCRIPTION_ENTITLEMENT_SYSTEM.md §9) |
| 14 | Staff role coverage was implicit (hard-coded TEACHER) rather than a declared plan policy | `coveredRoles` / `staffCoverageRoles` columns + resolution + enforcement derivation (migration 20261030140000) |
| 15 | KPI cards were static numbers; grouping required manual filter selection | Click-to-filter on all six KPI cards |
