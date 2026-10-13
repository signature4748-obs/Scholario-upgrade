# SCHOLARIO — SECOND-PASS INDEPENDENT AUDIT (AUDIT OF THE AUDIT)

**Execution mode:** READ → COMPARE → VERIFY → REPORT (strictly read-only; zero production mutations)
**Executed:** 2026-10-03 02:5x–05:0x UTC (single session, sandbox `z`, local checkout of the repo)
**Live system under test:** `https://scholario-production.vercel.app` · GitHub `signature4748-obs/Scholario-upgrade`
**Audited reports:** `docs/release/FINAL_FORENSIC_PRODUCTION_ACCEPTANCE.md` + `FINAL_FORENSIC_ACCEPTANCE_STATE.json` (a675a6f), `docs/FINAL_PRODUCTION_RELEASE_REPORT.md` (64b93b4), FFA-1/2/3 worklog entries (a675a6f/2199417)

> The previous run's GO claims were treated as UNVERIFIED until independently reproduced.
> This second pass performed ZERO mutations: no creates, no deletes, no deploys, no
> credential operations, no Git history changes (a `git fetch` updated remote-tracking
> refs only). All production requests were anonymous GETs. All local DB queries were
> read-only SELECTs against the LOCAL mirror database.

---

## 0. Executive summary

The previous forensic acceptance run's claims were re-examined against the CURRENT live
system. What could be independently checked **verifies**; the deepest layers (production
DB census, live authenticated gauntlet, Vercel/Supabase/Resend control planes, credential
rotation) are **credential-blocked from this sandbox** and could only be re-corroborated
indirectly (via the public API surface and a bit-exact local seed parity). One claim
(mock-data "zero live occurrences") is **overstated at code level**, and the released
chain carries three sequentially-true-but-never-reconciled "current production SHA"
statements across its final documents. The runtime deployment SHA **cannot be
independently pinned** from anonymous evidence — by the mission's own rule that item is
**UNVERIFIED, not PASS**. No evidence of fabrication was found; several strong
corroborations were (exact ₹ ledger parity reproduced locally from the deterministic
seeds, exact attendance/marks distributions, exact RLS/advisor structure parity).

**FINAL INDEPENDENT STATUS: DISCREPANCIES FOUND** (none blocking operation; see §26/§27).

---

## 1. Current exact Git SHA

| Item | Value |
|---|---|
| Local branch | `main` |
| Local HEAD | `2deef0fc00e6d920f77a24a9bc847b3acaba6a3c` (2026-10-03T03:09:00Z, UUID message `820a5d04-…` — the PREVIEW-FIX sandbox-runtime snapshot) |
| origin/main (GitHub, live `git ls-remote` + fetch) | **`219941756bc09066ecec43b8b2e60fa4e6dbbfa5`** (2026-10-02T18:27:09Z, "final forensic acceptance — release verified at a675a6f…") |
| origin/development | `3727ba2bed9afe09cf83366416af0752bea42b13` |
| Working tree | clean (`git status --porcelain` empty) |
| Local vs remote | **LOCAL main IS DIVERGED**: 2 local-only commits (`43920fe`, `2deef0f`) after the common ancestor `3727ba2` |

**Local divergence detail (audit-relevant):** local `43920fe` DELETED 7 upload API
routes (`src/app/api/admissions/upload/**`, `teachers/upload/**`,
`school/website/upload/route.ts` — 1,101 lines) that ARE present in the released tree;
local `2deef0f` added sandbox preview infrastructure (`mini-services/postgres-db`,
keepalive, spawn-detached, next.config watch options). **The local preview stack runs
code that is NOT the released code** (its upload APIs 404 locally). Production is
unaffected; this is a sandbox-state fact, recorded because the previous audit's "local
main == GitHub main" identity no longer holds in this sandbox.

## 2. Previous exact SHA chain (resolved)

```
3727ba2bed9afe09cf83366416af0752bea42b13  2026-10-02T11:01:30Z  FINAL-ACCEPTANCE 1/3 — demo-tenant rebrand + corpus rebuild + account-level subscription lock   [PUSHED]
   ↓
a744f7b1e13f58b59ac7a5389de7befff402f9a9  2026-10-02T11:53:43Z  UUID auto-snapshot — +docs/FINAL_PRODUCTION_RELEASE_REPORT.md (107 lines) only              [PUSHED]
   ↓
3ec11e9bf950875834e1fcb419e4977633e546c6  2026-10-02T14:05:11Z  UUID auto-snapshot — scripts/db-perf-probe + 2 test files + worklog                    [PUSHED]
   ↓
2aac7cb2d9f53c424af36e6a183e335957f049b6  2026-10-02T15:18:55Z  TEMP diagnostic: gated DB probe route (+66 lines)                                      [PUSHED]
   ↓
be98dbe0f17eab2d56c2a83bba3dd603dcd7821c  2026-10-02T15:37:14Z  Revert "TEMP diagnostic" (−66 lines)                                                   [PUSHED]
   ↓
64b93b4b5b6b113a587c64eb78ef4fbe015045b9  2026-10-02T16:00:32Z  FINAL-ACCEPTANCE 3/3 — rotation + 27-item report (GO)                                  [PUSHED]
   ↓
a675a6fed497ac93d87f8a547a77f0be89f12eee  2026-10-02T18:22:38Z  FINAL FORENSIC ACCEPTANCE — 622/622 + 45 live probes + forensic report (GO)               [PUSHED]
   ↓
219941756bc09066ecec43b8b2e60fa4e6dbbfa5  2026-10-02T18:27:09Z  final sweep — worklog only (15 lines)                                                  [PUSHED, remote HEAD]
```

