# SCHOLARIO — Stage A Workspace Recovery Report

**Date:** 2026-10-16 (07:57–08:45 UTC) · **Operator:** recovery session · **Scope:** read-only investigation → non-destructive recovery → environment gates
**Feature branch:** `feat/super-admin-schools-management` · **PR:** #31 · **Baseline rule honored:** no `reset --hard`, no force-push, no stash drops, no main-branch pushes, no production access of any kind.

---

## 1. Actual state discovered (A1) — all verified live, none assumed

| Item | Verified value | Evidence |
|---|---|---|
| Remote feature HEAD | `607c928` (`fix(ci): replace the in-function require() …`) | `git ls-remote origin` |
| PR #31 | open · head `607c928` · base `main` · mergeable_state `clean` · 28 commits | GitHub API |
| CI on `607c928` | **completed / success** (2026-10-16T04:03:38Z) | GitHub Actions API |
| Historical SHA reports | `7580656`, `1bb7626`, `bf7437e` are **ancestors** of `607c928`, not the tip; `7580656` was the only red run (superseded by the two harden commits) | Actions run list |
| Remote `main` | `8e58baa` | `git ls-remote` |
| Local `main` | `4c4291a` — **ahead 21** (local merge history only; never pushed, untouched) | `git status` |
| Local feature branch ref | `607c928` = remote (in sync) | `git for-each-ref` |
| Working tree (main) | **clean** — zero uncommitted tracked changes | `git status --short` |
| Stashes | 3 historical stashes — **preserved untouched** | `git stash list` (pre/post identical) |

## 2. Root causes (all evidenced, no guessing)

