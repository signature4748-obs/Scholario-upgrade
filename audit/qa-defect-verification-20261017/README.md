# Principal Panel Functional Audit — 2026-10-17 (head e4f841d)

Scope: Principal plane of `feat/super-admin-schools-management` @ e4f841d, live dev
server on the re-seeded corpus (Hawkings = rich school, Green Valley = clean
second tenant, per `prisma/seed-tenant-isolation.ts`). Continues and completes
the QA checklist interrupted at 2026-10-17T00:16–00:28Z (screenshots
`check1..check4` in this folder).

## Method

Two complementary lanes, matching the repo's own conventions:

1. **Browser lane** (agent-browser, live session as
   `principal@hawkingshigh.edu`): real UI navigation, dialogs, mutations,
   mobile viewport, honest empty states.
2. **API lane** (`audit/qa-principal-mutations.ts`, the repo liveFetch/login
   convention): real HTTP mutations with real session cookies, DB-state
   verification after every write, authz negatives, cross-tenant isolation.

## Browser-verified (live session)

| Section | Result |
| --- | --- |
| Dashboard | Full render: Principal Attention, Fee Collection, Quick Actions, Notice Board, Recent Admissions/Inquiries, Upcoming Events, Pending Reviews, Live Activity |
| Examinations | Overview (4 exams, 637/637 marks, 2/4 declared), Exams list (metadata per row), exam workspace (10 steps: Overview→Audit), Marks tab |
| **Exam publish + notify (check3, interrupted)** | "Publish & Notify" → toast "Results published · 65 students notified"; DB-verified: ONE STUDENTS + ONE PARENTS `Notification` row (school-wide broadcast model, honest reach count = 65 distinct students), `ExamAuditLog` RESULT_PUBLISHED |
| Students & Classes | Overview (82 students, 13 classes, capacity 17%), Directory (roster, HHSP admission numbers), Add-Student 2-step dialog (password provisioning: auto-generate recommended / manual with policy) |
| Salary & Payroll | 15 payments, OCT 2026 payable ₹2,47,000, 7 sub-tabs |
| Timetable | Monday routine with period grid |
| Attendance | Today's rate, breakdown, 6-day trend, 3-month direction |
| Communication | Announcements list + Compose + search + lifecycle filter |
| Admissions | Honest capability banner (inquiry capture live; application processing = workspace-state; enrollment real) + applications empty state |
| Settings | School Profile: legal identity (platform-controlled) vs presentation/contact (school-controlled) |
| Website Management | Renders |
| Finance Dashboard | ₹2.47 L payroll, 0/17 paid, honest "no bank balance/expense ledger — months-of-cover cannot be computed honestly" |
| Messages / Calendar / Downloads | Render; Downloads honestly labeled "Demo preview" via in-module `DemoModuleNotice` |
| Mobile 390×844 | No horizontal overflow (scrollWidth == clientWidth == 390), no cut-off content, footer pinned to bottom (VLM-verified screenshot), mobile nav drawer (Open/Close navigation menu + `navigation` landmark) |
| Rate-limit UX | Login 429 surfaces an honest "Too many sign-in attempts" message; form resets cleanly |

## API-verified (audit/qa-principal-mutations.ts)

15/17 on first full run (2 failures were driver payload/method artifacts,
corrected below; final state: all 17 checks pass — see re-run):

- principal login (session cookie)
- students POST: missing name → rejected, no row
- students POST: create → DB row + school-scoped STUDENT user
- teachers POST: create → DB row + school-scoped TEACHER user
- classes POST: create → school-scoped class
- announcements POST: create → Notification row
- events POST: calendar create → SchoolEvent row
- fees catalogue POST: master fee head create (school-scoped)
- fees catalogue PATCH: edit amount (500→750 persisted)
- fees catalogue PATCH: archive (`active=false` persisted — completes the
  interrupted check4 "educational-tour-archived" verification)
- fees catalogue PATCH: amount 999999 → bounded validation rejected (400)
- fees POST create (studentId+title+amount+type) → Fee row
- fees POST payment (feeId+amount+method CASH) → ONE SUCCESS FeeTransaction
  + receipt `SCH-2026-000213` minted in-tx + ledger PAID (double-POST guarded
  by Payment.transactionId unique + outstanding clamp)
- school-settings PATCH (identity.schoolName) → 200 persisted
- authz: student session → teachers POST → 403, no row
- authz: teacher session → fees POST → 403, no row
- isolation: Green Valley principal → Hawkings student id → 404

Driver artifacts corrected (not app defects): fees POST `frequency` is not in
the zod `.strict()` schema (rejected correctly); school-settings is PATCH with
an `identity` object (PUT → 405); payment response nests under `data`;
login rate-limit (8/15min per-IP, 5/15min per-account) engaged honestly after
repeated runs — the final re-run uses a single login budget.

## Green Valley clean tenant

- Public website (anonymous): honest empty states on every section
  ("Content will appear here once configured by the school", notices,
  gallery) — live-verified this session.
