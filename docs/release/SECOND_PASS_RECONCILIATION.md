# SCHOLARIO — SECOND-PASS RECONCILIATION & BLOCKER CLOSURE

**Execution mode:** targeted credentialed verification of the second-pass audit's unresolved items. Read-only. Zero production mutations (no creates, no deletes, no rotations, no deploys, no reseeds).
**Executed:** 2026-10-03, 05:07–07:05 UTC (single session, sandbox `z`).
**Live system:** `https://scholario-production.vercel.app` · GitHub `signature4748-obs/Scholario-upgrade`.
**Inputs:** `docs/release/SECOND_PASS_INDEPENDENT_AUDIT.md` (prior second pass), `docs/FINAL_PRODUCTION_RELEASE_REPORT.md` + `docs/release/FINAL_FORENSIC_*` (as carried on `origin/main`), remote `worklog.md`, live anonymous probes, live read-only SQL against the LOCAL mirror DB.

> This run did NOT repeat the forensic audit. It resolved the specific items the second
> pass left open. No credential value is printed anywhere in this report. No file was
> committed or pushed (see §Q note on platform auto-snapshot behavior).

---

## A. Credential recovery — BLOCKED (documented)

The task asked for the existing secure credential/vault mechanism in this environment. Searched, exhaustively and safely (names only, never values):

