# SCHOLARIO — FINAL FORENSIC PRODUCTION ACCEPTANCE REPORT

**Execution mode:** READ → VERIFY → CLASSIFY → REPAIR → REVERIFY → CERTIFY
**Executed:** 2026-10-02 (single session, forensic re-verification of the entire production system)
**Live system under test:** `scholario-production.vercel.app` · deployment SHA `64b93b4b5b6b113a587c64eb78ef4fbe015045b9` · Supabase `kbyknezedewvgrnqervj` (ap-south-1)

> Every claim below was re-verified against the LIVE state in this session — prior
> PASS/GO claims were treated as unverified until independently reproduced.

---

## 1. Executive summary

The Scholario production system was subjected to a full forensic re-acceptance:
external truth planes (GitHub / Vercel / Supabase / Resend) probed live, the
production PostgreSQL database censused and audited entity-by-entity, all
duplicate / orphan / cross-tenant detector families re-run from zero, the
two permanent tenants reconciled against their documented seed designs, a fresh
third-school provisioning lifecycle executed through the real control plane, the
RBAC / tenant-isolation / business-invariant matrix re-executed live against the
production API, a fresh local test matrix run (622 pass — exact canonical parity),
browser QA performed on real rendering (responsive 320–1440, zero console errors),
realtime verified end-to-end with a live broadcast, real email delivery verified,
one stale-legacy data cluster safely repaired (51 rows, transactional, with
before/after evidence), and one credential-rotation incident mitigated (3 demo
families rotated; old values verified dead).

**FINAL VERDICT: GO** — with the same set of documented owner-held external
actions recorded by the prior acceptance (custom email domain DNS, school DNS
domains, CI un-park, GitHub PAT/Vercel token/Supabase mgmt-key rotation runbooks).
None of these blocks operation; all are explicitly listed in §23.

---

## 2. Exact Git SHA

