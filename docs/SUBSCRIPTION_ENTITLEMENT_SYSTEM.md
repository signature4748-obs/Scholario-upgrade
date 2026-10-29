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

## 7. PR-30 pre-merge review hardening (2026-10-14)

Confirmed defects found by the independent review and fixed on the branch:

- **Verify routes** accept the gateway `orderId` (the checkout handler's
  `razorpay_order_id`) — the live-lane confirmation is bound to the order's
  `providerOrderId` before the HMAC check (a mismatched confirmation is
  rejected). The client UI opens the real Razorpay checkout sheet (same
  contract as the fee payment dialog) and relays the signed triple.
- **Native Razorpay webhook** (`/api/webhooks/razorpay`) settles subscription
  orders on `payment.captured` (matched by `providerOrderId`, amount+INR
  agreement, exactly-once) — previously a subscription capture 500'd on the
  FeeTransaction lookup and never settled. The platform-subscription webhook
  (custom signed envelope) remains the provider-agnostic lane.
- **Cross-student verify oracle closed:** the ownership check runs BEFORE
  the idempotent PAID fast-path (entitlement ids / paid-state never leak to
  another student probing sequential order numbers).
- **Claim-rejection diagnostics persist:** rejections return out of the
  transaction and their `CLAIM_REJECTED` events are written after it
  (rolled-back event rows left forensics blind).
- **Renewal atomicity:** the in-place extension is a conditional UPDATE
  (optimistic concurrency + re-read retries) — concurrent activations stack,
  never lose one. `P2002` on the one-live index surfaces as an honest
  CONFLICT (no query on the aborted transaction).
- **Reissue race:** the old code's ISSUED→REPLACED transition is
  conditional; a claim winning mid-reissue aborts with CONFLICT (previously
  a blind update could overwrite CLAIMED and double the paid period).
