# Staging & Environment Map

> Batch 1 (2026-10-10). The truthful state of every environment that can
> hold this application — what is isolated, what is NOT, and the exact
> missing resource for a cloud staging tier. **Never call a production-DB
> backed Vercel preview "staging".**

## 1. Environment map

| Environment | App | Database | Isolation | Status |
| --- | --- | --- | --- | --- |
| **Production** | Vercel `scholario-platform` (control plane) + `scholario-app` (school plane); `scholario-production` (deprecated, broken DB) | Supabase `kbyknezedewvgrnqervj` (aws-0-ap-south-1) — shared by all three projects | — | live at `3ae3c854` |
| **Vercel previews** | Per-branch preview deployments on each project (plane-inherited, SSO-protected) | **the PRODUCTION database** (env vars are set on all three Vercel targets) | ⚠ **NOT isolated** | auto-built on branch pushes |
| **Local staging (sandbox)** | Isolated `next dev` instance, port 3101, own `.next`, lazy port 3778, `DATABASE_ENV=staging` | Local embedded PostgreSQL **database `scholario_staging`** (separate database on the 127.0.0.1:5432 cluster) | ✅ isolated | verified Batch 1 (see §3) |
| **Local development** | `bun run dev` on :3000 (keepalive-managed) | Local embedded PostgreSQL database `scholario` | ✅ isolated from staging & prod | live |
| **CI** | GitHub Actions job (release workflow `ci` job) | job-local disposable `postgres:16` container | ✅ ephemeral | parked workflow (see docs/RELEASE.md §9) |

**Cloud staging database: DOES NOT EXIST.** The Supabase Management API
token in the release credentials is **invalid (401)** — project creation,
key listing and the migration API are unreachable. Creating the staging
Supabase project is the owner's action (free tier allows it; no new charge
expected); until then there is no genuinely isolated non-production
database reachable from Vercel. Everything short of that was completed
locally (§3).

## 2. Vercel preview caveat (why previews are not staging)

Application variables — including `DATABASE_URL` — are set on all three
Vercel targets (production / preview / development) per project
(`docs/VERCEL_PROJECTS.md` §2). A preview deployment therefore talks to
the **production database**. For this release specifically (compiled
Prisma client selects `User.credentialExpiresAt`, new fee/admissions
tables), a pre-migration preview is broken-by-design — which is exactly
the documented expand/contract ordering constraint. Production data is
never mutated through a preview (login fails closed), but the isolation
claim would be a lie: treat previews as build verification only.

## 3. Local staging (how it was built — recreate in ~5 minutes)

Disposable-by-design; nothing here touches the dev corpus or production.

```bash
# 1. Create the isolated database (embedded cluster, superuser conn)
bun .zscripts/stage-db.ts                      # CREATE DATABASE scholario_staging

# 2. Full migration chain (18 migrations incl. fee-admissions MVP)
DATABASE_URL="$(head -1 .zscripts/staging.env)" DATABASE_ENV=staging \
  bunx prisma migrate deploy

# 3. Sanitized demo fixtures — the canonical CI seed battery (NEVER a
#    production clone; no live credentials, session tokens or PII)
for s in seed seed-platform seed-learning seed-teacher-academics \
         seed-roster-150 seed-student-dashboard seed-teacher-hub \
         seed-tenant-isolation seed-website-cms seed-salary seed-platform; do
  DATABASE_URL="$(head -1 .zscripts/staging.env)" DATABASE_ENV=staging \
    bun "prisma/$s.ts"
done

# 4. Isolated app instance (double-fork detached so it survives the shell)
bun /tmp/stage-launch.mjs "$(head -1 .zscripts/staging.env)"   # → :3101
curl -s localhost:3101/health/ready      # {"status":"ready","database":"ok"}
```

Verified Batch 1: health/ready 200 (`database:ok`), both plane doors 200
(`/s/hawkings-prithvipur/login`, `/platform/login`), principal login 200 +
`/api/auth/me` → PRINCIPAL, browser login form render + successful
`POST /api/auth/login`. **Isolation proof**: login sessions landed in
`scholario_staging` (3 rows) while the dev database's session table and
count (30 / 0 recent) and production were untouched. Migration chain
carries 18/18 **true Prisma checksums** (`_prisma_migrations` = sha256 of
each `migration.sql`), all finished.

Known sandbox constraint (NOT a product defect): running a second full
webpack dev server alongside :3000 inside the 4GB cgroup — compiling the
`/` god-entry (~3.1–3.4GB peak, the exact case `lazyCompilation` exists
for) OOM-kills the staging instance at the kernel level. Health, doors and
login are the verified staging surface; the dashboard-level smoke runs
against :3000 (or on Vercel previews, which have real build memory).

## 4. Cloud staging — exact missing resource

| Need | Blocker | Owner action |
| --- | --- | --- |
| Isolated Supabase staging project (region `ap-south-1`, free plan) | Supabase Management API token invalid → HTTP 401 on every call (verified again Batch 1; the GitHub `production` environment holds an equally invalid `SUPABASE_ACCESS_TOKEN`) | Issue a valid access token (Supabase dashboard → Account → Access Tokens), store it as the `SUPABASE_ACCESS_TOKEN` secret, then create the staging project (or delegate creation) |
| Vercel preview targets pointed at staging | No staging database exists yet | After the project exists: set preview-target env vars (`DATABASE_URL`, `DATABASE_ENV=staging`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) on both plane projects, keeping production targets untouched |

Deploy hooks for the release-gate mechanism are already created
(`release-gate-platform`, `release-gate-school`, ref `main`) and stored as
GitHub `production` environment secrets (`VERCEL_DEPLOY_HOOK_URL`,
`VERCEL_DEPLOY_HOOK_URL_SCHOOL`) — see docs/RELEASE.md §9.
