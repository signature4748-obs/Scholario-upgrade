# CI — Scholario-OS (Phase 8B, Task 8B-16)

The workflow lives at `.github/workflows/ci.yml` (`name: CI`, job `verify`).
It supersedes the parked Phase-4/7-era file `.github/ci.yml.disabled`
(SQLite `DATABASE_URL` file: URLs, pre-8A seed set), which has been
**deleted**.

## What CI runs

One job, `ubuntu-latest`, on `push`/`pull_request` to `main`
(`concurrency: ci-<ref>`, cancel-in-progress, `timeout-minutes: 50`,
`permissions: contents: read`):

| # | Step | Gate |
|---|------|------|
| 1–3 | `actions/checkout@v4` → `oven-sh/setup-bun@v2` → `bun install --frozen-lockfile` | reproducible toolchain |
| 4 | `bunx prisma generate` | Prisma Client exists before anything compiles |
| 5 | `bun run typecheck` | zero TypeScript errors |
| 6 | `bun run lint` | zero ESLint errors (warning baseline does not fail) |
| 7 | `bunx prisma migrate deploy` | the FULL migration chain applies to a fresh postgres |
| 8 | drift gate (`id: drift-gate`, bash) | migrated DB == datamodel, trgm-aware (below) |
| 9 | `bun run build` (`NODE_OPTIONS=--max-old-space-size=3072`) | canonical standalone production build |
| 10 | 5 guarded seeds, in order | canonical test corpus (below) |
| 11 | `nohup bun run dev > dev.log 2>&1 &` + readiness wait (≤300s on `/health/ready`) | live server for HTTP suites |
| 12 | `bun run test` | unit + integration + API + regression + security |
| 13 | `bun run test:e2e` | live-server user journeys |
| 14 | `if: failure()` → `tail -n 200 dev.log` | post-mortem on any red gate |

## The local-postgres strategy (no production DB is ever touched)

CI provisions an **ephemeral job-local `postgres:16` service container**
(`POSTGRES_PASSWORD: postgres`, port 5432, `pg_isready` health checks) and
points the whole job at it:

```yaml
DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres?connection_limit=6&pool_timeout=60
DATABASE_ENV: test
REALTIME_MODE: disabled
RATE_LIMIT_DB_SYNC: 'on'
```

- **No Supabase URL, no anon/service keys, no tokens, no `secrets.*`** — the
  workflow file is secret-free by construction; a leak of it leaks nothing.
  This also means realtime must be *explicitly* disabled
  (`REALTIME_MODE=disabled`): `src/lib/realtime/mode.ts` defaults to
  `supabase` transport whenever the Supabase platform env is present — in CI
  it never is, and the explicit value documents the intent regardless.
- `DATABASE_ENV: test` is the sanctioned non-production declaration the
  Phase-8A seed guards (`prisma/seed-guard.ts → assertSeedable`) require;
  `production` (or `NODE_ENV=production`) hard-refuses every seed.
- The container dies with the job — nothing persists, nothing to clean up,
  no possibility of pointing CI at a hosted database by accident.
- Migrations, drift gate, seeds, the live dev server and every HTTP/DB
  test all run against that one throwaway database, in that order.

## The trgm drift gate — rationale

Migration `00000000000002_pg_rls_search` plants ~24 `pg_trgm` GIN indexes
(`User_name_trgm`, `Student_admissionNo_trgm`, …) via **raw SQL**. They are
intentionally *not* Prisma schema objects — they are DB-level search
accelerators (the ⌘K search path). `prisma migrate diff` therefore always
reports them as pending removals when diffing the real database against
the datamodel. CI must not fail on this *known, sanctioned* difference —
but must fail on any OTHER drift (an ALTER, a CREATE, a non-trgm DROP that
means someone edited the schema without a migration).

Gate mechanics (validated against the real prisma 6.11 output format):

```
-- DropIndex
DROP INDEX "User_name_trgm";
```

the gate strips exactly `DROP INDEX "…_trgm";` statements + their
`-- DropIndex` comment headers + blank lines; **anything that survives is
drift → the step prints it and exits 1.** (Note: the literal
`-- DropIndex "name"` comment shape sometimes quoted in older notes does
not match prisma's actual `--script` output — the filter here was tuned on
the real output of a fully-migrated database.)

