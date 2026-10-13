# Owner-Held Logical Backup Runbook (Option A)

> **Status: PREPARED — NOT EXECUTED.** This document was prepared on
> 2026-10-13 during the Option A (owner-held logical backup) preparation
> session. **Nothing in it has been executed against production.** It is the
> exact, reusable procedure the owner runs in the separately authorized
> backup window — immediately before the future live migration
> (`docs/LIVE-MIGRATION-RUNBOOK.md`, which itself remains unexecuted until a
> further explicit authorization).
>
> **Authorization boundary (hard):** taking a new logical backup is a NEW
> production data export and requires its own explicit authorization. No
> production writes, no dumps, no workflow dispatches, no merges, no
> deployments, no billing or configuration changes happen as part of this
> document existing. `pg_dump` itself is read-only against the source
> database.

Target: **scholario-production** — Supabase project `kbyknezedewvgrnqervj`,
region `ap-south-1`, PostgreSQL **17.11** (org has exactly one project —
verify below, don't assume).

---

## 1. Confirm the intended Supabase project and production database

Do this on the backup machine, before anything else. All commands are
read-only.

```bash
# Read-only Management API probe (token via env, never printed/committed):
curl -sS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  https://api.supabase.com/v1/projects/kbyknezedewvgrnqervj \
  | jq '{id, name, region, db, status}'
# EXPECT: id "kbyknezedewvgrnqervj" · name "scholario-production" ·
#         region "ap-south-1" · db "17.x" · status "ACTIVE_HEALTHY"

# Org-level cross-check — the org must list exactly ONE project:
curl -sS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  https://api.supabase.com/v1/projects | jq '[.[] | {id, name}]'
# EXPECT: exactly [{"id":"kbyknezedewvgrnqervj","name":"scholario-production"}]
```

Dashboard cross-check: <https://supabase.com/dashboard/project/kbyknezedewvgrnqervj>
must show the same project name, region, and PostgreSQL version.

Optional DB-identity check (read-only, uses the §3/§4 connection):

```bash
psql -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres -Atc \
  'SELECT current_database(), current_user, current_setting('"'server_version'"');'
# EXPECT: postgres | postgres.kbyknezedewvgrnqervj | 17.11
psql … -Atc 'SELECT count(*) FROM public."_prisma_migrations";'
# EXPECT (pre-apply): 23   ← the live migration will make this 24
```

If ANY of the above mismatches — STOP. Wrong project or wrong state.

## 2. Confirm disk space and a secure destination OUTSIDE Git

```bash
BACKUP_DIR="$HOME/backups/scholario-production"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
df -h "$BACKUP_DIR"      # require comfortably ≥ 50 MB free
                         # (last verified full dump: 1,156,906 bytes ≈ 1.1 MB;
                         #  it grows with data — leave generous headroom)

# PROOF the destination is not inside any Git repository:
git -C "$BACKUP_DIR" rev-parse --show-toplevel 2>/dev/null \
  && echo "STOP: destination is inside a Git repo — choose another" \
  || echo "OK: not inside a Git repository"
```

Rules:

- The dump file must live **outside every clone of Scholario-upgrade** (and
  outside any other repo). Git physically cannot track a path outside a
  repository work tree — that is the primary safety property.
- Defense in depth: the repo's `.gitignore` ignores `*.dump` / `*.dump.*`
  (added 2026-10-13), and `/backups/` was already ignored. These are safety
  nets for an accidental copy — **not** permission to store dumps in the repo.
- Never let the dump (or its sidecar files) appear in CI logs, PR
  attachments, screenshots, tickets, or any upload target that is not
  owner-approved storage.

## 3. Use the supported session pooler and a compatible client

**Connection (the sanctioned client path):**

| Parameter | Value |
|---|---|
| Host | `aws-0-ap-south-1.pooler.supabase.com` (Supavisor **session** pooler, IPv4) |
| Port | `5432` |
| User | `postgres.kbyknezedewvgrnqervj` |
| Database | `postgres` |
| TLS | `PGSSLMODE=require` |

- The **direct** host `db.kbyknezedewvgrnqervj.supabase.co:5432` is
  **IPv6-only** — unreachable from IPv4-only machines; the session pooler is
  the verified path (this exact route produced the verified 2026-10-13
  dump).
- Do **not** use the transaction pooler (`:6543`) for `pg_dump` — it does not
  carry the session state a whole-database dump needs.

**Client (PostgreSQL 17.x tools — server is 17.11):**

```bash
pg_dump --version     # MUST report major version 17 (17.11 is the verified
                      # exact-version client; ≥17 works; 16.x or older CANNOT
                      # dump a 17 server)
pg_restore --version  # same rule
```

If missing/wrong: Debian/Ubuntu `apt-get install postgresql-client-17`;
macOS `brew install postgresql@17`; other platforms equivalent. (In the
sanctioned sandbox the 17.11 client was provisioned without root via
`apt-get download` + `dpkg -x` under `/home/z/prod-recovery-prep/pgclient/`
— only relevant if you are on that machine.)

## 4. Credentials without exposure

The DB password is **owner-held by design** (`docs/PRODUCTION_DB_MIGRATION.md`
§2 — the migration pipeline never needs it; only this runbook does). Never
put it in a command line, a connection URI, an echo, a commit, or anything
that lands in shell history or logs.

**Option A — `~/.pgpass` (recommended):**

```bash
# Add ONE line (host:port:database:user:password) using an editor, not echo:
#   aws-0-ap-south-1.pooler.supabase.com:5432:postgres:postgres.kbyknezedewvgrnqervj:<DB_PASSWORD>
chmod 600 ~/.pgpass
```

**Option B — protected env file:**

```bash
install -m 600 /dev/null "$HOME/backups/scholario-production/backup.env"
# Then EDIT that file (text editor — no echo, no shell history) to contain:
#   export PGPASSWORD='<DB_PASSWORD>'
# Load it before the dump and unload after:
set -a;  . "$HOME/backups/scholario-production/backup.env"; set +a
```

Hygiene rules:

- Never `pg_dump "postgresql://user:password@…"` (URI leaks into history and
  process listings).
- If a password ever lands in shell history: `history -d <n>`, then **rotate
  the password** via the Supabase dashboard (Database → Settings). 
- `export PGSSLMODE=require` alongside whichever option you choose.

## 5. Take the new logical backup — ONLY in the authorized window

Run this **immediately before the live migration** (a stale backup is not an
apply-time backup — the 2026-10-13 sandbox dump is verification evidence,
not the pre-apply backup):

```bash
BACKUP_DIR="$HOME/backups/scholario-production"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

PGSSLMODE=require pg_dump \
  -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres \
  -Fc -f "$BACKUP_DIR/scholario-prod-$TS.dump"
echo "pg_dump exit=$?"          # MUST be 0
chmod 600 "$BACKUP_DIR/scholario-prod-$TS.dump"
```

Expected shape (from the verified 2026-10-13 run): exit 0, ~1 minute
(67 s observed), ~1.1 MB custom-format archive (grows with data).

Notes:

- `pg_dump` is **read-only** on the source; it takes one MVCC-consistent
  snapshot at start. Concurrent application writes are allowed and simply
  land after the dump's point-in-time (they are NOT covered by it).
- `-Fc` = custom compressed format (gzip) — the verified format, restorable
  with `pg_restore` (single file, TOC-listable, selective restore capable).

## 6. Record the evidence bundle (UTC time, size, versions, SHA-256)

```bash
cd "$BACKUP_DIR"
DUMP="scholario-prod-$TS.dump"

date -u +"%Y-%m-%dT%H:%M:%SZ"                       | tee "$DUMP.utc-timestamp"
stat -c 'size=%s bytes mode=%A owner=%U:%G' "$DUMP" | tee "$DUMP.stat"
pg_dump --version                                   | tee "$DUMP.client-version"
PGSSLMODE=require psql -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres -Atc 'SELECT version();' \
                                                    | tee "$DUMP.server-version"
sha256sum "$DUMP"                                   | tee "$DUMP.sha256"
chmod 600 "$DUMP".{utc-timestamp,stat,client-version,server-version,sha256}
```

Also record (read-only, useful for cross-checking against the migration
runbook's fresh preflight):

```bash
PGSSLMODE=require psql -h aws-0-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.kbyknezedewvgrnqervj -d postgres -Atc \
  'SELECT count(*) FROM public."_prisma_migrations";'   # pre-apply: 23
```

## 7. Validate the archive — integrity (NOT a restoration test)

```bash
cd "$BACKUP_DIR"; DUMP="scholario-prod-$TS.dump"
pg_restore --list "$DUMP" > "$DUMP.toc.txt"; echo "pg_restore --list exit=$?"
wc -l < "$DUMP.toc.txt"          # ~1835 lines for the 2026-10-13-sized DB
chmod 600 "$DUMP.toc.txt"
```

Read the TOC header (`$DUMP.toc.txt`, first ~14 lines) and confirm:

- `Format: CUSTOM`, `Compression: gzip`
- `Dumped from database version: 17.11` (matches the server)
- `Dumped by pg_dump version: 17.11 …` (matches the client you used)
- a large `TOC Entries:` count (1827 entries / 162 TABLE DATA entries at the
  2026-10-13 size) and an exit code of 0.

**Read this twice:** a clean `pg_restore --list` proves the archive is
readable and structurally intact — nothing more. It does **not** prove the
database can be restored. Only a completed restoration drill (§9) proves
restorability. The 2026-10-13 verification dump passed **both** (listing +
full digest-identical restore); a fresh apply-time dump is
**integrity-verified only** until §9 is run, and the owner should decide
knowingly whether that residual gap is acceptable for the apply window.

## 8. Owner retrieval and custody

- From the machine that will hold it, confirm you can read the dump, its
  checksum sidecar, and the TOC: `sha256sum -c "$DUMP.sha256"` must say OK.
- Copy the dump (plus `.sha256` and `.toc.txt`) to **durable owner storage**
  — the machine you ran it on, plus wherever your custody policy keeps
  confidential data. A sandbox or CI workspace is **not** durable custody.
- The dump contains personal information (student/staff records, password
  hashes, contact details) and must be handled as confidential: mode 600,
  directory 700, owner-only access, no PR attachments, no unapproved
  uploads, no printing of contents, never inside Git.
- The sandbox verification copy (evidence from 2026-10-13) is
  `/home/z/prod-recovery-prep/dumps/prod-full-20261013T050827Z.dump`
  (sha256 `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5`,
  1,156,906 bytes, mode 600, outside the repository). Download it too if you
  want it as a fallback — but the fresh apply-time dump supersedes it.

## 9. Restoration drill (isolated environment — recommended before relying on the backup)

### 9a. Target — disposable PostgreSQL 17+ (the PROVEN path)

The verified 2026-10-13 drill restored into a bare embedded PostgreSQL 18.4
with only 3 error lines (all `supabase_vault` — an extension that only
exists on Supabase; data unaffected). A disposable local PG is the cleanest
drill target:

```bash
docker run -d --name restore-drill \
  -e POSTGRES_PASSWORD=dummy -p 127.0.0.1:55432:5432 postgres:17

pg_restore -h 127.0.0.1 -p 55432 -U postgres -d postgres \
  --no-owner --role=postgres "$BACKUP_DIR/scholario-prod-$TS.dump"
# EXPECT: completes with "errors ignored on restore: 3"
#         (CREATE/COMMENT supabase_vault + COPY vault.secrets — extension
#          unavailable on vanilla PG; application data unaffected)
```

If you don't use Docker, any throwaway PG 17+ instance works (the sandbox
used an embedded cluster; a fresh empty database on any PG 17+ is
equivalent). Vanilla PG needs the contrib extensions available
(`pg_trgm`, `pg_stat_statements`, `uuid-ossp`, `pgcrypto` — standard in
`postgresql-contrib` packages).

### 9b. Target — a fresh Supabase project (platform parity, more caveats)

A **new** Supabase project (PG 17.x) has every required extension —
including `supabase_vault` — but it also **pre-creates** the
platform-managed schemas (`auth`, `storage`, `realtime`, …) with its own
rows. Restoring a full-database dump on top of them produces conflicts on
those platform objects. Practical approach: accept the platform-schema
error lines (or pre-drop with `--clean --if-exists` scoped to `public`)
and require the **`public` schema** (all application data) to restore
cleanly. Do **not** restore into the production project. Restore via the
new project's session pooler with `--no-owner --role=postgres`.

### 9c. Data-fidelity checks on the restored copy (read-only)

```bash
PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -Atc"

$PSQL 'SELECT count(*) FROM public."FeeTransaction";'
# 2026-10-13 dump expected: 226 (pre-apply)
$PSQL 'SELECT COALESCE(sum("amount"),0)::text FROM public."FeeTransaction";'
# expected: 602480.00 (pre-apply)
$PSQL 'SELECT md5(COALESCE(string_agg(COALESCE("receiptNo", '"'"'<null>'"'"') || '"'"'|'"'"' || COALESCE("studentId", '"'"'<null>'"'"') || '"'"'|'"'"' || "amount"::text, E'"'"'\n'"'"' ORDER BY "id"), '"'"''"'"')) FROM public."FeeTransaction";'
# expected (2026-10-13 dump): a87ebe601cdf03d3929ddefe33353ffb  ← the
# privacy-safe financial-ledger digest, byte-identical semantics to the
# pipeline's own gate (scripts/prod-migration/lib.ts financialIntegrity)
$PSQL 'SELECT count(*) FROM public."_prisma_migrations";'
# expected (pre-apply): 23
```

For a **fresh apply-time** dump, the expected numbers come from that
moment's fresh preflight snapshot
(`audit/feeid-apply-live-<TS>/preflight-snapshot-<TS>.json` — the migration
runbook prints rows/sum/digest in its log): compare the drill's restored
values against **that snapshot**, not against 2026-10-13 history.

Destroy the drill afterwards — it contains PII: `docker rm -f restore-drill`
(or drop the throwaway database/cluster).

## 10. Limitations of a logical restore (state honestly in any decision)

- **Point-in-time only.** The dump captures the MVCC snapshot at dump start.
  No PITR; nothing written afterwards is covered; there is no platform-level
  automated backup on the current plan (verified 2026-10-13: `pitr_enabled`
  false, `backups: []` — Free tier).
- **Roles & grants.** A logical dump carries ACLs referencing roles
  (`anon`, `authenticated`, `service_role`, `supabase_*`, `postgres`). On a
  non-Supabase target use `--no-owner` (+ `--no-privileges` if the roles
  don't exist) and recreate role bindings deliberately. On a fresh Supabase
  project the standard roles exist; RLS policies restore with the tables.
- **Extensions.** The dump emits `CREATE EXTENSION` for everything the source
  had. pg_trgm/pg_stat_statements/uuid-ossp/pgcrypto exist on Supabase and
  in PG contrib packages; `supabase_vault` exists **only** on Supabase — on
  vanilla PG exactly 3 vault-related error lines are expected and harmless.
- **Platform state is not in a database dump.** Auth provider configuration,
  storage bucket plumbing beyond the table rows, API keys, network
  restrictions, and Supabase project settings are platform-managed and are
  NOT part of `pg_dump` output. A disaster-recovery rebuild is: fresh
  project → logical restore → recreate platform settings → repoint
  application `DATABASE_URL`/pooler → re-run health checks.
- **Restoring does not fix drift.** If production history ever diverges from
  the repo chain, the recovery conversation is the migration pipeline's
  STOP-and-investigate path (docs/PRODUCTION_DB_MIGRATION.md §6), never a
  silent restore-over.

## 11. Prohibited without further explicit authorization

No production database writes · no live migration apply · no workflow
dispatch that could write · no new production exports (including a new
dump) outside the authorized window · no merges, deployments, billing or
production configuration changes · no exposure of credentials or data
contents. This runbook existing in the repository grants none of those.