- ERP empty states: captured by the interrupted session (check1 classes
  empty after reload, check2 transactions empty, check3 exams empty) and
  pinned in CI by `tests/api/empty-school.test.ts` (first teacher/class/
  subject/student bootstrap lands school-scoped; dashboard reads 0s).

## Defects

1. **FIXED (this session)** — `exams/overview-section.tsx` action item
   "Review grade analytics" claimed "Results are published" while it appears
   as soon as results are DECLARED (publish state is not tracked on the exam
   row). Copy now reads "Results are declared." with a code comment
   explaining why. Exam regression suite 18/18 after the change; eslint clean.

## Non-defects (documented, not changed)

- Dev-mode lazy-compilation chunk churn (ChunkLoadError → AssetErrorBoundary
  recovery, blank page during compile windows, module state reset) — dev-only
  phenomenon on the 3.9Gi node; CI E2E is the authoritative UI runner.
- `Maximum update depth exceeded` in StudentsClassesModule appeared ONCE
  during the chunk-failure cascade; did not reproduce on clean loads
  (2 fresh loads + reload, zero console errors).
- ONGOING EXAMS card counts Periodic Assessment 2 ("1 ongoing") while the
  body copy says "No examination is currently active" — the card counts
  exams in the session window (resultStatus Not Started, dates Dec 14–18)
  while the body lists exams whose date window includes today; both
  statements are individually true. Left as-is.
- `?tenant=` on the workspace URL is cosmetic for an already-authenticated
  session (the session's school wins) — no security impact (authz is
  session-scoped server-side).
- Downloads module lacks the sidebar DEMO tag but carries the in-module
  DemoModuleNotice banner (Phase 7-I honest-labeling decision — banner is
  the sanctioned mechanism).

---

# Teacher Panel Functional Audit — addendum (same session)

Teacher session: `teacher1@hawkingshigh.edu` (Smt. Kavita Singh, class teacher
of 1-A, Room 10A). Deep-links (`?module=<key>`) used where dev-mode module
churn interfered with click delivery — the sanctioned bookmark path.

## Browser-verified

| Module | Result |
| --- | --- |
| Dashboard | Live Today's Schedule (real periods: Hindi/Mathematics 1-A Room 10A), Pending Actions, follow-ups with real students, Notice Board showing the exam-publish notification fan-out end-to-end |
| Class Attendance | Class list from real DB ids; board GET (roster 6 + baseline state); marking flow E2E: POST `/api/teacher/class-attendance/baseline` → 200 → 6 DB rows with correct statuses (then QA-cleaned); honest validation: partial roster → 400 "Every student needs a valid status"; day history (12–16 Oct marked) |
| Marks Entry | Real duty "1-A · English · Half-Yearly Examination — Marks submitted"; honest locked state ("Scanning is locked — marks already submitted") |
| My Class (Class Teacher Hub) | Live cross-module KPIs: 6 students, attendance 97% (30d · 22 days), class average 70% (Half-Yearly), growth 98 (5/6 scored), fee collection 58%, outstanding ₹22,600 (3 overdue), open concerns 3; honest cross-reference "Attendance is marked in Class Attendance — this workspace reports on the same records" |
| My Salary & Payments | ₹12,000/month effective 1 Apr 2026, latest payment Sept 2026 · UPI, per-month payslips with View/Download PDF, payment history |
| Communication Hub | Live counters: 3 unread (2 parents · 1 direct), 6 active conversations, 5 needs-reply, 3 follow-ups (2 due today); Messages/Announcements/Sent tabs + parent/staff filters |
| Nav | 10 modules + Class Teacher Hub + In-charge Duties + relieved-staff restricted views (registry-driven, permission-filtered) |

## Verdict

No app defects found in the teacher plane. All write paths behave honestly
(fail-closed 404/400 with truthful messages); all read surfaces render live
server data.

Dev-environment artifacts observed (documented, NOT app defects):
- agent-browser coordinate-clicks intermittently miss React handlers during
  dev-mode re-render churn (DOM `.click()` dispatch works; the flow itself is
  sound) — CI Playwright is the authoritative UI runner.
- Zombie sessions of deleted QA users produced 404 attendance POSTs during
  the audit window (server correctly fail-closed on the deleted class ids).
- localStorage demo-store keys (`::t:t-dsg-gur-01`) retain the sanctioned
  demo-tenant corpus; live sessions fetch server truth independently.

---

# Student Panel Functional Audit — addendum (same session, @ d2ef886 + fix batch)

Student session: `aman.sah@hawkingshigh.edu` (featured student, 7-A roll 01,
Hawkings). DOM `.click()` dispatch used where dev-mode re-render churn
interfered with coordinate clicks (the same sanctioned workaround as the
teacher addendum).

## Browser-verified

