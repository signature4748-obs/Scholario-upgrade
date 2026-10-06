# Deployment Architecture & Operations

> One application · one database · many tenants. This document describes how
> Scholario is deployed, promoted, and operated. It contains **no secrets** —
> see the env-var matrix below for where each value lives.

## Topology

| Layer | Provider | Resource |
| --- | --- | --- |
| Application | Vercel | **two production projects**: `scholario-platform` (control plane) + `scholario-app` (school plane) — same repo, same build, split by `SCHOLARIO_PLANE`. Legacy `scholario-production` (unified) is **deprecated** — `docs/VERCEL_PROJECTS.md` §7 |
| Database | Supabase | project `scholario-production` (ap-south-1, PostgreSQL 17, Supavisor pooling) |
| Realtime | Supabase Realtime | broadcast channels (capability names, HMAC-signed) |
| Storage | Supabase Storage | tenant-scoped buckets, signed URLs |
| Email | Resend | transactional sends (server-side only) |
| Source of truth | GitHub | `signature4748-obs/Scholario-upgrade` (main = production) |

There is **one repository, one Supabase project, and two production Vercel
projects** — the two planes build from the same code and share the same
database. The deprecated legacy project (`scholario-production`) still
auto-deploys `main` during its decommission window (rollback path only).
Schools are tenants (rows), never deployments. Adding a school is a data
operation performed by the platform administrator through the control plane —
no infrastructure changes.

## Promotion flow

```
development ──► (PR / push) ──► main ──► production DB migration ──► Vercel production deployment
                                     │            (workflow/ scripts      │
                                     │             — MUST be green)      │
                                     └──► production domain (verified)
```

- `main` is the production branch (Vercel Git integration, auto-deploy on push).
- `development` is the working branch. Feature branches merge into development;
  development merges into main after QA.
- **The production database migration runs BEFORE the application deployment
  that depends on it** — the single authoritative pipeline is the **Release**
  workflow (`.github/release.yml.parked`; runbook `docs/RELEASE.md`):
  tests → config pre-flight → production DB migration (pre-flight gates →
  transactional apply with true Prisma checksums → A–G verification) →
  release gate → Vercel deployment → SHA-provenance + health verification.
  Until the workflow is enabled + the Vercel deploy-hook switch is made, run
  the same chain by dispatch on the exact release commit (or the
  `scripts/prod-migration/` + `scripts/prod-release/` stages by hand) and
  wait for green BEFORE pushing main. See `docs/PRODUCTION_DB_MIGRATION.md`
  for the migration stages in depth.
- Production deployments always correspond to a Git commit SHA — no manual
  source edits on Vercel, no local-only builds.
- Preview deployments run for every branch push (Vercel preview env).

## Environment variables (Vercel → all of development / preview / production)

| Variable | Class | Notes |
| --- | --- | --- |
| `DATABASE_URL` | server-only | Supavisor **session-mode** pooler (port 5432), `connection_limit=2`, user `postgres.<ref>`. Migrations and runtime both run through the pooler — the IPv6-only direct endpoint is not used. |
| `DATABASE_ENV` | server-only | environment marker (`development` / `test` / `staging` / `production`); set to `production` on both plane projects — gates seed guards and prod locks. |
| `SUPABASE_URL` | server-only | project origin; also used to derive the **CSP `connect-src`** realtime origin (see `src/lib/security/headers.ts`). |
| `SUPABASE_ANON_KEY` | publishable | handed to authenticated browsers by `/api/realtime/config` (subscription transport). Never grants data access — the database is deny-all (see TENANT docs). |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | used ONLY by server-side realtime REST publish. Never exposed to the client; `SUPABASE_*` never use the `NEXT_PUBLIC_` prefix. |
| `FILE_SIGNING_SECRET` | server-only | signed media access URLs. |
| `REALTIME_CHANNEL_SECRET` | server-only | HMAC key signing capability channel names (unguessability = authorization). |
| `RESEND_API_KEY` | server-only | Resend REST transport for transactional email (server-side only, no `NEXT_PUBLIC_`). |

Plane wiring (`SCHOLARIO_PLANE`, `SCHOLARIO_ALLOW_UNIFIED_PRODUCTION`,
`SCHOOL_APP_BASE_URL`) and the full per-project matrix live in
`docs/VERCEL_PROJECTS.md` §2.

Rules enforced by tests:
- No secret is ever `NEXT_PUBLIC_*` (headers/seed-guard/secrets-scan suites).
- Local dev/CI uses a local PostgreSQL with no Supabase/Resend credentials at
  all (realtime auto-resolves to `disabled`, email to the dev-log transport).

## Serverless compatibility rules

1. **No fire-and-forget network work.** Vercel freezes the function the moment
   the response returns — un-awaited `fetch` calls are killed mid-flight. Every
   realtime publish is `await`-ed (bounded 3 s, never throws). This was a real
   production bug (Phase 8C-N): six publish sites silently never delivered.
2. **No local filesystem persistence** in request paths — uploads go to
   Supabase Storage.
3. **No long-lived processes.** Realtime is Supabase Realtime (websocket,
   client-side) + stateless REST publishes (server-side). The legacy
   socket.io/event-stream service is dev-only (`REALTIME_MODE=event-stream`)
   and cannot activate on Vercel (no `3003` port, no Supabase env → mode
   resolves to `supabase` or `disabled`).
4. **Per-lambda Prisma reuse** — the Prisma client is a module singleton
   (see `src/lib/db.ts`), reused across warm invocations.

## CSP / realtime contract

The production CSP `connect-src` is derived from `SUPABASE_URL` (plus `wss:`
scheme of the same origin) because the realtime bridge connects to
`wss://<ref>.supabase.co`. Local/CI (no `SUPABASE_URL`) stays strict
`'self'`. Regression-pinned in `tests/security/headers.test.ts`.

## Operations runbook (quick reference)

| Task | Command / action |
| --- | --- |
| Deploy | push to `main` (auto) |
| Check health | `GET /health/live`, `GET /health/ready` (checks DB) |
| Migrations | **Production DB Migration pipeline** — `scripts/prod-migration/` (or the GitHub Actions workflow once enabled): pre-flight → transactional apply → verify. See `docs/PRODUCTION_DB_MIGRATION.md`. Runs from the exact release commit; secrets: `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`. (When a dedicated pooler credential is provisioned, `DATABASE_URL=<pooler session URL> npx prisma migrate deploy` from the same checkout is the drop-in equivalent — the pipeline writes byte-identical history.) |
| Rotation (DB password) | Supabase dashboard/API → update `DATABASE_URL` on Vercel → redeploy → verify `/health/ready` |
| Rotation (Resend key) | Resend dashboard → update `RESEND_API_KEY` on Vercel → redeploy → send probe |
| Backup | logical backup procedure in `docs/BACKUP_RECOVERY.md` |
| CI | `.github/ci.yml.parked` — workflows parked pending the GitHub token scope upgrade (see `docs/CI.md` + `docs/RELEASE.md`) |
