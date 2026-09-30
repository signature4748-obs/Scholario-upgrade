# PLATFORM SECURITY MODEL

> Phase 6 deliverable · Scholario-OS · companion: [`PLATFORM_CONTROL_PLANE.md`](./PLATFORM_CONTROL_PLANE.md) (architecture & capabilities)

## 1. The invariant

**School authentication can never issue a platform session, and platform authentication can never issue a school session.**

This is enforced structurally, not by policy:

| Layer | School plane | Platform plane |
|---|---|---|
| Identity table | `User` (role ∈ PRINCIPAL/MANAGEMENT/ACCOUNTANT/TEACHER/STUDENT/PARENT/DRIVER) | `PlatformAdmin` (no schoolId, no User row) |
| Session table | `Session` (`erp_session`) | `PlatformAdminSession` (`scholario_platform_session`) |
| Token at rest | raw token (documented Phase-0 baseline risk) | **SHA-256 hash** (a DB leak yields no usable credentials) |
| Login endpoint | `POST /api/auth/login` | `POST /api/platform/auth/login` |
| Login rejects | `role='SUPER_ADMIN'` (audited `PLATFORM_LOGIN_BLOCKED`); non-ACTIVE tenants | non-platform identities (generic 401, anti-enumeration) |
| Bearer transport | `Authorization: Bearer` | `x-platform-token` (dev preview only) |

A school token presented as a platform credential (in the platform cookie slot, in the `x-platform-token` header, anywhere) hashes to a value with **no row** in `PlatformAdminSession` → 401. The reverse is equally true (platform token on school APIs → 401). Both directions are pinned by tests.

## 2. Defense in depth (four layers)

1. **Middleware boundary** (`src/middleware.ts`)
   - `/api/platform/*` (dev **and** production): public exceptions aside, requests without a platform credential (or support credential for the support endpoints) receive an immediate **401 AUTH_REQUIRED** JSON — before any handler code runs. School credentials are deliberately not consulted.
   - `/platform/*` pages (production): no platform cookie → **307 redirect to `/platform/login`** — a hard edge before any HTML ships.
   - Dev preview: page-route redirects are disabled *by design* — the sandbox iframe blocks cookies and a redirect would loop (the documented school-side bearer pattern). The boundary in dev is the API gate + the console's server-validated `me` bootstrap + per-route authorization.
2. **Console bootstrap** (`/platform/(console)/layout.tsx` → `platform-client.tsx`): every console page mounts behind `GET /api/platform/auth/me` — a 401 replaces the route to `/platform/login`.
3. **Per-route authorization** (`lib/platform/authz.ts → withPlatform(policy, handler)`): live session (not revoked/expired) + ACTIVE admin + permission (fail-closed) + step-up when required + per-admin mutation rate limit, composed inside the Phase-1/4 `api()` envelope (safe errors, request ids, structured logs).
4. **Resource verification**: every `[id]` in a platform URL is re-verified against the real table (fail-safe 404); school data is always resolved through server-side joins — client-supplied `schoolId` is never trusted (the Phase-2 rule).

## 3. MFA (TOTP) & step-up

- **RFC 6238** (HMAC-SHA1, 6 digits, 30-second step, ±1 skew) implemented in `lib/platform/totp.ts` with constant-time comparison. Secrets are base32, stored on `PlatformAdmin.totpSecret`, **never sent to the browser**.
- **Mandatory at every sign-in**: password without a code → `MFA_REQUIRED`; bad code → `MFA_INVALID`. Successful login resets the account failure bucket.
- **Step-up window**: a successful TOTP (login or explicit `POST /api/platform/auth/step-up`) opens a **10-minute** window (`stepUpAt`) for destructive actions. Destructive = suspend school, delete school, plan changes, platform permission changes, admin creation/suspension, support-session creation (access to sensitive school data).
- Enrollment: admins created through the control plane get a random secret + one-time `otpauth://` enrollment payload. **Dev preview only**: the seeded demo admins carry fixed demo secrets and the login page renders a "Demo authenticator" widget backed by `POST /api/platform/auth/demo-code` — double-gated (hard 404 in production; serves only `isDemo` admins, which production never creates) and returning only a 30-second code, never the secret.

## 4. Rate limiting (stricter than the school plane)

| Bucket | Limit | Scope |
|---|---|---|
| `platformLogin` | 10 / 15 min | per IP |
| `platformLoginAccount` | 5 / 15 min | per account (progressive backoff on repeat abuse) |
| `platformStepUp` | 8 / 5 min | per admin (code-guessing brake) |
| `platformMutation` | 60 / min | per admin (all control-plane writes) |
| `platformAnnouncementPublic` | 30 / min | per IP (school-login banner) |

Failures and lockouts are audited (`platform.login.failed` / `platform.login.locked`). Anti-enumeration: unknown email, wrong password and suspended account are indistinguishable (generic 401 + timing-equalizing scrypt burn).

## 5. Permission model

`PlatformPermission` grants per admin; **root admins imply every key**; unknown keys fail closed. Keys: `schools.read`, `schools.manage`, `schools.provision`, `billing.manage`, `announcements.manage`, `settings.manage`, `audit.read`, `support.access`, `admins.manage`.

- Root-only in practice: `admins.manage` (creating admins / editing permissions / suspending admins — each step-up gated; you cannot revoke your own permissions or suspend yourself).
- Suspension of an admin **revokes every live platform session** of that admin and blocks re-login (generic 401 — no status disclosure).
- Frontend hiding is never authorization: the console hides nav items without the permission, and the routes still enforce it.

## 6. Audit trail

`PlatformAuditLog` records every security-relevant platform event — one structured JSON log line + one durable row (best-effort, never fails the operation):

