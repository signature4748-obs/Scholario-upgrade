# SCHOLARIO-OS — TESTING STRATEGY (PHASE 4)

> Status: **implemented and repeatedly green** (2026-02-02).
> Scope: the automated test hierarchy (unit / integration / API / security
> incl. tenant isolation / regression / E2E), its conventions, its CI gates,
> and its honest gaps.
> Companion docs: `docs/SECURITY_BASELINE.md` (Phase-1 suite), `docs/TENANT_ISOLATION_MODEL.md`
> (the cross-tenant suites), `docs/DATABASE_INTEGRITY.md` (the Phase-3
> invariant tests), `docs/OBSERVABILITY.md` (what the observability tests pin).
>
> **Honesty note:** counts below are the worklog-verified final state of
> Phase 4 (Task ID 11-b): **378 tests in `bun run test` + 5 E2E journeys**,
> each suite run at least twice green. This document claims no coverage that
> a file does not actually contain — §7 lists what is deliberately NOT
> covered.

---

## 1. The hierarchy — what each level means HERE

| Level | Directory | Definition in this repo | Runtime |
|---|---|---|---|
| **Unit** | `tests/unit/` | Pure functions, **no IO** — no DB, no HTTP. Log output is captured by monkey-patching `console.log/warn/error` (the logger's only sinks) and restored in `afterEach`. | bun:test, in-process |
| **Integration** | `tests/integration/` | Real database via `@/lib/db` / `PrismaClient` — `runJob` lifecycle, JobRun uniques, WebhookEvent.attempts, `trackedTransaction`, the readiness primitive. Self-cleaning (`test-p4-` prefix sweep). | bun:test, live SQLite |
| **API** | `tests/api/` | **Live HTTP against the dev server** (`API_TEST_BASE ?? http://localhost:3000`) with real logins — route-level contracts (health, envelope, correlation, role gates) plus golden-path domain smokes. | bun:test + dev server |
| **Security** (incl. tenant isolation) | `tests/security/` | The Phase-1/2/3 suites: envelope/error sanitization, rate limiting, validation, audit, headers, upload, file signing, secrets scan; the **tenant-isolation** live-HTTP cross-tenant suites; the **database-integrity** invariant suite. | bun:test, live HTTP + live DB |
| **Regression** | `tests/regression/` | **Incident pins** — every check references the phase/incident that introduced the fix; where a regression is already exhaustively covered by a Phase-1/2/3 suite, it is cross-referenced in comments instead of duplicated. | bun:test + dev server |
| **E2E** | `tests/e2e/` | **Cookie-driven user journeys** against the live server (`E2E_BASE_URL ?? http://localhost:3000`) — the `erp_session` cookie from login is propagated via a manual `Cookie` header, the same transport a browser uses; if any step breaks the journey fails. | bun:test + dev server |

The boundary rule: **unit = no IO, integration = DB only, api/security/e2e =
full HTTP stack**. A test that needs neither database nor server has no
business being outside `tests/unit/`.

## 2. Commands

| Command | Runs | Verified count |
|---|---|---|
| `bun run test:unit` | `bun test tests/unit/` | 88 (5 files) |
| `bun run test:integration` | `bun test tests/integration/` | 23 |
| `bun run test:api` | `bun test tests/api/` | 47 (2 files) |
| `bun run test:regression` | `bun test tests/regression/` | 18 |
| `bun run test:security` | `bun test tests/security/` | 202 |
| `bun run test:tenant` | the two tenant-isolation suites | 76 (57 live-HTTP + 19 model) |
| `bun run test:e2e` | `bun test tests/e2e/` | 5 journeys |
| `bun run test` | unit + integration + api + regression + security | **378** |
| `bun run test:all` | `bun run test && bun run test:e2e` | 383 |
| `bun run typecheck` | `tsc --noEmit` | 0 errors |

Security suite composition (202): 85 Phase-1 (`audit`, `auth-core`, `errors`,
`file-signing`, `headers`, `rate-limit`, `secrets-scan`, `upload`,
`validation`) + 57 cross-tenant live-HTTP (`tenant-isolation`) + 19 authz
model (`tenant-isolation-model`) + 41 database-integrity.

Live suites require the dev server running (`bun run dev`, :3000) and the
seeded DB (`bun run db:seed`, `bun run db:seed-tenant-isolation`).

## 3. Priority matrix — domain × level × where covered

| Domain | Level(s) | Exact files / blocks |
|---|---|---|
| **Auth / sessions** | api, security, e2e | `tests/api/domain-smoke.test.ts` §1 (login → HttpOnly cookie → me → logout → 401 `AUTH_REQUIRED`); `tests/security/auth-core.test.ts`; `tests/security/rate-limit.test.ts` (429 + Retry-After, lockout); all 4 e2e journeys |
| **Tenant isolation** (the cross-cutting domain) | security | `tests/security/tenant-isolation.test.ts` (57: anonymous boundary, cross-tenant read/write/delete with victim-row-survives assertions, indirect leakage, spoofed schoolId, positive controls for both tenants); `tests/security/tenant-isolation-model.test.ts` (19: pipeline, guards, fail-closed matrix) |
| **Admissions** | api | `tests/api/domain-smoke.test.ts` §2 (public inquiry POST, right-tenant Notification verified, probe rows swept) |
| **Fees / finance ledger** | security, api, regression | `tests/security/database-integrity.test.ts` (ledger apply/replay/clamp math, receipt/reference uniques); `tests/api/domain-smoke.test.ts` §3 (fees/transactions/catalogue 200) + §6 (POST no-body → 422 with `fee.count` unchanged); regression VALIDATION_FAILED pins |
| **Payments / webhooks** | security, integration | `tests/security/database-integrity.test.ts` (Payment.transactionId idempotency, settlement link uniques); `tests/integration/jobs-and-jobs.test.ts` (WebhookEvent.attempts 1→2→3) |
| **Attendance** | security, api, integration | `tests/security/database-integrity.test.ts` (double-POST idempotency, tenant-safe unique); `tests/api/domain-smoke.test.ts` §4 (overview 200); the draft-autofinalize job lifecycle in `tests/integration/jobs-and-jobs.test.ts` |
| **Marks / exams** | security, api | `tests/security/database-integrity.test.ts` (marks double-submit upsert, marksObtained ≤ maxMarks bounds, declared-exam deletion refusal); `tests/api/domain-smoke.test.ts` §4 (exams list 200); `tests/api/observability-contracts.test.ts` role gates |
| **Timetable** | security, api | `tests/security/database-integrity.test.ts` (class-slot + teacher double-booking uniques, period ≥ 1); `tests/api/domain-smoke.test.ts` §4 (timetable 200) |
| **Teacher permissions / CSA** | security, api, e2e | `tests/security/tenant-isolation-model.test.ts` (teacher-scope guards); `tests/api/domain-smoke.test.ts` §5 (teacher dashboard 200, staff reads allowed, superadmin 403, symmetric role gate 403); e2e Journey 2 |
| **Principal permissions** | api, e2e | `tests/api/domain-smoke.test.ts` §6 (dashboard 200, write-path validation with row-count check); e2e Journey 1 (full module chain) |
| **Student permissions** | api, security, e2e | `tests/api/domain-smoke.test.ts` §7 (student dashboard 200, staff route 403 `FORBIDDEN`); tenant-isolation STUDENT probes; e2e Journey 3 |
| **Parent permissions** | api, security | `tests/api/domain-smoke.test.ts` §8 (`/api/events` 200); tenant-isolation PARENT enumeration probes |
| **Observability contracts** | unit, integration, api, regression | `tests/unit/*` (logger/redact/http/context/taxonomy); `tests/integration/jobs-and-jobs.test.ts`; `tests/api/observability-contracts.test.ts` (29); `tests/regression/regression.test.ts` |

## 4. Conventions (non-negotiable)

- **bun:test** (`describe/test/expect` from `'bun:test'`); one file per
  concern; generous timeouts (`T = 45000` — first-hit dev compilation).
- **Re-runnability — rate-limit tolerance:** every live-HTTP suite mints a
  unique `X-Forwarded-For` per run (e.g. `10.244.x.y`), so the per-IP login
  buckets (8/15 min) are fresh on every re-run; the public admissions form
  uses its own fresh IP for the 10/hour bucket. When the login limiter is
  nonetheless exhausted, the helper falls back to a **direct session-row
  fixture** (insert `Session` row for a seeded fixture user) — it bypasses
  ONLY the limiter, never an authorization gate. Pattern provenance:
  `tests/security/tenant-isolation.test.ts`.
- **Self-cleaning prefixes:** DB-writing tests create rows whose marker fields
  start with `test-p3-` (Phase-3 suite) or `test-p4-` (Phase-4 suites) and
  sweep them in `afterAll` (JobRun/WebhookEvent/Notification/ActivityLog).
  Verified: 0 leftover `test-p4-` rows after full runs.
- **Assertions assert only what routes actually enforce** — the API suites
  probed every route contract BEFORE writing assertions; where reality
  differs from the ideal (e.g. `/api/app-version` returns `{version}` instead
  of the `{ok,data}` envelope), the suite pins the TRUE shape and the gap is
  documented, not papered over.
- **Determinism:** durations asserted `>= 0` only (never exact ms); no
  wall-clock-dependent assertions; no cross-test ordering dependencies.
- **NEVER weaken security to pass a test.** The rate-limit fallback exists to
  keep suites runnable, not to make a security posture invisible — security
  failures (lockouts, 401/403/404 semantics) are asserted as failures.
- **Fixture credentials:** env-driven via `prisma/seed-credentials.ts`
  (re-exported by `tests/helpers/credentials.ts` — the same source the seed
  pipeline plants; overridable through the `SEED_*` env vars). School A/B
  tenant fixtures
  `tenant.{principal,teacher,student,parent}.a@sunrise.test`
  (`prisma/seed-tenant-isolation.ts`, idempotent).

## 5. Writing new tests — where they go, what to copy

| You are testing… | Put it in… | Copy the pattern from |
|---|---|---|
| A pure function (logger, redaction, classifier, schema, helper) | `tests/unit/<module>.test.ts` | `tests/unit/observability-logger.test.ts` (console-capture harness, env save/restore in beforeEach/afterEach) |
| A DB-backed contract (model constraints, runJob, transaction semantics) | `tests/integration/<feature>.test.ts` | `tests/integration/jobs-and-jobs.test.ts` (`test-p4-` prefix, afterAll sweep, direct `db` import) |
| A route's HTTP contract (status, envelope, headers, role gate) | `tests/api/<feature>.test.ts` | `tests/api/observability-contracts.test.ts` (`expectFailureEnvelope` helper, login/direct-session helper) |
| A golden-path domain flow | `tests/api/domain-smoke.test.ts` (extend) | its `as(email, path)` helper + `afterAll` sweep |
| A security posture (envelope leakage, headers, limits) | `tests/security/<concern>.test.ts` | `tests/security/errors.test.ts` / `rate-limit.test.ts` |
| A cross-tenant invariant | `tests/security/tenant-isolation.test.ts` (extend) | its probe + victim-row-survives + safe-failure assertion style |
| A DB invariant (unique/bound/trigger) | `tests/security/database-integrity.test.ts` (extend) | its expect-throws P2002/P2003 blocks |
| A historical bug fix | `tests/regression/regression.test.ts` (extend) | its "incident: …" comment style + phase reference |
| A user journey | `tests/e2e/journeys.test.ts` (extend) | its cookie-propagation `step()` helper |

Rules for new tests: keep the prefix discipline; assert ≥ not == for
durations; add the `beforeAll` route-warm fetch for any first-hit route;
reference the phase/finding the test pins.

## 6. CI gates (`.github/workflows/ci.yml`)

One job, `build-and-verify` (ubuntu-latest, bun, 45 min timeout,
`LOG_LEVEL=warn`, cancel-in-progress per ref). CI **fails** on:

| Gate | Step | Detail |
|---|---|---|
| 1. TypeScript | `bunx tsc --noEmit` | strict gate since Phase 1 |
| 2. Lint | `bunx eslint .` | error-level defect rules (`no-unreachable`, `no-fallthrough`, hooks-correctness adjacent set, `no-unused-vars`…). `react-hooks/exhaustive-deps` is warn-level (burn-down documented in `docs/OBSERVABILITY.md` §12) — warnings do not fail CI, errors do. |
| 3. Migrations | `bunx prisma migrate deploy` on a FRESH database | proves the lineage applies end-to-end |
| 3b. Zero drift | `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma` | any diff fails the build (migrations must match `schema.prisma`) |
| 4. Build | `bun run build` (`NODE_ENV=production`) | `ignoreBuildErrors` was REMOVED in Phase 4 — the production build type-checks for real |
| 5-8. Tests | reset CI DB + re-deploy migrations + both seeds → start `bun run dev` (readiness-waited on `/health/ready`, 120 s budget) → `bun test tests/unit/ tests/integration/ tests/api/ tests/regression/` → `bun test tests/security/` → `bun test tests/e2e/` (`E2E_BASE_URL=http://localhost:3000`) | the same real-server runtime the suites were written against; dev-server log tail always shown on failure |

## 7. Honest gaps

1. **No component-level UI tests** — no React Testing Library, no component
   rendering assertions. The UI is verified by browser QA sessions recorded
   in the worklog (agent-browser walks of all four role panels), not by the
   automated gate.
2. **E2E are HTTP journeys, not browser automation** — the cookie header
   simulates the browser transport faithfully (incl. Set-Cookie extraction),
   but no real browser, no rendering, no JavaScript execution, no visual
   assertions.
3. **Coverage % is not measured** — no c8/istanbul instrumentation; the
   "covered" claim is per-file and per-contract, from the priority matrix §3,
   not a numeric coverage figure.
4. **The `/health/ready` DB-down (503) path is unexercised** — the shared dev
   DB cannot be taken down mid-suite; the failure-path fields are pinned on
   the success shape instead (documented in the regression suite and
   `docs/OBSERVABILITY.md` §12).
5. Live-HTTP suites depend on the dev server being up — transient dev-server
   flaps surface as environmental failures (worklog Task 11-b notes two,
   restored by the keepalive watchdog ~50 s); they are re-run green once
   stable, and CI owns a deterministic server lifecycle instead.
6. `bun run test` does not include e2e by design (separate server lifecycle);
   the full gate is `test:all` / the CI job.
