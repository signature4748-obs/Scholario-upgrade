# AUDIT 4/7 — QUALITY AND REGRESSION REPORT (incl. Phase 4 login/dashboard diagnosis)
Audit date: 2026-10-09

---

## 1. Commands executed this session (exact, with exit codes)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `bunx prisma generate` | 0 | client generated (was missing after the 10:32 reset) — no DB connection involved |
| 2 | `bun run typecheck` (`tsc --noEmit`) | 0 | **0 type errors** across the repository |
| 3 | `bun run lint` (`eslint .`) | 0 | **0 errors, 56 warnings** — all `react-hooks/exhaustive-deps`, the documented pre-existing class (61 at the Sept-30 gate → 56 now) |
| 4 | `bun test tests/unit/` | 0 | **91 pass / 0 fail / 421 expects** across 6 files (95 ms) — observability logger/redaction/context, errors taxonomy, platform MFA config, HTTP layers. No DB needed. |
| 5 | `nohup bun run dev` (background) | — | dev server up on :3000 at 12:40 (normal dev operation, non-destructive) |

**Not executed, and why (honest):**
- `tests/api`, `tests/integration`, `tests/regression`, `tests/security` (37 files), `tests/e2e`: these suites require a seeded PostgreSQL database (CI pipeline: ephemeral PG → `migrate deploy` → full seed corpus → suites) and, for e2e, a warm dev server + demo corpus. The DB cluster and corpus were wiped by the 10:32 reset; seeding is out of scope for this audit phase ("no production seeds / db push / migrations" — migration-deploy-to-fresh-local-cluster would be allowed later as an isolated-DB check, but it cannot yield meaningful suite results without the seed corpus, whose scripts are exactly the forbidden seed family). **No test result from these suites is claimed.**
- `bun run build`: intentionally skipped (documented 4 GiB OOM class for Turbopack; webpack build takes ~69 s but a production build during an audit-only phase adds risk without adding signal beyond the Sept-30 EXIT 0 + Oct-2 record).
- No DB mutations, no seeds, no `db:push`, no migrations, no destructive SQL were run.

## 2. Pre-existing vs. new failures

**New failures introduced by this session's work: none** (nothing was modified). All findings are pre-existing environmental damage (workspace resets) or documented register items.

## 3. Phase 4 — login/dashboard failure: exact location and evidence

### 3.1 Which application the user saw (proven)
The preview screen the user described (demo persona picker → "Welcome back." → dashboard never opens) is the **sandbox/v2-rebuild** app (SQLite, orphan branch), not the original:
- `Welcome back.` toast exists only in the rebuild (`src/components/app/login-view.tsx:33` in `ac0f6fd`).
- One-click persona doors (`arjun.malhotra@hhsp.edu.in`, teacher + student) exist only there (SANDBOX.md + `DEMO_LOGINS`).
- The original app has no persona picker and no such string (repo-wide search).
- The rebuild's own worklog (tracked in the branch) records its final state as fully E2E-verified with zero console errors — so the failure the user observed is consistent with the **workspace reset degrading a running app** (server killed / its SQLite DB `db/custom.db` and `.next` wiped mid-use by the 10:32 reset — the same mechanism that wiped this audit's `worklog.md`), rather than a code defect. The runtime logs that would pinpoint the instant (its dev.log) were wiped with the reset.
- Currently that app is gone from the workspace (checkout removed; DB wiped) and **nothing served :3000 between 10:32 and 12:40** (preview 502).

### 3.2 The ORIGINAL application's login→dashboard chain (static + live trace)
Chain: door `/s/[slug]/login` (school branding via `/api/schools/public`) → `POST /api/auth/login` (strict zod validation → DB-backed dual-bucket rate limit → `db.user.findUnique` → scrypt verify → tenant/entitlement check → session cookie) → middleware (correlation + plane gate) → shell `/api/auth/me` → `/api/dashboard` aggregate (role-resolved).

Live probes TODAY (original app, current workspace state):

