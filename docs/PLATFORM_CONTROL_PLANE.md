# PLATFORM CONTROL PLANE — Architecture & Operations

> Phase 6 deliverable · Scholario-OS · status: **implemented & verified**
> Companion document: [`PLATFORM_SECURITY_MODEL.md`](./PLATFORM_SECURITY_MODEL.md) (identity boundary, MFA, threat model)

## 1. What changed and why

Before Phase 6, "Super Admin" was **a school-side identity with a client-side console**:

| Legacy (pre-Phase 6) | Phase 6 |
|---|---|
| `User` row with `role='SUPER_ADMIN'`, `schoolId=null` | `PlatformAdmin` — a separate table, disjoint from the school `User` universe |
| Signed in through the **school login** (`/api/auth/login`) → school `Session` (erp_session) | Signs in at **`/platform/login`** only → `PlatformAdminSession` (`scholario_platform_session`) |
| `#platform` hash → `PlatformLanding` with a **client-only zustand `login('superadmin')`** — no server authentication at all | Real route namespace **`/platform/*`** with middleware boundary, server-side session validation on every page + API call |
| Mock control plane reading the mock tenant store | Real control plane reading/writing the real `School` table + full platform audit trail |
| Any school user could become "Super Admin" by editing localStorage | Structurally impossible: no school role, credential, cookie or header can satisfy any platform check (proven by `tests/security/platform-isolation.test.ts`) |

The migration was **safe and credential-preserving**: `prisma/seed-platform.ts` moved every legacy `SUPER_ADMIN` User into `PlatformAdmin` with the **same email and the same scrypt password hash** (existing credentials continue to work — at the new boundary only), then suspended the legacy User rows and revoked their school sessions. School login now rejects the `SUPER_ADMIN` role outright (audited as `PLATFORM_LOGIN_BLOCKED`) — the school authentication system can never issue a platform session.

## 2. Architecture

```
Scholario Platform
    |
    +---- Platform Control Plane  (/platform/*, /api/platform/*)
    |       PlatformAdmin ── PlatformAdminSession ── PlatformPermission
    |       PlatformAuditLog · SupportSession · PlatformAnnouncement
    |
    +---- School Platform  (/, /api/*)
              Principal / Teacher / Student / Parent
              User ── Session (erp_session) · per-school data
```

Two disjoint worlds:

- **Identity**: `PlatformAdmin` is not a `User`. No foreign keys cross the boundary (only `SupportSession.schoolId` — created by explicit platform action).
- **Sessions**: `PlatformAdminSession` (tokens hashed with SHA-256 at rest) vs school `Session` (separate table, separate cookie, separate validation code path).
- **Transports** (three token spaces, never interchangeable):

| Space | Cookie | Dev-preview header | Validated by |
|---|---|---|---|
| School session | `erp_session` | `Authorization: Bearer …` | `lib/auth.ts` → `Session` table |
| Platform session | `scholario_platform_session` | `x-platform-token` | `lib/platform/auth.ts` → `PlatformAdminSession` |
| Support session | `scholario_support` | `x-support-token` | `lib/platform/auth.ts` → `SupportSession` |

The dev-preview headers exist because the sandbox renders the app inside a cross-site iframe where browsers refuse `SameSite=Lax` cookies (same documented pattern as the school plane; hard-disabled in production where the HttpOnly cookie is the only transport).

## 3. Route namespace

Chosen after inspecting the existing architecture: the school product is a single-route SPA at `/` with hash views; the platform needed a **real, separate, server-gated namespace** → **`/platform`**.

### Pages (`src/app/platform/**`)

| Route | Purpose |
|---|---|
| `/platform/login` | The only entry point. Email + password + **TOTP** (mandatory MFA). Dev preview shows a "Demo authenticator" widget for the seeded demo admins (production renders nothing — admins use real authenticator apps). |
| `/platform` | Overview dashboard: schools by status, sessions, active support sessions, recent platform audit, live announcements. |
| `/platform/schools` | The school ledger: search/filter/paginate, provision dialog. |
| `/platform/schools/[id]` | School dossier: Overview / Metadata / Plan & Modules / Danger zone tabs + "Access School". |
| `/platform/support` | Support tools: support-session registry (revoke), school-session browser (force sign-out). |
| `/platform/support/view` | **Read-only oversight view** for an active support session (amber banner + live countdown + exit). |
| `/platform/audit` | Platform audit trail viewer (filters, pagination, metadata expansion). |
| `/platform/announcements` | Platform announcements manager (publish/retract; surfaces on school login pages). |
| `/platform/settings` | Platform settings + module master switches. |
| `/platform/admins` | Platform admin roster, permissions editor, one-time TOTP enrollment, suspend/reactivate (root only). |
| `/platform/sessions` | Own session/devices manager (revoke one / sign out everywhere). |