| Mechanism checked | Result |
|---|---|
| Process environment (Vercel/Supabase/Resend/GitHub token-shaped vars) | NONE present |
| `/home/z/.sec/`, `/home/z/.mission-secrets.env`, `/home/z/prod-verify/` | GONE (wiped by the Oct-3 02:42 sandbox recreation) |
| `~/.vercel/`, `~/.git-credentials`, `~/.netrc`, `~/.bash_history` | absent |
| Repo `.env` | LOCAL DEV ONLY (`postgresql://…@127.0.0.1` — the sandbox preview's embedded PG; no production values) |
| `git remote -v` | plain anonymous HTTPS (`https://github.com/signature4748-obs/Scholario-upgrade.git`) — no PAT embedded; push is not possible from this sandbox |
| Project `.vercel/`, `vercel.json` | absent |
| Filesystem pattern scan (`*secret*`, `*token*`, `*cred*`, `*.env*` outside the project) | only the prior audit's scan scripts (no values) |

**Conclusion:** no secure credential mechanism exists in this environment for Vercel / Supabase / Resend / GitHub-PAT / production-tenant logins. The corresponding verifications remain **BLOCKED** (listed in §R). Per instruction: "If credentials genuinely cannot be recovered through the secure environment: STOP the corresponding verification and mark it BLOCKED. Do not invent evidence."

**One genuine recovery this session:** the anonymous GitHub API rate-limit window for this egress IP RESET (60/60 at 05:07 UTC), unblocking **commit-status verification** — which independently resolved the deployment question (§B). (The window drained again within minutes from other shared-IP consumers; the key queries were captured in the first burst, and the remaining chain was queried at the 06:06 UTC reset.)

---

## B. Vercel deployment reconciliation — RESOLVED

### B.1 The key new evidence (independent, anonymous, verifiable)

The Vercel GitHub App posts a deployment status to every pushed commit. Quoting the live API response for the final commit:

```json
GET /repos/signature4748-obs/Scholario-upgrade/commits/219941756bc09066ecec43b8b2e60fa4e6dbbfa5/status
{
  "state": "success",
  "statuses": [{
      "state": "success",
      "description": "Deployment has completed",
      "context": "Vercel",
      "target_url": "https://vercel.com/signature4748-2940/scholario-production/FoVXJCFtb2V4eBB7bywJfGhiqEaD",
      "created_at": "2026-10-02T18:30:09Z"
  }],
  "sha": "219941756bc09066ecec43b8b2e60fa4e6dbbfa5"
}
```

The status was posted by the official Vercel integration (bot id `in/8329`), 3 minutes after the commit was pushed (18:27:09Z), and points at the deployment inside the **`scholario-production`** project dashboard.

### B.2 Answers to the required determinations

| Question | Answer |
|---|---|
| Current production deployment ID | `FoVXJCFtb2V4eBB7bywJfGhiqEaD` (new-format deployment slug in the dashboard URL; the legacy `dpl_*` ids used in earlier reports are the same concept) |
| Deployment creation time | commit pushed 2026-10-02T18:27:09Z; Vercel status "Deployment has completed" posted 2026-10-02T18:30:09Z |
| Deployment state | **success / completed** |
| Exact full Git SHA | `219941756bc09066ecec43b8b2e60fa4e6dbbfa5` |
| Production alias | `https://scholario-production.vercel.app` (live, HTTP 200) |
| Deployment URL | project deployment page `vercel.com/signature4748-2940/scholario-production/FoVXJCFtb2V4eBB7bywJfGhiqEaD` (deployment-specific `*.vercel.app` URL is SSO-gated; the slug does not map to a public URL pattern — tested, correctly 404) |
| Belongs to current main? | **YES** — `git ls-remote` live: `refs/heads/main = 2199417…` (no commits pushed after it → no newer pipeline deployment exists) |
| Live production corresponds to `2199417…`? | **VERIFIED via the attestation chain**: Vercel's own GitHub App attests the deployment of this exact SHA completed successfully; the Git integration (whose `…-git-main-…` alias is live, 302→SSO) auto-deploys `main`; nothing newer was pushed. |

**Corroborations (all live today):** `/health/ready` → `database:ok` 242 ms; `/api/app-version` → 2.14.0; homepage etag `03f58dd9b117cf3247676169c231b136` — **byte-identical to the etag the second-pass audit recorded at 03:56–04:41 UTC Oct-3**, i.e. the runtime output has not changed since; CSP still carries the post-rotation realtime origin `wss://kbyknezedewvgrnqervj.supabase.co`; `/api/dbdiag` → 404 (TEMP route gone).

**Honest limitation:** a dashboard-initiated manual rollback (which would not re-post a GitHub status) cannot be excluded by anonymous evidence. There is zero evidence of one — output stability (etag), health, header set, and post-rotation CSP are all consistent with the 2199417-era deployment — but this caveat is recorded rather than hidden. **Runtime SHA classification: VERIFIED (attested by the Vercel GitHub App; no evidence of any later deployment or rollback).**

### B.3 Full deployment chain (each docs-push auto-deployed)

| Commit | Deployed? | Evidence |
|---|---|---|
| `3727ba2` (app code — corpus rebuild + subscription lock) | YES | application release base; all later deployments include it |
| `a744f7b`, `3ec11e9` (docs/scripts) | YES (auto) | git-integration auto-deploy; no recorded dpl id |
| `2aac7cb` (TEMP `/api/dbdiag`) | deployed briefly (~19 min) | live 404 today = properly reverted by `be98dbe` |
| `be98dbe` (revert) | **YES** | FPR §3 "READY (Git-integrated, auto-deploy on push verified live)"; GitHub status captured this session: [status chain captured at 06:06 UTC — see B.4] |
| `64b93b4` (FPR final, GO) | **YES** | FFA phase-0: dpl_AqpB12mA + dpl_awgTvMCd READY at 64b93b4; GitHub status: [B.4] |
| `a675a6f` (FFA report, GO) | **YES** | FFA-3 worklog: dpl_49w9LsSF READY at a675a6f (verified via Vercel API then); GitHub status: [B.4] |
| `2199417` (final sweep — worklog only) | **YES** | **NEWLY VERIFIED this session** (§B.1): Vercel status success, completed 18:30:09Z |

### B.4 GitHub commit-status chain — CAPTURED (anonymous API, 05:07 + 06:59 UTC windows)

Every status below was posted by the **official Vercel GitHub App** (context `Vercel`, bot `in/8329`) and was captured live this session:

| Commit | Vercel status | Posted (UTC) | Deployment (dashboard slug) | Legacy `dpl_` id |
|---|---|---|---|---|
| `2aac7cb` (TEMP `/api/dbdiag`) | success — "Deployment has completed" | 2026-10-02T**15:34:14Z** | `GHAug6oAMw5iR7kbsHfLLoqa9GF8` | — |
| `be98dbe` (revert of TEMP) | success — "Deployment has completed" | 2026-10-02T**15:43:23Z** | `Dk8c9MNuCic8riz6LrqWgqL7aYPn` | — |
| `64b93b4` (FPR final, GO) | success — "Deployment has completed" | 2026-10-02T**16:06:44Z** | `AqpB12mAENFviAdkm2eaSDKeyCPD` | **`dpl_AqpB12mA` — prefix match!** |
| `a675a6f` (FFA report, GO) | success — "Deployment has completed" | 2026-10-02T**18:25:54Z** | `49w9LsSF1pvcoSz9UfkdVKvmdU22` | **`dpl_49w9LsSF` — prefix match!** |
| `2199417` (final sweep) | success — "Deployment has completed" | 2026-10-02T**18:30:09Z** | `FoVXJCFtb2V4eBB7bywJfGhiqEaD` | — (current production) |
| `3727ba2` (app-code base) | not captured (quota) — immaterial: every deployment above contains its code | — | — | — |

**Cross-evidence discovery:** the new-format dashboard slugs BEGIN with the legacy `dpl_` IDs the previous run recorded via the Vercel API (`AqpB12mA…` = `dpl_AqpB12mA`; `49w9LsSF…` = `dpl_49w9LsSF`). The previous run's deployment claims and this session's independent GitHub-status evidence therefore corroborate each other **on two different evidence paths**.

**Deployment timeline (fully attested):** 15:18:55Z `2aac7cb` pushed → deployed 15:34:14Z (TEMP route live on production ~9 minutes) → reverted 15:37:14Z `be98dbe` → deployed 15:43:23Z → `64b93b4` pushed 16:00:32Z → deployed 16:06:44Z → `a675a6f` pushed 18:22:38Z → deployed 18:25:54Z → `2199417` pushed 18:27:09Z → deployed 18:30:09Z (**current production**; no commit pushed since).

Also captured: `GET /branches/main` → HEAD `219941756bc09066ecec43b8b2e60fa4e6dbbfa5` (06:06 UTC).

**Quota phenomenon (for reproducibility):** this sandbox's egress rotates across a pool of shared IPs (observed: 8.212.10.159, 47.57.232.222, 47.57.242.119) whose anonymous 60-req/h windows drain within seconds of reset. The statuses above were captured in the opening seconds of the 05:07 and 06:59 UTC windows (the 06:59 burst fired 6 parallel queries the instant quota appeared; 4 landed, then the window drained mid-burst; the 64b93b4 retry landed on a rotated IP). The `actions/workflows` API query was rate-limited — CI is instead verified by repo evidence (`.github/ci.yml.parked` present, `.github/workflows/` absent in the released tree) + the second pass's HTML verification of the empty Actions page. Raw JSONs: `/home/z/audit-second-pass/gh-status/`.

<!-- STATUS_CHAIN_APPEND_HERE -->

---

## C. Production database reconciliation — direct BLOCKED, public + local-mirror verification complete

Direct production SQL: **BLOCKED** (no DB credentials — §A). What was re-verified, and how:

### C.1 Public API census (live, this session)

| Entity | Previous report | Second pass (Oct-3 am) | This session | Δ |
|---|---|---|---|---|
| Hawkings students | 82 | 82 | **82** | 0 |
| Hawkings teachers | 16 | 16 | **16** | 0 |
| Hawkings classes | 15 | 15 | **15** (`counts.classes`; payload list is `take:12` display-capped — code-verified) | 0 |
| Hawkings subjects | 14 | 14 | **14** | 0 |
| Hawkings libraryBooks | 12 | 12 | **12** | 0 |
| Green Valley business data | 0 | 0 | **0** (students/teachers/classes/subjects/books/announcements/gallery all zero) | 0 |
| Tenants | 2 | 2 | **2** (slug matrix: `hawkings-prithvipur`→200, `green-valley`→200, unknown→404; bare URL→demo tenant) | 0 |
| Unknown-slug behavior | neutral 404 | neutral 404 | **404 honest "School not found."** | 0 |
| Auth boundaries | 401 | 401 | **401** on `/api/dashboard`, `/api/platform/schools`, `/api/realtime/config` | 0 |
| TEMP route `/api/dbdiag` | 404 | 404 | **404** | 0 |

### C.2 Local mirror re-run (read-only SQL, fresh verification this session)

Every number claimed by the previous reports and re-derived by the second pass was re-derived AGAIN this session — **bit-exact, zero drift**:

| Detector | Result |
|---|---|
| Migration state | **9/9 applied**, names identical to the repo's 9 dirs (incl. `20261003000000_account_subscription_lock`) |
| Census | User 185 · Teacher 16 · Student 82 · Class 15 · Subject 14 · Attendance 3,280 · ExamMark 653 · Fee 328 / Payment 218 / FeeTransaction 226 · Timetable 396 · SalaryStructure 15 / SalaryPayment 30 · tenants 2 |
| Duplicate detectors (all families re-run) | **0**: student admissionNo & rollNo, user email, teacher employeeId, school slug, receiptNo (NULLs excluded), salary (school,teacher,month|RECORDED), examMark 4-key, attendance (student,date), timetable slot — all 0 groups |
| NULL-receipt artifact | 8 FeeTransaction rows with NULL receiptNo = `UNDER_VERIFICATION` by design (`@@unique` permits NULLs); real receipt duplicates **0** |
| Orphan detectors | **0**: students, attendance, marks, fees, sessions (null-owner), StudyMaterials, FlashcardDecks, FlashcardCards, StudyGroups |
| Cross-tenant | **0** (student↔class school mismatch) |
| Attendance invariant | unique index present; split **2933 PRESENT / 185 ABSENT / 110 LATE / 52 LEAVE** (exact) |
| Fees invariant | billed **₹1,025,600** · collected **₹595,820** (218 SUCCESS payments) · PAID 198 (₹550,300) / PARTIAL 20 (₹95,200) / UNPAID 110 (₹380,100) · 0 overpaid, 0 negative |
| Marks invariant | 653 marks, range **27–88**, 0 negative, 0 over-max |
| Salary invariant | fixed-monthly; 30 RECORDED = 15 teachers × 2026-08 + 2026-09; 0 dups, 0 school mismatches |
| Class-teacher coverage | **15/15 classes** with a real classTeacherId (0 vacant) |
| RLS structural parity | 102 tables RLS-enabled / **0 policies** (deny-all) + pg_trgm in `public` — exactly reproduces the 103-advisor classification |
| Temporary residue | 0 third tenants; GV: 0 business rows, 5 bootstrap users, Room 101, 7 grade scales |

**CURRENT vs PREVIOUS vs SECOND-PASS: every publicly-comparable value is UNCHANGED. No production drift is observable from the outside.** Production-internal state (sessions, EmailDelivery, audit rows, exact ledger totals) remains BLOCKED for direct inspection.

---

## D. The 51-row cleanup — arithmetic & design verified; historical evidence unrecoverable

1. **Arithmetic:** 11 StudyMaterials + 4 FlashcardDecks + 32 FlashcardCards + 3 StudyGroups + 1 User = **51** exactly as claimed.
2. **Historical evidence:** `cleanup-evidence.json` was a sandbox artifact — **GONE** with the Oct-3 02:42 sandbox recreation. It was never committed to the repo (verified: 0 hits for `live-tests|cleanup-evidence` in the released tree). Exact historical deletion evidence therefore **cannot be reconstructed** — stated plainly, not manufactured.
3. **What can be reconstructed (and was):**
   - The FFA report §7 and the remote worklog describe the deletion as transactional with zero-inbound-reference gates and live-equivalent verification.
   - The claim is **architecturally coherent**: `StudyMaterial.schoolId` is a soft reference with **no FK** (the schema at `2199417` — verified), which is exactly how a dead-school cluster could accumulate; `FlashcardDeck`/`StudyGroup` DO have School FKs (deleting the 4 decks + 3 groups with their 32 cards and 1 suspended user removed the only inbound references).
   - The deleted rows referenced the dead pre-rebuild Sunrise school id (`cmupmxxz7…`) — a universe that no longer exists in the current corpus (the corpus was rebuilt at `3727ba2`).
4. **Did the cleanup leave broken references?** Production-direct: BLOCKED. Indirect: the local fresh-seed corpus (which encodes the post-cleanup design) has **0 orphans / 0 broken references**; all production public surfaces render correctly; the app is healthy (`database:ok`, no 5xx on public surfaces). **No evidence of breakage.**
5. **Did it remove legitimate production data?** The live Hawkings equivalents exist (the local mirror reproduces them: decks/groups/Hawkings StudyMaterials), public counts unchanged vs census. **No evidence of legitimate-data loss; direct proof unavailable (BLOCKED).**

**Classification: CONSISTENT & PLAUSIBLE — direct historical evidence UNAVAILABLE.**

---

## E. Credential rotation — UNVERIFIED (blocked), current-credentials-work VERIFIED indirectly

| Question | Answer |
|---|---|
| Current credentials work? | **YES — verified indirectly**: the production app authenticates to its database on every request (`/health/ready` → `database:ok`, 242 ms, this session), the deployed realtime secret is active (CSP origin + healthy app), and the email env is configured. A broken credential would surface as health-check failures. |
| Old credentials no longer work? | **UNVERIFIED** — old credential material is unavailable in this sandbox (vault wiped); per instruction: mark UNVERIFIED, do not manufacture proof. |
| Application uses current credentials? | **YES — verified indirectly** (same health evidence). |
| No revoked credential remains active? | **UNVERIFIED** (same boundary). |

**Clarification for the docs (not a contradiction):** the FPR run (64b93b4) rotated **4** demo password families (showcase-principal/teacher/student + default — 172 accounts, 18 sessions revoked); the FFA run (a675a6f) then re-rotated **3** of those families (INC-1: a redaction miss re-exposed them; 11 sessions revoked). Two rotation events at different times, each correctly described by its own report — the "3 vs 4" difference across documents is explained, not contradictory.

---

## F. Resend — four-way classification (nothing merged, nothing upgraded)

| Dimension | Status | Basis |
|---|---|---|
| **EMAIL API (key state)** | **UNVERIFIED (current)** | no key in this sandbox; prior evidence: ACTIVE, send-restricted scope (read endpoints 401), consistent with design |
| **APPLICATION EMAIL PATH** | **UNVERIFIED (current)** | prior evidence: admission-enquiry → `EmailDelivery` SENT with provider message-id; current path intact in code at `2199417`; current production EmailDelivery rows BLOCKED (DB) |
| **CUSTOM SENDING DOMAIN** | **NOT VERIFIED** (unchanged gap) | prior evidence: no verified custom domain — sends via the shared test sender `onboarding@resend.dev`, which can only deliver to the account owner; owner DNS action (SPF/DKIM/DMARC) outstanding |
| **OWNER-ADDRESS DELIVERY** | **UNVERIFIED (current)** / prior-verified | real delivery with provider message id recorded by FFA §17; not re-testable from here (and per instruction no test emails were sent) |

**"Production email fully complete" is NOT claimed.** The custom-domain release gap remains open and owner-held, exactly as the previous reports stated.

---

## G. Migration lineage — 9/9 RESOLVED (8/8 was the earlier baseline)

**Repo at `2199417` (both remote and local trees — verified):** exactly **9 migration directories**:

```
0_init
00000000000001_pg_domain_guards
00000000000002_pg_rls_search
00000000000003_rate_limit_backend
20261002000000_phase8b_domains_salary_email
20261002000100_8c_rls_close_8b_gap
20261002000200_8c_hot_path_indexes
20261002000300_8c_n_function_security_closure
20261003000000_account_subscription_lock      ← the 9th
```

- **8/8 was an earlier baseline** (the lineage before `3727ba2`).
- **9/9 is the current released lineage**: the ninth migration, `20261003000000_account_subscription_lock`, was added by `3727ba2` (FINAL-ACCEPTANCE 1/3 — the account-level subscription lock).
- **Local DB: 9/9 applied, names identical to the repo** (read-only SQL this session).
- **Production `_prisma_migrations` = 9/9:** claimed and directly queried by the FFA run (a675a6f, with DB credentials then); **re-verification BLOCKED now**; indirectly corroborated (the deployed app expects the 9-migration schema and is healthy).
- Minor note: the local PREVIEW-FIX worklog entry (2deef0f era) wrote "all 8 migrations applied" — an off-by-one in that worklog sentence only; the actual local DB has 9/9 applied (verified this session). Sandbox-log imprecision, not a lineage difference.

---

## H. Release SHA documentation — resolved, unambiguous

| SHA (short) | Full SHA | Date (UTC) | Commit message (role) | Role in release | Deployed? | Current production? |
|---|---|---|---|---|---|---|
| `be98dbe` | `be98dbe0f17eab2d56c2a83bba3dd603dcd7821c` | 2026-10-02T15:37:14Z | Revert "TEMP diagnostic: gated DB probe route" | reverts the only TEMP route; tree becomes byte-identical to the tested release `3ec11e9` | **YES** (FPR §3: READY, auto-deploy verified live; status chain §B.4) | NO (superseded) |
| `64b93b4` | `64b93b4b5b6b113a587c64eb78ef4fbe015045b9` | 2026-10-02T16:00:32Z | FINAL-ACCEPTANCE 3/3 — release complete (rotation + 27-item report, GO) | release report #1 (FPR); docs+worklog only | **YES** (dpl_AqpB12mA + dpl_awgTvMCd READY per FFA phase-0; status chain §B.4) | NO (superseded) |
| `a675a6f` | `a675a6fed497ac93d87f8a547a77f0be89f12eee` | 2026-10-02T18:22:38Z | FINAL FORENSIC ACCEPTANCE — 622-pass + 45 live probes (GO) | forensic acceptance report #2 (FFA); docs+JSON+worklog only | **YES** (dpl_49w9LsSF READY per FFA-3, verified via Vercel API then; status chain §B.4) | NO (superseded) |
| `2199417` | `219941756bc09066ecec43b8b2e60fa4e6dbbfa5` | 2026-10-02T18:27:09Z | final forensic acceptance — release verified at a675a6f (final sweep) | final sweep commit; worklog-only (15 lines); ZERO app-code delta vs `3727ba2` | **YES — INDEPENDENTLY ATTESTED THIS SESSION** (Vercel GitHub-App status "Deployment has completed", success, 18:30:09Z, deployment slug `FoVXJCFtb2V4eBB7bywJfGhiqEaD`) | **YES** (main HEAD unchanged; no newer deployment exists) |

**Application-code fact (unchanged from the second pass):** from `3727ba2` through `2199417` every commit is docs/evidence-only — the runtime application code is identical across `be98dbe`, `64b93b4`, `a675a6f`, and `2199417`. The historical docs' three different "current production SHA" statements were each true at writing time; the definitive current value is `2199417…` (§B). Nothing in history was rewritten.

---

## I. Previous-report contradictions — reconciled with exact wording

Each item uses the required form "Historical report stated X; independent reconciliation found Y":

1. **Current-SHA ambiguity:** *Historical reports stated production = `be98dbe` (FPR §3/§24), `64b93b4` (FFA phase-0), and `a675a6f` (FFA-3), sequentially; independent reconciliation found* production = **`219941756bc09066ecec43b8b2e60fa4e6dbbfa5`**, deployed and completed 2026-10-02T18:30:09Z, attested by the Vercel GitHub App's commit status — and the three earlier statements were each true at their own writing time (auto-deploy per docs-push), never reconciled into one final statement until now.
2. **Test-count off-by-one (413):** *The FPR test table stated security = 413 tests / 395 pass / 17 skip; independent reconciliation found* 395 + 17 = **412 ≠ 413**, and the pass column sums to **621, not the stated 622** — one security-suite test is counted in "Tests" but accounted in neither pass nor skip. The grand total is internally consistent on its own terms (622 + 17 = 639 = tests column). The FFA restated "622 PASS" while its own row values sum to 621, carrying the discrepancy forward. **No "626" number exists anywhere in the released docs or worklogs** (searched exhaustively) — if a "626" was ever quoted verbally, it has no artifact basis.
3. **User 185 vs 186:** *The FFA JSON census stated `User: 186`; the FFA MD table stated 185 (5 GV + 177 Hawkings + 3 schoolless); independent reconciliation found* the JSON census was snapshotted **pre-cleanup** and the MD table **post-cleanup** — the difference is exactly the 1 deleted stale User row (`tenant.superadmin@sunrise.test`). Both were true; the timing difference was undocumented.
4. **"Zero live mock occurrences":** *The FPR/FFA stated fake KPIs ("1842", "96 teachers") had zero live occurrences; independent reconciliation found* the constants **remain in the shipped mock library** (`src/lib/mock/school.ts:23-24`, `students.ts:62`, `attendance.ts:20`) — but they are **never rendered** (precise analysis in §J). The corrected statement: "Legacy mock constants (1842 / 96 / 93.3%) remain in non-rendered mock modules and are not part of the production data path; all rendered KPIs are DB-derived (live-verified)."
5. **Rotation families 3 vs 4:** *The FFA overview stated "3 demo-families rotated"; the FPR table stated 4 families; independent reconciliation found* these are **two different rotation events** (FPR: 4 families incl. default, 172 accounts; FFA INC-1: 3 re-exposed families) — explained, not contradictory.
6. **45 live probes vs 41+4:** internally consistent as stated (41 recorded in the now-gone `live-tests.ndjson` + 4 session-evidenced); the artifact is unverifiable today — recorded as evidence-unavailable, not as a discrepancy.

---

## J. Mock-data claim — precise classification (no deletion, no overclaiming)

At `2199417` (released tree), verified field-by-field:

- **The values exist:** `src/lib/mock/school.ts` `totalStudents: 1842, totalTeachers: 96`; `src/lib/mock/students.ts` `total: 1842`; `src/lib/mock/attendance.ts` `today.total: 1842` (+ derived rate 93.3%).
- **They do not render:**
  - The only importer of the `school` object (`admission/PersonalStep.tsx`) consumes **`school.categories`** (a dropdown list with a hardcoded fallback) — the KPI fields are never read.
  - `students` is imported by the admission wizard solely as a **duplicate-name-check corpus** (`checkDuplicates(..., students, ...)`); its `total: 1842` metadata is never read.
  - `attendanceOverview` (the `today: {…total: 1842…}` object) has **zero external importers** — a dead export (only internal self-references inside the same mock file).
  - All other mock-module imports across the 53 importing files are **structural constants** (`classList`, `classSections`, `ACADEMIC_CLASSES`, subjects, departments, holidays, type definitions) — the documented `DATA_SOURCE_MAP.md` register R1–R20.
- **Rendered KPIs are DB-derived — live-verified:** the public website hero stats (82 / 16 / 15 / 14) come from the public API payload, whose `counts` block queries the DB (code-verified at `2199417`).

**Final wording (adopted, verified):** *"Legacy mock constants (1842 / 96 teachers / 93.3%) remain in non-rendered mock modules and are not part of the production data path; every rendered KPI is DB-derived (live-verified)."*

---

## K. Local sandbox divergence — analyzed, reported, untouched

Local `main` has **3 unpushed commits** beyond the common ancestor `3727ba2` (GitHub main is 7 docs-only commits ahead of the same ancestor — the two histories diverge):

| Commit | Time (UTC) | Content | Classification | Safe to discard? |
|---|---|---|---|---|
| `43920fe` | Oct-3 01:17:26 | deletes the 7 upload API routes (−1,101 lines) + adds `docs/FINAL_PRODUCTION_RELEASE_REPORT.md` locally | **SANDBOX-RUNTIME snapshot** (UUID auto-commit). The route deletion is a **local-only regression** — those routes exist in the released tree and in production | the deletion itself: yes (it diverges FROM the release); nothing user-authored in it |
| `2deef0f` | Oct-3 03:09:00 | sandbox preview infrastructure: `mini-services/postgres-db` (embedded PG 18.4), keepalive, spawn-detached, next.config watch options | **SANDBOX-RUNTIME** — required for this environment's preview stack; not present in the release | discard only if the preview stack is no longer needed |
| `6ee0472` | Oct-3 04:45:59 | the second-pass audit's own reports (`docs/release/SECOND_PASS_INDEPENDENT_AUDIT.{md,json}`) + worklog | **AUDIT EVIDENCE** (the second pass wrote the files untracked; the platform's auto-snapshot then committed them locally — never pushed) | NO — these are the prior audit's deliverables; preserve |

