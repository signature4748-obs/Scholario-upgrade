# Scholario — feeId Migration APPLY-READINESS REPORT
### `20261013140000_fee_transaction_dangling_feeid_self_heal`

**Prepared:** 2026-10-13 (UTC) · **Prepared by:** release-engineering session (evidence-gathering batch)
**Status: APPLY-READY — PENDING EXPLICIT OWNER AUTHORIZATION. NO PRODUCTION APPLY OCCURRED.**

---

## 1. Exact migration, merged SHA, verified checksum — **VERIFIED**

| Item | Value |
|---|---|
| Migration path | `prisma/migrations/20261013140000_fee_transaction_dangling_feeid_self_heal/migration.sql` |
| Merged commit | `cb9a0d485507f9c62d199901feefa1e83b1e3c7d` (PR #27, merged 2026-10-13T01:07:56Z, CI green on head `b50e34f` and on the merge push) |
| SHA-256 checksum | `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db` |

Checksum verified three independent ways:
1. `sha256sum` of the working-tree file — identical to the file at `cb9a0d4` (byte-identical diff, empty).
2. Prisma-compatibility proof: a fresh disposable database migrated by **`prisma migrate deploy` itself** recorded the SAME checksum in `_prisma_migrations` (disposable-PG scenario 12b).
3. The pending preflight (`--expect`) gate reads this exact checksum from the repo chain.

The migration's mechanics (audited statement-by-statement, not by comments):
`ALTER TABLE "FeeTransaction" DISABLE TRIGGER "tg_guard_FT_upd"` → one school-scoped self-heal `UPDATE … SET "feeId" = NULL WHERE "feeId" IS NOT NULL AND NOT EXISTS (same-school Fee)` → `ENABLE TRIGGER "tg_guard_FT_upd"` → `ADD CONSTRAINT "FeeTransaction_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "Fee"("id") ON DELETE SET NULL ON UPDATE CASCADE`.

Audit conclusions:
- Repairs **only** invalid feeId references (valid same-school pointers untouched — proven in scenario 1); the predicate detects **missing** and **cross-school** references identically to the tenant guard's feeId branch (scenario 3).
- **Financial immutability**: no DELETE, no receipt/amount/studentId rewrite — byte-level preservation proven by digest comparison (scenario 4) and enforced going forward by verify stage E2.
- Guard suspension is scoped to exactly the one UPDATE statement inside the single transaction; transactional DDL rolls the trigger state back on any failure (scenarios 6-R1/6-R2).
- FK actions match the studentId-FK contract (`ON DELETE SET NULL ON UPDATE CASCADE`); Prisma schema represents the optional relation (`fee Fee? @relation(… onDelete: SetNull)` + `Fee.feeTransactions FeeTransaction[]` + existing `@@index([feeId])`).
- Registered in the object-expectation gate: `MIGRATION_EXPECTATIONS['20261013140000…'].constraints = ['FeeTransaction_feeId_fkey']` (drift while pending / silent non-apply while applied both fail closed — regression-tested).
- Tenant guards remain effective after the migration (scenarios 9, 11); the documented **pre-existing** fail-closed hard-delete interaction (Student hard-delete with live fee pointers → guard P0001) is unchanged and BY DESIGN (scenario 10a).
- Locking: the ALTERs hold `ShareRowExclusiveLock` for the milliseconds the migration runs — concurrent writers **serialize** (proven: lock-timeout under 2s `lock_timeout`), readers unaffected; the uncommitted trigger-disable is **invisible** to concurrent sessions, so tenant validation cannot be bypassed mid-migration (scenario 11).

## 2. Actual production migration history and pending set — **VERIFIED**

Read-only probe (sanctioned Management API channel), 2026-10-13 ~02:15Z and re-confirmed by preflight at 03:11Z:

- **23 applied** migrations, every row `finished=true, rolled_back=false, steps=1` — the full list matches the repository chain exactly (0 unknown, 0 failed, 0 out-of-order, 0 unexpected checksum divergences; the one documented saas-hardening placeholder was already repaired by the earlier successful pipeline run).
- **Pending: exactly 1** — `20261013140000_fee_transaction_dangling_feeid_self_heal` (the repository's 24th migration). The `--expect` preflight gate matches it **exactly** (name + order).
- Target identity: project ref `kbyknezedewvgrnqervj` (Supabase, region ap-south-1, PostgreSQL 17.11) — confirmed by live queries returning exactly this schema/history; NOT a Vercel project (the two canonical Vercel projects are separate deploy surfaces).

## 3. Live before-state counts and FK/trigger state — **VERIFIED**

| Item | Value |
|---|---|
| `FeeTransaction` rows | **226** (same as the 2026-10-13T01:26Z closure snapshot — stable) |
| `feeId` non-null | 226 |
| **Dangling feeId (missing Fee)** | **3** (receipts SCH-2026-000216…218 per migration comment; ids never read) |
| Dangling feeId (cross-school) | 0 (predicate covers it regardless) |
| Dangling studentId | 0 (20261013120000 already healed + FK live) |
| Existing FKs on FeeTransaction | schoolId (CASCADE), settlementId (SET NULL), structureId (SET NULL), **studentId (SET NULL + ON UPDATE CASCADE)** — **no feeId FK yet** (correct pre-apply state; object-expectation gate verifies absence while pending) |
| Tenant-guard triggers | `tg_guard_FT_ins` **enabled** (`tgenabled='O'`), `tg_guard_FT_upd` **enabled** (`tgenabled='O'`), both bound to `tg_guard_FT_ins_fn` |
| `FeeTransaction_feeId_idx` | exists (fee_admissions_mvp era — no extra index needed) |
| Honest-signal invariant | 0 violations |
| Financial digest (new preflight) | rows 226 · amount sum `602480.00` · md5 `a87ebe601cdf03d3929ddefe33353ffb` · cutoff `2026-10-13 03:11:31.161121+00` |
| Both production planes | `https://scholario-platform.vercel.app/health/ready` and `https://scholario-app-virid.vercel.app/health/ready` → **HTTP 200, `database:ok`** (probed 2026-10-13; deployments at `cb9a0d4`: `dpl_Ar7hrG68` / `dpl_EucTeMM`, READY) |

Schema compatibility: the deployed application (`cb9a0d4`) runs correctly against the pre-migration schema — the feeId column exists with the same shape; the FK is an integrity addition only. **No redeploy is needed for or because of this migration.**

## 4. Recovery artifact locations and integrity — **VERIFIED**

| Artifact | Path | State |
|---|---|---|
| Original closure preflight snapshot | `audit/closure-2026-10-13/preflight-feeid-snapshot.json` | EXISTS (committed locally, `9f19b5d`); captured 2026-10-13T01:26:46Z @ `cb9a0d4`; 23 applied; FeeTransaction 226 — matches today's live state |
| Earlier failed-apply recovery evidence | `audit/hardening-2026-10-14/` (apply-failure output, pre-apply recovery snapshots) | EXISTS (committed locally, `55facb0`) |
| **New pre-apply snapshot (this task)** | `audit/feeid-apply-readiness-2026-10-13/preflight-snapshot-20261013T022056Z.json` (+ log) | preflight GREEN, old code, @ `e573d95` |
| **New pre-apply snapshot with financial digest** | `audit/feeid-apply-readiness-2026-10-13/preflight-snapshot-20261013T031124Z.json` (+ log) | preflight GREEN, hardened code (PR #28), digest `a87ebe601cdf…` |
| Fail-closed verify demo (pre-apply) | `audit/feeid-apply-readiness-2026-10-13/verify-failclosed-demo-20261013T031124Z.txt` | verify correctly RED pre-apply with exactly the 4 expected problems |
| Disposable-PG evidence | `audit/feeid-apply-readiness-2026-10-13/disposable-pg-evidence-20261013T030001Z.txt` + `-summary.md` | 12/12 scenarios PASS (see §5) |
| Session worklog | `worklog.md` (gitignored) | Task IDs 4, 6, 7-support appended |

All snapshots are **logical** evidence (counts, history, checksums, digests) — **NOT restorable database backups** (see §7).

**The apply-time preflight (workflow or operator) captures its OWN fresh snapshot before any write — never reuse a stale one; never overwrite the only copy.**

## 5. Disposable-PostgreSQL test results — **VERIFIED (12/12 PASS)**

Environment: embedded PostgreSQL **18.4** (disposable, local) vs production **17.11** — version delta declared; all exercised semantics (transactional DDL, trigger visibility, RI actions, locking) are version-stable across modern PostgreSQL.

Executed and observed (not inferred) — log: `disposable-pg-evidence-20261013T030001Z.txt`:
1. Valid same-school feeId unchanged ✓ 2. Dangling → NULL ✓ 3. Cross-school → NULL ✓ 4. Ledger values/receipts/studentIds byte-identical (digests) ✓ 5. Both triggers re-enabled (`tgenabled='O'`) ✓ 6. Forced failure (after heal AND at ADD CONSTRAINT) rolls back data AND trigger state ✓ 7. Future invalid feeId rejected (guard P0001 fires first; FK 23503 proven with guard suspended) ✓ 8. Fee deletion preserves the transaction, SET NULL ✓ 9. Tenant guards still reject cross-school references ✓ 10a. Hard-delete with live feeId refused (P0001, pre-existing fail-closed) / 10b. clean after detach ✓ 11. Concurrent writers: uncommitted disable invisible + writers serialize (lock timeout) — no bypass ✓ 12. `prisma validate` ✓ (env-override; bare run fails only on the local `.env` file: placeholder — environment artifact), `prisma migrate deploy` all 24 ✓, recorded checksum == file sha256 ✓, `migrate status` clean ✓, regression suites `prod-migration-fk-invariant` **45/45** ✓ and `release-two-plane` **38/38** ✓.

(Non-gating environment notes: `timetable-conflict` 0/1 and `regression.test` 0/19 fail locally for missing generated Prisma client / no live dev server — not migration-related; CI runs both green with the client generated.)

## 6. Sanctioned apply-script and workflow audit — **VERIFIED**

`scripts/prod-migration/{lib,apply}.ts` + `.github/workflows/production-db-migration.yml` reviewed line-by-line:

- **Channel**: Supabase Management API query endpoint is the documented/approved channel (executes as schema-owning `postgres` role, BYPASSRLS; the pooler DB password is owner-held and never in repo/token/script).
- **Atomicity**: every migration runs as `BEGIN; <migration.sql>; INSERT INTO _prisma_migrations (…true checksum…); COMMIT;` — one transaction; SQL failure ⇒ rollback + non-zero exit + halt; a failed migration can never be recorded as successful.
- **True Prisma checksums**: sha256 of migration.sql, byte-identical to `prisma migrate deploy` (re-proven in scenario 12b); zero drift, idempotent re-runs.
- **No seeds, no reset, no force, no dashboard SQL, no manual marking** — enforced by code shape (no seed invocation anywhere in the pipeline; `migrate resolve`/`reset` never invoked) and by the history gate failing closed on drift.
- **Expected-pending gate**: `--expect` compares exact list AND order — a different pending set fails apply before any write (apply re-validates all preflight gates standalone).
- **Target**: `SUPABASE_PROJECT_REF` comes from the GitHub `production` environment secret; the workflow provides no override; preflight/apply print the resolved ref (`kbyknezedewvgrnqervj`) for the operator to eyeball.
- **Workflow state (API-verified, not inferred from YAML)**: "Production DB Migration" workflow is **active**; `workflow_dispatch` only; jobs declare `environment: production` (secrets proven working: 2 successful dispatch runs on 2026-10-12 @ `d81d548`); `concurrency: group=production-db-migration, cancel-in-progress=false` ⇒ **serialized** (two runs cannot overlap); `permissions: contents: read`; per-job timeouts; snapshot uploaded as a 30-day artifact.
- **Dry-run**: `apply.ts --dry-run` re-validates all gates and prints the transactional batches without executing them (code-verified); preflight is read-only by construction (SELECT/catalog queries only).
- CI workflow state: **active** (green on main @ `cb9a0d4`, run #51) and on PR #28 head (see §7).

## 7. Remaining blockers and owner actions — **OWNER ACTION REQUIRED**

| # | Item | Status |
|---|---|---|
| 1 | **Live apply of `20261013140000`** | **OWNER ACTION REQUIRED** — everything in this report is the evidence package; a merged PR / green CI / available token / green preflight is NOT authorization. Choose the workflow path (§8) or the operator path. |
| 2 | **Merge PR #28** (verify-gates hardening: tenant-guard trigger-state gate + privacy-safe financial-ledger digest) | **OWNER ACTION REQUIRED** — CI green (`5a62dad`, full matrix, ~14 min). Merging auto-deploys both planes (schema-compatible, no schema change — safe, but the deploy decision is the owner's per the stop-conditions of this batch). Recommended: merge BEFORE dispatching the apply so the apply is verified with the hardened gates. Applying from `cb9a0d4` without PR #28 also works — the four core post-apply checks (FK present/actions, dangling=0, guards, planes) are already in verify.ts on main. |
| 3 | **Backup / PITR posture** | **BLOCKED (platform-level)** — live read-only API check 2026-10-13: `walg_enabled=true`, `pitr_enabled=false`, **`backups: []` (zero listable restorable backups)**, no physical backup data. There is NO independently verified restorable backup or PITR capability. The logical snapshots in §4 are **not** restorable backups. If the owner wants a restorable safety net before the apply, provision/verify one in the Supabase dashboard (paid tier features — owner decision; nothing was changed by this task). |
| 4 | Vercel storage cleanup / Resend domain / credential rotation | Carried over from the prior batch (separate owner actions; out of scope here; no changes made). |

## 8. Exact commands after explicit owner authorization

**Path A — GitHub workflow (recommended; identical gates):**
Actions → **Production DB Migration** → *Run workflow* → branch `main` @ the release commit (after merging PR #28: the new merge SHA; else `cb9a0d4`) → input `expected_pending` =
```
20261013140000_fee_transaction_dangling_feeid_self_heal
```
Optionally run once with `dry_run=true` first (preflight-only, no writes). Then run for real (dry_run unchecked): preflight → apply → verify A–G, snapshot uploaded as a 30-day artifact.

**Path B — operator machine (same code, same gates):**
```bash
cd Scholario-upgrade && git checkout <release-commit>   # PR #28 merge SHA, or cb9a0d4
set -a; source <credentials-env>; set +a               # SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj
SNAP=audit/feeid-apply-readiness-$(date -u +%Y-%m-%d)/preflight-snapshot-$(date -u +%Y%m%dT%H%M%SZ).json

bun scripts/prod-migration/preflight.ts --out "$SNAP" \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal     # read-only; STOP if not GREEN

bun scripts/prod-migration/apply.ts --dry-run \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal     # optional: prints batches, no writes

bun scripts/prod-migration/apply.ts \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal     # THE apply (one transaction)

bun scripts/prod-migration/verify.ts --snapshot "$SNAP"                # must be GREEN
```
Never bypass a red stage. Never mark migrations manually. Never re-dispatch concurrently (the workflow serializes; operator discipline applies on Path B).

## 9. Post-apply verification checklist and recovery procedure

**Expected post-apply state (all asserted by `verify.ts`; with PR #28 additionally stages B-trigger and E2):**
- A: 24/24 applied, 0 pending, 0 drift. B: `FeeTransaction_studentId_fkey` and `FeeTransaction_feeId_fkey` present with `ON DELETE SET NULL / ON UPDATE CASCADE`; **dangling feeId = 0**; both tenant guards present, enabled, bound to `tg_guard_FT_ins_fn`.
- C: 24 trgm + 11 schoolId indexes. D: credential invariants 0 violations.
- E: no table shrank; `_prisma_migrations` grew by exactly 1 (24).
- E2 (PR #28): ledger rows within the cutoff window unchanged (226 expected absent organic growth); amount sum `602480.00` unchanged; md5 digest `a87ebe601cdf…` unchanged; feeId pointers 226 → 223 expected (3 healed).
- F: both planes `/health/ready` 200 `database:ok`. G: account-recovery objects intact.

**Recovery procedure (interrupted/ambiguous outcome):**
1. Preserve: the pre-apply snapshot (apply-time path), the workflow artifact, this report, and the closure/hardening snapshots — never overwrite the only copy.
2. Determine committed vs rolled back — the apply transaction is atomic WITH its history row:
   `SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE migration_name = '20261013140000_fee_transaction_dangling_feeid_self_heal';`
   row present + `finished_at NOT NULL` + checksum `ec171c91…` ⇒ **committed** (confirm objects: `pg_get_constraintdef` for `FeeTransaction_feeId_fkey`, `tgenabled='O'` for both guards, dangling count = 0). Row absent ⇒ **rolled back** (nothing landed: trigger re-enabled automatically, no FK, 3 rows still dangling).
3. An interrupted CONNECTION does not make this ambiguous — PostgreSQL resolves the open transaction server-side (commit or full rollback); the above queries read the resolved state.
4. **Never blindly re-run over an unknown state** — the history gate makes a re-run safe ONLY after the state is understood: committed ⇒ migration no longer pending (idempotent no-op); rolled back ⇒ clean re-apply is fine. Never `migrate resolve`, never manual INSERT into `_prisma_migrations`, never dashboard SQL.
5. Exceptional recovery actions (manual history edits, data surgery beyond the sanctioned heal) require the **owner's explicit authorization** after investigation by the release engineer with read-only queries; every such action must be documented in the worklog.

## 10. Production-write statement — **NO PRODUCTION WRITE OCCURRED**

Every production interaction in this task was a **read** (SELECT / catalog queries via the sanctioned Management API channel; public HTTP health probes). The migration was NOT applied; production remains at **23 applied / 1 pending**, with the 3 dangling feeId rows untouched, the feeId FK absent, and both tenant guards enabled. No credentials were rotated, no secrets changed, no DNS touched, no emails sent. The only repository-side effects: PR #28 opened (branch push — preview deployment only, production untouched) and local evidence commits. Production deployments observed (`cb9a0d4` on both planes) predate this task (PR #27 merge by the prior session).

**Status summary: VERIFIED (state, migration, evidence, mechanism) · FIXED (verify.ts gaps → PR #28, CI green) · BLOCKED (restorable-backup posture — platform-level) · OWNER ACTION REQUIRED (authorize the live apply; decide PR #28 merge). The apply is READY pending the owner's explicit authorization.**
