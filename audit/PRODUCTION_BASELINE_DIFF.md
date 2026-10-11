# AUDIT 2/7 — PRODUCTION BASELINE DIFF
Audit date: 2026-10-09 · Method: git tree comparison (read-only)

---

## 1. Baseline definition

**Production baseline = remote `main` @ `3ae3c854b5dede47bee87671f2aa4e98101b012e`** ("test: export rate-limit probe uses a canonical role", 2026-10-08).
- Protected branch (required pull-request reviews — GitHub API, live).
- Ancestry: `37eb3fe → 7dbce14 → 28cd84b → 3ae3c85`; 211 commits total; last main push Oct 8 (the 04:33 UTC push today was the `sandbox/v2-rebuild` branch only).
- Preserved locally on branch `pr3-recovery-baseline` (exact tip match) and as fetched objects.

## 2. File-level classification — local tree (`baf93ac`) vs. baseline (`3ae3c85`)

The complete content difference is **6 files** (`git diff baf93ac 3ae3c85 --stat`: 675 insertions, 11 deletions):

| File | Class | Explanation |
|---|---|---|
| `src/app/api/school/website/upload/route.ts` (154 lines) | **DELETED vs. baseline — accidental damage** | see §3 |
| `src/app/api/teachers/upload/route.ts` (203) | **DELETED vs. baseline — accidental damage** | §3 |
| `src/app/api/teachers/upload/[fileId]/route.ts` (219) | **DELETED vs. baseline — accidental damage** | §3 |
| `src/app/api/teachers/upload/access/route.ts` (71) | **DELETED vs. baseline — accidental damage** | §3 |
| `docs/VERCEL_PROJECTS.md` | Modified — baseline is NEWER | baseline includes `28cd84b` ("legacy unified plane fails health 503 — not a rollback target" docs fix) |
| `tests/security/export-policy.test.ts` | Modified — baseline is NEWER | baseline includes `3ae3c85` ("export rate-limit probe uses a canonical role" test fix) |

**Unchanged: every other file in the repository** (all 266 API routes, all modules, schema, migrations, docs). **Uncommitted work: none** (tree clean). **No file in `main` replaces PostgreSQL/Supabase/Prisma behavior with SQLite, and no server route imports mock data** (verified: 0 `@/lib/mock` imports under `src/app/`).

## 3. The `baf93ac` amend is restore damage, not intentional work (high confidence)

Evidence chain:
1. Both `7dbce14` (baseline's docs commit) and `808bba9` (its local original) changed **only** `docs/EMAIL.md` + `scripts/dev-keepalive.mjs` (2 files, +8/−4) — matching their "docs:" message.
2. `baf93ac` is the amend of the same commit **plus the deletion of the 4 upload-route files, which existed intact at the parent `37eb3fe`** (`git ls-tree` proof) and remain intact at the baseline.
3. The repo's own history documents this exact loss class twice:
   - commit `3fd6a13` — "fix: restore teachers upload routes lost in the 43920fe cleanup";
   - `docs/FINAL_PRODUCT_EXCELLENCE_REPORT.md` §16 — "the restore tarball's `--exclude='upload'` pattern also dropped every source directory named `upload/` (7 API route files, restored byte-identical from git)".
4. The amend happened 2026-10-08 21:30, after a workspace restore class event — i.e., the tarball deleted `upload/` dirs from the tree and the deletion was committed as an "amend".

**Conclusion:** the ONLY local-only delta is damage. The correct repair (next approved gate) is to reconcile local `main` to the remote line and re-apply the legitimate docs delta (identical in both), restoring the 4 upload routes. Nothing was discarded during this audit; both histories remain preserved.

## 4. The `sandbox/v2-rebuild` branch (do-not-merge — verified)

- Orphan history (NO common ancestor with `main`): 2 commits — `e7e524d` "Initial commit" → `ac0f6fd` "sandbox: v2 rebuild — school OS on SQLite (checkpoint from isolated workspace)", dated 2026-10-09, pushed 04:33 UTC.
- Standalone SQLite rebuild (own schema, `provider` sqlite; own `src/`, 17 modules; one-click demo persona doors; Hawkings demo tenant identity mirrored).
- Its own `SANDBOX.md`: "**Do not merge into `main`** — kept as a durable checkpoint / design reference only. NOT connected to the production codebase."
- **No content of this branch exists in the working tree** (never checked out in this `.git` — full reflog search; the interim session that built it ran in this workspace before the 10:32 reset, which removed its checkout and reflog entries while preserving the earlier snapshot's `.git`).
- Audit action: none. It is correctly quarantined as a remote branch. The user's observation of its preview (demo login, "Welcome back.", dashboard not opening) is recorded in Audit 1 §4.

## 5. Workspace environment damage (env, not code)

- Current `.env` (recreated by the 10:32 bootstrap): only `DATABASE_URL=file:/home/z/my-project/db/custom.db` — invalid for the postgres provider, file does not exist.
- The application code reads **38 distinct env vars** (`RESEND_API_KEY`, `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET`, `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`, `FILE_SIGNING_SECRET`, `REALTIME_*`, `SCHOOL_GATEWAY_ENC_KEY`, `GOOGLE_OAUTH_*`, `PLATFORM_TOTP_ENABLED`, … — full inventory in Audit 5). **All are absent from the workspace** after the wipe; `.env.example` documents only 5 (DATABASE_URL, DATABASE_ENV, SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY). Values were never in the repo (by design) — restoration requires the operator's secret store.
- `db/pg` (local embedded PG cluster + seeded demo corpus): **wiped** — this is why every DB-backed API currently 500s (see Audit 4 §3).

## 6. Mock/demo data in the ORIGINAL tree (pre-existing, classified)

The repository carries a documented, intentional register of remaining non-canonical data paths: `docs/DATA_SOURCE_MAP.md` §5 (entries R1–R20). Server routes are clean; the 49 `@/lib/mock` importers are all client-side (28 components + 21 stores/search). Key entries: R3 finance statements (labeled illustrative, F-class), R4 store families (demo-gated client stores — messages/calendar/library/transport/inventory/certificates/downloads), R17 fee-domain config constants. These are the PR-3 fee-integrity backlog (Audit 6) — unchanged by any recent event (content identical to baseline).
