# SCHOLARIO-OS — FAILURE RECOVERY PLAYBOOK (PHASE 4)

> Status: **operational runbook** (2026-02-02). Every detection signal quoted
> below is a real log event / HTTP shape emitted by the code — the vocabulary
> is catalogued in `docs/OBSERVABILITY.md` §2.3, and the invariants the
> recovery steps lean on are specified in `docs/DATABASE_INTEGRITY.md`
> (Phase 3) and `docs/TENANT_ISOLATION_MODEL.md` (Phase 2).
>
> **Honesty note:** §11 lists the failure classes that are NOT yet
> recoverable inside this sandbox (no off-site backups, no log shipping,
> single instance). The recovery procedures assume the current deployment
> shape: one Next.js process + one SQLite file (`db/custom.db`) + the
> event-stream mini-service on :3003.

---

## 0. How to read this playbook

Every section follows the same structure:

| | |
|---|---|
| **Detection** | the exact log event, probe result or client symptom that fires first |
| **Containment** | what stops the failure from spreading while you diagnose |
| **Recovery** | the step-by-step procedure |
| **Verification** | how you PROVE the system is healthy again (commands/probes, not feelings) |

The universal first tool is the request triage runbook (§10): almost every
failure surfaces with a `requestId` (API) or a `digest` (render) — quote it,
grep it, reconstruct the timeline.

---

## 1. Database down / slow

| | |
|---|---|
| **Detection** | 1. `GET /health/ready` → **503** `{"status":"unavailable","checks":{"database":"failed"}}` (the load-balancer signal — stop routing traffic to this instance). 2. `health_ready_failed` error lines (channel `health`). 3. `db_query_error` lines (channel `db`, with `target`). 4. Client symptom: failure envelopes with `"code":"DATABASE_FAILURE"` (500) on routes that touch the DB. 5. Slowness without downtime: `db_slow_query` warn lines (`durationMs` ≥ `DB_SLOW_QUERY_MS`, default 200 ms). |
| **Containment** | The instance answers 503 on readiness (LB evicts it) while `/health/live` stays 200 — that split is deliberate: the process is fine, the dependency is not; restarting the app would NOT help and a liveness probe that depended on the DB would cause a restart storm. Auth-gated routes keep failing safe (`DATABASE_FAILURE` is a generic 500 envelope — no internals leak). |
| **Recovery — diagnosis order** | (a) `bunx prisma migrate status` — did a migration half-apply? (b) Check the SQLite file: `ls -la db/custom.db*` — lock files (`-journal`, `-wal`, `-shm`) present + queries timing out ⇒ a writer is stuck or a stale lock from a crashed process; the keepalive watchdog restarts the dev server, which releases process-held locks. (c) Disk: a full disk makes SQLite fail on write — `df -h .`. (d) Slow-only: correlate `db_slow_query` lines by `requestId` with the route (`route`/`operation` fields) — a route-specific slow query is an application problem (see the N+1 residuals in `docs/DATABASE_INTEGRITY.md` §11); a global slowdown is the engine (single-writer SQLite under concurrent load — the Postgres trigger, §11). |
| **Verification** | `GET /health/ready` → 200 with `checks.database:"ok"`; re-run the affected request and grep its `requestId` — the `http_request` line closes with `status:200` and no `db_query_error` lines share the id. The regression suite pins the ready-probe shape; the DB-integrity suite (`bun run test:security`) re-proves the invariants. |

---

## 2. Transaction failures (multi-row mutations rolled back)

