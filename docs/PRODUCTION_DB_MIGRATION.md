# Production Database Migration Pipeline

> **The authoritative, repeatable process for migrating the production
> database.** One channel, three fail-loud stages, true Prisma checksums,
> zero drift. This document is the contract: the database migration ALWAYS
> happens before application code that depends on the new schema reaches
> production — enforced by release sequencing (§5), never by a developer
> remembering.

Related: `docs/DEPLOYMENT.md` (topology & promotion), `docs/CI.md` (the
parked test workflow), `worklog.md` (SAAS-HARD-PROD, TRUTH-LOCK-FIX — the
two events that shaped this pipeline).

---

## 1. Why this pipeline exists

The 2026-10-04 **Production Truth Lock audit** left three verified Prisma
migrations pending on the development branch (`5df857b`) that production had
not received:

1. `20261004150000_credential_neutralization` — CRITICAL fix
2. `20261004153000_restore_trgm_search_indexes` — HIGH fix (24 GIN indexes)
3. `20261004154000_schoolid_indexes_tenant_tables` — HIGH fix (11 indexes)

Pushing main before migrating would have shipped a regenerated Prisma client
(the new `User` columns) against an unmigrated schema — every `User` query
failing, a production outage. Vercel auto-deploys main and does **not** run
migrations, so something else had to be the migration authority. Before this
pipeline, production migrations were applied ad-hoc (once by
`prisma migrate deploy` when the DB password was still shared, once by hand
through the Supabase Management API during the SaaS-hardening handoff —
which is exactly why one history row carried a placeholder checksum).
This pipeline replaces all of that with one repeatable mechanism.

## 2. Why the Management API channel

