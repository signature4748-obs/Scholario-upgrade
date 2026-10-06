# Backup & Recovery — Scholario-OS (Phase 8A, mission §30)

> Status (2026-10-06): the authoritative recovery RUNBOOK is now
> `docs/DISASTER_RECOVERY.md` (RPO/RTO, failure scenarios, procedures,
> drills). This document stays as the tool-level reference and historical
> evidence for the JSONL backup/restore path.

Owner: SRE (Task 8A-OPS). Status: **backup + TESTED restore delivered and run against the live integration DB** (Supabase PG 17.11, Supavisor session pooler). `package.json` is frozen for another wave — the commands below are plain `bun` invocations, not npm scripts.

## What exists (and what does NOT)

| Layer | What | Status |
|---|---|---|
| App-level logical dump | `scripts/db-backup.ts` → `backups/scholario-<ts>.jsonl.gz` | ✅ delivered, run today |
| Tested restore | `scripts/db-restore-verify.ts` (scratch-schema restore test + `--into public` disaster mode) | ✅ delivered, 3 green runs today |
| Scheduled/automated backups | none (no cron, no CI job) | ❌ not in scope this wave |
| Supabase platform backups (daily snapshots) / PITR | plan-tier platform features | ⚠️ **not provisioned or verified by this repo — check the Supabase dashboard for the actual plan; nothing here guarantees them** |

This is a **logical, on-demand dump**, not a physical base backup. It is the honest floor: a verified restore path that anyone can run in minutes.

## Backup procedure

```bash
# from the repo root, dev server may keep running (backup is read-only):
unset DATABASE_URL && bun scripts/db-backup.ts
# → backups/scholario-<UTC timestamp>.jsonl.gz
```

- Connection: `pg` Client built from the `DATABASE_URL` **read out of the `.env` FILE at runtime** (a stale shell `DATABASE_URL` is ignored with a note; the password is never printed). The script refuses to run if `.env` declares `DATABASE_ENV=production`.
- Dumps **every public-schema BASE table** (97 app tables; `_prisma_migrations` is skipped — migration state is a repo artifact, not data).
- One JSON line per row: `{"table":"Student","row":{…}}`, gzip level 6 via `node:zlib`.
- Fidelity: date/timestamp columns are dumped as their **raw Postgres text** (`"col"::text`) — timezone-independent and byte-exact; `NUMERIC(12,2)` money stays a **string** (never through float); booleans stay booleans.
- Tables are written in **FK-parents-first order** so the file is directly loadable in stream order.
- ⚠️ Archives contain bcrypt password hashes and session-token hashes → `backups/` is **git-ignored** (added to `.gitignore`). Treat archives as secrets; copy them OFF this sandbox for safekeeping (that off-box copy is currently a manual step — see residuals).

### Measured run (2026-10-01 20:33 UTC, corpus: 2 schools / 154 students)

```
BACKUP COMPLETE  backups/scholario-20261001t203313.jsonl.gz
tables: 97   rows: 9171   raw: 3229.1 KiB   gzip: 324.3 KiB   duration: 28.56 s
```

~29 s wall for ~300 round trips over the Supavisor session pooler (~137 ms RTT from this sandbox; the backup itself uses exactly ONE pooled session).

## Tested restore (the evidence)

```bash
unset DATABASE_URL && bun scripts/db-restore-verify.ts            # newest backup
unset DATABASE_URL && bun scripts/db-restore-verify.ts <file.gz>  # explicit file
```

The test (non-production environment = a **throwaway schema inside the integration DB** — `public` is never touched):

1. `CREATE SCHEMA restore_verify_<ts>`; `SET search_path` to it.
2. Executes `prisma/migrations/0_init/migration.sql` — its DDL uses unqualified quoted names, so all 96 tables + indexes + FKs land in the **scratch** schema. The one later-migrated table, `RateLimitBucket`, gets its `CREATE TABLE` from `00000000000003_rate_limit_backend` (RLS statement skipped — data test, not policy test).
3. Loads **every row** from the JSONL via **batched parameterized multi-row INSERTs** (≤2000 params/statement), column lists built from the scratch schema's `information_schema`, values decoded per column type (boolean / numeric / date / timestamp string handling), tables ordered by the scratch schema's own FK graph (Kahn, parents first), all inside one transaction.
4. Verifies per-table **backup vs restored row counts**, the **3-way money parity** on the restored Fee/Payment/FeeTransaction (`Σ Payment(SUCCESS) == Σ FeeTransaction(SUCCESS) == Σ Fee.paid`, exact `NUMERIC ::text`), **and** cross-checks those sums against paise-exact BigInt sums computed independently from the backup file. Exit non-zero on ANY mismatch.
5. Always drops the scratch schema (self-heals orphans from crashed runs too).

### Verification output (3 consecutive green runs; 2026-10-01 20:37–20:41 UTC)

