# AUDIT 5/7 — EXTERNAL SERVICES STATUS (read-only reconciliation)
Audit date: 2026-10-09 · No configuration was changed; no credential values were printed.

---

## 1. GitHub (verified live, read-only API + git)

| Check | Result |
|---|---|
| `main` branch head | `3ae3c854b5dede47bee87671f2aa4e98101b012e` (matches `git ls-remote`) |
| Branch protection | **ENABLED** — required pull-request reviews configured on `main` |
| Active workflows | **0** (GitHub Actions `workflows` API `total_count: 0`) — all three workflows parked: `.github/ci.yml.parked`, `.github/production-db-migration.yml.parked`, `.github/release.yml.parked` (Oct 5) |
| Why parked | the push token has `repo` scope only (no `workflow` scope) — GitHub rejects workflow-file pushes; restore requires a workflow-scoped PAT or web-UI rename (documented in FINAL_PRODUCT_EXCELLENCE_REPORT §14/§16 + CI.md) |
| Pull requests | PR #1 (closed): "Phase 8 production hardening: timetable conflict domain errors, FK indexes, ops fixes" = `808bba9` |
| Last push | 2026-10-09 04:33 UTC — the `sandbox/v2-rebuild` branch (not main) |
| Repo visibility | **public** — secrets discipline is a live constraint (recurring documented warning) |
| Production deploy trigger | per README, pushes to `main` deploy both Vercel projects — BUT Phase 8C recorded that Vercel Git integration was never connected and the handoff token was invalid; actual deploy wiring is **unverified** (see §2) |

## 2. Vercel (status: UNVERIFIABLE from this workspace — honest)

- Production URLs (README): platform `https://scholario-platform.vercel.app`, school ERP `https://scholario-app-virid.vercel.app`, legacy unified `https://scholario-production.vercel.app` (deprecated, retained during decommission window).
- **No Vercel credential exists in this workspace** (env wiped; the 8C session recorded the handoff token as INVALID — `invalidToken`). Last verified live evidence (Oct 2, 8C report): production home 200, `/health/ready database:ok` (199 ms), cache-isolation + security headers live on the 8B-era build.
- Deployed-SHA vs. repo SHA: **cannot be established from here**. If Git integration is indeed not connected, production may still serve an older build than `3ae3c85`; if it were connected, the Oct-8 pushes would have deployed. This is a P1 verification item for the user (Vercel dashboard) — no action was taken from this sandbox.
- Domain routing/SSO protection: designed via `TenantDomain` model + `SCHOOL_EMBED_ORIGINS` (16/16 tenant-domains tests, H1); deployment protection ON for team aliases (8C record).

## 3. Supabase / PostgreSQL

- **Production DB (Supabase):** not reachable from this workspace (no credentials post-wipe). Last healthy probe: Oct 2 (`/health/ready database:ok` through the Vercel deployment). RLS enabled by migration, 24 GIN indexes, hot-path FK indexes, `database-integrity` 41/41 (H1). Read-only reconciliation of record counts / referential integrity / financial consistency: **NOT PERFORMED (credential-gated)** — flagged as P1 user-side check.
- **Local dev DB (embedded PG 18.4 via `mini-services/postgres-db`):** cluster directory wiped by the 10:32 reset; service not auto-started; currently DOWN. The app's Prisma layer therefore fails at datasource validation (Audit 4 §3.2).
- Migration chain: 18 migrations, latest `20261008071751_fk_hotpath_indexes_settlement_exam_schedule`; historical fresh-deploy + drift gates green (Sept-30 §16, Oct-2 8C). Not re-run this session (no DB; out of audit scope).

## 4. Resend (email)

- Code requires `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM` — **all absent from the current workspace env** (values never in repo). 8C recorded live email as credential-blocked; email-infra tests 10/10 (H1) and `docs/EMAIL.md` is the transport record (recently corrected by `7dbce14`).
- Sending-domain configuration / recent delivery failures / webhook status: **unverifiable from here** (no key). P1 user-side check.

## 5. Razorpay (payments)

- Code requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYMENTS_SANDBOX(+_SECRET)`, `PLATFORM_PAYMENT_WEBHOOK_SECRET` — **all absent from the current workspace env**.
- Webhook receiver (static audit, healthy design): HMAC-SHA256 signature with `timingSafeEqual`; DB-persisted idempotency (`WebhookEvent.eventId @unique`); `Payment.transactionId @unique` blocks double-mint; auto-reconciliation on captured/failed/settled events; in-process fast dedup before DB.
- Live payment/ledger/receipt reconciliation: **NOT PERFORMED (no credentials, and production DB unreachable)**. The two-stage fee workflow invariants (receipt uniqueness `@@unique([schoolId, receiptNo])`, ledger-on-verify-only) are schema-enforced — but live ledger verification is a P1 user-side check. Sandbox mode exists (`PAYMENTS_SANDBOX`) for non-live verification.

## 6. Environment-variable presence summary (names only — no values)

Workspace `.env` (bootstrap template): `DATABASE_URL` (broken SQLite value) — **that is all**.
Code reads 38 env names; `.env.example` documents 5 (DATABASE_URL, DATABASE_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY). Full code-read list: APP_URL, DATABASE_ENV, DATABASE_URL, DB_SLOW_QUERY_MS, EMAIL_FROM, FILE_SIGNING_SECRET, GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI, LOG_LEVEL, NEXT_RUNTIME, NODE_ENV, PAYMENTS_SANDBOX(+_SECRET), PLATFORM_PAYMENT_WEBHOOK_SECRET, PLATFORM_TOTP_ENABLED, RATE_LIMIT_DB_SYNC, RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET, REALTIME_CHANNEL_SECRET, REALTIME_MODE, RESend (RESEND_API_KEY, RESEND_WEBHOOK_SECRET), SCHOLARIO_ALLOW_UNIFIED_PRODUCTION, SCHOLARIO_DEFAULT_PASSWORD, SCHOLARIO_DEV_BEARER, SCHOLARIO_LAZY_PORT, SCHOLARIO_PLANE, SCHOOL_APP_BASE_URL, SCHOOL_EMBED_ORIGINS, SCHOOL_GATEWAY_ENC_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, VERCEL_PROJECT_PRODUCTION_URL, VERCE_URL (sic — pre-existing typo'd name in code).
**Restoration source: the operator's secret store** (values were correctly never committed; secrets-scan suites green in history).
