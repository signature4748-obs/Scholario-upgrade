# Vercel Projects — the three deployments

> One repository builds three Vercel projects from the same codebase. The
> `SCHOLARIO_PLANE` environment variable decides which half of the route
> surface exists on each project (`src/lib/plane.ts`, `src/middleware.ts`).
> Companion docs: `docs/ARCHITECTURE.md` (system map), `docs/DEPLOYMENT.md`
> (operations), `docs/RELEASE.md` (release pipeline).

## 1. The deployments

| Project | ID | Plane variable | Serves | URL | Status |
| --- | --- | --- | --- | --- | --- |
| `scholario-platform` | `prj_gIO4DmWcBkHMhwkVpmzqqHNWU0MW` | `SCHOLARIO_PLANE=platform` | control plane ONLY: `/platform/*` console, `/api/platform/*`, shared infra | `https://scholario-platform.vercel.app` | **active — production control plane** |
| `scholario-app` | `prj_oiKZtuC7UgOSsShQ63MWxS5nWu53` | `SCHOLARIO_PLANE=school` | school plane ONLY: `/s/<slug>/login` doors, `/login`, ERP APIs, shared infra | `https://scholario-app-virid.vercel.app` | **active — production school plane** |
| `scholario-production` | `prj_cJFN4oYHZEM50ooGKUMiQmG3e6qM` | `SCHOLARIO_PLANE=unified` + `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1` | BOTH planes (legacy topology) | `https://scholario-production.vercel.app` | **DEPRECATED** — retained during the decommission window (§7); no new entry points |

Shared infra served on **every** plane: `GET /api` (heartbeat + version),
`/api/app-version` (VersionGuard poll), `/api/webhooks/*` (provider-signed
webhooks — Resend, Razorpay, platform-subscription).

Cross-plane wiring: `scholario-platform` sets
`SCHOOL_APP_BASE_URL=https://scholario-app-virid.vercel.app` so the console
can surface each school's canonical login URL (`/s/<slug>/login`) — admins
never guess URLs.

Fail-closed rule: `platform` and `school` are the only valid production
planes. An unset, empty, or unrecognized `SCHOLARIO_PLANE` value in
production **refuses to load** (`src/lib/plane.ts` throws at module load —
builds and requests fail loudly). `unified` survives in production only
behind the explicit `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1` opt-in, set
**only** on the deprecated legacy project. Local development defaults to
unified with the variable unset.

## 2. Environment variable matrix

| Variable | `scholario-production` | `scholario-platform` | `scholario-app` | Exposure | Purpose |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | ✅ | ✅ | **server-only** | Supavisor session-mode pooler (port 5432, `connection_limit=2`); runtime + migrations |
| `DATABASE_ENV` | ✅ `production` | ✅ `production` | ✅ `production` | server-only | environment marker; gates seed guards and prod locks |
| `SUPABASE_URL` | ✅ | ✅ | ✅ | server-only | project origin; derives CSP `connect-src` realtime origin |
| `SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | **publishable** (not a secret) | handed to authenticated browsers by `/api/realtime/config`; grants nothing (RLS deny-all) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ | **server-only — never browser** | realtime REST publish + Storage wrapper; module has a window-import guard |
| `RESEND_API_KEY` | ✅ | ✅ | ✅ | **server-only — never browser** | Resend REST transport |
| `EMAIL_FROM` | ✅ | ✅ | ✅ | server-side | sender override; default `Scholario <onboarding@resend.dev>` |
| `RESEND_WEBHOOK_SECRET` | ⛔ not set | ⛔ not set | ⛔ not set | server-only | Svix signature verification on `/api/webhooks/resend`; **route is fail-closed (401) until the owner sets it + registers the webhook** — see `docs/EMAIL.md` |
| `REALTIME_CHANNEL_SECRET` | ✅ | ✅ | ✅ | server-only | HMAC key signing capability channel names |
| `FILE_SIGNING_SECRET` | ✅ | ✅ | ✅ | server-only | signed media access URLs |
| `SCHOLARIO_PLANE` | `unified` (explicit) | `platform` | `school` | server-side | route-existence gate per plane; invalid values fail closed in production |
| `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION` | `1` | ⛔ not set | ⛔ not set | server-side | legacy-only opt-in that permits `unified` in production; nothing else sets it |
| `SCHOOL_APP_BASE_URL` | *(unset)* | `https://scholario-app-virid.vercel.app` | *(not needed)* | server-side | platform-only: computes cross-plane school login/public URLs |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | unset | unset | *(n/a)* | server-only | platform Google OIDC; unset = honestly off (`/api/platform/auth/google/status` → `enabled:false`); half-configured fails the release config gate |

