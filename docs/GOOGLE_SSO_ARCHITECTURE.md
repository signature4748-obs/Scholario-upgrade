# Google SSO Architecture (Identity Provider Integration)

> **STATUS: ARCHITECTED — NOT IMPLEMENTED.**
> No Google authentication code exists in this repository today. This
> document defines the target architecture so the capability can be built
> without re-architecting tenancy, authorization, or the platform boundary.
> The product must never present a "connected" state for an integration
> that is not implemented (the onboarding wizard's Google SSO step shows
> **Not connected** and is not selectable; the provisioning API refuses
> `authMethod: GOOGLE_SSO` with a typed error).

---

## 1. Design principles

1. **Google is an identity provider, never the authorization source.**
   A Google account proves *who someone is*. It never proves *what they may
   access*. Every authorization decision remains in SCHOLARIO's server
   pipeline: session → user → role → tenant → permission → resource.
2. **The SCHOLARIO database is canonical.** Tenant membership, role,
   permissions, and account status (`ACTIVE` / suspended) live in
   SCHOLARIO tables. A Google identity that maps to no SCHOLARIO user is
   nobody. A Google identity whose SCHOLARIO account is suspended is
   still blocked.
3. **One platform, many tenants, ONE OAuth client.** A new school must
   never require a developer to register a new Google OAuth application.
   A single SCHOLARIO Google OAuth client (Google Cloud project) serves
   every tenant; tenant binding is resolved by SCHOLARIO after the
   identity is verified, not by Google project sprawl.
   - **One Vercel project, one Supabase project, one GitHub repo, one
     OAuth client. Schools are data, not infrastructure.**
4. **School SSO and platform-admin authentication stay separate.**
   Platform admins authenticate through the dedicated control-plane
   credential space (`PlatformAdmin` + mandatory TOTP MFA + step-up).
   Google SSO is a *school-side* identity option only; it can never
   mint, extend, or bypass a platform session.

## 2. Target flow (school sign-in)

```
School portal login
  → "Continue with Google" (per-tenant, only when the tenant's
     auth configuration enables Google identity)
  → Google OIDC authorization (openid, email, profile — NO other scopes)
  → Authorization Code returned to the SERVER (never to the browser)
  → Server exchanges code for id_token (and access token, used only
     for nothing beyond verification — we do NOT call Google APIs)
  → id_token verified: signature, aud == SCHOLARIO client id, iss,
     exp, and email_verified
  → Identity email → User lookup (school-scoped)
     ├─ no user            → rejected (no provisioning-by-email)
     ├─ user, other tenant → rejected (tenant mismatch — fail closed)
     ├─ user, suspended    → rejected (account status is canonical)
     └─ user, ACTIVE       → school Session row minted (same Session
                             table, same cookie, same expiry rules as
                             password login)
  → School ERP session — identical to password login from here on
```

**Token handling:** Google tokens (access/refresh) are never sent to the
client. The browser only ever sees the SCHOLARIO HttpOnly session cookie.
We do not persist Google tokens at all (no offline access / no refresh
tokens requested) — every sign-in is a fresh OIDC round-trip. If a future
feature needs Google API access (e.g., Calendar sync), that is a separate,
per-school consented integration with its own scope minimization review.

**Email is not a grant:** matching is exact, case-normalized, against the
user's *login email* within the tenant's user directory. No wildcard
domain auto-join.

## 3. Domain restrictions (Google Workspace schools)

Tenants may pin their Google integration to a Workspace domain
(e.g. `@hawkingshigh.edu`):

- The tenant's SSO configuration stores the allowed domain (data, in
  `School.settings` under an `sso` key — no schema change required).
- At login, an id_token email outside the domain is rejected with a
  clear `DOMAIN_MISMATCH` error (the honest status below).
- Domain restriction is a *school policy*; the platform never forces it
  on tenants that use public Gmail addresses.

## 4. Integration status model (per tenant)

The tenant's SSO configuration exposes EXACTLY these states — the product
never fakes a connected state:

| Status | Meaning |
| --- | --- |
| `NOT_CONNECTED` | Google identity not configured for this tenant (default). |
| `CONNECTING` | Admin-initiated enablement in progress (DNS/consent round-trip pending). |
| `CONNECTED` | Domain verified (when pinned) + first successful OIDC sign-in completed. |
| `NEEDS_ADMIN_CONSENT` | Workspace admin consent required (Google's requirement when the platform OAuth client is unverified or tenant policy demands it). |
| `DOMAIN_MISMATCH` | The verified Workspace domain does not match the configured domain. |
| `ERROR` | Last verification/sign-in attempt failed; retry available, details in the platform audit log. |

## 5. Implementation plan (when scheduled)

1. **Environment**: single Google OAuth client credentials as platform
   secrets (server-side only). Redirect URIs enumerate the deployment's
   school portal callback path (`/api/auth/google/callback`) — one path,
   tenant resolved from the session-bound state parameter, never from the
   URL alone.
2. **Schema (data-driven)**: `School.settings.sso` JSON —
   `{ enabled, provider: 'google', domain?: string, status, lastCheckedAt? }`
   — validated by the bounded settings patcher; no new tables.
3. **APIs**: `POST /api/auth/google/start` (anonymous; issues signed,
   HttpOnly state cookie binding the requested school slug) and
   `GET /api/auth/google/callback` (server-side code exchange + the
   flow above). Rate-limited like the password login. Audited
   (`LOGIN_SUCCESS` / `LOGIN_FAILURE` with `method: 'google'`).
4. **Login UI**: per-tenant "Continue with Google" secondary button on the
   school portal door only when the tenant's SSO status is `CONNECTED`.
5. **Platform console**: Schools → school detail → Authentication tab shows
   the honest status chip + enable/verify actions for platform admins.
6. **Tests**: tenant isolation (Google identity from School A can never
   mint a School B session), suspended-user blocking, domain mismatch,
   no-token-exposure assertions in the browser contract tests.

**Estimated effort**: OIDC verification is standard; the risk concentrates
in tenant binding and honest status transitions. All of it is additive —
zero changes to the session table, cookie transport, or the platform
control plane.

---

*Related documents: `docs/PLATFORM_SECURITY_MODEL.md` (credential-space
separation), `docs/TENANT_ISOLATION_MODEL.md` (session-derived tenancy),
`docs/SCHOOL_CONFIGURATION_MODEL.md` (settings JSON as configuration
surface).*
