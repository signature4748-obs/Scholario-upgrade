# Platform Admin Account Recovery & Google Sign-In

> **STATUS: IMPLEMENTED** (additive extension of the Phase-6 platform
> control plane — custom authentication preserved end-to-end; NO Supabase
> Auth, NO change to school-side authentication).

This document is the operator runbook for three capabilities:

1. **Password recovery** (self-service forgot-password with emailed,
   single-use, hashed tokens)
2. **Optional Google OIDC sign-in** for PlatformAdmin (explicit identity
   linking; one Google identity → exactly one existing admin account)
3. **Emergency root recovery** (dual-control / two-person rule for
   credential actions against root accounts)

---

## 1. Password reset (self-service)

```
/platform/login → "Forgot password?"
  → /platform/forgot-password (email form)
  → POST /api/platform/auth/forgot-password      [public, rate-limited]
      · ALWAYS the same generic response (anti-enumeration)
      · ACTIVE admin → token minted + reset email (Resend pipeline)
  → email → /platform/reset-password?token=<raw 64-hex>
  → POST /api/platform/auth/reset-password       [public, rate-limited]
      · token consumed single-use (sha256 lookup — no oracle which
        failure mode fired: unknown/used/expired are one message)
      · new scrypt password hash
      · EVERY live PlatformAdminSession revoked
      · audit: platform.password_reset.completed
```

**Token contract** (`src/lib/platform/password-reset.ts`):

| Property | Guarantee |
| --- | --- |
| Entropy | 32 crypto-random bytes (256 bits), hex |
| At rest | `sha256(token)` only — a DB leak yields nothing replayable |
| Single-use | `usedAt` on consumption; consumption also invalidates every other pending token for the admin |
| Expiry | 30 minutes hard (`expiresAt`) |
| Outstanding | ONE per admin — a new request supersedes the previous |
| Logs | never — audit rows carry counts/ids only; error details never embed the token |
| Email body | the ONLY place the raw token appears (the dev-log transport logs subject/template, never the body) |

**Anti-enumeration**: the forgot-password response is byte-identical for
known/unknown addresses (same status, same body, scrypt timing burn for
unknowns). Rate limits: 5/hour per IP + 3/hour per submitted account key;
reset consume: 10/hour per IP.

**Email**: the existing transactional infrastructure
(`src/lib/email` → Resend; template `platform-password-reset`,
neutral Scholario branding, idempotent per token row via `dedupeKey`).
Email delivery failures never break the flow — they surface in the
EmailDelivery row/audit and (for admin-assisted sends) as an honest error.

---

## 2. Google sign-in (PlatformAdmin ONLY — optional)

### Principles

- **Google is an identity provider, never an authorization source.** A
  verified Google identity resolves to a PlatformAdmin ONLY through the
  explicit `PlatformAdmin.googleSub` link. There is NO auto-creation, NO
  email-match login, NO domain auto-join — an arbitrary Gmail address is
  nobody.
- **One Google identity → at most ONE admin** (unique index on
  `googleSub`; pre-checked with a typed error). Password and Google
  sign-ins always resolve to the SAME `PlatformAdmin.id`.
- **Same gates as password login**: PlatformAdmin lookup, ACTIVE status
  check, rate limits, session creation (same `PlatformAdminSession`
  table + HttpOnly cookie), audit logging. Root/permission checks are
  per-request through the unchanged `withPlatform` pipeline — Google
  authentication NEVER bypasses authorization.
- **Minimal data**: `googleSub` (stable subject id), `googleEmail`
  (display/audit only — sign-in resolves by `sub`, never by email),
  `googleLinkedAt`. No Google tokens are stored at all; scope is
  `openid email` (no profile, no offline access, no refresh tokens).

### Flow

