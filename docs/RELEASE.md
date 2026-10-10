# Production Release Runbook

> The single authoritative pipeline for releasing Scholario to production.
> **Ordering contract: DATABASE FIRST, APPLICATION SECOND** — the production
> database receives every migration the release depends on (applied +
> verified) BEFORE any application code that needs it is deployed. Never the
> other way around. This runbook is executed by the **Release** workflow
> (`.github/release.yml.parked`) and by hand with the same scripts.
>
> Contains no secrets — every credential lives in GitHub environment
> `production` or Vercel, never in the repo.

## 1. Pipeline (the order, enforced)

```
PR ─► tests (CI, pull_request) ─► merge to main
   ─► RELEASE workflow (on the exact release commit):
        1. ci                 full test matrix (job-local postgres ONLY)
        2. config-preflight   Vercel env CONFIGURED / MISSING (read-only)
        3. migration          PRODUCTION DB FIRST — preflight → apply →
                             verify A–G (fail-closed)
        4. release-gate       all green? else deployment is SKIPPED and
                             production stays at its known-good commit
        5. deploy             Vercel production deploy hook (AFTER the DB
                             has the new schema — APPLICATION SECOND)
        6. verify-deployment  release-SHA provenance + /health/ready
```

Current state of the triggers (see §9 Enablement):

| Stage | Mechanism | Status |
| --- | --- | --- |
| PR tests | `.github/ci.yml.parked` (`pull_request`) | parked (token scope) |
| Release chain | `.github/release.yml.parked` (`workflow_dispatch`; `push: main` commented until the Vercel switch) | parked (token scope) |
| Migration only | `.github/production-db-migration.yml.parked` | parked (token scope) |
| Vercel production deploy | Vercel Git integration — **auto-deploys on push to main** | live (main = production branch) |

Because Vercel still auto-deploys `main`, the safe order today is the
**dispatch mode**: run the release chain on the release commit first, promote
only after the gate is green (§4). The push-to-main trigger stays commented
until the Vercel deploy-hook switch (§9) makes the ordering a property of the
system.

## 2. Preflight (before anything touches production)

1. **Release commit chosen** — a SHA on `development` that passed the full
   matrix locally: `bunx tsc --noEmit` · `bun run lint` · `bun run test` ·
   `bun run test:e2e`.
2. **Config pre-flight** (read-only against Vercel; never reads values —
   names + target metadata only):

   ```bash
   VERCEL_TOKEN=… VERCEL_PROJECT_ID=scholario-production \
     bun scripts/prod-release/config-preflight.ts          # report + gate
   # add --warn-only for a pre-release report, --strict to also fail on
   # missing GOOGLE_* (otherwise Google degrades honestly off)
   ```

   Report shape — `CONFIGURED` / `MISSING` per variable, never values:

   | Category | Variables | Gate |
   | --- | --- | --- |
   | CORE | `DATABASE_URL`, `DATABASE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FILE_SIGNING_SECRET`, `REALTIME_CHANNEL_SECRET` | missing = **fail** |
   | RECOVERY | `RESEND_API_KEY`, `EMAIL_FROM` (this release ships password-reset email) | missing = **fail** |
   | GOOGLE | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | warn (optional capability); half-configured (ID without SECRET or vice versa) = **fail** |

   Missing a CORE/RECOVERY variable ⇒ fix it in Vercel →
   Settings → Environment Variables (Production) before proceeding.
3. **Migration pre-flight** (read-only; the workflow's `migration-preflight`
   job or by hand):

   ```bash
   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
     bun scripts/prod-migration/preflight.ts --out snapshot.json \
     --expect 20261005060000_platform_account_recovery
   ```

   Gates (any violation = STOP): production history must be a prefix of the
   repo's chain (unknown/failed/out-of-order rows = STOP); the pending set
   must match `--expect` exactly; target objects must not pre-exist;
   registered ADDITIVE-ONLY migrations must contain no data statements; a
   before-state snapshot (row counts, credential counts — never values) is
   saved for the post-verify comparison.

## 3. Migration (production DB — first, transactional, fail-closed)

```bash
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/apply.ts --expect 20261005060000_platform_account_recovery
```

- Each pending migration applies in exact timestamp order inside **one
  transaction** that also writes its `_prisma_migrations` row with the TRUE
  Prisma checksum (sha256 of `migration.sql`) — failure rolls the migration
  back and the run is RED.
