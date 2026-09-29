# SCHOLARIO-OS — OBSERVABILITY BASELINE (PHASE 4)

> Status: **implemented and test-verified** (2026-02-02).
> Scope: request correlation, structured logging, error taxonomy, API error
> envelope, error boundaries, health checks, database diagnostics, background
> job tracking, webhook event tracking.
> Constraints: single-process deployment, no Supabase/Vercel/Resend connection
> yet (per phase freeze) — see §12 for what that means for log shipping.
> Companion docs: `docs/SECURITY_BASELINE.md` (Phase 1 — the envelope),
> `docs/TENANT_ISOLATION_MODEL.md` (Phase 2 — tenant context rules),
> `docs/DATABASE_INTEGRITY.md` (Phase 3 — the invariants the diagnostics watch),
> `docs/TESTING_STRATEGY.md` + `docs/FAILURE_RECOVERY.md` (Phase 4 siblings).
>
> **Honesty note:** this document claims only what the code and the automated
> gate demonstrate. The gate is `bun run test` (378 tests) plus
> `bun run test:e2e` (5 journeys) — the observability-specific coverage lives
> in `tests/unit/` (88), `tests/integration/jobs-and-jobs.test.ts` (23) and
> `tests/api/observability-contracts.test.ts` (29). Known unverified paths are
> listed in §12.

---

## 1. Request correlation (one id per request, end-to-end)

**Implementation:** `src/middleware.ts` → `src/lib/observability/http.ts` →
`src/lib/observability/context.ts` → `src/lib/api.ts`.

### 1.1 The flow

| Step | Where | What happens |
|---|---|---|
| 1 | `src/middleware.ts` (matcher `/api/:path*`, `/health/:path*` only) | An inbound `X-Request-Id` is honored ONLY when it matches `^[A-Za-z0-9:_-]{8,128}$` (short, opaque, print-safe). Anything else — spaces, unicode, quotes, control chars, >128 chars — is **rejected and replaced** with a fresh `crypto.randomUUID()`. Request ids appear inside log lines; a hostile id must never become a log-forgery vector. |
| 2 | middleware (same call) | Stamps internal request headers: `x-request-id`, `x-scholario-route` (pathname), `x-scholario-op` (`"METHOD /path"`). A client cannot spoof these into anything meaningful — middleware overwrites both for every matched request (pinned by `tests/regression/regression.test.ts` §3). |
| 3 | middleware response | Sets the `X-Request-Id` **response** header — so even raw handlers that bypass `api()` (webhooks, health, `/api/app-version`) are correlated. |
| 4 | `src/lib/api.ts` `requestMeta()` | Reads `x-request-id` through `sanitizeRequestId()` (falls back to a fresh UUID) and `x-scholario-route`/`x-scholario-op` (fall back to `'unknown'` when middleware did not run — direct handler invocation in tests). |
| 5 | `api()` | Opens an `AsyncLocalStorage` request scope (`runWithContext`) carrying `requestId / userId / schoolId / route / operation / startedAt`. Every nested log line, Prisma diagnostic, job run and audit row inside that async chain reads it WITHOUT parameter threading. |
| 6 | `withUser` / `withAuthz` | `patchRequestContext({ userId, schoolId })` after authentication — **ids only, session-derived** (Phase-2 rule: client input never enters the context). |
| 7 | response | `X-Request-Id` header on every success envelope, every failure envelope, and raw `Response` passthroughs (`api()` sets the header on streams/CSVs too). The failure body also embeds it as `requestId`. |

The raw webhook receiver (`src/app/api/webhooks/razorpay/route.ts`) opens its
own `runWithContext` (gateway contract requires custom ack shapes) — it still
carries the middleware-stamped id and emits the same `http_request` completion
line.

### 1.2 How to trace a request

```bash
# A user quotes the requestId from the error envelope (or X-Request-Id header):
$ grep 'bugreport-20260202-001' dev.log
{"ts":"…","channel":"http","level":"warn","event":"http_request","requestId":"bugreport-20260202-001",...}
{"ts":"…","channel":"db","level":"warn","event":"db_slow_query","requestId":"bugreport-20260202-001",...}
{"ts":"…","channel":"jobs","event":"job_started","requestId":"bugreport-20260202-001",...}
```

One grep finds the envelope line (`http_request`), every nested db/job/webhook
line sharing the id, and the ActivityLog audit line (audit rows carry
`requestId` in their log mirror). The correlation round-trip — user quotes an
id, the server echoes it exactly — is pinned by
`tests/regression/regression.test.ts` §2 and `tests/api/observability-contracts.test.ts`.

---

## 2. Structured logging (ONE line format)

