# School Subscription & Access Model

> **Status: implemented (PHASE 7.5).** This document describes the *actual*
> runtime model in this repository — not a future design. Evidence: the
> domain layer `src/lib/access-policy.ts`, its enforcement points listed in
> §3, and the live-HTTP proofs in `tests/security/phase75-product.test.ts`
> (§7).
>
> Per the phase constraints, **no billing provider is connected**: there is
> no payment gateway, no invoicing engine, and no automatic status
> transitions. What exists is the **domain abstraction and enforcement
> seams** so the future billing phase plugs in centrally without rewriting
> call sites.

---

## 1. Model

```
School (tenant)
  ├── status : ACTIVE | TRIAL | SUSPENDED     ← tenant lifecycle (platform-owned)
  ├── plan   : FREE | STANDARD | PRO | ENTERPRISE  ← feature matrix (interface only)
  └── (record + data NEVER deleted on lapse)

        status ──► evaluateSchoolAccess(school) ──► { allowed, scope, reason }
                     (src/lib/access-policy.ts — single domain decision)

  ACTIVE   → allowed, scope 'full'  (all school roles)
  TRIAL    → allowed, scope 'full'  (all school roles)
  SUSPENDED→ denied,  scope 'none'  (reason string, safe to display)
  unknown / missing → denied (FAIL-CLOSED — never open)
```

**Ownership.** `School.status` is written exclusively by the **platform
control plane** (Phase 6: `/api/platform/schools/[id]/suspend` /
`reactivate`, MFA + step-up gated). No school-side code path can flip a
tenant back to `ACTIVE` — reactivation is a platform action.

**Data preservation.** Suspending a tenant revokes sessions, not rows:

- every live `Session` of the tenant is deleted (Phase 6 suspend flow,
  best-effort count reported in the platform audit event);
- the school record, its users, students, fees, website content, gallery
  and settings remain untouched;
- the platform control plane retains full management access through its
  own identity boundary (PlatformAdmin/PlatformAdminSession — a school
  session can never become a platform session, pinned by the Phase 6
  isolation suite).

---

## 2. The plan capability matrix (interface only)

`planAllows(plan, capability)` in `src/lib/access-policy.ts`:

| Capability | FREE | STANDARD | PRO | ENTERPRISE |
|---|---|---|---|---|
| announcements | ✓ | ✓ | ✓ | ✓ |
| website-cms | | ✓ | ✓ | ✓ |
| gallery | | ✓ | ✓ | ✓ |
| library / transport | | ✓ | ✓ | ✓ |
| hostel / payroll / analytics | | | ✓ | ✓ |
| online-payments / platform-support | | | | ✓ |

Call sites ask `can(school, capability)` — never plan strings. **Runtime
enforcement today** is the module-flag system owned by the platform control
plane (`School.featureFlags ?? PlatformSetting` defaults, consumed by
`effectiveModuleFlags` + client nav gating). The matrix is the seam where
plan-based gating lands later without touching call sites. No billing,
prices, invoices or payment-provider integrations exist in this phase.

---

## 3. Enforcement points (where the policy actually runs)

| # | Boundary | Mechanism | Effect on a SUSPENDED tenant |
|---|---|---|---|
| 1 | `POST /api/auth/login` | `evaluateSchoolAccess(user.school)` before session creation (audited `LOGIN_FAILED` + `SCHOOL_SUSPENDED` envelope) | No new school session can be minted; the user sees the policy's reason string |
| 2 | **`withUser()` — every school API** (`src/lib/api.ts`) | `evaluateSchoolAccess(user.school)` after the user-status check; school-scoped roles only (`SUPER_ADMIN` excluded — that legacy role is suspended post-Phase 6) | **Every school data API returns 403 with the policy reason** — even a session that somehow survives revocation is dead |
| 3 | Session store | Platform suspend deletes all tenant sessions (Phase 6) | Live sessions are revoked at suspension time |
| 4 | Public surface | `resolvePublicSchool()` only resolves `status: 'ACTIVE'` schools (`src/lib/tenant/resolution.ts`) | The suspended tenant's public website payload, RSS, and media fail-safe 404/neutral |
| 5 | Platform plane | Own guard chain (Phase 6) — never consults this policy | Platform admins keep management access by design |

Fail-closed details:

- `getCurrentUser()` now carries `school.status` on the resolved identity
  (one joined read — no extra query per request).
- A user with `schoolId` but a missing school relation, or an unknown
  status value, is **denied** (`SUSPENDED` interpretation), never allowed.
- The denial uses the canonical error taxonomy (`FORBIDDEN` envelope,
  requestId, sanitized public message = the policy `reason`).

---

## 4. What was retired (the fabricated paywall)

The previous "platform subscription" engine — a hardcoded ₹600/year
per-student UPI paywall held **in browser memory** (lost on every reload,
fake UTR numbers, blocked every non-seeded student) — was deleted in this
phase:

- `src/components/student/StudentSubscriptionActivation.tsx` removed;
- `src/lib/platform-subscription.ts` is now a **tombstone module** that
  fails loudly at compile time if any stale import resurfaces;
- school-role access is a **tenant-level** decision (this model), not a
  per-student client state.

---

## 5. Deliberately NOT done in this phase

- No payment provider / billing / invoicing (phase constraint §24).
- No automatic expiry timers: statuses change only via the platform
  control plane (a future billing system will drive the same field).
- No "grace period" logic: `TRIAL` is a full-access status, distinct from
  suspended.
- The suspended tenant's public website goes dark (resolver requires
  ACTIVE). A friendlier "subscription lapsed" public page is a deliberate
  future option — recorded as a known decision, not an accident.

---

## 6. Verification

`tests/security/phase75-product.test.ts` (live HTTP, real sessions):

1. suspend School B via the **platform control plane API** (MFA
   step-up honored) → B's principal session (previously minted) is
   rejected by `/api/dashboard` with the policy reason;
2. B login is blocked while suspended; **A is unaffected** (same run);
3. reactivate via the platform API → the SAME B session works again
   (data preserved — B's rows were never deleted);
4. `evaluateSchoolAccess` unit proofs: fail-closed on unknown status,
   `planAllows` matrix boundaries.

The Phase 6 suite additionally pins: suspend revokes sessions, login
blocks, MFA/step-up gates the suspend action itself, and school sessions
never mint platform sessions.