- **RC1 — branch-reset watcher (previous session's adversary).** A prior container ran a `.zscripts/dev.sh` bash loop (sleep-5) executing `git switch main` at tool-call boundaries. **In the current container this watcher does not exist** (`.zscripts/` absent; no keepalive/git-loop process). The post-checkout audit hook (`/tmp/git-checkout-audit.log`, ancestry-walking) records the **last external switch at 06:54:18Z** and **zero external checkout events since** — the only later event (08:19:49Z) is this session's own `git worktree add`, with full process ancestry proving tool provenance. Tool-call bashes are distinguishable (`--noprofile --norc`); the old watcher's were not.
- **RC2 — `.env` SQLite overwrite at container boot.** `/start.sh` lines 70/98 unconditionally write `DATABASE_URL=file:/home/z/my-project/db/custom.db` on every container start (fresh AND restore branches) → the postgres-db mini-service FATAL'd at 05:04:54Z (".env DATABASE_URL is not a postgresql:// URL"). Confirmed in `/tmp/mini-service-postgres-db.log`.
- **RC3 — per-tool-call env injection.** The sandbox controller injects `DATABASE_URL=<sqlite template>` into every tool shell session. Environment variables override dotenv in Prisma CLI, Prisma Client and bun — so even with a correct `.env` file, DB commands run from tool shells resolved SQLite and failed (P1012 "URL must start with postgresql://"; opaque connect errors). This was the invisible second layer behind the ".env keeps breaking" symptom. Mitigation: `scripts/dev-env.sh` (committed) re-exports the repo `.env` over the injection; it also reconstructs `.env` from the CI-documented default when a reset has wiped it.
- **RC4 — ICU60 linkage.** Embedded PG links `libicu{data,i18n,uc}.so.60`; Debian 13 ships ICU 76; the package ships only `.so.60.2` files. Previously bridged by an **external** `/home/z/.local/icu60` shim (wiped on reset — an undocumented single point of failure). Now fixed **inside the service**: `mini-services/postgres-db/index.ts` idempotently creates the soname aliases in the package's own `native/lib` dir and prepends it to `LD_LIBRARY_PATH` (symlink, copy fallback). Post-reboot, `bun install && bun run dev` in the service dir brings PG up with zero external library state.
- **RC5 — dev server SIGTERM.** The main dev server (`next dev`, port 3000) had been SIGTERM'd (dev.err); nothing auto-restarts it in this container. Now serving from the feature worktree.
- **RC6 — prior tool 403 storm.** The previous session's Bash/Read 403 failures were a transient platform outage (not repo state); the session restart resolved it. Current session: zero such failures; strict retry policy (max 2 consecutive failures per tool, then stop) was honored — no retry storms, no keepalive spam.

## 3. Recovery actions (A2–A5) — all additive / non-destructive

1. **Backups (A2):** `refs/recovery/stash-{0,1,2}` created (stash commits now ref-anchored); verified complete-history bundle `/home/z/recovery/refs-all-20261016.bundle`; per-stash patches; evidence snapshots (reflog, process table, audit log, mini-service logs, boot timeline); `.env` copy. Stash list re-verified identical afterward.
2. **Isolation (A3):** `git worktree add /home/z/feature-worktree feat/super-admin-schools-management` — main worktree untouched (`main` @ `4c4291a`). Branch stability re-verified across many separate tool calls; audit hook confirms zero external checkout events.
3. **PostgreSQL + .env (A4):** `.env` normalized (postgres URL per CI-documented local default, `DATABASE_ENV=test`, `REALTIME_MODE=disabled`) in both worktrees (git-ignored). `bun install` + `prisma generate` in the worktree. **Read-only identity check before any mutation:** URL-host assertion (localhost only) + server identity + database list. `prisma migrate deploy` → **all migrations applied** (123 public tables). **Canonical CI seed corpus: 12/12 scripts OK, 0 failures** (School 2 · User 185 · PlatformAdmin 4 · SchoolSubscription 2).
4. **PG service hardening:** restarted through the hardened service code from the feature worktree — existing cluster preserved (data intact), now self-contained w.r.t. ICU.
5. **Tool reliability (A5):** no repeated background spawns; single detached dev-server spawn; policy documented above.

## 4. Stage A acceptance gate results

| Gate | Result | Notes |
|---|---|---|
| Remote HEAD + PR #31 state known | **PASS** | §1 |
| Important local work preserved | **PASS** | §3.1 — bundle verified, stash refs anchored |
| Stable isolated feature worktree exists | **PASS** | `/home/z/feature-worktree` @ `607c928` |
| Branch stable across separate tool calls | **PASS** | Re-verified repeatedly; audit hook silent on external events |
| Repeated Bash failure classified, non-blocking | **PASS** | RC6 — transient platform outage; resolved |
| PostgreSQL starts + accepts local connection | **PASS** | Self-contained service; cluster serving :5432 |
| Startup no longer silently replaces PG URL | **PASS*** | In-session: stable (no overwrite since 06:57). On reboot the platform boot script still clobbers `.env` — `scripts/dev-env.sh` reconstructs it (documented runbook §6). Platform file `/start.sh` is outside the repo and must not be edited. |
| Local DB identity verified before mutations | **PASS** | Host assertion + identity probe |
| Intended migration state confirmed | **PASS** | `migrate deploy` clean; 123 tables |
| Typecheck runs | **PASS** | `tsc --noEmit` rc=0 — **requires `NODE_OPTIONS=--max-old-space-size=2600`** on this 3.9 Gi box (default heap SIGABRTs) |
| Lint runs | **PASS** | 0 errors · 57 warnings (≤ documented 59 baseline) |
| Next.js serves health/readiness | **PASS** | `/health/ready` → `{"status":"ready","database":"ok"}` ~10 s after spawn; login doors 200; `/api/platform/health` correctly fail-closed (AUTH_REQUIRED) |
| Recovery report records evidence + limitations | **PASS** | This document |

## 5. Environment facts for Stage B

- **Dev server:** `/home/z/feature-worktree` → `next dev --webpack -p 3000` (spawned via `spawn-detached.mjs`, log `dev.log`); health `http://localhost:3000/health/ready`.
- **Every tool shell must run `source scripts/dev-env.sh` first** (RC3) — DATABASE_ENV/REALTIME_MODE included.
- **Typecheck invocation:** `NODE_OPTIONS=--max-old-space-size=2600 bun run typecheck`.
- **CI parity env for test runs** (from `.github/workflows/ci.yml`, non-secret fixtures): `RATE_LIMIT_DB_SYNC=on`, fake `GOOGLE_OAUTH_CLIENT_{ID,SECRET}`, `RAZORPAY_WEBHOOK_SECRET=batch2-test-webhook-secret`, `PAYMENTS_SANDBOX=1`, `PAYMENTS_SANDBOX_SECRET=local-sandbox-secret`, `PLATFORM_PAYMENT_WEBHOOK_SECRET=platform-webhook-test-secret`.
- **Memory:** 3.9 Gi total; run heavy gates sequentially.

## 6. Post-container-reset RUNBOOK (reproducible, ~6 commands)

```bash
# 0) A reset wipes untracked files (.env, db/pg, node_modules, worktrees),
#    restores git-committed state, and re-clobbers .env with the SQLite template.
# 1) Re-create the isolated feature worktree (git refs survive via repo.tar):
cd /home/z/my-project && git worktree prune
git worktree add /home/z/feature-worktree feat/super-admin-schools-management
# 2) Deps + env + Prisma client:
cd /home/z/feature-worktree && source scripts/dev-env.sh
bun install && bunx prisma generate
# 3) PostgreSQL — self-contained (ICU soname aliases are created in-package on boot):
(cd mini-services/postgres-db && bun install)
bun /home/z/my-project/spawn-detached.mjs --cwd /home/z/feature-worktree/mini-services/postgres-db bun run dev
#    (embedded cluster auto-inits at db/pg and creates database `scholario`)
# 4) Migrations + canonical seed corpus (CI sequence, local DB only):
source scripts/dev-env.sh && bunx prisma migrate deploy
for s in prisma/seed.ts prisma/seed-platform.ts prisma/seed-learning.ts \
         prisma/seed-teacher-academics.ts prisma/seed-roster-150.ts \
         prisma/seed-student-dashboard.ts prisma/seed-teacher-hub.ts \
         prisma/seed-tenant-isolation.ts prisma/seed-website-cms.ts \
         prisma/seed-salary.ts prisma/backfill-subscriptions.ts prisma/seed-platform.ts; do
  bun "$s" || exit 1
done
# 5) Dev server:
bun /home/z/my-project/spawn-detached.mjs --cwd /home/z/feature-worktree bun run dev
curl -sf http://localhost:3000/health/ready
```

## 7. Remaining limitations (honest)

- Container **reboot** still re-clobbers `.env` (platform `/start.sh`, outside repo scope) and wipes `db/pg` — the runbook above recovers both in minutes; cluster data is dev-only (corpus re-seeds deterministically).
- The sandbox env injection (RC3) requires sourcing the helper in every shell — scripted, not fixable at platform level from inside the repo.
- Typecheck memory ceiling (see §4) — noted, scripted.
- Production was **not touched**: zero remote mutations except the feature-branch push carrying this report; no main push, no merge, no deploy, no production DB/migration/data operations.

## 8. Artifacts

- Local (non-git, session-scoped): `/home/z/recovery/` — bundle, stash patches, evidence snapshots, env backup.
- Committed (durable): this report, `scripts/dev-env.sh`, hardened `mini-services/postgres-db/index.ts`.
- Tripwire still active: post-checkout audit hook writes to `/tmp/git-checkout-audit.log` (any external `git switch` will be recorded with full ancestry).