**Implementation:** `src/lib/observability/logger.ts` + `redact.ts`. Every
line is single-line JSON on **stdout** (`info` → `console.log`, `warn` →
`console.warn`) or **stderr** (`error` → `console.error`), ready for any log
shipper.

### 2.1 Line schema

```json
{"ts":"2026-02-02T10:11:12.000Z","channel":"http","level":"info","event":"http_request",
 "requestId":"0a1b…","userId":"usr_…","schoolId":"sch_…","route":"/api/students",
 "operation":"GET /api/students","durationMs":42,"status":200}
```

| Field | Source | Notes |
|---|---|---|
| `ts` | logger | ISO timestamp |
| `channel` | caller field (default `"app"`) | see §2.2 |
| `level` | caller | `debug \| info \| warn \| error` |
| `event` | caller | stable event name — the grep/dashboard key (see §2.3) |
| `requestId`, `userId`, `schoolId`, `route`, `operation` | **injected from the request context only** | a log caller passing these keys explicitly is DROPPED — correlation identity cannot be spoofed (unit-tested). `userId`/`schoolId` are opaque database ids, not PII (§2.5). |
| *(event fields)* | caller, redacted | e.g. `durationMs`, `status`, `errorCode`, `jobName`, `eventId` |

Hardening details (all unit-tested in `tests/unit/observability-logger.test.ts`):
- `LOG_LEVEL=debug|info|warn|error` (default `info`, case-insensitive,
  invalid values fall back to `info`). Documented in `.env.example`.
- A field set with a throwing getter or unserializable shape degrades to a
  `detail: '[unserializable-fields]'` marker line — **logging can never become
  a failure mode** (found-and-fixed by the Phase-4 test build, worklog Task 11-b).

### 2.2 Channels

| Channel | Emitted by |
|---|---|
| `http` | `api()` completion lines; the raw webhook handler's completion line |
| `db` | Prisma query/error/warn events + `trackedTransaction` (`src/lib/db.ts`) |
| `jobs` | `runJob()` transitions (`src/lib/observability/jobs.ts`) |
| `webhook` | the Razorpay receiver lifecycle |
| `audit` | the security audit funnel (`src/lib/security/audit.ts`) — hand-rolled to the same JSON shape (§12 note) |
| `process` | `src/instrumentation.ts` (unhandled rejections/exceptions, Next request errors) — hand-rolled (§12 note) |
| `security` | `tenant_mismatch` signal (`src/lib/security/authz.ts`) |
| `external` | AI gateway degradation (`src/app/api/ai/generate-questions/route.ts`) |
| `health` | readiness probe failure |
| `client` | `ui_error_boundary` from `src/app/error.tsx` (browser console, same shape) |
| `app` | default for anything un-labeled |

### 2.3 Event vocabulary