| Probe | Result |
|---|---|
| `GET /` | **200** (public landing renders) |
| `GET /api/auth/me` | **401** (session layer healthy, DB not needed for negative case) |
| `POST /api/auth/login` (probe credentials) | **500** — fails in the DB layer BEFORE any credential check |
| `GET /api/schools/public` | **500** |
| `GET /s/hawkings-prithvipur/login` | **404** (school unresolvable without DB) |
| `GET /health/live` | **200** |
| `GET /health/ready` | **503** `{"status":"unavailable","checks":{"database":"failed"}}` — honest failure reporting |

**Exact failure location (root cause, original app):** `dev.log` structured events `db_query_error` — Prisma rejects the datasource at validation level: **"the URL must start with the protocol `postgresql://` or `postgres://`"** (schema.prisma:9, provider postgresql; the bootstrap-recreated `.env` contains the SQLite template URL). Secondary cascade: `tenantDomain.findFirst` errors on the door route; `rate_limit_backend_unavailable` (fails open to per-instance budget — as designed).

**Therefore:** on the original app, TODAY, no persona can log in and no dashboard can open because the DB stack is wiped — the failure is environmental (workspace), at the prisma-datasource boundary, before authentication logic. Repair path is the DB-stack gate (Audit 7, Gate A). After repair, the demo login flows for Principal/Teacher/Student must be re-run as the Phase-4 completion check (the earlier 8de94c3 "real session personas" work made the login personas real session personas; the flows were browser-verified at the Sept-30 gate).

### 3.3 Live-socket / realtime
`mini-services/event-stream` (socket.io :3003, authenticated, school-scoped) is running but failing its PG connection every minute since 10:32 (service.log attempts 163+) — the shell's live ticker will show its designed "Reconnecting…" honest degrade until Gate A.

## 4. Dependency / lockfile consistency

- `bun.lock` present; `node_modules` intact post-restore (449 top-level entries); `prisma generate` succeeded; typecheck+lint+unit ran clean against the installed tree → no drift detected.
- `mini-services/event-stream` and `mini-services/postgres-db` have their own `bun.lock` + `node_modules` (self-contained services, documented dev-only infrastructure).

## 5. Historical quality record (for context — not today's claims)

- 2026-09-30 gate: tsc 0 / eslint 0 (61 warn) / **437 pass + 5 e2e** / production build EXIT 0 (webpack, 69 s) / standalone boot 200s.
- 2026-10-02 (Phase 8C): **518 pass / 0 fail / 14 designed skips** (pg-rls off-Supabase by design), incl. security 292, e2e 32; provisioning acceptance 12/12; tenant acceptance 15/15.
- Known OOM class: in-sandbox Turbopack builds and dev-server compile spikes under the 4 GiB cgroup (documented in both reports; webpack engine + keepalive watchdog are the mitigations).
- Test coverage of the module matrix: security suite covers tenant isolation (57), platform isolation (43–45), database integrity (41), rate limits, upload (14), validation, headers, secrets-scan, seed guards; fee-lifecycle (5) covers the fee workflow invariants.

## 6. Workspace tooling reliability findings

| Finding | Severity | Note |
|---|---|---|
| postgres-db mini-service is not auto-started by the container (only event-stream is) | **P0 (workflow)** | every container restart leaves the app without its DB until manually started; cluster dir wiped by restores |
| Bootstrap recreates a SQLite-template `.env` incompatible with the app | **P0 (workflow)** | see Audit 1 §2 — silently breaks the DB layer after every reset |
| Untracked/ignored files (incl. `worklog.md`, `dev.log`, `db/`) are wiped on resets | **P0 (process)** | evidence loss + corpus loss; commit-promptly policy required |
| External branch revert (02:41:48) | **P0 (process)** | branch switches do not persist; verified branch presence before each phase is mandatory |
| Dev server itself is healthy: clean boot, structured logging, honest 503 ready-state | — | positive signal: the app degrades exactly as designed |
