# Disposable-PostgreSQL evidence — `20261013140000_fee_transaction_dangling_feeid_self_heal`

**Verdict: 12/12 scenarios PASS (14/14 check groups — scenario 6 has sub-checks 6-R1/6-R2, scenario 10 has 10a/10b).**
Migration is apply-ready: self-heal is surgical (only invalid feeId pointers → NULL), fully transactional (rollback-safe), guard triggers are never left disabled, the added FK is future-proof, and the immutable financial ledger is preserved byte-for-byte.

- **Run (authoritative):** `disposable-pg-evidence-20261013T030001Z.txt` (started 2026-10-13T03:00:01Z, exit code 0, final line `SCENARIOS: 14/14 PASS`)
- **Local (disposable) PG:** PostgreSQL 18.4 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit — embedded-postgres 18.4.0-beta.17 (same version family as `mini-services/postgres-db`), cluster `127.0.0.1:55432`, dir `/home/z/probe/pgdata-feeid`, throwaway local password only
- **Production PG (step 0, read-only):** PostgreSQL 17.11 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit — captured via `SELECT version()` through the sanctioned Management API helper (`/home/z/probe/probe-version.ts`); the ONLY statement ever run against production in this task
- **Checksum verification:** local file sha256 `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db` == expected == `checksum` recorded by `prisma migrate deploy` in `_prisma_migrations` for the target → **match: true** (identical bytes executed, never retyped)
- **Method:** Phase A applied the 23 pre-existing repo migrations (target excluded) + synthetic fixtures (schools schA/schB, fees feeA/feeB/feeTemp/feeX/feeY, students stuA/stuB/stuX/stuY, 6 FeeTransaction rows incl. one dangling and one cross-tenant pointer planted exactly like production's legacy rows); Phase C executed the EXACT migration file bytes inside `BEGIN; … COMMIT;`. All ids/counts in the evidence log are local synthetic values; no production row values were read or printed.

## Scenario → verdict

| # | Scenario | Verdict |
|---|----------|---------|
| 6-R1 | BEGIN → disable `tg_guard_FT_upd` → heal UPDATE → forced `SELECT 1/0` (22012) → ROLLBACK: heal rolled back (txMissing still `feeTemp`, txCross still `feeB`), trigger re-enabled (`tgenabled='O'`), FK constraint absent | **PASS** |
| 6-R2 | Failure at ADD CONSTRAINT (42710 duplicate name): full migration in one txn → rolled back — cross-school feeId NOT healed, trigger enabled, pre-created constraint intact | **PASS** |
| 1 | `txValid.feeId` still `feeA` (valid same-school pointer untouched) | **PASS** |
| 2 | Dangling pointer detached: `txMissing.feeId` → NULL | **PASS** |
| 3 | Cross-school pointer detached: `txCross.feeId` → NULL | **PASS** |
| 4 | Ledger preservation: 6→6 rows; every amount/receiptNo/status/studentId/method identical to pre-state digests; feeId changed only on the two intentionally-invalid rows | **PASS** |
| 5 | Both guard triggers enabled after apply (`tg_guard_FT_ins`=`O`, `tg_guard_FT_upd`=`O`) | **PASS** |
| 7 | Future-proof: INSERT nonexistent feeId → guard **P0001 fires first** (BEFORE trigger runs before RI); with guard suspended the FK refuses **23503**; INSERT cross-school feeB → guard **P0001** (FK alone would allow it); no probe rows survived | **PASS** |
| 8 | `DELETE Fee feeA` succeeds → txValid preserved, feeId SET NULL, amount/receipt unchanged | **PASS** |
| 9 | Guard still enforces updates: feeId→feeB, feeId→fee-nonexistent, studentId→stuB all refused P0001; row unchanged | **PASS** |
| 10a | `DELETE Student stuX` refused P0001 (fee cascade → studentId SET NULL RI-update → guard feeId branch sees feeX gone); stuX/feeX/txX all intact — documented PRE-EXISTING fail-closed behavior | **PASS** |
| 10b | Detach txY.feeId (guard tolerates NULL) → `DELETE Student stuY` succeeds; txY preserved, studentId NULL, amount/receipt unchanged | **PASS** |
| 11 | Concurrency: uncommitted disable invisible to C2 (still `O`) and unwritable — C2 UPDATE/INSERT hit lock timeout (55P03) behind the migration's ShareRowExclusiveLock; readers unaffected (SELECT in 1ms); after C1 ROLLBACK the same UPDATE is refused P0001 by the re-armed guard; no residue | **PASS** |
| 12 | Prisma: `prisma validate` schema valid (env-override, see deviation 4); `migrate deploy` applied all 24 incl. target on fresh `feeid_prisma` DB, recorded checksum matches; `migrate status` → up to date, no pending; mandated `prod-migration-fk-invariant.test.ts` 33/33 PASS; `release-two-plane.test.ts` 38/38 PASS | **PASS** |

## Regression tests (honest, per file)

| suite | result | note |
|---|---|---|
| `prod-migration-fk-invariant.test.ts` (mandated) | **exit 0 — 33 pass / 0 fail** | file-based + mocked Management API |
| `release-two-plane.test.ts` | **exit 0 — 38 pass / 0 fail** | gated PASS |
| `timetable-conflict.test.ts` | exit 1 — 0 pass / 1 fail | module-load error: `Cannot find module '.prisma/client/default'` (Prisma client not generated in this checkout) — test never executed; not part of this evidence gate |
| `regression.test.ts` | exit 1 — 0 pass / 18 fail | every failure is `ConnectionRefused` — needs a live dev server on `http://localhost:3000` (confirmed unreachable via curl); not part of this evidence gate |
| `tests/regression/` (combined dir) | exit 1 — 71 pass / 19 fail | sums of the above (33+38 pass; 1+18 fail, causes as above) |

## Deviations & notes

1. **PG version delta:** disposable cluster is PG 18.4, production is PG 17.11 (per the read-only step-0 probe). The migration uses only version-stable semantics (transactional DDL, `ALTER TABLE … DISABLE/ENABLE TRIGGER`, `ADD CONSTRAINT`, BEFORE triggers, ShareRowExclusiveLock behavior) — identical on both majors; FK/trigger SQLSTATEs (23503, P0001, 42710, 22012, 55P03) are version-stable. Residual risk from the major-version gap is judged negligible but is declared here.
2. **Scenario 7 — which error fires:** with the guard live, a nonexistent-fee INSERT fails with the guard's P0001 (BEFORE trigger precedes the RI check); the FK's 23503 was demonstrated by suspending only the INSERT guard. Cross-school fee (exists in another school) is refused by the guard P0001 — the FK alone would allow it (tenant scoping is the trigger's job). Documented as required.
3. **Scenario 11 — stronger than spec:** the spec expected the concurrent cross-school UPDATE to fail P0001, but on PG any writer first blocks on the uncommitted `ALTER TABLE`'s ShareRowExclusiveLock → observed 55P03 (lock timeout). That is a strictly stronger guarantee (the uncommitted disable window is unwritable — no statement executes at all), and guard re-arm was separately proven (same UPDATE → P0001 after rollback). Both the INSERT serialization and reader-unaffectedness were exactly as specified.
4. **`bunx prisma validate` (12a):** the bare command in the repo root fails P1012 ("URL must start with postgresql://") because the repo `.env` carries a `file:` placeholder for `DATABASE_URL` — an environment artifact of this checkout, NOT a schema defect; `.env` is untouchable per task rules. With a runtime env-var override (real env beats `.env`; nothing written) the schema validates: "The schema at prisma/schema.prisma is valid 🚀" (exit 0). Both runs are recorded in the evidence log.
5. **Run history:** the interrupted predecessor run (log `…-20261013T024043Z.txt`, 13/14 — its only FAIL was the bare `prisma validate`, root-caused as deviation 4) is retained for audit history. A first re-run attempt (`…-20261013T024843Z.txt`) crashed on a stale session blocking `DROP DATABASE` (55006) left by the interrupted run; the script was hardened to evict stray backends on the disposable cluster and to exit explicitly (open pg sockets kept the process alive); the 03:00:01Z run is the authoritative evidence.
6. **Cluster state:** the disposable cluster was left RUNNING on `127.0.0.1:55432` (supervised by `bun start-cluster.ts`). Restart procedure if stopped: `cd /home/z/probe && bun run start-cluster.ts` (adopts the existing `pgdata-feeid` cluster if the port is already serving; the dev stack `db/pg` on 5432 was never touched).
7. **Security:** no writes were ever issued against production (only `SELECT version()` via the Management API helper); no credential values appear in any artifact; `.env`, `prisma/migrations/`, `db/pg`, git state all untouched; nothing committed or pushed.

## Artifacts

- Evidence (authoritative): `audit/feeid-apply-readiness-2026-10-13/disposable-pg-evidence-20261013T030001Z.txt`
- Evidence (interrupted predecessor, history): `audit/feeid-apply-readiness-2026-10-13/disposable-pg-evidence-20261013T024043Z.txt`
- Evidence (crashed first re-run attempt, 55006 stale session): `audit/feeid-apply-readiness-2026-10-13/disposable-pg-evidence-20261013T024843Z.txt`
- This summary: `audit/feeid-apply-readiness-2026-10-13/disposable-pg-evidence-summary.md`
- Scripts: `/home/z/probe/feeid-evidence.ts`, `/home/z/probe/probe-version.ts`, `/home/z/probe/start-cluster.ts` (probe-only scratch, outside the repo tree)