```
Login mode (public):
  /platform/login → "Continue with Google"  (shown only when configured —
                    GET /api/platform/auth/google/status → { enabled })
  → GET /api/platform/auth/google/start     [public, rate-limited]
      state + PKCE S256 verifier → HttpOnly cookie (10 min, path-scoped)
      → 302 Google consent (prompt=select_account)
  → GET /api/platform/auth/google/callback  [public]
      state cookie ↔ query state (CSRF) → code exchange (PKCE) →
      id_token FULL verification → lookup by googleSub:
        · no link      → /platform/login?error=GOOGLE_NOT_LINKED
        · suspended    → generic failure (no status disclosure)
        · ACTIVE       → session + cookie → /platform

Link mode (authenticated + step-up):
  Settings → Account & sign-in → "Link Google"
  → GET /api/platform/auth/google/link/start [session + step-up]
      state cookie BOUND to the admin's id
  → (Google round-trip)
  → callback: session must still be live AND belong to the SAME admin
    (while MFA is on, step-up must still be live) → sub must not belong
    to a different admin → link → /platform/settings?google=linked

Unlink (authenticated + step-up):
  POST /api/platform/auth/google/unlink → identity removed + ALL of the
  admin's sessions revoked (fresh authentication with the surviving
  credential).
```

**id_token verification** (`src/lib/platform/google.ts` — pure function,
unit-tested): RS256 signature against Google's JWKS (fetched + cached
10 min), `iss` ∈ Google's accepted issuers, `aud` == our client id,
`exp` freshness (60 s leeway), `sub` present, `email_verified` when the
claim is present. Malformed/unknown-kid/bad-signature/wrong-audience/
expired tokens are all rejected before ANY account lookup.

**Step-up note**: linking and unlinking declare `stepUp: true` in the
platform policy — the same gate the suspend/reactivate routes use. While
platform TOTP is stood down (`lib/platform/mfa-config.ts`, documented
Part-1 reset) the live session is the gate; the step-up requirement
re-arms automatically when MFA returns.

### Environment variables (server-only — never `NEXT_PUBLIC_*`)

```
GOOGLE_OAUTH_CLIENT_ID      # required to enable
GOOGLE_OAUTH_CLIENT_SECRET  # required to enable
GOOGLE_OAUTH_REDIRECT_URI   # optional; default <request origin>/api/platform/auth/google/callback
```

Both unset ⇒ feature honestly OFF (status probe false, button hidden,
start redirects back with `GOOGLE_NOT_CONFIGURED`).

### Google Cloud Console configuration (owner action)

1. **APIs & Services → Credentials → Create OAuth client ID**
   (Application type: *Web application*).
2. **Authorized JavaScript origins** — exactly the origins the consent
   page is reached from:
   - Production: `https://<your-production-domain>`
   - Local development: `http://localhost:3000`
3. **Authorized redirect URIs** — exactly the callback path:
   - Production: `https://<your-production-domain>/api/platform/auth/google/callback`
   - Local development: `http://localhost:3000/api/platform/auth/google/callback`
4. Copy the Client ID + Client Secret into the deployment's encrypted
   environment (Vercel → Project → Settings → Environment Variables):
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
   (production + preview as appropriate). Optionally
   `GOOGLE_OAUTH_REDIRECT_URI` when the origin cannot be derived from
   requests (e.g. behind a proxy).
5. No consent-screen scopes beyond *openid* + *email* are requested by
   the app; while the OAuth client is in *Testing* mode, only test users
   you add under OAuth consent screen can complete the flow — either add
   the admins' Google accounts as test users or publish the app.

**No secrets are ever committed**; the repo carries only the documented
`.env.example` entries above.

---

## 3. Root recovery (emergency owner recovery — dual control)

The dangerous operation is credential takeover of a ROOT account. The
architecture makes it structurally a **two-person action**:

```
Any admins.manage holder (≠ target, step-up'd)
  POST /api/platform/admins/[id]/reset-password   (root target)
  POST /api/platform/admins/[id]/google-unlink    (root target)
      → PlatformRecoveryTicket (15-minute window; NOTHING executes yet)
      → audit platform.recovery.initiated

A SECOND, DISTINCT admins.manage holder (≠ initiator, ≠ target)
  POST /api/platform/admins/recovery/[ticketId]/confirm (step-up)
      → executes the ticketed action
      → audit platform.recovery.executed / .refused
```

