# PHASE 1/9 — BASELINE (repository & deployment state, testing baseline)

Audit date: 2026-10-22 (17:15–18:45 UTC) · Method: read-only reconnaissance + CI-recipe local baselines + read-only production queries (Supabase Management API query channel). No production data was modified; no secrets are printed in this pack.

---

## 1. Repository identity (verified live)

| Item | Value | Evidence |
|---|---|---|
| Working directory | `/home/z/Scholario-upgrade` | `pwd` |
| Branch | `main`, **clean working tree**, in sync with `origin/main` | `git status -sb` |
| HEAD = origin/main | `7585fad77a0ddb8489d60183ae500cb16fd33837` — "Merge pull request #56 from fix/release-ci-webhook-fixture-parity" (2026-10-22T16:04:20Z merge) | `git rev-parse HEAD` = `git rev-parse origin/main` |
| Open PRs | **1**: #30 (DRAFT, review-only) "production-grade subscription & entitlement system (Models A/B/C…)" head `284d90a0`, base `main`, last updated 2026-10-14 | GitHub API `pulls?state=open` |
| Recent merged PRs | #56 → `7585fad` (release-CI webhook fixture parity) · #55 → `a8f9357` (Svix dual-scheme verification) · #54 → `942dee4` (webhook rejection ledger) · #53 → `e7887ee` (live-verification gaps) · #52/#51/#50 (provider webhook repair series) | GitHub API `pulls?state=closed`, sorted by update |
| Active workflows | 7: CI, Release, Production DB Migration, Email Live Delivery Verification, Email/Webhook Live Audit (sanitized), Email Provider Webhook Repair, Resend Webhook Configure/Repair | GitHub API `actions/workflows` |
| Architecture | Next.js 16 App Router · TypeScript · Tailwind 4 + shadcn/ui · Prisma + PostgreSQL (Supabase production / embedded PG 18.4 local) · custom scrypt auth · two-plane Vercel deployment (platform console + school ERP) | repo tree, `prisma/schema.prisma` |

Local-only branches present (all safe, untouched): `fix/live-verification-gaps`, `fix/platform-routing-recovery`, `fix/release-ci-webhook-fixture-parity`, `fix/svix-dual-scheme-verification`, `fix/webhook-create-field`, `fix/webhook-provider-repair`, `fix/webhook-rejection-ledger`, `fix/webhook-repair-field-and-ordering`. **No uncommitted work existed anywhere** (main tree was clean before this audit created its own evidence branch).

## 2. CI / Release state on main @ `7585fad` (verified live)