- Applied via the Supabase Management API as the schema-owning `postgres`
  role — the only sanctioned channel (the pooler DB password is owner-held).
- **Never**: `prisma migrate reset`, force-anything, seeds, the dashboard SQL
  editor, printing credentials. One migration run at a time (workflow
  `concurrency: production-release`).

## 4. Migration verification, then the release gate

```bash
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/verify.ts --snapshot snapshot.json
```

Sections: **A** migration status (applied / 0 pending, true checksums) ·
**B** expected schema objects · **C** indexes (24 trgm + 11 schoolId) ·
**D** credential flags (counts only, never values) · **E** row-count
comparison vs the snapshot (no table may shrink) · **F** production
`/health/ready` · **G** account-recovery objects: `PlatformAdmin.google{Sub,
Email,LinkedAt}`, `PlatformPasswordReset` + `PlatformRecoveryTicket` tables,
6 indexes, `googleSub`/`tokenHash` UNIQUE, FK present, admin-state stability
(additive-only proof — existing admin passwords untouched).

**Release gate** (workflow job `release-gate`): deployment proceeds only when
ci = config = migration pre-flight = apply = verify = `success`. Any other
result — failure, skipped, cancelled, unknown; DB unreachable; history
inconsistent — the gate **closes**: the deploy job is skipped and production
stays at its previously deployed, known-good commit. A closed gate is a red
run, never silent. `migration_dry_run: true` rehearses everything with zero
writes (gate closes green, nothing deploys).

## 5. Application deployment (second)

- **Dispatch mode (today):** after the gate is green, promote manually —
  push the release commit to `main` (Vercel git integration deploys it), or
  dispatch the Release workflow with `deploy_after_gate: true` (requires the
  release SHA to already be `origin/main` HEAD — the workflow asserts it).
- **Push mode (target):** with the Vercel deploy-hook switch made (§9), a
  push to `main` fires the whole chain automatically and the workflow itself
  triggers the production deploy hook after the gate opens.
- The deploy hook URL is a secret (`VERCEL_DEPLOY_HOOK_URL`); it is never
  echoed. The hook responds 200 and Vercel builds `main` HEAD.

## 6. Post-deployment checks

The workflow's final job proves, fail-closed:

```bash
VERCEL_TOKEN=… VERCEL_PROJECT_ID=scholario-production \
  bun scripts/prod-release/verify-deployment.ts --sha <release-sha> \
  --url https://scholario-production.vercel.app --timeout-seconds 900
```

- the latest READY production deployment's git SHA **equals the release SHA**
  (no SHA metadata = UNKNOWN = STOP), and
- `/health/ready` answers 200 with `"database":"ok"`.

Then by hand (5 minutes, the operator smoke):

1. `GET /` → 200 (landing), `GET /platform/login` → 200.
2. Platform root login (password) → console renders; `/api/platform/auth/me` OK.
3. `POST /api/platform/auth/forgot-password` for a known admin → 200 generic
   body; the reset email arrives (Resend dashboard log).
4. If Google is configured: platform login shows the Google button; status
   probe `GET /api/platform/auth/google/status` → `{"configured":true}`.
5. `docs/PLATFORM_ACCOUNT_RECOVERY.md` §"Acceptance matrix" — the 12-scenario
   security matrix is enforced in CI (`tests/security/platform-account-recovery.test.ts`).

## 7. Rollback decision

| Situation | Decision |
| --- | --- |
| **Migration failed** (transaction rolled back) | Nothing changed. Fix the cause; re-run. Production app was never touched. |
| **Migration verified, app deploy failed** (Vercel build error) | Database is already migrated (additive). Re-run the deploy; or roll the app back by redeploying the previous known-good commit (Vercel → Deployments → … → Promote). Additive schema keeps the old app fully functional. |
| **App deployed, runtime regression** | Roll the APPLICATION back to the previous deployment (Vercel Promote). Database stays forward — the account-recovery migration is additive-only and inert for the old code. Only consider DB intervention for a data-corrupting bug — never `migrate reset`; write a forward-fix migration. |
| **Unknown state** (interrupted run, unverifiable) | STOP. Treat as closed gate. Investigate read-only (`preflight.ts` is read-only and safe); do not re-apply until the state is known. |

Rule of thumb: **roll the app forward or back freely; the database only
forward.** Every migration in this repo is additive-only by policy
(`assertAdditiveOnly` refuses data statements in registered migrations).