The production database password is **owner-held by design**: the final
forensic acceptance rotated it to the API boundary (the value lives only in
the owner's secure handoff — `docs/release/LAUNCH_ACCESS.md`), so no repo,
token, or script can — or should — carry it. The Supabase **Management API
query endpoint**, driven by `SUPABASE_ACCESS_TOKEN`, is the sanctioned
server-side migration credential for this architecture because it:

- executes as the `postgres` role — the role that **owns the application
  schema** and holds `BYPASSRLS` (verified live: `rolbypassrls = t`,
  `rolsuper = f`) — i.e. exactly the privileges `prisma migrate deploy`
  would run with;
- supports **multi-statement batches and explicit `BEGIN … COMMIT`** control
  (verified live), so every migration is one atomic transaction;
- never exposes or needs the DB password.

If the owner later provisions a dedicated migration credential
(`PROD_DATABASE_URL` pointing at the Supavisor session pooler), `bunx prisma
migrate deploy` can be swapped in as the apply stage with zero other
changes — the pre-flight/verify stages and history gates are identical
either way, because this pipeline writes **exactly what Prisma writes**.

## 3. The three stages (`scripts/prod-migration/`)

| Stage | Script | Writes? | Fails when |
| --- | --- | --- | --- |
| Pre-flight | `preflight.ts` | never (snapshot to a file) | history ≠ repo · pending ≠ expected · target objects already exist · unfinished/unknown rows |
| Apply | `apply.ts` | one transaction per migration | any SQL error (rollback + halt, never "successful") · post-row/object mismatch |
| Verify | `verify.ts` | never | pending ≠ 0 · checksum drift · columns/indexes missing · principals not flagged · any table shrank · `/health/ready` not ok |

Guarantees, in order of enforcement:

1. **History gate (§4 of the release plan):** production `_prisma_migrations`
   must be a *prefix* of the repository chain — no unknown migrations, no
   failed/rolled-back rows, no gaps, checksums identical to the repo files.
   Anything else ⇒ **STOP** (never force-reset, never `migrate reset`, never
   delete data, never blind `migrate resolve`).
2. **Expected-pending gate:** with `--expect`, the pending set must be
   *exactly* the listed migrations in timestamp order.
3. **Object-existence gate:** while a migration is pending, the objects it
   creates (columns / 24 trgm indexes / 11 schoolId indexes) must NOT exist —
   this is the "not already applied under a different migration state"
   protection.
4. **Transactional apply:** each migration runs as `BEGIN; <migration.sql>;
   INSERT INTO _prisma_migrations (…true checksum…); COMMIT;` — one batch,
   one transaction. Failure ⇒ nothing lands, nothing is recorded.
5. **True Prisma checksums:** rows are written with `sha256(migration.sql)`
   — byte-identical to what `prisma migrate deploy` records (verified 13/13
   against a locally `migrate deploy`-ed database). `prisma migrate
   deploy/status` treat this pipeline as their own: **zero drift, no repair
   markers, idempotent re-runs**.
6. **No seeds. Ever.** Production data is only ever touched by the
   version-controlled migration files' own statements.
7. **Verification A–F:** migration status · schema · indexes · credential
   flags (counts only — password values are never read, printed, or
   compared) · row-count comparison against the pre-flight snapshot (no
   public table may shrink; `_prisma_migrations` must grow by exactly the
   applied count) · production `/health/ready`.

### The one documented divergence (repaired by the pipeline)

Migration `20261004090000_saas_hardening_entitlement` was applied to
production through this same Management API channel during the SaaS-hardening
handoff, and its history row was recorded with the placeholder checksum
`'saas-hardening-manual-apply'` (worklog SAAS-HARD-PROD). `apply.ts` verifies
all eight of that migration's tables exist, then rewrites the row's checksum
to the true file checksum — transactionally, once, and only that row. The
exact divergence is understood and documented; after the first pipeline run
the history is pristine.

## 4. Running it

### The GitHub Actions workflow (the intended home)

`.github/production-db-migration.yml.parked` — identical constraints to the
parked CI workflow (docs/CI.md): pushing `.github/workflows/*` requires a
`workflow`-scoped PAT (or the web UI). Enable once, in 60 seconds:

1. GitHub → repository → create
   `.github/workflows/production-db-migration.yml` with the parked file's
   exact content (web editor), **or** push it with a workflow-scoped PAT.
2. The workflow reads its secrets from the **`production` environment**
   (already provisioned: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` —
   repo Settings → Environments → production). The jobs declare
   `environment: production`, so no further configuration is required.
   To rotate: Settings → Environments → production → update the secret, or
   `gh secret set SUPABASE_ACCESS_TOKEN --env production --repo <repo>`.
3. Run it: **Actions → Production DB Migration → Run workflow** on the exact
   release commit, with the expected pending set (e.g.
   `20261004150000_credential_neutralization,20261004153000_restore_trgm_search_indexes,20261004154000_schoolid_indexes_tenant_tables`).

Only after the run is green does main get pushed (see §5).

### From an operator machine (same code, same gates)

```bash
SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/preflight.ts --out /tmp/snapshot.json --expect <csv>

SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/apply.ts --expect <csv>

SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/verify.ts --snapshot /tmp/snapshot.json
```

`apply.ts --dry-run` prints the exact transactional batches without writing.
Credentials are read from the environment, never printed, never committed.

## 5. Release sequencing (schema compatibility order, enforced)

```
development ──► tests ──► staging/preview (Vercel preview env)
     ──► migration pre-flight (dry-run gates)
     ──► merge to main ──► PRODUCTION DB MIGRATION (workflow, on the release commit)
     ──► migration verification GREEN
     ──► application deployment (Vercel production)
```

Today the last two steps are sequenced **manually** (dispatch the workflow
on the release commit → verify green → push main → Vercel deploys). The
fully automated variant (proposed, owner opt-in):

- switch the Vercel project's production deploys to **Deploy Hook only**
  (Settings → Git: disable auto-deploy for production);
- enable `on: push: branches: [main]` on the workflow and add a final gate
  job that, after verification, triggers the Vercel Deploy Hook via
  `VERCEL_DEPLOY_HOOK_URL` (a secret).

Then a main push can physically never deploy the application before the
database migration has been applied and verified — the ordering becomes a
property of the system instead of a step in the runbook. (Until that switch
is made, keep the manual order above; Vercel still auto-deploys main.)

## 6. Operational rules (hard)

- Never `prisma migrate reset`, never force-reset, never delete production
  data, never touch Supabase's dashboard SQL editor for migrations.
- Never run seeds against production.
- Never commit, print, or log `SUPABASE_ACCESS_TOKEN` (or any credential).
- One migration run at a time (workflow `concurrency` group).
- The migration runs from the **exact release commit** checkout — the
  workflow logs `GITHUB_SHA` and every migration's sha256; the operator
  path prints the same.
- A red stage means red: investigate, do not re-run until the cause is known.