| Event | Channel | Level | Fields (beyond correlation) | Fired when |
|---|---|---|---|---|
| `http_request` | http | info / warn (≥400) / error (≥500) | `durationMs`, `status`, `errorCode`?, `detail`? (internalDetail — server-only) | every `api()` call completes; raw webhook handler completes |
| `db_slow_query` | db | warn | `durationMs`, `query` (SQL shape, ≤400 chars) | any Prisma query at/above `DB_SLOW_QUERY_MS` (default 200 ms) |
| `db_query_error` | db | error | `detail` (≤300), `target` | Prisma engine error event |
| `db_engine_warn` | db | warn | `detail` | Prisma engine warning |
| `db_transaction` | db | debug | `label`, `status:"committed"`, `durationMs` | `trackedTransaction` commits |
| `db_transaction_failure` | db | error | `label`, `status:"failed"`, `durationMs`, `errorCode`?, `detail` | `trackedTransaction` rolls back (see §7.3 status) |
| `job_started` | jobs | info | `jobName`, `jobId`, `attempt`, `maxAttempts`, `trigger` | job run begins |
| `job_retry` | jobs | warn | `jobName`, `jobId`, `attempt`, `maxAttempts`, `detail` | an attempt failed, more remain |
| `job_failed` | jobs | error | same as retry | the final attempt failed |
| `job_completed` | jobs | info | `jobName`, `jobId`, `attempt`, `durationMs` | an attempt succeeded |
| `job_skipped` | jobs | info | `jobName`, `jobId`, `idempotencyKey` | prior SUCCESS for the same key short-circuits |
| `job_tracking_failed` | jobs | error | `jobName`, `jobId`, `detail` | JobRun row could not be created — the job still runs untracked |
| `job_idempotency_check_failed` | jobs | warn | `jobName`, `detail` | the prior-run lookup itself failed — the job still runs |
| `webhook_received` | webhook | info | `eventId`, `eventType`, `gatewayPaymentId`, `orderId`, `amountPaise`, `paymentStatus`, `schoolId` | after signature verification; `notes` deliberately NOT logged (PII, §2.5) |
| `webhook_processed` / `webhook_failed` | webhook | info / error | `eventId`, `eventType`, `attempts:1`, `matchedTransactionId` | the finally-block outcome line |
| `webhook_processing_failed` | webhook | error | `eventId`, `eventType`, `detail` (≤300) | a handler threw (fires *before* the `webhook_failed` line) |
| `webhook_duplicate` | webhook | info | `eventId`, `layer:"in-mem"|"db"` | duplicate delivery hit the fast-path Set or the DB unique |
| `webhook_settlement_linked` | webhook | info | `eventId`, `payoutId`, `linkedCount` | settlement processing linked transactions |
| `webhook_no_handler` | webhook | debug | `eventId`, `eventType` | recognized signature, unhandled event type |
| `unhandled_rejection` | process | error | `detail` (name: message) | process-level net — the process stays up |
| `uncaught_exception` | process | error | `detail` | logged; **production exits 1** (supervisor restarts), dev stays up |
| `next_request_error` | process | error | `detail` (name: message \| route \| operation \| requestId \| routeType) | Next's `onRequestError` hook — anything that escapes to the framework (render, uncovered handlers) |
| `external_service_failure` | external | warn | `errorCode:"EXTERNAL_SERVICE_FAILURE"`, `service`, `detail` | upstream call threw (AI gateway) |
| `external_service_degraded` | external | warn | `service`, `reason` | upstream answered garbage / unavailable client — graceful degradation path |
| `tenant_mismatch` | security | warn | `errorCode:"TENANT_MISMATCH"`, `label` | authz guard detected a foreign-tenant row reference (§3) |
| `health_ready_failed` | health | error | `detail` | the readiness DB probe failed/timed out |
| `ui_error_boundary` | client | error | `digest` | browser-side mirror of a render failure (§9) |
| *(audit actions)* | audit | — | `action`, `schoolId`, `userId`, `actor`, `ip`, `requestId`, `detail` | the security audit funnel (canonical action vocabulary in `src/lib/security/audit.ts`) |

### 2.4 PII / secret policy (`src/lib/observability/redact.ts`)

Every logger field set flows through `redact()`:

- **Sensitive key vocabulary** (value → `[REDACTED]`, case-insensitive):
  `password|passwd|pass`, `secret`, `token`, `authorization`, `cookie`,
  `credential`, `api-key/api_key`, `private-key/private_key`, `signature`,
  `otp`, `cvv`, `salt`, `hash`, `session`, `refresh`, `access-key/access_key`,
  `rawpayload`, `rawbody`, `pa_token`.
- **Shape caps:** strings truncated at 2 000 chars (with an `[truncated N]`
  marker), object depth 4, array width 50 (remainder summarized as
  `[+N more]`).
- **Values:** `Error` → `{ name, message }` only — **stacks are dropped**
  (they contain filesystem paths); `Date` → ISO; `BigInt` → string; finite
  numbers stay numbers (NaN/Infinity degrade to strings); booleans pass
  through; `Map`/`Set`/exotics → `'[unloggable]'`.
- `redactDetail()` (message-field defense): scrubs ≥64-char hex tokens,
  `sk-…` keys, `password|secret|token|authorization: value` pairs, then caps.
- **Never logged by design:** Prisma query **parameters** (§7 — the SQL shape
  is the diagnostic, the bound values are student/parent PII); the webhook
  `notes` object (can carry student names — `schoolId` alone identifies the
  tenant).
- **`userId`/`schoolId` are ids, not PII:** they are opaque database
  identifiers (cuids), not names/emails/phones. Correlation REQUIRES them,
  and they are the join keys to `ActivityLog`/`JobRun` rows. The rule is
  *ids and enums yes, direct identifiers no* — same rationale as
  `docs/TENANT_ISOLATION_MODEL.md` §audit.

---

## 3. Error taxonomy (canonical codes)

**Implementation:** `src/lib/security/errors.ts` — `AppError`, `STATUS_BY_CODE`,
`classifyError()`. This is the classification layer; the envelope (§4) is
`src/lib/api.ts`.

### 3.1 The table

