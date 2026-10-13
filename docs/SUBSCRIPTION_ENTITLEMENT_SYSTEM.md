# SUBSCRIPTION & ENTITLEMENT SYSTEM — Design & Implementation Record

> Branch: `feat/subscription-entitlement-system` (base `8e58baa` = production).
> Status: implemented on the isolated branch; production apply of the new
> migration is owner-gated (release track). This document records the final
> data model and lifecycle rules (deliverable 11.2 of the brief).

## 1. What existed and was reused (no duplication)

- `SchoolSubscription` + `PlatformPayment` + `recordPlatformPayment`
  (`src/lib/platform/billing.ts`) — school-pays-SCHOLARIO ledger with the
  verified-payment-only invariant. **Reused and extended** (new columns are
  additive; the existing flows keep working).
- `evaluateTenantEntitlement` (`src/lib/entitlement/entitlement.ts`) — the
  central tenant-state service. **Reused as-is**; the new per-student service
  composes ON TOP of its output.
- `withUser` entitlement gate (`src/lib/api.ts`) — the single server-side
  enforcement point. **Extended** with the student-level gate (§5).
- `/api/webhooks/platform-subscription` — HMAC-verified, idempotent online
  payment receiver. **Extended** with order linkage + student events.
- Platform authz pipeline (`withPlatform`, permissions, step-up, audit) —
  reused for every new control-plane route.
- `PAYMENTS_SANDBOX` + `PAYMENTS_SANDBOX_SECRET` sandbox provider contract and
  the documented test-fixture webhook secrets — reused for the online lane.
- Existing UI: school-detail Subscription tab, provision wizard, console shell
  nav — extended, not replaced.

## 2. Commercial models

| Model | Billing | Activation cause |
|---|---|---|
| A — per-school | `SchoolSubscription` extended with `billingModel`, `planId/planCode/interval/price` snapshots | online: verified webhook/order settlement; offline: operator records VERIFIED payment → school-wide activation code → principal redeems |
| B — per-student annual | new `StudentEntitlement` (+ payment + order) | online: server-verified payment/webhook (exactly once); offline: operator records payment → student-specific code → student claims |
| C — manual/operator | same entities, `source: MANUAL` or `COMPLIMENTARY` | operator assigns validity dates directly (code optional); COMPLIMENTARY needs the separate `billing.complimentary` permission |

Platform config (`PlatformSetting.subscriptionConfig`, JSON, billing-manage):
model availability switches, default billing model for new schools, default
claim-window/validity/grace values.

