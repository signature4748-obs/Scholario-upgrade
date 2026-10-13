# Live Migration Runbook — `20261013140000_fee_transaction_dangling_feeid_self_heal`

> **Status: PREPARED — NOT EXECUTED.** The 2026-10-13 Option A preparation
> session verified the repository, the scripts, and the exact commands below,
> and executed **none of the database-touching steps**. Steps 6 and 7 below
> MUST NOT be performed until the owner issues a **separate, explicit
> authorization message** (Step 5). Nothing may be inferred from this
> document's existence — it grants no authorization.

---

## 0. Identity card (verified 2026-10-13 against the release commit)

| Item | Value |
|---|---|
| Repository | `signature4748-obs/Scholario-upgrade` |
| Release commit | `27183a991926db07729784b16f4752821a029ae6` (= `origin/main` head, verified read-only 2026-10-13T05:22Z) |
| Migration | `20261013140000_fee_transaction_dangling_feeid_self_heal` |
| Migration SQL SHA-256 | `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db` (3,988 bytes; verified byte-identical working-tree ↔ release commit) |
| Expected pending set | exactly this ONE migration (nothing before, nothing after) |
| Last verified production state (2026-10-13T05:12Z, read-only) | 23 applied / 24 in repo / **1 pending (this migration)** · ledger 226 rows · 226 feeId pointers · **3 dangling feeId rows (the heal target)** · amount sum `602480.00` · ledger digest `a87ebe601cdf03d3929ddefe33353ffb` · feeId FK absent (correct pre-apply) · studentId FK present · both tenant guards enabled · both planes 200 `database:ok` on the `27183a9` deployments |
| Scripts (byte-identical to release commit) | `scripts/prod-migration/{preflight,apply,verify}.ts` + `scripts/prod-migration/lib.ts` |
| Contract doc | `docs/PRODUCTION_DB_MIGRATION.md` |

**Note on "expected ledger values":** the row/sum/digest numbers above are
observations at the listed instant. Organic application growth since then is
normal and will legitimately change a FRESH preflight's numbers. The gates
that matter are: pending set = exactly this migration, target objects absent,
history clean. The fresh preflight snapshot becomes the baseline that
post-apply `verify.ts` must match **within the same cutoff window**.

## 1. Preconditions (owner/operator machine)

1. A checkout of the repo **at the release commit**:

   ```bash
   git fetch origin
   git checkout 27183a991926db07729784b16f4752821a029ae6   # detached is fine
   git rev-parse HEAD        # MUST print the SHA above
   # confirm the migration file checksum:
   sha256sum prisma/migrations/20261013140000_fee_transaction_dangling_feeid_self_heal/migration.sql
   # MUST print ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db
   ```

   (Working-tree `scripts/` and `docs/` were verified byte-identical to the
   release commit on 2026-10-13; if your checkout contains later commits,
   re-verify the migration checksum and re-read the scripts.)

2. `bun` runtime (the scripts import Node built-ins only — no `npm install`
   needed beyond the repo itself).

3. Pipeline credentials in a **600-mode env file**, loaded with `set -a`
   (never printed, never committed — `.env*` is git-ignored):

   ```bash
   # .env.prod-migration must define exactly:
   #   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF=kbyknezedewvgrnqervj
   set -a; . ./.env.prod-migration; set +a
   ```

   The pipeline runs through the Supabase **Management API** as the
   `postgres` role — it never needs the DB password
   (docs/PRODUCTION_DB_MIGRATION.md §2). The DB password is only used by the
   backup runbook (`docs/OWNER-BACKUP-RUNBOOK.md`).

4. **A fresh owner-held backup taken in this window** (Steps 1–8 of
   `docs/OWNER-BACKUP-RUNBOOK.md`), integrity-validated (`pg_restore --list`
   clean), secured (600, outside Git), retrievable by the owner.

5. Both application planes healthy:
   `https://scholario-platform.vercel.app/health/ready` and
   `https://scholario-app-virid.vercel.app/health/ready` → 200
   `"database":"ok"` (verify.ts re-checks this fail-closed anyway).

