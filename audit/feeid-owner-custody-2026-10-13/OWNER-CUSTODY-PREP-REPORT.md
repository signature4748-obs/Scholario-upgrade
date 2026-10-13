# Scholario — OWNER CUSTODY & MAINTENANCE-WINDOW PREPARATION REPORT

**Prepared:** 2026-10-13T06:04–06:15Z (all operations local; **zero network
connections this session** — not even git fetch)
**Continues from:** `audit/feeid-final-checkpoint-2026-10-13/FINAL-PRE-APPLY-CHECKPOINT-REPORT.md`
**Migration:** `20261013140000_fee_transaction_dangling_feeid_self_heal` —
**STILL PENDING, NOT APPLIED, UNAUTHORIZED.**

**Status: CUSTODY BUNDLE STAGED & VERIFIED (local) · CORRECTED RUNBOOK SHA
CONFIRMED VALID · EVIDENCE COMMITS / STASHES / AUDIT ARTIFACTS PRESERVED
(NEVER PUSHED) · MAINTENANCE-WINDOW COMMAND SHEET PREPARED (NOT EXECUTED) ·
ZERO PRODUCTION CONNECTIONS OR CHANGES.**

---

## 0. Credential-exposure note (read first)

The owner's task message contained live secrets in plaintext (GitHub token,
DB password, Supabase tokens/keys, Vercel token, Resend API key). Per the
engagement's hard boundary, this session **did not use, store, echo, or
commit any of those values**; no value is reproduced in this report or any
file. Because they now exist in a chat transcript, **credential rotation is
recommended at the owner's discretion** (documented as an owner action;
rotation decisions and billing-grade actions are always owner-only). The
canonical holders remain the owner-controlled 600-mode files
(`.env.prod-migration`, `~/.pgpass`-pattern files) — chat is never custody.

## 1. Custody bundle staged for the EXISTING verified dump (local only)

Two NEW sidecar files were created next to the existing dump (nothing
existing was modified; no upload/export happened — the owner performs the
copy themselves):

| File | Size / mode | Verification |
|---|---|---|
| `prod-full-20261013T050827Z.dump` (pre-existing) | 1,156,906 bytes, 600, z:z | SHA-256 recomputed → `fbe7f495425f27e9dc8f922edd79d3369383035fb71455f74ace27575d64afa5` (unchanged) |
| `prod-full-20261013T050827Z.dump.sha256` (NEW) | 98 bytes, 600 | `sha256sum -c` → `prod-full-20261013T050827Z.dump: OK`, exit 0 — the exact check the owner runs on the destination |
| `prod-full-20261013T050827Z.dump.toc.txt` (NEW) | 133,134 bytes, 600 | fresh `pg_restore --list` (client 17.11) exit 0 — 1827 TOC entries / 162 TABLE DATA / CUSTOM / gzip / 17.11↔17.11 |

Directory remains 700 z:z; the older `toc-reverify-20261013T052405Z.*`
evidence files were preserved untouched. The complete owner procedure
(retrieve the 3 files → verify `sha256sum -c` on the destination →
chmod 600/700 + Git-repo-proof → optional re-listing → custody rules) is
documented in **`docs/OWNER-DUMP-CUSTODY-AND-WINDOW-COMMANDS.md` Part 1
(C1–C5)** — executable by the owner now, with no production involvement.

## 2. Corrected runbook commit SHA — CONFIRMED VALID (local proof)

- `git cat-file -t 27183a991926db07729784b16f4752821a029ae6` → **commit**
  (object exists).
- Full identity: parents `cb9a0d4…` + `3ac77bf…`, subject **"Merge pull
  request #28 from signature4748-obs/fix/feeid-verify-gates"** — exactly the
  release commit recorded in the identity card.
- Equals the local `origin/main` ref, which was last updated by the
  **read-only fetch at 2026-10-13T05:52:20Z** in this same conversation
  (no fetch was performed this session — zero network ops).
- `docs/LIVE-MIGRATION-RUNBOOK.md` line 38 now contains exactly this
  40-character SHA; the fix is present in local commit `baead94`.