| | |
|---|---|
| **Detection** | **`db_transaction_failure`** lines (channel `db`, error-level) — `{label, status:"failed", durationMs, errorCode, detail}` — one per rolled-back transaction, the label naming the business operation (catalog below). Also the enclosing **`http_request`** failure line (channel `http`, `errorCode` + `internalDetail`) and a **`db_query_error`** line when the engine reported the failure. Note: the label migration landed concurrently with this document (the worklog Task 11-c entry was not yet appended at doc-writing time) — the labels below were verified by grep against the source; the code is authoritative if they ever disagree. |
| **Containment** | The transaction itself is the containment: a rollback leaves NO partial writes. This is the Phase-3 guarantee (worklog Task 7 / `docs/DATABASE_INTEGRITY.md` §5) with the Phase-4 wiring on top: every multi-row mutation runs through `trackedTransaction` (one atomic unit), so a mid-flight failure never leaves `FeeTransaction` marked SUCCESS without the ledger applied, never half-publishes a fee structure, never leaves a half-rebuilt timetable. |
| **Recovery** | 1. Grep the `requestId` from the envelope → the `db_transaction_failure` line's **label** names the failed business operation directly; the `http_request` line's `internalDetail` (server-only) adds the Prisma code. 2. Classify by code: `P2002` (CONFLICT 409 — a concurrent writer won; usually retry-safe), `P2003` (INVALID_INPUT 422 — a tenant-guard trigger or FK rejected the write; fix the input, do not retry), `P2028` (timeout — retry with the same idempotency keys). 3. Re-drive the operation: the money-landing paths are **idempotent by `Payment.transactionId`** — a retry after rollback re-applies exactly once (`applyPaymentToLedger` skips when the key exists, clamps to outstanding). 4. `bun run db:audit` — the read-only integrity auditor (duplicate keys, cross-school FKs, bounds) to prove no partial state. |
| **Verification** | The ledger invariant check: for every fee touched, `Fee.paid == Σ Payment.amount WHERE feeId = fee.id` and `fee.status` matches the boundary (UNPAID/PARTIAL/PAID); exactly one `Payment` row per `transactionId`. These are the exact assertions of `tests/security/database-integrity.test.ts` — re-run it. |

**The `db_transaction_failure` label catalog** — all 24 tracked mutations
(label → call site → business impact of a rollback):

| Label | Call site | Business impact of a rollback |
|---|---|---|
| `webhook-payment-captured` | `api/webhooks/razorpay` | txn stays non-SUCCESS + ledger un-applied — **safe**: replay/redelivery re-applies atomically |
| `webhook-settlement-processed` | `api/webhooks/razorpay` | settlement row + links not written — redelivery is deduped by eventId, re-drive via fees/verification |
| `payment-verify-reconcile` / `payment-verify-transition` | `api/student/payments/verify` (×2) | order stays PENDING or un-reconciled — retry is idempotent (conditional transition first) |
| `payment-record-manual` | `api/fees` (payment-record) | no ledger change — retry re-runs in-tx read+increment |
| `fee-verification` / `fee-direct-record` | `api/fees/verification` (×2) | no verification/ledger change — retry safe (record-direct TOCTOU closed in-tx) |
| `payment-confirm-capture` | `api/fees/payments/confirm` | demo-gateway order unconfirmed — retry idempotent by minted gatewayPaymentId |
| `fee-transaction-create` | `api/fees/transactions` | no txn row (receipt minted inside tx — no orphan) |
| `fee-structure-publish` / `fee-structure-update` | `api/fees/structures/[id]` + `/publish` | old structure stays current, draft stays draft — 409 on conflicting retry; head replacement is all-or-nothing |
| `student-create-with-user` / `teacher-create-with-user` / `school-create-with-principal` | `api/{students,teachers,schools}` POST | no orphaned User rows (user+profile created together) |
| `timetable-publish` | `api/timetable/publish` | previous timetable INTACT (wipe+rebuild is atomic — a failure cannot leave the school timetable-less) |
| `results-publish-batch` | `api/results` | no partial result rows (upsert-per-entry in one tx) |
| `library-issue` / `library-return` | `api/library` (×2) | availability count unchanged — double-return guard returns 409 on retry-after-success |
| `attendance-batch-mark` | `api/attendance` POST | tenant-safe create-or-update — retry hits the same `(studentId, date)` key |
| `attendance-canonical-write` | `lib/class-attendance.ts` | replace-by-class-day is all-or-nothing; journal only real changes |
| `exam-create` / `exam-seating-generate` / `exam-outcomes-compute` | `lib/exams/{service,service-extended}` (×3) | no exam scaffold/seat/outcome partial sets (marks seeding is one `createMany`) |
| `growth-point-correction` | `api/teacher/growth/[eventId]` | event + correction ledger stay consistent |

---

## 3. Webhook failures (Razorpay)