Legacy `#platform` / `#superadmin` deep links on `/` redirect to `/platform` (full document navigation).

### API surface (`src/app/api/platform/**`)

28 endpoints, every one behind the platform authorization pipeline (see §4):

- **auth**: `POST login` (MFA, anti-enumeration, dual rate-limit buckets) · `POST logout` · `POST logout-all` · `POST step-up` (TOTP re-verification) · `GET me` (console bootstrap + device list) · `POST demo-code` (dev preview only; production 404; serves only `isDemo` admins; returns a 30-second code, never the secret)
- **schools**: `GET list` (q/status/page + counts) · `POST provision` (PENDING + founding principal) · `GET/[id]` dossier · `PATCH/[id]` metadata · `POST activate` · `POST suspend` (step-up + reason ≥10) · `POST reactivate` · `PATCH plan` (billing permission + step-up) · `PATCH feature-flags` · `DELETE/[id]` (step-up + typed exact-name confirmation) · `POST access` (support session)
- **overview / health**: stats dashboard + system health (DB latency, counts, memory, recent auth failures)
- **audit**: `GET` with q/action/school/admin filters + pagination
- **announcements**: `GET/POST/DELETE` (manage) + `GET public` (rate-limited anonymous endpoint that powers the school login banner)
- **settings**: `GET/PATCH` (showDemoSchool, supportMaxDuration, module master switches)
- **support**: `GET overview` + `POST exit` (support-token auth) · `GET sessions` + `POST sessions/[id]/revoke` (registry) · `GET school-sessions` + `POST school-sessions/[id]/revoke` (force sign-out)
- **sessions**: own-session list via `me`, `POST sessions/[id]/revoke` (`?all=true` = sign out everywhere)
- **admins** (root permission): `GET/POST` (create → one-time enrollment secret) · `PATCH permissions` (step-up) · `POST suspend` (step-up, revokes all sessions) · `POST reactivate`

## 4. Authorization model

Every platform request flows through one pipeline (`src/lib/platform/authz.ts`):

```
Request
  → platform session      (scholario_platform_session cookie / x-platform-token — NEVER a school credential)
  → platform admin        (PlatformAdmin row, status ACTIVE)
  → platform permission   (root implies all; else PlatformPermission grants; unknown keys fail CLOSED)
  → step-up authentication (recent TOTP for destructive actions)
  → handler               (school ids re-verified against real rows — fail-safe 404)
```

**Permission keys** (`src/lib/platform/permissions.ts`): `schools.read`, `schools.manage`, `schools.provision`, `billing.manage`, `announcements.manage`, `settings.manage`, `audit.read`, `support.access`, `admins.manage`.

Frontend hiding is UX only — the pipeline is authoritative on every route (tested).

## 5. Core capabilities

| Capability | Mechanism |
|---|---|
| **School provisioning** | `POST /api/platform/schools` creates the School (`PENDING`) + founding PRINCIPAL user. Sign-in is blocked until an explicit **activate** action (separate audit event). |
| **School activation / suspension** | Activation restores sign-in. Suspension is destructive: step-up + mandatory reason (≥10 chars); sets `status=SUSPENDED`, **revokes every live school session of the tenant**, blocks school login (`SCHOOL_SUSPENDED`). Reactivation is the explicit reversal. |
| **School metadata** | `PATCH /api/platform/schools/[id]` — profile, branding, **domain configuration**, board, academic year. Audited field-by-field. |
| **Plan / subscription** | `PATCH …/plan` — `billing.manage` permission + step-up (billing-impactful). |
| **Platform modules / feature flags** | Platform master switches (`PlatformSetting.modules`) + per-school overrides (`School.featureFlags`). Effective availability = school override ?? platform master ?? enabled. Enforced server-side on the school module root routes (exams/fees/homework/library/transport → `FEATURE_DISABLED`). |
| **Platform settings** | showDemoSchool, supportMaxDuration, module masters. |
| **Domain configuration** | `School.domain` via metadata (future: production ingress resolves tenants by domain). |
| **Platform announcements** | Published in the control plane; active announcements render on every school login page (anonymous, rate-limited public endpoint). |
| **System health** | `/api/platform/health`: DB liveness + latency, school/user/admin counts, live session counts (platform/school/support), process uptime/memory, recent auth-failure signal. |
| **Audit logs** | `PlatformAuditLog` — every platform action, sign-in, step-up, support session; survives school/admin deletion (no FKs by design). Filterable viewer at `/platform/audit`. |
| **Support tools** | Support-session registry + revoke; school-session browser + force sign-out (both audited on platform + school trails). |