## 8. Google OAuth + Resend (production configuration)

**Google** (optional capability — degrades honestly off when unset; both
`GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` must be set
together, else the config gate fails):

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth
   client ID (Web application).
2. Authorized JavaScript origins: `https://<production-domain>`.
3. Authorized redirect URIs:
   `https://<production-domain>/api/platform/auth/google/callback`.
4. Set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (and
   `GOOGLE_OAUTH_REDIRECT_URI` only if the origin can't be derived) in
   Vercel → Settings → Environment Variables (Production).
5. Scopes are `openid` + `email` only; while the OAuth consent screen is in
   *Testing*, add the admins' Google accounts as test users (or publish).
   Full details: `docs/PLATFORM_ACCOUNT_RECOVERY.md`.

**Resend** (required for password-reset email — RECOVERY category):

1. Resend dashboard → Domains → Add the sending domain; add the returned
   DKIM/SPF DNS records at the domain's DNS provider.
2. After verification, set `EMAIL_FROM` = `Scholario <no-reply@<domain>>`
   and `RESEND_API_KEY` in Vercel (Production). Until the custom domain is
   verified, Resend's shared sender only delivers to the account owner —
   treat that as "not configured for real users". Full details:
   `docs/EMAIL.md`.

All of the above are server-only variables — never `NEXT_PUBLIC_*`.

## 9. One-time enablement (owner, in this order)

> **Status after Batch 1 (2026-10-10):** step 1 is DONE (all six Vercel
> secrets provisioned via the API, encrypted, values never printed —
> `VERCEL_PROJECT_ID` points at the active `scholario-platform` plane,
> both plane deploy-hook URLs stored); the deploy hooks of step 3 are
> CREATED (`release-gate-platform` / `release-gate-school`, ref `main`).
> The remaining owner actions are step 2 (workflow un-park — the push
> token carries `repo` scope only, re-verified Batch 1) and the two
> toggles of step 3 (skip-auto-deploy is NOT exposed by the Vercel REST
> API — verified against the live project model; it must be flipped in
> the dashboard). **The GitHub `production` environment's
> `SUPABASE_ACCESS_TOKEN` is INVALID (Management API 401 — re-verified
> Batch 1)**: replace it with a valid token or the migration stages can
> never run. Safe-path evidence from Batch 1: `config-preflight` GREEN
> against `scholario-platform`; `verify-deployment` GREEN against the live
> `3ae3c854` deployment; migration `preflight` fails loud on the invalid
> token with zero writes; the full 18-migration chain + 18/18 true
> checksums verified on disposable PostgreSQL (docs/STAGING.md §3).

1. **GitHub environment `production`** — provisioned:
   `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`
   (`scholario-platform`), `VERCEL_ORG_ID`, `VERCEL_DEPLOY_HOOK_URL`,
   `VERCEL_DEPLOY_HOOK_URL_SCHOOL`, `PRODUCTION_URL`.
   ⚠ `SUPABASE_ACCESS_TOKEN` exists but is INVALID — replace it (owner).
2. **Enable the workflows** (the push token lacks `workflow` scope — use the
   GitHub web UI or a workflow-scoped PAT; 60 seconds each): create
   `.github/workflows/release.yml`, `ci.yml`, `production-db-migration.yml`
   from the parked files' exact content. (The release-candidate branch
   `release/fee-admissions-rc1` carries them parked for review.)
3. **Vercel deploy-hook switch** (before un-commenting `on: push` in
   release.yml): Vercel → each plane project → Settings → Git → disable
   auto-deploy for production; the Deploy Hooks are already created and
   stored as the `VERCEL_DEPLOY_HOOK_URL` (platform) /
   `VERCEL_DEPLOY_HOOK_URL_SCHOOL` (school) secrets; then un-comment the
   `push: branches: [main]` trigger in release.yml. From that point a main
   push can physically never deploy before the migration is green. The
   skip-auto-deploy toggle is dashboard-only (not in the REST project
   model — verified).
4. Until step 3, keep using dispatch mode (§5) — Vercel still auto-deploys
   main pushes directly.

## 10. Hard rules (always)

- Migration failure / unknown state / DB unreachable / history drift ⇒ STOP
  — production stays at the known-good version.
- Never reset, never force, never seed production, never the SQL editor for
  migrations, never print a credential, never commit a secret.
- A red stage means red: investigate the cause before any re-run.
- `main` is production; only release through this pipeline.
