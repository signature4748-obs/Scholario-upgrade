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
