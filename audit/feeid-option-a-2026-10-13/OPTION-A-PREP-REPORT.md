# Scholario — OPTION A: OWNER-HELD BACKUP PREPARATION REPORT

**Prepared:** 2026-10-13T05:22–05:40Z (all observations local, timestamped)
**Status: EXISTING BACKUP ARTIFACT VERIFIED · FRESH-BACKUP RUNBOOK PREPARED (NOT EXECUTED) · MIGRATION RUNBOOK PREPARED (STEPS 6–7 FORBIDDEN UNTIL SEPARATE AUTHORIZATION) · MIGRATION STILL PENDING, NOT APPLIED.**

Authorization boundary honored (owner's Option A selection grants **preparation
and local evidence verification only**): no production database writes, no
live migration apply, no workflow dispatch, no new production dump or data
export, no merges, deployments, billing or production configuration changes,
no credential or data-content exposure. **This session made zero connections
to the production database and zero connections to any production API** —
every verification below was local file inspection plus a read-only `git
fetch`. The choice of Option A is NOT treated as authorization for anything.

---

## 1. Existing backup artifact — **VERIFIED**

Located via `audit/feeid-postmerge-2026-10-13/POSTMERGE-RECOVERY-REPORT.md`
§3b (no path or filename was assumed); full evidence:
`audit/feeid-option-a-2026-10-13/backup-artifact-verification-20261013T052405Z.txt`.

| Property | Actual (measured from the file) |
|---|---|
| Absolute path | `/home/z/prod-recovery-prep/dumps/prod-full-20261013T050827Z.dump` |
| File size | **1,156,906 bytes** (matches prior report exactly) |
| Permissions / ownership | `-rw-------` (600), owner `z:z`; containing dir hardened this session 775 → **700** |
| **SHA-256 (computed)** | **`fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5`** |
| Prior report's checksum | same full value — **byte-for-byte IDENTICAL** (the `fbe7f495…` prefix in the task is consistent with, and not a substitute for, the full 64-hex digest) |
| `pg_restore --list` | **exit 0** — 1827 TOC entries (162 TABLE DATA), CUSTOM format, gzip, `Dumped from database version: 17.11`, `Dumped by pg_dump version: 17.11 (Debian 17.11-0+deb13u1)`, archive created 2026-10-13 05:08:27 UTC |
| Client/server compatibility | server 17.11 ↔ pg_dump/pg_restore 17.11 — **exact version match**; prior restoration proof on disk (embedded PG 18.4 drill): 117/117 tables, only 3 error lines, all `supabase_vault` (extension absent outside Supabase; data unaffected), financial digest identical to live (`a87ebe601cdf03d3929ddefe33353ffb`) |
| Git tracking | **Outside the repository entirely** — `git check-ignore` proves the path is outside the work tree; `/home/z/prod-recovery-prep` is not itself a git repo; repo `.gitignore` now also ignores `*.dump` / `*.dump.*` (added this session, defense in depth); no `*.dump` file is tracked anywhere |
| Location & access | Owner-user home tree, mode 600, owner-only readable — accessible to the owner via the sandbox; **caveat: sandbox storage is not durable custody** — the owner must copy it (and its checksum) to durable owner storage if kept; the apply-time FRESH dump supersedes it regardless |

Integrity vs recoverability, stated honestly: the listing proves the archive
is readable and structurally complete. **Recoverability is proven only by the
prior completed restoration drill** (digest-identical restore, evidence on
disk). A fresh apply-time dump will be integrity-verified only unless its own
drill is run — the runbook makes this gap explicit for the owner's decision.

## 2. Fresh-backup procedure — **PREPARED** (`docs/OWNER-BACKUP-RUNBOOK.md`)

