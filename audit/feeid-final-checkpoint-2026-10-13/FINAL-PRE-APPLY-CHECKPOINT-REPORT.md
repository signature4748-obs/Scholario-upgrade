# Scholario — FINAL PRE-APPLY CHECKPOINT (NO PRODUCTION WRITES)

**Prepared:** 2026-10-13T05:52–06:05Z (all observations local + timestamped; one
read-only `git fetch origin` to GitHub — the source repository, not any
production database/API)
**Continues from:** `audit/feeid-option-a-2026-10-13/OPTION-A-PREP-REPORT.md`
**Migration under discussion (STILL PENDING, NOT APPLIED):**
`20261013140000_fee_transaction_dangling_feeid_self_heal`

**Status: EXISTING BACKUP RE-VERIFIED (checksum + listing) · RUNBOOKS INSPECTED
AND ONE OPERATIONAL DEFECT FOUND & FIXED (malformed checkout SHA) · DURABLE
OWNER-CONTROLLED COPY: NOT VERIFIABLE FROM HERE → OWNER ACTION REQUIRED ·
RELEASE COMMIT RE-CONFIRMED UNCHANGED · LOCAL EVIDENCE COMMITS PRESERVED (NEVER
PUSHED) · LIVE APPLY REMAINS BLOCKED — Option A selection is NOT treated as
authorization.**

---

## 1. What is VERIFIED (all evidence local; commands + outputs in
`checkpoint-evidence-20261013T055300Z.txt`)

### 1a. Existing backup artifact — path, checksum, integrity (re-verified)

| Property | Measured this session | Prior record | Match |
|---|---|---|---|
| Absolute path | `/home/z/prod-recovery-prep/dumps/prod-full-20261013T050827Z.dump` (located via the prior reports; no path assumed) | same | ✓ |
| Size | 1,156,906 bytes | 1,156,906 bytes | ✓ |
| Mode / owner | `-rw-------` (600) `z:z`; parent `dumps/` = 700 | 600 z:z, dir 700 | ✓ |
| SHA-256 (recomputed) | `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5` | identical full digest (and the `fbe7f495…` prefix from the task) | ✓ byte-for-byte |
| `pg_restore --list` | exit 0 · 1827 TOC entries · 162 TABLE DATA · CUSTOM/gzip · `Dumped from database version: 17.11` · `Dumped by pg_dump version: 17.11 (Debian 17.11-0+deb13u1)` | same | ✓ |
| Client used | `pg_restore` 17.11 (the provisioned client at `/home/z/prod-recovery-prep/pgclient/root/usr/lib/postgresql/17/bin/`) | 17.11 | ✓ exact client↔server match |
| Git exposure | Path is outside the repository work tree (`git check-ignore` fatal-outside-repo); `/home/z/prod-recovery-prep` is not a git repo; repo `.gitignore` ignores `*.dump`/`*.dump.*`; zero tracked dump files | same | ✓ |

No file contents, no credentials, no connection strings were displayed at any
point; the archive TOC header above is metadata only. Integrity (readable,
structurally complete) is what this re-check proves — restorability rests on
the prior completed restoration drill (digest-identical restore, evidence
preserved), exactly as the runbook states.

### 1b. Runbooks inspected — and one operational defect found & fixed

Both documents were read in full and their **commands reviewed line-by-line**
for credential handling, shell-history exposure, flag correctness, and
in-repo paths:

- **Credential handling — CLEAN.** Pipeline secrets only via a 600-mode
  `.env.prod-migration` (git-ignored, untracked — re-verified: mode 600 `z:z`,
  ignored by `.gitignore:84 (.env.*)`, `git ls-files` = 0), loaded with
  `set -a; . …; set +a` (never printed). DB password only via `~/.pgpass`
  (600, edited not echoed) or a 600-mode env file. No command in either
  runbook embeds a password/token literally; the Management API bearer uses
  env expansion. Leak guidance (`history -d` + rotate) present.
- **Shell-history exposure — CLEAN.** No echo of secrets anywhere; history
  records only unexpanded command text; values live only in 600-mode files.
- **Flags — CLEAN.** Every prepared command matches the actual script
  contracts (re-verified in source): `preflight.ts --out <path> --expect <csv>`;
  `apply.ts --expect <csv> [--dry-run]`; `verify.ts --snapshot <path>`
  (required). `pg_dump -Fc -f … -h pooler -p 5432 -U postgres.<ref> -d
  postgres` with `PGSSLMODE=require` — session pooler (not the 6543
  transaction pooler), correct for a whole-DB dump. `pg_restore --list` /
  `--no-owner --role=postgres` — correct. The psql quoting idioms
  (`'"'server_version'"'`, `'"'"'`) parse to valid SQL. The `| tee` +
  `${PIPESTATUS[0]}` exit-code pattern is correctly documented.