| Code | HTTP | Meaning | Thrown by / produced by |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | no active session / inactive account | `withUser`, `authorize()`, login routes |
| `FORBIDDEN` | 403 | authenticated, role/permission denied | `withUser` role gate, `authorize()` permission/tenant-mode gates, `schoolScoped()` |
| `TENANT_MISMATCH` | 403 | **INTERNAL classification only** — cross-tenant attempt | authz guards (`assertTenantRow`, `assertSameTenant`, `assertFkInTenant`) → log + audit; **never in a client envelope** (§3.3) |
| `RESOURCE_NOT_FOUND` | 404 | resource does not exist **or exists in another tenant** (fail-safe) | every tenant-scoped by-id lookup; Prisma P2025 |
| `VALIDATION_FAILED` | 422 | schema/shape validation — zod paths | `parseJsonBody` / strict zod schemas |
| `INVALID_INPUT` | 422 | domain/business-rule input validation | route + service rules (marks bounds, status whitelists, FK-in-tenant); Prisma P2003 |
| `RATE_LIMITED` | 429 | rate limiter | `enforceRateLimit`/`checkRateLimit` |
| `ACCOUNT_LOCKED` | 429 | auth lockout | login route |
| `PAYLOAD_TOO_LARGE` | 413 | body size cap | `parseJsonBody` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | file/MIME policy | upload policy |
| `CONFLICT` | 409 | uniqueness / state conflicts | P2002 translation, fee-structure publish, library return, timetable slot conflicts |
| `CSRF_REJECTED` | 403 | cross-origin cookie request | `isCrossOriginRequest` |
| `DATABASE_FAILURE` | 500 | Prisma/DB engine failures (internal) | `classifyPrisma` default branch for any `P****` |
| `EXTERNAL_SERVICE_FAILURE` | 503 | upstream dependency failure | AI gateway route |
| `INTERNAL_ERROR` | 500 | everything unclassified/unsafe | `classifyError` fallback |
| `UNAUTHORIZED` *(deprecated)* | 401 | legacy alias — classifies to `AUTH_REQUIRED` | legacy `throw new Error('UNAUTHORIZED')` |
| `NOT_FOUND` *(deprecated)* | 404 | legacy alias — classifies to `RESOURCE_NOT_FOUND` | legacy sentinel throws |
| `BAD_REQUEST` *(classification-only)* | 400 | a plain `Error` with a provably-safe human message | `classifyError` step 4 — route-authored UX copy. Not an `AppErrorCode`; appears only in envelopes, never as a typed throw. |

### 3.2 Classification ladder (`classifyError`, in order)

1. `AppError` (typed) → its own code/status/message.
2. Legacy sentinel strings — `'UNAUTHORIZED'` → `AUTH_REQUIRED` 401;
   `'FORBIDDEN'` / `'NO_SCHOOL'` / `'SUPER_ADMIN has no school scope'` →
   `FORBIDDEN` 403; `'NOT_FOUND'` → `RESOURCE_NOT_FOUND` 404.
3. Prisma engine errors (§7.4 mapping).
4. Plain `Error` whose message passes `isSafeClientMessage()` → 400
   `BAD_REQUEST` with the message as-is.
5. Everything else → 500 `INTERNAL_ERROR`, generic message, internals stay in
   the log.

Unsafe-message heuristics (any match ⇒ message NEVER reaches a client):
absolute paths, `prisma`, `sqlite`, `invalid … invocation`, stack-frame
shapes, embedded `\n/\r`, `relation … does not exist`, `unique constraint`,
`foreign key`, socket errors, `ENOENT/EACCES/EPERM`, `secret|token|…`, and a
>300-char cap.

### 3.3 The TENANT_MISMATCH design note

`TENANT_MISMATCH` names the violation **internally** — a `tenant_mismatch`
warn line (channel `security`, `errorCode`) plus an ActivityLog
`TENANT_MISMATCH` audit row via `signalTenantMismatch()` in
`src/lib/security/authz.ts` — while the **client envelope stays a fail-safe
404 `RESOURCE_NOT_FOUND`**. This preserves the Phase-2 no-existence-oracle
invariant (a caller must not learn *which* school owns a row it probed).
It fires only when the referenced row EXISTS in a foreign tenant (a true
violation); a null row is just a wrong id and gets plain 404. Covered by
`tests/security/tenant-isolation.test.ts`.

### 3.4 VALIDATION_FAILED vs INVALID_INPUT

Both are 422, deliberately split by *who validated*:
- `VALIDATION_FAILED` — the central zod layer (`parseJsonBody`): shape,
  types, unknown fields, size caps. Fix by the caller (bad payload).
- `INVALID_INPUT` — domain rules at the route/service boundary: marks
  outside 0…maxMarks, un-whitelisted status strings, an FK id that does not
  resolve in the caller's school (P2003 translation). Fix by the feature
  logic (semantically invalid for the business state).

---

## 4. The API error envelope

**Implementation:** `src/lib/api.ts`. Every route wrapped in `api()` /
`withUser` / `withAuthz` (188+ routes) inherits this.

### 4.1 Shapes

Success:

```json
{ "ok": true, "data": { … } }
```

Failure:

