# Authentication & Authorization Architecture

> The evidence-based decision on who authenticates SCHOLARIO, the two
> identity planes, and why. Companion docs: `docs/ARCHITECTURE.md` (system
> map), `docs/VERCEL_PROJECTS.md` (deployments), `docs/PLATFORM_SECURITY_MODEL.md`
> (platform boundary detail), `docs/PLATFORM_ACCOUNT_RECOVERY.md`
> (recovery flows).

## 1. THE DECISION: custom application auth remains authoritative (Option A)

SCHOLARIO authenticates users with its own server-side code — scrypt
password hashes in application-owned Postgres tables plus hashed server
session tokens in HttpOnly cookies. **Supabase Auth (GoTrue) is not used;
there are zero GoTrue users.** This is not inertia — it is a documented
decision with evidence, and it is revisitable (§7).

### 1.1 The evidence (what the custom system already does)

| Capability | Implementation | Evidence |
| --- | --- | --- |
| Password hashing | scrypt (`scryptSync`, 16-byte random salt, 64-byte key) stored `salt:hash`, verified with `timingSafeEqual` | `hashPassword` / `verifyPassword` in `src/lib/auth.ts` |
| Server-side sessions | `Session` table; the at-rest column is `tokenHash` (sha256 of the token) — the raw token exists only in memory and on the wire | `createSession`, `hashSessionToken`, Phase 8A |
| Cookie transport | `erp_session` — HttpOnly, SameSite=Lax, `secure` in production, 7-day TTL | `SESSION_COOKIE`, `sessionCookieOptions` |
| Disjoint token spaces | platform (`scholario_platform_session` cookie / `x-platform-token` dev header) vs school (`erp_session` / `Authorization`) — Phase 6 invariant, never interchangeable | `src/lib/platform/auth.ts`, `src/middleware.ts` |
| Server-side authorization | `withUser` (role, tenant `schoolId`, `mustChangePassword`, subscription entitlement) and `withPlatform` (permission sets, step-up MFA) | `src/lib/api.ts`, `src/lib/platform/authz.ts` |
| Rate limiting | DB-backed `RateLimitBucket` (shared across instances), dual **IP + account** buckets on login, progressive block extension | `src/lib/security/rate-limit.ts` |
| Audit | `PlatformAuditLog` (platform events) + `ActivityLog` (school events); every auth-significant action audited | `src/lib/platform/audit.ts` |
| Account recovery | `PlatformPasswordReset` (single-use link) + `PlatformRecoveryTicket` (admin-assisted confirm) | `docs/PLATFORM_ACCOUNT_RECOVERY.md` |
| Google OIDC | opt-in for **platform admins** (scopes `openid`+`email`, honest off when unconfigured) | `/api/platform/auth/google/*` |
| Forced first-password-change | `mustChangePassword=true` blocks business routes until changed (server-enforced in `withUser`) | provisioning + credential-reset suites |
| Anti-enumeration | `burnPasswordTiming()` (constant-time dummy scrypt) + generic login responses that never disclose account existence/status | `src/lib/auth.ts`, `/api/auth/login` |
| Session revocation | `revokeAllPlatformSessions(adminId)` on password reset/suspend/unlink; school suspend revokes every live tenant session | `src/lib/platform/auth.ts`, `/api/platform/schools/[id]/suspend` |

### 1.2 Why NOT Supabase Auth (Option B — rejected)

1. **The credential wall.** Production has **185 existing users whose
   passwords are scrypt `salt:hash` digests** (verified by the production
   migration snapshot — 182 school-plane users + 4 principals). scrypt
   hashes cannot be re-hashed into GoTrue's bcrypt format: the plaintext is
   gone by design. Adopting Supabase Auth for these users requires every
   one of them to re-enter a password through a reset flow — a **forced
   mass credential reset**, i.e. the exact "no forced mass logout unless
   unavoidable" violation the project baseline forbids.
2. **Authorization does not fit provider metadata.** The architecture rule
   is explicit: never put all school authorization logic into Supabase Auth
   metadata. SCHOLARIO's authorization is role + tenant + permission +
   entitlement + step-up, enforced server-side per request (`withUser` /
   `withPlatform`) with Postgres RLS as backstop. Duplicating that into
   provider claims would create a second, drift-prone authority.