Rules (tested — `headers` / `secrets-scan` / `seed-guard` suites):

- No secret is ever `NEXT_PUBLIC_*`; no `NEXT_PUBLIC_` Supabase prefix.
- Never exposed to the browser: `DATABASE_URL`, `DATABASE_ENV`,
  `SUPABASE_URL` (the value; its origin appears in CSP), the
  `SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
  `REALTIME_CHANNEL_SECRET`, `FILE_SIGNING_SECRET`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `SCHOOL_APP_BASE_URL`.
- **Secret classification**: the true secrets (`DATABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
  `REALTIME_CHANNEL_SECRET`, `FILE_SIGNING_SECRET`) are stored as
  Vercel **Sensitive** environment variables — values are hidden in the
  dashboard and cannot be re-read through the API. Rotate by overwriting;
  never by reading back.
- Obsolete integration-era variables were audited and removed from the
  legacy project (2026-10-06): `POSTGRES_HOST/USER/PASSWORD/DATABASE/URL/
  PRISMA_URL/URL_NON_POOLING`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/PUBLISHABLE_KEY` — zero references
  in the codebase (verified by grep before deletion; the application has
  only ever read `DATABASE_URL` + `SUPABASE_*` as listed above).
- Local dev/CI runs a local PostgreSQL with **no** Supabase/Resend
  credentials (realtime resolves to `disabled`, email to the dev-log
  transport).

Release-pipeline secrets live in the GitHub `production` environment, not
Vercel: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
(`kbyknezedewvgrnqervj`), `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
`VERCEL_ORG_ID`, `VERCEL_DEPLOY_HOOK_URL` (see `docs/RELEASE.md` §9).

### Target notes (production / preview / development)

- Application variables are set on **all three Vercel targets**
  (production, preview, development) per project, as in
  `docs/DEPLOYMENT.md`.
- `SCHOLARIO_PLANE` is a project-level property — **previews inherit the
  plane**. A preview of `scholario-platform` has no `/s/*` doors; a preview
  of `scholario-app` has no `/platform/*` console. Previews of both planes
  respect the same gate as production, so cross-plane QA is faithful.
- Vercel deployment protection (SSO on team aliases) applies to the
  projects; team `signature4748-2940`.

## 3. How deploys happen

- All three projects are connected to the same GitHub repository with
  production branch `main` (Vercel Git integration). **A push to `main`
  deploys all three projects** from the same commit — the plane split is
  an env var, not a fork.
- Every branch push builds Vercel **preview deployments** on each project
  (plane-inherited, see above).
- Production deployments always correspond to a Git commit SHA — no manual
  source edits, no local-only builds.
- Region: `bom1` (same region as the Supabase project `ap-south-1`) for
  `scholario-production`; keep the same region for the two plane projects.

## 4. Migration order (unified → two planes) — COMPLETE

The staged cutover finished on 2026-10-06; both plane projects are live,
independently verified, and serve all production entry points:

| Step | State |
| --- | --- |
| 1. `scholario-app` (school plane) deployed and smoke-verified | ✅ done — doors, branding, plane-gate 404s verified |
| 2. `scholario-platform` (platform plane) deployed with `SCHOOL_APP_BASE_URL` | ✅ done — console login, `/s/*` 404s, absolute `loginUrl` values verified |
| 3. Entry points on the plane URLs (console-emitted login URLs, school doors) | ✅ done |
| 4. `scholario-production` retained as fallback during a stability window | ✅ current — DEPRECATED, kept working (see §7) |
| 5. Decommission `scholario-production` | ⏳ owner decision after the stability window — runbook in §7 |

## 5. Deploy hook & release gate (migration-first ordering)

The ordering contract is **DATABASE FIRST, APPLICATION SECOND** — the full
chain and gates are documented in `docs/RELEASE.md`:

```
tests → config-preflight → production DB migration (preflight → apply →
verify A–G) → RELEASE GATE → deploy → SHA-provenance + /health/ready
```

- Today the Release workflow runs in **dispatch mode** (run the chain on
  the release commit, promote only after the gate is green) because Vercel
  still auto-deploys `main`. The push-to-main trigger stays commented until
  the Vercel deploy-hook switch (Vercel → Project → Settings → Git →
  disable auto-deploy; create a Deploy Hook; store its URL as
  `VERCEL_DEPLOY_HOOK_URL`).