- **Paths inside Git — CLEAN.** Dump + sidecars target `$HOME/backups/…`
  with an in-runbook proof step that the destination is not inside any repo;
  the sandbox evidence copy is outside the work tree (proven). Only
  non-sensitive audit evidence (counts/digests/logs — no row values, no
  credentials) intentionally lives under `audit/` in the repo.
- **Checksums recorded in the runbooks — CORRECT.** The only 64-hex strings
  in either runbook are `ec171c91…e9db` (migration SQL — re-verified
  byte-identical at working tree AND release commit) and `fbe7f495…fa5`
  (dump — recomputed above). The 32-hex ledger digest `a87ebe60…` matches the
  last verified read-only production state.

- **DEFECT FOUND AND FIXED (docs-only, local commit, never pushed):**
  `docs/LIVE-MIGRATION-RUNBOOK.md` Step 1's checkout command contained a
  **malformed 37-character commit SHA** (`27183a991926db07784b16f4752821a029ae6`
  — missing the `297` segment) while the identity card (line 17) had the
  correct 40-character SHA. An owner executing Step 1 verbatim would have hit
  `fatal: invalid object name` and stalled at the very first gate. **Fixed to
  `27183a991926db07784b16f4752821a029ae6`** → corrected to
  `27183a991926db07729784b16f4752821a029ae6` (40 hex chars, verified =
  `origin/main` = the PR #28 merge commit). Repo-wide scan: **zero** remaining
  occurrences in any tracked file. (The same typo appears once in the
  untracked, append-only `worklog.md` history entry for Task ID 11; per the
  append-only convention that entry is preserved as-is and corrected HERE, in
  this report, rather than rewritten.)

### 1c. Durable owner-controlled copy — **NOT VERIFIABLE → OWNER ACTION REQUIRED**

A filesystem-wide search (whole home tree + `/tmp`; repo `upload/` inspected)
found **exactly one copy** of the verified dump: the sandbox copy at
`/home/z/prod-recovery-prep/dumps/…` (mode 600, dir 700). No second copy, no
`~/backups/`, no checksum sidecar next to it (its digest lives in the audit
reports), and no evidence of owner retrieval exists inside this environment.

A copy outside this sandbox cannot be confirmed or denied from inside it. Per
the task's rule, **nothing was uploaded or exported to create such a copy.**
Therefore:

> **OWNER ACTION REQUIRED:** if you want the 2026-10-13 artifact as a
> fallback, copy the dump file AND its SHA-256
> (`fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5`) to
> durable owner-controlled storage yourself (sandbox storage is not durable
> custody). This is optional: the apply-time **fresh** dump — taken with its
> own separate authorization — supersedes this artifact and is the one the
> runbook actually requires.

### 1d. Release commit and local evidence state (read-only `git fetch`)

- **Release commit re-confirmed unchanged:** after a fresh read-only
  `git fetch origin` (2026-10-13T05:52:20Z), `origin/main` =
  `27183a991926db07729784b16f4752821a029ae6` — exactly the PR #28 merge
  commit; **main has NOT advanced.**
- **Working tree: CLEAN** (0 modified, 0 untracked beyond git-ignored files)
  before this session's one docs fix; all prior audit artifacts are committed.
- **Local evidence commits: 10, all local-only, NEVER pushed** (re-counted
  after the fetch: still `ahead 10`): `bc11ccc` (Option A browser-verification
  screenshot), `0fccb20` (Option A prep docs + report), `acd89b6` (post-merge
  evidence), `d959674` (merge of origin/main into local main), `d370793`,
  `5019ea7` (release-gate / apply-readiness evidence), `f8be545`, `9f19b5d`,
  `55facb0` (older local evidence commits), `e573d95` (PR #27-era merge).
  **Preserved as-is — no rebase, no drop, no push.**
- **Stashes: 3, preserved untouched** (`stash@{0}` upload-route residue
  snapshot; `stash@{1}` WIP; `stash@{2}` pre-RC preserved worktree).
- **Other local branches preserved** (development, feat/*, fix/*, pr/*,
  release/*, workspace snapshot branch) — none modified.
- `.env.prod-migration`: mode 600, git-ignored, untracked — untouched.
- This session adds: the runbook SHA fix, this report + evidence file under a
  **NEW unique audit path** (`audit/feeid-final-checkpoint-2026-10-13/` —
  nothing reused or overwritten), a worklog append, and one LOCAL commit
  (never pushed).

## 2. What REMAINS BLOCKED (unchanged; Option A grants none of these)

1. **The live apply** (runbook Steps 6–7) — forbidden until a **separate,
   explicit owner authorization message** exists (Step 5). Not inferred from
   the Option A selection, from any document, or from this checkpoint.
2. **A fresh production backup** — a new logical dump is a new production
   data export and needs its own authorization window.
3. **Any fresh preflight/dry-run against production** — not run in this task
   (per instruction); the runbook's versions remain prepared-only.
4. **Any workflow dispatch** (incl. `Production DB Migration`), merges,
   deployments, billing or production configuration changes.
5. **Durable custody of the 2026-10-13 dump** — owner action, above.

## 3. Checklist for the eventual authorized window (exact, in order)

Run on a checkout at the release commit `27183a991926db07729784b16f4752821a029ae6`
(migration SQL must hash to `ec171c91ee4e2be1912a3a81bc1b9b26264011e1b020ec34ce8c9416bb16e9db`):

1. **Durable backup + checksum verified** — owner confirms the fresh dump
   (step 2 below) AND its `.sha256` are copied to durable owner-controlled
   storage and `sha256sum -c <dump>.sha256` reports OK there.
2. **Fresh timestamped backup taken with separate authorization** — execute
   `docs/OWNER-BACKUP-RUNBOOK.md` §1–§8 in its own authorized window
   (project/db probes → 700 Git-external destination → PG17 client →
   pgpass/600-env credentials → `pg_dump -Fc` → UTC/size/versions/SHA-256
   bundle → `pg_restore --list` exit 0; §9 restore drill optional, gap
   acknowledged if skipped).
3. **Fresh read-only preflight passes with exactly the expected pending
   migration** — `bun scripts/prod-migration/preflight.ts --out
   audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json --expect
   20261013140000_fee_transaction_dangling_feeid_self_heal` → exit 0
   (check `${PIPESTATUS[0]}` when piping through `tee`); unique timestamped
   evidence dir; pending set = exactly this one migration.
4. **Sanctioned apply dry-run passes** — `bun scripts/prod-migration/apply.ts
   --expect 20261013140000_fee_transaction_dangling_feeid_self_heal
   --dry-run` → exit 0; prints SHA `ec171c91…`, 63 statements, 1 transaction
   (incl. history row), `DRY RUN — transaction not executed · no writes`.
5. **Owner explicitly authorizes live apply in a separate message** —
   runbook Step 5; nothing may be inferred from Option A, these documents, or
   this checkpoint. Until this message exists, STOP.
6. **Sanctioned apply runs once** — `bun scripts/prod-migration/apply.ts
   --expect 20261013140000_fee_transaction_dangling_feeid_self_heal` → exit 0
   (one atomic transaction incl. history row; failure ⇒ full rollback, no
   history row, exit 1 — then STOP and investigate, never re-run blindly).
7. **Post-apply verification passes** — `bun scripts/prod-migration/verify.ts
   --snapshot audit/feeid-apply-live-$TS/preflight-snapshot-$TS.json` →
   exit 0: 24/24 history · `FeeTransaction_feeId_fkey` (SET NULL/CASCADE) ·
   zero dangling feeId · both tenant guards present + `tgenabled='O'` ·
   financial rows/sum/digest identical within the snapshot cutoff window ·
   BOTH planes `/health/ready` 200 `database:ok`.

## 4. Compliance statement (explicit)

**This task performed ZERO production writes, ZERO new production dumps or
data exports, ZERO workflow dispatches, ZERO merges, and ZERO deployments.**
Zero connections were made to the production database or to any production
API (Supabase/Vercel). The only network operation was one read-only
`git fetch origin` against the GitHub source repository (same compliant
pattern as the prior Option A session). No credentials, tokens, connection
strings, or database contents were displayed, printed, committed, or
uploaded. The existing dump was only `stat`/`sha256sum`/`pg_restore --list`-ed
locally; its contents were never read.

Local-only actions: file stat/hash/listing; filesystem searches for dump
copies; read-only git inspection (log/status/branch/stash/rev-parse/diff) +
one read-only fetch; one **docs-only defect fix** (malformed checkout SHA in
`docs/LIVE-MIGRATION-RUNBOOK.md`); this report + evidence file under a NEW
unique audit path; worklog append; one LOCAL git commit (never pushed);
dev-server status check (running, untouched — no source changes this
session). Stashes, uncommitted state, and all audit artifacts preserved.