| | |
|---|---|
| **Detection** | `db.webhookEvent.findMany({ where: { status: 'error' } })` — the durable triage list (`eventId`, `eventType`, `error`, `attempts`, `matchedTransactionId`, `schoolId`). Log lines: `webhook_processing_failed` + `webhook_failed` (both error-level, share `eventId`). Missing-secret misconfiguration is the loudest case: the route answers **503** with `"Webhook secret not configured on the server."` so the gateway KEEPS RETRYING until the operator sets `RAZORPAY_WEBHOOK_SECRET` (fail-closed by design). |
| **Containment** | Errors are persisted on the WebhookEvent row and the gateway is still acked 200 — a failing handler does not become an infinite retry loop. Signature failures never mutate anything (400 before the row is created). Rate-limit floods get 429 + `Retry-After` (120/min per IP). |
| **Recovery** | 1. Read `WebhookEvent.error` for the exact handler failure. 2. **Signature misconfig (503 secret-missing):** set `RAZORPAY_WEBHOOK_SECRET` (`.env`, never committed) — the gateway's own retries then land and process normally. 3. **`payment.captured` handler failure** (e.g. "No FeeTransaction found for gatewayOrderId …"): do NOT re-POST the webhook — a same-event-id redelivery is a **counted no-op by design** (`eventId @unique` gate; `attempts` increments). Re-drive the business effect through the idempotent writers instead: `POST /api/student/payments/verify` (reconcile-if-unapplied path) or the fees/verification flow — `applyPaymentToLedger` applies at most once per `Payment.transactionId`. 4. **Settlement unattributed** (`schoolId` null): deliberate — ambiguous/multi-school settlements are recorded and never guessed; resolve the ambiguity (which orders the payout covers) before any manual linking. 5. In-memory-dedup edge (process restart lost the fast-path Set): harmless — the DB unique is authoritative. |
| **Verification** | The event row reaches `status:'processed'` with `matchedTransactionId` set; the ledger invariant check of §2 passes for the referenced fee; `webhook_processed` (info) line appears with the `eventId`. Replays are safe to test live: a re-delivered event shows `webhook_duplicate` + `attempts` incremented and changes nothing. |

---

## 4. Background job failures

| | |
|---|---|
| **Detection** | `db.jobRun.findMany({ where: { status: 'failed' } })` → `jobName`, `error` (≤400 chars), `attempt`/`maxAttempts`, `requestId`, `schoolId`, `startedAt`. Log lines: `job_failed` (error) — preceded by `job_retry` (warn) lines while attempts remained. |
| **Containment** | `runJob` **never throws** — a failed job cannot fail the enclosing request by accident; the only production job (`attendance-draft-autofinalize`) returns `jobStatus: 'failed'` in the route response and the canonical attendance record is untouched. Observability is never a new failure mode: a JobRun row that cannot be created (DB down, tenant-guard P2003 on a bogus schoolId) degrades to `job_tracking_failed` and the job still runs. |
| **Recovery** | 1. Retry = re-invoke the trigger (re-`POST /api/teacher/class-attendance/draft?classId&date`). A prior FAILED row does **NOT** short-circuit `runJob` — only a prior **SUCCESS** with the same `(jobName, idempotencyKey)` does (this semantics is integration-tested). 2. Why re-running is safe: the wired job is a **re-check job with no idempotencyKey** — its `fn` (`finalizeDraftIfDue`) is state-idempotent: no-draft → no-op, already-submitted → no-op, before-boundary/disabled → no-op; only a genuinely due, complete, unsubmitted draft finalizes. Keyed jobs (future) get the prior-SUCCESS short-circuit instead. 3. Read `JobRun.error` — the same `Error.name: message` the `job_failed` line carries. |
| **Verification** | The retried run's JobRun row: `status:'success'`, `attempt` reflects the fresh chain, `finishedAt`/`durationMs` set; `job_completed` line shares the new `requestId`; the business state (canonical attendance rows for that class-day) matches the draft, and the draft is cleared. |

---

## 5. Uncaught process failures

| | |
|---|---|
| **Detection** | `uncaught_exception` / `unhandled_rejection` lines (channel `process`, hand-rolled JSON from `src/instrumentation.ts` — the process-level safety net installed in `register()`, which runs once at boot in dev and production, and is a no-op inside the edge middleware sandbox). |
| **Containment / Recovery** | **Unhandled rejection:** logged, process stays up — a stray promise is a defect signal, not a crash reason. **Uncaught exception:** logged, then `process.exit(1)` **in production** — a crashed process must not keep serving; the supervisor restarts it (in this sandbox that role is played by `keepalive.mjs`, which probes and respawns the server; in production it is the platform process manager). In dev the process stays up to keep iterating. |
| **Verification** | After restart: `GET /health/live` 200 (process serving), `GET /health/ready` 200 (DB reachable); the uptime/timestamp on the live probe confirms a fresh boot; grep the crash line's timestamp against the restart to confirm causality; then request-triage (§10) the failing `requestId` if one is attached. |