A precise, reusable, owner-executed runbook covering all ten required points
(project/db confirmation incl. read-only Management API probes; disk space
and a Git-external 700 destination; the session-pooler + PostgreSQL 17.x
client contract; credentials via `~/.pgpass` or a 600-mode env file — never
command line, URI, or shell history; dump execution only in the separately
authorized window; UTC timestamp/size/versions/SHA-256 evidence bundle;
`pg_restore --list` validation; owner retrieval and custody; isolated-environment
restoration incl. extensions and logical-restore limitations; Git/CI/PR
exclusion rules). The core future commands (exact, not executed):

```bash
BACKUP_DIR="$HOME/backups/scholario-production"; TS="$(date -u +%Y%m%dT%H%M%SZ)"
PGSSLMODE=require pg_dump -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres \
  -Fc -f "$BACKUP_DIR/scholario-prod-$TS.dump"        # exit 0, ~1 min, ~1.1 MB
chmod 600 "$BACKUP_DIR/scholario-prod-$TS.dump"
sha256sum "$BACKUP_DIR/scholario-prod-$TS.dump" | tee "$BACKUP_DIR/scholario-prod-$TS.dump.sha256"
pg_restore --list "$BACKUP_DIR/scholario-prod-$TS.dump" > "$BACKUP_DIR/scholario-prod-$TS.dump.toc.txt"
# restore drill (disposable PG 17+; expect exactly 3 supabase_vault error lines):
pg_restore -h 127.0.0.1 -p 55432 -U postgres -d postgres --no-owner --role=postgres "$BACKUP_DIR/scholario-prod-$TS.dump"
```

## 3. Secure storage and recovery limitations

- **Point-in-time logical backup only**: MVCC snapshot at dump start; no
  PITR; no coverage of writes after that instant; the platform has **no
  automated backups and no PITR on the current (Free) plan** — re-verified in
  the post-merge session; upgrading is a billing decision deliberately left
  to the owner.
- **Logical-restore constraints**: roles/ACLs need `--no-owner` (+
  `--role=postgres` / `--no-privileges` on non-Supabase targets); extensions
  must exist on the target (`supabase_vault` only exists on Supabase → 3
  harmless error lines on vanilla PG); Supabase platform-managed schemas
  conflict on an initialized fresh project (restore cleanly into a bare PG
  17+ or accept scoped platform-object errors); platform state outside the
  database (auth providers config, buckets plumbing, settings) is not in a
  `pg_dump` — a disaster rebuild is fresh project → logical restore →
  recreate platform settings → repoint `DATABASE_URL`.
- **Custody**: dump contains PII (student/staff rows, password hashes) —
  600/700 perms, outside Git, never in CI logs/PRs/unapproved uploads;
  durable custody is the owner's durable storage, not the sandbox.

## 4. Migration runbook — **PREPARED** (`docs/LIVE-MIGRATION-RUNBOOK.md`)

Scripts verified byte-identical to the release commit `27183a99…`
(`git diff 27183a9 HEAD --stat -- scripts/ docs/` = empty); migration SQL
SHA-256 `ec171c91…` verified at both the working tree and the release
commit; pending gate object = `FeeTransaction_feeId_fkey`; the feeId
migration is correctly NOT in the additive-only set (its data statements are
by design). The operator sequence (7 steps, exactly as required):

1. **Fresh read-only preflight, unique timestamped snapshot**
   ```bash
   TS="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "audit/feeid-apply-live-$TS"
   set -a; . ./.env.prod-migration; set +a
   bun scripts/prod-migration/preflight.ts \
     --out "audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json" \
     --expect 20261013140000_fee_transaction_dangling_feeid_self_heal
   # exit 0 required; check ${PIPESTATUS[0]} if piping through tee
   ```
2. **Exact pending-migration gate** — enforced twice (preflight `--expect`
   and independently inside `apply.ts --expect`); mismatch ⇒ STOP.
