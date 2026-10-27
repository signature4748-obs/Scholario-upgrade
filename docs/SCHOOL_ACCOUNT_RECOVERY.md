# School Account Recovery (Student & Staff self-service password reset)

> **STATUS: IMPLEMENTED** — the school-plane mirror of the platform plane's
> account-recovery contract (docs/PLATFORM_ACCOUNT_RECOVERY.md §1). Custom
> scrypt authentication preserved end-to-end; NO Supabase Auth, no change
> to the platform plane or to school authorization.

## Why the flow is first-party (architecture note)

School users authenticate against the Scholario Postgres `User` row with a
local scrypt hash (`src/lib/auth.ts`) — `src/app/api/auth/login/route.ts`
never consults Supabase Auth. Supabase (GoTrue) is an OPTIONAL, flag-gated
identity provider for the school plane (`SCHOLARIO_SUPABASE_AUTH`, default
OFF — docs/AUTH_ARCHITECTURE.md §7); its password store is NOT the school
login's credential source. A Supabase-hosted reset would therefore change
a password the school login never reads. The recovery flow consequently
reuses the ESTABLISHED first-party pattern (hashed single-use token +
the shared transactional email pipeline) rather than creating a parallel
credential system. The only Supabase interaction is the documented
staged-migration cutover parity: when `SCHOLARIO_SUPABASE_AUTH=on`, a
completed reset ALSO provisions the new password to the provider
(guarded, conflict-safe, audited — identical to the natural
`/api/auth/change-password` cutover).

## Flow

```
/login or /s/<slug>/login → "Forgot password?"
  → /forgot-password?email=<prefill>&from=<door>     [public page]
      · the address typed on the login form rides along as a PREFILL
        (still editable); `from` is a validated return door
  → POST /api/auth/forgot-password                   [public, rate-limited]
      · ALWAYS the same generic response (anti-enumeration)
      · ACTIVE canonical-role user WITH a school binding → token minted
        + reset email (shared Resend pipeline, school-branded)
  → email → /reset-password?token=<raw 64-hex>&from=/s/<slug>/login
  → POST /api/auth/reset-password                    [public, rate-limited]
      · token consumed single-use (sha256 lookup — no oracle which
        failure mode fired: unknown/used/expired are one message)
      · new scrypt password hash (the SAME hash the login verifies)
      · bootstrap state retires (mustChangePassword=false,
        passwordChangedAt=now)
      · EVERY live User session revoked
      · per-account login lockout cleared (verified-recovery
        supersession — the emailed link is a stronger identity proof
        than the failure counter; the per-IP bucket is untouched)
      · audit: PASSWORD_RESET_COMPLETED + change-notification email
  → "Sign in with your new password" → the user's OWN school door
      · `from` in the emailed link is stamped from the School row
        (never client input) and re-validated against a strict
        allow-regex by the page — no open redirect
```

## Token contract (`src/lib/school/password-reset.ts`)

Identical to the platform plane (`src/lib/platform/password-reset.ts`):

| Property | Guarantee |
| --- | --- |
| Entropy | 32 crypto-random bytes (256 bits), hex |
| At rest | `sha256(token)` only (`SchoolPasswordReset.tokenHash`) — a DB leak yields nothing replayable |
| Single-use | `usedAt` on consumption; consumption also invalidates every other pending token for the user |
| Expiry | 30 minutes hard (`expiresAt`) |
| Outstanding | ONE per user — a new request supersedes the previous |
| Logs | never — audit rows carry ids/counts/domains only; the raw token appears exactly once, in the emailed link |

**Anti-enumeration**: the forgot-password response is byte-identical for
known/unknown/ineligible addresses (same status, same body; unknowns burn
a scrypt timing round). Rate limits: 5/hour per IP + 3/hour per submitted
account key (forgot), 10/hour per IP (reset consume) — `RATE_LIMITS.
schoolForgotPassword*` / `schoolResetPassword`.

**Eligibility** mirrors what the school login can ever authenticate
(ACTIVE status + canonical role PRINCIPAL|TEACHER|STUDENT + school
binding). SUPER_ADMIN and legacy non-canonical roles are refused (and
audited) — platform identities recover on the platform plane only.

**Email**: the shared pipeline (`src/lib/email`) with the
`school-password-reset` / `school-password-changed` templates and the
user's school branding; honest status semantics (docs/EMAIL.md) — a
provider rejection is a FAILED `EmailDelivery` row with a typed class
tag, never a fabricated success and never a changed API response.

## API surface

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/auth/forgot-password` | public | generic response; dual rate limits |
| `POST /api/auth/reset-password` | public | single-use token; revokes sessions; clears lockout |
| `GET /forgot-password` | public page | school plane only (platform deployment 404s it) |
| `GET /reset-password` | public page | school plane only; validates `from` allow-list |

Middleware: the two pages are school-plane surfaces — the platform
deployment answers an honest 404 at the edge (same gate as `/login`).

## Tests

`tests/security/school-account-recovery.test.ts` — PART L (token
contract: single-use, supersede, expiry, malformed, lockout-clear) +
PART H (live HTTP: anti-enumeration byte-identity, email pipeline rows,
session revocation, bootstrap-state retirement, sign-in with the new
password through the REAL login endpoint, generic refusals). The
platform plane's own suite
(`tests/security/platform-account-recovery.test.ts`) is unaffected.

## Operational prerequisite (delivery)

The reset email uses the SAME sender configuration as every other
transactional email (docs/EMAIL.md). While the Resend account is in
testing mode with zero verified domains, delivery to any address other
than the account-owner address is rejected with 403
`[testing-recipient-restricted]` — recorded honestly in the
`EmailDelivery` row. To deliver to real school users, EITHER verify a
sending domain in Resend and set `EMAIL_FROM` on it, OR configure the
Gmail SMTP provider (`GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD`).
No application change is required — the flow is delivery-agnostic.
