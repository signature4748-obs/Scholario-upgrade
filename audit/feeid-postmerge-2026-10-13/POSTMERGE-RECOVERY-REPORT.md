# Scholario — PR #28 MERGE & PRODUCTION RECOVERY PREPARATION REPORT

**Prepared:** 2026-10-13T04:41–05:15Z (all observations timestamped)
**Status: PR #28 MERGED (authorized) · PLANES AUTO-DEPLOYED & HEALTHY · RECOVERY PATH VERIFIED (pg_dump + restore proof) · MIGRATION STILL PENDING, NOT APPLIED.**

---

## 1. Phase 1 — Final PR validation — VERIFIED (04:41–04:44Z)

PR #28 was unchanged since the final release-gate audit: open, head `3ac77bf8953bdc28426fbf72f61391490f814a5b` (3 commits / 16 files, updated_at 2026-10-13T04:07:08Z — no new commits/comments/reviews), `mergeable_state: clean`, CI on head all-green (run 38344725977). Diff scope re-verified: **zero `src/` and zero `prisma/` changes** — limited exactly to verification hardening, regression tests, documentation, and CI de-flaking. → **Safe to merge.**

## 2. Phase 2 — Merge result & deployments — VERIFIED

- **Merged via the normal GitHub merge mechanism** (merge commit, no force, no rewrite): **resulting commit `27183a991926db07729784b16f4752821a029ae6`** ("Merge pull request #28 from signature4748-obs/fix/feeid-verify-gates", parents `cb9a0d4` + `3ac77bf`), 2026-10-13T04:44:06Z (+05:30 10:14).
- Merge diff = exactly the audited 16-file diff (+1291/−24). **Migration SQL at the merge commit: sha256 `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db` — byte-identical.**
- **CI on main @ 27183a9: run 38347880439 completed / SUCCESS** (04:44:09Z → 04:57:12Z, ~13m; every step green incl. full test matrix — liveFetch de-flake held; verified stable over 4 consecutive polls).
- **Automatic deployments (verified, no manual action taken):**
  - App plane: `dpl_GNAmJGgqtRCBmuSeSnJG2VfFyQFT` → **READY** 04:46:44Z → serves `scholario-app-virid.vercel.app`
  - Platform plane: `dpl_4ignALLpFtRfZcRuJHSdoUtbku61` → **READY** 04:49:09Z → serves `scholario-platform.vercel.app`
  - Health: both `/health/ready` → **200 `database:ok`** (04:50:51/53Z, re-probed 05:03:37/39Z and 05:14Z — continuously healthy).
- No Vercel settings touched, no manual redeploy. No remediation needed.

## 3. Phase 3 — Production recovery preparation — VERIFIED (pg_dump path) / BLOCKED (platform path)

### 3a. Platform backup with the current plan — NOT AVAILABLE (Free tier)

Fresh read-only probes (04:36Z and this session): `walg_enabled=true`, `pitr_enabled=false`, `backups: []`, `physical_backup_data: {}`; infra nano/2 GB (Free-tier). **The current plan provides no platform restorable backups and no "create backup now" capability.** The only platform route is an owner dashboard upgrade: Settings → Billing → upgrade to **Pro** (daily automated backups with restore UI; optional PITR add-on). NOT changed by this task (owner decision; costs money).

### 3b. pg_dump path — VERIFIED END-TO-END in the sanctioned environment

| Step | Evidence (all executed, read-only against production) |
|---|---|
| Connection | Supavisor **session pooler** `aws-0-ap-south-1.pooler.supabase.com:5432`, user `postgres.kbyknezedewvgrnqervj`, db `postgres`, SSL — authenticates with the owner-held DB password (never printed; stored in a 600-mode env file outside the repo). Direct `db.<ref>.supabase.co:5432` is **IPv6-only — unreachable from this sandbox** (IPv4 pooler is the sanctioned client path). Connected as `postgres`, PG **17.11**, not in recovery. |
| Tools | No system pg_dump and no sudo → provisioned **without root** via `apt-get download` + `dpkg -x` (Debian trixie `postgresql-client-17.11` + `libpq5 17.11` — **exact server-version match**; extracted under `/home/z/prod-recovery-prep/pgclient/`, all libs resolved). |
| Dump | `pg_dump -Fc` via the pooler: **exit 0, 67s, 1,156,906 bytes**, `dumps/prod-full-20261013T050827Z.dump` (sha256 `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5`, mode 600, **outside the repo, never in git**). |
| Archive integrity | `pg_restore --list`: **1827 TOC entries** (162 TABLE DATA), custom format, "Dumped from database version 17.11 / by pg_dump 17.11" — listing completes cleanly. |
| Restoration | Restored into the disposable embedded PG 18.4 cluster (127.0.0.1:55432, fresh `restorecheck` db): **only 3 errors, all extension DDL** (pg_trgm/pg_stat_statements/uuid-ossp/supabase_vault unavailable in the bare embedded PG — they exist on any standard PG and on Supabase itself; data unaffected). |
| Data fidelity | **Financial digest on the restored copy = `a87ebe601cdf03d3929ddefe33353ffb` — IDENTICAL to live** (re-queried live: 226 rows · 226 feeId pointers · sum `602480.00` · same md5). 117/117 tables restored; per-table counts identical except `RateLimitBucket` 93→94, which is organic growth (live NOW = 94 = restored value; snapshot predates the dump by 36 min). 23 migration-history rows; guards restored `tgenabled='O'` bound to `tg_guard_FT_ins_fn`; 3 dangling feeId rows preserved (pre-apply state). |

