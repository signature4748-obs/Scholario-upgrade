# Owner Dump Custody & Maintenance-Window Commands

> **Status: PREPARED — NOT EXECUTED.** Written 2026-10-13 (final pre-apply
> checkpoint follow-up). Part 1 is owner-executable **now** and touches no
> production system (local file copy + verification only). Part 2 is the
> exact command sheet for the **future authorized maintenance window** —
> **none of it has been executed against production**, and the live apply
> remains forbidden until a separate, explicit owner authorization message
> exists (`docs/LIVE-MIGRATION-RUNBOOK.md` Step 5). Nothing in this document
> grants any authorization.
>
> **Authorization map (hard):**
> - **Part 1 (custody of the existing dump):** allowed now — local copy
>   verification only; the owner performs the copy; nothing is uploaded or
>   exported by anyone else.
> - **Part 2 W1 (fresh backup):** a NEW production data export — requires
>   its own explicit authorization before the window opens.
> - **Part 2 W2–W3 (preflight / dry-run):** read-only production probes —
>   run only inside that opened window, after W1.
> - **Live apply (runbook Steps 6–7):** requires a FURTHER separate explicit
>   authorization; never inferable from Option A, these documents, or any
>   prior preparation. No workflow dispatch, no `dry_run=false`, before that.

---

## Part 1 — Custody of the EXISTING verified 2026-10-13 dump (owner, now)

**What exists (sandbox, all mode 600, directory 700, outside every Git repo):**

| File (in `/home/z/prod-recovery-prep/dumps/`) | Size | Purpose |
|---|---|---|
| `prod-full-20261013T050827Z.dump` | 1,156,906 bytes | The verified logical dump (CUSTOM/gzip, PG 17.11) |
| `prod-full-20261013T050827Z.dump.sha256` | 98 bytes | Checksum sidecar: `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5` + relative filename |
| `prod-full-20261013T050827Z.dump.toc.txt` | 133,134 bytes | `pg_restore --list` TOC evidence (1827 entries; 162 TABLE DATA) |

The three files above are the **complete custody bundle**. Their integrity
was re-verified at staging time (2026-10-13T06:04Z): recomputed SHA-256
identical, `sha256sum -c` → `OK`, fresh TOC listing exit 0.

### C1 — Retrieve the bundle to owner-controlled storage

Copy **all three files** (dump + `.sha256` + `.toc.txt`) from the sandbox to
the durable machine/location the owner controls — via the environment's
file-download facility (Preview Panel → file access / "Open in New Tab"
download). Keep the three files **together in one directory** (the checksum
sidecar references the dump by relative filename).

**Transport rules (the dump contains PII — student/staff records, password
hashes):** never through Git, a PR, a CI log, a ticket, a screenshot, a
public paste, or ANY upload target that is not owner-approved storage; never
by asking an AI agent or CI to "push/upload/export" it; encrypted transport
or an already-private channel is preferred where available.

### C2 — Verify the copy on the destination (before trusting it)

On the destination machine, in the directory holding the three files:

```bash
sha256sum -c prod-full-20261013T050827Z.dump.sha256
# EXPECT: prod-full-20261013T050827Z.dump: OK     (exit 0)
# macOS equivalent: shasum -a 256 -c prod-full-20261013T050827Z.dump.sha256
```

If the check fails — the copy is corrupt; delete it and re-copy. Do NOT
proceed with a failing checksum. (Cross-check, optional: the digest must
equal `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5`.)

### C3 — Protect access on the destination

```bash
DEST="$HOME/backups/scholario-production"          # or the owner's chosen durable location
mkdir -p "$DEST" && chmod 700 "$DEST"
# move the three files into $DEST, then:
chmod 600 "$DEST/prod-full-20261013T050827Z.dump"{,.sha256,.toc.txt}
chmod 700 "$(dirname "$DEST")" 2>/dev/null || true  # tighten the parent only if it exists and is yours

# PROOF the storage location is not inside any Git repository:
git -C "$DEST" rev-parse --show-toplevel 2>/dev/null \
  && echo "STOP: destination is inside a Git repo — choose another" \
  || echo "OK: not inside a Git repository"
```

Ongoing rules: owner-only access (600/700); never in a synced folder that
is not owner-approved; never inside any clone of the repository; if the
machine is shared, use an encrypted volume; record WHERE custody lives in
the owner's own records (the sandbox is not durable custody).

### C4 — Optional destination-side listing check (integrity, not restorability)

If a PostgreSQL 17.x client is installed on the destination:

```bash
pg_restore --version                                  # major version 17 required
pg_restore --list "$DEST/prod-full-20261013T050827Z.dump" | head -14
# EXPECT header: Format: CUSTOM · Compression: gzip ·
#                Dumped from database version: 17.11 · Dumped by pg_dump version: 17.11 …
```

A clean listing proves the copy is readable and structurally intact.
**Restorability** is proven only by a restore drill
(`docs/OWNER-BACKUP-RUNBOOK.md` §9) — the 2026-10-13 artifact already has a
completed, digest-identical drill on record.

### C5 — What this artifact is (and is not)

- It **is** a verified, restorable point-in-time fallback of the FULL
  production database as of 2026-10-13 05:08:27 UTC.
- It **is not** the pre-apply backup: the future apply window requires a
  **FRESH** dump taken then (Part 2 W1) — the fresh dump supersedes this one.