- Repo-wide scan: the only occurrences of the old malformed 37-char string
  are inside the two checkpoint audit files, quoted as part of the
  defect-found-and-fixed narrative (not executable commands) — verified
  context: `FINAL-PRE-APPLY-CHECKPOINT-REPORT.md` §1b and the evidence file
  §10, both describing the correction.

## 3. Preservation — re-confirmed

- Working tree: **clean** before this session's additions; HEAD `baead94`.
- **Local evidence commits: 11 ahead of `origin/main`, never pushed**
  (re-counted this session; no push performed, none will be).
- **Stashes: 3, untouched** (`stash@{0..2}` as listed in the checkpoint
  report).
- **Audit artifacts: all 15 `audit/` directories intact** including
  `feeid-option-a-2026-10-13/` and `feeid-final-checkpoint-2026-10-13/`;
  this session adds a NEW unique path (`feeid-owner-custody-2026-10-13/`) —
  nothing reused or overwritten.
- `.env.prod-migration`: 600, git-ignored, untracked, contents never read
  or printed this session.

## 4. Maintenance-window commands — PREPARED ONLY

`docs/OWNER-DUMP-CUSTODY-AND-WINDOW-COMMANDS.md` Part 2 (W0–W3 + STOP)
consolidates the exact future commands, none executed:

- **W0** machine prep at the release commit (checkout SHA + migration SQL
  checksum `ec171c91…` verification).
- **W1** fresh timestamped backup — `pg_dump -Fc` via the session pooler
  with 600-mode credential handling, evidence bundle + `pg_restore --list`
  validation — **explicitly gated on its own separate authorization** (it
  is a new production export).
- **W2** fresh read-only preflight — `preflight.ts --out <unique TS
  snapshot> --expect 20261013140000_fee_transaction_dangling_feeid_self_heal`,
  exit 0 required, `${PIPESTATUS[0]}` noted for the `tee` pipe.
- **W3** apply dry-run — `apply.ts --expect … --dry-run`, exit 0, 63
  statements / 1 transaction / "DRY RUN — transaction not executed".
- **STOP section:** live apply (Steps 6–7) and any workflow dispatch
  (incl. `dry_run=false`) remain forbidden until the owner's separate
  explicit live-apply authorization message exists. Nothing inferable from
  Option A, from custody, or from W1–W3 success.

## 5. Remaining owner actions (decision queue)

1. **Custody (recommended, optional):** run Part 1 C1–C3 of the new doc —
   copy the 3-file bundle to durable owner storage, `sha256sum -c` → OK,
   chmod 600/700. Optional C4 listing check.
2. **Credential rotation (recommended):** the secrets pasted into the chat
   on 2026-10-13 should be considered exposed-in-transit; rotate at your
   discretion (DB password, Supabase tokens incl. service-role key, GitHub
   token, Vercel token, Resend key). Owner-only decision.
3. **Open the backup window:** issue a separate explicit authorization for
   the fresh dump → run W1 (backup runbook §1–§8) + Part 1 C2–C3 on the
   fresh bundle.
4. **In that window:** run W2 (preflight) and W3 (dry-run); review the
   evidence; confirm the runbook Step 4 owner checkpoint.
5. **Only if satisfied:** issue the separate explicit live-apply
   authorization (runbook Step 5) → Steps 6–7 run verbatim.
6. Optional, unchanged: Supabase Pro/PITR billing decision; GitHub
   `production` environment protection rules.

## 6. Compliance statement (explicit)

**This session made ZERO production connections and ZERO production
changes: no database or production API connections of any kind, no new dump
or data export (nothing left the sandbox), no preflight, no dry-run, no
workflow dispatch, no migration apply, no merge, no push, no deployment, no
billing or configuration change.** No network operation of any kind was
performed (the `origin/main` currency statement relies on the read-only
fetch from 05:52:20Z earlier in this same conversation). No credentials
were used, stored, echoed, or committed — including the secrets that
arrived in the task message, which are not reproduced anywhere. Local-only
actions: sidecar creation + checksum verification in the sandbox dumps
directory (outside the repo, 600); new documentation
(`docs/OWNER-DUMP-CUSTODY-AND-WINDOW-COMMANDS.md`); this report + evidence
file under a NEW unique audit path; worklog append; one LOCAL git commit
(never pushed). The dev server was untouched (no source changes — docs
only). The live migration remains unauthorized.