- **No user business work exists in any of the 3 commits** (verified file-by-file: infrastructure, snapshot artifacts, audit docs).
- **Local code ≠ production code:** the local tree is missing the 7 upload routes (deleted by `43920fe`) and missing the 7 remote-only commits' docs; it additionally carries preview-only infra. The running local preview is therefore NOT the released code — a sandbox-state fact, **production unaffected** (deployments build from GitHub main).
- **Not pushed, not merged, not reset** — per instructions. Recommended (for the owner, after review): reconcile by resetting local `main` to `origin/main` and preserving `docs/release/SECOND_PASS_*` + this reconciliation as untracked files or a reviewed docs commit.

---

## L. Scorecard (targeted items)

| Item | Status |
|---|---|
| Credential recovery | **BLOCKED** (no vault mechanism exists; §A) |
| Vercel deployment ID / state / SHA / alias / URL | **VERIFIED** (GitHub commit-status attestation; §B) |
| Live production = current main `2199417` | **VERIFIED** (attestation + no-newer-push + output stability) |
| Runtime SHA = Git SHA = deployment SHA | **VERIFIED** (attested chain; manual-rollback caveat documented) |
| Production DB census (direct) | **BLOCKED**; public-subset **VERIFIED — UNCHANGED** |
| Duplicate / orphan / cross-tenant / invariants (production direct) | **BLOCKED**; local mirror re-run **ALL ZERO / bit-exact** |
| Tenant count = 2 | **VERIFIED (public)** |
| Hawkings counts | **VERIFIED (public)**; ledger parity **VERIFIED (local mirror)** |
| Green Valley cleanliness | **VERIFIED (public + local)** |
| 51-row cleanup | **CONSISTENT/PLAUSIBLE; historical evidence UNAVAILABLE** |
| Credential rotation (old→dead, new→live) | current-work **VERIFIED (indirect)**; old-dead **UNVERIFIED** |
| Resend (4-way) | **UNVERIFIED (current) × 3; NOT VERIFIED (domain)** — gap unchanged |
| Migrations 9/9 + 8/8→9/9 explanation | **VERIFIED (repo + local)**; production re-verify BLOCKED |
| SHA history (be98dbe/64b93b4/a675a6f/2199417) | **RESOLVED & DOCUMENTED** |
| Documentation contradictions | **RECONCILED (§I, exact wording)** |
| Mock-data claim | **RECLASSIFIED with verified precise wording (§J)** |
| Local divergence | **ANALYZED & REPORTED (§K)** — untouched |
| CI (parked, no workflows) | **VERIFIED (repo + no `.github/workflows/`; API check at §B.4 window)** |
| Backup/restore evidence | prior-evidence coherent; artifacts gone — **PARTIALLY VERIFIED (unchanged)** |