---

## The operator sequence

### Step 1 — Fresh read-only preflight with a unique timestamped snapshot

```bash
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "audit/feeid-apply-live-$TS"
set -a; . ./.env.prod-migration; set +a

bun scripts/prod-migration/preflight.ts \
  --out "audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json" \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal \
  2>&1 | tee "audit/feeid-apply-live-$TS/preflight-log-$TS.txt"
echo "preflight exit=${PIPESTATUS[0]}"     # MUST be 0
```

> ⚠️ `| tee` swallows the script's exit code — always check
> `${PIPESTATUS[0]}` (or re-run without the pipe) before trusting GREEN.
> Never reuse or overwrite a previous session's evidence paths — the
> `audit/feeid-apply-live-$TS/` directory is unique to this run.

GREEN means: history gate clean (no unknown/failed/gapped rows) · **pending
set is exactly the one migration** · its object (`FeeTransaction_feeId_fkey`)
does not already exist · snapshot written (table counts, user/admin state,
financial-ledger digest with DB-clock cutoff). The snapshot path is what
Step 7 consumes — record it.

### Step 2 — Exact pending-migration gate

Enforced **twice**: preflight's `--expect` (above) and again, independently,
inside `apply.ts --expect` before any transaction is built — a mismatch
aborts with a non-zero exit and lists expected vs actual. No further action
is needed for this step beyond the flags already shown; if either gate
fails, **STOP and investigate** (never force, never `migrate resolve`,
never edit `_prisma_migrations` by hand — docs/PRODUCTION_DB_MIGRATION.md
§6).

### Step 3 — Successful apply dry-run (builds the transaction, never executes)

```bash
bun scripts/prod-migration/apply.ts \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal \
  --dry-run \
  2>&1 | tee "audit/feeid-apply-live-$TS/apply-dryrun-$TS.txt"
echo "dry-run exit=${PIPESTATUS[0]}"       # MUST be 0
```

GREEN means: all preflight gates re-validated · the migration's SHA-256
printed (`ec171c91…`) · the batch plan printed — **63 statements, one
transaction including the `_prisma_migrations` history row** · and
`DRY RUN — transaction not executed` / `no writes performed`. In dry-run
mode the documented saas-hardening checksum repair would also only print
(`would rewrite…`), never execute.

### Step 4 — Owner checkpoint: fresh backup retained + risk understood

The owner explicitly confirms ALL of:

- the fresh dump (this window) exists, `sha256` recorded, mode 600, stored
  outside Git, and the owner can retrieve both file and checksum;
- `pg_restore --list` on the fresh dump exited 0 (archive integrity), and
  the owner knows an archive listing is **not** a restoration proof — and
  whether a §9 restoration drill was run for it or the residual gap is
  knowingly accepted;
- recovery posture understood: logical point-in-time backup only (no PITR,
  no platform automated backups on the current plan); recovery = fresh
  project/instance + logical restore + platform settings + repoint
  (docs/OWNER-BACKUP-RUNBOOK.md §9–§10);
- risk posture understood: the migration itself is 12/12 green on disposable
  PG replicas, applies as ONE atomic transaction (any failure rolls back
  completely and leaves no history row), and `verify.ts` fails closed on
  any financial-divergence or tenant-guard regression.

**STOP HERE.** Nothing below runs yet.

### Step 5 — Separate explicit owner authorization

A **later message from the owner** explicitly authorizing the live apply of
`20261013140000_fee_transaction_dangling_feeid_self_heal` against project
`kbyknezedewvgrnqervj`. This document, the Option A selection, and any prior
preparedness are **not** that authorization. Until this message exists,
Steps 6–7 are forbidden.

### Step 6 — The sanctioned production apply (only after Step 5)

```bash
bun scripts/prod-migration/apply.ts \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal \
  2>&1 | tee "audit/feeid-apply-live-$TS/apply-live-$TS.txt"
echo "apply exit=${PIPESTATUS[0]}"         # MUST be 0
```

