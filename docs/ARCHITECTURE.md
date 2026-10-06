# SCHOLARIO Production Architecture

> The full system map. One GitHub repository, one Supabase project, one
> production database, three Vercel deployments, one email provider. This
> document is the entry point — each subsystem has its own doc
> (cross-referenced below). It contains **no secrets**.

Related docs: `docs/VERCEL_PROJECTS.md` (deployment map + env matrix) ·
`docs/AUTH_ARCHITECTURE.md` (identity model) · `docs/TENANT_ROUTING.md`
(public tenant resolution) · `docs/SCHOOL_FACTORY.md` (provisioning) ·
`docs/EMAIL.md` (transactional email) · `docs/DEPLOYMENT.md` (operations) ·
`docs/RELEASE.md` (release pipeline) · `docs/CUSTOM_DOMAINS.md` (custom
domains).

## 1. The inventory (what exists, exactly)

| Resource | Provider | Identity | Notes |
| --- | --- | --- | --- |
| Source of truth | GitHub | `signature4748-obs/Scholario-upgrade` | `main` = production branch |
| Database + Storage + Realtime | Supabase | project `kbyknezedewvgrnqervj` (ap-south-1, PostgreSQL 17, Supavisor pooling) | **ONE production database**, 14 migrations, RLS deny-all |
| Control-plane deployment | Vercel | `scholario-platform` (`prj_gIO4DmWcBkHMhwkVpmzqqHNWU0MW`) | `SCHOLARIO_PLANE=platform` |
| School-plane deployment | Vercel | `scholario-app` (`prj_oiKZtuC7UgOSsShQ63MWxS5nWu53`) | `SCHOLARIO_PLANE=school` |
| Legacy unified deployment | Vercel | `scholario-production` (`prj_cJFN4oYHZEM50ooGKUMiQmG3e6qM`, live at `https://scholario-production.vercel.app`) | `SCHOLARIO_PLANE=unified` + legacy opt-in; **DEPRECATED** — retained until decommissioned (`docs/VERCEL_PROJECTS.md` §7) |
| Transactional email | Resend | REST send + signed delivery webhook | server-side only (`docs/EMAIL.md`) |
| Supabase Auth | — | — | **used for NOTHING** (see §4) |

**Anti-goals (things that deliberately do not exist):** no Kubernetes, no
microservices, no per-school databases, no per-school Supabase projects, no
per-school repositories. Adding a school is a **data operation** (rows in the
one production database) performed through the control plane — never an
infrastructure change.

## 2. Topology

```
                 GitHub: signature4748-obs/Scholario-upgrade  (main = production)
                                    │
                                    │  one codebase, one build per commit
          ┌─────────────────────────┼─────────────────────────────┐
          ▼                         ▼                             ▼
 ┌─────────────────────┐  ┌─────────────────────┐   ┌────────────────────────────┐
 │ VERCEL              │  │ VERCEL              │   │ VERCEL (legacy, DEPRECATED)│
 │ scholario-platform  │  │ scholario-app       │   │ scholario-production       │
 │ prj_gIO4DmWc…       │  │ prj_oiKZtuC7…       │   │ prj_cJFN4oYHZE…            │
 │ PLANE=platform      │  │ PLANE=school        │   │ PLANE=unified (+opt-in)    │
 │                     │  │                     │   │ (retained → decommission)  │
 │ PLATFORM PLANE:     │  │ SCHOOL PLANE:       │   │ everything (byte-compat)   │
 │  /platform/*        │  │  /s/<slug>/login    │   │                            │
 │  /api/platform/*    │  │  /login + ERP APIs  │   │                            │
 │  shared /api,       │  │  shared /api,       │   │                            │
 │  /api/webhooks/*    │  │  /api/webhooks/*    │   │                            │
 └────────┬────────────┘  └──────────┬──────────┘   └────────────┬───────────────┘
          │                          │                           │
          │ SCHOOL_APP_BASE_URL ─────┘                           │
          │ (console builds absolute school                       │
          │  login URLs: https://scholario-app-virid.vercel.app) │
          ▼                          ▼                           ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ SUPABASE — ONE project (kbyknezedewvgrnqervj, ap-south-1)                  │
 │  · Postgres 17 — ONE production DB: Prisma, 14 migrations, RLS deny-all    │
 │  · Storage — 'school-media' (PRIVATE default) + 'public-media' (public)    │
 │  · Realtime — HMAC capability channels (t:<schoolId>:<audience>:<sig>)     │
 │  · Auth — NOT USED: no GoTrue users; auth is the app's custom model        │
 └────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ RESEND — transactional email                                               │
 │  server-side REST sends (EmailDelivery audit rows) +                       │
 │  POST /api/webhooks/resend (Svix-signed bounce/complaint state sync,       │
 │  served on EVERY plane — shared infrastructure)                            │
 └────────────────────────────────────────────────────────────────────────────┘
```