- The release scripts (`scripts/prod-release/config-preflight.ts`,
  `verify-deployment.ts`) take `VERCEL_PROJECT_ID` — currently
  `scholario-production`. Extending the gated pipeline to the two plane
  projects means running the same stages per project id (same scripts, same
  gates); until then the plane projects ride the push-to-main deploys and
  the migration gates run once against the shared database (all three
  projects use the **same** `DATABASE_URL`, so a gated migration protects
  all of them simultaneously).

## 6. Operator quick reference

| To… | Do this |
| --- | --- |
| See what a plane serves | `SCHOLARIO_PLANE` value + the route table in `docs/ARCHITECTURE.md` §6. |
| Verify the plane gate | `curl https://scholario-platform.vercel.app/s/anything` → honest 404; `curl https://scholario-app-virid.vercel.app/platform/login` → honest 404. |
| Find a school's canonical login URL | Platform console → Schools (rows carry `loginUrl` = `SCHOOL_APP_BASE_URL` + `/s/<slug>/login`). |
| Deploy all three | Push to `main` (after the release chain is green — `docs/RELEASE.md`). |
| Roll back an app | Vercel → Deployments → Promote the previous known-good deployment (per project). Database only rolls forward (additive-only policy). |
| Rotate a secret | Overwrite the Vercel env var (secrets are Sensitive — they cannot be read back), then redeploy the affected projects. |

## 7. Legacy project `scholario-production` — DEPRECATED

**Status: deprecated.** The unified deployment was superseded by the
two-plane architecture on 2026-10-06. It still auto-deploys `main`, keeps
serving both planes at `https://scholario-production.vercel.app`, and
requires the explicit `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION=1` opt-in to
boot in production (without that opt-in, `unified` fails closed like any
other legacy value).

**Rollback status (audited 2026-10-08): BROKEN — not a rollback target.**
The project auto-deploys current `main` (READY) with its legacy
environment set, but its `/health/ready` answers
`503 {"status":"unavailable","checks":{"database":"failed"}}` — the stale
database configuration cannot serve any tenant traffic. The two plane
projects are the only working deployments; rollback goes through them
(Vercel deployment rollback on a plane project, or redeploying an
earlier `main` commit). The decommission decision below no longer waits
on a stability window for the unified plane's sake.

**What still references the legacy URL (audit 2026-10-06):**

- Nothing in the codebase or the platform console — the console emits
  `scholario-app-virid.vercel.app` login URLs (`SCHOOL_APP_BASE_URL`).
- No Resend webhook, no custom domain, no DNS, no GitHub workflow targets
  it exclusively (release scripts take `VERCEL_PROJECT_ID` — point them
  at a plane project when the gated pipeline is extended).
- User bookmarks / shared links to `scholario-production.vercel.app` and
  the documented (unconfigured) Google OAuth redirect example are the only
  known soft references. Any future Google OAuth client must use
  `https://scholario-platform.vercel.app/api/platform/auth/google/callback`.

**Safe decommission runbook (owner action, in order):**

1. **Confirm stability** — both plane projects serve production traffic
   for the agreed window (suggested: ≥ 2 weeks) with no rollbacks to the
   unified deployment.
2. **Migrate residual links** — tell schools to bookmark
   `https://scholario-app-virid.vercel.app/s/<slug>/login`; platform staff
   use `https://scholario-platform.vercel.app/platform/login`.
3. **Point shared infra at the planes** — if a Resend webhook was ever
   registered on the legacy URL, re-register it on
   `https://scholario-platform.vercel.app/api/webhooks/resend` (the route
   is served on every plane; one registration is enough).
4. **Freeze it (optional intermediate step)** — Vercel → Project Settings
   → Git → disable auto-deploy, so the legacy project stops tracking
   `main` while its URL stays alive.
5. **Delete the project** — Vercel → `scholario-production` → Settings →
   General → Delete Project. Its `*.vercel.app` domain and its env vars
   (including the Sensitive ones) are destroyed with it. Nothing else
   breaks: the planes, the database, and the repository are independent of it.
6. **Tidy after deletion** — remove `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION`
   knowledge from onboarding docs if desired; the code keeps accepting the
   opt-in harmlessly (it is simply never set).

**Deletion remains an explicit owner decision.** Since the 2026-10-08
audit (above) the unified plane can no longer serve traffic at all —
there is no technical reason to keep it, only the owner's call on when
to remove the URL and its legacy secrets from the world.