---

## 6. Render / route failures (pages and uncovered handlers)

| | |
|---|---|
| **Detection** | Client: the `error.tsx` boundary card — "Something went wrong" with a **Reference:** code (the render `digest`, first 24 chars); the browser console carries the `ui_error_boundary` line (channel `client`) with the full digest. Server: `next_request_error` line (channel `process`) from `onRequestError` — `name: message \| route \| operation \| requestId \| routeType`. If the root layout itself failed, `global-error.tsx` renders (last resort). API-route failures outside the envelope also land on `next_request_error`. |
| **Containment** | The boundary replaces only the failing segment — nav/footer survive; data is not lost client-side. 404s render `not-found.tsx`; segment transitions show the `loading.tsx` Suspense fallback instead of a blank screen. |
| **Recovery** | Map the user-reported **Reference** (digest prefix) to the server log: grep the digest — Next's server-side error log and the `next_request_error` line both carry it; the line also carries the `requestId` when middleware stamped one, which then reconstructs the full timeline (§10). Retry actions: the boundary's `Try again` (reset the segment) / `Reload page` buttons. For API errors, the user quotes the envelope's `requestId` instead. |
| **Verification** | After a fix deploys, the same route renders without an `error` prop → no new `ui_error_boundary` line, no `next_request_error` line; `/health/live` stays 200 throughout (render failures never kill the process). |

---

## 7. External service failures (AI gateway)

| | |
|---|---|
| **Detection** | `external_service_failure` warn lines (`errorCode:"EXTERNAL_SERVICE_FAILURE"`, `service:"ai-gateway"`, the upstream message) and `external_service_degraded` lines (reason: `sdk-client-unavailable` / `unparseable-response` / `response-was-not-a-json-array`). These are WARN-level by design: the user experience degrades before you notice. |
| **Containment** | Graceful degradation, never a hard failure: `/api/ai/generate-questions` falls back to `generateTemplateQuestions(...)` — teachers still get usable questions. When even the fallback yields nothing valid, the route answers a human message ("AI returned no valid questions…") with `ok:false` — still no internals. |
| **Recovery** | The gateway is env/SDK-configured; restore the z-ai-web-dev-sdk availability (in production: credentials/network for the AI provider). No data was corrupted — the route is read/generate-only; question-bank autoSave only runs on successfully generated sets. |
| **Verification** | Generate-questions requests stop emitting `external_service_*` lines and return real AI output (non-template questions); the 12/hour per-account rate limit still gates abuse. |

---

## 8. Rate limiting / lockout storms

| | |
|---|---|
| **Detection** | `RATE_LIMITED` 429 envelopes (with `Retry-After` seconds) and `ACCOUNT_LOCKED` 429s on login; audit lines `LOGIN_RATE_BLOCKED` / `RATE_LIMIT_BLOCKED` (channel `audit`, with the profile + key). A storm shows as many such lines from one IP or against one account. |
| **Containment** | This IS the containment — the in-memory fixed-window limiter bluts DoS/replay/brute-force floods (login 8/15 min per IP and 5/15 min per account with lockout; webhook 120/min per IP; per-account limits on messaging/payment/upload surfaces — the full table is `docs/SECURITY_BASELINE.md` §2). |
| **Recovery** | 1. Legitimate shared-IP exhaustion (a school NAT): the buckets key on the client IP (`clientIpFromHeaders`, `X-Forwarded-For`-aware) — exactly the property the test suites exploit with per-run unique `X-Forwarded-For` values to stay re-runnable. Users self-recover after the window (`Retry-After` is communicated); a genuine abuse storm ages out with the window (progressive extension on repeated abuse). 2. Account lockout: time-boxed — retry after the lockout window. 3. If a storm is an attack: the audit lines carry the key prefix for the source; block at the gateway. 4. Do NOT restart the process to "clear" limiter state — that resets counters for the attacker too. |
| **Verification** | Audit lines stop for the offending key; the golden-path logins work (`tests/api/domain-smoke.test.ts` §1 / e2e journeys exercise real logins against the same limiter); no `ACCOUNT_LOCKED` for the affected legitimate users after the window. |
| **Known property (documented, not a bug):** the limiter is single-process in-memory — counters are per-instance and reset on restart (`docs/OBSERVABILITY.md` §12). |

---

## 9. Migration failures