The two plane projects deploy **the same commit of the same repository**;
`SCHOLARIO_PLANE` is a per-project environment variable that decides which
half of the route surface exists (route existence, **not** authorization —
`src/middleware.ts` + `src/lib/plane.ts`). An unset, empty, or unrecognized
value **fails closed** in production: the app refuses to load rather than
guess a plane. `unified` survives in production only on the deprecated
legacy project, which sets the explicit opt-in
`SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1`. Local development defaults to
unified when the variable is unset.

## 3. The 18 questions (answered directly)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Where does authentication happen? | In the application, server-side. School plane: `src/lib/auth.ts` — scrypt verify + `Session` row + `erp_session` HttpOnly cookie. Platform plane: `src/lib/platform/auth.ts` — `PlatformAdmin` + `PlatformAdminSession` + `scholario_platform_session` cookie + TOTP MFA. NOT in Supabase Auth (`docs/AUTH_ARCHITECTURE.md`). |
| 2 | Where is authorization enforced? | Three layers. (a) Middleware edge gate: plane route existence + platform-API credential presence (`src/middleware.ts`). (b) `withUser` (school APIs): live session, role, `mustChangePassword`, tenant binding via `User.schoolId`, subscription entitlement (`src/lib/api.ts`). (c) `withPlatform` (control-plane APIs): live session, ACTIVE admin, permission set, step-up MFA (`src/lib/platform/authz.ts`). Postgres RLS is the backstop. |
| 3 | Where is school identity stored? | The `School` row (id, slug, code, domain, status, plan, settings). Every member's tenant membership is `User.schoolId` — one column, server-side, immutable per user. |
| 4 | Where is tenant identity derived? | Authenticated requests: from the **server-side session** (`withUser` → `User.schoolId`). Public/anonymous requests: `src/lib/tenant/resolution.ts` — Host header → VERIFIED `TenantDomain` → legacy `School.domain` → `?slug=`/`?tenant=` → null. Public resolution selects **branding/content only**, never authorization (`docs/TENANT_ROUTING.md`). |
| 5 | Which Vercel project serves what? | `scholario-platform` → `/platform/*` console + `/api/platform/*` + shared infra. `scholario-app` → `/s/<slug>/login` doors, `/login`, school ERP APIs + shared infra. `scholario-production` → both planes (DEPRECATED legacy, retained during decommission window). Full table: `docs/VERCEL_PROJECTS.md`. |
| 6 | How is a school's login URL discovered? | The control plane computes it: `schoolLoginUrl(slug)` = `SCHOOL_APP_BASE_URL` + `/s/<slug>/login` (cross-plane) or `/s/<slug>/login` (unified fallback). It is returned by `POST /api/platform/schools` and surfaced in the schools list — admins never guess. |
| 7 | What is the new-school creation flow? | `POST /api/platform/schools` (permission `schools.provision`) — one atomic transaction creates School (PENDING) + `SchoolSubscription` (ACTIVE) + founding PRINCIPAL + optional PENDING `TenantDomain` + optional academic bootstrap. Separate audited `activate` step. Full detail: `docs/SCHOOL_FACTORY.md`. |
| 8 | How is the principal created? | Inside the same provisioning transaction: `User` row with `role=PRINCIPAL`, `status=ACTIVE`, `mustChangePassword=true`, scrypt-hashed password (supplied or crypto-random 12-char temp). |
| 9 | How does the principal get first access? | After platform activation: the login URL + the one-time temp password (shown once in the provisioning response). First sign-in hits the server-enforced forced password-change gate (`withUser` rejects business routes until changed). |
| 10 | Where do files live? | Supabase Storage. `school-media` (PRIVATE — everything by default) and `public-media` (PUBLIC — website-published media only). Paths are tenant-scoped: `<scope>/<schoolId>/<opaque-filename>` (`src/lib/storage/supabase.ts`). Private reads = short-TTL signed URLs minted only after tenant/role checks. |
| 11 | How is email sent? | `sendEmail()` in `src/lib/email/index.ts` — server-only pipeline: validate → dedupe (`dedupeKey`) → `EmailDelivery` PENDING row → render → Resend REST (bounded retries) → row SENT/FAILED. Never throws to callers. |
| 12 | What is Resend responsible for? | Transactional delivery (admission enquiries, salary receipts, platform password-reset), provider delivery state via the Svix-signed webhook, and domain-scoped sender identity. Nothing else — no auth, no data storage. |
| 13 | What is Supabase Auth responsible for? | **Nothing today.** Zero GoTrue users. Authentication is custom (scrypt + server-side sessions). This is a documented, revisitable decision — evidence and the future migration path: `docs/AUTH_ARCHITECTURE.md`. |
| 14 | What is Postgres responsible for? | Everything durable: all tenant data, `User`/`PlatformAdmin` credentials, `Session`/`PlatformAdminSession` tokens (hashed at rest), `RateLimitBucket` (shared rate-limit state), `TenantDomain`, `EmailDelivery` outbox, `PlatformAuditLog`/`ActivityLog` audit trails, RLS deny-all backstop. |
| 15 | Cloudflare later? | No Cloudflare layer exists or is planned in the current docs. Custom domains attach at the **Vercel edge**: DNS points at `cname.vercel-dns.com` / `76.76.21.21`, Vercel routes the hostname, and the app resolves the tenant from the Host header (`docs/CUSTOM_DOMAINS.md`). |
| 16 | What is the custom-domain lifecycle? | PENDING `TenantDomain` (random verification token) → school DNS TXT `_scholario-verify.<hostname>` + CNAME/A to Vercel → verify (TXT match) → `VERIFIED` → routes. Unverified mappings **never** route traffic. Full flow: `docs/TENANT_ROUTING.md` §5, `docs/CUSTOM_DOMAINS.md`. |
| 17 | How are cross-tenant attacks prevented? | Ten independent layers — see §5 below. Summary: public URL never authorizes; the session's `User.schoolId` is the only tenant authority; token spaces are disjoint per plane; RLS denies the anon key; hostnames are globally unique and verified. |
| 18 | How does code reach production? | Push to `main` → Vercel Git integration auto-deploys all three projects; migrations run **before** the app via the Release pipeline (dispatch mode today, deploy-hook switch planned) — `docs/RELEASE.md`, `docs/VERCEL_PROJECTS.md` §5. |

