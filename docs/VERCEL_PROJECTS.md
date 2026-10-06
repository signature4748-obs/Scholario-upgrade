# Vercel Projects — the three deployments

> One repository builds three Vercel projects from the same codebase. The
> `SCHOLARIO_PLANE` environment variable decides which half of the route
> surface exists on each project (`src/lib/plane.ts`, `src/middleware.ts`).
> Companion docs: `docs/ARCHITECTURE.md` (system map), `docs/DEPLOYMENT.md`
> (operations), `docs/RELEASE.md` (release pipeline).

## 1. The deployments

| Project | ID | Plane variable | Serves | URL | Status |
| --- | --- | --- | --- | --- | --- |
| `scholario-production` | `prj_cJFN4oYHZEM50ooGKUMiQmG3e6qM` | *(unset → unified)* | BOTH planes — the legacy topology, byte-compatible | `https://scholario-production.vercel.app` | live; **retained until decommissioned** |
| `scholario-platform` | `prj_gIO4DmWcBkHMhwkVpmzqqHNWU0MW` | `SCHOLARIO_PLANE=platform` | control plane ONLY: `/platform/*` console, `/api/platform/*`, shared infra | `https://scholario-platform.vercel.app` | active |
| `scholario-app` | `prj_oiKZtuC7UgOSsShQ63MWxS5nWu53` | `SCHOLARIO_PLANE=school` | school plane ONLY: `/s/<slug>/login` doors, `/login`, ERP APIs, shared infra | `https://scholario-app.vercel.app` | active |

Shared infra served on **every** plane: `GET /api` (heartbeat + version),
`/api/app-version` (VersionGuard poll), `/api/webhooks/*` (provider-signed
webhooks — Resend, Razorpay, platform-subscription).

Cross-plane wiring: `scholario-platform` sets
`SCHOOL_APP_BASE_URL=https://scholario-app.vercel.app` so the console can
surface each school's canonical login URL (`/s/<slug>/login`) — admins
never guess URLs.

Fail-open rule: an unset, empty, or **unrecognized** `SCHOLARIO_PLANE`
value resolves to `unified` — a typo'd plane value must never silently
delete half the product.

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
| `RESEND_WEBHOOK_SECRET` | ✅ | ✅ | ✅ | server-only | Svix signature verification on `/api/webhooks/resend` (fail-closed without it) |
| `REALTIME_CHANNEL_SECRET` | ✅ | ✅ | ✅ | server-only | HMAC key signing capability channel names |
| `FILE_SIGNING_SECRET` | ✅ | ✅ | ✅ | server-only | signed media access URLs |
| `SCHOLARIO_PLANE` | *(unset)* | `platform` | `school` | server-side | route-existence gate per plane |
| `SCHOOL_APP_BASE_URL` | *(unset)* | `https://scholario-app.vercel.app` | *(not needed)* | server-side | platform-only: computes cross-plane school login/public URLs |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | ✅ (opt-in) | ✅ (opt-in) | *(n/a)* | server-only | platform Google OIDC; unset = honestly off; half-configured fails the release config gate |

Rules (tested — `headers` / `secrets-scan` / `seed-guard` suites):

- No secret is ever `NEXT_PUBLIC_*`; no `NEXT_PUBLIC_` Supabase prefix.
- Never exposed to the browser: `DATABASE_URL`, `DATABASE_ENV`,
  `SUPABASE_URL` (the value; its origin appears in CSP), the
  `SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
  `REALTIME_CHANNEL_SECRET`, `FILE_SIGNING_SECRET`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `SCHOOL_APP_BASE_URL`.
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

## 4. Migration order (unified → two planes)

The cutover is staged so production is never dark and rollback is always
"the old project still works":

| Step | Action | Verification |
| --- | --- | --- |
| 1 | `scholario-production` (unified) keeps serving production as-is | current state — live, health-checked |
| 2 | Deploy `scholario-app` (school plane); smoke the doors: `/s/<slug>/login` renders real branding, `/login` works, `/platform/*` 404s | `GET /health/ready` 200 `database:ok`; door renders; plane-gate checks |
| 3 | Deploy `scholario-platform` (platform plane) with `SCHOOL_APP_BASE_URL`; smoke: `/platform/login` 200, console login, `/s/*` 404s, school list returns absolute `loginUrl` values pointing at `scholario-app` | same health + surface checks from the platform origin |
| 4 | **Switch**: move user entry points to the plane URLs — the platform console's emitted login URLs already point at `scholario-app`; custom domains and future canonical domains attach to `scholario-app` | each school's door reachable on `scholario-app` |
| 5 | Old `scholario-production` retained temporarily as the known-good fallback | rollback path: re-point domains / communicate the unified URLs |
| 6 | Decommission `scholario-production` after a stability window | only after both plane deployments are proven stable |

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
| Verify the plane gate | `curl https://scholario-platform.vercel.app/s/anything` → honest 404; `curl https://scholario-app.vercel.app/platform/login` → honest 404. |
| Find a school's canonical login URL | Platform console → Schools (rows carry `loginUrl` = `SCHOOL_APP_BASE_URL` + `/s/<slug>/login`). |
| Deploy all three | Push to `main` (after the release chain is green — `docs/RELEASE.md`). |
| Roll back an app | Vercel → Deployments → Promote the previous known-good deployment (per project). Database only rolls forward (additive-only policy). |