3. **Production risk mid-flight.** The system is live (2 schools, real
   sessions, audited lifecycle). Swapping the identity provider under it
   buys no user-visible capability and risks the working recovery,
   rate-limit, audit, and MFA paths above.

## 2. The two identity planes

| | SCHOOL plane | PLATFORM plane |
| --- | --- | --- |
| Who | school users: PRINCIPAL, TEACHER, STUDENT, PARENT, … | platform administrators (+ scoped support sessions) |
| Credential row | `User` (email, scrypt `passwordHash`, `schoolId`) | `PlatformAdmin` (own table — the legacy `User(role='SUPER_ADMIN')` rows are suspended and rejected) |
| Session row | `Session` (`tokenHash`, 7-day TTL) | `PlatformAdminSession` (`tokenHash`, 4-hour absolute TTL) |
| Cookie | `erp_session` (HttpOnly, SameSite=Lax, secure in prod) | `scholario_platform_session` (HttpOnly, SameSite=Lax) |
| Dev bearer | `Authorization: Bearer <token>` (dev preview only) | `x-platform-token` header (dev preview only) |
| Login route | `POST /api/auth/login` (and the `/s/<slug>/login` door) | `POST /api/platform/auth/login` (public) + TOTP MFA |
| MFA | — (password policy + rate limits) | TOTP on every login; 10-minute step-up window for destructive actions |
| API guard | `withUser` (role/tenant/entitlement) | `withPlatform` (permission, step-up) |
| Routes served | `/login`, `/s/*`, school ERP APIs | `/platform/*`, `/api/platform/*` |
| Deployment | `scholario-app` (`SCHOLARIO_PLANE=school`) | `scholario-platform` (`SCHOLARIO_PLANE=platform`) |

The invariant (Phase 6): **the school system can never issue a platform
session, and the platform system can never issue a school session.** The
middleware platform boundary consults only `scholario_platform_session` /
`x-platform-token` — a school `erp_session` cookie or `Authorization`
bearer is deliberately ignored (`src/middleware.ts`).

## 3. Enforcement layers (in request order)

1. **Edge — plane gate** (`src/middleware.ts`): wrong-plane routes 404.
   Existence, not authorization.
2. **Edge — platform boundary**: non-public `/api/platform/*` without a
   platform credential → 401 `AUTH_REQUIRED` JSON. Public exceptions:
   login, demo-code, forgot/reset password, Google OAuth round-trip, public
   announcements. Support endpoints require the separate SUPPORT token
   space. `/platform/*` pages redirect (307) to `/platform/login` in
   production first-party contexts.
3. **Handler — full authorization**: `withPlatform` loads the live session,
   ACTIVE admin, effective permissions (root implies all; else granted
   rows), optional step-up. `withUser` loads the live session, ACTIVE user,
   blocks on `mustChangePassword` (PASSWORD_CHANGE_REQUIRED), enforces
   optional role allowlists, and binds the request context to
   `user.schoolId` — the tenant authority for every query downstream.
4. **Database — RLS**: deny-all row-level security on the tenant tables;
   the publishable anon key reads nothing even if a route were bypassed.

## 4. Session lifecycle

| Event | School plane | Platform plane |
| --- | --- | --- |
| Login | scrypt verify + anti-enumeration timing; session created only for `status=ACTIVE` user of an `ACTIVE` school (never-activated schools block sign-in; SUSPENDED schools sign in but the entitlement model locks business APIs) | password + TOTP verify; session created for ACTIVE admin |
| At rest | `Session.tokenHash` = sha256(token) | `PlatformAdminSession.tokenHash` = sha256(token) |
| Expiry | 7 days (`SESSION_TTL_MS`) | 4 hours absolute (`PLATFORM_SESSION_TTL_MS`) |
| Logout | `destroySession` deletes the row (the delete IS the security effect; DB failures propagate, never a fake ok) | logout + logout-all (`revokeAllPlatformSessions`) |
| Password reset | forced first change via `mustChangePassword` (school users change through `/api/auth/change-password`) | `revokeAllPlatformSessions` fires on reset — every other device dies with the old secret |
| Tenant suspension | platform suspend revokes every live school `Session` for the tenant immediately | admin suspend revokes sessions |
| Recovery | — (school-side reset is in-product password change) | `PlatformPasswordReset` single-use link + `PlatformRecoveryTicket` admin-assisted confirm; anti-enumeration generic responses throughout |

