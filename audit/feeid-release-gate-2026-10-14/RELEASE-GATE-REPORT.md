# Scholario — FINAL RELEASE GATE & FEE-ID MIGRATION READINESS REPORT
### `20261013140000_fee_transaction_dangling_feeid_self_heal`

**Prepared:** 2026-10-13T04:32–04:40Z (all observations timestamped below)
**Status: RELEASE DECISION READY — NO PRODUCTION WRITE, NO DEPLOY, NO MERGE OCCURRED IN THIS TASK.**

---

## 1. PR #28 — VERIFIED (safe to merge; owner decision)

| Item | Value (fresh, API-verified 2026-10-13T04:28–04:31Z) |
|---|---|
| URL | https://github.com/signature4748-obs/Scholario-upgrade/pull/28 |
| Head | `3ac77bf8953bdc28426fbf72f61391490f814a5b` (branch `fix/feeid-verify-gates`, 3 commits: `5a62dad` code → `0c891e7` evidence → `3ac77bf` CI de-flake) |
| State | **OPEN, NOT merged**, `mergeable_state: clean` (base `main` @ `cb9a0d4`) |
| CI on head | **All green** — `Typecheck · Lint · Migrations · Build · Tests` = completed/**success** (run 38344725977, 04:04:54Z→04:19:17Z); Vercel Preview Comments = success; Supabase Preview = skipped |
| Reviews | 0 formal reviews (branch protection requires 0 approvals, no required status checks — merge gating is the owner's procedural decision) |
| Comments | 2 (Vercel bot preview notice + CI-flake explanation note); secret-scan clean |

**Complete diff reviewed** (16 files, +1291/−24): `lib.ts` (+62: `FinancialIntegrity` + `financialIntegrity(cutoff?)` + `dbNow()`), `preflight.ts` (+25: DB-clock cutoff + digest capture + privacy-safe log line), `verify.ts` (+70: stage-B tenant-guard trigger gate + stage E2 financial-ledger digest comparison), `docs/PRODUCTION_DB_MIGRATION.md` (stage table + digest paragraph), `tests/regression/prod-migration-fk-invariant.test.ts` (+616 lines, 10 contract areas incl. trigger fail-closed, digest privacy, cutoff scoping, `financialIntegrity`/`dbNow` mocked units), 3 test suites converted `fetch`→`liveFetch` (de-flake, assertions untouched), 8 audit evidence files. **`prisma/` diff: EMPTY.**

Findings (each verified by code review AND live read-only execution from a detached worktree at `3ac77bf`):
- **Trigger gate fails closed**: missing / `tgenabled ≠ 'O'` / re-bound function each push a problem; scoped to `"FeeTransaction"`, excludes internal triggers; both guards verified live **enabled and bound to `tg_guard_FT_ins_fn`** pre-apply (demo log: `tenant guards ins+upd enabled ✓`).
- **Digest detects financial-value changes without exposing data**: md5 over `receiptNo|studentId|amount` ordered by id + row count + decimal sum; feeId deliberately excluded (sanctioned heal column); row VALUES never selected/printed/stored (privacy-contract regression-tested; live log prints only counts + 12-char digest prefix).
- **Cutoff semantics correct**: cutoff = `clock_timestamp()` from the DB server that stamps `createdAt`; verify recomputes the SAME `WHERE "createdAt" <= cutoff` window — organic post-snapshot inserts excluded from both sides (no false positives); a hypothetical in-flight transaction committed late fails CLOSED (safe direction).
- **Pre-apply verify fails for exactly the expected 4 reasons** (fresh demo 04:33Z, exit code 1): ① migration still pending ② applied (23) ≠ repository (24) ③ `FeeTransaction_feeId_fkey` constraint missing ④ dangling feeId references remain: 3 rows. New gates (trigger state, digest) report GREEN pre-apply.
- **Post-apply verify checks the intended final state**: A 24/24 + 0 pending + checksums true; B both FKs present with SET NULL/CASCADE, dangling = 0, guards enabled; E2 digest/rows/sum unchanged; F both planes healthy.
- **Migration SQL byte-for-byte unchanged from PR #27** — SHA-256 recomputed from the actual file in 4 refs (worktree, `b50e34f` PR#27 head, `cb9a0d4` merge/origin-main, `3ac77bf` PR#28 head): all `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db`, 3988 bytes, `cmp` = IDENTICAL.
- **Fail-loud confirmed**: `exitWithProblems` → `process.exit(1)` (verified true exit code 1; earlier "EXIT: 0" artifacts were `tee` pipe artifacts, re-tested without pipe).
- **No secrets** in PR diff, comments, or new artifacts (one false positive: migration name `…restore_trgm_search_indexes` matched the `re_` pattern — not a credential).

**Merge safety**: merging auto-deploys both planes (Vercel auto-deploy on main); the diff is scripts/tests/docs only — **schema-compatible, zero runtime/`src/` changes** → deploy-safe. Owner decision per §6. Branch protection: linear history required, no force-push, 0 required approvals.

## 2. Fresh production read-only state — VERIFIED (2026-10-13T04:32:14Z–04:35:12Z)

Via the sanctioned Management API channel (read-only SELECT/catalog only) from worktree @ `3ac77bf`:

| Item | Value |
|---|---|
| Migrations | **23 applied / 24 in repo / 1 pending** — exactly `20261013140000_fee_transaction_dangling_feeid_self_heal`, sha256 `ec171c91ee4e2be1…` (preflight `--expect` exact match ✓; object expectations clean ✓) |
| Preflight | **GREEN** (`preflight-log-20261013T043214Z.txt`, snapshot `preflight-snapshot-20261013T043214Z.json`) |
| Financial ledger | 226 rows · feeId pointers 226 · amount sum `602480.00` · digest `a87ebe601cdf…` (cutoff 2026-10-13 04:32:20.729626+00) — **identical to the 03:11Z snapshot** → ledger unchanged since the last session |
| Dangling feeId | **3** (verify demo; receipts SCH-2026-000216…218, values never read) |
| FeeTransaction FKs | studentId FK present (SET NULL/CASCADE); **feeId FK absent** (correct pre-apply state) |
| Tenant guards | `tg_guard_FT_ins` + `tg_guard_FT_upd` present, `tgenabled='O'`, bound to `tg_guard_FT_ins_fn` |
| Dry-run | `apply.ts --dry-run --expect 20261013140000…` **GREEN, exit 0** — 63 statements, 1 transaction incl. history row, **no writes** (`apply-dryrun-20261013T043214Z.txt`) |
| Both planes | `scholario-platform.vercel.app` + `scholario-app-virid.vercel.app` `/health/ready` → **200 `database:ok`** (04:35:11/12Z); production deployments on both = `dpl_Ar7hrG68` / `dpl_EucTeMM` READY @ `cb9a0d485507` |
| Target identity | Supabase project `kbyknezedewvgrnqervj` ("scholario-production", ap-south-1, PG 17.11, ACTIVE_HEALTHY, org's ONLY project) — the DB, not a Vercel project; canonical Vercel projects: `scholario-platform` (`prj_gIO4Dm…`) + `scholario-app` (`prj_oiKZt…`) |

## 3. Recovery gap — BLOCKED / OWNER ACTION REQUIRED (platform-level)

Fresh read-only platform API probe (2026-10-13T04:36Z):
`GET /v1/projects/{ref}/database/backups` → `walg_enabled: true`, **`pitr_enabled: false`, `backups: []`, `physical_backup_data: {}`**.

- `walg_enabled=true` is infrastructure plumbing, NOT a restorable backup. **Zero listable/verifiable restorable backups exist.** PITR is disabled. The logical preflight snapshots (counts/checksums/digests) are evidence, not backups.
- Infra: nano compute / 2 GB gp3 disk — Free-tier shape; daily restorable backups + PITR are paid (Pro) features.
- **Nothing was changed** (no billing/plan/backup settings touched — that requires owner authorization).

**Owner options (dashboard actions):**
1. **Provision recovery first** (safest): upgrade the project to Supabase Pro (dashboard → Settings → Billing) → daily backups become available and restorable; optionally add the PITR add-on for point-in-time recovery; then verify `backups: []` becomes non-empty and a restore test (or at minimum a listed backup with a restore window) succeeds before authorizing the apply. Cost: Pro ~$25/mo + PITR add-on.
2. **Manual pre-apply dump** (middle ground, no plan change): owner-held `pg_dump` of at least the `"FeeTransaction"`, `"Fee"`, `"Student"` and `_prisma_migrations` tables (or full DB) immediately before the apply — restorable into a fresh project; verifiable by dump file size/checksum; not a platform backup but a genuine recovery artifact for this one migration.
3. **Proceed without** (accepted-risk): the migration is one atomic transaction (rollback on any failure leaves zero partial state); disposable-PG evidence 12/12; ledger preservation is digest-enforced. Residual risk: a post-commit logic error (not a crash) would need manual surgery with no time machine. The heal itself is practically irreversible (the 3 dead pointers reference cascade-deleted Fee rows), but reversal has no value — the referenced rows are gone.

## 4. Sanctioned apply procedure — VERIFIED (code + live dry-run + API-verified workflow state)

- `preflight.ts` read-only (SELECT/catalog only; snapshot to file; `--expect` exact-set gate; object-existence drift gate). **Live GREEN this session.**
- `apply.ts`: re-validates all gates standalone; `--expect` exact pending-set match; one `BEGIN; <migration.sql>; INSERT INTO _prisma_migrations(…true sha256…); COMMIT;` per migration; failure ⇒ rollback + `exit(1)` + halt, never marked successful; post-apply row+object verification; idempotent re-runs; seeds NEVER (no seed code path exists); no reset/resolve/manual marking anywhere; the one documented checksum repair (`20261004090000`) is guarded and currently a no-op (history is pristine). **Live DRY-RUN GREEN this session.**
- `verify.ts` read-only; stages A–G + trigger gate + E2 digest (see §1). Fails closed (`exit 1`).
- Workflow `.github/workflows/production-db-migration.yml` — **live + ACTIVE on GitHub** (id 381524131; "parked" comments in docs are stale history): `workflow_dispatch` only; inputs `expected_pending` (string) + `dry_run` (boolean); jobs declare `environment: production` (env secrets verified present: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`); `concurrency: group=production-db-migration, cancel-in-progress=false` (serialized); `permissions: contents: read`; per-job 20-min timeouts; snapshot artifact 30-day retention; apply job skipped when `dry_run=true`. File identical between `cb9a0d4` and `3ac77bf`.
- Environment "Production" exists with the required secrets; **protection_rules: none** (no required reviewers) — optional hardening: add required reviewers before the authorized run (owner choice; not changed by this task).

## 5. Operator runbook for the authorized run (PREPARED — NOT EXECUTED)

**Step 0 — Owner merges PR #28** (GitHub web UI; merging auto-deploys both planes — schema-compatible, scripts/tests/docs only). Note the new merge SHA. *(Optional but recommended: run the apply from the post-merge SHA so the hardened gates do the verification; applying from `cb9a0d4` also works — core post-apply checks exist on main.)*

**Step 1 — fresh preflight snapshot** (read-only):
```bash
SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj \
  bun scripts/prod-migration/preflight.ts \
    --out /tmp/prod-migration-snapshot.json \
    --expect 20261013140000_fee_transaction_dangling_feeid_self_heal
```
Must print `✓ PRE-FLIGHT GREEN` with exactly 1 pending (`20261013140000…`, sha256 `ec171c91…`) and the financial-ledger line (226 rows / sum 602480.00). Uniquely timestamp the file (`…$(date -u +%Y%m%dT%H%M%SZ).json`); never reuse a stale snapshot.

**Step 2 — recovery decision** (§3): provision/verify a restorable backup or accept the documented residual risk, then give the **separate explicit live-apply authorization**.

**Step 3 — dry-run** (read-only): `bun scripts/prod-migration/apply.ts --dry-run --expect 20261013140000_fee_transaction_dangling_feeid_self_heal` → `✓ DRY RUN GREEN — plan verified, no writes performed`.

**Step 4 — THE APPLY.** Path A (recommended): GitHub → Actions → **Production DB Migration** → *Run workflow* → ref = release commit (PR #28 merge SHA, else `main`@`cb9a0d4`) → `expected_pending` = `20261013140000_fee_transaction_dangling_feeid_self_heal` → `dry_run` unchecked → wait for preflight→apply→verify all green (snapshot uploaded as 30-day artifact). Path B (operator): same four scripts as §8 of `APPLY-READINESS-REPORT.md`, `apply.ts --expect …` (no `--dry-run`), then `verify.ts --snapshot /tmp/prod-migration-snapshot.json`.

**Step 5 — independent post-apply confirmation** (read-only): `verify.ts` green (A 24/24, 0 pending; B feeId FK present SET NULL/CASCADE, dangling = 0, guards enabled; E `_prisma_migrations` grew by exactly 1; E2 digest `a87ebe601cdf…` unchanged, feeId pointers 226 → **223**; F both planes 200 `database:ok`); optionally eyeball `pg_get_constraintdef('FeeTransaction_feeId_fkey'::regclass)` + `tgenabled` for both guards + dangling count = 0.

**Interrupted/ambiguous outcome**: follow §9 recovery procedure of `APPLY-READINESS-REPORT.md` (atomic transaction ⇒ row present = committed, row absent = rolled back; never blind re-run, never `migrate resolve`, never manual history INSERT).

## 6. Production-safety confirmation

**No production writes, no workflow dispatch, no merge, no deploy, no settings/billing/DNS/secret changes occurred in this task.** All production interactions were read-only (SELECT/catalog via Management API; public HTTP health probes). The only local effects: fresh evidence artifacts in `audit/feeid-release-gate-2026-10-14/` (this report + preflight log/snapshot + fail-closed verify demo + dry-run log) and a detached git worktree (created and removed; local `main` @ `f8be545`, 5 audit commits ahead of origin, untouched; stashes and residue preserved).

**Status summary: VERIFIED (PR #28 state/CI/diff; migration identity byte-for-byte; fresh production baseline; apply procedure) · FIXED (n/a — no new defects found; prior session's verify-gaps remain fixed in PR #28, CI green) · BLOCKED (restorable backup/PITR — platform-level, Free-tier posture) · OWNER ACTION REQUIRED (① merge PR #28 decision ② recovery provisioning decision ③ separate explicit live-apply authorization).**