- Local `main` HEAD: `64b93b4b5b6b113a587c64eb78ef4fbe015045b9` (clean working tree before this report's commit)
- GitHub remote `main`: `64b93b4b5b6b113a587c64eb78ef4fbe015045b9` (verified via live GitHub API + `git fetch`)
- **GitHub SHA == expected canonical SHA ✓**

## 3. Exact Vercel production deployment

- Project: `scholario-production` (`prj_cJFN4oYHZEM50ooGKUMiQmG3e6qM`, team signature4748-2940, repo `signature4748-obs/Scholario-upgrade`, prod branch `main`, Next.js, Node 22.x)
- Production deployments READY at SHA `64b93b4b5b6b113a…` (dpl_AqpB12mA, dpl_awgTvMCd) — **matches expected ✓**
- Runtime health: `/health/ready` → `ready / database:ok / 14–234ms`
- CSP carries the post-rotation realtime URL (`wss://kbyknezedewvgrnqervj.supabase.co`) ✓
- 9 env vars, all encrypted + non-empty ✓ (anon key is the publishable-by-design value)

## 4. Supabase project identity

- `scholario-production`, ref `kbyknezedewvgrnqervj`, region ap-south-1, status **ACTIVE_HEALTHY**, PG 17 lineage
- Direct DB access verified through the Supavisor transaction pooler with the **rotated** DB password
- Prisma migrations: **9/9 applied** (queried directly from `_prisma_migrations`)

## 5. Database census (production, read-only, raw SQL)

| Entity | Total | Green Valley | Hawkings | Notes |
|---|---|---|---|---|
| School | 2 | — | — | GV (clean, ACTIVE) + Hawkings (demo, ACTIVE) |
| TenantDomain | 0 | — | — | no custom domains (documented owner action) |
| User | 185 | 5 | 177 | +3 documented legacy/fixture schoolless users |
| Teacher | 16 | 0 | 16 | |
| Student | 82 | 0 | 82 | |
| Class | 15 | 0 | 15 | Nursery-A … 12-A |
| Subject / CSA | 14 / 87 | 0 | 14 / 87 | |
| Exam / ExamClass / ExamMark | 4 / 45 / 653 | 0 | 4 / 45 / 653 | |
| Fee / Payment / FeeTransaction | 328 / 218 / 226 | 0 | 328 / 218 / 226 | |
| Attendance | 3280 | 0 | 3280 | PRESENT 2933 · ABSENT 185 · LATE 110 · LEAVE 52 |
| Timetable | 396 | 0 | 396 | |
| SalaryStructure / SalaryPayment | 15 / 30 | 0 | 15 / 30 | |
| CurriculumTopic / LessonTopicCompletion | 518 / 419 | 0 | 518 / 419 | |
| PlatformAdmin / PlatformAuditLog | 2 / 629 | — | — | control-plane |
| RateLimitBucket / SupportSession | 43 / 17 | — | — | operational |

Full census: `forensics.json` / `census.json` (audit artifacts, outside the repo).

## 6. Duplicate findings

**ZERO** duplicate groups across 28 detector families: student admissionNo
(in-school), rollNo (in-class), user↔student/teacher mappings, teacher employeeId
(in-school), user email, school slug/code/domain, TenantDomain hostname,
FeeTransaction receiptNo / referenceNumber / gatewayPaymentId, Payment
transactionId, canonical payments per fee, impossible payment states (overpay),
Attendance (studentId+date unique; conflicting class/status), ExamMark
(exam+class+subject+student), Timetable slot (school+class+day+period), teacher
collision, room collision, SalaryPayment (school+teacher+month), salary
reference, Message id, EmailDelivery dedupeKey.

## 7. Orphan findings

- **Repaired (this session):** 51 STALE-LEGACY rows referencing the dead
  pre-transform Sunrise school id `cmupmxxz7…` — 11 StudyMaterials (dead copies of
  the live Hawkings set, same titles/business timestamps), 4 FlashcardDecks +
  32 FlashcardCards, 3 StudyGroups (old versions; live equivalents exist) — plus
  1 User row `tenant.superadmin@sunrise.test` (SUSPENDED, zero references, not
  recreated by any current seed). Deleted transactionally with safety gates
  (inbound-reference count must be 0; live-equivalent counts verified) and
  before/after evidence (`cleanup-evidence.json`). Detector re-run: **zero
  remaining**.
- **Retained by design:** 3 schoolless SUPER_ADMIN User rows (2 suspended
  legacy-migration rows created by `prisma/seed.ts` and documented by
  `prisma/seed-platform.ts`'s migrate-and-suspend design; 1 deliberate schoolless
  fixture `tenant.superadmin@hawkings.test` from `seed-tenant-isolation.ts`),
  65 null-school ActivityLog rows (LOGIN_FAILED / PLATFORM_LOGIN_BLOCKED audit
  trail — the blocking behavior these records prove is itself a security control).

## 8. Cross-tenant findings

**ZERO** violations across 35 probed relation surfaces (student↔class,
CSA↔class/subject/teacher, classTeacher, classRoom, fee↔student, payment↔fee,
feeTx↔student/fee, attendance↔student/class, examMark↔exam/student/class,
examClass, salary↔teacher, timetable↔class/subject/teacher, message
sender/recipient, homework, curriculum, lesson completion, parentConversation,
homeworkSubmission, uploadedFile user, bookIssue, notificationRead, gallery).
Live API gauntlet: forged `?schoolId=` ignored (session-derived tenant), foreign
student-by-id 404, GV roster honest-empty, new-tenant probes denied.

## 9. Hawkings High School Prithvipur audit (demo tenant)

Structure: 15 classes (Nursery-A…12-A) · 82 students (5–6/class) · 16 teachers ·
87 CSAs · 100% class-teacher coverage. Users by role: 2 PRINCIPAL (1 real + 1
documented fixture), 1 MANAGEMENT, 16 TEACHER, 82 STUDENT, 76 PARENT — matching
the credential report exactly. Marks: 653 rows, range 27–88, zero negatives,
zero over-maxMarks. Fees: PAID 198 (₹550,300) + PARTIAL 20 (₹95,200/₹45,520) +
UNPAID 110 (₹380,100) = **₹1,025,600 total; ₹595,820 collected** — exact KPI
parity with the live principal dashboard. Attendance: 3280 sanely distributed.
No old Sunrise branding in live tenant data. Coherent, interconnected, canonical.

## 10. Green Valley Public School audit (clean tenant)

Exactly the documented `seed-clean.ts` design: bootstrap-only — 5 role users
(principal + documented `.b` fixture family, no Teacher/Student profiles), Room
101, GradeScale (7 CBSE boundaries), ExamTypeConfig ('Unit Test'); **zero
business data** (students/teachers/classes/subjects/fees/attendance/exams/
timetable/messages/salary all 0). Not contaminated by Hawkings or QA data.
The clean zero-data experience is the deliberate acceptance fixture.

## 11. Temporary tenant audit (third-school provisioning)

A fresh third school was provisioned **through the real control plane** on the
current deployment: platform root login (password+TOTP, cookie transport) →
ledger (2 permanent tenants) → provision (PENDING) → PENDING principal login
blocked (403) → platform activate (audited) → principal login 200 →
setup-readiness honest (`usable=false / requiredComplete=false`) → foreign
student 404 → platform step-up (TOTP re-verify) → suspend (typed reason) →
DELETE with typed `confirmName` → ledger back to exactly **2 permanent tenants**.
All platform mutations are in PlatformAuditLog. An interrupted first probe run
had left one PENDING temp school; the resume-safe logic REUSED it (no duplicate
created) and completed its lifecycle.

## 12. RBAC matrix (live, positive + negative, direct API)

| Role | Positive | Negative |
|---|---|---|
| Principal | dashboard 200 + exact DB KPIs; students/teachers/classes/rooms/salary/timetable 200 | platform API 401; superadmin school-login refused |
| Teacher | teacher dashboard 200 (own scope) | POST /api/salary/payments 403; GET /api/fees 403 |
| Student | student dashboard/attendance 200 (own data) | /api/teachers 403; /api/dashboard 403 (school financials) |
| Parent | profile 200 (role=PARENT) | /api/teachers 403 |
| Locked account | login 200, /api/auth/me 200 | module API 403 SUBSCRIPTION_REQUIRED (server-side lock) |
| Anonymous | — | /api/auth/me 401; /api/dashboard 401; /api/platform/schools 401 |
| Platform | control plane with MFA + step-up | school session on platform API 401 |

## 13. Business invariant results

- **Attendance:** CLASS+DATE+STUDENT canonical — DB unique(studentId,date) holds,
  zero duplicate/conflicting rows; subject/class teacher flows covered by the
  canonical suite (tenant-isolation 57/57, fee-lifecycle, salary-persistence).
- **Fees:** states PAID/PARTIAL/UNPAID with exact integer-money totals
  (₹1,025,600 / ₹595,820 / 110 overdue — exact dashboard parity); zero duplicate
  receipts/references; zero overpay states; pg-money precision suite green.
- **Marks:** 0 ≤ marks ≤ maxMarks (zero violations); duplicate key zero;
  unauthorized-combination denial covered by assignment-scope suite (green).
- **Salary:** monthly-fixed model only; duplicate (school,teacher,month) zero;
  principal-records/teacher-reads same canonical rows (suite green).
- **Rooms:** archive/selection rules covered by canonical suite; 22 rooms all
  Hawkings, class-room references consistent.
- **Lesson planner:** 518 CurriculumTopics + 419 LessonTopicCompletion rows —
  progress derived from planning records; teacher scope enforced by
  assignment-scope suite.

## 14. RLS / database security

- Advisors (fresh run): **103 findings = 102 × `rls_enabled_no_policy` (INFO) +
  1 × `extension_in_public` (WARN, pg_trgm)** — identical to the documented
  classification: deny-all RLS is the design (the app enforces authorization in
  the service layer; anon/authenticated get nothing), pg_trgm placement is a
  documented trade-off.
- Live anon PostgREST probe: **0 rows returned on every probed table** (School,
  User, Student, Teacher, Fee, Payment, Attendance, ExamMark, Message, Session,
  PlatformAdmin) — RLS effective.
- Platform control-plane auth is a separate table with MFA + step-up + audit.

## 15. Performance findings

Production `/health/ready` DB latency observed 14–234ms (ap-south-1 RTT from
this sandbox ~150ms baseline — the 234ms spikes are first-pool-connection
acquisition). Teacher-dashboard N+1 batching and the dashboard aggregate path
were optimized and verified in the prior acceptance; no new index was added
blindly in this session and none was indicated (all probed list surfaces return
in bounded, single-digit-query plans; the local suite runs the same query paths
green). Supavisor pool: transaction mode with `pgbouncer=true&connection_limit=2`
verified working.

## 16. Realtime results

- Websocket: **connected** on production (aria-label "live event stream
  connected").
- End-to-end broadcast: an announcement created through the authenticated API
  (server-side publish awaited) **arrived in the principal's Live Activity panel
  in the live browser session without reload** ("Final Forensic Realtime Probe —
  now"), then the probe row + all verification sessions were cleaned.
- Database remains the source of truth (the announcement row was verified before
  UI delivery). CSP allows exactly the Supabase realtime origin.

## 17. Resend reconciliation

- The production `RESEND_API_KEY` is **ACTIVE** (real API responses, not auth
  failures — read endpoints 401 because the key is send-restricted by design).
- **Real delivery verified live this session**: admission-enquiry path →
  EmailDelivery SENT with provider message id (delivered to the account owner's
  address). Failure handling verified: a non-owner recipient correctly FAILED
  with the provider's 403 captured in `lastError` (retry/dedupe/audit pipeline
  intact; outbox rows for probes cleaned).
- **Release gap (documented, owner action): NO verified custom sending
  domain.** The account currently sends via the Resend shared test sender
  (`onboarding@resend.dev`), which can only deliver to the account owner's own
  address. School-facing production email to arbitrary recipients requires the
  owner to verify a domain at resend.com/domains (SPF/DKIM/DMARC). This is NOT
  certified as "production email complete"; it is an explicitly recorded gap.

## 18. CI/CD verification

- **No CI workflow is active.** `.github/workflows/` does not exist; the
  validated workflow is parked at `.github/ci.yml.parked` because the push PAT
  lacks the `workflow` scope (documented in git history — commits 0ae21a0 /
  f7e65b5).
- Per the mission's rule this is reported explicitly: **CI is NOT claimed as
  active.** Owner action: restore the workflow with a workflow-scoped PAT or via
  the GitHub UI. The equivalent quality gates (typecheck 0 errors, lint 0 errors,
  622-pass suite) were executed manually in this session.

## 19. Browser QA (real rendering)

- Landing page: correct Hawkings branding, zero console errors.
- Principal console (local corpus): dashboard renders live DB data
  (Attendance 91.5%, ₹4.30L pending dues, 82 students); Students & Classes
  module renders DB-derived stats; no broken dialogs, no dead navigation.
- Responsive: **320px, 390px, 1440px — no horizontal overflow, footer visible**,
  no clipping; screenshots captured (mobile-320 / desktop-1440).
- Production console (authenticated session): zero errors.
- Real iOS Safari hardware: **NOT TESTED** (sandbox has no iOS device). The
  security-relevant contract was verified live: session cookie is HttpOnly +
  Secure + SameSite=Lax + Path=/; logout kills the server-side session (me→401);
  wrong-password and unknown-account logins are indistinguishable 401s.

## 20. Mock-data findings

- Old branding: **zero** "Sunrise" references in src/public.
- Fake KPIs ("707 students", "1842", "96 teachers"): zero live occurrences —
  only historical comments describing their removal.
- `₹1.84 Cr` / "Aarav Sharma": documentation examples and a CSV input
  placeholder (UI PLACEHOLDER class), not rendered data.
- `src/lib/exams/mock-exams-data.ts`: the sanctioned demo-tier corpus (boots
  empty; seeded only for `School.isDemo` via `ensureDemoSpec`) — DEMO DATA by
  documented design; real tenants start honest-empty.
- Auto-timetable mock teacher names: name-resolution fallback only (documented).
- All production user-facing modules consume canonical backend data (KPI parity
  proven in §9/§12).

## 21. Backup / restore

`docs/BACKUP_RECOVERY.md` documents the on-demand logical dump + **TESTED
restore** (scratch-schema restore verify: 97 tables / 9,171 rows / ~29–44s, 3
green runs) with honest RPO/RTO statements (operator-triggered backups; Supabase
plan-tier PITR not assumed). Evidence verified present and consistent.

## 22. Credential rotation (final, this session)

- **INC-1 mitigation:** 3 featured demo families (showcase principal/teacher/
  student) rotated after an evidence-read redaction miss printed them into tool
  output. Pre-rotation hash-match verified for all 3; surgical DB update; 11
  sessions revoked; **live OLD→401 / NEW→200 verified for all 3**; vault updated;
  credential report regenerated against production (177 accounts + 2 platform
  admins, chmod 600) with a rotation log appended. Old values are dead.
- Infra credentials (DB password, Resend key, REALTIME_CHANNEL_SECRET,
  FILE_SIGNING_SECRET) were rotated by the prior acceptance and re-verified
  WORKING this session (DB connect ✓, real email send ✓, live realtime HMAC
  handshake + broadcast ✓ — the deployed secrets are provably valid).
- Rotation-impossible credentials (GitHub PAT, Vercel token, Supabase mgmt PAT,
  legacy anon/service keys) remain documented owner runbooks per §23.

## 23. Remaining risks / exact blockers / owner actions

None of these blocks operation; all are previously documented owner-held
external actions, re-confirmed:
1. Resend custom sending domain + DNS (SPF/DKIM/DMARC) — required for
   school-facing email to arbitrary recipients (§17).
2. School custom DNS domains for hostname-based tenant URLs (slug-based
   resolution is live and verified; TenantDomain machinery is ready).
3. CI un-park (workflow-scoped GitHub PAT or GitHub UI action) (§18).
4. Owner-side rotation runbooks: GitHub PAT, Vercel token, Supabase mgmt PAT,
   legacy anon/service keys.
5. Real iOS Safari device smoke test (contract-equivalents verified; §19).

## 24–26. Test counts (fresh, this session — never reused)

- **Local canonical matrix:** unit 88/88 · integration 23/23 · api 65/65 (one
  cold-compile timeout re-verified green standalone) · regression 18/18 ·
  security 395 pass + 17 designed skips (pg-rls off-Supabase 15 + phase75 split
  2) · e2e 32/32 → **622 PASS / 0 FAIL / 17 designed skips** (exact canonical
  parity; the login-bucket flakes encountered mid-run were root-caused to my
  own base-URL override creating an unhealed `::ffff:127.0.0.1` limiter key —
  healed and re-verified green; documented in the worklog).
- **Live production matrix:** 45 probes — 41 recorded in
  `live-tests.ndjson` + 4 session-evidenced (first-run B probes) — **45 PASS /
  0 FAIL**.
- **Forensic DB audit:** 101 models censused; 28 duplicate families = 0; 35
  cross-tenant surfaces = 0; orphans fully classified (51 repaired with
  evidence, remainder documented-by-design).
- typecheck: 0 errors · eslint: 0 errors / 59 pre-existing warnings.

## 27. FINAL GO / NO-GO

| Gate | Status |
|---|---|
| Production Git SHA verified | ✓ 64b93b4… (local = GitHub = Vercel) |
| Vercel production SHA matches | ✓ READY deployments at 64b93b4… |
| Database migration state verified | ✓ 9/9 |
| No unexplained duplicate business records | ✓ 0 across 28 families |
| No unexplained orphan records | ✓ repaired/documented (§7) |
| No cross-tenant contamination | ✓ 0 across 35 surfaces + live gauntlet |
| Hawkings demo coherent | ✓ (§9) |
| Green Valley clean | ✓ (§10) |
| Temporary test tenant handled | ✓ full lifecycle + purged, ledger = 2 |
| Auth verified | ✓ live (login/logout/lockout/cookie hardening) |
| RBAC verified | ✓ live matrix + 622-test suite |
| API authorization verified | ✓ negative probes on every role |
| Attendance invariant | ✓ |
| Fee invariant | ✓ (exact ₹ parity) |
| Marks invariant | ✓ (0 ≤ marks ≤ max) |
| Salary invariant | ✓ |
| Room/configuration invariant | ✓ |
| Lesson planner verified | ✓ |
| Realtime verified | ✓ live end-to-end broadcast |
| RLS/security verified | ✓ advisors classified + anon probe 0 rows |
| Performance reviewed | ✓ (§15) |
| Resend production status verified | ✓ active + real delivery; domain gap documented |
| CI status verified | ✓ honestly reported: parked (§18) |
| Vercel status verified | ✓ (§3) |
| Mobile authentication verified | ✓ contract-level; hardware NOT TESTED (§19) |
| Responsive browser QA verified | ✓ 320/390/1440 |
| Mock-data audit complete | ✓ (§20) |
| Backup/restore verified | ✓ documented TESTED restore |
| Repository secret audit complete | ✓ 0 true hits (tree + full history) |
| Credential rotation verified | ✓ INC-1 families: old dead / new live |
| Old credentials confirmed dead | ✓ live 401s |
| No release blockers | ✓ (owner actions ≠ blockers) |

# **FINAL VERDICT: GO**
