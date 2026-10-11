# Supabase Auth — Phase 1 (provider identity behind a controlled flag)

> **Status: implemented, tested, live-verified; ROLLED OUT DARK.** The
> custom scrypt authentication remains authoritative (Option A,
> `docs/AUTH_ARCHITECTURE.md` §1). Supabase Auth is now an ADDITIONAL
> identity provider that mints a Scholario session only through the
> server-side exchange, which enforces the complete login invariant set.
> The feature ships behind `SCHOLARIO_SUPABASE_AUTH` (default **off**).
>
> This implements the staged migration path that was documented as the
> exit plan in `docs/AUTH_ARCHITECTURE.md` §7: per-user linking, never a
> bulk reset, never a forced logout, authorization never moves to the
> provider.

## 1. Architecture (what Supabase Auth is responsible for — and what it is NOT)

| Responsibility | Owner | Where |
| --- | --- | --- |
| Password/OTP identity, email verification, provider session | **Supabase Auth (GoTrue)** | hosted project `kbyknezedewvgrnqervj` |
| Account existence, role, tenant, status, entitlement, permissions | **Scholario Postgres (authoritative)** | `User` / `PlatformAdmin` rows |
| Session issuance, cookies, expiry, revocation | **Scholario server sessions** | `Session` / `PlatformAdminSession` (unchanged) |
| Authorization decisions | **`withUser` / `withPlatform` / RLS (unchanged)** | server-side only |

**The exchange is the only bridge.** A provider access token buys
NOTHING until `POST /api/auth/supabase/exchange` (school plane) or
`POST /api/platform/auth/supabase/exchange` (platform plane):

1. the token is verified **server-to-server** against the provider's own
   `/auth/v1/user` endpoint (never decoded or trusted locally);
2. the identity resolves to a canonical account by the linked pointer
   (`User.authUserId` / `PlatformAdmin.authUserId`) or by a **verified**
   email/phone match — never by a client-supplied identifier;
3. a **first link additionally requires the account's current Scholario
   password** (scrypt-verified) — the anti-takeover gate: a verified
   mailbox alone never links;
4. the FULL login invariant set runs (status, role allowlist, Phase-6
   plane boundary, school binding, entitlement, rate limits, audit,
   anti-enumeration) and the response mirrors the custom login contract
   exactly, so the client post-login state machine is shared;
5. the Scholario session cookie is minted as usual — the provider
   session (browser localStorage) grants nothing on app APIs.

## 2. Migration of existing users (staged, per `AUTH_ARCHITECTURE.md` §7)

* **No bulk reset, no forced logout.** The custom scrypt login keeps
  working permanently while the flag is on OR off.
* **Identity mapping:** `User.authUserId` / `PlatformAdmin.authUserId`
  (nullable, UNIQUE, additive migration `20261011140000_…` — reversible
  by dropping the columns). The Postgres row stays the identity of
  record forever; the provider id is a pointer.
* **Cutover on natural password change (§7.3):** when a school user
  changes their password through `/api/auth/change-password` (flag on),
  the new password is additionally provisioned to the provider and the
  row is linked — best-effort, audited (`AUTH_SUPABASE_PROVISIONED` /
  `…_UPDATED` / `…_PROVISION_SKIPPED`), never blocking the app change.
* **First-login enrolment for everyone else:** sign up at the provider
  with your existing account email → verify the email → sign in on the
  school door → the exchange asks ONCE for the current Scholario
  password (ownership proof) → linked.
* **Public signup provisions nothing:** a provider identity with no
  matching Scholario account gets the honest `NO_SCHOLARIO_ACCOUNT`
  state. Accounts are provisioned by the platform/school flows only.

## 3. Endpoint surface

| Endpoint | Plane | Auth | Purpose |
| --- | --- | --- | --- |
| `GET /api/auth/supabase/status` | school | public | honest capability probe (drives card rendering) |
| `POST /api/auth/supabase/exchange` | school | public (provider token) | token → Scholario session (all login invariants) |
| `GET /api/platform/auth/supabase/status` | platform | public | honest capability probe |
| `POST /api/platform/auth/supabase/exchange` | platform | public (provider token) | token → platform session (TOTP policy preserved, school identities never resolve) |
| `/auth/callback` | school page | — | provider email-link landing (verification, recovery: set-new-password) |

Stable error codes (client UX drives off these): `FEATURE_DISABLED`,
`NO_SCHOLARIO_ACCOUNT`, `LINK_PASSWORD_REQUIRED`, `IDENTITY_UNVERIFIED`,
`PHONE_AMBIGUOUS`, `AUTH_LINK_CONFLICT`, `AUTH_REQUIRED`,
`AUTH_PROVIDER_UNREACHABLE`.

## 4. Configuration

### Application (Vercel, both planes)

| Variable | Value | Notes |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | already configured | server-side only (CORE gate) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **added 2026-10-11** | publishable by design (RLS deny-by-default); browser client |
| `SCHOLARIO_SUPABASE_AUTH` | unset → **off** | the controlled rollout switch; set `on` to enable BOTH planes' provider sign-in |
| `SUPABASE_SMS_PROVIDER_CONFIGURED` | unset → blocked | set `on` ONLY after a real SMS provider is configured and tested in the Supabase dashboard |