## 4. Provider responsibility matrix

| Concern | Owner | Not the owner |
| --- | --- | --- |
| Password hashing / verification | App (`scryptSync` + `timingSafeEqual`, `src/lib/auth.ts`) | Supabase Auth |
| Session issuance & revocation | App (`Session` / `PlatformAdminSession` rows, hashed tokens) | Supabase Auth |
| Authorization (role/tenant/permission) | App (`withUser` / `withPlatform`) + Postgres RLS backstop | Supabase Auth metadata (deliberately — see `docs/AUTH_ARCHITECTURE.md` §3) |
| Durable data | Postgres (Prisma, 14 migrations) | — |
| File bytes + ACL | Supabase Storage (buckets + signed URLs; ACL decisions in app routes) | Vercel filesystem (read-only, unused) |
| Realtime fan-out | Supabase Realtime (HMAC capability channels) | app-hosted socket.io (dev-only `event-stream` mode) |
| Email delivery + bounce state | Resend | app queue (the `EmailDelivery` table is the outbox/audit, not an MTA) |
| Domain routing / TLS termination | Vercel edge | Cloudflare (absent) |
| School identity | `School` + `User.schoolId` rows | DNS, subdomains-as-tenants |

**Supabase Auth: nothing.** There are no GoTrue users, and school/platform
authorization is never expressed in auth-provider metadata. The decision,
its evidence (185 existing scrypt password hashes that cannot be re-hashed
into GoTrue's bcrypt without a forced mass credential reset), and the
revisitable migration path are documented in `docs/AUTH_ARCHITECTURE.md`.

## 5. Cross-tenant attack prevention (the summary)

| # | Layer | Mechanism |
| --- | --- | --- |
| 1 | Tenant authority | Authenticated APIs derive the tenant ONLY from the session (`User.schoolId` via `withUser`). A forged `?tenant=` / `?slug=` / `?schoolId=` never switches it — regression-pinned in `tests/security/plane-architecture.test.ts`. |
| 2 | Public resolution | `resolvePublicSchool` selects branding only; unknown/implicit values fail to null (the SCHOLARIO SaaS website). A hostile Host header can only fail to resolve. |
| 3 | Domain uniqueness | `TenantDomain.hostname` is globally UNIQUE — cross-tenant domain collisions are structurally impossible (P2002 → 409). |
| 4 | Verified-only routing | Only `VERIFIED` TenantDomain rows route; DNS-squatting an unverified domain serves nothing. |
| 5 | Disjoint token spaces | `scholario_platform_session` / `x-platform-token` vs `erp_session` / `Authorization` — a school credential can never satisfy the platform boundary, in either direction. |
| 6 | Plane gate | The platform deployment has no `/s/*` login door to phish; the school deployment has no `/platform/*` console to probe (honest 404 at the edge). |
| 7 | RLS deny-all | 98 tables behind row-level security; the publishable anon key reads nothing (probe-role tests: `tests/security/pg-rls.test.ts`). |
| 8 | Storage | Private bucket by default, tenant-scoped paths `<scope>/<schoolId>/<file>`, signed URLs only after tenant/role checks; path segments validated against traversal. |
| 9 | Realtime | Channel names embed an HMAC (`REALTIME_CHANNEL_SECRET`) — cross-tenant subscription requires guessing an unguessable signature; names are issued server-side by `/api/realtime/config`. |
| 10 | Cache isolation | `private, no-store` + `Vary: Host` on `/api/schools/public`; no per-tenant static HTML exists (client-rendered SPA). |

## 6. Plane model (route existence, not authorization)

| Route | platform plane | school plane | unified (legacy) |
| --- | --- | --- | --- |
| `/platform/*` pages | ✅ served | ❌ 404 (edge) | ✅ served |
| `/api/platform/*` | ✅ served (credential-gated) | ❌ 404 — except `/api/platform/announcements/public` (the one public broadcast the school login door reads) | ✅ served |
| `/s/<slug>`, `/s/<slug>/login`, `/login` | ❌ 404 (edge) | ✅ served | ✅ served |
| School ERP APIs (`/api/auth`, `/api/students`, …) | ❌ 404 (edge) | ✅ served | ✅ served |
| `/api` heartbeat, `/api/app-version`, `/api/webhooks/*` | ✅ shared infra | ✅ shared infra | ✅ shared infra |

Authorization is unchanged by the plane split: `withUser`/`withPlatform`
enforce session, role, tenant, permission, step-up on every handler
regardless of plane. The gate only makes the wrong plane's surface vanish
from the wrong deployment. Preview and production targets of each project
inherit the same `SCHOLARIO_PLANE` value (`docs/VERCEL_PROJECTS.md`).

## 7. Operator quick reference

| To… | Do this |
| --- | --- |
| Find a school's login URL | Platform console → Schools row (the list returns `loginUrl` per school), or compute `https://scholario-app-virid.vercel.app/s/<slug>/login`. |
| Provision a school | Platform console → Add School wizard (6 steps) → activate from the school record. See `docs/SCHOOL_FACTORY.md`. |
| Attach a custom domain | Follow `docs/CUSTOM_DOMAINS.md` (TenantDomain + TXT proof + Vercel domain attach). |
| Check production health | `GET /health/live`, `GET /health/ready` (checks DB) on any plane deployment. |
| Deploy | Push to `main` (all three projects auto-deploy); migrations first — `docs/RELEASE.md`. |
| Trace an email | `EmailDelivery` row (send-side truth) + `WebhookEvent` rows (provider-side truth). `docs/EMAIL.md`. |

## 8. What this architecture intentionally is not

- **Not multi-repo / multi-build**: one repository, one Next.js build; the
  plane split is an environment variable, not a fork.
- **Not multi-tenant-at-the-edge**: there is no CDN-level tenant routing;
  the app resolves tenants from the Host header and session, at request
  time.
- **Not per-school infrastructure**: no school gets its own database,
  project, or deployment. Scale is rows, not servers.
- **Not provider-authenticated**: Supabase Auth is unused (documented
  decision, `docs/AUTH_ARCHITECTURE.md`); identity lives in Postgres tables
  the application owns end-to-end.