## 6. "Access School" — support sessions

A support session is **oversight, not impersonation**:

1. Platform admin opens **Access School** on a school row.
2. Must provide a **reason (≥10 chars, visible to the school)** and a **duration (5–60 min)**.
3. Creation requires `support.access` permission **+ step-up MFA**.
4. The server creates a `SupportSession` row with its own token (SHA-256 at rest) — **no school Session row is ever minted, no school identity is assumed**.
5. Audited on BOTH trails: `PlatformAuditLog` (`platform.support_session.created`) **and** the school's own `ActivityLog` (`PLATFORM_SUPPORT_SESSION` — the principal sees that platform support opened a session and why).
6. The oversight view (`/platform/support/view`) is **read-only by construction** — the support token only unlocks `GET /api/platform/support/overview`; every school write path, every platform admin path and every school session path rejects it (three disjoint token spaces; proven by tests).
7. A persistent amber banner shows the school, the reason and a **live countdown**; expiry and explicit exit both revoke server-side (lazily swept and audited).

## 7. Destructive actions & step-up

Step-up = TOTP re-verification within the last **10 minutes** (a fresh login MFA counts). Enforced server-side on: suspend school, delete school (additionally: typed exact-name confirmation), plan changes, permission grants/revokes, admin creation/suspension, support-session creation. UI affordance: an always-visible step-up pill (live countdown) + a shared step-up gate dialog that transparently retries the blocked action after verification.

## 8. Data model (migration `20260203000000_phase6_platform_control_plane`)

- `PlatformAdmin` — email (unique), scrypt passwordHash, status, isRoot, totpSecret (base32), isDemo
- `PlatformAdminSession` — tokenHash (sha256, unique), adminId, stepUpAt, expiresAt, revokedAt, userAgent, ipAddress
- `PlatformPermission` — unique (adminId, key), granted
- `PlatformAuditLog` — action, targetType/targetId, schoolId (no FK), reason, metadata JSON, ip, requestId; indexed on createdAt / (adminId, createdAt) / (schoolId, createdAt) / action
- `SupportSession` — adminId, schoolId (FK, cascade), reason, durationMinutes, tokenHash (unique), expiresAt, revokedAt
- `PlatformAnnouncement` — title, body, level, audience, createdBy, expiresAt
- `School.featureFlags` (JSON) + `PlatformSetting.modules` / `supportMaxDuration`

## 9. Seeds & credentials (DEV PREVIEW ONLY)

`bun run db:seed-platform` (idempotent):

| Admin | Email | Capabilities | TOTP |
|---|---|---|---|
| Root (migrated legacy super admin) | `admin@scholario.cloud` | all | env-driven demo secret (`prisma/seed-credentials.ts`) |
| Ops (limited) | `ops@scholario.io` | schools.read/manage, announcements, audit, support — **no** billing/provision/settings/admins | env-driven demo secret (`prisma/seed-credentials.ts`) |

Passwords and TOTP secrets for the seeded dev-preview admins are
env-driven (`SEED_PLATFORM_*` vars; defaults in
`prisma/seed-credentials.ts`) and are never printed by seed output nor
surfaced in any UI.

Production enrollment: `POST /api/platform/admins` generates a **random** TOTP secret and returns a one-time enrollment payload (`totpSecret` + `otpauth://` URL for QR provisioning) — never stored client-side, never re-served, and production admins are never `isDemo`.

## 10. Verification

- `tests/security/platform-isolation.test.ts` — 45 live-HTTP tests covering the full Phase-6 isolation matrix (all four school roles × platform routes; multi-school management incl. provision→activate→suspend→delete; cross-tenant platform attempts; school-session↔platform-session disjointness incl. forged-cookie probes; MFA; step-up; rate limits; support-session read-only/expiry/revocation; session lifecycle).
- Browser E2E (agent-browser): MFA login → console → schools → school detail → suspend (step-up gate dialog → TOTP → suspended) → reactivate → Access School → oversight banner + countdown → exit; school login shows the platform announcement and **no Super Admin anywhere**; zero horizontal overflow at 320px on every platform surface; 401-redirect to `/platform/login` after credential clear.
- Gates at close: `tsc --noEmit` 0 errors · eslint 0 errors · **423/423 tests + 5/5 e2e green**.