Mechanics (audited in the release-gate sessions):

- ONE explicit transaction per migration via the Management API as the
  `postgres` role: `BEGIN;` migration SQL `; INSERT INTO _prisma_migrations
  (… true sha256 checksum …); COMMIT;` — a failure rolls the **whole**
  migration back (no partial schema state, **no history row**) and the
  process exits 1 immediately. A failed migration can never be recorded as
  applied.
- The migration suspends `tg_guard_FT_upd` only **inside its own
  transaction**, performs the school-scoped self-heal UPDATE (detaching the
  3 dangling feeId pointers), re-enables the trigger, then adds
  `FeeTransaction_feeId_fkey` (ON DELETE SET NULL / ON UPDATE CASCADE).
  Transactional DDL means a failed run leaves the trigger re-enabled.
- After success the script re-reads the history row and re-validates the
  migration's objects; then it also performs the documented, guarded,
  idempotent checksum repair of `20261004090000_saas_hardening_entitlement`
  (only if its divergence is still present and its 8 tables demonstrably
  exist).
- Seeds are never executed. No production data is touched beyond the
  migration's own statements.

**If the apply FAILS:** do **not** re-run blindly. The transaction rolled
back; production remains in the verified pre-apply state. Read the error
from the log, investigate per docs/PRODUCTION_DB_MIGRATION.md §6 ("a red
stage means red"), and only re-attempt with a understood cause and a fresh
preflight. If production is somehow left inconsistent, the recovery path is
the owner-held logical backup + owner decision (docs/OWNER-BACKUP-RUNBOOK.md
§9–§10) — never an unverified repair.

### Step 7 — Post-apply verification (read-only)

```bash
bun scripts/prod-migration/verify.ts \
  --snapshot "audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json" \
  2>&1 | tee "audit/feeid-apply-live-$TS/verify-$TS.txt"
echo "verify exit=${PIPESTATUS[0]}"        # MUST be 0
```

GREEN proves exactly the checklist the owner requires — each stage is
fail-closed:

| Requirement | verify.ts stage |
|---|---|
| Migration history complete: 24/24 applied, 0 pending, 0 failed, checksums = repo files | A |
| `FeeTransaction_feeId_fkey` exists with ON DELETE SET NULL / ON UPDATE CASCADE | B |
| **Zero** dangling feeId references remain (the guard's own predicate, held at 0) | B |
| **Both** tenant-guard triggers present, `tgenabled='O'`, bound to `tg_guard_FT_ins_fn` | B |
| Financial values and receipt numbers **unchanged**: rows / amount sum / privacy-safe digest identical to the preflight snapshot within the same cutoff window (row values never read) | E2 |
| Both application health endpoints — `scholario-platform` AND `scholario-app-virid` `/health/ready` 200 `database:ok` (one unhealthy plane = FAIL) | F |
| (Also, defensively) 24 trgm + 11 schoolId indexes · credential flags · no table shrank · `_prisma_migrations` grew by exactly 1 · account-recovery shapes intact | C, D, E, G |

**If verify FAILS after a successful apply:** production is in an
applied-but-unverified state — STOP, preserve all logs, do not attempt
repairs silently, escalate to the owner with the recovery options (logical
restore path). The migration is only "done" when verify exits 0.

---

## Appendix — what this runbook is not

- It is not authorization. Steps 6–7 stay forbidden until Step 5's explicit
  owner message exists.
- It does not use `prisma migrate deploy` (the owner-held DB password is
  never needed by the pipeline; the Management-API channel writes
  byte-identical history — zero drift — by design).
- It does not cover the GitHub Actions dispatch path
  (`Production DB Migration` workflow, inputs `expected_pending` +
  `dry_run`); if the owner prefers that channel, the same gates and the
  same `--expect` value apply — dispatch only after Step 5, and never with
  `dry_run=false` before that authorization.
- Nothing in it was executed against production by the preparation session
  (2026-10-13): the only database interactions in that session's lineage
  were historical, read-only probes; this session touched no database at
  all.
