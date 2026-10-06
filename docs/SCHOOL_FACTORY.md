# School Factory — provisioning, activation, first access

> How a school is born in SCHOLARIO: one POST, one atomic transaction, one
> explicit activation, one forced first password change. Adding a school is
> a **data operation** — no new deployment, database, or repository.
> Companion docs: `docs/ARCHITECTURE.md` (system map),
> `docs/VERCEL_PROJECTS.md` (which project serves the console),
> `docs/TENANT_ROUTING.md` (what happens after activation).

## 1. The provisioning transaction

`POST /api/platform/schools` — permission `schools.provision`
(`withPlatform`). Everything below happens in **ONE database transaction**
(`db.$transaction`), so a failure anywhere rolls the whole school back —
no orphan `School` rows, ever (Phase 8C atomicity repair):

| # | Row(s) created | Key fields |
| --- | --- | --- |
| 1 | `School` | `status: 'PENDING'` (sign-in blocked until activation), slug/code unique, plan, board, branding defaults (`#0f766e`/`#f59e0b`), settings JSON (country, timezone, `websiteEnabled`, `tempDomain` = `<slug>.scholario.cloud`, `authMethod: 'PASSWORD'`) |
| 2 | `SchoolSubscription` | `status: 'ACTIVE'`, plan, `periodStart` now, `periodEnd: null` — honest default: billing starts when billing starts (no fabricated payments) |
| 3 | Founding principal `User` | `role: 'PRINCIPAL'`, `status: 'ACTIVE'`, `schoolId` = new school, scrypt `passwordHash`, **`mustChangePassword: true`** (always — supplied or generated password) |
| 4 | `TenantDomain` (optional) | `status: 'PENDING'`, normalized + validated hostname, `isPrimary: true`, real random 16-byte hex `verificationToken` — DNS verification is never faked |
| 5 | Academic bootstrap (optional) | classes (+ sections), school-level subjects (derived unique codes), rooms — same transaction, tenant-scoped |

Race safety: the pre-insert duplicate checks are UX fast-path only; the
**database uniques are the authority**. A concurrent duplicate (slug, code,
principal email, or mapped hostname) surfaces as `P2002` inside the
transaction, is mapped to a typed `CONFLICT` error, and the transaction
rolls back. Never a raw 500, never a partial school.

Honest capability gate: `authMethod: 'GOOGLE_SSO'` is refused with a typed
error (architected, not implemented — no fake "connected" state).

After the transaction, the audit event
`platform.school.provisioned` is written to `PlatformAuditLog` with the
school, principal id/email, plan, custom domain, and bootstrap counts.

## 2. The wizard (control-plane UI)

`src/components/platform/modules/provision-wizard.tsx` — Platform console
→ Schools → **Add School**:

| Step | Label | Collects |
| --- | --- | --- |
| 1 | Basics | school name, short name, code, address/city/state/phone, board, academic year, plan |
| 2 | Branding | primary + accent color (presets or hex), tagline (school-provided — the platform never invents copy) |
| 3 | Website | website toggle (default on), tenant slug, optional custom domain (recorded PENDING with a real verification token) |
| 4 | Admin | founding principal name + email, optional password (else generated) |
| 5 | Config | classes + sections, subjects, rooms, working days |
| 6 | Review | payload review → **CREATE SCHOOL** (POST `/api/platform/schools`) |