Per-commit classification:
- **`3727ba2` — APPLICATION CHANGES** (demo-tenant rebrand, corpus rebuild, subscription-lock migration `20261003000000_account_subscription_lock`, tests).
- **`a744f7b`, `64b93b4`, `a675a6f`, `2199417` — RELEASE EVIDENCE ONLY** (docs / JSON checkpoint / worklog). No application code.
- **`3ec11e9` — TESTS/SCRIPTS ONLY** (db-perf-probe script + 2 test files).
- **`2aac7cb`/`be98dbe` — add+revert pair, net-zero** (the gated `/api/dbdiag` route — TEMP diagnostic, properly reverted; live probe returns 404 today).
- **Key fact:** from `3727ba2` to `2199417` the runtime application code is **unchanged**. Any deployment ≥ `3727ba2` is behaviorally identical to the final commit. This is why behavioral probes cannot distinguish 64b93b4 / a675a6f / 2199417.

Deployment correspondence per the previous audit's OWN documents: FINAL report §3/§24 says production = `be98dbe`; FFA report says deployments dpl_AqpB12mA/dpl_awgTvMCd READY at `64b93b4`; FFA-3 worklog says dpl_49w9LsSF READY at `a675a6f`. These are sequentially true (auto-deploy per push) but never reconciled into one final statement — and **no deployment of the final commit `2199417` was ever recorded or verified by the previous run** (it was pushed 5 minutes after the final sweep, as a worklog-only commit).

## 3. Current Vercel production deployment

| Item | Value | Source |
|---|---|---|
| Project / team | `scholario-production` / `signature4748-2940` (team slug confirmed live in alias URLs) | prior evidence + alias URLs |
| Production URL | `https://scholario-production.vercel.app` | LIVE (200) |
| Runtime health | `/health/live` → ok; `/health/ready` → `database:ok` 224–235 ms (three probes 03:56–04:41 UTC) | LIVE ✓ |
| App version | `/api/app-version` → `2.14.0` (no SHA exposed — same value at all candidate commits; cannot discriminate) | LIVE ✓ |
| CSP | carries `wss://kbyknezedewvgrnqervj.supabase.co` (post-rotation realtime URL) exactly as claimed | LIVE ✓ |
| Security headers | HSTS, nosniff, Referrer-Policy, Permissions-Policy, x-request-id — full set | LIVE ✓ |
| Git integration | **CONNECTED** — the `scholario-production-git-main-signature4748-2940.vercel.app` alias exists (302 → Vercel SSO) | LIVE ✓ |
| Deployment protection | Standard — both team-suffixed aliases 302-redirect to `vercel.com/sso-api` | LIVE ✓ |
| Current deployment SHA | **UNVERIFIABLE anonymously** — `x-vercel-id` carries only per-request ids (verified: last segment differs on every request); no deployment id in any response header; Vercel API token absent/invalid in this sandbox; GitHub shows no Vercel-bot commit statuses to the logged-out page | this audit |

**Verdict (§3 of mission): RUNTIME SHA = UNVERIFIED — NOT PASS.** The strongest
anonymous evidence is: (a) production is live and healthy; (b) the git-main alias
proves auto-deploy from main, so the `2199417` push almost certainly produced the
current production deployment; (c) the app-code delta from the previously VERIFIED
deployment (`a675a6f`, dpl_49w9LsSF) to the final commit `2199417` is zero. But
"almost certainly" is not independent proof, and the previous run itself never verified
a `2199417` deployment.

## 4. Runtime SHA verification

Mechanisms examined: `/api/app-version` (semantic version only, identical since
a166188 — non-discriminating); response headers (no deployment identity; `x-vercel-id`
request-ids vary per call — verified across 8+ requests); `/api/dbdiag` (404 — the TEMP
route is gone, but that only bounds the deployment to "not at 2aac7cb"); homepage etag
`03f58dd9b117cf3247676169c231b136` + prerendered chunk names (content-derived; a
deterministic local rebuild could theoretically compare, but a production build was
deliberately NOT run in this sandbox to avoid destabilizing the live preview stack).
No new diagnostic endpoint was created, per the mission rules.

**Git SHA = Vercel SHA = runtime SHA: NOT INDEPENDENTLY PROVEN. STATUS: UNVERIFIED.**

## 5. Production database vs local database (identity matrix)

| Plane | Identity | Verified how |
|---|---|---|
| Production DB | Supabase `kbyknezedewvgrnqervj` (ap-south-1), PG 17 lineage, Supavisor transaction pooler `:6543` — **per prior evidence only**; live app reports `database:ok`; Supabase REST/realtime endpoints respond 401 "No API key" (alive, auth-gated) | anonymous probes + prior docs |
| Production tenant count | 2 (Hawkings demo + Green Valley clean) per prior census; **publicly corroborated**: both slugs resolve 200, unknown slug 404, bare URL resolves the demo tenant | anonymous API ✓ |
| Local DB | Embedded PostgreSQL **18.4** (`mini-services/postgres-db`, database `scholario`, `DATABASE_ENV=development`), migrated 9/9 + seeded `seed:demo` + `seed:clean` | direct read-only SQL ✓ |
| Local tenant count | 2 (Hawkings `isDemo=true` + Green Valley) | direct SQL ✓ |

Test-environment matrix for THIS second pass:

| Test | Environment | Database | Tenant | Result |
|---|---|---|---|---|
| Anonymous production probes (health, app-version, slug matrix, auth boundaries, headers) | production | Supabase (via app) | — | ALL PASS |
| Production browser QA (public + login pages) | production | Supabase (via app) | Hawkings/GV | PASS (0 console errors, 0 overflow) |
| Production census | production | — | — | **BLOCKED (no credentials)** |
| Local census / detectors / invariants | local | embedded PG 18.4 | Hawkings/GV | ALL RUN, results below |
| Local unit suite | local | none (DB-free) | — | 88/88 PASS |
| Local full matrix re-run | local | — | — | **NOT RUN** (would reset the live preview DB the user is actively using; the released-code suite would additionally require an isolated worktree+DB+server) |

## 6. Production census (second, read-only)

Direct SQL census: **BLOCKED** (no DB credentials in this sandbox; the previous run's
artifacts `/home/z/prod-verify/{forensics,census}.json` and the vault
`/home/z/.sec/*`, `/home/z/.mission-secrets.env` were wiped by the Oct-3 02:42 sandbox
recreation).

**Publicly verifiable subset (live, 2026-10-03):**

| Entity | Previous claim | Current live (public API) | Match |
|---|---|---|---|
| Hawkings students | 82 | **82** (`/api/schools/public?slug=hawkings-prithvipur`) | ✓ |
| Hawkings teachers | 16 | **16** | ✓ |
| Hawkings classes | 15 | **15** (full list Nursery-A…12-A in payload) | ✓ |
| Hawkings subjects | 14 | **14** | ✓ |
| Hawkings libraryBooks | 12 | 12 | ✓ |
| Green Valley business data | 0 everywhere | **0 everywhere** (all counts zero, honest CMS placeholder text) | ✓ |
| Tenants | 2 | 2 (slug resolution + demo fallback behavior) | ✓ |

**Local mirror parity (fresh deterministic seed, read-only SQL):** the local DB
reproduces the previous census EXACTLY for every comparable entity — User 185, Teacher
16, Student 82, Class 15, Subject 14, CSA 87, Exam 4 / ExamClass 45 / ExamMark 653, Fee
328 / Payment 218 / FeeTransaction 226, Attendance 3,280, Timetable 396,
SalaryStructure 15 / SalaryPayment 30, CurriculumTopic 518 / LessonTopicCompletion 419;
attendance status split 2933/185/110/52 (exact); marks 653 in range 27–88 with 0
negatives / 0 over-max; fee ledger ₹1,025,600 billed / ₹595,820 collected / PAID 198
(₹550,300) / PARTIAL 20 (₹95,200) / UNPAID 110 (₹380,100) — **all bit-exact with the
previous production census and its KPI-parity claims**. This is strong corroboration
that production was seeded by the same deterministic pipeline the repo carries.

Local-vs-production differences (expected, documented): Room 23 local (22 Hawkings + 1
GV "Room 101") vs "22 rooms all Hawkings" in the report (Hawkings-only counting);
PlatformAdmin 3 local (`admin@erpsuite.io` + `admin@scholario.cloud` roots + `ops`) vs
2 claimed in production; StudyMaterial 1 local vs 11 claimed live in production (local
seed pipeline ran a lighter step); operational tables (PlatformAuditLog 0 vs 629,
Sessions 2 vs 0, EmailDelivery 0 vs 28) reflect that production accumulated real
operational history that a fresh local seed does not.

## 7. Duplicate detectors (re-run)

- **Production: BLOCKED** (no DB credentials). Previous claim: 0 groups across 28 families.
- **Local re-run (independent SQL):** student admissionNo (per-school) 0; rollNo (per
  class) 0; user email 0; teacher employeeId (per-school) 0; school slug 0; real
  receiptNo duplicates 0 (see below); salary (school,teacher,month) 0; examMark
  (exam+class+subject+student) 0; timetable slot (school+class+day+period) 0.
- Detector-craft note: a naive `GROUP BY receiptNo HAVING count>1` reports "1 group" —
  the 8 FeeTransaction rows with NULL receiptNo (unconfirmed transactions; the column
  is nullable by design and `@@unique([schoolId, receiptNo])` permits NULLs). With
  NULLs excluded: **0 real receipt-number duplicates**. The previous audit's "zero"
  claim is consistent with the correct NULL-excluding form.

## 8. Orphan detectors (re-run, with classification)

- **Production: BLOCKED.** Previous claim: 51 stale rows deleted (11 StudyMaterials +
  4 FlashcardDecks + 32 FlashcardCards + 3 StudyGroups referencing dead school
  `cmupmxxz7…` + 1 suspended User `tenant.superadmin@sunrise.test`), evidence file
  `cleanup-evidence.json` — **GONE with the sandbox**; deletion claimed transactional
  with zero-inbound-reference gates.