`SchoolSubscription.billingModel` ∈ `SCHOOL_WIDE` (default — every existing
tenant keeps today's behavior: students covered by the tenant state) |
`PER_STUDENT` | `MIXED`. School-wide codes are tenant-level single redemption
(one claim = the whole-school entitlement; they never mint per-member grants).

## 3. Data model (new migration `20261013183000_subscription_entitlement_system`)

New tables (all tenant-scoped by `schoolId` FK, Decimal(12,2) money, explicit
UTC validity timestamps — dates stored, never labels):

- `SubscriptionPlan` — registry: code (unique), name, description, scope
  (`SCHOOL`|`STUDENT`), interval (`MONTHLY`|`ANNUAL`), priceMonthly /
  priceAnnual (school plans) / pricePerStudent (student plans), currency,
  modules JSON, limits JSON (e.g. maxStudents), graceDays, allowOnline /
  allowOffline, availableForNew / availableForRenewal, status
  (`ACTIVE`|`ARCHIVED`), sortOrder. Soft-archive only — plans are referenced
  by snapshots.
- `SubscriptionOrder` — online orders: orderNo (unique), scope
  (`SCHOOL_PLAN`|`STUDENT_PLAN`), school/student/initiator, plan snapshot,
  amount/currency, status (`PENDING`|`PAID`|`FAILED`|`EXPIRED`|`CANCELLED`|
  `REFUNDED`), provider (`SANDBOX`|`RAZORPAY`|`PLATFORM`), providerOrderId /
  providerPaymentId (unique — double-settle backstop), validityMonths,
  expiresAt (30-min order TTL), entitlement result snapshots.
- `StudentEntitlement` — one live row per student (partial unique index
  `ON (studentId) WHERE status IN ('PENDING','ACTIVE')` — the DB-level
  double-activation guard): plan snapshot, status
  (`PENDING`|`ACTIVE`|`EXPIRED`|`REVOKED`|`SUSPENDED`), validityStart/End,
  source (`ONLINE`|`OFFLINE_CODE`|`MANUAL`|`COMPLIMENTARY`), payment + code
  links, revoke/suspend fields. History rows (REVOKED/EXPIRED) are retained;
  financial records are never mutated by revocation.
- `StudentSubscriptionPayment` — per-student A-domain ledger (mirrors
  PlatformPayment): mode (incl. `COMPLIMENTARY`), VERIFIED-only, immutable,
  receipt `SCH-SSR-YYYY-NNNNN`, order link, status snapshots.
- `ActivationCode` — `publicRef` (`SCH-ACT-YYYY-NNNNN`, the support-safe
  identifier) + `codeHash` (SHA-256 of a 100-bit random Crockford-base32
  code — plaintext never stored, shown exactly once at issuance), scope
  (`SCHOOL_SUBSCRIPTION`|`STUDENT_ENTITLEMENT`), school/student scope, plan
  snapshot, claimWindowDays → expiresAt, status
  (`ISSUED`|`CLAIMED`|`EXPIRED`|`REVOKED`|`REPLACED`), claim/revocation
  fields, `replacedByCodeId` (reissue chain), payment linkage.
- `ActivationCodeEvent` — claim/issue/reject/revoke audit trail with
  rejection-reason CLASS only (never another student's identity or the code).

Additive column changes: `SchoolSubscription` (+billingModel/planId/planCode/
interval/priceSnapshot/currencySnapshot), `PlatformSetting`
(+subscriptionConfig). New platform permission key `billing.complimentary`.

## 4. Lifecycle rules

- **Activation causes (exclusive):** signature-verified webhook, server-side
  provider verification, operator-recorded VERIFIED payment + (offline) code
  redemption, or operator manual/complimentary assignment. A browser redirect
  NEVER activates.
- **Expiry is computed live** at evaluation time from the explicit timestamps
  (`validityEnd`/`periodEnd`) — never dependent on a scheduled job; stored
  status columns are snapshots refreshed on write/read paths.
- **Grace:** tenant-level `graceDays` (existing semantics) preserved; student
  entitlements have no grace window (annual validity is explicit) — the
  config may set the tenant billing model back to SCHOOL_WIDE as the recovery
  path.
- **Renewal/replacement:** new payment + new/extended entitlement; the old
  row is superseded (retained) — anchor `max(now, current validityEnd)`.
- **Refund/revocation:** entitlement → `REVOKED` (reason + admin + audit);
  order → `REFUNDED`; the payment rows stay VERIFIED and untouched.
- **Student leaves/transfers:** entitlement is scoped `(schoolId, studentId)`;
  student deletion cascades the row; a transfer requires a new entitlement at
  the new tenant (cross-tenant codes/payments are rejected by scope checks).
- **Concurrent-claim safety:** conditional `UPDATE … WHERE status='ISSUED'`
  inside the claim transaction + the partial unique index + unique provider
  payment ids — the triple guard the tests exercise.

## 5. Enforcement (single authority)

`evaluateStudentEntitlement` (pure, in `src/lib/entitlement/student.ts`):
account lock → tenant state wins → school-wide coverage (billingModel
SCHOOL_WIDE + tenant ACTIVE/GRACE ⇒ covered) → student row (PENDING → not
yet started; live window check; REVOKED/SUSPENDED/EXPIRED) → NOT_SUBSCRIBED.
`withUser` applies it for STUDENT sessions on non-exempt business routes;
`/api/subscription*` stays exempt (status + claim + renewal always reachable
so a locked student can activate). Support sessions keep using the platform
identity plane (audited, isolated) — unaffected by student gating.

## 6. Online payment lane (provider strategy)

Sandbox (`PAYMENTS_SANDBOX=1` + secret — the documented dev/test contract) →
HMAC checkout token, server-side settle. Razorpay (platform-level env keys) →
server-side order creation + payment fetch verification. Otherwise the live
lane is **fail-closed BLOCKED_INTEGRATION** — honestly labeled in the UI
until the owner configures keys (no fake success anywhere).