Slug validation: 3–60 chars, `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Code: 2–16
chars uppercase/digits/hyphens.

## 3. The post-provision truth surface

The POST response (and the wizard's success panel) is the single source of
truth for onboarding — copy everything you need from it:

| Field | Meaning |
| --- | --- |
| `school.id / name / code / slug` | the tenant identity |
| `school.status` | `PENDING` — sign-in blocked until activation |
| `principal.email / name` | the founding account |
| `loginUrl` | the school's canonical login door: `SCHOOL_APP_BASE_URL` + `/s/<slug>/login` (or `/s/<slug>/login` on the unified deployment) |
| `publicUrl` | the school's canonical public URL: `/s/<slug>` (307s to the tenant website) |
| `tempPassword` | **present only when the server generated it** — shown once, never stored, never logged; the principal must replace it at first sign-in |
| `mustChangePassword` | always `true` — the bootstrap credential is single-purpose |
| `domain.customDomain` | `{ hostname, status: 'PENDING' }` if a custom domain was supplied |
| `domain.tempDomain` | `<slug>.scholario.cloud` — the derived platform subdomain (data, never a custom domain) |
| `domain.previewUrl` | `/?tenant=<slug>` — preview the website before DNS |
| `bootstrap` | counts of classes/sections/subjects/rooms actually created |
| `nextStep` | `activate` |

To hand off to the school: copy `loginUrl` + `principal.email` +
`tempPassword`, deliver them to the principal over a secure channel, then
activate the school.

## 4. Activation, suspension, reactivation

| Action | Route | Permission | Audit event | Effect |
| --- | --- | --- | --- | --- |
| Activate | `POST /api/platform/schools/[id]/activate` | `schools.manage` | `platform.school.activated` | PENDING → ACTIVE — the school's users may now sign in (login requires an ACTIVE school) |
| Suspend | `POST /api/platform/schools/[id]/suspend` | `schools.manage` + **step-up MFA** + reason (10–400 chars) | `platform.school.suspended` | status → SUSPENDED; **every live school `Session` for the tenant is revoked immediately**; sign-in still works, but business APIs reject `SUBSCRIPTION_REQUIRED` (locked-shell entitlement) |
| Reactivate | `POST /api/platform/schools/[id]/reactivate` | `schools.manage` | `platform.school.reactivated` | SUSPENDED → ACTIVE (suspended schools cannot be re-activated via `activate` — the flows are distinct and audited) |

Activation is deliberately a **separate, audited action** from
provisioning: the PENDING gap is the operator's window to hand the
principal their credentials before sign-in becomes possible.

## 5. Credential rules (the temp-password contract)

1. **Generation**: 12-character crypto-random password, rejection-sampled
   from an alphabet with ambiguous glyphs removed (no `0/O/1/I/l`); seeded
   letter + digit so it satisfies the password policy by construction
   (`src/lib/account-provisioning.ts`).
2. **Caller-supplied alternative**: if the wizard supplies a password it
   must pass the Phase-1 policy (8–128 chars, letter + digit) — checked at
   provisioning.
3. **Hash at rest**: only the scrypt `salt:hash` is stored (`hashPassword`).
   The plaintext is never persisted.
4. **Never logged**: no log line, audit row, or DB column carries the
   plaintext; failure details never contain it.
5. **Single display**: `tempPassword` appears exactly once, in the
   provisioning response (`...(generated ? { tempPassword } : {})`).
6. **Forced first change**: `mustChangePassword: true` on the principal row
   — `withUser` blocks every business route with `PASSWORD_CHANGE_REQUIRED`
   until the principal sets their own password (server-enforced, audited
   at completion). Production can never run on a shared or wizard
   password.
7. Dev convenience: `SCHOLARIO_DEFAULT_PASSWORD` may override generation
   only when `NODE_ENV !== 'production'` (scripted QA logins). Ignored in
   production, always.

## 6. How the principal gets first access

1. The school is **activated** (§4) — until then the door rejects sign-in
   (`school login blocked: tenant not activated`).
2. The principal opens the `loginUrl` — `/s/<slug>/login` on the school
   plane. The slug is validated server-side against the real `School` table
   (unknown slug → honest 404); the door renders the school's real branding
   through `/api/schools/public`.
3. The principal signs in with their email + the one-time `tempPassword`.
   The login POST binds the session to the user's real `schoolId` — the
   URL's slug never authorizes anything (a user from another tenant cannot
   ride this door into this school's data).
4. `mustChangePassword` forces the password-setup screen before any ERP
   surface is reachable. From that point the principal is a normal
   PRINCIPAL-role user with full `withUser` authorization for their tenant.

## 7. Operator quick reference

| To… | Do this |
| --- | --- |
| Provision a school | Platform console → Schools → Add School → complete 6 steps → CREATE. |
| Find a school's login URL | The wizard success panel (copy button) or the Schools list — every row carries `loginUrl`. Never construct it by guessing. |
| Hand the principal their credential | Copy `principal.email` + `tempPassword` from the success panel **once**; deliver securely; the forced-change gate does the rest. |
| Enable sign-in | School record → Activate (`schools.manage`, audited). |
| Lock a tenant out | School record → Suspend (step-up + reason; sessions revoked instantly, business APIs lock). |
| Check what was bootstrapped | The response's `bootstrap` counts and the school's setup-readiness tracker (honest report of what was and wasn't configured). |