- Taking this copy changes nothing about the migration's authorization
  state: `20261013140000_fee_transaction_dangling_feeid_self_heal` remains
  PENDING, and every apply gate remains closed.

---

## Part 2 — Future maintenance-window command sheet (PREPARED, NOT EXECUTED)

Run on a checkout of `signature4748-obs/Scholario-upgrade` **at the release
commit** (see W0). Credentials: pipeline secrets via the 600-mode
`.env.prod-migration` (`set -a; . ./.env.prod-migration; set +a` — never
printed); DB password via `~/.pgpass` or a 600-mode env file
(`docs/OWNER-BACKUP-RUNBOOK.md` §4) — never a command line, URI, or shell
history.

### W0 — Machine prep (local, any time)

```bash
git fetch origin
git checkout 27183a991926db07729784b16f4752821a029ae6   # release commit (PR #28 merge)
git rev-parse HEAD
# MUST print: 27183a991926db07729784b16f4752821a029ae6
sha256sum prisma/migrations/20261013140000_fee_transaction_dangling_feeid_self_heal/migration.sql
# MUST print: ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db
bun --version    # the scripts need only the repo + bun (Node built-ins only)
```

### W1 — Fresh timestamped backup (**requires its own explicit authorization first**)

A new `pg_dump` is a new production data export. Do not run W1 until that
authorization exists. Then execute `docs/OWNER-BACKUP-RUNBOOK.md` §1–§8 —
core commands:

```bash
BACKUP_DIR="$HOME/backups/scholario-production"; TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"

PGSSLMODE=require pg_dump \
  -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres \
  -Fc -f "$BACKUP_DIR/scholario-prod-$TS.dump"
echo "pg_dump exit=$?"                       # MUST be 0
chmod 600 "$BACKUP_DIR/scholario-prod-$TS.dump"

# evidence bundle + integrity validation:
sha256sum "$BACKUP_DIR/scholario-prod-$TS.dump" | tee "$BACKUP_DIR/scholario-prod-$TS.dump.sha256"
pg_restore --list "$BACKUP_DIR/scholario-prod-$TS.dump" > "$BACKUP_DIR/scholario-prod-$TS.dump.toc.txt"
chmod 600 "$BACKUP_DIR/scholario-prod-$TS.dump.sha256" "$BACKUP_DIR/scholario-prod-$TS.dump.toc.txt"
```

Expect exit 0, ~1 minute, ~1.1 MB (grows with data). Then verify custody on
the destination exactly as Part 1 C2–C3 (the fresh dump + sidecars travel the
same way). Optional: §9 restore drill against a disposable PG 17+.

### W2 — Fresh read-only preflight (in the opened window, after W1)

```bash
TS="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "audit/feeid-apply-live-$TS"
set -a; . ./.env.prod-migration; set +a

bun scripts/prod-migration/preflight.ts \
  --out "audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json" \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal \
  2>&1 | tee "audit/feeid-apply-live-$TS/preflight-log-$TS.txt"
echo "preflight exit=${PIPESTATUS[0]}"       # MUST be 0
```

GREEN = history gate clean · **pending set is EXACTLY this one migration** ·
`FeeTransaction_feeId_fkey` does not already exist · snapshot written (the
file Step 7 verification later consumes). Any red ⇒ STOP and investigate
(`docs/PRODUCTION_DB_MIGRATION.md` §6) — never force.

### W3 — Apply dry-run (builds the transaction, never executes)

```bash
bun scripts/prod-migration/apply.ts \
  --expect 20261013140000_fee_transaction_dangling_feeid_self_heal \
  --dry-run \
  2>&1 | tee "audit/feeid-apply-live-$TS/apply-dryrun-$TS.txt"
echo "dry-run exit=${PIPESTATUS[0]}"         # MUST be 0
```

GREEN = all gates re-validated · migration SHA-256 printed (`ec171c91…`) ·
**63 statements, ONE transaction incl. the `_prisma_migrations` history
row** · output states `DRY RUN — transaction not executed · no writes`.

### STOP — what remains forbidden after W3

- **The live apply** (runbook Step 6) and **post-apply verification** (Step 7):
  forbidden until the owner issues a **separate, explicit live-apply
  authorization message** (Step 5). Nothing may be inferred from Option A,
  from Part 1 custody, or from W1–W3 success.
- **Workflow dispatch** of `Production DB Migration` (incl. any run with
  `dry_run=false`) — equally gated behind Step 5.
- If the owner later authorizes: run Steps 6–7 of
  `docs/LIVE-MIGRATION-RUNBOOK.md` verbatim (single atomic apply; verify
  fails closed on history/FK/dangling/guards/digest/both-plane health).

---

## Part 3 — Credential hygiene (binding rules for every part above)

- Credentials live ONLY in owner-controlled 600-mode files
  (`.env.prod-migration`, `~/.pgpass`, backup env files) — never in command
  lines, URIs, shell history, chat messages, tickets, PRs, CI logs, or any
  document in the repository.
- **Chat-paste exposure:** secrets pasted into a conversation (as happened
  on 2026-10-13) must be treated as exposed-in-transit. They were NOT used,
  stored, or echoed by this session. The owner should decide on **rotation**
  (Supabase DB password + access tokens, GitHub token, Vercel token, Resend
  key) — rotation is cheap; a leaked service-role key or DB password is not.
- If a secret ever lands in shell history: `history -d <n>` then rotate
  (Supabase dashboard → Database → Settings for the DB password; each
  provider's token settings otherwise).