**Owner procedure (verified commands — run from any machine with pg_dump 17+; passwords via env, never printed/committed):**
```bash
export PGPASSWORD='<owner-held DB password>' PGSSLMODE=require
pg_dump -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres \
  -Fc -f scholario-prod-$(date -u +%Y%m%dT%H%M%SZ).dump          # ~1.1 MB, ~1 min
sha256sum scholario-prod-*.dump                                    # record the checksum
pg_restore --list scholario-prod-*.dump | head                     # 1827+ TOC entries = archive readable
# Restore drill (into a fresh PG ≥17, e.g. a new Supabase project or local PG):
pg_restore -h <target> -U <user> -d <freshdb> --no-owner --no-privileges scholario-prod-*.dump
```
The sandbox copy at `/home/z/prod-recovery-prep/dumps/` is verification evidence; the durable pre-apply backup should be owner-held (take a fresh dump at apply time — never rely on a stale one).

### 3c. Residual risks / limitations (stated honestly)

- The dump is a **logical, point-in-time** backup: consistent snapshot at dump start, no PITR. Anything written after the dump is not covered.
- Full-object restore requires a target with the project's extensions (pg_trgm, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault — a **fresh Supabase project has all of these**; vanilla PG needs contrib packages and will skip vault objects).
- The platform-level gap (no automated backups, no PITR) remains until the owner upgrades the plan — that is a **billing decision, deliberately not made here**.

## 4. Phase 4 — Post-merge migration readiness — VERIFIED (05:12–05:15Z, from the merge commit `27183a9`)

- **Fresh preflight (checkout `27183a99…`)**: GREEN — 24 repo / **23 applied / 1 pending**, exact expected set; ledger 226 rows / sum `602480.00` / **digest `a87ebe601cdf…` unchanged**; snapshot `audit/feeid-postmerge-2026-10-13/preflight-snapshot-20261013T051232Z.json` (unique path; no evidence reused or overwritten).
- **Sanctioned dry-run**: GREEN, exit 0 — sha256 `ec171c91…`, 63 statements, 1 transaction incl. history row, **no writes**.
- **Fail-closed verify demo (post-merge code, exit 1 as designed)**: exactly the 4 expected pre-apply problems (pending · 23≠24 · feeId FK missing · 3 dangling); tenant guards enabled ✓; digest unchanged ✓.
- **Planes**: both 200 `database:ok` (05:14Z).
- The merge/deployments changed nothing in the migration's expected state — production DB untouched by deploys (schema-compatible, as designed).

## 5. Production-safety statement

**No migration applied. No live-write workflow dispatched. No production database writes.** The only production mutations in this task were the authorized **PR #28 merge** (GitHub) and the **resulting Vercel auto-deployments** — both verified green. All database interactions were read-only (Management API SELECTs, health probes, pg_dump/psql SELECTs). No billing/plan/backup settings changed; no new backup destinations created (the dump lives in the sandbox workspace outside git; the owner decides its durable home). Local state: `main` = `d959674` (audit evidence commits + merge of origin/main preserved; never force-pushed).

**Status summary: VERIFIED (PR #28 merge + CI + deployments + planes; recovery pg_dump path end-to-end; post-merge preflight/dry-run/verify) · BLOCKED (platform-level automated backup/PITR — Free-tier; owner billing decision) · OWNER ACTION REQUIRED (choose recovery posture; then a SEPARATE explicit authorization for the live apply, after which the runbook in RELEASE-GATE-REPORT §5 executes verbatim).**