| Run | Workflow | SHA | Result | Created |
|---|---|---|---|---|
| 39810762044 | CI | 7585fad | **success** | 2026-10-22T16:04:23Z |
| 39810795955 | Release | 7585fad | **success** | 2026-10-22T16:04:36Z |
| 39802116911 | Email Live Delivery Verification | a8f9357 (post-#55 main) | **success** | 2026-10-22T15:09:17Z |
| 39797165140 | Release | a8f9357 | success | 2026-10-22T14:36:40Z |
| 39786635929 | CI | f4a7768 (#55 branch) | success | 2026-10-22T13:25:03Z |

The email → webhook → database chain from the previous workstream is therefore **complete and green at the gate**: after PR #55's dual-scheme Svix fix merged, the live delivery verification run (39802116911) succeeded on main, and PR #56 subsequently closed the Release-workflow fixture gap (the 21-test signed-webhook battery now runs in Release's embedded CI stage too — its commit message documents the 48-vs-27 skip delta evidence).

## 3. Production planes (Vercel) — deployment identity verified

| Plane | Project | Production deployment | SHA | State | Live check (2026-10-22) |
|---|---|---|---|---|---|
| Platform console | `scholario-platform` (`scholario-platform.vercel.app`) | `dpl_E8ZFhf3Aw8` | `7585fad` | READY (created 1792686520295, latest prod deployment) | `/` → 307 → `/platform/login` → **200** |
| School ERP | `scholario-app` (`scholario-app-virid.vercel.app`) | `dpl_9tz2dCLPbN` | `7585fad` | READY (created 1792686529889, latest prod deployment) | `/` → **200**; `/login` → **200** |

Both planes are on the **exact current main HEAD** — the latest intended deployment (Release run 39810795955 → deploy hooks → READY), not a stale deployment. Prior READY deployments on the same SHA (`dpl_4HnvTwo3wq`, `dpl_FtE3EAQJgz`, ~18 min earlier) are the Release run's first hook batch; the newest batch above is the live one.

## 4. Production database (read-only, via the repo's Supabase Management API query channel)

- 3 schools: **SBS SHIKSHA NIKETAN** (created 2026-10-20 10:33:57, ACTIVE — the wizard-created school central to the Class 0 investigation), **Hawkings High School Prithvipur** (demo corpus, 2026-10-01), **Green Valley Public School** (2026-10-01, ACTIVE).
- 26 applied migrations in production per the last in-repo verification pack (`audit/release-fd14234-verification-20261020T044436Z`); the repo now carries **28** (`prisma migrate status` locally — the two newer `platform_operations_center` / `platform_password_reset_new_email` migrations were applied by their documented release pipelines during PR #45–#49 window; their apply evidence lives in the release/ops audit trail).
- Read-only queries executed this session (SELECT only, via Management API): school list; Class rows per school with gradeLevel nullability; dependent-record counts; `PlatformAuditLog` events for the new school. Nothing was written.

## 5. Local environment limitations (honest)

| Constraint | Detail |
|---|---|
| 4 GB box | The repo's own prior audit (`audit/release-fd14234-verification-20261020T044436Z` §7.1) documents that the dev server OOM-cycles on this box under E2E+Chrome load. Confirmed again this session: Next's memory guard ("Server is approaching the used memory threshold, restarting…") fired during the e2e suites; a wrongly-set 4096 MB heap caused kernel OOM kills until reset to the repo's sandbox-tuned 1700 MB. **E2E journeys cannot run reliably on this box** — see §6. |
| Supabase Management API | One access token works (the second token in the handoff set is expired — "Invalid access token"). Query channel is read-write; this audit used SELECT-only. |
| Dev-server restart windows | Next dev (webpack + lazy compilation) intermittently holds in-flight requests 45–65 s during restart windows (log signature: "Hot Module Replacement is not enabled. Waiting for process restart…" / memory-guard restart). Confirmed effect: two local test outcomes (see §6) and one 57 s/65 s provisioning POST. CI's 16 GB runners show the same *class* of flake (documented in the fd14234 pack §5), so it is an infrastructure class, not a product regression. |
| Live-HTTP suites need CI-parity env | `.env` carries only `DATABASE_URL`, `DATABASE_ENV=test`, `REALTIME_MODE`. The CI fixture block (RAZORPAY_WEBHOOK_SECRET, PLATFORM_PAYMENT_WEBHOOK_SECRET, RESEND_WEBHOOK_SECRET, GOOGLE_OAUTH_* fakes, PAYMENTS_SANDBOX=1, RATE_LIMIT_DB_SYNC=on) must be exported into **both** the test process **and the dev server** or contract suites fail 170+ env-gated tests (first-hand measured: 171 → 0 after parity). |

## 6. Testing baseline (commands, exit codes, counts — all executed this session)

CI-parity environment: `DATABASE_URL=…/scholario …, DATABASE_ENV=test, REALTIME_MODE=disabled, RATE_LIMIT_DB_SYNC=on, PAYMENTS_SANDBOX=1,` + the CI test-fixture values; dev server supervised (`spawn-detached.mjs` + respawn loop) with `DEV_OLD_SPACE_MB=1700`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `bun run typecheck` (tsc --noEmit) | **0** | clean |
| 2 | `bun run lint` (eslint .) | **0** | 0 errors, 57 warnings (react-hooks/exhaustive-deps class; 0-error gate) |
| 3 | `bunx prisma migrate reset --force --skip-seed` on local embedded PG + 12-step canonical seed pipeline (seed.ts, seed-platform, seed-learning, seed-teacher-academics, seed-roster-150, seed-student-dashboard, seed-teacher-hub, seed-tenant-isolation, seed-website-cms, seed-salary, backfill-subscriptions, seed-platform re-run) | 0 | 28 migrations replay clean on fresh DB; all 12 seeds green (order per ci.yml §Seeds) |
| 4 | `bun run test:unit` | **0** | **256 pass / 0 fail** (23 files, 835 expect calls) — incl. svix-signature dual-scheme battery |
| 5 | `bun run test:integration` | **0** | **49 pass / 0 fail** (2 files) |
| 6 | `bun run test:regression` | **0** | **178 pass / 0 fail** (9 files) |
| 7 | security half 1 (35 files) | **0** | **503 pass / 15 skip / 0 fail** |
| 8 | security half 2 (35 files, first attempt) | 1 | 523 pass / 2 skip / **72 fail** → **all 72 were environmental**: the dev server was OOM-killed mid-run (kernel `oom-kill … next-server` in dmesg; my heap had been wrongly set 4096 MB on the 4 GB box) → ConnectionRefused cascades. |
| 9 | security retry on the correctly-tuned server: `provisioning-reliability` → **14/0**; `platform-account-recovery` + `tenant-isolation` → **133 pass / 0 fail** | 0/1* | *the joint retry run exited 1 on the first pass mid-server-restart, then 133/0 after re-warm; final state green |
| 10 | `bun run test:api` (fresh corpus, final run) | 1 | **109 pass / 1 fail / 10 skip** (120 tests, 10 files). The 1 fail = "wizard §STEP 1 … legacy boards are refused" timing out at 45 s while the dev server held the UP_BOARD provision for 45–65 s in a lazy-compilation restart window (server-side evidence: `POST /api/platform/schools 200 in 65s (compile: 2ms … render: 65s)`; the provision itself completed correctly with audit row + email). Earlier run also showed "server-side sort orders the rows" failing **only** with leftover test schools from an aborted run polluting the corpus (clean-corpus re-run: pass). Both are environment/test-robustness classes, not product regressions — CI is green for the identical tree (run 39810762044). |
| 11 | `bun run test:e2e` (attempt 1 / attempt 2 after pre-warming routes) | 1 / 1 | **Cannot run reliably on this box**: Next memory-guard restarts mid-suite (7 / 25 tests passed in attempt 2 when the server was healthy; failures are ECONNRESET/ConnectionRefused during the documented restart windows). CI green for the identical tree at `7585fad`. Matches the prior audit's own honest limitation note (fd14234 §7.1). |

**Totals actually executed locally: 1,743 test cases.** Product-signal outcome: every suite that could run to completion is green except the two environment-class items above; CI (16 GB runner, same SHA) is fully green including e2e.

### Separation of confirmed product failures vs environment (mission requirement)

| Class | Items | Evidence |
|---|---|---|
| Confirmed product defect(s) | **1** — the Class 0 / section-merge display defect (see CLASS-SECTION-INVESTIGATION.md; **not** caught by any test) | code chain + deterministic repro + production rows |
| Test-robustness (latent, test-only) | sort test assumes JS `localeCompare` ≡ Postgres `ORDER BY` for all names — false for dashed-hex test names in a polluted corpus | failure diff (`Reliability Test 91259887-*` rows) + clean-corpus pass |
| Infrastructure / environment | e2e memory-guard restarts on 4 GB box; 45–65 s request holds during Next dev lazy-compilation restart windows; OOM kill after wrong heap setting (self-inflicted, fixed) | dev.log/service.log signatures, dmesg oom-kill line, request timings |
| Could not run | e2e journeys reliably (box); Supabase live-auth exchange suites skip by design without Supabase env (17 skips in security halves) | suite skip messages |

## 7. What is deployed where — one-line truth

`main @ 7585fad` → Release 39810795955 → both Vercel planes READY on `7585fad` (verified deployment IDs above) → production DB carries the recordPrefix/billing-terms schema (26-of-28 migrations verified applied at fd14234 time; the 2 newer migrations applied by their documented release pipelines) → production email/webhook chain proven by run 39802116911 (WebhookEvent → EmailDelivery SENT evidence in docs/EMAIL.md + the release audit trail).