```
RESTORE VERIFY  backup=backups/scholario-20261001t203313.jsonl.gz
target schema: restore_verify_20261001t203742   (load: 100 batched inserts in 16.10 s)
TABLE                        BACKUP  RESTORED   MATCH          (97 rows — every one OK)
──────────────────────────────────────────────
Attendance                     4173      4173      OK
Fee                             155       155      OK
Payment                         124       124      OK
FeeTransaction                  126       126      OK
Student                         154       154      OK
User                            325       325      OK
Session                         170       170      OK
… (all 97 tables OK) …
TOTAL                          9171      9171      OK
MONEY PARITY (3-way, NUMERIC-exact):
  restored scratch : pay=2162650.00  txn=2162650.00  fee=2162650.00
  backup-file sums : pay=2162650.00  txn=2162650.00  fee=2162650.00
  live public (ref): pay=2162650.00  txn=2162650.00  fee=2162650.00
  3-way equal (restored): OK   restored==backup-file: OK
scratch schema dropped: OK   duration: 40.14 s
RESTORE VERIFY PASSED — every backed-up row round-tripped; parity exact; scratch schema dropped.
```

(Runs: 40.14 s / 44.09 s / 41.75 s total, ~16 s of that is the row load. Residue check: `pg_namespace LIKE 'restore_verify%'` → empty after every run.)

## Restore runbook (disaster path)

`db-restore-verify.ts --into public` is the **disaster-restore mode**: same loader, target schema `public`, DDL owned by migrations, and an **emptiness interlock** that refuses to load over live data (verified today — it refused on the non-empty integration DB with exit 1).

1. **Get the archive** off the box where it was taken (the latest is also on the sandbox under `backups/`).
2. **Provision a fresh Postgres/Supabase project**; put its URL in a NEW `.env` (`DATABASE_ENV=development` while restoring).
3. **Apply schema**: `bunx prisma migrate deploy` (versioned migrations only — never `db push`).
4. **Restore + verify in one step**:
   ```bash
   unset DATABASE_URL && bun scripts/db-restore-verify.ts <archive>.jsonl.gz --into public
   ```
   This loads every row into `public` inside one transaction, then re-runs the count + parity verification **against the restored public schema** and exits 0 only on a full match. (Refuses if any backed-up table is non-empty — restore into fresh databases only.)
5. **Post-restore**: restart the app against the new DB; spot-check a login, the students roster, and the fees dashboard (the parity number from step 4 should equal the dashboard's COLLECTED total, e.g. ₹21,62,650 today).
6. Sessions in the archive are time-limited and hashed — users simply re-login if any expired.

## RPO / RTO (honest statements)

- **RPO: unbounded by default.** The backup is operator-triggered; data written after the last `db-backup.ts` run is lost in a disaster. No schedule exists in this repo (no cron/CI; `package.json` frozen). Recommended cadence until automation exists: run after every seeded corpus change and at least daily in any environment that holds data you care about.
- **Supabase platform backups / PITR are plan-tier features** (daily snapshots, point-in-time recovery on paid tiers). **This repo does not provision, configure, or verify them — do not assume they exist; confirm on the Supabase dashboard for this project.** Supavisor/session-mode networking constraints from this sandbox (direct `:5432` refused) do not affect platform-side backups.
- **RTO: minutes, dominated by humans + provisioning, not data.** Measured data path today: full tested-restore cycle (DDL + load + verify + drop) **40–44 s** for 9,171 rows; the load phase alone was **16.1 s (~570 rows/s** over a ~137 ms-RTT pooler link, one session). A real disaster restore adds project provisioning (platform, minutes) and `prisma migrate deploy` (seconds). Load time grows ~linearly with rows: at the perf probe's synthetic 5,000-student scale the same batching inserted 150k attendance rows in well under a minute — expect minutes, not hours, at realistic school sizes (hundreds of students).
- Caveat: the *tested* path today restores into a scratch schema of the same integration DB and into `public` only via the interlocked mode (refusal path exercised; the load engine is identical). The `--into public` full happy path was **not** executed against a live empty database today — first real disaster drill should be a scheduled exercise.

## Residuals / next actions

- Automation: a cron/CI job for `bun scripts/db-backup.ts` + off-box upload (S3/Supabase Storage) once the package.json freeze lifts.
- Off-box archive copies are manual today (the archive lives on the sandbox disk only — same blast radius as the DB).
- Consider `pg_dump` as a belt-and-braces physical-logical complement before any production cutover (the JSONL path stays the app-verifiable one).

---

## VERIFIED RESTORE EXERCISE (Phase 8C-N, 2026-10-02 — production data)

A real logical backup of the production database was taken (44-table
census, 8,501 rows, 2.9 MB JSONL — never committed to the repository) and
restored into a fresh local PostgreSQL:

- **Schema reproducibility** — fresh database + `prisma migrate deploy`
  (8 migrations, including the function-security closure) succeeded clean;
  the drift gate command stays silent.
- **Row parity** — every table's restored row count matched the backup
  census exactly (`ROW PARITY: ALL TABLES MATCH`).
- **Financial parity** — `SUM(Fee.amount)` / `SUM(Payment.amount)` /
  `SUM(SalaryPayment.amount)` matched production to the cent
  (3,012,400 / 2,162,650 / 400,000).
- **Tenant parity** — exactly 2 schools, correct `isDemo` flags
  (Sunrise=true, Green Valley=false), both ACTIVE.
- **Guard integrity after restore** — a cross-tenant `Student` insert
  (school B student → school A class) was REJECTED by the `tenant-guard`
  trigger on the restored database; the same-tenant control insert was
  accepted. Restores do not weaken tenant isolation.
- **RTO (observed)** — migration + restore + verify cycle for the full
  production corpus completed in under two minutes at this data size.

RPO remains as documented below (operator-triggered backup); Supabase
plan-tier automatic backups are explicitly NOT assumed for this project.