```
platform.login.success / .failed / .locked     platform.logout / .logout_all
platform.step_up.granted / .failed             platform.session.revoked
platform.school.provisioned / activated / suspended / reactivated /
  updated / plan_changed / feature_flags_updated / deleted
platform.support_session.created / revoked / expired
platform.school_session.revoked                 platform.announcement.published / deleted
platform.settings.updated                       platform.admin.created /
  permission_changed / suspended / reactivated
```

Design notes: **no foreign keys** (audit rows survive school/admin deletion — deletion events can name a school that no longer exists); reason strings pass through the shared sanitizer; metadata is JSON (counts/diffs, no PII); IPs on auth events only. Support-session creation is additionally written to the **school's own ActivityLog** (`PLATFORM_SUPPORT_SESSION` with the reason) so schools see oversight of their tenant.

## 7. "Access School" — anti-impersonation design

Support sessions deliberately avoid every impersonation primitive:

| Impersonation pattern | Support-session design |
|---|---|
| Mint a school Session for the admin | Never — separate `SupportSession` token space |
| Assume a school identity/role | Never — the oversight view is role-less and read-only |
| Unrestricted school API access | Never — the token unlocks exactly ONE read-only endpoint (`GET /api/platform/support/overview`); school APIs, platform-admin APIs and school sessions all reject it (tested) |
| Unlimited duration | 5–60 min (capped by `PlatformSetting.supportMaxDuration`), server-side expiry with lazy sweep + audit |
| Invisible access | Requires an explicit action + reason (≥10 chars) + step-up MFA; audited on the platform trail AND the school's own activity feed; a persistent amber banner with live countdown is always rendered; explicit exit revokes immediately |

## 8. Secret & credential hygiene

- Platform session tokens: 32 random bytes, **SHA-256 at rest**, 4-hour absolute expiry, revocable (single / all devices / on suspension).
- TOTP secrets never leave the server (except the one-time enrollment payload for new admins).
- No database credentials in the browser: every platform query runs in route handlers (Node runtime); the client only ever calls `/api/platform/*`.
- Cookies: HttpOnly, SameSite=Lax, Secure in production, distinct names per plane; cookie-based requests are same-origin checked (CSRF defense-in-depth, shared with the school plane).
- Dev-preview affordances (bearer headers, demo authenticator) are hard-disabled in production — identical to the school plane's documented pattern.

## 9. Threat model walkthrough

| Attack | Outcome |
|---|---|
| School user edits client state (localStorage role, store) to "superadmin" | The school SPA has no superadmin role anymore (auth-store v2 discards stale states; no panel exists to render). Nothing server-side consults client roles. |
| School session token replayed against `/api/platform/*` (any transport slot) | 401 — wrong token space; hash matches no PlatformAdminSession. |
| Legacy superadmin email + password at `/api/auth/login` | 401 (role gate + suspended row), audited as `PLATFORM_LOGIN_BLOCKED`. |
| Platform admin email at school login | 401 — no User row. |
| Brute-force platform login | Dual buckets lock IP and account (429 with Retry-After); progressive backoff extends abuse windows; every failure audited. |
| TOTP guessing | 8 attempts / 5 min per admin on step-up; login itself rides the login buckets; ±1-step window only. |
| Destructive action with a stolen platform session | Step-up required — a fresh session (≤10 min MFA) or explicit re-verification; everything audited. |
| Support token escalation | Read-only single endpoint; expiry server-side; not a platform or school credential. |
| School B ops using platform routes | Identical 401 — no school credential satisfies the boundary (the cross-tenant matrix holds at the platform layer on top of the Phase-2 school-layer isolation). |
| Audit tampering via cascade | PlatformAuditLog has no FKs — deletions cannot erase their own trail. |

## 10. Test evidence

`tests/security/platform-isolation.test.ts` (45 tests, live HTTP against the dev server, real sessions, real TOTP via the server's own library) proves:

1. Principal / Teacher / Student / Parent cannot access the control plane (bearer, cookie-slot forgery, step-up minting, page-route content).
2. Platform admin manages multiple schools (list/read both tenants, metadata + plan, provision → PENDING-blocked → activate → sign-in → typed-confirmation delete with surviving audit).
3. No school credential (A or B) satisfies platform routes; school-B tokens rejected symmetrically in every transport slot.
4. School session ⇏ platform session (structural disjointness: separate tables, hashed tokens, login rejections in both directions, legacy migration dead-end).
5. MFA required at login; step-up gates destructive actions and reopens after verification; login lockout works; every login audited.
6. Permission model (ops granted vs denied capabilities).
7. Support sessions: step-up + reason + duration validation, read-only token semantics across all three token spaces, server-side expiry with audit, school-visible marker, exit revocation.
8. Session lifecycle: logout, logout-all, admin suspension revoking sessions and blocking re-login.

Repeated-run semantics are documented in the suite header (rate-limited re-runs degrade login assertions to the fail-safe "no access" contract; fresh environments assert exact codes).

## 11. Residuals & production notes

- **Page-route edge redirect** is production-only (dev iframe constraint). In production, enable it (already coded in middleware) and consider CSP headers for the console.
- **Production Supabase / Vercel / Resend remain intentionally unconnected** (per phase constraints). The control plane's external surface (email on suspension, webhook for billing) is architected around the existing JobRun/WebhookEvent observability seams.
- Module flags are product availability toggles, not security boundaries — tenant isolation never depends on them.
- The school plane's raw session tokens (Phase-0 baseline risk) are unchanged; the platform plane demonstrates the hashed-token pattern a future phase can migrate the school plane to.