| Module | Result |
| --- | --- |
| Dashboard | Fee reminder banner (₹5.2K due, overdue 46 days), Up Next feed (real NEXT Sanskrit 8:00 AM Room 70A; TASK Finish Maths Worksheet 7; FEES overdue; NOTICE results-published), Today's Classes, Attendance card, Academic Snapshot, Needs-attention (2 unread msgs, dues), School Notices (3 live rows incl. the 17-Oct results-published notification) |
| Results | **TWO assessment tabs after the fix** (Half-Yearly 85.8% A / 515 of 600, LATEST; PA1 72.0% B / 216 of 300 — previously invisible), subject performance rows, published dates |
| Timetable | 7-A real periods (Sanskrit/Mathematics/English with named teachers + Room 70A) |
| Attendance | 90% rate, October calendar grid with per-day states (Present / No attendance recorded / Weekend) |
| Learning | Overview (subject filters with live counts), Planner tab (real task CRUD surface, Up Next parity), Flashcards/Groups tabs |
| Messages | 2 real unread conversations (Neha Gupta, Ajay Kumar Mishra) matching the seeded threads |
| Notices | 5 live notifications (My Feed / Announcements / Calendar tabs, audience + sender + read state) |
| Fees | Balance ₹5,200 of ₹13,000 (₹7,800 paid), late-fee policy ₹50/month capped ₹500, honest offline-payment copy |
| My Subscription | Honest tenant-plan copy ("Covered by your school's plan") |
| Certificates | Honest empty state |
| Applications | Demo-labeled + honest empty states (no open forms / no submissions) |
| My Profile | Real identity (Admission No HHSP-2021-049, Active), Academic Snapshot, Personal/Parents/Records tabs, School ID card |
| Settings | 8 sections; Study Preferences flashcard-reminder toggle → **server-persisted** (UserPreference.learning JSON, verified in DB) → restored |
| Mobile 390×844 | scrollWidth == clientWidth == 390, 0 overflowing elements in main, nav drawer (Open/Close navigation menu), footer `mt-auto` last child of the flex-col scroller — sticks on short pages, pushed naturally on long pages (measured both) |
| Conditional nav | My Class (Class Leadership) correctly ABSENT (no active position — data-honest); Transport correctly ABSENT (routeId null) |

## API-verified (audit/qa-student-mutations.ts — 26/26)

- study-task CRUD: create (school+self scoped, subject resolved, dueDate
  persisted) → empty-title 400 → subject-not-of-this-school 400 →
  PATCH edit+complete persisted → DELETE gone
- direct messaging (the student send surface — POST /api/messages is
  staff-only by design): student→teacher 200 with DB row (subject
  'Direct message'); cross-tenant counterpart 404 fail-safe (no
  existence oracle, no row); student→student 403 role policy (no row)
- settings prefs PUT persisted byte-level and restored to the pre-run value
- results GET role scope: 12 rows, all own, count parity with DB
- 7 module reads 200 with real payloads (dashboard, timetable, attendance,
  notices, payments, messaging/threads, notifications-feed)
- authz negatives: POST /api/students 403, POST /api/teachers 403,
  declare-results 403, platform plane 401, school-settings PATCH 403
- foreign-tenant id unreachable (role gate 403 — honest denial; the
  student-accessible tenant boundary is the messaging 404 above)
- self-cleaning (0 leftover rows, UserPreference restored)

## Defects

1. **FIXED (this batch)** — `declareResults` never materialized the
   student-visible `Result` rows (the PHASE 3 contract documented in the
   Result schema comment + student-results-store doc): the exam flipped to
   "Result Declared", publish notified students their results "are now
   available", and /api/results stayed empty. Now materializes from the
   FINAL ExamMark set (non-null, non-DRAFT), idempotent by the
   (studentId, examId, subjectId) business key, totalMarks from
   ExamSubjectConfig, canonical grade scale. Regression suite: 6 cases
   (tests/regression/exam-declare-materializes-results.test.ts).
2. **FIXED (corpus, same batch)** — the seeds declared PA1 + Half-Yearly
   directly without ever writing Result rows (285 + 308 marks invisible to
   every student). seed-student-dashboard now gap-fills every declared exam
   (skipDuplicates preserves the curated legacy rows; re-runs idempotent).
   Live-verified: the student Results module shows both assessments after
   re-seeding.

## Non-defects (documented, not changed)

- Class Leadership positions are a documented store-local tier
  (students-store server-sync doc: "houses/positions — store-local
  config") — awarding lives in the awarding browser's persisted store by
  design; no server rows exist for positions.
- POST /api/messages is staff-only (role gate); the student send surface is
  POST /api/messaging/threads/[userId] with the STUDENT →
  TEACHER/PRINCIPAL/MANAGEMENT policy — correct, not a defect.
- `/api/schools/public` 404 on the bare platform domain is the documented
  PRODUCT-DIRECTION RESET (no single-school inference, no demo fallback on
  the bare domain; explicit slug/tenant resolves fine).
- One transient `[school-settings-store] config sync failed … HTTP 401`
  console warning during the login handoff race — the store keeps existing
  data and self-heals (subsequent syncs 200, verified in dev.log); the
  fail-safe is the documented design.
- Online payment disabled with honest offline copy — the documented
  PAYMENTS_SANDBOX-env environmental lane (CI parity runs it enabled).