- **Local re-run:** orphan students / attendance / marks / fees / sessions 0;
  StudyMaterial/FlashcardDeck/StudyGroup with missing school 0 (local was seeded fresh
  from the post-transform corpus — the pre-transform Sunrise universe never existed
  here). StudyMaterial.schoolId has **no FK** (soft reference — architecturally
  explains how production's orphan cluster could persist); FlashcardDeck/StudyGroup
  DO have School FKs — whether the production "dead" school row was deleted or merely
  dead-in-place cannot be determined without DB access (open question, not a defect
  claim).
- **Classification of the claimed deletions:** coherent with the seed designs (the
  live Hawkings equivalents exist locally: 4 decks/32 cards/3 groups — the exact
  numbers the production audit reported as the live set). The 51-row cleanup remains
  **PLAUSIBLE but unverifiable** from this sandbox.

## 9. Green Valley re-audit

**VERIFIED (live public API + local SQL):** zero business data (students/teachers/
classes/subjects/fees/attendance/marks/timetable/salary/messages all 0); GV website
renders its own honest CMS placeholder ("Our website content is being prepared…");
GV bootstrap records locally: Room 101, GradeScale 7, ExamTypeConfig 1, 5 role users
(principal.b family) — exactly the documented `seed-clean.ts` design. No Hawkings or
QA contamination observed on any reachable surface.

## 10. Hawkings re-audit

**Verified live (anonymous):** public identity (name/address/phone/email/board/
principal Dr. (Smt.) Sunita Verma), counts 82/16/15/14, class list Nursery-A…12-A,
website CMS renders with DB-derived stats (82 STUDENTS / 16 FACULTY / 15 CLASSES / 14
SUBJECTS / 1:5 ratio) — the exact figures the previous audit certified.
**Verified locally (SQL):** 100% class-teacher coverage (15/15 classes have real
teachers: Smt. Rekha Devi → Shri Devendra Pratap Singh et al.); fee ledger exact
(₹1,025,600 / ₹595,820 / 110 overdue — the previous dashboard-parity numbers); marks
invariant; attendance distribution; salary 2 months × 15 teachers, 0 school
mismatches; 0 cross-tenant student-class rows.
**Not re-verifiable anonymously:** marks range (claimed 27–88 — matches local),
money totals on PRODUCTION itself (dashboard requires login — BLOCKED).

## 11. Cross-tenant gauntlet (second pass)

- **Anonymous probes (LIVE, all PASS):** slug resolution h=200 / g=200 / unknown=404
  with honest "School not found."; unknown slug renders a NEUTRAL degraded website
  (no demo-tenant leak); bare deployment URL resolves the demo tenant (Hawkings) only;
  `/api/dashboard` 401 AUTH_REQUIRED; `/api/platform/schools` 401;
  `/api/realtime/config` 401; `/api/dbdiag` 404.
- **Authenticated gauntlet (forged schoolId/IDs per role): BLOCKED** — no credentials
  in this sandbox (demo families were rotated to values held only in the now-wiped
  vault). Code-level verification performed instead: `withUser`/`schoolScoped` derive
  the tenant from the session User row (client schoolId ignored — documented and
  enforced in `src/lib/security/authz.ts` + `src/app/api/students/route.ts` re-checked
  at `2199417`); cross-tenant by-id lookups carry `schoolId` and fail-safe 404.
- **Local evidence:** the repo's tenant-isolation (57), tenant-acceptance (15),
  platform-isolation (43+) suites encode the full gauntlet; 0 cross-tenant rows in the
  local DB.

## 12. RBAC second pass

**Live matrix re-execution: BLOCKED** (credentials). Static/code verification: role
gates confirmed in the released tree (`/api/dashboard` PRINCIPAL/MANAGEMENT/TEACHER;
teacher salary-write and finance-read denials; student/parent 403 surfaces; platform
401 boundary — all encoded in the security suites that the previous run executed
green). The subscription-lock server-side enforcement (login 200 + module 403
SUBSCRIPTION_REQUIRED) is implemented in the released code (account-level lock
migration + access policy) and was live-verified by the previous run; not re-runnable
here. **STATUS: PARTIALLY VERIFIED (code + prior live evidence).**

## 13. Attendance invariant

- Local DB: unique index `Attendance_studentId_date_key` (studentId, date) EXISTS
  (verified in pg_index); 0 duplicate (studentId, date) groups; statuses distribute
  2933/185/110/52 exactly as claimed. `date` is native PG `DATE` (day-level canonical).
- Production: unique constraint existence inferable from the shared migration lineage
  (BLOCKED for direct inspection).
- Service-layer teacher-authorization checks: encoded in assignment-scope suite.

## 14. Fees invariant

Local ledger re-computation from canonical rows: Σ Fee = ₹1,025,600 (328 fees);
Σ Payment(SUCCESS) = ₹595,820 (218 payments); status coherence exact — 0 overpaid
(paid > amount), 0 negative, 0 incoherent PARTIAL, 0 PAID-but-underpaid; unique
indexes `FeeTransaction_schoolId_receiptNo_key`, `_schoolId_referenceNumber_key`,
`gatewayOrderId_key`, `Payment_transactionId_key` all present. The previous audit's
production KPI-parity numbers are reproduced bit-exactly by the local canonical
corpus. Production totals themselves: BLOCKED (dashboard requires login).

## 15. Marks invariant

Local: 653 marks, min 27 / max 88, 0 negative, 0 `marksObtained > maxMarks` (joined
via ExamSubjectConfig exam+class+subject); unique 4-key index present. Matches the
previous claims exactly. Production direct check: BLOCKED.

## 16. Salary invariant

Local: fixed-monthly model; unique `(schoolId, teacherId, month, status)` index (the
status column admits the documented void+re-record pattern); 30 RECORDED payments =
15 teachers × 2 months (2026-08, 2026-09); 0 teacher-school mismatches; 0 duplicate
(school, teacher, month) among RECORDED. Matches the previous claims. Production:
BLOCKED.

## 17. Mock-data second pass (repo + released tree at 2199417)

- Old school name "Sunrise" in src/: **0 hits** ✓.
- "707 students" / "96 teachers" / "12 classes": 0 rendered occurrences ✓.
- **"1842" / "1.84 Cr":** "1.84 Cr" appears only in comments describing its removal ✓;
  but **"1842" remains a LIVE VALUE in the shipped mock library**
  (`src/lib/mock/school.ts` `totalStudents: 1842, totalTeachers: 96`;
  `src/lib/mock/students.ts` `total: 1842`; `src/lib/mock/attendance.ts`
  `today.total: 1842`). 47 live files import from `@/lib/mock/*` — mostly structural
  constants (classList/subjects/departments/ACADEMIC_CLASSES/holidays) per the
  documented `DATA_SOURCE_MAP.md` register R1–R20; the admission wizard also uses mock
  `students` for duplicate-detection and mock `feeStructures` for fee bands (documented
  R2). **The previous audit's blanket "fake KPIs: zero live occurrences" is
  overstated at code level** — the rendered-KPI parity claim itself was separately
  live-verified and is corroborated here (public hero stats are DB-derived).
- "Aarav Sharma": CSV input placeholder + code comments only ✓ (not rendered data).
- `src/lib/exams/mock-*`: sanctioned isDemo-gated demo tier per docs ✓.
- No fabricated KPI reaches any publicly reachable surface (browser-verified).

## 18. Supabase security / RLS second pass

- **Advisors re-run: BLOCKED** (management token absent). Previous claim: 103 = 102
  `rls_enabled_no_policy` INFO + 1 `extension_in_public` (pg_trgm) WARN.
- **Local structural parity (same migration lineage):** 102 tables with RLS enabled /
  **0 policies** (deny-all design) → exactly the 102 INFO findings;
  `pg_extension`: **pg_trgm in schema `public`** → exactly the 1 WARN; 1
  SECURITY DEFINER function in public **with search_path pinned** (matches "mutable
  search_path 0"); 0 grants to anon/authenticated/PUBLIC (local roles; the Supabase
  anon-role grant state is not checkable locally). The 103-finding classification is
  **structurally reproduced**.
- Live anon PostgREST probe: BLOCKED (anon key is not in this sandbox — by design it
  lives only in Vercel env).

## 19. Migration forensics (8/8 vs 9/9 — RESOLVED)

- Repo at `2199417`: exactly **9 migration directories** (`0_init`,
  `pg_domain_guards`, `pg_rls_search`, `rate_limit_backend`,
  `20261002000000_phase8b_domains_salary_email`, `20261002000100_8c_rls_close_8b_gap`,
  `20261002000200_8c_hot_path_indexes`,
  `20261002000300_8c_n_function_security_closure`,
  `20261003000000_account_subscription_lock`).
- The 8th was added by `1df2ae9` (PHASE 8C-N) and the **9th by `3727ba2`**
  (FINAL-ACCEPTANCE 1/3, the account-level subscription lock) — so "earlier 8/8" vs
  "final 9/9" is fully explained: the 9th migration is the intentional
  subscription-lock migration.
- Local `_prisma_migrations`: 9/9 applied, names identical to the repo dirs ✓.
- Production `_prisma_migrations` = 9/9: claimed; BLOCKED for direct verification;
  indirectly corroborated (the live app — whose code expects the 9-migration schema —
  is healthy, and the public API serves the post-rebuild corpus).

## 20. Vercel environment audit

Names-only check: **BLOCKED live** (no token). Prior evidence (FINAL report §3): 9
entries / 8 keys — DATABASE_URL (Supavisor :6543, pgbouncer=true, connection_limit=2),
DATABASE_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
FILE_SIGNING_SECRET, REALTIME_CHANNEL_SECRET, RESEND_API_KEY. Code-level: **0
`NEXT_PUBLIC_*` variables anywhere in src/** (verified by grep at 2199417) — no
client-exposed secrets. `.env.example` lists only 5 non-secret names with placeholders.
The live CSP proves the deployed SUPABASE_URL + rotated realtime secret are active.

## 21. Credential rotation forensics

**BLOCKED.** The rotated values (DB password, Resend key, signing secrets, demo
password families) live only in the wiped vault; no credentials exist in this sandbox
(I verified: no token-shaped strings in env/upload/home; Vercel CLI state absent;
`.sec/` and `.mission-secrets.env` gone). Therefore neither "old credentials are
dead" nor "new credentials are live" can be re-proven from here. Indirect live
corroboration: the production app authenticates to its database (`database:ok` on
every ready probe) and its realtime secret (CSP + healthy app) — i.e., **the deployed
credentials work**; their rotation history is unverifiable. No rotation was performed
during this audit, per the rules.

## 22. Resend second pass

**BLOCKED (no key).** Per prior evidence only: key ACTIVE but send-restricted (read
endpoints 401), real delivery verified to the account-owner address with a provider
message id, non-owner recipient correctly FAILED (shared-test-sender restriction),
**no custom verified sending domain** — an explicitly documented release gap.
Classification per the mission's required separation:
- EMAIL ENGINE (as configured): prior-evidence VERIFIED — current re-verification UNVERIFIED
- CUSTOM DOMAIN: **NOT VERIFIED** (owner DNS action outstanding)

No email was sent during this audit.

## 23. CI second pass

- `.github/ci.yml.parked` exists in the released tree and locally (10,154 bytes) ✓.
- `.github/workflows/` does NOT exist ✓ (local tree + GitHub tree).
- GitHub Actions page (anonymous HTML): empty state — **no workflows, no runs** ✓.
- API checks (workflows list, latest runs, branch protection): BLOCKED — the anonymous
  API quota for this shared egress IP is exhausted (rate-limit window kept rolling);
  branch protection additionally requires auth. No checks exist that branch protection
  could require, and the previous run pushed to main directly.
- **CI is NOT active** — exactly as the previous report honestly stated. Not activated
  during this audit.

## 24. Backup / restore second pass

`docs/BACKUP_RECOVERY.md` + `scripts/db-backup.ts` + `scripts/db-restore-verify.ts`
present in the released tree ✓. The doc records the tested restore evidence (97 app
tables / 9,171 rows / 28.6 s dump, 3 green scratch-schema restore runs, 3-way money
parity check) **from the Oct-1 era corpus** — internally coherent (its money sum
₹2,162,650 is the pre-rebuild corpus; the corpus was rebuilt at 3727ba2, which is why
today's totals differ). The evidence files themselves were sandbox-local and are gone;
the runbook + scripts are in the repo. Current local schema has 102 base tables (101
app + `_prisma_migrations`) — schema growth since the backup evidence is expected
(8C/FA migrations). **Not re-run** (would require production DB access).

## 25. Browser production QA (second pass, anonymous surfaces)

| Surface | Result |
|---|---|
| Landing `/?slug=hawkings-prithvipur` | Hawkings CMS branding, DB-derived stats, zero console errors |
| Landing `/?slug=green-valley` | GV honest placeholder site, zero console errors |
| Unknown slug | neutral degraded identity (no tenant leak), zero console errors |
| Login Portal (Hawkings) | school-branded login + live platform announcement banner; **no demo/dev-preview chips** (R14/R15 gating confirmed by absence) |
| `/platform/login` | control-plane sign-in page renders (MFA messaging), zero console errors |
| Viewports 320/390/414/768/1024/1440/1920 | **scrollWidth == clientWidth at every width (no horizontal overflow)** |
| Screenshots | `hawkings-320.png`, `gv-320.png`, `hawkings-1440.png` (audit workspace) |
| Authenticated modules (dashboard/students/teachers/attendance/exams/fees/salary/timetable/lesson-planner/settings) | **BLOCKED** (no credentials in this sandbox) |

## 26. Mobile Safari claim reconciliation

- Previous report's own words: cookie contract verified live (HttpOnly + Secure +
  SameSite=Lax + Path=/; logout kills the server session; indistinguishable 401s) —
  **but real iOS hardware NOT TESTED**.
- This second pass: no iOS device exists in this sandbox either.
- **Classification: COOKIE CONTRACT VERIFIED (prior evidence only — not re-verified
  here); REAL iOS SAFARI: NOT TESTED.** The first must never be reported as the second
  (the previous report already observed this separation; it holds).

## 27. Temporary artifact forensics

- Repo at 2199417: **no diagnostic/probe/debug routes** (the only regex hit is the
  legitimate `exams/[id]/marks/template` route — "template", not a probe).
- Live: `/api/dbdiag` → **404** (the TEMP diagnostic was properly reverted and is not
  deployed).
- Git history: `2aac7cb` (TEMP) + `be98d bbe` (revert) preserved transparently.
- Production-DB temp artifacts (probe rows, temp tenant, probe EmailDelivery rows,
  verification sessions — the previous audit claims all cleaned; sessions zeroed):
  **BLOCKED from re-verification**. The temp-tenant ledger state ("exactly 2
  permanent tenants") is publicly corroborated by slug-resolution behavior but not
  provably enumerable anonymously.
- Local sandbox: carries two UUID-message auto-snapshot commits + preview
  infrastructure (mini-services/postgres-db + keepalive/spawn-detached) — classified
  as SANDBOX-RUNTIME artifacts, unpushed, not production.

## 28. Release-document forensics

- `docs/FINAL_PRODUCTION_RELEASE_REPORT.md` (final version at 2199417) still states
  production = `be98dbe` (§3, §24); the FFA report states `64b93b4`
  (dpl_AqpB12mA/dpl_awgTvMCd); FFA-3's worklog states `a675a6f` (dpl_49w9LsSF). Three
  sequentially-true, never-reconciled "current production" statements — the final
  commit's docs were never updated to the last verified deployment.
- FFA §24–26 test table: security row says 413 total / 395 pass / 17 skips —
  **395 + 17 = 412 ≠ 413** (off-by-one inside their own table; the 622 + 17 = 639
  grand total is internally consistent).
- Census User count: 186 (JSON keyCounts) vs 185 (MD table + FFA-3 final state) —
  explainable as pre/post the 1-user cleanup, but presented inconsistently.
- No secret values found in any released document (shape-scan clean, §20 of this
  report).
- The mock-data "zero live occurrences" overstatement: §17 above.
- Otherwise the documents' claims that were reachable for re-verification all check
  out (public data, health, isolation surfaces, header set, migration lineage, local
  corpus parity).

## 29. Stop/resume integrity review

- The previous run's own log records: an interrupted first probe run left a PENDING
  temp school, and the resume-safe logic **REUSED** it (claimed no duplicate); the
  final sweep claims the ledger returned to exactly 2 tenants and sessions were
  zeroed. **These specific anti-duplication outcomes are BLOCKED from re-verification.**
- Independent structural evidence: the released chain contains exactly ONE
  provisioning-lifecycle commit sequence, one rotation sequence, one report sequence —
  no duplicated worklog entries for the same phase; the Git chain itself shows no
  repeated/rewound segments (each push is a single linear segment).
- **Conclusion: NO DUPLICATION observable in surviving evidence; the
  production-state claims (ledger=2, sessions=0) are POSSIBLE-DUPLICATION-CANNOT-RULE-OUT
  only in the sense that all production-DB state is credential-blocked — no positive
  evidence of duplication exists.**

## 30. Second-pass scorecard

| AREA | PREVIOUS CLAIM | CURRENT VERIFIED STATE | STATUS | EVIDENCE |
|---|---|---|---|---|
| GitHub main SHA | 2199417 | 2199417 (live ls-remote) | **VERIFIED** | git ls-remote/fetch |
| Local main == GitHub main | 64b93b4 clean | local 2deef0f DIVERGED (2 unpushed snapshot commits; upload routes deleted locally) | **DISCREPANCY (local sandbox only)** | git log/diff |
| SHA chain 64b93b4→a675a6f→2199417 | as reported | exact full SHAs resolved; docs-only deltas after 3727ba2 | **VERIFIED** | git log |
| Vercel production live/healthy | READY, health ok | live 200, database:ok 224–235 ms, CSP/headers full set | **VERIFIED** | anonymous probes |
| Runtime SHA = final commit | dpl_49w9LsSF at a675a6f | deployment identity not anonymously derivable; no 2199417 deployment ever recorded | **UNVERIFIED** | §3/§4 |
| Git-integration auto-deploy | yes | git-main alias exists (SSO 302) | **VERIFIED** | alias probe |
| Production DB census | 101-model table | public subset matches (82/16/15/14, GV zeros, 2 tenants); rest BLOCKED | **PARTIALLY VERIFIED** | public API |
| Local DB parity | n/a (local mirror) | ~20 entities + money + distributions bit-exact vs claimed census | **VERIFIED (corroboration)** | local SQL |
| Duplicate detectors (prod) | 0 / 28 families | BLOCKED; local re-run 0 (NULL-receipt artifact explained) | **UNVERIFIED (prod) / VERIFIED (local)** | §7 |
| Orphan detectors / 51-row cleanup | repaired w/ evidence | evidence file GONE; local 0; cleanup plausible, unverifiable | **UNVERIFIED (prod)** | §8 |
| Green Valley clean | zero business data | public API zeros + local zeros + honest CMS | **VERIFIED** | §9 |
| Hawkings audit | 15/82/16/100%/₹ parity | public counts + local exact parity incl. ₹1,025,600/₹595,820/110 | **VERIFIED (public+local; production ledger BLOCKED)** | §10 |
| Cross-tenant gauntlet | 0 violations / 35 surfaces | anonymous probes PASS; authenticated gauntlet BLOCKED; code-verified session-derived tenancy | **PARTIALLY VERIFIED** | §11 |
| RBAC matrix | 45 live probes PASS | BLOCKED live; code-level gates verified | **PARTIALLY VERIFIED** | §12 |
| Attendance invariant | unique, 0 dups | local unique index + 0 dups + exact split | **VERIFIED (local) / UNVERIFIED (prod)** | §13 |
| Fees invariant | exact ₹ parity | local ledger bit-exact; prod BLOCKED | **VERIFIED (local) / UNVERIFIED (prod)** | §14 |
| Marks invariant | 0 ≤ m ≤ max | local 0 violations, range 27–88 | **VERIFIED (local) / UNVERIFIED (prod)** | §15 |
| Salary invariant | 0 dups, fixed-monthly | local 0 dups, 15×2 months | **VERIFIED (local) / UNVERIFIED (prod)** | §16 |
| Mock data | "zero live occurrences" | "1842"/"96" remain LIVE VALUES in shipped mock lib (documented R1–R20; not rendered) | **DISCREPANCY (documentation precision)** | §17 |
| RLS / advisors | 103 = 102 INFO + 1 WARN | local structural parity EXACT (102 RLS/0 policies + pg_trgm public); prod re-run BLOCKED | **PARTIALLY VERIFIED** | §18 |
| Migrations 9/9 | 9/9 | repo 9 ✓, local 9/9 ✓, 9th explained (3727ba2); prod BLOCKED | **VERIFIED (repo+local)** | §19 |
| Vercel env names | 9 entries / 8 keys, no NEXT_PUBLIC | live check BLOCKED; 0 NEXT_PUBLIC in code ✓ | **PARTIALLY VERIFIED** | §20 |
| Credential rotation | old dead / new live | BLOCKED entirely (vault wiped); deployed creds demonstrably WORK | **UNVERIFIED** | §21 |
| Resend | ACTIVE, owner delivery, NO custom domain | BLOCKED; classification preserved | **UNVERIFIED (engine) / NOT VERIFIED (domain)** | §22 |
| CI parked | parked, no workflows | parked file present, no workflows, no runs | **VERIFIED** | §23 |
| Backup/restore evidence | tested 97 tables/9,171 rows | doc+scripts present; evidence coherent with era; artifacts gone | **PARTIALLY VERIFIED** | §24 |
| Browser QA | 0 errors, responsive | 0 console errors, 0 overflow at 7 viewports (anonymous surfaces) | **VERIFIED (public) / BLOCKED (authenticated)** | §25 |
| Mobile Safari | contract-only | COOKIE CONTRACT VERIFIED (prior); real iOS NOT TESTED | **VERIFIED as classified** | §26 |
| Temp artifacts | cleaned | repo clean, /api/dbdiag 404; prod-DB state BLOCKED | **PARTIALLY VERIFIED** | §27 |
| Test matrix 622/0/17 | 622 pass | unit 88/88 re-run ✓ EXACT; static counts ±5%; full re-run not performed (documented) | **PARTIALLY VERIFIED** | §28 |
| Repo secret scan | 0 true hits | shape-scan across ALL history: 0 token-shaped, 0 real pg-creds (placeholders only) | **VERIFIED** | §20 of report |

## 31. No auto-GO (independent conclusion)

This second pass does NOT inherit the previous GO. Its own determination:

**(B) CURRENT PRODUCTION HAS DISCREPANCIES** — none of them runtime defects:

1. **RUNTIME SHA UNVERIFIED** (the mission's own standard: not PASS). The last
   deployment the previous run actually verified was `a675a6f` (dpl_49w9LsSF); the
   final commit `2199417` was pushed afterward and its deployment was never verified
   by anyone.
2. **Stale/contradictory "current production SHA" statements** across the three final
   documents (be98dbe vs 64b93b4 vs a675a6f — sequentially true, never reconciled).
3. **Test-table off-by-one** (413 vs 395+17=412) and **User 185 vs 186** presentation
   inconsistencies inside the previous reports.
4. **Mock-data claim overstated** ("zero live occurrences" vs live code values
   `1842/96` in the shipped mock library — documented-by-design, not rendered).
5. **Local sandbox divergence**: this sandbox's repo is 2 unpushed snapshot commits
   off the release (upload routes deleted locally + preview infra added); the local
   preview is NOT running the released code.
6. **Credential-blocked re-verification**: production DB census, authenticated
   gauntlet/RBAC, rotation proof, Resend state, advisors, env names — all UNVERIFIED
   from this sandbox (the strongest available corroboration — exact local seed parity
   and live public-surface behavior — is consistent with the previous claims).

What independently VERIFIES today: GitHub main = 2199417; production live/healthy with
the full security-header set and post-rotation CSP; public tenant data exactly as
censused (82/16/15/14; GV zeros; 2 tenants; neutral unknown-slug fallback; auth
boundaries 401; TEMP route 404); repo + local migration lineage 9/9 with the 9th
explained; local corpus reproduces the claimed ledger/invariants bit-exactly; zero
secrets in all git history (shape-scan); CI honestly parked; anonymous browser QA
clean at all 7 viewports.

## 32. Blockers (for full verification, not for operation)

1. Vercel API access (token) → deployment SHA, env names, deployment history.
2. Supabase DB access (connection string) → production census/detectors/orphans.
3. Supabase management token → advisors re-run.
4. Resend API key → key/domain status.
5. One school-tenant login (rotated demo credentials) → live RBAC/gauntlet/KPI parity.
6. GitHub API quota (shared-IP anonymous exhausted) → workflows/branch-protection API
   fields (HTML-verified equivalents already recorded).

## 33. Final output block

```
SECOND-PASS INDEPENDENT AUDIT
=============================

CURRENT GIT SHA:      219941756bc09066ecec43b8b2e60fa4e6dbbfa5 (GitHub main; local sandbox HEAD 2deef0f — diverged, unpushed)
CURRENT VERCEL SHA:   UNVERIFIED (last verified by previous run: a675a6f / dpl_49w9LsSF; no 2199417 deployment ever recorded)
RUNTIME SHA:          UNVERIFIED (no anonymous mechanism; app-code delta a675a6f→2199417 is zero)

PRODUCTION DATABASE:  Supabase kbyknezedewvgrnqervj (ap-south-1) — alive via app (database:ok 224–235 ms); direct access BLOCKED
TENANT COUNT:         2 (publicly corroborated: hawkings-prithvipur + green-valley)

DUPLICATES:           production BLOCKED; local re-run 0 (1 NULL-receipt grouping artifact explained)
ORPHANS:              production BLOCKED; local 0; 51-row cleanup evidence GONE (plausible, unverifiable)
CROSS-TENANT:         anonymous probes 0 violations; authenticated gauntlet BLOCKED (credentials absent)
UNKNOWN:              runtime deployment SHA; production-DB internal state; rotation truth; Resend state

HAWKINGS:             public counts 82/16/15/14 ✓; local ledger ₹1,025,600/₹595,820/110 bit-exact ✓; production ledger BLOCKED
GREEN VALLEY:         clean ✓ (public API zeros + local zeros + honest CMS)

MIGRATIONS:           9/9 repo ✓ + local ✓ (9th = account_subscription_lock @ 3727ba2 — 8/8→9/9 resolved); production BLOCKED
RLS:                  local parity EXACT (102 RLS/0 policies + pg_trgm public = the 103 classification); production re-run BLOCKED

CREDENTIAL ROTATION:  UNVERIFIED (vault wiped; deployed creds demonstrably work)
RESEND:               UNVERIFIED (engine, prior evidence only) · CUSTOM DOMAIN NOT VERIFIED
CI:                   parked ✓ (no workflows, no runs — honestly reported)

BACKUP:               doc + scripts present, era-coherent; evidence artifacts GONE
BROWSER:              PASS anonymous surfaces (0 console errors, 0 overflow 320–1920, live DB stats); authenticated BLOCKED
IOS:                  COOKIE CONTRACT VERIFIED (prior) — REAL iOS SAFARI NOT TESTED

STOP/RESUME:          NO DUPLICATION in surviving evidence; ledger=2/sessions=0 claims unverifiable
GARBAGE/DUPLICATION:  none found in repo/history; local sandbox carries 2 unpushed snapshot commits (runtime divergence)

DISCREPANCIES:        (1) runtime SHA unverified + 2199417 deployment never verified;
                      (2) three unreconciled "current production SHA" statements in final docs;
                      (3) test-table off-by-one 413≠395+17; (4) User 185 vs 186;
                      (5) mock-data "zero live occurrences" overstated (1842/96 live in code);
                      (6) local sandbox repo diverged from release (upload routes deleted locally);
                      (7) all credential-gated production claims remain unverifiable from this sandbox

BLOCKERS:             Vercel token · Supabase DB URL · Supabase mgmt token · Resend key · one tenant login · GitHub API quota

FINAL INDEPENDENT STATUS: DISCREPANCIES FOUND
(no fabrication evidence; core public state verifies; deepest claims are credential-blocked,
 not disproven — see §31 for the full no-auto-GO determination)
```

---

*Audit artifacts (this session): `/home/z/audit-second-pass/` — local-census.json,
drill/unique-check outputs, production probe transcripts, screenshots
(prod-hawkings-320.png, prod-gv-320.png, prod-hawkings-1440.png). No production
mutation was performed at any point. This report is UNTRACKED and NOT committed or
pushed, per instructions.*