| | |
|---|---|
| **Detection** | CI Gate 3/3b: `prisma migrate deploy` on a FRESH database fails, or the drift diff (`prisma migrate diff --from-url … --to-schema-datamodel`) reports a difference → the build fails before any code ships. In the environment: `bun run db:migrate:status` reports pending/failed migrations; trigger-guard ABORTs surface as Prisma `P2003` on writes. |
| **Containment** | The destructive workflow is already impossible to run by accident: `bun run db:push` / `db:reset` are loud guard scripts (`scripts/db-push-guard.ts`, `db-reset-guard.ts`) that exit 1 with instructions; the explicit override is dev-only (`SCHOLARIO_ALLOW_DB_PUSH=1`, never possible with `NODE_ENV=production`). `prisma migrate deploy` only ever APPLIES pending migrations — never resets, never drops. |
| **Recovery** | 1. Reproduce locally: `DATABASE_URL=file:./scratch.db bunx prisma migrate deploy` — a fresh-file deploy is the CI gate in miniature. 2. Fix the migration file (migrations are **additive-first**: new columns/tables/triggers; Phase-3 discipline — hand-written SQL only inside versioned migration files, which is why triggers survive future diffs). 3. Data blockers (a unique that existing rows violate) are caught BEFORE deploy by `bun run db:audit` (the read-only integrity auditor) — clean the data first. 4. Rollback posture: because migrations are additive, the prior app build remains compatible with the post-migration schema; restore the SQLite file from backup for a true point-in-time rollback (see §11 for the backup caveat). NEVER `db push` to "fix" drift — push bypasses history by design. |
| **Verification** | `bunx prisma migrate status` → "Database schema is up to date!"; the drift diff is empty; `bun run db:audit` → 0 flagged rows; `bun run test:security` (202, incl. the 41 invariant tests) green. |

---

## 10. Request-triage runbook (the universal procedure)

```
1. QUOTE   the id:  API failures → requestId from the error envelope
                     (or the X-Request-Id response header);
                     render failures → the "Reference:" digest from error.tsx.
2. GREP    the log:  grep '"requestId":"<id>"' dev.log   (or server.log)
3. READ    the timeline, in order:
   · http_request (channel http)  — the request envelope line:
     status, durationMs, errorCode, internalDetail (server-only detail).
   · any db_* lines sharing the id — slow queries / engine errors /
     transaction failures inside that request.
   · any job_* lines sharing the id — background work it triggered
     (JobRun rows also carry requestId).
   · any webhook_* lines sharing the id — webhook processing it caused.
   · any audit lines carrying the id (channel audit) — security events.
4. CROSS-CHECK durable state: JobRun (status/error/requestId),
   WebhookEvent (status/error/attempts), ActivityLog rows.
5. REPRODUCE with a safe probe (health, read-only GET with the same
   session) before/after the fix.
```

The correlation contract this relies on is regression-pinned: the envelope's
`requestId` equals the `X-Request-Id` header, an inbound well-formed
`X-Request-Id` round-trips exactly (a quoted bug-report id is grep-able), and
hostile ids are replaced, never echoed (`tests/regression/regression.test.ts`
§2–§3, `tests/api/observability-contracts.test.ts`).

---

## 11. Incident classes NOT yet recoverable in this sandbox (honest)

1. **No off-site backups.** The database is a single SQLite file
   (`db/custom.db`) on the same disk as the app. File-level copies are
   possible (and are the only rollback mechanism for §9), but nothing
   schedules, encrypts, or ships them. A disk loss is a total data loss.
2. **No log shipping.** Logs go to stdout/stderr (and `dev.log`/`server.log`
   via the dev/start scripts) on the same host — no aggregation, no retention,
   no alerting. A host loss erases the incident history with it
   (`docs/OBSERVABILITY.md` §12).
3. **Single-instance deployment.** One app process, one DB file, one
   event-stream process — no redundancy, no failover. The in-memory rate
   limiter and the in-memory webhook fast-path are per-instance by
   consequence.
4. **No point-in-time recovery** — SQLite has no WAL archiving / PITR here.

These are deferred **deliberately** with the Postgres/Supabase migration
plan (`docs/POSTGRES_MIGRATION_PLAN.md`): managed Postgres brings PITR +
off-site backups, the platform brings log shipping + multi-instance process
management + an external rate-limit store. The plan also carries the
single-writer SQLite ceiling (10k+ students) that is the *other* reason that
migration is the strategic fix.