### Supabase Auth project (live config — updated 2026-10-11 via Management API)

* `site_url` → `https://scholario-app-virid.vercel.app` (was the
  **deprecated legacy deployment URL** — stale config fixed)
* `uri_allow_list` → both ACTIVE planes (`scholario-app-virid` +
  `scholario-platform`, `/**` for callback paths)
* email confirmations **required** (`mailer_autoconfirm=false`) —
  unverified identities never link
* signups enabled (identity only — provisions no Scholario account)
* Google provider: **off, unconfigured** (honest disabled state)
* SMS: **Twilio selected with ZERO credentials** — the provider itself
  answers `otp_disabled` (verified live). Phone-OTP delivery is BLOCKED
  until the owner configures a real provider.
* SMTP: Supabase built-in (rate limit 2 emails/hour). Email
  verification/reset links are delivered by the BUILT-IN service, not
  the app's Resend pipeline (Resend is the app's transactional email,
  not the identity provider's transport).

## 5. Rollout / rollback

* **Enable (owner):** set `SCHOLARIO_SUPABASE_AUTH=on` (both planes,
  production target) — the login doors render the provider card; the
  custom login remains fully functional.
* **Disable:** remove the variable (default off) — the exchange
  endpoints answer `FEATURE_DISABLED`, the cards stop rendering, all
  existing sessions stay valid. No data is lost.
* **Full rollback:** `ALTER TABLE "User" DROP COLUMN "authUserId"; …`
  (both tables) — the provider users can be deleted via the admin API.
  Existing sessions and scrypt credentials are never affected.

## 6. Test evidence (2026-10-11)

* `tests/integration/supabase-auth-linking.test.ts` — 26/26: token
  verification (trust boundary: forged/invalid/no-id/unreachable),
  E.164 validation, resolution matrix (linked/verified-email/unverified/
  unique-phone/ambiguous-phone/unknown/duplicate-email attacker),
  ownership proof (wrong password ⇒ no pointer), race-safe linking,
  platform-plane disjoint resolution, cutover provisioning outcomes.
* `tests/api/supabase-auth-exchange-live.test.ts` — 10/10 **against the
  REAL provider + dev server**: forged token; NO_SCHOLARIO_ACCOUNT;
  LINK_PASSWORD_REQUIRED; **wrong current password ⇒ rejected with no
  pointer (takeover blocked)**; correct password ⇒ session + linked row
  + `/api/auth/me` resolves the same account; steady-state re-exchange;
  cross-plane rejection (Phase 6); cross-role rejection (no elevation);
  suspended account (generic response).
* Full battery alongside: unit+integration 140/0, security trio 152/0,
  api+regression 138/0, typecheck 0 errors, lint 0 errors (57 warnings,
  baseline). CI note: the live suite skips where the provider env is
  absent (CI never has provider credentials — same convention as the
  storage suites).
* In-sandbox browser: the card renders (tabs, fields, honest
  blocked-SMS note, network-failure notice); the provider round-trip
  itself cannot be driven from the sandbox browser (no external network
  in the browser context) — it is proven at the API level above.

## 7. Owner actions (priority order)

1. **Enable when ready:** `SCHOLARIO_SUPABASE_AUTH=on` on both Vercel
   planes (production target). Nothing else changes; the custom login
   stays authoritative.
2. **SMS (optional):** configure a real SMS provider in the Supabase
   dashboard (Twilio/Vonage credentials), send one real OTP, then set
   `SUPABASE_SMS_PROVIDER_CONFIGURED=on`. Until then phone OTP stays
   honestly blocked.
3. **Google (optional):** create a Google OAuth client (origins: both
   active planes; redirect:
   `<plane>/api/platform/auth/google/callback` — the PLATFORM Google
   flow), configure it in the Supabase dashboard, then extend the
   status probe honestly.
4. **Email deliverability:** the built-in Supabase SMTP is capped
   (2/hour). For production volume, configure custom SMTP in the
   Supabase dashboard (Resend SMTP requires a verified sending domain —
   see `docs/EMAIL.md` for the domain state).

## 8. Support quick reference

| Symptom | Meaning | Action |
| --- | --- | --- |
| `LINK_PASSWORD_REQUIRED` loop | the account's current Scholario password is wrong | user resets via the normal in-app flows |
| `NO_SCHOLARIO_ACCOUNT` | verified identity, no account mapping | provisioning question, not an auth bug |
| `IDENTITY_UNVERIFIED` | provider email/phone not verified yet | user clicks the verification email first |
| `PHONE_AMBIGUOUS` | household number shared by accounts | sign in with email instead |
| `AUTH_LINK_CONFLICT` | account or identity already linked elsewhere | audit trail shows which; support can clear the pointer |
| Card missing on a door | flag off OR provider env absent | check `SCHOLARIO_SUPABASE_AUTH` + status endpoint |