## Seeds (step 10) — order and safety

```bash
bun prisma/seed.ts               # demo tenant (Sunrise) + clean tenant (Green Valley)
bun prisma/seed-platform.ts      # platform control-plane admins
bun prisma/seed-tenant-isolation.ts # cross-tenant matrix fixtures
bun prisma/seed-website-cms.ts   # editorial docs (phase75 product suite asserts these)
bun prisma/seed-salary.ts        # demo payroll (structures + last-2-months payments)
```

Every script calls `assertSeedable` first (passes under
`DATABASE_ENV=test`), resolves ids at runtime, and is idempotent /
skip-if-exists. All credentials come from `prisma/seed-credentials.ts`
env-driven values with dev-safe defaults — **no secrets are needed in
CI**, and no credential is printed to the log.

## Known limitations (honest)

1. **Enabling the workflow needs a workflow-scoped push.** GitHub only
   accepts commits that create/modify files under `.github/workflows/`
   when the pushing credential has the `workflow` scope (or the file is
   added via the web UI). The repo's 2026-09-30 push token lacked that
   scope — the reason CI was parked as `ci.yml.disabled` in the first
   place. The operator must either push with a workflow-scoped PAT or add
   the file through the GitHub web UI; the workflow itself needs no
   configuration beyond that.
2. **Supabase-only suites now SKIP cleanly instead of failing.**
   Phase 8C fixed the four CI-red defects that the parked workflow would
   have hit on its very first run (each was authored against a
   Supabase-env sandbox and never CI-validated):
   - `pg-rls.test.ts` — its file-level `beforeAll` asserted the Supabase
     shape unconditionally → the whole file FAILED (not skipped) on
     local PG. Now: guard wraps hooks + every describe → 14 clean skips.
   - `realtime-bridge.test.ts` — unit derivation threw without
     `REALTIME_CHANNEL_SECRET`, live-HTTP asserted a mode the server
     cannot be in, publisher no-ops under `REALTIME_MODE=disabled` → 13
     red. Now: unit + publisher layers run everywhere via synthetic
     in-process env (restored in afterAll, fetch stubbed), live layer
     skips unless the server can be in supabase mode, the 401 boundary
     test runs in every mode.
   - `phase75-product.test.ts` gallery media test — real uploads answer
     503 without object storage (no local-disk fallback by design) → red
     in CI. Now: album-scoping proofs run everywhere; only the
     byte-serving test skips where storage cannot exist.
   - **Seed set** — `database-integrity.test.ts` requires
     `ExamSubjectConfig` rows that only `seed-teacher-academics` /
     `seed-roster-150` create; the old 5-seed step made that file red
     before any test ran. The step now runs the full canonical corpus
     (10 seeds, dependency-ordered; `seed-study-materials` excluded —
     it needs real object storage CI never has).
   - `tenant-isolation.test.ts` now heals its login buckets in `beforeAll`
     (the same `resetLoginBuckets` pattern platform-isolation already
     used) so its direct login-endpoint probes are order-independent.
3. **First-compile latency.** The dev server compiles routes lazily
   (`next dev --webpack`); the live suites already carry 45s per-test
   budgets for first-hit compilation, and the 50-minute workflow timeout
   is sized for it.

## What was validated locally vs derived (8B-16)

Locally validated (this sandbox, current tree): `bunx prisma generate`,
`bun run typecheck` (0 errors), `bun run lint` (0 errors / 59 warnings),
`bunx prisma migrate status` (5 migrations, all applied, "Database schema
is up to date!"), the exact drift-diff command + output format (24 trgm
drops, zero other statements), the drift-gate shell logic under
`bash -e` (clean → exit 0; synthetic drift → exit 1), and the workflow
YAML (parsed + structure-asserted with python3/PyYAML 6.0.3).

Derived (documented commands, not executed here): `migrate deploy` on a
fresh postgres, the 5 seed scripts (never run in this sandbox — the
Supabase integration DB must not be re-seeded), the production build in
the CI environment, the live suites, and e2e. Each is the repo's own
canonical script, proven repeatedly in prior phases (see `worklog.md`).