## 5. Google OIDC (platform admins, opt-in)

- Endpoints: `/api/platform/auth/google/status|start|callback` (public, in
  the middleware allowlist). Scopes: `openid` + `email` only.
- Activation: `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (+
  `GOOGLE_OAUTH_REDIRECT_URI` if the origin can't be derived) in Vercel.
  Half-configured fails the release config gate; unset degrades honestly
  off (no button). See `docs/RELEASE.md` §8.
- Linked identity is stored on `PlatformAdmin` (`googleSub` / `googleEmail`);
  unlinking revokes all sessions. School-plane users have **no** Google
  login today (provisioning refuses `GOOGLE_SSO` with a typed, honest error
  — the integration is architected, not implemented; see
  `docs/GOOGLE_SSO_ARCHITECTURE.md`).

## 6. What Supabase Auth would have been responsible for (and why that's moot)

| GoTrue feature | SCHOLARIO equivalent today |
| --- | --- |
| Password store | `User.passwordHash` / `PlatformAdmin` TOTP+password (scrypt) |
| Session tokens | `Session` / `PlatformAdminSession` (hashed at rest, app-owned TTL) |
| JWT claims | server-side `withUser`/`withPlatform` context (never a bearer claim the client can influence) |
| Rate limiting | app `RateLimitBucket` (DB-backed, per-IP + per-account) |
| Email confirm / reset mail | app `sendEmail` pipeline + Resend (`docs/EMAIL.md`) |
| SMTP config | not needed — **noted, not used**; the email pipeline is provider-independent and Resend does not require SMTP. The option stays open (see `docs/EMAIL.md` §"Provider independence") |

## 7. Future migration path (documented so the decision stays revisitable)

If SCHOLARIO ever adopts Supabase Auth, the migration that respects the
"no forced mass logout" rule is per-user, not big-bang:

1. **Deterministic mapping** — add a nullable, UNIQUE `User.authUserId`
   column; map each user to a GoTrue user id at creation time only.
2. **Immutable-ID identity** — treat the Postgres `User.id` as the stable
   application identity forever; the provider id is a pointer, never the
   join key of record.
3. **Per-user cutover on next password change** — existing scrypt hashes
   keep authenticating until the user naturally changes their password; at
   that moment the new password is additionally provisioned to the provider
   and the row is flagged. No reset email is ever forced.
4. **Parallel verification window** — run both verifiers (scrypt first,
   provider second) with dual-read audit before making the provider the
   first check; roll back by flipping the check order.
5. **Authorization stays in the app** regardless — `withUser` /
   `withPlatform` and RLS remain the only authorization authorities; no
   authorization moves into provider metadata (the standing rule).

Nothing above is scheduled — it exists so the Option A decision is a
choice with an exit, not a trap.

## 8. Operator quick reference

| To… | Do this |
| --- | --- |
| Verify a password is scrypt | `User.passwordHash` format is `salt:hash` hex (64-byte key). Anything else is not a valid school credential. |
| Check who holds live sessions | `Session` (school) / `PlatformAdminSession` (platform) rows, matched by sha256(token) of the presented cookie. |
| Kill a compromised platform account | Suspend the admin (`revokeAllPlatformSessions` fires) or trigger password reset (revokes all sessions). |
| Kill a school tenant's access | Suspend the school from the console — sessions revoked at suspend time; sign-in still works but business APIs reject `SUBSCRIPTION_REQUIRED`. |
| Confirm no credential leak in logs | `secrets-scan` / `demo-credential-exposure` suites; the logger redacts `authorization` keys; temp passwords are never logged, shown once. |