- **At least two authorized recovery identities** are therefore required
  (initiator + confirmer), and for password takeover the target's
  verified email inbox is a third factor: even after dual confirmation
  the new password reaches the OWNER's inbox only — no acting admin
  ever sees a credential.
- Non-root admin recovery stays a single authorized decision
  (`admins.manage` + step-up — the suspend/reactivate posture).
- Root **session revocation** alone (lockout mitigation) and
  **disable/re-enable** use the pre-existing suspend/reactivate routes
  (`admins.manage` + step-up, audited) — unchanged by this feature.
- Every transition writes the audit trail:
  `platform.recovery.initiated | .refused | .executed`,
  `platform.admin.password_reset_initiated`,
  `platform.admin.google_linked | .google_unlinked | .google_link_failed`,
  `platform.password_reset.requested | .failed | .completed`.

**Operational requirement**: keep at least TWO administrators with
`admins.manage` (root accounts qualify) at all times — otherwise root
recovery degrades to the documented manual runbook (a third root is
created only through deliberate provisioning, never automatically).

**Never implemented** (by design): hidden universal passwords, secret
backdoors, auto-admin Google accounts, email-match login.

---

## 4. API surface summary

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/platform/auth/forgot-password` | public | generic response; dual rate limits |
| `POST /api/platform/auth/reset-password` | public | single-use token; revokes sessions |
| `GET /api/platform/auth/google/status` | public | `{ enabled }` — no config detail |
| `GET /api/platform/auth/google/start` | public | login round-trip; state+PKCE cookie |
| `GET /api/platform/auth/google/callback` | public | completes login OR link |
| `GET /api/platform/auth/google/link/start` | session + step-up | bind Google identity to THIS admin |
| `POST /api/platform/auth/google/unlink` | session + step-up | removes identity, revokes sessions |
| `POST /api/platform/admins/[id]/reset-password` | admins.manage + step-up | root target ⇒ dual-control ticket |
| `POST /api/platform/admins/[id]/google-unlink` | admins.manage + step-up | root target ⇒ dual-control ticket |
| `GET /api/platform/admins/recovery` | admins.manage | pending ticket queue |
| `POST /api/platform/admins/recovery/[ticketId]/confirm` | admins.manage + step-up | second-person execution |

Middleware (`src/middleware.ts`) whitelists the five public routes and
exempts `/platform/forgot-password` + `/platform/reset-password` pages
(production page boundary). School principal login and every school
route are untouched.

## 5. Schema (migration `20261005060000_platform_account_recovery`)

- `PlatformAdmin.googleSub` (unique) / `googleEmail` / `googleLinkedAt`
- `PlatformPasswordReset` (hashed token, usedAt, expiresAt, indexes)
- `PlatformRecoveryTicket` (action, target/initiator/confirmer, expiry,
  execution state — no FKs, security-trail convention)

Additive only — no data changes; joins the pending release lineage
(production deployment remains blocked pending the migration-first
release ordering documented in `docs/DEPLOYMENT.md`).

## 6. Production owner actions (to activate)

1. **Password reset emails**: confirm `RESEND_API_KEY` (+ optionally a
   verified-domain `EMAIL_FROM`) in the Vercel production environment
   (already documented in `docs/EMAIL.md`); the reset pipeline uses the
   same transport.
2. **Google sign-in**: perform the Google Cloud Console configuration
   (§2 above) and set `GOOGLE_OAUTH_CLIENT_ID/SECRET` in Vercel.
3. **Root recovery posture**: ensure at least two admins hold
   `admins.manage`.
4. Ship through the standard migration-first release ordering
   (apply pending migrations → deploy), never code-before-schema.
