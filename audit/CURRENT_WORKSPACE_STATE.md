# AUDIT 1/7 — CURRENT WORKSPACE STATE
Audit date: 2026-10-09 (12:24–12:45 UTC) · Audited by: read-only forensic session · Task: SCHOLARIO existing-workspace recovery audit

---

## 1. Workspace identity (verified)

| Item | Value | Evidence |
|---|---|---|
| Working directory | `/home/z/my-project` | `pwd` |
| Repository | Scholario (original, production-oriented) | `README.md`, git history |
| Current branch | `main` | `git branch --show-current` |
| HEAD | `baf93ac95e94bf826fcf600e9ae7bfc0da109e4f` "docs: correct email transport details; fix dev keepalive PG URL" (parent `37eb3fe`) | `git rev-parse HEAD` |
| Working tree | **CLEAN** — 0 tracked/untracked changes | `git status --short` |
| Remote | `github.com/signature4748-obs/Scholario-upgrade` (token embedded in remote URL — never printed; repo is **public**) | `git remote -v` (redacted by environment) |
| Remote refs (live, 2026-10-09 12:25) | `main = 3ae3c854b5…` · `development = 808bba9` · `sandbox/v2-rebuild = ac0f6fdf9c…` (NEW — pushed 2026-10-09 04:33 UTC) · `pull/1 = 808bba9` | `git ls-remote` + GitHub API |
| Package manager | bun (bun.lock, `bun run dev` scripts) | `package.json` |
| Architecture | Next.js 16 App Router, TypeScript, Tailwind 4, shadcn/ui, **PostgreSQL (Supabase prod / embedded PG 18.4 local)** + Prisma, custom scrypt auth, two-plane Vercel deployment (platform + school ERP), caddy gateway | `README.md`, `prisma/schema.prisma` (`provider = "postgresql"`) |
| Local branches | `main`, `development`, `pr3-recovery-baseline` (at `3ae3c85` — created in the prior recovery session, survived all resets) | `git branch -a` |
| Gateway / preview | caddy `:81` → default proxy `localhost:3000`; `?XTransformPort=` query can target other ports; branded restart screen on errors | project `Caddyfile` |

## 2. Workspace controller behavior (CONFIRMED — do not fight it)

This workspace is externally managed. Three reset events are directly evidenced:

| Event | Time (UTC) | Evidence |
|---|---|---|
| Container start + workspace restore | 2026-10-09 02:21 | process START times; `/home/z/my-project` mtime |
| External branch revert | 2026-10-09 02:41:48 | reflog: `checkout: moving from pr3-recovery-baseline to main` — 11 s after my verified switch (02:41:37), **not executed by any of my commands** |
| Container restart + workspace restore | 2026-10-09 10:32 | all process START times 10:32; `.env` mtime 10:32; `/home/z` mtime 10:32 |

What the 10:32 restore did (documented class — the repo's own `docs/FINAL_PRODUCT_EXCELLENCE_REPORT.md` §16 records the identical mechanism):
- **Wiped (git-ignored/untracked):** `db/` (embedded PG cluster `db/pg` **and** the demo corpus — gone), `.next/`, `dev.log`, `worklog.md` (prior session's evidence log), the original `.env`.
- **Recreated:** a **template `.env` containing ONLY `DATABASE_URL=file:/home/z/my-project/db/custom.db`** — a SQLite URL that (a) points to a nonexistent file and (b) is **rejected by the app's `postgresql` Prisma provider**.
- **Restored:** tracked files to `main @ baf93ac` content; **`.git` preserved** (refs, full 145-entry reflog, objects survive resets).
- `node_modules` survived (449 entries) but **prisma client was not generated** (regenerated during this audit: exit 0).

**Persistence verdict (Phase 1.6):** only git-committed state and git refs are durable. Uncommitted working-tree changes are subject to reversion; untracked/ignored files are wiped on resets. All future implementation must be committed at the earliest approval gate.

## 3. Running processes (12:24)

| Process | Owner | Port | State |
|---|---|---|---|
| caddy (gateway) | root | :81 | running (serves preview) |
| infra python `main.py` (`/app/.venv`) | root | — | running since 10:32 — suspected workspace controller (unverifiable as user `z`) |
| `bun --hot index.ts` (mini-services/**event-stream**) | z | :3003 | running but **PG connect failing every minute** (attempts 163+ in its service.log — DATABASE_URL is the broken SQLite template) |
| mini-services/**postgres-db** (embedded PG 18.4, cluster `db/pg`, :5432) | — | — | **NOT running, NOT auto-started by the container** (start.sh only launches event-stream) — and the cluster directory is wiped |
| Next.js dev server (this app) | z | :3000 | **started by this audit at 12:40** (normal dev operation; see Audit 4) |

## 4. Preview ownership (Phase 1.5 / Phase 4 identification)

- Nothing served :3000 between 10:32 and 12:40 → preview was **502** (caddy branded restart screen).
- The login screen the user observed (persona picker, "Welcome back.", no dashboard) is **NOT this application** — it is the **sandbox/v2-rebuild** (orphan SQLite branch pushed 04:33 today). Proof: `Welcome back.` exists only in that branch (`src/components/app/login-view.tsx:33`) with one-click demo persona doors (`arjun.malhotra@hhsp.edu.in` etc., SANDBOX.md); the original app has no persona picker and no such string.
- The rebuild was running on :3000 during 02:42–10:32 (interim session), then the 10:32 reset killed it and wiped its `db/custom.db`. Its own build worklog (tracked in the branch) documents a fully verified final state — the failure the user saw is consistent with the reset degrading a running app, not a defect in the original codebase.
- Since 12:40 the preview serves the **original application** in its current (DB-broken) state — see Audit 4 §3.

## 5. Sectors of uncommitted work

None. The tree is clean; no stashes; the only local-only commit delta vs. the production baseline is the `baf93ac` amend, which the evidence now shows is **accidental restore damage, not work** (see Audit 2 §3).

## 6. Secrets discipline

No secret values were printed during this audit. The remote URL token was used only in-transit for read-only GitHub API calls; DATABASE_URL was reported masked/host-shape only. The repo is public — any secret leak is immediately live (recurring documented constraint).