```json
{
  "ok": false,
  "error": "Resource not found",
  "code": "RESOURCE_NOT_FOUND",
  "requestId": "0a1b2c3d-…"
}
```

- `X-Request-Id` response header on **every** response (success, failure, raw
  `Response` passthrough for file streams/CSVs — `api()` sets the header on
  those too). The body `requestId` equals the header (regression-pinned).
- `error` is a guaranteed-safe message; `code` is the §3 taxonomy;
  internals (`internalDetail`) go ONLY to the server log line.
- 429s (`RATE_LIMITED`, `ACCOUNT_LOCKED`) additionally carry a
  `Retry-After` header (seconds) — merged from `AppError.headers`.
- Handler-thrown `Response` instances (streams) pass through untouched
  except for the correlation header.

### 4.2 Raw handlers (documented exceptions)

Routes with custom transport contracts that bypass the `api()` envelope but
still get middleware correlation (`X-Request-Id` header set by middleware /
the handler) and hand-rolled safe envelopes with `newRequestId()`:
`/api/webhooks/razorpay` (gateway ack shapes), `/api` root, `/api/app-version`
(VersionGuard `{version}` shape — pinned as-is by the API test suite),
`/api/schools/public`, `/api/admissions/public`, `/api/public/notices/rss`,
`/api/teachers/upload*`, `/api/admissions/upload*`,
`/api/profile/avatar/[userId]`, `/health/*` (see §12 for the residual risk).

---

## 5. Health checks

**Implementation:** `src/app/health/{live,ready}/route.ts` (nodejs runtime,
`force-dynamic`, `Cache-Control: no-store`).

| Probe | Question answered | Checks | Failure semantics |
|---|---|---|---|
| `GET /health/live` | "is the process able to serve HTTP?" | **nothing else** — uptime + timestamp only | liveness must never depend on dependencies, or a degraded DB causes a **restart storm** (a restarting app cannot recover the DB). |
| `GET /health/ready` | "can this instance serve REAL traffic?" | the **database only**: `db.$queryRaw\`SELECT 1\`` raced against a **2 s timeout** | 503 + `{"status":"unavailable","probe":"ready","checks":{"database":"failed",…}}` — a slow dependency is an unhealthy dependency for routing. |

Readiness success shape:

```json
{ "status": "ready", "probe": "ready", "checks": { "database": "ok", "dbDurationMs": 3 },
  "durationMs": 4, "timestamp": "2026-02-02T…" }
```

A failed probe also emits a `health_ready_failed` error line (channel
`health`).

**Deliberately NOT probed by readiness** (degradation must not evict the
instance from the load balancer — those failures surface through
`EXTERNAL_SERVICE_FAILURE` envelopes + logs instead): the realtime
event-stream mini-service, the AI gateway, mock data sources, and the
not-yet-connected Supabase/Vercel/Resend dependencies.

Both probes are unauthenticated and covered by
`tests/api/observability-contracts.test.ts` + the regression suite (§12
documents the untested 503 path).

---

## 6. Error boundaries (client strategy)

**Implementation:** `src/app/{error,global-error,not-found,loading}.tsx` —
four layers:

| Layer | File | Catches | UX |
|---|---|---|---|
| Loading state | `loading.tsx` | root-segment Suspense fallback while the server streams | minimal spinner, `role="status"` |
| Segment boundary | `error.tsx` | render errors **inside** the root page tree (layout chrome survives) | "Something went wrong" card, `Try again` (reset) / `Reload page`, and a **Reference:** line showing `error.digest.slice(0,24)` |
| Global boundary | `global-error.tsx` | the root layout itself fails (last resort, must render its own `<html>`) | minimal "Something went wrong!" + Try again |
| Not-found | `not-found.tsx` | unmatched routes / 404s | 404 card + back link |

**Digest correlation:** Next.js assigns the failing render a `digest` — the
same id Next logs server-side. `error.tsx` mirrors it to the browser console
as a `ui_error_boundary` line (channel `client`, same JSON shape) and shows
it on screen, so a user-reported reference maps to the server log line even
without a `requestId`. On the server side, render/route failures reach
`instrumentation.ts` `onRequestError` → `next_request_error` (channel
`process`, with route + requestId + routeType).

---

## 7. Database diagnostics

**Implementation:** `src/lib/db.ts` — the Prisma client with event listeners +
`trackedTransaction`.

### 7.1 Slow queries

Every query event with `duration >= DB_SLOW_QUERY_MS` (env, default 200 ms)
emits:

```json
{"channel":"db","level":"warn","event":"db_slow_query","durationMs":342,
 "query":"SELECT \"id\", \"schoolId\" FROM \"Student\" WHERE …"}
```

The SQL text is truncated to 400 chars and **bound parameters are never
logged** — they carry student/parent PII. The shape + duration is the
diagnostic; the values are the leak.