- **Operator payments route:** the code-gated offline flow records the
  payment with `deferActivation` (no apply-then-rollback of live tenant
  state — no stale-snapshot clobber of a concurrent settlement); the
  billingModel switch rides the payment transaction (a failing request
  never flips the tenant's model).
- **Webhook dedupe race:** concurrent duplicate deliveries of the same
  `eventId` ack 200 via the P2002 catch (previously a 500).
- **Order TTL grace:** a signature-verified settlement inside 24h past the
  30-minute TTL still settles (captured money must not strand); beyond the
  grace the order expires for real and stragglers go to operator
  reconciliation.
- **Online lane is INR-only** at order creation (the shared provider
  charges paise-INR; non-INR plans stay offline/code-gated).
- **Model C hardening:** operator assignment modes exclude ONLINE_PAYMENT
  (unverifiable ledger rows); complimentary grants require an audit note
  (≥10 chars); entitlement lifecycle actions require a reason (≥10) and
  step-up policy; adjust-validity is EXTEND-ONLY (early exit = revoke);
  live-row resolution prefers PENDING|ACTIVE over stale SUSPENDED rows;
  reactivate hitting the one-live index answers CONFLICT.
- **Audit vocabulary:** the new `targetType` (`STUDENT`, `SUBSCRIPTION_PLAN`,
  `ACTIVATION_CODE`) and school-plane event values joined the canonical
  unions (the omission was the CI typecheck failure).
- Regression coverage: `tests/security/subscription-entitlement.test.ts`
  grew the "PR-30 review regressions" suite (cross-student oracle, rejection
  persistence, renewal stacking, extend-only adjust, Razorpay-webhook
  settlement incl. amount mismatch + replay, plan-PATCH allowOnline merge,
  billingModel atomicity).

---

## 8. STAFF ENTITLEMENTS + BATCH CODES + RECONCILE (2026-10-30)

The three remaining axes of the entitlement model, implemented additively
on top of everything above (migration `20261030120000_staff_entitlements_batch_codes`
— additive only: two new tables, one default-'TENANT' policy column, one
code column + sequence; no existing column is dropped or retyped).

### 8.1 The third scope — STAFF_ENTITLEMENT

- `SubscriptionPlan.scope` gains `STAFF` (per-seat ANNUAL, priced via the
  per-seat price — the `pricePerStudent` column doubling as the seat
  price, mirroring the STUDENT contract).
- `StaffEntitlement` — the StudentEntitlement analogue for canonical
  TEACHER accounts (one-live-per-user partial unique index
  `StaffEntitlement_one_live_per_user`, same lifecycle: renewal anchored
  at `max(now, validityEnd)`, SUSPENSION FREEZE banking, extend-only
  adjust, frozen-clock reactivation). `StaffSubscriptionPayment` is the
  immutable per-seat ledger (receipts `SCH-SSP-<year>-<seq>` via
  `staff_payment_receipt_seq`).
- `ActivationCode.scope` gains `STAFF_ENTITLEMENT`; pre-assignment rides
  the new `assignedUserId` column. A staff code is claimable ONLY by a
  server-verified canonical TEACHER of the owning tenant
  (`POST /api/subscription/staff/claim` — the session role is the
  authority, never a submitted field). A student code never activates a
  teacher, a staff code never activates a student, and a principal's
  administrative access is NEVER a paid seat (principals are not gated
  by staff coverage at all).
- Enforcement: `SchoolSubscription.staffCoverage` = `TENANT` (default —
  every existing tenant keeps today's behavior) | `PER_SEAT` (TEACHER
  sessions need a live StaffEntitlement on business routes — enforced in
  `withUser` next to the per-student gate; the same exempt surface stays
  reachable). Set per-tenant via the terms route (audited).
- OPEN student codes: STUDENT_ENTITLEMENT codes may now be issued
  without a pre-assigned student and securely claimed by any eligible
  student of the owning tenant (assignment policy: OPEN | ASSIGNED).
- Operator surfaces: `GET/POST/PATCH /api/platform/users/[id]/subscription`
  (staff Model-C assignment + lifecycle, teacher-only target),
  `GET /api/platform/schools/[id]/staff` (roster with live posture),
  teacher self-view `GET /api/subscription/staff`.

### 8.2 Batch code generation

`POST /api/platform/subscriptions/codes/batch` (billing.manage + step-up):
1–200 codes per batch, bound to tenant + plan + scope + validity policy;
redemption deadline (`claimWindowDays`) independent from the entitlement
expiry; assignment policy OPEN or ASSIGNED (server-verified members);
backing = a VERIFIED payment recorded in the SAME transaction (per-seat
deferred rows for ASSIGNED batches; one tenant-level deferred row for
OPEN batches — amount = unit × quantity) or an explicitly authorized
COMPLIMENTARY grant (separate `billing.complimentary` permission).
Generating codes is never proof of payment by itself. Plaintexts are
returned ONCE in the response (one-time display); the registry GET never
returns them.

### 8.3 Keyed code verifier (at-rest hardening)

Codes issued from 2026-10-30 store HMAC-SHA256(normalized code, pepper)
where the pepper is `CODE_VERIFIER_SECRET` (or a sha256 derivation of
`FILE_SIGNING_SECRET` when unset — stable across instances). Claim/lookup
tries the keyed verifier first and falls back to the legacy sha256, so
codes issued before the change keep redeeming with no migration or
reissue. With neither env configured the design honestly stays on the
legacy sha256 (dev/CI default) rather than peppering with an ephemeral
process key.

### 8.4 Reconciliation sweep

`POST /api/cron/subscription-reconcile` (vercel.json daily 03:20 UTC;
OPS_CRON_SECRET bearer or platform `ops.read`): idempotent conditional
updates that reconcile STORED SNAPSHOTS with the live evaluation —
expired-window codes ISSUED→EXPIRED, lapsed live entitlement rows
(student + staff) → EXPIRED, stale PENDING orders past TTL+grace →
EXPIRED. Enforcement never depends on it (expiry is computed live at
evaluation time); observability rides the JobRun trail (one row per
hour bucket).