3. **Successful apply dry-run** (builds the one transaction, never executes)
   ```bash
   bun scripts/prod-migration/apply.ts \
     --expect 20261013140000_fee_transaction_dangling_feeid_self_heal --dry-run
   # exit 0 required; expect: sha256 ec171c91… · 63 statements · 1 transaction
   # incl. history row · "DRY RUN — transaction not executed · no writes"
   ```
4. **Owner checkpoint** — fresh backup retained (checksum recorded, 600,
   outside Git, retrievable) + recovery risk understood (logical PIT-less
   posture; archive-listing ≠ restoration proof; 12/12 disposable-PG
   migration evidence + fail-closed digest/trigger gates).
5. **Separate explicit owner authorization in a later message** — nothing
   may be inferred from Option A or from these documents.
6. **Only then, the sanctioned production apply**
   (`bun scripts/prod-migration/apply.ts --expect 20261013140000_…` — one
   atomic transaction incl. history row; any failure ⇒ full rollback, no
   history row, exit 1).
7. **Post-apply verification** (`bun scripts/prod-migration/verify.ts
   --snapshot audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json`) —
   fail-closed on: 24/24 history · `FeeTransaction_feeId_fkey`
   (SET NULL/CASCADE) · **zero dangling feeId** · **both tenant guards
   present + `tgenabled='O'`** · financial rows/sum/digest **identical
   within the snapshot cutoff window** (receipt numbers and amounts never
   read) · **both** plane health endpoints 200 `database:ok`.

**Steps 6–7 were NOT executed and MUST NOT be executed until Step 5's
explicit authorization exists.** They remain prepared procedures only.

## 5. Remaining owner actions (decision queue)

1. **Custody of the verified artifact (recommended, optional)**: copy
   `/home/z/prod-recovery-prep/dumps/prod-full-20261013T050827Z.dump` +
   its checksum to durable owner storage if you want it as a fallback
   (it is sandbox-held evidence today).
2. **Recovery posture (optional, billing)**: Supabase Pro/PITR upgrade for
   platform-level automated backups — deliberately not changed, owner
   decision only.
3. **In the future apply window**: run `docs/OWNER-BACKUP-RUNBOOK.md`
   (fresh dump + evidence bundle + listing validation; §9 drill optional),
   then `docs/LIVE-MIGRATION-RUNBOOK.md` Steps 1–4.
4. **Then, only if satisfied**: issue the separate explicit live-apply
   authorization (runbook Step 5) — after which Steps 6–7 may run verbatim.
5. Optional hardening: protection rules on the GitHub `production`
   environment (noted in prior reports; unchanged).

## 6. Compliance statement (explicit)

**No production writes. No new production exports (no database dump, no
data export of any kind — zero production database and zero production API
connections were made this session). No migration applied —
`20261013140000_fee_transaction_dangling_feeid_self_heal` remains PENDING
per the last verified read-only state (2026-10-13T05:12Z: 23 applied / 24
repo / 1 pending · 3 dangling rows · guards enabled · feeId FK absent ·
ledger digest `a87ebe601cdf…` unchanged). No workflow dispatches. No
merges. No deployments. No billing or production configuration changes. No
credentials or data contents printed, copied into the repository, attached
to any PR, or uploaded anywhere.**

Local-only actions this session: read-only `git fetch` + local log/status
inspection; local `stat`/`sha256sum`/`pg_restore --list` on the existing
dump (listing stored outside the repo, mode 600); local permission
hardening of the sandbox dump directory (775 → 700) and its TOC evidence
files (→ 600); `.gitignore` hardening (`*.dump`, `*.dump.*` — defense in
depth, zero tracked files affected); new documentation
(`docs/OWNER-BACKUP-RUNBOOK.md`, `docs/LIVE-MIGRATION-RUNBOOK.md`); this
report + evidence file under a NEW unique audit path
(`audit/feeid-option-a-2026-10-13/` — no prior evidence reused or
overwritten); worklog append; a LOCAL git commit (never pushed). The dev
server for the Next.js app was untouched (no source changes — docs only).