### 7.2 Query/engine errors

- `db_query_error` (error): failed engine operations — constraint violations
  surfacing at the engine, aborted statements. `detail` ≤300 chars + `target`.
- `db_engine_warn` (warn): engine-level warnings.

### 7.3 `trackedTransaction(label, fn, opts)`

Identical behavior to `db.$transaction` (options pass through) with
observability added: commit → debug `db_transaction` line; failure → error
`db_transaction_failure` line with `{ label, status:"failed", durationMs,
errorCode, detail }` and the ORIGINAL error re-thrown. Integration-tested in
`tests/integration/jobs-and-jobs.test.ts` §6 (commit persists, rollback
rethrows the original error, the labeled line fires, P2028 timeout options
pass through).

**All 24 multi-row atomic mutations run through it** — every interactive
`$transaction` in the application was migrated (labels verified in source at
doc-writing time; note the migration landed concurrently with this document —
the worklog Task 11-c entry had not been appended yet):

| Label | Call site |
|---|---|
| `webhook-payment-captured` | `api/webhooks/razorpay` — SUCCESS transition + ledger apply in one tx |
| `webhook-settlement-processed` | `api/webhooks/razorpay` — settlement upsert + txn linking in one tx |
| `payment-verify-reconcile` / `payment-verify-transition` | `api/student/payments/verify` (×2) |
| `payment-record-manual` | `api/fees` POST payment-record |
| `fee-verification` / `fee-direct-record` | `api/fees/verification` (×2) |
| `payment-confirm-capture` | `api/fees/payments/confirm` (demo gateway) |
| `fee-transaction-create` | `api/fees/transactions` POST |
| `fee-structure-publish` / `fee-structure-update` | `api/fees/structures/[id]/{publish,PATCH}` |
| `student-create-with-user` / `teacher-create-with-user` / `school-create-with-principal` | `api/{students,teachers,schools}` POST |
| `timetable-publish` | `api/timetable/publish` (wipe + rebuild) |
| `results-publish-batch` | `api/results` POST |
| `library-issue` / `library-return` | `api/library` (×2) |
| `attendance-batch-mark` | `api/attendance` POST (legacy upsert) |
| `attendance-canonical-write` | `lib/class-attendance.ts` (replace-by-class-day) |
| `exam-create` / `exam-seating-generate` / `exam-outcomes-compute` | `lib/exams/{service,service-extended}` (×3) |
| `growth-point-correction` | `api/teacher/growth/[eventId]` PATCH |

Recovery procedures per label (business impact + post-checks) live in
`docs/FAILURE_RECOVERY.md` §2.

### 7.4 Prisma P-code → envelope mapping

| Prisma code | Envelope | HTTP | Public message |
|---|---|---|---|
| `P2002` (unique) | `CONFLICT` | 409 | "This record already exists" (internalDetail keeps `P2002: …`) |
| `P2025` (record not found) | `RESOURCE_NOT_FOUND` | 404 | default |
| `P2003` (FK / tenant-guard trigger ABORT) | `INVALID_INPUT` | 422 | "Related record not found" |
| any other `P****` | `DATABASE_FAILURE` | 500 | "Internal server error" — the diagnostic code stays in `internalDetail`/the log line |

---

## 8. Background jobs

**Implementation:** `src/lib/observability/jobs.ts` (`runJob`) +
`JobRun` model (migration `20260202000000_observability`).

### 8.1 The JobRun model

| Field | Type / values | Meaning |
|---|---|---|
| `id` | cuid (PK) | row id |
| `jobId` | string, **unique** | stable identity: `name:key` or `name:<base36-ts>-<rand>` |
| `jobName` | string | grouping key for dashboards |
| `schoolId` | string?, FK School, SetNull | tenant scope; **tenant-guard trigger** aborts bogus school ids (P2003) |
| `trigger` | `request \| scheduled \| manual \| system` (default `request`) | what kicked it off |
| `idempotencyKey` | string? | with `jobName` **unique** — the dedup pair |
| `status` | `running \| success \| failed \| skipped` (default `running`) | lifecycle |
| `attempt` / `maxAttempts` | int (default 1/1) | retry state; maxAttempts clamped [1,10] |
| `startedAt` / `finishedAt` / `durationMs` | | timing |
| `error` | string? | `Error.name: message` truncated to 400 |
| `resultSummary` | string? | JSON/stringified result, ≤300 chars, `'[unserializable-result]'` fallback |
| `requestId` | string? | correlation to the triggering request |

Indexes: `(jobName, status, startedAt)`, `(schoolId, jobName, startedAt)`.

### 8.2 The `runJob()` contract