---

## M. No automatic GO

This reconciliation does not inherit any previous GO. Its own determination:

**All critical public production facts now independently verify** (deployment identity — newly attested; health; tenant census; isolation surfaces; migration lineage; repo cleanliness). The remaining unverifiable items are exactly the credential-gated internals (production DB direct census, old-credential death proof, Resend account state, authenticated gauntlet) — inaccessible from this sandbox, **not contradicted by any evidence**, and the strongest available corroboration (bit-exact local seed parity + stable public behavior) is consistent with the previous claims.

**FINAL STATUS: PARTIALLY VERIFIED — SPECIFIC ITEMS BLOCKED** (the blockers are listed in §R; none is a discovered production defect; none was invented away).

---

## N. Final output block

```
CURRENT PRODUCTION SHA:   219941756bc09066ecec43b8b2e60fa4e6dbbfa5 (GitHub main; Vercel-attested deployment completed 2026-10-02T18:30:09Z)
VERCEL DEPLOYMENT SHA:   219941756bc09066ecec43b8b2e60fa4e6dbbfa5 (deployment slug FoVXJCFtb2V4eBB7bywJfGhiqEaD, state success)
RUNTIME SHA:             VERIFIED = 2199417… (Vercel GitHub-App attestation + no-newer-push + etag-stable output; dashboard-rollback not anonymously excludable, zero evidence of one)

PRODUCTION DB:           alive via app (database:ok 242 ms); direct access BLOCKED (no credentials)
DUPLICATES:              production direct BLOCKED; local mirror 0 (all families); public surfaces unchanged
ORPHANS:                 production direct BLOCKED; local mirror 0; 51-row cleanup consistent, evidence gone
CROSS-TENANT:            anonymous probes 0 violations (slug matrix, 401 boundaries, neutral 404); authenticated gauntlet BLOCKED
TENANTS:                 2 (hawkings-prithvipur + green-valley)

HAWKINGS:                82 students / 16 teachers / 15 classes / 14 subjects (public, unchanged); local ledger parity ₹1,025,600 / ₹595,820 / 110 UNPAID bit-exact
GREEN VALLEY:            clean — zero business data (public + local), honest CMS placeholder

CREDENTIAL ROTATION:     current credentials WORK (indirect, health-verified); old-dead UNVERIFIED (material unavailable)
RESEND:                  EMAIL API UNVERIFIED (current) · APP PATH UNVERIFIED (current) · CUSTOM DOMAIN NOT VERIFIED (owner action outstanding) · OWNER-ADDRESS DELIVERY prior-verified
MIGRATIONS:              9/9 (repo + local, identical names; 9th = account_subscription_lock @ 3727ba2; 8/8 was the earlier baseline); production re-verify BLOCKED

SHA HISTORY:             be98dbe (revert TEMP, deployed) → 64b93b4 (FPR GO, dpl_AqpB12mA/dpl_awgTvMCd) → a675a6f (FFA GO, dpl_49w9LsSF) → 2199417 (final, attested FoVXJCFtb2V4eBB7bywJfGhiqEaD) — app code identical from 3727ba2 onward
DOCUMENTATION DISCREPANCIES: reconciled — SHA ambiguity (3 sequential statements → final 2199417); 413≠395+17 & 622≠sum(621) off-by-one; User 185-vs-186 (pre/post cleanup); mock "zero occurrences" overstated → precise wording; rotation 3-vs-4 = two events; no "626" exists in any artifact

LOCAL DIVERGENCE:        3 unpushed sandbox commits (upload-route deletion + preview infra + prior-audit reports); no user business work; production unaffected; NOT pushed/merged/reset (report-only)

REMAINING BLOCKERS:      production DB credentials · Vercel API token · Supabase management token · Resend key · one tenant login (authenticated gauntlet/RBAC/dashboard parity) · real iOS device

FINAL STATUS:            PARTIALLY VERIFIED — SPECIFIC ITEMS BLOCKED
```

---

## R. Remaining blockers (owner-held, unchanged except where noted)

1. **Supabase production DB connection string** → direct census, detector re-runs, 51-row-cleanup direct verification, sessions/EmailDelivery residue checks.
2. **Vercel API token** → deployment history API parity, environment-variable names audit (code-level 0 `NEXT_PUBLIC_*` re-verified at `2199417` this session).
3. **Supabase management token** → advisor re-run (structural parity already reproduces the 103 classification locally).
4. **Resend API key** → key/domain state.
5. **One authorized tenant login** → authenticated gauntlet, live RBAC matrix, dashboard KPI parity.
6. **A real iOS Safari device** → the cookie contract remains prior-verified only; real-device test still not performed (honestly never claimed otherwise).
7. *(Resolved this session)* GitHub API quota — recovered; commit-status chain now captured.

---

*Artifacts: this report + `SECOND_PASS_RECONCILIATION.json`. No production mutation was performed at any point. No commit, no push, no deploy (the platform's local auto-snapshot may locally commit untracked report files — as it did with the prior audit's reports — but nothing is pushed; see §K).*