- **Never throws** — returns `{ status: 'success' | 'failed' | 'skipped',
  jobId, runId, attempt, durationMs, result?, error? }`. A failed job is the
  CALLER's decision, never a new failure mode.
- **Retry state:** `fn(attempt)` re-runs sequentially up to `maxAttempts`
  (clamped 1–10). `job_retry` (warn) per failed attempt, `job_failed` (error)
  at exhaustion; the row records the FINAL attempt number.
- **Idempotency semantics:** when an `idempotencyKey` is supplied and a prior
  run with `(jobName, key)` has status **`success`**, the call short-circuits
  to `skipped` WITHOUT executing `fn` (a `job_skipped` line, the prior
  jobId/runId returned). A prior `failed` or `running` row does **NOT**
  short-circuit — redelivery after failure re-executes (this exact semantics
  was a real bug found and fixed by the integration suite, worklog Task 11-b).
- **Tracking tolerance:** if the JobRun row cannot be created (DB down, bogus
  schoolId → tenant-guard P2003), the job still runs — a `job_tracking_failed`
  line records it. Same for a failed idempotency lookup.
- **Request correlation:** the ambient request context's `requestId` is
  stamped on the row and the log lines.
- **Jobs WITHOUT a natural idempotency key** (re-check style) pass no key —
  their `fn` is state-idempotent by construction and every execution still
  gets full run tracking.

### 8.3 Job inventory (the honest audit)

| Unit of work | Tracked by | Trigger | Notes |
|---|---|---|---|
| `attendance-draft-autofinalize` | `runJob` (the ONLY production call site today) | `request` — `POST /api/teacher/class-attendance/draft?classId&date` | no `idempotencyKey` (re-check job); `fn = finalizeDraftIfDue` is state-idempotent — reasons `no-draft / already-submitted / before-boundary / disabled / ok`; response carries `jobStatus` + boundary info |
| **Scheduled / cron work** | — | — | **NONE exists in the app runtime.** There is no scheduler, no queue worker, no cron process inside Next.js. |
| `keepalive.mjs`, `warm-chunks.mjs` (project root) | — | sandbox watchdog / cache warm-up | **dev-infra, OUTSIDE the app runtime** (separate Node processes; they probe `robots.txt`/chunks and restart the dev server). They produce no JobRun rows, no app log lines, and are deliberately excluded from the jobs model — they are environment tooling, not application work. |
| event-stream mini-service (`:3003`, socket.io) | — | separate process | polls SQLite and broadcasts tenant-scoped realtime events; own health check (socket.io handshake); not a background job of this app. |
| Request-triggered synchronous computations (report exports, seating generation, auto-outcomes, CSV imports) | the enclosing `http_request` line | request | NOT background jobs — they run in-request and fail the request if they fail. |

---

## 9. Webhook event tracking

**Implementation:** `src/app/api/webhooks/razorpay/route.ts` + the
`WebhookEvent` model (`eventId @unique`, `attempts Int @default(1)` added by
migration `20260202000000_observability`).

### 9.1 Lifecycle

```
delivery → rate limit (120/min IP) → secret check (unset → 503) →
HMAC-SHA256 signature verify (missing/invalid → 400) →
eventId resolution → WebhookEvent row created (status 'processing',
BEFORE any financial work) → handler → finally: row updated to
'processed' | 'error' (+ matchedTransactionId, error, processedAt) → ack 200
```

### 9.2 The idempotency gate

`eventId` resolution order: `x-razorpay-event-id` header →
`payload.meta.event_id` → `payload.event_id` → **deterministic fallback**
`"evt_" + HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET).slice(0,32)` — a
replayed signed delivery reuses the SAME id and hits the dedup path (Phase-3
fix; a random fallback would process the same event twice).

Duplicate handling (two layers, both attempt-counted):
1. **in-memory fast path** (`Set`, bounded 5000): duplicate →
   `attempts += 1` on the durable row (fire-and-forget) + `webhook_duplicate`
   (layer `in-mem`) + ack 200.
2. **DB unique**: `P2002` on insert → `attempts += 1` (fire-and-forget) +
   `webhook_duplicate` (layer `db`) + ack 200 — never re-processed.

`attempts` therefore counts deliveries seen per event id (retries + signed
replays); default 1. Processing errors are persisted on the row
(`status:'error'`, `error` text) — the gateway is still acked 200 so it does
not retry forever; triage is the operator's job (see
`docs/FAILURE_RECOVERY.md` §4).

---

## 10. Operational runbook (greps and queries)

```bash
# 1. Trace one request (user quotes requestId from the envelope):
grep '"requestId":"<id>"' dev.log

# 2. Top slow queries (≥ DB_SLOW_QUERY_MS, SQL shape only):
grep '"event":"db_slow_query"' dev.log | grep -o '"durationMs":[0-9]*' | sort -t: -k2 -n | tail

# 3. Engine/query errors right now:
grep '"event":"db_query_error"' dev.log

# 4. Failed-job triage (Prisma console or a one-off bun script):
#    db.jobRun.findMany({ where: { status: 'failed' } })
#    → jobName, error (≤400 chars), attempt/maxAttempts, requestId, schoolId, startedAt
#    Retry = re-invoke the trigger (a FAILED row never short-circuits runJob).

# 5. Webhook triage:
#    db.webhookEvent.findMany({ where: { status: 'error' } })
#    → eventId, eventType, error, attempts, matchedTransactionId, schoolId
#    Unattributed settlement events (schoolId null) are recorded, never guessed.

# 6. Cross-tenant attempt hunting:
grep '"event":"tenant_mismatch"' dev.log     # + ActivityLog action TENANT_MISMATCH
```

Full failure-mode playbooks (detection → containment → recovery →
verification) live in `docs/FAILURE_RECOVERY.md`.

---

## 11. Verification (the gate)

```
$ bun run test           # unit + integration + API + regression + security → 378 pass
$ bun run test:e2e       # 4 cookie journeys + public visitor → 5 pass
$ bunx tsc --noEmit      # 0 errors
$ bunx eslint .          # 0 errors (warn-level: react-hooks/exhaustive-deps burn-down, §12)
```

Observability-specific coverage: `tests/unit/` (logger shape/filtering/anti-
spoof/redact/truncation/hostile-fields — 88 total incl. request-id
sanitization, context scoping, taxonomy), `tests/integration/jobs-and-jobs.test.ts`
(runJob lifecycle/retries/idempotency/tracking tolerance, JobRun uniques,
WebhookEvent.attempts, trackedTransaction, readiness primitive — 23),
`tests/api/observability-contracts.test.ts` (health probes, X-Request-Id
propagation/echo/anti-injection, envelope shapes — 29 of the 47 API tests).

---

## 12. Honest limitations

1. **Single-process in-memory rate limiter** (`src/lib/security/rate-limit.ts`)
   — counters reset on restart and are not shared across instances. Fine for
   the current single-instance deployment; a hard blocker for horizontal
   scaling (Postgres-backed limiter is on the migration plan backlog).
2. **Logs go to stdout/stderr only — no shipper is wired.** There is no log
   aggregation, retention, or alerting pipeline (Supabase/Vercel/Resend
   connection deferred by the phase constraints). Grep-ability is the current
   operational model; durability of `dev.log`/`server.log` is a filesystem
   concern.
3. **Audit + process lines are hand-rolled**, not routed through the
   structured logger: `audit.ts` and `instrumentation.ts` emit the same JSON
   shape directly via `console.log/warn/error` (the instrumentation file
   deliberately imports nothing — the edge-middleware build cannot bundle
   Node APIs; `audit.ts` predates Phase 4). Consequences: no `LOG_LEVEL`
   filtering and no `redact()` pass on those specific lines — their fields
   are sanitized at the source (`sanitizeAuditDetail`) instead.
4. **`/health/ready`'s 503 path is untested against the shared dev DB** — the
   test suites must not take down the database other suites depend on, so the
   failure branch is pinned by code reading + the success shape carries the
   failure-path fields (`checks.database`). Known gap, documented in the
   regression suite.
5. **A handful of raw routes bypass the `api()` envelope** (§4.2:
   `/api/app-version`, `/api` root, webhooks, health, RSS, schools/public,
   admissions/public, the upload family, avatar). Each hand-rolls a safe
   envelope with `newRequestId()` and all still get middleware correlation,
   but they do not get the `http_request` completion line or the uniform
   `{ok,error,code,requestId}` failure shape (the API test suite pins their
   ACTUAL shapes instead of pretending).
6. **The `trackedTransaction` label migration landed concurrently with this
   document** (worklog Task 11-c entry not yet appended at doc-writing time) —
   the §7.3 label table reflects the source state verified by grep, not a
   worklog claim; if the two ever disagree, the code wins.
7. **`react-hooks/exhaustive-deps` stays warn-level** (error-level rollout
   happens as the warning count is burned down — `eslint.config.mjs`).
8. **The event-stream mini-service is a separate process** — not covered by
   `/health/ready` or the structured logger (its handshake IS its health
   check; see `docs/SECURITY_BASELINE.md` for its auth posture).
9. The in-memory webhook dedup `Set` is bounded at 5 000 ids and clears
   wholesale when full — the DB unique is the authoritative gate, so this is
   purely a fast-path optimization.
10. `db_transaction` commit lines are debug-level — invisible at the default
    `LOG_LEVEL=info`; failures are always visible.
